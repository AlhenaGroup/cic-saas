// Widget pubblico prenotazioni — endpoint NO AUTH.
// Usato dalla pagina pubblica /prenota/<slug> per:
//   GET  ?slug=xxx          → restituisce settings widget (nome, gdpr_text, pax_max, occasioni, colore)
//   POST {slug, ...payload} → crea prenotazione + customer (se nuovo) + evento nuova_prenotazione
//
// Validazioni:
//   - slug deve esistere e settings.attivo = true
//   - honeypot field "hp" deve essere vuoto (anti-bot)
//   - nome/telefono obbligatori; email opzionale ma raccomandata
//   - data_ora futura (max 90 giorni)
//   - pax 1..pax_max
//   - rate limit per IP+slug: max 3 invii / 10 min (best-effort via tabella throttle in memoria del runtime)
//
// Sicurezza:
//   - Service key Supabase (bypassa RLS); l'isolamento è imposto via slug → (user_id, locale) lookup
//   - CORS aperto (deve funzionare embed cross-origin)

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

// Rate-limit ingenuo in-memory (per istanza serverless). Sufficiente per il pilota.
// Per scalare seriamente serve Redis o tabella DB.
const THROTTLE = new Map()  // key = `${ip}:${slug}` → { count, since }
const THROTTLE_MAX = 3
const THROTTLE_WINDOW_MS = 10 * 60 * 1000

function isThrottled(ip, slug) {
  const key = `${ip}:${slug}`
  const now = Date.now()
  const r = THROTTLE.get(key)
  if (!r || (now - r.since) > THROTTLE_WINDOW_MS) {
    THROTTLE.set(key, { count: 1, since: now })
    return false
  }
  r.count += 1
  if (r.count > THROTTLE_MAX) return true
  return false
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'] || ''
  return String(xff.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim()
}

function sanitize(s, max = 500) {
  if (s == null) return null
  return String(s).slice(0, max).trim() || null
}
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(s || '')) }
function isPhone(s) { return /^[+]?[0-9\s().\-/]{6,20}$/.test(String(s || '')) }

