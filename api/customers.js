// API CRM clienti
// - Usata sia dalla dashboard sia dal POS via REST autenticato
// - Auth: Bearer JWT del ristoratore (Supabase Auth)
// - Multi-tenant: ogni utente vede SOLO i propri clienti (RLS auth.uid()=user_id)

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

// Normalizza un numero di telefono italiano in +39XXXXXXXXXX (best effort, no libphone).
// Conserva input se non riconosciuto. POS e dashboard devono usare lo stesso normalizzatore.
function normPhone(raw) {
  if (!raw) return null
  let s = String(raw).replace(/[^\d+]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (!s.startsWith('+') && s.length >= 9 && s.length <= 11) s = '+39' + s.replace(/^0+/, '')
  return s
}

function normEmail(raw) {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  return s || null
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

      // ─── LIST: lista clienti del locale con filtri ──────────────────
      case 'list': {
        const { locale, search = '', tag_id = null, limit = 200, offset = 0 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        let q = sb.from('customers')
          .select('*, customer_tags(tag_id, tag_definitions(id, nome, colore, icona))', { count: 'exact' })
          .eq('user_id', user_id)
          .eq('locale', locale)
          .order('last_seen_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1)
        if (search) {
          const s = `%${search}%`
          q = q.or(`nome.ilike.${s},cognome.ilike.${s},telefono.ilike.${s},email.ilike.${s}`)
        }
        const { data, error, count } = await q
        if (error) throw error
        let out = data || []
        if (tag_id) {
          out = out.filter(c => (c.customer_tags || []).some(ct => ct.tag_id === tag_id))
        }
        return res.status(200).json({ customers: out, total: count })
      }

      // ─── GET: singolo cliente ────────────────────────────────────────
      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data, error } = await sb.from('customers')
          .select('*, customer_tags(tag_id, tag_definitions(id, nome, colore, icona))')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        return res.status(200).json({ customer: data })
      }

      // ─── LOOKUP: ricerca per telefono/email (uso POS al checkout) ────
      case 'lookup': {
        const { locale, telefono, email } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        if (!telefono && !email) return res.status(400).json({ error: 'telefono or email required' })
        let q = sb.from('customers')
          .select('*, customer_tags(tag_id, tag_definitions(id, nome, colore, icona))')
          .eq('user_id', user_id).eq('locale', locale).limit(1)
        if (telefono) q = q.eq('telefono', normPhone(telefono))
        else q = q.eq('email', normEmail(email))
        const { data, error } = await q.maybeSingle()
        if (error && error.code !== 'PGRST116') throw error
        return res.status(200).json({ customer: data || null })
      }

      // ─── UPSERT: crea o aggiorna cliente (chiave naturale: telefono o email) ─
      case 'upsert': {
        const c = body.customer || {}
        if (!c.locale) return res.status(400).json({ error: 'locale required' })
        const telefono = normPhone(c.telefono)
        const email = normEmail(c.email)
        if (!telefono && !email && !c.id) return res.status(400).json({ error: 'telefono or email required for new customer' })

        const payload = {
          user_id,
          locale: c.locale,
          nome: c.nome ?? null,
          cognome: c.cognome ?? null,
          telefono,
          email,
          data_nascita: c.data_nascita || null,
          lingua: c.lingua || 'it',
          note: c.note ?? null,
          source: c.source || 'manual',
          gdpr_marketing: !!c.gdpr_marketing,
          gdpr_profilazione: !!c.gdpr_profilazione,
          gdpr_consent_at: (c.gdpr_marketing || c.gdpr_profilazione) ? (c.gdpr_consent_at || new Date().toISOString()) : null,
          last_seen_at: c.last_seen_at || null,
          updated_at: new Date().toISOString(),
        }

        if (c.id) {
          const { data, error } = await sb.from('customers').update(payload)
            .eq('user_id', user_id).eq('id', c.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ customer: data })
        }

        // Try INSERT, fallback to UPDATE on unique conflict (telefono/email)
        let { data, error } = await sb.from('customers').insert(payload).select().maybeSingle()
        if (error && (error.code === '23505' || /duplicate/i.test(error.message))) {
          let q = sb.from('customers').update(payload).eq('user_id', user_id).eq('locale', c.locale)
          if (telefono) q = q.eq('telefono', telefono)
          else q = q.eq('email', email)
          const r2 = await q.select().maybeSingle()
          if (r2.error) throw r2.error
          data = r2.data
        } else if (error) throw error
        return res.status(200).json({ customer: data })
      }

      // ─── DELETE ──────────────────────────────────────────────────────
      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('customers').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── ASSIGN TAG ──────────────────────────────────────────────────
      case 'tag-assign': {
        const { customer_id, tag_id } = body
        if (!customer_id || !tag_id) return res.status(400).json({ error: 'customer_id and tag_id required' })
        // verifica ownership
        const { data: c } = await sb.from('customers').select('user_id').eq('id', customer_id).maybeSingle()
        if (!c || c.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const { error } = await sb.from('customer_tags').upsert({ customer_id, tag_id })
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── REMOVE TAG ──────────────────────────────────────────────────
      case 'tag-remove': {
        const { customer_id, tag_id } = body
        if (!customer_id || !tag_id) return res.status(400).json({ error: 'customer_id and tag_id required' })
        const { data: c } = await sb.from('customers').select('user_id').eq('id', customer_id).maybeSingle()
        if (!c || c.user_id !== user_id) return res.status(403).json({ error: 'not owner' })
        const { error } = await sb.from('customer_tags').delete().eq('customer_id', customer_id).eq('tag_id', tag_id)
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
