// Vercel Cron Job — gira ogni notte alle 04:00 UTC
// Sincronizza i giorni mancanti in daily_stats usando api.cassanova.com
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';
const CIC_BASE = 'https://api.cassanova.com';

const SALESPOINTS = [
  { id: 21747, name: 'REMEMBEER',      apiKey: '4b7a4c14-75f3-417a-8f23-fc85c8c58d57' },
  { id: 22399, name: 'CASA DE AMICIS', apiKey: '41000e19-b98c-4022-904a-cf2290ae9d81' },
];

async function getCicToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('Token fail: ' + JSON.stringify(d));
  return d.access_token;
}

async function getReceipts(token, date, spId) {
  const sorts = encodeURIComponent(JSON.stringify([{ key: 'date', direction: 1 }]));
  const dateQ = encodeURIComponent('"' + date + '"');
  const url = `${CIC_BASE}/documents/receipts?start=0&limit=500&datetimeFrom=${dateQ}&datetimeTo=${dateQ}&sorts=${sorts}`;
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' } });
  const d = await res.json();
  return d.receipts || [];
}

function aggregateReceipts(receipts) {
  const deptMap = {}, catMap = {};
  let revenue = 0;
  for (const r of receipts) {
    revenue += r.document?.amount || 0;
    for (const row of (r.document?.rows || [])) {
      if (row.subtotal || row.composition) continue;
      const price = (row.price || 0) * (row.quantity || 1);
      const dId = row.idDepartment || 'unknown';
      const cId = row.idCategory || null;
      deptMap[dId] = deptMap[dId] || { idDepartment: dId, profit: 0, quantity: 0 };
      deptMap[dId].profit += price;
      deptMap[dId].quantity += row.quantity || 1;
      if (cId) {
        catMap[cId] = catMap[cId] || { idCategory: cId, profit: 0, quantity: 0 };
        catMap[cId].profit += price;
        catMap[cId].quantity += row.quantity || 1;
      }
    }
  }
  return {
    dept_records: Object.values(deptMap).sort((a, b) => b.profit - a.profit),
    cat_records: Object.values(catMap).sort((a, b) => b.profit - a.profit),
    bill_count: receipts.length,
    revenue: Math.round(revenue * 100) / 100
  };
}

async function saveDailyStats(sp, date, agg) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_stats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([{
      salespoint_id: sp.id,
      salespoint_name: sp.name,
      date: date,
      dept_records: agg.dept_records,
      cat_records: agg.cat_records,
      bill_count: agg.bill_count,
      revenue: agg.revenue,
      synced_at: new Date().toISOString()
    }])
  });
  return res.status;
}

async function getMissingDays() {
  // Ultime 7 giorni sempre risincronizzate + giorni mancanti dal 2024
  const today = new Date();
  const days = [];
  // Ultimi 7 giorni (aggiorna anche oggi/ieri)
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return [...new Set(days)];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Sicurezza: solo Vercel Cron o richieste autorizzate
  const authHeader = req.headers['authorization'];
  const cronHeader = req.headers['x-vercel-cron'];
  if (!cronHeader && authHeader !== 'Bearer ' + (process.env.CRON_SECRET || 'cic-sync-2026')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const logs = [];
  let saved = 0, errors = 0;

  try {
    const days = await getMissingDays();
    logs.push(`Sync ${days.length} giorni per ${SALESPOINTS.length} locali`);

    for (const sp of SALESPOINTS) {
      let token;
      try { token = await getCicToken(sp.apiKey); }
      catch (e) { logs.push(`Token fail ${sp.name}: ${e.message}`); errors++; continue; }

      for (const date of days) {
        try {
          const receipts = await getReceipts(token, date, sp.id);
          if (receipts.length === 0) continue; // salta giorni senza vendite
          const agg = aggregateReceipts(receipts);
          const status = await saveDailyStats(sp, date, agg);
          if (status === 201 || status === 204) {
            saved++;
          } else {
            errors++;
            logs.push(`Save fail ${sp.name} ${date}: status ${status}`);
          }
          await new Promise(r => setTimeout(r, 100)); // rate limiting
        } catch (e) {
          errors++; logs.push(`Err ${sp.name} ${date}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    logs.push('Fatal: ' + e.message);
    return res.status(500).json({ error: e.message, logs });
  }

  return res.status(200).json({ ok: true, saved, errors, logs, at: new Date().toISOString() });
}