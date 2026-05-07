// Prenotazioni — backoffice CRM. Vista lista + KPI + filtri + crea/modifica anagrafica.
// Le state transitions (accept/reject/waitlist/seat) vengono fatte dal POS, non da qui.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'
import ReservationsStats from './ReservationsStats'

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

const STATI = {
  pending:   { label: 'In attesa',   c: '#F59E0B' },
  confirmed: { label: 'Confermata',  c: '#3B82F6' },
  seated:    { label: 'A tavolo',    c: '#06B6D4' },
  completed: { label: 'Completata',  c: '#10B981' },
  no_show:   { label: 'No-show',     c: '#EF4444' },
  cancelled: { label: 'Cancellata',  c: '#94A3B8' },
  waitlist:  { label: 'Lista attesa', c: '#8B5CF6' },
}
const SOURCES = ['web', 'google', 'telefono', 'walk-in', 'manual', 'pos']
const OCCASIONI = ['', 'compleanno', 'anniversario', 'business', 'romantica', 'altro']

// preset range date
function todayISO() { return new Date().toISOString().slice(0, 10) }
function addDays(s, n) { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDateOnly(iso) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 16)  // for input[type=datetime-local]
}

export default function ReservationsManager({ sp, sps }) {
  const localesAvail = useMemo(() => { const raw = sps && sps.length ? sps.map(s => s.name) : ["REMEMBEER", "CASA DE AMICIS", "BIANCOLATTE", "LABORATORIO"]; return [...new Set(raw)] }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_reserv_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_reserv_locale', locale) }, [locale])

  const [from, setFrom] = useState(() => todayISO())
  const [to, setTo]   = useState(() => addDays(todayISO(), 7))
  const [statoFilter, setStatoFilter] = useState('')

  const [list, setList] = useState([])
  const [kpi, setKpi]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState([])
  const [showStats, setShowStats] = useState(() => localStorage.getItem('mkt_reserv_stats') === '1')
  useEffect(() => { localStorage.setItem('mkt_reserv_stats', showStats ? '1' : '0') }, [showStats])

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const fromIso = from + 'T00:00:00Z'
      const toIso   = to + 'T23:59:59Z'
      const [ls, kp] = await Promise.all([
        api('/api/reservations', { action: 'list', locale, from: fromIso, to: toIso, stato: statoFilter || null }),
        api('/api/reservations', { action: 'kpi',  locale, from: fromIso, to: toIso }),
      ])
      setList(ls.reservations || [])
      setKpi(kp.kpi || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale, from, to, statoFilter])

  useEffect(() => { reload() }, [reload])

  // ── preset range ──────────────────────────────────────────────────
  const setPreset = (key) => {
    const t = todayISO()
    if (key === 'oggi')    { setFrom(t); setTo(t) }
    if (key === 'sett')    { setFrom(t); setTo(addDays(t, 7)) }
    if (key === 'mese')    { setFrom(t); setTo(addDays(t, 30)) }
    if (key === 'storico') { setFrom(addDays(t, -90)); setTo(t) }
  }

  // ── customer lookup nel drawer ────────────────────────────────────
  useEffect(() => {
    if (!editing) { setCustResults([]); return }
    const t = setTimeout(async () => {
      if (!custSearch || custSearch.length < 2) { setCustResults([]); return }
      try {
        const r = await api('/api/customers', { action: 'list', locale, search: custSearch, limit: 8 })
        setCustResults(r.customers || [])
      } catch { setCustResults([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [custSearch, editing, locale])

  // ── crea/modifica ─────────────────────────────────────────────────
  const openNew = () => setEditing({
    locale,
    customer_id: null,
    guest_nome: '',
    guest_telefono: '',
    guest_email: '',
    data_ora: fmtDateOnly(new Date(Date.now() + 3600000).toISOString()),
    durata_min: 90,
    pax: 2,
    sala: '',
    tavoli: [],
    source: 'manual',
    occasione: '',
    note: '',
    allergie: '',
  })

  const openExisting = async (r) => {
    setEditing({
      ...r,
      data_ora: fmtDateOnly(r.data_ora),
    })
    setCustSearch('')
  }

  const onSave = async () => {
    if (!editing.data_ora || !editing.pax) return alert('Data, ora e coperti obbligatori')
    if (!editing.customer_id && !editing.guest_nome && !editing.guest_telefono) return alert('Inserisci un cliente o almeno nome/telefono')
    try {
      const payload = { ...editing, locale, data_ora: new Date(editing.data_ora).toISOString() }
      await api('/api/reservations', { action: 'upsert', reservation: payload })
      setEditing(null); reload()
    } catch (e) { alert('Errore salvataggio: ' + e.message) }
  }

  const onDelete = async () => {
    if (!editing?.id) return
    if (!confirm('Eliminare la prenotazione?')) return
    try {
      await api('/api/reservations', { action: 'delete', id: editing.id })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const linkCustomer = (c) => {
    setEditing({
      ...editing,
      customer_id: c.id,
      guest_nome: [c.nome, c.cognome].filter(Boolean).join(' '),
      guest_telefono: c.telefono || '',
      guest_email: c.email || '',
    })
    setCustSearch(''); setCustResults([])
  }

  // ── UI ──────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Prenotazioni</h2>
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>· vista backoffice</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={openNew} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuova prenotazione</button>
    </div>

    {/* Range + filtri */}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => setPreset('oggi')}    style={btnSm('#0f1420')}>Oggi</button>
        <button onClick={() => setPreset('sett')}    style={btnSm('#0f1420')}>+ 7gg</button>
        <button onClick={() => setPreset('mese')}    style={btnSm('#0f1420')}>+ 30gg</button>
        <button onClick={() => setPreset('storico')} style={btnSm('#0f1420')}>Storico 90gg</button>
      </div>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={S.input} />
      <span style={{ color: 'var(--text3)' }}></span>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} style={S.input} />
      <select value={statoFilter} onChange={e => setStatoFilter(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        <option value="">Tutti gli stati</option>
        {Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <div style={{ flex: 1 }} />
      <button onClick={() => setShowStats(!showStats)} style={btnSm(showStats ? '#F59E0B' : '#0f1420')}>
        {showStats ? 'Nascondi statistiche' : 'Mostra statistiche'}
      </button>
    </div>

    {showStats && <ReservationsStats locale={locale} from={from} to={to} />}

    {/* KPI */}
    {kpi && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
      <KPI label="Prenotazioni" value={kpi.totale} />
      <KPI label="Coperti" value={kpi.coperti} />
      <KPI label="Confermate" value={kpi.per_stato.confirmed || 0} accent="#3B82F6" />
      <KPI label="Completate" value={kpi.per_stato.completed || 0} accent="#10B981" />
      <KPI label="No-show" value={kpi.per_stato.no_show || 0} accent="#EF4444" />
      <KPI label="No-show rate" value={`${kpi.no_show_rate}%`} accent="#EF4444" />
    </div>}

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: 'var(--text2)', fontSize: 12 }}>Caricamento…</div>}

    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: 'var(--text3)', fontSize: 13 }}>
        Nessuna prenotazione nel periodo. Crea una prenotazione manualmente o riceverai prenotazioni dal POS / web.
      </div>
    )}

    {!loading && list.length > 0 && (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={S.th}>Data/ora</th>
              <th style={S.th}>Cliente</th>
              <th style={S.th}>Pax</th>
              <th style={S.th}>Tavolo</th>
              <th style={S.th}>Stato</th>
              <th style={S.th}>Sorgente</th>
              <th style={S.th}>Note</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => {
              const s = STATI[r.stato] || { label: r.stato, c: '#94A3B8' }
              const cust = r.customers
              const nome = cust ? [cust.nome, cust.cognome].filter(Boolean).join(' ') : (r.guest_nome || '')
              const tel = cust?.telefono || r.guest_telefono
              return <tr key={r.id} onClick={() => openExisting(r)} style={{ cursor: 'pointer' }}>
                <td style={S.td}>{fmtDateTime(r.data_ora)}</td>
                <td style={S.td}>
                  <div style={{ fontWeight: 600 }}>{nome || <span style={{ color: 'var(--text3)' }}>(senza nome)</span>}</div>
                  {tel && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{tel}</div>}
                </td>
                <td style={S.td}>{r.pax}</td>
                <td style={S.td}>
                  {r.sala && <div style={{ fontSize: 12 }}>{r.sala}</div>}
                  {r.tavoli?.length > 0 && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.tavoli.join(', ')}</div>}
                </td>
                <td style={S.td}>
                  <span style={{ background: s.c + '22', color: s.c, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{s.label}</span>
                </td>
                <td style={S.td}><span style={{ fontSize: 11, color: 'var(--text2)' }}>{r.source || '—'}</span></td>
                <td style={S.td}>
                  <div style={{ fontSize: 11, color: 'var(--text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[r.occasione, r.allergie && `${r.allergie}`, r.note].filter(Boolean).join(' · ') || '—'}
                  </div>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {/* Drawer */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica prenotazione' : 'Nuova prenotazione'}</h3>

      {editing.id && <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
        Stato attuale: <b style={{ color: (STATI[editing.stato] || {}).c || '#cbd5e1' }}>{(STATI[editing.stato] || {}).label || editing.stato}</b>
        <div style={{ fontSize: 11, marginTop: 4 }}>Le transizioni di stato (conferma/rifiuta/lista d'attesa) avvengono dal POS.</div>
      </div>}

      {/* Cliente collegato o ospite */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Cliente</div>
        {editing.customer_id ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{editing.guest_nome || '(senza nome)'}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{editing.guest_telefono} {editing.guest_email && `· ${editing.guest_email}`}</div>
            </div>
            <button onClick={() => setEditing({ ...editing, customer_id: null })} style={btnSm('#1a1f2e')}>Scollega</button>
          </div>
        ) : (
          <>
            <input placeholder="Cerca cliente per nome, telefono..." value={custSearch} onChange={e => setCustSearch(e.target.value)} style={{ ...S.input, width: '100%', marginBottom: 6 }} />
            {custResults.length > 0 && <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>
              {custResults.map(c => (
                <div key={c.id} onClick={() => linkCustomer(c)} style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid #1a1f2e', fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{[c.nome, c.cognome].filter(Boolean).join(' ') || '(senza nome)'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{c.telefono || c.email || '—'}</div>
                </div>
              ))}
            </div>}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Oppure inserisci ospite (non in anagrafica):</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input placeholder="Nome" value={editing.guest_nome || ''} onChange={e => setEditing({ ...editing, guest_nome: e.target.value })} style={S.input} />
              <input placeholder="Telefono" value={editing.guest_telefono || ''} onChange={e => setEditing({ ...editing, guest_telefono: e.target.value })} style={S.input} />
            </div>
            <input placeholder="Email (opz)" value={editing.guest_email || ''} onChange={e => setEditing({ ...editing, guest_email: e.target.value })} style={{ ...S.input, width: '100%', marginTop: 8 }} />
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Data e ora"><input type="datetime-local" value={editing.data_ora} onChange={e => setEditing({ ...editing, data_ora: e.target.value })} style={S.input} /></Field>
        <Field label="Coperti"><input type="number" min="1" value={editing.pax} onChange={e => setEditing({ ...editing, pax: Number(e.target.value || 1) })} style={S.input} /></Field>
        <Field label="Durata (min)"><input type="number" value={editing.durata_min} onChange={e => setEditing({ ...editing, durata_min: Number(e.target.value || 90) })} style={S.input} /></Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Sala"><input value={editing.sala || ''} onChange={e => setEditing({ ...editing, sala: e.target.value })} placeholder="es. Sala 1" style={S.input} /></Field>
        <Field label="Tavoli (separati da virgola)"><input value={(editing.tavoli || []).join(', ')} onChange={e => setEditing({ ...editing, tavoli: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="T5, T6" style={S.input} /></Field>
        <Field label="Sorgente"><select value={editing.source || 'manual'} onChange={e => setEditing({ ...editing, source: e.target.value })} style={S.input}>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select></Field>
        <Field label="Occasione"><select value={editing.occasione || ''} onChange={e => setEditing({ ...editing, occasione: e.target.value })} style={S.input}>
          {OCCASIONI.map(o => <option key={o} value={o}>{o || '(nessuna)'}</option>)}
        </select></Field>
      </div>

      <Field label="Allergie / intolleranze">
        <input value={editing.allergie || ''} onChange={e => setEditing({ ...editing, allergie: e.target.value })} placeholder="es. noci, glutine" style={S.input} />
      </Field>
      <div style={{ marginTop: 8 }}>
        <Field label="Note"><textarea value={editing.note || ''} onChange={e => setEditing({ ...editing, note: e.target.value })} style={{ ...S.input, minHeight: 60, fontFamily: 'inherit' }} /></Field>
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
function btnSm(bg) {
  return { padding: '5px 10px', fontSize: 11, background: bg, color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }
}

function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}

function KPI({ label, value, accent = '#F59E0B' }) {
  return <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: accent }} />
    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
  </div>
}

function Drawer({ children, onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(620px, 100%)', height: '100%', background: 'var(--surface)', padding: 20, overflowY: 'auto', borderLeft: '1px solid var(--border)' }}>
      {children}
    </div>
  </div>
}
