// Pagina pubblica /prenota/:slug — il cliente prenota dal sito del ristorante.
// No auth. Mobile-first. Branding dinamico per locale (nome + colore primario).
//
// Setup: ogni locale deve avere una riga in public_widget_settings con il proprio slug.
// Esempio inserimento (da Supabase Studio finché non c'è la UI dashboard):
//   INSERT INTO public_widget_settings (user_id, locale, slug, nome_visualizzato)
//   VALUES ('<owner-uuid>', 'BIANCOLATTE', 'biancolatte', 'Biancolatte Pinerolo');

import { useState, useEffect, useMemo } from 'react'

const SLOT_INTERVAL_MIN = 15  // ogni 15'
const PRANZO = { from: '12:00', to: '14:30' }
const CENA   = { from: '19:00', to: '22:30' }

function buildSlots() {
  const out = []
  const ranges = [PRANZO, CENA]
  for (const r of ranges) {
    const [h0, m0] = r.from.split(':').map(Number)
    const [h1, m1] = r.to.split(':').map(Number)
    const start = h0 * 60 + m0, end = h1 * 60 + m1
    for (let t = start; t <= end; t += SLOT_INTERVAL_MIN) {
      const hh = String(Math.floor(t / 60)).padStart(2, '0')
      const mm = String(t % 60).padStart(2, '0')
      out.push(`${hh}:${mm}`)
    }
  }
  return out
}

