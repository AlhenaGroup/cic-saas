// Widget Task per la Panoramica.
// Mostra il riepilogo task attive raggruppate per stato:
//   - Da fare oggi · scadute · in ritardo · per dipendente top
// Click → modale fullscreen con la lista dettagliata.
//
// Configurazione (settings persistiti in localStorage):
//   - period: 'oggi' | 'settimana'           (default 'oggi')
//   - locali:  array nomi locale | null      (default null = tutti)
//   - tipo: 'tutti' | 'compito' | 'problema' | 'scadenza'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S } from './shared/styles.jsx'

const STORAGE_KEY = 'cic_widget_task_cfg'

function loadCfg() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveCfg(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)) } catch {}
}

const STATUS_LABEL = { da_fare: 'Da fare', in_corso: 'In corso', fatta: 'Fatta', saltata: 'Saltata', scaduta: 'Scaduta', delegata: 'Delegata' }
const STATUS_COLOR = { da_fare: '#3B82F6', in_corso: '#F59E0B', fatta: '#10B981', saltata: 'var(--text3)', scaduta: '#EF4444', delegata: '#8B5CF6' }
const TIPO_COLOR = { compito: '#3B82F6', problema: '#EF4444', scadenza: '#F59E0B' }

function ymd(d) { return d.toISOString().split('T')[0] }
function todayYmd() { return ymd(new Date()) }
function weekStartYmd() {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return ymd(d)
}
function weekEndYmd() {
  const d = new Date(); d.setDate(d.getDate() + (6 - ((d.getDay() + 6) % 7)))
  return ymd(d)
}

