import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtD, fmtN } from '../shared/styles.jsx'

const iS = S.input

// Cache in memoria: sopravvive al remount del componente dentro la stessa sessione
// Key = sp, Value = { cicProducts, articles, recipes, ts }
const MEM_CACHE = {}
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minuti

export default function RecipeManager({ sp, sps }) {
  // Prodotti venduti su CiC
  const [cicProducts, setCicProducts] = useState([])
  // Articoli acquistati (da warehouse_invoice_items con nome_articolo)
  const [articles, setArticles] = useState([])
  // Semilavorati (manual_articles) — ingredienti prodotti internamente
  const [manualArticles, setManualArticles] = useState([])
  // Ricette salvate
  const [recipes, setRecipes] = useState({}) // nome_prodotto recipe
  const [loading, setLoading] = useState(false)
  // UI
  const [selected, setSelected] = useState(null) // prodotto selezionato per editare ricetta
  const [search, setSearch] = useState(() => localStorage.getItem('recipe_search') || '')
  const [filter, setFilter] = useState(() => localStorage.getItem('recipe_filter') || 'tutti') // tutti, con_ricetta, senza_ricetta
  const [ingredientSearch, setIngredientSearch] = useState('')
  useEffect(() => { localStorage.setItem('recipe_search', search) }, [search])
  useEffect(() => { localStorage.setItem('recipe_filter', filter) }, [filter])
  useEffect(() => {
    if (selected?.name) localStorage.setItem('recipe_selected', selected.name)
    else localStorage.removeItem('recipe_selected')
  }, [selected])
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState('')

  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async (force = false) => {
    const cacheKey = String(sp || 'all')
    const cached = MEM_CACHE[cacheKey]
    if (!force && cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      setCicProducts(cached.cicProducts)
      setArticles(cached.articles)
      setManualArticles(cached.manualArticles || [])
      setRecipes(cached.recipes)
      setLoading(false)
      return
    }
    setLoading(true)
    // 1. Prodotti CiC da receipt_details
    let query = supabase.from('daily_stats').select('receipt_details, salespoint_name')
    if (sp && sp !== 'all') {
      const asNum = Number(sp)
      if (!Number.isNaN(asNum) && String(asNum) === String(sp)) query = query.eq('salespoint_id', asNum)
      else if (selectedLocaleName) query = query.eq('salespoint_name', selectedLocaleName)
    }
    const { data: rows } = await query
    const prodMap = {}
    ;(rows || []).forEach(row => {
      ;(row.receipt_details || []).forEach(receipt => {
        ;(receipt.items || []).forEach(item => {
          const name = item.nome || item.description || ''
          if (!name) return
          const price = Number(item.prezzo) || Number(item.totalPrice) || 0
          const qty = Number(item.qty) || Number(item.quantity) || 1
          const reparto = item.reparto || item.department?.description || '—'
          if (!prodMap[name]) prodMap[name] = { name, reparto, revenue: 0, qty: 0 }
          prodMap[name].revenue += price
          prodMap[name].qty += qty
          if (prodMap[name].reparto === '—' && reparto !== '—') prodMap[name].reparto = reparto
        })
      })
    })
    const prods = Object.values(prodMap).filter(p => p.qty > 0).map(p => ({
      ...p, avgPrice: p.qty > 0 ? Math.round(p.revenue / p.qty * 100) / 100 : 0,
    })).sort((a, b) => b.qty - a.qty)
    setCicProducts(prods)

    // 2. Articoli acquistati con prezzi
    // Pagina warehouse_invoice_items per superare il limite di 1000 di Supabase
    // (oggi ~1374 righe; senza pagina si perdevano alcuni articoli come "Sale").
    const items = []
    {
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase.from('warehouse_invoice_items')
          .select('nome_articolo, unita, quantita, qty_singola, prezzo_totale, totale_um, escludi_magazzino')
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        items.push(...data)
        if (data.length < PAGE) break
      }
    }
    const artMap = {}
    ;(items || []).forEach(it => {
      if (it.escludi_magazzino || !it.nome_articolo) return
      const key = it.nome_articolo.toLowerCase().trim()
      if (!artMap[key]) artMap[key] = { nome: it.nome_articolo, unita: it.unita || '', prezzi: [] }
      // Prezzo per UM reale = spesa / (qty fatt × qty del tipo × capacita unitaria)
      const qtyFatt = Number(it.quantita) || 0
      const qtyTipo = Number(it.totale_um) || 0
      const qSing   = Number(it.qty_singola) || 0
      const totUnita = qtyFatt * qtyTipo * qSing
      const spesa = Math.abs(Number(it.prezzo_totale)) || 0
      if (totUnita > 0 && spesa > 0) artMap[key].prezzi.push(spesa / totUnita)
    })
    const arts = Object.values(artMap).map(a => ({
      ...a, prezzoMedio: a.prezzi.length > 0 ? a.prezzi.reduce((s, v) => s + v, 0) / a.prezzi.length : 0,
    })).sort((a, b) => a.nome.localeCompare(b.nome))
    setArticles(arts)

    // 2.5. Semilavorati (manual_articles)
    const { data: mans } = await supabase.from('manual_articles').select('*')
    setManualArticles(mans || [])

    // 3. Ricette salvate
    const { data: recs } = await supabase.from('recipes').select('*')
    const recMap = {}
    ;(recs || []).forEach(r => { recMap[r.nome_prodotto] = r })
    setRecipes(recMap)

    // Salva in cache per evitare refetch al prossimo mount
    MEM_CACHE[cacheKey] = { cicProducts: prods, articles: arts, manualArticles: mans || [], recipes: recMap, ts: Date.now() }

    setLoading(false)
  }, [sp, selectedLocaleName])

  useEffect(() => { load() }, [load])

  // Ripristina ricetta selezionata dopo caricamento prodotti
  useEffect(() => {
    if (selected || cicProducts.length === 0) return
    const savedName = localStorage.getItem('recipe_selected')
    if (!savedName) return
    const prod = cicProducts.find(p => p.name === savedName)
    if (prod) setSelected(prod)
  }, [cicProducts, selected])

  // Filtro prodotti
  const filtered = useMemo(() => {
    let list = [...cicProducts]
    if (search) list = list.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    if (filter === 'con_ricetta') list = list.filter(p => recipes[p.name] && (recipes[p.name].ingredienti || []).length > 0)
    if (filter === 'senza_ricetta') list = list.filter(p => !recipes[p.name] || (recipes[p.name].ingredienti || []).length === 0)
    return list
  }, [cicProducts, search, filter, recipes])

  // Ricetta del prodotto selezionato
  const selectedRecipe = selected ? recipes[selected.name] : null
  const ingredienti = selectedRecipe?.ingredienti || []

  // Converti quantità in UM base per calcolo costo (gKG, clLT)
  const toBaseUnit = (qty, um) => {
    const q = Number(qty) || 0
    const u = um || 'PZ'
    if (u === 'g') return { qty: q / 1000, baseUm: 'KG' }
    if (u === 'cl') return { qty: q / 100, baseUm: 'LT' }
    if (u === 'ml') return { qty: q / 1000, baseUm: 'LT' }
    return { qty: q, baseUm: u }
  }

  // Mappa nome semilavorato per lookup rapido
  const manualByName = {}
  for (const m of manualArticles) manualByName[m.nome.trim().toLowerCase()] = m

  // Costo unitario di un singolo ingrediente (€/UM_base):
  //  - se e' un semilavorato ricorre sulla sub-ricetta (somma costi / resa)
  //  - altrimenti cerca prezzo medio in articles (warehouse_invoice_items)
  //  - se l'ingrediente non e' in articoli (es. "Acqua potabile") torna 0
  const ingrUnitCost = (nome, depth = 0) => {
    if (depth > 8) return 0 // protezione cicli
    const key = (nome || '').trim().toLowerCase()
    if (manualByName[key]) {
      const m = manualByName[key]
      let total = 0
      for (const sub of (m.ingredienti || [])) {
        const { qty } = toBaseUnit(sub.quantita || 0, sub.unita || 'PZ')
        total += qty * ingrUnitCost(sub.nome_articolo, depth + 1)
      }
      const { qty: resaBase } = toBaseUnit(Number(m.resa) || 1, m.unita || 'PZ')
      return resaBase > 0 ? total / resaBase : 0
    }
    const art = articles.find(a => a.nome.toLowerCase() === key)
    if (art && art.prezzoMedio > 0) return art.prezzoMedio
    return 0
  }

  // Calcolo food cost con conversione unità (include semilavorati e scarto)
  // Scarto in UM: qty registrata e' netta. qty_lorda = qty + scarto (stessa baseUm).
  const calcCost = (ingr) => {
    let total = 0
    for (const ig of ingr) {
      const cost = ingrUnitCost(ig.nome_articolo)
      if (cost <= 0) continue
      const base = toBaseUnit(ig.quantita || 0, ig.unita || 'PZ')
      let qtyLorda = base.qty
      if (Number(ig.scarto) > 0) {
        const sc = toBaseUnit(Number(ig.scarto), ig.scarto_unita || ig.unita)
        if (sc.baseUm === base.baseUm) qtyLorda = base.qty + sc.qty
      } else if (Number(ig.scarto_pct) > 0) {
        const pct = Math.max(0, Math.min(99, Number(ig.scarto_pct)))
        qtyLorda = base.qty / (1 - pct / 100)
      }
      total += qtyLorda * cost
    }
    return Math.round(total * 100) / 100
  }

  const foodCost = calcCost(ingredienti)
  const fcPct = selected && selected.avgPrice > 0 ? Math.round(foodCost / selected.avgPrice * 10000) / 100 : 0

  // Salva ricetta
  const saveRecipe = async (prodName, ingr) => {
    setSaveStatus('saving')
    setSaveError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Utente non autenticato')
      const prod = cicProducts.find(p => p.name === prodName)
      const { error } = await supabase.from('recipes').upsert({
        user_id: user.id,
        nome_prodotto: prodName,
        reparto: prod?.reparto || '',
        prezzo_vendita: prod?.avgPrice || 0,
        ingredienti: ingr,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,nome_prodotto' })
      if (error) throw error
      setRecipes(prev => {
        const next = { ...prev, [prodName]: { ...prev[prodName], ingredienti: ingr, prezzo_vendita: prod?.avgPrice || 0 } }
        // Propaga alla cache in memoria così al remount i dati sono aggiornati
        const cacheKey = String(sp || 'all')
        if (MEM_CACHE[cacheKey]) MEM_CACHE[cacheKey] = { ...MEM_CACHE[cacheKey], recipes: next, ts: Date.now() }
        return next
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
    } catch (e) {
      setSaveError(e.message || 'Errore sconosciuto')
      setSaveStatus('error')
    }
  }

  // Aggiungi ingrediente esistente (articolo magazzino o semilavorato)
  const addIngredient = (artNome) => {
    if (!selected) return
    const art = articles.find(a => a.nome === artNome)
    const man = manualArticles.find(m => m.nome === artNome)
    if (!art && !man) return
    const nome = art ? art.nome : man.nome
    const unita = art ? art.unita : man.unita
    const newIngr = [...ingredienti, { nome_articolo: nome, quantita: 0, unita }]
    saveRecipe(selected.name, newIngr)
    setIngredientSearch('')
  }

  // Aggiungi ingrediente "libero" (es. "Acqua potabile") — costo 0 €/UM, UM PZ default
  // Flag `gratis: true` segna l'ingrediente come gratuito intenzionale: non
  // verra' conteggiato come "mancante prezzo".
  const addFreeIngredient = (nome) => {
    if (!selected || !nome.trim()) return
    const newIngr = [...ingredienti, { nome_articolo: nome.trim(), quantita: 0, unita: 'PZ', gratis: true }]
    saveRecipe(selected.name, newIngr)
    setIngredientSearch('')
  }

  // Aggiorna campo ingrediente e salva
  const updateIngredient = (idx, field, value) => {
    const newIngr = ingredienti.map((ig, i) => i === idx ? { ...ig, [field]: value } : ig)
    saveRecipe(selected.name, newIngr)
  }

  // Rimuovi ingrediente
  const removeIngredient = (idx) => {
    const newIngr = ingredienti.filter((_, i) => i !== idx)
    saveRecipe(selected.name, newIngr)
  }

  // Articoli filtrati per ricerca ingrediente: include articoli magazzino e semilavorati
  const allSelectable = [
    ...articles.map(a => ({ nome: a.nome, unita: a.unita, prezzoMedio: a.prezzoMedio, kind: 'art' })),
    ...manualArticles.map(m => ({
      nome: m.nome,
      unita: m.unita,
      prezzoMedio: ingrUnitCost(m.nome),
      kind: 'man',
    })),
  ]
  const filteredArticles = ingredientSearch.length >= 2
    ? allSelectable.filter(a => a.nome.toLowerCase().includes(ingredientSearch.toLowerCase()) && !ingredienti.some(ig => ig.nome_articolo.toLowerCase() === a.nome.toLowerCase()))
    : []
  // Verifica se la stringa cercata matcha esattamente (case-insensitive) un articolo gia' esistente
  const normalizeStr = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ')
  const exactMatch = ingredientSearch.length >= 2
    ? allSelectable.find(a => normalizeStr(a.nome) === normalizeStr(ingredientSearch))
    : null

  const conRicetta = cicProducts.filter(p => recipes[p.name] && (recipes[p.name].ingredienti || []).length > 0).length

  return <div style={{ display: 'flex', gap: 16, flexDirection: selected ? 'row' : 'column' }}>
    {/* Lista prodotti */}
    <div style={{ flex: selected ? '0 0 45%' : '1' }}>
      <Card title="Prodotti venduti" badge={loading ? '...' : `${filtered.length} prodotti · ${conRicetta} con ricetta`} extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...iS, fontSize: 11, padding: '4px 8px', width: 130 }} />
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...iS, fontSize: 10, padding: '4px 6px' }}>
            <option value="tutti">Tutti</option>
            <option value="con_ricetta">Con ricetta</option>
            <option value="senza_ricetta">Senza ricetta</option>
          </select>
        </div>
      }>
        {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)' }}>Caricamento...</div>}
        <div style={{ maxHeight: selected ? 500 : 600, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Prodotto', 'Reparto', 'Prezzo', 'Venduti', 'FC', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 9 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map((p, i) => {
                const rec = recipes[p.name]
                const hasRecipe = rec && (rec.ingredienti || []).length > 0
                const fc = hasRecipe ? calcCost(rec.ingredienti) : 0
                const pct = hasRecipe && p.avgPrice > 0 ? Math.round(fc / p.avgPrice * 10000) / 100 : 0
                return <tr key={i}
                  onClick={() => { setSaveStatus('idle'); setSaveError(''); setSelected(selected?.name === p.name ? null : p) }}
                  style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e', background: selected?.name === p.name ? '#131825' : 'transparent' }}>
                  <td style={{ ...S.td, fontWeight: 600, fontSize: 12 }}>{p.name}</td>
                  <td style={{ ...S.td, fontSize: 10, color: 'var(--text2)' }}>{p.reparto}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>{fmtD(p.avgPrice)}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{fmtN(p.qty)}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>
                    {hasRecipe
                      ? <span style={{ color: pct > 35 ? '#EF4444' : pct > 25 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>{pct}%</span>
                      : <span style={{ color: 'var(--text3)', fontSize: 10 }}>—</span>}
                  </td>
                  <td style={{ ...S.td, fontSize: 10 }}>
                    {hasRecipe ? <span style={{ color: '#10B981' }}></span> : null}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>

    {/* Editor ricetta */}
    {selected && <div style={{ flex: '1' }}>
      <Card title={`Ricetta: ${selected.name}`} extra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {saveStatus === 'saving' && (
            <span style={{ fontSize: 11, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>⏳ Salvando…</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ fontSize: 11, color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Salvato</span>
          )}
          {saveStatus === 'error' && (
            <span title={saveError} style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>Errore</span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>{selected.reparto} · {fmtD(selected.avgPrice)}</span>
        </div>
      }>
        {/* KPI food cost */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
          <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>Food Cost</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B', marginTop: 2 }}>{fmtD(foodCost)}</div>
          </div>
          <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>FC %</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: fcPct > 35 ? '#EF4444' : fcPct > 25 ? '#F59E0B' : '#10B981', marginTop: 2 }}>{fcPct}%</div>
          </div>
          <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>MOL</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981', marginTop: 2 }}>{fmtD(selected.avgPrice - foodCost)}</div>
          </div>
        </div>

        {/* Tabella ingredienti */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Articolo', 'Qty', 'UM', 'Scarto', 'UM scarto', '€/UM', 'Costo', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 9 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {ingredienti.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: 'var(--text3)', textAlign: 'center', fontSize: 12 }}>Nessun ingrediente. Cerca e aggiungi articoli.</td></tr>}
            {ingredienti.map((ig, idx) => {
              if (!ig || !ig.nome_articolo) return null
              const key = (ig.nome_articolo || '').toLowerCase()
              const isManual = !!manualByName[key]
              const art = articles.find(a => a.nome.toLowerCase() === key)
              // Per i semilavorati uso ingrUnitCost; per articoli usa prezzoMedio
              const prezzoUmBase = isManual ? ingrUnitCost(ig.nome_articolo) : (art?.prezzoMedio || 0)
              const igUm = ig.unita || art?.unita || (isManual ? manualByName[key].unita : 'PZ')
              const { qty: qtyBase, baseUm } = toBaseUnit(ig.quantita, igUm)
              let qtyLorda = qtyBase
              if (Number(ig.scarto) > 0) {
                const sc = toBaseUnit(Number(ig.scarto), ig.scarto_unita || igUm)
                if (sc.baseUm === baseUm) qtyLorda = qtyBase + sc.qty
              } else if (Number(ig.scarto_pct) > 0) {
                const pct = Math.max(0, Math.min(99, Number(ig.scarto_pct)))
                qtyLorda = qtyBase / (1 - pct / 100)
              }
              const costo = qtyLorda * prezzoUmBase
              let prezzoDisplay = '—'
              try {
                if (prezzoUmBase > 0) {
                  if (igUm === 'g') prezzoDisplay = fmtD(Math.round(prezzoUmBase / 1000 * 10000) / 10000) + '/g'
                  else if (igUm === 'cl') prezzoDisplay = fmtD(Math.round(prezzoUmBase / 100 * 10000) / 10000) + '/cl'
                  else if (igUm === 'ml') prezzoDisplay = fmtD(Math.round(prezzoUmBase / 1000 * 10000) / 10000) + '/ml'
                  else prezzoDisplay = fmtD(Math.round(prezzoUmBase * 100) / 100) + '/' + baseUm
                }
              } catch { prezzoDisplay = '—' }
              return <tr key={idx} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 500, fontSize: 12 }}>
                  {ig.gratis && <span title="Articolo gratuito (costo 0)" style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(59,130,246,.15)', color: '#3B82F6', letterSpacing: '.04em', marginRight: 6 }}>GRATIS</span>}
                  {isManual && <span style={{ marginRight: 4, fontSize: 10 }} title="Semilavorato (sub-ricetta)"></span>}
                  {ig.nome_articolo}
                </td>
                <td style={{ ...S.td, padding: '4px 6px' }}>
                  <input type="text" inputMode="decimal"
                    key={selected.name + '-' + idx}
                    defaultValue={ig.quantita ? String(ig.quantita) : ''}
                    onBlur={e => {
                      const val = parseFloat((e.target.value || '').replace(',', '.')) || 0
                      if (val !== (ig.quantita || 0)) updateIngredient(idx, 'quantita', val)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                    style={{ ...iS, fontSize: 11, padding: '3px 5px', width: 65, textAlign: 'center' }} />
                </td>
                <td style={{ ...S.td, padding: '4px 6px' }}>
                  <select value={igUm} onChange={e => updateIngredient(idx, 'unita', e.target.value)}
                    style={{ ...iS, fontSize: 10, padding: '2px 3px', width: 50, color: 'var(--text)' }}>
                    <option value="KG">KG</option>
                    <option value="g">g</option>
                    <option value="LT">LT</option>
                    <option value="cl">cl</option>
                    <option value="ml">ml</option>
                    <option value="PZ">PZ</option>
                  </select>
                </td>
                <td style={{ ...S.td, padding: '4px 6px' }}>
                  <input type="text" inputMode="decimal"
                    key={selected.name + '-scarto-' + idx}
                    defaultValue={ig.scarto ? String(ig.scarto) : ''}
                    placeholder="0"
                    onBlur={e => {
                      const val = parseFloat((e.target.value || '').replace(',', '.')) || 0
                      if (val !== (Number(ig.scarto) || 0)) updateIngredient(idx, 'scarto', val)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                    title="Quantita' di scarto (es. 50g di pelle/buccia/ossa che butti). La paghi ma non finisce nel piatto."
                    style={{ ...iS, fontSize: 11, padding: '3px 5px', width: 60, textAlign: 'center' }} />
                </td>
                <td style={{ ...S.td, padding: '4px 6px' }}>
                  <select value={ig.scarto_unita || igUm} onChange={e => updateIngredient(idx, 'scarto_unita', e.target.value)}
                    style={{ ...iS, fontSize: 10, padding: '2px 3px', width: 50, color: 'var(--text)' }}>
                    <option value="KG">KG</option>
                    <option value="g">g</option>
                    <option value="LT">LT</option>
                    <option value="cl">cl</option>
                    <option value="ml">ml</option>
                    <option value="PZ">PZ</option>
                  </select>
                </td>
                <td style={{ ...S.td, fontSize: 10, color: 'var(--text3)' }}>{prezzoDisplay}</td>
                <td style={{ ...S.td, fontWeight: 600, fontSize: 11, color: '#F59E0B' }}>{costo > 0 ? fmtD(Math.round(costo * 10000) / 10000) : '—'}</td>
                <td style={{ ...S.td }}>
                  <button onClick={() => removeIngredient(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>×</button>
                </td>
              </tr>
            })}
            {ingredienti.length > 0 && <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={6} style={{ ...S.td, fontWeight: 700, textAlign: 'right', fontSize: 12 }}>Totale Food Cost</td>
              <td style={{ ...S.td, fontWeight: 700, fontSize: 13, color: '#F59E0B' }}>{fmtD(foodCost)}</td>
              <td />
            </tr>}
          </tbody>
        </table>

        {/* Aggiungi ingrediente */}
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>Aggiungi articolo alla ricetta:</div>
          <input placeholder="Cerca articolo o semilavorato..." value={ingredientSearch}
            onChange={e => setIngredientSearch(e.target.value)}
            style={{ ...iS, fontSize: 12, padding: '6px 10px', width: '100%', marginBottom: 6 }} />
          {filteredArticles.slice(0, 12).map(a => {
            const tag = a.kind === 'man' ? 'SEM' : null
            const tagColor = a.kind === 'man' ? '#10B981' : 'var(--text3)'
            return (
              <div key={a.nome + ':' + a.kind} onClick={() => addIngredient(a.nome)}
                style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  {tag && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: tagColor + '22', color: tagColor, letterSpacing: '.04em', flexShrink: 0 }}>{tag}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome}</span>
                </span>
                <span style={{ fontSize: 10, color: tagColor, flexShrink: 0 }}>{a.prezzoMedio > 0 ? fmtD(Math.round(a.prezzoMedio * 100) / 100) + '/' + a.unita : '—'}</span>
              </div>
            )
          })}
          {/* Aggiungi articolo libero a costo 0 (es. "Acqua potabile") */}
          {ingredientSearch.length >= 2 && !exactMatch && (
            <div onClick={() => addFreeIngredient(ingredientSearch)}
              style={{ padding: '8px 10px', cursor: 'pointer', borderTop: filteredArticles.length > 0 ? '1px solid var(--border)' : 'none', fontSize: 12, color: '#3B82F6' }}>
              + Aggiungi <strong>"{ingredientSearch}"</strong> a costo 0 €
            </div>
          )}
        </div>
      </Card>
    </div>}
  </div>
}

