import { supabase } from './supabase'
import { CATEGORY_RULES } from '../components/ContoEconomico.jsx'


const PROXY = '/api/cic';
async function proxyCall(apiKey, action, params = {}) {
  const res = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, action, params }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Proxy error ' + res.status);
  return data;
}


// ─── Mapping UUID → Nome (estratto da monthly_stats) ───────────────────────
const DEPT_NAMES = {"4b5a191f-2a22-4520-9c86-71ad1eda5b15":"BAR","5fe05a66-002d-4c2f-9fe7-2d2ea55a39c9":"CUCINA","a164ece6-2c76-4031-a6f6-4900acf1229f":"Reparto 1","ecddf000-60ad-492c-aaaa-5d669e188679":"IVA AL 4","1f8f00bd-7671-4d5d-b19e-e8dc581c3256":"COPERTO","226b870e-44fc-40d1-8506-585bec12ed72":"PIZZERIA","c80cdb68-e3c1-4344-a8e4-f799ff811ae9":"COPERTO","ed7ffa46-6a3d-42f8-a52f-3be32b97d8db":"BAR"};
const CAT_NAMES  = {"5c4e782b-8c54-402d-8ee2-861d1fc181c1":"CLASSICI","15df84ef-245f-44f2-a651-ffe6ba5820b1":"SPINA","3a8c8499-4200-4a8a-8b68-4d84a5e8da17":"VINI","6610357a-5f52-49cc-8b5c-78bef33f29c7":"GIN","8856e504-961b-4b92-8218-305bd4c9d5b7":"BIBITE","d6231966-0341-4e5b-b362-421526e186c2":"ALCOOL FREE","879254a2-c2af-444b-afac-3b75d0847b2d":"BOX","be654494-49c3-4b77-a1be-ed985c233acf":"PINSE","edf21cf0-4f6f-4055-bb2c-389b796fbafd":"AMARI","bbfcab4f-de88-422c-a7b9-77c19ca14a56":"STARTERS","6f6c58ab-08c7-40ce-bcac-226701f87ffb":"BURGER","be7758d7-fcba-48b3-80c4-bd2ff8fa9480":"BEER AND JUICE","833e3f20-8338-4e9d-a4ea-f1d147094ad4":"REMEMBEER WHEN","20230963-1f42-4709-8fbb-687d41f44f2b":"VERMOUTH","9df9e33a-e2e8-4d6b-8c06-5371f086fe47":"DOLCI","b687801f-010a-43bc-bdb8-f408d370e821":"WHISKY","aa6ce45f-3a53-4d52-802e-fe8c999bf123":"SUCCHI DI FRUTTA","c4d771fb-74ba-426e-b2aa-9e25b109753e":"RUM","e361b756-5727-4296-b02d-78c8cbff721a":"GRAPPE","f1320f5d-b5b4-4f1c-a03e-88e7f2266f10":"PESTATI","e2b95b55-1e74-4345-95a0-a6011088fe4f":"GOLOSI","e859c5a1-bf49-4926-a1df-4fbcdec3d146":"CUCINA","f3bd1fc0-cde2-4cb4-ae19-156900bf3f98":"PROMOZIONI BEVERAGE","eefa3dc1-ce70-496d-a776-750ef84e8001":"PROMOZIONI FOOD","b8f3b1f7-e318-45aa-8972-b911649ca5bd":"LE NOSTRE CLASSICHE","aa26eeec-f9b1-4496-b751-1dc03354e64e":"LE CREAZIONI DI CASA","fcdfcc4b-c5ae-4997-90a3-c7b9ca35e0c8":"DOLCI","466f0936-de33-42b7-9009-4484ae251e3c":"BIRRE","221fe8dc-cd19-4cc6-a81a-1fb13048d2f8":"STAGIONALI","69bad285-f472-4af3-ac6c-d390d8c03a8e":"I PADELLINI CONTEMPORANEI","49d6708c-e2ab-4c38-8439-3c32873e4c82":"ACQUE","ebb905c9-1ff1-47d7-a741-ca59354d20da":"CAFFE'","01401edf-7dbf-4b9e-a9fe-6fd2a7c162f2":"BIBITE","8dee62de-7ee9-451d-a13c-2ea90d652e5f":"ROSSI","bebbd1f6-bb42-40ab-8587-e19e6774143e":"BOLLICINE","df4556fc-bccb-4747-a06c-fd246e9972b8":"BIANCHI","e1261237-2b0a-4602-8b8b-ed4d620f921a":"AMARI","1c86d42e-903d-411a-a70f-f74dd8692538":"GIN TONIC","a250119a-17d4-4eb5-956a-e3fa56794136":"VINI DESSERT","be444bfe-2665-4ebb-a445-a45d2bf612bc":"ROSATI","c4f16422-61b4-4612-94c0-80519e46b03c":"BOURBON","8a7664fe-2883-4b3c-89eb-3e4bf4a6f5af":"VINI DOLCI","6cc63801-6e20-41df-b59a-2d6a140ecb5f":"WHISKY","45493c2a-824b-4a4e-ad94-8220ef617b96":"RUM","b710212b-1653-4a53-b56c-30dde21eb37d":"COCKTAIL","1b42d20e-53b8-4a45-a278-f75d829d1186":"BEVANDE","b2290bc1-4da9-45eb-8306-a74b163b234e":"ANTIPASTI","9119a630-5d0c-4f10-ac22-895331f58abb":"PROMOZIONI BEVERAGE","8bc2e435-0b06-4f6b-b8ba-a72ce2886e77":"PROMOZIONI FOOD","7fe7f355-f3c8-4c65-b5b5-62c6abf5a894":"PROMOZIONI FOOD & BEVERAGE"};
// ────────────────────────────────────────────────────────────────────────────

