import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmt, fmtN } from '../shared/styles.jsx'

export default function WarehouseDashboard() {
  const [stats, setStats] = useState({ valore: 0, sottoScorta: 0, movimenti: 0, scostamento: 0 })
  const [critici, setCritici] = useState([])
  const [prezziUp, setPrezziUp] = useState([])
  const [alerts, setAlerts] = useState({ negative: [], critiche: [], senzaRicetta: [], prezziAnomali: [], unitaIncoerenti: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Valore totale magazzino
      const { data: stock } = await supabase.from('warehouse_stock').select('quantita, product_id')
      const { data: products } = await supabase.from('warehouse_products').select('id, nome, categoria, ultimo_prezzo, scorta_minima, unita_misura, attivo').eq('attivo', true)
      const prodMap = Object.fromEntries((products || []).map(p => [p.id, p]))

      let valore = 0
      const sottoScortaList = []
      const stockByProd = {}
      ;(stock || []).forEach(s => {
        const p = prodMap[s.product_id]
        if (!p) return
        stockByProd[s.product_id] = (stockByProd[s.product_id] || 0) + (s.quantita || 0)
        valore += (s.quantita || 0) * (p.ultimo_prezzo || 0)
      })

      ;(products || []).forEach(p => {
        const qty = stockByProd[p.id] || 0
        if (p.scorta_minima && qty < p.scorta_minima) {
          sottoScortaList.push({ ...p, quantita: qty })
        }
      })

      // Movimenti ultimo mese
      const mese = new Date()
      mese.setMonth(mese.getMonth() - 1)
      const { count: movCount } = await supabase.from('warehouse_movements').select('id', { count: 'exact', head: true }).gte('created_at', mese.toISOString())

      // Scostamento ultimo inventario
      const { data: lastInv } = await supabase.from('warehouse_inventories').select('id').order('data', { ascending: false }).limit(1)
      let scostamento = 0
      if (lastInv?.[0]) {
        const { data: items } = await supabase.from('warehouse_inventory_items').select('valore_differenza').eq('inventory_id', lastInv[0].id)
        scostamento = (items || []).reduce((s, i) => s + Math.abs(i.valore_differenza || 0), 0)
      }

      // Aumenti prezzo recenti
      const { data: prices } = await supabase.from('warehouse_prices').select('product_id, prezzo, data_fattura').order('data_fattura', { ascending: false }).limit(200)
      const priceByProd = {}
      ;(prices || []).forEach(pr => {
        if (!priceByProd[pr.product_id]) priceByProd[pr.product_id] = []
        priceByProd[pr.product_id].push(pr)
      })
      const aumenti = []
      Object.entries(priceByProd).forEach(([pid, list]) => {
        if (list.length < 2) return
        const last = list[0].prezzo, prev = list[1].prezzo
        if (prev > 0 && last > prev) {
          const variazione = ((last - prev) / prev * 100)
          if (variazione > 5) {
            const p = prodMap[pid]
            if (p) aumenti.push({ ...p, last, prev, variazione })
          }
        }
      })
      aumenti.sort((a, b) => b.variazione - a.variazione)

      // --- ALERT COMPUTATIONS ---
      // Giacenze negative
      const negative = []
      ;(stock || []).forEach(s => {
        const p = prodMap[s.product_id]
        if (p && (s.quantita || 0) < 0) negative.push({ ...p, quantita: s.quantita })
      })

      // Sotto scorta critica (< 50% scorta_minima)
      const critiche = []
      ;(products || []).forEach(p => {
        const qty = stockByProd[p.id] || 0
        if (p.scorta_minima && qty < p.scorta_minima * 0.5) {
          critiche.push({ ...p, quantita: qty })
        }
      })

      // Vendite senza ricetta
      const senzaRicetta = []
      try {
        const oggi = new Date()
        const setteGiorniFa = new Date(oggi); setteGiorniFa.setDate(oggi.getDate() - 7)
        const { data: recentStats } = await supabase.from('daily_stats').select('receipt_details').gte('data', setteGiorniFa.toISOString().slice(0, 10))
        const { data: allRecipes } = await supabase.from('warehouse_recipes').select('nome')
        const recipeNames = new Set((allRecipes || []).map(r => r.nome.toLowerCase().trim()))
        const soldNames = new Set()
        ;(recentStats || []).forEach(s => {
          const details = typeof s.receipt_details === 'string' ? JSON.parse(s.receipt_details) : (s.receipt_details || [])
          ;(Array.isArray(details) ? details : []).forEach(d => {
            const items = d.items || d.righe || []
            items.forEach(item => {
              const nome = (item.nome || item.descrizione || '').toLowerCase().trim()
              if (nome && !recipeNames.has(nome)) soldNames.add(nome)
            })
          })
        })
        soldNames.forEach(n => senzaRicetta.push({ nome: n }))
      } catch (e) { console.error('Alert vendite senza ricetta:', e) }

      // Prezzi anomali (>20% variazione da prezzo_medio)
      const prezziAnomali = []
      try {
        const { data: prodsFull } = await supabase.from('warehouse_products').select('id, nome, ultimo_prezzo, prezzo_medio').eq('attivo', true)
        ;(prodsFull || []).forEach(p => {
          if (p.prezzo_medio && p.prezzo_medio > 0 && p.ultimo_prezzo) {
            const varPct = Math.abs((p.ultimo_prezzo - p.prezzo_medio) / p.prezzo_medio * 100)
            if (varPct > 20) prezziAnomali.push({ ...p, variazione: varPct })
          }
        })
      } catch (e) { console.error('Alert prezzi anomali:', e) }

      // Unita incoerenti
      const unitaIncoerenti = []
      try {
        const { data: prodsFull2 } = await supabase.from('warehouse_products').select('id, nome, unita_misura, unita_acquisto, fattore_conversione').eq('attivo', true)
        ;(prodsFull2 || []).forEach(p => {
          if (p.unita_misura && p.unita_acquisto && p.unita_misura !== p.unita_acquisto && (p.fattore_conversione === 1 || !p.fattore_conversione)) {
            unitaIncoerenti.push(p)
          }
        })
      } catch (e) { console.error('Alert unita incoerenti:', e) }

      setAlerts({ negative, critiche, senzaRicetta, prezziAnomali, unitaIncoerenti })
      // --- END ALERT COMPUTATIONS ---

      setStats({ valore, sottoScorta: sottoScortaList.length, movimenti: movCount || 0, scostamento })
      setCritici(sottoScortaList.slice(0, 10))
      setPrezziUp(aumenti.slice(0, 10))
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 13 }}>Caricamento cruscotto...</div>

  return <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
      <KPI label="Valore magazzino" icon="" value={fmt(stats.valore)} accent="#F59E0B" />
      <KPI label="Sotto scorta" icon="" value={stats.sottoScorta} sub="prodotti" accent="#EF4444" />
      <KPI label="Movimenti mese" icon="" value={fmtN(stats.movimenti)} accent="#3B82F6" />
      <KPI label="Scostamento inv." icon="" value={fmt(stats.scostamento)} sub="ultimo inventario" accent="#8B5CF6" />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Card title="Prodotti sotto scorta" badge={critici.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Prodotto', 'Categoria', 'Giacenza', 'Scorta min.'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {critici.length === 0 && <tr><td colSpan={4} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessun prodotto sotto scorta</td></tr>}
            {critici.map(p => (
              <tr key={p.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{p.nome}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{p.categoria}</td>
                <td style={{ ...S.td, color: '#EF4444', fontWeight: 600 }}>{fmtN(p.quantita)} {p.unita_misura}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{fmtN(p.scorta_minima)} {p.unita_misura}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Aumenti prezzo recenti" badge={prezziUp.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Prodotto', 'Precedente', 'Attuale', 'Var. %'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {prezziUp.length === 0 && <tr><td colSpan={4} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessun aumento significativo</td></tr>}
            {prezziUp.map(p => (
              <tr key={p.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{p.nome}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{fmt(p.prev)}</td>
                <td style={{ ...S.td, color: '#f1f5f9' }}>{fmt(p.last)}</td>
                <td style={S.td}><span style={S.badge('#EF4444', 'rgba(239,68,68,.12)')}>+{p.variazione.toFixed(1)}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>

    {/* Anomalie e Controlli */}
    <div style={{ marginTop: 12 }}>
      <Card title="Anomalie e Controlli" badge={alerts.negative.length + alerts.critiche.length + alerts.senzaRicetta.length + alerts.prezziAnomali.length + alerts.unitaIncoerenti.length}>
        {[
          { label: 'Giacenze negative', items: alerts.negative, color: '#EF4444', bg: 'rgba(239,68,68,.12)', render: p => `${p.nome} (${fmtN(p.quantita)} ${p.unita_misura || ''})` },
          { label: 'Sotto scorta critica (<50%)', items: alerts.critiche, color: '#EF4444', bg: 'rgba(239,68,68,.12)', render: p => `${p.nome} (${fmtN(p.quantita)}/${fmtN(p.scorta_minima)} ${p.unita_misura || ''})` },
          { label: 'Vendite senza ricetta (7gg)', items: alerts.senzaRicetta, color: '#F59E0B', bg: 'rgba(245,158,11,.12)', render: p => p.nome },
          { label: 'Prezzi anomali (>20% var.)', items: alerts.prezziAnomali, color: '#EAB308', bg: 'rgba(234,179,8,.12)', render: p => `${p.nome} (${fmt(p.ultimo_prezzo)} vs media ${fmt(p.prezzo_medio)}, ${p.variazione?.toFixed(0)}%)` },
          { label: 'Unita incoerenti', items: alerts.unitaIncoerenti, color: '#EAB308', bg: 'rgba(234,179,8,.12)', render: p => `${p.nome} (${p.unita_misura} / ${p.unita_acquisto}, fatt. conv. = ${p.fattore_conversione || 1})` },
        ].map(alert => (
          <div key={alert.label} style={{ marginBottom: 12, padding: 10, background: '#131825', borderRadius: 8, border: `1px solid ${alert.items.length > 0 ? alert.color : '#2a3042'}33` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: alert.items.length > 0 ? 8 : 0 }}>
              <span style={S.badge(alert.color, alert.bg)}>{alert.items.length}</span>
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{alert.label}</span>
            </div>
            {alert.items.slice(0, 5).map((p, i) => (
              <div key={p.id || i} style={{ fontSize: 12, color: '#94a3b8', padding: '2px 0 2px 28px' }}>
                {alert.render(p)}
              </div>
            ))}
            {alert.items.length > 5 && <div style={{ fontSize: 11, color: '#475569', padding: '2px 0 0 28px' }}>...e altri {alert.items.length - 5}</div>}
          </div>
        ))}
        {(alerts.negative.length + alerts.critiche.length + alerts.senzaRicetta.length + alerts.prezziAnomali.length + alerts.unitaIncoerenti.length) === 0 &&
          <div style={{ textAlign: 'center', padding: 20, color: '#475569', fontSize: 13 }}>Nessuna anomalia rilevata</div>
        }
      </Card>
    </div>
  </>
}
