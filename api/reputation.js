// Reputation endpoint — consolidato
//
// Un singolo Vercel Serverless Function che gestisce:
//
//  GET  /api/reputation?action=oauth-start          → redirect a Google OAuth
//  GET  /api/reputation?code=...                    → OAuth callback (HTML)
//  POST /api/reputation { action: 'test' }          → health check
//  POST /api/reputation { action: 'list-accounts', refreshToken }
//  POST /api/reputation { action: 'list-locations', refreshToken, accountName }
//  POST /api/reputation { action: 'place-details', placeId }
//  POST /api/reputation { action: 'tripadvisor', url }
//
// Consolidato da google-oauth.js + google-reviews.js + tripadvisor.js
// per rispettare il limite Hobby plan di 12 Serverless Functions.

const CLIENT_ID = '379095886678-4gu92mrcvl3chknsc08kv8p1unuk419v.apps.googleusercontent.com'
const REDIRECT_URI = 'https://cic-saas.vercel.app/api/reputation'
const SCOPE = 'https://www.googleapis.com/auth/business.manage'
const TA_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Helpers ───────────────────────────────────────────────────────────────
function sendHtml(res, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(200).send(html)
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function getAccessToken(refreshToken) {
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET non configurato su Vercel')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    }).toString()
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error_description || j.error || 'Token refresh failed')
  return j.access_token
}

async function gbpGet(accessToken, url) {
  const r = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
  })
  const txt = await r.text()
  let data
  try { data = JSON.parse(txt) } catch { throw new Error('Invalid JSON from ' + url + ': ' + txt.substring(0, 200)) }
  if (!r.ok) throw new Error(data.error?.message || data.error || 'API error ' + r.status)
  return data
}

function extractJsonLd(html) {
  const out = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) out.push(...parsed)
      else out.push(parsed)
    } catch {}
  }
  return out
}

function findBusiness(ldBlocks) {
  const types = ['Restaurant', 'LocalBusiness', 'FoodEstablishment', 'BarOrPub', 'CafeOrCoffeeShop', 'Organization']
  for (const t of types) {
    const found = ldBlocks.find(b => {
      const type = Array.isArray(b['@type']) ? b['@type'][0] : b['@type']
      return type === t
    })
    if (found) return found
  }
  return ldBlocks.find(b => b.aggregateRating) || null
}

