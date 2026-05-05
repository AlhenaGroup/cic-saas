// Editor "Dettaglio personale" per la riga Personale del budget.
// Visualizza una tabella espandibile con: dipendenti (autofill da employees),
// costo lavoro mensile (dal consulente, già comprensivo di lordo+contributi+13a+14a+TFR),
// buoni pasto (giorni × valore), welfare, split %.
// Più una sezione "Altre voci" libere (formazione, consulente del lavoro, ecc.).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S, fmtD } from '../shared/styles.jsx'

const newDip = (overrides = {}) => ({
  id: crypto.randomUUID(),
  employee_id: null,
  label: '',
  costo_lavoro: 0,
  buono_pasto_giorni: 22,
  buono_pasto_valore: 8,
  welfare: 0,
  split_pct: 100,
  attivo: true,
  ...overrides,
})

const newVoce = (overrides = {}) => ({
  id: crypto.randomUUID(),
  label: '',
  amount: 0,
  ...overrides,
})

const inpS = { ...S.input, fontSize: 12, padding: '6px 8px' }

function rowCost(d) {
  if (d.attivo === false) return 0
  const base = (Number(d.costo_lavoro) || 0)
              + (Number(d.buono_pasto_giorni) || 0) * (Number(d.buono_pasto_valore) || 0)
              + (Number(d.welfare) || 0)
  return base * ((d.split_pct == null ? 100 : Number(d.split_pct)) / 100)
}

