// CRM Clienti — lista + filtri + drawer edit + gestione tag.
// Backoffice: l'utente crea/modifica clienti e tag. Il POS legge tutto via /api/customers.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'
import TagsManager from './TagsManager'

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

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

const Pill = ({ tag, onRemove }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: tag.colore + '22', color: tag.colore,
    border: '1px solid ' + tag.colore + '55',
    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
  }}>
    {tag.nome}
    {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove() }} style={{ cursor: 'pointer', opacity: 0.7 }}>×</span>}
  </span>
)

export default function CustomersManager({ sp, sps }) {
  const localesAvail = useMemo(() => (sps && sps.length ? sps.map(s => s.name) : ['REMEMBEER', 'CASA DE AMICIS', 'BIANCOLATTE', 'LABORATORIO']), [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_clienti_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_clienti_locale', locale) }, [locale])

  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [list, setList] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(null)  // cliente in editing (drawer)
  const [showTagsModal, setShowTagsModal] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [tg, cs] = await Promise.all([
        api('/api/tags', { action: 'list', locale }),
        api('/api/customers', { action: 'list', locale, search, tag_id: tagFilter || null }),
      ])
      setTags(tg.tags || [])
      setList(cs.customers || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale, search, tagFilter])

  useEffect(() => { reload() }, [reload])

  // ── Drawer/form edit cliente ─────────────────────────────────────
  const openNew = () => setEditing({
    locale, nome: '', cognome: '', telefono: '', email: '', data_nascita: '', note: '',
    gdpr_marketing: false, gdpr_profilazione: false, source: 'manual',
  })

  const onSave = async () => {
    if (!editing) return
    try {
      await api('/api/customers', { action: 'upsert', customer: { ...editing, locale } })
      setEditing(null)
      reload()
    } catch (e) { alert('Errore salvataggio: ' + e.message) }
  }

  const onDelete = async () => {
    if (!editing?.id) return
    if (!confirm('Eliminare definitivamente questo cliente?')) return
    try {
      await api('/api/customers', { action: 'delete', id: editing.id })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const toggleTag = async (cust, tag) => {
    const has = (cust.customer_tags || []).some(ct => ct.tag_id === tag.id)
    try {
      if (has) await api('/api/customers', { action: 'tag-remove', customer_id: cust.id, tag_id: tag.id })
      else     await api('/api/customers', { action: 'tag-assign', customer_id: cust.id, tag_id: tag.id })
      reload()
      if (editing?.id === cust.id) {
        const r = await api('/api/customers', { action: 'get', id: cust.id })
        setEditing(prev => ({ ...prev, customer_tags: r.customer?.customer_tags || [] }))
      }
    } catch (e) { alert('Errore tag: ' + e.message) }
  }

  // ── UI ─────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Clienti</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· {list.length} totali</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={() => setShowTagsModal(true)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Gestisci tag</button>
      <button onClick={openNew} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuovo cliente</button>
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <input placeholder="Cerca per nome, telefono, email..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...S.input, flex: 1, minWidth: 260 }} />
      <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        <option value="">Tutti i tag</option>
        {tags.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
      </select>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: '#64748b', fontSize: 13 }}>
        Nessun cliente trovato. Clicca "+ Nuovo cliente" per crearne uno, oppure il POS registrerà i clienti automaticamente al checkout.
      </div>
    )}

    {!loading && list.length > 0 && (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0f1420' }}>
              <th style={S.th}>Nome</th>
              <th style={S.th}>Telefono</th>
              <th style={S.th}>Email</th>
              <th style={S.th}>Tag</th>
              <th style={S.th}>Ultima visita</th>
              <th style={S.th}>Sorgente</th>
            </tr>
          </thead>
          <tbody>
            {list.map(c => (
              <tr key={c.id} onClick={() => setEditing(c)} style={{ cursor: 'pointer' }}>
                <td style={S.td}>{[c.nome, c.cognome].filter(Boolean).join(' ') || <span style={{ color: '#64748b' }}>(senza nome)</span>}</td>
                <td style={S.td}>{c.telefono || '—'}</td>
                <td style={S.td}>{c.email || '—'}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(c.customer_tags || []).map(ct => ct.tag_definitions && <Pill key={ct.tag_id} tag={ct.tag_definitions} />)}
                  </div>
                </td>
                <td style={S.td}>{fmtDate(c.last_seen_at)}</td>
                <td style={S.td}><span style={{ fontSize: 11, color: '#94a3b8' }}>{c.source || '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {/* Drawer edit */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica cliente' : 'Nuovo cliente'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Nome"><input value={editing.nome || ''} onChange={e => setEditing({ ...editing, nome: e.target.value })} style={S.input} /></Field>
        <Field label="Cognome"><input value={editing.cognome || ''} onChange={e => setEditing({ ...editing, cognome: e.target.value })} style={S.input} /></Field>
        <Field label="Telefono"><input value={editing.telefono || ''} onChange={e => setEditing({ ...editing, telefono: e.target.value })} placeholder="+393331234567" style={S.input} /></Field>
        <Field label="Email"><input value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} style={S.input} /></Field>
        <Field label="Data nascita"><input type="date" value={editing.data_nascita || ''} onChange={e => setEditing({ ...editing, data_nascita: e.target.value })} style={S.input} /></Field>
        <Field label="Lingua"><select value={editing.lingua || 'it'} onChange={e => setEditing({ ...editing, lingua: e.target.value })} style={S.input}>
          <option value="it">Italiano</option><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option>
        </select></Field>
      </div>

      <Field label="Note"><textarea value={editing.note || ''} onChange={e => setEditing({ ...editing, note: e.target.value })} style={{ ...S.input, minHeight: 60, fontFamily: 'inherit' }} /></Field>

      {editing.id && <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Tag</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => {
            const has = (editing.customer_tags || []).some(ct => ct.tag_id === t.id)
            return <button key={t.id} onClick={() => toggleTag(editing, t)} style={{
              ...btn(has ? t.colore + '22' : '#0f1420', has ? t.colore : '#94a3b8', has ? t.colore + '88' : '#2a3042'),
              fontSize: 12, padding: '4px 10px',
            }}>{t.nome}</button>
          })}
        </div>
      </div>}

      <div style={{ marginTop: 16, padding: 12, background: '#0f1420', borderRadius: 8, border: '1px solid #2a3042' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>Consensi GDPR</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
          <input type="checkbox" checked={!!editing.gdpr_marketing} onChange={e => setEditing({ ...editing, gdpr_marketing: e.target.checked })} />
          Comunicazioni marketing (email/SMS/WhatsApp)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!editing.gdpr_profilazione} onChange={e => setEditing({ ...editing, gdpr_profilazione: e.target.checked })} />
          Profilazione e analisi comportamentale
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        {editing.id && <button onClick={onDelete} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>Elimina</button>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
      </div>
    </Drawer>}

    {/* Modal gestione tag */}
    {showTagsModal && <TagsManager locale={locale} onClose={() => { setShowTagsModal(false); reload() }} />}
  </div>
}

// ── helpers ─────────────────────────────────────────────────────
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
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100%)', height: '100%', background: '#1a1f2e', padding: 20, overflowY: 'auto', borderLeft: '1px solid #2a3042' }}>
      {children}
    </div>
  </div>
}
