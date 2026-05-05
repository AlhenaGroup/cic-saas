// Pannello /timbra: Calendario task + dettaglio + completamento + (per chi ha permesso) creazione/smistamento.
// Mobile-first, full-screen sullo schermo.

import { useState, useEffect, useCallback } from 'react'

const PRIORITY_COLORS = {
  bassa:   { bg: 'rgba(148,163,184,.18)', fg: '#64748B', border: '#94a3b8' },
  media:   { bg: 'rgba(41,82,204,.18)',   fg: '#2952CC', border: '#2952CC' },
  alta:    { bg: 'rgba(245,158,11,.18)',  fg: '#B45309', border: '#F59E0B' },
  urgente: { bg: 'rgba(239,68,68,.18)',   fg: '#DC2626', border: '#EF4444' },
}

const STATUS_LABEL = {
  da_fare: 'Da fare', in_corso: 'In corso', fatta: 'Fatta',
  saltata: 'Saltata', scaduta: 'Scaduta', delegata: 'Delegata',
}

async function api(payload) {
  const r = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  return r.json()
}

export default function TaskCalendarPanel({ pin, employee, permissions, onBack }) {
  const canCreate = !!permissions?.task_create
  const canDispatch = !!permissions?.task_dispatch

  const [view, setView] = useState('calendar') // calendar | detail | create | dispatch
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('mine') // mine | subordinates
  const [selected, setSelected] = useState(null)
  const [fromDate] = useState(() => new Date().toISOString().split('T')[0])
  const [toDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0] })

  const load = useCallback(async () => {
    setLoading(true)
    const out = await api({ action: 'list', pin, from: fromDate, to: toDate, scope: scope === 'subordinates' ? 'subordinates' : null })
    setTasks(out.tasks || [])
    setLoading(false)
  }, [pin, fromDate, toDate, scope])
  useEffect(() => { load() }, [load])

  // Raggruppa per data
  const grouped = tasks.reduce((acc, t) => {
    (acc[t.due_date] = acc[t.due_date] || []).push(t)
    return acc
  }, {})
  const dates = Object.keys(grouped).sort()

  if (view === 'detail' && selected) {
    return <TaskDetail pin={pin} task={selected} onBack={() => { setView('calendar'); setSelected(null); load() }} canDispatch={canDispatch} onDispatch={() => setView('dispatch')}/>
  }
  if (view === 'create') {
    return <TaskCreate pin={pin} onBack={() => { setView('calendar'); load() }}/>
  }
  if (view === 'dispatch' && selected) {
    return <TaskDispatch pin={pin} task={selected} onBack={() => { setView('detail') }} onDone={() => { setView('calendar'); setSelected(null); load() }}/>
  }

  return <div style={{ maxWidth: 480, width: '100%', padding: '0 12px' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 14, marginBottom: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Calendario task</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{employee.nome}</div>
    </div>

    {(canCreate || canDispatch) && <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
      <button onClick={() => setScope('mine')} style={tabBtn(scope === 'mine')}>Mie / Team</button>
      <button onClick={() => setScope('subordinates')} style={tabBtn(scope === 'subordinates')}>Sottoposti</button>
    </div>}

    {canCreate && <button onClick={() => setView('create')} style={btnPrimary}>+ Nuova task</button>}

    {loading && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Caricamento…</div>}

    {!loading && dates.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      Nessuna task nei prossimi 30 giorni.
    </div>}

    {!loading && dates.map(d => {
      const dt = new Date(d)
      const isToday = d === new Date().toISOString().split('T')[0]
      const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const isTomorrow = d === tomorrowDate.toISOString().split('T')[0]
      const dayLabel = isToday ? 'OGGI' : isTomorrow ? 'DOMANI' :
        dt.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'short' }).toUpperCase()
      return <div key={d} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: isToday ? '#F59E0B' : '#94a3b8', fontWeight: 700, letterSpacing: '.05em', marginBottom: 8, padding: '0 4px' }}>
          {dayLabel}
        </div>
        {grouped[d].map(t => <TaskListItem key={t.id} task={t} onClick={() => { setSelected(t); setView('detail') }}/>)}
      </div>
    })}

    <button onClick={onBack} style={btnBack}>Indietro</button>
  </div>
}

