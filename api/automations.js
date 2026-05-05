// API Automations engine: CRUD automazioni + nodi + grafo + enqueue eventi.
// L'esecuzione vera (process queue + scheduled steps) è in /api/automations-cron.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

async function requireUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  return { user }
}

const VALID_TRIGGERS = [
  'nuova_prenotazione', 'cambio_stato_prenotazione', 'applicazione_tag',
  'conto_ricevuto', 'nuovo_ordine', 'cambio_stato_ordine',
  'compleanno', 'iscrizione_fidelity', 'compilazione_sondaggio'
]

const VALID_NODE_TYPES = [
  'trigger', 'invia_email', 'invia_whatsapp', 'invia_sms',
  'modifica_tag', 'invia_promozione', 'invito_sondaggio',
  'invito_recensione', 'punti_fidelity', 'invia_webhook',
  'attesa', 'condizione', 'fine'
]

// ─── Templates precostruiti ────────────────────────────────────────
const TEMPLATES = {
  benvenuto: {
    nome: 'Benvenuto prima visita',
    descrizione: 'Email di benvenuto la prima volta che un cliente prenota',
    trigger_event: 'cambio_stato_prenotazione',
    trigger_filters: { stato_to: 'completed', solo_prima_visita: true },
    nodes: [
      { id: 't', tipo: 'trigger',     pos_x: 200, pos_y: 50, next: ['n1'] },
      { id: 'n1', tipo: 'attesa',     pos_x: 200, pos_y: 180, config: { unit: 'hour', value: 2 }, next: ['n2'] },
      { id: 'n2', tipo: 'invia_email', pos_x: 200, pos_y: 310, config: {
        oggetto: 'Grazie per la visita, {nome}!',
        contenuto: 'Ciao {nome},\n\nGrazie per essere venuto a {locale}. Speriamo di rivederti presto!\n\nA presto,\nLo staff'
      }, next: ['n3'] },
      { id: 'n3', tipo: 'modifica_tag', pos_x: 200, pos_y: 440, config: { action: 'add', tag_nome: 'Nuovo' }, next: ['nf'] },
      { id: 'nf', tipo: 'fine', pos_x: 200, pos_y: 570, next: [] },
    ]
  },
  ci_manchi_30: {
    nome: 'Ci manchi · 30 giorni',
    descrizione: 'Promemoria dopo 30 giorni di inattività',
    trigger_event: 'compleanno',  // placeholder; il vero "30gg inactive" è gestito dal cron
    trigger_filters: { },
    nodes: [
      { id: 't', tipo: 'trigger',     pos_x: 200, pos_y: 50, next: ['n1'] },
      { id: 'n1', tipo: 'invia_whatsapp', pos_x: 200, pos_y: 180, config: {
        contenuto: 'Ciao {nome}! Ci manchi. Vieni a trovarci a {locale}: ti aspetta una sorpresa.'
      }, next: ['nf'] },
      { id: 'nf', tipo: 'fine', pos_x: 200, pos_y: 310, next: [] },
    ]
  },
  compleanno: {
    nome: 'Auguri compleanno + sconto',
    descrizione: 'Augurio automatico il giorno del compleanno con codice sconto',
    trigger_event: 'compleanno',
    trigger_filters: { },
    nodes: [
      { id: 't', tipo: 'trigger',     pos_x: 200, pos_y: 50, next: ['n1'] },
      { id: 'n1', tipo: 'invia_whatsapp', pos_x: 200, pos_y: 180, config: {
        contenuto: 'Tanti auguri {nome}! Per festeggiare ti regaliamo il 10% sulla tua prossima visita a {locale}. Buon compleanno!'
      }, next: ['nf'] },
      { id: 'nf', tipo: 'fine', pos_x: 200, pos_y: 310, next: [] },
    ]
  },
  punti_per_euro: {
    nome: 'Punti fidelity per ogni Euro speso',
    descrizione: 'Accredita punti automatici al ricevimento conto',
    trigger_event: 'conto_ricevuto',
    trigger_filters: { },
    nodes: [
      { id: 't', tipo: 'trigger',     pos_x: 200, pos_y: 50, next: ['n1'] },
      { id: 'n1', tipo: 'punti_fidelity', pos_x: 200, pos_y: 180, config: { punti_per_euro: 1 }, next: ['nf'] },
      { id: 'nf', tipo: 'fine', pos_x: 200, pos_y: 310, next: [] },
    ]
  },
  sondaggio_post_visita: {
    nome: 'Sondaggio NPS post-visita',
    descrizione: '8 ore dopo la chiusura conto, invio richiesta sondaggio',
    trigger_event: 'cambio_stato_prenotazione',
    trigger_filters: { stato_to: 'completed' },
    nodes: [
      { id: 't', tipo: 'trigger',     pos_x: 200, pos_y: 50, next: ['n1'] },
      { id: 'n1', tipo: 'attesa',     pos_x: 200, pos_y: 180, config: { unit: 'hour', value: 8 }, next: ['n2'] },
      { id: 'n2', tipo: 'invia_email', pos_x: 200, pos_y: 310, config: {
        oggetto: 'Com\'è andata la tua visita a {locale}?',
        contenuto: 'Ciao {nome},\n\ngrazie di essere venuto. Vorresti farci sapere com\'è andata? Ti basta un attimo.\n\nGrazie!'
      }, next: ['nf'] },
      { id: 'nf', tipo: 'fine', pos_x: 200, pos_y: 440, next: [] },
    ]
  },
}

