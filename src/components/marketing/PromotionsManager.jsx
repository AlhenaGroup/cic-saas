// Promozioni — backoffice CRM. La dashboard configura, il POS scansiona/digita il codice.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'

async function api(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'API error')
  return j
}

const TIPI_SCONTO = [
  { key: 'percentuale', label: 'Percentuale (%)' },
  { key: 'fisso',       label: 'Importo fisso (€)' },
  { key: 'omaggio',     label: 'Omaggio' },
  { key: 'menu_speciale', label: 'Menu speciale' },
]
const GIORNI = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

function fmtSconto(p) {
  if (p.tipo_sconto === 'percentuale') return `-${Number(p.valore_sconto)}%`
  if (p.tipo_sconto === 'fisso')       return `-${Number(p.valore_sconto).toFixed(2)} €`
  if (p.tipo_sconto === 'omaggio')     return 'Omaggio'
  if (p.tipo_sconto === 'menu_speciale') return 'Menu'
  return '—'
}

function fmtValidita(p) {
  const parts = []
  if (p.data_inizio || p.data_fine) {
    parts.push(`${p.data_inizio || '—'} → ${p.data_fine || '—'}`)
  }
  if (p.giorni_settimana && p.giorni_settimana.length) {
    parts.push(p.giorni_settimana.map(d => GIORNI[d]).join(' '))
  }
  if (p.ora_inizio || p.ora_fine) {
    parts.push(`${(p.ora_inizio || '00:00').slice(0, 5)}-${(p.ora_fine || '23:59').slice(0, 5)}`)
  }
  return parts.length ? parts.join(' · ') : 'Sempre attiva'
}

