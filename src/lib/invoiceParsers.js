// Parser fatture/DDT da file XML, CSV, PDF.
// Condiviso tra InvoiceTab e InvoiceManager.

// ─── Tipo doc mapping FatturaPA ────────────────────────────────────────────
const TIPO_DOC_MAP = {
  TD01: 'fattura', TD02: 'fattura', TD04: 'nota_credito', TD05: 'nota_credito',
  TD24: 'fattura', TD25: 'fattura', TD06: 'fattura',
}

// ─── Parser XML FatturaPA ──────────────────────────────────────────────────
export function parseXmlInvoice(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const getText = (parent, tag) => {
    const el = parent.querySelector(tag) || parent.getElementsByTagName(tag)[0]
    return el ? el.textContent.trim() : ''
  }
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
  const datiGen = doc.querySelector('DatiGeneraliDocumento') || doc.getElementsByTagName('DatiGeneraliDocumento')[0]
  const numero = datiGen ? getText(datiGen, 'Numero') : ''
  const data = datiGen ? getText(datiGen, 'Data') : ''
  const tipoRaw = datiGen ? getText(datiGen, 'TipoDocumento') : 'TD01'
  const tipo_doc = TIPO_DOC_MAP[tipoRaw] || 'fattura'
  let totaleDoc = datiGen ? parseFloat(getText(datiGen, 'ImportoTotaleDocumento')) || 0 : 0
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
export function parseCsvInvoice(csvText, filename) {
  const firstLine = csvText.split('\n')[0] || ''
  const semis = (firstLine.match(/;/g) || []).length
  const commas = (firstLine.match(/,/g) || []).length
  const tabs = (firstLine.match(/\t/g) || []).length
  const delim = tabs > commas && tabs > semis ? '\t' : semis > commas ? ';' : ','
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return { fornitore: '', numero: '', data: '', tipo_doc: 'fattura', totale: 0, righe: [], format: 'CSV' }
  const headers = lines[0].split(delim).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase())
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
  const baseName = (filename || '').replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim()
  const totale = righe.reduce((s, r) => s + r.prezzo_totale, 0)
  return { fornitore: baseName, numero: '', data: new Date().toISOString().split('T')[0], tipo_doc: 'fattura', totale: Math.round(totale * 100) / 100, righe, format: 'CSV' }
}

// ─── Parser PDF (testo estratto server-side) ───────────────────────────────
export function parsePdfInvoice(text) {
  let fornitore = ''
  const fornMatch = text.match(/(?:Ragione\s+Sociale|Denominazione|Spettabile|Da:?)[:\s]*([^\n]{3,60})/i)
  if (fornMatch) fornitore = fornMatch[1].trim()
  if (!fornitore) {
    const firstLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3)
    fornitore = firstLines[0] || ''
  }
  let numero = ''
  const numMatch = text.match(/(?:Fattura\s*(?:n[.°]?\s*|nr\.?\s*)|N\.\s*|Nr\.?\s*|Documento\s*n[.°]?\s*)([\w\-\/]+)/i)
  if (numMatch) numero = numMatch[1].trim()
  let data = ''
  const dateMatch = text.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/)
  if (dateMatch) data = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
  const dateIso = text.match(/(\d{4}-\d{2}-\d{2})/)
  if (!data && dateIso) data = dateIso[1]
  let totale = 0
  const totMatch = text.match(/(?:Totale\s+(?:Documento|Fattura|Generale|Complessivo)?)[:\s]*[€]?\s*([\d.,]+)/i)
  if (totMatch) totale = parseFloat(totMatch[1].replace(/\./g, '').replace(',', '.')) || 0
  let tipo_doc = 'fattura'
  if (/nota\s+(?:di\s+)?credito/i.test(text)) tipo_doc = 'nota_credito'
  else if (/DDT|documento\s+di\s+trasporto/i.test(text)) tipo_doc = 'ddt'
  const righe = []
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const nums = line.match(/[\d]+[.,]\d{2}/g)
    if (!nums || nums.length < 1) continue
    if (/^(totale|subtotale|imponibile|iva|imposta|sconto|pagamento|banca|iban|data|numero|p\.iva)/i.test(line)) continue
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

// ─── Handler generico: legge file e invoca il parser giusto ─────────────────
export async function handleInvoiceFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'xml') {
    const text = await file.text()
    const parsed = parseXmlInvoice(text)
    if (!parsed.righe.length) throw new Error('Nessuna riga DettaglioLinee trovata nel file XML')
    return parsed
  }
  if (ext === 'csv') {
    const text = await file.text()
    const parsed = parseCsvInvoice(text, file.name)
    if (!parsed.righe.length) throw new Error('Nessuna riga trovata nel file CSV')
    return parsed
  }
  if (ext === 'pdf') {
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
      parsed.fornitore = file.name.replace(/\.[^.]+$/, '')
    }
    return parsed
  }
  throw new Error('Formato non supportato: ' + ext + '. Usa XML, CSV o PDF.')
}
