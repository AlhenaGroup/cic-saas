// OAuth Google: authorize → callback → salva tokens in google_tokens.
// Usato SOLO per Google Calendar (sync turni HR). Per invio email usiamo SendGrid (vedi campaigns.js).
// + azioni di gestione: status (connesso?), disconnect.
//
// Env vars richieste:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   PUBLIC_BASE_URL (es. https://cic-saas.vercel.app)  ← stabile, deve essere quello registrato su Google Cloud Console
// In sviluppo locale, se PUBLIC_BASE_URL manca, si usa http://localhost:3000.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// Base URL stabile, registrato su Google Cloud Console
function getBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  // fallback per dev locale
  return 'http://localhost:3000'
}
function getRedirectUri() {
  return `${getBaseUrl()}/api/google-auth?action=callback`
}

async function requireUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  return { user }
}

export default async function handler(req, res) {
  const action = req.query.action || req.body?.action

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth non configurato. Aggiungi GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nelle env vars di Vercel.' })
  }

  switch (action) {
    case 'authorize': {
      // Scope: solo calendar.events (sync turni HR). Per invio email usiamo SendGrid.
      const scopes = ['https://www.googleapis.com/auth/calendar.events']
      const scope = encodeURIComponent(scopes.join(' '))
      const userId = req.query.state || ''
      const redirect = encodeURIComponent(getRedirectUri())
      const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${redirect}&response_type=code&scope=${scope}&access_type=offline&prompt=consent${userId ? '&state=' + encodeURIComponent(userId) : ''}`
      return res.redirect(302, url)
    }

    case 'callback': {
      const code = req.query.code
      if (!code) return res.status(400).json({ error: 'No code' })

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: getRedirectUri(),
          grant_type: 'authorization_code',
        }),
      })
      const tokens = await tokenRes.json()
      if (!tokens.access_token) {
        return res.status(400).json({ error: 'Token exchange failed', details: tokens })
      }

      const userId = req.query.state || null
      if (userId) {
        const payload = {
          user_id: userId,
          access_token: tokens.access_token,
          token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }
        if (tokens.refresh_token) payload.refresh_token = tokens.refresh_token

        const { error } = await sb.from('google_tokens')
          .upsert(payload, { onConflict: 'user_id' })
        if (error) {
          return res.status(500).json({ error: 'Salvataggio token fallito', details: error.message })
        }
      }

      return res.redirect(302, '/?tab=hr&gcal=connected')
    }

    // ─── STATUS: l'app chiede "sono connesso a Google Calendar?" ───────
    case 'status': {
      const auth = await requireUser(req)
      if (auth.error) return res.status(401).json({ error: auth.error })
      const { data } = await sb.from('google_tokens')
        .select('token_expiry, refresh_token, updated_at')
        .eq('user_id', auth.user.id).maybeSingle()
      if (!data) return res.status(200).json({ connected: false })
      return res.status(200).json({
        connected: !!data.refresh_token,
        token_expiry: data.token_expiry,
        updated_at: data.updated_at,
      })
    }

    // ─── DISCONNECT: l'utente disconnette Google ───────────────────────
    case 'disconnect': {
      const auth = await requireUser(req)
      if (auth.error) return res.status(401).json({ error: auth.error })
      const { error } = await sb.from('google_tokens').delete().eq('user_id', auth.user.id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    default:
      return res.status(400).json({ error: 'Unknown action: ' + action })
  }
}