export default function TaskWidget({ sps = [] }) {
  const [cfg, setCfg] = useState(() => ({
    period: 'oggi',
    locali: null,
    tipo: 'tutti',
    ...loadCfg(),
  }))
  useEffect(() => { saveCfg(cfg) }, [cfg])

  const [showSettings, setShowSettings] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [openDetail, setOpenDetail] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const localiFiltrati = useMemo(() => {
    const all = (sps || []).map(s => s.description || s.name).filter(Boolean)
    return cfg.locali ? all.filter(l => cfg.locali.includes(l)) : all
  }, [sps, cfg.locali])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      const from = cfg.period === 'oggi' ? todayYmd() : weekStartYmd()
      const to = cfg.period === 'oggi' ? todayYmd() : weekEndYmd()
      let q = supabase.from('tasks').select('*').gte('due_date', from).lte('due_date', to)
      const { data } = await q
      if (cancel) return
      let list = (data || [])
      if (localiFiltrati.length > 0) list = list.filter(t => !t.locale || localiFiltrati.includes(t.locale))
      if (cfg.tipo !== 'tutti') list = list.filter(t => (t.tipo || 'compito') === cfg.tipo)
      setTasks(list)
      const { data: emps } = await supabase.from('employees').select('id,nome,ruolo').eq('stato', 'Attivo')
      if (!cancel) { setEmployees(emps || []); setLoading(false) }
    })()
    return () => { cancel = true }
  }, [cfg.period, cfg.tipo, localiFiltrati.join(','), reloadKey])

  // Aggregati
  const counts = useMemo(() => {
    const today = todayYmd()
    const c = { totale: tasks.length, daFare: 0, inCorso: 0, fatte: 0, scadute: 0, problemi: 0, scadenze: 0 }
    for (const t of tasks) {
      if (t.status === 'fatta') c.fatte++
      else if (t.status === 'in_corso') c.inCorso++
      else if (t.status === 'da_fare') c.daFare++
      // Scaduta: due_date < oggi e non fatta
      if (t.due_date < today && t.status !== 'fatta' && t.status !== 'saltata') c.scadute++
      if (t.tipo === 'problema') c.problemi++
      if (t.tipo === 'scadenza') c.scadenze++
    }
    return c
  }, [tasks])

  const periodLabel = cfg.period === 'oggi' ? 'Oggi' : 'Settimana'
  const periodSub = cfg.period === 'oggi'
    ? new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    : `Da ${new Date(weekStartYmd()+'T12:00:00').toLocaleDateString('it-IT',{day:'numeric',month:'short'})} a ${new Date(weekEndYmd()+'T12:00:00').toLocaleDateString('it-IT',{day:'numeric',month:'short'})}`

  const completionRate = counts.totale > 0 ? Math.round((counts.fatte / counts.totale) * 100) : 0
  const ok = counts.scadute === 0 && counts.problemi === 0

  return <div style={{ ...S.card, gridColumn: 'span 3' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
          Task · {cfg.tipo === 'tutti' ? 'tutte' : cfg.tipo}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2, letterSpacing: '-0.01em' }}>
          {periodLabel}: {counts.fatte}/{counts.totale} completate {counts.totale > 0 && <span style={{ fontSize: 13, color: ok ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginLeft: 6 }}>({completionRate}%)</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, textTransform: 'capitalize' }}>
          {periodSub}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setShowCreate(true)} title="Crea task al volo"
          style={{ background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
          + Nuova
        </button>
        <button onClick={() => setShowSettings(true)} title="Configura widget"
          style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
          Configura
        </button>
      </div>
    </div>

    {loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Caricamento…</div>}

    {!loading && tasks.length === 0 && (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        Nessuna task nel periodo selezionato.
      </div>
    )}

    {!loading && tasks.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
        <CountTile label="Da fare" value={counts.daFare} color="#3B82F6" onClick={() => setOpenDetail({ filter: 'da_fare', tasks: tasks.filter(t => t.status === 'da_fare') })}/>
        <CountTile label="In corso" value={counts.inCorso} color="#F59E0B" onClick={() => setOpenDetail({ filter: 'in_corso', tasks: tasks.filter(t => t.status === 'in_corso') })}/>
        <CountTile label="Scadute" value={counts.scadute} color="#EF4444" onClick={() => {
          const today = todayYmd()
          setOpenDetail({ filter: 'scadute', tasks: tasks.filter(t => t.due_date < today && t.status !== 'fatta' && t.status !== 'saltata') })
        }}/>
        {counts.problemi > 0 && (
          <CountTile label="Problemi" value={counts.problemi} color="#EF4444" onClick={() => setOpenDetail({ filter: 'problema', tasks: tasks.filter(t => t.tipo === 'problema') })}/>
        )}
        {counts.scadenze > 0 && (
          <CountTile label="Scadenze" value={counts.scadenze} color="#F59E0B" onClick={() => setOpenDetail({ filter: 'scadenza', tasks: tasks.filter(t => t.tipo === 'scadenza') })}/>
        )}
        <CountTile label="Fatte" value={counts.fatte} color="#10B981" onClick={() => setOpenDetail({ filter: 'fatta', tasks: tasks.filter(t => t.status === 'fatta') })}/>
      </div>
    )}

    {showSettings && (
      <TaskWidgetSettings cfg={cfg} sps={sps} onSave={(c) => { setCfg(c); setShowSettings(false) }} onClose={() => setShowSettings(false)}/>
    )}

    {openDetail && <TaskDetailModal data={openDetail} employees={employees} onClose={() => setOpenDetail(null)}/>}

    {showCreate && <QuickCreateModal sps={sps} employees={employees}
      onClose={() => setShowCreate(false)}
      onCreated={() => { setShowCreate(false); setReloadKey(k => k + 1) }}/>}
  </div>
}

// Default reparti se l'owner non ne ha personalizzati
const DEFAULT_AREAS = ['Amministrazione', 'Sala', 'Cucina', 'Bar', 'Produzione', 'Magazzino', 'Pulizia', 'Manutenzione', 'Rifiuti', 'Sicurezza', 'Marketing', 'Altro']

