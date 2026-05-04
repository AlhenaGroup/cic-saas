// Campagne — backoffice. Crea segmenti, scrivi messaggio, invia o pianifica.
// Canali: email (Gmail già connesso), SMS / WhatsApp (Twilio).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'
import EmailBuilder from './EmailBuilder'

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

const CANALI = [
  { key: 'email',    label: 'Email',    sub: 'via Gmail collegato' },
  { key: 'sms',      label: 'SMS',      sub: 'via Twilio' },
  { key: 'whatsapp', label: 'WhatsApp', sub: 'via Twilio Business' },
]

const STATI = {
  draft:     { label: 'Bozza',         c: '#94A3B8' },
  scheduled: { label: 'Programmata',   c: '#3B82F6' },
  sending:   { label: 'In invio…',     c: '#F59E0B' },
  sent:      { label: 'Inviata',       c: '#10B981' },
  failed:    { label: 'Errore invio',  c: '#EF4444' },
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CampaignsManager({ sp, sps }) {
  const localesAvail = useMemo(() => { const raw = sps && sps.length ? sps.map(s => s.name) : ["REMEMBEER", "CASA DE AMICIS", "BIANCOLATTE", "LABORATORIO"]; return [...new Set(raw)] }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_camp_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_camp_locale', locale) }, [locale])

  const [list, setList] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [audPreview, setAudPreview] = useState(null)
  const [sending, setSending] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [cs, tg] = await Promise.all([
        api('/api/campaigns', { action: 'list', locale }),
        api('/api/tags',      { action: 'list', locale }),
      ])
      setList(cs.campaigns || [])
      setTags(tg.tags || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  const openNew = () => setEditing({
    locale,
    nome: '',
    canale: 'email',
    oggetto: '',
    contenuto: 'Ciao {nome}!\n\nUn saluto da {locale}.\n\nA presto.',
    blocks: [],
    segment_tag_ids: [],
    segment_tag_mode: 'any',
    segment_min_visite: 0,
    segment_giorni_inattivita: '',
    segment_solo_compleanno_mese: false,
    schedule_at: '',
    rispetta_gdpr: true,
    stato: 'draft',
  })

  const [emailMode, setEmailMode] = useState('builder')  // builder | text

  const onSave = async () => {
    if (!editing.nome?.trim()) return alert('Nome obbligatorio')
    if (!editing.contenuto?.trim()) return alert('Contenuto obbligatorio')
    if (editing.canale === 'email' && !editing.oggetto?.trim()) return alert('Oggetto obbligatorio per email')
    try {
      await api('/api/campaigns', { action: 'upsert', campaign: { ...editing, locale } })
      setEditing(null); setAudPreview(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async () => {
    if (!editing?.id) return
    if (!confirm('Eliminare la campagna? Lo storico messaggi verrà cancellato.')) return
    try {
      await api('/api/campaigns', { action: 'delete', id: editing.id })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const previewAudience = useCallback(async () => {
    if (!editing) return
    try {
      const r = await api('/api/campaigns', { action: 'preview-audience', campaign: { ...editing, locale } })
      setAudPreview(r)
    } catch (e) { alert('Errore preview: ' + e.message) }
  }, [editing, locale])

  // auto-preview on segment change
  useEffect(() => {
    if (!editing) return
    const t = setTimeout(previewAudience, 400)
    return () => clearTimeout(t)
  }, [
    editing?.canale, editing?.segment_tag_mode, editing?.segment_min_visite,
    editing?.segment_giorni_inattivita, editing?.segment_solo_compleanno_mese,
    editing?.rispetta_gdpr, JSON.stringify(editing?.segment_tag_ids || []),
  ])

  const sendNow = async () => {
    if (!editing?.id) return alert('Salva prima la campagna')
    if (!confirm(`Invio reale a ${audPreview?.count || '?'} destinatari. Procedere?`)) return
    setSending(true)
    try {
      const r = await api('/api/campaigns', { action: 'send-now', id: editing.id })
      alert(`Inviati ${r.inviati}/${r.totale} (errori: ${r.falliti})`)
      setEditing(null); reload()
    } catch (e) { alert('Errore invio: ' + e.message) }
    finally { setSending(false) }
  }

  // ── UI ──────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Campagne</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· email · SMS · WhatsApp</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={openNew} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuova campagna</button>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: '#64748b', fontSize: 13 }}>
        Nessuna campagna ancora. Crea la prima per inviare email/SMS/WhatsApp ai clienti segmentati.
      </div>
    )}

    {!loading && list.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {list.map(c => {
          const s = STATI[c.stato] || { label: c.stato, c: '#94A3B8' }
          return <div key={c.id} onClick={() => setEditing({ ...c, segment_giorni_inattivita: c.segment_giorni_inattivita ?? '' })} style={{
            background: '#0f1420', border: '1px solid #2a3042', borderRadius: 10, padding: 14, cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ background: s.c + '22', color: s.c, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{s.label}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>{c.canale}</span>
              <div style={{ flex: 1 }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{c.nome}</div>
            {c.oggetto && <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>{c.oggetto}</div>}
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
              {c.stato === 'sent' ? `Inviati ${c.inviati}/${c.destinatari_totali} · ${fmtDateTime(c.sent_at)}`
                : c.schedule_at ? `Programmata: ${fmtDateTime(c.schedule_at)}`
                : 'Non ancora inviata'}
            </div>
            {c.canale === 'email' && c.stato === 'sent' && c.inviati > 0 && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
                <span style={{ color: '#10B981' }}>
                  Aperti: <b>{c.aperti || 0}</b> ({Math.round(((c.aperti || 0) / c.inviati) * 100)}%)
                </span>
                <span style={{ color: '#3B82F6' }}>
                  Click: <b>{c.click || 0}</b> ({Math.round(((c.click || 0) / c.inviati) * 100)}%)
                </span>
              </div>
            )}
          </div>
        })}
      </div>
    )}

    {/* Drawer */}
    {editing && <Drawer onClose={() => { setEditing(null); setAudPreview(null) }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica campagna' : 'Nuova campagna'}</h3>

      <Field label="Nome interno"><input value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} placeholder="es. Promo dormienti aprile" style={S.input} /></Field>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Canale</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CANALI.map(c => <button key={c.key} onClick={() => setEditing({ ...editing, canale: c.key })} style={tabBtn(editing.canale === c.key)}>
            <div>{c.label}</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>{c.sub}</div>
          </button>)}
        </div>
      </div>

      {editing.canale === 'email' && <div style={{ marginTop: 12 }}>
        <Field label="Oggetto email"><input value={editing.oggetto || ''} onChange={e => setEditing({ ...editing, oggetto: e.target.value })} style={S.input} /></Field>
      </div>}

      {editing.canale === 'email' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setEmailMode('builder')} style={tabBtnSm(emailMode === 'builder')}>🎨 Builder visuale</button>
            <button onClick={() => setEmailMode('text')} style={tabBtnSm(emailMode === 'text')}>📝 Testo semplice</button>
          </div>
          {emailMode === 'builder' ? (
            <EmailBuilder
              blocks={editing.blocks || []}
              meta={editing.meta || {}}
              onChange={({ blocks, meta }) => setEditing({ ...editing, blocks, meta })}
            />
          ) : (
            <Field label="Messaggio · placeholder: {nome} {cognome} {locale} {punti}">
              <textarea value={editing.contenuto} onChange={e => setEditing({ ...editing, contenuto: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 110, fontFamily: 'inherit' }} />
            </Field>
          )}
        </div>
      )}

      {editing.canale !== 'email' && (
        <div style={{ marginTop: 12 }}>
          <Field label="Messaggio · placeholder: {nome} {cognome} {locale} {punti}">
            <textarea value={editing.contenuto} onChange={e => setEditing({ ...editing, contenuto: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 110, fontFamily: 'inherit' }} />
          </Field>
        </div>
      )}

      <Section title="Segmento target">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {tags.map(t => {
            const sel = (editing.segment_tag_ids || []).includes(t.id)
            return <button key={t.id} onClick={() => {
              const cur = editing.segment_tag_ids || []
              setEditing({ ...editing, segment_tag_ids: sel ? cur.filter(x => x !== t.id) : [...cur, t.id] })
            }} style={{
              ...btn(sel ? t.colore + '22' : '#0f1420', sel ? t.colore : '#94a3b8', sel ? t.colore + '88' : '#2a3042'),
              fontSize: 12, padding: '4px 10px',
            }}>{t.nome}</button>
          })}
        </div>
        {(editing.segment_tag_ids || []).length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setEditing({ ...editing, segment_tag_mode: 'any' })} style={tabBtnSm(editing.segment_tag_mode === 'any')}>Almeno uno dei tag</button>
            <button onClick={() => setEditing({ ...editing, segment_tag_mode: 'all' })} style={tabBtnSm(editing.segment_tag_mode === 'all')}>Tutti i tag</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Inattivi da (giorni)"><input type="number" value={editing.segment_giorni_inattivita || ''} onChange={e => setEditing({ ...editing, segment_giorni_inattivita: e.target.value })} placeholder="es. 60" style={S.input} /></Field>
          <Field label="Min visite"><input type="number" value={editing.segment_min_visite || 0} onChange={e => setEditing({ ...editing, segment_min_visite: Number(e.target.value || 0) })} style={S.input} /></Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
          <input type="checkbox" checked={!!editing.segment_solo_compleanno_mese} onChange={e => setEditing({ ...editing, segment_solo_compleanno_mese: e.target.checked })} />
          Solo clienti col compleanno questo mese
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 6 }}>
          <input type="checkbox" checked={!!editing.rispetta_gdpr} onChange={e => setEditing({ ...editing, rispetta_gdpr: e.target.checked })} />
          Solo clienti col consenso marketing (GDPR)
        </label>

        {audPreview && <div style={{ marginTop: 12, padding: 10, background: '#1a1f2e', borderRadius: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>{audPreview.count} destinatari</div>
          {audPreview.sample?.length > 0 && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            Anteprima: {audPreview.sample.map(s => [s.nome, s.cognome].filter(Boolean).join(' ') || s.email || s.telefono).join(', ')}{audPreview.count > audPreview.sample.length ? '…' : ''}
          </div>}
        </div>}
      </Section>

      <Section title="Programmazione">
        <Field label="Data e ora invio (vuoto = invio manuale immediato)">
          <input type="datetime-local" value={editing.schedule_at ? new Date(editing.schedule_at).toISOString().slice(0, 16) : ''}
            onChange={e => setEditing({ ...editing, schedule_at: e.target.value ? new Date(e.target.value).toISOString() : null })} style={S.input} />
        </Field>
      </Section>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        {editing.id && <button onClick={onDelete} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>Elimina</button>}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setEditing(null); setAudPreview(null) }} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
        {editing.id && editing.stato !== 'sent' && editing.stato !== 'sending' && (
          <button onClick={sendNow} disabled={sending} style={btn(sending ? '#64748b' : '#10B981', '#0f1420', sending ? '#64748b' : '#10B981')}>
            {sending ? 'Invio…' : 'Invia ora'}
          </button>
        )}
      </div>
    </Drawer>}
  </div>
}

function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}
function tabBtn(active) {
  return {
    padding: '8px 14px', fontSize: 12, fontWeight: 600, textAlign: 'left',
    background: active ? '#F59E0B' : '#0f1420', color: active ? '#0f1420' : '#cbd5e1',
    border: '1px solid ' + (active ? '#F59E0B' : '#2a3042'), borderRadius: 6, cursor: 'pointer', flex: 1, minWidth: 100,
  }
}
function tabBtnSm(active) {
  return {
    padding: '5px 10px', fontSize: 11, fontWeight: 600,
    background: active ? '#F59E0B' : '#0f1420', color: active ? '#0f1420' : '#cbd5e1',
    border: '1px solid ' + (active ? '#F59E0B' : '#2a3042'), borderRadius: 5, cursor: 'pointer',
  }
}
function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}
function Section({ title, children }) {
  return <div style={{ marginTop: 14, padding: 12, background: '#0f1420', borderRadius: 8, border: '1px solid #2a3042' }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
    {children}
  </div>
}
function Drawer({ children, onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(1100px, 100%)', height: '100%', background: '#1a1f2e', padding: 20, overflowY: 'auto', borderLeft: '1px solid #2a3042' }}>
      {children}
    </div>
  </div>
}
