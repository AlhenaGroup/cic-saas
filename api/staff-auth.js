// Endpoint login dipendente: email + PIN -> Supabase session.
//
// Flow:
// 1. Verifica employees.email + employees.pin (service-role, bypass RLS)
// 2. Se employees.auth_user_id non esiste, crea lazy un auth.user marcato
//    user_metadata.staff = true e collega l'id a employees.auth_user_id
// 3. Ad ogni login, ruota la password dell'auth.user (random crypto-strong)
// 4. Esegue grant_type=password sul Supabase Auth REST -> ottiene sessione
// 5. Restituisce { access_token, refresh_token } al client. Il client chiama
//    supabase.auth.setSession() e da li' usa la sessione standard.
//
// Sicurezza: la password reale del dipendente non e' mai esposta. Il PIN e'
// l'unica credenziale, ma viene scambiato qui per una vera sessione Supabase.

import crypto from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzM5OTEsImV4cCI6MjA5MDUwOTk5MX0.LH9G6pAWBn-UAOM2XV-O0wL5Vg2i-uCWSWfpDDp0_yQ'

const sbAdmin = (path, init = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(init.headers || {}),
    },
  })

// PostgREST shorthand
async function sbQuery(path) {
  const r = await sbAdmin(`/rest/v1/${path}`)
  if (!r.ok) return null
  return r.json()
}

function randomPassword() {
  return crypto.randomBytes(32).toString('base64url')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, pin } = req.body || {}
  if (!email || !pin) return res.status(400).json({ error: 'email e pin obbligatori' })
  const emailLow = String(email).trim().toLowerCase()
  const pinStr = String(pin).trim()

  try {
    // 1) Cerca employee attivo con email + pin
    const emps = await sbQuery(
      `employees?email=eq.${encodeURIComponent(emailLow)}&pin=eq.${encodeURIComponent(pinStr)}&stato=eq.Attivo&select=id,user_id,nome,email,auth_user_id,module_permissions&limit=1`
    )
    if (!emps || emps.length === 0) {
      return res.status(401).json({ error: 'Email o PIN non validi (oppure dipendente disattivato)' })
    }
    const emp = emps[0]

    // 2) Lazy create auth.user se non esiste
    let authUserId = emp.auth_user_id
    const newPassword = randomPassword()

    if (!authUserId) {
      // Verifica se esiste gia' un auth.user con questa email
      const existRes = await sbAdmin(`/auth/v1/admin/users?email=${encodeURIComponent(emailLow)}`)
      let existing = null
      if (existRes.ok) {
        const existJson = await existRes.json()
        existing = (existJson.users || existJson || [])[0]
      }
      if (existing) {
        // Caso 1: l'auth.user esistente e' marcato come staff (es. tentativo precedente
        // andato a buon fine su createUser ma fallito sull'UPDATE employees). Riusalo.
        if (existing.user_metadata?.staff === true) {
          authUserId = existing.id
          // Aggiorno la password (ruota) — verra' usata subito sotto per signin
          const updPwd = await sbAdmin(`/auth/v1/admin/users/${authUserId}`, {
            method: 'PUT',
            body: JSON.stringify({ password: newPassword, user_metadata: { staff: true, employee_id: emp.id } }),
          })
          if (!updPwd.ok) {
            const t = await updPwd.text().catch(() => '')
            return res.status(500).json({ error: 'Errore reset password staff esistente: ' + t.slice(0, 200) })
          }
        } else {
          // Caso 2: e' un account owner reale. Blocca per non dirottare il suo login.
          return res.status(409).json({
            error: 'Email gia' + String.fromCharCode(39) + ' registrata come account principale. Usare un' + String.fromCharCode(39) + 'altra email per questo dipendente.',
          })
        }
      } else {
        // Crea nuovo auth.user
        const createRes = await sbAdmin(`/auth/v1/admin/users`, {
          method: 'POST',
          body: JSON.stringify({
            email: emailLow,
            password: newPassword,
            email_confirm: true,
            user_metadata: { staff: true, employee_id: emp.id },
          }),
        })
        if (!createRes.ok) {
          const t = await createRes.text().catch(() => '')
          return res.status(500).json({ error: 'Errore creazione utente: ' + t.slice(0, 200) })
        }
        const created = await createRes.json()
        authUserId = created.id || created.user?.id
        if (!authUserId) return res.status(500).json({ error: 'auth user id mancante dopo create' })
      }
      // Salva auth_user_id su employees (per entrambi i casi sopra)
      const updRes = await sbAdmin(
        `/rest/v1/employees?id=eq.${encodeURIComponent(emp.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ auth_user_id: authUserId }),
        }
      )
      if (!updRes.ok) {
        const t = await updRes.text().catch(() => '')
        return res.status(500).json({ error: 'Errore link auth_user_id: ' + t.slice(0, 200) })
      }
    } else {
      // Auth user gia' esistente: ruota la password
      const updPwd = await sbAdmin(`/auth/v1/admin/users/${authUserId}`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword, user_metadata: { staff: true, employee_id: emp.id } }),
      })
      if (!updPwd.ok) {
        const t = await updPwd.text().catch(() => '')
        return res.status(500).json({ error: 'Errore rotazione password: ' + t.slice(0, 200) })
      }
    }

    // 3) Sign-in via grant_type=password con la password appena impostata
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: emailLow, password: newPassword }),
    })
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => '')
      return res.status(500).json({ error: 'Errore login: ' + t.slice(0, 300) })
    }
    const session = await tokenRes.json()

    return res.status(200).json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      employee: {
        id: emp.id,
        user_id: emp.user_id,
        nome: emp.nome,
        email: emp.email,
        module_permissions: emp.module_permissions || {},
      },
    })
  } catch (e) {
    return res.status(500).json({ error: 'Errore server: ' + (e?.message || 'unknown') })
  }
}
