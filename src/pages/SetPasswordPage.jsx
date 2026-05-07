// Pagina mostrata al cliente quando arriva sull'app via:
//  - Magic link di invito (primo accesso, deve impostare la password)
//  - Magic link di recovery (ha cliccato "password dimenticata")
//
// Supabase ha gia' loggato la sessione tramite il token nell'URL
// (detectSessionInUrl: true di default). Qui deve solo settare la password.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function SetPasswordPage({ mode = 'invite', email }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Pulisce l'hash dall'URL dopo il primo render (i token sono gia' stati consumati)
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  const submit = async (e) => {
    e?.preventDefault()
    setError('')
    if (password.length < 8) { setError('La password deve essere lunga almeno 8 caratteri'); return }
    if (password !== confirm) { setError('Le due password non coincidono'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setError(error.message); return }
    setDone(true)
    // Dopo 1.5s ricarica per andare alla dashboard normalmente
    setTimeout(() => { window.location.href = '/' }, 1500)
  }

  return <div style={{
    minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
    fontFamily: "'DM Sans',system-ui,sans-serif",
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  }}>
    <form onSubmit={submit} style={{
      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 16,
      padding: '36px 32px', maxWidth: 440, width: '100%',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>{mode === 'recovery' ? '' : ''}</div>
        <h1 style={{ fontSize: 22, margin: '0 0 6px 0', fontWeight: 700 }}>
          {mode === 'recovery' ? 'Reimposta password' : 'Benvenuto su Convivia'}
        </h1>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {mode === 'recovery'
            ? 'Imposta una nuova password per il tuo account.'
            : 'Crea la password per accedere alla tua dashboard.'}
          {email && <><br /><strong style={{ color: 'var(--text)' }}>{email}</strong></>}
        </div>
      </div>

      {done ? (
        <div style={{
          background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)',
          borderRadius: 8, padding: '14px 16px', textAlign: 'center',
          fontSize: 13, color: '#10B981',
        }}>
          Password impostata. Ti porto alla dashboard…
        </div>
      ) : (
        <>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Nuova password (min 8 caratteri)</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus
              required minLength={8}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }} />
          </label>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Conferma password</div>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              required minLength={8}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }} />
          </label>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
              borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#FCA5A5',
              marginBottom: 12,
            }}>{error}</div>
          )}
          <button type="submit" disabled={saving}
            style={{
              width: '100%', padding: '11px', borderRadius: 6,
              background: saving ? '#1a1f2e' : '#F59E0B',
              color: saving ? '#94a3b8' : '#0f1420',
              fontWeight: 600, fontSize: 14, border: 'none',
              cursor: saving ? 'wait' : 'pointer',
            }}>
            {saving ? 'Salvo…' : (mode === 'recovery' ? 'Imposta nuova password' : 'Crea password & entra')}
          </button>
        </>
      )}
    </form>
  </div>
}
