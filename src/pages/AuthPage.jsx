import { useState } from 'react'
import { supabase } from '../lib/supabase'
const s = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'var(--bg)' },
  box: { width: '100%', maxWidth: '400px' },
  logo: { textAlign: 'center', marginBottom: '2rem' },
  logoTitle: { fontSize: '22px', fontWeight: '600', color: 'var(--text)', letterSpacing: '-0.02em' },
  logoSub: { fontSize: '13px', color: 'var(--text3)', marginTop: '4px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.75rem', boxShadow: 'var(--shadow)' },
  tabs: { display: 'flex', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', padding: '3px', marginBottom: '1.5rem' },
  tab: (a) => ({ flex: 1, padding: '7px 0', fontSize: '13px', fontWeight: a?'500':'400', color: a?'var(--text)':'var(--text3)', background: a?'var(--surface)':'transparent', border: 'none', borderRadius: '5px', cursor: 'pointer', transition: 'all .15s', boxShadow: a?'var(--shadow)':'none' }),
  label: { display: 'block', fontSize: '12px', fontWeight: '500', color: 'var(--text2)', marginBottom: '6px' },
  input: { width: '100%', padding: '9px 12px', fontSize: '14px', border: '1px solid var(--border-md)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text)', transition: 'border-color .15s' },
  fw: { marginBottom: '1rem' },
  btn: (l) => ({ width: '100%', padding: '10px', fontSize: '14px', fontWeight: '500', color: '#fff', background: l?'#93A3D4':'var(--blue)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: l?'not-allowed':'pointer', marginTop: '0.5rem' }),
  err: { background: 'var(--red-bg)', border: '1px solid rgba(153,27,27,.15)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: '13px', color: 'var(--red)', marginBottom: '1rem' },
  ok: { background: 'var(--green-bg)', border: '1px solid rgba(22,117,74,.15)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: '13px', color: 'var(--green)', marginBottom: '1rem' },
  switch: { textAlign: 'center', marginTop: '1rem', fontSize: '12px', color: 'var(--text3)' },
  switchBtn: { background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: '12px', fontWeight: '500', padding: 0, textDecoration: 'underline' },
}
export default function AuthPage() {
  // mode: 'owner' (login/signup imprenditore) | 'staff' (login dipendente con email+PIN)
  const [mode, setMode] = useState('owner')
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleOwnerSubmit(e) {
    e.preventDefault(); setError(''); setSuccess(''); setLoading(true)
    try {
      if (tab === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('Account creato! Controlla la tua email per confermare.')
      }
    } catch (err) { setError(err.message === 'Invalid login credentials' ? 'Email o password errata' : err.message)
    } finally { setLoading(false) }
  }

  async function handleStaffSubmit(e) {
    e.preventDefault(); setError(''); setSuccess(''); setLoading(true)
    try {
      const r = await fetch('/api/staff-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), pin: pin.trim() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore login')
      // Setta la sessione Supabase: da qui in avanti il client e' loggato come dipendente
      const { error } = await supabase.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token })
      if (error) throw error
      // App.jsx via onAuthStateChange ricaricherà la dashboard automaticamente
    } catch (err) { setError(err.message)
    } finally { setLoading(false) }
  }

  const inp = (v,fn) => ({ value: v, onChange: e => fn(e.target.value), onFocus: e => e.target.style.borderColor='var(--blue)', onBlur: e => e.target.style.borderColor='var(--border-md)' })
  return (
    <div style={s.wrap}><div style={s.box}>
      <div style={s.logo}><div style={s.logoTitle}>Convivia</div><div style={s.logoSub}>Gestionale ristoranti</div></div>
      <div style={s.card}>
        {mode === 'owner' ? (
          <>
            <div style={s.tabs}>
              <button style={s.tab(tab==='login')} onClick={() => { setTab('login'); setError(''); setSuccess('') }}>Accedi</button>
              <button style={s.tab(tab==='signup')} onClick={() => { setTab('signup'); setError(''); setSuccess('') }}>Registrati</button>
            </div>
            {error && <div style={s.err}>{error}</div>}
            {success && <div style={s.ok}>{success}</div>}
            <form onSubmit={handleOwnerSubmit}>
              <div style={s.fw}><label style={s.label}>Email</label><input style={s.input} type="email" placeholder="nome@esempio.it" required {...inp(email, setEmail)} /></div>
              <div style={s.fw}><label style={s.label}>Password</label><input style={s.input} type="password" placeholder={tab==='signup'?'Min. 8 caratteri':'••••••••'} required minLength={tab==='signup'?8:1} {...inp(password, setPassword)} /></div>
              <button type="submit" style={s.btn(loading)} disabled={loading}>{loading?'Caricamento...':tab==='login'?'Accedi':'Crea account'}</button>
            </form>
            <div style={s.switch}>
              Sei un dipendente? <button type="button" style={s.switchBtn} onClick={() => { setMode('staff'); setError(''); setSuccess('') }}>Accedi con PIN</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>Accesso dipendente</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 18 }}>
              Inserisci l'email che ti ha fornito il tuo datore di lavoro e il tuo PIN a 4 cifre.
            </div>
            {error && <div style={s.err}>{error}</div>}
            <form onSubmit={handleStaffSubmit}>
              <div style={s.fw}><label style={s.label}>Email</label><input style={s.input} type="email" placeholder="mario.rossi@…" required {...inp(email, setEmail)} /></div>
              <div style={s.fw}><label style={s.label}>PIN (4 cifre)</label><input style={{...s.input, letterSpacing: '.4em', textAlign: 'center', fontSize: 18}} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="••••" required {...inp(pin, setPin)} /></div>
              <button type="submit" style={s.btn(loading)} disabled={loading}>{loading?'Verifica…':'Entra'}</button>
            </form>
            <div style={s.switch}>
              Sei l'imprenditore? <button type="button" style={s.switchBtn} onClick={() => { setMode('owner'); setError(''); setSuccess('') }}>Accedi con password</button>
            </div>
          </>
        )}
      </div>
    </div></div>
  )
}
