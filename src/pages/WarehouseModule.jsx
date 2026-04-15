import { useState } from 'react'
import { S } from '../components/shared/styles.jsx'
import WarehouseDashboard from '../components/warehouse/WarehouseDashboard'
import InvoiceManager from '../components/warehouse/InvoiceManager'
import ProductManager from '../components/warehouse/ProductManager'
import RecipeManager from '../components/warehouse/RecipeManager'
import StockView from '../components/warehouse/StockView'
import InventoryManager from '../components/warehouse/InventoryManager'
import OrderManager from '../components/warehouse/OrderManager'
import PriceAnalysis from '../components/warehouse/PriceAnalysis'

const TABS = [
  { key: 'cruscotto',  label: 'Cruscotto',  icon: '📊' },
  { key: 'fatture',    label: 'Fatture',     icon: '🧾' },
  { key: 'prodotti',   label: 'Prodotti',    icon: '🍕' },
  { key: 'articoli',   label: 'Articoli',    icon: '📦' },
  { key: 'ricette',    label: 'Ricette',     icon: '🍳' },
  { key: 'giacenze',   label: 'Giacenze',    icon: '🏠' },
  { key: 'inventario', label: 'Inventario',  icon: '📋' },
  { key: 'ordini',     label: 'Ordini',      icon: '🛒' },
  { key: 'prezzi',     label: 'Prezzi',      icon: '💰' },
]

export default function WarehouseModule({ sp, sps }) {
  const [tab, setTab] = useState('cruscotto')

  const tabStyle = (active) => ({
    padding: '8px 16px', fontSize: 12, fontWeight: active ? 700 : 500,
    color: active ? '#F59E0B' : '#94a3b8', background: active ? 'rgba(245,158,11,.1)' : 'transparent',
    border: 'none', borderBottom: active ? '2px solid #F59E0B' : '2px solid transparent',
    cursor: 'pointer', transition: 'all .2s',
  })

  return <>
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #2a3042', marginBottom: 16, overflowX: 'auto' }}>
      {TABS.map(t => (
        <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>
          {t.icon} {t.label}
        </button>
      ))}
    </div>

    {tab === 'cruscotto'  && <WarehouseDashboard sp={sp} sps={sps} />}
    {tab === 'fatture'    && <InvoiceManager sp={sp} sps={sps} />}
    {tab === 'prodotti'   && <ProdottiCiC sp={sp} sps={sps} />}
    {tab === 'articoli'   && <ProductManager sp={sp} sps={sps} />}
    {tab === 'ricette'    && <RecipeManager sp={sp} sps={sps} />}
    {tab === 'giacenze'   && <StockView sp={sp} sps={sps} />}
    {tab === 'inventario' && <InventoryManager sp={sp} sps={sps} />}
    {tab === 'ordini'     && <OrderManager sp={sp} sps={sps} />}
    {tab === 'prezzi'     && <PriceAnalysis sp={sp} sps={sps} />}
  </>
}

// Prodotti venduti su CiC (da daily_stats receipt_details)
import { useState as useState2, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ScatterChart, Scatter, XAxis as SX, YAxis as SY, Tooltip as ST, ResponsiveContainer as SRC, Cell } from 'recharts'
import { Card, KPI, fmt, fmtD, fmtN } from '../components/shared/styles.jsx'

const SORT_OPTIONS = [
  { key: 'qty_desc', label: 'Più venduti' },
  { key: 'qty_asc', label: 'Meno venduti' },
  { key: 'revenue_desc', label: 'Incasso più alto' },
  { key: 'mol_desc', label: 'Margine più alto' },
  { key: 'mol_asc', label: 'Margine più basso' },
  { key: 'fc_desc', label: 'Food cost % più alto' },
  { key: 'fc_asc', label: 'Food cost % più basso' },
  { key: 'name_asc', label: 'Nome A→Z' },
]

