// HACCP → Corsi & Attestati per dipendente
// Per ogni dipendente, attestati con scadenza:
//   HACCP alimentarista, HACCP responsabile, antincendio (basso/medio/alto),
//   primo soccorso, RSPP, RLS, sicurezza generale, sicurezza specifica.
// Visibili da /timbra come "I miei attestati".

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

export const CERT_TYPES = [
  { key: 'haccp_alimentarista',   label: 'HACCP alimentarista',         color: '#10B981', defaultDurataOre: 12, defaultValiditaAnni: 5 },
  { key: 'haccp_responsabile',    label: 'HACCP responsabile',           color: '#10B981', defaultDurataOre: 16, defaultValiditaAnni: 5 },
  { key: 'antincendio_basso',     label: 'Antincendio rischio basso',    color: '#EF4444', defaultDurataOre: 4,  defaultValiditaAnni: 5 },
  { key: 'antincendio_medio',     label: 'Antincendio rischio medio',    color: '#EF4444', defaultDurataOre: 8,  defaultValiditaAnni: 5 },
  { key: 'antincendio_alto',      label: 'Antincendio rischio alto',     color: '#EF4444', defaultDurataOre: 16, defaultValiditaAnni: 5 },
  { key: 'primo_soccorso',        label: 'Primo soccorso (BLSD/Gruppo B)', color: '#F59E0B', defaultDurataOre: 12, defaultValiditaAnni: 3 },
  { key: 'rspp',                  label: 'RSPP — Datore di lavoro',      color: '#3B82F6', defaultDurataOre: 16, defaultValiditaAnni: 5 },
  { key: 'rls',                   label: 'RLS — Rappresentante lavoratori', color: '#3B82F6', defaultDurataOre: 32, defaultValiditaAnni: null },
  { key: 'sicurezza_generale',    label: 'Sicurezza generale (4h)',      color: '#8B5CF6', defaultDurataOre: 4,  defaultValiditaAnni: null },
  { key: 'sicurezza_specifica',   label: 'Sicurezza specifica (8/12h)',  color: '#8B5CF6', defaultDurataOre: 8,  defaultValiditaAnni: 5 },
  { key: 'altro',                 label: 'Altro',                         color: '#64748B', defaultDurataOre: null, defaultValiditaAnni: null },
]
const TYPE_BY_KEY = Object.fromEntries(CERT_TYPES.map(t => [t.key, t]))

