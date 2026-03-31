
const CIC_BASE = 'https://api.cassanova.com';

async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Token error ' + res.status + ': ' + body);
  }
  return (await res.json()).access_token;
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Version': '1.0.0',
      'Accept': 'application/json',
      'User-Agent': 'CIC-Dashboard/1.0'
    }
  });
  const body = await res.text();
  if (!res.ok) throw new Error('CIC ' + res.status + ' ' + path + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, action, params } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
  if (!action) return res.status(400).json({ error: 'action required' });

  const allowed = ['token', 'salespoints', 'receipts', 'sold-by-department', 'sold-by-category', 'sold-by-tax', 'products'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'action not allowed' });

  try {
    // Step 1: ottieni token
    const token = await getToken(apiKey);

    // Step 2: esegui azione richiesta
    let data;
    switch (action) {
      case 'token':
        return res.status(200).json({ token });

      case 'salespoints':
        data = await cicGet(token, '/salespoint', { hasActiveLicense: true });
        return res.status(200).json(data);

      case 'receipts':
        data = await cicGet(token, '/documents/receipts', params || {});
        return res.status(200).json(data);

      case 'sold-by-department':
        data = await cicGet(token, '/reports/sold-by-department', params || {});
        return res.status(200).json(data);

      case 'sold-by-category':
        data = await cicGet(token, '/reports/sold-by-category', params || {});
        return res.status(200).json(data);

      case 'sold-by-tax':
        data = await cicGet(token, '/reports/sold-by-tax', params || {});
        return res.status(200).json(data);

      case 'products':
        data = await cicGet(token, '/products', params || {});
        return res.status(200).json(data);

      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (err) {
    console.error('[CIC PROXY ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
