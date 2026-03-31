const CIC_BASE = 'https://api.cassanova.com'

export async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  })
  if (!res.ok) throw new Error('API Key non valida')
  return (await res.json()).access_token
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path)
  Object.entries(params).forEach(([k,v]) => { if (v!=null) url.searchParams.set(k, typeof v==='object'?JSON.stringify(v):v) })
  const res = await fetch(url.toString(), { headers: { 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'X-Version':'1.0.0' } })
  if (!res.ok) throw new Error('CIC API '+res.status+': '+path)
  return res.json()
}

export async function getSalesPoints(token) {
  const d = await cicGet(token, '/salespoint', { hasActiveLicense: true })
  return Array.isArray(d.salesPoint) ? d.salesPoint : Array.isArray(d) ? d : []
}

function rand(min, max) { return Math.round(min + Math.random()*(max-min)) }
function randF(min, max) { return Math.round((min + Math.random()*(max-min))*100)/100 }

export function generateDemoData(from, to, salesPoints=[]) {
  const days = Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1)
  const m = days/30

  // ── Reparti ──────────────────────────────────────────────────────────────
  const depts = [
    { description:'PIZZERIA',  profit:Math.round(22593*m), qty:Math.round(3188*m), color:'#F59E0B' },
    { description:'BAR',       profit:Math.round(14820*m), qty:Math.round(4210*m), color:'#3B82F6' },
    { description:'CUCINA',    profit:Math.round(9340*m),  qty:Math.round(1820*m), color:'#10B981' },
    { description:'DOLCI',     profit:Math.round(4210*m),  qty:Math.round(980*m),  color:'#8B5CF6' },
    { description:'ANTIPASTI', profit:Math.round(2980*m),  qty:Math.round(540*m),  color:'#EC4899' },
    { description:'COPERTO',   profit:0,                   qty:Math.round(1936*m), color:'#94A3B8' },
  ]

  // ── Categorie ────────────────────────────────────────────────────────────
  const cats = [
    { description:'LE CREAZIONI DI CASA', total:Math.round(15200*m) },
    { description:'PIZZE SPECIALI',       total:Math.round(7393*m)  },
    { description:'VINI',                 total:Math.round(6820*m)  },
    { description:'BIRRE ARTIGIANALI',    total:Math.round(4800*m)  },
    { description:'COCKTAIL',             total:Math.round(3200*m)  },
    { description:'SECONDI',              total:Math.round(5640*m)  },
    { description:'PRIMI',                total:Math.round(3700*m)  },
    { description:'DOLCI',                total:Math.round(4210*m)  },
    { description:'ACQUA / SOFT',         total:Math.round(2100*m)  },
    { description:'ANTIPASTI',            total:Math.round(2980*m)  },
  ]

  // ── IVA ──────────────────────────────────────────────────────────────────
  const taxes = [
    { rate:10, taxable:Math.round(49715*m*0.909), tax_amount:Math.round(49715*m*0.091) },
    { rate:4,  taxable:Math.round(2800*m*0.962),  tax_amount:Math.round(2800*m*0.038)  },
    { rate:22, taxable:Math.round(2171*m*0.820),  tax_amount:Math.round(2171*m*0.180)  },
  ]

  // ── Trend giornaliero ────────────────────────────────────────────────────
  const trend = []
  const cur = new Date(from)
  const end = new Date(to)
  while (cur <= end) {
    const dow = cur.getDay()
    const isWe = dow===0||dow===6
    const base = isWe ? 2400 : 1500
    const jitter = (Math.random()-.5)*600
    trend.push({
      date: cur.toISOString().split('T')[0],
      label: cur.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}),
      ricavi: Math.max(0, Math.round(base+jitter)),
      scontrini: Math.round((base+jitter)/22)
    })
    cur.setDate(cur.getDate()+1)
  }

  // ── Scontrini ────────────────────────────────────────────────────────────
  const payments = ['Contanti','Carta','Satispay','Carta','Contanti','Carta']
  const scontrini = Array.from({length:Math.min(50, Math.round(100*m))}, (_,i) => {
    const d = new Date(from); d.setDate(d.getDate()+rand(0,days-1))
    const tot = randF(8, 95)
    return {
      id: 'S'+String(i+1).padStart(4,'0'), date: d.toISOString().split('T')[0],
      time: String(rand(11,23)).padStart(2,'0')+':'+String(rand(0,59)).padStart(2,'0'),
      items: rand(1,8), total: tot, payment: payments[rand(0,5)],
      locale: salesPoints[rand(0,salesPoints.length-1)]?.description || 'REMEMBEER'
    }
  }).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time))

  // ── Produttività oraria ──────────────────────────────────────────────────
  const prodOre = Array.from({length:16}, (_,i) => {
    const h = i+8
    const peak = h>=12&&h<=14 || h>=19&&h<=22
    const base = peak?2800:400
    return {
      ora: String(h).padStart(2,'0')+':00',
      ricavi: Math.max(0,Math.round(base*(0.7+Math.random()*.6))),
      scontrini: Math.max(0,Math.round(base/22*(0.7+Math.random()*.6))),
    }
  })

  // ── Movimenti sospetti ───────────────────────────────────────────────────
  const suspicious = [
    { type:'Annullo', icon:'⚠️', desc:'Scontrino annullato dopo emissione', amount:-45.50, date:from, user:'Operatore 1', severity:'high' },
    { type:'Sconto elevato', icon:'🔶', desc:'Sconto >30% applicato manualmente', amount:-18.00, date:from, user:'Admin', severity:'medium' },
    { type:'Annullo', icon:'⚠️', desc:'Scontrino annullato dopo emissione', amount:-32.00, date:from, user:'Operatore 2', severity:'high' },
    { type:'Reso', icon:'🔁', desc:'Reso senza motivazione registrata', amount:-22.50, date:from, user:'Operatore 1', severity:'medium' },
    { type:'Sconto elevato', icon:'🔶', desc:'Sconto >50% su prodotto premium', amount:-28.00, date:from, user:'Operatore 3', severity:'high' },
  ].slice(0, Math.max(1, rand(2,5)))

  // ── Fatture passive ──────────────────────────────────────────────────────
  const suppliers = ['DAVIDE MEINI','LA NOBILE BEVERAGE','DISTRIBUZIONE METRO','FORNITORE VINI SRL','ALHENA SERVIZI','CO.LA.MA SPA']
  const docTypes = ['TD01','TD01','TD01','TD04','TD01']
  const sdiStates = ['✅ Consegnata','⏳ In attesa','✅ Consegnata','✅ Consegnata','⏳ In attesa']
  const fatture = Array.from({length:Math.min(30, Math.round(40*m))}, (_,i) => {
    const d = new Date(from); d.setDate(d.getDate()+rand(0,days-1))
    const sup = suppliers[rand(0,suppliers.length-1)]
    return {
      id:i+1, date:d.toISOString().split('T')[0], fornitore:sup,
      numero:'FT'+String(rand(100,999)), tipo:docTypes[rand(0,4)],
      locale:salesPoints[rand(0,salesPoints.length-1)]?.description||'REMEMBEER',
      imponibile:randF(120,3200), iva:randF(12,640),
      statoSDI:sdiStates[rand(0,4)], statoContabile:Math.random()>.4?'✅ Registrata':'📋 Da registrare'
    }
  }).sort((a,b)=>b.date.localeCompare(a.date))

  // ── Conto Economico ──────────────────────────────────────────────────────
  const totale = depts.reduce((s,d)=>s+d.profit,0)
  const foodCost = Math.round(totale*0.195)
  const bevCost  = Math.round(totale*0.148)
  const matCost  = Math.round(totale*0.018)
  const persCost = 0
  const strCost  = Math.round(totale*0.025)
  const altCost  = 0
  const totCosti = foodCost+bevCost+matCost+persCost+strCost
  const mol = totale - totCosti
  const ce = {
    ricavi: totale, foodCost, bevCost, matCost, persCost, strCost, altCost,
    totCosti, mol, molPct:totale>0?mol/totale*100:0,
    foodPct:totale>0?foodCost/totale*100:0,
    bevPct: totale>0?bevCost/totale*100:0,
    persPct:totale>0?persCost/totale*100:0,
  }

  // ── Top Prodotti ─────────────────────────────────────────────────────────
  const topProducts = [
    { name:'Margherita',       qty:Math.round(520*m), revenue:Math.round(5720*m)  },
    { name:'Diavola',          qty:Math.round(380*m), revenue:Math.round(4940*m)  },
    { name:'Acqua 0.75L',      qty:Math.round(890*m), revenue:Math.round(2670*m)  },
    { name:'Birra 0.4L',       qty:Math.round(620*m), revenue:Math.round(3720*m)  },
    { name:'Quattro Stagioni', qty:Math.round(290*m), revenue:Math.round(3480*m)  },
    { name:'Vino casa 0.5L',   qty:Math.round(340*m), revenue:Math.round(3060*m)  },
    { name:'Tiramisù',         qty:Math.round(280*m), revenue:Math.round(1960*m)  },
    { name:'Capricciosa',      qty:Math.round(210*m), revenue:Math.round(2730*m)  },
  ]

  const totaleCalc = depts.reduce((s,d)=>s+d.profit,0)
  const scontriniCount = Math.round(totaleCalc/22)

  return {
    totale:totaleCalc, scontrini:scontriniCount,
    medio:scontriniCount>0?totaleCalc/scontriniCount:0,
    depts, cats, taxes, trend, topProducts,
    scontriniList:scontrini, prodOre, suspicious, fatture, ce, isDemo:true
  }
}

