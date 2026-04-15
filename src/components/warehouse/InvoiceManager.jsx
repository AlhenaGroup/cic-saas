import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }
const MAGAZZINI = ['food', 'beverage', 'materiali', 'attrezzatura', 'altro']
const TIPI_CONFEZIONE = ['Bottiglie', 'Fusto', 'Lattine', 'Cassa', 'Sacco', 'Confezione', 'Cartone', 'Pezzo', 'Altro']
const ESCLUDI_PATTERNS = /^(spese|addebito|accredito|cauzioni?|arrotondamento|sconto|abbuono|contributo|imballo|trasporto|spedizione|contrassegno|bollo|rivalsa|interessi)/i

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
  // Regole apprese (nome_fattura → escludi/magazzino/nome_articolo/unita)
  const [itemRules, setItemRules] = useState({})
  // Stato completamento fatture importate (hubId → {total, done})
  const [whStatus, setWhStatus] = useState({})
  // Filtro: 'tutte' | 'da_associare' | 'complete'
  const [filterStatus, setFilterStatus] = useState('tutte')

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

  const loadWhStatus = useCallback(async () => {
    // Carica tutte le fatture importate con conteggio righe associate
    const { data: invs } = await supabase.from('warehouse_invoices').select('id, numero, fornitore')
    if (!invs || invs.length === 0) { setWhStatus({}); return }
    const { data: items } = await supabase.from('warehouse_invoice_items').select('invoice_id, nome_articolo, escludi_magazzino')
    const status = {}
    for (const inv of invs) {
      const rows = (items || []).filter(it => it.invoice_id === inv.id)
      const total = rows.length
      const done = rows.filter(it => it.nome_articolo || it.escludi_magazzino).length
      // Trova il hubId corrispondente tramite numero+fornitore
      status[inv.numero + '||' + inv.fornitore] = { total, done, complete: total > 0 && done >= total }
    }
    setWhStatus(status)
  }, [])

  const loadProducts = useCallback(async () => {
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, categoria, unita_misura').eq('attivo', true).order('nome')
    setProducts(prods || [])
    const { data: als } = await supabase.from('warehouse_aliases').select('id, product_id, alias')
    setAliases(als || [])
    // Carica regole apprese
    const { data: rules } = await supabase.from('item_rules').select('*')
    const rulesMap = {}
    ;(rules || []).forEach(r => { rulesMap[r.nome_fattura_pattern.toLowerCase()] = r })
    setItemRules(rulesMap)
  }, [])

  useEffect(() => { loadTsPage(0); loadProducts(); loadWhStatus() }, [loadProducts, loadWhStatus])

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
    if (!assigned) return false
    if (selectedLocaleName && assigned !== selectedLocaleName && assigned !== 'Alhena Group') return false
    // Filtro completamento
    if (filterStatus !== 'tutte') {
      const key = (f.docId || '') + '||' + (f.senderName || '')
      const st = whStatus[key]
      if (filterStatus === 'complete' && (!st || !st.complete)) return false
      if (filterStatus === 'da_associare' && st && st.complete) return false
    }
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
  const suggestFromDescription = (desc, xmlUm) => {
    if (!desc) return { nome: '', qty: null, um: '' }
    const d = desc.toUpperCase()
    // Pulisci codice prodotto iniziale (es. "G800 ", "119430 ", "BIB ")
    let nome = desc.replace(/^[A-Z0-9]{2,10}\s+/, '').trim()
    // Rileva UM dalla descrizione
    let um = ''
    if (/\d+\s*LT\b|\d+\s*LITRI?|\d+L\b/i.test(d)) um = 'LT'
    else if (/\d+\s*KG\b|\d+\s*KILO/i.test(d)) um = 'KG'
    else if (/\d+\s*GR\b|\d+\s*GRAMMI/i.test(d)) um = 'KG'
    else if (/\bML\b|\bCL\b/i.test(d)) um = 'LT'
    else if (/\bLT\b|\bLITR/i.test(d)) um = 'LT'
    else if (/\bKG\b|\bKILO/i.test(d)) um = 'KG'
    else if (/\bFS\b|\bFUSTO\b/i.test(d)) um = 'LT'
    else if (/\bBT\b|\bVP\b|\bVAP\b|\bOW\b|\bCF\b|\bCT\b|\bPZ\b/i.test(d)) um = 'PZ'
    // Fallback: usa UM dal XML se presente
    if (!um && xmlUm) {
      const u = xmlUm.toUpperCase()
      if (u === 'LT' || u === 'L') um = 'LT'
      else if (u === 'KG') um = 'KG'
      else if (u === 'NR' || u === 'PZ' || u === 'N') um = 'PZ'
    }
    if (!um) um = 'PZ' // default PZ
    // Suggerisci magazzino
    let magazzino = 'food'
    if (/birr|vin[oa]|spirit|cocktail|coca|fanta|sprite|succo|prosecco|spumante|amaro|grappa|whisk|vodka|gin\b|rum\b|tonic|aperol|campari|spritz|beverage|drink|beer|wine|fusto|keg|sciroppo|the\b|te\b|tea\b|tisana|caffe|lattina/i.test(d)) magazzino = 'beverage'
    if (/tovaglio|piatt|bicchier|posate|busta|sacchett|pellicol|detersiv|sapon|carta|guant|contenitor|vaschett|monous|bobina|spugn/i.test(d)) magazzino = 'materiali'
    if (/attrezzatura|macchina|frigo|forno|lavastoviglie|robot|bilancia|termometro|coltello|padella|pentola|teglia/i.test(d)) magazzino = 'attrezzatura'
    // Escludi da magazzino?
    let escludi = ESCLUDI_PATTERNS.test(desc.trim())
    // Rileva quantità reale
    let qty = null
    const multiMatch = d.match(/(\d+)\s*[Xx]\s*[\d.,]+/i)
    if (multiMatch) qty = parseInt(multiMatch[1])
    const ltMatch = d.match(/([\d.,]+)\s*LT\b/i)
    if (ltMatch && !qty && um === 'LT') qty = parseFloat(ltMatch[1].replace(',', '.'))
    const kgMatch = d.match(/([\d.,]+)\s*KG\b/i)
    if (kgMatch && !qty && um === 'KG') qty = parseFloat(kgMatch[1].replace(',', '.'))
    const lMatch = d.match(/\b(\d+)\s*LT?\s*FS\b/i)
    if (lMatch && !qty) qty = parseInt(lMatch[1])
    // Pulisci nome: rimuovi codici, quantità, UM
    nome = nome
      .replace(/\d+\s*[Xx]\s*[\d.,]+\s*(LT|KG|L|ML|CL|GR)?\b/gi, '')
      .replace(/\b\d+[\s.,]*\d*\s*(LT|KG|GR|ML|CL|PZ|BT|CF|CT|FS|VP|VAP|OW)\b/gi, '')
      .replace(/\b(LT|KG|GR|ML|CL|PZ|BT|CF|CT|FS|VP|VAP|OW)\b/gi, '')
      .replace(/\s{2,}/g, ' ').trim()
    // Qty singola (capacità unitaria: 0.75L per bottiglia, 20L per fusto, ecc.)
    let qtySingola = null
    const clM = d.match(/(\d+)\s*CL\b/i)
    const mlM = d.match(/(\d+)\s*ML\b/i)
    const ltM2 = d.match(/([\d.,]+)\s*LT?\b/i)
    const kgM2 = d.match(/([\d.,]+)\s*KG\b/i)
    const grM2 = d.match(/(\d+)\s*GR\b/i)
    if (um === 'LT') {
      if (clM) qtySingola = parseInt(clM[1]) / 100
      else if (mlM) qtySingola = parseInt(mlM[1]) / 1000
      else if (ltM2) qtySingola = parseFloat(ltM2[1].replace(',', '.'))
    } else if (um === 'KG') {
      if (kgM2) qtySingola = parseFloat(kgM2[1].replace(',', '.'))
      else if (grM2) qtySingola = parseInt(grM2[1]) / 1000
    } else if (um === 'PZ') {
      qtySingola = 1
    }

    // Tipo confezione
    let tipo = ''
    if (/\bFS\b|\bFUSTO\b|\bFUSTI\b/i.test(d)) tipo = 'Fusto'
    else if (/\bBT\b|\bVP\b|\bVAP\b|\bOW\b|\b\d+\s*CL\b|\b75\s*CL\b|\b\d+\s*ML\b/i.test(d)) tipo = 'Bottiglie'
    else if (/\bLATT\b|\bCAN\b/i.test(d)) tipo = 'Lattine'
    else if (/\bCF\b|\bCONF\b/i.test(d)) tipo = 'Confezione'
    else if (/\bCT\b|\bCARTON/i.test(d)) tipo = 'Cartone'
    else if (/\bSACCO\b|\bSACCH/i.test(d)) tipo = 'Sacco'
    else if (um === 'KG') tipo = 'Confezione'
    else if (um === 'PZ') tipo = 'Pezzo'
    else tipo = 'Bottiglie'

    // Totale UM: qty × capacità unitaria
    let totaleUm = null
    if (um === 'LT') {
      // Cerca capacità unitaria (es. 75CL = 0.75L, 1LT, 20LT, 25CL)
      const clMatch = d.match(/(\d+)\s*CL\b/i)
      const ltMatch2 = d.match(/([\d.,]+)\s*LT?\b/i)
      const mlMatch = d.match(/(\d+)\s*ML\b/i)
      let unitCap = null
      if (clMatch) unitCap = parseInt(clMatch[1]) / 100
      else if (ltMatch2) unitCap = parseFloat(ltMatch2[1].replace(',', '.'))
      else if (mlMatch) unitCap = parseInt(mlMatch[1]) / 1000
      if (unitCap && qty) totaleUm = Math.round(qty * unitCap * 100) / 100
      else if (unitCap) totaleUm = unitCap
    } else if (um === 'KG') {
      const kgM = d.match(/([\d.,]+)\s*KG\b/i)
      const grM = d.match(/(\d+)\s*GR?\b/i)
      let unitW = null
      if (kgM) unitW = parseFloat(kgM[1].replace(',', '.'))
      else if (grM) unitW = parseInt(grM[1]) / 1000
      if (unitW && qty) totaleUm = Math.round(qty * unitW * 100) / 100
      else if (unitW) totaleUm = unitW
    } else if (um === 'PZ') {
      totaleUm = qty || null
    }

    // TOT calcolato
    let totaleUm2 = null
    if (qty && qtySingola) totaleUm2 = Math.round(qty * qtySingola * 1000) / 1000

    return { nome, qty, um, magazzino, escludi, tipo, qtySingola, totaleUm: totaleUm2 }
  }

  // Pre-popola suggerimenti all'import — compila nome, qty, UM, magazzino, escludi
  const applySmartDefaults = async (importedItems) => {
    for (const it of importedItems) {
      const key = (it.nome_fattura || '').toLowerCase().trim()
      const rule = itemRules[key]
      const s = suggestFromDescription(it.nome_fattura, it.unita)
      const upd = {}
      // Regola appresa ha priorità
      if (rule) {
        if (rule.nome_articolo_default && !it.nome_articolo) upd.nome_articolo = rule.nome_articolo_default
        if (rule.unita_default) upd.unita = rule.unita_default
        if (rule.magazzino) upd.magazzino = rule.magazzino
        if (rule.escludi_magazzino != null) upd.escludi_magazzino = rule.escludi_magazzino
        if (rule.tipo_confezione_default) upd.tipo_confezione = rule.tipo_confezione_default
        if (rule.qty_singola_default) upd.qty_singola = rule.qty_singola_default
      } else {
        if (s.nome && !it.nome_articolo) upd.nome_articolo = s.nome
        if (s.um) upd.unita = s.um
        if (s.magazzino) upd.magazzino = s.magazzino
        if (s.escludi) upd.escludi_magazzino = true
        if (s.tipo) upd.tipo_confezione = s.tipo
        if (s.qtySingola != null) upd.qty_singola = s.qtySingola
        if (s.totaleUm != null) upd.totale_um = s.totaleUm
      }
      if (s.qty != null) upd.quantita = s.qty
      if (Object.keys(upd).length > 0) {
        await supabase.from('warehouse_invoice_items').update(upd).eq('id', it.id)
      }
    }
    if (whInvoice) {
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
    <Card title="Fatture TS Digital" badge={tsLoading ? '...' : `${tsFiltered.length} · Pag. ${tsPage + 1}`} extra={
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {['tutte', 'da_associare', 'complete'].map(f => (
          <button key={f} onClick={() => setFilterStatus(f)}
            style={{ ...iS, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: filterStatus === f ? (f === 'complete' ? '#10B981' : f === 'da_associare' ? '#F59E0B' : '#3B82F6') : 'transparent',
              color: filterStatus === f ? '#0f1420' : '#94a3b8',
            }}>{f === 'tutte' ? 'Tutte' : f === 'da_associare' ? 'Da associare' : 'Associate'}</button>
        ))}
        <button onClick={() => { loadTsPage(tsPage); loadWhStatus() }} disabled={tsLoading}
          style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}
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
              <td style={S.td}>{(() => {
                const key = (f.docId || '') + '||' + (f.senderName || '')
                const st = whStatus[key]
                if (!st) return <span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>Da importare</span>
                if (st.complete) return <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>✓ {st.done}/{st.total}</span>
                return <span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>{st.done}/{st.total}</span>
              })()}</td>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#10B981' }}>✓ Importata nel magazzino — assegna il nome articolo interno</span>
                    <button onClick={async () => {
                      setLoading(true)
                      // Applica regole apprese a TUTTE le righe di TUTTE le fatture importate
                      const { data: allItems } = await supabase.from('warehouse_invoice_items').select('id, nome_fattura, nome_articolo, unita, magazzino, escludi_magazzino, tipo_confezione')
                      let updated = 0
                      for (const it of (allItems || [])) {
                        const key = (it.nome_fattura || '').toLowerCase().trim()
                        const rule = itemRules[key]
                        if (!rule) continue
                        const upd = {}
                        if (rule.nome_articolo_default && !it.nome_articolo) upd.nome_articolo = rule.nome_articolo_default
                        if (rule.unita_default && it.unita !== rule.unita_default) upd.unita = rule.unita_default
                        if (rule.magazzino && it.magazzino !== rule.magazzino) upd.magazzino = rule.magazzino
                        if (rule.escludi_magazzino != null && it.escludi_magazzino !== rule.escludi_magazzino) upd.escludi_magazzino = rule.escludi_magazzino
                        if (rule.tipo_confezione_default && it.tipo_confezione !== rule.tipo_confezione_default) upd.tipo_confezione = rule.tipo_confezione_default
                        if (Object.keys(upd).length > 0) {
                          await supabase.from('warehouse_invoice_items').update(upd).eq('id', it.id)
                          updated++
                        }
                      }
                      // Ricarica righe della fattura corrente
                      if (whInvoice) {
                        const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', whInvoice.id).order('id')
                        setItems(data || [])
                      }
                      setLoading(false)
                      alert(`Regole applicate a ${updated} righe su ${(allItems||[]).length} totali`)
                    }} disabled={loading}
                      style={{ ...iS, background: '#8B5CF6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
                    >{loading ? '...' : '🔄 Applica regole a tutte le fatture'}</button>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                      {['Mag.', 'Descrizione fattura', 'Nome articolo', 'Qty', 'Tipo', 'Q.Sing.', 'UM', 'TOT', '€/UM', 'Tot. €', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 8, padding: '4px 3px' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {items.length === 0 && <tr><td colSpan={11} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessuna riga</td></tr>}
                      {items.map(it => {
                        const suggestion = suggestFromDescription(it.nome_fattura, it.unita)
                        const rule = itemRules[(it.nome_fattura || '').toLowerCase().trim()]
                        const displayNome = it.nome_articolo || rule?.nome_articolo_default || suggestion?.nome || ''
                        const displayUm = it.unita || rule?.unita_default || suggestion?.um || ''
                        const displayMag = it.magazzino || rule?.magazzino || suggestion?.magazzino || 'food'
                        const displayTipo = it.tipo_confezione || rule?.tipo_confezione_default || suggestion?.tipo || ''
                        const displayQtySing = it.qty_singola ?? rule?.qty_singola_default ?? suggestion?.qtySingola ?? ''
                        const isExcluded = it.escludi_magazzino ?? rule?.escludi_magazzino ?? suggestion?.escludi ?? false
                        // Calcola TOT = QTY × Q.Sing.
                        const qty = parseFloat(it.quantita) || 0
                        const qSing = parseFloat(it.qty_singola ?? displayQtySing) || 0
                        const autoTot = qty > 0 && qSing > 0 ? Math.round(qty * qSing * 1000) / 1000 : null
                        const displayTot = it.totale_um ?? autoTot ?? ''
                        return <tr key={it.id} style={{ opacity: isExcluded ? 0.4 : 1, background: isExcluded ? 'rgba(239,68,68,.05)' : 'transparent' }}>
                          <td style={{ ...S.td, padding: '5px 6px' }}>
                            {isExcluded
                              ? <button onClick={() => setItems(prev => prev.map(x => x.id === it.id ? { ...x, escludi_magazzino: false } : x))}
                                  title="Escluso — click per includere"
                                  style={{ background: 'none', border: '1px solid #EF4444', color: '#EF4444', borderRadius: 4, fontSize: 9, padding: '2px 4px', cursor: 'pointer' }}>✗</button>
                              : <select value={displayMag}
                                  onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, magazzino: e.target.value } : x))}
                                  style={{ ...iS, fontSize: 9, padding: '2px 2px', width: 70, color: '#e2e8f0' }}>
                                  {MAGAZZINI.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            }
                          </td>
                          <td style={{ ...S.td, fontSize: 10, padding: '5px 6px', color: '#94a3b8', maxWidth: 180 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nome_fattura}</span>
                              {!isExcluded && <button onClick={() => setItems(prev => prev.map(x => x.id === it.id ? { ...x, escludi_magazzino: true } : x))}
                                title="Escludi dal magazzino"
                                style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 10, flexShrink: 0 }}>✗</button>}
                            </div>
                          </td>
                          <td style={{ ...S.td, padding: '5px 6px' }}>
                            <input value={displayNome}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, nome_articolo: e.target.value } : x))}
                              style={{ ...iS, fontSize: 10, padding: '3px 5px', width: '100%', fontWeight: 600, color: it.nome_articolo ? '#F59E0B' : '#8B5CF6' }}
                            />
                          </td>
                          <td style={{ ...S.td, padding: '4px 4px' }}>
                            <input type="number" step="0.01" value={it.quantita ?? ''}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, quantita: e.target.value } : x))}
                              style={{ ...iS, fontSize: 10, padding: '2px 3px', width: 45, textAlign: 'center' }}
                            />
                          </td>
                          <td style={{ ...S.td, padding: '4px 4px' }}>
                            <select value={displayTipo}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, tipo_confezione: e.target.value } : x))}
                              style={{ ...iS, fontSize: 9, padding: '2px 2px', width: 75, color: '#e2e8f0' }}>
                              <option value="">—</option>
                              {TIPI_CONFEZIONE.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td style={{ ...S.td, padding: '4px 3px' }}>
                            <input type="number" step="0.001"
                              value={it.qty_singola ?? displayQtySing ?? ''}
                              onChange={e => {
                                const val = e.target.value
                                setItems(prev => prev.map(x => {
                                  if (x.id !== it.id) return x
                                  const newQS = parseFloat(val) || 0
                                  const newQty = parseFloat(x.quantita) || 0
                                  const newTot = newQty > 0 && newQS > 0 ? Math.round(newQty * newQS * 1000) / 1000 : x.totale_um
                                  return { ...x, qty_singola: val, totale_um: newTot }
                                }))
                              }}
                              style={{ ...iS, fontSize: 10, padding: '2px 3px', width: 50, textAlign: 'center', color: '#8B5CF6' }}
                            />
                          </td>
                          <td style={{ ...S.td, padding: '4px 3px' }}>
                            <select value={displayUm}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, unita: e.target.value } : x))}
                              style={{ ...iS, fontSize: 9, padding: '2px 2px', width: 42, color: '#e2e8f0' }}>
                              <option value="">—</option>
                              <option value="KG">KG</option>
                              <option value="LT">LT</option>
                              <option value="PZ">PZ</option>
                            </select>
                          </td>
                          <td style={{ ...S.td, padding: '4px 4px' }}>
                            <input type="number" step="0.01" value={it.totale_um ?? displayTot ?? ''}
                              onChange={e => setItems(prev => prev.map(x => x.id === it.id ? { ...x, totale_um: e.target.value } : x))}
                              style={{ ...iS, fontSize: 10, padding: '2px 3px', width: 50, textAlign: 'center', color: '#10B981' }}
                            />
                          </td>
                          <td style={{ ...S.td, fontSize: 10, padding: '4px 4px', color: '#64748b' }}>{(() => {
                            // €/UM = prezzo_totale / totale_um (prezzo per LT/KG/PZ)
                            const tot = parseFloat(it.totale_um ?? displayTot) || 0
                            const prezzoTot = Math.abs(parseFloat(it.prezzo_totale) || 0)
                            if (tot > 0 && prezzoTot > 0) return fmt(Math.round(prezzoTot / tot * 100) / 100) + '/' + (displayUm || '?')
                            return '—'
                          })()}</td>
                          <td style={{ ...S.td, fontWeight: 600, fontSize: 10, padding: '4px 4px' }}>{fmt(it.prezzo_totale)}</td>
                          <td style={{ ...S.td, padding: '5px 6px' }}>
                            <button onClick={async () => {
                              const nameToSave = it.nome_articolo || displayNome
                              const umToSave = it.unita || displayUm
                              const magToSave = it.magazzino || displayMag
                              const tipoToSave = it.tipo_confezione || displayTipo
                              const exclToSave = it.escludi_magazzino ?? isExcluded
                              const qSingToSave = parseFloat(it.qty_singola ?? displayQtySing) || 0
                              const totToSave = parseFloat(it.totale_um) || (qty > 0 && qSingToSave > 0 ? Math.round(qty * qSingToSave * 1000) / 1000 : 0)
                              // Salva sulla riga
                              await supabase.from('warehouse_invoice_items').update({
                                nome_articolo: nameToSave, quantita: parseFloat(it.quantita) || 0,
                                unita: umToSave, magazzino: magToSave, escludi_magazzino: exclToSave,
                                tipo_confezione: tipoToSave, qty_singola: qSingToSave, totale_um: totToSave,
                              }).eq('id', it.id)
                              // Memorizza regola per le prossime fatture
                              const key = (it.nome_fattura || '').toLowerCase().trim()
                              if (key) {
                                const { data: { user } } = await supabase.auth.getUser()
                                if (user) {
                                  await supabase.from('item_rules').upsert({
                                    user_id: user.id, nome_fattura_pattern: key,
                                    nome_articolo_default: nameToSave, unita_default: umToSave,
                                    magazzino: magToSave, escludi_magazzino: exclToSave,
                                    tipo_confezione_default: tipoToSave, qty_singola_default: qSingToSave,
                                  }, { onConflict: 'user_id,nome_fattura_pattern' })
                                  setItemRules(prev => ({ ...prev, [key]: { nome_articolo_default: nameToSave, unita_default: umToSave, magazzino: magToSave, escludi_magazzino: exclToSave, tipo_confezione_default: tipoToSave, qty_singola_default: qSingToSave } }))
                                }
                              }
                              setItems(prev => prev.map(x => x.id === it.id ? { ...x, nome_articolo: nameToSave, unita: umToSave, magazzino: magToSave, escludi_magazzino: exclToSave, tipo_confezione: tipoToSave, qty_singola: qSingToSave, totale_um: totToSave, _saved: true } : x))
                              setTimeout(() => setItems(prev => prev.map(x => x.id === it.id ? { ...x, _saved: false } : x)), 1500)
                            }} style={{ ...iS, background: it._saved ? '#10B981' : '#F59E0B', color: '#0f1420', border: 'none', padding: '3px 8px', fontWeight: 700, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {it._saved ? '✓' : '💾'}
                            </button>
                          </td>
                        </tr>
                      })}
                    </tbody>
                  </table>
                  </div>

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
