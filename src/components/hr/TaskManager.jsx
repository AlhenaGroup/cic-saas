// Modulo Task — UI dashboard HR (admin/direzione)
// Sub-tabs: Calendario · Lista · Ricorrenti
// Crea/modifica task one-shot, gestisce template ricorrenti, smista tra dipendenti.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, KPI } from '../shared/styles.jsx'
import SubTabsBar from '../SubTabsBar'

const PRIORITY_COLORS = {
  bassa:   { bg: 'rgba(148,163,184,.15)', fg: '#64748B' },
  media:   { bg: 'var(--blue-bg)',        fg: 'var(--blue-text)' },
  alta:    { bg: 'rgba(245,158,11,.15)',  fg: '#B45309' },
  urgente: { bg: 'var(--red-bg)',         fg: 'var(--red)' },
}

const STATUS_LABEL = {
  da_fare: 'Da fare', in_corso: 'In corso', fatta: 'Fatta',
  saltata: 'Saltata', scaduta: 'Scaduta', delegata: 'Delegata',
}

const RECURRENCE_LABEL = {
  daily: 'Ogni giorno', weekdays: 'Giorni feriali (Lun-Ven)',
  weekly: 'Settimanale', biweekly: 'Quindicinale', monthly: 'Mensile',
}

const DAY_NAMES = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']

const iS = S.input

export default function TaskManager({ sp, sps, employees }) {
  const [tab, setTab] = useState(() => localStorage.getItem('task_tab') || 'calendario')
  useEffect(() => { localStorage.setItem('task_tab', tab) }, [tab])

  const [tasks, setTasks] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [editingTpl, setEditingTpl] = useState(null)
  const [dispatchTask, setDispatchTask] = useState(null)
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.toISOString().split('T')[0]
  })

  const localeFilter = sp === 'all' ? null : sps.find(s => String(s.id) === sp)?.description || sp

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('tasks').select('*').order('due_date').order('due_time')
    if (localeFilter) q = q.eq('locale', localeFilter)
    const { data: t } = await q
    setTasks(t || [])
    let qt = supabase.from('task_templates').select('*').order('title')
    if (localeFilter) qt = qt.eq('locale', localeFilter)
    const { data: tp } = await qt
    setTemplates(tp || [])
    setLoading(false)
  }, [localeFilter])
  useEffect(() => { load() }, [load])

  const generateInstances = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const r = await fetch('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', user_id: user.id }),
    })
    const out = await r.json()
    alert(out.error ? 'Errore: ' + out.error : `Generate: ${out.generated} task fino a ${out.until}`)
    await load()
  }

  return <Card title="📋 Task" extra={
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={() => setEditingTask({})} style={btnPrimary}>+ Nuova task</button>
      <button onClick={() => setEditingTpl({})} style={btnSecondary}>+ Nuovo ricorrente</button>
      <button onClick={generateInstances} style={btnSecondary} disabled={loading}>🔄 Genera ricorrenze</button>
    </div>
  }>
    <SubTabsBar tabs={[
      { key: 'calendario', label: '📅 Calendario' },
      { key: 'lista',      label: '📋 Lista' },
      { key: 'ricorrenti', label: '🔁 Ricorrenti (' + templates.length + ')' },
    ]} value={tab} onChange={setTab} />

    {tab === 'calendario' && <CalendarView tasks={tasks} weekStart={weekStart} setWeekStart={setWeekStart} onTaskClick={setEditingTask} employees={employees}/>}
    {tab === 'lista' && <ListView tasks={tasks} employees={employees} onEdit={setEditingTask} onDispatch={setDispatchTask} onDelete={async (id) => {
      if (!confirm('Eliminare questa task?')) return
      await supabase.from('tasks').delete().eq('id', id)
      await load()
    }} />}
    {tab === 'ricorrenti' && <TemplatesView templates={templates} onEdit={setEditingTpl} onDelete={async (id) => {
      if (!confirm('Eliminare il template? Le istanze già generate non verranno toccate.')) return
      await supabase.from('task_templates').delete().eq('id', id)
      await load()
    }} />}

    {editingTask && <TaskEditor task={editingTask} employees={employees} sps={sps} onClose={() => setEditingTask(null)} onSaved={() => { setEditingTask(null); load() }}/>}
    {editingTpl && <TemplateEditor tpl={editingTpl} employees={employees} sps={sps} onClose={() => setEditingTpl(null)} onSaved={() => { setEditingTpl(null); load() }}/>}
    {dispatchTask && <DispatchModal task={dispatchTask} employees={employees} onClose={() => setDispatchTask(null)} onDone={() => { setDispatchTask(null); load() }}/>}
  </Card>
}

