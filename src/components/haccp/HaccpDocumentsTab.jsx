// HACCP → Documenti aziendali
// Archivio centralizzato di DVR / SCIA / manuale / manutenzioni / autorizzazioni
// con tracking scadenza + alert visivo (rosso < 30gg, giallo < 90gg).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

// Categorie predefinite (estendibili nel form con "Altro")
export const HACCP_CATEGORIES = [
  { key: 'dvr',                   label: 'DVR — Documento Valutazione Rischi',  color: '#EF4444' },
  { key: 'manuale_haccp',         label: 'Manuale HACCP',                        color: '#10B981' },
  { key: 'organigramma',          label: 'Organigramma sicurezza',               color: '#3B82F6' },
  { key: 'scia_commerciale',      label: 'SCIA commerciale',                     color: '#8B5CF6' },
  { key: 'scia_sanitaria',        label: 'SCIA sanitaria',                       color: '#8B5CF6' },
  { key: 'autorizzazioni',        label: 'Autorizzazioni / licenze',             color: '#8B5CF6' },
  { key: 'manutenzione_estintori',label: 'Manutenzione estintori',               color: '#F59E0B' },
  { key: 'manutenzione_cappe',    label: 'Manutenzione cappe / aspirazione',     color: '#F59E0B' },
  { key: 'manutenzione_impianti', label: 'Manutenzione impianti (elettrico/gas)',color: '#F59E0B' },
  { key: 'potabilita',            label: 'Certificato potabilità acqua',         color: '#06B6D4' },
  { key: 'disinfestazione',       label: 'Disinfestazione / derattizzazione',    color: '#06B6D4' },
  { key: 'contratti_servizi',     label: 'Contratti servizi (rifiuti, ecc.)',    color: '#64748B' },
  { key: 'altro',                 label: 'Altro',                                 color: '#64748B' },
]
const CAT_BY_KEY = Object.fromEntries(HACCP_CATEGORIES.map(c => [c.key, c]))

const ymd = (d) => d.toISOString().split('T')[0]
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

