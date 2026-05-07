// Configurazione email "Resoconto giornaliero" inviata ogni mattina alle 06:00.
// Multi-destinatario per ruolo (imprenditore / resp acquisti / HR / altro),
// sezioni del report selezionabili globalmente o per singolo destinatario,
// bottone "Invia ora di prova" per testare end-to-end.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card } from './shared/styles.jsx'

const iS = S.input

const RUOLI = [
  { v: 'imprenditore', l: 'Imprenditore' },
  { v: 'resp_acquisti', l: 'Resp. acquisti' },
  { v: 'hr', l: 'HR' },
  { v: 'manager', l: 'Manager' },
  { v: 'contabile', l: 'Contabile' },
  { v: 'altro', l: 'Altro' },
]

const SECTIONS = [
  { v: 'vendite',   l: 'Vendite del giorno', d: 'Ricavi, scontrini, coperti per ogni locale' },
  { v: 'confronto', l: 'Confronto sett. scorsa', d: 'Stesso giorno della settimana scorsa, ±%' },
  { v: 'personale', l: 'Personale del turno', d: 'Ore reali, costo, produttività €/h' },
  { v: 'alert',     l: 'Alert magazzino & checklist', d: 'Sotto soglia, prezzi anomali, checklist KO' },
]

export default function DailyReportSettings({ onClose }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [userId, setUserId] = useState(null)
  const [hasGmail, setHasGmail] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [defaults, setDefaults] = useState({ vendite: true, confronto: true, personale: true, alert: true })
  const [recipients, setRecipients] = useState([])
  const [lastSentAt, setLastSentAt] = useState(null)
  const [lastError, setLastError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setErr('Devi essere autenticato'); setLoading(false); return }
    setUserId(user.id)
    // Verifica connessione Gmail
    const { data: tok } = await supabase.from('google_tokens').select('refresh_token').eq('user_id', user.id).limit(1)
    setHasGmail(!!tok?.[0]?.refresh_token)
    // Carica impostazioni esistenti
    const { data } = await supabase.from('daily_report_settings').select('*').eq('user_id', user.id).limit(1)
    if (data?.[0]) {
      setEnabled(!!data[0].enabled)
      setDefaults(data[0].default_sections || defaults)
      setRecipients(Array.isArray(data[0].recipients) ? data[0].recipients : [])
      setLastSentAt(data[0].last_sent_at)
      setLastError(data[0].last_error)
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true); setMsg(''); setErr('')
    try {
      const cleaned = recipients.filter(r => r.email?.trim()).map(r => ({
        email: r.email.trim(), ruolo: r.ruolo || 'altro',
        sections: r.sections || null,  // null = usa default_sections
      }))
      const { error } = await supabase.from('daily_report_settings').upsert({
        user_id: userId,
        enabled,
        default_sections: defaults,
        recipients: cleaned,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      setMsg('Salvato')
      setTimeout(() => setMsg(''), 2500)
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  const testSend = async () => {
    setSending(true); setMsg(''); setErr('')
    try {
      // Salva prima per assicurarsi che la config sia aggiornata
      await save()
      const r = await fetch('/api/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status))
      const ok = (data.results || []).filter(x => x.ok).length
      const ko = (data.results || []).filter(x => !x.ok)
      let m = `Inviate ${ok} email`
      if (ko.length) m += ` · ${ko.length} errori: ` + ko.map(x => x.email + ' (' + x.error + ')').join(', ')
      setMsg(m)
    } catch (e) { setErr(e.message) }
    setSending(false)
  }

  const addRecipient = () => setRecipients(prev => [...prev, { email: '', ruolo: 'imprenditore', sections: null }])
  const updRecipient = (i, patch) => setRecipients(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const rmRecipient = (i) => setRecipients(prev => prev.filter((_, idx) => idx !== i))
  const toggleSection = (i, sec) => setRecipients(prev => prev.map((r, idx) => {
    if (idx !== i) return r
    const cur = r.sections || { ...defaults }
    return { ...r, sections: { ...cur, [sec]: !cur[sec] } }
  }))
  const useDefaultSections = (i) => setRecipients(prev => prev.map((r, idx) => idx === i ? { ...r, sections: null } : r))

  const connectGmail = () => {
    if (!userId) return
    window.location.href = `/api/google-auth?action=authorize&state=${encodeURIComponent(userId)}`
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 720 }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>Resoconto giornaliero via email</h3>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Inviato ogni mattina alle 06:00 con il riepilogo del giorno prima</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ padding: 30, color: 'var(--text3)', textAlign: 'center' }}>Caricamento…</div>
        ) : !hasGmail ? (
          <div style={{ padding: 16, background: 'rgba(245,158,11,.08)', border: '1px solid #F59E0B', borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#F59E0B', marginBottom: 6 }}>Gmail non connesso</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
              Per inviare il resoconto giornaliero serve connettere il tuo account Gmail (le email partiranno da lì).
              Cliccando sotto verrai reindirizzato a Google per autorizzare l'accesso (scope: invio email).
            </div>
            <button onClick={connectGmail}
              style={{ padding: '10px 18px', background: '#10B981', color: 'var(--text)', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Connetti Gmail
            </button>
          </div>
        ) : <>
          {/* Toggle on/off */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: enabled ? 'rgba(16,185,129,.08)' : '#131825', border: `1px solid ${enabled ? '#10B981' : '#2a3042'}`, borderRadius: 8, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ accentColor: '#10B981', width: 18, height: 18 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: enabled ? '#10B981' : '#e2e8f0' }}>Invia il resoconto ogni mattina alle 06:00</div>
              {lastSentAt && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Ultimo invio: {new Date(lastSentAt).toLocaleString('it-IT')}{lastError ? <span style={{ color: '#EF4444', marginLeft: 8 }}>· errori: {lastError}</span> : ''}</div>}
            </div>
          </label>

          {/* Sezioni di default */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600, marginBottom: 8 }}>Sezioni del report (default)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
              {SECTIONS.map(s => (
                <label key={s.v} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 10, background: defaults[s.v] ? 'rgba(59,130,246,.06)' : '#131825', border: `1px solid ${defaults[s.v] ? '#3B82F6' : '#2a3042'}`, borderRadius: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!defaults[s.v]} onChange={() => setDefaults(p => ({ ...p, [s.v]: !p[s.v] }))} style={{ marginTop: 2, accentColor: '#3B82F6' }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: defaults[s.v] ? '#3B82F6' : '#e2e8f0' }}>{s.l}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{s.d}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Destinatari */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>Destinatari ({recipients.length})</div>
              <button onClick={addRecipient} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                + Aggiungi destinatario
              </button>
            </div>
            {recipients.length === 0 && (
              <div style={{ padding: 14, color: 'var(--text3)', textAlign: 'center', fontSize: 12, border: '1px dashed #2a3042', borderRadius: 8 }}>
                Nessun destinatario. Aggiungine almeno uno.
              </div>
            )}
            {recipients.map((r, i) => {
              const customSections = r.sections != null
              const effective = r.sections || defaults
              return <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 6, marginBottom: 8 }}>
                  <input value={r.email || ''} onChange={e => updRecipient(i, { email: e.target.value })} placeholder="email@esempio.it" type="email" style={{ ...iS, width: '100%' }} />
                  <select value={r.ruolo || 'imprenditore'} onChange={e => updRecipient(i, { ruolo: e.target.value })} style={{ ...iS, width: '100%' }}>
                    {RUOLI.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}
                  </select>
                  <button onClick={() => rmRecipient(i)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 13, padding: '0 8px' }}>×</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text2)' }}>
                  <span>Sezioni:</span>
                  {customSections ? (
                    <>{SECTIONS.map(s => (
                      <button key={s.v} onClick={() => toggleSection(i, s.v)}
                        style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, border: 'none', background: effective[s.v] ? '#3B82F6' : '#1a1f2e', color: effective[s.v] ? '#fff' : '#64748b', cursor: 'pointer' }}>
                        {s.l.replace(/\s.*$/, '')}
                      </button>
                    ))}
                    <button onClick={() => useDefaultSections(i)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>usa default</button></>
                  ) : (
                    <>
                      <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>usa il default</span>
                      <button onClick={() => updRecipient(i, { sections: { ...defaults } })} style={{ background: 'none', border: 'none', color: '#3B82F6', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>personalizza</button>
                    </>
                  )}
                </div>
              </div>
            })}
          </div>

          {msg && <div style={{ padding: 10, background: 'rgba(16,185,129,.1)', color: '#10B981', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{msg}</div>}
          {err && <div style={{ padding: 10, background: 'rgba(239,68,68,.1)', color: '#EF4444', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{err}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button onClick={testSend} disabled={sending || saving || !recipients.length}
              style={{ ...iS, background: '#F59E0B', color: 'var(--text)', border: 'none', padding: '8px 16px', fontWeight: 700, cursor: sending ? 'wait' : 'pointer', opacity: !recipients.length ? 0.5 : 1 }}>
              {sending ? 'Invio…' : 'Invia ora di prova'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Chiudi</button>
              <button onClick={save} disabled={saving}
                style={{ ...iS, background: '#10B981', color: 'var(--text)', border: 'none', padding: '8px 20px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Salvo…' : 'Salva'}
              </button>
            </div>
          </div>
        </>}
      </div>
    </div>
  </div>
}