// ─── Quick-create modale: task al volo dalla Panoramica ─────────────
function QuickCreateModal({ sps, employees, onClose, onCreated }) {
  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)
  const todayStr = new Date().toISOString().split('T')[0]
  const [f, setF] = useState({
    title: '',
    tipo: 'compito',
    priority: 'media',
    area: '',
    due_date: todayStr,
    due_time: '',
    duration_min: '',
    locale: allLocali[0] || '',
    assignment_kind: 'persons',
    assigned_employee_ids: [],
    assigned_roles: [],
    is_delegable: true,
    requires_photo: false,
    description: '',
    instructions: '',
    is_recurring: false,
    recurrence: 'weekly',
    days_of_week: [],
    day_of_month: 1,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Reparti personalizzati: uniqi tra DEFAULT_AREAS e quelli salvati in user_settings.task_areas
  const [customAreas, setCustomAreas] = useState([])
  const [showAddArea, setShowAddArea] = useState(false)
  const [newAreaText, setNewAreaText] = useState('')
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.from('user_settings').select('task_areas').eq('user_id', user.id).maybeSingle()
      if (error) return // colonna non ancora creata: ignora silenziosamente
      const arr = Array.isArray(data?.task_areas) ? data.task_areas : []
      setCustomAreas(arr.filter(Boolean))
    })()
  }, [])
  const allAreas = useMemo(() => {
    const s = new Set([...DEFAULT_AREAS, ...customAreas])
    return [...s]
  }, [customAreas])

  const addArea = async () => {
    const t = newAreaText.trim()
    if (!t) return
    if (allAreas.some(a => a.toLowerCase() === t.toLowerCase())) {
      setNewAreaText('')
      setShowAddArea(false)
      setF(prev => ({ ...prev, area: t }))
      return
    }
    const next = [...customAreas, t]
    setCustomAreas(next)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // Persistenza su user_settings.task_areas — best-effort: se la colonna non
      // esiste ancora (DDL non applicata) salviamo solo in memoria locale.
      await supabase.from('user_settings').update({ task_areas: next }).eq('user_id', user.id)
    }
    setF(prev => ({ ...prev, area: t }))
    setNewAreaText('')
    setShowAddArea(false)
  }
  const removeArea = async (areaName) => {
    if (!customAreas.includes(areaName)) return // non si può rimuovere un default
    if (!confirm(`Rimuovere il reparto "${areaName}"? (Le task gia' create con questo reparto restano invariate.)`)) return
    const next = customAreas.filter(a => a !== areaName)
    setCustomAreas(next)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // best-effort
      await supabase.from('user_settings').update({ task_areas: next }).eq('user_id', user.id)
    }
    if (f.area === areaName) setF(prev => ({ ...prev, area: '' }))
  }

  // Ruoli disponibili (da employees attivi)
  const rolesAvail = useMemo(() => {
    const s = new Set()
    employees.forEach(e => { if (e.ruolo) s.add(e.ruolo) })
    return [...s].sort()
  }, [employees])

  // Filtra dipendenti per locale selezionato
  const empsForLocale = useMemo(() => {
    if (!f.locale) return employees
    return employees.filter(e => !e.locale || e.locale.split(',').map(x => x.trim()).includes(f.locale))
  }, [employees, f.locale])

  const save = async () => {
    setErr('')
    if (!f.title.trim()) { setErr('Titolo obbligatorio'); return }
    if (f.assignment_kind === 'persons' && f.assigned_employee_ids.length === 0) { setErr('Seleziona almeno un dipendente'); return }
    if (f.assignment_kind === 'roles' && f.assigned_roles.length === 0) { setErr('Seleziona almeno un ruolo'); return }
    if (f.is_recurring && (f.recurrence === 'weekly' || f.recurrence === 'biweekly') && f.days_of_week.length === 0) {
      setErr('Per ricorrenza settimanale seleziona almeno un giorno')
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    // Helper: tenta INSERT, se fallisce con "column X does not exist" (Postgres 42703)
    // riprova rimuovendo le colonne nuove non ancora aggiunte alla tabella.
    const safeInsert = async (table, payload) => {
      let body = { ...payload }
      const optionalCols = ['tipo', 'area', 'is_delegable']
      for (let attempt = 0; attempt < 4; attempt++) {
        const { error } = await supabase.from(table).insert(body)
        if (!error) return
        // Postgres error 42703: undefined column. Estrai nome dalla msg e rimuovilo dal payload.
        if (error.code === '42703' || /column .* does not exist/i.test(error.message || '')) {
          const m = (error.message || '').match(/column "?([a-z_]+)"? does not exist/i)
          const col = m ? m[1] : null
          if (col && col in body) { delete body[col]; continue }
          // Fallback: rimuovi tutte le opzionali e ritenta una volta sola
          let removed = false
          for (const c of optionalCols) { if (c in body) { delete body[c]; removed = true } }
          if (removed) continue
        }
        throw error
      }
      throw new Error('Impossibile inserire: troppe colonne mancanti. Applica la migration SQL hierarchy-tasks.sql.')
    }
    try {
      if (f.is_recurring) {
        await safeInsert('task_templates', {
          user_id: user.id,
          title: f.title.trim(),
          description: f.description || null,
          instructions: f.instructions || null,
          tipo: f.tipo,
          area: f.area || null,
          type: 'generic',
          priority: f.priority,
          recurrence: f.recurrence,
          days_of_week: f.days_of_week,
          day_of_month: f.day_of_month,
          default_time: f.due_time || null,
          default_duration_min: f.duration_min ? Number(f.duration_min) : null,
          locale: f.locale || null,
          sub_location: 'principale',
          assignment_kind: f.assignment_kind,
          assigned_employee_ids: f.assigned_employee_ids,
          assigned_roles: f.assigned_roles,
          requires_photo: f.requires_photo,
          is_delegable: f.is_delegable,
          active: true,
        })
      } else {
        await safeInsert('tasks', {
          user_id: user.id,
          title: f.title.trim(),
          description: f.description || null,
          instructions: f.instructions || null,
          tipo: f.tipo,
          area: f.area || null,
          type: 'generic',
          priority: f.priority,
          due_date: f.due_date,
          due_time: f.due_time || null,
          duration_min: f.duration_min ? Number(f.duration_min) : null,
          locale: f.locale || null,
          sub_location: 'principale',
          assignment_kind: f.assignment_kind,
          assigned_employee_ids: f.assigned_employee_ids,
          assigned_roles: f.assigned_roles,
          requires_photo: f.requires_photo,
          is_delegable: f.is_delegable,
          status: 'da_fare',
          assigned_by_id: null,
        })
      }
      onCreated()
    } catch (e) { setErr(e.message || String(e)); setSaving(false) }
  }

  // Mobile-first: tap target grandi (44px+), input grossi, padding generoso.
  // Su PC stessi controlli ma con maxWidth comodo. Niente densità a 2 colonne:
  // tutto in stack verticale per massima leggibilità su entrambi.
  const inpL = { ...inp, padding: '12px 14px', fontSize: 16, minHeight: 48 }
  const lblL = { ...lbl, fontSize: 12, marginBottom: 6 }
  const tapBtn = (active, color) => ({
    flex: 1, padding: '12px 8px', fontSize: 14, fontWeight: 600,
    border: '2px solid ' + (active ? color : 'var(--border)'),
    background: active ? color + '22' : 'transparent',
    color: active ? color : 'var(--text2)',
    borderRadius: 10, cursor: 'pointer', minHeight: 48,
  })
  return (
    <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', zIndex: 1000, padding: 0, overflow: 'hidden' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 0, maxWidth: 600, width: '100%', boxShadow: 'var(--shadow-md)', height: '100dvh', maxHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, color: 'var(--text)', fontWeight: 700 }}>Nuova task</h3>
          <button onClick={onClose} aria-label="Chiudi"
            style={{ background: 'var(--surface2)', border: 'none', width: 36, height: 36, borderRadius: 18, fontSize: 22, color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Body scrollabile interno (footer e header restano fissi) */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18, flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <Field label="Titolo *">
            <input style={inpL} placeholder='es. "Pulire frigo bar"' value={f.title} onChange={e => setF({ ...f, title: e.target.value })}/>
          </Field>

          <Field label="Categoria">
            <div style={{ display: 'flex', gap: 8 }}>
              {[['compito','Compito','#3B82F6'],['problema','Problema','#EF4444'],['scadenza','Scadenza','#F59E0B']].map(([v,l,c]) => (
                <button key={v} type="button" onClick={() => setF({ ...f, tipo: v })} style={tapBtn(f.tipo === v, c)}>{l}</button>
              ))}
            </div>
          </Field>

          <Field label="Priorità">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {[['bassa','Bassa','var(--text3)'],['media','Media','#3B82F6'],['alta','Alta','#F59E0B'],['urgente','Urgente','#EF4444']].map(([v,l,c]) => (
                <button key={v} type="button" onClick={() => setF({ ...f, priority: v })} style={tapBtn(f.priority === v, c)}>{l}</button>
              ))}
            </div>
          </Field>

          <Field label="Reparto">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {allAreas.map(a => {
                const checked = f.area === a
                const isCustom = customAreas.includes(a)
                return <button key={a} type="button" onClick={() => setF({ ...f, area: checked ? '' : a })}
                  onContextMenu={isCustom ? (e) => { e.preventDefault(); removeArea(a) } : undefined}
                  title={isCustom ? 'Tap per selezionare · Tieni premuto/right-click per rimuovere' : 'Tap per selezionare'}
                  style={{
                    padding: '12px 16px', fontSize: 14, borderRadius: 999, fontWeight: 600,
                    border: '2px solid ' + (checked ? 'var(--text)' : 'var(--border)'),
                    background: checked ? 'var(--text)' : 'transparent',
                    color: checked ? 'var(--surface)' : 'var(--text2)',
                    cursor: 'pointer', minHeight: 44,
                  }}>{a}</button>
              })}
              {!showAddArea && (
                <button type="button" onClick={() => setShowAddArea(true)}
                  style={{
                    padding: '12px 16px', fontSize: 14, borderRadius: 999, fontWeight: 700,
                    border: '2px dashed var(--blue)',
                    background: 'transparent', color: 'var(--blue)',
                    cursor: 'pointer', minHeight: 44,
                  }}>+ Aggiungi categoria</button>
              )}
              {showAddArea && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 100%' }}>
                  <input style={{ ...inpL, flex: 1 }} placeholder="Nome reparto (es. Igiene, IT, Sicurezza)" value={newAreaText} onChange={e => setNewAreaText(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArea() } }}/>
                  <button type="button" onClick={addArea}
                    style={{ padding: '12px 18px', fontSize: 14, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 12, cursor: 'pointer', minHeight: 48 }}>
                    Aggiungi
                  </button>
                  <button type="button" onClick={() => { setShowAddArea(false); setNewAreaText('') }}
                    style={{ padding: '12px 14px', fontSize: 14, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', minHeight: 48 }}>
                    ×
                  </button>
                </div>
              )}
            </div>
            {customAreas.length > 0 && !showAddArea && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>
                Suggerimento: tieni premuto (o tasto destro) su un reparto personalizzato per rimuoverlo.
              </div>
            )}
          </Field>

          {!f.is_recurring && (
            <Field label="Quando">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input type="date" style={inpL} value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })}/>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="time" style={{ ...inpL, flex: 1 }} value={f.due_time} onChange={e => setF({ ...f, due_time: e.target.value })}/>
                  <input style={{ ...inpL, flex: '0 0 90px' }} placeholder="Min" inputMode="numeric" value={f.duration_min} onChange={e => setF({ ...f, duration_min: e.target.value })}/>
                </div>
              </div>
            </Field>
          )}

          <Field label="Locale">
            <select style={inpL} value={f.locale} onChange={e => setF({ ...f, locale: e.target.value, assigned_employee_ids: [] })}>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>

          <Field label="Assegna a">
            <select style={inpL} value={f.assignment_kind} onChange={e => setF({ ...f, assignment_kind: e.target.value, assigned_employee_ids: [], assigned_roles: [] })}>
              <option value="persons">Persone specifiche</option>
              <option value="roles">Ruoli</option>
              <option value="team">Tutto il team</option>
            </select>
          </Field>

          {f.assignment_kind === 'persons' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)' }}>
              {empsForLocale.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic', padding: 8 }}>Nessun dipendente in questo locale.</div>}
              {empsForLocale.map(e => {
                const checked = f.assigned_employee_ids.includes(e.id)
                return <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, color: 'var(--text)', cursor: 'pointer', padding: '12px 12px', borderRadius: 8, background: checked ? 'var(--blue-bg)' : 'var(--surface)', border: '1px solid ' + (checked ? 'var(--blue)' : 'var(--border)'), minHeight: 48 }}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    const next = checked ? f.assigned_employee_ids.filter(x => x !== e.id) : [...f.assigned_employee_ids, e.id]
                    setF({ ...f, assigned_employee_ids: next })
                  }} style={{ width: 20, height: 20 }}/>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>{e.nome}</strong>
                    {e.ruolo ? <span style={{ color: 'var(--text3)', fontSize: 12, marginLeft: 6 }}>{e.ruolo}</span> : null}
                  </span>
                </label>
              })}
            </div>
          )}

          {f.assignment_kind === 'roles' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {rolesAvail.map(r => {
                const checked = f.assigned_roles.includes(r)
                return <button key={r} type="button" onClick={() => {
                  const next = checked ? f.assigned_roles.filter(x => x !== r) : [...f.assigned_roles, r]
                  setF({ ...f, assigned_roles: next })
                }} style={{
                  padding: '12px 18px', fontSize: 14, borderRadius: 999, fontWeight: 600,
                  border: '2px solid ' + (checked ? 'var(--text)' : 'var(--border)'),
                  background: checked ? 'var(--text)' : 'transparent',
                  color: checked ? 'var(--surface)' : 'var(--text2)',
                  cursor: 'pointer', minHeight: 44,
                }}>{r}</button>
              })}
              {rolesAvail.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>Nessun ruolo configurato.</div>}
            </div>
          )}

          <Field label="Descrizione (opzionale)">
            <textarea style={{ ...inpL, minHeight: 80 }} placeholder="A cosa serve" value={f.description} onChange={e => setF({ ...f, description: e.target.value })}/>
          </Field>

          <Field label="Istruzioni (opzionale)">
            <textarea style={{ ...inpL, minHeight: 100 }} placeholder="Passo-passo come si fa" value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })}/>
          </Field>

          {/* Opzioni: ognuna è una grossa riga toggle */}
          <ToggleRow checked={f.is_delegable} onChange={v => setF({ ...f, is_delegable: v })}
            title="Delegabile" sub="Il manager può smistarla a un sottoposto"/>
          <ToggleRow checked={f.requires_photo} onChange={v => setF({ ...f, requires_photo: v })}
            title="Richiede foto" sub="Al completamento il dipendente deve allegare una foto"/>
          <ToggleRow checked={f.is_recurring} onChange={v => setF({ ...f, is_recurring: v })}
            title="Ricorrente" sub="Si ripete nel calendario (giornaliera, settimanale, ecc.)" highlight/>

          {f.is_recurring && (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Frequenza">
                <select style={inpL} value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })}>
                  <option value="daily">Ogni giorno</option>
                  <option value="weekdays">Giorni feriali (Lun-Ven)</option>
                  <option value="weekly">Settimanale</option>
                  <option value="biweekly">Quindicinale</option>
                  <option value="monthly">Mensile</option>
                </select>
              </Field>
              <Field label="Orario (opzionale)">
                <input type="time" style={inpL} value={f.due_time} onChange={e => setF({ ...f, due_time: e.target.value })}/>
              </Field>
              {(f.recurrence === 'weekly' || f.recurrence === 'biweekly') && (
                <Field label="Giorni della settimana">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                    {[1,2,3,4,5,6,0].map(dow => {
                      const dayN = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][dow]
                      const checked = f.days_of_week.includes(dow)
                      return <button key={dow} type="button" onClick={() => {
                        const next = checked ? f.days_of_week.filter(d => d !== dow) : [...f.days_of_week, dow]
                        setF({ ...f, days_of_week: next })
                      }} style={{
                        padding: '12px 2px', fontSize: 12, borderRadius: 8, fontWeight: 700,
                        border: '2px solid ' + (checked ? 'var(--text)' : 'var(--border)'),
                        background: checked ? 'var(--text)' : 'transparent',
                        color: checked ? 'var(--surface)' : 'var(--text2)',
                        cursor: 'pointer', minHeight: 44,
                      }}>{dayN}</button>
                    })}
                  </div>
                </Field>
              )}
              {f.recurrence === 'monthly' && (
                <Field label="Giorno del mese">
                  <input type="number" min={1} max={31} inputMode="numeric" style={inpL} value={f.day_of_month} onChange={e => setF({ ...f, day_of_month: Number(e.target.value) })}/>
                </Field>
              )}
            </div>
          )}

          {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 12, borderRadius: 10, fontSize: 14 }}>{err}</div>}
        </div>

        {/* Footer fisso in basso (flex-shrink: 0 nel container flex column) */}
        <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, background: 'var(--surface)', flexShrink: 0, paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} disabled={saving}
            style={{ flex: 1, padding: '14px 16px', fontSize: 15, fontWeight: 600, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', minHeight: 50 }}>
            Annulla
          </button>
          <button onClick={save} disabled={saving}
            style={{ flex: 2, padding: '14px 16px', fontSize: 15, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 12, cursor: 'pointer', minHeight: 50 }}>
            {saving ? 'Salvo…' : 'Crea task'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ checked, onChange, title, sub, highlight }) {
  return <label style={{
    display: 'flex', alignItems: 'center', gap: 14, padding: 14,
    background: highlight && checked ? 'var(--blue-bg)' : 'var(--surface2)',
    border: '1px solid ' + (highlight && checked ? 'var(--blue)' : 'var(--border)'),
    borderRadius: 12, cursor: 'pointer', minHeight: 60,
  }}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0 }}/>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>
    </div>
  </label>
}