export default function HaccpDocumentsTab({ sps = [] }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | {} (nuovo) | doc obj
  const [filterCat, setFilterCat] = useState('')
  const [filterLocale, setFilterLocale] = useState('')
  const [filterScad, setFilterScad] = useState('')   // '' | 'scaduti' | 'in_scadenza' | 'attivi'
  const [search, setSearch] = useState('')

  const allLocali = useMemo(() => (sps || []).map(s => s.description || s.name).filter(Boolean), [sps])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('haccp_documents').select('*').order('scadenza', { ascending: true, nullsFirst: false })
    setDocs(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    return docs.filter(d => {
      if (filterCat && d.categoria !== filterCat) return false
      if (filterLocale === '__null__' && d.locale) return false
      if (filterLocale && filterLocale !== '__null__' && d.locale !== filterLocale) return false
      if (search && !`${d.titolo} ${d.responsabile||''} ${d.fornitore||''}`.toLowerCase().includes(search.toLowerCase())) return false
      const dt = daysTo(d.scadenza)
      if (filterScad === 'scaduti' && (dt == null || dt >= 0)) return false
      if (filterScad === 'in_scadenza' && (dt == null || dt < 0 || dt > 90)) return false
      if (filterScad === 'attivi' && (dt != null && dt < 0)) return false
      return true
    })
  }, [docs, filterCat, filterLocale, filterScad, search])

  const stats = useMemo(() => {
    let scaduti = 0, in_scadenza = 0, attivi = 0, no_scadenza = 0
    for (const d of docs) {
      const dt = daysTo(d.scadenza)
      if (dt == null) no_scadenza++
      else if (dt < 0) scaduti++
      else if (dt <= 90) in_scadenza++
      else attivi++
    }
    return { tot: docs.length, scaduti, in_scadenza, attivi, no_scadenza }
  }, [docs])

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {/* KPI */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <KPI label="Totale" value={stats.tot} accent="#3B82F6"/>
      <KPI label="Scaduti" value={stats.scaduti} accent="#EF4444" onClick={() => setFilterScad('scaduti')}/>
      <KPI label="In scadenza (90gg)" value={stats.in_scadenza} accent="#F59E0B" onClick={() => setFilterScad('in_scadenza')}/>
      <KPI label="Attivi" value={stats.attivi} accent="#10B981"/>
      <KPI label="Senza scadenza" value={stats.no_scadenza} accent="var(--text3)"/>
    </div>

    <Card title="Archivio documenti HACCP & sicurezza" badge={loading ? '…' : (filtered.length + ' di ' + docs.length)} extra={
      <button onClick={() => setEditing({})}
        style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        + Carica documento
      </button>
    }>
      {/* Filtri */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input placeholder="Cerca titolo, responsabile, fornitore…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...S.input, fontSize: 12, padding: '6px 10px', flex: '1 1 200px', minWidth: 180 }}/>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutte le categorie</option>
          {HACCP_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {allLocali.length > 0 && <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i locali</option>
          <option value="__null__">Solo aziendali (nessun locale)</option>
          {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
        </select>}
        <select value={filterScad} onChange={e => setFilterScad(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Qualsiasi stato</option>
          <option value="scaduti">Solo scaduti</option>
          <option value="in_scadenza">In scadenza (≤ 90gg)</option>
          <option value="attivi">Solo attivi</option>
        </select>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        {docs.length === 0 ? 'Nessun documento ancora caricato. Click "+ Carica documento" per iniziare.' : 'Nessun documento con questi filtri.'}
      </div>}

      {!loading && filtered.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Categoria', 'Titolo', 'Locale', 'Emesso', 'Scadenza', 'Responsabile', 'File', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(d => <DocRow key={d.id} doc={d} onEdit={() => setEditing(d)} onDelete={async () => {
              if (!confirm(`Eliminare "${d.titolo}"?`)) return
              if (d.file_path) await supabase.storage.from('documents').remove([d.file_path])
              await supabase.from('haccp_documents').delete().eq('id', d.id)
              await load()
            }}/>)}
          </tbody>
        </table>
      </div>}
    </Card>

    {editing != null && <DocEditor doc={editing} sps={sps}
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

function DocRow({ doc, onEdit, onDelete }) {
  const cat = CAT_BY_KEY[doc.categoria] || { label: doc.categoria, color: '#64748B' }
  const dt = daysTo(doc.scadenza)
  let scadColor = 'var(--text3)', scadLabel = '—', scadBg = 'transparent'
  if (dt != null) {
    if (dt < 0) { scadColor = '#EF4444'; scadLabel = `Scaduto ${Math.abs(dt)}gg fa`; scadBg = 'rgba(239,68,68,.1)' }
    else if (dt <= 30) { scadColor = '#EF4444'; scadLabel = `${dt}gg`; scadBg = 'rgba(239,68,68,.1)' }
    else if (dt <= 90) { scadColor = '#F59E0B'; scadLabel = `${dt}gg`; scadBg = 'rgba(245,158,11,.1)' }
    else { scadColor = '#10B981'; scadLabel = `${dt}gg` }
  }
  const downloadFile = async () => {
    if (!doc.file_path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  return <tr style={{ borderBottom: '1px solid var(--border)' }}>
    <td style={{ ...S.td }}>
      <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: cat.color + '22', color: cat.color, fontSize: 11, fontWeight: 600 }}>{cat.label}</span>
    </td>
    <td style={{ ...S.td, fontWeight: 600 }}>
      {doc.titolo}
      {doc.note && <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginTop: 2 }}>{doc.note}</div>}
    </td>
    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{doc.locale || <span style={{ color: 'var(--text3)' }}>aziendale</span>}</td>
    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{fmtDate(doc.data_emissione)}</td>
    <td style={{ ...S.td, fontSize: 12 }}>
      {doc.scadenza ? <>
        <div style={{ color: 'var(--text)' }}>{fmtDate(doc.scadenza)}</div>
        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: scadBg, color: scadColor, fontSize: 10, fontWeight: 700, marginTop: 2 }}>{scadLabel}</span>
      </> : <span style={{ color: 'var(--text3)' }}>non scade</span>}
    </td>
    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>
      {doc.responsabile || <span style={{ color: 'var(--text3)' }}>—</span>}
      {doc.fornitore && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{doc.fornitore}</div>}
    </td>
    <td style={{ ...S.td }}>
      {doc.file_path ? <button onClick={downloadFile} style={{ background: 'none', border: '1px solid var(--border)', color: '#3B82F6', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6, fontWeight: 600 }}>Apri</button> : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}
    </td>
    <td style={{ ...S.td }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onEdit} style={{ background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Modifica</button>
        <button onClick={onDelete} style={{ background: 'transparent', color: 'var(--red)', border: '1px solid rgba(220,38,38,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Elimina</button>
      </div>
    </td>
  </tr>
}

function DocEditor({ doc, sps, onClose, onSaved }) {
  const [f, setF] = useState({
    categoria: doc.categoria || 'dvr',
    titolo: doc.titolo || '',
    locale: doc.locale || '',
    data_emissione: doc.data_emissione || '',
    scadenza: doc.scadenza || '',
    responsabile: doc.responsabile || '',
    fornitore: doc.fornitore || '',
    note: doc.note || '',
  })
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)

  const save = async () => {
    setErr('')
    if (!f.titolo.trim()) { setErr('Titolo obbligatorio'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let filePath = doc.file_path || null
      if (file) {
        const ext = (file.name.split('.').pop() || 'bin').slice(0, 6)
        const path = `haccp/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file)
        if (upErr) throw upErr
        // Se sostituisco un file precedente, rimuovo il vecchio
        if (doc.file_path && doc.id) await supabase.storage.from('documents').remove([doc.file_path])
        filePath = path
      }
      const payload = {
        user_id: user.id,
        categoria: f.categoria,
        titolo: f.titolo.trim(),
        locale: f.locale || null,
        data_emissione: f.data_emissione || null,
        scadenza: f.scadenza || null,
        responsabile: f.responsabile || null,
        fornitore: f.fornitore || null,
        note: f.note || null,
        file_path: filePath,
        updated_at: new Date().toISOString(),
      }
      if (doc.id) {
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('haccp_documents').insert(payload)
        if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { ...S.input, width: '100%' }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 640, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{doc.id ? 'Modifica documento' : 'Carica nuovo documento HACCP'}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Categoria *">
          <select style={inp} value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })}>
            {HACCP_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Titolo *">
          <input style={inp} placeholder='es. "DVR 2026 - Casa De Amicis"' value={f.titolo} onChange={e => setF({ ...f, titolo: e.target.value })}/>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Locale (vuoto = generale)">
            <select style={inp} value={f.locale} onChange={e => setF({ ...f, locale: e.target.value })}>
              <option value="">— Aziendale (tutti i locali) —</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Data emissione">
            <input type="date" style={inp} value={f.data_emissione} onChange={e => setF({ ...f, data_emissione: e.target.value })}/>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Scadenza (vuoto = non scade)">
            <input type="date" style={inp} value={f.scadenza} onChange={e => setF({ ...f, scadenza: e.target.value })}/>
          </Field>
          <Field label="Responsabile / RSPP">
            <input style={inp} placeholder='es. "Mario Rossi RSPP"' value={f.responsabile} onChange={e => setF({ ...f, responsabile: e.target.value })}/>
          </Field>
        </div>
        <Field label="Fornitore (per manutenzioni esterne)">
          <input style={inp} placeholder='es. "GielleService srl"' value={f.fornitore} onChange={e => setF({ ...f, fornitore: e.target.value })}/>
        </Field>
        <Field label="Note">
          <textarea style={{ ...inp, minHeight: 60 }} value={f.note} onChange={e => setF({ ...f, note: e.target.value })}/>
        </Field>
        <Field label={doc.file_path ? `File caricato: ${doc.file_path.split('/').pop()}. Carica un nuovo file per sostituirlo:` : 'File (PDF, immagine, doc) — opzionale ma consigliato'}>
          <input type="file" accept="application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e => setFile(e.target.files?.[0] || null)} style={inp}/>
        </Field>
        {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Annulla</button>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {saving ? 'Salvo…' : (doc.id ? 'Salva modifiche' : 'Carica documento')}
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
