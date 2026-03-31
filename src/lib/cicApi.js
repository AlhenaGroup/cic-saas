const CIC_BASE = 'https://api.cassanova.com'
const PROXY_BASE = '/api/report'

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

// Chiamata ai report tramite proxy Vercel (bypassa CORS e usa cookie di sessione)
async function foReport(cicSessionToken, endpoint, params = {}) {
  const qs = new URLSearchParams({ endpoint, ...params }).toString()
  const res = await fetch(`${PROXY_BASE}?${qs}`, {
    headers: { 'x-cic-token': cicSessionToken }
  })
  if (!res.ok) throw new Error('Report API ' + res.status + ': ' + endpoint)
  return res.json()
}

export async function getReportData(apiToken, { from, to, idsSalesPoint }, cicSessionToken) {
  if (!cicSessionToken) throw new Error('SESSION_MISSING')

  const filter = JSON.stringify({
    referenceDatetimeFrom: from + 'T00:00:00.000',
    referenceDatetimeTo:   to   + 'T23:59:59.999',
    refund: false, idSharedBillReasonIsNull: true,
    periodLocked: true, idSalesPointIsNull: !idsSalesPoint?.length,
    idSalesPoint: idsSalesPoint?.length ? idsSalesPoint[0] : null,
    idSalesPointLocked: false, idDevice: null, idDeviceLocked: false
  })

  const [deptData, catData, taxData] = await Promise.all([
    foReport(cicSessionToken, 'sold-by-department', { filter, start: 0, limit: 100, sorts: JSON.stringify({ profit: -1 }) }),
    foReport(cicSessionToken, 'sold-by-category',   { filter, start: 0, limit: 100, sorts: JSON.stringify({ profit: -1 }) }),
    foReport(cicSessionToken, 'sold-by-tax',        { filter, start: 0, limit: 50 }),
  ])

  const depts = Array.isArray(deptData?.records) ? deptData.records : []
  const cats  = Array.isArray(catData?.records)  ? catData.records  : []
  const taxes = Array.isArray(taxData?.records)  ? taxData.records  : []

  const totale    = depts.reduce((s, d) => s + (d.profit || 0), 0)
  const scontrini = depts.reduce((s, d) => s + (d.billCount || 0), 0)

  return {
    totale, scontrini,
    medio: scontrini > 0 ? totale / scontrini : 0,
    depts: depts.map(d => ({ department: d.department || { description: 'Reparto' }, profit: d.profit || 0 })),
    cats:  cats.map(c  => ({ category: c.category   || { description: 'Categoria' }, totalSold: c.profit || 0 })),
    taxes: taxes.map(t => ({ tax: { rate: t.taxPercent || t.tax?.rate || '?' }, taxable: t.taxable || 0, tax_amount: t.tax || 0 }))
  }
}
