import { useEffect, useState, useMemo, useCallback, Fragment } from 'react'
import { S, Card, fmt, fmtD } from '../shared/styles.jsx'
import { fetchBudget, saveBudget, fetchPreviousBudgetRows } from '../../lib/budgetData.js'
import {
  CATS, CAT_META, DRIVERS, driversForCategory, DEFAULT_DRIVER,
  computeMOL, computeMolPct, computeTotCosti,
} from '../../lib/budgetModel.js'
import PersonaleDettaglioEditor from './PersonaleDettaglioEditor.jsx'

// Crea righe default quando non c'è ancora budget per il mese.
function makeDefaultRows() {
  return CATS.map(cat => {
    const driverKey = DEFAULT_DRIVER[cat]
    const driver = DRIVERS[driverKey]
    const cfg = {}
    ;(driver?.fields || []).forEach(f => { cfg[f.key] = f.default })
    return {
      category: cat,
      driver_type: driverKey,
      driver_config: cfg,
      amount: 0,
      notes: '',
    }
  })
}

// Ricalcola amount per ogni riga in base al driver corrente + ctx ricavi.
function recomputeAmounts(rows) {
  // Prima calcola ricavi
  const ricaviRow = rows.find(r => r.category === 'ricavi')
  let ricavi = 0
  if (ricaviRow && ricaviRow.driver_type) {
    const driver = DRIVERS[ricaviRow.driver_type]
    if (driver) ricavi = driver.compute(ricaviRow.driver_config || {}, {})
  }
  return rows.map(r => {
    const driver = DRIVERS[r.driver_type]
    let amount = 0
    if (driver) amount = driver.compute(r.driver_config || {}, { ricavi })
    return { ...r, amount: Math.round(amount * 100) / 100 }
  })
}

const MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