export async function getToken(apiKey) { return apiKey; }

export async function getSalesPoints(apiKey) {
  try {
    const d = await proxyCall(apiKey, 'salespoints');
    return Array.isArray(d.salesPoint) ? d.salesPoint : Array.isArray(d) ? d : [];
  } catch(e) {
    const { data } = await supabase.from('daily_stats').select('salespoint_id,salespoint_name').limit(50);
    const seen = {};
    (data||[]).forEach(r => { seen[r.salespoint_id] = r.salespoint_name; });
    return Object.entries(seen).map(([id,name]) => ({ id: parseInt(id), description: name }));
  }
}

// Legge dati giornalieri ESATTI da daily_stats
export async function getFromDailyStats(from, to, idsSalesPoint = []) {
  let query = supabase
    .from('daily_stats')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });
  if (idsSalesPoint?.length) query = query.in('salespoint_id', idsSalesPoint);
  
  const { data: rows, error } = await query;
  if (error || !rows?.length) return null;

  const deptMap = {}, catMap = {}, trendMap = {}, hourlyMap = {};
  let totalBillCount = 0;
  let totalCoperti = 0;
  let firstReceiptTime = null, lastReceiptTime = null, lastKitchenTime = null, lastBarTime = null, zNumber = null, fiscalCloseTime = null;

  rows.forEach(row => {
    const dateStr = typeof row.date === 'string' ? row.date.substring(0,10) : row.date;

    // Scontrini esatti per giorno
    totalBillCount += row.bill_count || 0;

    // Coperti giornalieri (dal reparto COPERTO)
    let dayCoperti = 0;

    // Aggregazione reparti (somma per nome)
    (row.dept_records || []).forEach(rec => {
      const key = rec.department?.description || DEPT_NAMES[rec.idDepartment] || rec.idDepartment || 'Altro';
      if (!deptMap[key]) deptMap[key] = { description: key, profit: 0, qty: 0 };
      deptMap[key].profit += rec.profit || 0;
      deptMap[key].qty += rec.quantity || 0;
      if (key === 'COPERTO') dayCoperti += rec.quantity || 0;
    });
    totalCoperti += dayCoperti;

    // Aggregazione categorie
    (row.cat_records || []).forEach(rec => {
      const rawName = rec.description || CAT_NAMES[rec.idCategory] || null;
      const name = rawName || (rec.idCategory && rec.idCategory.length > 20 ? 'Altro' : rec.idCategory) || 'Altro';
      if (!catMap[name]) catMap[name] = { description: name, total: 0 };
      catMap[name].total += rec.profit || 0;
    });

    // Aggregazione oraria
    (row.hourly_records || []).forEach(hr => {
      const h = hr.hour;
      if (!hourlyMap[h]) hourlyMap[h] = { ora: String(h).padStart(2,'0')+':00', ricavi: 0, scontrini: 0 };
      hourlyMap[h].ricavi += hr.ricavi || 0;
      hourlyMap[h].scontrini += hr.scontrini || 0;
    });

    // Tempi ultimo scontrino — prendi solo dall'ultimo giorno con dati
    // I rows sono ordinati per data ASC, quindi l'ultimo giorno sovrascrive
    if (row.first_receipt_time) firstReceiptTime = row.first_receipt_time;
    if (row.last_receipt_time) lastReceiptTime = row.last_receipt_time;
    if (row.last_kitchen_time) lastKitchenTime = row.last_kitchen_time;
    if (row.last_bar_time) lastBarTime = row.last_bar_time;
    if (row.z_number) zNumber = row.z_number;
    if (row.fiscal_close_time) fiscalCloseTime = row.fiscal_close_time;

    // Trend giornaliero (con coperti)
    if (!trendMap[dateStr]) trendMap[dateStr] = { date: dateStr, ricavi: 0, coperti: 0 };
    trendMap[dateStr].ricavi += Number(row.revenue) || 0;
    trendMap[dateStr].coperti += dayCoperti;
  });

  const depts = Object.values(deptMap).sort((a,b) => b.profit - a.profit);
  const cats = Object.values(catMap).sort((a,b) => b.total - a.total);
  const prodOre = Object.values(hourlyMap).sort((a,b) => a.ora.localeCompare(b.ora));
  const trend = Object.values(trendMap).sort((a,b) => a.date.localeCompare(b.date))
    .map(t => ({ ...t, label: new Date(t.date + 'T12:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}) }));
  const totale = trend.reduce((s,t) => s + t.ricavi, 0);
  const taxes = totale > 0 ? [{ rate: 10, taxable: Math.round(totale / 1.1), tax_amount: Math.round(totale - totale / 1.1) }] : [];

  return {
    totale,
    scontrini: totalBillCount,
    medio: totalBillCount > 0 ? totale / totalBillCount : 0,
    coperti: totalCoperti,
    copertoMedio: totalCoperti > 0 ? totale / totalCoperti : 0,
    depts, cats, taxes, trend, prodOre,
    receiptDetails: rows.flatMap(r => r.receipt_details || []).sort((a,b) => (a.aperturaComanda||a.ora||'').localeCompare(b.aperturaComanda||b.ora||'')),
    // Costruisci scontriniList dai dati reali (receipt_details per giorno)
    scontriniList: rows.flatMap(r => {
      const dateStr = typeof r.date === 'string' ? r.date.substring(0,10) : r.date;
      const spName = r.salespoint_name || 'LOCALE';
      return (r.receipt_details || []).map((rd, i) => ({
        id: rd.isInvoice ? ('F' + String(rd.invoiceNumber || i+1)) : ('S' + String(i+1).padStart(4,'0')),
        date: dateStr,
        time: rd.aperturaComanda || rd.chiusuraComanda || '—',
        items: (rd.items || []).length,
        total: rd.totale || 0,
        payment: rd.metodoPagamento || rd.payment || '—',
        locale: spName,
        tavolo: rd.tavolo || null,
        coperti: rd.coperti || null,
        chiusura: rd.chiusuraComanda || null,
        isInvoice: !!rd.isInvoice,
        invoiceNumber: rd.invoiceNumber || null,
        // Dettaglio comanda completo per il modal
        cassiere: rd.cassiere || rd.user || null,
        sconto: rd.sconto || null,
        promozioni: rd.promozioni || null,
        itemsList: rd.items || [],
        rawReceipt: rd,
      }));
    }).sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time)),
    // Monitoring events (annulli, sconti, ecc.) dai dati sincronizzati
    monitoringEvents: rows.flatMap(r => {
      const dateStr = typeof r.date === 'string' ? r.date.substring(0,10) : r.date;
      const spName = r.salespoint_name || 'LOCALE';
      return (r.monitoring_events || []).map(ev => ({ ...ev, date: dateStr, locale: spName }));
    }).sort((a,b) => (b.datetime || '').localeCompare(a.datetime || '')),
    firstReceiptTime, lastReceiptTime, lastKitchenTime, lastBarTime, zNumber, fiscalCloseTime,
    isDemo: false
  };
}

// Sync on-demand: chiama /api/sync-cron per riempire daily_stats nel range
// Usato quando il client apre un periodo non ancora sincronizzato dal cron notturno
export async function syncOnDemand(apiKey, from, to) {
  try {
    const url = `/api/sync-cron?apiKey=${encodeURIComponent(apiKey)}&from=${from}&to=${to}`;
    const r = await fetch(url, { method: 'GET' });
    return r.ok ? await r.json() : { error: 'sync failed: ' + r.status };
  } catch (e) {
    return { error: e.message };
  }
}

// Verifica quali giorni sono mancanti in daily_stats per un range/salesPoints
async function findMissingDays(from, to, idsSalesPoint = []) {
  let q = supabase.from('daily_stats').select('date, salespoint_id').gte('date', from).lte('date', to);
  if (idsSalesPoint?.length) q = q.in('salespoint_id', idsSalesPoint);
  const { data: rows } = await q;
  const have = new Set((rows || []).map(r => `${r.salespoint_id}|${typeof r.date === 'string' ? r.date.substring(0,10) : r.date}`));
  const missing = [];
  const start = new Date(from), end = new Date(to);
  const sps = idsSalesPoint?.length ? idsSalesPoint : [null];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().split('T')[0];
    for (const sp of sps) {
      if (sp === null) {
        if (!have.has(`${sp}|${ds}`) && rows.every(r => (typeof r.date === 'string' ? r.date.substring(0,10) : r.date) !== ds)) {
          missing.push(ds); break;
        }
      } else {
        if (!have.has(`${sp}|${ds}`)) missing.push(ds);
      }
    }
  }
  return missing;
}

