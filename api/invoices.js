// API fatture — integrazione TS Digital (API diretta) + CiC legacy (cookie)
// Trigger redeploy: 2026-05-01
import crypto from 'crypto'

// Aggrega IVA per aliquota dai blocchi <DatiRiepilogo> dell'XML FatturaPA.
// Restituisce { "22.00": { imponibile, imposta }, "10.00": {...}, ... }
function parseIvaBreakdown(xml) {
  if (!xml) return {}
  const out = {}
  const re = /<DatiRiepilogo>([\s\S]*?)<\/DatiRiepilogo>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]
    const g = (t) => { const x = block.match(new RegExp('<' + t + '>(.*?)</' + t + '>')); return x ? x[1] : '' }
    const aliq = parseFloat(g('AliquotaIVA')) || 0
    const imp = parseFloat(g('ImponibileImporto')) || 0
    const ivaA = parseFloat(g('Imposta')) || 0
    if (aliq === 0 && imp === 0 && ivaA === 0) continue
    const key = aliq.toFixed(2)
    if (!out[key]) out[key] = { imponibile: 0, imposta: 0 }
    out[key].imponibile += imp
    out[key].imposta += ivaA
  }
  for (const k of Object.keys(out)) {
    out[k].imponibile = Math.round(out[k].imponibile * 100) / 100
    out[k].imposta = Math.round(out[k].imposta * 100) / 100
  }
  return out
}

const FO_BASE = 'https://fo-services.cassanova.com'
const TS_AUTH_BASE = 'https://b2b-auth-service.agyo.io'
const TS_API_BASE = 'https://b2bread-api.agyo.io'

// TS Digital credentials (env vars o fallback)
const TS_ID = process.env.TS_DIGITAL_ID || 'ccff31e7-a883-4f00-872a-4f03480028ff'
const TS_SECRET = process.env.TS_DIGITAL_SECRET || 'e4de10bd-04d5-4bfd-b91a-0a69a3ac2f41'
const TS_APP_NAME = 'CICAnalytics'
const TS_APP_VERSION = '1.0.0'

// Codici fiscali delle aziende (ownerId per TS Digital)
const TS_OWNERS = [
  { cf: 'FSCSMN98H12G674S', name: 'BIANCOLATTE' },
  // Aggiungi qui altri CF per REMEMBEER / CASA DE AMICIS se diversi
]

// ─── TS Digital Auth ───────────────────────────────────────────────────────
function uuid() { return crypto.randomUUID() }
function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex') }

function tsHeaders(itemId) {
  return {
    'Content-Type': 'application/json',
    'X-App-Name': TS_APP_NAME,
    'X-App-Version': TS_APP_VERSION,
    'X-Request-ID': uuid(),
    'X-Correlation-ID': uuid(),
    ...(itemId ? { 'X-Item-ID': itemId, 'X-User-ID': TS_ID } : {}),
  }
}

// Cache token in memory (Vercel cold start = rigenera, ma ok per durata richiesta)
let _tsToken = null
let _tsTokenTime = 0
const TOKEN_TTL = 3600000 // 1h

async function getTsToken() {
  if (_tsToken && Date.now() - _tsTokenTime < TOKEN_TTL) return _tsToken
  // Step 1: nonce
  const nonceRes = await fetch(`${TS_AUTH_BASE}/api/v3/nonces`, {
    method: 'POST',
    headers: tsHeaders(),
    body: JSON.stringify({ id: TS_ID }),
  })
  if (!nonceRes.ok) throw new Error('TS nonce failed: ' + nonceRes.status)
  const { nonce } = await nonceRes.json()
  // Step 2: digest = sha256(sha256(id+secret) + nonce)
  const inner = sha256(TS_ID + TS_SECRET)
  const digest = sha256(inner + nonce)
  // Step 3: token
  const tokenRes = await fetch(`${TS_AUTH_BASE}/api/v3/tokens`, {
    method: 'POST',
    headers: tsHeaders(),
    body: JSON.stringify({ id: TS_ID, digest }),
  })
  if (!tokenRes.ok) throw new Error('TS token failed: ' + tokenRes.status)
  const { accessToken } = await tokenRes.json()
  _tsToken = accessToken
  _tsTokenTime = Date.now()
  return accessToken
}

