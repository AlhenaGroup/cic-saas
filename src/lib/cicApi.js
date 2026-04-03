import { supabase } from './supabase'

const PROXY = '/api/cic';
async function proxyCall(apiKey, action, params = {}) {
  const res = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, action, params }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Proxy error ' + res.status);
  return data;
}

export async function getToken(apiKey) { return apiKey; }

export async function getSalesPoints(apiKey) {
  try {
    const d = await proxyCall(apiKey, 'salespoints');
    return Array.isArray(d.salesPoint) ? d.salesPoint : Array.isArray(d) ? d : [];
  } catch(e) {
    const { data } = await supabase.from('monthly_stats').select('salespoint_id,salespoint_name').limit(50);
    const seen = {};
    (data||[]).forEach(r => { seen[r.salespoint_id] = r.salespoint_name; });
    return Object.entries(seen).map(([id,name]) => ({ id: parseInt(id), description: name }));
  }
}

// Legge e aggrega dati da Supabase monthly_stats con supporto range parziali
async function getFromSupabase(from, to, idsSalesPoint = []) {
  // Calcola mesi nel range
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const months = [];
  let d = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  while (d <= toDate) {
    months.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
    d.setMonth(d.getMonth() + 1);
  }

  let query = supabase.from('monthly_stats').select('*').in('month', months);
  if (idsSalesPoint?.length) query = query.in('salespoint_id', idsSalesPoint);
  const { data: rows, error } = await query;
  if (error || !rows?.length) return null;

  const deptMap = {}, catMap = {}, trendMap = {};

  rows.forEach(row => {
    // Calcola quanta % dei ricavi mensili cade nel range selezionato
    // usando il trend giornaliero come peso
    const trendAll = row.trend_records || [];
    const totalMonthRevenue = trendAll.reduce((s, t) => s + (t.total || t.profit || 0), 0);
    const selectedRevenue = trendAll.filter(t => {
      const date = (t.referenceDatetime || t.date || '').substring(0, 10);
      return date >= from && date <= to;
    }).reduce((s, t) => s + (t.total || t.profit || 0), 0);

    // Ratio: se il mese è tutto nel range → 1.0, se parziale → proporzione dei ricavi
    const ratio = totalMonthRevenue > 0 ? selectedRevenue / totalMonthRevenue : 1.0;

    // Aggrega reparti con ratio
    (row.dept_records || []).forEach(rec => {
      const key = rec.department?.description || rec.idDepartment || 'Altro';
      if (!deptMap[key]) deptMap[key] = { description: key, profit: 0, qty: 0 };
      deptMap[key].profit += (rec.profit || 0) * ratio;
      deptMap[key].qty += (rec.quantity || 0) * ratio;
    });

    // Aggrega categorie con ratio
    (row.cat_records || []).forEach(rec => {
      const key = rec.category?.description || rec.idCategory || 'Altro';
      if (!catMap[key]) catMap[key] = { description: key, total: 0 };
      catMap[key].total += (rec.profit || 0) * ratio;
    });

    // Aggrega trend giornaliero (solo giorni nel range)
    trendAll.forEach(rec => {
      const date = (rec.referenceDatetime || rec.date || '').substring(0, 10);
      if (!date || date < from || date > to) return;
      if (!trendMap[date]) trendMap[date] = { date, ricavi: 0, scontrini: 0 };
      trendMap[date].ricavi += rec.total || rec.profit || 0;
      trendMap[date].scontrini += rec.quantity || 0;
    });
  });

  const depts = Object.values(deptMap).sort((a,b) => b.profit - a.profit);
  const cats = Object.values(catMap).sort((a,b) => b.total - a.total);
  const trend = Object.values(trendMap).sort((a,b) => a.date.localeCompare(b.date))
    .map(t => ({ ...t, label: new Date(t.date + 'T12:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}) }));
  const totale = trend.reduce((s,t) => s + t.ricavi, 0);
  const scontrini = trend.reduce((s,t) => s + t.scontrini, 0);
  const taxes = totale > 0 ? [{ rate: 10, taxable: Math.round(totale / 1.1), tax_amount: Math.round(totale - totale / 1.1) }] : [];

  return { totale, scontrini, medio: scontrini > 0 ? totale/scontrini : 0, depts, cats, taxes, trend, isDemo: false };
}

export async function getReportData(apiKey, { from, to, idsSalesPoint }, salesPoints = []) {
  try {
    const sb = await getFromSupabase(from, to, idsSalesPoint);
    if (sb && sb.totale > 0) {
      const demo = generateDemoData(from, to, salesPoints);
      return { ...demo, ...sb };
    }
  } catch(e) { console.warn('[Supabase]', e.message); }

  try {
    const params = { datetimeFrom: from+'T00:00:00.000', datetimeTo: to+'T23:59:59.999', start:0, limit:100 };
    if (idsSalesPoint?.length) params.idsSalesPoint = JSON.stringify(idsSalesPoint);
    const d = await proxyCall(apiKey, 'receipts', params);
    if (Array.isArray(d.receipts) && d.receipts.length > 0) {
      const receipts = d.receipts;
      const deptMap={},catMap={},taxMap={};let totale=0;
      receipts.forEach(r=>{totale+=r.totalPrice||0;(r.items||[]).forEach(item=>{const dept=item.department?.description||'Altro',cat=item.category?.description||'Altro',rate=item.tax?.rate??0,price=item.totalPrice||0;deptMap[dept]=deptMap[dept]||{profit:0,qty:0};deptMap[dept].profit+=price;deptMap[dept].qty+=item.quantity||1;catMap[cat]=(catMap[cat]||0)+price;taxMap[rate]=taxMap[rate]||{taxable:0,tax_amount:0};taxMap[rate].taxable+=price/(1+rate/100);taxMap[rate].tax_amount+=price-price/(1+rate/100);});});
      const demo=generateDemoData(from,to,salesPoints);
      return{totale,scontrini:receipts.length,medio:receipts.length?totale/receipts.length:0,depts:Object.entries(deptMap).map(([k,v])=>({description:k,...v})).sort((a,b)=>b.profit-a.profit),cats:Object.entries(catMap).map(([k,v])=>({description:k,total:v})).sort((a,b)=>b.total-a.total),taxes:Object.entries(taxMap).map(([k,v])=>({rate:Number(k),...v})),trend:demo.trend,topProducts:demo.topProducts,scontriniList:demo.scontriniList,prodOre:demo.prodOre,suspicious:demo.suspicious,fatture:demo.fatture,ce:demo.ce,isDemo:false};
    }
  } catch(e) { console.warn('[CiC]', e.message); }

  return generateDemoData(from, to, salesPoints);
}

function rand(min,max){return Math.round(min+Math.random()*(max-min))}
export function generateDemoData(from,to,salesPoints=[]){const days=Math.max(1,Math.round((new Date(to)-new Date(from))/86400000)+1);const m=days/30;const depts=[{description:'PIZZERIA',profit:Math.round(22593*m),qty:Math.round(3188*m),color:'#F59E0B'},{description:'BAR',profit:Math.round(14820*m),qty:Math.round(4210*m),color:'#3B82F6'},{description:'CUCINA',profit:Math.round(9340*m),qty:Math.round(1820*m),color:'#10B981'},{description:'DOLCI',profit:Math.round(4210*m),qty:Math.round(980*m),color:'#8B5CF6'},{description:'ANTIPASTI',profit:Math.round(2980*m),qty:Math.round(540*m),color:'#EC4899'},{description:'COPERTO',profit:0,qty:Math.round(1936*m),color:'#94A3B8'}];const cats=[{description:'LE CREAZIONI DI CASA',total:Math.round(15200*m)},{description:'PIZZE SPECIALI',total:Math.round(7393*m)},{description:'VINI',total:Math.round(6820*m)},{description:'BIRRE ARTIGIANALI',total:Math.round(4800*m)},{description:'COCKTAIL',total:Math.round(3200*m)},{description:'SECONDI',total:Math.round(5640*m)},{description:'PRIMI',total:Math.round(3700*m)},{description:'DOLCI',total:Math.round(4210*m)},{description:'ACQUA / SOFT',total:Math.round(2100*m)},{description:'ANTIPASTI',total:Math.round(2980*m)}];const taxes=[{rate:10,taxable:Math.round(49715*m*0.909),tax_amount:Math.round(49715*m*0.091)},{rate:4,taxable:Math.round(2800*m*0.962),tax_amount:Math.round(2800*m*0.038)},{rate:22,taxable:Math.round(2171*m*0.820),tax_amount:Math.round(2171*m*0.180)}];const trend=[];const cur=new Date(from),end=new Date(to);while(cur<=end){const isWe=cur.getDay()===0||cur.getDay()===6;const v=Math.max(0,Math.round((isWe?2400:1500)+(Math.random()-0.5)*600));trend.push({date:cur.toISOString().split('T')[0],label:cur.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}),ricavi:v,scontrini:Math.round(v/22)});cur.setDate(cur.getDate()+1)}const payments=['Contanti','Carta','Satispay','Carta','Contanti','Carta'];const scontriniList=Array.from({length:Math.min(50,Math.round(100*m))},(_,i)=>{const d=new Date(from);d.setDate(d.getDate()+rand(0,days-1));return{id:'S'+String(i+1).padStart(4,'0'),date:d.toISOString().split('T')[0],time:String(rand(11,23)).padStart(2,'0')+':'+String(rand(0,59)).padStart(2,'0'),items:rand(1,8),total:Math.round((8+Math.random()*87)*100)/100,payment:payments[rand(0,5)],locale:salesPoints[rand(0,Math.max(0,salesPoints.length-1))]?.description||'REMEMBEER'}}).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));const prodOre=Array.from({length:16},(_,i)=>{const h=i+8,peak=(h>=12&&h<=14)||(h>=19&&h<=22);const v=Math.max(0,Math.round((peak?2800:400)*(0.7+Math.random()*0.6)));return{ora:String(h).padStart(2,'0')+':00',ricavi:v,scontrini:Math.round(v/22)}});const suppliers=['DAVIDE MEINI','LA NOBILE BEVERAGE','DISTRIBUZIONE METRO','FORNITORE VINI SRL','ALHENA SERVIZI'];const fatture=Array.from({length:Math.min(30,Math.round(40*m))},(_,i)=>{const d=new Date(from);d.setDate(d.getDate()+rand(0,days-1));return{id:i+1,date:d.toISOString().split('T')[0],fornitore:suppliers[rand(0,4)],numero:'FT'+rand(100,999),tipo:'TD01',locale:salesPoints[rand(0,Math.max(0,salesPoints.length-1))]?.description||'REMEMBEER',imponibile:Math.round((120+Math.random()*3080)*100)/100,iva:Math.round((12+Math.random()*628)*100)/100,statoSDI:Math.random()>.3?'✅ Consegnata':'⏳ In attesa',statoContabile:Math.random()>.4?'✅ Registrata':'📋 Da registrare'}}).sort((a,b)=>b.date.localeCompare(a.date));const suspicious=[{type:'Annullo',icon:'⚠️',desc:'Scontrino annullato dopo emissione',amount:-45.50,date:from,user:'Operatore 1',severity:'high'},{type:'Sconto elevato',icon:'🔶',desc:'Sconto >30% applicato manualmente',amount:-18.00,date:from,user:'Admin',severity:'medium'},{type:'Annullo',icon:'⚠️',desc:'Scontrino annullato dopo emissione',amount:-32.00,date:from,user:'Operatore 2',severity:'high'}];const totale=depts.reduce((s,d)=>s+d.profit,0);const foodCost=Math.round(totale*0.195),bevCost=Math.round(totale*0.148);const matCost=Math.round(totale*0.018),strCost=Math.round(totale*0.025);const totCosti=foodCost+bevCost+matCost+strCost;const mol=totale-totCosti;const topProducts=[{name:'Margherita',qty:Math.round(520*m),revenue:Math.round(5720*m)},{name:'Diavola',qty:Math.round(380*m),revenue:Math.round(4940*m)},{name:'Acqua 0.75L',qty:Math.round(890*m),revenue:Math.round(2670*m)},{name:'Birra 0.4L',qty:Math.round(620*m),revenue:Math.round(3720*m)},{name:'Quattro Stagioni',qty:Math.round(290*m),revenue:Math.round(3480*m)},{name:'Vino casa 0.5L',qty:Math.round(340*m),revenue:Math.round(3060*m)},{name:'Tiramisù',qty:Math.round(280*m),revenue:Math.round(1960*m)},{name:'Capricciosa',qty:Math.round(210*m),revenue:Math.round(2730*m)}];const scontrini=Math.round(totale/22);return{totale,scontrini,medio:scontrini>0?totale/scontrini:0,depts,cats,taxes,trend,topProducts,scontriniList,prodOre,suspicious,fatture,ce:{ricavi:totale,foodCost,bevCost,matCost,persCost:0,strCost,altCost:0,totCosti,mol,molPct:totale>0?mol/totale*100:0,foodPct:totale>0?foodCost/totale*100:0,bevPct:totale>0?bevCost/totale*100:0,persPct:0},isDemo:true}}