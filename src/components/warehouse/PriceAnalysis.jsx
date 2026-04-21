import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtN } from '../shared/styles.jsx'

const iS = S.input

export default function PriceAnalysis() {
  const [products, setProducts] = useState([])
  const [prices, setPrices] = useState([])
  const [selectedProd, setSelectedProd] = useState(null)
  const [prodPrices, setProdPrices] = useState([])
  const [filter, setFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [fornFilter, setFornFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, categoria, fornitore_principale, ultimo_prezzo, prezzo_medio, unita_misura').eq('attivo', true).order('nome')
    setProducts(prods || [])
    const { data: pr } = await supabase.from('warehouse_prices').select('*').order('data_fattura', { ascending: false }).limit(500)
    setPrices(pr || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Calculate variations
  const priceByProd = {}
  prices.forEach(p => {
    if (!priceByProd[p.product_id]) priceByProd[p.product_id] = []
    priceByProd[p.product_id].push(p)
  })

  const productData = products.map(p => {
    const history = priceByProd[p.id] || []
    let variazione = 0
    if (history.length >= 2) {
      const last = history[0].prezzo, prev = history[1].prezzo
      if (prev > 0) variazione = ((last - prev) / prev * 100)
    }
    return { ...p, variazione, historyCount: history.length }
  })

  const filtered = productData.filter(p => {
    if (filter && !p.nome.toLowerCase().includes(filter.toLowerCase())) return false
    if (catFilter && p.categoria !== catFilter) return false
    if (fornFilter && (p.fornitore_principale || '') !== fornFilter) return false
    return true
  })

  // Alerts: significant increases (> 10%)
  const alerts = productData.filter(p => p.variazione > 10).sort((a, b) => b.variazione - a.variazione)

  const categories = [...new Set(products.map(p => p.categoria).filter(Boolean))]
  const fornitori = [...new Set(products.map(p => p.fornitore_principale).filter(Boolean))]

  const loadProdHistory = (prodId) => {
    setSelectedProd(prodId)
    setProdPrices((priceByProd[prodId] || []).slice(0, 20))
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 13 }}>Caricamento prezzi...</div>

  return <>
    {/* Alerts */}
    {alerts.length > 0 && <Card title="Allerta prezzi" badge={alerts.length + ' aumenti significativi'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {alerts.slice(0, 8).map(p => (
          <div key={p.id} style={{ ...S.card, padding: '10px 14px', minWidth: 180, flex: '0 0 auto' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{p.nome}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{p.fornitore_principale || '-'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#EF4444', marginTop: 4 }}>+{p.variazione.toFixed(1)}%</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{fmt(p.ultimo_prezzo)}</div>
          </div>
        ))}
      </div>
    </Card>}

    {alerts.length > 0 && <div style={{ marginTop: 12 }} />}

    {/* Filters */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      <input placeholder="Cerca articolo..." value={filter} onChange={e => setFilter(e.target.value)} style={{ ...iS, flex: 1 }} />
      <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={iS}>
        <option value="">Tutte le categorie</option>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={fornFilter} onChange={e => setFornFilter(e.target.value)} style={iS}>
        <option value="">Tutti i fornitori</option>
        {fornitori.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>

    {/* Price table */}
    <Card title="Analisi prezzi" badge={filtered.length + ' articoli'}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Articolo', 'Categoria', 'Fornitore', 'Ultimo prezzo', 'Prezzo medio', 'Var. %', 'Storico', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessun articolo trovato</td></tr>}
          {filtered.map(p => {
            const varColor = p.variazione > 5 ? '#EF4444' : p.variazione < -5 ? '#10B981' : '#64748b'
            return <tr key={p.id} style={{ background: selectedProd === p.id ? '#131825' : 'transparent' }}>
              <td style={{ ...S.td, fontWeight: 500 }}>{p.nome}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{p.categoria}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{p.fornitore_principale || '-'}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{p.ultimo_prezzo ? fmt(p.ultimo_prezzo) : '-'}</td>
              <td style={{ ...S.td, color: '#64748b' }}>{p.prezzo_medio ? fmt(p.prezzo_medio) : '-'}</td>
              <td style={S.td}>
                {p.variazione !== 0
                  ? <span style={S.badge(varColor, p.variazione > 5 ? 'rgba(239,68,68,.12)' : p.variazione < -5 ? 'rgba(16,185,129,.12)' : 'rgba(148,163,184,.1)')}>
                      {p.variazione > 0 ? '+' : ''}{p.variazione.toFixed(1)}%
                    </span>
                  : <span style={{ color: '#475569', fontSize: 12 }}>-</span>
                }
              </td>
              <td style={{ ...S.td, color: '#64748b', fontSize: 12 }}>{p.historyCount} registrazioni</td>
              <td style={S.td}>
                <button onClick={() => loadProdHistory(selectedProd === p.id ? null : p.id)} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11 }}>
                  {selectedProd === p.id ? 'Chiudi' : 'Dettaglio'}
                </button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </Card>

    {/* Price history detail */}
    {selectedProd && <div style={{ marginTop: 12 }}>
      <Card title={'Storico prezzi: ' + (products.find(p => p.id === selectedProd)?.nome || '')} badge={prodPrices.length + ' registrazioni'}>
        {prodPrices.length === 0
          ? <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: 20 }}>Nessuno storico prezzi disponibile</div>
          : <>
            {/* Simple bar chart */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, marginBottom: 16, padding: '0 8px' }}>
              {(() => {
                const maxP = Math.max(...prodPrices.map(p => p.prezzo || 0), 0.01)
                return prodPrices.slice().reverse().map((p, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>{fmt(p.prezzo)}</span>
                    <div style={{ width: '100%', maxWidth: 30, height: Math.max((p.prezzo / maxP) * 100, 4), background: '#F59E0B', borderRadius: 3 }} />
                    <span style={{ fontSize: 8, color: '#475569' }}>{(p.data_fattura || '').slice(5)}</span>
                  </div>
                ))
              })()}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                {['Data', 'Fornitore', 'Prezzo'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {prodPrices.map((p, i) => (
                  <tr key={i}>
                    <td style={S.td}>{p.data_fattura}</td>
                    <td style={{ ...S.td, color: '#94a3b8' }}>{p.fornitore || '-'}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmt(p.prezzo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        }
      </Card>
    </div>}
  </>
}
