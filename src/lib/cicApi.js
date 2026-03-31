// Adapter ufficiale Cassa in Cloud API
const CIC_BASE = 'https://api.cassanova.com'

export async function getToken(apiKey) {
  const res = await fetch(CIC_BASE + '/apikey/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': '*' },
    body: JSON.stringify({ apiKey })
  })
  if (!res.ok) throw new Error('API Key non valida o piano non supportato')
  return (await res.json()).access_token
}

async function cicGet(token, path, params = {}) {
  const url = new URL(CIC_BASE + path)
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v)
  })
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Version': '1.0.0' }
  })
  if (!res.ok) throw new Error('CIC API error ' + res.status + ': ' + path)
  return res.json()
}

// Endpoint corretto: /salespoint (singolare)
export async function getSalesPoints(token) {
  const data = await cicGet(token, '/salespoint', { hasActiveLicense: true })
  return data.salesPoints || data.records || data || []
}

export async function getSoldByDepartment(token, { from, to, idsSalesPoint }) {
  const f = { referenceDatetimeFrom: from+'T00:00:00.000', referenceDatetimeTo: to+'T23:59:59.999', refund: false, idSharedBillReasonIsNull: true }
  if (idsSalesPoint?.length) f.idsSalesPoint = idsSalesPoint
  return (await cicGet(token, '/reports/sold-by-department', { filter: JSON.stringify(f), start: 0, limit: 100 })).records || []
}

export async function getSoldByCategory(token, { from, to, idsSalesPoint }) {
  const f = { referenceDatetimeFrom: from+'T00:00:00.000', referenceDatetimeTo: to+'T23:59:59.999', refund: false, idSharedBillReasonIsNull: true }
  if (idsSalesPoint?.length) f.idsSalesPoint = idsSalesPoint
  return (await cicGet(token, '/reports/sold-by-category', { filter: JSON.stringify(f), start: 0, limit: 100 })).records || []
}

export async function getSoldByTax(token, { from, to, idsSalesPoint }) {
  const f = { referenceDatetimeFrom: from+'T00:00:00.000', referenceDatetimeTo: to+'T23:59:59.999', refund: false, idSharedBillReasonIsNull: true }
  if (idsSalesPoint?.length) f.idsSalesPoint = idsSalesPoint
  return (await cicGet(token, '/reports/sold-by-tax', { filter: JSON.stringify(f), start: 0, limit: 50 })).records || []
}

export async function getReceipts(token, { from, to, idsSalesPoint, start=0, limit=50 }) {
  const p = { datetimeFrom: from+'T00:00:00.000', datetimeTo: to+'T23:59:59.999', start, limit }
  if (idsSalesPoint?.length) p.idsSalesPoint = JSON.stringify(idsSalesPoint)
  const d = await cicGet(token, '/documents/receipts', p)
  return { records: d.receipts || [], total: d.totalCount || 0 }
}
