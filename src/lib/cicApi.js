const CIC_BASE = 'https://api.cassanova.com'
const SUPA_URL = 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPA_KEY = 'sb_publishable_YjwJTzgn3CZrzvckFJ_RrA_PT9OZ6V9'

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
  Object.entries(params).forEach(([k,v]) => { if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v) })
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

export async function getReportData(userToken, { from, to, idsSalesPoint }) {
  // Legge dalla cache Supabase (dati sincronizzati dalla dashboard overlay)
  const spId = idsSalesPoint?.length === 1 ? idsSalesPoint[0] : null
  let url = SUPA_URL + '/rest/v1/report_cache'
    + '?period_from=eq.' + from
    + '&period_to=eq.' + to
    + (spId ? '&sales_point_id=eq.' + spId : '&sales_point_id=is.null')
    + '&order=synced_at.desc&limit=1'
  
  const res = await fetch(url, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + userToken }
  })
  const rows = await res.json()
  
  if (!rows?.length) throw new Error('SYNC_NEEDED')
  return rows[0].data
}
