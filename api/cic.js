
const CIC_BASE = 'https://api.cassanova.com';
const FO_BASE  = 'https://fo-services.cassanova.com';

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
  if (!res.ok) throw new Error('CIC ' + res.status + ' ' + path + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

// Prova fo-services server-side con Bearer token — funziona da server ma non da browser?
async function foGet(token, path, params = {}) {
  const url = new URL(FO_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
      'Accept-Language': 'it',
      'cn-datetime': new Date().toISOString(),
      'User-Agent': 'Mozilla/5.0 (compatible; CIC-Dashboard/1.0)'
    }
  });
  const body = await res.text();
  if (!res.ok) throw new Error('FO ' + res.status + ' ' + path + ': ' + body.substring(0, 200));
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
    const f = params?.filter ? JSON.parse(params.filter) : {
      referenceDatetimeFrom: (params?.from || '2026-03-01') + 'T00:00:00.000',
      referenceDatetimeTo:   (params?.to   || '2026-03-31') + 'T23:59:59.999',
      refund: false, idSharedBillReasonIsNull: true,
      periodLocked: true, idSalesPointIsNull: true,
      idSalesPoint: null, idSalesPointLocked: false,
      idDevice: null, idDeviceLocked: false
    };

    let data;
    switch (action) {
      case 'salespoints':
        data = await cicGet(token, '/salespoint', { hasActiveLicense: true });
        return res.status(200).json(data);

      case 'receipts':
        data = await cicGet(token, '/documents/receipts', params || {});
        return res.status(200).json(data);

      // Tenta fo-services server-side con Bearer token
      case 'sold-by-department':
        data = await foGet(token, '/sold-by-department', { filter: JSON.stringify(f), start: 0, limit: 100, sorts: JSON.stringify({ profit: -1 }) });
        return res.status(200).json(data);

      case 'sold-by-category':
        data = await foGet(token, '/sold-by-category', { filter: JSON.stringify(f), start: 0, limit: 100, sorts: JSON.stringify({ profit: -1 }) });
        return res.status(200).json(data);

      case 'sold-by-tax':
        data = await foGet(token, '/sold-by-tax', { filter: JSON.stringify(f), start: 0, limit: 50 });
        return res.status(200).json(data);

      case 'sold-trend-by-day':
        data = await foGet(token, '/sold-trend-by-day', { filter: JSON.stringify(f), referenceDate: true });
        return res.status(200).json(data);

      case 'products':
        data = await cicGet(token, '/products', params || {});
        return res.status(200).json(data);

      default:
        return res.status(400).json({ error: 'action not allowed: ' + action });
    }
  } catch (err) {
    console.error('[CIC PROXY ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
