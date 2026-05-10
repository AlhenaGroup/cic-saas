// API REST per integrazioni esterne (POS, sviluppatori, ecc.)
// Auth: Authorization: Bearer pk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Endpoint multiplexati su /api/v1?resource={...}&action={...}
//   resource=customers   action=list|get|create|update
//   resource=sales       action=create|get
//   resource=loyalty     action=balance|transactions
//   resource=promotions  action=list
//
// Convenzione preferita REST: /api/v1/{resource}[/:id]?action=...
// Ma Vercel routes statiche -> usiamo query params per compatibilita'.
//
// Scopes:
//   customers.read  customers.write
//   sales.read      sales.write
//   loyalty.read    loyalty.write
//   promotions.read

import crypto from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

async function sb(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
  if (body) opts.body = JSON.stringify(body)
  if (method === 'POST' || method === 'PATCH') opts.headers['Prefer'] = 'return=representation'
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts)
  if (method === 'GET') return r.json()
  if (method === 'DELETE') return r
  try { return await r.json() } catch { return null }
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// Verifica chiave API e lo scope richiesto. Restituisce { keyRow, error, code }.
async function verifyApiKey(req, requiredScope) {
  const auth = req.headers['authorization'] || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return { error: 'Authorization header mancante (atteso: Bearer pk_...)', code: 401 }
  const key = m[1].trim()
  if (!key.startsWith('pk_')) return { error: 'Formato chiave non valido', code: 401 }

  const hash = sha256(key)
  const rows = await sb(`api_keys?key_hash=eq.${hash}&select=*&limit=1`)
  if (!rows?.[0]) return { error: 'Chiave non valida', code: 401 }
  const k = rows[0]
  if (k.revoked_at) return { error: 'Chiave revocata', code: 401 }

  const scopes = Array.isArray(k.scopes) ? k.scopes : []
  if (requiredScope && !scopes.includes(requiredScope)) {
    return { error: `Scope insufficienti. Richiesto: ${requiredScope}`, code: 403 }
  }

  // Aggiorna ultimo uso (best-effort, no blocking)
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
  sb(`api_keys?id=eq.${k.id}`, 'PATCH', {
    last_used_at: new Date().toISOString(),
    last_used_ip: ip,
    uses_count: (k.uses_count || 0) + 1,
  }).catch(() => {})

  return { keyRow: k }
}

// Helpers per filtrare per locale se la chiave ne ha uno
function localeFilter(keyRow) {
  if (keyRow.locale) return `locale=eq.${encodeURIComponent(keyRow.locale)}`
  return null
}

// ────────────────────────────────────────────────────────────────────────
// CUSTOMERS
// ────────────────────────────────────────────────────────────────────────
async function customersHandler(req, res, key) {
  const action = req.query.action || (req.method === 'POST' ? 'create' : 'list')

  if (action === 'list') {
    const v = await verifyApiKey(req, 'customers.read'); if (v.error) return res.status(v.code).json({ error: v.error })
    let q = `customers?user_id=eq.${key.user_id}&select=*&order=created_at.desc&limit=${Math.min(Number(req.query.limit) || 50, 200)}`
    if (req.query.search) q += `&or=(nome.ilike.*${req.query.search}*,cognome.ilike.*${req.query.search}*,email.ilike.*${req.query.search}*,telefono.ilike.*${req.query.search}*)`
    if (req.query.telefono) q += `&telefono=eq.${encodeURIComponent(req.query.telefono)}`
    if (req.query.email) q += `&email=eq.${encodeURIComponent(req.query.email)}`
    const data = await sb(q)
    return res.status(200).json({ customers: data || [] })
  }

  if (action === 'get') {
    const v = await verifyApiKey(req, 'customers.read'); if (v.error) return res.status(v.code).json({ error: v.error })
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id richiesto' })
    const data = await sb(`customers?id=eq.${id}&user_id=eq.${key.user_id}&select=*&limit=1`)
    if (!data?.[0]) return res.status(404).json({ error: 'Cliente non trovato' })
    return res.status(200).json({ customer: data[0] })
  }

  if (action === 'create') {
    const v = await verifyApiKey(req, 'customers.write'); if (v.error) return res.status(v.code).json({ error: v.error })
    const b = req.body || {}
    if (!b.nome && !b.telefono && !b.email) return res.status(400).json({ error: 'Almeno uno tra nome, telefono o email richiesto' })
    const payload = {
      user_id: key.user_id,
      nome: b.nome || null, cognome: b.cognome || null,
      email: b.email || null, telefono: b.telefono || null,
      data_nascita: b.data_nascita || null, note: b.note || null,
      consenso_marketing: b.consenso_marketing || false,
    }
    const result = await sb('customers', 'POST', [payload])
    if (!Array.isArray(result) || !result[0]) return res.status(500).json({ error: 'Errore creazione cliente' })
    return res.status(201).json({ customer: result[0] })
  }

  if (action === 'update') {
    const v = await verifyApiKey(req, 'customers.write'); if (v.error) return res.status(v.code).json({ error: v.error })
    const id = req.query.id || req.body?.id
    if (!id) return res.status(400).json({ error: 'id richiesto' })
    const b = req.body || {}
    delete b.id; delete b.user_id; delete b.created_at
    const result = await sb(`customers?id=eq.${id}&user_id=eq.${key.user_id}`, 'PATCH', { ...b, updated_at: new Date().toISOString() })
    if (!Array.isArray(result) || !result[0]) return res.status(404).json({ error: 'Cliente non trovato' })
    return res.status(200).json({ customer: result[0] })
  }

  return res.status(400).json({ error: 'action non valida (list|get|create|update)' })
}

