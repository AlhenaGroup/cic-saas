
const CIC_BASE = 'https://api.cassanova.com';

async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  });
  if (!res.ok) throw new Error('Token error ' + res.status + ': ' + await res.text());
  return (await res.json()).access_token;
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Version': '1.0.0' }
  });
  const body = await res.text();
  if (!res.ok) throw new Error('CIC ' + res.status + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

async function cicPost(token, path, data) {
  const res = await fetch(CIC_BASE + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Version': '1.0.0', 'X-Requested-With': '*' },
    body: JSON.stringify(data)
  });
  const body = await res.text();
  if (!res.ok) throw new Error('CIC POST ' + res.status + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, action, params } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

  try {
    const token = await getToken(apiKey);
    let data;

    switch (action) {
      case 'salespoints':
        data = await cicGet(token, '/salespoint', { hasActiveLicense: true });
        return res.status(200).json(data);

      case 'receipts':
        data = await cicGet(token, '/documents/receipts', params || {});
        return res.status(200).json(data);

      case 'webhooks_list':
        data = await cicGet(token, '/webhooks', { start: 0, limit: 20 });
        return res.status(200).json(data);

      case 'webhooks_create':
        data = await cicPost(token, '/webhooks', params);
        return res.status(200).json(data);

      case 'webhooks_delete':
        const del = await fetch(CIC_BASE + '/webhooks/' + params.id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token, 'X-Version': '1.0.0' }
        });
        return res.status(200).json({ deleted: del.ok, status: del.status });

      default:
        return res.status(400).json({ error: 'unknown action: ' + action });
    }
  } catch (err) {
    console.error('[CIC PROXY]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
