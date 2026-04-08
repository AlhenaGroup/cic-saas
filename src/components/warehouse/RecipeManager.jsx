import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }
const CATEGORIE = ['antipasti', 'primi', 'secondi', 'contorni', 'dolci', 'bevande', 'cocktail', 'altro']
const TIPI = ['piatto', 'bevanda', 'semilavorato', 'base']
const UNITA_INGR = ['g', 'kg', 'ml', 'l', 'pz']

export default function RecipeManager() {
  const [recipes, setRecipes] = useState([])
  const [products, setProducts] = useState([])
  const [selected, setSelected] = useState(null)
  const [items, setItems] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nome: '', categoria: 'primi', tipo: 'piatto', porzioni: 1, note: '' })
  const [editRec, setEditRec] = useState(null)
  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState([])
  const [ingredForm, setIngredForm] = useState({ product_id: null, prodNome: '', quantita: '', unita: 'g' })
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('warehouse_recipes').select('*').order('nome')
    setRecipes(r || [])
    const { data: p } = await supabase.from('warehouse_products').select('id, nome, ultimo_prezzo, unita_misura, fattore_conversione').eq('attivo', true).order('nome')
    setProducts(p || [])
  }, [])

  const loadItems = useCallback(async (rid) => {
    const { data } = await supabase.from('warehouse_recipe_items').select('*').eq('recipe_id', rid).order('id')
    setItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (selected) loadItems(selected) }, [selected, loadItems])

  const calcCost = (item) => {
    const prod = products.find(p => p.id === item.product_id)
    if (!prod || !prod.ultimo_prezzo) return 0
    // Convert recipe qty to base unit
    let qtyBase = parseFloat(item.quantita) || 0
    if (item.unita === 'g' && prod.unita_misura === 'kg') qtyBase /= 1000
    if (item.unita === 'kg' && prod.unita_misura === 'g') qtyBase *= 1000
    if (item.unita === 'ml' && prod.unita_misura === 'l') qtyBase /= 1000
    if (item.unita === 'l' && prod.unita_misura === 'ml') qtyBase *= 1000
    return qtyBase * prod.ultimo_prezzo
  }

  const totalCost = items.reduce((s, i) => s + calcCost(i), 0)
  const selRecipe = recipes.find(r => r.id === selected)
  const costPerPortion = selRecipe ? totalCost / (selRecipe.porzioni || 1) : 0

  const save = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = { nome: form.nome, categoria: form.categoria, tipo: form.tipo, porzioni: parseInt(form.porzioni) || 1, note: form.note }
    if (editRec) {
      await supabase.from('warehouse_recipes').update(payload).eq('id', editRec.id)
    } else {
      await supabase.from('warehouse_recipes').insert({ ...payload, user_id: user.id })
    }
    setForm({ nome: '', categoria: 'primi', tipo: 'piatto', porzioni: 1, note: '' }); setShowForm(false); setEditRec(null)
    await load(); setLoading(false)
  }

  const deleteRecipe = async (id) => {
    await supabase.from('warehouse_recipe_items').delete().eq('recipe_id', id)
    await supabase.from('warehouse_recipes').delete().eq('id', id)
    if (selected === id) { setSelected(null); setItems([]) }
    await load()
  }

  const searchProd = (q) => {
    setProdSearch(q)
    if (q.length < 2) { setProdResults([]); return }
    setProdResults(products.filter(p => p.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 8))
  }

  const addIngredient = async () => {
    if (!selected || !ingredForm.product_id) return
    setLoading(true)
    await supabase.from('warehouse_recipe_items').insert({
      recipe_id: selected, product_id: ingredForm.product_id,
      quantita: parseFloat(ingredForm.quantita) || 0, unita: ingredForm.unita,
    })
    setIngredForm({ product_id: null, prodNome: '', quantita: '', unita: 'g' }); setProdSearch(''); setProdResults([])
    await loadItems(selected); setLoading(false)
  }

  const removeIngredient = async (id) => {
    await supabase.from('warehouse_recipe_items').delete().eq('id', id)
    if (selected) await loadItems(selected)
  }

  return <>
    <Card title="Ricette" badge={recipes.length} extra={
      <button onClick={() => { setShowForm(true); setEditRec(null); setForm({ nome: '', categoria: 'primi', tipo: 'piatto', porzioni: 1, note: '' }) }} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>+ Nuova ricetta</button>
    }>
      {showForm && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #2a3042' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          <input placeholder="Nome ricetta *" value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} style={formS} />
          <select value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))} style={formS}>
            {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))} style={formS}>
            {TIPI.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Porzioni" type="number" min="1" value={form.porzioni} onChange={e => setForm(p => ({ ...p, porzioni: e.target.value }))} style={formS} />
        </div>
        <textarea placeholder="Note" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} style={{ ...formS, height: 50, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={!form.nome || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>{editRec ? 'Salva' : 'Aggiungi'}</button>
          <button onClick={() => { setShowForm(false); setEditRec(null) }} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Annulla</button>
        </div>
      </div>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Nome', 'Categoria', 'Tipo', 'Porzioni', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {recipes.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessuna ricetta</td></tr>}
          {recipes.map(r => (
            <tr key={r.id} style={{ cursor: 'pointer', background: selected === r.id ? '#131825' : 'transparent' }} onClick={() => setSelected(selected === r.id ? null : r.id)}>
              <td style={{ ...S.td, fontWeight: 500, color: '#3B82F6' }}>{r.nome}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{r.categoria}</td>
              <td style={{ ...S.td, fontSize: 12 }}>{r.tipo}</td>
              <td style={S.td}>{r.porzioni}</td>
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                <button onClick={e => { e.stopPropagation(); setEditRec(r); setForm({ nome: r.nome, categoria: r.categoria || 'primi', tipo: r.tipo || 'piatto', porzioni: r.porzioni || 1, note: r.note || '' }); setShowForm(true) }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 12, marginRight: 8 }}>Modifica</button>
                <button onClick={e => { e.stopPropagation(); if (confirm('Eliminare ricetta?')) deleteRecipe(r.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>Elimina</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    {selected && <div style={{ marginTop: 12 }}>
      <Card title={'Ingredienti: ' + (selRecipe?.nome || '')} badge={items.length} extra={
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>Costo totale: {fmt(totalCost)}</span>
          <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>Per porzione: {fmt(costPerPortion)}</span>
          {costPerPortion > 15 && <span style={S.badge('#EF4444', 'rgba(239,68,68,.12)')}>Costo alto!</span>}
        </div>
      }>
        {/* Add ingredient */}
        <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #2a3042' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <div style={{ position: 'relative' }}>
              <input placeholder="Cerca prodotto..." value={ingredForm.prodNome || prodSearch} onChange={e => { setIngredForm(p => ({ ...p, product_id: null, prodNome: '' })); searchProd(e.target.value) }} style={formS} />
              {prodResults.length > 0 && <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1f2e', border: '1px solid #2a3042', borderRadius: 6, zIndex: 10, maxHeight: 200, overflow: 'auto' }}>
                {prodResults.map(p => (
                  <div key={p.id} onClick={() => { setIngredForm(prev => ({ ...prev, product_id: p.id, prodNome: p.nome })); setProdSearch(''); setProdResults([]) }} style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid #2a3042', fontSize: 12, color: '#e2e8f0' }}>
                    {p.nome} <span style={{ color: '#64748b' }}>({p.unita_misura})</span>
                  </div>
                ))}
              </div>}
            </div>
            <input placeholder="Quantita" type="number" step="0.01" value={ingredForm.quantita} onChange={e => setIngredForm(p => ({ ...p, quantita: e.target.value }))} style={formS} />
            <select value={ingredForm.unita} onChange={e => setIngredForm(p => ({ ...p, unita: e.target.value }))} style={formS}>
              {UNITA_INGR.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <button onClick={addIngredient} disabled={!ingredForm.product_id || !ingredForm.quantita || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 600, marginBottom: 8 }}>+</button>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Ingrediente', 'Quantita', 'Unita', 'Prezzo unit.', 'Costo', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessun ingrediente</td></tr>}
            {items.map(it => {
              const prod = products.find(p => p.id === it.product_id)
              const cost = calcCost(it)
              return <tr key={it.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{prod?.nome || '?'}</td>
                <td style={S.td}>{it.quantita}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{it.unita}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{prod?.ultimo_prezzo ? fmt(prod.ultimo_prezzo) + '/' + prod.unita_misura : '-'}</td>
                <td style={{ ...S.td, fontWeight: 600, color: '#F59E0B' }}>{fmt(cost)}</td>
                <td style={S.td}><button onClick={() => removeIngredient(it.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>X</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </Card>
    </div>}
  </>
}
