import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtN } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }

export default function StockView() {
  const [locations, setLocations] = useState([])
  const [selLoc, setSelLoc] = useState('')
  const [stock, setStock] = useState([])
  const [products, setProducts] = useState([])
  const [showLocForm, setShowLocForm] = useState(false)
  const [locForm, setLocForm] = useState({ nome: '', locale: '', tipo: 'magazzino' })
  const [showAdjust, setShowAdjust] = useState(null)
  const [adjQty, setAdjQty] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [showTransfer, setShowTransfer] = useState(null)
  const [transferLoc, setTransferLoc] = useState('')
  const [transferQty, setTransferQty] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const { data: locs } = await supabase.from('warehouse_locations').select('*').order('nome')
    setLocations(locs || [])
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, unita_misura, ultimo_prezzo').eq('attivo', true)
    setProducts(prods || [])
  }, [])

  const loadStock = useCallback(async () => {
    if (!selLoc) { setStock([]); return }
    const { data } = await supabase.from('warehouse_stock').select('*').eq('location_id', selLoc).order('product_id')
    setStock(data || [])
  }, [selLoc])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadStock() }, [loadStock])

  const prodMap = Object.fromEntries(products.map(p => [p.id, p]))
  const totalValue = stock.reduce((s, st) => {
    const p = prodMap[st.product_id]
    return s + (st.quantita || 0) * (p?.ultimo_prezzo || 0)
  }, 0)

  const saveLoc = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('warehouse_locations').insert({ user_id: user.id, nome: locForm.nome, locale: locForm.locale, tipo: locForm.tipo })
    setLocForm({ nome: '', locale: '', tipo: 'magazzino' }); setShowLocForm(false)
    await load(); setLoading(false)
  }

  const deleteLoc = async (id) => {
    await supabase.from('warehouse_stock').delete().eq('location_id', id)
    await supabase.from('warehouse_locations').delete().eq('id', id)
    if (selLoc === id) setSelLoc('')
    await load()
  }

  const doAdjust = async (stockItem) => {
    const { data: { user } } = await supabase.auth.getUser()
    const delta = parseFloat(adjQty) || 0
    if (delta === 0) return
    setLoading(true)
    // Insert movement
    await supabase.from('warehouse_movements').insert({
      user_id: user.id, product_id: stockItem.product_id, location_id: stockItem.location_id,
      tipo: delta > 0 ? 'carico' : 'scarico', quantita: Math.abs(delta),
      fonte: 'manuale', note: adjNote || 'Rettifica manuale',
    })
    // Update stock
    await supabase.from('warehouse_stock').update({ quantita: (stockItem.quantita || 0) + delta }).eq('id', stockItem.id)
    setShowAdjust(null); setAdjQty(''); setAdjNote('')
    await loadStock(); setLoading(false)
  }

  const doTransfer = async (stockItem) => {
    if (!transferLoc || !transferQty) return
    const { data: { user } } = await supabase.auth.getUser()
    const qty = parseFloat(transferQty) || 0
    if (qty <= 0 || qty > (stockItem.quantita || 0)) return
    setLoading(true)

    // Scarico da origine
    await supabase.from('warehouse_movements').insert({
      user_id: user.id, product_id: stockItem.product_id, location_id: stockItem.location_id,
      tipo: 'trasferimento_out', quantita: qty, note: 'Trasferimento verso ' + (locations.find(l => l.id === transferLoc)?.nome || ''),
    })
    await supabase.from('warehouse_stock').update({ quantita: (stockItem.quantita || 0) - qty }).eq('id', stockItem.id)

    // Carico a destinazione
    await supabase.from('warehouse_movements').insert({
      user_id: user.id, product_id: stockItem.product_id, location_id: transferLoc,
      tipo: 'trasferimento_in', quantita: qty, note: 'Trasferimento da ' + (locations.find(l => l.id === selLoc)?.nome || ''),
    })
    // Upsert stock destinazione
    const { data: existing } = await supabase.from('warehouse_stock').select('*').eq('product_id', stockItem.product_id).eq('location_id', transferLoc).limit(1)
    if (existing?.[0]) {
      await supabase.from('warehouse_stock').update({ quantita: (existing[0].quantita || 0) + qty }).eq('id', existing[0].id)
    } else {
      await supabase.from('warehouse_stock').insert({ user_id: user.id, product_id: stockItem.product_id, location_id: transferLoc, quantita: qty })
    }

    setShowTransfer(null); setTransferLoc(''); setTransferQty('')
    await loadStock(); setLoading(false)
  }

  return <>
    <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
      <select value={selLoc} onChange={e => setSelLoc(e.target.value)} style={{ ...iS, minWidth: 200 }}>
        <option value="">Seleziona magazzino...</option>
        {locations.map(l => <option key={l.id} value={l.id}>{l.nome} ({l.tipo})</option>)}
      </select>
      <button onClick={() => setShowLocForm(true)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>+ Nuovo magazzino</button>
      {selLoc && <span style={{ fontSize: 13, color: '#F59E0B', fontWeight: 600 }}>Valore totale: {fmt(totalValue)}</span>}
    </div>

    {showLocForm && <div style={{ ...S.card, marginBottom: 16, background: '#131825' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr) auto', gap: 10, alignItems: 'end' }}>
        <input placeholder="Nome *" value={locForm.nome} onChange={e => setLocForm(p => ({ ...p, nome: e.target.value }))} style={formS} />
        <input placeholder="Locale" value={locForm.locale} onChange={e => setLocForm(p => ({ ...p, locale: e.target.value }))} style={formS} />
        <select value={locForm.tipo} onChange={e => setLocForm(p => ({ ...p, tipo: e.target.value }))} style={formS}>
          <option value="magazzino">Magazzino</option>
          <option value="cucina">Cucina</option>
          <option value="bar">Bar</option>
          <option value="frigo">Frigo</option>
          <option value="cantina">Cantina</option>
        </select>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button onClick={saveLoc} disabled={!locForm.nome || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 600 }}>Salva</button>
          <button onClick={() => setShowLocForm(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>X</button>
        </div>
      </div>
    </div>}

    {/* Locations list */}
    {!selLoc && <Card title="Magazzini" badge={locations.length}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Nome', 'Locale', 'Tipo', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {locations.length === 0 && <tr><td colSpan={4} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessun magazzino. Creane uno per iniziare.</td></tr>}
          {locations.map(l => (
            <tr key={l.id}>
              <td style={{ ...S.td, fontWeight: 500, color: '#3B82F6', cursor: 'pointer' }} onClick={() => setSelLoc(l.id)}>{l.nome}</td>
              <td style={{ ...S.td, color: '#94a3b8' }}>{l.locale || '-'}</td>
              <td style={S.td}><span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>{l.tipo}</span></td>
              <td style={S.td}><button onClick={() => { if (confirm('Eliminare magazzino?')) deleteLoc(l.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>Elimina</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>}

    {/* Stock for selected location */}
    {selLoc && <Card title={'Giacenze: ' + (locations.find(l => l.id === selLoc)?.nome || '')} badge={stock.length}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Prodotto', 'Quantita', 'Unita', 'Valore', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {stock.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessuna giacenza in questo magazzino</td></tr>}
          {stock.map(st => {
            const p = prodMap[st.product_id]
            const val = (st.quantita || 0) * (p?.ultimo_prezzo || 0)
            return <tr key={st.id}>
              <td style={{ ...S.td, fontWeight: 500 }}>{p?.nome || '?'}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{fmtN(st.quantita)}</td>
              <td style={{ ...S.td, color: '#94a3b8' }}>{p?.unita_misura || '-'}</td>
              <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{fmt(val)}</td>
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                <button onClick={() => { setShowAdjust(st); setAdjQty(''); setAdjNote('') }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11, marginRight: 6 }}>Rettifica</button>
                <button onClick={() => { setShowTransfer(st); setTransferLoc(''); setTransferQty('') }} style={{ background: 'none', border: 'none', color: '#8B5CF6', cursor: 'pointer', fontSize: 11 }}>Trasferisci</button>
              </td>
            </tr>
          })}
        </tbody>
      </table>

      {/* Adjust modal */}
      {showAdjust && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginTop: 12, border: '1px solid #3B82F6' }}>
        <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 8 }}>Rettifica: {prodMap[showAdjust.product_id]?.nome} (attuale: {fmtN(showAdjust.quantita)})</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <input placeholder="Delta (+/-)" type="number" step="0.01" value={adjQty} onChange={e => setAdjQty(e.target.value)} style={{ ...iS, width: 120 }} />
          <input placeholder="Note" value={adjNote} onChange={e => setAdjNote(e.target.value)} style={{ ...iS, flex: 1 }} />
          <button onClick={() => doAdjust(showAdjust)} disabled={!adjQty || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600 }}>Applica</button>
          <button onClick={() => setShowAdjust(null)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>X</button>
        </div>
      </div>}

      {/* Transfer modal */}
      {showTransfer && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginTop: 12, border: '1px solid #8B5CF6' }}>
        <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 8 }}>Trasferisci: {prodMap[showTransfer.product_id]?.nome} (disponibile: {fmtN(showTransfer.quantita)})</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <select value={transferLoc} onChange={e => setTransferLoc(e.target.value)} style={{ ...iS, minWidth: 180 }}>
            <option value="">Destinazione...</option>
            {locations.filter(l => l.id !== selLoc).map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <input placeholder="Quantita" type="number" step="0.01" min="0" value={transferQty} onChange={e => setTransferQty(e.target.value)} style={{ ...iS, width: 120 }} />
          <button onClick={() => doTransfer(showTransfer)} disabled={!transferLoc || !transferQty || loading} style={{ ...iS, background: '#8B5CF6', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600 }}>Trasferisci</button>
          <button onClick={() => setShowTransfer(null)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>X</button>
        </div>
      </div>}
    </Card>}
  </>
}
