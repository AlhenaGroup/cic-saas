import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, KPI } from '../shared/styles.jsx'

// ─── helpers priorità ──────────────────────────────────────────────────────
// Calcola priorità dinamica dalla scadenza (se presente)
function computePrio(scadenza) {
  if (!scadenza) return 'planned'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(scadenza + 'T00:00:00')
  const days = Math.round((d - today) / 86400000)
  if (days <= 1) return 'urgent'
  if (days <= 7) return 'soon'
  return 'planned'
}

const PRIO_META = {
  urgent:  { label: '🔴 Urgente',    color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  soon:    { label: '🟡 In scadenza', color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  planned: { label: '🟢 Pianificato', color: '#10B981', bg: 'rgba(16,185,129,.12)' },
  done:    { label: '✅ Completato',  color: '#64748b', bg: 'rgba(100,116,139,.08)' }
}

const TIPO_OPTIONS = [
  { value: 'campagna',  label: '📣 Campagna' },
  { value: 'contenuto', label: '📸 Contenuto' },
  { value: 'review',    label: '⭐ Review' },
  { value: 'altro',     label: '📝 Altro' }
]

// ─── componente ────────────────────────────────────────────────────────────
export default function MarketingTasks({ sp, sps, from, to, onTasksChange }) {
  const [tasks, setTasks]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [filter, setFilter]     = useState('all')   // all | urgent | soon | planned | done

  const emptyForm = {
    titolo: '',
    tipo: 'altro',
    locale: sp === 'all' ? '' : String(sp),
    scadenza: '',
    note: ''
  }
  const [form, setForm] = useState(emptyForm)

  const iS = S.input

  // ─── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data, error } = await supabase
        .from('marketing_tasks')
        .select('*')
        .order('scadenza', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      // Ricalcola priorità on-the-fly in base a oggi
      const withPrio = (data || []).map(t => ({
        ...t,
        priorita: t.stato === 'done' ? 'planned' : computePrio(t.scadenza)
      }))
      setTasks(withPrio)
      if (typeof onTasksChange === 'function') onTasksChange()
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [onTasksChange])

  useEffect(() => { load() }, [load])

  // Riapplica il filtro locale quando cambia il sp globale
  useEffect(() => {
    if (!showForm) setForm(f => ({ ...f, locale: sp === 'all' ? '' : String(sp) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  // ─── CRUD ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.titolo.trim()) { setErr('Titolo richiesto'); return }
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        titolo: form.titolo.trim(),
        tipo: form.tipo,
        locale: form.locale || null,
        scadenza: form.scadenza || null,
        note: form.note || null,
        priorita: computePrio(form.scadenza),
        updated_at: new Date().toISOString()
      }
      if (editing) {
        const { error } = await supabase.from('marketing_tasks').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('marketing_tasks').insert({ ...payload, user_id: user.id })
        if (error) throw error
      }
      setForm(emptyForm); setShowForm(false); setEditing(null)
      await load()
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  const toggleDone = async (task) => {
    const newState = task.stato === 'done' ? 'open' : 'done'
    await supabase.from('marketing_tasks').update({
      stato: newState,
      completed_at: newState === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', task.id)
    await load()
  }

  const remove = async (id) => {
    if (!confirm('Eliminare questo task?')) return
    await supabase.from('marketing_tasks').delete().eq('id', id)
    await load()
  }

  const startEdit = (task) => {
    setEditing(task)
    setForm({
      titolo: task.titolo || '',
      tipo: task.tipo || 'altro',
      locale: task.locale || '',
      scadenza: task.scadenza || '',
      note: task.note || ''
    })
    setShowForm(true)
  }

  const cancelForm = () => {
    setForm(emptyForm); setShowForm(false); setEditing(null); setErr('')
  }

  // ─── KPI + filtro ────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const open = tasks.filter(t => t.stato !== 'done')
    return {
      urgent:  open.filter(t => t.priorita === 'urgent').length,
      soon:    open.filter(t => t.priorita === 'soon').length,
      planned: open.filter(t => t.priorita === 'planned').length,
      done:    tasks.filter(t => t.stato === 'done').length
    }
  }, [tasks])

  const filtered = useMemo(() => {
    if (filter === 'all')  return tasks.filter(t => t.stato !== 'done')
    if (filter === 'done') return tasks.filter(t => t.stato === 'done')
    return tasks.filter(t => t.stato !== 'done' && t.priorita === filter)
  }, [tasks, filter])

  // ─── render ──────────────────────────────────────────────────────────────
  const filterBtn = (k, label) => ({
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    border: filter === k ? `1px solid ${PRIO_META[k === 'all' ? 'planned' : k]?.color || '#F59E0B'}` : '1px solid #2a3042',
    background: filter === k ? 'rgba(245,158,11,.15)' : 'transparent',
    color: filter === k ? '#F59E0B' : '#94a3b8',
    whiteSpace: 'nowrap'
  })

  const localeLabel = (loc) => {
    if (!loc) return '—'
    const match = sps.find(s => String(s.id) === String(loc))
    return match?.description || match?.name || loc
  }

  return <>
    {/* KPI row */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
      <KPI label="🔴 Urgenti"    icon="🔴" value={counts.urgent}  sub="scade oggi/domani" accent="#EF4444" />
      <KPI label="🟡 In scadenza" icon="🟡" value={counts.soon}    sub="entro 7 giorni"    accent="#F59E0B" />
      <KPI label="🟢 Pianificati" icon="🟢" value={counts.planned} sub="oltre 7 giorni"    accent="#10B981" />
      <KPI label="✅ Completati"  icon="✅" value={counts.done}    sub="tutti"             accent="#64748b" />
    </div>

    {/* Error */}
    {err && <div style={{
      background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#FCA5A5', marginBottom: 12
    }}>{err}</div>}

    {/* Form (inline) */}
    {showForm && <div style={{
      ...S.card, marginBottom: 16, borderLeft: '3px solid #F59E0B'
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>
        {editing ? '✏️ Modifica task' : '➕ Nuovo task'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input
          placeholder="Titolo del task…"
          value={form.titolo}
          onChange={e => setForm({ ...form, titolo: e.target.value })}
          style={iS}
          autoFocus
        />
        <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={iS}>
          {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={form.locale} onChange={e => setForm({ ...form, locale: e.target.value })} style={iS}>
          <option value="">📍 Tutti i locali</option>
          {sps.map(s => <option key={s.id} value={s.id}>{s.description || s.name}</option>)}
        </select>
        <input
          type="date"
          value={form.scadenza}
          onChange={e => setForm({ ...form, scadenza: e.target.value })}
          style={iS}
        />
      </div>
      <textarea
        placeholder="Note (opzionale)…"
        value={form.note}
        onChange={e => setForm({ ...form, note: e.target.value })}
        style={{ ...iS, width: '100%', minHeight: 50, resize: 'vertical', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancelForm} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 14px', cursor: 'pointer' }}>
          Annulla
        </button>
        <button
          onClick={save}
          disabled={loading || !form.titolo.trim()}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: (loading || !form.titolo.trim()) ? 0.5 : 1 }}
        >
          {loading ? 'Salvataggio…' : (editing ? 'Aggiorna' : 'Aggiungi')}
        </button>
      </div>
    </div>}

    {/* Filtri + add button */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={() => setFilter('all')}     style={filterBtn('all',    'Tutti aperti')}>📋 Tutti aperti ({counts.urgent + counts.soon + counts.planned})</button>
      <button onClick={() => setFilter('urgent')}  style={filterBtn('urgent', 'Urgenti')}>🔴 Urgenti ({counts.urgent})</button>
      <button onClick={() => setFilter('soon')}    style={filterBtn('soon',   'Scadenza')}>🟡 Scadenza ({counts.soon})</button>
      <button onClick={() => setFilter('planned')} style={filterBtn('planned','Pianificati')}>🟢 Pianificati ({counts.planned})</button>
      <button onClick={() => setFilter('done')}    style={filterBtn('done',   'Completati')}>✅ Completati ({counts.done})</button>
      <div style={{ flex: 1 }} />
      {!showForm && <button
        onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm) }}
        style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
      >+ Nuovo task</button>}
    </div>

    {/* Lista */}
    <Card title="Task marketing" badge={loading ? 'Caricamento…' : `${filtered.length} task`}>
      {filtered.length === 0 ? (
        <div style={{ padding: '24px 8px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          {filter === 'all' && counts.urgent + counts.soon + counts.planned === 0
            ? '🎉 Nessun task aperto. Aggiungi il primo con "+ Nuovo task".'
            : 'Nessun task in questa categoria.'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a3042' }}>
              <th style={{ ...S.th, width: 30 }}></th>
              <th style={S.th}>Titolo</th>
              <th style={{ ...S.th, width: 110 }}>Tipo</th>
              <th style={{ ...S.th, width: 150 }}>Locale</th>
              <th style={{ ...S.th, width: 110 }}>Scadenza</th>
              <th style={{ ...S.th, width: 120 }}>Priorità</th>
              <th style={{ ...S.th, width: 90 }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => {
              const prio = PRIO_META[t.stato === 'done' ? 'done' : t.priorita] || PRIO_META.planned
              const tipoLabel = TIPO_OPTIONS.find(o => o.value === t.tipo)?.label || t.tipo
              const isDone = t.stato === 'done'
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid #1a1f2e', opacity: isDone ? 0.55 : 1 }}>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => toggleDone(t)}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)', accentColor: '#10B981' }}
                    />
                  </td>
                  <td style={{ ...S.td, fontWeight: 500, textDecoration: isDone ? 'line-through' : 'none' }}>
                    {t.titolo}
                    {t.note && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{t.note}</div>}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{tipoLabel}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{localeLabel(t.locale)}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>
                    {t.scadenza ? new Date(t.scadenza + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(prio.color, prio.bg)}>{prio.label}</span>
                  </td>
                  <td style={S.td}>
                    <button
                      onClick={() => startEdit(t)}
                      title="Modifica"
                      style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
                    >✏️</button>
                    <button
                      onClick={() => remove(t.id)}
                      title="Elimina"
                      style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
                    >🗑</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  </>
}