export default async function handler(req, res) {
  // CORS (widget embed-abile)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    // ─── GET: leggi settings widget ─────────────────────────────────────
    if (req.method === 'GET') {
      const slug = sanitize(req.query.slug, 80)
      if (!slug) return res.status(400).json({ error: 'slug required' })
      const { data: settings } = await sb.from('public_widget_settings')
        .select('slug, nome_visualizzato, attivo, pax_max, durata_default_min, gdpr_text, messaggio_benvenuto, colore_primario, occasioni')
        .eq('slug', slug).maybeSingle()
      if (!settings) return res.status(404).json({ error: 'Widget non trovato' })
      if (!settings.attivo) return res.status(403).json({ error: 'Widget disattivato' })
      return res.status(200).json({ settings })
    }

    // ─── POST: crea prenotazione ────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

    const body = req.body || {}
    const slug = sanitize(body.slug, 80)
    if (!slug) return res.status(400).json({ error: 'slug required' })

    // honeypot: deve essere vuoto. Se ha valore → bot → restituisco success fake.
    if (body.hp && String(body.hp).trim().length > 0) {
      return res.status(200).json({ ok: true, reservation_id: null })
    }

    const ip = getClientIp(req)
    if (isThrottled(ip, slug)) {
      return res.status(429).json({ error: 'Troppe richieste, riprova fra qualche minuto' })
    }

    // Carica settings
    const { data: settings } = await sb.from('public_widget_settings')
      .select('user_id, locale, attivo, pax_max, durata_default_min')
      .eq('slug', slug).maybeSingle()
    if (!settings) return res.status(404).json({ error: 'Widget non trovato' })
    if (!settings.attivo) return res.status(403).json({ error: 'Widget disattivato' })

    // Sanitizza & valida campi
    const nome = sanitize(body.nome, 80)
    const cognome = sanitize(body.cognome, 80)
    const telefono = sanitize(body.telefono, 30)
    const email = sanitize(body.email, 120)
    const note = sanitize(body.note, 500)
    const occasione = sanitize(body.occasione, 50)
    const allergie = sanitize(body.allergie, 200)
    const pax = Number(body.pax || 0)
    const dataOraRaw = sanitize(body.data_ora, 40)  // ISO 8601 atteso

    if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' })
    if (!telefono || !isPhone(telefono)) return res.status(400).json({ error: 'Telefono non valido' })
    if (email && !isEmail(email)) return res.status(400).json({ error: 'Email non valida' })
    if (!pax || pax < 1 || pax > settings.pax_max) {
      return res.status(400).json({ error: `Numero persone non valido (1-${settings.pax_max})` })
    }
    if (!dataOraRaw) return res.status(400).json({ error: 'Data/ora obbligatoria' })
    const dt = new Date(dataOraRaw)
    if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Data/ora non valida' })
    const now = Date.now()
    if (dt.getTime() < now - 60_000) return res.status(400).json({ error: 'Data/ora nel passato' })
    if (dt.getTime() > now + 90 * 86400_000) return res.status(400).json({ error: 'Data/ora troppo in là (max 90 giorni)' })

    const gdprMarketing = !!body.gdpr_marketing

    // Trova/crea customer (per (user_id, locale, email)). Se no email, dedup per telefono.
    let customer_id = null
    if (email) {
      const { data: existing } = await sb.from('customers')
        .select('id')
        .eq('user_id', settings.user_id)
        .eq('locale', settings.locale)
        .ilike('email', email)
        .maybeSingle()
      if (existing) customer_id = existing.id
    }
    if (!customer_id && telefono) {
      const { data: existing } = await sb.from('customers')
        .select('id')
        .eq('user_id', settings.user_id)
        .eq('locale', settings.locale)
        .eq('telefono', telefono)
        .maybeSingle()
      if (existing) customer_id = existing.id
    }
    if (!customer_id) {
      // crea customer nuovo
      const { data: created, error: errC } = await sb.from('customers').insert({
        user_id: settings.user_id,
        locale: settings.locale,
        nome,
        cognome,
        telefono,
        email,
        source: 'public_widget',
        gdpr_marketing: gdprMarketing,
        gdpr_consent_at: gdprMarketing ? new Date().toISOString() : null,
      }).select('id').maybeSingle()
      if (errC) {
        // Se conflict su UNIQUE email, riprova lookup
        if (errC.code === '23505' && email) {
          const { data: again } = await sb.from('customers')
            .select('id').eq('user_id', settings.user_id).eq('locale', settings.locale)
            .ilike('email', email).maybeSingle()
          customer_id = again?.id || null
        } else throw errC
      } else {
        customer_id = created?.id || null
      }
    } else {
      // Aggiorna anagrafica con eventuali nuovi dati + GDPR consent (best effort, non strict)
      const upd = { last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      if (nome) upd.nome = nome
      if (cognome) upd.cognome = cognome
      if (telefono) upd.telefono = telefono
      if (email) upd.email = email
      if (gdprMarketing) {
        upd.gdpr_marketing = true
        upd.gdpr_consent_at = new Date().toISOString()
      }
      await sb.from('customers').update(upd).eq('id', customer_id)
    }

    // Inserisci prenotazione
    const { data: reservation, error: errR } = await sb.from('reservations').insert({
      user_id: settings.user_id,
      locale: settings.locale,
      customer_id,
      guest_nome: customer_id ? null : (nome + (cognome ? ' ' + cognome : '')),
      guest_telefono: customer_id ? null : telefono,
      guest_email: customer_id ? null : email,
      data_ora: dt.toISOString(),
      durata_min: settings.durata_default_min,
      pax,
      stato: 'pending',
      source: 'public_widget',
      occasione,
      note,
      allergie,
    }).select('id').maybeSingle()
    if (errR) throw errR

    // Emetti evento nuova_prenotazione per automation engine (es. email/WA di conferma)
    await sb.from('automation_events_queue').insert({
      user_id: settings.user_id,
      locale: settings.locale,
      evento: 'nuova_prenotazione',
      customer_id,
      payload: {
        reservation_id: reservation.id,
        pax,
        data_ora: dt.toISOString(),
        source: 'public_widget',
      },
    })

    return res.status(200).json({ ok: true, reservation_id: reservation.id })
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
