import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const DAYS_HEADER = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']
const URGENCY_COLORS = { critica:'#EF4444', alta:'#F97316', normale:'#F59E0B', bassa:'#94a3b8' }
const TYPE_COLORS = { scadenza_doc:'#EF4444', turno:'#3B82F6', ferie:'#10B981', generico:'#8B5CF6' }

function getMonthDays(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7 // Monday=0
  const days = []
  for (let i = -startOffset; i < lastDay.getDate() + (6 - (lastDay.getDay() + 6) % 7); i++) {
    const d = new Date(year, month, i + 1)
    days.push(d)
  }
  return days
}

export default function HRCalendar({ employees }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [events, setEvents] = useState([])
  const [selectedDay, setSelectedDay] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ titolo: '', descrizione: '', data_inizio: '', data_fine: '', tipo: 'generico', urgenza: 'normale', employee_id: '' })

  const iS = S.input

  const loadEvents = useCallback(async () => {
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00`
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}T23:59:59`
    const { data } = await supabase.from('calendar_events').select('*').gte('data_inizio', from).lte('data_inizio', to).order('data_inizio')
    setEvents(data || [])
  }, [year, month])

  // Auto-create scadenza events from documents
  const syncDocExpiries = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: docs } = await supabase.from('employee_documents').select('id,nome,scadenza,employee_id').not('scadenza', 'is', null)
    if (!docs?.length) return
    const { data: existingEvents } = await supabase.from('calendar_events').select('document_id').eq('tipo', 'scadenza_doc')
    const existingDocIds = new Set((existingEvents || []).map(e => e.document_id))

    for (const doc of docs) {
      if (existingDocIds.has(doc.id)) continue
      const scad = new Date(doc.scadenza)
      if (scad < now) continue
      await supabase.from('calendar_events').insert({
        user_id: user.id, titolo: 'Scadenza: ' + doc.nome,
        data_inizio: doc.scadenza + 'T09:00:00', data_fine: doc.scadenza + 'T09:00:00',
        tipo: 'scadenza_doc', urgenza: 'alta', employee_id: doc.employee_id, document_id: doc.id,
        reminder_days: [30, 15, 5]
      })
    }
    await loadEvents()
  }, [loadEvents])

  useEffect(() => { loadEvents(); syncDocExpiries() }, [loadEvents, syncDocExpiries])

  const saveEvent = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('calendar_events').insert({
      user_id: user.id, ...form,
      data_inizio: form.data_inizio + 'T09:00:00', data_fine: (form.data_fine || form.data_inizio) + 'T18:00:00',
      employee_id: form.employee_id || null
    })
    setShowForm(false); setForm({ titolo: '', descrizione: '', data_inizio: '', data_fine: '', tipo: 'generico', urgenza: 'normale', employee_id: '' })
    await loadEvents()
  }

  const deleteEvent = async (id) => {
    await supabase.from('calendar_events').delete().eq('id', id)
    await loadEvents()
  }

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const days = getMonthDays(year, month)
  const monthLabel = new Date(year, month).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })

  const dayEvents = (date) => {
    const ds = date.toISOString().split('T')[0]
    return events.filter(e => e.data_inizio?.startsWith(ds))
  }

  const selectedDayEvents = selectedDay ? dayEvents(selectedDay) : []
  const formStyle = { ...iS, width: '100%', marginBottom: 8 }
  const todayStr = now.toISOString().split('T')[0]

  return <>
    <Card title="Calendario" extra={
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={prevMonth} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}></button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 140, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel}</span>
        <button onClick={nextMonth} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}></button>
        <button onClick={() => { setShowForm(true); setForm(f => ({ ...f, data_inizio: todayStr, data_fine: todayStr })) }} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11 }}>+ Evento</button>
      </div>
    }>
      {/* Form nuovo evento */}
      {showForm && <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #2a3042' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8 }}>
          <input placeholder="Titolo *" value={form.titolo} onChange={e => setForm(p => ({ ...p, titolo: e.target.value }))} style={formStyle} />
          <input type="date" value={form.data_inizio} onChange={e => setForm(p => ({ ...p, data_inizio: e.target.value }))} style={formStyle} title="Dal" />
          <input type="date" value={form.data_fine} onChange={e => setForm(p => ({ ...p, data_fine: e.target.value }))} style={formStyle} title="Al" />
          <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))} style={formStyle}>
            {['generico', 'scadenza_doc', 'turno', 'ferie'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={form.urgenza} onChange={e => setForm(p => ({ ...p, urgenza: e.target.value }))} style={formStyle}>
            {['bassa', 'normale', 'alta', 'critica'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))} style={{ ...formStyle, maxWidth: 200 }}>
            <option value="">Dipendente (opz.)</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <button onClick={saveEvent} disabled={!form.titolo || !form.data_inizio} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 11 }}>Salva</button>
          <button onClick={() => setShowForm(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '5px 10px', fontSize: 11 }}>Annulla</button>
        </div>
      </div>}

      {/* Griglia calendario */}
      <div className="hr-calendar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {DAYS_HEADER.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, color: '#475569', fontWeight: 600, padding: '4px 0', textTransform: 'uppercase' }}>{d}</div>)}
        {days.map((d, i) => {
          const ds = d.toISOString().split('T')[0]
          const isCurrentMonth = d.getMonth() === month
          const isToday = ds === todayStr
          const isSelected = selectedDay && selectedDay.toISOString().split('T')[0] === ds
          const evts = dayEvents(d)
          return <div key={i} onClick={() => setSelectedDay(d)} style={{
            minHeight: 60, padding: 4, borderRadius: 6, cursor: 'pointer',
            background: isSelected ? '#2a3042' : isToday ? 'rgba(245,158,11,.08)' : 'transparent',
            border: isToday ? '1px solid #F59E0B' : '1px solid transparent',
            opacity: isCurrentMonth ? 1 : 0.3
          }}>
            <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? '#F59E0B' : '#94a3b8', marginBottom: 2 }}>{d.getDate()}</div>
            {evts.slice(0, 3).map((e, j) => <div key={j} style={{
              fontSize: 9, padding: '1px 4px', borderRadius: 3, marginBottom: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              background: (TYPE_COLORS[e.tipo] || '#475569') + '22', color: TYPE_COLORS[e.tipo] || '#94a3b8'
            }}>{e.titolo}</div>)}
            {evts.length > 3 && <div style={{ fontSize: 9, color: '#64748b' }}>+{evts.length - 3}</div>}
          </div>
        })}
      </div>
    </Card>

    {/* Dettaglio giorno selezionato */}
    {selectedDay && <div style={{ marginTop: 12 }}>
      <Card title={selectedDay.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} badge={selectedDayEvents.length + ' eventi'}>
        {selectedDayEvents.length === 0 ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: 16, fontSize: 13 }}>Nessun evento per questo giorno.</div>
        ) : (
          <div>
            {selectedDayEvents.map(e => {
              const emp = employees.find(emp => emp.id === e.employee_id)
              return <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1e2636' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 4, height: 32, borderRadius: 2, background: URGENCY_COLORS[e.urgenza] || '#94a3b8' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{e.titolo}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {e.tipo && <span style={S.badge(TYPE_COLORS[e.tipo] || '#94a3b8', (TYPE_COLORS[e.tipo] || '#94a3b8') + '22')}>{e.tipo}</span>}
                      {emp && <span style={{ marginLeft: 6 }}>{emp.nome}</span>}
                      {e.descrizione && <span style={{ marginLeft: 6 }}>— {e.descrizione}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => { if (confirm('Eliminare evento?')) deleteEvent(e.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>Elimina</button>
              </div>
            })}
          </div>
        )}
      </Card>
    </div>}

    {/* Legenda colori */}
    <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 11, color: '#64748b' }}>
      {Object.entries(TYPE_COLORS).map(([k, c]) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />{k}
      </div>)}
      <span style={{ marginLeft: 'auto' }}>Urgenza:</span>
      {Object.entries(URGENCY_COLORS).map(([k, c]) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{k}
      </div>)}
    </div>
  </>
}
