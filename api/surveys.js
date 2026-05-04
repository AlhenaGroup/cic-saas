// API Surveys (auth): CRUD template + invio link + lista risposte + KPI NPS.
// L'endpoint pubblico per la compilazione è /api/survey-public (no-auth).

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

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

const DEFAULT_DOMANDE = [
  { id: 'nps', tipo: 'nps',    label: 'Quanto raccomanderesti il nostro locale a un amico?', required: true },
  { id: 'q1',  tipo: 'rating', label: 'Qualità del cibo',     required: false },
  { id: 'q2',  tipo: 'rating', label: 'Servizio',             required: false },
  { id: 'q3',  tipo: 'rating', label: 'Atmosfera del locale', required: false },
  { id: 'note', tipo: 'longtext', label: 'Vuoi lasciarci un commento?', required: false },
]

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
        const { data, error } = await sb.from('surveys').select('*')
          .eq('user_id', user_id).eq('locale', locale)
          .order('attivo', { ascending: false })
          .order('created_at', { ascending: false })
        if (error) throw error
        return res.status(200).json({ surveys: data || [] })
      }

      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data, error } = await sb.from('surveys').select('*')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        return res.status(200).json({ survey: data })
      }

      case 'upsert': {
        const s = body.survey || {}
        if (!s.locale || !s.nome) return res.status(400).json({ error: 'locale and nome required' })
        const payload = {
          user_id,
          locale: s.locale,
          nome: s.nome.trim(),
          intro: s.intro ?? null,
          thank_you: s.thank_you ?? null,
          domande: Array.isArray(s.domande) && s.domande.length > 0 ? s.domande : DEFAULT_DOMANDE,
          attivo: s.attivo !== false,
          routing_soglia: s.routing_soglia != null ? Number(s.routing_soglia) : 8,
          routing_link_review: s.routing_link_review ?? null,
          updated_at: new Date().toISOString(),
        }
        if (s.id) {
          const { data, error } = await sb.from('surveys').update(payload)
            .eq('user_id', user_id).eq('id', s.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ survey: data })
        }
        const { data, error } = await sb.from('surveys').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ survey: data })
      }

      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('surveys').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── Crea invitazione e ritorna link pubblico (es. da automazioni o test manuale) ─
      case 'create-invitation': {
        const { survey_id, customer_id = null, reservation_id = null, canale = null, scadenza_giorni = 14 } = body
        if (!survey_id) return res.status(400).json({ error: 'survey_id required' })
        const { data: surv } = await sb.from('surveys').select('user_id, locale').eq('id', survey_id).maybeSingle()
        if (!surv || surv.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const token = crypto.randomUUID()
        const scadenza = new Date(Date.now() + Number(scadenza_giorni) * 86400000).toISOString()
        const { data, error } = await sb.from('survey_invitations').insert({
          user_id, locale: surv.locale, survey_id, customer_id, reservation_id, canale, token, scadenza_at: scadenza,
        }).select().maybeSingle()
        if (error) throw error
        const baseUrl = process.env.PUBLIC_BASE_URL || 'https://cic-saas.vercel.app'
        return res.status(200).json({ invitation: data, link: `${baseUrl}/survey/${token}` })
      }

      // ─── Lista risposte con filtri ────────────────────────────────────
      case 'responses': {
        const { survey_id, locale, sentiment = null, limit = 200 } = body
        let q = sb.from('survey_responses')
          .select('*, customers(id, nome, cognome, telefono, email), surveys(nome)')
          .eq('user_id', user_id)
          .order('submitted_at', { ascending: false }).limit(limit)
        if (survey_id) q = q.eq('survey_id', survey_id)
        if (locale)    q = q.eq('locale', locale)
        if (sentiment) q = q.eq('sentiment', sentiment)
        const { data, error } = await q
        if (error) throw error
        return res.status(200).json({ responses: data || [] })
      }

      // ─── KPI NPS per survey o per locale ──────────────────────────────
      case 'kpi': {
        const { survey_id = null, locale = null } = body
        let q = sb.from('survey_responses').select('nps_score, rating_avg, sentiment')
          .eq('user_id', user_id)
        if (survey_id) q = q.eq('survey_id', survey_id)
        if (locale)    q = q.eq('locale', locale)
        const { data, error } = await q
        if (error) throw error
        const arr = data || []
        const totale = arr.length
        let promoter = 0, passive = 0, detractor = 0, sumNps = 0, npsCount = 0
        let sumRating = 0, ratingCount = 0
        for (const r of arr) {
          if (r.nps_score != null) {
            npsCount++
            sumNps += r.nps_score
            if (r.nps_score >= 9) promoter++
            else if (r.nps_score >= 7) passive++
            else detractor++
          }
          if (r.rating_avg != null) {
            ratingCount++
            sumRating += Number(r.rating_avg)
          }
        }
        const nps = npsCount > 0 ? Math.round(((promoter / npsCount) - (detractor / npsCount)) * 100) : null
        return res.status(200).json({ kpi: {
          totale,
          nps,
          nps_breakdown: { promoter, passive, detractor },
          nps_avg: npsCount > 0 ? Math.round((sumNps / npsCount) * 10) / 10 : null,
          rating_avg: ratingCount > 0 ? Math.round((sumRating / ratingCount) * 10) / 10 : null,
        }})
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
