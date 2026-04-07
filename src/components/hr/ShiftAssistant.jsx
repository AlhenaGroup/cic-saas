import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmt, fmtD } from '../shared/styles.jsx'

const DAYS = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']

function weekMonday(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + 1 + offset * 7)
  return d.toISOString().split('T')[0]
}

export default function ShiftAssistant({ employees, sp, sps, staffSchedule, setStaffSchedule, saveSchedule }) {
  const [weekStart, setWeekStart] = useState(weekMonday())
  const [shifts, setShifts] = useState([])
  const [editCell, setEditCell] = useState(null)
  const [cellForm, setCellForm] = useState({ ora_inizio: '', ora_fine: '' })
  const [costMonth, setCostMonth] = useState(new Date().toISOString().substring(0, 7))
  const [costFile, setCostFile] = useState(null)
  const [personnelCosts, setPersonnelCosts] = useState([])
  const [costForm, setCostForm] = useState({ costo_totale: '', fonte: 'consulente' })
  const [showCostForm, setShowCostForm] = useState(false)

  const iS = S.input
  const locale = sp === 'all' ? null : sps.find(s => String(s.id) === sp)?.description || sp
  const localeEmps = locale ? employees.filter(e => e.locale === locale && e.stato === 'Attivo') : employees.filter(e => e.stato === 'Attivo')

  const loadShifts = useCallback(async () => {
    let q = supabase.from('employee_shifts').select('*').eq('settimana', weekStart)
    if (locale) q = q.eq('locale', locale)
    const { data } = await q
    setShifts(data || [])
  }, [weekStart, locale])

  const loadCosts = useCallback(async () => {
    const { data } = await supabase.from('personnel_costs').select('*').order('mese', { ascending: false }).limit(12)
    setPersonnelCosts(data || [])
  }, [])

  useEffect(() => { loadShifts(); loadCosts() }, [loadShifts, loadCosts])

  const getShift = (empId, day) => shifts.find(s => s.employee_id === empId && s.giorno === day)

  const saveShift = async (empId, day) => {
    if (!cellForm.ora_inizio || !cellForm.ora_fine) return
    const { data: { user } } = await supabase.auth.getUser()
    const existing = getShift(empId, day)
    if (existing) {
      await supabase.from('employee_shifts').update({ ora_inizio: cellForm.ora_inizio, ora_fine: cellForm.ora_fine }).eq('id', existing.id)
    } else {
      await supabase.from('employee_shifts').insert({
        user_id: user.id, employee_id: empId, locale: locale || '', settimana: weekStart, giorno: day,
        ora_inizio: cellForm.ora_inizio, ora_fine: cellForm.ora_fine
      })
    }
    setEditCell(null)
    await loadShifts()
  }

  const deleteShift = async (empId, day) => {
    const existing = getShift(empId, day)
    if (existing) {
      await supabase.from('employee_shifts').delete().eq('id', existing.id)
      await loadShifts()
    }
  }

  // Auto-calcola presenze orarie dai turni
  const autoCalcPresenze = () => {
    const hourly = {}
    for (const s of shifts) {
      const startH = parseInt(s.ora_inizio?.split(':')[0])
      const endH = parseInt(s.ora_fine?.split(':')[0])
      if (isNaN(startH) || isNaN(endH)) continue
      for (let h = startH; h < endH; h++) {
        const key = String(h).padStart(2, '0') + ':00'
        hourly[key] = (hourly[key] || 0) + 1
      }
    }
    setStaffSchedule(hourly)
    saveSchedule()
  }

  // Calcola costo settimanale
  const weekCost = shifts.reduce((sum, s) => {
    const emp = employees.find(e => e.id === s.employee_id)
    const startH = parseInt(s.ora_inizio?.split(':')[0]) || 0
    const endH = parseInt(s.ora_fine?.split(':')[0]) || 0
    const hours = endH - startH
    return sum + hours * (Number(emp?.costo_orario) || 0)
  }, 0)

  // Salva costo personale mensile
  const saveCost = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    let filePath = null
    if (costFile) {
      const ext = costFile.name.split('.').pop()
      const path = `${user.id}/costs_${Date.now()}.${ext}`
      await supabase.storage.from('documents').upload(path, costFile)
      filePath = path
    }
    await supabase.from('personnel_costs').upsert({
      user_id: user.id, mese: costMonth + '-01', locale: locale || 'all',
      costo_totale: Number(costForm.costo_totale), fonte: costForm.fonte,
      file_path: filePath
    }, { onConflict: 'user_id,mese,locale' })
    setShowCostForm(false); setCostForm({ costo_totale: '', fonte: 'consulente' }); setCostFile(null)
    await loadCosts()
  }

  const prevWeek = () => setWeekStart(weekMonday(Math.round((new Date(weekStart) - new Date(weekMonday())) / 604800000) - 1))
  const nextWeek = () => setWeekStart(weekMonday(Math.round((new Date(weekStart) - new Date(weekMonday())) / 604800000) + 1))

  const weekLabel = () => {
    const start = new Date(weekStart)
    const end = new Date(start); end.setDate(end.getDate() + 6)
    return start.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' — ' + end.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  }

  return <>
    {/* Turni settimanali */}
    <Card title="Turni settimanali" extra={
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={prevWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>◀</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 130, textAlign: 'center' }}>{weekLabel()}</span>
        <button onClick={nextWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>▶</button>
        <button onClick={autoCalcPresenze} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11, marginLeft: 8 }}>Auto-presenze</button>
      </div>
    }>
      {localeEmps.length === 0 ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 20, fontSize: 13 }}>Nessun dipendente attivo per questo locale.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
              <th style={{ ...S.th, width: 140 }}>Dipendente</th>
              {DAYS.map(d => <th key={d} style={{ ...S.th, textAlign: 'center' }}>{d}</th>)}
              <th style={{ ...S.th, textAlign: 'right' }}>Ore</th>
            </tr></thead>
            <tbody>
              {localeEmps.map(emp => {
                const empShifts = shifts.filter(s => s.employee_id === emp.id)
                const totHours = empShifts.reduce((s, sh) => {
                  const a = parseInt(sh.ora_inizio?.split(':')[0]) || 0
                  const b = parseInt(sh.ora_fine?.split(':')[0]) || 0
                  return s + (b - a)
                }, 0)
                return <tr key={emp.id}>
                  <td style={{ ...S.td, fontWeight: 500, fontSize: 12 }}>{emp.nome}</td>
                  {DAYS.map((_, day) => {
                    const shift = getShift(emp.id, day)
                    const isEditing = editCell?.emp === emp.id && editCell?.day === day
                    return <td key={day} style={{ ...S.td, textAlign: 'center', padding: '4px 2px', cursor: 'pointer', minWidth: 80 }}
                      onClick={() => {
                        if (!isEditing) {
                          setEditCell({ emp: emp.id, day })
                          setCellForm({ ora_inizio: shift?.ora_inizio?.substring(0, 5) || '', ora_fine: shift?.ora_fine?.substring(0, 5) || '' })
                        }
                      }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <input type="time" value={cellForm.ora_inizio} onChange={e => setCellForm(p => ({ ...p, ora_inizio: e.target.value }))} style={{ ...iS, fontSize: 10, padding: '2px 4px', textAlign: 'center' }} />
                          <input type="time" value={cellForm.ora_fine} onChange={e => setCellForm(p => ({ ...p, ora_fine: e.target.value }))} style={{ ...iS, fontSize: 10, padding: '2px 4px', textAlign: 'center' }} />
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                            <button onClick={(e) => { e.stopPropagation(); saveShift(emp.id, day) }} style={{ background: '#10B981', color: '#fff', border: 'none', borderRadius: 4, fontSize: 9, padding: '2px 6px', cursor: 'pointer' }}>OK</button>
                            {shift && <button onClick={(e) => { e.stopPropagation(); deleteShift(emp.id, day) }} style={{ background: '#EF4444', color: '#fff', border: 'none', borderRadius: 4, fontSize: 9, padding: '2px 6px', cursor: 'pointer' }}>X</button>}
                            <button onClick={(e) => { e.stopPropagation(); setEditCell(null) }} style={{ background: '#2a3042', color: '#94a3b8', border: 'none', borderRadius: 4, fontSize: 9, padding: '2px 6px', cursor: 'pointer' }}>Esc</button>
                          </div>
                        </div>
                      ) : shift ? (
                        <div style={{ background: 'rgba(59,130,246,.15)', borderRadius: 4, padding: '4px 2px', fontSize: 11 }}>
                          <div style={{ color: '#3B82F6', fontWeight: 600 }}>{shift.ora_inizio?.substring(0, 5)}</div>
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{shift.ora_fine?.substring(0, 5)}</div>
                        </div>
                      ) : (
                        <div style={{ color: '#2a3042', fontSize: 18 }}>+</div>
                      )}
                    </td>
                  })}
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: '#F59E0B', fontSize: 12 }}>{totHours}h</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
      {weekCost > 0 && <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
        Costo stimato settimana: <span style={{ color: '#F59E0B', fontWeight: 600 }}>{fmtD(weekCost)}</span>
      </div>}
    </Card>

    {/* Costi personale per CE */}
    <div style={{ marginTop: 12 }}>
      <Card title="Costi personale (Conto Economico)" extra={
        <button onClick={() => setShowCostForm(true)} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11 }}>+ Aggiungi costo</button>
      }>
        {showCostForm && <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #2a3042' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Mese</div>
              <input type="month" value={costMonth} onChange={e => setCostMonth(e.target.value)} style={{ ...iS, width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Costo totale €</div>
              <input type="number" placeholder="Costo totale" value={costForm.costo_totale} onChange={e => setCostForm(p => ({ ...p, costo_totale: e.target.value }))} style={{ ...iS, width: '100%' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>File consulente</div>
              <input type="file" accept=".pdf,.xlsx,.xls,.csv,.doc,.docx" onChange={e => setCostFile(e.target.files[0] || null)} style={{ fontSize: 11, color: '#94a3b8' }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveCost} disabled={!costForm.costo_totale} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600, fontSize: 11 }}>Salva</button>
              <button onClick={() => setShowCostForm(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 10px', fontSize: 11 }}>X</button>
            </div>
          </div>
        </div>}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Mese', 'Locale', 'Costo totale', 'Fonte', 'File'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {personnelCosts.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 16 }}>Nessun costo registrato. I costi inseriti qui appariranno nel Conto Economico.</td></tr>}
            {personnelCosts.map(c => <tr key={c.id}>
              <td style={{ ...S.td, fontWeight: 600, color: '#F59E0B' }}>{c.mese?.substring(0, 7)}</td>
              <td style={{ ...S.td, color: '#94a3b8' }}>{c.locale}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{fmtD(c.costo_totale)}</td>
              <td style={S.td}><span style={S.badge(c.fonte === 'consulente' ? '#3B82F6' : '#10B981', c.fonte === 'consulente' ? 'rgba(59,130,246,.12)' : 'rgba(16,185,129,.12)')}>{c.fonte}</span></td>
              <td style={S.td}>{c.file_path ? <button onClick={async () => { const { data } = await supabase.storage.from('documents').createSignedUrl(c.file_path, 300); if (data?.signedUrl) window.open(data.signedUrl, '_blank') }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 12 }}>Scarica</button> : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  </>
}