export default function PromotionsManager({ sp, sps }) {
  const localesAvail = useMemo(() => { const raw = sps && sps.length ? sps.map(s => s.name) : ["REMEMBEER", "CASA DE AMICIS", "BIANCOLATTE", "LABORATORIO"]; return [...new Set(raw)] }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_promo_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_promo_locale', locale) }, [locale])

  const [list, setList] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [pr, tg] = await Promise.all([
        api('/api/promotions', { action: 'list', locale }),
        api('/api/tags',       { action: 'list', locale }),
      ])
      setList(pr.promotions || [])
      setTags(tg.tags || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  const openNew = () => setEditing({
    locale,
    codice: '',
    nome: '',
    descrizione: '',
    tipo_sconto: 'percentuale',
    valore_sconto: 10,
    importo_minimo: 0,
    target_tag_ids: [],
    target_min_visite: 0,
    giorni_settimana: [],
    max_utilizzi: '',
    max_utilizzi_per_cliente: 1,
    attivo: true,
  })

  const onSave = async () => {
    if (!editing) return
    if (!editing.codice?.trim()) return alert('Codice obbligatorio')
    if (!editing.nome?.trim()) return alert('Nome obbligatorio')
    try {
      await api('/api/promotions', { action: 'upsert', promotion: { ...editing, locale } })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async () => {
    if (!editing?.id) return
    if (!confirm('Eliminare la promozione? Lo storico utilizzi verrà eliminato.')) return
    try {
      await api('/api/promotions', { action: 'delete', id: editing.id })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onToggle = async (p) => {
    try {
      await api('/api/promotions', { action: 'toggle', id: p.id, attivo: !p.attivo })
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const tagsById = Object.fromEntries(tags.map(t => [t.id, t]))

  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Promozioni</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· {list.length} totali · {list.filter(p => p.attivo).length} attive</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={openNew} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuova promozione</button>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: '#64748b', fontSize: 13 }}>
        Nessuna promozione. Crea il primo codice — il POS lo riconoscerà automaticamente alla scansione.
      </div>
    )}

    {!loading && list.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {list.map(p => (
          <div key={p.id} onClick={() => setEditing(p)} style={{
            background: '#0f1420', border: '1px solid ' + (p.attivo ? '#F59E0B55' : '#2a3042'),
            borderRadius: 10, padding: 14, cursor: 'pointer', position: 'relative'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <code style={{ background: '#F59E0B22', color: '#F59E0B', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{p.codice}</code>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{p.nome}</span>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
                background: p.attivo ? '#10B98122' : '#94A3B822',
                color: p.attivo ? '#10B981' : '#94A3B8',
              }}>{p.attivo ? 'ATTIVA' : 'OFF'}</span>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 6 }}>{fmtSconto(p)} {p.importo_minimo > 0 && <span style={{ color: '#64748b' }}>(min {p.importo_minimo}€)</span>}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{fmtValidita(p)}</div>
            {p.target_tag_ids?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {p.target_tag_ids.map(tid => tagsById[tid] && (
                  <span key={tid} style={{
                    background: tagsById[tid].colore + '22', color: tagsById[tid].colore,
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999
                  }}>{tagsById[tid].nome}</span>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
              Utilizzi: {p.utilizzi_totali}{p.max_utilizzi ? `/${p.max_utilizzi}` : ''}
            </div>
            <button onClick={(e) => { e.stopPropagation(); onToggle(p) }} style={{
              position: 'absolute', top: 10, right: 10, width: 16, height: 16, padding: 0,
              background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 11,
            }} title={p.attivo ? 'Disattiva' : 'Attiva'}>{p.attivo ? '⏸' : '▶'}</button>
          </div>
        ))}
      </div>
    )}

    {/* Drawer crea/modifica */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica promozione' : 'Nuova promozione'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Codice (univoco, scan POS)"><input value={editing.codice} onChange={e => setEditing({ ...editing, codice: e.target.value.toUpperCase() })} placeholder="ESTATE25" style={S.input} /></Field>
        <Field label="Nome"><input value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} placeholder="Sconto estate" style={S.input} /></Field>
      </div>
      <Field label="Descrizione (opz)"><textarea value={editing.descrizione || ''} onChange={e => setEditing({ ...editing, descrizione: e.target.value })} style={{ ...S.input, minHeight: 50, fontFamily: 'inherit' }} /></Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <Field label="Tipo sconto"><select value={editing.tipo_sconto} onChange={e => setEditing({ ...editing, tipo_sconto: e.target.value })} style={S.input}>
          {TIPI_SCONTO.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select></Field>
        <Field label={editing.tipo_sconto === 'percentuale' ? 'Valore (%)' : 'Valore (€)'}>
          <input type="number" step="0.01" value={editing.valore_sconto} onChange={e => setEditing({ ...editing, valore_sconto: e.target.value })} style={S.input} />
        </Field>
        <Field label="Spesa minima (€)"><input type="number" step="0.01" value={editing.importo_minimo} onChange={e => setEditing({ ...editing, importo_minimo: e.target.value })} style={S.input} /></Field>
        <Field label="Max utilizzi totali (vuoto = ∞)"><input type="number" value={editing.max_utilizzi || ''} onChange={e => setEditing({ ...editing, max_utilizzi: e.target.value })} style={S.input} /></Field>
        <Field label="Max utilizzi per cliente"><input type="number" value={editing.max_utilizzi_per_cliente} onChange={e => setEditing({ ...editing, max_utilizzi_per_cliente: Number(e.target.value || 1) })} style={S.input} /></Field>
        <Field label="Min visite cliente"><input type="number" value={editing.target_min_visite} onChange={e => setEditing({ ...editing, target_min_visite: Number(e.target.value || 0) })} style={S.input} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Validità temporale</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Data inizio"><input type="date" value={editing.data_inizio || ''} onChange={e => setEditing({ ...editing, data_inizio: e.target.value })} style={S.input} /></Field>
          <Field label="Data fine"><input type="date" value={editing.data_fine || ''} onChange={e => setEditing({ ...editing, data_fine: e.target.value })} style={S.input} /></Field>
          <Field label="Ora inizio"><input type="time" value={editing.ora_inizio || ''} onChange={e => setEditing({ ...editing, ora_inizio: e.target.value })} style={S.input} /></Field>
          <Field label="Ora fine"><input type="time" value={editing.ora_fine || ''} onChange={e => setEditing({ ...editing, ora_fine: e.target.value })} style={S.input} /></Field>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>Giorni della settimana (vuoto = tutti)</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {GIORNI.map((g, i) => {
              const sel = (editing.giorni_settimana || []).includes(i)
              return <button key={i} onClick={() => {
                const cur = editing.giorni_settimana || []
                setEditing({ ...editing, giorni_settimana: sel ? cur.filter(x => x !== i) : [...cur, i].sort() })
              }} style={{
                ...btn(sel ? '#F59E0B' : '#0f1420', sel ? '#0f1420' : '#cbd5e1', sel ? '#F59E0B' : '#2a3042'),
                width: 50, padding: '6px 0',
              }}>{g}</button>
            })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Targeting (vuoto = tutti i clienti)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => {
            const sel = (editing.target_tag_ids || []).includes(t.id)
            return <button key={t.id} onClick={() => {
              const cur = editing.target_tag_ids || []
              setEditing({ ...editing, target_tag_ids: sel ? cur.filter(x => x !== t.id) : [...cur, t.id] })
            }} style={{
              ...btn(sel ? t.colore + '22' : '#0f1420', sel ? t.colore : '#94a3b8', sel ? t.colore + '88' : '#2a3042'),
              fontSize: 12, padding: '4px 10px',
            }}>{t.nome}</button>
          })}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!editing.attivo} onChange={e => setEditing({ ...editing, attivo: e.target.checked })} />
          Promozione attiva (riconosciuta dal POS)
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        {editing.id && <button onClick={onDelete} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>Elimina</button>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
      </div>
    </Drawer>}
  </div>
}

function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}

function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}

function Drawer({ children, onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(620px, 100%)', height: '100%', background: '#1a1f2e', padding: 20, overflowY: 'auto', borderLeft: '1px solid #2a3042' }}>
      {children}
    </div>
  </div>
}