// ─── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { action, code, error: oauthError } = req.query || {}

  // ─── GET: OAuth flow (start + callback) ─────────────────────────────────
  if (req.method === 'GET') {
    // Start: redirect a Google OAuth
    if (action === 'oauth-start') {
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

    // Callback: gestito dalla presenza di "code" o "error" nella query
    if (oauthError) {
      return sendHtml(res, `<html><body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9">
        <h2 style="color:#EF4444">❌ Login Google annullato</h2>
        <p>${escapeHtml(String(oauthError))}</p>
        <p>Puoi chiudere questa finestra.</p>
        <script>window.opener?.postMessage({type:'google-oauth-error',error:${JSON.stringify(String(oauthError))}},'*');setTimeout(()=>window.close(),2000);</script>
      </body></html>`)
    }

    if (code) {
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET
      if (!clientSecret) {
        return sendHtml(res, `<html><body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9">
          <h2 style="color:#EF4444">❌ GOOGLE_CLIENT_SECRET non configurato</h2>
          <p>L'amministratore deve aggiungere la variabile d'ambiente <code>GOOGLE_CLIENT_SECRET</code> su Vercel.</p>
          <script>window.opener?.postMessage({type:'google-oauth-error',error:'GOOGLE_CLIENT_SECRET missing'},'*');setTimeout(()=>window.close(),3000);</script>
        </body></html>`)
      }

      try {
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
        if (!tokens.refresh_token) {
          throw new Error('Nessun refresh_token ricevuto. Revoca l\'accesso da myaccount.google.com e riprova.')
        }

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

        const payload = { type: 'google-oauth-success', refresh_token: tokens.refresh_token, email }
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
        console.error('[reputation oauth callback]', err.message)
        return sendHtml(res, `<html><body style="font-family:system-ui;padding:40px;background:#0f1420;color:#f1f5f9">
          <h2 style="color:#EF4444">❌ Errore login Google</h2>
          <p>${escapeHtml(err.message)}</p>
          <script>window.opener?.postMessage({type:'google-oauth-error',error:${JSON.stringify(err.message)}},'*');setTimeout(()=>window.close(),3000);</script>
        </body></html>`)
      }
    }

    return res.status(400).json({ error: 'Missing action=oauth-start or code parameter' })
  }

  // ─── POST: API actions ──────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body || {}
  const { action: postAction, refreshToken, accountName, placeId, url } = body
  if (!postAction) return res.status(400).json({ error: 'action required' })

  try {
    switch (postAction) {
      case 'test': {
        return res.status(200).json({ ok: true, message: 'reputation endpoint live' })
      }

      case 'list-accounts': {
        if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' })
        const accessToken = await getAccessToken(refreshToken)
        const data = await gbpGet(accessToken,
          'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
        )
        return res.status(200).json({
          accounts: (data.accounts || []).map(a => ({
            name: a.name,
            accountName: a.accountName,
            type: a.type,
            verificationState: a.verificationState,
            vettedState: a.vettedState
          }))
        })
      }

      case 'list-locations': {
        if (!refreshToken || !accountName) {
          return res.status(400).json({ error: 'refreshToken + accountName required' })
        }
        const accessToken = await getAccessToken(refreshToken)
        const readMask = [
          'name', 'title', 'storefrontAddress', 'metadata',
          'categories', 'phoneNumbers', 'websiteUri', 'regularHours'
        ].join(',')
        const data = await gbpGet(accessToken,
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`
        )
        return res.status(200).json({
          locations: (data.locations || []).map(l => ({
            name: l.name,
            title: l.title,
            address: [
              l.storefrontAddress?.addressLines?.join(' '),
              l.storefrontAddress?.locality,
              l.storefrontAddress?.postalCode,
              l.storefrontAddress?.regionCode
            ].filter(Boolean).join(', '),
            placeId: l.metadata?.placeId || null,
            mapsUri: l.metadata?.mapsUri || null,
            newReviewUri: l.metadata?.newReviewUri || null,
            primaryPhone: l.phoneNumbers?.primaryPhone || null,
            websiteUri: l.websiteUri || null,
            primaryCategory: l.categories?.primaryCategory?.displayName || null
          }))
        })
      }

      case 'place-details': {
        if (!placeId) return res.status(400).json({ error: 'placeId required' })
        const apiKey = process.env.GOOGLE_PLACES_API_KEY
        if (!apiKey) {
          return res.status(200).json({
            warning: 'GOOGLE_PLACES_API_KEY non configurata — rating e n° recensioni non disponibili',
            rating: null, userRatingCount: null
          })
        }
        const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'displayName,rating,userRatingCount,googleMapsUri,reviews'
          }
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error?.message || j.error || 'Places API error')
        return res.status(200).json({
          displayName: j.displayName?.text || null,
          rating: j.rating || null,
          userRatingCount: j.userRatingCount || 0,
          googleMapsUri: j.googleMapsUri || null,
          reviews: (j.reviews || []).slice(0, 5).map(rv => ({
            rating: rv.rating,
            text: rv.text?.text || rv.originalText?.text || '',
            authorName: rv.authorAttribution?.displayName || null,
            relativeTime: rv.relativePublishTimeDescription || null,
            publishTime: rv.publishTime || null
          }))
        })
      }

      case 'tripadvisor': {
        if (!url || !/^https?:\/\/(www\.)?tripadvisor\./i.test(url)) {
          return res.status(400).json({ error: 'URL TripAdvisor richiesto' })
        }
        const r = await fetch(url, {
          headers: {
            'User-Agent': TA_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8'
          }
        })
        if (!r.ok) {
          const blocked = r.status === 403 || r.status === 429
          return res.status(200).json({
            error: 'HTTP ' + r.status,
            blocked,
            message: blocked
              ? 'TripAdvisor ha bloccato la richiesta dal nostro server (anti-bot).'
              : 'Errore ' + r.status
          })
        }
        const html = await r.text()
        const blocks = extractJsonLd(html)
        if (blocks.length === 0) {
          return res.status(200).json({ error: 'Nessun blocco JSON-LD trovato', message: 'TripAdvisor ha cambiato la struttura' })
        }
        const biz = findBusiness(blocks)
        if (!biz) {
          return res.status(200).json({ error: 'Nessun business schema trovato' })
        }
        const agg = biz.aggregateRating || {}
        const reviews = (biz.review || []).map(rv => ({
          rating: Number(rv.reviewRating?.ratingValue || 0),
          text: rv.reviewBody || rv.description || '',
          authorName: rv.author?.name || (typeof rv.author === 'string' ? rv.author : null),
          datePublished: rv.datePublished || null
        }))
        return res.status(200).json({
          name: biz.name || null,
          url: biz.url || url,
          rating: Number(agg.ratingValue || 0) || null,
          reviewCount: Number(agg.reviewCount || 0) || null,
          bestRating: Number(agg.bestRating || 5),
          worstRating: Number(agg.worstRating || 1),
          priceRange: biz.priceRange || null,
          address: biz.address?.streetAddress || null,
          reviews,
          schemaType: Array.isArray(biz['@type']) ? biz['@type'][0] : biz['@type']
        })
      }

      default:
        return res.status(400).json({ error: 'unknown action: ' + postAction })
    }
  } catch (err) {
    console.error('[reputation]', postAction, err.message)
    return res.status(500).json({ error: err.message })
  }
}