export default function BudgetInput({ sp, sps, year, month }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState(() => recomputeAmounts(makeDefaultRows()))
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [hasSaved, setHasSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const b = await fetchBudget(sp, year, month)
      if (b && b.rows && b.rows.length > 0) {
        // Merge DB rows with default order
        const byCat = {}
        b.rows.forEach(r => { byCat[r.category] = r })
        const newRows = CATS.map(cat => {
          const r = byCat[cat]
          if (r) {
            return {
              category: cat,
              driver_type: r.driver_type || DEFAULT_DRIVER[cat],
              driver_config: r.driver_config || {},
              amount: Number(r.amount) || 0,
              notes: r.notes || '',
            }
          }
          // Categoria mancante: default
          const driverKey = DEFAULT_DRIVER[cat]
          const driver = DRIVERS[driverKey]
          const cfg = {}
          ;(driver?.fields || []).forEach(f => { cfg[f.key] = f.default })
          return { category: cat, driver_type: driverKey, driver_config: cfg, amount: 0, notes: '' }
        })
        setRows(recomputeAmounts(newRows))
        setNote(b.period?.note || '')
        setHasSaved(true)
      } else {
        setRows(recomputeAmounts(makeDefaultRows()))
        setNote('')
        setHasSaved(false)
      }
      setDirty(false)
      setSaveMsg(null)
    } catch (e) {
      console.error('[BudgetInput load]', e)
    } finally {
      setLoading(false)
    }
  }, [sp, year, month])

  useEffect(() => { load() }, [load])

  // ── Handlers ────────────────────────────────────────────────
  const changeDriver = (cat, newType) => {
    setRows(prev => {
      const next = prev.map(r => {
        if (r.category !== cat) return r
        const driver = DRIVERS[newType]
        const cfg = {}
        ;(driver?.fields || []).forEach(f => { cfg[f.key] = r.driver_config?.[f.key] ?? f.default })
        return { ...r, driver_type: newType, driver_config: cfg }
      })
      return recomputeAmounts(next)
    })
    setDirty(true)
  }

  const changeField = (cat, fieldKey, value) => {
    setRows(prev => {
      const next = prev.map(r => {
        if (r.category !== cat) return r
        return { ...r, driver_config: { ...r.driver_config, [fieldKey]: value } }
      })
      return recomputeAmounts(next)
    })
    setDirty(true)
  }

  const changeNotes = (cat, value) => {
    setRows(prev => prev.map(r => r.category === cat ? { ...r, notes: value } : r))
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const rowsToSave = rows.map(r => ({
        category: r.category,
        amount: r.amount,
        driver_type: r.driver_type,
        driver_config: r.driver_config,
        notes: r.notes,
      }))
      await saveBudget(sp, year, month, rowsToSave, note)
      setSaveMsg({ ok: true, text: 'Budget salvato' })
      setDirty(false)
      setHasSaved(true)
    } catch (e) {
      setSaveMsg({ ok: false, text: 'Errore: ' + e.message })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyPrevious = async () => {
    try {
      const prev = await fetchPreviousBudgetRows(sp, year, month)
      if (!prev || prev.length === 0) {
        setSaveMsg({ ok: false, text: 'Nessun budget nel mese precedente' })
        return
      }
      const byCat = {}
      prev.forEach(r => { byCat[r.category] = r })
      const newRows = CATS.map(cat => {
        const r = byCat[cat]
        if (r) return {
          category: cat,
          driver_type: r.driver_type || DEFAULT_DRIVER[cat],
          driver_config: r.driver_config || {},
          amount: Number(r.amount) || 0,
          notes: r.notes || '',
        }
        const driverKey = DEFAULT_DRIVER[cat]
        const driver = DRIVERS[driverKey]
        const cfg = {}
        ;(driver?.fields || []).forEach(f => { cfg[f.key] = f.default })
        return { category: cat, driver_type: driverKey, driver_config: cfg, amount: 0, notes: '' }
      })
      setRows(recomputeAmounts(newRows))
      setDirty(true)
      setSaveMsg({ ok: true, text: 'Copiato dal mese precedente (clicca Salva)' })
    } catch (e) {
      setSaveMsg({ ok: false, text: 'Errore copia: ' + e.message })
    }
  }

  // ── Derived ─────────────────────────────────────────────────
  const stateObj = useMemo(() => {
    const s = {}
    rows.forEach(r => { s[r.category] = r.amount })
    return s
  }, [rows])
  const totCosti = computeTotCosti(stateObj)
  const mol = computeMOL(stateObj)
  const molPct = computeMolPct(stateObj)

  if (loading) {
    return <Card title="Budget">
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>
    </Card>
  }

  const inputS = { ...S.input, fontSize: 12, padding: '5px 8px', width: 100 }
  const selectS = { ...S.input, fontSize: 12, padding: '5px 8px' }

  return <Card
    title="Budget mensile"
    badge={hasSaved ? 'salvato' : 'nuovo'}
    extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleCopyPrevious}
          style={{
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer'
          }}
        >Copia mese prec.</button>
        {dirty && (
          <button
            onClick={load}
            style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer'
            }}
          >Annulla</button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            background: dirty ? '#10B981' : '#1a1f2e',
            color: dirty ? '#0f1420' : '#64748b',
            border: 'none', padding: '5px 14px', borderRadius: 6,
            fontSize: 11, fontWeight: 700, cursor: dirty ? 'pointer' : 'not-allowed'
          }}
        >{saving ? '…' : 'Salva'}</button>
      </div>
    }
  >
    {saveMsg && (
      <div style={{
        marginBottom: 12, padding: '6px 10px', borderRadius: 6,
        background: saveMsg.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
        border: `1px solid ${saveMsg.ok ? '#10B981' : '#EF4444'}`,
        color: saveMsg.ok ? '#10B981' : '#EF4444',
        fontSize: 12,
      }}>{saveMsg.text}</div>
    )}

    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={S.th}>Categoria</th>
            <th style={S.th}>Driver</th>
            <th style={S.th}>Parametri</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Importo</th>
            <th style={S.th}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const meta = CAT_META[r.category]
            const drivers = driversForCategory(r.category)
            const driver = DRIVERS[r.driver_type]
            const isCustomEditor = r.driver_type === 'personale_dettaglio'
            return <Fragment key={r.category}>
              <tr>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  <span style={{ color: meta.color }}></span> {meta.label}
                </td>
                <td style={S.td}>
                  <select
                    value={r.driver_type}
                    onChange={e => changeDriver(r.category, e.target.value)}
                    style={selectS}
                  >
                    {drivers.map(d => (
                      <option key={d.key} value={d.key}>{d.label}</option>
                    ))}
                  </select>
                </td>
                <td style={S.td}>
                  {isCustomEditor ? (
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
                      Vedi tabella sotto 
                    </span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(driver?.fields || []).map(f => (
                        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{f.label}</span>
                          <input
                            type="number"
                            step={f.step || 1}
                            value={r.driver_config?.[f.key] ?? ''}
                            onChange={e => changeField(r.category, f.key, Number(e.target.value))}
                            style={inputS}
                          />
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{f.unit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: meta.color }}>
                  {fmtD(r.amount)}
                </td>
                <td style={S.td}>
                  <input
                    type="text"
                    value={r.notes || ''}
                    placeholder="—"
                    onChange={e => changeNotes(r.category, e.target.value)}
                    style={{ ...S.input, fontSize: 12, padding: '5px 8px', width: '100%' }}
                  />
                </td>
              </tr>
              {isCustomEditor && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, padding: 0, background: 'transparent', borderBottom: 'none' }}>
                    <PersonaleDettaglioEditor
                      value={r.driver_config}
                      onChange={(newCfg) => {
                        setRows(prev => recomputeAmounts(prev.map(row => row.category === r.category ? { ...row, driver_config: newCfg } : row)))
                        setDirty(true)
                      }}
                      locale={sp === 'all' ? null : (sps?.find(s => String(s.id) === sp)?.description || null)}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...S.td, borderTop: '2px solid var(--border)', color: 'var(--text2)', fontSize: 11 }} colSpan={3}>
              Totale costi
            </td>
            <td style={{ ...S.td, borderTop: '2px solid var(--border)', textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>
              {fmtD(totCosti)}
            </td>
            <td style={{ ...S.td, borderTop: '2px solid var(--border)' }}/>
          </tr>
          <tr>
            <td style={{ ...S.td, fontWeight: 700, color: 'var(--text)' }} colSpan={3}>
              MOL budget ({molPct.toFixed(1)}%)
            </td>
            <td style={{ ...S.td, textAlign: 'right', fontWeight: 800, color: mol >= 0 ? '#10B981' : '#EF4444', fontSize: 16 }}>
              {fmtD(mol)}
            </td>
            <td style={S.td}/>
          </tr>
        </tfoot>
      </table>
    </div>

    <div style={{ marginTop: 16 }}>
      <label style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
        Note del periodo
      </label>
      <textarea
        value={note}
        onChange={e => { setNote(e.target.value); setDirty(true) }}
        placeholder="Ipotesi, assunzioni, eventi del mese…"
        rows={2}
        style={{ ...S.input, width: '100%', fontSize: 12, padding: 8, resize: 'vertical', fontFamily: 'inherit' }}
      />
    </div>
  </Card>
}
