import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtN } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }

export default function InventoryManager() {
  const [locations, setLocations] = useState([])
  const [inventories, setInventories] = useState([])
  const [selected, setSelected] = useState(null)
  const [invItems, setInvItems] = useState([])
  const [products, setProducts] = useState([])
  const [stock, setStock] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ location_id: '', data: new Date().toISOString().split('T')[0], note: '' })
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const { data: locs } = await supabase.from('warehouse_locations').select('*').order('nome')
    setLocations(locs || [])
    const { data: inv } = await supabase.from('warehouse_inventories').select('*').order('data', { ascending: false })
    setInventories(inv || [])
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, unita_misura, ultimo_prezzo').eq('attivo', true)
    setProducts(prods || [])
    const { data: st } = await supabase.from('warehouse_stock').select('*')
    setStock(st || [])
  }, [])

  const loadItems = useCallback(async (invId) => {
    const { data } = await supabase.from('warehouse_inventory_items').select('*').eq('inventory_id', invId).order('id')
    setInvItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (selected) loadItems(selected) }, [selected, loadItems])

  const prodMap = Object.fromEntries(products.map(p => [p.id, p]))
  const locMap = Object.fromEntries(locations.map(l => [l.id, l]))

  const createInventory = async () => {
    if (!newForm.location_id) return
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    // Create inventory
    const { data: inv } = await supabase.from('warehouse_inventories').insert({
      user_id: user.id, location_id: newForm.location_id, data: newForm.data, stato: 'in_corso', note: newForm.note,
    }).select().single()

    if (inv) {
      // Pre-populate with current stock for this location
      const locStock = stock.filter(s => s.location_id === newForm.location_id)
      const itemsToInsert = locStock.map(s => ({
        inventory_id: inv.id, product_id: s.product_id,
        giacenza_teorica: s.quantita || 0, giacenza_reale: null, differenza: 0, valore_differenza: 0,
      }))
      // Also add products with no stock
      const stockProds = new Set(locStock.map(s => s.product_id))
      products.forEach(p => {
        if (!stockProds.has(p.id)) {
          itemsToInsert.push({ inventory_id: inv.id, product_id: p.id, giacenza_teorica: 0, giacenza_reale: null, differenza: 0, valore_differenza: 0 })
        }
      })
      if (itemsToInsert.length > 0) {
        await supabase.from('warehouse_inventory_items').insert(itemsToInsert)
      }
      setSelected(inv.id)
    }
    setShowNew(false); setNewForm({ location_id: '', data: new Date().toISOString().split('T')[0], note: '' })
    await load(); setLoading(false)
  }

  const updateItemReal = async (item, val) => {
    const giacReale = parseFloat(val)
    if (isNaN(giacReale)) return
    const diff = giacReale - (item.giacenza_teorica || 0)
    const prod = prodMap[item.product_id]
    const valDiff = diff * (prod?.ultimo_prezzo || 0)
    await supabase.from('warehouse_inventory_items').update({
      giacenza_reale: giacReale, differenza: diff, valore_differenza: valDiff,
    }).eq('id', item.id)
    if (selected) await loadItems(selected)
  }

  const updateItemNote = async (item, note) => {
    await supabase.from('warehouse_inventory_items').update({ note }).eq('id', item.id)
  }

  const closeInventory = async () => {
    if (!selected) return
    await supabase.from('warehouse_inventories').update({ stato: 'chiuso' }).eq('id', selected)
    // Update stock with real quantities
    for (const it of invItems) {
      if (it.giacenza_reale != null) {
        const inv = inventories.find(i => i.id === selected)
        if (inv) {
          const { data: existing } = await supabase.from('warehouse_stock').select('*').eq('product_id', it.product_id).eq('location_id', inv.location_id).limit(1)
          if (existing?.[0]) {
            await supabase.from('warehouse_stock').update({ quantita: it.giacenza_reale }).eq('id', existing[0].id)
          }
        }
      }
    }
    await load(); if (selected) await loadItems(selected)
  }

  const selInv = inventories.find(i => i.id === selected)
  const totDiff = invItems.reduce((s, i) => s + Math.abs(i.valore_differenza || 0), 0)

  return <>
    <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
      <button onClick={() => setShowNew(true)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>+ Nuovo inventario</button>
    </div>

    {showNew && <div style={{ ...S.card, marginBottom: 16, background: '#131825' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr) auto', gap: 10, alignItems: 'end' }}>
        <select value={newForm.location_id} onChange={e => setNewForm(p => ({ ...p, location_id: e.target.value }))} style={formS}>
          <option value="">Magazzino *</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <input type="date" value={newForm.data} onChange={e => setNewForm(p => ({ ...p, data: e.target.value }))} style={formS} />
        <input placeholder="Note" value={newForm.note} onChange={e => setNewForm(p => ({ ...p, note: e.target.value }))} style={formS} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button onClick={createInventory} disabled={!newForm.location_id || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 600 }}>Crea</button>
          <button onClick={() => setShowNew(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>X</button>
        </div>
      </div>
    </div>}

    {/* History */}
    <Card title="Storico inventari" badge={inventories.length}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Data', 'Magazzino', 'Stato', 'Note', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {inventories.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessun inventario effettuato</td></tr>}
          {inventories.map(inv => (
            <tr key={inv.id} style={{ cursor: 'pointer', background: selected === inv.id ? '#131825' : 'transparent' }} onClick={() => setSelected(selected === inv.id ? null : inv.id)}>
              <td style={{ ...S.td, fontWeight: 500 }}>{inv.data}</td>
              <td style={{ ...S.td, color: '#94a3b8' }}>{locMap[inv.location_id]?.nome || '-'}</td>
              <td style={S.td}>
                <span style={S.badge(
                  inv.stato === 'chiuso' ? '#10B981' : '#F59E0B',
                  inv.stato === 'chiuso' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)'
                )}>{inv.stato === 'chiuso' ? 'Chiuso' : 'In corso'}</span>
              </td>
              <td style={{ ...S.td, color: '#64748b', fontSize: 12 }}>{inv.note || '-'}</td>
              <td style={S.td}>
                <button onClick={e => { e.stopPropagation(); setSelected(inv.id) }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 12 }}>Apri</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    {/* Inventory detail */}
    {selected && <div style={{ marginTop: 12 }}>
      <Card title={'Inventario ' + (selInv?.data || '')} badge={selInv?.stato} extra={
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>Scostamento: {fmt(totDiff)}</span>
          {selInv?.stato === 'in_corso' && <button onClick={closeInventory} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '4px 14px', fontWeight: 600, fontSize: 11 }}>Chiudi inventario</button>}
        </div>
      }>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Prodotto', 'Unita', 'Teorica', 'Reale', 'Diff.', 'Diff. %', 'Val. diff.', 'Note'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {invItems.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessun prodotto</td></tr>}
            {invItems.map(it => {
              const prod = prodMap[it.product_id]
              const diffPct = (it.giacenza_teorica || 0) > 0 ? ((it.differenza || 0) / it.giacenza_teorica * 100).toFixed(1) : '-'
              const diffColor = (it.differenza || 0) < 0 ? '#EF4444' : (it.differenza || 0) > 0 ? '#F59E0B' : '#64748b'
              return <tr key={it.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{prod?.nome || '?'}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{prod?.unita_misura || '-'}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{fmtN(it.giacenza_teorica)}</td>
                <td style={S.td}>
                  {selInv?.stato === 'in_corso'
                    ? <input type="number" step="0.01" value={it.giacenza_reale ?? ''} onChange={e => updateItemReal(it, e.target.value)} style={{ ...iS, width: 80, textAlign: 'center', padding: '3px 6px' }} placeholder="-" />
                    : <span style={{ fontWeight: 600 }}>{it.giacenza_reale != null ? fmtN(it.giacenza_reale) : '-'}</span>
                  }
                </td>
                <td style={{ ...S.td, color: diffColor, fontWeight: 600 }}>{it.differenza != null ? (it.differenza > 0 ? '+' : '') + fmtN(it.differenza) : '-'}</td>
                <td style={{ ...S.td, color: diffColor, fontSize: 12 }}>{diffPct !== '-' ? diffPct + '%' : '-'}</td>
                <td style={{ ...S.td, color: diffColor, fontWeight: 600 }}>{it.valore_differenza ? fmt(it.valore_differenza) : '-'}</td>
                <td style={S.td}>
                  {selInv?.stato === 'in_corso'
                    ? <input value={it.note || ''} onChange={e => updateItemNote(it, e.target.value)} onBlur={e => updateItemNote(it, e.target.value)} style={{ ...iS, width: 100, padding: '3px 6px', fontSize: 11 }} placeholder="nota" />
                    : <span style={{ fontSize: 11, color: '#64748b' }}>{it.note || '-'}</span>
                  }
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </Card>
    </div>}
  </>
}
