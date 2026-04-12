import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }
const STATUS_COLORS = {
  bozza:    { c: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  completa: { c: '#10B981', bg: 'rgba(16,185,129,.12)' },
  parziale: { c: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
}

// ─── Tipo doc mapping FatturaPA ────────────────────────────────────────────
const TIPO_DOC_MAP = {
  TD01: 'fattura', TD02: 'fattura', TD04: 'nota_credito', TD05: 'nota_credito',
  TD24: 'fattura', TD25: 'fattura', TD06: 'fattura',
}

// ─── Parser XML FatturaPA ──────────────────────────────────────────────────
function parseXmlInvoice(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const getText = (parent, tag) => {
    const el = parent.querySelector(tag) || parent.getElementsByTagName(tag)[0]
    return el ? el.textContent.trim() : ''
  }
  // Fornitore
  const cedente = doc.querySelector('CedentePrestatore') || doc.getElementsByTagName('CedentePrestatore')[0]
  let fornitore = ''
  if (cedente) {
    fornitore = getText(cedente, 'Denominazione')
    if (!fornitore) {
      const nome = getText(cedente, 'Nome')
      const cognome = getText(cedente, 'Cognome')
      fornitore = [cognome, nome].filter(Boolean).join(' ')
    }
  }
  // Dati generali
  const datiGen = doc.querySelector('DatiGeneraliDocumento') || doc.getElementsByTagName('DatiGeneraliDocumento')[0]
  const numero = datiGen ? getText(datiGen, 'Numero') : ''
  const data = datiGen ? getText(datiGen, 'Data') : ''
  const tipoRaw = datiGen ? getText(datiGen, 'TipoDocumento') : 'TD01'
  const tipo_doc = TIPO_DOC_MAP[tipoRaw] || 'fattura'
  let totaleDoc = datiGen ? parseFloat(getText(datiGen, 'ImportoTotaleDocumento')) || 0 : 0
  // Righe
  const righe = []
  const dettagli = doc.querySelectorAll('DettaglioLinee').length > 0
    ? doc.querySelectorAll('DettaglioLinee')
    : doc.getElementsByTagName('DettaglioLinee')
  for (const det of dettagli) {
    const nome = getText(det, 'Descrizione')
    const qty = parseFloat(getText(det, 'Quantita')) || 0
    const um = getText(det, 'UnitaMisura')
    const pu = parseFloat(getText(det, 'PrezzoUnitario')) || 0
    const pt = parseFloat(getText(det, 'PrezzoTotale')) || 0
    if (nome) righe.push({ nome_fattura: nome, quantita: qty, unita: um, prezzo_unitario: pu, prezzo_totale: pt, selected: true })
  }
  if (!totaleDoc && righe.length) totaleDoc = righe.reduce((s, r) => s + r.prezzo_totale, 0)
  return { fornitore, numero, data, tipo_doc, totale: Math.round(totaleDoc * 100) / 100, righe, format: 'XML' }
}

// ─── Parser CSV generico ───────────────────────────────────────────────────
function parseCsvInvoice(csvText, filename) {
  // Auto-detect delimiter
  const firstLine = csvText.split('\n')[0] || ''
  const semis = (firstLine.match(/;/g) || []).length
  const commas = (firstLine.match(/,/g) || []).length
  const tabs = (firstLine.match(/\t/g) || []).length
  const delim = tabs > commas && tabs > semis ? '\t' : semis > commas ? ';' : ','
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return { fornitore: '', numero: '', data: '', tipo_doc: 'fattura', totale: 0, righe: [], format: 'CSV' }
  const headers = lines[0].split(delim).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase())
  // Mappa colonne
  const findCol = (patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)))
  const iDesc = findCol(['descrizione', 'nome', 'prodotto', 'articolo', 'voce', 'description'])
  const iQty  = findCol(['quantita', 'qty', 'qta', 'q.ta', 'quantity'])
  const iPU   = findCol(['prezzo_unitario', 'prezzo unitario', 'prezzo', 'costo', 'unit price', 'p.u.'])
  const iPT   = findCol(['totale', 'importo', 'prezzo_totale', 'prezzo totale', 'amount', 'total'])
  const iUM   = findCol(['unita', 'um', 'u.m.', 'unit'])
  const parseNum = (s) => parseFloat(String(s || '').replace(/[€\s]/g, '').replace(',', '.')) || 0
  const righe = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(c => c.trim().replace(/^["']|["']$/g, ''))
    const nome = iDesc >= 0 ? cols[iDesc] : cols[0] || ''
    if (!nome) continue
    const qty = iQty >= 0 ? parseNum(cols[iQty]) : 0
    const pu = iPU >= 0 ? parseNum(cols[iPU]) : 0
    const pt = iPT >= 0 ? parseNum(cols[iPT]) : (qty && pu ? qty * pu : 0)
    const um = iUM >= 0 ? cols[iUM] : ''
    righe.push({ nome_fattura: nome, quantita: qty, unita: um, prezzo_unitario: pu, prezzo_totale: Math.round(pt * 100) / 100, selected: true })
  }
  // Fornitore dal nome file
  const baseName = (filename || '').replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim()
  const totale = righe.reduce((s, r) => s + r.prezzo_totale, 0)
  return { fornitore: baseName, numero: '', data: new Date().toISOString().split('T')[0], tipo_doc: 'fattura', totale: Math.round(totale * 100) / 100, righe, format: 'CSV' }
}

// ─── Parser PDF (testo estratto server-side) ───────────────────────────────
function parsePdfInvoice(text) {
  // Fornitore: cerca Ragione Sociale o prime righe significative
  let fornitore = ''
  const fornMatch = text.match(/(?:Ragione\s+Sociale|Denominazione|Spettabile|Da:?)[:\s]*([^\n]{3,60})/i)
  if (fornMatch) fornitore = fornMatch[1].trim()
  if (!fornitore) {
    // Fallback: prima riga non-vuota sopra 3 caratteri
    const firstLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3)
    fornitore = firstLines[0] || ''
  }
  // Numero fattura
  let numero = ''
  const numMatch = text.match(/(?:Fattura\s*(?:n[.°]?\s*|nr\.?\s*)|N\.\s*|Nr\.?\s*|Documento\s*n[.°]?\s*)([\w\-\/]+)/i)
  if (numMatch) numero = numMatch[1].trim()
  // Data
  let data = ''
  const dateMatch = text.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/)
  if (dateMatch) data = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
  const dateIso = text.match(/(\d{4}-\d{2}-\d{2})/)
  if (!data && dateIso) data = dateIso[1]
  // Totale
  let totale = 0
  const totMatch = text.match(/(?:Totale\s+(?:Documento|Fattura|Generale|Complessivo)?)[:\s]*[€]?\s*([\d.,]+)/i)
  if (totMatch) totale = parseFloat(totMatch[1].replace(/\./g, '').replace(',', '.')) || 0
  // Tipo doc
  let tipo_doc = 'fattura'
  if (/nota\s+(?:di\s+)?credito/i.test(text)) tipo_doc = 'nota_credito'
  else if (/DDT|documento\s+di\s+trasporto/i.test(text)) tipo_doc = 'ddt'
  // Righe: cerca pattern tabellari con numeri
  const righe = []
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    // Pattern: testo + almeno 2 numeri (qty/prezzo o prezzo unitario + totale)
    const nums = line.match(/[\d]+[.,]\d{2}/g)
    if (!nums || nums.length < 1) continue
    // Ignora righe di intestazione/totale
    if (/^(totale|subtotale|imponibile|iva|imposta|sconto|pagamento|banca|iban|data|numero|p\.iva)/i.test(line)) continue
    // Estrai la parte testuale (prima del primo numero)
    const firstNumIdx = line.search(/\d+[.,]\d{2}/)
    if (firstNumIdx < 3) continue
    const nome = line.substring(0, firstNumIdx).replace(/\s+$/, '').trim()
    if (nome.length < 2) continue
    const parseIt = (s) => parseFloat(s.replace('.', '').replace(',', '.')) || 0
    if (nums.length >= 3) {
      righe.push({ nome_fattura: nome, quantita: parseIt(nums[0]), unita: '', prezzo_unitario: parseIt(nums[1]), prezzo_totale: parseIt(nums[2]), selected: true })
    } else if (nums.length === 2) {
      righe.push({ nome_fattura: nome, quantita: parseIt(nums[0]), unita: '', prezzo_unitario: 0, prezzo_totale: parseIt(nums[1]), selected: true })
    } else {
      righe.push({ nome_fattura: nome, quantita: 0, unita: '', prezzo_unitario: 0, prezzo_totale: parseIt(nums[0]), selected: true })
    }
  }
  if (!totale && righe.length) totale = righe.reduce((s, r) => s + r.prezzo_totale, 0)
  return { fornitore, numero, data: data || new Date().toISOString().split('T')[0], tipo_doc, totale: Math.round(totale * 100) / 100, righe, format: 'PDF' }
}

