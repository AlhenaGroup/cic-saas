const CIC_BASE = 'https://api.cassanova.com'

export async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  })
  if (!res.ok) throw new Error('API Key non valida — verifica che sia attiva')
  return (await res.json()).access_token
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path)
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v)
  })
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Version': '1.0.0' }
  })
  if (!res.ok) throw new Error('CIC API ' + res.status + ': ' + path)
  return res.json()
}

export async function getSalesPoints(token) {
  const d = await cicGet(token, '/salespoint', { hasActiveLicense: true })
  return Array.isArray(d.salesPoint) ? d.salesPoint : Array.isArray(d) ? d : []
}

// Recupera tutti gli scontrini del periodo e calcola aggregazioni
async function getAllReceipts(token, { from, to, idsSalesPoint }) {
  const params = {
    datetimeFrom: from + 'T00:00:00.000',
    datetimeTo:   to   + 'T23:59:59.999',
    start: 0, limit: 100
  }
  if (idsSalesPoint?.length) params.idsSalesPoint = JSON.stringify(idsSalesPoint)

  let all = [], page = 0
  while (true) {
    params.start = page * 100
    const d = await cicGet(token, '/documents/receipts', params)
    const recs = d.receipts || []
    all = all.concat(recs)
    if (recs.length < 100 || all.length >= (d.totalCount || 0)) break
    page++
    if (page > 9) break // max 1000 scontrini per sicurezza
  }
  return all
}

export async function getReportData(token, { from, to, idsSalesPoint }) {
  const receipts = await getAllReceipts(token, { from, to, idsSalesPoint })
  
  const deptMap = {}, catMap = {}, taxMap = {}
  let totale = 0, scontrini = receipts.length

  receipts.forEach(r => {
    const amount = r.totalPrice || r.price || 0
    totale += amount
    
    // Aggregazione per reparto
    ;(r.items || r.receiptItems || []).forEach(item => {
      const dept = item.department?.description || item.departmentDescription || 'Altro'
      const cat  = item.category?.description  || item.categoryDescription  || 'Altro'
      const tax  = item.tax?.rate != null ? item.tax.rate + '%' : (item.taxRate != null ? item.taxRate + '%' : '—')
      const price = (item.totalPrice || item.price || 0) * (item.quantity || 1)
      
      deptMap[dept] = (deptMap[dept] || 0) + price
      catMap[cat]   = (catMap[cat]   || 0) + price
      taxMap[tax]   = (taxMap[tax]   || 0) + price
    })
  })

  const depts = Object.entries(deptMap).map(([k,v]) => ({ department: { description: k }, profit: v, billCount: 0 })).sort((a,b) => b.profit - a.profit)
  const cats  = Object.entries(catMap).map(([k,v]) => ({ category: { description: k }, totalSold: v })).sort((a,b) => b.totalSold - a.totalSold)
  const taxes = Object.entries(taxMap).map(([k,v]) => ({ tax: { rate: k.replace('%','') }, taxable: v * 0.9, tax_amount: v * 0.1 }))

  return { totale, scontrini, medio: scontrini > 0 ? totale / scontrini : 0, depts, cats, taxes, receipts }
}