export default function PersonaleDettaglioEditor({ value, onChange, locale }) {
  const dipendenti = Array.isArray(value?.dipendenti) ? value.dipendenti : []
  const altre = Array.isArray(value?.altre_voci) ? value.altre_voci : []

  const [employees, setEmployees] = useState([])
  useEffect(() => {
    supabase.from('employees').select('id,nome,ruolo,locale,stato').eq('stato', 'Attivo').order('nome')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  // Filtra dipendenti per locale corrente (se passato)
  const employeesForLocale = useMemo(() => {
    if (!locale) return employees
    return employees.filter(e => (e.locale || '').split(',').some(l => l.trim() === locale))
  }, [employees, locale])

  const updateDip = (id, patch) => {
    const next = dipendenti.map(d => d.id === id ? { ...d, ...patch } : d)
    onChange({ dipendenti: next, altre_voci: altre })
  }
  const removeDip = (id) => {
    onChange({ dipendenti: dipendenti.filter(d => d.id !== id), altre_voci: altre })
  }
  const addDip = () => {
    onChange({ dipendenti: [...dipendenti, newDip()], altre_voci: altre })
  }
  const importAll = () => {
    if (employeesForLocale.length === 0) return
    const existing = new Set(dipendenti.map(d => d.employee_id).filter(Boolean))
    const newOnes = employeesForLocale
      .filter(e => !existing.has(e.id))
      .map(e => newDip({ employee_id: e.id, label: e.nome }))
    if (newOnes.length === 0) return
    onChange({ dipendenti: [...dipendenti, ...newOnes], altre_voci: altre })
  }

  const updateVoce = (id, patch) => {
    onChange({ dipendenti, altre_voci: altre.map(v => v.id === id ? { ...v, ...patch } : v) })
  }
  const removeVoce = (id) => {
    onChange({ dipendenti, altre_voci: altre.filter(v => v.id !== id) })
  }
  const addVoce = () => {
    onChange({ dipendenti, altre_voci: [...altre, newVoce()] })
  }

  // Quando si seleziona un dipendente dall'autocomplete, autofill label
  const onSelectEmployee = (id, employeeId) => {
    if (!employeeId) {
      updateDip(id, { employee_id: null })
      return
    }
    const emp = employees.find(e => e.id === employeeId)
    updateDip(id, { employee_id: employeeId, label: emp?.nome || '' })
  }

  // Totali
  const totDip = dipendenti.reduce((s, d) => s + rowCost(d), 0)
  const totBP = dipendenti.reduce((s, d) => {
    if (d.attivo === false) return s
    const split = (d.split_pct == null ? 100 : Number(d.split_pct)) / 100
    return s + (Number(d.buono_pasto_giorni) || 0) * (Number(d.buono_pasto_valore) || 0) * split
  }, 0)
  const totWelfare = dipendenti.reduce((s, d) => {
    if (d.attivo === false) return s
    const split = (d.split_pct == null ? 100 : Number(d.split_pct)) / 100
    return s + (Number(d.welfare) || 0) * split
  }, 0)
  const totLavoro = dipendenti.reduce((s, d) => {
    if (d.attivo === false) return s
    const split = (d.split_pct == null ? 100 : Number(d.split_pct)) / 100
    return s + (Number(d.costo_lavoro) || 0) * split
  }, 0)
  const totAltre = altre.reduce((s, v) => s + (Number(v.amount) || 0), 0)
  const grandTotal = totDip + totAltre

  return <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)', padding: 14, marginTop: 8 }}>

    {/* Toolbar */}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>Dettaglio personale {locale ? `· ${locale}` : ''}</strong>
      <span style={{ flex: 1 }}/>
      <button onClick={importAll} style={btnSm} title="Aggiunge i dipendenti del locale che non sono già in tabella">
        ⤓ Importa dipendenti del locale
      </button>
      <button onClick={addDip} style={btnSm}>+ Riga manuale</button>
    </div>

    {/* Tabella dipendenti */}
    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            <th style={thS}>Att</th>
            <th style={thS}>Dipendente</th>
            <th style={{ ...thS, textAlign: 'right' }}>Costo lavoro/mese</th>
            <th style={{ ...thS, textAlign: 'center' }}>Buoni pasto</th>
            <th style={{ ...thS, textAlign: 'right' }}>Welfare</th>
            <th style={{ ...thS, textAlign: 'right' }}>Split %</th>
            <th style={{ ...thS, textAlign: 'right' }}>Totale</th>
            <th style={thS}></th>
          </tr>
        </thead>
        <tbody>
          {dipendenti.map(d => {
            const cost = rowCost(d)
            return <tr key={d.id} style={{ opacity: d.attivo === false ? 0.5 : 1 }}>
              <td style={tdS}>
                <input type="checkbox" checked={d.attivo !== false} onChange={e => updateDip(d.id, { attivo: e.target.checked })}/>
              </td>
              <td style={tdS}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <select value={d.employee_id || ''} onChange={e => onSelectEmployee(d.id, e.target.value || null)}
                    style={{ ...inpS, minWidth: 120 }}>
                    <option value="">— manuale —</option>
                    {employeesForLocale.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  {!d.employee_id && (
                    <input value={d.label} onChange={e => updateDip(d.id, { label: e.target.value })}
                      placeholder="Nome libero..." style={{ ...inpS, width: 110 }}/>
                  )}
                </div>
              </td>
              <td style={tdS}>
                <input type="number" step="50" value={d.costo_lavoro || 0}
                  onChange={e => updateDip(d.id, { costo_lavoro: Number(e.target.value) })}
                  style={{ ...inpS, width: 100, textAlign: 'right' }} title="Costo lavoro mensile (lordo + contributi + 13a + 14a + TFR)"/>
              </td>
              <td style={tdS}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                  <input type="number" step="1" value={d.buono_pasto_giorni || 0}
                    onChange={e => updateDip(d.id, { buono_pasto_giorni: Number(e.target.value) })}
                    style={{ ...inpS, width: 50, textAlign: 'right' }} title="Giorni"/>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>×</span>
                  <input type="number" step="0.5" value={d.buono_pasto_valore || 0}
                    onChange={e => updateDip(d.id, { buono_pasto_valore: Number(e.target.value) })}
                    style={{ ...inpS, width: 60, textAlign: 'right' }} title="Valore €"/>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>€</span>
                </div>
              </td>
              <td style={tdS}>
                <input type="number" step="10" value={d.welfare || 0}
                  onChange={e => updateDip(d.id, { welfare: Number(e.target.value) })}
                  style={{ ...inpS, width: 70, textAlign: 'right' }}/>
              </td>
              <td style={tdS}>
                <input type="number" step="5" min="0" max="100" value={d.split_pct == null ? 100 : d.split_pct}
                  onChange={e => updateDip(d.id, { split_pct: Number(e.target.value) })}
                  style={{ ...inpS, width: 60, textAlign: 'right' }} title="% allocata a questo locale (es. 50 se diviso 50/50 con altro locale)"/>
              </td>
              <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                {fmtD(cost)}
              </td>
              <td style={tdS}>
                <button onClick={() => removeDip(d.id)} style={btnDel}>×</button>
              </td>
            </tr>
          })}
          {dipendenti.length === 0 && <tr>
            <td colSpan={8} style={{ ...tdS, textAlign: 'center', color: 'var(--text3)', padding: 20 }}>
              Nessun dipendente. Click "⤓ Importa dipendenti del locale" o "+ Riga manuale".
            </td>
          </tr>}
        </tbody>
      </table>
    </div>

    {/* Altre voci */}
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 12, color: 'var(--text2)' }}>Altre voci personale</strong>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>(formazione, consulente lavoro, premi una tantum, ecc.)</span>
        <span style={{ flex: 1 }}/>
        <button onClick={addVoce} style={btnSm}>+ Voce</button>
      </div>
      {altre.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {altre.map(v => <tr key={v.id}>
            <td style={tdS}>
              <input value={v.label} onChange={e => updateVoce(v.id, { label: e.target.value })}
                placeholder="Es. Formazione HACCP" style={{ ...inpS, width: '100%' }}/>
            </td>
            <td style={{ ...tdS, width: 120, textAlign: 'right' }}>
              <input type="number" step="10" value={v.amount || 0}
                onChange={e => updateVoce(v.id, { amount: Number(e.target.value) })}
                style={{ ...inpS, width: 100, textAlign: 'right' }}/>
            </td>
            <td style={{ ...tdS, width: 30 }}>
              <button onClick={() => removeVoce(v.id)} style={btnDel}>×</button>
            </td>
          </tr>)}
        </tbody>
      </table>}
    </div>

    {/* Riepilogo */}
    <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
      <Sub label="Costo lavoro" value={totLavoro} accent="var(--text)"/>
      <Sub label="Buoni pasto" value={totBP} accent="var(--blue-text)"/>
      <Sub label="Welfare" value={totWelfare} accent="var(--green)"/>
      <Sub label="Altre voci" value={totAltre} accent="var(--text2)"/>
      <Sub label="TOTALE PERSONALE" value={grandTotal} accent="var(--red)" strong/>
    </div>
  </div>
}

function Sub({ label, value, accent, strong }) {
  return <div>
    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '.05em' }}>{label}</div>
    <div style={{ fontSize: strong ? 16 : 14, color: accent, fontWeight: strong ? 700 : 600, marginTop: 2 }}>{fmtD(value)}</div>
  </div>
}

const thS = { ...S.th, padding: '6px 8px', fontSize: 10 }
const tdS = { ...S.td, padding: '4px 6px' }
const btnSm = { padding: '5px 10px', fontSize: 11, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }
const btnDel = { padding: '2px 8px', fontSize: 14, background: 'transparent', color: 'var(--text3)', border: 'none', cursor: 'pointer', fontWeight: 600 }