// ─── Calendario settimanale ─────────────────────────────────────────
function CalendarView({ tasks, weekStart, setWeekStart, onTaskClick, employees }) {
  const days = useMemo(() => {
    const arr = []
    const start = new Date(weekStart)
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i)
      arr.push(d.toISOString().split('T')[0])
    }
    return arr
  }, [weekStart])

  const tasksByDay = useMemo(() => {
    const m = {}
    days.forEach(d => m[d] = [])
    tasks.forEach(t => { if (m[t.due_date]) m[t.due_date].push(t) })
    return m
  }, [tasks, days])

  const moveWeek = (n) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + n * 7)
    setWeekStart(d.toISOString().split('T')[0])
  }

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <button onClick={() => moveWeek(-1)} style={btnSecondary}>←</button>
      <strong style={{ fontSize: 14, color: 'var(--text)' }}>
        Settimana del {new Date(weekStart).toLocaleDateString('it-IT', { day: '2-digit', month: 'long' })}
      </strong>
      <button onClick={() => moveWeek(1)} style={btnSecondary}>→</button>
      <button onClick={() => {
        const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
        setWeekStart(d.toISOString().split('T')[0])
      }} style={btnSecondary}>Oggi</button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
      {days.map(d => {
        const dt = new Date(d)
        const isToday = d === new Date().toISOString().split('T')[0]
        return <div key={d} style={{
          background: 'var(--surface)', border: '1px solid ' + (isToday ? 'var(--blue)' : 'var(--border)'),
          borderRadius: 'var(--radius-control)', padding: 10, minHeight: 200,
        }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
            {DAY_NAMES[(dt.getDay() + 7) % 7]} {dt.getDate()}/{dt.getMonth() + 1}
          </div>
          {tasksByDay[d]?.map(t => <TaskCard key={t.id} task={t} compact onClick={() => onTaskClick(t)} employees={employees}/>)}
          {tasksByDay[d]?.length === 0 && <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>—</div>}
        </div>
      })}
    </div>
  </div>
}

function TaskCard({ task, compact, onClick, employees }) {
  const c = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.media
  const assigneeLabel = task.assignment_kind === 'team' ? 'TEAM' :
    task.assignment_kind === 'roles' ? (task.assigned_roles || []).join(', ') :
    (task.assigned_employee_ids || []).map(id => (employees.find(e => e.id === id)?.nome || '?')).join(', ')
  const icon = task.type === 'production' ? '🔪' : '📌'
  return <div onClick={onClick} style={{
    background: c.bg, border: '1px solid transparent', borderRadius: 8,
    padding: compact ? '6px 8px' : '10px 12px', marginBottom: 6, cursor: 'pointer',
    fontSize: compact ? 11 : 13, color: c.fg,
    opacity: task.status === 'fatta' ? 0.5 : 1,
    textDecoration: task.status === 'fatta' ? 'line-through' : 'none',
  }}>
    <div style={{ fontWeight: 600 }}>{icon} {task.title}</div>
    {!compact && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
      {task.due_time?.substring(0, 5) || ''} · {assigneeLabel}
    </div>}
    {compact && <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{assigneeLabel}</div>}
  </div>
}

