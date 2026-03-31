const CIC_BASE = 'https://api.cassanova.com'

export async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  })
  if (!res.ok) throw new Error('API Key non valida')
  return (await res.json()).access_token
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path)
  Object.entries(params).forEach(([k,v]) => { if (v!=null) url.searchParams.set(k, typeof v==='object'?JSON.stringify(v):v) })
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json', 'X-Version': '1.0.0' }
  })
  if (!res.ok) throw new Error('CIC API '+res.status+': '+path)
  return res.json()
}

export async function getSalesPoints(token) {
  const d = await cicGet(token, '/salespoint', { hasActiveLicense: true })
  return Array.isArray(d.salesPoint) ? d.salesPoint : Array.isArray(d) ? d : []
}

// Genera dati demo realistici per il periodo selezionato
function generateDemoData(from, to, salesPoints) {
  const fromDate = new Date(from), toDate = new Date(to)
  const days = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1)
  const multiplier = days / 30

  const depts = [
    { description:'PIZZERIA',   profit: Math.round(22593*multiplier), qty: Math.round(3188*multiplier), color:'#F59E0B' },
    { description:'BEVANDE',    profit: Math.round(14820*multiplier), qty: Math.round(4210*multiplier), color:'#3B82F6' },
    { description:'CUCINA',     profit: Math.round(9340*multiplier),  qty: Math.round(1820*multiplier), color:'#10B981' },
    { description:'DOLCI',      profit: Math.round(4210*multiplier),  qty: Math.round(980*multiplier),  color:'#8B5CF6' },
    { description:'ANTIPASTI',  profit: Math.round(2980*multiplier),  qty: Math.round(540*multiplier),  color:'#EC4899' },
    { description:'COPERTO',    profit: 0,                            qty: Math.round(1936*multiplier), color:'#94A3B8' },
  ]

  const cats = [
    { description:'Pizza classica', total: Math.round(15200*multiplier) },
    { description:'Pizza speciale', total: Math.round(7393*multiplier)  },
    { description:'Vino',           total: Math.round(6820*multiplier)  },
    { description:'Birra',          total: Math.round(4800*multiplier)  },
    { description:'Acqua/Soft',     total: Math.round(3200*multiplier)  },
    { description:'Secondi',        total: Math.round(5640*multiplier)  },
    { description:'Primi',          total: Math.round(3700*multiplier)  },
    { description:'Dolci',          total: Math.round(4210*multiplier)  },
  ]

  const taxes = [
    { rate: 10, taxable: Math.round(49715*multiplier*0.909), tax_amount: Math.round(49715*multiplier*0.091) },
    { rate: 4,  taxable: Math.round(2800*multiplier*0.962),  tax_amount: Math.round(2800*multiplier*0.038)  },
    { rate: 22, taxable: Math.round(2171*multiplier*0.820),  tax_amount: Math.round(2171*multiplier*0.180)  },
  ]

  // Andamento giornaliero
  const trend = []
  const cur = new Date(fromDate)
  while (cur <= toDate) {
    const dow = cur.getDay()
    const isWeekend = dow===0||dow===6
    const base = isWeekend ? 2400 : 1500
    const jitter = (Math.random()-0.5)*600
    trend.push({
      date: cur.toISOString().split('T')[0],
      label: cur.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}),
      ricavi: Math.max(0, Math.round(base+jitter)),
      scontrini: Math.round((base+jitter)/22)
    })
    cur.setDate(cur.getDate()+1)
  }

  const totale = depts.reduce((s,d)=>s+d.profit, 0)
  const scontrini = Math.round(totale/22)

  // Top prodotti
  const topProducts = [
    { name:'Margherita',      qty: Math.round(520*multiplier), revenue: Math.round(5720*multiplier)  },
    { name:'Diavola',         qty: Math.round(380*multiplier), revenue: Math.round(4940*multiplier)  },
    { name:'Acqua 0.75L',     qty: Math.round(890*multiplier), revenue: Math.round(2670*multiplier)  },
    { name:'Birra 0.4L',      qty: Math.round(620*multiplier), revenue: Math.round(3720*multiplier)  },
    { name:'Quattro Stagioni',qty: Math.round(290*multiplier), revenue: Math.round(3480*multiplier)  },
    { name:'Vino casa 0.5L',  qty: Math.round(340*multiplier), revenue: Math.round(3060*multiplier)  },
    { name:'Tiramisù',        qty: Math.round(280*multiplier), revenue: Math.round(1960*multiplier)  },
    { name:'Capricciosa',     qty: Math.round(210*multiplier), revenue: Math.round(2730*multiplier)  },
  ]

  return { totale, scontrini, medio: scontrini>0?totale/scontrini:0, depts, cats, taxes, trend, topProducts, isDemo: true }
}

export async function getReportData(token, { from, to, idsSalesPoint }, salesPoints=[]) {
  // Prova receipts — se CiC lo abilita, usa dati reali; altrimenti demo
  try {
    const params = { datetimeFrom: from+'T00:00:00.000', datetimeTo: to+'T23:59:59.999', start:0, limit:100 }
    if (idsSalesPoint?.length) params.idsSalesPoint = JSON.stringify(idsSalesPoint)
    const d = await cicGet(token, '/documents/receipts', params)
    if (Array.isArray(d.receipts) && d.receipts.length > 0) {
      // Dati reali disponibili — calcola aggregazioni
      const receipts = d.receipts
      const deptMap={}, catMap={}, taxMap={}
      let totale=0
      receipts.forEach(r => {
        totale += r.totalPrice||0
        ;(r.items||[]).forEach(item => {
          const dept = item.department?.description||'Altro'
          const cat  = item.category?.description||'Altro'
          const rate = item.tax?.rate??0
          const price = (item.totalPrice||0)
          deptMap[dept] = (deptMap[dept]||{profit:0,qty:0})
          deptMap[dept].profit += price; deptMap[dept].qty += item.quantity||1
          catMap[cat] = (catMap[cat]||0) + price
          taxMap[rate] = (taxMap[rate]||{taxable:0,tax_amount:0})
          taxMap[rate].taxable += price/(1+rate/100)
          taxMap[rate].tax_amount += price - price/(1+rate/100)
        })
      })
      return {
        totale, scontrini: receipts.length, medio: receipts.length?totale/receipts.length:0,
        depts: Object.entries(deptMap).map(([k,v])=>({description:k,...v})).sort((a,b)=>b.profit-a.profit),
        cats: Object.entries(catMap).map(([k,v])=>({description:k,total:v})).sort((a,b)=>b.total-a.total),
        taxes: Object.entries(taxMap).map(([k,v])=>({rate:Number(k),...v})),
        topProducts: [], trend: [], isDemo: false
      }
    }
  } catch(e) { /* API non disponibile, uso demo */ }
  return generateDemoData(from, to, salesPoints)
}