// ─── TS Digital Invoice API ────────────────────────────────────────────────
async function tsListInvoices(token, ownerId, { active = false, from, continuationToken } = {}) {
  const tsFrom = from || 1546300801000 // 2019-01-01
  let url = `${TS_API_BASE}/api/v2/invoices?ownerId=${ownerId}&active=${active}&lastTimestampFrom=${tsFrom}`
  if (continuationToken) url += `&continuationToken=${encodeURIComponent(continuationToken)}`
  const res = await fetch(url, {
    headers: { ...tsHeaders(ownerId), Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`TS list ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

async function tsDownloadInvoice(token, ownerId, hubId, format = 'XML') {
  const res = await fetch(`${TS_API_BASE}/api/v2/invoices/${hubId}/download?format=${format}`, {
    headers: { ...tsHeaders(ownerId), Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`TS download ${res.status}`)
  return res.text()
}

// ─── CiC Legacy (cookie-based) ─────────────────────────────────────────────
const SALESPOINTS = [
  { id: 21747, name: 'REMEMBEER' },
  { id: 22399, name: 'CASA DE AMICIS' },
]

async function foGet(sessionCookie, path) {
  const res = await fetch(FO_BASE + path, {
    headers: {
      Cookie: sessionCookie,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'it',
      Referer: 'https://fo.cassanova.com/',
      'User-Agent': 'Mozilla/5.0',
      'cn-datetime': new Date().toISOString(),
    },
  })
  return res
}

// ─── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, sessionCookie, invoiceId, spId } = req.body || {}

  try {
    switch (action) {
      // ─── TS Digital: una pagina di fatture (il client pagina in loop) ─
      case 'ts-list': {
        const { from, continuationToken: ct, ownerId: explicitOwner } = req.body
        const token = await getTsToken()
        const owner = explicitOwner || TS_OWNERS[0]?.cf
        const ownerName = TS_OWNERS.find(o => o.cf === owner)?.name || owner
        const resp = await tsListInvoices(token, owner, { from, continuationToken: ct })
        const invoices = resp._embedded?.invoiceList || []
        invoices.forEach(inv => { inv._locale = ownerName })
        return res.status(200).json({
          invoices,
          hasNext: resp.page?.hasNext || false,
          continuationToken: resp.page?.continuationToken || null,
          total: invoices.length,
          source: 'ts-digital',
        })
      }

      // ─── TS Digital: scarica XML/PDF di una fattura ───────────────
      case 'ts-download': {
        const { hubId, format, ownerId: explicitOwner } = req.body
        if (!hubId) return res.status(400).json({ error: 'hubId richiesto' })
        const token = await getTsToken()
        const ownerId = explicitOwner || TS_OWNERS[0]?.cf
        const content = await tsDownloadInvoice(token, ownerId, hubId, format || 'XML')
        return res.status(200).json({ content, format: format || 'XML' })
      }

      // ─── Batch import: importa fatture assegnate nel warehouse ────
      case 'batch-import': {
        const { localeMap, continuationToken: bCt } = req.body
        if (!localeMap) return res.status(400).json({ error: 'localeMap richiesto' })
        const token = await getTsToken()
        const owner = TS_OWNERS[0]?.cf
        const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
        const SB_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
        const UID = '4bedef4d-cf04-4c34-b614-dd0b78b496be'
        const sbH = { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=representation' }

        const resp = await tsListInvoices(token, owner, { continuationToken: bCt })
        const invoices = resp._embedded?.invoiceList || []
        let imported = 0, skipped = 0, errors = 0

        for (const inv of invoices) {
          const locale = localeMap[inv.hubId]
          if (!locale) { skipped++; continue }
          try {
            // Check se gia importata
            const chkR = await fetch(`${SB_URL}/rest/v1/warehouse_invoices?numero=eq.${encodeURIComponent(inv.docId || '')}&fornitore=eq.${encodeURIComponent(inv.senderName || '')}&select=id&limit=1`, { headers: sbH })
            const ex = await chkR.json()
            if (ex && ex.length > 0) { skipped++; continue }
            // Scarica XML
            const xml = await tsDownloadInvoice(token, owner, inv.hubId, 'XML')
            // Parse righe
            const lines = []
            const re = /<DettaglioLinee>([\s\S]*?)<\/DettaglioLinee>/g
            let m
            while ((m = re.exec(xml)) !== null) {
              const b = m[1]
              const g = (t) => { const x = b.match(new RegExp('<' + t + '>(.*?)</' + t + '>')); return x ? x[1] : '' }
              lines.push({ desc: g('Descrizione'), qty: parseFloat(g('Quantita')) || 0, um: g('UnitaMisura'),
                pu: parseFloat(g('PrezzoUnitario')) || 0, pt: parseFloat(g('PrezzoTotale')) || 0 })
            }
            const isNC = inv.detail?.td === 'TD04' || inv.detail?.td === 'TD05'
            // Calcola IVA breakdown da DatiRiepilogo
            const ivaBd = parseIvaBreakdown(xml)
            const ivaBdSigned = isNC
              ? Object.fromEntries(Object.entries(ivaBd).map(([k, v]) => [k, { imponibile: -Math.abs(v.imponibile), imposta: -Math.abs(v.imposta) }]))
              : ivaBd
            // Insert fattura
            const irR = await fetch(`${SB_URL}/rest/v1/warehouse_invoices`, { method: 'POST', headers: sbH,
              body: JSON.stringify({ user_id: UID, data: inv.docDate, numero: inv.docId || '', fornitore: inv.senderName || '',
                locale, totale: isNC ? -Math.abs(inv.detail?.totalAmount || 0) : inv.detail?.totalAmount || 0,
                tipo_doc: isNC ? 'nota_credito' : 'fattura', stato: 'bozza',
                iva_breakdown: ivaBdSigned }) })
            if (!irR.ok) { errors++; continue }
            const [newInv] = await irR.json()
            // Insert righe
            if (lines.length > 0) {
              await fetch(`${SB_URL}/rest/v1/warehouse_invoice_items`, { method: 'POST',
                headers: { ...sbH, 'Prefer': 'return=minimal' },
                body: JSON.stringify(lines.map(l => ({
                  invoice_id: newInv.id, nome_fattura: l.desc, quantita: l.qty, unita: l.um,
                  prezzo_unitario: isNC ? -Math.abs(l.pu) : l.pu,
                  prezzo_totale: isNC ? -Math.abs(l.pt) : l.pt, stato_match: 'non_abbinato' }))) })
            }
            imported++
          } catch { errors++ }
        }
        return res.status(200).json({
          imported, skipped, errors,
          hasNext: resp.page?.hasNext || false,
          continuationToken: resp.page?.continuationToken || null,
        })
      }

      // ─── Backfill iva_breakdown su fatture esistenti ─────────────────
      // Chiamato in loop dal client; processa fino a 15 fatture per chiamata
      // (timeout Vercel ~10s su free, abbondante margine).
      case 'backfill-iva-breakdown': {
        const token = await getTsToken()
        const owner = TS_OWNERS[0]?.cf
        const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
        const SB_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
        const sbH = { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=representation' }
        // Fattura senza iva_breakdown popolato
        const listR = await fetch(`${SB_URL}/rest/v1/warehouse_invoices?iva_breakdown=eq.{}&select=id,numero,fornitore,tipo_doc,data&order=data.desc&limit=15`, { headers: sbH })
        const toFix = await listR.json()
        if (!Array.isArray(toFix) || toFix.length === 0) {
          return res.status(200).json({ updated: 0, errors: 0, hasMore: false, remaining: 0 })
        }
        // Devo trovare hubId/ownerId di ogni fattura cercando in TS Digital per docId
        // Strategia: scarico la lista corrente (ultime ~50) e matcho per (docId, senderName)
        const tsList = await tsListInvoices(token, owner, {})
        const tsInvoices = tsList._embedded?.invoiceList || []
        const tsIndex = {}
        for (const ti of tsInvoices) tsIndex[`${ti.docId}|${ti.senderName}`] = ti
        let updated = 0, errors = 0
        for (const dbInv of toFix) {
          const key = `${dbInv.numero}|${dbInv.fornitore}`
          const tsInv = tsIndex[key]
          if (!tsInv) { errors++; continue }
          try {
            const xml = await tsDownloadInvoice(token, owner, tsInv.hubId, 'XML')
            const bd = parseIvaBreakdown(xml)
            const isNC = dbInv.tipo_doc === 'nota_credito'
            const bdSigned = isNC
              ? Object.fromEntries(Object.entries(bd).map(([k, v]) => [k, { imponibile: -Math.abs(v.imponibile), imposta: -Math.abs(v.imposta) }]))
              : bd
            await fetch(`${SB_URL}/rest/v1/warehouse_invoices?id=eq.${dbInv.id}`, {
              method: 'PATCH', headers: { ...sbH, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ iva_breakdown: bdSigned })
            })
            updated++
          } catch { errors++ }
        }
        // Conta rimanenti (con paginazione esatta no, stima)
        const remR = await fetch(`${SB_URL}/rest/v1/warehouse_invoices?iva_breakdown=eq.{}&select=id&limit=1`, { headers: { ...sbH, 'Prefer': 'count=exact' } })
        const remCount = parseInt(remR.headers.get('content-range')?.split('/')[1] || '0')
        return res.status(200).json({ updated, errors, hasMore: remCount > 0, remaining: remCount })
      }

      // ─── CiC Legacy: lista fatture da entrambi i salespoint ───────
      case 'list': {
        if (!sessionCookie) return res.status(400).json({ error: 'sessionCookie required', needsSession: true })
        const { limit = 100, start = 0 } = req.body
        const allInvoices = []
        for (const sp of SALESPOINTS) {
          try {
            const r = await foGet(sessionCookie, `/integration/agyo-wrapper/${sp.id}/e-invoices?limit=${limit}&start=${start}`)
            if (r.ok) {
              const d = await r.json()
              const records = (d.records || []).map(inv => ({ ...inv, salespoint_id: sp.id, salespoint_name: sp.name }))
              allInvoices.push(...records)
            }
          } catch (e) { /* skip */ }
        }
        allInvoices.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        return res.status(200).json({ invoices: allInvoices, total: allInvoices.length })
      }

      // ─── CiC Legacy: scarica XML ─────────────────────────────────
      case 'xml': {
        if (!sessionCookie) return res.status(400).json({ error: 'sessionCookie required', needsSession: true })
        if (!invoiceId || !spId) return res.status(400).json({ error: 'invoiceId e spId richiesti' })
        const spsToTry = spId ? [spId] : SALESPOINTS.map(s => s.id)
        for (const sid of spsToTry) {
          try {
            const r = await foGet(sessionCookie, `/integration/agyo-wrapper/${sid}/e-invoices/${invoiceId}/xml`)
            if (r.ok) {
              const xml = await r.text()
              return res.status(200).json({ xml, spId: sid })
            }
          } catch (e) { continue }
        }
        return res.status(503).json({ error: 'XML non disponibile al momento.' })
      }

      default:
        return res.status(400).json({ error: 'action richiesta: ts-list, ts-download, list, xml' })
    }
  } catch (err) {
    console.error('[INVOICES]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
