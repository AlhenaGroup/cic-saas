// API public_widget_settings — CRUD per gestire i widget pubblici prenotazione.
// Auth: Bearer JWT del ristoratore. Multi-tenant via RLS.
// Frontend pubblico (no auth) è invece in /api/reservations-public.

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

// Slug-ifica una stringa (es. "Casa De Amicis" → "casa-de-amicis")
function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // rimuovi accenti
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
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

      // ─── LIST tutti i widget del ristoratore ─────────────────────────
      case 'list': {
        const { data, error } = await sb.from('public_widget_settings').select('*')
          .eq('user_id', user_id).order('locale', { ascending: true })
        if (error) throw error
        return res.status(200).json({ widgets: data || [] })
      }

      // ─── GET widget singolo (per locale) ─────────────────────────────
      case 'get': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('public_widget_settings').select('*')
          .eq('user_id', user_id).eq('locale', locale).maybeSingle()
        if (error) throw error
        return res.status(200).json({ widget: data })
      }

      // ─── STATS prenotazioni arrivate dal widget (ultimi N giorni) ────
      case 'stats': {
        const { locale, days = 30 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const from = new Date(Date.now() - Number(days) * 86400000).toISOString()
        const { data, error } = await sb.from('reservations')
          .select('stato, pax, created_at')
          .eq('user_id', user_id).eq('locale', locale)
          .eq('source', 'public_widget')
          .gte('created_at', from)
        if (error) throw error
        const out = { totale: 0, coperti: 0, per_stato: {} }
        for (const r of (data || [])) {
          out.totale += 1
          out.coperti += r.pax || 0
          out.per_stato[r.stato] = (out.per_stato[r.stato] || 0) + 1
        }
        return res.status(200).json({ stats: out })
      }

      // ─── UPSERT: crea o aggiorna widget settings ─────────────────────
      case 'upsert': {
        const w = body.widget || {}
        if (!w.locale) return res.status(400).json({ error: 'locale required' })

        // Auto-genera slug se non fornito (basato su nome_visualizzato o locale)
        let slug = String(w.slug || '').trim()
        if (!slug) slug = slugify(w.nome_visualizzato || w.locale)
        if (!slug) return res.status(400).json({ error: 'slug non valido' })
        if (!/^[a-z0-9-]+$/.test(slug)) {
          return res.status(400).json({ error: 'slug ammesso: lettere minuscole, numeri, trattini' })
        }

        // Verifica unicità slug (escludendo se stesso in caso di update)
        const { data: existing } = await sb.from('public_widget_settings')
          .select('id, user_id, locale').eq('slug', slug).maybeSingle()
        if (existing && (existing.user_id !== user_id || existing.locale !== w.locale)) {
          return res.status(409).json({ error: 'slug già in uso, scegliere un altro' })
        }

        const payload = {
          user_id,
          locale: w.locale,
          slug,
          nome_visualizzato: w.nome_visualizzato ?? null,
          attivo: w.attivo !== false,
          pax_max: Number(w.pax_max || 12),
          durata_default_min: Number(w.durata_default_min || 90),
          gdpr_text: w.gdpr_text ?? null,
          messaggio_benvenuto: w.messaggio_benvenuto ?? null,
          colore_primario: w.colore_primario || '#F59E0B',
          occasioni: Array.isArray(w.occasioni) ? w.occasioni.filter(Boolean) : [],
          updated_at: new Date().toISOString(),
        }

        if (w.id) {
          const { data, error } = await sb.from('public_widget_settings').update(payload)
            .eq('user_id', user_id).eq('id', w.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ widget: data })
        }
        const { data, error } = await sb.from('public_widget_settings').insert(payload).select().maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'widget già esistente per questo locale' })
          throw error
        }
        return res.status(200).json({ widget: data })
      }

      // ─── TOGGLE rapido attivo/disattivo ──────────────────────────────
      case 'toggle': {
        const { id, attivo } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data, error } = await sb.from('public_widget_settings')
          .update({ attivo: !!attivo, updated_at: new Date().toISOString() })
          .eq('user_id', user_id).eq('id', id).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ widget: data })
      }

      // ─── DELETE ──────────────────────────────────────────────────────
      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('public_widget_settings').delete()
          .eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
