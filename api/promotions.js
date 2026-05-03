// API promozioni: CRUD da dashboard + redeem da POS al checkout.
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

// Calcola lo sconto applicabile a uno scontrino dato.
function computeDiscount(promo, importoScontrino) {
  const t = promo.tipo_sconto
  const v = Number(promo.valore_sconto || 0)
  const totale = Number(importoScontrino || 0)
  if (t === 'percentuale') return Math.round(totale * v) / 100
  if (t === 'fisso')       return Math.min(v, totale)
  if (t === 'omaggio')     return v        // valore in euro dell'omaggio (informativo)
  if (t === 'menu_speciale') return 0      // gestito a parte (prezzo del menu, non sconto)
  return 0
}

// Verifica validità della promo nel momento corrente (data, ora, giorno settimana).
function isValidNow(promo, now = new Date()) {
  const ymd = now.toISOString().slice(0, 10)
  if (promo.data_inizio && ymd < promo.data_inizio) return { ok: false, reason: 'non ancora attiva' }
  if (promo.data_fine   && ymd > promo.data_fine)   return { ok: false, reason: 'scaduta' }
  if (promo.giorni_settimana && promo.giorni_settimana.length > 0) {
    if (!promo.giorni_settimana.includes(now.getDay())) return { ok: false, reason: 'non valida oggi' }
  }
  if (promo.ora_inizio || promo.ora_fine) {
    const hm = now.toTimeString().slice(0, 5)
    if (promo.ora_inizio && hm < promo.ora_inizio.slice(0, 5)) return { ok: false, reason: 'fuori orario' }
    if (promo.ora_fine   && hm > promo.ora_fine.slice(0, 5))   return { ok: false, reason: 'fuori orario' }
  }
  return { ok: true }
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

      // ─── LIST promozioni (dashboard) ─────────────────────────────────
      case 'list': {
        const { locale, only_active = false } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        let q = sb.from('promotions').select('*')
          .eq('user_id', user_id).eq('locale', locale)
          .order('attivo', { ascending: false })
          .order('created_at', { ascending: false })
        if (only_active) q = q.eq('attivo', true)
        const { data, error } = await q
        if (error) throw error
        return res.status(200).json({ promotions: data || [] })
      }

      // ─── GET singola ─────────────────────────────────────────────────
      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data, error } = await sb.from('promotions').select('*')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        return res.status(200).json({ promotion: data })
      }

      // ─── UPSERT (crea o aggiorna) ────────────────────────────────────
      case 'upsert': {
        const p = body.promotion || {}
        if (!p.locale || !p.codice || !p.nome) return res.status(400).json({ error: 'locale, codice, nome required' })
        const payload = {
          user_id,
          locale: p.locale,
          codice: String(p.codice).trim().toUpperCase(),
          nome: p.nome.trim(),
          descrizione: p.descrizione ?? null,
          target_tag_ids: Array.isArray(p.target_tag_ids) ? p.target_tag_ids : [],
          target_min_visite: Number(p.target_min_visite || 0),
          tipo_sconto: p.tipo_sconto || 'percentuale',
          valore_sconto: Number(p.valore_sconto || 0),
          importo_minimo: Number(p.importo_minimo || 0),
          data_inizio: p.data_inizio || null,
          data_fine: p.data_fine || null,
          giorni_settimana: Array.isArray(p.giorni_settimana) && p.giorni_settimana.length ? p.giorni_settimana : null,
          ora_inizio: p.ora_inizio || null,
          ora_fine: p.ora_fine || null,
          max_utilizzi: p.max_utilizzi == null || p.max_utilizzi === '' ? null : Number(p.max_utilizzi),
          max_utilizzi_per_cliente: Number(p.max_utilizzi_per_cliente || 1),
          attivo: p.attivo === false ? false : true,
          updated_at: new Date().toISOString(),
        }
        if (p.id) {
          const { data, error } = await sb.from('promotions').update(payload)
            .eq('user_id', user_id).eq('id', p.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ promotion: data })
        }
        const { data, error } = await sb.from('promotions').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ promotion: data })
      }

      // ─── DELETE ──────────────────────────────────────────────────────
      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('promotions').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── TOGGLE attivo ───────────────────────────────────────────────
      case 'toggle': {
        const { id, attivo } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('promotions').update({ attivo: !!attivo, updated_at: new Date().toISOString() })
          .eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── VALIDATE: verifica codice senza redimere (POS pre-check) ────
      case 'validate': {
        const { locale, codice, customer_id = null, importo_scontrino = 0 } = body
        if (!locale || !codice) return res.status(400).json({ error: 'locale and codice required' })
        const code = String(codice).trim().toUpperCase()
        const { data: promo, error } = await sb.from('promotions').select('*')
          .eq('user_id', user_id).eq('locale', locale).eq('codice', code).maybeSingle()
        if (error) throw error
        if (!promo) return res.status(200).json({ ok: false, reason: 'codice inesistente' })
        if (!promo.attivo) return res.status(200).json({ ok: false, reason: 'promozione disattivata' })
        const valid = isValidNow(promo)
        if (!valid.ok) return res.status(200).json({ ok: false, reason: valid.reason, promotion: promo })
        if (Number(promo.importo_minimo) > Number(importo_scontrino || 0)) {
          return res.status(200).json({ ok: false, reason: `spesa minima ${promo.importo_minimo}€`, promotion: promo })
        }
        if (promo.max_utilizzi != null && promo.utilizzi_totali >= promo.max_utilizzi) {
          return res.status(200).json({ ok: false, reason: 'limite utilizzi raggiunto', promotion: promo })
        }
        if (customer_id && promo.max_utilizzi_per_cliente != null) {
          const { count } = await sb.from('promotion_redemptions')
            .select('*', { count: 'exact', head: true })
            .eq('promotion_id', promo.id).eq('customer_id', customer_id)
          if ((count || 0) >= promo.max_utilizzi_per_cliente) {
            return res.status(200).json({ ok: false, reason: 'cliente ha già utilizzato questa promozione', promotion: promo })
          }
        }
        const sconto = computeDiscount(promo, importo_scontrino)
        return res.status(200).json({ ok: true, promotion: promo, sconto_calcolato: sconto })
      }

      // ─── REDEEM: registra utilizzo (chiamato dal POS al checkout) ────
      case 'redeem': {
        const { locale, codice, customer_id = null, importo_scontrino, scontrino_id = null, note = null } = body
        if (!locale || !codice) return res.status(400).json({ error: 'locale and codice required' })
        const code = String(codice).trim().toUpperCase()
        const { data: promo, error: e1 } = await sb.from('promotions').select('*')
          .eq('user_id', user_id).eq('locale', locale).eq('codice', code).maybeSingle()
        if (e1) throw e1
        if (!promo) return res.status(404).json({ error: 'codice inesistente' })
        const valid = isValidNow(promo)
        if (!promo.attivo || !valid.ok) return res.status(409).json({ error: valid.reason || 'promo non valida' })

        const sconto = computeDiscount(promo, importo_scontrino)

        const { data: red, error: e2 } = await sb.from('promotion_redemptions').insert({
          promotion_id: promo.id,
          user_id,
          customer_id,
          importo_scontrino: importo_scontrino ?? null,
          importo_scontato: sconto,
          scontrino_id,
          note,
        }).select().maybeSingle()
        if (e2) throw e2

        // Increment counter (best-effort, non transazionale ma sufficiente per uso reale)
        await sb.from('promotions').update({ utilizzi_totali: (promo.utilizzi_totali || 0) + 1, updated_at: new Date().toISOString() })
          .eq('id', promo.id)

        return res.status(200).json({ ok: true, redemption: red, sconto_applicato: sconto, promotion: promo })
      }

      // ─── REDEMPTIONS list (dashboard reporting) ──────────────────────
      case 'redemptions': {
        const { promotion_id = null, locale = null, limit = 100 } = body
        let q = sb.from('promotion_redemptions')
          .select('*, promotions(codice, nome, locale), customers(id, nome, cognome, telefono)')
          .eq('user_id', user_id)
          .order('redeemed_at', { ascending: false }).limit(limit)
        if (promotion_id) q = q.eq('promotion_id', promotion_id)
        const { data, error } = await q
        if (error) throw error
        let out = data || []
        if (locale) out = out.filter(r => r.promotions?.locale === locale)
        return res.status(200).json({ redemptions: out })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
