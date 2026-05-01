const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/google-auth?action=callback` : 'http://localhost:3000/api/google-auth?action=callback';

export default async function handler(req, res) {
  const action = req.query.action || req.body?.action;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth non configurato. Aggiungi GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nelle env vars di Vercel.' });
  }

  switch (action) {
    case 'authorize': {
      // Scope: calendar.events (per HR) + gmail.send (per resoconto giornaliero) + userinfo.email
      const scopes = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
      ];
      const scope = encodeURIComponent(scopes.join(' '));
      const userId = req.query.state || '';
      const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent${userId ? '&state=' + encodeURIComponent(userId) : ''}`;
      return res.redirect(302, url);
    }

    case 'callback': {
      const code = req.query.code;
      if (!code) return res.status(400).json({ error: 'No code' });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) return res.status(400).json({ error: 'Token exchange failed', details: tokens });

      // Per ora salviamo con un user_id placeholder - in produzione bisogna passare il session token
      const userId = req.query.state || null;
      if (userId) {
        await fetch(`${SUPABASE_URL}/rest/v1/google_tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{
            user_id: userId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          }])
        });
      }

      return res.redirect(302, '/?tab=hr&gcal=connected');
    }

    default:
      return res.status(400).json({ error: 'Unknown action: ' + action });
  }
}