// ────────────────────────────────────────────────────────────────────────
// SALES (scontrini POS → daily_stats.receipt_details)
// ────────────────────────────────────────────────────────────────────────
async function salesHandler(req, res, key) {
  const action = req.query.action || (req.method === 'POST' ? 'create' : 'list')

  if (action === 'create') {
    const v = await verifyApiKey(req, 'sales.write'); if (v.error) return res.status(v.code).json({ error: v.error })
    const b = req.body || {}
    // Atteso payload:
    // { id, locale?, data, ora_apertura, ora_chiusura?, tavolo?, coperti?,
    //   items: [{nome, qty, prezzo (totale_riga), reparto?, categoria?, iva?}],
    //   totale, payment?, customer_id?, isInvoice? }
    if (!b.data || !Array.isArray(b.items)) return res.status(400).json({ error: 'data e items richiesti' })
    const locale = b.locale || key.locale
    if (!locale) return res.status(400).json({ error: 'locale richiesto (chiave senza locale di default)' })

    // Calcola totale dagli items se non fornito
    const totale = Number(b.totale) || b.items.reduce((s, it) => s + (Number(it.prezzo) || 0), 0)

    // Trova/crea daily_stats per (data, locale) e fai append in receipt_details
    const exist = await sb(`daily_stats?date=eq.${b.data}&salespoint_name=eq.${encodeURIComponent(locale)}&user_id=eq.${key.user_id}&select=id,receipt_details,revenue,bill_count&limit=1`)
    const newReceipt = {
      id: b.id || null,
      aperturaComanda: b.ora_apertura || null,
      chiusuraComanda: b.ora_chiusura || null,
      tavolo: b.tavolo || null,
      coperti: b.coperti || null,
      items: b.items.map(it => ({
        nome: it.nome, qty: Number(it.qty) || 1,
        prezzo: Number(it.prezzo) || 0,  // gia' totale-riga (qty * unit)
        reparto: it.reparto || null, categoria: it.categoria || null,
        iva: it.iva || null,
      })),
      totale,
      payment: b.payment || null,
      customer_id: b.customer_id || null,
      isInvoice: !!b.isInvoice,
      source: 'pos_api',
    }

    if (exist?.[0]) {
      const rd = Array.isArray(exist[0].receipt_details) ? exist[0].receipt_details : []
      rd.push(newReceipt)
      await sb(`daily_stats?id=eq.${exist[0].id}`, 'PATCH', {
        receipt_details: rd,
        revenue: (Number(exist[0].revenue) || 0) + totale,
        bill_count: (exist[0].bill_count || 0) + 1,
        synced_at: new Date().toISOString(),
      })
    } else {
      await sb('daily_stats', 'POST', [{
        user_id: key.user_id,
        salespoint_name: locale, date: b.data,
        revenue: totale, bill_count: 1,
        receipt_details: [newReceipt],
        synced_at: new Date().toISOString(),
      }])
    }
    return res.status(201).json({ ok: true, receipt: newReceipt })
  }

  if (action === 'list') {
    const v = await verifyApiKey(req, 'sales.read'); if (v.error) return res.status(v.code).json({ error: v.error })
    const locale = req.query.locale || key.locale
    let q = `daily_stats?user_id=eq.${key.user_id}&select=date,salespoint_name,revenue,bill_count,receipt_details&order=date.desc&limit=${Math.min(Number(req.query.limit) || 30, 90)}`
    if (locale) q += `&salespoint_name=eq.${encodeURIComponent(locale)}`
    if (req.query.from) q += `&date=gte.${req.query.from}`
    if (req.query.to) q += `&date=lte.${req.query.to}`
    const data = await sb(q)
    return res.status(200).json({ sales: data || [] })
  }

  return res.status(400).json({ error: 'action non valida (create|list)' })
}

