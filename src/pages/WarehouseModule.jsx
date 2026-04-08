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
  { key: 'cruscotto',  label: 'Cruscotto',  icon: '\u{1F4CA}' },
  { key: 'fatture',    label: 'Fatture',     icon: '\u{1F9FE}' },
  { key: 'prodotti',   label: 'Prodotti',    icon: '\u{1F4E6}' },
  { key: 'ricette',    label: 'Ricette',     icon: '\u{1F373}' },
  { key: 'giacenze',   label: 'Giacenze',    icon: '\u{1F3E0}' },
  { key: 'inventario', label: 'Inventario',  icon: '\u{1F4CB}' },
  { key: 'ordini',     label: 'Ordini',      icon: '\u{1F6D2}' },
  { key: 'prezzi',     label: 'Prezzi',      icon: '\u{1F4B0}' },
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
    {tab === 'prodotti'   && <ProductManager sp={sp} sps={sps} />}
    {tab === 'ricette'    && <RecipeManager sp={sp} sps={sps} />}
    {tab === 'giacenze'   && <StockView sp={sp} sps={sps} />}
    {tab === 'inventario' && <InventoryManager sp={sp} sps={sps} />}
    {tab === 'ordini'     && <OrderManager sp={sp} sps={sps} />}
    {tab === 'prezzi'     && <PriceAnalysis sp={sp} sps={sps} />}
  </>
}
