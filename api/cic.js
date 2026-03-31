
const CIC_BASE    = 'https://api.cassanova.com';
const FO_BASE     = 'https://fo-services.cassanova.com';
const FO_LOGIN    = 'https://fo.cassanova.com';

// Cache sessione in memoria (dura finché il processo Vercel è alive)
let sessionCache = null;
let sessionExpiry = 0;

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

// Login a fo.cassanova.com e ottieni cookie di sessione
async function getFoSession(username, password) {
  const now = Date.now();
  if (sessionCache && now < sessionExpiry) return sessionCache;

  // Step 1: GET login page per ottenere CSRF token se necessario
  const loginPageRes = await fetch(FO_LOGIN + '/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CIC-Dashboard/1.0)' },
    redirect: 'follow'
  });
  
  // Raccoglie i cookie dalla login page
  const cookies = [];
  const setCookieHeader = loginPageRes.headers.get('set-cookie');
  if (setCookieHeader) {
    setCookieHeader.split(',').forEach(c => {
      const name = c.trim().split(';')[0];
      if (name) cookies.push(name);
    });
  }

  // Step 2: POST login
  const loginRes = await fetch(FO_LOGIN + '/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies.join('; '),
      'User-Agent': 'Mozilla/5.0 (compatible; CIC-Dashboard/1.0)',
      'Referer': FO_LOGIN + '/',
      'Origin': FO_LOGIN
    },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual'
  });

  // Raccoglie tutti i cookie di sessione
  const sessionCookies = [];
  const rawCookies = loginRes.headers.raw?.()?.['set-cookie'] || [];
  if (Array.isArray(rawCookies)) {
    rawCookies.forEach(c => {
      const name = c.split(';')[0].trim();
      if (name) sessionCookies.push(name);
    });
  }

  // Prova anche con getSetCookie se disponibile
  try {
    const sc = loginRes.headers.getSetCookie?.() || [];
    sc.forEach(c => {
      const name = c.split(';')[0].trim();
      if (name && !sessionCookies.includes(name)) sessionCookies.push(name);
    });
  } catch(e) {}

  const cookieStr = [...cookies, ...sessionCookies].join('; ');
  console.log('[SESSION] login status:', loginRes.status, 'cookies:', cookieStr.substring(0, 100));

  sessionCache = cookieStr;
  sessionExpiry = now + 30 * 60 * 1000; // 30 minuti
  return cookieStr;
}

// Chiama fo-services con sessione
async function foGet(cookieStr, path, params = {}) {
  const url = new URL(FO_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  const res = await fetch(url.toString(), {
    headers: {
      'Cookie': cookieStr,
      'Accept': 'application/json',
      'Accept-Language': 'it',
      'User-Agent': 'Mozilla/5.0 (compatible; CIC-Dashboard/1.0)',
      'Referer': 'https://fo.cassanova.com/'
    }
  });
  const body = await res.text();
  if (!res.ok) throw new Error('FO ' + res.status + ' ' + path + ': ' + body.substring(0, 200));
  return JSON.parse(body);
}

// Crea il filtro fo-services
function buildFilter(from, to, idSalesPoint = null) {
  return JSON.stringify({
    referenceDatetimeFrom: from + 'T00:00:00.000',
    referenceDatetimeTo:   to   + 'T23:59:59.999',
    refund: false, idSharedBillReasonIsNull: true,
    periodLocked: true,
    idSalesPointIsNull: idSalesPoint === null,
    idSalesPoint: idSalesPoint,
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

  const { apiKey, action, params, username, password } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

  try {
    const token = await getToken(apiKey);
    let data;

    switch (action) {
      case 'salespoints':
        data = await cicGet(token, '/salespoint', { hasActiveLicense: true });
        return res.status(200).json(data);

      case 'receipts': {
        const p = params || {};
        const from = toUnix(p.from || p.datetimeFrom || '2026-01-01');
        const to   = toUnix(p.to   || p.datetimeTo   || new Date().toISOString().split('T')[0]);
        data = await cicGet(token, '/documents/receipts', { start: 0, limit: p.limit || 100, datetimeFrom: from, datetimeTo: to, ...(p.idsSalesPoint && { idsSalesPoint: p.idsSalesPoint }) });
        return res.status(200).json(data);
      }

      // Endpoint fo-services — richiedono sessione browser
      case 'sold-by-department':
      case 'sold-by-category':
      case 'sold-by-tax':
      case 'sold-trend-by-day':
      case 'sold-trend-by-hour': {
        if (!username || !password) return res.status(400).json({ error: 'username and password required for fo-services' });
        const cookieStr = await getFoSession(username, password);
        const p = params || {};
        const from = p.from || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
        const to   = p.to   || new Date().toISOString().split('T')[0];
        const filter = buildFilter(from, to, p.idSalesPoint || null);
        const path = '/' + action;
        const queryParams = { start: 0, limit: p.limit || 200, filter, ...(action.includes('department') || action.includes('category') ? { sorts: JSON.stringify({ profit: -1 }) } : {}) };
        if (action === 'sold-trend-by-day') queryParams.referenceDate = true;
        data = await foGet(cookieStr, path, queryParams);
        return res.status(200).json(data);
      }

      case 'webhooks_list':
        data = await cicGet(token, '/webhooks', { start: 0, limit: 20 });
        return res.status(200).json(data);

      default:
        return res.status(400).json({ error: 'unknown action: ' + action });
    }
  } catch (err) {
    console.error('[PROXY ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
