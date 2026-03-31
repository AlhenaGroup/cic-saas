const CIC_BASE = 'https://api.cassanova.com'
const FO_BASE = 'https://fo-services.cassanova.com'

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

// Usa fo-services per i report (stessa API usata dal frontend ufficiale CiC)
async function foGet(token, path, params = {}) {
  const url = new URL(FO_BASE + path)
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v)
  })
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
  })
  if (!res.ok) throw new Error('FO API ' + res.status + ': ' + path)
  return res.json()
}

export async function getReportData(token, { from, to, idsSalesPoint }) {
  const filter = {
    referenceDatetimeFrom: from + 'T00:00:00.000',
    referenceDatetimeTo:   to   + 'T23:59:59.999',
    refund: false,
    idSharedBillReasonIsNull: true,
    periodLocked: true,
    idSalesPointIsNull: !idsSalesPoint?.length,
    idSalesPoint: idsSalesPoint?.length ? idsSalesPoint[0] : null,
    idSalesPointLocked: false,
    idDevice: null, idDeviceLocked: false
  }

  const [deptData, catData, taxData] = await Promise.all([
    foGet(token, '/sold-by-department', { filter: JSON.stringify(filter), start: 0, limit: 100, sorts: JSON.stringify({ profit: -1 }) }),
    foGet(token, '/sold-by-category',   { filter: JSON.stringify(filter), start: 0, limit: 100, sorts: JSON.stringify({ profit: -1 }) }),
    foGet(token, '/sold-by-tax',        { filter: JSON.stringify(filter), start: 0, limit: 50 }),
  ])

  const depts = Array.isArray(deptData) ? deptData : (deptData.data || deptData.records || [])
  const cats  = Array.isArray(catData)  ? catData  : (catData.data  || catData.records  || [])
  const taxes = Array.isArray(taxData)  ? taxData  : (taxData.data  || taxData.records  || [])

  const totale    = depts.reduce((s, d) => s + (d.profit || 0), 0)
  const scontrini = depts.reduce((s, d) => s + (d.billCount || 0), 0)

  return {
    totale,
    scontrini,
    medio: scontrini > 0 ? totale / scontrini : 0,
    depts: depts.map(d => ({ department: d.department || { description: d.departmentDescription || 'Reparto' }, profit: d.profit || 0, billCount: d.billCount || 0 })),
    cats:  cats.map(c  => ({ category:   c.category   || { description: c.categoryDescription   || 'Categoria' }, totalSold: c.profit || c.totalSold || 0 })),
    taxes: taxes.map(t => ({ tax: t.tax || { rate: t.taxRate }, taxable: t.taxable || 0, tax_amount: t.taxAmount || t.tax_amount || 0 }))
  }
}
