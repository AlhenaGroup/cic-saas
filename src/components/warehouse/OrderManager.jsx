import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtN } from '../shared/styles.jsx'

const iS = S.input
const STATUS_COLORS = {
  bozza:    { c: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  inviato:  { c: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  ricevuto: { c: '#10B981', bg: 'rgba(16,185,129,.12)' },
}

export default function OrderManager() {
  const [orders, setOrders] = useState([])
  const [orderItems, setOrderItems] = useState([])
  const [products, setProducts] = useState([])
  const [stock, setStock] = useState([])
  const [movements, setMovements] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [selected, setSelected] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const { data: ord } = await supabase.from('warehouse_orders').select('*').order('data', { ascending: false })
    setOrders(ord || [])
    const { data: prods } = await supabase.from('warehouse_products').select('*').eq('attivo', true).order('nome')
    setProducts(prods || [])
    const { data: st } = await supabase.from('warehouse_stock').select('product_id, quantita')
    setStock(st || [])
    // Last 30 days movements for average consumption
    const d30 = new Date(); d30.setDate(d30.getDate() - 30)
    const { data: mov } = await supabase.from('warehouse_movements').select('product_id, quantita, tipo').gte('created_at', d30.toISOString())
    setMovements(mov || [])
  }, [])

  const loadOrderItems = useCallback(async (orderId) => {
    const { data } = await supabase.from('warehouse_order_items').select('*').eq('order_id', orderId).order('id')
    setOrderItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (selected) loadOrderItems(selected) }, [selected, loadOrderItems])

  const prodMap = Object.fromEntries(products.map(p => [p.id, p]))

  // Calculate suggestions
  const calcSuggestions = useCallback(() => {
    const stockByProd = {}
    stock.forEach(s => { stockByProd[s.product_id] = (stockByProd[s.product_id] || 0) + (s.quantita || 0) })

    const consumoByProd = {}
    movements.forEach(m => {
      if (m.tipo === 'scarico' || m.tipo === 'trasferimento_out') {
        consumoByProd[m.product_id] = (consumoByProd[m.product_id] || 0) + (m.quantita || 0)
      }
    })

    const suggs = []
    products.forEach(p => {
      const qty = stockByProd[p.id] || 0
      if (p.scorta_minima && qty < p.scorta_minima) {
        const consumoMedio = (consumoByProd[p.id] || 0) / 30 // daily average
        const needed = Math.max((consumoMedio * (p.giorni_copertura || 7)) - qty, p.scorta_minima - qty)
        suggs.push({ ...p, quantita_attuale: qty, consumo_medio: consumoMedio, quantita_suggerita: Math.ceil(needed) })
      }
    })
    suggs.sort((a, b) => (a.fornitore_principale || '').localeCompare(b.fornitore_principale || ''))
    setSuggestions(suggs)
    setShowSuggestions(true)
  }, [products, stock, movements])

  const createOrderFromSuggestions = async (fornitore, items) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: order } = await supabase.from('warehouse_orders').insert({
      user_id: user.id, fornitore, data: new Date().toISOString().split('T')[0], stato: 'bozza',
    }).select().single()
    if (order) {
      const orderItemsData = items.map(i => ({
        order_id: order.id, product_id: i.id,
        quantita_suggerita: i.quantita_suggerita, quantita_ordinata: i.quantita_suggerita,
      }))
      await supabase.from('warehouse_order_items').insert(orderItemsData)
      setSelected(order.id)
    }
    setShowSuggestions(false); await load(); setLoading(false)
  }

  const updateOrderQty = async (item, val) => {
    await supabase.from('warehouse_order_items').update({ quantita_ordinata: parseFloat(val) || 0 }).eq('id', item.id)
    if (selected) await loadOrderItems(selected)
  }

  const updateOrderStatus = async (orderId, stato) => {
    await supabase.from('warehouse_orders').update({ stato }).eq('id', orderId)
    await load()
  }

  const deleteOrder = async (id) => {
    await supabase.from('warehouse_order_items').delete().eq('order_id', id)
    await supabase.from('warehouse_orders').delete().eq('id', id)
    if (selected === id) { setSelected(null); setOrderItems([]) }
    await load()
  }

  // Group suggestions by fornitore
  const suggByFornitore = {}
  suggestions.forEach(s => {
    const f = s.fornitore_principale || 'Senza fornitore'
    if (!suggByFornitore[f]) suggByFornitore[f] = []
    suggByFornitore[f].push(s)
  })

  return <>
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      <button onClick={calcSuggestions} style={{ ...iS, background: '#F59E0B', color: 'var(--text)', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>Calcola ordini suggeriti</button>
    </div>

    {/* Suggestions */}
    {showSuggestions && <div style={{ marginBottom: 16 }}>
      <Card title="Ordini suggeriti" badge={suggestions.length + ' prodotti'}>
        {suggestions.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>Tutti i prodotti sono sopra la scorta minima</div>}
        {Object.entries(suggByFornitore).map(([fornitore, items]) => (
          <div key={fornitore} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{fornitore}</span>
              <button onClick={() => createOrderFromSuggestions(fornitore, items)} disabled={loading} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11 }}>Crea ordine</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Prodotto', 'Giacenza', 'Scorta min.', 'Consumo/gg', 'Suggerito'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id}>
                    <td style={{ ...S.td, fontWeight: 500 }}>{it.nome}</td>
                    <td style={{ ...S.td, color: '#EF4444', fontWeight: 600 }}>{fmtN(it.quantita_attuale)} {it.unita_misura}</td>
                    <td style={{ ...S.td, color: 'var(--text3)' }}>{fmtN(it.scorta_minima)}</td>
                    <td style={{ ...S.td, color: 'var(--text2)' }}>{it.consumo_medio.toFixed(1)}</td>
                    <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{fmtN(it.quantita_suggerita)} {it.unita_misura}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
    </div>}

    {/* Orders list */}
    <Card title="Ordini" badge={orders.length}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
          {['Data', 'Fornitore', 'Stato', 'Note', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: 'var(--text3)', textAlign: 'center', padding: 20 }}>Nessun ordine</td></tr>}
          {orders.map(o => {
            const sc = STATUS_COLORS[o.stato] || STATUS_COLORS.bozza
            return <tr key={o.id} style={{ cursor: 'pointer', background: selected === o.id ? '#131825' : 'transparent' }} onClick={() => setSelected(selected === o.id ? null : o.id)}>
              <td style={{ ...S.td, fontWeight: 500 }}>{o.data}</td>
              <td style={{ ...S.td, color: 'var(--text)' }}>{o.fornitore}</td>
              <td style={S.td}><span style={S.badge(sc.c, sc.bg)}>{o.stato}</span></td>
              <td style={{ ...S.td, color: 'var(--text3)', fontSize: 12 }}>{o.note || '-'}</td>
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                {o.stato === 'bozza' && <button onClick={e => { e.stopPropagation(); updateOrderStatus(o.id, 'inviato') }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11, marginRight: 6 }}>Invia</button>}
                {o.stato === 'inviato' && <button onClick={e => { e.stopPropagation(); updateOrderStatus(o.id, 'ricevuto') }} style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontSize: 11, marginRight: 6 }}>Ricevuto</button>}
                <button onClick={e => { e.stopPropagation(); if (confirm('Eliminare ordine?')) deleteOrder(o.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>Elimina</button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </Card>

    {/* Order detail */}
    {selected && <div style={{ marginTop: 12 }}>
      <Card title={'Dettaglio ordine: ' + (orders.find(o => o.id === selected)?.fornitore || '')} badge={orderItems.length + ' righe'}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Prodotto', 'Unita', 'Suggerita', 'Ordinata', 'Note'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {orderItems.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: 'var(--text3)', textAlign: 'center' }}>Nessun articolo</td></tr>}
            {orderItems.map(it => {
              const prod = prodMap[it.product_id]
              const ord = orders.find(o => o.id === selected)
              return <tr key={it.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{prod?.nome || '?'}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12 }}>{prod?.unita_misura || '-'}</td>
                <td style={{ ...S.td, color: 'var(--text3)' }}>{fmtN(it.quantita_suggerita)}</td>
                <td style={S.td}>
                  {ord?.stato === 'bozza'
                    ? <input type="number" step="0.01" value={it.quantita_ordinata ?? ''} onChange={e => updateOrderQty(it, e.target.value)} style={{ ...iS, width: 80, textAlign: 'center', padding: '3px 6px' }} />
                    : <span style={{ fontWeight: 600 }}>{fmtN(it.quantita_ordinata)}</span>
                  }
                </td>
                <td style={{ ...S.td, color: 'var(--text3)', fontSize: 12 }}>{it.note || '-'}</td>
              </tr>
            })}
          </tbody>
        </table>
      </Card>
    </div>}
  </>
}
