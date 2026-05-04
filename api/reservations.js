// API prenotazioni: dashboard (vista, KPI, CRUD anagrafica) + POS (state transitions accept/reject/seat/...).
// Auth: Bearer JWT. Multi-tenant via RLS.

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

const STATI_VALIDI = ['pending', 'confirmed', 'seated', 'completed', 'no_show', 'cancelled', 'waitlist']

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

      // ─── LIST con filtri data/stato ──────────────────────────────────
      case 'list': {
        const { locale, from = null, to = null, stato = null, customer_id = null, limit = 500 } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        let q = sb.from('reservations')
          .select('*, customers(id, nome, cognome, telefono, email)')
          .eq('user_id', user_id).eq('locale', locale)
          .order('data_ora', { ascending: true })
          .limit(limit)
        if (from) q = q.gte('data_ora', from)
        if (to)   q = q.lte('data_ora', to)
        if (stato) q = q.eq('stato', stato)
        if (customer_id) q = q.eq('customer_id', customer_id)
        const { data, error } = await q
        if (error) throw error
        return res.status(200).json({ reservations: data || [] })
      }

      // ─── KPI: totali per data range ──────────────────────────────────
      case 'kpi': {
        const { locale, from, to } = body
        if (!locale || !from || !to) return res.status(400).json({ error: 'locale, from, to required' })
        const { data, error } = await sb.from('reservations')
          .select('stato, pax')
          .eq('user_id', user_id).eq('locale', locale)
          .gte('data_ora', from).lte('data_ora', to)
        if (error) throw error
        const out = { totale: 0, coperti: 0, per_stato: {} }
        for (const r of (data || [])) {
          out.totale += 1
          out.coperti += r.pax || 0
          out.per_stato[r.stato] = (out.per_stato[r.stato] || 0) + 1
        }
        const completate = out.per_stato.completed || 0
        const no_show = out.per_stato.no_show || 0
        out.no_show_rate = (completate + no_show) > 0 ? Math.round(no_show / (completate + no_show) * 100) : 0
        return res.status(200).json({ kpi: out })
      }

      // ─── GET singola ─────────────────────────────────────────────────
      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data, error } = await sb.from('reservations')
          .select('*, customers(id, nome, cognome, telefono, email)')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        return res.status(200).json({ reservation: data })
      }

      // ─── UPSERT (anagrafica + dati) — crea/modifica ──────────────────
      case 'upsert': {
        const r = body.reservation || {}
        if (!r.locale || !r.data_ora || !r.pax) return res.status(400).json({ error: 'locale, data_ora, pax required' })
        const payload = {
          user_id,
          locale: r.locale,
          customer_id: r.customer_id || null,
          guest_nome: r.guest_nome ?? null,
          guest_telefono: r.guest_telefono ?? null,
          guest_email: r.guest_email ?? null,
          data_ora: r.data_ora,
          durata_min: Number(r.durata_min || 90),
          pax: Number(r.pax),
          sala: r.sala ?? null,
          tavoli: Array.isArray(r.tavoli) ? r.tavoli : [],
          source: r.source || 'manual',
          occasione: r.occasione ?? null,
          note: r.note ?? null,
          allergie: r.allergie ?? null,
          campi_custom: r.campi_custom || {},
          updated_at: new Date().toISOString(),
        }
        if (r.id) {
          const { data, error } = await sb.from('reservations').update(payload)
            .eq('user_id', user_id).eq('id', r.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ reservation: data })
        }
        // nuova: include stato iniziale (default 'pending')
        payload.stato = r.stato || 'pending'
        const { data, error } = await sb.from('reservations').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ reservation: data })
      }

      // ─── SET-STATUS (chiamato dal POS: accept/reject/waitlist/seat/...) ─
      case 'set-status': {
        const { id, stato, reason = null } = body
        if (!id || !stato) return res.status(400).json({ error: 'id and stato required' })
        if (!STATI_VALIDI.includes(stato)) return res.status(400).json({ error: 'stato invalido' })
        // Carica stato_from per il payload evento
        const { data: prev } = await sb.from('reservations').select('stato, locale, customer_id, pax').eq('user_id', user_id).eq('id', id).maybeSingle()
        const upd = { stato, updated_at: new Date().toISOString() }
        if (stato === 'confirmed') upd.confirmed_at = new Date().toISOString()
        if (stato === 'seated')    upd.seated_at = new Date().toISOString()
        if (stato === 'completed') upd.completed_at = new Date().toISOString()
        if (stato === 'cancelled') { upd.cancelled_at = new Date().toISOString(); upd.cancelled_reason = reason }
        const { data, error } = await sb.from('reservations').update(upd)
          .eq('user_id', user_id).eq('id', id).select().maybeSingle()
        if (error) throw error
        // Emetti evento per automations engine (cambio_stato_prenotazione)
        if (prev && prev.stato !== stato) {
          await sb.from('automation_events_queue').insert({
            user_id,
            locale: prev.locale,
            evento: 'cambio_stato_prenotazione',
            payload: { reservation_id: id, stato_from: prev.stato, stato_to: stato, pax: prev.pax },
            customer_id: prev.customer_id || null,
          }).select().maybeSingle()
        }
        return res.status(200).json({ reservation: data })
      }

      // ─── DELETE ──────────────────────────────────────────────────────
      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('reservations').delete().eq('user_id', user_id).eq('id', id)
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
