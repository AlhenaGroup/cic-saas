import { useEffect, useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { S, Card, fmt, fmtD, fmtN } from '../shared/styles.jsx'
import { fetchConsuntivo } from '../../lib/budgetData.js'
import {
  CAT_META, computeMOL, computeMolPct,
  computeForecast, daysElapsedInMonth, daysInMonth,
} from '../../lib/budgetModel.js'

export default function Forecast({ sp, sps, year, month }) {
  const [loading, setLoading] = useState(true)
  const [consuntivo, setConsuntivo] = useState(null)
  const [trendAdjust, setTrendAdjust] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const c = await fetchConsuntivo(sp, year, month, sps)
        if (!cancelled) setConsuntivo(c)
      } catch (e) {
        console.error('[Forecast load]', e)
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
    return computeForecast(consuntivo, daysElapsed, totalDays, trendAdjust)
  }, [consuntivo, daysElapsed, totalDays, trendAdjust])

  // Serie per il chart: cumulativo reale giorno-per-giorno + proiezione lineare
  const chartData = useMemo(() => {
    if (!consuntivo || !consuntivo.daily) return []
    // Cumulo giorno-per-giorno
    const sorted = [...consuntivo.daily].sort((a, b) => a.date.localeCompare(b.date))
    let cum = 0
    const points = []
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const today = sorted.find(r => r.date === dateStr)
      if (today) cum += Number(today.ricavi) || 0
      const isFuture = d > daysElapsed
      if (!isFuture) {
        points.push({ day: d, reale: cum, proiezione: null })
      } else {
        // Proiezione lineare: cum fino a daysElapsed + (d - daysElapsed) * dailyAvg
        const dailyAvg = daysElapsed > 0 ? (Number(consuntivo.ricavi) || 0) / daysElapsed : 0
        const projected = (Number(consuntivo.ricavi) || 0) + dailyAvg * (d - daysElapsed) * (1 + trendAdjust / 100)
        points.push({ day: d, reale: null, proiezione: Math.round(projected) })
      }
    }
    // Collegamento visivo: duplica l'ultimo reale come primo punto della proiezione
    if (daysElapsed > 0 && daysElapsed < totalDays) {
      const idx = points.findIndex(p => p.day === daysElapsed)
      if (idx >= 0) points[idx].proiezione = points[idx].reale
    }
    return points
  }, [consuntivo, daysElapsed, totalDays, trendAdjust, year, month])

  if (loading) {
    return <Card title="Forecast">
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Caricamento…</div>
    </Card>
  }

  if (!consuntivo || consuntivo.ricavi === 0) {
    return <Card title="Forecast">
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 48, marginBottom: 14, opacity: .3 }}></div>
        Nessun dato di consuntivo per {String(month).padStart(2, '0')}/{year}
      </div>
    </Card>
  }

  const CATS_DISP = ['ricavi', 'food', 'beverage', 'materiali', 'personale', 'struttura']

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <Card title="Proiezione fine mese">
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <span>
          Giorno <strong style={{ color: '#f1f5f9' }}>{daysElapsed}</strong> di <strong style={{ color: '#f1f5f9' }}>{totalDays}</strong>
          {' · '}
          avanzamento <strong style={{ color: '#F59E0B' }}>{totalDays > 0 ? ((daysElapsed / totalDays) * 100).toFixed(0) : 0}%</strong>
        </span>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          Le proiezioni personale restano fissate al costo mensile (non scalato).
        </span>
      </div>

      {/* Slider aggiustamento trend */}
      <div style={{
        padding: '12px 14px',
        background: '#131825',
        border: '1px solid #2a3042',
        borderRadius: 8,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Aggiustamento trend forecast</span>
          <strong style={{ fontSize: 13, color: trendAdjust === 0 ? '#94a3b8' : (trendAdjust > 0 ? '#10B981' : '#EF4444') }}>
            {trendAdjust > 0 ? '+' : ''}{trendAdjust}%
          </strong>
        </div>
        <input
          type="range"
          min={-20}
          max={20}
          step={1}
          value={trendAdjust}
          onChange={e => setTrendAdjust(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#F59E0B' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 4 }}>
          <span>−20% (mese in rallentamento)</span>
          <span>0% (trend lineare)</span>
          <span>+20% (sprint finale)</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Voce</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Consuntivo parziale</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Proiezione fine mese</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {CATS_DISP.map(k => {
              const meta = CAT_META[k]
              const parzAny = Number(consuntivo[k]) || 0
              const forAny = Number(forecast?.[k]) || 0
              const delta = forAny - parzAny
              return <tr key={k}>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  <span style={{ color: meta.color }}></span> {meta.label}
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>{fmtD(parzAny)}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: meta.color }}>{fmtD(forAny)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: '#64748b' }}>+{fmtD(delta)}</td>
              </tr>
            })}
            <tr>
              <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #2a3042' }}>MOL ({forecast ? computeMolPct(forecast).toFixed(1) : '—'}%)</td>
              <td style={{ ...S.td, textAlign: 'right', borderTop: '2px solid #2a3042' }}>{fmtD(computeMOL(consuntivo))}</td>
              <td style={{ ...S.td, textAlign: 'right', borderTop: '2px solid #2a3042', fontWeight: 700, color: '#10B981', fontSize: 14 }}>
                {forecast ? fmtD(computeMOL(forecast)) : '—'}
              </td>
              <td style={{ ...S.td, textAlign: 'right', borderTop: '2px solid #2a3042', color: '#64748b' }}>
                +{forecast ? fmtD(computeMOL(forecast) - computeMOL(consuntivo)) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Card title="Ricavi cumulativi: reale + proiezione">
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid stroke="#1a1f2e" />
            <XAxis dataKey="day" stroke="#64748b" fontSize={11} label={{ value: 'Giorno del mese', position: 'insideBottom', offset: -4, fill: '#64748b', fontSize: 11 }} />
            <YAxis stroke="#64748b" fontSize={11} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
            <Tooltip
              contentStyle={{ background: '#0f1420', border: '1px solid #2a3042', fontSize: 12 }}
              formatter={(v) => v != null ? fmtD(v) : '—'}
              labelFormatter={l => `Giorno ${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {daysElapsed > 0 && daysElapsed < totalDays && (
              <ReferenceLine x={daysElapsed} stroke="#F59E0B" strokeDasharray="3 3" label={{ value: 'oggi', fill: '#F59E0B', fontSize: 10 }} />
            )}
            <Line type="monotone" dataKey="reale" name="Ricavi cum. reali" stroke="#10B981" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="proiezione" name="Proiezione" stroke="#8B5CF6" strokeWidth={2.5} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  </div>
}