function daysTo(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr + 'T12:00:00')
  return Math.round((d - today) / 86400000)
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function HaccpCorsiTab({ sps = [] }) {
  const [certs, setCerts] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [filterEmp, setFilterEmp] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [filterScad, setFilterScad] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('lista') // 'lista' | 'matrice'

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from('employee_certificates').select('*').order('scadenza', { ascending: true, nullsFirst: false }),
      supabase.from('employees').select('id, nome, ruolo, locale, stato').order('nome'),
    ])
    setCerts(c || [])
    setEmployees(e || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const empById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])
  const empAttivi = useMemo(() => employees.filter(e => e.stato === 'Attivo'), [employees])

  const filtered = useMemo(() => {
    return certs.filter(c => {
      if (filterEmp && c.employee_id !== filterEmp) return false
      if (filterTipo && c.tipo !== filterTipo) return false
      if (search) {
        const emp = empById[c.employee_id]
        const haystack = `${c.titolo} ${emp?.nome || ''} ${c.ente_erogante || ''}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }
      const dt = daysTo(c.scadenza)
      if (filterScad === 'scaduti' && (dt == null || dt >= 0)) return false
      if (filterScad === 'in_scadenza' && (dt == null || dt < 0 || dt > 90)) return false
      if (filterScad === 'attivi' && (dt != null && dt < 0)) return false
      return true
    })
  }, [certs, filterEmp, filterTipo, filterScad, search, empById])

  const stats = useMemo(() => {
    let scaduti = 0, in_scadenza = 0, attivi = 0, no_scadenza = 0
    for (const c of certs) {
      const dt = daysTo(c.scadenza)
      if (dt == null) no_scadenza++
      else if (dt < 0) scaduti++
      else if (dt <= 90) in_scadenza++
      else attivi++
    }
    return { tot: certs.length, scaduti, in_scadenza, attivi, no_scadenza }
  }, [certs])

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <KPI label="Totale attestati" value={stats.tot} accent="#3B82F6"/>
      <KPI label="Scaduti" value={stats.scaduti} accent="#EF4444" onClick={() => setFilterScad('scaduti')}/>
      <KPI label="In scadenza (90gg)" value={stats.in_scadenza} accent="#F59E0B" onClick={() => setFilterScad('in_scadenza')}/>
      <KPI label="Attivi" value={stats.attivi} accent="#10B981"/>
      <KPI label="Senza scadenza" value={stats.no_scadenza} accent="var(--text3)"/>
    </div>

    <Card title="Corsi & Attestati dipendenti" badge={loading ? '…' : (filtered.length + ' di ' + certs.length)} extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setView(view === 'lista' ? 'matrice' : 'lista')}
          style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
          {view === 'lista' ? 'Vista matrice' : 'Vista lista'}
        </button>
        <button onClick={() => setEditing({})}
          style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          + Carica attestato
        </button>
      </div>
    }>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input placeholder="Cerca dipendente, titolo, ente…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...S.input, fontSize: 12, padding: '6px 10px', flex: '1 1 200px', minWidth: 180 }}/>
        <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i dipendenti</option>
          {empAttivi.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i tipi</option>
          {CERT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={filterScad} onChange={e => setFilterScad(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Qualsiasi stato</option>
          <option value="scaduti">Solo scaduti</option>
          <option value="in_scadenza">In scadenza (≤ 90gg)</option>
          <option value="attivi">Solo attivi</option>
        </select>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}

      {!loading && view === 'lista' && filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        {certs.length === 0 ? 'Nessun attestato ancora caricato. Click "+ Carica attestato".' : 'Nessun attestato con questi filtri.'}
      </div>}

      {!loading && view === 'lista' && filtered.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Dipendente', 'Tipo corso', 'Titolo', 'Emesso', 'Scadenza', 'Ente', 'File', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(c => <CertRow key={c.id} cert={c} emp={empById[c.employee_id]}
              onEdit={() => setEditing(c)}
              onDelete={async () => {
                if (!confirm(`Eliminare l'attestato "${c.titolo}"?`)) return
                if (c.file_path) await supabase.storage.from('documents').remove([c.file_path])
                await supabase.from('employee_certificates').delete().eq('id', c.id)
                await load()
              }}/>)}
          </tbody>
        </table>
      </div>}

      {!loading && view === 'matrice' && <MatrixView employees={empAttivi} certs={certs} onCellClick={(empId, tipo) => {
        const exist = certs.find(c => c.employee_id === empId && c.tipo === tipo)
        setEditing(exist || { employee_id: empId, tipo })
      }}/>}
    </Card>

    {editing != null && <CertEditor cert={editing} employees={empAttivi}
      onClose={() => setEditing(null)}
      onSaved={async () => { setEditing(null); await load() }}/>}
  </div>
}

