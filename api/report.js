export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cic-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, ...params } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  const cicToken = req.headers['x-cic-token'];
  if (!cicToken) return res.status(401).json({ error: 'x-cic-token header required' });

  const allowed = ['sold-by-department','sold-by-category','sold-by-tax','sold-trend-by-day'];
  if (!allowed.includes(endpoint)) return res.status(400).json({ error: 'endpoint not allowed' });

  const qs = new URLSearchParams(params).toString();
  const url = `https://fo-services.cassanova.com/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const r = await fetch(url, {
      headers: {
        'Cookie': cicToken,
        'Accept': 'application/json',
        'Accept-Language': 'it',
        'cn-datetime': new Date().toISOString()
      }
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
