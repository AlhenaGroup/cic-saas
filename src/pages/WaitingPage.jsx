// Pagina mostrata ai clienti il cui account NON e' ancora stato configurato
// dall'admin (manca cic_api_key in user_settings).

import { supabase } from '../lib/supabase'

export default function WaitingPage({ email }) {
  return <div style={{
    minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
    fontFamily: "'DM Sans',system-ui,sans-serif",
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  }}>
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 16,
      padding: '48px 40px', maxWidth: 520, width: '100%', textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
      <h1 style={{ fontSize: 22, margin: '0 0 8px 0', fontWeight: 700 }}>
        Account in fase di attivazione
      </h1>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 28, lineHeight: 1.6 }}>
        Stiamo configurando la tua dashboard <strong>{email}</strong>.<br />
        Riceverai una notifica appena sarà pronta — di solito entro 24 ore.
      </div>

      <div style={{
        background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)',
        borderRadius: 8, padding: '14px 16px', textAlign: 'left',
        fontSize: 12, color: '#D97706', marginBottom: 24,
      }}>
        <strong>Hai bisogno di assistenza?</strong><br />
        <span style={{ color: 'var(--text2)' }}>
          Scrivi a <a href="mailto:support@alhenagroup.com" style={{ color: '#F59E0B' }}>support@alhenagroup.com</a> o
          chiama il +39 011 1234567
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        <button onClick={() => window.location.reload()}
          style={{
            background: '#F59E0B', color: 'var(--text)', fontWeight: 600,
            border: 'none', padding: '10px 20px', borderRadius: 6, cursor: 'pointer',
          }}>Ricarica</button>
        <button onClick={() => supabase.auth.signOut()}
          style={{
            background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)',
            padding: '10px 20px', borderRadius: 6, cursor: 'pointer',
          }}>Esci</button>
      </div>
    </div>
  </div>
}
