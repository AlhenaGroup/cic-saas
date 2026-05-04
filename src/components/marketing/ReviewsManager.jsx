// Recensioni — feed unificato + risposta AI con tone-of-voice del locale.
// Per ora ingestion manuale (paste). Sync Google/TripAdvisor in fase futura.

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

const SORGENTI = [
  { key: 'google',      label: 'Google',     c: '#4285F4' },
  { key: 'tripadvisor', label: 'TripAdvisor', c: '#00AA6C' },
  { key: 'sondaggio',   label: 'Sondaggio',  c: '#8B5CF6' },
  { key: 'manuale',     label: 'Manuale',    c: '#94A3B8' },
]

function votoColor(v) {
  if (v == null) return '#94A3B8'
  if (v >= 4) return '#10B981'
  if (v >= 3) return '#F59E0B'
  return '#EF4444'
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Stars({ v }) {
  const value = v || 0
  return <span style={{ color: votoColor(v), fontSize: 14, letterSpacing: 1 }}>
    {'★'.repeat(value)}<span style={{ color: '#2a3042' }}>{'★'.repeat(5 - value)}</span>
  </span>
}

export default function ReviewsManager({ sp, sps }) {
  const localesAvail = useMemo(() => { const raw = sps && sps.length ? sps.map(s => s.name) : ["REMEMBEER", "CASA DE AMICIS", "BIANCOLATTE", "LABORATORIO"]; return [...new Set(raw)] }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_rev_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_rev_locale', locale) }, [locale])

  const [list, setList] = useState([])
  const [kpi, setKpi] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [filterVoto, setFilterVoto] = useState('')
  const [filterSorgente, setFilterSorgente] = useState('')
  const [onlyNoReply, setOnlyNoReply] = useState(false)

  const [editing, setEditing] = useState(null)
  const [editingSettings, setEditingSettings] = useState(null)
  const [generating, setGenerating] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [ls, kp, st] = await Promise.all([
        api('/api/reviews', { action: 'list', locale, voto: filterVoto || null, sorgente: filterSorgente || null, only_no_reply: onlyNoReply }),
        api('/api/reviews', { action: 'kpi', locale }),
        api('/api/reviews', { action: 'settings-get', locale }),
      ])
      setList(ls.reviews || [])
      setKpi(kp.kpi || null)
      setSettings(st.settings || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale, filterVoto, filterSorgente, onlyNoReply])

  useEffect(() => { reload() }, [reload])

  const openNew = () => setEditing({
    locale,
    sorgente: 'manuale',
    autore: '',
    voto: 5,
    testo: '',
    data_pubblicazione: new Date().toISOString().slice(0, 16),
    url: '',
  })

  const onSave = async () => {
    if (!editing.testo?.trim() && !editing.voto) return alert('Almeno voto o testo')
    try {
      const payload = {
        ...editing,
        data_pubblicazione: editing.data_pubblicazione ? new Date(editing.data_pubblicazione).toISOString() : null,
      }
      await api('/api/reviews', { action: 'upsert', review: payload })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onArchive = async () => {
    if (!editing?.id) return
    try {
      await api('/api/reviews', { action: 'archive', id: editing.id, archiviata: true })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async () => {
    if (!editing?.id) return
    if (!confirm('Eliminare la recensione?')) return
    try {
      await api('/api/reviews', { action: 'delete', id: editing.id })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const generateReply = async () => {
    if (!editing?.id) return alert('Salva prima la recensione')
    setGenerating(true)
    try {
      const r = await api('/api/reviews', { action: 'generate-reply', id: editing.id, locale })
      setEditing({ ...editing, reply_draft: r.reply_draft })
    } catch (e) { alert('Errore AI: ' + e.message) }
    finally { setGenerating(false) }
  }

  const publishReply = async () => {
    const text = editing?.reply_draft || editing?.risposta
    if (!text?.trim()) return alert('Nessun testo da pubblicare')
    if (!confirm('Marcare come pubblicata? Dovrai poi copiarla manualmente sulla piattaforma di origine (Google, TripAdvisor).')) return
    try {
      await api('/api/reviews', { action: 'publish-reply', id: editing.id, risposta: text })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── Settings ──────────────────────────────────────────────────────
  const openSettings = () => setEditingSettings(settings ? { ...settings } : {
    locale,
    tone_of_voice: 'Cordiale, professionale, italiano. Ringrazia sempre il cliente, sii empatico ma sintetico (max 4 frasi).',
    firma: '',
    auto_draft: true,
    google_place_id: '',
    tripadvisor_url: '',
  })

  const saveSettings = async () => {
    try {
      await api('/api/reviews', { action: 'settings-upsert', settings: { ...editingSettings, locale } })
      setEditingSettings(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── UI ──────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Recensioni</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· feed + risposta AI</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={openSettings} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Tone & impostazioni</button>
      <button onClick={openNew} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Aggiungi recensione</button>
    </div>

    {/* KPI */}
    {kpi && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
      <KPI label="Totali" value={kpi.totale} />
      <KPI label="Voto medio" value={kpi.media || '—'} accent={votoColor(kpi.media)} />
      <KPI label="Senza risposta" value={kpi.senzaRisposta} accent={kpi.senzaRisposta > 0 ? '#F59E0B' : '#10B981'} />
      <KPI label="Risposte pubblicate" value={kpi.conRisposta} accent="#10B981" />
      <KPI label="Negative (1-2★)" value={kpi.negative} accent={kpi.negative > 0 ? '#EF4444' : '#94A3B8'} />
    </div>}

    {/* Filtri */}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
      <select value={filterVoto} onChange={e => setFilterVoto(e.target.value ? Number(e.target.value) : '')} style={{ ...S.input, padding: '7px 10px' }}>
        <option value="">Tutti i voti</option>
        {[5, 4, 3, 2, 1].map(v => <option key={v} value={v}>{v} ★</option>)}
      </select>
      <select value={filterSorgente} onChange={e => setFilterSorgente(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        <option value="">Tutte le sorgenti</option>
        {SORGENTI.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' }}>
        <input type="checkbox" checked={onlyNoReply} onChange={e => setOnlyNoReply(e.target.checked)} />
        Solo senza risposta
      </label>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: '#64748b', fontSize: 13 }}>
        Nessuna recensione. Aggiungile manualmente (paste da Google/TripAdvisor) — l'AI ti aiuterà a rispondere.
      </div>
    )}

    {!loading && list.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map(r => {
          const src = SORGENTI.find(s => s.key === r.sorgente) || SORGENTI[3]
          return <div key={r.id} onClick={() => setEditing({ ...r, data_pubblicazione: r.data_pubblicazione ? new Date(r.data_pubblicazione).toISOString().slice(0, 16) : '' })} style={{
            background: '#0f1420', border: '1px solid ' + (r.risposta ? '#2a3042' : '#F59E0B55'),
            borderRadius: 10, padding: 14, cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ background: src.c + '22', color: src.c, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{src.label}</span>
              <Stars v={r.voto} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.autore || '(anonimo)'}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>{fmtDateTime(r.data_pubblicazione)}</span>
              {!r.risposta && <span style={{ background: '#F59E0B22', color: '#F59E0B', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>DA RISPONDERE</span>}
            </div>
            {r.testo && <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: r.risposta ? 8 : 0 }}>{r.testo}</div>}
            {r.risposta && <div style={{ marginTop: 8, padding: 10, background: '#1a1f2e', borderRadius: 6, borderLeft: '3px solid #10B981', fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ fontSize: 10, color: '#10B981', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Risposta · {fmtDateTime(r.risposta_at)}</div>
              {r.risposta}
            </div>}
            {!r.risposta && r.reply_draft && <div style={{ marginTop: 8, padding: 10, background: '#1a1f2e', borderRadius: 6, borderLeft: '3px solid #F59E0B', fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ fontSize: 10, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Bozza AI</div>
              {r.reply_draft}
            </div>}
          </div>
        })}
      </div>
    )}

    {/* Drawer recensione */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Recensione' : 'Aggiungi recensione'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Sorgente"><select value={editing.sorgente} onChange={e => setEditing({ ...editing, sorgente: e.target.value })} style={S.input}>
          {SORGENTI.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select></Field>
        <Field label="Voto"><select value={editing.voto || ''} onChange={e => setEditing({ ...editing, voto: e.target.value ? Number(e.target.value) : null })} style={S.input}>
          <option value="">—</option>
          {[5, 4, 3, 2, 1].map(v => <option key={v} value={v}>{v} ★</option>)}
        </select></Field>
        <Field label="Autore"><input value={editing.autore || ''} onChange={e => setEditing({ ...editing, autore: e.target.value })} style={S.input} /></Field>
        <Field label="Data pubblicazione"><input type="datetime-local" value={editing.data_pubblicazione || ''} onChange={e => setEditing({ ...editing, data_pubblicazione: e.target.value })} style={S.input} /></Field>
      </div>

      <Field label="URL recensione (opz)"><input value={editing.url || ''} onChange={e => setEditing({ ...editing, url: e.target.value })} style={{ ...S.input, width: '100%' }} /></Field>

      <div style={{ marginTop: 10 }}>
        <Field label="Testo recensione">
          <textarea value={editing.testo || ''} onChange={e => setEditing({ ...editing, testo: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 90, fontFamily: 'inherit' }} />
        </Field>
      </div>

      {editing.id && <div style={{ marginTop: 14, padding: 12, background: '#0f1420', borderRadius: 8, border: '1px solid #2a3042' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '.06em' }}>Risposta</div>
          <div style={{ flex: 1 }} />
          {!editing.risposta && <button onClick={generateReply} disabled={generating} style={btn(generating ? '#64748b' : '#8B5CF6', '#fff', generating ? '#64748b' : '#8B5CF6')}>
            {generating ? 'Generazione…' : '✨ Genera con AI'}
          </button>}
        </div>
        {editing.risposta ? (
          <div style={{ padding: 10, background: '#1a1f2e', borderRadius: 6, borderLeft: '3px solid #10B981', fontSize: 13, color: '#cbd5e1' }}>
            {editing.risposta}
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Pubblicata: {fmtDateTime(editing.risposta_at)}</div>
          </div>
        ) : (
          <textarea
            placeholder={editing.reply_draft ? '' : 'Scrivi la risposta o usa il pulsante AI'}
            value={editing.reply_draft || ''}
            onChange={e => setEditing({ ...editing, reply_draft: e.target.value })}
            style={{ ...S.input, width: '100%', minHeight: 100, fontFamily: 'inherit' }}
          />
        )}
        {!editing.risposta && editing.reply_draft && (
          <div style={{ marginTop: 10, padding: 8, background: '#1a1f2e', borderRadius: 6, fontSize: 11, color: '#94a3b8' }}>
            Quando soddisfatto, copia il testo sulla piattaforma di origine ({SORGENTI.find(s => s.key === editing.sorgente)?.label}) e clicca "Marca pubblicata".
          </div>
        )}
      </div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {editing.id && <button onClick={onDelete} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>Elimina</button>}
        {editing.id && !editing.archiviata && <button onClick={onArchive} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Archivia</button>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
        {editing.id && !editing.risposta && editing.reply_draft && (
          <button onClick={publishReply} style={btn('#10B981', '#0f1420', '#10B981')}>✓ Marca pubblicata</button>
        )}
      </div>
    </Drawer>}

    {/* Drawer settings */}
    {editingSettings && <Drawer onClose={() => setEditingSettings(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Impostazioni recensioni · {locale}</h3>

      <Field label="Tone of voice (usato dall'AI per generare risposte)">
        <textarea value={editingSettings.tone_of_voice || ''} onChange={e => setEditingSettings({ ...editingSettings, tone_of_voice: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 100, fontFamily: 'inherit' }} placeholder="Es. Cordiale, professionale, italiano. Sintetico (max 4 frasi). Tono familiare verso clienti abituali." />
      </Field>

      <div style={{ marginTop: 10 }}>
        <Field label="Firma di chiusura (opzionale)"><input value={editingSettings.firma || ''} onChange={e => setEditingSettings({ ...editingSettings, firma: e.target.value })} placeholder="Es. Lo staff di REMEMBEER" style={{ ...S.input, width: '100%' }} /></Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <Field label="Google Place ID (futuro sync)"><input value={editingSettings.google_place_id || ''} onChange={e => setEditingSettings({ ...editingSettings, google_place_id: e.target.value })} style={S.input} /></Field>
        <Field label="URL TripAdvisor (futuro sync)"><input value={editingSettings.tripadvisor_url || ''} onChange={e => setEditingSettings({ ...editingSettings, tripadvisor_url: e.target.value })} style={S.input} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!editingSettings.auto_draft} onChange={e => setEditingSettings({ ...editingSettings, auto_draft: e.target.checked })} />
          Genera bozza AI automatica all'arrivo di nuove recensioni
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button onClick={() => setEditingSettings(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={saveSettings} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
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
function KPI({ label, value, accent = '#F59E0B' }) {
  return <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, padding: 12, position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: accent }} />
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
  </div>
}
function Drawer({ children, onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(640px, 100%)', height: '100%', background: '#1a1f2e', padding: 20, overflowY: 'auto', borderLeft: '1px solid #2a3042' }}>
      {children}
    </div>
  </div>
}