// ─── Lista task ───────────────────────────────────────────────────
function ListView({ tasks, employees, onEdit, onDispatch, onDelete }) {
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  const filtered = tasks.filter(t => {
    if (filterStatus && t.status !== filterStatus) return false
    if (filterPriority && t.priority !== filterPriority) return false
    return true
  })

  return <div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={iS}>
        <option value="">Tutti gli stati</option>
        {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={iS}>
        <option value="">Tutte priorità</option>
        <option value="bassa">Bassa</option><option value="media">Media</option>
        <option value="alta">Alta</option><option value="urgente">Urgente</option>
      </select>
    </div>

    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>
          <th style={S.th}>Data</th><th style={S.th}>Titolo</th>
          <th style={S.th}>Tipo</th><th style={S.th}>Priorità</th>
          <th style={S.th}>Assegnata</th><th style={S.th}>Stato</th>
          <th style={S.th}>Azioni</th>
        </tr></thead>
        <tbody>
          {filtered.map(t => {
            const c = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.media
            const assigneeLabel = t.assignment_kind === 'team' ? 'TEAM' :
              t.assignment_kind === 'roles' ? (t.assigned_roles || []).join(', ') :
              (t.assigned_employee_ids || []).map(id => (employees.find(e => e.id === id)?.nome || '?')).join(', ')
            return <tr key={t.id}>
              <td style={S.td}>{t.due_date} {t.due_time?.substring(0, 5) || ''}</td>
              <td style={S.td}><strong>{t.title}</strong></td>
              <td style={S.td}>{t.type === 'production' ? '🔪 Produzione' : '📌 Generica'}</td>
              <td style={S.td}><span style={{ ...S.badge(c.fg, c.bg) }}>{t.priority}</span></td>
              <td style={S.td}>{assigneeLabel}</td>
              <td style={S.td}>{STATUS_LABEL[t.status]}</td>
              <td style={S.td}>
                <button onClick={() => onEdit(t)} style={btnSm}>✏️</button>{' '}
                <button onClick={() => onDispatch(t)} style={btnSm}>↪</button>{' '}
                <button onClick={() => onDelete(t.id)} style={btnSm}>🗑</button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    {filtered.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>Nessuna task</div>}
  </div>
}

// ─── Lista template ricorrenti ────────────────────────────────────
function TemplatesView({ templates, onEdit, onDelete }) {
  return <div>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>
          <th style={S.th}>Titolo</th><th style={S.th}>Ricorrenza</th>
          <th style={S.th}>Tipo</th><th style={S.th}>Locale</th>
          <th style={S.th}>Foto</th><th style={S.th}>Attivo</th>
          <th style={S.th}>Azioni</th>
        </tr></thead>
        <tbody>
          {templates.map(t => <tr key={t.id}>
            <td style={S.td}><strong>{t.title}</strong></td>
            <td style={S.td}>{RECURRENCE_LABEL[t.recurrence]}</td>
            <td style={S.td}>{t.type === 'production' ? '🔪 Produzione' : '📌 Generica'}</td>
            <td style={S.td}>{t.locale || '—'}</td>
            <td style={S.td}>{t.requires_photo ? '📷' : '—'}</td>
            <td style={S.td}>{t.active ? '✅' : '⏸'}</td>
            <td style={S.td}>
              <button onClick={() => onEdit(t)} style={btnSm}>✏️</button>{' '}
              <button onClick={() => onDelete(t.id)} style={btnSm}>🗑</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {templates.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>Nessun template ricorrente</div>}
  </div>
}

// ─── Editor task one-shot ─────────────────────────────────────────
function TaskEditor({ task, employees, sps, onClose, onSaved }) {
  const [f, setF] = useState({
    title: task.title || '',
    description: task.description || '',
    instructions: task.instructions || '',
    type: task.type || 'generic',
    priority: task.priority || 'media',
    due_date: task.due_date || new Date().toISOString().split('T')[0],
    due_time: task.due_time || '',
    duration_min: task.duration_min || '',
    locale: task.locale || (sps[0]?.description || ''),
    sub_location: task.sub_location || 'principale',
    assignment_kind: task.assignment_kind || 'persons',
    assigned_employee_ids: task.assigned_employee_ids || [],
    assigned_roles: task.assigned_roles || [],
    production_recipe_id: task.production_recipe_id || null,
    production_qty: task.production_qty || '',
    production_unit: task.production_unit || '',
    requires_photo: task.requires_photo || false,
    status: task.status || 'da_fare',
  })
  const [recipes, setRecipes] = useState([])
  useEffect(() => {
    if (f.type === 'production' && recipes.length === 0) {
      supabase.from('recipes').select('id,nome_prodotto,reparto').order('nome_prodotto').limit(500).then(({ data }) => setRecipes(data || []))
    }
  }, [f.type, recipes.length])

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      ...f,
      user_id: user.id,
      due_time: f.due_time || null,
      duration_min: f.duration_min ? Number(f.duration_min) : null,
      production_recipe_id: f.production_recipe_id || null,
      production_qty: f.production_qty ? Number(f.production_qty) : null,
      assigned_by_id: null, // dashboard = direzione
    }
    if (task.id) {
      await supabase.from('tasks').update(payload).eq('id', task.id)
    } else {
      await supabase.from('tasks').insert(payload)
    }
    onSaved()
  }

  return <Modal title={task.id ? '✏️ Modifica task' : '+ Nuova task'} onClose={onClose} onSave={save}>
    <Field label="Titolo *"><input style={iS} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}/></Field>
    <Field label="Tipo">
      <select style={iS} value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
        <option value="generic">📌 Generica</option><option value="production">🔪 Produzione</option>
      </select>
    </Field>
    {f.type === 'production' && <>
      <Field label="Ricetta">
        <select style={iS} value={f.production_recipe_id || ''} onChange={e => setF({ ...f, production_recipe_id: e.target.value || null })}>
          <option value="">— scegli —</option>
          {recipes.map(r => <option key={r.id} value={r.id}>{r.nome_prodotto}</option>)}
        </select>
      </Field>
      <Field label="Quantità + UM">
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={iS} placeholder="Quantità" value={f.production_qty} onChange={e => setF({ ...f, production_qty: e.target.value })}/>
          <input style={iS} placeholder="UM (PZ/KG/LT)" value={f.production_unit} onChange={e => setF({ ...f, production_unit: e.target.value })}/>
        </div>
      </Field>
    </>}
    <Field label="Descrizione"><textarea style={{ ...iS, minHeight: 60 }} value={f.description} onChange={e => setF({ ...f, description: e.target.value })}/></Field>
    <Field label="Istruzioni (come si fa)"><textarea style={{ ...iS, minHeight: 100 }} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })}/></Field>
    <Field label="Locale">
      <select style={iS} value={f.locale} onChange={e => setF({ ...f, locale: e.target.value })}>
        {sps.map(s => <option key={s.id} value={s.description}>{s.description}</option>)}
      </select>
    </Field>
    <Field label="Data + ora">
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="date" style={iS} value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })}/>
        <input type="time" style={iS} value={f.due_time} onChange={e => setF({ ...f, due_time: e.target.value })}/>
        <input style={iS} placeholder="Min" value={f.duration_min} onChange={e => setF({ ...f, duration_min: e.target.value })}/>
      </div>
    </Field>
    <Field label="Priorità">
      <select style={iS} value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>
        <option value="bassa">Bassa</option><option value="media">Media</option>
        <option value="alta">Alta</option><option value="urgente">Urgente</option>
      </select>
    </Field>
    <Field label="Assegnata a">
      <select style={iS} value={f.assignment_kind} onChange={e => setF({ ...f, assignment_kind: e.target.value })}>
        <option value="persons">Persone specifiche</option>
        <option value="team">Tutto il team del locale</option>
        <option value="roles">Per ruolo</option>
      </select>
    </Field>
    {f.assignment_kind === 'persons' && <Field label="Dipendenti">
      <select multiple style={{ ...iS, minHeight: 100 }} value={f.assigned_employee_ids} onChange={e => {
        const sel = Array.from(e.target.selectedOptions, o => o.value)
        setF({ ...f, assigned_employee_ids: sel })
      }}>
        {employees.filter(e => !f.locale || (e.locale || '').includes(f.locale)).map(e => <option key={e.id} value={e.id}>{e.nome} {e.ruolo ? '· ' + e.ruolo : ''}</option>)}
      </select>
    </Field>}
    {f.assignment_kind === 'roles' && <Field label="Ruoli (separati da virgola, es. cuoco, barista)">
      <input style={iS} value={(f.assigned_roles || []).join(', ')} onChange={e => setF({ ...f, assigned_roles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}/>
    </Field>}
    <Field label="">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)' }}>
        <input type="checkbox" checked={f.requires_photo} onChange={e => setF({ ...f, requires_photo: e.target.checked })}/>
        📷 Foto obbligatoria al completamento
      </label>
    </Field>
  </Modal>
}

