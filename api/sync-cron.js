// Vercel Cron Job — gira ogni notte alle 04:00 UTC
// Sincronizza i giorni mancanti in daily_stats usando api.cassanova.com
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';
const CIC_BASE = 'https://api.cassanova.com';

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
  { id: 21747, name: 'REMEMBEER',      apiKey: '4b7a4c14-75f3-417a-8f23-fc85c8c58d57', filterSp: 21747 },
  { id: 22399, name: 'CASA DE AMICIS', apiKey: '41000e19-b98c-4022-904a-cf2290ae9d81', filterSp: 22399 },
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

async function getReceipts(token, date, filterSp) {
  // Paginazione: cap API = 100 record/pagina
  const sorts = encodeURIComponent(JSON.stringify([{ key: 'date', direction: 1 }]));
  const dateQ = encodeURIComponent('"' + date + '"');
  const all = [];
  let start = 0;
  while (true) {
    const url = `${CIC_BASE}/documents/receipts?start=${start}&limit=100&datetimeFrom=${dateQ}&datetimeTo=${dateQ}&sorts=${sorts}`;
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'x-version': '1.0.0' } });
    const d = await res.json();
    const page = d.receipts || [];
    // filtro client-side per salespoint
    all.push(...page.filter(r => r.document?.idSalesPoint === filterSp && !r.document?.refund));
    if (page.length < 100) break;
    start += 100;
    await new Promise(r => setTimeout(r, 150));
  }
  return all;
}

// Reparti cucina/pizzeria per rilevare ultima comanda cucina
const KITCHEN_DEPTS = new Set(['CUCINA', 'PIZZERIA']);
const BAR_DEPTS = new Set(['BAR']);

function aggregateReceipts(receipts, dynamicCatNames = {}, productNames = {}) {
  const deptMap = {}, catMap = {}, hourlyMap = {};
  const receiptDetails = [];
  let revenue = 0;
  let firstReceiptTime = null, lastReceiptTime = null, lastKitchenTime = null, lastBarTime = null;
  let zNumber = null;

  for (const r of receipts) {
    const doc = r.document || {};
    revenue += doc.amount || 0;

    // Estrai ora dallo scontrino (datetime è sul receipt top-level)
    const dt = r.datetime || r.date || '';
    const timeMatch = typeof dt === 'string' ? dt.match(/T(\d{2}):(\d{2})/) : null;
    const receiptHour = timeMatch ? parseInt(timeMatch[1]) : null;
    const receiptTime = timeMatch ? timeMatch[1] + ':' + timeMatch[2] : null;

    // Traccia primo e ultimo scontrino
    if (receiptTime && (!firstReceiptTime || receiptTime < firstReceiptTime)) firstReceiptTime = receiptTime;
    if (receiptTime && (!lastReceiptTime || receiptTime > lastReceiptTime)) lastReceiptTime = receiptTime;
    // Numero chiusura Z
    if (r.zNumber) zNumber = r.zNumber;

    // Aggregazione oraria
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
        receiptItems.push({ nome: prodName || dName || 'Articolo', qty: row.quantity || 1, prezzo: price, reparto: dName });
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
    // Salva dettaglio comanda
    if (receiptItems.length > 0) {
      receiptDetails.push({ ora: receiptTime || '—', totale: doc.amount || 0, items: receiptItems });
    }
    if (hasKitchen && receiptTime && (!lastKitchenTime || receiptTime > lastKitchenTime)) lastKitchenTime = receiptTime;
    if (hasBar && receiptTime && (!lastBarTime || receiptTime > lastBarTime)) lastBarTime = receiptTime;
  }

  return {
    dept_records: Object.values(deptMap).sort((a, b) => b.profit - a.profit),
    cat_records: Object.values(catMap).sort((a, b) => b.profit - a.profit),
    hourly_records: Object.values(hourlyMap).sort((a, b) => a.hour - b.hour),
    receipt_details: receiptDetails.sort((a, b) => (a.ora || '').localeCompare(b.ora || '')),
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
    bill_count: agg.bill_count,
    revenue: agg.revenue,
    first_receipt_time: agg.first_receipt_time,
    last_receipt_time: agg.last_receipt_time,
    last_kitchen_time: agg.last_kitchen_time,
    last_bar_time: agg.last_bar_time,
    z_number: agg.z_number,
    synced_at: new Date().toISOString()
  };
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'return=minimal'
  };

  // Prima prova UPDATE (PATCH) sul record esistente
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/daily_stats?salespoint_id=eq.${sp.id}&date=eq.${date}`,
    { method: 'PATCH', headers, body: JSON.stringify(payload) }
  );
  // 204 = aggiornato, 404 o 0 righe = non esiste ancora
  if (patchRes.status === 204) return 204;

  // Fallback: INSERT
  const postRes = await fetch(`${SUPABASE_URL}/rest/v1/daily_stats`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([payload])
  });
  return postRes.status;
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

      // Fetch nomi categorie dinamici dall'API
      const dynamicCatNames = await fetchCategoryNames(token);
      const prodNames = await fetchProductNames(token);
      const dynCount = Object.keys(dynamicCatNames).length;
      const prodCount = Object.keys(prodNames).length;
      if (dynCount > 0) logs.push(`${sp.name}: ${dynCount} categorie da API`);
      if (prodCount > 0) logs.push(`${sp.name}: ${prodCount} prodotti da API`);

      for (const date of days) {
        try {
          const receipts = await getReceipts(token, date, sp.filterSp);
          if (receipts.length === 0) continue; // salta giorni senza vendite
          const agg = aggregateReceipts(receipts, dynamicCatNames, prodNames);
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