function Field({ label, children }) {
  return <div>
    {label && <div style={lbl}>{label}</div>}
    {children}
  </div>
}

function CountTile({ label, value, color, onClick }) {
  return <button onClick={onClick}
    style={{
      background: 'var(--surface2)', border: '1px solid var(--border)',
      borderLeft: '3px solid ' + color,
      borderRadius: 'var(--radius-control)', padding: 12, textAlign: 'left',
      cursor: 'pointer', fontFamily: 'inherit',
    }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 4 }}>{label}</div>
  </button>
}

function TaskDetailModal({ data, employees, onClose }) {
  const list = data.tasks
  const filterLabel = data.filter === 'scadute' ? 'Task scadute' :
                      data.filter === 'problema' ? 'Problemi aperti' :
                      data.filter === 'scadenza' ? 'Scadenze' :
                      'Task ' + (STATUS_LABEL[data.filter] || data.filter).toLowerCase()
  const empName = (id) => employees.find(e => e.id === id)?.nome || '?'

  return (
    <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--surface)', borderRadius: '16px 16px 0 0' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)' }}>{filterLabel} · {list.length}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text2)', cursor: 'pointer', padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          {list.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>Nessuna task in questa categoria.</div>}
          {list.map(t => {
            const tipoColor = TIPO_COLOR[t.tipo] || TIPO_COLOR.compito
            const statusColor = STATUS_COLOR[t.status] || STATUS_COLOR.da_fare
            const assignees = t.assignment_kind === 'team' ? 'Team' :
              t.assignment_kind === 'roles' ? (t.assigned_roles || []).join(', ') :
              (t.assigned_employee_ids || []).map(empName).join(', ') || '—'
            return <div key={t.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderLeft: '3px solid ' + tipoColor, borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                {t.tipo && t.tipo !== 'compito' && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: tipoColor + '22', color: tipoColor, letterSpacing: '.04em', textTransform: 'uppercase' }}>{t.tipo}</span>
                )}
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: statusColor + '22', color: statusColor, letterSpacing: '.04em', textTransform: 'uppercase' }}>{STATUS_LABEL[t.status] || t.status}</span>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 0 }}>{t.title}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>{new Date(t.due_date+'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}{t.due_time ? ' ' + t.due_time.substring(0, 5) : ''}</span>
                {t.locale && <span>{t.locale}</span>}
                {t.area && <span style={{ fontWeight: 600, color: 'var(--blue-text)' }}>· {t.area}</span>}
                <span>→ {assignees}</span>
              </div>
              {t.description && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, opacity: 0.85 }}>{t.description}</div>}
            </div>
          })}
        </div>
      </div>
    </div>
  )
}

