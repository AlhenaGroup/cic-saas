// API recensioni: CRUD + generate-reply AI con tone-of-voice del locale.
// Per ora ingestion manuale (paste copy/incolla). Sync automatico Google
// Business Profile in fase successiva.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

async function requireUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  return { user }
}

function detectSentiment(voto) {
  if (voto == null) return null
  if (voto >= 4) return 'positive'
  if (voto >= 3) return 'neutral'
  return 'negative'
}

async function callAnthropic(systemPrompt, userPrompt) {
  if (!ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY non configurata' }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.error?.message || 'AI error' }
  const text = (j.content || []).map(c => c.text || '').join('').trim()
  return { text }
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

      // ─── SETTINGS ──────────────────────────────────────────────────
      case 'settings-get': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('review_settings').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (error) throw error
        return res.status(200).json({ settings: data })
      }

      case 'settings-upsert': {
        const s = body.settings || {}
        if (!s.locale) return res.status(400).json({ error: 'locale required' })
        const payload = {
          user_id,
          locale: s.locale,
          tone_of_voice: s.tone_of_voice ?? null,
          firma: s.firma ?? null,
          auto_draft: s.auto_draft !== false,
          google_place_id: s.google_place_id ?? null,
          tripadvisor_url: s.tripadvisor_url ?? null,
          updated_at: new Date().toISOString(),
        }
        if (s.id) {
          const { data, error } = await sb.from('review_settings').update(payload)
            .eq('user_id', user_id).eq('id', s.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ settings: data })
        }
        const { data, error } = await sb.from('review_settings').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ settings: data })
      }

      // ─── REVIEWS list ───────────────────────────────────────────────
      case 'list': {
        const { locale, voto = null, sorgente = null, only_no_reply = false, limit = 200 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        let q = sb.from('reviews').select('*')
          .eq('user_id', user_id).eq('locale', locale).eq('archiviata', false)
          .order('data_pubblicazione', { ascending: false, nullsFirst: false })
          .limit(limit)
        if (voto != null) q = q.eq('voto', voto)
        if (sorgente)     q = q.eq('sorgente', sorgente)
        if (only_no_reply) q = q.is('risposta', null)
        const { data, error } = await q
        if (error) throw error
        return res.status(200).json({ reviews: data || [] })
      }

      case 'kpi': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('reviews').select('voto, risposta, sorgente')
          .eq('user_id', user_id).eq('locale', locale).eq('archiviata', false)
        if (error) throw error
        const arr = data || []
        const totale = arr.length
        const conRisposta = arr.filter(r => r.risposta).length
        const senzaRisposta = totale - conRisposta
        const negative = arr.filter(r => r.voto != null && r.voto <= 2).length
        const sumVoti = arr.reduce((s, r) => s + (r.voto || 0), 0)
        const countVoti = arr.filter(r => r.voto != null).length
        const media = countVoti > 0 ? (sumVoti / countVoti) : 0
        return res.status(200).json({ kpi: { totale, conRisposta, senzaRisposta, negative, media: Math.round(media * 10) / 10 } })
      }

      // ─── UPSERT (manuale o sync) ────────────────────────────────────
      case 'upsert': {
        const r = body.review || {}
        if (!r.locale || !r.sorgente) return res.status(400).json({ error: 'locale and sorgente required' })
        const payload = {
          user_id,
          locale: r.locale,
          sorgente: r.sorgente,
          external_id: r.external_id ?? null,
          url: r.url ?? null,
          autore: r.autore ?? null,
          voto: r.voto != null ? Number(r.voto) : null,
          testo: r.testo ?? null,
          data_pubblicazione: r.data_pubblicazione || null,
          sentiment: r.sentiment || detectSentiment(r.voto),
          reply_draft: r.reply_draft ?? null,
          risposta: r.risposta ?? null,
          risposta_at: r.risposta_at || (r.risposta ? new Date().toISOString() : null),
          risposta_by: r.risposta ? user_id : null,
          customer_id: r.customer_id || null,
          archiviata: !!r.archiviata,
          updated_at: new Date().toISOString(),
        }
        if (r.id) {
          const { data, error } = await sb.from('reviews').update(payload)
            .eq('user_id', user_id).eq('id', r.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ review: data })
        }
        const { data, error } = await sb.from('reviews').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ review: data })
      }

      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('reviews').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'archive': {
        const { id, archiviata = true } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('reviews').update({ archiviata: !!archiviata, updated_at: new Date().toISOString() })
          .eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── AI: genera bozza risposta con tone-of-voice del locale ─────
      case 'generate-reply': {
        const { id, locale } = body
        if (!id || !locale) return res.status(400).json({ error: 'id and locale required' })
        const { data: rev } = await sb.from('reviews').select('*')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (!rev) return res.status(404).json({ error: 'review non trovata' })
        const { data: settings } = await sb.from('review_settings').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()

        const tone = settings?.tone_of_voice
          || 'Cordiale, professionale, italiano. Ringrazia il cliente, sii empatico, sintetico (max 4 frasi).'
        const firma = settings?.firma ? `\n\nFirma di chiusura da usare a fine messaggio: "${settings.firma}"` : ''

        const sys = `Sei l'assistente di un ristorante che risponde a recensioni online. Scrivi solo la risposta finale, senza preamboli, in italiano. Adatta il tono al voto: per recensioni 5 stelle ringrazia caloroso; per 3-4 ringrazia e raccogli il feedback; per 1-2 stelle scusati con empatia, evita scuse difensive, invita a un contatto diretto se possibile. Massimo 4 frasi. Non promettere sconti o omaggi.`
        const userMsg = `Recensione ricevuta su ${rev.sorgente}${rev.autore ? ` da ${rev.autore}` : ''}, voto ${rev.voto || 'N/D'}/5:

"${rev.testo || '(senza testo)'}"

Locale: ${rev.locale}.
Tone of voice del locale: ${tone}${firma}

Scrivi la risposta del ristorante.`

        const ai = await callAnthropic(sys, userMsg)
        if (ai.error) return res.status(500).json({ error: ai.error })

        await sb.from('reviews').update({
          reply_draft: ai.text,
          updated_at: new Date().toISOString(),
        }).eq('id', id)

        return res.status(200).json({ reply_draft: ai.text })
      }

      // ─── publish-reply: marca la risposta come pubblicata (testo o draft confermato) ─
      case 'publish-reply': {
        const { id, risposta } = body
        if (!id || !risposta) return res.status(400).json({ error: 'id and risposta required' })
        const { data, error } = await sb.from('reviews').update({
          risposta,
          risposta_at: new Date().toISOString(),
          risposta_by: user_id,
          reply_draft: null,
          updated_at: new Date().toISOString(),
        }).eq('user_id', user_id).eq('id', id).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ review: data })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
