import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getToken, getSalesPoints } from '../lib/cicApi'
const s = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'var(--bg)' },
  box: { width: '100%', maxWidth: '480px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.75rem', boxShadow: 'var(--shadow)' },
  title: { fontSize: '16px', fontWeight: '500', color: 'var(--text)', marginBottom: '6px' },
  sub: { fontSize: '13px', color: 'var(--text2)', marginBottom: '1.5rem', lineHeight: '1.6' },
  label: { display: 'block', fontSize: '12px', fontWeight: '500', color: 'var(--text2)', marginBottom: '6px' },
  input: { width: '100%', padding: '9px 12px', fontSize: '13px', fontFamily: "'DM Mono', monospace", border: '1px solid var(--border-md)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text)' },
  hint: { fontSize: '12px', color: 'var(--text3)', marginTop: '6px' },
  btn: (d) => ({ width: '100%', padding: '10px', fontSize: '14px', fontWeight: '500', color: '#fff', background: d?'#93A3D4':'var(--blue)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: d?'not-allowed':'pointer', marginTop: '1.25rem' }),
  err: { background: 'var(--red-bg)', border: '1px solid rgba(153,27,27,.15)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: '13px', color: 'var(--red)', marginTop: '1rem' },
  divider: { borderTop: '1px solid var(--border)', margin: '1.5rem 0' },
  stepRow: { display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' },
  stepNum: { width: '20px', height: '20px', borderRadius: '50%', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '500', color: 'var(--text2)', flexShrink: 0 },
  stepText: { fontSize: '12px', color: 'var(--text2)', lineHeight: '1.5' },
  logout: { fontSize: '12px', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', marginTop: '1rem', display: 'block', width: '100%', textAlign: 'center' },
}
export default function SetupPage({ onSaved }) {
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function handleSave(e) {
    e.preventDefault(); if (!apiKey.trim()) return; setError(''); setLoading(true)
    try {
      const token = await getToken(apiKey.trim())
      const salesPoints = await getSalesPoints(token)
      const { data: { user } } = await supabase.auth.getUser()
      const { error: dbErr } = await supabase.from('user_settings').upsert({ user_id: user.id, cic_api_key: apiKey.trim(), sales_points: salesPoints, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (dbErr) throw dbErr
      if (onSaved) onSaved()
    } catch (err) { setError(err.message?.includes('API Key') ? 'API Key non valida. Verifica di avere il piano Enterprise su Cassa in Cloud.' : 'Errore: ' + err.message)
    } finally { setLoading(false) }
  }
  return (
    <div style={s.wrap}><div style={s.box}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text)', letterSpacing: '-0.02em' }}>CIC Dashboard</div>
        <div style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '4px' }}>Configura il tuo account</div>
      </div>
      <div style={s.card}>
        <div style={s.title}>Collega Cassa in Cloud</div>
        <div style={s.sub}>Inserisci la tua API Key per connettere il tuo account CiC. I tuoi dati sono privati.</div>
        <form onSubmit={handleSave}>
          <label style={s.label}>API Key Cassa in Cloud</label>
          <input style={s.input} type="password" placeholder="La tua API Key..." value={apiKey} onChange={e => setApiKey(e.target.value)} onFocus={e => e.target.style.borderColor='var(--blue)'} onBlur={e => e.target.style.borderColor='var(--border-md)'} required />
          <div style={s.hint}>La chiave viene salvata in modo sicuro e usata solo per leggere i tuoi dati.</div>
          {error && <div style={s.err}>{error}</div>}
          <button type="submit" style={s.btn(loading || !apiKey.trim())} disabled={loading || !apiKey.trim()}>{loading?'Verifica in corso...':'Connetti e continua →'}</button>
        </form>
        <div style={s.divider} />
        <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text2)', marginBottom: '10px' }}>Come trovare la tua API Key</div>
        {['Accedi a fo.cassanova.com con il tuo account','Vai in Impostazioni → sezione API','Clicca su "Genera nuova API Key"','Copia la chiave e incollala qui sopra'].map((step, i) => (
          <div key={i} style={s.stepRow}><div style={s.stepNum}>{i+1}</div><div style={s.stepText}>{step}</div></div>
        ))}
        <div style={{ ...s.hint, marginTop: '12px', padding: '8px', background: 'var(--amber-bg)', borderRadius: 'var(--radius-sm)', color: 'var(--amber)' }}>
          Richiede piano Risto Enterprise o Retail Enterprise su Cassa in Cloud
        </div>
      </div>
      <button style={s.logout} onClick={() => supabase.auth.signOut()}>Esci dall'account</button>
    </div></div>
  )
}
