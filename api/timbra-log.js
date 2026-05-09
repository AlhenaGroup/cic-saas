// Endpoint pubblico per logging eventi /timbra (nessun auth, body sanitizzato).
// Scopo: capire cosa succede quando un dipendente dice "ho timbrato" ma in DB
// non c'e' niente (errori rete, GPS denied, abbandono pagina mid-flow, ecc.).
//
// Cosa NON viene loggato:
//   - PIN completo (solo last 4)
//   - Foto / dati personali oltre il nome
//   - Token / password
//
// Best-effort: se il log fallisce non blocca nulla, restituisce comunque 200.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

async function sbQuery(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
  if (body) opts.body = JSON.stringify(body)
  if (method === 'POST' || method === 'PATCH') opts.headers['Prefer'] = 'return=representation'
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts)
  if (method === 'GET') return res.json()
  return res
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })

  try {
    const b = req.body || {}
    const pin = String(b.pin || '').replace(/[^\d]/g, '').slice(-4) || null

    // Risolvi user_id e employee_id se PIN passato
    let userId = null, employeeId = null, employeeName = null
    if (pin && pin.length === 4) {
      const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,user_id&limit=1`)
      if (emps?.[0]) {
        userId = emps[0].user_id
        employeeId = emps[0].id
        employeeName = emps[0].nome
      }
    }

    const row = {
      user_id: userId,
      employee_id: employeeId,
      employee_name: employeeName,
      pin_last4: pin,
      locale: b.locale ? String(b.locale).slice(0, 80) : null,
      action: String(b.action || 'unknown').slice(0, 80),
      step: b.step ? String(b.step).slice(0, 80) : null,
      level: b.level === 'warning' ? 'warning' : (b.level === 'info' ? 'info' : 'error'),
      message: String(b.message || '').slice(0, 1000),
      error_type: b.error_type ? String(b.error_type).slice(0, 40) : null,
      http_status: typeof b.http_status === 'number' ? b.http_status : null,
      user_agent: req.headers['user-agent']?.slice(0, 400) || null,
      online: typeof b.online === 'boolean' ? b.online : null,
      gps_status: b.gps_status ? String(b.gps_status).slice(0, 40) : null,
      payload: b.payload && typeof b.payload === 'object' ? b.payload : null,
    }

    await sbQuery('timbra_logs', 'POST', [row])
    return res.status(200).json({ ok: true })
  } catch (err) {
    // Non bloccare mai: il logging non deve interferire con UX
    console.error('[timbra-log]', err)
    return res.status(200).json({ ok: false, error: err.message })
  }
}