// ────────────────────────────────────────────────────────────────────────
// LOYALTY (programmi fedelta' / punti)
// ────────────────────────────────────────────────────────────────────────
async function loyaltyHandler(req, res, key) {
  const action = req.query.action

  if (action === 'balance') {
    const v = await verifyApiKey(req, 'loyalty.read'); if (v.error) return res.status(v.code).json({ error: v.error })
    const customerId = req.query.customer_id
    if (!customerId) return res.status(400).json({ error: 'customer_id richiesto' })
    const data = await sb(`loyalty_transactions?customer_id=eq.${customerId}&user_id=eq.${key.user_id}&select=punti_delta`)
    const balance = (data || []).reduce((s, t) => s + (Number(t.punti_delta) || 0), 0)
    return res.status(200).json({ customer_id: customerId, balance })
  }

  if (action === 'transactions') {
    if (req.method === 'POST') {
      const v = await verifyApiKey(req, 'loyalty.write'); if (v.error) return res.status(v.code).json({ error: v.error })
      const b = req.body || {}
      if (!b.customer_id || b.punti_delta == null) return res.status(400).json({ error: 'customer_id e punti_delta richiesti' })
      const result = await sb('loyalty_transactions', 'POST', [{
        user_id: key.user_id,
        customer_id: b.customer_id,
        punti_delta: Number(b.punti_delta),
        descrizione: b.descrizione || null,
        riferimento_tipo: b.riferimento_tipo || 'pos',
        riferimento_id: b.riferimento_id || null,
        locale: b.locale || key.locale || null,
      }])
      return res.status(201).json({ transaction: Array.isArray(result) ? result[0] : null })
    } else {
      const v = await verifyApiKey(req, 'loyalty.read'); if (v.error) return res.status(v.code).json({ error: v.error })
      const customerId = req.query.customer_id
      if (!customerId) return res.status(400).json({ error: 'customer_id richiesto' })
      const data = await sb(`loyalty_transactions?customer_id=eq.${customerId}&user_id=eq.${key.user_id}&select=*&order=created_at.desc&limit=${Math.min(Number(req.query.limit) || 30, 100)}`)
      return res.status(200).json({ transactions: data || [] })
    }
  }

  return res.status(400).json({ error: 'action non valida (balance|transactions)' })
}

// ────────────────────────────────────────────────────────────────────────
// PROMOTIONS (read-only per POS)
// ────────────────────────────────────────────────────────────────────────
async function promotionsHandler(req, res, key) {
  const v = await verifyApiKey(req, 'promotions.read'); if (v.error) return res.status(v.code).json({ error: v.error })
  const today = new Date().toISOString().split('T')[0]
  const locale = req.query.locale || key.locale
  let q = `promotions?user_id=eq.${key.user_id}&attiva=eq.true&data_inizio=lte.${today}&or=(data_fine.gte.${today},data_fine.is.null)&select=*&order=created_at.desc`
  if (locale) q += `&or=(locale.eq.${encodeURIComponent(locale)},locale.is.null)`
  const data = await sb(q)
  return res.status(200).json({ promotions: data || [] })
}

// ────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const resource = (req.query.resource || '').toLowerCase()
    if (!resource) return res.status(400).json({ error: 'resource richiesto (?resource=customers|sales|loyalty|promotions)' })

    // Verifica chiave per ottenere user_id da usare in tutti gli handler
    const v = await verifyApiKey(req, null)
    if (v.error) return res.status(v.code).json({ error: v.error })
    const key = v.keyRow

    if (resource === 'customers')   return customersHandler(req, res, key)
    if (resource === 'sales')       return salesHandler(req, res, key)
    if (resource === 'loyalty')     return loyaltyHandler(req, res, key)
    if (resource === 'promotions')  return promotionsHandler(req, res, key)

    return res.status(400).json({ error: 'resource non valida (customers|sales|loyalty|promotions)' })
  } catch (err) {
    console.error('[v1]', err)
    return res.status(500).json({ error: err.message || 'Errore interno' })
  }
}
