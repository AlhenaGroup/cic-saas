// Vercel Cron Job — gira ogni notte alle 04:00 UTC
// Sincronizza i giorni mancanti in daily_stats usando api.cassanova.com
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';
const CIC_BASE = 'https://api.cassanova.com';
const FO_BASE = 'https://fo-services.cassanova.com';

const CAT_NAMES = {
  "5c4e782b-8c54-402d-8ee2-861d1fc181c1": "CLASSICI",
  "15df84ef-245f-44f2-a651-ffe6ba5820b1": "SPINA",
  "8856e504-961b-4b92-8218-305bd4c9d5b7": "BIBITE",
  "3a8c8499-4200-4a8a-8b68-4d84a5e8da17": "VINI",
  "6610357a-5f52-49cc-8b5c-78bef33f29c7": "GIN",
  "bbfcab4f-de88-422c-a7b9-77c19ca14a56": "STARTERS",
  "d6231966-0341-4e5b-b362-421526e186c2": "ALCOOL FREE",
  "be654494-49c3-4b77-a1be-ed985c233acf": "PINSE",
  "879254a2-c2af-444b-afac-3b75d0847b2d": "BOX",
  "edf21cf0-4f6f-4055-bb2c-389b796fbafd": "AMARI",
  "6f6c58ab-08c7-40ce-bcac-226701f87ffb": "BURGER",
  "be7758d7-fcba-48b3-80c4-bd2ff8fa9480": "BEER AND JUICE",
  "e859c5a1-bf49-4926-a1df-4fbcdec3d146": "CUCINA",
  "833e3f20-8338-4e9d-a4ea-f1d147094ad4": "REMEMBEER WHEN",
  "f1320f5d-b5b4-4f1c-a03e-88e7f2266f10": "PESTATI",
  "aa6ce45f-3a53-4d52-802e-fe8c999bf123": "SUCCHI DI FRUTTA",
  "20230963-1f42-4709-8fbb-687d41f44f2b": "VERMOUTH",
  "e2b95b55-1e74-4345-95a0-a6011088fe4f": "GOLOSI",
  "b687801f-010a-43bc-bdb8-f408d370e821": "WHISKY",
  "9df9e33a-e2e8-4d6b-8c06-5371f086fe47": "DOLCI",
  "c4d771fb-74ba-426e-b2aa-9e25b109753e": "RUM",
  "e361b756-5727-4296-b02d-78c8cbff721a": "GRAPPE",
  "eefa3dc1-ce70-496d-a776-750ef84e8001": "PROMOZIONI FOOD",
  "f3bd1fc0-cde2-4cb4-ae19-156900bf3f98": "PROMOZIONI BEVERAGE",
  "aa26eeec-f9b1-4496-b751-1dc03354e64e": "LE CREAZIONI DI CASA",
  "b8f3b1f7-e318-45aa-8972-b911649ca5bd": "LE NOSTRE CLASSICHE",
  "fcdfcc4b-c5ae-4997-90a3-c7b9ca35e0c8": "DOLCI",
  "466f0936-de33-42b7-9009-4484ae251e3c": "BIRRE",
  "221fe8dc-cd19-4cc6-a81a-1fb13048d2f8": "STAGIONALI",
  "49d6708c-e2ab-4c38-8439-3c32873e4c82": "ACQUE",
  "69bad285-f472-4af3-ac6c-d390d8c03a8e": "I PADELLINI CONTEMPORANEI",
  "01401edf-7dbf-4b9e-a9fe-6fd2a7c162f2": "BIBITE",
  "ebb905c9-1ff1-47d7-a741-ca59354d20da": "CAFFE'",
  "df4556fc-bccb-4747-a06c-fd246e9972b8": "BIANCHI",
  "bebbd1f6-bb42-40ab-8587-e19e6774143e": "BOLLICINE",
  "e1261237-2b0a-4602-8b8b-ed4d620f921a": "AMARI",
  "8dee62de-7ee9-451d-a13c-2ea90d652e5f": "ROSSI",
  "b2290bc1-4da9-45eb-8306-a74b163b234e": "ANTIPASTI",
  "be444bfe-2665-4ebb-a445-a45d2bf612bc": "ROSATI",
  "a250119a-17d4-4eb5-956a-e3fa56794136": "VINI DESSERT",
  "1c86d42e-903d-411a-a70f-f74dd8692538": "GIN TONIC",
  "7fe7f355-f3c8-4c65-b5b5-62c6abf5a894": "PROMOZIONI FOOD & BEVERAGE",
  "b710212b-1653-4a53-b56c-30dde21eb37d": "COCKTAIL",
  "6cc63801-6e20-41df-b59a-2d6a140ecb5f": "WHISKY",
  "8a7664fe-2883-4b3c-89eb-3e4bf4a6f5af": "VINI DOLCI",
  "45493c2a-824b-4a4e-ad94-8220ef617b96": "RUM",
  "1b42d20e-53b8-4a45-a278-f75d829d1186": "BEVANDE",
  "c4f16422-61b4-4612-94c0-80519e46b03c": "BOURBON",
  "9119a630-5d0c-4f10-ac22-895331f58abb": "PROMOZIONI BEVERAGE",
  "8bc2e435-0b06-4f6b-b8ba-a72ce2886e77": "PROMOZIONI FOOD"
};