// ─── Editor template ricorrente ───────────────────────────────────
function TemplateEditor({ tpl, employees, sps, onClose, onSaved }) {
  const [f, setF] = useState({
    title: tpl.title || '',
    description: tpl.description || '',
    instructions: tpl.instructions || '',
    type: tpl.type || 'generic',
    priority: tpl.priority || 'media',
    recurrence: tpl.recurrence || 'weekly',
    days_of_week: tpl.days_of_week || [],
    day_of_month: tpl.day_of_month || 1,
    default_time: tpl.default_time || '',
    default_duration_min: tpl.default_duration_min || '',
    locale: tpl.locale || (sps[0]?.description || ''),
    sub_location: tpl.sub_location || 'principale',
    assignment_kind: tpl.assignment_kind || 'team',
    assigned_employee_ids: tpl.assigned_employee_ids || [],
    assigned_roles: tpl.assigned_roles || [],
    production_recipe_id: tpl.production_recipe_id || null,
    production_qty: tpl.production_qty || '',
    production_unit: tpl.production_unit || '',
    requires_photo: tpl.requires_photo || false,
    active: tpl.active !== undefined ? tpl.active : true,
  })

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      ...f, user_id: user.id,
      default_time: f.default_time || null,
      default_duration_min: f.default_duration_min ? Number(f.default_duration_min) : null,
      production_recipe_id: f.production_recipe_id || null,
      production_qty: f.production_qty ? Number(f.production_qty) : null,
    }
    if (tpl.id) await supabase.from('task_templates').update(payload).eq('id', tpl.id)
    else await supabase.from('task_templates').insert(payload)
    onSaved()
  }

  return <Modal title={tpl.id ? '✏️ Modifica template ricorrente' : '+ Nuovo template ricorrente'} onClose={onClose} onSave={save}>
    <Field label="Titolo *"><input style={iS} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}/></Field>
    <Field label="Tipo">
      <select style={iS} value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
        <option value="generic">📌 Generica</option><option value="production">🔪 Produzione</option>
      </select>
    </Field>
    <Field label="Istruzioni"><textarea style={{ ...iS, minHeight: 80 }} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })}/></Field>
    <Field label="Ricorrenza">
      <select style={iS} value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })}>
        {Object.entries(RECURRENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
    {(f.recurrence === 'weekly' || f.recurrence === 'biweekly') && <Field label="Giorni settimana">
      <div style={{ display: 'flex', gap: 6 }}>
        {[1,2,3,4,5,6,0].map(dow => <button key={dow} type="button" onClick={() => {
          const set = new Set(f.days_of_week); if (set.has(dow)) set.delete(dow); else set.add(dow)
          setF({ ...f, days_of_week: Array.from(set) })
        }} style={{
          padding: '6px 10px', fontSize: 12, borderRadius: 'var(--radius-control)',
          border: '1px solid var(--border)', cursor: 'pointer',
          background: f.days_of_week.includes(dow) ? 'var(--text)' : 'transparent',
          color: f.days_of_week.includes(dow) ? 'var(--surface)' : 'var(--text2)',
        }}>{DAY_NAMES[dow]}</button>)}
      </div>
    </Field>}
    {f.recurrence === 'monthly' && <Field label="Giorno del mese">
      <input type="number" min="1" max="28" style={iS} value={f.day_of_month} onChange={e => setF({ ...f, day_of_month: Number(e.target.value) })}/>
    </Field>}
    <Field label="Ora preferita + durata">
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="time" style={iS} value={f.default_time} onChange={e => setF({ ...f, default_time: e.target.value })}/>
        <input style={iS} placeholder="Min" value={f.default_duration_min} onChange={e => setF({ ...f, default_duration_min: e.target.value })}/>
      </div>
    </Field>
    <Field label="Locale">
      <select style={iS} value={f.locale} onChange={e => setF({ ...f, locale: e.target.value })}>
        {sps.map(s => <option key={s.id} value={s.description}>{s.description}</option>)}
      </select>
    </Field>
    <Field label="Priorità">
      <select style={iS} value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>
        <option value="bassa">Bassa</option><option value="media">Media</option>
        <option value="alta">Alta</option><option value="urgente">Urgente</option>
      </select>
    </Field>
    <Field label="Assegnata a">
      <select style={iS} value={f.assignment_kind} onChange={e => setF({ ...f, assignment_kind: e.target.value })}>
        <option value="team">Team del locale</option>
        <option value="roles">Per ruolo</option>
        <option value="persons">Persone specifiche</option>
      </select>
    </Field>
    {f.assignment_kind === 'roles' && <Field label="Ruoli (es. cuoco, barista)">
      <input style={iS} value={(f.assigned_roles || []).join(', ')} onChange={e => setF({ ...f, assigned_roles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}/>
    </Field>}
    {f.assignment_kind === 'persons' && <Field label="Dipendenti">
      <select multiple style={{ ...iS, minHeight: 100 }} value={f.assigned_employee_ids} onChange={e => {
        const sel = Array.from(e.target.selectedOptions, o => o.value)
        setF({ ...f, assigned_employee_ids: sel })
      }}>
        {employees.filter(emp => !f.locale || (emp.locale || '').includes(f.locale)).map(emp => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
      </select>
    </Field>}
    <Field label="">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={f.requires_photo} onChange={e => setF({ ...f, requires_photo: e.target.checked })}/>
        📷 Foto obbligatoria al completamento
      </label>
    </Field>
    <Field label="">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })}/>
        Template attivo (genera istanze automaticamente)
      </label>
    </Field>
  </Modal>
}

// ─── Modal smistamento ────────────────────────────────────────────
function DispatchModal({ task, employees, onClose, onDone }) {
  const [selected, setSelected] = useState([])
  const eligible = employees.filter(e => !task.locale || (e.locale || '').includes(task.locale))
  const dispatch = async () => {
    if (selected.length === 0) return alert('Seleziona almeno un dipendente')
    const { data: { user } } = await supabase.auth.getUser()
    // Crea N task figlie
    const rows = selected.map(empId => ({
      user_id: user.id, locale: task.locale, sub_location: task.sub_location,
      title: task.title, description: task.description, instructions: task.instructions,
      type: task.type, priority: task.priority, status: 'da_fare',
      assignment_kind: 'persons', assigned_employee_ids: [empId],
      due_date: task.due_date, due_time: task.due_time, duration_min: task.duration_min,
      parent_task_id: task.id,
      production_recipe_id: task.production_recipe_id, production_qty: task.production_qty,
      production_unit: task.production_unit, requires_photo: task.requires_photo,
    }))
    await supabase.from('tasks').insert(rows)
    await supabase.from('tasks').update({ status: 'delegata' }).eq('id', task.id)
    onDone()
  }
  return <Modal title={'↪ Smista: ' + task.title} onClose={onClose} onSave={dispatch} saveLabel="Smista">
    <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
      Crea N task figlie, una per ogni dipendente selezionato. La task originale viene marcata come "delegata".
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
      {eligible.map(e => <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 10px', borderRadius: 6, background: selected.includes(e.id) ? 'var(--blue-bg)' : 'transparent', cursor: 'pointer' }}>
        <input type="checkbox" checked={selected.includes(e.id)} onChange={ev => {
          setSelected(s => ev.target.checked ? [...s, e.id] : s.filter(x => x !== e.id))
        }}/>
        {e.nome} {e.ruolo ? '· ' + e.ruolo : ''}
      </label>)}
    </div>
  </Modal>
}

// ─── Helpers ──────────────────────────────────────────────────────
function Modal({ title, children, onClose, onSave, saveLabel = 'Salva' }) {
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 600, width: '90%', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{title}</h3>
        <button onClick={onClose} style={{ ...btnSecondary, padding: '4px 10px' }}>✕</button>
      </div>
      <div>{children}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <button onClick={onClose} style={btnSecondary}>Annulla</button>
        <button onClick={onSave} style={btnPrimary}>{saveLabel}</button>
      </div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>}
    {children}
  </div>
}

const btnPrimary = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 'var(--radius-control)', cursor: 'pointer' }
const btnSecondary = { padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)', cursor: 'pointer' }
const btnSm = { padding: '4px 8px', fontSize: 12, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }
