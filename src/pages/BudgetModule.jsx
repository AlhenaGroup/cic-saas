import { useState, useEffect } from 'react'
import { S, Card } from '../components/shared/styles.jsx'
import BudgetOverview from '../components/budget/BudgetOverview.jsx'
import BudgetInput from '../components/budget/BudgetInput.jsx'
import Forecast from '../components/budget/Forecast.jsx'
import VarianceCE from '../components/budget/VarianceCE.jsx'
import Simulator from '../components/budget/Simulator.jsx'
import SubTabsBar from '../components/SubTabsBar'

// [id, label, descrizione placeholder]
const SUBS = [
  ['ov',  '🏠 Panoramica',      'KPI consuntivo / budget / forecast, blocchi cosa va bene e cosa va male, leve suggerite'],
  ['inp', '✏️ Budget',          'Inserisci il budget mensile per locale con driver (coperti × medio, % ricavi, FTE)'],
  ['fc',  '🔮 Forecast',        'Proiezione di fine mese a partire dai giorni trascorsi, con slider di aggiustamento'],
  ['var', '📊 CE scostamenti',  'Conto economico a colonne consuntivo / budget / forecast con delta e color coding'],
  ['sim', '🎯 Simulatore',      'Motore scenari con 7 leve per simulare l\'impatto di decisioni strategiche'],
]

const IMPLEMENTED = new Set(['ov', 'inp', 'fc', 'var', 'sim'])

// Util per default year/month dal date range globale o mese corrente
function defaultPeriod(from) {
  if (from && /^\d{4}-\d{2}-\d{2}/.test(from)) {
    const [y, m] = from.split('-').map(Number)
    return { year: y, month: m }
  }
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export default function BudgetModule({ sp, sps, from, to }) {
  const [sub, setSub] = useState(() => localStorage.getItem('cic_bud_sub') || 'ov')
  useEffect(() => { localStorage.setItem('cic_bud_sub', sub) }, [sub])

  const initial = defaultPeriod(from)
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)

  // Se cambia il range globale, allinea year/month al mese di `from`
  useEffect(() => {
    const p = defaultPeriod(from)
    setYear(p.year)
    setMonth(p.month)
  }, [from])

  const subBtn = (t) => ({
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: sub === t ? '#F59E0B' : 'transparent',
    color: sub === t ? '#0f1420' : '#94a3b8',
    transition: 'all .2s',
    whiteSpace: 'nowrap'
  })

  const current = SUBS.find(([t]) => t === sub) || SUBS[0]
  const localeName = sp === 'all'
    ? 'Tutti i locali'
    : (sps.find(s => String(s.id) === String(sp))?.description || sp)

  const parts = current[1].split(' ')
  const bigIcon = parts[0]
  const shortTitle = parts.slice(1).join(' ')

  const MONTH_LABELS = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ]

  const inputS = { ...S.input, fontSize: 12, padding: '5px 8px' }

  // Naviga da Overview → Simulator (con leve precompilate in localStorage)
  const handleNavigate = (target, prefill = null) => {
    if (prefill) {
      try { localStorage.setItem('cic_bud_sim_prefill', JSON.stringify(prefill)) } catch {}
    }
    setSub(target)
  }

  const commonProps = { sp, sps, year, month, onNavigate: handleNavigate }

  return <>
    {/* Sub-tab bar (uniforme con resto app) */}
    <SubTabsBar
      tabs={SUBS.map(([key, label]) => ({ key, label }))}
      value={sub}
      onChange={setSub}
    />

    {/* Contesto: locale + selettore anno/mese (indipendente dai filtri globali) */}
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 14
    }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        📍 <strong style={{ color: '#94a3b8' }}>{localeName}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>📅 Periodo budget:</span>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} style={inputS}>
          {MONTH_LABELS.map((lbl, i) => (
            <option key={i + 1} value={i + 1}>{lbl}</option>
          ))}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={inputS}>
          {[2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>

    {/* Render sub-tab */}
    {sub === 'ov'  && <BudgetOverview  {...commonProps} />}
    {sub === 'inp' && <BudgetInput     {...commonProps} />}
    {sub === 'fc'  && <Forecast        {...commonProps} />}
    {sub === 'var' && <VarianceCE      {...commonProps} />}
    {sub === 'sim' && <Simulator       {...commonProps} />}

    {!IMPLEMENTED.has(sub) && (
      <Card title={current[1]} badge="🚧 In sviluppo">
        <div style={{ padding: '32px 8px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 14, opacity: .3 }}>{bigIcon}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>
            {shortTitle}
          </div>
          <div style={{
            fontSize: 12,
            color: '#64748b',
            maxWidth: 520,
            margin: '0 auto',
            lineHeight: 1.5
          }}>
            {current[2]}
          </div>
        </div>
      </Card>
    )}
  </>
}
