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
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ employee_id: '', giorno: 0, ora_inizio: '18:00', ora_fine: '23:00' })
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
    const startH = parseInt(s.ora_inizio?.split(':')[0]) || 0
    const endH = parseInt(s.ora_fine?.split(':')[0]) || 0
    const hours = endH > startH ? endH - startH : 0
    return sum + hours * (Number(emp?.costo_orario) || 0)
  }, 0)

  const totalHours = shifts.reduce((sum, s) => {
    const a = parseInt(s.ora_inizio?.split(':')[0]) || 0
    const b = parseInt(s.ora_fine?.split(':')[0]) || 0
    return sum + (b > a ? b - a : 0)
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

  const formStyle = { ...iS, marginBottom: 0 }

  return <>
    {/* KPI turni */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
      <KPI label="Turni questa settimana" icon="📅" value={shifts.length} sub="inseriti" accent='#3B82F6' />
      <KPI label="Ore totali" icon="⏱️" value={totalHours + 'h'} sub="settimana" accent='#F59E0B' />
      <KPI label="Costo stimato" icon="💶" value={weekCost > 0 ? fmtD(weekCost) : '—'} sub="settimana" accent='#10B981' />
    </div>

    {/* Turni settimanali */}
    <Card title="Turni settimanali" extra={
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={prevWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>◀</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 130, textAlign: 'center' }}>{weekLabel()}</span>
        <button onClick={nextWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>▶</button>
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
                  return s + (b > a ? b - a : 0)
                }, 0)
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
  </>
}