function ProdottiCiC({ sp, sps }) {
  const [products, setProducts] = useState2([])
  const [loading, setLoading] = useState2(false)
  const [sortBy, setSortBy] = useState2('qty_desc')

  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('daily_stats').select('receipt_details, cat_records, salespoint_name')
    if (sp && sp !== 'all') {
      const asNum = Number(sp)
      if (!Number.isNaN(asNum) && String(asNum) === String(sp)) query = query.eq('salespoint_id', asNum)
      else if (selectedLocaleName) query = query.eq('salespoint_name', selectedLocaleName)
    }
    const { data: rows } = await query
    // Aggrega per singolo prodotto dai receipt_details
    const prodMap = {}
    ;(rows || []).forEach(row => {
      ;(row.receipt_details || []).forEach(receipt => {
        ;(receipt.items || []).forEach(item => {
          const name = item.nome || item.description || 'Sconosciuto'
          const reparto = item.reparto || item.department?.description || '—'
          const categoria = item.categoria || item.category?.description || '—'
          const price = Number(item.prezzo) || Number(item.totalPrice) || 0
          const qty = Number(item.qty) || Number(item.quantity) || 1
          if (!prodMap[name]) prodMap[name] = { name, reparto, categoria, revenue: 0, qty: 0, avgPrice: 0, costo: 0, mol: 0, fcPct: 0 }
          prodMap[name].revenue += price
          prodMap[name].qty += qty
          if (prodMap[name].reparto === '—' && reparto !== '—') prodMap[name].reparto = reparto
          if (prodMap[name].categoria === '—' && categoria !== '—') prodMap[name].categoria = categoria
        })
      })
    })
    // Calcola prezzo medio
    Object.values(prodMap).forEach(p => {
      p.avgPrice = p.qty > 0 ? Math.round(p.revenue / p.qty * 100) / 100 : 0
      // TODO: costo da ricette (per ora 0)
      p.mol = p.avgPrice - p.costo
      p.fcPct = p.avgPrice > 0 ? Math.round(p.costo / p.avgPrice * 10000) / 100 : 0
    })
    setProducts(Object.values(prodMap).filter(p => p.qty > 0))
    setLoading(false)
  }, [sp, selectedLocaleName])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => {
    const list = [...products]
    switch (sortBy) {
      case 'qty_desc': return list.sort((a, b) => b.qty - a.qty)
      case 'qty_asc': return list.sort((a, b) => a.qty - b.qty)
      case 'revenue_desc': return list.sort((a, b) => b.revenue - a.revenue)
      case 'mol_desc': return list.sort((a, b) => b.mol - a.mol)
      case 'mol_asc': return list.sort((a, b) => a.mol - b.mol)
      case 'fc_desc': return list.sort((a, b) => b.fcPct - a.fcPct)
      case 'fc_asc': return list.sort((a, b) => a.fcPct - b.fcPct)
      case 'name_asc': return list.sort((a, b) => a.name.localeCompare(b.name))
      default: return list
    }
  }, [products, sortBy])

  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0)
  const totalQty = products.reduce((s, p) => s + p.qty, 0)

  // Matrice Eisenhower: vendite (x) × margine (y)
  const medianQty = products.length > 0 ? [...products].sort((a, b) => a.qty - b.qty)[Math.floor(products.length / 2)]?.qty || 1 : 1
  const medianMol = products.length > 0 ? [...products].sort((a, b) => a.mol - b.mol)[Math.floor(products.length / 2)]?.mol || 0 : 0
  const matrixData = products.map(p => ({
    name: p.name, x: p.qty, y: p.mol,
    quadrant: p.qty >= medianQty ? (p.mol >= medianMol ? 'star' : 'review') : (p.mol >= medianMol ? 'niche' : 'drop'),
  }))
  const quadColors = { star: '#10B981', review: '#F59E0B', niche: '#3B82F6', drop: '#EF4444' }

  return <>
    {/* Matrice Eisenhower — 4 quadranti */}
    {products.length > 5 && <Card title="Matrice Prodotti — Vendite × Margine">
      <div style={{ position: 'relative', width: '100%', height: 380 }}>
        {/* Sfondi quadranti */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: '50%', bottom: '50%', background: 'rgba(245,158,11,.06)', borderRight: '1px dashed #2a3042', borderBottom: '1px dashed #2a3042' }} />
        <div style={{ position: 'absolute', top: 0, left: '50%', right: 0, bottom: '50%', background: 'rgba(16,185,129,.06)', borderBottom: '1px dashed #2a3042' }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, right: '50%', bottom: 0, background: 'rgba(239,68,68,.06)', borderRight: '1px dashed #2a3042' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', right: 0, bottom: 0, background: 'rgba(59,130,246,.06)' }} />
        {/* Label quadranti */}
        <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, color: '#F59E0B', fontWeight: 600, opacity: 0.8 }}>⚠ Alto vendente / Basso margine</div>
        <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, color: '#10B981', fontWeight: 600, opacity: 0.8, textAlign: 'right' }}>⭐ Alto vendente / Alto margine</div>
        <div style={{ position: 'absolute', bottom: 28, left: 8, fontSize: 10, color: '#EF4444', fontWeight: 600, opacity: 0.8 }}>✗ Basso vendente / Basso margine</div>
        <div style={{ position: 'absolute', bottom: 28, right: 8, fontSize: 10, color: '#3B82F6', fontWeight: 600, opacity: 0.8, textAlign: 'right' }}>💎 Basso vendente / Alto margine</div>
        {/* Assi label */}
        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: '#475569' }}>Margine → alto</div>
        <div style={{ position: 'absolute', top: '50%', left: 4, transform: 'translateY(-50%) rotate(-90deg)', fontSize: 9, color: '#475569', transformOrigin: 'left center' }}>Vendite ↑</div>
        <SRC>
          <ScatterChart margin={{ top: 30, right: 20, bottom: 25, left: 20 }}>
            <SX type="number" dataKey="y" name="Margine €" stroke="#2a3042" fontSize={9} tick={{ fill: '#475569' }} />
            <SY type="number" dataKey="x" name="Qty vendute" stroke="#2a3042" fontSize={9} tick={{ fill: '#475569' }} />
            <ST contentStyle={{ background: '#0f1420', border: '1px solid #2a3042', fontSize: 11, zIndex: 10 }}
              formatter={(v, name) => [name === 'Qty vendute' ? fmtN(v) : fmtD(v), name]}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.name || ''} />
            <Scatter data={matrixData} nameKey="name">
              {matrixData.map((d, i) => <Cell key={i} fill={quadColors[d.quadrant]} fillOpacity={0.8} />)}
            </Scatter>
          </ScatterChart>
        </SRC>
      </div>
    </Card>}

    <Card title="Prodotti venduti" badge={loading ? '...' : products.length + ' prodotti'} extra={
      <select value={sortBy} onChange={e => setSortBy(e.target.value)}
        style={{ ...S.input, fontSize: 11, padding: '4px 8px' }}>
        {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    }>
      {loading && <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Caricamento...</div>}
      {!loading && products.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#475569' }}>Nessun dato vendite.</div>}
      {sorted.length > 0 && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
          <KPI label="Prodotti" icon="🍕" value={products.length} accent="#F59E0B" />
          <KPI label="Incasso totale" icon="💰" value={fmtD(totalRevenue)} accent="#10B981" />
          <KPI label="Pezzi venduti" icon="📦" value={fmtN(totalQty)} accent="#3B82F6" />
        </div>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome', 'Reparto', 'Categoria', 'Prezzo vendita', 'Qty vendute', 'Incasso tot.', 'Costo', 'MOL', 'FC%'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 600, fontSize: 12 }}>{p.name}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 11 }}>{p.reparto}</td>
                <td style={{ ...S.td, color: '#8B5CF6', fontSize: 11 }}>{p.categoria}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{fmtD(p.avgPrice)}</td>
                <td style={S.td}>{fmtN(p.qty)}</td>
                <td style={{ ...S.td, fontWeight: 600, color: '#10B981' }}>{fmtD(p.revenue)}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{p.costo > 0 ? fmtD(p.costo) : <span style={{ color: '#475569', fontSize: 10 }}>da ricette</span>}</td>
                <td style={{ ...S.td, fontWeight: 600, color: p.mol > 0 ? '#10B981' : '#EF4444' }}>{p.costo > 0 ? fmtD(p.mol) : '—'}</td>
                <td style={{ ...S.td, fontWeight: 600, color: p.fcPct > 35 ? '#EF4444' : p.fcPct > 25 ? '#F59E0B' : '#10B981' }}>{p.costo > 0 ? p.fcPct.toFixed(1) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </>}
    </Card>
  </>
}
