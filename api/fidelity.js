// API Fidelity (programma punti).
// - Dashboard: CRUD programma + premi
// - POS: balance / accumulate / redeem al checkout
// Auth: Bearer JWT del ristoratore. Multi-tenant via RLS.

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

// Saldo punti del cliente (non scaduti)
async function balanceOf(customer_id) {
  const { data } = await sb.from('fidelity_movements')
    .select('punti, expires_at')
    .eq('customer_id', customer_id)
  if (!data) return 0
  const now = new Date()
  return data.reduce((s, m) => {
    if (m.expires_at && new Date(m.expires_at) <= now) return s
    return s + (m.punti || 0)
  }, 0)
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

      // ─── PROGRAM ──────────────────────────────────────────────────────
      case 'program-get': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('fidelity_programs').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (error) throw error
        return res.status(200).json({ program: data })
      }

      case 'program-upsert': {
        const p = body.program || {}
        if (!p.locale || !p.nome) return res.status(400).json({ error: 'locale and nome required' })
        const payload = {
          user_id,
          locale: p.locale,
          nome: p.nome.trim(),
          descrizione: p.descrizione ?? null,
          punti_per_euro: Number(p.punti_per_euro || 1),
          punti_visita: Number(p.punti_visita || 0),
          punti_iscrizione: Number(p.punti_iscrizione || 0),
          punti_compleanno: Number(p.punti_compleanno || 0),
          durata_punti_giorni: p.durata_punti_giorni == null || p.durata_punti_giorni === '' ? null : Number(p.durata_punti_giorni),
          attivo: p.attivo === false ? false : true,
          updated_at: new Date().toISOString(),
        }
        if (p.id) {
          const { data, error } = await sb.from('fidelity_programs').update(payload)
            .eq('user_id', user_id).eq('id', p.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ program: data })
        }
        const { data, error } = await sb.from('fidelity_programs').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ program: data })
      }

      // ─── REWARDS ──────────────────────────────────────────────────────
      case 'rewards-list': {
        const { program_id, locale } = body
        if (!program_id && !locale) return res.status(400).json({ error: 'program_id or locale required' })
        let q = sb.from('fidelity_rewards').select('*').eq('user_id', user_id)
          .order('attivo', { ascending: false }).order('punti_richiesti', { ascending: true })
        if (program_id) q = q.eq('program_id', program_id)
        if (locale)     q = q.eq('locale', locale)
        const { data, error } = await q
        if (error) throw error
        return res.status(200).json({ rewards: data || [] })
      }

      case 'reward-upsert': {
        const r = body.reward || {}
        if (!r.program_id || !r.locale || !r.nome || !r.punti_richiesti) return res.status(400).json({ error: 'program_id, locale, nome, punti_richiesti required' })
        const payload = {
          user_id,
          locale: r.locale,
          program_id: r.program_id,
          nome: r.nome.trim(),
          descrizione: r.descrizione ?? null,
          punti_richiesti: Number(r.punti_richiesti),
          tipo: r.tipo || 'omaggio',
          valore: Number(r.valore || 0),
          max_riscatti_globali: r.max_riscatti_globali == null || r.max_riscatti_globali === '' ? null : Number(r.max_riscatti_globali),
          max_riscatti_per_cliente: Number(r.max_riscatti_per_cliente || 1),
          attivo: r.attivo === false ? false : true,
          updated_at: new Date().toISOString(),
        }
        if (r.id) {
          const { data, error } = await sb.from('fidelity_rewards').update(payload)
            .eq('user_id', user_id).eq('id', r.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ reward: data })
        }
        const { data, error } = await sb.from('fidelity_rewards').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ reward: data })
      }

      case 'reward-delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('fidelity_rewards').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── BALANCE (POS / dashboard) ────────────────────────────────────
      case 'balance': {
        const { customer_id } = body
        if (!customer_id) return res.status(400).json({ error: 'customer_id required' })
        // verify ownership
        const { data: c } = await sb.from('customers').select('user_id, locale').eq('id', customer_id).maybeSingle()
        if (!c || c.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const saldo = await balanceOf(customer_id)
        // Ultimi 20 movimenti
        const { data: mov } = await sb.from('fidelity_movements')
          .select('*, fidelity_rewards(nome)')
          .eq('customer_id', customer_id)
          .order('movimento_at', { ascending: false }).limit(20)
        return res.status(200).json({ balance: saldo, movements: mov || [] })
      }

      // ─── ACCUMULATE (POS al checkout) ─────────────────────────────────
      case 'accumulate': {
        const { customer_id, locale, importo_scontrino, scontrino_id = null, force_visita = false } = body
        if (!customer_id || !locale) return res.status(400).json({ error: 'customer_id and locale required' })
        // verify ownership
        const { data: c } = await sb.from('customers').select('user_id').eq('id', customer_id).maybeSingle()
        if (!c || c.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        // get program
        const { data: prog } = await sb.from('fidelity_programs').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (!prog || !prog.attivo) return res.status(409).json({ error: 'programma non attivo' })

        const importo = Number(importo_scontrino || 0)
        const punti_spesa = Math.floor(importo * Number(prog.punti_per_euro || 0))
        const punti_visita = (prog.punti_visita || 0) > 0 ? prog.punti_visita : 0

        // first ever movement for this customer? then welcome bonus
        let punti_welcome = 0
        if (prog.punti_iscrizione > 0) {
          const { count } = await sb.from('fidelity_movements')
            .select('*', { count: 'exact', head: true })
            .eq('customer_id', customer_id).eq('program_id', prog.id)
          if ((count || 0) === 0) punti_welcome = prog.punti_iscrizione
        }

        const expires = prog.durata_punti_giorni
          ? new Date(Date.now() + prog.durata_punti_giorni * 86400000).toISOString()
          : null

        const movs = []
        if (punti_welcome > 0) movs.push({ user_id, customer_id, program_id: prog.id, tipo: 'iscrizione', punti: punti_welcome, expires_at: expires })
        if (punti_spesa  > 0) movs.push({ user_id, customer_id, program_id: prog.id, tipo: 'accumulo',   punti: punti_spesa, scontrino_id, importo_scontrino: importo, expires_at: expires })
        if ((punti_visita > 0) || force_visita) movs.push({ user_id, customer_id, program_id: prog.id, tipo: 'accumulo', punti: punti_visita, scontrino_id, expires_at: expires, note: 'bonus visita' })

        if (movs.length === 0) return res.status(200).json({ ok: true, accumulated: 0, balance: await balanceOf(customer_id) })

        const { error } = await sb.from('fidelity_movements').insert(movs)
        if (error) throw error
        // update last_seen_at on customer
        await sb.from('customers').update({ last_seen_at: new Date().toISOString() }).eq('id', customer_id)

        return res.status(200).json({
          ok: true,
          accumulated: punti_spesa + punti_visita + punti_welcome,
          breakdown: { spesa: punti_spesa, visita: punti_visita, iscrizione: punti_welcome },
          balance: await balanceOf(customer_id),
        })
      }

      // ─── REDEEM REWARD (POS al checkout) ─────────────────────────────
      case 'redeem': {
        const { customer_id, reward_id, scontrino_id = null, note = null } = body
        if (!customer_id || !reward_id) return res.status(400).json({ error: 'customer_id and reward_id required' })
        const { data: c } = await sb.from('customers').select('user_id').eq('id', customer_id).maybeSingle()
        if (!c || c.user_id !== user_id) return res.status(403).json({ error: 'not owner' })

        const { data: rew, error: e1 } = await sb.from('fidelity_rewards').select('*')
          .eq('user_id', user_id).eq('id', reward_id).maybeSingle()
        if (e1) throw e1
        if (!rew || !rew.attivo) return res.status(409).json({ error: 'premio non disponibile' })
        if (rew.max_riscatti_globali != null && rew.riscatti_totali >= rew.max_riscatti_globali) return res.status(409).json({ error: 'premio esaurito' })

        // limiti per cliente
        if (rew.max_riscatti_per_cliente != null) {
          const { count } = await sb.from('fidelity_movements')
            .select('*', { count: 'exact', head: true })
            .eq('customer_id', customer_id).eq('reward_id', reward_id).eq('tipo', 'riscatto')
          if ((count || 0) >= rew.max_riscatti_per_cliente) return res.status(409).json({ error: 'cliente ha già riscattato questo premio' })
        }

        // saldo sufficiente?
        const saldo = await balanceOf(customer_id)
        if (saldo < rew.punti_richiesti) return res.status(409).json({ error: `saldo insufficiente (${saldo}/${rew.punti_richiesti})` })

        const { error: e2 } = await sb.from('fidelity_movements').insert({
          user_id, customer_id, program_id: rew.program_id, reward_id,
          tipo: 'riscatto',
          punti: -rew.punti_richiesti,
          scontrino_id,
          note,
        })
        if (e2) throw e2

        await sb.from('fidelity_rewards').update({ riscatti_totali: (rew.riscatti_totali || 0) + 1, updated_at: new Date().toISOString() })
          .eq('id', reward_id)

        return res.status(200).json({ ok: true, reward: rew, punti_scalati: rew.punti_richiesti, balance: await balanceOf(customer_id) })
      }

      // ─── MANUAL ADJUST (admin) ────────────────────────────────────────
      case 'manual-adjust': {
        const { customer_id, locale, punti, note = null } = body
        if (!customer_id || !locale || !punti) return res.status(400).json({ error: 'customer_id, locale, punti required' })
        const { data: c } = await sb.from('customers').select('user_id').eq('id', customer_id).maybeSingle()
        if (!c || c.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const { data: prog } = await sb.from('fidelity_programs').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (!prog) return res.status(409).json({ error: 'programma non configurato per questo locale' })
        const expires = prog.durata_punti_giorni && Number(punti) > 0
          ? new Date(Date.now() + prog.durata_punti_giorni * 86400000).toISOString()
          : null
        const { error } = await sb.from('fidelity_movements').insert({
          user_id, customer_id, program_id: prog.id, tipo: 'manuale', punti: Number(punti), note, expires_at: expires,
        })
        if (error) throw error
        return res.status(200).json({ ok: true, balance: await balanceOf(customer_id) })
      }

      // ─── TOP CLIENTS by saldo ────────────────────────────────────────
      case 'top-clients': {
        const { locale, limit = 20 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data: prog } = await sb.from('fidelity_programs').select('id')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (!prog) return res.status(200).json({ top: [] })
        // recupero tutti i movimenti per il programma (semplice, dataset piccolo per cliente)
        const { data: movs } = await sb.from('fidelity_movements')
          .select('customer_id, punti, expires_at')
          .eq('program_id', prog.id)
        const now = new Date()
        const balByCust = {}
        for (const m of (movs || [])) {
          if (m.expires_at && new Date(m.expires_at) <= now) continue
          balByCust[m.customer_id] = (balByCust[m.customer_id] || 0) + (m.punti || 0)
        }
        const ids = Object.keys(balByCust).filter(id => balByCust[id] > 0)
          .sort((a, b) => balByCust[b] - balByCust[a]).slice(0, limit)
        if (ids.length === 0) return res.status(200).json({ top: [] })
        const { data: custs } = await sb.from('customers')
          .select('id, nome, cognome, telefono, email').in('id', ids)
        const top = ids.map(id => ({
          customer: (custs || []).find(c => c.id === id),
          balance: balByCust[id],
        }))
        return res.status(200).json({ top })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
