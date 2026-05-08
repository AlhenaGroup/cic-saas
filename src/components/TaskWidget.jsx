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
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [openDetail, setOpenDetail] = useState(null)

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
  }, [cfg.period, cfg.tipo, localiFiltrati.join(',')])

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
      <button onClick={() => setShowSettings(true)} title="Configura widget"
        style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
        Configura
      </button>
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
