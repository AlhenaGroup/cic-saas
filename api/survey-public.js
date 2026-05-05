// Endpoint pubblico (no auth utente) per la pagina /survey/:token.
// GET  ?token=...        restituisce { survey, invitation } o errore se token invalido/scaduto
// POST { token, risposte } registra survey_response, calcola nps/rating/sentiment, ritorna routing review URL se promoter

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

function deriveMetrics(survey, risposte) {
  let nps_score = null, sumRating = 0, ratingCount = 0
  for (const d of (survey.domande || [])) {
    const v = risposte[d.id]
    if (v == null) continue
    if (d.tipo === 'nps') nps_score = Number(v)
    if (d.tipo === 'rating') { sumRating += Number(v); ratingCount++ }
  }
  const rating_avg = ratingCount > 0 ? Math.round((sumRating / ratingCount) * 100) / 100 : null
  let sentiment = null
  if (nps_score != null) {
    if (nps_score >= 9) sentiment = 'positive'
    else if (nps_score >= 7) sentiment = 'neutral'
    else sentiment = 'negative'
  } else if (rating_avg != null) {
    sentiment = rating_avg >= 4 ? 'positive' : rating_avg >= 3 ? 'neutral' : 'negative'
  }
  return { nps_score, rating_avg, sentiment }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const token = req.query.token || (req.query.t)
      if (!token) return res.status(400).json({ error: 'token required' })
      const { data: inv } = await sb.from('survey_invitations')
        .select('*, surveys(*)')
        .eq('token', token).maybeSingle()
      if (!inv || !inv.surveys) return res.status(404).json({ error: 'invitation non trovata' })
      if (inv.scadenza_at && new Date(inv.scadenza_at) < new Date()) return res.status(410).json({ error: 'scaduto' })

      // marca aperto_at se primo open
      if (!inv.aperto_at) {
        await sb.from('survey_invitations').update({ aperto_at: new Date().toISOString() }).eq('id', inv.id)
      }

      const survey = inv.surveys
      // ritorna solo i campi pubblici
      return res.status(200).json({
        survey: {
          id: survey.id,
          nome: survey.nome,
          intro: survey.intro,
          thank_you: survey.thank_you,
          domande: survey.domande,
          locale: survey.locale,
        },
        invitation: { id: inv.id, customer_id: inv.customer_id },
      })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const { token, risposte = {} } = body
      if (!token) return res.status(400).json({ error: 'token required' })
      const { data: inv } = await sb.from('survey_invitations')
        .select('*, surveys(*)')
        .eq('token', token).maybeSingle()
      if (!inv || !inv.surveys) return res.status(404).json({ error: 'invitation non trovata' })
      if (inv.scadenza_at && new Date(inv.scadenza_at) < new Date()) return res.status(410).json({ error: 'scaduto' })

      const { nps_score, rating_avg, sentiment } = deriveMetrics(inv.surveys, risposte)

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
      const user_agent = req.headers['user-agent'] || null

      const { data: resp, error } = await sb.from('survey_responses').insert({
        user_id: inv.user_id,
        locale: inv.locale,
        survey_id: inv.survey_id,
        invitation_id: inv.id,
        customer_id: inv.customer_id,
        risposte,
        nps_score, rating_avg, sentiment,
        ip, user_agent,
      }).select().maybeSingle()
      if (error) throw error

      // routing reputazione: se promoter, suggerisci recensione esterna
      const survey = inv.surveys
      const soglia = survey.routing_soglia || 8
      const showReview = (nps_score != null && nps_score >= soglia) && !!survey.routing_link_review

      return res.status(200).json({
        ok: true,
        thank_you: survey.thank_you || 'Grazie per il tuo feedback!',
        review_link: showReview ? survey.routing_link_review : null,
        sentiment,
      })
    }

    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
