// HACCP → Registri autocontrollo
// L'owner crea template configurabili (es. temperatura frigo, pulizia banco)
// I dipendenti compilano da /timbra; l'owner vede storico e può compilare anche dalla dashboard.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const FREQ_LABEL = {
  giornaliera: 'Giornaliera',
  settimanale: 'Settimanale',
  mensile: 'Mensile',
  on_event: 'Su evento',
}

const FIELD_TYPE_LABEL = {
  number: 'Numero',
  boolean: 'Sì / No',
  text: 'Testo',
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Calcola se ci sono anomalie nei valori (numerici fuori range)
function checkAnomalia(template, values) {
  for (const f of (template?.fields || [])) {
    if (f.type === 'number') {
      const v = values?.[f.key]
      if (v == null || v === '') continue
      const n = Number(v)
      if (Number.isNaN(n)) continue
      if (f.min != null && n < Number(f.min)) return true
      if (f.max != null && n > Number(f.max)) return true
    }
  }
  return false
}

export default function HaccpRegistriTab({ sps = [] }) {
  const [view, setView] = useState('compilazioni') // 'compilazioni' | 'template'
  const [templates, setTemplates] = useState([])
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTpl, setEditingTpl] = useState(null)
  const [openEntry, setOpenEntry] = useState(null)
  const [compilingTpl, setCompilingTpl] = useState(null)
  const [filterTpl, setFilterTpl] = useState('')
  const [filterLocale, setFilterLocale] = useState('')
  const [filterAnomalia, setFilterAnomalia] = useState(false)
  const [periodoMese, setPeriodoMese] = useState(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  })

  const allLocali = useMemo(() => [...new Set((sps || []).map(s => s.description || s.name).filter(Boolean))], [sps])

  const load = useCallback(async () => {
    setLoading(true)
    const start = periodoMese + '-01'
    const [yy, mm] = periodoMese.split('-').map(Number)
    const endDate = new Date(yy, mm, 1)
    const end = endDate.toISOString().split('T')[0]
    const [t, e, emp] = await Promise.all([
      supabase.from('haccp_log_templates').select('*').order('ordine', { ascending: true }).order('nome'),
      supabase.from('haccp_log_entries').select('*')
        .gte('data_compilazione', start).lt('data_compilazione', end)
        .order('data_compilazione', { ascending: false }).order('ora_compilazione', { ascending: false }),
      supabase.from('employees').select('id, nome').eq('stato', 'Attivo').order('nome'),
    ])
    setTemplates(t.data || [])
    setEntries(e.data || [])
    setEmployees(emp.data || [])
    setLoading(false)
  }, [periodoMese])
  useEffect(() => { load() }, [load])

  const tplById = useMemo(() => Object.fromEntries(templates.map(t => [t.id, t])), [templates])
  const empById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])

  const filteredEntries = useMemo(() => entries.filter(e => {
    if (filterTpl && e.template_id !== filterTpl) return false
    if (filterLocale && e.locale !== filterLocale) return false
    if (filterAnomalia && !e.anomalia) return false
    return true
  }), [entries, filterTpl, filterLocale, filterAnomalia])

  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const todayCount = entries.filter(e => e.data_compilazione === today).length
    const anomalieCount = entries.filter(e => e.anomalia).length
    const tplAttivi = templates.filter(t => t.attivo).length
    return { tot: entries.length, todayCount, anomalieCount, tplAttivi }
  }, [entries, templates])

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <KPI label="Compilazioni mese" value={stats.tot} accent="#3B82F6"/>
      <KPI label="Compilazioni oggi" value={stats.todayCount} accent="#10B981"/>
      <KPI label="Anomalie" value={stats.anomalieCount} accent="#EF4444" onClick={() => setFilterAnomalia(true)}/>
      <KPI label="Template attivi" value={stats.tplAttivi} accent="#F59E0B"/>
    </div>

    <Card title="Registri autocontrollo HACCP" extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setView('compilazioni')}
          style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600,
            background: view === 'compilazioni' ? 'var(--text)' : 'transparent',
            color: view === 'compilazioni' ? 'var(--surface)' : 'var(--text2)',
            border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
          Compilazioni
        </button>
        <button onClick={() => setView('template')}
          style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600,
            background: view === 'template' ? 'var(--text)' : 'transparent',
            color: view === 'template' ? 'var(--surface)' : 'var(--text2)',
            border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
          Template
        </button>
      </div>
    }>
      {view === 'compilazioni' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <input type="month" value={periodoMese} onChange={e => setPeriodoMese(e.target.value)}
            style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}/>
          <select value={filterTpl} onChange={e => setFilterTpl(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
            <option value="">Tutti i registri</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          {allLocali.length > 0 && <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
            <option value="">Tutti i locali</option>
            {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
          </select>}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={filterAnomalia} onChange={e => setFilterAnomalia(e.target.checked)}/>
            Solo anomalie
          </label>
          <div style={{ flex: 1 }}/>
          {templates.filter(t => t.attivo).length > 0 && <select onChange={e => {
            if (e.target.value) { setCompilingTpl(tplById[e.target.value]); e.target.value = '' }
          }} style={{ ...S.input, fontSize: 12, padding: '6px 10px', fontWeight: 600, background: 'var(--text)', color: 'var(--surface)', borderColor: 'var(--text)' }}>
            <option value="">+ Compila registro…</option>
            {templates.filter(t => t.attivo).map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>}
        </div>

        {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}
        {!loading && filteredEntries.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
          {entries.length === 0 ? 'Nessuna compilazione in questo mese.' : 'Nessuna compilazione con questi filtri.'}
        </div>}

        {!loading && filteredEntries.length > 0 && <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Data', 'Ora', 'Registro', 'Locale', 'Operatore', 'Sintesi', 'Anomalia'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filteredEntries.map(e => {
                const t = tplById[e.template_id]
                const emp = empById[e.employee_id]
                return <tr key={e.id} onClick={() => setOpenEntry(e)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <td style={{ ...S.td, fontSize: 12 }}>{fmtDate(e.data_compilazione)}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{(e.ora_compilazione || '').slice(0, 5)}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{t?.nome || '?'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{e.locale || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{emp?.nome || e.operatore_nome || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {summarizeValues(t, e.values)}
                  </td>
                  <td style={{ ...S.td }}>
                    {e.anomalia ? <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: 'rgba(239,68,68,.15)', color: '#EF4444', fontSize: 10, fontWeight: 700 }}>⚠ ANOMALIA</span>
                      : <span style={{ color: '#10B981', fontSize: 11 }}>✓ OK</span>}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>}
      </>}

      {view === 'template' && <TemplateList templates={templates} onEdit={setEditingTpl} onAdd={() => setEditingTpl({})} onReload={load}/>}
    </Card>

    {editingTpl != null && <TemplateEditor tpl={editingTpl} sps={sps}
      onClose={() => setEditingTpl(null)}
      onSaved={async () => { setEditingTpl(null); await load() }}/>}
    {openEntry && <EntryDetailModal entry={openEntry} template={tplById[openEntry.template_id]} employee={empById[openEntry.employee_id]}
      onClose={() => setOpenEntry(null)}/>}
    {compilingTpl && <CompileModal tpl={compilingTpl} sps={sps} employees={employees}
      onClose={() => setCompilingTpl(null)}
      onSaved={async () => { setCompilingTpl(null); await load() }}/>}
  </div>
}

function summarizeValues(template, values) {
  if (!template || !values) return ''
  const parts = []
  for (const f of template.fields || []) {
    const v = values[f.key]
    if (v === undefined || v === null || v === '') continue
    let display = v
    if (f.type === 'boolean') display = v ? '✓' : '✗'
    parts.push(`${f.label}: ${display}`)
    if (parts.length >= 3) break
  }
  return parts.join(' · ')
}

function KPI({ label, value, accent, onClick }) {
  return <div onClick={onClick} style={{
    background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid ' + accent,
    borderRadius: 8, padding: 12, cursor: onClick ? 'pointer' : 'default',
  }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
  </div>
}

function TemplateList({ templates, onEdit, onAdd, onReload }) {
  const remove = async (t) => {
    if (!confirm(`Eliminare il template "${t.nome}"? Verranno eliminate anche tutte le compilazioni.`)) return
    await supabase.from('haccp_log_templates').delete().eq('id', t.id)
    onReload()
  }
  const toggleAttivo = async (t) => {
    await supabase.from('haccp_log_templates').update({ attivo: !t.attivo }).eq('id', t.id)
    onReload()
  }
  return <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
      <button onClick={onAdd}
        style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        + Nuovo template
      </button>
    </div>
    {templates.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
      Nessun template configurato. Click "+ Nuovo template" per iniziare con il primo registro autocontrollo.
    </div>}
    {templates.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {templates.map(t => <div key={t.id} style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14,
        opacity: t.attivo ? 1 : 0.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t.nome}</div>
            {t.descrizione && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{t.descrizione}</div>}
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#3B82F6', background: 'rgba(59,130,246,.15)', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>
            {FREQ_LABEL[t.frequenza] || t.frequenza}
          </span>
          {t.locale && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 10 }}>{t.locale}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(t.fields || []).map(f => <span key={f.key} style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4 }}>
            {f.label} <span style={{ color: 'var(--text3)', fontSize: 10 }}>({FIELD_TYPE_LABEL[f.type] || f.type})</span>
            {f.required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
          </span>)}
          {(!t.fields || t.fields.length === 0) && <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Nessun campo configurato</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onEdit(t)} style={{ background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Modifica</button>
          <button onClick={() => toggleAttivo(t)} style={{ background: 'transparent', color: t.attivo ? '#F59E0B' : '#10B981', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>
            {t.attivo ? 'Disattiva' : 'Attiva'}
          </button>
          <button onClick={() => remove(t)} style={{ background: 'transparent', color: '#EF4444', border: '1px solid rgba(220,38,38,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Elimina</button>
        </div>
      </div>)}
    </div>}
  </>
}

function TemplateEditor({ tpl, sps, onClose, onSaved }) {
  const [f, setF] = useState({
    nome: tpl.nome || '',
    descrizione: tpl.descrizione || '',
    locale: tpl.locale || '',
    frequenza: tpl.frequenza || 'giornaliera',
    fields: tpl.fields || [],
    attivo: tpl.attivo !== false,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)

  const addField = () => {
    setF({ ...f, fields: [...f.fields, { key: 'campo_' + (f.fields.length + 1), label: '', type: 'number', required: true }] })
  }
  const updField = (i, patch) => {
    const next = [...f.fields]; next[i] = { ...next[i], ...patch }; setF({ ...f, fields: next })
  }
  const removeField = (i) => {
    const next = [...f.fields]; next.splice(i, 1); setF({ ...f, fields: next })
  }

  const save = async () => {
    setErr('')
    if (!f.nome.trim()) { setErr('Nome registro obbligatorio'); return }
    if (f.fields.length === 0) { setErr('Aggiungi almeno un campo'); return }
    if (f.fields.some(x => !x.label?.trim() || !x.key?.trim())) { setErr('Tutti i campi devono avere label e chiave'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        user_id: user.id,
        nome: f.nome.trim(),
        descrizione: f.descrizione || null,
        locale: f.locale || null,
        frequenza: f.frequenza,
        fields: f.fields.map(x => ({
          key: x.key.trim(),
          label: x.label.trim(),
          type: x.type,
          required: !!x.required,
          ...(x.type === 'number' ? { min: x.min === '' ? null : Number(x.min), max: x.max === '' ? null : Number(x.max) } : {}),
        })),
        attivo: f.attivo,
        updated_at: new Date().toISOString(),
      }
      if (tpl.id) {
        const { error } = await supabase.from('haccp_log_templates').update(payload).eq('id', tpl.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('haccp_log_templates').insert(payload)
        if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { ...S.input, width: '100%' }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{tpl.id ? 'Modifica template' : 'Nuovo template registro autocontrollo'}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Nome registro *">
          <input style={inp} placeholder='es. "Temperatura frigo banco"' value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })}/>
        </Field>
        <Field label="Descrizione (opzionale)">
          <textarea style={{ ...inp, minHeight: 50 }} placeholder="Cosa va compilato e quando" value={f.descrizione} onChange={e => setF({ ...f, descrizione: e.target.value })}/>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Frequenza">
            <select style={inp} value={f.frequenza} onChange={e => setF({ ...f, frequenza: e.target.value })}>
              {Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Locale (vuoto = tutti)">
            <select style={inp} value={f.locale} onChange={e => setF({ ...f, locale: e.target.value })}>
              <option value="">— Tutti i locali —</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Campi del registro *</div>
            <button onClick={addField} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'transparent', color: '#3B82F6', border: '1px solid rgba(59,130,246,.3)', borderRadius: 6, cursor: 'pointer' }}>+ Aggiungi campo</button>
          </div>
          {f.fields.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: '12px 0' }}>
            Nessun campo. Aggiungine almeno uno (es. una temperatura, un check sanificato).
          </div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {f.fields.map((fld, i) => <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <input style={{ ...inp, fontSize: 12 }} placeholder="Etichetta (es. Temp frigo °C)" value={fld.label} onChange={e => updField(i, { label: e.target.value })}/>
                <input style={{ ...inp, fontSize: 12 }} placeholder="Chiave (no spazi, es. temp_frigo)" value={fld.key} onChange={e => updField(i, { key: e.target.value.replace(/\s+/g, '_').toLowerCase() })}/>
                <select style={{ ...inp, fontSize: 12 }} value={fld.type} onChange={e => updField(i, { type: e.target.value })}>
                  {Object.entries(FIELD_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={() => removeField(i)} style={{ background: 'transparent', color: '#EF4444', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={!!fld.required} onChange={e => updField(i, { required: e.target.checked })}/>
                  Obbligatorio
                </label>
                {fld.type === 'number' && <>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Range valido:</span>
                  <input type="number" style={{ ...inp, width: 80, fontSize: 11 }} placeholder="min" value={fld.min ?? ''} onChange={e => updField(i, { min: e.target.value === '' ? null : Number(e.target.value) })}/>
                  <input type="number" style={{ ...inp, width: 80, fontSize: 11 }} placeholder="max" value={fld.max ?? ''} onChange={e => updField(i, { max: e.target.value === '' ? null : Number(e.target.value) })}/>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>fuori range = anomalia</span>
                </>}
              </div>
            </div>)}
          </div>
        </div>

        <Field label="Stato">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.attivo} onChange={e => setF({ ...f, attivo: e.target.checked })}/>
            Template attivo (visibile in /timbra ai dipendenti)
          </label>
        </Field>

        {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Annulla</button>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {saving ? 'Salvo…' : 'Salva template'}
        </button>
      </div>
    </div>
  </div>
}

function CompileModal({ tpl, sps, employees, onClose, onSaved }) {
  const [values, setValues] = useState({})
  const [locale, setLocale] = useState(tpl.locale || '')
  const [employeeId, setEmployeeId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)

  const save = async () => {
    setErr('')
    for (const f of tpl.fields || []) {
      if (f.required) {
        const v = values[f.key]
        if (v === undefined || v === null || v === '' || (f.type === 'boolean' && v == null)) {
          setErr(`Compila il campo obbligatorio: ${f.label}`); return
        }
      }
    }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const emp = employees.find(e => e.id === employeeId)
      const anomalia = checkAnomalia(tpl, values)
      const payload = {
        user_id: user.id,
        template_id: tpl.id,
        employee_id: employeeId || null,
        operatore_nome: emp?.nome || null,
        locale: locale || null,
        values,
        anomalia,
        note: note || null,
      }
      const { error } = await supabase.from('haccp_log_entries').insert(payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { ...S.input, width: '100%' }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 540, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Compila: {tpl.nome}</h3>
        {tpl.descrizione && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{tpl.descrizione}</div>}
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Locale">
            <select style={inp} value={locale} onChange={e => setLocale(e.target.value)}>
              <option value="">— Aziendale —</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Operatore">
            <select style={inp} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">— Seleziona —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {(tpl.fields || []).map(fld => <div key={fld.key} style={{ marginBottom: 12 }}>
            <Field label={fld.label + (fld.required ? ' *' : '') + (fld.type === 'number' && (fld.min != null || fld.max != null) ? ` (range ${fld.min ?? '-∞'} – ${fld.max ?? '+∞'})` : '')}>
              {fld.type === 'number' && <input type="number" step="0.1" style={inp}
                value={values[fld.key] ?? ''} onChange={e => setValues({ ...values, [fld.key]: e.target.value })}/>}
              {fld.type === 'text' && <textarea style={{ ...inp, minHeight: 50 }}
                value={values[fld.key] ?? ''} onChange={e => setValues({ ...values, [fld.key]: e.target.value })}/>}
              {fld.type === 'boolean' && <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setValues({ ...values, [fld.key]: true })}
                  style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid ' + (values[fld.key] === true ? '#10B981' : 'var(--border)'),
                    background: values[fld.key] === true ? 'rgba(16,185,129,.15)' : 'var(--surface2)',
                    color: values[fld.key] === true ? '#10B981' : 'var(--text2)' }}>✓ Sì</button>
                <button onClick={() => setValues({ ...values, [fld.key]: false })}
                  style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid ' + (values[fld.key] === false ? '#EF4444' : 'var(--border)'),
                    background: values[fld.key] === false ? 'rgba(239,68,68,.15)' : 'var(--surface2)',
                    color: values[fld.key] === false ? '#EF4444' : 'var(--text2)' }}>✗ No</button>
              </div>}
            </Field>
          </div>)}
        </div>

        <Field label="Note (opzionali)">
          <textarea style={{ ...inp, minHeight: 50 }} value={note} onChange={e => setNote(e.target.value)}/>
        </Field>

        {checkAnomalia(tpl, values) && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#EF4444', padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
          ⚠ Almeno un valore è fuori dal range previsto. La compilazione verrà marcata come anomalia.
        </div>}
        {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Annulla</button>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {saving ? 'Salvo…' : 'Salva compilazione'}
        </button>
      </div>
    </div>
  </div>
}

function EntryDetailModal({ entry, template, employee, onClose }) {
  const remove = async () => {
    if (!confirm('Eliminare questa compilazione?')) return
    await supabase.from('haccp_log_entries').delete().eq('id', entry.id)
    onClose(); window.location.reload()
  }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 540, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>{template?.nome || 'Compilazione'}</h3>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {fmtDate(entry.data_compilazione)} alle {(entry.ora_compilazione || '').slice(0, 5)} · {employee?.nome || entry.operatore_nome || 'operatore non specificato'}
            {entry.locale && ' · ' + entry.locale}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entry.anomalia && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#EF4444', padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          ⚠ ANOMALIA: almeno un valore numerico è fuori dal range previsto
        </div>}
        {(template?.fields || []).map(f => {
          const v = entry.values?.[f.key]
          let display = v
          let outOfRange = false
          if (f.type === 'boolean') display = v === true ? '✓ Sì' : v === false ? '✗ No' : '—'
          else if (f.type === 'number' && v != null && v !== '') {
            const n = Number(v)
            if ((f.min != null && n < Number(f.min)) || (f.max != null && n > Number(f.max))) outOfRange = true
          }
          return <div key={f.key} style={{
            display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
            color: outOfRange ? '#EF4444' : 'var(--text)',
          }}>
            <span style={{ color: 'var(--text3)' }}>{f.label}</span>
            <span style={{ fontWeight: 600 }}>{display ?? '—'}{outOfRange && ' ⚠'}</span>
          </div>
        })}
        {entry.note && <div style={{ marginTop: 10, padding: 10, background: 'var(--surface2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Note</div>
          {entry.note}
        </div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button onClick={remove} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: '#EF4444', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, cursor: 'pointer' }}>Elimina</button>
        <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Chiudi</button>
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