async function createAutomationFromTemplate(user_id, locale, template_key) {
  const tpl = TEMPLATES[template_key]
  if (!tpl) throw new Error('template inesistente')
  const { data: aut, error } = await sb.from('automations').insert({
    user_id, locale,
    nome: tpl.nome,
    descrizione: tpl.descrizione,
    trigger_event: tpl.trigger_event,
    trigger_filters: tpl.trigger_filters,
    attivo: false,
    template_key,
  }).select().maybeSingle()
  if (error) throw error
  // Crea nodi (prima senza next_node_ids, poi update con id reali)
  const nodeRows = tpl.nodes.map(n => ({
    automation_id: aut.id,
    tipo: n.tipo,
    config: n.config || {},
    pos_x: n.pos_x, pos_y: n.pos_y,
  }))
  const { data: created, error: e2 } = await sb.from('automation_nodes').insert(nodeRows).select()
  if (e2) throw e2
  // Mappa template_id -> uuid reale (per l'ordine dell'array, in pratica li abbiamo creati in sequenza)
  const idMap = {}
  tpl.nodes.forEach((n, i) => { idMap[n.id] = created[i].id })
  // Aggiorna next_node_ids
  for (let i = 0; i < tpl.nodes.length; i++) {
    const n = tpl.nodes[i]
    const nextIds = (n.next || []).map(t => idMap[t]).filter(Boolean)
    if (nextIds.length > 0) {
      await sb.from('automation_nodes').update({ next_node_ids: nextIds }).eq('id', created[i].id)
    }
  }
  return aut
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await requireUser(req)
  if (auth.error) return res.status(401).json({ error: auth.error })
  const user_id = auth.user.id

  const action = (req.body && req.body.action) || req.query.action
  const body = req.body || {}

  try {
    switch (action) {

      case 'list': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('automations').select('*')
          .eq('user_id', user_id).eq('locale', locale)
          .order('attivo', { ascending: false })
          .order('created_at', { ascending: false })
        if (error) throw error
        return res.status(200).json({ automations: data || [] })
      }

      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data: aut, error } = await sb.from('automations').select('*')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        if (!aut) return res.status(404).json({ error: 'non trovata' })
        const { data: nodes } = await sb.from('automation_nodes').select('*')
          .eq('automation_id', id)
        return res.status(200).json({ automation: aut, nodes: nodes || [] })
      }

      case 'create': {
        const a = body.automation || {}
        if (!a.locale || !a.nome || !a.trigger_event) return res.status(400).json({ error: 'locale, nome, trigger_event required' })
        if (!VALID_TRIGGERS.includes(a.trigger_event)) return res.status(400).json({ error: 'trigger invalido' })
        const { data, error } = await sb.from('automations').insert({
          user_id,
          locale: a.locale,
          nome: a.nome.trim(),
          descrizione: a.descrizione ?? null,
          trigger_event: a.trigger_event,
          trigger_filters: a.trigger_filters || {},
          attivo: false,
        }).select().maybeSingle()
        if (error) throw error
        // Crea il nodo trigger di base
        await sb.from('automation_nodes').insert({
          automation_id: data.id,
          tipo: 'trigger',
          pos_x: 200, pos_y: 50,
        })
        return res.status(200).json({ automation: data })
      }

      case 'create-from-template': {
        const { locale, template_key } = body
        if (!locale || !template_key) return res.status(400).json({ error: 'locale, template_key required' })
        const aut = await createAutomationFromTemplate(user_id, locale, template_key)
        return res.status(200).json({ automation: aut })
      }

      case 'list-templates': {
        return res.status(200).json({
          templates: Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, nome: t.nome, descrizione: t.descrizione }))
        })
      }

      case 'update-meta': {
        const { id, nome, descrizione, trigger_event, trigger_filters, attivo } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const upd = { updated_at: new Date().toISOString() }
        if (nome !== undefined)            upd.nome = nome
        if (descrizione !== undefined)     upd.descrizione = descrizione
        if (trigger_event !== undefined) {
          if (!VALID_TRIGGERS.includes(trigger_event)) return res.status(400).json({ error: 'trigger invalido' })
          upd.trigger_event = trigger_event
        }
        if (trigger_filters !== undefined) upd.trigger_filters = trigger_filters || {}
        if (attivo !== undefined)          upd.attivo = !!attivo
        const { data, error } = await sb.from('automations').update(upd)
          .eq('user_id', user_id).eq('id', id).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ automation: data })
      }

      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('automations').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── Nodi: l'editor canvas chiama questi per CRUD del grafo ────
      case 'node-upsert': {
        const n = body.node || {}
        if (!n.automation_id || !n.tipo) return res.status(400).json({ error: 'automation_id, tipo required' })
        if (!VALID_NODE_TYPES.includes(n.tipo)) return res.status(400).json({ error: 'tipo invalido' })
        // verify ownership
        const { data: aut } = await sb.from('automations').select('user_id').eq('id', n.automation_id).maybeSingle()
        if (!aut || aut.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const payload = {
          automation_id: n.automation_id,
          tipo: n.tipo,
          config: n.config || {},
          pos_x: Number(n.pos_x || 0),
          pos_y: Number(n.pos_y || 0),
          next_node_ids: Array.isArray(n.next_node_ids) ? n.next_node_ids : [],
          updated_at: new Date().toISOString(),
        }
        if (n.id) {
          const { data, error } = await sb.from('automation_nodes').update(payload).eq('id', n.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ node: data })
        }
        const { data, error } = await sb.from('automation_nodes').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ node: data })
      }

      case 'node-delete': {
        const { id, automation_id } = body
        if (!id || !automation_id) return res.status(400).json({ error: 'id, automation_id required' })
        const { data: aut } = await sb.from('automations').select('user_id').eq('id', automation_id).maybeSingle()
        if (!aut || aut.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const { error } = await sb.from('automation_nodes').delete().eq('id', id)
        if (error) throw error
        // rimuovi anche da next_node_ids di altri nodi
        const { data: others } = await sb.from('automation_nodes').select('id, next_node_ids').eq('automation_id', automation_id)
        for (const o of (others || [])) {
          if ((o.next_node_ids || []).includes(id)) {
            await sb.from('automation_nodes').update({ next_node_ids: o.next_node_ids.filter(x => x !== id) }).eq('id', o.id)
          }
        }
        return res.status(200).json({ ok: true })
      }

      // ─── ENQUEUE EVENT (chiamato da hooks interni e dal POS) ────────
      case 'enqueue-event': {
        const { locale, evento, payload, customer_id = null } = body
        if (!locale || !evento) return res.status(400).json({ error: 'locale, evento required' })
        if (!VALID_TRIGGERS.includes(evento)) return res.status(400).json({ error: 'evento invalido' })
        const { data, error } = await sb.from('automation_events_queue').insert({
          user_id, locale, evento, payload: payload || {}, customer_id,
        }).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ event: data })
      }

      // ─── Esecuzioni / log ────────────────────────────────────────────
      case 'runs': {
        const { automation_id, limit = 50 } = body
        if (!automation_id) return res.status(400).json({ error: 'automation_id required' })
        const { data, error } = await sb.from('automation_runs')
          .select('*, customers(id, nome, cognome, telefono, email)')
          .eq('user_id', user_id).eq('automation_id', automation_id)
          .order('started_at', { ascending: false }).limit(limit)
        if (error) throw error
        return res.status(200).json({ runs: data || [] })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
