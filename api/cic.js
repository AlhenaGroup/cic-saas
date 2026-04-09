
const CIC_BASE = 'https://api.cassanova.com';
const FO_BASE  = 'https://fo-services.cassanova.com';

async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  });
  if (!res.ok) throw new Error('Token error ' + res.status);
  return (await res.json()).access_token;
}

function toUnix(d) {
  if (!d) return null;
  if (typeof d === 'number') return d;
  return Math.floor(new Date(d).getTime() / 1000);
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' }
  });
  const body = await res.text();
  if (!res.ok) throw new Error('CIC ' + res.status + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

async function foGet(sessionCookie, path, params = {}) {
  const url = new URL(FO_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), {
    headers: {
      'Cookie': sessionCookie,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'it',
      'Referer': 'https://fo.cassanova.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'cn-datetime': new Date().toISOString()
    }
  });
  const body = await res.text();
  if (!res.ok) throw new Error('FO ' + res.status + ' ' + path + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

function buildFilter(from, to, idSalesPoint) {
  return JSON.stringify({
    referenceDatetimeFrom: from + 'T00:00:00.000',
    referenceDatetimeTo:   to   + 'T23:59:59.999',
    refund: false, idSharedBillReasonIsNull: true,
    periodLocked: true,
    idSalesPointIsNull: idSalesPoint == null,
    idSalesPoint: idSalesPoint || null,
    idSalesPointLocked: false,
    idDevice: null, idDeviceLocked: false
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, action, params, sessionCookie } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

  const p = params || {};
  const from = p.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const to   = p.to   || new Date().toISOString().split('T')[0];

  try {
    const token = await getToken(apiKey);

    switch (action) {
      case 'salespoints': {
        const data = await cicGet(token, '/salespoint', { hasActiveLicense: true });
        return res.status(200).json(data);
      }

      case 'receipts': {
        const fromU = toUnix(p.from || p.datetimeFrom || from);
        const toU   = toUnix(p.to   || p.datetimeTo   || to);
        const data  = await cicGet(token, '/documents/receipts', {
          start: 0, limit: p.limit || 100,
          datetimeFrom: fromU, datetimeTo: toU,
          ...(p.idsSalesPoint && { idsSalesPoint: p.idsSalesPoint })
        });
        return res.status(200).json(data);
      }

      // fo-services endpoints — usano il cookie di sessione passato dal browser
      case 'sold-by-department':
      case 'sold-by-category':
      case 'sold-by-tax':
      case 'sold-trend-by-day':
      case 'sold-trend-by-hour': {
        if (!sessionCookie) {
          return res.status(400).json({ error: 'sessionCookie required for fo-services', needsSession: true });
        }
        const filter = buildFilter(from, to, p.idSalesPoint);
        const foParams = { start: 0, limit: p.limit || 200, filter };

        if (action === 'sold-by-department' || action === 'sold-by-category') {
          foParams.sorts = JSON.stringify({ profit: -1 });
          if (action === 'sold-by-department') {
            foParams.fields = JSON.stringify({ '*': true, department: { id: true, salesPoint: { id: true, name: true, description: true }, description: true, live: true } });
          } else {
            foParams.fields = JSON.stringify({ '*': true, category: { id: true, salesPoint: { id: true, name: true, description: true }, description: true, live: true } });
          }
        }
        if (action === 'sold-trend-by-day') foParams.referenceDate = true;

        const data = await foGet(sessionCookie, '/' + action, foParams);
        return res.status(200).json(data);
      }

      case 'all-reports': {
        // Chiama tutti gli endpoint fo-services in parallelo
        if (!sessionCookie) {
          return res.status(400).json({ error: 'sessionCookie required', needsSession: true });
        }
        const filter = buildFilter(from, to, p.idSalesPoint);
        const base = { start: 0, limit: 200, filter };

        const reconcFilter = JSON.stringify({
          referenceDatetimeFrom: from + 'T00:00:00.000',
          referenceDatetimeTo:   to   + 'T23:59:59.999'
        });

        const [dept, cat, tax, trend, hour, reconc] = await Promise.all([
          foGet(sessionCookie, '/sold-by-department', { ...base, sorts: JSON.stringify({profit:-1}), fields: JSON.stringify({'*':true,department:{id:true,salesPoint:{id:true,name:true,description:true},description:true,live:true}}) }),
          foGet(sessionCookie, '/sold-by-category',   { ...base, sorts: JSON.stringify({profit:-1}), fields: JSON.stringify({'*':true,category:{id:true,salesPoint:{id:true,name:true,description:true},description:true,live:true}}) }),
          foGet(sessionCookie, '/sold-by-tax',        { ...base }),
          foGet(sessionCookie, '/sold-trend-by-day',  { ...base, referenceDate: true }),
          foGet(sessionCookie, '/sold-trend-by-hour', { ...base }),
          foGet(sessionCookie, '/reconciliation',     { start: 0, limit: 50, filter: reconcFilter }).catch(() => ({ records: [] })),
        ]);

        return res.status(200).json({ dept, cat, tax, trend, hour, reconc });
      }

      case 'logs': {
        const { sessionCookie: logCookie, from: logFrom, to: logTo, limit: logLimit = 200, start: logStart = 0 } = body;
        if (!logCookie) return res.status(400).json({ error: 'sessionCookie required', needsSession: true });
        const logFilter = JSON.stringify({
          datetimeFrom: logFrom + 'T00:00:00.000',
          datetimeTo: logTo + 'T23:59:59.999',
          platform: ['CASSANOVA', 'COMANDI', 'MYCASSANOVA'],
          level: ['INFO']
        });
        const logs = await foGet(logCookie, '/logs', {
          filter: logFilter,
          limit: logLimit,
          sorts: JSON.stringify({ datetime: -1 }),
          start: logStart
        });
        return res.status(200).json(logs);
      }

      case 'webhooks_list': {
        const data = await cicGet(token, '/webhooks', { start: 0, limit: 20 });
        return res.status(200).json(data);
      }

      default:
        return res.status(400).json({ error: 'unknown action: ' + action });
    }
  } catch (err) {
    console.error('[PROXY ERROR]', action, err.message);
    return res.status(500).json({ error: err.message });
  }
}