function TaskListItem({ task, onClick }) {
  const c = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.media
  const isDone = task.status === 'fatta'
  const icon = task.type === 'production' ? '' : ''
  return <button onClick={onClick} style={{
    display: 'block', width: '100%', textAlign: 'left',
    background: '#1a1f2e', border: '1px solid #2a3042', borderLeft: '4px solid ' + c.border,
    borderRadius: 10, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', color: '#e2e8f0',
    opacity: isDone ? 0.55 : 1,
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, textDecoration: isDone ? 'line-through' : 'none' }}>
          {icon} {task.title}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
          {task.due_time?.substring(0, 5) || '—'}
          {task.duration_min ? ` · ${task.duration_min}'` : ''}
          {' · '}
          {task.assignment_kind === 'team' ? 'TEAM' : task.assignment_kind === 'roles' ? 'RUOLI' : 'PERSONA'}
          {task.requires_photo ? ' · ' : ''}
        </div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, textTransform: 'uppercase' }}>
        {task.priority}
      </span>
    </div>
    <div style={{ marginTop: 6, fontSize: 11, color: isDone ? '#10B981' : '#94a3b8' }}>{STATUS_LABEL[task.status]}</div>
  </button>
}

// ─── DETTAGLIO + COMPLETAMENTO ─────────────────────────────────────
function TaskDetail({ pin, task, onBack, canDispatch, onDispatch }) {
  const [t, setT] = useState(task)
  const [recipe, setRecipe] = useState(null)
  const [subTasks, setSubTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [notes, setNotes] = useState('')
  const [photoData, setPhotoData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api({ action: 'detail', pin, task_id: task.id }).then(out => {
      if (out.task) setT(out.task)
      if (out.recipe) setRecipe(out.recipe)
      if (out.sub_tasks) setSubTasks(out.sub_tasks)
      setLoading(false)
    })
  }, [pin, task.id])

  const handlePhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const r = new FileReader()
    r.onload = () => setPhotoData(r.result)
    r.readAsDataURL(file)
  }

  const handleStart = async () => {
    await api({ action: 'start', pin, task_id: t.id })
    setT({ ...t, status: 'in_corso' })
  }

  const handleComplete = async () => {
    setError('')
    if (t.requires_photo && !photoData) {
      setError('Foto obbligatoria per questa task'); return
    }
    setCompleting(true)
    const out = await api({ action: 'complete', pin, task_id: t.id, notes, photo_base64: photoData })
    setCompleting(false)
    if (out.error) { setError(out.error); return }
    onBack()
  }

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Caricamento…</div>

  const c = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.media
  const isDone = t.status === 'fatta'
  const isDelegata = t.status === 'delegata'

  return <div style={{ maxWidth: 480, width: '100%', padding: '0 12px' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 16, marginBottom: 12, borderLeft: '4px solid ' + c.border }}>
      <div style={{ fontSize: 11, color: c.fg, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{t.priority}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
        {t.type === 'production' ? '' : ''} {t.title}
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>
        {t.due_date} {t.due_time?.substring(0, 5) || ''}
        {t.duration_min ? ` · ${t.duration_min} min stimati` : ''}
        {t.locale ? ` · ${t.locale}` : ''}
      </div>
    </div>

    {t.description && <Block title="Descrizione">{t.description}</Block>}
    {t.instructions && <Block title="Istruzioni">{t.instructions}</Block>}

    {t.type === 'production' && recipe && <Block title="Produzione">
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <strong>{recipe.nome_prodotto}</strong> {t.production_qty ? `· ${t.production_qty}${t.production_unit || ''}` : ''}
      </div>
      {Array.isArray(recipe.ingredienti) && recipe.ingredienti.length > 0 && <div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>INGREDIENTI</div>
        {recipe.ingredienti.map((ing, i) => <div key={i} style={{ fontSize: 12, color: '#e2e8f0', padding: '4px 0', borderBottom: '1px solid #2a3042' }}>
          • {ing.quantita} {ing.unita} {ing.nome_articolo}
        </div>)}
      </div>}
    </Block>}

    {isDelegata && subTasks.length > 0 && <Block title="Smistata a">
      {subTasks.map(s => <div key={s.id} style={{ fontSize: 12, padding: '6px 0', color: '#e2e8f0' }}>
        • {STATUS_LABEL[s.status]} {s.completed_at ? `· ${new Date(s.completed_at).toLocaleString('it-IT')}` : ''}
      </div>)}
    </Block>}

    {!isDone && !isDelegata && <>
      {t.status === 'da_fare' && <button onClick={handleStart} style={btnSecondary}>Avvia</button>}

      <Block title={t.requires_photo ? 'Foto obbligatoria' : 'Foto (opzionale)'}>
        <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'block', marginBottom: 8 }}/>
        {photoData && <img src={photoData} alt="anteprima" style={{ maxWidth: '100%', borderRadius: 8 }}/>}
      </Block>

      <Block title="Note">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', minHeight: 60, background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, padding: 10, color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit' }}/>
      </Block>

      {error && <div style={{ background: 'rgba(239,68,68,.15)', color: '#EF4444', padding: '10px 14px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>{error}</div>}

      <button onClick={handleComplete} disabled={completing} style={btnPrimary}>
        {completing ? 'Completamento…' : 'Fatto'}
      </button>

      {canDispatch && <button onClick={onDispatch} style={btnSecondary}>Smista a sottoposti</button>}
    </>}

    {isDone && <div style={{ background: 'rgba(16,185,129,.15)', color: '#10B981', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 10 }}>
      Completata il {new Date(t.completed_at).toLocaleString('it-IT')}
      {t.completion_notes && <div style={{ marginTop: 6, color: '#94a3b8', fontStyle: 'italic' }}>"{t.completion_notes}"</div>}
      {t.completion_photo_url && <img src={t.completion_photo_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8 }}/>}
    </div>}

    <button onClick={onBack} style={btnBack}>Indietro</button>
  </div>
}