function KPI({ label, value, accent, onClick }) {
  return <div onClick={onClick} style={{
    background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid ' + accent,
    borderRadius: 8, padding: 12, cursor: onClick ? 'pointer' : 'default',
  }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent === 'var(--text3)' ? 'var(--text2)' : accent, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
  </div>
}

function CertRow({ cert, emp, onEdit, onDelete }) {
  const tipo = TYPE_BY_KEY[cert.tipo] || { label: cert.tipo, color: '#64748B' }
  const dt = daysTo(cert.scadenza)
  let scadColor = 'var(--text3)', scadLabel = '—', scadBg = 'transparent'
  if (dt != null) {
    if (dt < 0) { scadColor = '#EF4444'; scadLabel = `Scaduto ${Math.abs(dt)}gg fa`; scadBg = 'rgba(239,68,68,.1)' }
    else if (dt <= 30) { scadColor = '#EF4444'; scadLabel = `${dt}gg`; scadBg = 'rgba(239,68,68,.1)' }
    else if (dt <= 90) { scadColor = '#F59E0B'; scadLabel = `${dt}gg`; scadBg = 'rgba(245,158,11,.1)' }
    else { scadColor = '#10B981'; scadLabel = `${dt}gg` }
  }
  const downloadFile = async () => {
    if (!cert.file_path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(cert.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  return <tr style={{ borderBottom: '1px solid var(--border)' }}>
    <td style={{ ...S.td, fontWeight: 600 }}>
      {emp?.nome || <span style={{ color: 'var(--text3)' }}>?</span>}
      {emp?.ruolo && <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginTop: 2 }}>{emp.ruolo}</div>}
    </td>
    <td style={{ ...S.td }}>
      <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: tipo.color + '22', color: tipo.color, fontSize: 11, fontWeight: 600 }}>{tipo.label}</span>
    </td>
    <td style={{ ...S.td, fontSize: 12 }}>
      {cert.titolo}
      {cert.durata_ore && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{cert.durata_ore}h</div>}
    </td>
    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{fmtDate(cert.data_emissione)}</td>
    <td style={{ ...S.td, fontSize: 12 }}>
      {cert.scadenza ? <>
        <div style={{ color: 'var(--text)' }}>{fmtDate(cert.scadenza)}</div>
        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: scadBg, color: scadColor, fontSize: 10, fontWeight: 700, marginTop: 2 }}>{scadLabel}</span>
      </> : <span style={{ color: 'var(--text3)' }}>non scade</span>}
    </td>
    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{cert.ente_erogante || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
    <td style={{ ...S.td }}>
      {cert.file_path ? <button onClick={downloadFile} style={{ background: 'none', border: '1px solid var(--border)', color: '#3B82F6', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6, fontWeight: 600 }}>Apri</button> : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}
    </td>
    <td style={{ ...S.td }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onEdit} style={{ background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Modifica</button>
        <button onClick={onDelete} style={{ background: 'transparent', color: 'var(--red)', border: '1px solid rgba(220,38,38,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Elimina</button>
      </div>
    </td>
  </tr>
}

function MatrixView({ employees, certs, onCellClick }) {
  const TYPES_TO_SHOW = CERT_TYPES.filter(t => t.key !== 'altro')
  return <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
        <th style={{ ...S.th, fontSize: 10, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, minWidth: 160 }}>Dipendente</th>
        {TYPES_TO_SHOW.map(t => <th key={t.key} style={{ ...S.th, fontSize: 10, minWidth: 110, color: t.color }}>{t.label}</th>)}
      </tr></thead>
      <tbody>
        {employees.map(emp => <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)' }}>
          <td style={{ ...S.td, fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{emp.nome}</td>
          {TYPES_TO_SHOW.map(t => {
            const c = certs.find(x => x.employee_id === emp.id && x.tipo === t.key)
            const dt = c?.scadenza ? daysTo(c.scadenza) : null
            let bg = 'transparent', label = '—', color = 'var(--text3)'
            if (c) {
              if (dt == null) { bg = 'rgba(16,185,129,.15)'; label = '✓'; color = '#10B981' }
              else if (dt < 0) { bg = 'rgba(239,68,68,.2)'; label = `${Math.abs(dt)}gg fa`; color = '#EF4444' }
              else if (dt <= 90) { bg = 'rgba(245,158,11,.15)'; label = `${dt}gg`; color = '#F59E0B' }
              else { bg = 'rgba(16,185,129,.15)'; label = fmtDate(c.scadenza); color = '#10B981' }
            }
            return <td key={t.key} onClick={() => onCellClick(emp.id, t.key)} style={{ ...S.td, textAlign: 'center', cursor: 'pointer', background: bg, color, fontWeight: 600, fontSize: 11 }}>
              {label}
            </td>
          })}
        </tr>)}
      </tbody>
    </table>
  </div>
}

function CertEditor({ cert, employees, onClose, onSaved }) {
  const [f, setF] = useState({
    employee_id: cert.employee_id || '',
    tipo: cert.tipo || 'haccp_alimentarista',
    titolo: cert.titolo || '',
    data_emissione: cert.data_emissione || '',
    scadenza: cert.scadenza || '',
    durata_ore: cert.durata_ore || '',
    ente_erogante: cert.ente_erogante || '',
    note: cert.note || '',
  })
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Auto-suggerisci durata + scadenza (data_emissione + validitaAnni) quando cambia tipo o data_emissione
  const onTipoChange = (val) => {
    const t = TYPE_BY_KEY[val]
    setF(f => {
      const next = { ...f, tipo: val }
      if (!f.titolo) next.titolo = t?.label || ''
      if (!f.durata_ore && t?.defaultDurataOre) next.durata_ore = t.defaultDurataOre
      if (!f.scadenza && f.data_emissione && t?.defaultValiditaAnni) {
        const d = new Date(f.data_emissione + 'T12:00:00')
        d.setFullYear(d.getFullYear() + t.defaultValiditaAnni)
        next.scadenza = d.toISOString().split('T')[0]
      }
      return next
    })
  }
  const onDataChange = (val) => {
    setF(f => {
      const next = { ...f, data_emissione: val }
      const t = TYPE_BY_KEY[f.tipo]
      if (val && t?.defaultValiditaAnni && !f.scadenza) {
        const d = new Date(val + 'T12:00:00')
        d.setFullYear(d.getFullYear() + t.defaultValiditaAnni)
        next.scadenza = d.toISOString().split('T')[0]
      }
      return next
    })
  }

  const save = async () => {
    setErr('')
    if (!f.employee_id) { setErr('Dipendente obbligatorio'); return }
    if (!f.titolo.trim()) { setErr('Titolo obbligatorio'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let filePath = cert.file_path || null
      if (file) {
        const ext = (file.name.split('.').pop() || 'bin').slice(0, 6)
        const path = `haccp-corsi/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file)
        if (upErr) throw upErr
        if (cert.file_path && cert.id) await supabase.storage.from('documents').remove([cert.file_path])
        filePath = path
      }
      const payload = {
        user_id: user.id,
        employee_id: f.employee_id,
        tipo: f.tipo,
        titolo: f.titolo.trim(),
        data_emissione: f.data_emissione || null,
        scadenza: f.scadenza || null,
        durata_ore: f.durata_ore ? Number(f.durata_ore) : null,
        ente_erogante: f.ente_erogante || null,
        note: f.note || null,
        file_path: filePath,
        updated_at: new Date().toISOString(),
      }
      if (cert.id) {
        const { error } = await supabase.from('employee_certificates').update(payload).eq('id', cert.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('employee_certificates').insert(payload)
        if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { ...S.input, width: '100%' }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 640, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{cert.id ? 'Modifica attestato' : 'Carica nuovo attestato'}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Dipendente *">
          <select style={inp} value={f.employee_id} onChange={e => setF({ ...f, employee_id: e.target.value })}>
            <option value="">— Seleziona dipendente —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.nome}{e.ruolo ? ' (' + e.ruolo + ')' : ''}</option>)}
          </select>
        </Field>
        <Field label="Tipo corso *">
          <select style={inp} value={f.tipo} onChange={e => onTipoChange(e.target.value)}>
            {CERT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Titolo *">
          <input style={inp} placeholder='es. "Corso HACCP alimentarista 12h"' value={f.titolo} onChange={e => setF({ ...f, titolo: e.target.value })}/>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Data emissione">
            <input type="date" style={inp} value={f.data_emissione} onChange={e => onDataChange(e.target.value)}/>
          </Field>
          <Field label="Scadenza (vuoto = non scade)">
            <input type="date" style={inp} value={f.scadenza} onChange={e => setF({ ...f, scadenza: e.target.value })}/>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Durata (ore)">
            <input type="number" style={inp} value={f.durata_ore} onChange={e => setF({ ...f, durata_ore: e.target.value })}/>
          </Field>
          <Field label="Ente erogante">
            <input style={inp} placeholder='es. "Confcommercio Pinerolo"' value={f.ente_erogante} onChange={e => setF({ ...f, ente_erogante: e.target.value })}/>
          </Field>
        </div>
        <Field label="Note">
          <textarea style={{ ...inp, minHeight: 60 }} value={f.note} onChange={e => setF({ ...f, note: e.target.value })}/>
        </Field>
        <Field label={cert.file_path ? `File caricato: ${cert.file_path.split('/').pop()}. Carica un nuovo file per sostituirlo:` : 'Attestato (PDF, immagine) — opzionale ma consigliato'}>
          <input type="file" accept="application/pdf,image/*"
            onChange={e => setFile(e.target.files?.[0] || null)} style={inp}/>
        </Field>
        {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Annulla</button>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {saving ? 'Salvo…' : (cert.id ? 'Salva modifiche' : 'Carica attestato')}
        </button>
      </div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <div>
    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{label}</div>
    {children}
  </div>
}
