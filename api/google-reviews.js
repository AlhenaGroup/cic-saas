// Google Business Profile API proxy
//
// Usa il refresh_token ottenuto via api/google-oauth per:
// 1. list-accounts → elenca gli account Business Profile dell'utente
// 2. list-locations → elenca le location di un account (nome, indirizzo, placeId, ecc.)
// 3. place-details → rating + userRatingCount via Places API (New) per un placeId
//                    (richiede GOOGLE_PLACES_API_KEY in env, opzionale)

const CLIENT_ID = '379095886678-4gu92mrcvl3chknsc08kv8p1unuk419v.apps.googleusercontent.com'

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
  if (!r.ok) throw new Error((data.error?.message || data.error || 'API error ' + r.status))
  return data
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, refreshToken, accountName, placeId } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action required' })

  try {
    switch (action) {
      case 'list-accounts': {
        if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' })
        const accessToken = await getAccessToken(refreshToken)
        const data = await gbpGet(accessToken,
          'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
        )
        return res.status(200).json({
          accounts: (data.accounts || []).map(a => ({
            name: a.name,               // es. "accounts/123456"
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
        // readMask deve essere fornita obbligatoriamente
        const readMask = [
          'name', 'title', 'storefrontAddress', 'metadata',
          'categories', 'phoneNumbers', 'websiteUri', 'regularHours'
        ].join(',')
        const data = await gbpGet(accessToken,
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`
        )
        return res.status(200).json({
          locations: (data.locations || []).map(l => ({
            name: l.name,                           // es. "accounts/123/locations/456"
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
        // Places API (New) — v1
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

      default:
        return res.status(400).json({ error: 'unknown action: ' + action })
    }
  } catch (err) {
    console.error('[google-reviews]', action, err.message)
    return res.status(500).json({ error: err.message })
  }
}
