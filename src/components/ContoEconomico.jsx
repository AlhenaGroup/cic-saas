import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { S, KPI, Card, Bar2, fmt, fmtD, fmtN, pct } from './shared/styles.jsx'

export default function ContoEconomico({ ce, from, to }) {
  const [invoices, setInvoices] = useState([])
  const [selectedVoce, setSelectedVoce] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('warehouse_invoices').select('*').order('data', { ascending: false }).limit(100)
    setInvoices(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // F&B = food + beverage (solo indicatore, NON costo nel MOL)
  const fb = (ce.foodCost || 0) + (ce.bevCost || 0)
  const fbPct = ce.ricavi > 0 ? (fb / ce.ricavi * 100) : 0

  // Fatture raggruppate per voce CE
  const invoicesByVoce = {
    'food': invoices.filter(i => (i.tipo_doc === 'TD01') && (i.fornitore || '').toLowerCase().match(/metro|partesa|davide|ortofrutta|food|carne|pesce|frutta|verdur/i)),
    'beverage': invoices.filter(i => (i.tipo_doc === 'TD01') && (i.fornitore || '').toLowerCase().match(/beverage|nobile|birr|vin|spirit|drink|coca|bevand/i)),
    'materiali': invoices.filter(i => (i.tipo_doc === 'TD01') && (i.fornitore || '').toLowerCase().match(/consumo|materiale|packagin|carta|plastica|detersiv/i)),
    'struttura': invoices.filter(i => (i.tipo_doc === 'TD01') && (i.fornitore || '').toLowerCase().match(/hera|enel|gas|acqua|affitto|manutenzione|assicuraz/i)),
    'personale': invoices.filter(i => (i.tipo_doc === 'TD01') && (i.fornitore || '').toLowerCase().match(/personale|consulen|paga|lavoro|inps|inail/i)),
    'altro': [],
  }
  // Le fatture non categorizzate vanno in "altro"
  const categorized = new Set([...Object.values(invoicesByVoce).flat().map(i => i.id)])
  invoicesByVoce.altro = invoices.filter(i => !categorized.has(i.id))

  const voceLabels = {
    'food': '🍕 Food cost',
    'beverage': '🍺 Beverage cost',
    'materiali': '📦 Mat. consumo',
    'struttura': '🏗️ Struttura',
    'personale': '👥 Personale',
    'altro': '📄 Non categorizzate',
  }

  const iS = S.input

  return <>
    {/* KPI con F&B */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Ricavi" icon="💶" value={fmt(ce.ricavi)} sub="totale venduto" accent='#10B981' />
      <KPI label="F&B" icon="🍽️" value={fmt(fb)} sub={fbPct.toFixed(1) + '% su incasso'} accent='#F97316' />
      <KPI label="Food cost" icon="🍕" value={fmt(ce.foodCost)} sub={pct(ce.foodCost, ce.ricavi) + ' dei ricavi'} accent='#F59E0B' />
      <KPI label="Bev. cost" icon="🍺" value={fmt(ce.bevCost)} sub={pct(ce.bevCost, ce.ricavi) + ' dei ricavi'} accent='#3B82F6' />
      <KPI label="MOL" icon="📊" value={fmt(ce.mol)} sub={pct(ce.mol, ce.ricavi) + ' margine'} accent='#10B981' />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Conto Economico con righe cliccabili */}
      <Card title="Conto Economico">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Voce', 'Importo', '% Ricavi', 'Fatture'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {[
              { label: '📈 RICAVI', val: ce.ricavi, bold: true, color: '#10B981', voce: null },
              { label: '🍕 Food cost', val: -ce.foodCost, color: '#EF4444', voce: 'food' },
              { label: '🍺 Beverage cost', val: -ce.bevCost, color: '#EF4444', voce: 'beverage' },
              { label: '📦 Mat. consumo', val: -ce.matCost, color: '#EF4444', voce: 'materiali' },
              { label: '👥 Personale', val: -(ce.persCost || 0), color: '#EF4444', voce: 'personale' },
              { label: '🏗️ Struttura', val: -ce.strCost, color: '#EF4444', voce: 'struttura' },
              { label: '── TOTALE COSTI', val: -ce.totCosti, bold: true, color: '#EF4444', voce: null },
              { label: '📊 MOL', val: ce.mol, bold: true, color: '#10B981', voce: null },
            ].map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: r.bold ? '#131825' : 'transparent', cursor: r.voce ? 'pointer' : 'default' }}
                onClick={() => r.voce && setSelectedVoce(selectedVoce === r.voce ? null : r.voce)}>
                <td style={{ ...S.td, fontWeight: r.bold ? 700 : 400, color: selectedVoce === r.voce ? '#F59E0B' : undefined }}>{r.label}</td>
                <td style={{ ...S.td, fontWeight: r.bold ? 700 : 500, color: r.color || '#e2e8f0' }}>{fmt(Math.abs(r.val))}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{pct(Math.abs(r.val), ce.ricavi)}</td>
                <td style={{ ...S.td, color: '#475569', fontSize: 11 }}>
                  {r.voce && <span style={S.badge(selectedVoce === r.voce ? '#F59E0B' : '#475569', selectedVoce === r.voce ? 'rgba(245,158,11,.12)' : 'rgba(71,85,105,.12)')}>
                    {(invoicesByVoce[r.voce] || []).length} fatture
                  </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 11, color: '#475569' }}>
          Clicca su una voce per vedere le fatture collegate
        </div>
      </Card>

      {/* Composizione costi */}
      <Card title="Composizione costi">
        <div style={{ marginBottom: 16 }}>
          {[
            { label: 'Food cost', val: ce.foodCost, color: '#F59E0B' },
            { label: 'Beverage cost', val: ce.bevCost, color: '#3B82F6' },
            { label: 'Mat. consumo', val: ce.matCost, color: '#8B5CF6' },
            { label: 'Struttura', val: ce.strCost, color: '#EC4899' },
            { label: 'Personale', val: ce.persCost || 0, color: '#10B981' },
          ].map((r, i) => <Bar2 key={i} label={r.label} value={r.val} max={ce.totCosti || 1} color={r.color} pct={ce.totCosti > 0 ? (r.val / ce.totCosti * 100).toFixed(1) : 0} />)}
        </div>
        {/* F&B indicator separato */}
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>F&B (Food + Beverage)</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>Solo indicatore, non incluso nei costi</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F97316' }}>{fbPct.toFixed(1)}%</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{fmt(fb)}</div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 12, marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#94a3b8' }}>MOL %</span>
          <span style={{ color: '#10B981', fontWeight: 700, fontSize: 16 }}>{ce.molPct?.toFixed(1)}%</span>
        </div>
      </Card>
    </div>

    {/* Fatture collegate alla voce selezionata */}
    {selectedVoce && <div style={{ marginTop: 12 }}>
      <Card title={'Fatture: ' + (voceLabels[selectedVoce] || selectedVoce)} badge={(invoicesByVoce[selectedVoce] || []).length + ' fatture'} extra={
        <button onClick={() => setSelectedVoce(null)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '4px 12px', fontSize: 11 }}>Chiudi</button>
      }>
        {(invoicesByVoce[selectedVoce] || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#475569', fontSize: 13 }}>
            Nessuna fattura trovata per questa voce. Le fatture vengono categorizzate automaticamente in base al nome fornitore.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Data', 'Fornitore', 'N° Doc', 'Tipo', 'Locale', 'Totale'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(invoicesByVoce[selectedVoce] || []).slice(0, 20).map((f, i) => (
                <tr key={f.id || i}>
                  <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{f.data}</td>
                  <td style={{ ...S.td, fontWeight: 500 }}>{f.fornitore}</td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>{f.numero}</td>
                  <td style={S.td}><span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>{f.tipo_doc || 'TD01'}</span></td>
                  <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{f.locale || '—'}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{f.totale ? fmtD(f.totale) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>}
  </>
}