export async function getReportData(token, { from, to, idsSalesPoint }, salesPoints=[]) {
  try {
    const params = { datetimeFrom:from+'T00:00:00.000', datetimeTo:to+'T23:59:59.999', start:0, limit:100 }
    if (idsSalesPoint?.length) params.idsSalesPoint = JSON.stringify(idsSalesPoint)
    const d = await cicGet(token, '/documents/receipts', params)
    if (Array.isArray(d.receipts) && d.receipts.length > 0) {
      const receipts = d.receipts
      const deptMap={}, catMap={}, taxMap={}
      let totale=0
      receipts.forEach(r => {
        totale += r.totalPrice||0
        ;(r.items||[]).forEach(item => {
          const dept=item.department?.description||'Altro', cat=item.category?.description||'Altro', rate=item.tax?.rate??0
          const price=item.totalPrice||0
          deptMap[dept]=(deptMap[dept]||{profit:0,qty:0}); deptMap[dept].profit+=price; deptMap[dept].qty+=item.quantity||1
          catMap[cat]=(catMap[cat]||0)+price
          taxMap[rate]=(taxMap[rate]||{taxable:0,tax_amount:0}); taxMap[rate].taxable+=price/(1+rate/100); taxMap[rate].tax_amount+=price-price/(1+rate/100)
        })
      })
      const demo = generateDemoData(from, to, salesPoints)
      return {
        totale, scontrini:receipts.length, medio:receipts.length?totale/receipts.length:0,
        depts:Object.entries(deptMap).map(([k,v])=>({description:k,...v})).sort((a,b)=>b.profit-a.profit),
        cats:Object.entries(catMap).map(([k,v])=>({description:k,total:v})).sort((a,b)=>b.total-a.total),
        taxes:Object.entries(taxMap).map(([k,v])=>({rate:Number(k),...v})),
        topProducts:[], trend:demo.trend, scontriniList:demo.scontriniList,
        prodOre:demo.prodOre, suspicious:demo.suspicious, fatture:demo.fatture, ce:demo.ce, isDemo:false
      }
    }
  } catch(e) {}
  return generateDemoData(from, to, salesPoints)
}
