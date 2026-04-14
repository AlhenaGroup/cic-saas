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

// Prodotti venduti su CiC (da daily_stats cat_records)
import { useState as useState2, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card, KPI, fmt, fmtD, fmtN } from '../components/shared/styles.jsx'

function ProdottiCiC({ sp, sps }) {
  const [products, setProducts] = useState2([])
  const [loading, setLoading] = useState2(false)

  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('daily_stats').select('cat_records, dept_records, salespoint_name')
    if (sp && sp !== 'all') {
      const asNum = Number(sp)
      if (!Number.isNaN(asNum) && String(asNum) === String(sp)) query = query.eq('salespoint_id', asNum)
      else if (selectedLocaleName) query = query.eq('salespoint_name', selectedLocaleName)
    }
    const { data: rows } = await query
    // Aggrega categorie vendute
    const catMap = {}
    ;(rows || []).forEach(row => {
      ;(row.cat_records || []).forEach(rec => {
        const name = rec.description || rec.idCategory || 'Altro'
        if (!catMap[name]) catMap[name] = { name, revenue: 0, qty: 0, days: 0 }
        catMap[name].revenue += Number(rec.profit) || 0
        catMap[name].qty += Number(rec.quantity) || 0
        catMap[name].days++
      })
    })
    const sorted = Object.values(catMap).sort((a, b) => b.revenue - a.revenue)
    setProducts(sorted)
    setLoading(false)
  }, [sp, selectedLocaleName])

  useEffect(() => { load() }, [load])

  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0)
  const totalQty = products.reduce((s, p) => s + p.qty, 0)

  return <Card title="Prodotti venduti su Cassa in Cloud" badge={loading ? '...' : products.length + ' categorie'}>
    {loading && <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Caricamento...</div>}
    {!loading && products.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#475569' }}>Nessun dato vendite. Sincronizza i dati CiC.</div>}
    {products.length > 0 && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        <KPI label="Categorie" icon="🍕" value={products.length} accent="#F59E0B" />
        <KPI label="Ricavi totali" icon="💰" value={fmtD(totalRevenue)} accent="#10B981" />
        <KPI label="Pezzi venduti" icon="📦" value={fmtN(totalQty)} accent="#3B82F6" />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Categoria', 'Ricavi', '% su totale', 'Quantita', 'Giorni vendita'].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1f2e' }}>
              <td style={{ ...S.td, fontWeight: 600 }}>{p.name}</td>
              <td style={{ ...S.td, fontWeight: 600, color: '#10B981' }}>{fmtD(p.revenue)}</td>
              <td style={{ ...S.td, color: '#94a3b8' }}>{totalRevenue > 0 ? (p.revenue / totalRevenue * 100).toFixed(1) + '%' : '—'}</td>
              <td style={S.td}>{fmtN(p.qty)}</td>
              <td style={{ ...S.td, color: '#64748b' }}>{p.days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>}
  </Card>
}