export async function getReportData(apiKey, { from, to, idsSalesPoint }, salesPoints = []) {
  // Prima prova daily_stats (dati esatti)
  try {
    let daily = await getFromDailyStats(from, to, idsSalesPoint);
    // Se non abbiamo dati o il periodo recente non e' stato sincronizzato, sync on-demand
    const todayStr = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    if (to >= sevenDaysAgo) {
      const missing = await findMissingDays(from, to, idsSalesPoint);
      // Sync solo dei giorni mancanti recenti (ultimi 30gg) per evitare fetch enormi
      const recentMissing = missing.filter(d => d >= new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] && d <= todayStr);
      if (recentMissing.length > 0) {
        const syncFrom = recentMissing[0];
        const syncTo = recentMissing[recentMissing.length - 1];
        await syncOnDemand(apiKey, syncFrom, syncTo);
        // Rilegge dopo il sync
        daily = await getFromDailyStats(from, to, idsSalesPoint);
      }
    }
    if (daily && daily.totale > 0) {
      const demo = generateDemoData(from, to, salesPoints);
      const result = { ...demo, ...daily };
      // ─── CE reale: costi da warehouse_invoices + personnel_costs ───
      try {
        const ricavi = daily.totale;
        // Costi da fatture warehouse (classificate per fornitore/prodotto)
        // Carica mappature apprese
        const { data: mappings } = await supabase.from('category_mappings').select('nome_prodotto, category');
        const learned = {};
        (mappings||[]).forEach(m => { learned[(m.nome_prodotto||'').toLowerCase().trim()] = m.category; });

        // Carica righe fatture nel periodo
        const { data: invItems } = await supabase.from('warehouse_invoice_items')
          .select('nome_fattura, prezzo_totale, warehouse_invoices!inner(fornitore, data)')
          .gte('warehouse_invoices.data', from)
          .lte('warehouse_invoices.data', to);

        let foodCost=0, bevCost=0, matCost=0, strCost=0, altCost=0;
        // Usa stesse regex di CATEGORY_RULES (importate da ContoEconomico)
        const catOrder = ['beverage','materiali','struttura','personale','food'];

        (invItems||[]).forEach(it => {
          const desc = (it.nome_fattura||'').toLowerCase().trim();
          const amt = Number(it.prezzo_totale)||0;
          if (amt === 0) return; // Nota credito (TD04): importo negativo, va sottratto
          // Priorita 1: mappatura appresa
          let cat = learned[desc] || null;
          // Priorita 2: regex su nome prodotto
          if (!cat) {
            for (const k of catOrder) {
              if (CATEGORY_RULES[k]?.prodotti?.test(desc)) { cat = k; break; }
            }
          }
          if (cat==='food') foodCost+=amt;
          else if (cat==='beverage') bevCost+=amt;
          else if (cat==='materiali') matCost+=amt;
          else if (cat==='struttura') strCost+=amt;
          else if (cat!=='personale') altCost+=amt;
        });

        // Personale da personnel_costs
        let persCost = 0;
        try {
          const { data: pcRows } = await supabase.from('personnel_costs').select('costo_totale').gte('mese', from.substring(0,7)+'-01').lte('mese', to.substring(0,7)+'-01');
          persCost = (pcRows||[]).reduce((s,r) => s + Number(r.costo_totale||0), 0);
        } catch(e) {}

        // Costi manuali (affitto, utenze, ecc.) — espande ricorrenze nel periodo
        try {
          const { data: mcRows } = await supabase.from('manual_costs').select('*');
          const { aggregateManualCosts } = await import('./manualCosts.js');
          const mcAgg = aggregateManualCosts(mcRows || [], from, to);
          foodCost += mcAgg.food || 0;
          bevCost  += mcAgg.beverage || 0;
          matCost  += mcAgg.materiali || 0;
          strCost  += mcAgg.struttura || 0;
          persCost += mcAgg.personale || 0;
          altCost  += mcAgg.altro || 0;
        } catch(e) { console.warn('[manual_costs]', e.message); }

        const totCosti = foodCost+bevCost+matCost+persCost+strCost+altCost;
        const mol = ricavi - totCosti;
        result.ce = {
          ricavi, foodCost, bevCost, matCost, persCost, strCost, altCost, totCosti, mol,
          molPct: ricavi > 0 ? mol/ricavi*100 : 0,
          foodPct: ricavi > 0 ? foodCost/ricavi*100 : 0,
          bevPct: ricavi > 0 ? bevCost/ricavi*100 : 0,
          persPct: ricavi > 0 ? persCost/ricavi*100 : 0,
        };
      } catch(e) { console.warn('[CE real]', e.message); }
      return result;
    }
  } catch(e) { console.warn('[daily_stats]', e.message); }

  // Fallback: receipts live CiC (aggregazione completa, niente dati DEMO mescolati)
  try {
    const params = { datetimeFrom: from+'T00:00:00.000', datetimeTo: to+'T23:59:59.999', start:0, limit:500 };
    if (idsSalesPoint?.length) params.idsSalesPoint = JSON.stringify(idsSalesPoint);
    const d = await proxyCall(apiKey, 'receipts', params);
    if (Array.isArray(d.receipts) && d.receipts.length > 0) {
      const receipts = d.receipts;
      const deptMap = {}, catMap = {}, taxMap = {}, trendMap = {}, hourlyMap = {}, prodMap = {};
      let totale = 0;
      receipts.forEach(r => {
        const price = r.totalPrice || 0;
        totale += price;
        const dt = r.datetime || r.createdAt || ''
        const dStr = dt ? dt.substring(0, 10) : ''
        const hr = dt ? parseInt(dt.substring(11, 13)) : -1
        if (dStr) {
          if (!trendMap[dStr]) trendMap[dStr] = { date: dStr, ricavi: 0, scontrini: 0, coperti: 0 }
          trendMap[dStr].ricavi += price
          trendMap[dStr].scontrini += 1
        }
        if (hr >= 0) {
          if (!hourlyMap[hr]) hourlyMap[hr] = { ora: String(hr).padStart(2, '0') + ':00', ricavi: 0, scontrini: 0 }
          hourlyMap[hr].ricavi += price
          hourlyMap[hr].scontrini += 1
        }
        ;(r.items || []).forEach(item => {
          const dept = item.department?.description || 'Altro'
          const cat = item.category?.description || 'Altro'
          const rate = item.tax?.rate ?? 0
          const ip = item.totalPrice || 0
          const qty = item.quantity || 1
          if (!deptMap[dept]) deptMap[dept] = { profit: 0, qty: 0 }
          deptMap[dept].profit += ip; deptMap[dept].qty += qty
          catMap[cat] = (catMap[cat] || 0) + ip
          if (!taxMap[rate]) taxMap[rate] = { taxable: 0, tax_amount: 0 }
          taxMap[rate].taxable += ip / (1 + rate / 100)
          taxMap[rate].tax_amount += ip - ip / (1 + rate / 100)
          const pname = item.description || item.name || 'Sconosciuto'
          if (!prodMap[pname]) prodMap[pname] = { name: pname, qty: 0, revenue: 0 }
          prodMap[pname].qty += qty; prodMap[pname].revenue += ip
        })
      })
      const trend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date))
        .map(t => ({ ...t, label: new Date(t.date + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) }))
      const prodOre = Array.from({ length: 24 }, (_, h) => hourlyMap[h] || { ora: String(h).padStart(2, '0') + ':00', ricavi: 0, scontrini: 0 })
      const topProducts = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 20)
      return {
        totale,
        scontrini: receipts.length,
        medio: receipts.length ? totale / receipts.length : 0,
        depts: Object.entries(deptMap).map(([k, v]) => ({ description: k, ...v })).sort((a, b) => b.profit - a.profit),
        cats: Object.entries(catMap).map(([k, v]) => ({ description: k, total: v })).sort((a, b) => b.total - a.total),
        taxes: Object.entries(taxMap).map(([k, v]) => ({ rate: Number(k), ...v })),
        trend, topProducts, prodOre,
        scontriniList: [], suspicious: [], fatture: [],
        ce: { ricavi: totale, foodCost: 0, bevCost: 0, matCost: 0, persCost: 0, strCost: 0, altCost: 0, totCosti: 0, mol: totale, molPct: 100 },
        isDemo: false, isLive: true,
      }
    }
  } catch (e) { console.warn('[CiC live]', e.message); }

  // Nessun dato disponibile: ritorna struttura vuota (NO DEMO)
  return {
    totale: 0, scontrini: 0, medio: 0, coperti: 0, copertoMedio: 0,
    depts: [], cats: [], taxes: [], trend: [], topProducts: [],
    scontriniList: [], prodOre: [], suspicious: [], fatture: [],
    ce: { ricavi: 0, foodCost: 0, bevCost: 0, matCost: 0, persCost: 0, strCost: 0, altCost: 0, totCosti: 0, mol: 0, molPct: 0 },
    isDemo: false, isEmpty: true,
  }
}

