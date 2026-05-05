import { useEffect, useState, useMemo } from 'react'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { S, Card, KPI, fmt, fmtD, fmtN, pct } from '../shared/styles.jsx'
import { fetchConsuntivo, fetchBudget } from '../../lib/budgetData.js'
import {
  CAT_META,
  computeMOL, computeMolPct, computeBreakEven,
  computeFoodPct, computeBevPct, computePersPct, computeCopertoMedio,
  computeForecast, daysElapsedInMonth, daysInMonth,
  classifyHealth, suggestLevers,
} from '../../lib/budgetModel.js'

function ValueOrDash({ v, format = 'eur' }) {
  if (v == null || Number.isNaN(v)) return '—'
  if (format === 'eur') return fmtD(v)
  if (format === 'pct') return (Number(v) || 0).toFixed(1) + '%'
  if (format === 'num') return fmtN(v)
  return String(v)
}

export default function BudgetOverview({ sp, sps, year, month, onNavigate }) {
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
        console.error('[BudgetOverview]', e)
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
    if (!consuntivo || daysElapsed <= 0) return null
    return computeForecast(consuntivo, daysElapsed, totalDays, 0)
  }, [consuntivo, daysElapsed, totalDays])

  const health = useMemo(() => classifyHealth(consuntivo, budget), [consuntivo, budget])
  const suggestions = useMemo(() => suggestLevers(health), [health])

  // Dati per ComposedChart: 6 categorie + Ricavi e MOL
  const chartData = useMemo(() => {
    if (!consuntivo) return []
    const cats = ['ricavi', 'food', 'beverage', 'materiali', 'personale', 'struttura']
    return cats.map(k => ({
      name: CAT_META[k].label,
      budget: Number((budget || {})[k]) || 0,
      forecast: Number((forecast || {})[k]) || 0,
      consuntivo: Number(consuntivo[k]) || 0,
    })).concat([{
      name: 'MOL',
      budget: budget ? computeMOL(budget) : 0,
      forecast: forecast ? computeMOL(forecast) : 0,
      consuntivo: computeMOL(consuntivo),
    }])
  }, [consuntivo, budget, forecast])

  if (loading) {
    return <Card title="Panoramica" badge="⏳ caricamento">
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Caricamento dati consuntivo…</div>
    </Card>
  }

  if (!consuntivo || consuntivo.ricavi === 0) {
    return <Card title="Panoramica">
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 48, marginBottom: 14, opacity: .3 }}></div>
        <div style={{ fontSize: 14, color: '#cbd5e1', marginBottom: 6 }}>
          Nessun dato di consuntivo per {String(month).padStart(2, '0')}/{year}
        </div>
        <div style={{ fontSize: 12 }}>
          I ricavi vengono letti da <code>daily_stats</code>. Assicurati che la sync CiC sia aggiornata per questo mese.
        </div>
      </div>
    </Card>
  }

  const ricaviBudget = budget?.ricavi || 0
  const molConsuntivo = computeMOL(consuntivo)
  const molBudget = budget ? computeMOL(budget) : null
  const molForecast = forecast ? computeMOL(forecast) : null
  const breakEven = computeBreakEven(consuntivo)

  const goodHealth = health.filter(h => h.positive)
  const badHealth  = health.filter(h => !h.positive)

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {/* Info header con giorni trascorsi */}
    <div style={{ fontSize: 12, color: '#64748b' }}>
      Giorno <strong style={{ color: '#94a3b8' }}>{daysElapsed}</strong> di <strong style={{ color: '#94a3b8' }}>{totalDays}</strong>
      {' · '}
      {budget
        ? <span style={{ color: '#10B981' }}>Budget impostato</span>
        : <span style={{ color: '#F59E0B' }}>Nessun budget — apri "Budget" per inserirlo</span>}
    </div>

    {/* KPI grid 4×2 */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      <KPI
        label="Ricavi consuntivo"
        value={fmtD(consuntivo.ricavi)}
        sub={ricaviBudget > 0 ? `Budget ${fmtD(ricaviBudget)}` : 'Nessun budget'}
        accent={CAT_META.ricavi.color}
        icon=""
        trend={ricaviBudget > 0 ? ((consuntivo.ricavi - ricaviBudget) / ricaviBudget * 100) : null}
      />
      <KPI
        label="MOL consuntivo"
        value={fmtD(molConsuntivo)}
        sub={`${computeMolPct(consuntivo).toFixed(1)}% sui ricavi` + (molBudget != null ? ` · budget ${fmtD(molBudget)}` : '')}
        accent="#10B981"
        icon=""
        trend={molBudget != null && molBudget !== 0 ? ((molConsuntivo - molBudget) / Math.abs(molBudget) * 100) : null}
      />
      <KPI
        label="Forecast fine mese"
        value={forecast ? fmtD(forecast.ricavi) : '—'}
        sub={forecast ? `MOL forecast ${fmtD(molForecast)}` : 'Mese futuro'}
        accent="#F59E0B"
        icon=""
      />
      <KPI
        label="Break-even"
        value={fmtD(breakEven)}
        sub={breakEven > 0 && consuntivo.ricavi > 0 ? `${((consuntivo.ricavi / breakEven) * 100).toFixed(0)}% raggiunto` : '—'}
        accent="#8B5CF6"
        icon=""
      />
      <KPI
        label="Food cost"
        value={`${computeFoodPct(consuntivo).toFixed(1)}%`}
        sub={fmtD(consuntivo.food)}
        accent={CAT_META.food.color}
        icon=""
      />
      <KPI
        label="Beverage cost"
        value={`${computeBevPct(consuntivo).toFixed(1)}%`}
        sub={fmtD(consuntivo.beverage)}
        accent={CAT_META.beverage.color}
        icon=""
      />
      <KPI
        label="Costo lavoro"
        value={`${computePersPct(consuntivo).toFixed(1)}%`}
        sub={fmtD(consuntivo.personale)}
        accent={CAT_META.personale.color}
        icon=""
      />
      <KPI
        label="Coperti / medio"
        value={fmtN(consuntivo.coperti || 0)}
        sub={consuntivo.coperti > 0 ? `${fmtD(computeCopertoMedio(consuntivo))} /coperto` : '—'}
        accent="#06B6D4"
        icon=""
      />
    </div>

    {/* Due colonne: cosa va bene / cosa va male */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
      <Card title="Cosa va bene" badge={budget ? null : 'inserisci budget'}>
        {!budget && <div style={{ color: '#64748b', fontSize: 12 }}>Inserisci un budget nel tab <strong>Budget</strong> per vedere gli scostamenti.</div>}
        {budget && goodHealth.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>Nulla sopra target per ora.</div>}
        {budget && goodHealth.map(h => (
          <div key={h.metric} style={{
            display: 'flex', justifyContent: 'space-between', padding: '8px 0',
            borderBottom: '1px solid #1a1f2e', fontSize: 13
          }}>
            <span style={{ color: '#cbd5e1' }}>{h.label}</span>
            <span style={{ color: '#10B981', fontWeight: 600 }}>
              {h.delta >= 0 ? '+' : ''}{fmtD(h.delta)} ({h.pct >= 0 ? '+' : ''}{h.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </Card>

      <Card title="Cosa sta andando male" badge={budget ? null : 'inserisci budget'}>
        {!budget && <div style={{ color: '#64748b', fontSize: 12 }}>Inserisci un budget per rivelare le criticità.</div>}
        {budget && badHealth.length === 0 && <div style={{ color: '#10B981', fontSize: 12 }}>Tutto in linea con il budget. </div>}
        {budget && badHealth.map(h => (
          <div key={h.metric} style={{
            display: 'flex', justifyContent: 'space-between', padding: '8px 0',
            borderBottom: '1px solid #1a1f2e', fontSize: 13
          }}>
            <span style={{ color: '#cbd5e1' }}>{h.label}</span>
            <span style={{ color: '#EF4444', fontWeight: 600 }}>
              {h.delta >= 0 ? '+' : ''}{fmtD(h.delta)} ({h.pct >= 0 ? '+' : ''}{h.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </Card>
    </div>

    {/* Leve suggerite */}
    {suggestions.length > 0 && (
      <Card title="Leve suggerite">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              background: '#131825',
              border: '1px solid #2a3042',
              borderRadius: 8,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B', marginBottom: 2 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{s.action}</div>
              </div>
              <button
                onClick={() => onNavigate && onNavigate('sim', { levers: s.levers })}
                style={{
                  background: '#F59E0B', color: '#0f1420', border: 'none',
                  padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer'
                }}
              >Simula</button>
            </div>
          ))}
        </div>
      </Card>
    )}

    {/* Mini chart: budget (barre) + forecast (linea) + consuntivo (linea) */}
    <Card title="Consuntivo · Budget · Forecast per categoria">
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData}>
            <CartesianGrid stroke="#1a1f2e" />
            <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
            <Tooltip
              contentStyle={{ background: '#0f1420', border: '1px solid #2a3042', fontSize: 12 }}
              formatter={(v) => fmtD(v)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="budget" name="Budget" fill="#F59E0B" opacity={0.8} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="consuntivo" name="Consuntivo" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  </div>
}
