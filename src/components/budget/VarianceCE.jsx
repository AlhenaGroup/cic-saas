import { useEffect, useState, useMemo } from 'react'
import { S, Card, fmtD } from '../shared/styles.jsx'
import { fetchConsuntivo, fetchBudget } from '../../lib/budgetData.js'
import {
  CAT_META, CATS, computeMOL, computeMolPct, computeTotCosti,
  computeForecast, daysElapsedInMonth, daysInMonth,
} from '../../lib/budgetModel.js'
import { exportToXlsx, exportToCsv, exportToPdf, ExportButtons } from '../../lib/exporters'

// Color coding for delta % based on whether metric is "better higher" or "better lower"
function deltaColor(pct, better) {
  if (pct == null || Number.isNaN(pct)) return '#64748b'
  if (Math.abs(pct) < 1) return '#94a3b8'
  if (better === 'higher') return pct >= 0 ? '#10B981' : '#EF4444'
  return pct <= 0 ? '#10B981' : '#EF4444'
}

function fmtPctDelta(pct) {
  if (pct == null || Number.isNaN(pct) || !Number.isFinite(pct)) return '—'
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

export default function VarianceCE({ sp, sps, year, month }) {
  const [loading, setLoading] = useState(true)
  const [consuntivo, setConsuntivo] = useState(null)
  const [budget, setBudget] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [c, b] = await Promise.all([
          fetchConsuntivo(sp, year, month, sps),
          fetchBudget(sp, year, month),
        ])
        if (cancelled) return
        setConsuntivo(c)
        setBudget(b?.state || null)
      } catch (e) {
        console.error('[VarianceCE]', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sp, year, month, sps])

  const daysElapsed = daysElapsedInMonth(year, month)
  const totalDays = daysInMonth(year, month)
  const forecast = useMemo(() => {
    if (!consuntivo) return null
    return computeForecast(consuntivo, daysElapsed, totalDays, 0)
  }, [consuntivo, daysElapsed, totalDays])

  const rows = useMemo(() => {
    if (!consuntivo) return []
    const out = []
    const pushRow = (key, label, better) => {
      const c = Number(consuntivo[key]) || 0
      const b = budget ? Number(budget[key]) || 0 : null
      const f = forecast ? Number(forecast[key]) || 0 : null
      const deltaEur = b != null ? c - b : null
      const deltaPct = b != null && b !== 0 ? (deltaEur / b) * 100 : null
      const forecastVsBudget = b != null && f != null && b !== 0 ? ((f - b) / b) * 100 : null
      out.push({ key, label, consuntivo: c, budget: b, forecast: f, deltaEur, deltaPct, forecastVsBudget, better })
    }
    pushRow('ricavi',    'Ricavi',     'higher')
    pushRow('food',      'Food cost',  'lower')
    pushRow('beverage',  'Beverage',   'lower')
    pushRow('materiali', 'Materiali',  'lower')
    pushRow('personale', 'Personale',  'lower')
    pushRow('struttura', 'Struttura',  'lower')

    // Totale costi
    const cTot = computeTotCosti(consuntivo)
    const bTot = budget ? computeTotCosti(budget) : null
    const fTot = forecast ? computeTotCosti(forecast) : null
    const dTot = bTot != null ? cTot - bTot : null
    const dTotPct = bTot != null && bTot !== 0 ? (dTot / bTot) * 100 : null
    const fTotVsB = bTot != null && fTot != null && bTot !== 0 ? ((fTot - bTot) / bTot) * 100 : null
    out.push({
      key: 'totcosti', label: 'Totale costi', bold: true,
      consuntivo: cTot, budget: bTot, forecast: fTot,
      deltaEur: dTot, deltaPct: dTotPct, forecastVsBudget: fTotVsB, better: 'lower',
    })

    // MOL
    const cMol = computeMOL(consuntivo)
    const bMol = budget ? computeMOL(budget) : null
    const fMol = forecast ? computeMOL(forecast) : null
    const dMol = bMol != null ? cMol - bMol : null
    const dMolPct = bMol != null && bMol !== 0 ? (dMol / Math.abs(bMol)) * 100 : null
    const fMolVsB = bMol != null && fMol != null && bMol !== 0 ? ((fMol - bMol) / Math.abs(bMol)) * 100 : null
    out.push({
      key: 'mol', label: 'MOL', bold: true, highlight: true,
      consuntivo: cMol, budget: bMol, forecast: fMol,
      deltaEur: dMol, deltaPct: dMolPct, forecastVsBudget: fMolVsB, better: 'higher',
    })
    return out
  }, [consuntivo, budget, forecast])

  const buildExportData = () => {
    const headers = ['Voce', 'Consuntivo', 'Budget', 'Delta EUR', 'Delta %', 'Forecast', 'Forecast vs Budget %']
    const dataRows = rows.map(r => [
      r.label,
      r.consuntivo?.toFixed(2) ?? '',
      r.budget?.toFixed(2) ?? '',
      r.deltaEur?.toFixed(2) ?? '',
      r.deltaPct?.toFixed(1) ?? '',
      r.forecast?.toFixed(2) ?? '',
      r.forecastVsBudget?.toFixed(1) ?? '',
    ])
    const filename = `ce-scostamenti-${year}-${String(month).padStart(2, '0')}`
    return { headers, dataRows, filename }
  }
  const onExcel = () => { const { headers, dataRows, filename } = buildExportData(); exportToXlsx(filename, headers, dataRows, { sheetName: 'CE scostamenti' }) }
  const onCsv = () => { const { headers, dataRows, filename } = buildExportData(); exportToCsv(filename, headers, dataRows) }
  const onPdf = () => {
    const { headers, dataRows } = buildExportData()
    const titolo = `CE scostamenti · ${year}-${String(month).padStart(2, '0')}`
    exportToPdf(titolo, headers, dataRows)
  }

  if (loading) {
    return <Card title="CE scostamenti">
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Caricamento…</div>
    </Card>
  }

  return <Card
    title="Conto economico: consuntivo vs budget vs forecast"
    extra={<ExportButtons onExcel={onExcel} onCsv={onCsv} onPdf={onPdf} disabled={!rows.length} />}
  >
    {!budget && (
      <div style={{
        marginBottom: 14, padding: '8px 12px',
        background: 'rgba(245,158,11,.1)',
        border: '1px solid #F59E0B',
        borderRadius: 6, color: '#F59E0B', fontSize: 12
      }}>Nessun budget inserito per questo mese. Vai al tab <strong>Budget</strong> per crearlo.</div>
    )}

    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={S.th}>Voce</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Consuntivo</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Budget</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Δ €</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Δ %</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Forecast</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Forecast vs Budget</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const meta = CAT_META[r.key]
            const rowStyle = r.bold ? { borderTop: '2px solid #2a3042' } : {}
            return <tr key={r.key} style={r.highlight ? { background: 'rgba(245,158,11,.06)' } : {}}>
              <td style={{ ...S.td, ...rowStyle, fontWeight: r.bold ? 700 : 600 }}>
                {meta && <span style={{ color: meta.color }}></span>} {r.label}
              </td>
              <td style={{ ...S.td, ...rowStyle, textAlign: 'right' }}>{fmtD(r.consuntivo)}</td>
              <td style={{ ...S.td, ...rowStyle, textAlign: 'right', color: r.budget != null ? '#94a3b8' : '#475569' }}>
                {r.budget != null ? fmtD(r.budget) : '—'}
              </td>
              <td style={{ ...S.td, ...rowStyle, textAlign: 'right', color: deltaColor(r.deltaPct, r.better), fontWeight: 600 }}>
                {r.deltaEur != null ? (r.deltaEur >= 0 ? '+' : '') + fmtD(r.deltaEur) : '—'}
              </td>
              <td style={{ ...S.td, ...rowStyle, textAlign: 'right', color: deltaColor(r.deltaPct, r.better), fontWeight: 700 }}>
                {fmtPctDelta(r.deltaPct)}
              </td>
              <td style={{ ...S.td, ...rowStyle, textAlign: 'right', color: '#8B5CF6' }}>
                {r.forecast != null ? fmtD(r.forecast) : '—'}
              </td>
              <td style={{ ...S.td, ...rowStyle, textAlign: 'right', color: deltaColor(r.forecastVsBudget, r.better), fontWeight: 600 }}>
                {fmtPctDelta(r.forecastVsBudget)}
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>

    <div style={{
      marginTop: 14, padding: '8px 12px', background: '#131825', borderRadius: 6,
      fontSize: 11, color: '#64748b', display: 'flex', gap: 18, flexWrap: 'wrap'
    }}>
      <span><span style={{ color: '#10B981' }}></span> meglio del budget</span>
      <span><span style={{ color: '#EF4444' }}></span> peggio del budget</span>
      <span><span style={{ color: '#94a3b8' }}></span> in linea (Δ &lt; 1%)</span>
      <span style={{ marginLeft: 'auto' }}>Per ricavi/MOL "meglio" = più alto; per costi "meglio" = più basso.</span>
    </div>
  </Card>
}
