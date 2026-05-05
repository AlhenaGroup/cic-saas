import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmt, fmtD } from '../shared/styles.jsx'
import { exportToCsv } from '../../lib/exporters'

const DAYS = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']

// Calcola ore lavorate da ora_inizio e ora_fine (gestisce superamento mezzanotte)
function calcShiftHours(inizio, fine) {
  if (!inizio || !fine) return 0
  const [h1, m1] = inizio.split(':').map(Number)
  const [h2, m2] = fine.split(':').map(Number)
  let startMin = h1 * 60 + (m1 || 0)
  let endMin = h2 * 60 + (m2 || 0)
  if (endMin <= startMin) endMin += 24 * 60 // dopo mezzanotte
  return Math.round((endMin - startMin) / 60 * 10) / 10 // arrotonda a 0.1h
}

function weekMonday(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + 1 + offset * 7)
  return d.toISOString().split('T')[0]
}

export default function ShiftAssistant({ employees, sp, sps, staffSchedule, setStaffSchedule, saveSchedule }) {
  const [weekStart, setWeekStart] = useState(weekMonday())
  const [shifts, setShifts] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ employee_id: '', giorno: 0, ora_inizio: '18:00', ora_fine: '23:00' })
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('hr_shift_view') || 'settimana') // 'settimana' | 'giorno'
  useEffect(() => { localStorage.setItem('hr_shift_view', viewMode) }, [viewMode])
  const [selectedDay, setSelectedDay] = useState(0) // 0..6 (Lun..Dom)
  const [costMonth, setCostMonth] = useState(new Date().toISOString().substring(0, 7))
  const [costFile, setCostFile] = useState(null)
  const [personnelCosts, setPersonnelCosts] = useState([])
  const [costForm, setCostForm] = useState({ costo_totale: '', fonte: 'consulente' })
  const [showCostForm, setShowCostForm] = useState(false)

  const iS = S.input
  const locale = sp === 'all' ? null : sps.find(s => String(s.id) === sp)?.description || sp
  const localeEmps = locale ? employees.filter(e => (e.locale||'').split(',').some(l => l.trim() === locale) && e.stato === 'Attivo') : employees.filter(e => e.stato === 'Attivo')

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

  // Aggiungi turno dal form con tendine
  const addShift = async () => {
    if (!addForm.employee_id || !addForm.ora_inizio || !addForm.ora_fine) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('employee_shifts').insert({
      user_id: user.id, employee_id: addForm.employee_id, locale: locale || '',
      settimana: weekStart, giorno: addForm.giorno,
      ora_inizio: addForm.ora_inizio, ora_fine: addForm.ora_fine
    })
    await loadShifts()
    // Reset solo orari, mantieni dipendente per inserimento rapido
    setAddForm(f => ({ ...f, ora_inizio: '18:00', ora_fine: '23:00' }))
  }

  const deleteShift = async (id) => {
    await supabase.from('employee_shifts').delete().eq('id', id)
    await loadShifts()
  }

  // Auto-calcola presenze orarie dai turni
  const autoCalcPresenze = () => {
    const hourly = {}
    for (const s of shifts) {
      const startH = parseInt(s.ora_inizio?.split(':')[0])
      const endH = parseInt(s.ora_fine?.split(':')[0])
      if (isNaN(startH) || isNaN(endH)) continue
      for (let h = startH; h < (endH < startH ? 24 : endH); h++) {
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
    const hours = calcShiftHours(s.ora_inizio, s.ora_fine)
    return sum + hours * (Number(emp?.costo_orario) || 0)
  }, 0)

  const totalHours = shifts.reduce((sum, s) => sum + calcShiftHours(s.ora_inizio, s.ora_fine), 0)

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

  const formStyle = { ...iS, marginBottom: 0 }

  return <>
    {/* KPI turni */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
      <KPI label="Turni questa settimana" icon="" value={shifts.length} sub="inseriti" accent='#3B82F6' />
      <KPI label="Ore totali" icon="" value={totalHours + 'h'} sub="settimana" accent='#F59E0B' />
      <KPI label="Costo stimato" icon="" value={weekCost > 0 ? fmtD(weekCost) : '—'} sub="settimana" accent='#10B981' />
    </div>

    {/* Turni settimanali */}
    <Card title="Turni settimanali" extra={
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid #2a3042', borderRadius: 6, overflow: 'hidden' }}>
          <button onClick={() => setViewMode('settimana')}
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: viewMode === 'settimana' ? '#F59E0B' : 'transparent', color: viewMode === 'settimana' ? '#0f1420' : '#94a3b8' }}>Per settimana</button>
          <button onClick={() => setViewMode('giorno')}
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: viewMode === 'giorno' ? '#F59E0B' : 'transparent', color: viewMode === 'giorno' ? '#0f1420' : '#94a3b8' }}>Per giorno</button>
        </div>
        <button onClick={prevWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}></button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 130, textAlign: 'center' }}>{weekLabel()}</span>
        <button onClick={nextWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}></button>
        <button onClick={autoCalcPresenze} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11, marginLeft: 8 }}>Aggiorna presenze</button>
      </div>
    }>
      {/* Form inserimento turno con tendine */}
      <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 16, border: '1px solid #2a3042' }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Aggiungi turno</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={addForm.employee_id} onChange={e => setAddForm(p => ({ ...p, employee_id: e.target.value }))} style={{ ...formStyle, minWidth: 180 }}>
            <option value="">Seleziona dipendente...</option>
            {localeEmps.map(e => <option key={e.id} value={e.id}>{e.nome} ({e.ruolo || '—'})</option>)}
          </select>
          <select value={addForm.giorno} onChange={e => setAddForm(p => ({ ...p, giorno: Number(e.target.value) }))} style={{ ...formStyle, minWidth: 100 }}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>dalle</span>
            <input type="time" value={addForm.ora_inizio} onChange={e => setAddForm(p => ({ ...p, ora_inizio: e.target.value }))} style={{ ...formStyle, width: 100 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>alle</span>
            <input type="time" value={addForm.ora_fine} onChange={e => setAddForm(p => ({ ...p, ora_fine: e.target.value }))} style={{ ...formStyle, width: 100 }} />
          </div>
          <button onClick={addShift} disabled={!addForm.employee_id} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>+ Aggiungi</button>
        </div>
      </div>

      {/* Griglia riepilogativa */}
      {localeEmps.length === 0 ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 20, fontSize: 13 }}>Nessun dipendente attivo per questo locale.</div>
      ) : viewMode === 'settimana' ? (
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
                  return s + calcShiftHours(sh.ora_inizio, sh.ora_fine)
                }, 0)
                // (no-op)
                return <tr key={emp.id}>
                  <td style={{ ...S.td, fontWeight: 500, fontSize: 12 }}>{emp.nome}</td>
                  {DAYS.map((_, day) => {
                    const dayShifts = empShifts.filter(s => s.giorno === day)
                    return <td key={day} style={{ ...S.td, textAlign: 'center', padding: '4px 2px', minWidth: 80 }}>
                      {dayShifts.length > 0 ? dayShifts.map(s => (
                        <div key={s.id} style={{ background: 'rgba(59,130,246,.15)', borderRadius: 4, padding: '3px 4px', fontSize: 10, marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#3B82F6', fontWeight: 600 }}>{s.ora_inizio?.substring(0, 5)}-{s.ora_fine?.substring(0, 5)}</span>
                          <button onClick={() => deleteShift(s.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 9, padding: 0, lineHeight: 1 }}>x</button>
                        </div>
                      )) : (
                        <span style={{ color: '#1e2636', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  })}
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: '#F59E0B', fontSize: 12 }}>{totHours}h</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <DailyTimelineEditor
          emps={localeEmps} shifts={shifts} selectedDay={selectedDay} setSelectedDay={setSelectedDay}
          weekStart={weekStart} locale={locale || ''} onChanged={loadShifts}
          staffSchedule={staffSchedule}
        />
      )}
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

    {/* ── ORARI CONSIGLIATI ── */}
    <SuggestedSchedule sp={sp} sps={sps} employees={employees} />
  </>
}

// Componente separato per evitare problemi con hooks
function SuggestedSchedule({ sp, sps, employees = [] }) {
  const [grid, setGrid] = useState({}) // { dayIndex: { hour: { ricavi, staff } } }
  const [soglia, setSoglia] = useState(() => Number(localStorage.getItem('cic_soglia_staff')) || 50)
  useEffect(() => { localStorage.setItem('cic_soglia_staff', String(soglia)) }, [soglia])
  const [loading, setLoading] = useState(false)
  const [prep, setPrep] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cic_prep_hours') || '{}') } catch { return {} }
  })
  const [prepNotes, setPrepNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cic_prep_notes') || '{}') } catch { return {} }
  })
  // Ore: 12:00 04:00 (dopo mezzanotte)
  const HOURS = Array.from({ length: 17 }, (_, i) => (i + 12) % 24) // 12,13,...,23,0,1,2,3,4
  const PREP_CATS = [
    { key: 'prep_cucina', label: 'Prep. cucina', icon: '', color: '#F59E0B', area: 'cucina' },
    { key: 'prep_sala', label: 'Prep. sala', icon: '', color: '#3B82F6', area: 'sala' },
    { key: 'pulizie_cucina', label: 'Pulizie cucina', icon: '', color: '#8B5CF6', area: 'cucina' },
    { key: 'pulizie_sala', label: 'Pulizie sala', icon: '', color: '#10B981', area: 'sala' },
    { key: 'pulizie_str_cucina', label: 'Pulizie straord. cucina', icon: '', color: '#EC4899', area: 'cucina', hasNote: true },
    { key: 'pulizie_str_sala', label: 'Pulizie straord. sala', icon: '', color: '#F97316', area: 'sala', hasNote: true },
  ]
  const updatePrep = (day, hour, cat, val) => {
    const k = `${day}-${hour}-${cat}`
    const next = { ...prep, [k]: Number(val) || 0 }
    setPrep(next)
    localStorage.setItem('cic_prep_hours', JSON.stringify(next))
  }
  const updatePrepNote = (day, hour, cat, note) => {
    const k = `${day}-${hour}-${cat}-note`
    const next = { ...prepNotes, [k]: note }
    setPrepNotes(next)
    localStorage.setItem('cic_prep_notes', JSON.stringify(next))
  }
  const getPrep = (day, hour) => PREP_CATS.reduce((s, c) => s + (prep[`${day}-${hour}-${c.key}`] || 0), 0)
  const getPrepByArea = (day, hour, area) => PREP_CATS.filter(c => c.area === area).reduce((s, c) => s + (prep[`${day}-${hour}-${c.key}`] || 0), 0)

  const localeName = sp === 'all' ? null : sps.find(s => String(s.id) === String(sp))?.description || sps.find(s => String(s.id) === String(sp))?.name || null
  const localeEmps = localeName ? employees.filter(e => (e.locale||'').split(',').some(l => l.trim() === localeName) && e.stato === 'Attivo') : employees.filter(e => e.stato === 'Attivo')

  const prevMonday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() - 6) // lunedì scorso
    return d.toISOString().split('T')[0]
  })()
  const prevSunday = (() => {
    const d = new Date(prevMonday)
    d.setDate(d.getDate() + 6)
    return d.toISOString().split('T')[0]
  })()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      let query = supabase.from('daily_stats').select('date, hourly_records, salespoint_name').gte('date', prevMonday).lte('date', prevSunday)
      if (localeName) query = query.eq('salespoint_name', localeName)
      const { data: rows } = await query
      const g = {}
      for (const row of (rows || [])) {
        const d = new Date(row.date + 'T12:00:00')
        const dow = d.getDay() // 0=dom
        const dayIdx = dow === 0 ? 6 : dow - 1 // 0=lun, 6=dom
        if (!g[dayIdx]) g[dayIdx] = {}
        for (const hr of (row.hourly_records || [])) {
          if (!g[dayIdx][hr.hour]) g[dayIdx][hr.hour] = { ricavi: 0 }
          g[dayIdx][hr.hour].ricavi += hr.ricavi || 0
        }
      }
      setGrid(g)
      setLoading(false)
    }
    load()
  }, [prevMonday, prevSunday, localeName])

  const getCell = (day, hour) => {
    const cell = grid[day]?.[hour]
    const prepStaff = getPrep(day, hour)
    const prepCucina = getPrepByArea(day, hour, 'cucina')
    const prepSala = getPrepByArea(day, hour, 'sala')
    const revenueStaff = cell && cell.ricavi > 0 ? Math.max(1, Math.ceil(cell.ricavi / soglia)) : 0
    return { ricavi: cell?.ricavi || 0, staff: revenueStaff + prepStaff, revenueStaff, prepStaff, prepCucina, prepSala }
  }

  const staffColor = n => n === 0 ? '#1a1f2e' : n <= 2 ? 'rgba(16,185,129,.15)' : n <= 4 ? 'rgba(245,158,11,.15)' : 'rgba(239,68,68,.15)'
  const staffTextColor = n => n === 0 ? '#475569' : n <= 2 ? '#10B981' : n <= 4 ? '#F59E0B' : '#EF4444'

  // Totali per giorno
  const dayTotals = DAYS.map((_, di) => HOURS.reduce((s, h) => s + getCell(di, h).staff, 0))
  const dayRevenues = DAYS.map((_, di) => HOURS.reduce((s, h) => s + (grid[di]?.[h]?.ricavi || 0), 0))
  const totalStaff = dayTotals.reduce((s, v) => s + v, 0)
  const daysWithData = Object.keys(grid).length

  // Raccogli note pulizie per il PDF
  const getPrepNotesForPDF = () => {
    const notes = []
    DAYS.forEach((d, di) => {
      PREP_CATS.filter(c => c.hasNote).forEach(cat => {
        const note = prepNotes[`${di}-${cat.key}-note`]
        if (note) notes.push({ day: d, cat: cat.label, note })
      })
    })
    return notes
  }

  const printPDF = () => {
    const locale = localeName || 'Tutti i locali'
    const notes = getPrepNotesForPDF()
    let html = `<html><head><title>Orari Consigliati - ${locale}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 13px; color: #666; font-weight: normal; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th { background: #f1f5f9; padding: 6px 4px; border: 1px solid #ddd; text-align: center; font-weight: 600; }
      td { padding: 4px; border: 1px solid #ddd; text-align: center; }
      .staff { font-weight: 700; font-size: 14px; }
      .rev { font-size: 9px; color: #888; }
      .area { font-size: 8px; }
      .g { background: #d1fae5; } .y { background: #fef3c7; } .r { background: #fee2e2; } .p { background: #ede9fe; }
      .tot { background: #e2e8f0; font-weight: 700; }
      .legend { margin-top: 16px; border-top: 1px solid #ddd; padding-top: 8px; }
      .legend h3 { font-size: 12px; margin-bottom: 6px; }
      .legend-item { font-size: 10px; margin-bottom: 3px; color: #555; }
      .footer { margin-top: 12px; font-size: 9px; color: #999; }
    </style></head><body>
    <h1>Orari Consigliati - ${locale}</h1>
    <h2>Basato su incassi settimana ${prevMonday} ${prevSunday} | Soglia: ${soglia}€/h per persona</h2>
    <table><thead><tr><th>Ora</th>`
    DAYS.forEach(d => { html += `<th>${d}</th>` })
    html += `</tr></thead><tbody>`
    HOURS.forEach(h => {
      const hStr = String(h).padStart(2, '0') + ':00'
      html += `<tr><td><b>${hStr}</b></td>`
      DAYS.forEach((_, di) => {
        const c = getCell(di, h)
        const cls = c.staff === 0 ? '' : c.prepStaff > 0 && c.revenueStaff === 0 ? 'p' : c.staff <= 2 ? 'g' : c.staff <= 4 ? 'y' : 'r'
        html += `<td class="${cls}"><div class="staff">${c.staff || '—'}</div>`
        if (c.ricavi > 0) html += `<div class="rev">${Math.round(c.ricavi)}€</div>`
        if (c.prepCucina > 0 || c.prepSala > 0) html += `<div class="area">${c.prepCucina > 0 ? '' + c.prepCucina : ''} ${c.prepSala > 0 ? '' + c.prepSala : ''}</div>`
        html += `</td>`
      })
      html += `</tr>`
    })
    html += `<tr class="tot"><td><b>TOTALE</b></td>`
    dayTotals.forEach((t, i) => {
      const rev = dayRevenues[i]
      html += `<td class="tot"><b>${t}</b>${rev > 0 ? `<div style="font-size:9px;color:#666;font-weight:400">(${Math.round(rev)}€)</div>` : ''}</td>`
    })
    html += `</tr></tbody></table>`
    // Legenda pulizie
    if (notes.length > 0) {
      html += `<div class="legend"><h3>Pulizie programmate</h3>`
      notes.forEach(n => { html += `<div class="legend-item"><b>${n.day}</b> — ${n.cat}: ${n.note}</div>` })
      html += `</div>`
    }
    html += `<div class="footer">Generato da CIC Dashboard — ${new Date().toLocaleDateString('it-IT')} | Totale ore personale: ${totalStaff}h | =cucina =sala</div>
    </body></html>`
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.print()
  }

  const downloadExcel = () => {
    const locale = localeName || 'Tutti i locali'
    const wb = XLSX.utils.book_new()

    // Separa dipendenti cucina e sala
    const cucinaEmps = localeEmps.filter(e => (e.ruolo || '').toLowerCase().match(/cucin|pizz|chef|cuoco|lava/))
    const salaEmps = localeEmps.filter(e => !(e.ruolo || '').toLowerCase().match(/cucin|pizz|chef|cuoco|lava/))
    const allEmps = localeEmps

    // Per ogni giorno della settimana, crea un foglio
    DAYS.forEach((dayName, di) => {
      const hourLabels = HOURS.map(h => String(h).padStart(2, '0') + ':00')
      const suggested = HOURS.map(h => getCell(di, h))

      // Header: Riga 1 = Titolo
      const rows = []
      rows.push([`ORARI ${dayName.toUpperCase()} — ${locale}`, '', ...hourLabels.map(() => ''), '', 'Soglia: ' + soglia + '€/h'])

      // Riga 2 = Consigliati
      rows.push(['CONSIGLIATI', '', ...suggested.map(c => c.staff || 0), '', 'Tot: ' + suggested.reduce((s, c) => s + c.staff, 0)])

      // Riga 3 = Dettaglio cucina/sala
      rows.push(['  di cui cucina', '', ...HOURS.map(h => getCell(di, h).prepCucina + (getCell(di, h).revenueStaff > 0 ? Math.ceil(getCell(di, h).revenueStaff / 2) : 0))])
      rows.push(['  di cui sala', '', ...HOURS.map(h => getCell(di, h).prepSala + (getCell(di, h).revenueStaff > 0 ? Math.floor(getCell(di, h).revenueStaff / 2) : 0))])

      // Riga vuota
      rows.push([])

      // Sezione CUCINA
      rows.push(['CUCINA', 'Ruolo', ...hourLabels])
      // Righe precompilate per ogni dipendente cucina + righe vuote
      const maxCucina = Math.max(cucinaEmps.length, Math.max(...HOURS.map(h => getCell(di, h).prepCucina + (getCell(di, h).revenueStaff > 0 ? Math.ceil(getCell(di, h).revenueStaff / 2) : 0)), 0) + 2)
      for (let i = 0; i < maxCucina; i++) {
        const emp = cucinaEmps[i]
        rows.push([emp ? emp.nome : '', emp ? emp.ruolo : '', ...hourLabels.map(() => '')])
      }

      // Riga vuota
      rows.push([])

      // Sezione SALA
      rows.push(['SALA', 'Ruolo', ...hourLabels])
      const maxSala = Math.max(salaEmps.length, Math.max(...HOURS.map(h => getCell(di, h).prepSala + (getCell(di, h).revenueStaff > 0 ? Math.floor(getCell(di, h).revenueStaff / 2) : 0)), 0) + 2)
      for (let i = 0; i < maxSala; i++) {
        const emp = salaEmps[i]
        rows.push([emp ? emp.nome : '', emp ? emp.ruolo : '', ...hourLabels.map(() => '')])
      }

      // Note pulizie
      const dayNotes = PREP_CATS.filter(c => c.hasNote).map(c => prepNotes[`${di}-${c.key}-note`]).filter(Boolean)
      if (dayNotes.length > 0) {
        rows.push([])
        rows.push(['PULIZIE:', ...dayNotes])
      }

      const ws = XLSX.utils.aoa_to_sheet(rows)

      // Larghezza colonne
      ws['!cols'] = [{ wch: 20 }, { wch: 12 }, ...hourLabels.map(() => ({ wch: 6 }))]

      // Data validation per tendina nomi dipendenti
      // XLSX.js non supporta data validation nativa, ma possiamo aggiungere un foglio "Dipendenti" come riferimento

      XLSX.utils.book_append_sheet(wb, ws, dayName)
    })

    // Foglio riassunto settimanale
    const summaryRows = [['RIEPILOGO SETTIMANALE — ' + locale], []]
    summaryRows.push(['Ora', ...DAYS])
    HOURS.forEach(h => {
      summaryRows.push([String(h).padStart(2, '0') + ':00', ...DAYS.map((_, di) => getCell(di, h).staff || 0)])
    })
    summaryRows.push(['TOTALE PERSONE', ...dayTotals])
    summaryRows.push(['INCASSO €', ...dayRevenues.map(r => Math.round(r))])
    summaryRows.push([])
    summaryRows.push(['Tot. ore settimanali:', totalStaff])

    // Note pulizie
    const allNotes = getPrepNotesForPDF()
    if (allNotes.length > 0) {
      summaryRows.push([])
      summaryRows.push(['PULIZIE PROGRAMMATE:'])
      allNotes.forEach(n => summaryRows.push([n.day, n.cat, n.note]))
    }

    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows)
    summaryWs['!cols'] = [{ wch: 12 }, ...DAYS.map(() => ({ wch: 8 }))]
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Riepilogo')

    // Foglio lista dipendenti (per riferimento tendina)
    const empRows = [['Nome', 'Ruolo', 'Area', 'Locale']]
    allEmps.forEach(e => {
      const area = (e.ruolo || '').toLowerCase().match(/cucin|pizz|chef|cuoco|lava/) ? 'Cucina' : 'Sala'
      empRows.push([e.nome, e.ruolo || '', area, e.locale || ''])
    })
    const empWs = XLSX.utils.aoa_to_sheet(empRows)
    empWs['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 8 }, { wch: 15 }]
    XLSX.utils.book_append_sheet(wb, empWs, 'Dipendenti')

    XLSX.writeFile(wb, `Orari_${locale.replace(/\s/g, '_')}_${prevMonday}.xlsx`)
  }

  const downloadCsv = () => {
    const locale = localeName || 'Tutti i locali'
    const headers = ['Ora', ...DAYS]
    const rows = HOURS.map(h => [
      String(h).padStart(2, '0') + ':00',
      ...DAYS.map((_, di) => getCell(di, h).staff || 0),
    ])
    rows.push(['TOTALE PERSONE', ...dayTotals])
    rows.push(['INCASSO €', ...dayRevenues.map(r => Math.round(r))])
    exportToCsv(`Orari_${locale.replace(/\s/g, '_')}_${prevMonday}`, headers, rows)
  }

  const iS = S.input

  return <div style={{ marginTop: 12 }}>
    <Card title="Orari consigliati" badge={loading ? 'Caricamento...' : totalStaff + 'h personale'} extra={
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#64748b' }}>Soglia €/h:</span>
        <input type="number" value={soglia} onChange={e => setSoglia(Number(e.target.value) || 50)} style={{ ...iS, width: 55, textAlign: 'center', fontSize: 12 }} />
        <button onClick={downloadExcel} style={{ ...iS, background: '#10B981', color: '#0f1420', border: 'none', padding: '4px 12px', fontWeight: 700, fontSize: 11 }}>Excel</button>
        <button onClick={downloadCsv} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 700, fontSize: 11 }} title="Scarica CSV riepilogo orario per giorno">CSV</button>
        <button onClick={printPDF} style={{ ...iS, background: '#EF4444', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 700, fontSize: 11 }}>PDF</button>
      </div>
    }>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
        Basato sugli incassi della settimana precedente ({prevMonday} {prevSunday}) {localeName ? `per ${localeName}` : ''} — {daysWithData} giorni con dati
      </div>

      {/* Preparazioni budget */}
      <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #2a3042' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>Budget preparazioni e pulizie</div>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>Inserisci il numero di persone per ogni categoria. Le ore vengono sommate alla tabella orari consigliati.</div>
        {PREP_CATS.map(cat => {
          const hasAnyValue = HOURS.some(h => DAYS.some((_, di) => prep[`${di}-${h}-${cat.key}`] > 0))
          return <div key={cat.key} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}
              onClick={() => { const el = document.getElementById('prep-' + cat.key); if (el) el.style.display = el.style.display === 'none' ? '' : 'none' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: cat.color }}>{cat.icon} {cat.label}</span>
              <span style={{ fontSize: 9, color: '#475569' }}>({cat.area})</span>
              <span style={{ fontSize: 9, color: '#475569' }}></span>
            </div>
            <div id={'prep-' + cat.key} style={{ display: hasAnyValue ? '' : 'none', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead><tr><th style={{ ...S.th, fontSize: 8, width: 40 }}>Ora</th>
                  {DAYS.map(d => <th key={d} style={{ ...S.th, fontSize: 8 }}>{d}</th>)}
                </tr></thead>
                <tbody>
                  {HOURS.map(h => <tr key={h} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ ...S.td, fontSize: 9, color: '#94a3b8', padding: '1px 4px' }}>{String(h).padStart(2,'0')}:00</td>
                    {DAYS.map((_, di) => <td key={di} style={{ ...S.td, padding: '1px' }}>
                      <input type="number" min="0" max="10" value={prep[`${di}-${h}-${cat.key}`] || ''}
                        onChange={e => updatePrep(di, h, cat.key, e.target.value)} placeholder="0"
                        style={{ ...iS, width: 28, fontSize: 9, padding: '1px 2px', textAlign: 'center', color: cat.color }} />
                    </td>)}
                  </tr>)}
                </tbody>
              </table>
              {cat.hasNote && <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DAYS.map((d, di) => {
                  const noteKey = `${di}-${cat.key}-note`
                  return <input key={di} value={prepNotes[noteKey] || ''} onChange={e => {
                    const next = { ...prepNotes, [noteKey]: e.target.value }
                    setPrepNotes(next); localStorage.setItem('cic_prep_notes', JSON.stringify(next))
                  }} placeholder={d + ': tipo pulizia...'} style={{ ...iS, flex: 1, minWidth: 90, fontSize: 9, padding: '2px 4px', color: cat.color }} />
                })}
              </div>}
            </div>
          </div>
        })}
        <div style={{ fontSize: 9, color: '#475569', marginTop: 4 }}>Clicca su una categoria per espandere/chiudere. I dati si salvano in automatico.</div>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 20, color: '#F59E0B', fontSize: 12 }}>Caricamento dati settimana precedente...</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '2px solid #2a3042' }}>
              <th style={{ ...S.th, width: 50 }}>Ora</th>
              {DAYS.map(d => <th key={d} style={S.th} colSpan={1}>{d}</th>)}
            </tr>
            <tr style={{ borderBottom: '1px solid #2a3042' }}>
              <th style={{ ...S.th, fontSize: 8 }}></th>
              {DAYS.map(d => <th key={d} style={{ ...S.th, fontSize: 8, padding: '2px' }}>
                <span style={{ color: '#F59E0B' }}></span> <span style={{ color: '#3B82F6' }}></span> <span style={{ color: '#94a3b8' }}>Tot</span>
              </th>)}
            </tr></thead>
            <tbody>
              {HOURS.map(h => {
                const hStr = String(h).padStart(2, '0') + ':00'
                const hasAny = DAYS.some((_, di) => getCell(di, h).staff > 0)
                if (!hasAny) return null
                return <tr key={h} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...S.td, fontWeight: 600, color: '#e2e8f0', fontSize: 11 }}>{hStr}</td>
                  {DAYS.map((_, di) => {
                    const c = getCell(di, h)
                    return <td key={di} style={{ ...S.td, background: staffColor(c.staff), textAlign: 'center', padding: '2px 1px' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 3, fontSize: 10 }}>
                        {c.prepCucina > 0 && <span style={{ color: '#F59E0B', fontWeight: 700 }}>{c.prepCucina}</span>}
                        {c.prepSala > 0 && <span style={{ color: '#3B82F6', fontWeight: 700 }}>{c.prepSala}</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: staffTextColor(c.staff) }}>{c.staff || '—'}</div>
                      {c.ricavi > 0 && <div style={{ fontSize: 8, color: '#64748b' }}>{Math.round(c.ricavi)}€</div>}
                      {c.prepStaff > 0 && c.revenueStaff === 0 && <div style={{ fontSize: 7, color: '#8B5CF6' }}>prep</div>}
                    </td>
                  })}
                </tr>
              })}
              {/* Riga totale */}
              <tr style={{ borderTop: '2px solid #2a3042', background: '#131825' }}>
                <td style={{ ...S.td, fontWeight: 700, color: '#e2e8f0' }}>TOT</td>
                {dayTotals.map((t, i) => {
                  const rev = dayRevenues[i]
                  return <td key={i} style={{ ...S.td, textAlign: 'center', padding: '6px 4px' }}>
                    <div style={{ fontWeight: 700, color: '#F59E0B', fontSize: 14, lineHeight: 1.1 }}>{t}</div>
                    {rev > 0 && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>({fmt(rev)})</div>}
                  </td>
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: '#64748b' }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(16,185,129,.15)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> 1-2 persone</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(245,158,11,.15)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> 3-4 persone</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(239,68,68,.15)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> 5+ persone</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(139,92,246,.15)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> preparazioni</span>
      </div>
    </Card>
  </div>
}

// ═════════════════════════════════════════════════════════════════════
// Editor timeline giornaliera con click-on-hour + zoom a quarti d'ora
// ═════════════════════════════════════════════════════════════════════

// Configurazione giornata operativa:
// iniziamo alle 12:00 del giorno stesso e finiamo alle 05:00 del giorno dopo.
// Totale 17 ore "visualizzate" da colonne 0..16.
const DAY_START_HOUR = 12
const DAY_END_HOUR_NEXT = 5 // 05:00 del giorno successivo
const DAY_SPAN_HOURS = (24 - DAY_START_HOUR) + DAY_END_HOUR_NEXT // = 17
const DAY_SPAN_QUARTERS = DAY_SPAN_HOURS * 4 // = 68

// Converte 'HH:MM' in minuti dall'inizio giornata (0..1439)
function hmToMin(hm) {
  if (!hm || !hm.includes(':')) return null
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (m || 0)
}
// Converte minuti in 'HH:MM'
function minToHm(min) {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}
// Indice "colonna" (0..DAY_SPAN_HOURS-1) HH:MM reale di partenza
function colHourToHm(col) {
  const h = (DAY_START_HOUR + col) % 24
  return String(h).padStart(2, '0') + ':00'
}
// Indice quarto (0..DAY_SPAN_QUARTERS-1) minuti dall'inizio giornata reale (0..1439),
// flaggando se appartiene al giorno dopo.
function qToClock(q) {
  const totalMin = q * 15 + DAY_START_HOUR * 60 // minuti dall'inizio del giorno "calendario" di partenza
  const isNextDay = totalMin >= 24 * 60
  const wrapped = totalMin % (24 * 60)
  return { hm: minToHm(wrapped), min: wrapped, isNextDay }
}

// Dati "quali quarti d'ora sono lavorati" per un dipendente nel giorno operativo.
// Ogni giorno operativo ha DAY_SPAN_QUARTERS (68) quarti, a partire dalle 12:00.
// Include i turni del giorno stesso (dalle 12:00 alle 23:59) E i turni del giorno
// dopo che iniziano tra 00:00 e 05:00 (continuazione notturna).
function shiftsToQuartersOp(allShifts, empId, day) {
  const set = new Set()
  const dayBefore12 = allShifts.filter(s => s.employee_id === empId && s.giorno === day)
  const dayAfterEarly = allShifts.filter(s => s.employee_id === empId && s.giorno === (day + 1) % 7)
  // Turni di 'day' quarti 0..47 della giornata operativa (12:00..23:59)
  for (const s of dayBefore12) {
    let start = hmToMin(s.ora_inizio?.substring(0, 5))
    let end = hmToMin(s.ora_fine?.substring(0, 5))
    if (start == null || end == null) continue
    if (end <= start) end = 24 * 60 // se scavalca mezzanotte, considera fino a 24 (il resto sta nel giorno dopo)
    if (end <= DAY_START_HOUR * 60) continue // turno del mattino: non appartiene a questa giornata operativa
    const effStart = Math.max(start, DAY_START_HOUR * 60)
    const q1 = Math.floor((effStart - DAY_START_HOUR * 60) / 15)
    const q2 = Math.ceil((end - DAY_START_HOUR * 60) / 15)
    for (let q = q1; q < q2; q++) if (q >= 0 && q < DAY_SPAN_QUARTERS) set.add(q)
  }
  // Turni del giorno dopo che iniziano dalle 00:00 fino alle DAY_END_HOUR_NEXT:00
  for (const s of dayAfterEarly) {
    let start = hmToMin(s.ora_inizio?.substring(0, 5))
    let end = hmToMin(s.ora_fine?.substring(0, 5))
    if (start == null || end == null) continue
    if (end <= start) continue // escludiamo eventuali turni del giorno dopo che scavalcano ancora
    if (start >= DAY_END_HOUR_NEXT * 60) continue // inizia dopo il cutoff (appartiene al giorno dopo)
    const effEnd = Math.min(end, DAY_END_HOUR_NEXT * 60)
    // offset: questi quarti sono nella seconda metà della giornata operativa (dopo le 24:00)
    const q1 = Math.floor(start / 15) + (24 - DAY_START_HOUR) * 4
    const q2 = Math.ceil(effEnd / 15) + (24 - DAY_START_HOUR) * 4
    for (let q = q1; q < q2; q++) if (q >= 0 && q < DAY_SPAN_QUARTERS) set.add(q)
  }
  return set
}

// Converte Set di quarti (in giorno operativo, 0..DAY_SPAN_QUARTERS-1) in intervalli.
// Ogni intervallo puo' essere nel "giorno stesso" o nel "giorno dopo" (split su 24:00).
// Ritorna array: [{giornoOffset: 0|1, startHm, endHm}]
function quartersOpToIntervals(set) {
  const arr = [...set].sort((a, b) => a - b)
  if (arr.length === 0) return []
  const out = []
  let i = 0
  const SPLIT = (24 - DAY_START_HOUR) * 4 // = 48, confine tra day e day+1
  while (i < arr.length) {
    let j = i
    while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++
    // Start/end in quarti, convertiti in minuti dall'inizio del giorno calendario di partenza
    const startAbsMin = arr[i] * 15 + DAY_START_HOUR * 60
    const endAbsMin = (arr[j] + 1) * 15 + DAY_START_HOUR * 60
    // Spezza su 24:00 se attraversa
    if (endAbsMin <= 24 * 60) {
      out.push({ giornoOffset: 0, startHm: minToHm(startAbsMin), endHm: minToHm(endAbsMin % (24 * 60)) })
    } else if (startAbsMin >= 24 * 60) {
      out.push({ giornoOffset: 1, startHm: minToHm(startAbsMin - 24 * 60), endHm: minToHm(endAbsMin - 24 * 60) })
    } else {
      // Attraversa mezzanotte: split in due pezzi
      out.push({ giornoOffset: 0, startHm: minToHm(startAbsMin), endHm: '23:59' })
      out.push({ giornoOffset: 1, startHm: '00:00', endHm: minToHm(endAbsMin - 24 * 60) })
    }
    i = j + 1
  }
  return out
}

function DailyTimelineEditor({ emps, shifts, selectedDay, setSelectedDay, weekStart, locale, onChanged, staffSchedule = {} }) {
  const [zoomedHour, setZoomedHour] = useState(null) // null | { empId, col }
  const [saving, setSaving] = useState(false)

  // ─── Carica i dati degli Orari consigliati per questo giorno ──────────
  // Stessa logica di SuggestedSchedule: incassi settimana precedente per hour
  //   staff_consigliato(day, hour) = max(1, ceil(ricavi/soglia)) + prep(day, hour)
  const [recGrid, setRecGrid] = useState({}) // { hour: ricavi } per il giorno selezionato
  const soglia = Number(localStorage.getItem('cic_soglia_staff')) || 50
  const prep = (() => { try { return JSON.parse(localStorage.getItem('cic_prep_hours') || '{}') } catch { return {} } })()
  const prepTotalAt = (day, hour) => {
    const KEYS = ['prep_cucina', 'prep_sala', 'pulizie_cucina', 'pulizie_sala', 'pulizie_str_cucina', 'pulizie_str_sala']
    return KEYS.reduce((s, k) => s + (Number(prep[`${day}-${hour}-${k}`]) || 0), 0)
  }
  useEffect(() => {
    (async () => {
      const prevMonday = (() => {
        const d = new Date(); d.setDate(d.getDate() - d.getDay() - 6)
        return d.toISOString().split('T')[0]
      })()
      const prevSunday = (() => {
        const d = new Date(prevMonday); d.setDate(d.getDate() + 6)
        return d.toISOString().split('T')[0]
      })()
      // Giorno calendario della settimana scorsa corrispondente a selectedDay (Lun=0)
      const target = new Date(prevMonday)
      target.setDate(target.getDate() + selectedDay)
      const targetStr = target.toISOString().split('T')[0]
      let q = supabase.from('daily_stats').select('date,hourly_records,salespoint_name').eq('date', targetStr)
      if (locale) q = q.eq('salespoint_name', locale)
      const { data } = await q
      const byHour = {}
      for (const row of (data || [])) {
        for (const hr of (row.hourly_records || [])) {
          byHour[hr.hour] = (byHour[hr.hour] || 0) + (hr.ricavi || 0)
        }
      }
      setRecGrid(byHour)
    })()
  }, [selectedDay, locale])
  const recommendedAt = (realHour) => {
    const ricavi = Number(recGrid[realHour]) || 0
    const rev = ricavi > 0 ? Math.max(1, Math.ceil(ricavi / soglia)) : 0
    return rev + prepTotalAt(selectedDay, realHour)
  }

  // Calcola data del giorno selezionato (Lun=0)
  const dayDate = (() => {
    const d = new Date(weekStart); d.setDate(d.getDate() + selectedDay)
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit' })
  })()

  // Mappa empId Set<quartiere> in coordinate giorno operativo (0..67, 12:00..05:00 next day)
  const empQuarters = {}
  for (const e of emps) empQuarters[e.id] = shiftsToQuartersOp(shifts, e.id, selectedDay)

  // Salva sul DB: sostituisce TUTTI i turni del dipendente per day E (day+1 solo per parte notturna 00-05)
  const persistEmployee = async (empId, newSet) => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const nextDay = (selectedDay + 1) % 7
      // Step 1: elimina i turni "di questo giorno operativo" per empId:
      //   - tutti i turni del giorno 'selectedDay' che iniziano >= 12:00 (rientrano nella giornata op)
      //   - tutti i turni del giorno 'nextDay' che finiscono <= 05:00 (continuazione notturna)
      // Per semplicita', rileggo i turni correnti e cancello solo quelli rilevanti per empId.
      const { data: cur } = await supabase.from('employee_shifts').select('*')
        .eq('employee_id', empId).eq('settimana', weekStart).in('giorno', [selectedDay, nextDay])
      const toDel = []
      for (const s of (cur || [])) {
        const st = hmToMin(s.ora_inizio?.substring(0, 5)) ?? 0
        const en = hmToMin(s.ora_fine?.substring(0, 5)) ?? 0
        if (s.giorno === selectedDay) {
          // Se il turno inizia >= 12:00 o scavalca mezzanotte: fa parte della giornata op
          if (st >= DAY_START_HOUR * 60 || en <= st) toDel.push(s.id)
        } else if (s.giorno === nextDay) {
          // Se il turno finisce entro le 05:00: e' la coda notturna della giornata op precedente
          const realEnd = en <= st ? en + 24 * 60 : en
          if (st < DAY_END_HOUR_NEXT * 60 && realEnd <= DAY_END_HOUR_NEXT * 60) toDel.push(s.id)
        }
      }
      if (toDel.length > 0) {
        await supabase.from('employee_shifts').delete().in('id', toDel)
      }
      // Step 2: inserisci i nuovi intervalli, splittando su mezzanotte
      const intervals = quartersOpToIntervals(newSet)
      if (intervals.length > 0) {
        const rows = intervals.map(iv => ({
          user_id: user.id, employee_id: empId, locale: locale || '',
          settimana: weekStart,
          giorno: iv.giornoOffset === 0 ? selectedDay : nextDay,
          ora_inizio: iv.startHm + ':00',
          ora_fine: iv.endHm + ':00',
        }))
        await supabase.from('employee_shifts').insert(rows)
      }
      await onChanged()
    } catch (e) { alert('Errore salvataggio: ' + e.message) }
    setSaving(false)
  }

  // Toggle intera ora (4 quarti)
  const toggleCol = (empId, col) => {
    const cur = new Set(empQuarters[empId])
    const qs = [col * 4, col * 4 + 1, col * 4 + 2, col * 4 + 3]
    const allOn = qs.every(q => cur.has(q))
    qs.forEach(q => allOn ? cur.delete(q) : cur.add(q))
    persistEmployee(empId, cur)
  }

  const toggleQuarter = (empId, q) => {
    const cur = new Set(empQuarters[empId])
    cur.has(q) ? cur.delete(q) : cur.add(q)
    persistEmployee(empId, cur)
  }

  const openZoom = (empId, col) => setZoomedHour({ empId, col })
  const closeZoom = () => setZoomedHour(null)

  const empHours = (empId) => Math.round((empQuarters[empId]?.size || 0) / 4 * 100) / 100

  // Colonne: 0..DAY_SPAN_HOURS-1. Colonna i ora (DAY_START_HOUR + i) % 24.
  const COLS = Array.from({ length: DAY_SPAN_HOURS }, (_, i) => i)

  // Per ogni colonna calcolo:
  //  - staffNow: numero di persone con almeno 1 quarto attivo in quella colonna
  //  - staffRec: valore consigliato dalla tabella Orari consigliati (ricavi/soglia + prep)
  //  - overstaff: staffNow > staffRec
  const colStats = COLS.map(c => {
    const realH = (DAY_START_HOUR + c) % 24
    let staffNow = 0
    for (const e of emps) {
      const qs = [c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 3]
      if (qs.some(q => empQuarters[e.id]?.has(q))) staffNow++
    }
    const staffRec = recommendedAt(realH)
    return { col: c, realH, staffNow, staffRec, overstaff: staffRec > 0 && staffNow > staffRec }
  })

  return <div>
    {/* Selettore giorno */}
    <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
      {DAYS.map((d, i) => (
        <button key={d} onClick={() => setSelectedDay(i)}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: selectedDay === i ? '#F59E0B' : '#1a1f2e',
            color: selectedDay === i ? '#0f1420' : '#94a3b8' }}>{d}</button>
      ))}
      <span style={{ marginLeft: 10, fontSize: 12, color: '#64748b', alignSelf: 'center' }}>{dayDate}</span>
      {saving && <span style={{ color: '#F59E0B', fontSize: 11, alignSelf: 'center' }}>Salvo…</span>}
    </div>

    {/* Legenda */}
    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
      Orari mostrati dalle <strong style={{ color: '#e2e8f0' }}>12:00</strong> alle <strong style={{ color: '#8B5CF6' }}>05:00</strong> del giorno dopo (tutto contato come lavoro di questa giornata).
      <br /><strong style={{ color: '#94a3b8' }}>Click</strong> su un'ora per attivarla/disattivarla · <strong style={{ color: '#94a3b8' }}>Doppio click</strong> per zoom a quarti d'ora.
    </div>

    {/* Griglia giornata operativa: 12:00 05:00 next day */}
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 10, minWidth: 1100 }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', textAlign: 'left', minWidth: 130, position: 'sticky', left: 0, background: '#1a1f2e', zIndex: 2, color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Dipendente</th>
            {COLS.map(c => {
              const realH = (DAY_START_HOUR + c) % 24
              const isNext = DAY_START_HOUR + c >= 24
              const isMidnight = realH === 0 && isNext
              return <th key={c} style={{ padding: '4px 0', minWidth: 36, textAlign: 'center', color: isNext ? '#8B5CF6' : '#64748b', fontWeight: 500, fontSize: 10, borderLeft: isMidnight ? '2px solid #8B5CF6' : (c % 6 === 0 ? '1px solid #2a3042' : 'none') }}>
                {String(realH).padStart(2, '0')}{isNext && <div style={{ fontSize: 8, color: '#8B5CF6', fontWeight: 700 }}>+1</div>}
              </th>
            })}
            <th style={{ padding: '4px 10px', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', textAlign: 'right', position: 'sticky', right: 0, background: '#1a1f2e' }}>Ore</th>
          </tr>
          {/* Riga riepilogo staff: pianificato / consigliato con alert rosso se over */}
          <tr style={{ borderTop: '1px solid #2a3042', background: '#0f1420' }}>
            <td style={{ padding: '4px 8px', fontSize: 10, color: '#64748b', fontWeight: 600, position: 'sticky', left: 0, background: '#0f1420', zIndex: 2, textTransform: 'uppercase', letterSpacing: '.04em' }} title="Personale pianificato / consigliato">Staff</td>
            {colStats.map(cs => {
              const realH = cs.realH
              const isNext = DAY_START_HOUR + cs.col >= 24
              const isMidnight = realH === 0 && isNext
              const over = cs.overstaff
              const under = cs.staffRec > 0 && cs.staffNow < cs.staffRec
              const col = over ? '#EF4444' : (cs.staffNow > 0 && !under ? '#10B981' : '#64748b')
              return <td key={cs.col} title={`Pianificati: ${cs.staffNow}${cs.staffRec > 0 ? ' / Consigliati: ' + cs.staffRec : ''}`}
                style={{ padding: '3px 0', textAlign: 'center', fontSize: 9, fontWeight: 700,
                  borderLeft: isMidnight ? '2px solid #8B5CF6' : (cs.col % 6 === 0 ? '1px solid #2a3042' : 'none'),
                  color: col, background: over ? 'rgba(239,68,68,.12)' : 'transparent' }}>
                {cs.staffNow}{cs.staffRec > 0 && <span style={{ color: '#475569', fontWeight: 400 }}>/{cs.staffRec}</span>}
              </td>
            })}
            <td style={{ padding: '4px 10px', fontSize: 10, color: '#64748b', textAlign: 'right', position: 'sticky', right: 0, background: '#0f1420' }}>Pian. / Cons.</td>
          </tr>
        </thead>
        <tbody>
          {emps.map(emp => {
            const qset = empQuarters[emp.id]
            return <tr key={emp.id} style={{ borderTop: '1px solid #1a1f2e' }}>
              <td style={{ padding: '4px 8px', fontSize: 12, fontWeight: 500, color: '#e2e8f0', position: 'sticky', left: 0, background: '#0f1420', zIndex: 1 }}>{emp.nome}</td>
              {COLS.map(c => {
                const realH = (DAY_START_HOUR + c) % 24
                const isNext = DAY_START_HOUR + c >= 24
                const isMidnight = realH === 0 && isNext
                const qs = [c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 3]
                const countOn = qs.filter(q => qset.has(q)).length
                const full = countOn === 4
                const partial = countOn > 0 && countOn < 4
                const isZoomed = zoomedHour?.empId === emp.id && zoomedHour?.col === c
                const borderLeft = isMidnight ? '2px solid #8B5CF6' : (c % 6 === 0 ? '1px solid #2a3042' : '1px solid #1a1f2e')
                if (isZoomed) {
                  return <td key={c} style={{ padding: 0, borderLeft, background: '#131825' }}>
                    <div style={{ display: 'flex', height: 28, border: '2px solid #F59E0B' }}>
                      {qs.map((q, qi) => {
                        const on = qset.has(q)
                        const label = ['00', '15', '30', '45'][qi]
                        return <button key={q} onClick={() => toggleQuarter(emp.id, q)} title={`${String(realH).padStart(2,'0')}:${label}${isNext ? ' (giorno dopo)' : ''}`}
                          style={{ flex: 1, border: 'none', borderRight: qi < 3 ? '1px solid #0f1420' : 'none',
                            background: on ? '#3B82F6' : 'transparent', color: on ? '#fff' : '#475569',
                            fontSize: 8, fontWeight: 700, cursor: 'pointer', padding: 0 }}>{label}</button>
                      })}
                    </div>
                    <button onClick={closeZoom} style={{ width: '100%', fontSize: 8, padding: '1px', border: 'none', background: '#F59E0B', color: '#0f1420', cursor: 'pointer', fontWeight: 700 }}>× chiudi</button>
                  </td>
                }
                const isOver = colStats[c]?.overstaff
                const activeBg = isOver ? '#EF4444' : (isNext ? '#8B5CF6' : '#3B82F6')
                const fillBg = full ? activeBg : 'transparent'
                return <td key={c}
                  onClick={() => toggleCol(emp.id, c)}
                  onDoubleClick={() => openZoom(emp.id, c)}
                  title={`${String(realH).padStart(2,'0')}:00${isNext ? ' (giorno dopo)' : ''}${isOver ? ' — sovra-staffato' : ''} · click=toggle, doppio click=zoom 15min`}
                  className="ts-cell"
                  style={{ height: 28, borderLeft, cursor: 'pointer' }}>
                  <span className="ts-fill" style={{ background: fillBg, display: 'flex' }}>
                    {partial && qs.map(q => <span key={q} style={{ flex: 1, background: qset.has(q) ? activeBg : 'transparent' }} />)}
                  </span>
                </td>
              })}
              <td style={{ padding: '4px 10px', color: '#F59E0B', fontWeight: 700, fontSize: 12, textAlign: 'right', position: 'sticky', right: 0, background: '#0f1420' }}>{empHours(emp.id)}h</td>
            </tr>
          })}
          {emps.length === 0 && <tr><td colSpan={DAY_SPAN_HOURS + 2} style={{ padding: 16, textAlign: 'center', color: '#475569', fontSize: 12 }}>Nessun dipendente</td></tr>}
        </tbody>
      </table>
    </div>
    <div style={{ marginTop: 8, fontSize: 10, color: '#64748b', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#3B82F6', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> ore del giorno</span>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#8B5CF6', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> ore dopo mezzanotte (contate in questa giornata)</span>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#EF4444', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} /> sovra-staffato (più persone del consigliato)</span>
    </div>
  </div>
}
