// Endpoint pubblico per ispezioni HACCP via QR code.
// URL: GET /api/haccp-qr?token={token}
//
// Validazioni:
// 1. Token esiste, attivo, non scaduto
// 2. Aggiorna ultimo_accesso_at + accessi_count
// 3. Restituisce SOLO i dati abilitati nello scope (white-list, mai dati sensibili
//    tipo paghe, contratti, contatti dipendenti).
//
// Tutti gli URL file sono firmati con TTL 1h.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

async function sbQuery(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
  if (body) opts.body = JSON.stringify(body)
  if (method === 'POST' || method === 'PATCH') opts.headers['Prefer'] = 'return=representation'
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts)
  if (method === 'GET') return res.json()
  return res
}

async function signedUrl(filePath, ttl = 3600) {
  if (!filePath) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${filePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify({ expiresIn: ttl }),
    })
    const j = await r.json()
    if (j.signedURL) return `${SUPABASE_URL}/storage/v1${j.signedURL}`
  } catch { /* ignore */ }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET richiesto' })

  const token = req.query?.token
  if (!token) return res.status(400).json({ error: 'token richiesto' })

  // 1) Trova token e valida
  const tokens = await sbQuery(`haccp_qr_tokens?token=eq.${encodeURIComponent(token)}&attivo=eq.true&select=*&limit=1`)
  if (!tokens?.[0]) return res.status(404).json({ error: 'Link non valido o revocato' })
  const tk = tokens[0]
  if (new Date(tk.scadenza_at) < new Date()) {
    return res.status(410).json({ error: 'Link scaduto' })
  }

  // 2) Aggiorna accessi
  await sbQuery(`haccp_qr_tokens?id=eq.${tk.id}`, 'PATCH', {
    ultimo_accesso_at: new Date().toISOString(),
    accessi_count: (tk.accessi_count || 0) + 1,
  })

  const userId = tk.user_id
  const scope = tk.scope || {}

  // 3) Costruisci payload secondo scope
  const out = {
    azienda: { /* anonimo per default — owner pu\u00f2 estendere */ },
    intestazione: {
      nome: tk.nome,
      destinatario: tk.destinatario,
      generato_il: tk.created_at,
      scadenza_at: tk.scadenza_at,
    },
    documenti: [],
    lotti: [],
    registri: [],
    attestati: [],
  }

  // Carica info azienda (user_settings -> nome locale principale)
  const settings = await sbQuery(`user_settings?user_id=eq.${userId}&select=cic_locale_principale&limit=1`)
  if (settings?.[0]?.cic_locale_principale) out.azienda.nome = settings[0].cic_locale_principale

  // ---- DOCUMENTI ----
  if (scope.documenti_categorie?.length > 0 || scope.documenti_locali?.length > 0 || scope.includi_documenti) {
    let q = `haccp_documents?user_id=eq.${userId}&select=id,categoria,titolo,locale,data_emissione,scadenza,responsabile,fornitore,note,file_path&order=categoria.asc,scadenza.asc`
    if (scope.documenti_categorie?.length > 0) {
      q += `&categoria=in.(${scope.documenti_categorie.map(c => `"${c}"`).join(',')})`
    }
    const docs = await sbQuery(q)
    let filtered = docs || []
    if (scope.documenti_locali?.length > 0) {
      filtered = filtered.filter(d => !d.locale || scope.documenti_locali.includes(d.locale))
    }
    out.documenti = await Promise.all(filtered.map(async d => ({
      ...d,
      file_url: await signedUrl(d.file_path),
      file_path: undefined,  // non esporre path interno
    })))
  }

  // ---- LOTTI PRODUZIONE ----
  if (scope.lotti_periodo_giorni > 0) {
    const start = new Date(Date.now() - scope.lotti_periodo_giorni * 86400000).toISOString().split('T')[0]
    let q = `production_batches?user_id=eq.${userId}&data_produzione=gte.${start}&select=id,lotto,recipe_id,data_produzione,ora_produzione,data_scadenza,locale_produzione,locale_destinazione,operatore_nome,quantita_prodotta,unita,ingredienti_usati,allergeni,conservazione,stato,note&order=data_produzione.desc&limit=500`
    const batches = await sbQuery(q)
    let filtered = batches || []
    if (scope.lotti_locali?.length > 0) {
      filtered = filtered.filter(b => scope.lotti_locali.includes(b.locale_produzione) || scope.lotti_locali.includes(b.locale_destinazione))
    }
    // Carica nomi ricetta per batch
    const recipeIds = [...new Set(filtered.map(b => b.recipe_id).filter(Boolean))]
    let recipeMap = {}
    if (recipeIds.length > 0) {
      const recipes = await sbQuery(`production_recipes?id=in.(${recipeIds.join(',')})&select=id,nome,allergeni,conservazione`)
      recipeMap = Object.fromEntries((recipes || []).map(r => [r.id, r]))
    }
    out.lotti = filtered.map(b => ({ ...b, recipe_nome: recipeMap[b.recipe_id]?.nome || null }))
  }

  // ---- REGISTRI AUTOCONTROLLO ----
  if (scope.registri_periodo_giorni > 0) {
    const start = new Date(Date.now() - scope.registri_periodo_giorni * 86400000).toISOString().split('T')[0]
    let templatesQ = `haccp_log_templates?user_id=eq.${userId}&select=id,nome,descrizione,frequenza,locale,fields&order=ordine.asc`
    if (scope.registri_template_ids?.length > 0) {
      templatesQ += `&id=in.(${scope.registri_template_ids.join(',')})`
    }
    const templates = await sbQuery(templatesQ) || []
    const tplIds = templates.map(t => t.id)
    let entries = []
    if (tplIds.length > 0) {
      let entriesQ = `haccp_log_entries?user_id=eq.${userId}&template_id=in.(${tplIds.join(',')})&data_compilazione=gte.${start}&select=id,template_id,operatore_nome,locale,data_compilazione,ora_compilazione,values,anomalia,note&order=data_compilazione.desc&limit=2000`
      entries = await sbQuery(entriesQ) || []
      if (scope.mostra_anomalie === false) {
        entries = entries.filter(e => !e.anomalia)
      }
    }
    out.registri = templates.map(t => ({
      ...t,
      entries: entries.filter(e => e.template_id === t.id),
    }))
  }

  // ---- ATTESTATI ----
  if (scope.attestati_tipi?.length > 0 || scope.includi_attestati) {
    let q = `employee_certificates?user_id=eq.${userId}&select=id,tipo,titolo,data_emissione,scadenza,durata_ore,ente_erogante,employee_id,file_path&order=tipo.asc,scadenza.asc`
    if (scope.attestati_tipi?.length > 0) {
      q += `&tipo=in.(${scope.attestati_tipi.map(t => `"${t}"`).join(',')})`
    }
    const certs = await sbQuery(q) || []
    // Carica nomi dipendenti se richiesto
    let empMap = {}
    if (scope.attestati_includi_employees) {
      const empIds = [...new Set(certs.map(c => c.employee_id).filter(Boolean))]
      if (empIds.length > 0) {
        const emps = await sbQuery(`employees?id=in.(${empIds.join(',')})&select=id,nome,ruolo`)
        empMap = Object.fromEntries((emps || []).map(e => [e.id, e]))
      }
    }
    out.attestati = await Promise.all(certs.map(async c => ({
      ...c,
      employee_nome: scope.attestati_includi_employees ? (empMap[c.employee_id]?.nome || null) : null,
      employee_ruolo: scope.attestati_includi_employees ? (empMap[c.employee_id]?.ruolo || null) : null,
      file_url: await signedUrl(c.file_path),
      file_path: undefined,
      employee_id: undefined,  // non esporre id interno
    })))
  }

  return res.status(200).json(out)
}
