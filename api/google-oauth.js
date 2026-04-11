// Google OAuth 2.0 flow per Google Business Profile
//
// Due azioni in questo endpoint:
// 1. GET /api/google-oauth?action=start  → redirect a Google authorization URL
// 2. GET /api/google-oauth?code=...     → callback, scambia code per tokens,
//                                          restituisce HTML che fa postMessage al opener e close
//
// Client ID è pubblico. Client Secret è letto da env var GOOGLE_CLIENT_SECRET
// configurata su Vercel.

const CLIENT_ID = '379095886678-4gu92mrcvl3chknsc08kv8p1unuk419v.apps.googleusercontent.com'
const REDIRECT_URI = 'https://cic-saas.vercel.app/api/google-oauth'
const SCOPE = 'https://www.googleapis.com/auth/business.manage'

export default async function handler(req, res) {
  const { action, code, error: oauthError } = req.query || {}

  // ─── Step 1: avvio flow → redirect verso Google ────────────────────────
  if (action === 'start') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPE)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('include_granted_scopes', 'true')
    res.writeHead(302, { Location: url.toString() })
    return res.end()
  }

  // ─── Step 2: callback da Google ────────────────────────────────────────
  if (oauthError) {
    return sendHtml(res, `<html><body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9">
      <h2 style="color:#EF4444">❌ Login Google annullato</h2>
      <p>${escapeHtml(String(oauthError))}</p>
      <p>Puoi chiudere questa finestra.</p>
      <script>window.opener?.postMessage({type:'google-oauth-error',error:${JSON.stringify(String(oauthError))}},'*');setTimeout(()=>window.close(),2000);</script>
    </body></html>`)
  }

  if (!code) {
    return res.status(400).send('Missing code or action=start')
  }

  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientSecret) {
    return sendHtml(res, `<html><body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9">
      <h2 style="color:#EF4444">❌ GOOGLE_CLIENT_SECRET non configurato</h2>
      <p>L'amministratore deve aggiungere la variabile d'ambiente <code>GOOGLE_CLIENT_SECRET</code> su Vercel.</p>
      <script>window.opener?.postMessage({type:'google-oauth-error',error:'GOOGLE_CLIENT_SECRET missing'},'*');setTimeout(()=>window.close(),3000);</script>
    </body></html>`)
  }

  try {
    // Scambia code per access_token + refresh_token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      }).toString()
    })

    const tokens = await tokenRes.json()
    if (!tokenRes.ok) throw new Error(tokens.error_description || tokens.error || 'Token exchange failed')

    // refresh_token c'è solo se è la prima volta o se abbiamo usato prompt=consent
    if (!tokens.refresh_token) {
      throw new Error('Nessun refresh_token ricevuto. Revoca l\'accesso da myaccount.google.com e riprova.')
    }

    // Recupera anche il profilo utente (email) per mostrare chi è connesso
    let email = null
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
        headers: { 'Authorization': 'Bearer ' + tokens.access_token }
      })
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json()
        email = userInfo.email || null
      }
    } catch {}

    // Restituisci HTML che fa postMessage all'opener e chiude la popup
    const payload = {
      type: 'google-oauth-success',
      refresh_token: tokens.refresh_token,
      email
    }
    return sendHtml(res, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connesso</title></head>
<body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9;text-align:center">
  <h2 style="color:#10B981">✓ Google connesso</h2>
  <p>${email ? 'Account: <strong>' + escapeHtml(email) + '</strong>' : ''}</p>
  <p style="color:#94a3b8">Puoi chiudere questa finestra.</p>
  <script>
    try { window.opener?.postMessage(${JSON.stringify(payload)}, '*'); } catch(e) {}
    setTimeout(() => window.close(), 800);
  </script>
</body></html>`)
  } catch (err) {
    console.error('[google-oauth callback]', err.message)
    return sendHtml(res, `<html><body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9">
      <h2 style="color:#EF4444">❌ Errore login Google</h2>
      <p>${escapeHtml(err.message)}</p>
      <script>window.opener?.postMessage({type:'google-oauth-error',error:${JSON.stringify(err.message)}},'*');setTimeout(()=>window.close(),3000);</script>
    </body></html>`)
  }
}

function sendHtml(res, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(200).send(html)
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
