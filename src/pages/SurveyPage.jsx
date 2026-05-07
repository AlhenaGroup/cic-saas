// Pagina pubblica /survey/:token — il cliente compila il sondaggio NPS post-visita.
// No auth, niente DashboardPage. Stile leggero, mobile-first.

import { useState, useEffect } from 'react'

export default function SurveyPage({ token }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [survey, setSurvey] = useState(null)
  const [risposte, setRisposte] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)  // { thank_you, review_link, sentiment }

  useEffect(() => {
    fetch(`/api/survey-public?token=${encodeURIComponent(token)}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) setError(j.error || 'errore')
        else    setSurvey(j.survey)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const setRisposta = (qid, v) => setRisposte(prev => ({ ...prev, [qid]: v }))

  const submit = async () => {
    if (!survey) return
    // Validate required
    for (const d of (survey.domande || [])) {
      if (d.required && (risposte[d.id] == null || risposte[d.id] === '')) {
        return alert(`Campo obbligatorio: ${d.label}`)
      }
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/survey-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, risposte }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'errore invio')
      setDone(j)
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSubmitting(false) }
  }

  return <div style={{
    minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
    fontFamily: '-apple-system, system-ui, sans-serif',
    padding: 20, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
  }}>
    <div style={{ width: '100%', maxWidth: 600, background: 'var(--surface)', borderRadius: 14, padding: 24, border: '1px solid var(--border)' }}>
      {loading && <div style={{ textAlign: 'center', color: 'var(--text2)' }}>Caricamento…</div>}
      {error && <div style={{ textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Sondaggio non disponibile</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>{error}</div>
      </div>}

      {survey && !done && <>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '.1em' }}>{survey.locale}</div>
          <h1 style={{ margin: '4px 0', fontSize: 22, fontWeight: 700 }}>{survey.nome}</h1>
          {survey.intro && <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 8 }}>{survey.intro}</p>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {(survey.domande || []).map(d => (
            <Domanda key={d.id} d={d} value={risposte[d.id]} onChange={(v) => setRisposta(d.id, v)} />
          ))}
        </div>

        <button onClick={submit} disabled={submitting} style={{
          width: '100%', marginTop: 22, padding: '12px 16px',
          background: submitting ? '#64748b' : '#F59E0B', color: 'var(--text)',
          fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 8, cursor: submitting ? 'wait' : 'pointer',
        }}>{submitting ? 'Invio…' : 'Invia feedback'}</button>
      </>}

      {done && <div style={{ textAlign: 'center', padding: 20 }}>
        <div style={{ fontSize: 48, marginBottom: 10 }}></div>
        <h2 style={{ margin: 0, fontSize: 20 }}>{done.thank_you}</h2>
        {done.review_link && <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 12 }}>Ci hai dato un voto fantastico — ti va di lasciarci una recensione anche su Google? Significherebbe molto per noi.</p>
          <a href={done.review_link} target="_blank" rel="noreferrer" style={{
            display: 'inline-block', padding: '10px 18px', background: '#10B981', color: 'var(--text)',
            fontWeight: 700, fontSize: 14, borderRadius: 8, textDecoration: 'none',
          }}>Lascia recensione</a>
        </div>}
      </div>}
    </div>
  </div>
}

// ─── Domande ─────────────────────────────────────────────────────────
function Domanda({ d, value, onChange }) {
  return <div>
    <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
      {d.label}{d.required && <span style={{ color: '#EF4444', marginLeft: 4 }}>*</span>}
    </label>

    {d.tipo === 'nps' && <NpsScale value={value} onChange={onChange} />}

    {d.tipo === 'rating' && <RatingStars value={value} onChange={onChange} />}

    {d.tipo === 'text' && <input value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />}

    {d.tipo === 'longtext' && <textarea value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit', resize: 'vertical' }} />}

    {d.tipo === 'choice' && (d.options || []).map(opt => (
      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg)', borderRadius: 6, marginBottom: 6, cursor: 'pointer', border: value === opt ? '1px solid #F59E0B' : '1px solid var(--border)' }}>
        <input type="radio" name={d.id} value={opt} checked={value === opt} onChange={() => onChange(opt)} />
        <span>{opt}</span>
      </label>
    ))}

    {d.tipo === 'multichoice' && (d.options || []).map(opt => {
      const arr = Array.isArray(value) ? value : []
      const sel = arr.includes(opt)
      return <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--bg)', borderRadius: 6, marginBottom: 6, cursor: 'pointer', border: sel ? '1px solid #F59E0B' : '1px solid var(--border)' }}>
        <input type="checkbox" checked={sel} onChange={() => onChange(sel ? arr.filter(x => x !== opt) : [...arr, opt])} />
        <span>{opt}</span>
      </label>
    })}
  </div>
}

function NpsScale({ value, onChange }) {
  return <div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 4 }}>
      {Array.from({ length: 11 }).map((_, i) => {
        const sel = value === i
        const c = i <= 6 ? '#EF4444' : i <= 8 ? '#F59E0B' : '#10B981'
        return <button key={i} onClick={() => onChange(i)} style={{
          padding: '10px 0', background: sel ? c : '#0f1420', color: sel ? '#0f1420' : '#cbd5e1',
          border: '1px solid ' + (sel ? c : '#2a3042'), borderRadius: 6,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>{i}</button>
      })}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
      <span>Per niente</span><span>Sicuramente sì</span>
    </div>
  </div>
}

function RatingStars({ value, onChange }) {
  return <div style={{ display: 'flex', gap: 6 }}>
    {[1, 2, 3, 4, 5].map(n => (
      <button key={n} onClick={() => onChange(n)} style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 32, color: (value || 0) >= n ? '#F59E0B' : '#2a3042',
        padding: 0,
      }}></button>
    ))}
  </div>
}

const inputStyle = {
  width: '100%', padding: '10px 12px', background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, outline: 'none',
}
