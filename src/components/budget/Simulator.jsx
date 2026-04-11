import { useEffect, useState, useMemo, useCallback } from 'react'
import { S, Card, fmtD, fmtN } from '../shared/styles.jsx'
import {
  fetchConsuntivo, fetchBudget,
  fetchScenarios, saveScenario, deleteScenario,
} from '../../lib/budgetData.js'
import {
  CAT_META, CATS,
  applyLevers, LEVER_TYPES,
  computeMOL, computeMolPct, computeBreakEven, computeCopertoMedio,
  computeForecast, daysElapsedInMonth, daysInMonth,
} from '../../lib/budgetModel.js'

function makeDefaultLever(type) {
  const meta = LEVER_TYPES[type]
  const obj = { type, id: Math.random().toString(36).slice(2, 9) }
  ;(meta?.fields || []).forEach(f => { obj[f.key] = f.default })
  return obj
}

function cleanLevers(levers) {
  // strip id prima di serializzare/simulare
  return (levers || []).map(({ id, ...rest }) => rest)
}

export default function Simulator({ sp, sps, year, month }) {
  const [loading, setLoading] = useState(true)
  const [consuntivo, setConsuntivo] = useState(null)
  const [budgetState, setBudgetState] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [baseSource, setBaseSource] = useState('consuntivo')
  const [levers, setLevers] = useState([])
  const [name, setName] = useState('Nuovo scenario')
  const [description, setDescription] = useState('')
  const [compareWithId, setCompareWithId] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, b, sc] = await Promise.all([
        fetchConsuntivo(sp, year, month, sps),
        fetchBudget(sp, year, month),
        fetchScenarios(sp),
      ])
      setConsuntivo(c)
      setBudgetState(b?.state || null)
      setScenarios(sc || [])
      // Controlla prefill da Overview
      try {
        const raw = localStorage.getItem('cic_bud_sim_prefill')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && Array.isArray(parsed.levers)) {
            setLevers(parsed.levers.map(l => ({ ...l, id: Math.random().toString(36).slice(2, 9) })))
            setMsg({ ok: true, text: '✨ Leve precaricate dal suggerimento Overview' })
          }
          localStorage.removeItem('cic_bud_sim_prefill')
        }
      } catch {}
    } catch (e) {
      console.error('[Simulator]', e)
    } finally {
      setLoading(false)
    }
  }, [sp, year, month, sps])

  useEffect(() => { load() }, [load])

  // ── Derived values ────────────────────────────────────────
  const daysElapsed = daysElapsedInMonth(year, month)
  const totalDays = daysInMonth(year, month)

  const baseValues = useMemo(() => {
    if (baseSource === 'budget' && budgetState) return budgetState
    if (baseSource === 'forecast' && consuntivo) {
      return computeForecast(consuntivo, daysElapsed, totalDays, 0)
    }
    return consuntivo || {}
  }, [baseSource, consuntivo, budgetState, daysElapsed, totalDays])

  const simulated = useMemo(() => {
    return applyLevers(baseValues, cleanLevers(levers))
  }, [baseValues, levers])

  const compareScenario = useMemo(() => {
    if (!compareWithId) return null
    return scenarios.find(s => s.id === compareWithId) || null
  }, [compareWithId, scenarios])

  // ── Handlers ──────────────────────────────────────────────
  const loadScenario = (id) => {
    const s = scenarios.find(x => x.id === id)
    if (!s) return
    setActiveId(s.id)
    setName(s.name)
    setDescription(s.description || '')
    setBaseSource(s.base_source || 'consuntivo')
    setLevers((s.levers || []).map(l => ({ ...l, id: Math.random().toString(36).slice(2, 9) })))
    setMsg(null)
  }

  const handleNew = () => {
    setActiveId(null)
    setName('Nuovo scenario')
    setDescription('')
    setBaseSource('consuntivo')
    setLevers([])
    setMsg(null)
  }

  const addLever = (type) => {
    setLevers(prev => [...prev, makeDefaultLever(type)])
  }
  const removeLever = (id) => {
    setLevers(prev => prev.filter(l => l.id !== id))
  }
  const updateLever = (id, key, value) => {
    setLevers(prev => prev.map(l => l.id === id ? { ...l, [key]: Number(value) || 0 } : l))
  }

  const handleSave = async (asNew = false) => {
    setSaving(true)
    setMsg(null)
    try {
      const payload = {
        id: asNew ? undefined : activeId,
        name,
        description,
        locale: sp,
        base_source: baseSource,
        base_values: baseValues,
        levers: cleanLevers(levers),
        simulated_values: simulated,
      }
      const saved = await saveScenario(payload)
      setMsg({ ok: true, text: '✓ Scenario salvato' })
      const fresh = await fetchScenarios(sp)
      setScenarios(fresh || [])
      setActiveId(saved.id)
    } catch (e) {
      setMsg({ ok: false, text: 'Errore: ' + e.message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!activeId) return
    if (!confirm('Eliminare questo scenario?')) return
    try {
      await deleteScenario(activeId)
      const fresh = await fetchScenarios(sp)
      setScenarios(fresh || [])
      handleNew()
      setMsg({ ok: true, text: '✓ Scenario eliminato' })
    } catch (e) {
      setMsg({ ok: false, text: 'Errore: ' + e.message })
    }
  }

  if (loading) {
    return <Card title="🎯 Simulatore">
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Caricamento…</div>
    </Card>
  }

  const inputS = { ...S.input, fontSize: 12, padding: '5px 8px', width: 90 }
  const selectS = { ...S.input, fontSize: 12, padding: '5px 8px' }

  const CATS_FULL = ['ricavi', 'food', 'beverage', 'materiali', 'personale', 'struttura']

  // ── Render ────────────────────────────────────────────────
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

    {msg && (
      <div style={{
        padding: '6px 10px', borderRadius: 6,
        background: msg.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
        border: `1px solid ${msg.ok ? '#10B981' : '#EF4444'}`,
        color: msg.ok ? '#10B981' : '#EF4444', fontSize: 12,
      }}>{msg.text}</div>
    )}

    {/* Barra scenari */}
    <Card title="📂 I miei scenari">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={handleNew}
          style={{
            background: '#F59E0B', color: '#0f1420', border: 'none',
            padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer'
          }}
        >➕ Nuovo</button>
        {scenarios.length === 0 && (
          <span style={{ fontSize: 12, color: '#64748b' }}>Nessuno scenario salvato finora.</span>
        )}
        {scenarios.map(s => (
          <button
            key={s.id}
            onClick={() => loadScenario(s.id)}
            style={{
              background: activeId === s.id ? '#10B981' : 'transparent',
              color: activeId === s.id ? '#0f1420' : '#94a3b8',
              border: '1px solid ' + (activeId === s.id ? '#10B981' : '#2a3042'),
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer'
            }}
          >{s.name}</button>
        ))}
      </div>
    </Card>

    {/* Nome + descrizione + base */}
    <Card title={activeId ? '✏️ Modifica scenario' : '➕ Nuovo scenario'}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 14 }}>
        <input
          placeholder="Nome scenario"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ ...S.input, fontSize: 13, padding: '7px 10px' }}
        />
        <input
          placeholder="Descrizione (opzionale)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          style={{ ...S.input, fontSize: 13, padding: '7px 10px' }}
        />
      </div>

      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Base di partenza</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['consuntivo', 'budget', 'forecast'].map(src => (
          <label key={src} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px',
            background: baseSource === src ? 'rgba(245,158,11,.15)' : 'transparent',
            border: '1px solid ' + (baseSource === src ? '#F59E0B' : '#2a3042'),
            borderRadius: 6, fontSize: 12, cursor: 'pointer',
            color: baseSource === src ? '#F59E0B' : '#94a3b8',
          }}>
            <input
              type="radio"
              name="baseSource"
              value={src}
              checked={baseSource === src}
              onChange={() => setBaseSource(src)}
              style={{ accentColor: '#F59E0B' }}
            />
            {src === 'consuntivo' ? '📊 Consuntivo' : src === 'budget' ? '🎯 Budget' : '🔮 Forecast'}
          </label>
        ))}
      </div>

      {/* Readout base values */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8,
        fontSize: 11, padding: 10, background: '#131825', borderRadius: 6,
      }}>
        {CATS_FULL.map(k => (
          <div key={k}>
            <div style={{ color: '#64748b', marginBottom: 2 }}>{CAT_META[k].label}</div>
            <div style={{ color: CAT_META[k].color, fontWeight: 700 }}>{fmtD(baseValues[k] || 0)}</div>
          </div>
        ))}
      </div>
    </Card>

    {/* Leve */}
    <Card title="🎛 Leve">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(LEVER_TYPES).map(([type, meta]) => (
          <button
            key={type}
            onClick={() => addLever(type)}
            style={{
              background: 'transparent', border: '1px solid #2a3042', color: '#94a3b8',
              padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer'
            }}
            title={meta.description}
          >+ {meta.label}</button>
        ))}
      </div>

      {levers.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>
          Aggiungi una leva per iniziare a simulare.
        </div>
      )}

      {levers.map(lever => {
        const meta = LEVER_TYPES[lever.type]
        if (!meta) return null
        return <div key={lever.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          background: '#131825', border: '1px solid #2a3042', borderRadius: 8, marginBottom: 8
        }}>
          <div style={{ flex: '0 0 180px', fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}>{meta.label}</div>
          <div style={{ flex: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {meta.fields.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>{f.label}</span>
                <input
                  type="number"
                  step={f.step || 1}
                  value={lever[f.key] ?? ''}
                  onChange={e => updateLever(lever.id, f.key, e.target.value)}
                  style={inputS}
                />
                <span style={{ fontSize: 10, color: '#64748b' }}>{f.unit}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => removeLever(lever.id)}
            style={{
              background: 'transparent', border: '1px solid #EF4444', color: '#EF4444',
              width: 24, height: 24, borderRadius: 4, fontSize: 12, cursor: 'pointer'
            }}
          >×</button>
        </div>
      })}
    </Card>

    {/* Risultato: Base vs Simulato */}
    <Card title="📈 Risultato simulazione">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Voce</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Base</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Simulato</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Δ €</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Δ %</th>
            </tr>
          </thead>
          <tbody>
            {CATS_FULL.map(k => {
              const meta = CAT_META[k]
              const b = Number(baseValues[k]) || 0
              const s = Number(simulated[k]) || 0
              const d = s - b
              const dPct = b !== 0 ? (d / b) * 100 : null
              return <tr key={k}>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  <span style={{ color: meta.color }}>●</span> {meta.label}
                </td>
                <td style={{ ...S.td, textAlign: 'right', color: '#94a3b8' }}>{fmtD(b)}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: meta.color }}>{fmtD(s)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: d >= 0 ? '#10B981' : '#EF4444' }}>
                  {d >= 0 ? '+' : ''}{fmtD(d)}
                </td>
                <td style={{ ...S.td, textAlign: 'right', color: d >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {dPct != null ? (dPct >= 0 ? '+' : '') + dPct.toFixed(1) + '%' : '—'}
                </td>
              </tr>
            })}
            {/* MOL */}
            {(() => {
              const bMol = computeMOL(baseValues)
              const sMol = computeMOL(simulated)
              const dMol = sMol - bMol
              const dPct = bMol !== 0 ? (dMol / Math.abs(bMol)) * 100 : null
              return <tr style={{ background: 'rgba(16,185,129,.05)' }}>
                <td style={{ ...S.td, borderTop: '2px solid #2a3042', fontWeight: 700 }}>MOL ({computeMolPct(simulated).toFixed(1)}%)</td>
                <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', color: '#94a3b8' }}>{fmtD(bMol)}</td>
                <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', fontWeight: 800, fontSize: 15, color: sMol >= 0 ? '#10B981' : '#EF4444' }}>{fmtD(sMol)}</td>
                <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', color: dMol >= 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                  {dMol >= 0 ? '+' : ''}{fmtD(dMol)}
                </td>
                <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', color: dMol >= 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                  {dPct != null ? (dPct >= 0 ? '+' : '') + dPct.toFixed(1) + '%' : '—'}
                </td>
              </tr>
            })()}
          </tbody>
        </table>
      </div>

      {/* Bottom KPI extra */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 14, fontSize: 11 }}>
        <div style={{ padding: 10, background: '#131825', borderRadius: 6 }}>
          <div style={{ color: '#64748b' }}>Break-even simulato</div>
          <div style={{ color: '#8B5CF6', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{fmtD(computeBreakEven(simulated))}</div>
        </div>
        <div style={{ padding: 10, background: '#131825', borderRadius: 6 }}>
          <div style={{ color: '#64748b' }}>Coperti simulati</div>
          <div style={{ color: '#06B6D4', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{fmtN(Math.round(simulated.coperti || 0))}</div>
        </div>
        <div style={{ padding: 10, background: '#131825', borderRadius: 6 }}>
          <div style={{ color: '#64748b' }}>Coperto medio</div>
          <div style={{ color: '#F59E0B', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{fmtD(computeCopertoMedio(simulated))}</div>
        </div>
      </div>
    </Card>

    {/* Confronto */}
    <Card title="🔀 Confronta con un altro scenario">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Scenario da confrontare:</span>
        <select
          value={compareWithId}
          onChange={e => setCompareWithId(e.target.value)}
          style={selectS}
        >
          <option value="">— nessuno —</option>
          {scenarios.filter(s => s.id !== activeId).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      {compareScenario && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>Voce</th>
                <th style={{ ...S.th, textAlign: 'right' }}>A: {name}</th>
                <th style={{ ...S.th, textAlign: 'right' }}>B: {compareScenario.name}</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Δ (A − B)</th>
              </tr>
            </thead>
            <tbody>
              {CATS_FULL.map(k => {
                const meta = CAT_META[k]
                const a = Number(simulated[k]) || 0
                const b = Number(compareScenario.simulated_values?.[k]) || 0
                const d = a - b
                return <tr key={k}>
                  <td style={{ ...S.td, fontWeight: 600 }}><span style={{ color: meta.color }}>●</span> {meta.label}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: meta.color }}>{fmtD(a)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: '#94a3b8' }}>{fmtD(b)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: d >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                    {d >= 0 ? '+' : ''}{fmtD(d)}
                  </td>
                </tr>
              })}
              {(() => {
                const aMol = computeMOL(simulated)
                const bMol = Number(compareScenario.simulated_values?.mol) || computeMOL(compareScenario.simulated_values || {})
                const d = aMol - bMol
                return <tr style={{ background: 'rgba(16,185,129,.05)' }}>
                  <td style={{ ...S.td, borderTop: '2px solid #2a3042', fontWeight: 700 }}>MOL</td>
                  <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', color: '#10B981', fontWeight: 700 }}>{fmtD(aMol)}</td>
                  <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', color: '#94a3b8', fontWeight: 700 }}>{fmtD(bMol)}</td>
                  <td style={{ ...S.td, borderTop: '2px solid #2a3042', textAlign: 'right', color: d >= 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                    {d >= 0 ? '+' : ''}{fmtD(d)}
                  </td>
                </tr>
              })()}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    {/* Bottoni save / delete */}
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      {activeId && (
        <button
          onClick={handleDelete}
          style={{
            background: 'transparent', border: '1px solid #EF4444', color: '#EF4444',
            padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer'
          }}
        >🗑 Elimina</button>
      )}
      <button
        onClick={() => handleSave(true)}
        disabled={saving}
        style={{
          background: 'transparent', border: '1px solid #2a3042', color: '#94a3b8',
          padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer'
        }}
      >💾 Salva come nuovo</button>
      <button
        onClick={() => handleSave(false)}
        disabled={saving}
        style={{
          background: '#10B981', color: '#0f1420', border: 'none',
          padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer'
        }}
      >{saving ? '…' : activeId ? '💾 Aggiorna' : '💾 Salva'}</button>
    </div>

  </div>
}