export default function InvoiceManager() {
  const [invoices, setInvoices] = useState([])
  const [items, setItems] = useState([])
  const [products, setProducts] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ data: '', numero: '', fornitore: '', locale: '', totale: '', tipo_doc: 'fattura' })
  const [expanded, setExpanded] = useState(null)
  const [itemForm, setItemForm] = useState({ nome_fattura: '', quantita: '', unita: '', prezzo_unitario: '', prezzo_totale: '' })
  const [matchSearch, setMatchSearch] = useState('')
  const [matchResults, setMatchResults] = useState([])
  const [matchingItem, setMatchingItem] = useState(null)
  const [aliases, setAliases] = useState([])
  const [autoMatched, setAutoMatched] = useState({})
  const [loading, setLoading] = useState(false)
  // Upload file state
  const [uploadPreview, setUploadPreview] = useState(null) // {fornitore, numero, data, tipo_doc, totale, righe, format}
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileInputRef = { current: null }

  const load = useCallback(async () => {
    const { data: inv } = await supabase.from('warehouse_invoices').select('*').order('data', { ascending: false })
    setInvoices(inv || [])
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, categoria, unita_misura').eq('attivo', true).order('nome')
    setProducts(prods || [])
    const { data: als } = await supabase.from('warehouse_aliases').select('id, product_id, alias')
    setAliases(als || [])
  }, [])

  const loadItems = useCallback(async (invoiceId) => {
    const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', invoiceId).order('id')
    setItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (expanded) loadItems(expanded) }, [expanded, loadItems])
  useEffect(() => { if (items.length > 0 && products.length > 0) autoMatchItems(items) }, [items, products, aliases])

  const saveInvoice = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('warehouse_invoices').insert({
      user_id: user.id, data: form.data, numero: form.numero, fornitore: form.fornitore,
      locale: form.locale, totale: parseFloat(form.totale) || 0, tipo_doc: form.tipo_doc, stato: 'bozza',
    })
    setForm({ data: '', numero: '', fornitore: '', locale: '', totale: '', tipo_doc: 'fattura' })
    setShowForm(false); await load(); setLoading(false)
  }

  const addItem = async () => {
    if (!expanded) return
    setLoading(true)
    await supabase.from('warehouse_invoice_items').insert({
      invoice_id: expanded, nome_fattura: itemForm.nome_fattura,
      quantita: parseFloat(itemForm.quantita) || 0, unita: itemForm.unita,
      prezzo_unitario: parseFloat(itemForm.prezzo_unitario) || 0,
      prezzo_totale: parseFloat(itemForm.prezzo_totale) || 0, stato_match: 'non_abbinato',
    })
    setItemForm({ nome_fattura: '', quantita: '', unita: '', prezzo_unitario: '', prezzo_totale: '' })
    await loadItems(expanded); setLoading(false)
  }

  const deleteItem = async (id) => {
    await supabase.from('warehouse_invoice_items').delete().eq('id', id)
    if (expanded) await loadItems(expanded)
  }

  const fuzzyScore = (keywords, text) => {
    if (!text) return 0
    const lower = text.toLowerCase()
    let score = 0, allMatch = true
    for (const kw of keywords) {
      if (lower.includes(kw)) { score += kw.length + 1 } else { allMatch = false }
    }
    // Bonus for exact full match
    if (lower === keywords.join(' ')) score += 10
    return allMatch ? score + keywords.length : score > 0 ? score * 0.5 : 0
  }

  const searchProducts = async (q) => {
    setMatchSearch(q)
    if (q.length < 2) { setMatchResults([]); return }
    const keywords = q.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
    if (keywords.length === 0) { setMatchResults([]); return }

    const scored = products.map(p => {
      const nameScore = fuzzyScore(keywords, p.nome)
      // Check aliases for this product
      const prodAliases = aliases.filter(a => a.product_id === p.id)
      const aliasScore = prodAliases.reduce((best, a) => Math.max(best, fuzzyScore(keywords, a.alias)), 0)
      const bestScore = Math.max(nameScore, aliasScore)
      const matchedVia = aliasScore > nameScore ? 'alias' : 'nome'
      return { ...p, score: bestScore, matchedVia }
    }).filter(p => p.score > 0)

    scored.sort((a, b) => b.score - a.score)
    setMatchResults(scored.slice(0, 5))
  }

  const autoMatchItems = async (itemsList) => {
    const matched = {}
    for (const it of itemsList) {
      if (it.stato_match === 'abbinato') continue
      // Check if alias already exists
      const existingAlias = aliases.find(a => a.alias.toLowerCase() === it.nome_fattura.toLowerCase())
      if (existingAlias) {
        matched[it.id] = existingAlias.product_id
        continue
      }
      // Try fuzzy auto-match with high confidence
      const keywords = it.nome_fattura.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
      if (keywords.length === 0) continue
      const best = products.reduce((acc, p) => {
        const s = fuzzyScore(keywords, p.nome)
        return s > acc.score ? { product: p, score: s } : acc
      }, { product: null, score: 0 })
      if (best.product && best.score >= keywords.length * 3) {
        matched[it.id] = best.product.id
      }
    }
    setAutoMatched(matched)
  }

  const confirmMatch = async (item, product) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('warehouse_invoice_items').update({ product_id: product.id, stato_match: 'abbinato' }).eq('id', item.id)
    // Auto-create alias
    if (item.nome_fattura && item.nome_fattura.toLowerCase() !== product.nome.toLowerCase()) {
      await supabase.from('warehouse_aliases').insert({ product_id: product.id, alias: item.nome_fattura, confermato: true })
    }
    setMatchingItem(null); setMatchSearch(''); setMatchResults([])
    if (expanded) await loadItems(expanded)
  }

  const deleteInvoice = async (id) => {
    await supabase.from('warehouse_invoice_items').delete().eq('invoice_id', id)
    await supabase.from('warehouse_invoices').delete().eq('id', id)
    setExpanded(null); await load()
  }

  // ─── File upload handler ──────────────────────────────────────────
  const handleFileUpload = async (file) => {
    if (!file) return
    setUploading(true)
    setUploadMsg(null)
    const ext = file.name.split('.').pop().toLowerCase()
    try {
      if (ext === 'xml') {
        const text = await file.text()
        const parsed = parseXmlInvoice(text)
        if (!parsed.righe.length) throw new Error('Nessuna riga DettaglioLinee trovata nel file XML')
        setUploadPreview(parsed)
      } else if (ext === 'csv') {
        const text = await file.text()
        const parsed = parseCsvInvoice(text, file.name)
        if (!parsed.righe.length) throw new Error('Nessuna riga trovata nel file CSV')
        setUploadPreview(parsed)
      } else if (ext === 'pdf') {
        // Leggi file come base64 e manda al server
        const buf = await file.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        const r = await fetch('/api/parse-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'parse-invoice-pdf', pdfBase64: base64 }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.error || 'Errore server PDF ' + r.status)
        }
        const { text } = await r.json()
        const parsed = parsePdfInvoice(text)
        if (!parsed.fornitore && !parsed.righe.length) {
          // Anche se non trova righe strutturate, mostra almeno il testo
          parsed.fornitore = file.name.replace(/\.[^.]+$/, '')
        }
        setUploadPreview(parsed)
      } else {
        throw new Error('Formato non supportato: ' + ext + '. Usa XML, CSV o PDF.')
      }
    } catch (err) {
      setUploadMsg({ ok: false, text: err.message })
    } finally {
      setUploading(false)
    }
  }

  const saveUploadedInvoice = async () => {
    if (!uploadPreview) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const selectedRows = uploadPreview.righe.filter(r => r.selected)
      const totale = selectedRows.reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0)
      const { data: inv, error: invErr } = await supabase.from('warehouse_invoices').insert({
        user_id: user.id,
        data: uploadPreview.data || new Date().toISOString().split('T')[0],
        numero: uploadPreview.numero || '',
        fornitore: uploadPreview.fornitore || '',
        locale: uploadPreview.locale || '',
        totale: Math.round(totale * 100) / 100,
        tipo_doc: uploadPreview.tipo_doc || 'fattura',
        stato: 'bozza',
      }).select('id').single()
      if (invErr) throw new Error('Errore inserimento fattura: ' + invErr.message)
      if (selectedRows.length > 0) {
        const itemsToInsert = selectedRows.map(r => ({
          invoice_id: inv.id,
          nome_fattura: r.nome_fattura,
          quantita: Number(r.quantita) || 0,
          unita: r.unita || '',
          prezzo_unitario: Number(r.prezzo_unitario) || 0,
          prezzo_totale: Number(r.prezzo_totale) || 0,
          stato_match: 'non_abbinato',
        }))
        const { error: itErr } = await supabase.from('warehouse_invoice_items').insert(itemsToInsert)
        if (itErr) throw new Error('Errore inserimento righe: ' + itErr.message)
      }
      setUploadMsg({ ok: true, text: `Fattura salvata con ${selectedRows.length} righe` })
      setUploadPreview(null)
      await load()
      // Auto-expand la nuova fattura
      setExpanded(inv.id)
    } catch (err) {
      setUploadMsg({ ok: false, text: err.message })
    } finally {
      setUploading(false)
    }
  }

  return <>
    <Card title="Fatture" badge={invoices.length} extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
          disabled={uploading}
        >{uploading ? '...' : '📤 Carica file'}</button>
        <input
          type="file"
          accept=".xml,.csv,.pdf"
          ref={el => fileInputRef.current = el}
          style={{ display: 'none' }}
          onChange={e => { handleFileUpload(e.target.files?.[0]); e.target.value = '' }}
        />
        <button onClick={() => setShowForm(true)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>+ Nuova fattura</button>
      </div>
    }>
      {showForm && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #2a3042' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <input type="date" value={form.data} onChange={e => setForm(p => ({ ...p, data: e.target.value }))} style={formS} />
          <input placeholder="Numero" value={form.numero} onChange={e => setForm(p => ({ ...p, numero: e.target.value }))} style={formS} />
          <input placeholder="Fornitore" value={form.fornitore} onChange={e => setForm(p => ({ ...p, fornitore: e.target.value }))} style={formS} />
          <input placeholder="Locale" value={form.locale} onChange={e => setForm(p => ({ ...p, locale: e.target.value }))} style={formS} />
          <input placeholder="Totale" type="number" step="0.01" value={form.totale} onChange={e => setForm(p => ({ ...p, totale: e.target.value }))} style={formS} />
          <select value={form.tipo_doc} onChange={e => setForm(p => ({ ...p, tipo_doc: e.target.value }))} style={formS}>
            <option value="fattura">Fattura</option>
            <option value="nota_credito">Nota di credito</option>
            <option value="ddt">DDT</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={saveInvoice} disabled={!form.data || !form.fornitore || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Salva</button>
          <button onClick={() => setShowForm(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Annulla</button>
        </div>
      </div>}

      {/* Upload message */}
      {uploadMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6,
          background: uploadMsg.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
          border: `1px solid ${uploadMsg.ok ? '#10B981' : '#EF4444'}`,
          color: uploadMsg.ok ? '#10B981' : '#EF4444', fontSize: 12,
        }}>{uploadMsg.text}</div>
      )}

      {/* Upload preview modal */}
      {uploadPreview && (
        <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #F59E0B' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
              Anteprima fattura da file
            </div>
            <span style={S.badge(
              uploadPreview.format === 'PDF' ? '#F59E0B' : '#10B981',
              uploadPreview.format === 'PDF' ? 'rgba(245,158,11,.15)' : 'rgba(16,185,129,.15)'
            )}>{uploadPreview.format} {uploadPreview.format === 'PDF' ? '⚠ verifica' : '✓'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Fornitore</label>
              <input value={uploadPreview.fornitore} onChange={e => setUploadPreview(p => ({ ...p, fornitore: e.target.value }))} style={formS} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Data</label>
              <input type="date" value={uploadPreview.data} onChange={e => setUploadPreview(p => ({ ...p, data: e.target.value }))} style={formS} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Numero</label>
              <input value={uploadPreview.numero} onChange={e => setUploadPreview(p => ({ ...p, numero: e.target.value }))} style={formS} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Tipo</label>
              <select value={uploadPreview.tipo_doc} onChange={e => setUploadPreview(p => ({ ...p, tipo_doc: e.target.value }))} style={formS}>
                <option value="fattura">Fattura</option>
                <option value="nota_credito">Nota di credito</option>
                <option value="ddt">DDT</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 10, fontSize: 12, color: '#94a3b8' }}>
            {uploadPreview.righe.filter(r => r.selected).length} righe selezionate
            {' · '}
            Totale: <strong style={{ color: '#F59E0B' }}>{fmt(uploadPreview.righe.filter(r => r.selected).reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0))}</strong>
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                <th style={{ ...S.th, width: 30 }}></th>
                <th style={S.th}>Descrizione</th>
                <th style={S.th}>Qty</th>
                <th style={S.th}>UM</th>
                <th style={S.th}>Prezzo unit.</th>
                <th style={S.th}>Totale</th>
              </tr></thead>
              <tbody>
                {uploadPreview.righe.map((r, i) => (
                  <tr key={i} style={{ opacity: r.selected ? 1 : 0.4 }}>
                    <td style={S.td}>
                      <input type="checkbox" checked={r.selected} onChange={() => {
                        setUploadPreview(p => ({
                          ...p,
                          righe: p.righe.map((rr, j) => j === i ? { ...rr, selected: !rr.selected } : rr)
                        }))
                      }} style={{ accentColor: '#F59E0B' }} />
                    </td>
                    <td style={{ ...S.td, fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome_fattura}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{r.quantita || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.unita || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{r.prezzo_unitario ? fmt(r.prezzo_unitario) : '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, fontWeight: 600 }}>{fmt(r.prezzo_totale)}</td>
                  </tr>
                ))}
                {uploadPreview.righe.length === 0 && (
                  <tr><td colSpan={6} style={{ ...S.td, color: '#EF4444', textAlign: 'center' }}>Nessuna riga rilevata dal file</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setUploadPreview(null); setUploadMsg(null) }}
              style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 14px', fontSize: 12 }}>Annulla</button>
            <button onClick={saveUploadedInvoice} disabled={uploading || !uploadPreview.righe.some(r => r.selected)}
              style={{
                ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 700, fontSize: 12,
                cursor: uploadPreview.righe.some(r => r.selected) ? 'pointer' : 'not-allowed',
              }}>{uploading ? 'Salvataggio...' : '💾 Salva fattura + righe'}</button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Data', 'Numero', 'Fornitore', 'Locale', 'Tipo', 'Totale', 'Stato', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {invoices.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessuna fattura inserita</td></tr>}
          {invoices.map(inv => {
            const sc = STATUS_COLORS[inv.stato] || STATUS_COLORS.bozza
            return <tr key={inv.id} style={{ cursor: 'pointer', background: expanded === inv.id ? '#131825' : 'transparent' }} onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}>
              <td style={S.td}>{inv.data}</td>
              <td style={{ ...S.td, fontWeight: 500 }}>{inv.numero || '-'}</td>
              <td style={{ ...S.td, color: '#e2e8f0' }}>{inv.fornitore}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{inv.locale || '-'}</td>
              <td style={{ ...S.td, fontSize: 12 }}>{inv.tipo_doc}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{fmt(inv.totale)}</td>
              <td style={S.td}><span style={S.badge(sc.c, sc.bg)}>{inv.stato}</span></td>
              <td style={S.td}><button onClick={e => { e.stopPropagation(); if (confirm('Eliminare fattura?')) deleteInvoice(inv.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>Elimina</button></td>
            </tr>
          })}
        </tbody>
      </table>
    </Card>

    {expanded && <div style={{ marginTop: 12 }}>
      <Card title="Righe fattura" badge={items.length} extra={
        <span style={{ fontSize: 11, color: '#64748b' }}>Fattura #{invoices.find(i => i.id === expanded)?.numero}</span>
      }>
        {/* Add item form */}
        <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #2a3042' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <input placeholder="Nome in fattura" value={itemForm.nome_fattura} onChange={e => setItemForm(p => ({ ...p, nome_fattura: e.target.value }))} style={formS} />
            <input placeholder="Qty" type="number" step="0.01" value={itemForm.quantita} onChange={e => setItemForm(p => ({ ...p, quantita: e.target.value }))} style={formS} />
            <input placeholder="Unita" value={itemForm.unita} onChange={e => setItemForm(p => ({ ...p, unita: e.target.value }))} style={formS} />
            <input placeholder="Prezzo unit." type="number" step="0.01" value={itemForm.prezzo_unitario} onChange={e => setItemForm(p => ({ ...p, prezzo_unitario: e.target.value }))} style={formS} />
            <input placeholder="Totale" type="number" step="0.01" value={itemForm.prezzo_totale} onChange={e => setItemForm(p => ({ ...p, prezzo_totale: e.target.value }))} style={formS} />
            <button onClick={addItem} disabled={!itemForm.nome_fattura || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 600, marginBottom: 8 }}>+</button>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome fattura', 'Qty', 'Unita', 'Prezzo unit.', 'Totale', 'Stato', 'Prodotto', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessuna riga</td></tr>}
            {items.map(it => (
              <tr key={it.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{it.nome_fattura}</td>
                <td style={S.td}>{it.quantita}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{it.unita}</td>
                <td style={S.td}>{fmt(it.prezzo_unitario)}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{fmt(it.prezzo_totale)}</td>
                <td style={S.td}>
                  <span style={S.badge(
                    it.stato_match === 'abbinato' ? '#10B981' : '#F59E0B',
                    it.stato_match === 'abbinato' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)'
                  )}>{it.stato_match === 'abbinato' ? 'Abbinato' : 'Non abbinato'}</span>
                </td>
                <td style={S.td}>
                  {it.stato_match === 'abbinato'
                    ? <span style={{ fontSize: 12, color: '#10B981' }}>{products.find(p => p.id === it.product_id)?.nome || 'Abbinato'}</span>
                    : autoMatched[it.id]
                      ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.12)')}>suggerito</span>
                          <span style={{ fontSize: 11, color: '#c4b5fd' }}>{products.find(p => p.id === autoMatched[it.id])?.nome}</span>
                          <button onClick={() => confirmMatch(it, products.find(p => p.id === autoMatched[it.id]))} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '2px 8px', fontWeight: 600, fontSize: 10 }}>Conferma</button>
                          <button onClick={() => { setMatchingItem(it); setMatchSearch(''); setMatchResults([]) }} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '2px 8px', fontSize: 10 }}>Altro</button>
                        </span>
                      : <button onClick={() => { setMatchingItem(it); setMatchSearch(''); setMatchResults([]) }} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '3px 10px', fontWeight: 600, fontSize: 11 }}>Abbina</button>
                  }
                </td>
                <td style={S.td}><button onClick={() => deleteItem(it.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>X</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Match modal */}
        {matchingItem && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginTop: 12, border: '1px solid #F59E0B' }}>
          <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 8 }}>Abbina "{matchingItem.nome_fattura}" a un prodotto:</div>
          <input placeholder="Cerca prodotto..." value={matchSearch} onChange={e => searchProducts(e.target.value)} style={{ ...formS, maxWidth: 300 }} autoFocus />
          {matchResults.map(p => (
            <div key={p.id} onClick={() => confirmMatch(matchingItem, p)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #2a3042', fontSize: 13, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 500 }}>{p.nome}</span>
              <span style={{ color: '#64748b', fontSize: 11 }}>({p.categoria} - {p.unita_misura})</span>
              {p.matchedVia === 'alias' && <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.12)')}>alias</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>score: {p.score.toFixed(0)}</span>
            </div>
          ))}
          <button onClick={() => setMatchingItem(null)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '4px 12px', marginTop: 8, fontSize: 11 }}>Annulla</button>
        </div>}
      </Card>
    </div>}
  </>
}
