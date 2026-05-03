// API centralino: CRUD config + lista chiamate.
// I webhook Twilio (/api/twilio-webhook) sono separati (no auth).

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

const DEFAULT_GREETING = 'Benvenuto. Premi 1 per ricevere il link prenotazione su WhatsApp, oppure 2 per parlare con il ristorante.'
const DEFAULT_WA_TEMPLATE = 'Ciao! Per prenotare al ristorante clicca: {link}'
const DEFAULT_VOICEMAIL = 'Lasciate un messaggio dopo il segnale, vi richiameremo al più presto.'
const DEFAULT_FUORI = 'In questo momento siamo chiusi. Lasciate un messaggio dopo il segnale.'

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

      // ─── CONFIG ──────────────────────────────────────────────────────
      case 'config-get': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('centralino_config').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (error) throw error
        return res.status(200).json({ config: data })
      }

      case 'config-upsert': {
        const c = body.config || {}
        if (!c.locale) return res.status(400).json({ error: 'locale required' })
        const payload = {
          user_id,
          locale: c.locale,
          twilio_number: c.twilio_number || null,
          twilio_phone_sid: c.twilio_phone_sid || null,
          attivo: !!c.attivo,
          lingua: c.lingua || 'it-IT',
          greeting_mode: c.greeting_mode || 'tts',
          greeting_text: c.greeting_text || DEFAULT_GREETING,
          greeting_audio_url: c.greeting_audio_url || null,
          opt1_enabled: c.opt1_enabled !== false,
          whatsapp_template: c.whatsapp_template || DEFAULT_WA_TEMPLATE,
          prenotazione_url: c.prenotazione_url || null,
          opt2_enabled: c.opt2_enabled !== false,
          parallel_ring_numbers: Array.isArray(c.parallel_ring_numbers) ? c.parallel_ring_numbers : [],
          parallel_ring_timeout_sec: Number(c.parallel_ring_timeout_sec || 20),
          voicemail_enabled: c.voicemail_enabled !== false,
          voicemail_text: c.voicemail_text || DEFAULT_VOICEMAIL,
          orari_attivi: c.orari_attivi || {},
          fuori_orario_text: c.fuori_orario_text || DEFAULT_FUORI,
          updated_at: new Date().toISOString(),
        }
        if (c.id) {
          const { data, error } = await sb.from('centralino_config').update(payload)
            .eq('user_id', user_id).eq('id', c.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ config: data })
        }
        const { data, error } = await sb.from('centralino_config').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ config: data })
      }

      // ─── CALLS log ───────────────────────────────────────────────────
      case 'calls-list': {
        const { locale, limit = 100 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('centralino_calls')
          .select('*, customers(id, nome, cognome)')
          .eq('user_id', user_id).eq('locale', locale)
          .order('started_at', { ascending: false }).limit(limit)
        if (error) throw error
        return res.status(200).json({ calls: data || [] })
      }

      case 'calls-stats': {
        const { locale, days = 30 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const since = new Date(Date.now() - days * 86400000).toISOString()
        const { data, error } = await sb.from('centralino_calls')
          .select('esito, durata_sec')
          .eq('user_id', user_id).eq('locale', locale)
          .gte('started_at', since)
        if (error) throw error
        const out = { totale: 0, per_esito: {}, durata_media: 0 }
        let durSum = 0, durCount = 0
        for (const c of (data || [])) {
          out.totale++
          out.per_esito[c.esito || 'unknown'] = (out.per_esito[c.esito || 'unknown'] || 0) + 1
          if (c.durata_sec) { durSum += c.durata_sec; durCount++ }
        }
        out.durata_media = durCount > 0 ? Math.round(durSum / durCount) : 0
        return res.status(200).json({ stats: out })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
