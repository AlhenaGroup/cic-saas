// Centralino — config IVR + log chiamate.
// Backoffice della logica Twilio. Le chiamate reali sono gestite da /api/twilio-webhook.

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

const GIORNI = [
  { key: 'lun', label: 'Lunedì' },
  { key: 'mar', label: 'Martedì' },
  { key: 'mer', label: 'Mercoledì' },
  { key: 'gio', label: 'Giovedì' },
  { key: 'ven', label: 'Venerdì' },
  { key: 'sab', label: 'Sabato' },
  { key: 'dom', label: 'Domenica' },
]

const ESITI = {
  whatsapp_sent:    { label: 'WhatsApp inviato', c: '#10B981' },
  whatsapp_failed:  { label: 'WhatsApp errore',  c: '#EF4444' },
  dial_answered:    { label: 'Risposto',         c: '#3B82F6' },
  dial_no_answer:   { label: 'Senza risposta',   c: '#F59E0B' },
  voicemail:        { label: 'Segreteria',       c: '#8B5CF6' },
  fuori_orario:     { label: 'Fuori orario',     c: '#94A3B8' },
  hangup:           { label: 'Riagganciato',     c: '#94A3B8' },
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtDur(s) {
  if (!s) return '—'
  const m = Math.floor(s / 60), r = s % 60
  return m > 0 ? `${m}m ${r}s` : `${r}s`
}

const WEBHOOK_URL = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/twilio-webhook?step=voice'

export default function CentralinoManager({ sp, sps }) {
  const localesAvail = useMemo(() => { const raw = sps && sps.length ? sps.map(s => s.name) : ["REMEMBEER", "CASA DE AMICIS", "BIANCOLATTE", "LABORATORIO"]; return [...new Set(raw)] }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_cent_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_cent_locale', locale) }, [locale])

  const [config, setConfig] = useState(null)
  const [calls, setCalls] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [cf, cl, st] = await Promise.all([
        api('/api/centralino', { action: 'config-get', locale }),
        api('/api/centralino', { action: 'calls-list', locale, limit: 100 }),
        api('/api/centralino', { action: 'calls-stats', locale, days: 30 }),
      ])
      setConfig(cf.config || null)
      setCalls(cl.calls || [])
      setStats(st.stats || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  const openEditor = () => setEditing(config ? { ...config } : {
    locale,
    twilio_number: '',
    attivo: false,
    lingua: 'it-IT',
    greeting_mode: 'tts',
    greeting_text: 'Benvenuto. Premi 1 per ricevere il link prenotazione su WhatsApp, oppure 2 per parlare con il ristorante.',
    opt1_enabled: true,
    whatsapp_template: 'Ciao! Per prenotare al ristorante clicca: {link}',
    prenotazione_url: '',
    opt2_enabled: true,
    parallel_ring_numbers: [],
    parallel_ring_timeout_sec: 20,
    voicemail_enabled: true,
    voicemail_text: 'Lasciate un messaggio dopo il segnale, vi richiameremo al più presto.',
    orari_attivi: {},
    fuori_orario_text: 'In questo momento siamo chiusi. Lasciate un messaggio dopo il segnale.',
  })

  const onSave = async () => {
    if (!editing) return
    if (editing.attivo && !editing.twilio_number) return alert('Imposta il numero Twilio prima di attivare')
    try {
      await api('/api/centralino', { action: 'config-upsert', config: { ...editing, locale } })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── orari attivi helpers ───────────────────────────────────────────
  const updateGiorno = (day, slots) => {
    const newOrari = { ...(editing.orari_attivi || {}) }
    if (slots.length === 0) delete newOrari[day]
    else newOrari[day] = slots
    setEditing({ ...editing, orari_attivi: newOrari })
  }

  // ── numeri parallel ring helpers ───────────────────────────────────
  const addNumber = () => setEditing({ ...editing, parallel_ring_numbers: [...(editing.parallel_ring_numbers || []), ''] })
  const updateNumber = (i, v) => {
    const arr = [...(editing.parallel_ring_numbers || [])]
    arr[i] = v
    setEditing({ ...editing, parallel_ring_numbers: arr })
  }
  const removeNumber = (i) => setEditing({ ...editing, parallel_ring_numbers: (editing.parallel_ring_numbers || []).filter((_, j) => j !== i) })

  // ── UI ──────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Centralino</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· IVR Twilio + WhatsApp + parallel ring</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={() => setShowHelp(!showHelp)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>?</button>
    </div>

    {showHelp && <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, padding: 14, marginBottom: 14, fontSize: 12, color: '#cbd5e1' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Setup centralino — passi necessari</div>
      <ol style={{ marginLeft: 20, lineHeight: 1.7 }}>
        <li>Acquistare un numero Twilio italiano (da Twilio Console) o portarne uno esistente.</li>
        <li>Configurare le variabili ambiente Vercel: <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_WHATSAPP_FROM</code> (es. <code>whatsapp:+14155238886</code>).</li>
        <li>In Twilio Console, sul numero acquistato, impostare il webhook "A CALL COMES IN" (HTTP POST) su:<br /><code style={{ background: '#1a1f2e', padding: '2px 8px', borderRadius: 4 }}>{WEBHOOK_URL}</code></li>
        <li>Configurare qui sotto: greeting, link prenotazione, numeri da far squillare, orari attivi.</li>
        <li>Attivare il toggle "Centralino attivo".</li>
      </ol>
    </div>}

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {/* Config card */}
    {!loading && (
      <div style={{ background: '#0f1420', border: '1px solid ' + (config?.attivo ? '#10B98155' : '#2a3042'), borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 999, fontWeight: 700,
            background: config?.attivo ? '#10B98122' : '#94A3B822',
            color: config?.attivo ? '#10B981' : '#94A3B8',
          }}>{config?.attivo ? 'ATTIVO' : 'NON ATTIVO'}</span>
          <code style={{ fontSize: 14, fontWeight: 700, background: '#1a1f2e', padding: '4px 10px', borderRadius: 4 }}>
            {config?.twilio_number || '(numero non configurato)'}
          </code>
          <div style={{ flex: 1 }} />
          <button onClick={openEditor} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>{config ? 'Modifica config' : 'Configura'}</button>
        </div>

        {config && <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
            <Stat label="Opt 1 (WhatsApp)" value={config.opt1_enabled ? 'ON' : 'OFF'} ok={config.opt1_enabled} />
            <Stat label="Opt 2 (Squillo fisso/cell)" value={config.opt2_enabled ? `${(config.parallel_ring_numbers || []).length} numeri` : 'OFF'} ok={config.opt2_enabled} />
            <Stat label="Segreteria" value={config.voicemail_enabled ? 'ON' : 'OFF'} ok={config.voicemail_enabled} />
            <Stat label="Lingua" value={config.lingua} />
          </div>
          {config.attivo && config.twilio_number && (
            <div style={{ marginTop: 12, padding: 10, background: '#1a1f2e', borderRadius: 6, fontSize: 11, color: '#94a3b8' }}>
              Webhook URL da configurare in Twilio Console: <code style={{ color: '#F59E0B' }}>{WEBHOOK_URL}</code>
            </div>
          )}
        </>}
      </div>
    )}

    {/* Stats 30gg */}
    {stats && stats.totale > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <KPI label="Chiamate (30gg)" value={stats.totale} />
        <KPI label="WhatsApp inviati" value={stats.per_esito.whatsapp_sent || 0} accent="#10B981" />
        <KPI label="Risposte" value={stats.per_esito.dial_answered || 0} accent="#3B82F6" />
        <KPI label="Senza risposta" value={stats.per_esito.dial_no_answer || 0} accent="#F59E0B" />
        <KPI label="Segreteria" value={stats.per_esito.voicemail || 0} accent="#8B5CF6" />
        <KPI label="Durata media" value={fmtDur(stats.durata_media)} />
      </div>
    )}

    {/* Lista chiamate */}
    <h3 style={{ margin: '20px 0 10px', fontSize: 15 }}>Ultime chiamate · {calls.length}</h3>
    {calls.length === 0 ? (
      <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 13, background: '#0f1420', borderRadius: 8 }}>
        Nessuna chiamata registrata. Una volta configurato e attivato il centralino, le chiamate ricevute appariranno qui.
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0f1420' }}>
              <th style={S.th}>Data/ora</th>
              <th style={S.th}>Da</th>
              <th style={S.th}>Cliente</th>
              <th style={S.th}>Digit</th>
              <th style={S.th}>Esito</th>
              <th style={S.th}>Durata</th>
              <th style={S.th}>Note</th>
            </tr>
          </thead>
          <tbody>
            {calls.map(c => {
              const e = ESITI[c.esito] || { label: c.esito || '—', c: '#94A3B8' }
              const cust = c.customers
              return <tr key={c.id}>
                <td style={S.td}>{fmtDateTime(c.started_at)}</td>
                <td style={S.td}><code style={{ fontSize: 12 }}>{c.from_number}</code></td>
                <td style={S.td}>{cust ? [cust.nome, cust.cognome].filter(Boolean).join(' ') : <span style={{ color: '#64748b' }}>—</span>}</td>
                <td style={S.td}>{c.digit_pressed || '—'}</td>
                <td style={S.td}><span style={{ background: e.c + '22', color: e.c, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{e.label}</span></td>
                <td style={S.td}>{fmtDur(c.durata_sec)}</td>
                <td style={S.td}>
                  {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer" style={{ color: '#F59E0B', fontSize: 11 }}>audio</a>}
                  {c.trascrizione && <div style={{ fontSize: 11, color: '#cbd5e1', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.trascrizione}</div>}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {/* Drawer config */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica centralino' : 'Configura centralino'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Numero Twilio (E.164)"><input value={editing.twilio_number || ''} onChange={e => setEditing({ ...editing, twilio_number: e.target.value })} placeholder="+390112345678" style={S.input} /></Field>
        <Field label="Lingua"><select value={editing.lingua} onChange={e => setEditing({ ...editing, lingua: e.target.value })} style={S.input}>
          <option value="it-IT">Italiano</option>
          <option value="en-GB">English (UK)</option>
          <option value="fr-FR">Français</option>
          <option value="de-DE">Deutsch</option>
          <option value="es-ES">Español</option>
        </select></Field>
      </div>

      <Section title="Greeting (messaggio iniziale)">
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button onClick={() => setEditing({ ...editing, greeting_mode: 'tts' })} style={tabBtn(editing.greeting_mode === 'tts')}>Testo (TTS)</button>
          <button onClick={() => setEditing({ ...editing, greeting_mode: 'audio' })} style={tabBtn(editing.greeting_mode === 'audio')}>File audio</button>
        </div>
        {editing.greeting_mode === 'tts' ? (
          <textarea value={editing.greeting_text || ''} onChange={e => setEditing({ ...editing, greeting_text: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 60, fontFamily: 'inherit' }} />
        ) : (
          <input value={editing.greeting_audio_url || ''} onChange={e => setEditing({ ...editing, greeting_audio_url: e.target.value })} placeholder="https://.../greeting.mp3" style={{ ...S.input, width: '100%' }} />
        )}
      </Section>

      <Section title="Opzione 1 — invio link prenotazione su WhatsApp">
        <Toggle checked={!!editing.opt1_enabled} onChange={v => setEditing({ ...editing, opt1_enabled: v })} label="Abilita risposta a digit 1" />
        {editing.opt1_enabled && <>
          <div style={{ marginTop: 8 }}>
            <Field label="URL prenotazione"><input value={editing.prenotazione_url || ''} onChange={e => setEditing({ ...editing, prenotazione_url: e.target.value })} placeholder="https://prenota.tuolocale.it" style={{ ...S.input, width: '100%' }} /></Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <Field label="Template messaggio WhatsApp ({link} verrà sostituito)">
              <textarea value={editing.whatsapp_template || ''} onChange={e => setEditing({ ...editing, whatsapp_template: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 60, fontFamily: 'inherit' }} />
            </Field>
          </div>
        </>}
      </Section>

      <Section title="Opzione 2 — squillo simultaneo a fissi/cellulari">
        <Toggle checked={!!editing.opt2_enabled} onChange={v => setEditing({ ...editing, opt2_enabled: v })} label="Abilita risposta a digit 2" />
        {editing.opt2_enabled && <>
          <div style={{ marginTop: 8 }}>
            <Field label="Numeri da far squillare in parallelo (E.164)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(editing.parallel_ring_numbers || []).map((n, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input value={n} onChange={e => updateNumber(i, e.target.value)} placeholder="+393331234567" style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => removeNumber(i)} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>×</button>
                  </div>
                ))}
                <button onClick={addNumber} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>+ Aggiungi numero</button>
              </div>
            </Field>
          </div>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <Field label="Timeout squillo (sec)"><input type="number" value={editing.parallel_ring_timeout_sec || 20} onChange={e => setEditing({ ...editing, parallel_ring_timeout_sec: Number(e.target.value || 20) })} style={S.input} /></Field>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Orari attivi (vuoto = sempre)</div>
            {GIORNI.map(g => {
              const slots = (editing.orari_attivi || {})[g.key] || []
              return <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 90, fontSize: 12, color: '#94a3b8' }}>{g.label}</div>
                {slots.map((s, i) => (
                  <span key={i} style={{ display: 'flex', gap: 2 }}>
                    <input type="time" value={s.from} onChange={e => {
                      const ns = [...slots]; ns[i] = { ...ns[i], from: e.target.value }; updateGiorno(g.key, ns)
                    }} style={{ ...S.input, padding: '4px 6px', fontSize: 12 }} />
                    <span style={{ color: '#64748b', alignSelf: 'center' }}></span>
                    <input type="time" value={s.to} onChange={e => {
                      const ns = [...slots]; ns[i] = { ...ns[i], to: e.target.value }; updateGiorno(g.key, ns)
                    }} style={{ ...S.input, padding: '4px 6px', fontSize: 12 }} />
                    <button onClick={() => updateGiorno(g.key, slots.filter((_, j) => j !== i))} style={{ ...btn('transparent', '#EF4444', 'transparent'), padding: '2px 6px' }}>×</button>
                  </span>
                ))}
                <button onClick={() => updateGiorno(g.key, [...slots, { from: '12:00', to: '15:00' }])} style={{ ...btn('#1a1f2e', '#cbd5e1', '#2a3042'), padding: '3px 8px', fontSize: 11 }}>+</button>
              </div>
            })}
          </div>
        </>}
      </Section>

      <Section title="Segreteria">
        <Toggle checked={!!editing.voicemail_enabled} onChange={v => setEditing({ ...editing, voicemail_enabled: v })} label="Abilita segreteria (no answer / fuori orario)" />
        {editing.voicemail_enabled && <>
          <div style={{ marginTop: 8 }}>
            <Field label="Messaggio segreteria">
              <textarea value={editing.voicemail_text || ''} onChange={e => setEditing({ ...editing, voicemail_text: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 50, fontFamily: 'inherit' }} />
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <Field label="Messaggio fuori orario">
              <textarea value={editing.fuori_orario_text || ''} onChange={e => setEditing({ ...editing, fuori_orario_text: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 50, fontFamily: 'inherit' }} />
            </Field>
          </div>
        </>}
      </Section>

      <div style={{ marginTop: 14, padding: 12, background: '#0f1420', borderRadius: 8 }}>
        <Toggle checked={!!editing.attivo} onChange={v => setEditing({ ...editing, attivo: v })} label="Centralino attivo (Twilio risponderà alle chiamate)" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button onClick={() => setEditing(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
      </div>
    </Drawer>}
  </div>
}

function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}
function tabBtn(active) {
  return { padding: '5px 12px', fontSize: 12, fontWeight: 600, background: active ? '#F59E0B' : '#0f1420', color: active ? '#0f1420' : '#cbd5e1', border: '1px solid ' + (active ? '#F59E0B' : '#2a3042'), borderRadius: 5, cursor: 'pointer' }
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
function Toggle({ checked, onChange, label }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    {label}
  </label>
}
function Stat({ label, value, ok = null }) {
  return <div>
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 700, color: ok === false ? '#94A3B8' : ok === true ? '#10B981' : '#cbd5e1' }}>{value}</div>
  </div>
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