const DEPT_NAMES = {"4b5a191f-2a22-4520-9c86-71ad1eda5b15":"BAR","5fe05a66-002d-4c2f-9fe7-2d2ea55a39c9":"CUCINA","a164ece6-2c76-4031-a6f6-4900acf1229f":"Reparto 1","ecddf000-60ad-492c-aaaa-5d669e188679":"IVA AL 4","1f8f00bd-7671-4d5d-b19e-e8dc581c3256":"COPERTO","226b870e-44fc-40d1-8506-585bec12ed72":"PIZZERIA","c80cdb68-e3c1-4344-a8e4-f799ff811ae9":"COPERTO","ed7ffa46-6a3d-42f8-a52f-3be32b97d8db":"BAR"};

const SALESPOINTS = [
  { id: 21747, name: 'REMEMBEER',      apiKey: '4b7a4c14-75f3-417a-8f23-fc85c8c58d57', filterSp: 21747, openHour: 10 },
  { id: 22399, name: 'CASA DE AMICIS', apiKey: '41000e19-b98c-4022-904a-cf2290ae9d81', filterSp: 22399, openHour: 17 },
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

// Fetch nomi prodotti dall'API CiC
async function fetchProductNames(token) {
  const names = {};
  try {
    let start = 0;
    while (true) {
      const res = await fetch(CIC_BASE + '/products?start=' + start + '&limit=100', {
        headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' }
      });
      if (!res.ok) break;
      const d = await res.json();
      const prods = d.products || [];
      for (const p of prods) { if (p.id && p.description) names[p.id] = p.description; }
      if (prods.length < 100) break;
      start += 100;
      await new Promise(r => setTimeout(r, 100));
    }
  } catch (e) { /* silently fail */ }
  return names;
}

// Fetch categorie dinamiche dall'API CiC
async function fetchCategoryNames(token) {
  const names = {};
  try {
    const res = await fetch(CIC_BASE + '/warehouse/categories?start=0&limit=500', {
      headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' }
    });
    if (res.ok) {
      const d = await res.json();
      const cats = d.categories || d.results || (Array.isArray(d) ? d : []);
      for (const c of cats) {
        if (c.id && c.description) names[c.id] = c.description;
      }
    }
  } catch (e) { /* fallback a CAT_NAMES statica */ }
  return names;
}

// Fetch chiusura cassa (reconciliation) per una data
// Cerca sia nel giorno stesso che nel giorno dopo (per chiusure after-midnight)
async function getReconciliation(token, date, filterSp) {
  try {
    // Cerca riconciliazioni nella finestra dal giorno stesso fino al giorno dopo
    // (la chiusura cassa dell'8 aprile potrebbe essere registrata il 9 aprile alle 01:00)
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().split('T')[0];
    const dateFromQ = encodeURIComponent('"' + date + '"');
    const dateToQ = encodeURIComponent('"' + nextDateStr + '"');
    const url = `${CIC_BASE}/reconciliations?start=0&limit=10&datetimeFrom=${dateFromQ}&datetimeTo=${dateToQ}`;
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' } });
    if (!res.ok) return null;
    const d = await res.json();
    // Filtra per locale e prendi l'ultima riconciliazione (quella di chiusura serale)
    const recs = (d.reconciliations || []).filter(r => r.idSalesPoint === filterSp);
    if (!recs.length) return null;
    // Prendi l'ultima (più recente) — è quella di chiusura serale
    const rec = recs.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (!rec.date) return null;
    // Converti in ora italiana (Europe/Rome) — su Vercel il server è UTC
    const dt = new Date(rec.date);
    const itTime = dt.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
    return { time: itTime, zNumber: rec.number };
  } catch { return null; }
}

async function getReceipts(token, date, filterSp, openHour = 10) {
  // Scarica receipt del giorno lavorativo:
  // - Dal giorno di calendario (date) dall'ora di apertura
  // - + il giorno successivo fino all'ora di apertura (per scontrini dopo mezzanotte)
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = nextDate.toISOString().split('T')[0];

  const sorts = encodeURIComponent(JSON.stringify([{ key: 'date', direction: 1 }]));
  const all = [];
  const refunds = []; // Receipt annullati/resi — per monitoring

  // Fetch da entrambi i giorni di calendario
  for (const d of [date, nextDateStr]) {
    const dateQ = encodeURIComponent('"' + d + '"');
    let start = 0;
    while (true) {
      const url = `${CIC_BASE}/documents/receipts?start=${start}&limit=100&datetimeFrom=${dateQ}&datetimeTo=${dateQ}&sorts=${sorts}`;
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' } });
      const data = await res.json();
      const page = data.receipts || [];
      for (const r of page) {
        if (r.document?.idSalesPoint !== filterSp) continue;
        const h = r.datetime ? parseInt(r.datetime.match(/T(\d{2})/)?.[1]) : null;
        if (h == null) continue;
        const inRange = (d === date && h >= openHour) || (d === nextDateStr && h < openHour);
        if (!inRange) continue;
        if (r.document?.refund) {
          refunds.push(r); // Traccia annulli separatamente
        } else {
          all.push(r);
        }
      }
      if (page.length < 100) break;
      start += 100;
      await new Promise(r => setTimeout(r, 150));
    }
  }
  return { receipts: all, refunds };
}

// Estrai monitoring events dai receipt (annulli, sconti, ecc.)
// Fetch monitoring logs da fo-services (richiede sessionCookie salvato in Supabase settings)
async function fetchMonitoringLogs(sessionCookie, date) {
  if (!sessionCookie) return [];
  try {
    const filter = JSON.stringify({
      datetimeFrom: date + 'T00:00:00.000',
      datetimeTo: date + 'T23:59:59.999',
      platform: ['CASSANOVA', 'COMANDI', 'MYCASSANOVA'],
      level: ['INFO']
    });
    const url = `${FO_BASE}/logs?filter=${encodeURIComponent(filter)}&limit=500&sorts=${encodeURIComponent('{"datetime":-1}')}&start=0`;
    const res = await fetch(url, {
      headers: {
        'Cookie': sessionCookie,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'it',
        'Referer': 'https://fo.cassanova.com/',
      }
    });
    if (!res.ok) return [];
    const d = await res.json();
    const records = d.records || d.logs || [];
    // Converte in formato standard
    return records.map(r => {
      const dt = r.datetime || '';
      const timeStr = dt.includes('T') ? dt.substring(11, 19) : '';
      return {
        type: r.operation || r.action || 'Altro',
        datetime: dt,
        time: timeStr,
        user: r.user?.username || r.user?.name || r.username || '—',
        description: r.description || r.details || r.message || '—',
        locale: r.salesPoint?.description || r.salesPoint?.name || '—',
        amount: 0,
        severity: (r.operation || '').toLowerCase().includes('eliminazione') ? 'high' :
                  (r.operation || '').toLowerCase().includes('sconto') ? 'medium' : 'low',
      };
    });
  } catch (e) { console.error('Monitoring logs fetch error:', e.message); return []; }
}

// Legge sessionCookie da Supabase settings (salvato dal frontend)
async function getSessionCookie() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.cic_session_cookie&select=value`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.value || null;
  } catch { return null; }
}

function extractMonitoringEvents(receipts, refunds) {
  const events = [];
  const toTime = (dt) => {
    if (!dt) return '—';
    try {
      const d = new Date(dt);
      return d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return '—'; }
  };

  // 1. Annulli/Resi (refund receipts)
  for (const r of refunds) {
    const doc = r.document || {};
    events.push({
      type: 'Eliminazione Documento',
      datetime: r.datetime,
      time: toTime(r.datetime),
      user: doc.operator?.username || doc.operator?.name || '—',
      description: `Scontrino ${r.number || '—'} - totale: ${(doc.amount || 0).toFixed(2)}€`,
      amount: doc.amount || 0,
      severity: 'high',
    });
  }

  // 2. Sconti applicati sugli items
  for (const r of receipts) {
    const doc = r.document || {};
    const items = doc.items || [];
    for (const item of items) {
      if (item.discount && item.discount > 0) {
        const pct = item.discountPercentage || (item.discount / (item.totalPrice + item.discount) * 100);
        events.push({
          type: 'Applicazione/Modifica Sconto',
          datetime: r.datetime,
          time: toTime(r.datetime),
          user: doc.operator?.username || doc.operator?.name || '—',
          description: `[prodotto: ${item.description || item.name || '—'} - sconto ${pct > 0 ? pct.toFixed(0) + '%' : (item.discount || 0).toFixed(2) + '€'} - documento: Scontrino ${r.number || '—'}${doc.orderSummary?.tableName ? ' - tavolo: ' + doc.orderSummary.tableName : ''}]`,
          amount: item.discount,
          severity: pct > 30 ? 'medium' : 'low',
        });
      }
    }
  }

  // Ordina per datetime desc
  events.sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
  return events;
}

// Reparti cucina/pizzeria per rilevare ultima comanda cucina
const KITCHEN_DEPTS = new Set(['CUCINA', 'PIZZERIA']);
const BAR_DEPTS = new Set(['BAR']);

function aggregateReceipts(receipts, dynamicCatNames = {}, productNames = {}, openHour = 10) {
  const deptMap = {}, catMap = {}, hourlyMap = {}, comandeMap = {};
  let revenue = 0;
  let firstReceiptTime = null, lastReceiptTime = null, lastKitchenTime = null, lastBarTime = null;
  let firstBizTime = null, lastBizTime = null, lastKitchenBiz = null, lastBarBiz = null;
  let zNumber = null;

  for (const r of receipts) {
    const doc = r.document || {};
    revenue += doc.amount || 0;

    // Estrai ora dallo scontrino (datetime è sul receipt top-level)
    const dt = r.datetime || r.date || '';
    const timeMatch = typeof dt === 'string' ? dt.match(/T(\d{2}):(\d{2})/) : null;
    const receiptHour = timeMatch ? parseInt(timeMatch[1]) : null;
    const receiptTime = timeMatch ? timeMatch[1] + ':' + timeMatch[2] : null;

    // Traccia primo e ultimo scontrino del giorno lavorativo
    // Ore prima di openHour = dopo mezzanotte, vanno considerate "tardi"
    if (receiptHour != null && receiptTime) {
      const bizTime = receiptHour < openHour ? (24 + receiptHour) : receiptHour;
      if (firstBizTime == null || bizTime < firstBizTime) { firstBizTime = bizTime; firstReceiptTime = receiptTime; }
      if (lastBizTime == null || bizTime > lastBizTime) { lastBizTime = bizTime; lastReceiptTime = receiptTime; }
    }
    // Numero chiusura Z
    if (r.zNumber) zNumber = r.zNumber;

    // Aggregazione oraria (solo dalle 16:00)
    if (receiptHour != null) {
      if (!hourlyMap[receiptHour]) hourlyMap[receiptHour] = { hour: receiptHour, ricavi: 0, scontrini: 0 };
      hourlyMap[receiptHour].ricavi += doc.amount || 0;
      hourlyMap[receiptHour].scontrini += 1;
    }

    // Raccolta items per dettaglio comanda
    const receiptItems = [];
    let hasKitchen = false, hasBar = false;
    for (const row of (doc.rows || [])) {
      if (row.subtotal || row.composition) continue;
      const price = (row.price || 0) * (row.quantity || 1);
      const dId = row.idDepartment || 'unknown';
      const cId = row.idCategory || null;
      const dName = row.department?.description || DEPT_NAMES[dId] || null;
      deptMap[dId] = deptMap[dId] || { idDepartment: dId, department: dName ? { description: dName } : undefined, profit: 0, quantity: 0 };
      if (!deptMap[dId].department?.description && dName) deptMap[dId].department = { description: dName };
      deptMap[dId].profit += price;
      deptMap[dId].quantity += row.quantity || 1;

      // Dettaglio prodotto per la comanda
      if (!row.coverCharge && price > 0) {
        const prodName = (row.idProduct && productNames[row.idProduct]) || (row.idProductVariant && productNames[row.idProductVariant]) || null;
        const catName = row.category?.description || dynamicCatNames[cId] || CAT_NAMES[cId] || null;
        receiptItems.push({ nome: prodName || dName || 'Articolo', qty: row.quantity || 1, prezzo: price, reparto: dName, categoria: catName });
      }

      // Traccia ultima comanda cucina/bar
      if (dName && KITCHEN_DEPTS.has(dName.toUpperCase())) hasKitchen = true;
      if (dName && BAR_DEPTS.has(dName.toUpperCase())) hasBar = true;

      if (cId) {
        const cName = row.category?.description || dynamicCatNames[cId] || CAT_NAMES[cId] || null;
        catMap[cId] = catMap[cId] || { idCategory: cId, description: cName, profit: 0, quantity: 0 };
        if (!catMap[cId].description && cName) catMap[cId].description = cName;
        catMap[cId].profit += price;
        catMap[cId].quantity += row.quantity || 1;
      }
    }
    // Raggruppa scontrini per comanda (orderSummary.id) — solo dalle 16:00
    if (receiptItems.length > 0 && receiptHour != null) {
      const os = doc.orderSummary || {};
      const orderId = os.id || r.id; // fallback a receipt id se non c'e orderSummary
      const openMatch = typeof os.openingTime === 'string' ? os.openingTime.match(/T(\d{2}:\d{2})/) : null;
      const closeMatch = typeof os.closingTime === 'string' ? os.closingTime.match(/T(\d{2}:\d{2})/) : null;

      if (!comandeMap[orderId]) {
        comandeMap[orderId] = {
          aperturaComanda: openMatch ? openMatch[1] : null,
          chiusuraComanda: closeMatch ? closeMatch[1] : null,
          tavolo: os.tableName || null,
          coperti: os.covers || null,
          totale: 0,
          items: []
        };
      }
      comandeMap[orderId].totale += doc.amount || 0;
      comandeMap[orderId].items.push(...receiptItems);
    }
    if (receiptHour != null) {
      const bizT = receiptHour < openHour ? (24 + receiptHour) : receiptHour;
      if (hasKitchen && receiptTime && (lastKitchenBiz == null || bizT > lastKitchenBiz)) { lastKitchenBiz = bizT; lastKitchenTime = receiptTime; }
      if (hasBar && receiptTime && (lastBarBiz == null || bizT > lastBarBiz)) { lastBarBiz = bizT; lastBarTime = receiptTime; }
    }
  }

  return {
    dept_records: Object.values(deptMap).sort((a, b) => b.profit - a.profit),
    cat_records: Object.values(catMap).sort((a, b) => b.profit - a.profit),
    hourly_records: Object.values(hourlyMap).sort((a, b) => a.hour - b.hour),
    receipt_details: Object.values(comandeMap).sort((a, b) => (a.aperturaComanda || '').localeCompare(b.aperturaComanda || '')),
    bill_count: receipts.length,
    revenue: Math.round(revenue * 100) / 100,
    first_receipt_time: firstReceiptTime,
    last_receipt_time: lastReceiptTime,
    last_kitchen_time: lastKitchenTime,
    last_bar_time: lastBarTime,
    z_number: zNumber
  };
}

async function saveDailyStats(sp, date, agg) {
  const payload = {
    salespoint_id: sp.id,
    salespoint_name: sp.name,
    date: date,
    dept_records: agg.dept_records,
    cat_records: agg.cat_records,
    hourly_records: agg.hourly_records,
    receipt_details: agg.receipt_details,
    monitoring_events: agg.monitoring_events || [],
    bill_count: agg.bill_count,
    revenue: agg.revenue,
    first_receipt_time: agg.first_receipt_time,
    last_receipt_time: agg.last_receipt_time,
    last_kitchen_time: agg.last_kitchen_time,
    last_bar_time: agg.last_bar_time,
    z_number: agg.z_number,
    fiscal_close_time: agg.fiscal_close_time,
    synced_at: new Date().toISOString()
  };
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'return=minimal'
  };

  // DELETE + INSERT (upsert affidabile)
  await fetch(
    `${SUPABASE_URL}/rest/v1/daily_stats?salespoint_id=eq.${sp.id}&date=eq.${date}`,
    { method: 'DELETE', headers }
  );
  const postRes = await fetch(`${SUPABASE_URL}/rest/v1/daily_stats`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify([payload])
  });
  return postRes.status;
}

async function getMissingDays(numDays = 7) {
  const today = new Date();
  const days = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return [...new Set(days)];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: cron Vercel | CRON_SECRET | apiKey CiC nota (per sync on-demand dal client)
  const authHeader = req.headers['authorization'] || '';
  const cronHeader = req.headers['x-vercel-cron'];
  const clientApiKey = req.query?.apiKey || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  const hardcodedKeys = SALESPOINTS.map(s => s.apiKey).filter(Boolean);
  const isCron = !!cronHeader;
  const isCronSecret = authHeader === 'Bearer ' + (process.env.CRON_SECRET || 'cic-sync-2026');
  let isClientKey = clientApiKey && hardcodedKeys.includes(clientApiKey);
  // Se non e' una delle apiKey hardcoded, prova lookup in user_settings (apiKey aggregatrice)
  if (!isClientKey && clientApiKey && !isCron && !isCronSecret) {
    try {
      const sbUrl = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
      const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';
      const r = await fetch(`${sbUrl}/rest/v1/user_settings?cic_api_key=eq.${encodeURIComponent(clientApiKey)}&select=id&limit=1`, {
        headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey }
      });
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length > 0) isClientKey = true;
    } catch {}
  }
  if (!isCron && !isCronSecret && !isClientKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const logs = [];
  let saved = 0, errors = 0;

  try {
    // Range custom (from/to) per sync on-demand, oppure ultimi N giorni (default cron)
    let days;
    const qFrom = req.query?.from, qTo = req.query?.to;
    if (qFrom && qTo) {
      days = [];
      const start = new Date(qFrom), end = new Date(qTo);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split('T')[0]);
      }
      // Limita a 60 giorni per sicurezza (timeout Vercel)
      if (days.length > 60) days = days.slice(-60);
    } else {
      const numDays = parseInt(req.query?.days) || 7;
      days = await getMissingDays(numDays);
    }
    logs.push(`Sync ${days.length} giorni per ${SALESPOINTS.length} locali`);

    for (const sp of SALESPOINTS) {
      let token;
      try { token = await getCicToken(sp.apiKey); }
      catch (e) { logs.push(`Token fail ${sp.name}: ${e.message}`); errors++; continue; }

      // Fetch nomi categorie dinamici dall'API
      const dynamicCatNames = await fetchCategoryNames(token);
      const prodNames = await fetchProductNames(token);
      const dynCount = Object.keys(dynamicCatNames).length;
      const prodCount = Object.keys(prodNames).length;
      if (dynCount > 0) logs.push(`${sp.name}: ${dynCount} categorie da API`);
      if (prodCount > 0) logs.push(`${sp.name}: ${prodCount} prodotti da API`);

      for (const date of days) {
        try {
          const { receipts, refunds } = await getReceipts(token, date, sp.filterSp, sp.openHour);
          if (receipts.length === 0 && refunds.length === 0) continue; // salta giorni senza vendite
          const agg = aggregateReceipts(receipts, dynamicCatNames, prodNames, sp.openHour);
          // Monitoring: prima prova fo-services /logs (dati completi), fallback a receipt analysis
          const foLogs = []; // fetchMonitoringLogs disabilitato (sessionCookie non disponibile nel cron)
          const spLogs = foLogs.filter(l => l.locale.includes(sp.name) || l.locale === '—');
          agg.monitoring_events = spLogs.length > 0 ? spLogs : extractMonitoringEvents(receipts, refunds);
          // Chiusura cassa reale dalla reconciliation
          const reconc = await getReconciliation(token, date, sp.filterSp);
          if (reconc) {
            agg.fiscal_close_time = reconc.time;
            agg.z_number = reconc.zNumber;
          }
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