function TaskWidgetSettings({ cfg, sps, onSave, onClose }) {
  const [draft, setDraft] = useState(cfg)
  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)
  const sel = draft.locali === null ? allLocali : draft.locali
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Configura widget Task</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer', padding: 4 }}>×</button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Periodo</label>
          <select value={draft.period} onChange={e => setDraft({ ...draft, period: e.target.value })} style={inp}>
            <option value="oggi">Oggi</option>
            <option value="settimana">Questa settimana</option>
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Categoria</label>
          <select value={draft.tipo} onChange={e => setDraft({ ...draft, tipo: e.target.value })} style={inp}>
            <option value="tutti">Tutte</option>
            <option value="compito">Solo compiti</option>
            <option value="problema">Solo problemi</option>
            <option value="scadenza">Solo scadenze</option>
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Locali</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
            {allLocali.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nessun locale</div>}
            {allLocali.map(loc => {
              const checked = sel.includes(loc)
              return <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => {
                  const next = checked ? sel.filter(l => l !== loc) : [...sel, loc]
                  setDraft({ ...draft, locali: next.length === allLocali.length ? null : next })
                }}/>
                {loc}
              </label>
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSec}>Annulla</button>
          <button onClick={() => onSave(draft)} style={btnPri}>Salva</button>
        </div>
      </div>
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }
const inp = { ...S.input, width: '100%' }
const btnPri = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 'var(--radius-control)', cursor: 'pointer' }
const btnSec = { padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)', cursor: 'pointer' }