function todayPlus(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function PublicReservationPage({ slug }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const [form, setForm] = useState({
    nome: '', cognome: '', telefono: '', email: '',
    pax: 2, data: todayPlus(1), ora: '20:00',
    occasione: '', note: '', allergie: '',
    gdpr_marketing: false,
    hp: '',  // honeypot
  })

  useEffect(() => {
    fetch(`/api/reservations-public?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error || 'errore')
        else setSettings(j.settings)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const slots = useMemo(buildSlots, [])
  const primary = settings?.colore_primario || '#F59E0B'

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault?.()
    // Validazione client lato base
    if (!form.nome.trim()) return alert('Nome obbligatorio')
    if (!form.telefono.trim()) return alert('Telefono obbligatorio')
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return alert('Email non valida')
    if (form.pax < 1 || form.pax > (settings?.pax_max || 12)) return alert(`Numero persone non valido (1-${settings?.pax_max || 12})`)

    const data_ora = `${form.data}T${form.ora}:00`
    setSubmitting(true)
    try {
      const r = await fetch('/api/reservations-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          nome: form.nome.trim(),
          cognome: form.cognome.trim() || null,
          telefono: form.telefono.trim(),
          email: form.email.trim() || null,
          pax: Number(form.pax),
          data_ora,
          occasione: form.occasione || null,
          note: form.note.trim() || null,
          allergie: form.allergie.trim() || null,
          gdpr_marketing: form.gdpr_marketing,
          hp: form.hp,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'errore invio')
      setDone(true)
    } catch (err) {
      alert('Errore: ' + err.message)
    } finally { setSubmitting(false) }
  }

  if (loading) return <Centered>Caricamento…</Centered>
  if (error)   return <Centered><div style={{ color: '#dc2626' }}>{error}</div></Centered>
  if (!settings) return <Centered>Widget non disponibile.</Centered>

  if (done) return (
    <Centered>
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: 28, maxWidth: 460, textAlign: 'center',
      }}>
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>✓</div>
        <h2 style={{ margin: '0 0 8px', color: primary }}>Richiesta inviata!</h2>
        <p style={{ color: '#475569', margin: '8px 0 0' }}>
          Ti contatteremo a breve per confermare la prenotazione.
        </p>
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 16 }}>
          {settings.nome_visualizzato}
        </p>
      </div>
    </Centered>
  )

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: 15,
    border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff',
    color: '#0f172a', boxSizing: 'border-box', outline: 'none',
  }
  const labelStyle = { fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6, display: 'block' }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
          padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <h1 style={{
            margin: '0 0 6px', fontSize: 24, color: primary, fontWeight: 700,
          }}>
            Prenota un tavolo
          </h1>
          <div style={{ color: '#64748b', fontSize: 15, marginBottom: 18 }}>
            {settings.nome_visualizzato}
          </div>
          {settings.messaggio_benvenuto && (
            <div style={{
              background: '#fef3c7', border: '1px solid #fde68a',
              borderRadius: 8, padding: '10px 12px', marginBottom: 16,
              fontSize: 14, color: '#78350f',
            }}>
              {settings.messaggio_benvenuto}
            </div>
          )}

          <form onSubmit={submit}>
            {/* Honeypot nascosto */}
            <input type="text" name="hp" value={form.hp} onChange={e => update('hp', e.target.value)}
              tabIndex="-1" autoComplete="off"
              style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }} />

            <Grid2>
              <Field label="Nome *" style={labelStyle}>
                <input style={inputStyle} value={form.nome} onChange={e => update('nome', e.target.value)} required maxLength={80} />
              </Field>
              <Field label="Cognome" style={labelStyle}>
                <input style={inputStyle} value={form.cognome} onChange={e => update('cognome', e.target.value)} maxLength={80} />
              </Field>
            </Grid2>

            <Grid2>
              <Field label="Telefono *" style={labelStyle}>
                <input style={inputStyle} type="tel" value={form.telefono} onChange={e => update('telefono', e.target.value)} required maxLength={30} />
              </Field>
              <Field label="Email" style={labelStyle}>
                <input style={inputStyle} type="email" value={form.email} onChange={e => update('email', e.target.value)} maxLength={120} />
              </Field>
            </Grid2>

            <Grid3>
              <Field label="Persone *" style={labelStyle}>
                <select style={inputStyle} value={form.pax} onChange={e => update('pax', Number(e.target.value))}>
                  {Array.from({ length: settings.pax_max || 12 }, (_, i) => i + 1).map(n =>
                    <option key={n} value={n}>{n}</option>
                  )}
                </select>
              </Field>
              <Field label="Data *" style={labelStyle}>
                <input style={inputStyle} type="date" value={form.data}
                  min={todayPlus(0)} max={todayPlus(90)}
                  onChange={e => update('data', e.target.value)} required />
              </Field>
              <Field label="Ora *" style={labelStyle}>
                <select style={inputStyle} value={form.ora} onChange={e => update('ora', e.target.value)}>
                  {slots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </Grid3>

            {(settings.occasioni || []).length > 0 && (
              <Field label="Occasione (opzionale)" style={labelStyle}>
                <select style={inputStyle} value={form.occasione} onChange={e => update('occasione', e.target.value)}>
                  <option value="">— nessuna —</option>
                  {settings.occasioni.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            )}

            <Field label="Allergie o intolleranze" style={labelStyle}>
              <input style={inputStyle} value={form.allergie} onChange={e => update('allergie', e.target.value)} maxLength={200} />
            </Field>

            <Field label="Note (opzionale)" style={labelStyle}>
              <textarea style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit' }}
                value={form.note} onChange={e => update('note', e.target.value)} maxLength={500} />
            </Field>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 0', fontSize: 13, color: '#475569', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={form.gdpr_marketing}
                onChange={e => update('gdpr_marketing', e.target.checked)}
                style={{ marginTop: 3 }} />
              <span>
                {settings.gdpr_text || 'Acconsento a ricevere comunicazioni promozionali (compleanno, eventi). Posso disiscrivermi in qualsiasi momento.'}
              </span>
            </label>

            <button type="submit" disabled={submitting}
              style={{
                width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 700,
                background: primary, color: '#0f1420', border: 'none', borderRadius: 8,
                cursor: submitting ? 'wait' : 'pointer', marginTop: 14, opacity: submitting ? 0.6 : 1,
              }}>
              {submitting ? 'Invio in corso…' : 'Richiedi prenotazione'}
            </button>

            <div style={{
              marginTop: 14, textAlign: 'center', fontSize: 11, color: '#94a3b8',
            }}>
              La tua richiesta sarà confermata dal ristorante.<br/>
              Trattamento dati ai sensi del GDPR — Reg. UE 2016/679.
            </div>
          </form>
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 14 }}>
          Powered by CIC SaaS
        </div>
      </div>
    </div>
  )
}

function Centered({ children }) {
  return <div style={{
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f1f5f9', padding: 20,
  }}>{children}</div>
}
function Field({ label, style, children }) {
  return <div style={{ marginBottom: 12 }}>
    <div style={style}>{label}</div>
    {children}
  </div>
}
function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>
}
function Grid3({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>{children}</div>
}