// ─── CREAZIONE ─────────────────────────────────────────────────────
function TaskCreate({ pin, onBack }) {
  const [subordinates, setSubordinates] = useState([])
  const [recipes, setRecipes] = useState([])
  const [knowledge, setKnowledge] = useState([])
  const [usedKnowledgeId, setUsedKnowledgeId] = useState(null)
  const [f, setF] = useState({
    title: '', description: '', instructions: '',
    type: 'generic', priority: 'media',
    due_date: new Date().toISOString().split('T')[0], due_time: '',
    assignment_kind: 'team', assigned_employee_ids: [],
    requires_photo: false,
    production_recipe_id: null, production_qty: '', production_unit: '',
    duration_min: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api({ action: 'subordinates', pin }).then(o => setSubordinates(o.subordinates || []))
    api({ action: 'knowledge_list', pin }).then(o => setKnowledge(o.knowledge || []))
  }, [pin])
  useEffect(() => {
    if (f.type === 'production' && recipes.length === 0) {
      api({ action: 'recipes', pin }).then(o => setRecipes(o.recipes || []))
    }
  }, [f.type, pin, recipes.length])

  const loadKnowledge = (id) => {
    const k = knowledge.find(x => String(x.id) === String(id))
    if (!k) return
    setF(prev => ({
      ...prev,
      title: k.title,
      description: k.description || '',
      instructions: k.instructions || '',
      type: k.type || 'generic',
      priority: k.default_priority || 'media',
      duration_min: k.default_duration_min || '',
      requires_photo: !!k.requires_photo,
      production_recipe_id: k.production_recipe_id || null,
      production_qty: k.production_qty || '',
      production_unit: k.production_unit || '',
    }))
    setUsedKnowledgeId(k.id)
  }

  const save = async () => {
    if (!f.title.trim()) return setError('Titolo obbligatorio')
    setSaving(true); setError('')
    const out = await api({ action: 'create', pin, task: {
      ...f,
      duration_min: f.duration_min ? Number(f.duration_min) : null,
      production_qty: f.production_qty ? Number(f.production_qty) : null,
    }})
    setSaving(false)
    if (out.error) return setError(out.error)
    if (usedKnowledgeId) await api({ action: 'knowledge_use', pin, knowledge_id: usedKnowledgeId })
    onBack()
  }

  return <div style={{ maxWidth: 480, width: '100%', padding: '0 12px' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 14, marginBottom: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>+ Nuova task</div>
    </div>

    {knowledge.length > 0 && <Field label="Carica da modello (autocompila)">
      <select style={inp} value={usedKnowledgeId || ''} onChange={e => loadKnowledge(e.target.value)}>
        <option value="">— scegli un modello pre-compilato —</option>
        {knowledge.map(k => <option key={k.id} value={k.id}>
          {k.type === 'production' ? '' : ''} {k.title}{k.usage_count ? ` (×${k.usage_count})` : ''}
        </option>)}
      </select>
    </Field>}

    <Field label="Titolo *"><input style={inp} value={f.title} onChange={e => setF({ ...f, title: e.target.value })}/></Field>
    <Field label="Tipo">
      <select style={inp} value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
        <option value="generic">Generica</option><option value="production">Produzione</option>
      </select>
    </Field>
    {f.type === 'production' && <>
      <Field label="Ricetta">
        <select style={inp} value={f.production_recipe_id || ''} onChange={e => setF({ ...f, production_recipe_id: e.target.value || null })}>
          <option value="">— scegli —</option>
          {recipes.map(r => <option key={r.id} value={r.id}>{r.nome_prodotto}</option>)}
        </select>
      </Field>
      <Field label="Quantità + UM">
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={inp} placeholder="Qta" value={f.production_qty} onChange={e => setF({ ...f, production_qty: e.target.value })}/>
          <input style={inp} placeholder="UM" value={f.production_unit} onChange={e => setF({ ...f, production_unit: e.target.value })}/>
        </div>
      </Field>
    </>}
    <Field label="Istruzioni"><textarea style={{ ...inp, minHeight: 80 }} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })}/></Field>
    <Field label="Data + ora">
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="date" style={inp} value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })}/>
        <input type="time" style={inp} value={f.due_time} onChange={e => setF({ ...f, due_time: e.target.value })}/>
      </div>
    </Field>
    <Field label="Priorità">
      <select style={inp} value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>
        <option value="bassa">Bassa</option><option value="media">Media</option>
        <option value="alta">Alta</option><option value="urgente">Urgente</option>
      </select>
    </Field>
    <Field label="Assegnata a">
      <select style={inp} value={f.assignment_kind} onChange={e => setF({ ...f, assignment_kind: e.target.value })}>
        <option value="team">Team del locale</option>
        <option value="persons">Persona/e specifica/e</option>
      </select>
    </Field>
    {f.assignment_kind === 'persons' && <Field label="Sottoposti">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {subordinates.map(s => <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', padding: '6px 8px', background: f.assigned_employee_ids.includes(s.id) ? '#2a3042' : 'transparent', borderRadius: 6 }}>
          <input type="checkbox" checked={f.assigned_employee_ids.includes(s.id)} onChange={e => {
            setF(prev => ({ ...prev, assigned_employee_ids: e.target.checked ? [...prev.assigned_employee_ids, s.id] : prev.assigned_employee_ids.filter(x => x !== s.id) }))
          }}/>
          {s.nome} {s.role ? '· ' + s.role : ''}
        </label>)}
        {subordinates.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Nessun sottoposto configurato</div>}
      </div>
    </Field>}
    <Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0' }}>
        <input type="checkbox" checked={f.requires_photo} onChange={e => setF({ ...f, requires_photo: e.target.checked })}/>
        Foto obbligatoria al completamento
      </label>
    </Field>

    {error && <div style={{ background: 'rgba(239,68,68,.15)', color: '#EF4444', padding: '10px 14px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>{error}</div>}

    <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? 'Salvataggio…' : 'Crea'}</button>
    <button onClick={onBack} style={btnBack}>Annulla</button>
  </div>
}

// ─── SMISTAMENTO ───────────────────────────────────────────────────
function TaskDispatch({ pin, task, onBack, onDone }) {
  const [subordinates, setSubordinates] = useState([])
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api({ action: 'subordinates', pin }).then(o => setSubordinates(o.subordinates || []))
  }, [pin])

  const send = async () => {
    if (selected.length === 0) return setError('Seleziona almeno un sottoposto')
    setSaving(true)
    const out = await api({ action: 'dispatch', pin, task_id: task.id, employee_ids: selected })
    setSaving(false)
    if (out.error) return setError(out.error)
    onDone()
  }

  return <div style={{ maxWidth: 480, width: '100%', padding: '0 12px' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Smista task</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{task.title}</div>
    </div>

    <Field label="Seleziona sottoposti">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {subordinates.map(s => <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', padding: '8px 10px', background: selected.includes(s.id) ? '#2a3042' : '#1a1f2e', borderRadius: 8, border: '1px solid #2a3042' }}>
          <input type="checkbox" checked={selected.includes(s.id)} onChange={e => {
            setSelected(prev => e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id))
          }}/>
          {s.nome} {s.role ? '· ' + s.role : ''}
        </label>)}
        {subordinates.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Nessun sottoposto configurato per il tuo profilo</div>}
      </div>
    </Field>

    {error && <div style={{ background: 'rgba(239,68,68,.15)', color: '#EF4444', padding: '10px 14px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>{error}</div>}

    <button onClick={send} disabled={saving || selected.length === 0} style={btnPrimary}>
      {saving ? 'Smistamento…' : `Smista a ${selected.length} dipendente${selected.length !== 1 ? 'i' : ''}`}
    </button>
    <button onClick={onBack} style={btnBack}>Indietro</button>
  </div>
}

// ─── helpers ───────────────────────────────────────────────────────
function Block({ title, children }) {
  return <div style={{ background: '#1a1f2e', borderRadius: 10, padding: 14, marginBottom: 10 }}>
    <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: '.05em' }}>{title}</div>
    <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{children}</div>
  </div>
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>}
    {children}
  </div>
}

const inp = { width: '100%', padding: '10px 12px', fontSize: 14, background: '#0f1420', color: '#e2e8f0', border: '1px solid #2a3042', borderRadius: 8, fontFamily: 'inherit', outline: 'none' }
const btnPrimary = { display: 'block', width: '100%', padding: '14px', fontSize: 15, fontWeight: 700, background: '#10B981', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', marginBottom: 8 }
const btnSecondary = { display: 'block', width: '100%', padding: '12px', fontSize: 14, fontWeight: 600, background: 'transparent', color: '#e2e8f0', border: '1px solid #2a3042', borderRadius: 10, cursor: 'pointer', marginBottom: 8 }
const btnBack = { display: 'block', width: '100%', padding: '10px', fontSize: 13, background: 'transparent', color: '#64748b', border: '1px solid #2a3042', borderRadius: 8, cursor: 'pointer', marginTop: 12 }
const tabBtn = (active) => ({ flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 600, background: active ? '#F59E0B' : '#1a1f2e', color: active ? '#0f1420' : '#94a3b8', border: '1px solid ' + (active ? '#F59E0B' : '#2a3042'), borderRadius: 8, cursor: 'pointer' })
