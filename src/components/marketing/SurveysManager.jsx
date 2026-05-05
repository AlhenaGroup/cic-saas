// Sondaggi NPS — backoffice. Template + risposte + KPI NPS.

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

const TIPI_DOMANDA = [
  { key: 'nps',         label: 'NPS (0-10)' },
  { key: 'rating',      label: 'Rating (1-5)' },
  { key: 'choice',      label: 'Scelta singola' },
  { key: 'multichoice', label: 'Scelta multipla' },
  { key: 'text',        label: 'Testo breve' },
  { key: 'longtext',    label: 'Testo lungo' },
]

const SENTIMENT_COLORS = { positive: '#10B981', neutral: '#F59E0B', negative: '#EF4444' }

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function SurveysManager({ sp, sps }) {
  const localesAvail = useMemo(() => { const raw = sps && sps.length ? sps.map(s => s.name) : ['REMEMBEER', 'CASA DE AMICIS', 'BIANCOLATTE', 'LABORATORIO']; return [...new Set(raw)] }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_surv_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_surv_locale', locale) }, [locale])

  const [list, setList] = useState([])
  const [responses, setResponses] = useState([])
  const [kpi, setKpi] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [filterSurvey, setFilterSurvey] = useState('')

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [a, b, c] = await Promise.all([
        api('/api/surveys', { action: 'list', locale }),
        api('/api/surveys', { action: 'responses', locale, survey_id: filterSurvey || null, limit: 100 }),
        api('/api/surveys', { action: 'kpi', locale, survey_id: filterSurvey || null }),
      ])
      setList(a.surveys || [])
      setResponses(b.responses || [])
      setKpi(c.kpi || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale, filterSurvey])

  useEffect(() => { reload() }, [reload])

  const openNew = () => setEditing({
    locale,
    nome: '',
    intro: 'Grazie per la tua visita! Aiutaci a migliorare con un breve feedback.',
    thank_you: 'Grazie per il tuo feedback!',
    domande: [
      { id: 'nps', tipo: 'nps', label: 'Quanto raccomanderesti il nostro locale a un amico?', required: true },
      { id: 'q1', tipo: 'rating', label: 'Qualità del cibo', required: false },
      { id: 'q2', tipo: 'rating', label: 'Servizio', required: false },
      { id: 'note', tipo: 'longtext', label: 'Vuoi lasciarci un commento?', required: false },
    ],
    attivo: true,
    routing_soglia: 9,
    routing_link_review: '',
  })

  const onSave = async () => {
    if (!editing.nome?.trim()) return alert('Nome obbligatorio')
    try {
      await api('/api/surveys', { action: 'upsert', survey: { ...editing, locale } })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async () => {
    if (!editing?.id) return
    if (!confirm('Eliminare il sondaggio? Tutte le risposte associate verranno cancellate.')) return
    try {
      await api('/api/surveys', { action: 'delete', id: editing.id })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const generateLink = async (s) => {
    try {
      const r = await api('/api/surveys', { action: 'create-invitation', survey_id: s.id })
      navigator.clipboard?.writeText(r.link)
      alert(`Link copiato negli appunti:\n${r.link}`)
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── Domanda editor helpers ──────────────────────────────────────
  const addDomanda = () => {
    const id = 'q' + Date.now().toString(36)
    setEditing({ ...editing, domande: [...(editing.domande || []), { id, tipo: 'rating', label: '', required: false }] })
  }
  const updateDomanda = (idx, patch) => {
    const arr = [...(editing.domande || [])]
    arr[idx] = { ...arr[idx], ...patch }
    setEditing({ ...editing, domande: arr })
  }
  const deleteDomanda = (idx) => {
    setEditing({ ...editing, domande: (editing.domande || []).filter((_, i) => i !== idx) })
  }

  // ── UI ──────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Sondaggi NPS</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· post-visita + reputation routing</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={openNew} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuovo sondaggio</button>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {/* KPI */}
    {kpi && kpi.totale > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
      <KPI label="Risposte" value={kpi.totale} />
      <KPI label="NPS Score" value={kpi.nps != null ? kpi.nps : '—'} accent={kpi.nps != null ? (kpi.nps >= 50 ? '#10B981' : kpi.nps >= 0 ? '#F59E0B' : '#EF4444') : '#94A3B8'} />
      <KPI label="Promoter" value={kpi.nps_breakdown?.promoter || 0} accent="#10B981" />
      <KPI label="Passive" value={kpi.nps_breakdown?.passive || 0} accent="#F59E0B" />
      <KPI label="Detractor" value={kpi.nps_breakdown?.detractor || 0} accent="#EF4444" />
      <KPI label="Rating medio" value={kpi.rating_avg != null ? kpi.rating_avg + ' ' : '—'} />
    </div>}

    {/* Lista sondaggi */}
    <h3 style={{ margin: '20px 0 10px', fontSize: 14, color: '#cbd5e1' }}>Template sondaggi</h3>
    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 13, background: '#0f1420', borderRadius: 8 }}>
        Nessun sondaggio. Crea il primo, poi automation o cron lo invierà ai clienti dopo la visita.
      </div>
    )}
    {!loading && list.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {list.map(s => (
          <div key={s.id} style={{ background: '#0f1420', border: '1px solid ' + (s.attivo ? '#10B98155' : '#2a3042'), borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
                background: s.attivo ? '#10B98122' : '#94A3B822',
                color: s.attivo ? '#10B981' : '#94A3B8',
              }}>{s.attivo ? 'ATTIVO' : 'OFF'}</span>
              <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{s.nome}</div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>{(s.domande || []).length} domande</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setEditing(s)} style={{ ...btn('#1a1f2e', '#cbd5e1', '#2a3042'), flex: 1 }}>Modifica</button>
              <button onClick={() => generateLink(s)} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Link test</button>
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Risposte */}
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 22, marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 14, color: '#cbd5e1' }}>Risposte ricevute · {responses.length}</h3>
      <div style={{ flex: 1 }} />
      <select value={filterSurvey} onChange={e => setFilterSurvey(e.target.value)} style={{ ...S.input, padding: '5px 8px', fontSize: 12 }}>
        <option value="">Tutti i sondaggi</option>
        {list.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>
    </div>

    {responses.length === 0 && (
      <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 13, background: '#0f1420', borderRadius: 8 }}>
        Nessuna risposta ancora.
      </div>
    )}
    {responses.length > 0 && (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#0f1420' }}>
              <th style={S.th}>Data</th>
              <th style={S.th}>Cliente</th>
              <th style={S.th}>Sondaggio</th>
              <th style={S.th}>NPS</th>
              <th style={S.th}>Rating</th>
              <th style={S.th}>Sentiment</th>
              <th style={S.th}>Note</th>
            </tr>
          </thead>
          <tbody>
            {responses.map(r => {
              const c = r.customers
              const noteText = r.risposte?.note || r.risposte?.commento || ''
              return <tr key={r.id}>
                <td style={S.td}>{fmtDateTime(r.submitted_at)}</td>
                <td style={S.td}>{c ? [c.nome, c.cognome].filter(Boolean).join(' ') : <span style={{ color: '#64748b' }}>(anonimo)</span>}</td>
                <td style={S.td}><span style={{ fontSize: 11 }}>{r.surveys?.nome || '—'}</span></td>
                <td style={S.td}>{r.nps_score != null ? <b style={{ color: r.nps_score >= 9 ? '#10B981' : r.nps_score >= 7 ? '#F59E0B' : '#EF4444' }}>{r.nps_score}</b> : '—'}</td>
                <td style={S.td}>{r.rating_avg != null ? <span style={{ color: '#F59E0B' }}>{r.rating_avg}</span> : '—'}</td>
                <td style={S.td}>{r.sentiment ? <span style={{ background: SENTIMENT_COLORS[r.sentiment] + '22', color: SENTIMENT_COLORS[r.sentiment], padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>{r.sentiment}</span> : '—'}</td>
                <td style={S.td}><div style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cbd5e1' }}>{noteText}</div></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {/* Drawer template editor */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica sondaggio' : 'Nuovo sondaggio'}</h3>

      <Field label="Nome interno"><input value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} placeholder="Es. Sondaggio post-cena" style={{ ...S.input, width: '100%' }} /></Field>

      <div style={{ marginTop: 10 }}>
        <Field label="Intro (visibile al cliente)"><textarea value={editing.intro || ''} onChange={e => setEditing({ ...editing, intro: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 60, fontFamily: 'inherit' }} /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Messaggio di ringraziamento finale"><input value={editing.thank_you || ''} onChange={e => setEditing({ ...editing, thank_you: e.target.value })} style={{ ...S.input, width: '100%' }} /></Field>
      </div>

      {/* Domande */}
      <div style={{ marginTop: 14, padding: 12, background: '#0f1420', borderRadius: 8, border: '1px solid #2a3042' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Domande</div>
        {(editing.domande || []).map((d, i) => (
          <div key={d.id || i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'flex-start' }}>
            <select value={d.tipo} onChange={e => updateDomanda(i, { tipo: e.target.value })} style={{ ...S.input, padding: '5px 6px', fontSize: 11, width: 120 }}>
              {TIPI_DOMANDA.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <input value={d.label || ''} onChange={e => updateDomanda(i, { label: e.target.value })} placeholder="Testo domanda" style={{ ...S.input, flex: 1 }} />
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
              <input type="checkbox" checked={!!d.required} onChange={e => updateDomanda(i, { required: e.target.checked })} /> obbl.
            </label>
            <button onClick={() => deleteDomanda(i)} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>×</button>
          </div>
        ))}
        <button onClick={addDomanda} style={{ ...btn('#1a1f2e', '#cbd5e1', '#2a3042'), width: '100%' }}>+ Aggiungi domanda</button>
      </div>

      {/* Routing reputazione */}
      <div style={{ marginTop: 14, padding: 12, background: '#0f1420', borderRadius: 8, border: '1px solid #2a3042' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Routing reputazione</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <Field label="Soglia promoter (NPS)"><input type="number" min="0" max="10" value={editing.routing_soglia || 9} onChange={e => setEditing({ ...editing, routing_soglia: Number(e.target.value || 9) })} style={S.input} /></Field>
          <Field label="Link recensione (Google/TripAdvisor)"><input value={editing.routing_link_review || ''} onChange={e => setEditing({ ...editing, routing_link_review: e.target.value })} placeholder="https://g.page/..." style={S.input} /></Field>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>I clienti che danno NPS ≥ {editing.routing_soglia || 9} verranno invitati a lasciare una recensione pubblica.</div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!editing.attivo} onChange={e => setEditing({ ...editing, attivo: e.target.checked })} />
          Sondaggio attivo
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