function rand(min,max){return Math.round(min+Math.random()*(max-min))}
export function generateDemoData(from,to,salesPoints=[]){const days=Math.max(1,Math.round((new Date(to)-new Date(from))/86400000)+1);const m=days/30;const depts=[{description:'PIZZERIA',profit:Math.round(22593*m),qty:Math.round(3188*m),color:'#F59E0B'},{description:'BAR',profit:Math.round(14820*m),qty:Math.round(4210*m),color:'#3B82F6'},{description:'CUCINA',profit:Math.round(9340*m),qty:Math.round(1820*m),color:'#10B981'},{description:'DOLCI',profit:Math.round(4210*m),qty:Math.round(980*m),color:'#8B5CF6'},{description:'ANTIPASTI',profit:Math.round(2980*m),qty:Math.round(540*m),color:'#EC4899'},{description:'COPERTO',profit:0,qty:Math.round(1936*m),color:'#94A3B8'}];const cats=[{description:'LE CREAZIONI DI CASA',total:Math.round(15200*m)},{description:'PIZZE SPECIALI',total:Math.round(7393*m)},{description:'VINI',total:Math.round(6820*m)},{description:'BIRRE ARTIGIANALI',total:Math.round(4800*m)},{description:'COCKTAIL',total:Math.round(3200*m)},{description:'SECONDI',total:Math.round(5640*m)},{description:'PRIMI',total:Math.round(3700*m)},{description:'DOLCI',total:Math.round(4210*m)},{description:'ACQUA / SOFT',total:Math.round(2100*m)},{description:'ANTIPASTI',total:Math.round(2980*m)}];const taxes=[{rate:10,taxable:Math.round(49715*m*0.909),tax_amount:Math.round(49715*m*0.091)},{rate:4,taxable:Math.round(2800*m*0.962),tax_amount:Math.round(2800*m*0.038)},{rate:22,taxable:Math.round(2171*m*0.820),tax_amount:Math.round(2171*m*0.180)}];const trend=[];const cur=new Date(from),end=new Date(to);while(cur<=end){const isWe=cur.getDay()===0||cur.getDay()===6;const v=Math.max(0,Math.round((isWe?2400:1500)+(Math.random()-0.5)*600));trend.push({date:cur.toISOString().split('T')[0],label:cur.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}),ricavi:v,scontrini:Math.round(v/22),coperti:Math.round(v/28)});cur.setDate(cur.getDate()+1)}const payments=['Contanti','Carta','Satispay','Carta','Contanti','Carta'];const scontriniList=Array.from({length:Math.min(50,Math.round(100*m))},(_,i)=>{const d=new Date(from);d.setDate(d.getDate()+rand(0,days-1));return{id:'S'+String(i+1).padStart(4,'0'),date:d.toISOString().split('T')[0],time:String(rand(11,23)).padStart(2,'0')+':'+String(rand(0,59)).padStart(2,'0'),items:rand(1,8),total:Math.round((8+Math.random()*87)*100)/100,payment:payments[rand(0,5)],locale:salesPoints[rand(0,Math.max(0,salesPoints.length-1))]?.description||'REMEMBEER'}}).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));const prodOre=Array.from({length:16},(_,i)=>{const h=i+8,peak=(h>=12&&h<=14)||(h>=19&&h<=22);const v=Math.max(0,Math.round((peak?2800:400)*(0.7+Math.random()*0.6)));return{ora:String(h).padStart(2,'0')+':00',ricavi:v,scontrini:Math.round(v/22)}});const suppliers=['DAVIDE MEINI','LA NOBILE BEVERAGE','DISTRIBUZIONE METRO','FORNITORE VINI SRL','ALHENA SERVIZI'];const fatture=Array.from({length:Math.min(30,Math.round(40*m))},(_,i)=>{const d=new Date(from);d.setDate(d.getDate()+rand(0,days-1));return{id:i+1,date:d.toISOString().split('T')[0],fornitore:suppliers[rand(0,4)],numero:'FT'+rand(100,999),tipo:'TD01',locale:salesPoints[rand(0,Math.max(0,salesPoints.length-1))]?.description||'REMEMBEER',imponibile:Math.round((120+Math.random()*3080)*100)/100,iva:Math.round((12+Math.random()*628)*100)/100,statoSDI:Math.random()>.3?'✅ Consegnata':'⏳ In attesa',statoContabile:Math.random()>.4?'✅ Registrata':'📋 Da registrare'}}).sort((a,b)=>b.date.localeCompare(a.date));const suspicious=[{type:'Annullo',icon:'⚠️',desc:'Scontrino annullato dopo emissione',amount:-45.50,date:from,user:'Operatore 1',severity:'high'},{type:'Sconto elevato',icon:'🔶',desc:'Sconto >30% applicato manualmente',amount:-18.00,date:from,user:'Admin',severity:'medium'},{type:'Annullo',icon:'⚠️',desc:'Scontrino annullato dopo emissione',amount:-32.00,date:from,user:'Operatore 2',severity:'high'}];const totale=depts.reduce((s,d)=>s+d.profit,0);const foodCost=Math.round(totale*0.195),bevCost=Math.round(totale*0.148);const matCost=Math.round(totale*0.018),strCost=Math.round(totale*0.025);const totCosti=foodCost+bevCost+matCost+strCost;const mol=totale-totCosti;const topProducts=[{name:'Margherita',qty:Math.round(520*m),revenue:Math.round(5720*m)},{name:'Diavola',qty:Math.round(380*m),revenue:Math.round(4940*m)},{name:'Acqua 0.75L',qty:Math.round(890*m),revenue:Math.round(2670*m)},{name:'Birra 0.4L',qty:Math.round(620*m),revenue:Math.round(3720*m)},{name:'Quattro Stagioni',qty:Math.round(290*m),revenue:Math.round(3480*m)},{name:'Vino casa 0.5L',qty:Math.round(340*m),revenue:Math.round(3060*m)},{name:'Tiramisù',qty:Math.round(280*m),revenue:Math.round(1960*m)},{name:'Capricciosa',qty:Math.round(210*m),revenue:Math.round(2730*m)}];const scontrini=Math.round(totale/22);const coperti=Math.round(1936*m);return{totale,scontrini,medio:scontrini>0?totale/scontrini:0,coperti,copertoMedio:coperti>0?totale/coperti:0,depts,cats,taxes,trend,topProducts,scontriniList,prodOre,suspicious,fatture,ce:{ricavi:totale,foodCost,bevCost,matCost,persCost:0,strCost,altCost:0,totCosti,mol,molPct:totale>0?mol/totale*100:0,foodPct:totale>0?foodCost/totale*100:0,bevPct:totale>0?bevCost/totale*100:0,persPct:0},isDemo:true}}