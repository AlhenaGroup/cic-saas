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
}
export default function AuthPage() {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  async function handleSubmit(e) {
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
  const inp = (v,fn) => ({ value: v, onChange: e => fn(e.target.value), onFocus: e => e.target.style.borderColor='var(--blue)', onBlur: e => e.target.style.borderColor='var(--border-md)' })
  return (
    <div style={s.wrap}><div style={s.box}>
      <div style={s.logo}><div style={s.logoTitle}>CIC Dashboard</div><div style={s.logoSub}>Analisi avanzata per Cassa in Cloud</div></div>
      <div style={s.card}>
        <div style={s.tabs}>
          <button style={s.tab(tab==='login')} onClick={() => { setTab('login'); setError(''); setSuccess('') }}>Accedi</button>
          <button style={s.tab(tab==='signup')} onClick={() => { setTab('signup'); setError(''); setSuccess('') }}>Registrati</button>
        </div>
        {error && <div style={s.err}>{error}</div>}
        {success && <div style={s.ok}>{success}</div>}
        <form onSubmit={handleSubmit}>
          <div style={s.fw}><label style={s.label}>Email</label><input style={s.input} type="email" placeholder="nome@esempio.it" required {...inp(email, setEmail)} /></div>
          <div style={s.fw}><label style={s.label}>Password</label><input style={s.input} type="password" placeholder={tab==='signup'?'Min. 8 caratteri':'••••••••'} required minLength={tab==='signup'?8:1} {...inp(password, setPassword)} /></div>
          <button type="submit" style={s.btn(loading)} disabled={loading}>{loading?'Caricamento...':tab==='login'?'Accedi':'Crea account'}</button>
        </form>
      </div>
    </div></div>
  )
}
