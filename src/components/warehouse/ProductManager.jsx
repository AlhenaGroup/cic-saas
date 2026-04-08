import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }
const CATEGORIE = ['food', 'beverage', 'packaging', 'consumo', 'detergenza', 'laboratorio', 'semilavorati']
const UNITA = ['kg', 'g', 'l', 'ml', 'pz', 'ct', 'bt', 'cf']

const emptyForm = {
  nome: '', nome_standard: '', categoria: 'food', sotto_categoria: '', unita_misura: 'kg',
  unita_acquisto: '', fattore_conversione: 1, fornitore_principale: '', scorta_minima: '',
  giorni_copertura: 7, ultimo_prezzo: '', prezzo_medio: '', magazzino_default: '', attivo: true,
}

export default function ProductManager() {
  const [products, setProducts] = useState([])
  const [aliases, setAliases] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editProd, setEditProd] = useState(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [filter, setFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [expandedAliases, setExpandedAliases] = useState(null)
  const [newAlias, setNewAlias] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('warehouse_products').select('*').order('nome')
    setProducts(data || [])
    const { data: al } = await supabase.from('warehouse_aliases').select('*')
    setAliases(al || [])
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = products.filter(p => {
    if (filter && !p.nome.toLowerCase().includes(filter.toLowerCase())) return false
    if (catFilter && p.categoria !== catFilter) return false
    return true
  })

  const save = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      ...form, fattore_conversione: parseFloat(form.fattore_conversione) || 1,
      scorta_minima: parseFloat(form.scorta_minima) || null,
      giorni_copertura: parseInt(form.giorni_copertura) || 7,
      ultimo_prezzo: parseFloat(form.ultimo_prezzo) || null,
      prezzo_medio: parseFloat(form.prezzo_medio) || null,
    }
    if (editProd) {
      await supabase.from('warehouse_products').update(payload).eq('id', editProd.id)
    } else {
      await supabase.from('warehouse_products').insert({ ...payload, user_id: user.id })
    }
    setForm({ ...emptyForm }); setShowForm(false); setEditProd(null)
    await load(); setLoading(false)
  }

  const toggle = async (p) => {
    await supabase.from('warehouse_products').update({ attivo: !p.attivo }).eq('id', p.id)
    await load()
  }

  const deleteProd = async (id) => {
    await supabase.from('warehouse_products').delete().eq('id', id)
    await load()
  }

  const addAlias = async (productId) => {
    if (!newAlias.trim()) return
    await supabase.from('warehouse_aliases').insert({ product_id: productId, alias: newAlias.trim(), confermato: true })
    setNewAlias(''); await load()
  }

  const deleteAlias = async (id) => {
    await supabase.from('warehouse_aliases').delete().eq('id', id)
    await load()
  }

  return <>
    <Card title="Prodotti" badge={products.length} extra={
      <button onClick={() => { setShowForm(true); setEditProd(null); setForm({ ...emptyForm }) }} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>+ Nuovo prodotto</button>
    }>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input placeholder="Cerca prodotto..." value={filter} onChange={e => setFilter(e.target.value)} style={{ ...iS, flex: 1 }} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={iS}>
          <option value="">Tutte le categorie</option>
          {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Form */}
      {showForm && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #2a3042' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          <input placeholder="Nome *" value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} style={formS} />
          <input placeholder="Nome standard" value={form.nome_standard} onChange={e => setForm(p => ({ ...p, nome_standard: e.target.value }))} style={formS} />
          <select value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))} style={formS}>
            {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Sotto-categoria" value={form.sotto_categoria} onChange={e => setForm(p => ({ ...p, sotto_categoria: e.target.value }))} style={formS} />
          <select value={form.unita_misura} onChange={e => setForm(p => ({ ...p, unita_misura: e.target.value }))} style={formS}>
            {UNITA.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <input placeholder="Unita acquisto" value={form.unita_acquisto} onChange={e => setForm(p => ({ ...p, unita_acquisto: e.target.value }))} style={formS} />
          <input placeholder="Fattore conversione" type="number" step="0.01" value={form.fattore_conversione} onChange={e => setForm(p => ({ ...p, fattore_conversione: e.target.value }))} style={formS} />
          <input placeholder="Fornitore principale" value={form.fornitore_principale} onChange={e => setForm(p => ({ ...p, fornitore_principale: e.target.value }))} style={formS} />
          <input placeholder="Scorta minima" type="number" step="0.01" value={form.scorta_minima} onChange={e => setForm(p => ({ ...p, scorta_minima: e.target.value }))} style={formS} />
          <input placeholder="Giorni copertura" type="number" value={form.giorni_copertura} onChange={e => setForm(p => ({ ...p, giorni_copertura: e.target.value }))} style={formS} />
          <input placeholder="Ultimo prezzo" type="number" step="0.01" value={form.ultimo_prezzo} onChange={e => setForm(p => ({ ...p, ultimo_prezzo: e.target.value }))} style={formS} />
          <input placeholder="Magazzino default" value={form.magazzino_default} onChange={e => setForm(p => ({ ...p, magazzino_default: e.target.value }))} style={formS} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={save} disabled={!form.nome || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>{editProd ? 'Salva' : 'Aggiungi'}</button>
          <button onClick={() => { setShowForm(false); setEditProd(null) }} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Annulla</button>
        </div>
      </div>}

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Nome', 'Categoria', 'Unita', 'Fornitore', 'Ultimo prezzo', 'Scorta min.', 'Attivo', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessun prodotto trovato</td></tr>}
          {filtered.map(p => {
            const prodAliases = aliases.filter(a => a.product_id === p.id)
            return <tr key={p.id}>
              <td style={{ ...S.td, fontWeight: 500 }}>
                <div>{p.nome}</div>
                {expandedAliases === p.id && <div style={{ marginTop: 6 }}>
                  {prodAliases.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{a.alias}</span>
                      <button onClick={() => deleteAlias(a.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 10 }}>x</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <input placeholder="Nuovo alias" value={newAlias} onChange={e => setNewAlias(e.target.value)} style={{ ...iS, fontSize: 11, padding: '3px 6px', width: 120 }} />
                    <button onClick={() => addAlias(p.id)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '3px 8px', fontSize: 10 }}>+</button>
                  </div>
                </div>}
                <button onClick={() => setExpandedAliases(expandedAliases === p.id ? null : p.id)} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 10, padding: 0, marginTop: 2 }}>
                  {prodAliases.length} alias {expandedAliases === p.id ? '\u25B2' : '\u25BC'}
                </button>
              </td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{p.categoria}</td>
              <td style={{ ...S.td, fontSize: 12 }}>{p.unita_misura}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{p.fornitore_principale || '-'}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{p.ultimo_prezzo ? fmt(p.ultimo_prezzo) : '-'}</td>
              <td style={{ ...S.td, color: '#64748b' }}>{p.scorta_minima || '-'}</td>
              <td style={S.td}>
                <button onClick={() => toggle(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: p.attivo ? '#10B981' : '#EF4444' }}>
                  {p.attivo ? 'Si' : 'No'}
                </button>
              </td>
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                <button onClick={() => { setEditProd(p); setForm({ nome: p.nome, nome_standard: p.nome_standard || '', categoria: p.categoria || 'food', sotto_categoria: p.sotto_categoria || '', unita_misura: p.unita_misura || 'kg', unita_acquisto: p.unita_acquisto || '', fattore_conversione: p.fattore_conversione || 1, fornitore_principale: p.fornitore_principale || '', scorta_minima: p.scorta_minima || '', giorni_copertura: p.giorni_copertura || 7, ultimo_prezzo: p.ultimo_prezzo || '', prezzo_medio: p.prezzo_medio || '', magazzino_default: p.magazzino_default || '', attivo: p.attivo }); setShowForm(true) }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 12, marginRight: 8 }}>Modifica</button>
                <button onClick={() => { if (confirm('Eliminare ' + p.nome + '?')) deleteProd(p.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>Elimina</button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </Card>
  </>
}
