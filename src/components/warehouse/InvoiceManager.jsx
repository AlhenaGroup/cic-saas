import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }

export default function InvoiceManager({ sp, sps }) {
  // TS Digital fatture
  const [tsInvoices, setTsInvoices] = useState([])
  const [tsLoading, setTsLoading] = useState(false)
  // Locale assignment (shared con InvoiceTab via localStorage)
  const [tsLocaleMap, setTsLocaleMap] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_ts_invoice_locales') || '{}') } catch { return {} } })
  // Expanded invoice + XML + items
  const [expanded, setExpanded] = useState(null)
  const [xmlContent, setXmlContent] = useState(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  // Warehouse items (per le fatture importate in warehouse)
  const [whInvoice, setWhInvoice] = useState(null) // warehouse_invoice record corrispondente
  const [items, setItems] = useState([])
  const [itemForm, setItemForm] = useState({ nome_fattura: '', quantita: '', unita: '', prezzo_unitario: '', prezzo_totale: '' })
  // Products + matching
  const [products, setProducts] = useState([])
  const [aliases, setAliases] = useState([])
  const [autoMatched, setAutoMatched] = useState({})
  const [matchSearch, setMatchSearch] = useState('')
  const [matchResults, setMatchResults] = useState([])
  const [matchingItem, setMatchingItem] = useState(null)
  const [loading, setLoading] = useState(false)

  // ─── Load TS Digital invoices (paginato, 1 pagina) ──────────────
  const [tsPage, setTsPage] = useState(0)
  const [tsPages, setTsPagesArr] = useState([null])
  const [tsHasNext, setTsHasNext] = useState(false)

  const loadTsPage = async (pageIdx) => {
    setTsLoading(true)
    try {
      // Refresh localeMap da localStorage (l'utente potrebbe aver assegnato nel tab Fatture)
      try { setTsLocaleMap(JSON.parse(localStorage.getItem('cic_ts_invoice_locales') || '{}')) } catch {}
      const ct = tsPages[pageIdx] || null
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ts-list', continuationToken: ct }),
      })
      if (r.ok) {
        const d = await r.json()
        setTsInvoices(d.invoices || [])
        setTsHasNext(d.hasNext || false)
        if (d.hasNext && d.continuationToken) {
          setTsPagesArr(prev => { const next = [...prev]; next[pageIdx + 1] = d.continuationToken; return next })
        }
        setTsPage(pageIdx)
      }
    } catch (e) { console.warn('[InvoiceManager] TS load:', e.message) }
    setTsLoading(false)
  }

  const loadProducts = useCallback(async () => {
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, categoria, unita_misura').eq('attivo', true).order('nome')
    setProducts(prods || [])
    const { data: als } = await supabase.from('warehouse_aliases').select('id, product_id, alias')
    setAliases(als || [])
  }, [])

  useEffect(() => { loadTsPage(0); loadProducts() }, [loadProducts])

  // Refresh locale map when localStorage changes (cross-tab sync)
  useEffect(() => {
    const handler = () => {
      try { setTsLocaleMap(JSON.parse(localStorage.getItem('cic_ts_invoice_locales') || '{}')) } catch {}
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // ─── Filter: solo fatture assegnate al locale corrente ─────────────
  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || sps?.find(s => String(s.id) === String(sp))?.name || null)

  const tsFiltered = [...tsInvoices].filter(f => {
    const assigned = tsLocaleMap[f.hubId]
    if (!assigned) return false // mostra solo le assegnate
    if (selectedLocaleName && assigned !== selectedLocaleName && assigned !== 'Alhena Group') return false
    return true
  }).sort((a, b) => (b.docDate || '').localeCompare(a.docDate || ''))

  // ─── XML download + parse ──────────────────────────────────────────
  const downloadXml = async (inv) => {
    setXmlLoading(true); setXmlContent(null)
    try {
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ts-download', hubId: inv.hubId, ownerId: inv.ownerId, format: 'XML' }),
      })
      if (r.ok) {
        const d = await r.json()
        setXmlContent(d.content)
      }
    } catch {}
    setXmlLoading(false)
  }

  const parseXmlLines = (xml) => {
    if (!xml || xml.length < 100) return []
    const lines = []
    const lineRegex = /<DettaglioLinee>([\s\S]*?)<\/DettaglioLinee>/g
    let match
    while ((match = lineRegex.exec(xml)) !== null) {
      const block = match[1]
      const get = (tag) => { const m = block.match(new RegExp('<' + tag + '>(.*?)</' + tag + '>')); return m ? m[1] : '' }
      lines.push({ descrizione: get('Descrizione'), quantita: get('Quantita'), um: get('UnitaMisura'), prezzoUnitario: get('PrezzoUnitario'), prezzoTotale: get('PrezzoTotale'), aliquotaIVA: get('AliquotaIVA') })
    }
    return lines
  }

  // ─── Import TS invoice → warehouse (per match prodotti) ────────────
  const importToWarehouse = async (tsInv) => {
    // Scarica XML e parsa righe
    setLoading(true)
    try {
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ts-download', hubId: tsInv.hubId, ownerId: tsInv.ownerId, format: 'XML' }),
      })
      if (!r.ok) throw new Error('Download XML fallito')
      const { content: xml } = await r.json()
      const xmlLines = parseXmlLines(xml)

      const { data: { user } } = await supabase.auth.getUser()
      const locale = tsLocaleMap[tsInv.hubId] || ''
      const isNotaCredito = tsInv.detail?.td === 'TD04' || tsInv.detail?.td === 'TD05'
      const { data: inv, error: invErr } = await supabase.from('warehouse_invoices').insert({
        user_id: user.id,
        data: tsInv.docDate || new Date().toISOString().split('T')[0],
        numero: tsInv.docId || '',
        fornitore: tsInv.senderName || '',
        locale,
        totale: isNotaCredito ? -Math.abs(tsInv.detail?.totalAmount || 0) : Math.abs(tsInv.detail?.totalAmount || 0),
        tipo_doc: isNotaCredito ? 'nota_credito' : 'fattura',
        stato: 'bozza',
      }).select('id').single()
      if (invErr) throw new Error(invErr.message)

      if (xmlLines.length > 0) {
        await supabase.from('warehouse_invoice_items').insert(
          xmlLines.map(l => ({
            invoice_id: inv.id,
            nome_fattura: l.descrizione,
            quantita: parseFloat(l.quantita) || 0,
            unita: l.um || '',
            // Nota credito: importo negativo (XML ha sempre prezzi positivi)
            prezzo_unitario: isNotaCredito ? -Math.abs(parseFloat(l.prezzoUnitario) || 0) : Math.abs(parseFloat(l.prezzoUnitario) || 0),
            prezzo_totale: isNotaCredito ? -Math.abs(parseFloat(l.prezzoTotale) || 0) : Math.abs(parseFloat(l.prezzoTotale) || 0),
            stato_match: 'non_abbinato',
          }))
        )
      }
      // Carica le righe e applica suggerimenti automatici
      setWhInvoice(inv)
      const { data: its } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', inv.id).order('id')
      setItems(its || [])
      // Pre-popola nome articolo, qty e UM dai suggerimenti
      if (its && its.length > 0) await applySmartDefaults(its)
    } catch (e) {
      console.error('[importToWarehouse]', e.message)
    }
    setLoading(false)
  }

  // ─── Check if already imported ─────────────────────────────────────
  const checkWarehouseInvoice = async (tsInv) => {
    const { data } = await supabase.from('warehouse_invoices')
      .select('id')
      .eq('numero', tsInv.docId || '')
      .eq('fornitore', tsInv.senderName || '')
      .limit(1)
    if (data && data[0]) {
      setWhInvoice(data[0])
      const { data: its } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', data[0].id).order('id')
      setItems(its || [])
      return true
    }
    return false
  }

  // ─── Expand handler ────────────────────────────────────────────────
  const handleExpand = async (hubId) => {
    if (expanded === hubId) { setExpanded(null); setItems([]); setWhInvoice(null); setXmlContent(null); return }
    setExpanded(hubId)
    setItems([]); setWhInvoice(null); setXmlContent(null); setAutoMatched({})
    const tsInv = tsInvoices.find(f => f.hubId === hubId)
    if (tsInv) {
      const found = await checkWarehouseInvoice(tsInv)
      if (!found) downloadXml(tsInv)
    }
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────
  const addItem = async () => {
    if (!whInvoice) return
    setLoading(true)
    await supabase.from('warehouse_invoice_items').insert({
      invoice_id: whInvoice.id, nome_fattura: itemForm.nome_fattura,
      quantita: parseFloat(itemForm.quantita) || 0, unita: itemForm.unita,
      prezzo_unitario: parseFloat(itemForm.prezzo_unitario) || 0,
      prezzo_totale: parseFloat(itemForm.prezzo_totale) || 0, stato_match: 'non_abbinato',
    })
    setItemForm({ nome_fattura: '', quantita: '', unita: '', prezzo_unitario: '', prezzo_totale: '' })
    const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', whInvoice.id).order('id')
    setItems(data || [])
    setLoading(false)
  }

  const deleteItem = async (id) => {
    await supabase.from('warehouse_invoice_items').delete().eq('id', id)
    if (whInvoice) {
      const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', whInvoice.id).order('id')
      setItems(data || [])
    }
  }

  // ─── Fuzzy match ───────────────────────────────────────────────────
  const fuzzyScore = (keywords, text) => {
    if (!text) return 0
    const lower = text.toLowerCase()
    let score = 0, allMatch = true
    for (const kw of keywords) {
      if (lower.includes(kw)) { score += kw.length + 1 } else { allMatch = false }
    }
    if (lower === keywords.join(' ')) score += 10
    return allMatch ? score + keywords.length : score > 0 ? score * 0.5 : 0
  }

  const searchProducts = (q) => {
    setMatchSearch(q)
    if (q.length < 2) { setMatchResults([]); return }
    const keywords = q.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
    if (keywords.length === 0) { setMatchResults([]); return }
    const scored = products.map(p => {
      const nameScore = fuzzyScore(keywords, p.nome)
      const prodAliases = aliases.filter(a => a.product_id === p.id)
      const aliasScore = prodAliases.reduce((best, a) => Math.max(best, fuzzyScore(keywords, a.alias)), 0)
      const bestScore = Math.max(nameScore, aliasScore)
      const matchedVia = aliasScore > nameScore ? 'alias' : 'nome'
      return { ...p, score: bestScore, matchedVia }
    }).filter(p => p.score > 0).sort((a, b) => b.score - a.score)
    setMatchResults(scored.slice(0, 5))
  }

  useEffect(() => {
    if (items.length > 0 && products.length > 0) {
      const matched = {}
      for (const it of items) {
        if (it.stato_match === 'abbinato') continue
        const existingAlias = aliases.find(a => a.alias.toLowerCase() === it.nome_fattura.toLowerCase())
        if (existingAlias) { matched[it.id] = existingAlias.product_id; continue }
        const keywords = it.nome_fattura.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
        if (keywords.length === 0) continue
        const best = products.reduce((acc, p) => {
          const s = fuzzyScore(keywords, p.nome)
          return s > acc.score ? { product: p, score: s } : acc
        }, { product: null, score: 0 })
        if (best.product && best.score >= keywords.length * 3) matched[it.id] = best.product.id
      }
      setAutoMatched(matched)
    }
  }, [items, products, aliases])

  // ─── Nome articolo interno + UM + Qty ──────────────────────────
  const saveItemField = async (itemId, field, value) => {
    await supabase.from('warehouse_invoice_items').update({ [field]: value }).eq('id', itemId)
  }

  // Suggerisci nome articolo, qty reale e UM dalla descrizione fattura
  const suggestFromDescription = (desc) => {
    if (!desc) return { nome: '', qty: null, um: '' }
    const d = desc.toUpperCase()
    // Pulisci codice prodotto iniziale (es. "G800 ", "119430 ")
    let nome = desc.replace(/^[A-Z0-9]{2,8}\s+/, '').trim()
    // Rileva UM dalla descrizione
    let um = ''
    if (/\d+\s*LT\b|\d+\s*LITRI?|\d+L\b/i.test(d)) um = 'LT'
    else if (/\d+\s*KG\b|\d+\s*KILO/i.test(d)) um = 'KG'
    else if (/\d+\s*GR?\b|\d+\s*GRAMMI/i.test(d) && !/GROUP|GROU/i.test(d)) um = 'KG'
    else if (/\bPZ\b|\bBT\b|\bCF\b|\bCT\b|\bFS\b|\bVP\b|\bVAP\b|\bOW\b|\bCL\b/i.test(d)) um = 'PZ'
    // Rileva quantità reale (es. "6x1LT" → 6, "20 CL VP" con qty fattura=24 → 24)
    let qty = null
    const multiMatch = d.match(/(\d+)\s*[Xx]\s*[\d.,]+\s*(LT|KG|L|ML|CL)\b/i)
    if (multiMatch) qty = parseInt(multiMatch[1])
    const ltMatch = d.match(/([\d.,]+)\s*LT\b/i)
    if (ltMatch && !qty) {
      const litri = parseFloat(ltMatch[1].replace(',', '.'))
      if (litri > 0) qty = litri
    }
    const kgMatch = d.match(/([\d.,]+)\s*KG\b/i)
    if (kgMatch && !qty) {
      const kg = parseFloat(kgMatch[1].replace(',', '.'))
      if (kg > 0) qty = kg
    }
    // Pulisci nome: rimuovi codici, quantità, UM dal nome suggerito
    nome = nome.replace(/\d+\s*[Xx]\s*[\d.,]+\s*(LT|KG|L|ML|CL|GR?)\b/gi, '')
      .replace(/\b\d+\s*(LT|KG|GR?|ML|CL|PZ|BT|CF|CT|FS|VP|VAP|OW)\b/gi, '')
      .replace(/\s{2,}/g, ' ').trim()
    return { nome, qty, um }
  }

  // Pre-popola suggerimenti all'import
  const applySmartDefaults = async (importedItems) => {
    const updates = []
    for (const it of importedItems) {
      if (it.nome_articolo) continue // già compilato
      const s = suggestFromDescription(it.nome_fattura)
      const upd = {}
      if (s.nome) upd.nome_articolo = s.nome
      if (s.um) upd.unita = s.um
      if (s.qty != null) upd.quantita = s.qty
      if (Object.keys(upd).length > 0) {
        updates.push({ id: it.id, ...upd })
        await supabase.from('warehouse_invoice_items').update(upd).eq('id', it.id)
      }
    }
    if (updates.length > 0 && whInvoice) {
      const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', whInvoice.id).order('id')
      setItems(data || [])
    }
  }

  const confirmMatch = async (item, product) => {
    await supabase.from('warehouse_invoice_items').update({ product_id: product.id, stato_match: 'abbinato' }).eq('id', item.id)
    if (item.nome_fattura && item.nome_fattura.toLowerCase() !== product.nome.toLowerCase()) {
      await supabase.from('warehouse_aliases').insert({ product_id: product.id, alias: item.nome_fattura, confermato: true })
    }
    setMatchingItem(null); setMatchSearch(''); setMatchResults([])
    if (whInvoice) {
      const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', whInvoice.id).order('id')
      setItems(data || [])
    }
  }

  // ─── Render ────────────────────────────────────────────────────────
  return <>
    <Card title="Fatture TS Digital" badge={tsLoading ? '...' : `${tsFiltered.length} assegnate · Pag. ${tsPage + 1}`} extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => loadTsPage(tsPage)} disabled={tsLoading}
          style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
        >{tsLoading ? '...' : 'Aggiorna'}</button>
      </div>
    }>
      {tsFiltered.length === 0 && !tsLoading && (
        <div style={{ color: '#475569', textAlign: 'center', padding: 20, fontSize: 13 }}>
          {selectedLocaleName
            ? `Nessuna fattura assegnata a ${selectedLocaleName}. Assegna le fatture dal tab 📄 Fatture.`
            : 'Nessuna fattura assegnata. Vai al tab 📄 Fatture per assegnare le fatture ai locali.'}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {tsFiltered.length > 0 && <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['', 'Data', 'Fornitore', 'N° Doc', 'Tipo', 'Importo', 'Locale', 'Stato'].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>}
        <tbody>
          {tsFiltered.map((f, i) => {
            const isExp = expanded === f.hubId
            const locale = tsLocaleMap[f.hubId] || ''
            return <><tr key={f.hubId || i}
              onClick={() => handleExpand(f.hubId)}
              style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e', background: isExp ? '#131825' : 'transparent' }}>
              <td style={{ ...S.td, width: 24, color: '#64748b' }}>{isExp ? '▼' : '▶'}</td>
              <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{f.docDate}</td>
              <td style={{ ...S.td, fontWeight: 500 }}>{f.senderName || '—'}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{f.docId || '—'}</td>
              <td style={S.td}><span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>{f.detail?.td || 'TD01'}</span></td>
              <td style={{ ...S.td, fontWeight: 600 }}>{f.detail?.totalAmount != null ? fmt(f.detail.totalAmount) : '—'}</td>
              <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{locale}</td>
              <td style={S.td}>{whInvoice && isExp
                ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Importata</span>
                : <span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>TS Digital</span>
              }</td>
            </tr>

            {/* Expanded: righe XML o warehouse items con match */}
            {isExp && <tr key={'exp-' + f.hubId}><td colSpan={8} style={{ padding: '12px 14px 12px 38px', background: '#131825' }}>

              {/* Se non ancora importato in warehouse: mostra XML + bottone importa */}
              {!whInvoice && !loading && (
                <>
                  {xmlLoading && <div style={{ padding: 12, color: '#F59E0B', fontSize: 12 }}>Caricamento XML...</div>}
                  {xmlContent && xmlContent.length > 100 && (() => {
                    const lines = parseXmlLines(xmlContent)
                    return <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>{lines.length} righe nel XML</span>
                        <button onClick={() => importToWarehouse(f)}
                          style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                        >📥 Importa nel magazzino per match prodotti</button>
                      </div>
                      {lines.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>
                          {['Descrizione', 'Qty', 'UM', 'Prezzo unit.', 'Prezzo tot.', 'IVA %'].map(h => <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 8px' }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {lines.map((l, j) => <tr key={j}>
                            <td style={{ ...S.td, fontSize: 12, fontWeight: 500, padding: '6px 8px' }}>{l.descrizione}</td>
                            <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{l.quantita}</td>
                            <td style={{ ...S.td, fontSize: 11, color: '#64748b', padding: '6px 8px' }}>{l.um}</td>
                            <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{l.prezzoUnitario ? Number(l.prezzoUnitario).toFixed(2) + ' €' : ''}</td>
                            <td style={{ ...S.td, fontSize: 12, fontWeight: 600, padding: '6px 8px' }}>{l.prezzoTotale ? Number(l.prezzoTotale).toFixed(2) + ' €' : ''}</td>
                            <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', padding: '6px 8px' }}>{l.aliquotaIVA}%</td>
                          </tr>)}
                        </tbody>
                      </table>}
                    </>
                  })()}
                </>
              )}

              {loading && <div style={{ padding: 12, color: '#F59E0B', fontSize: 12 }}>Importazione in corso...</div>}

              {/* Se importato: mostra righe warehouse con match prodotti */}
              {whInvoice && (
                <>
                  <div style={{ fontSize: 12, color: '#10B981', marginBottom: 8 }}>✓ Importata nel magazzino — assegna il nome articolo interno</div>

                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                      {['Descrizione fattura', 'Nome articolo', 'Qty', 'UM', 'P. unit.', 'Totale', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 8px' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {items.length === 0 && <tr><td colSpan={7} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessuna riga</td></tr>}
                      {items.map(it => (
                        <tr key={it.id}>
                          <td style={{ ...S.td, fontSize: 11, padding: '6px 8px', color: '#94a3b8', maxWidth: 220 }}>{it.nome_fattura}</td>
                          <td style={{ ...S.td, padding: '6px 8px' }}>
                            <input
                              value={it.nome_articolo || ''}
                              placeholder="Nome interno..."
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, nome_articolo: e.target.value } : x))}
                              style={{ ...iS, fontSize: 11, padding: '3px 6px', width: '100%', fontWeight: 600, color: it.nome_articolo ? '#F59E0B' : '#475569' }}
                            />
                          </td>
                          <td style={{ ...S.td, padding: '6px 8px' }}>
                            <input type="number" step="0.01"
                              value={it.quantita ?? ''}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, quantita: e.target.value } : x))}
                              style={{ ...iS, fontSize: 11, padding: '3px 6px', width: 60, textAlign: 'center' }}
                            />
                          </td>
                          <td style={{ ...S.td, padding: '6px 8px' }}>
                            <select value={it.unita || ''}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, unita: e.target.value } : x))}
                              style={{ ...iS, fontSize: 10, padding: '2px 4px', width: 60, color: '#e2e8f0' }}>
                              <option value="">—</option>
                              <option value="KG">KG</option>
                              <option value="LT">LT</option>
                              <option value="PZ">PZ</option>
                            </select>
                          </td>
                          <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{fmt(it.prezzo_unitario)}</td>
                          <td style={{ ...S.td, fontWeight: 600, fontSize: 12, padding: '6px 8px' }}>{fmt(it.prezzo_totale)}</td>
                          <td style={{ ...S.td, padding: '6px 8px' }}>
                            <button onClick={async () => {
                              await saveItemField(it.id, 'nome_articolo', it.nome_articolo || '')
                              await saveItemField(it.id, 'quantita', parseFloat(it.quantita) || 0)
                              await saveItemField(it.id, 'unita', it.unita || '')
                              setItems(prev => prev.map(x => x.id === it.id ? { ...x, _saved: true } : x))
                              setTimeout(() => setItems(prev => prev.map(x => x.id === it.id ? { ...x, _saved: false } : x)), 1500)
                            }} style={{ ...iS, background: it._saved ? '#10B981' : '#F59E0B', color: '#0f1420', border: 'none', padding: '3px 8px', fontWeight: 700, fontSize: 10, cursor: 'pointer' }}>
                              {it._saved ? '✓' : '💾'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Match modal */}
                  {matchingItem && <div style={{ background: '#0f1420', borderRadius: 8, padding: 14, marginTop: 10, border: '1px solid #F59E0B' }}>
                    <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 6 }}>Abbina "{matchingItem.nome_fattura}" a un prodotto:</div>
                    <input placeholder="Cerca prodotto..." value={matchSearch} onChange={e => searchProducts(e.target.value)} style={{ ...formS, maxWidth: 300 }} autoFocus />
                    {matchResults.map(p => (
                      <div key={p.id} onClick={() => confirmMatch(matchingItem, p)} style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #2a3042', fontSize: 12, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>{p.nome}</span>
                        <span style={{ color: '#64748b', fontSize: 10 }}>({p.categoria} - {p.unita_misura})</span>
                        {p.matchedVia === 'alias' && <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.12)')}>alias</span>}
                      </div>
                    ))}
                    <button onClick={() => setMatchingItem(null)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '3px 10px', marginTop: 6, fontSize: 10 }}>Annulla</button>
                  </div>}
                </>
              )}
            </td></tr>}
            </>
          })}
        </tbody>
      </table>

      {/* Paginazione */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '0 4px' }}>
        <button onClick={() => loadTsPage(tsPage - 1)} disabled={tsPage === 0 || tsLoading}
          style={{ ...iS, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: tsPage === 0 ? 'not-allowed' : 'pointer',
            background: tsPage === 0 ? '#1a1f2e' : '#3B82F6', color: tsPage === 0 ? '#475569' : '#fff', border: 'none' }}
        >← Precedente</button>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          Pagina <strong style={{ color: '#e2e8f0' }}>{tsPage + 1}</strong>
          {' · '}{tsFiltered.length} assegnate su {tsInvoices.length}
        </span>
        <button onClick={() => loadTsPage(tsPage + 1)} disabled={!tsHasNext || tsLoading}
          style={{ ...iS, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: !tsHasNext ? 'not-allowed' : 'pointer',
            background: !tsHasNext ? '#1a1f2e' : '#3B82F6', color: !tsHasNext ? '#475569' : '#fff', border: 'none' }}
        >Successiva →</button>
      </div>
    </Card>
  </>
}
