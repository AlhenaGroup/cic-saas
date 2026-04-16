import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtD, fmtN } from '../shared/styles.jsx'

const iS = S.input

export default function RecipeManager({ sp, sps }) {
  // Prodotti venduti su CiC
  const [cicProducts, setCicProducts] = useState([])
  // Articoli acquistati (da warehouse_invoice_items con nome_articolo)
  const [articles, setArticles] = useState([])
  // Ricette salvate
  const [recipes, setRecipes] = useState({}) // nome_prodotto → recipe
  const [loading, setLoading] = useState(false)
  // UI
  const [selected, setSelected] = useState(null) // prodotto selezionato per editare ricetta
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('tutti') // tutti, con_ricetta, senza_ricetta
  const [ingredientSearch, setIngredientSearch] = useState('')

  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
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
    const { data: items } = await supabase.from('warehouse_invoice_items')
      .select('nome_articolo, unita, prezzo_totale, totale_um, escludi_magazzino')
    const artMap = {}
    ;(items || []).forEach(it => {
      if (it.escludi_magazzino || !it.nome_articolo) return
      const key = it.nome_articolo.toLowerCase().trim()
      if (!artMap[key]) artMap[key] = { nome: it.nome_articolo, unita: it.unita || '', prezzi: [] }
      const tot = Number(it.totale_um) || 0
      const spesa = Math.abs(Number(it.prezzo_totale)) || 0
      if (tot > 0 && spesa > 0) artMap[key].prezzi.push(spesa / tot)
    })
    const arts = Object.values(artMap).map(a => ({
      ...a, prezzoMedio: a.prezzi.length > 0 ? a.prezzi.reduce((s, v) => s + v, 0) / a.prezzi.length : 0,
    })).sort((a, b) => a.nome.localeCompare(b.nome))
    setArticles(arts)

    // 3. Ricette salvate
    const { data: recs } = await supabase.from('recipes').select('*')
    const recMap = {}
    ;(recs || []).forEach(r => { recMap[r.nome_prodotto] = r })
    setRecipes(recMap)

    setLoading(false)
  }, [sp, selectedLocaleName])

  useEffect(() => { load() }, [load])

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

  // Converti quantità in UM base per calcolo costo (g→KG, cl→LT)
  const toBaseUnit = (qty, um) => {
    const q = Number(qty) || 0
    const u = um || 'PZ'
    if (u === 'g') return { qty: q / 1000, baseUm: 'KG' }
    if (u === 'cl') return { qty: q / 100, baseUm: 'LT' }
    if (u === 'ml') return { qty: q / 1000, baseUm: 'LT' }
    return { qty: q, baseUm: u }
  }

  // Calcolo food cost con conversione unità
  const calcCost = (ingr) => {
    let total = 0
    for (const ig of ingr) {
      const art = articles.find(a => a.nome.toLowerCase() === (ig.nome_articolo || '').toLowerCase())
      if (!art || art.prezzoMedio <= 0) continue
      const { qty, baseUm } = toBaseUnit(ig.quantita || 0, ig.unita || art.unita)
      // Il prezzo medio dell'articolo è per la sua UM base (KG, LT, PZ)
      total += qty * art.prezzoMedio
    }
    return Math.round(total * 100) / 100
  }

  const foodCost = calcCost(ingredienti)
  const fcPct = selected && selected.avgPrice > 0 ? Math.round(foodCost / selected.avgPrice * 10000) / 100 : 0

  // Salva ricetta
  const saveRecipe = async (prodName, ingr) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const prod = cicProducts.find(p => p.name === prodName)
    await supabase.from('recipes').upsert({
      user_id: user.id,
      nome_prodotto: prodName,
      reparto: prod?.reparto || '',
      prezzo_vendita: prod?.avgPrice || 0,
      ingredienti: ingr,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,nome_prodotto' })
    setRecipes(prev => ({ ...prev, [prodName]: { ...prev[prodName], ingredienti: ingr, prezzo_vendita: prod?.avgPrice || 0 } }))
  }

  // Aggiungi ingrediente
  const addIngredient = (artNome) => {
    const art = articles.find(a => a.nome === artNome)
    if (!art || !selected) return
    const newIngr = [...ingredienti, { nome_articolo: art.nome, quantita: 0, unita: art.unita }]
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

  // Articoli filtrati per ricerca ingrediente
  const filteredArticles = ingredientSearch.length >= 2
    ? articles.filter(a => a.nome.toLowerCase().includes(ingredientSearch.toLowerCase()) && !ingredienti.some(ig => ig.nome_articolo.toLowerCase() === a.nome.toLowerCase()))
    : []

  const conRicetta = cicProducts.filter(p => recipes[p.name] && (recipes[p.name].ingredienti || []).length > 0).length

  return <div style={{ display: 'flex', gap: 16, flexDirection: selected ? 'row' : 'column' }}>
    {/* Lista prodotti */}
    <div style={{ flex: selected ? '0 0 45%' : '1' }}>
      <Card title="Prodotti venduti" badge={loading ? '...' : `${filtered.length} prodotti · ${conRicetta} con ricetta`} extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input placeholder="🔍 Cerca..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...iS, fontSize: 11, padding: '4px 8px', width: 130 }} />
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...iS, fontSize: 10, padding: '4px 6px' }}>
            <option value="tutti">Tutti</option>
            <option value="con_ricetta">Con ricetta</option>
            <option value="senza_ricetta">Senza ricetta</option>
          </select>
        </div>
      }>
        {loading && <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Caricamento...</div>}
        <div style={{ maxHeight: selected ? 500 : 600, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Prodotto', 'Reparto', 'Prezzo', 'Venduti', 'FC', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 9 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map((p, i) => {
                const rec = recipes[p.name]
                const hasRecipe = rec && (rec.ingredienti || []).length > 0
                const fc = hasRecipe ? calcCost(rec.ingredienti) : 0
                const pct = hasRecipe && p.avgPrice > 0 ? Math.round(fc / p.avgPrice * 10000) / 100 : 0
                return <tr key={i}
                  onClick={() => setSelected(selected?.name === p.name ? null : p)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e', background: selected?.name === p.name ? '#131825' : 'transparent' }}>
                  <td style={{ ...S.td, fontWeight: 600, fontSize: 12 }}>{p.name}</td>
                  <td style={{ ...S.td, fontSize: 10, color: '#94a3b8' }}>{p.reparto}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>{fmtD(p.avgPrice)}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>{fmtN(p.qty)}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>
                    {hasRecipe
                      ? <span style={{ color: pct > 35 ? '#EF4444' : pct > 25 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>{pct}%</span>
                      : <span style={{ color: '#475569', fontSize: 10 }}>—</span>}
                  </td>
                  <td style={{ ...S.td, fontSize: 10 }}>
                    {hasRecipe ? <span style={{ color: '#10B981' }}>✓</span> : null}
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
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{selected.reparto} · {fmtD(selected.avgPrice)}</span>
      }>
        {/* KPI food cost */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
          <div style={{ padding: 10, background: '#131825', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: '#64748b' }}>Food Cost</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B', marginTop: 2 }}>{fmtD(foodCost)}</div>
          </div>
          <div style={{ padding: 10, background: '#131825', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: '#64748b' }}>FC %</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: fcPct > 35 ? '#EF4444' : fcPct > 25 ? '#F59E0B' : '#10B981', marginTop: 2 }}>{fcPct}%</div>
          </div>
          <div style={{ padding: 10, background: '#131825', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: '#64748b' }}>MOL</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981', marginTop: 2 }}>{fmtD(selected.avgPrice - foodCost)}</div>
          </div>
        </div>

        {/* Tabella ingredienti */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Articolo', 'Qty', 'UM', '€/UM', 'Costo', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 9 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {ingredienti.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: '#475569', textAlign: 'center', fontSize: 12 }}>Nessun ingrediente. Cerca e aggiungi articoli.</td></tr>}
            {ingredienti.map((ig, idx) => {
              if (!ig || !ig.nome_articolo) return null
              const art = articles.find(a => a.nome.toLowerCase() === (ig.nome_articolo || '').toLowerCase())
              const prezzoUmBase = art?.prezzoMedio || 0
              const igUm = ig.unita || art?.unita || 'PZ'
              const { qty: qtyBase, baseUm } = toBaseUnit(ig.quantita, igUm)
              const costo = qtyBase * prezzoUmBase
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
                <td style={{ ...S.td, fontWeight: 500, fontSize: 12 }}>{ig.nome_articolo}</td>
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
                    style={{ ...iS, fontSize: 10, padding: '2px 3px', width: 50, color: '#e2e8f0' }}>
                    <option value="KG">KG</option>
                    <option value="g">g</option>
                    <option value="LT">LT</option>
                    <option value="cl">cl</option>
                    <option value="ml">ml</option>
                    <option value="PZ">PZ</option>
                  </select>
                </td>
                <td style={{ ...S.td, fontSize: 10, color: '#64748b' }}>{prezzoDisplay}</td>
                <td style={{ ...S.td, fontWeight: 600, fontSize: 11, color: '#F59E0B' }}>{costo > 0 ? fmtD(Math.round(costo * 10000) / 10000) : '—'}</td>
                <td style={{ ...S.td }}>
                  <button onClick={() => removeIngredient(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>✗</button>
                </td>
              </tr>
            })}
            {ingredienti.length > 0 && <tr style={{ borderTop: '2px solid #2a3042' }}>
              <td colSpan={4} style={{ ...S.td, fontWeight: 700, textAlign: 'right', fontSize: 12 }}>Totale Food Cost</td>
              <td style={{ ...S.td, fontWeight: 700, fontSize: 13, color: '#F59E0B' }}>{fmtD(foodCost)}</td>
              <td />
            </tr>}
          </tbody>
        </table>

        {/* Aggiungi ingrediente */}
        <div style={{ background: '#131825', borderRadius: 8, padding: 12, border: '1px solid #2a3042' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>Aggiungi articolo alla ricetta:</div>
          <input placeholder="Cerca articolo..." value={ingredientSearch}
            onChange={e => setIngredientSearch(e.target.value)}
            style={{ ...iS, fontSize: 12, padding: '6px 10px', width: '100%', marginBottom: 6 }} />
          {filteredArticles.slice(0, 8).map(a => (
            <div key={a.nome} onClick={() => addIngredient(a.nome)}
              style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #1a1f2e', fontSize: 12, color: '#e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>{a.nome}</span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{a.prezzoMedio > 0 ? fmtD(Math.round(a.prezzoMedio * 100) / 100) + '/' + a.unita : '—'}</span>
            </div>
          ))}
          {ingredientSearch.length >= 2 && filteredArticles.length === 0 && (
            <div style={{ padding: 8, fontSize: 11, color: '#475569' }}>Nessun articolo trovato. Associa prima gli articoli nelle fatture.</div>
          )}
        </div>
      </Card>
    </div>}
  </div>
}
