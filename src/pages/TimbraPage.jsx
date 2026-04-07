import { useState, useEffect } from 'react'

const API = '/api/attendance'

export default function TimbraPage() {
  const params = new URLSearchParams(window.location.search)
  const locale = params.get('locale') || 'LOCALE'

  const [pin, setPin] = useState('')
  const [step, setStep] = useState('pin') // pin, confirm, done, error
  const [employee, setEmployee] = useState(null)
  const [suggestedTipo, setSuggestedTipo] = useState('entrata')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('waiting') // waiting, loading, ok, error
  const [coords, setCoords] = useState(null)
  const [history, setHistory] = useState([])

  // Richiedi GPS subito
  useEffect(() => {
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsStatus('ok') },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  const handlePin = (digit) => {
    if (pin.length >= 4) return
    const newPin = pin + digit
    setPin(newPin)
    if (newPin.length === 4) verifyPin(newPin)
  }

  const clearPin = () => setPin('')

  const verifyPin = async (p) => {
    setLoading(true); setMessage('')
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin: p, locale }) })
      const d = await r.json()
      if (!r.ok) { setMessage(d.error); setStep('error'); setPin(''); setLoading(false); return }
      setEmployee(d.employee)
      setSuggestedTipo(d.suggestedTipo)
      setStep('confirm')
      // Carica storico
      const h = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'history', pin: p, locale }) })
      const hd = await h.json()
      setHistory(hd.records || [])
    } catch (e) { setMessage('Errore di connessione'); setStep('error') }
    setLoading(false)
  }

  const timbra = async (tipo) => {
    if (gpsStatus !== 'ok') { setMessage('GPS non disponibile. Attiva la localizzazione.'); return }
    setLoading(true); setMessage('')
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'timbra', pin, locale, tipo, lat: coords?.lat, lng: coords?.lng }) })
      const d = await r.json()
      if (!r.ok) { setMessage(d.error); setLoading(false); return }
      setMessage(`${tipo.toUpperCase()} registrata alle ${new Date(d.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`)
      setStep('done')
    } catch (e) { setMessage('Errore di connessione') }
    setLoading(false)
  }

  const reset = () => { setPin(''); setStep('pin'); setEmployee(null); setMessage(''); setHistory([]) }

  const bgColor = '#0f1420'
  const accent = '#F59E0B'

  return <div style={{ minHeight: '100vh', background: bgColor, fontFamily: "'DM Sans',system-ui,sans-serif", color: '#e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px' }}>
    {/* Header */}
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <div style={{ width: 40, height: 40, background: accent, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: bgColor, fontSize: 16, marginBottom: 8 }}>C</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>Timbratura</div>
      <div style={{ fontSize: 14, color: '#94a3b8' }}>{locale}</div>
      <div style={{ marginTop: 8, fontSize: 11 }}>
        {gpsStatus === 'loading' && <span style={{ color: '#F59E0B' }}>Localizzazione in corso...</span>}
        {gpsStatus === 'ok' && <span style={{ color: '#10B981' }}>GPS attivo</span>}
        {gpsStatus === 'error' && <span style={{ color: '#EF4444' }}>GPS non disponibile - attiva la localizzazione</span>}
      </div>
    </div>

    {/* PIN Input */}
    {step === 'pin' && <div style={{ maxWidth: 320, width: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>Inserisci il tuo PIN</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {[0, 1, 2, 3].map(i => <div key={i} style={{
            width: 48, height: 56, borderRadius: 12,
            background: pin.length > i ? accent : '#1a1f2e',
            border: '2px solid ' + (pin.length > i ? accent : '#2a3042'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 700, color: pin.length > i ? bgColor : '#2a3042'
          }}>{pin.length > i ? '*' : ''}</div>)}
        </div>
      </div>

      {/* Numpad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'C'].map((n, i) => n === null ? <div key={i} /> :
          <button key={i} onClick={() => n === 'C' ? clearPin() : handlePin(String(n))} disabled={loading}
            style={{ height: 56, borderRadius: 12, border: 'none', fontSize: 22, fontWeight: 600, cursor: 'pointer',
              background: n === 'C' ? '#EF4444' : '#1a1f2e', color: n === 'C' ? '#fff' : '#e2e8f0' }}>
            {n}
          </button>
        )}
      </div>
      {loading && <div style={{ textAlign: 'center', marginTop: 16, color: '#F59E0B' }}>Verifica in corso...</div>}
    </div>}

    {/* Conferma */}
    {step === 'confirm' && employee && <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
      <div style={{ background: '#1a1f2e', borderRadius: 16, padding: 24, marginBottom: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#2a3042', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, color: accent, marginBottom: 12 }}>
          {employee.nome?.charAt(0)?.toUpperCase()}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{employee.nome}</div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>{employee.ruolo} - {locale}</div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button onClick={() => timbra('entrata')} disabled={loading}
          style={{ flex: 1, height: 56, borderRadius: 12, border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            background: suggestedTipo === 'entrata' ? '#10B981' : '#1a1f2e', color: suggestedTipo === 'entrata' ? '#fff' : '#10B981',
            border: '2px solid #10B981' }}>
          ENTRATA
        </button>
        <button onClick={() => timbra('uscita')} disabled={loading}
          style={{ flex: 1, height: 56, borderRadius: 12, border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            background: suggestedTipo === 'uscita' ? '#EF4444' : '#1a1f2e', color: suggestedTipo === 'uscita' ? '#fff' : '#EF4444',
            border: '2px solid #EF4444' }}>
          USCITA
        </button>
      </div>

      {message && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: 12, fontSize: 13, color: '#FCA5A5', marginBottom: 12 }}>{message}</div>}

      <button onClick={reset} style={{ background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '8px 20px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>Annulla</button>

      {/* Storico oggi */}
      {history.length > 0 && <div style={{ marginTop: 20, textAlign: 'left' }}>
        <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Oggi</div>
        {history.map((h, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e2636', fontSize: 13 }}>
          <span style={{ color: h.tipo === 'entrata' ? '#10B981' : '#EF4444', fontWeight: 600 }}>{h.tipo.toUpperCase()}</span>
          <span style={{ color: '#94a3b8' }}>{new Date(h.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>)}
      </div>}
    </div>}

    {/* Completato */}
    {step === 'done' && <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 12 }}>✓</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#10B981', marginBottom: 8 }}>{message}</div>
      <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24 }}>{employee?.nome}</div>
      <button onClick={reset} style={{ background: accent, color: bgColor, border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Nuova timbratura</button>
    </div>}

    {/* Errore */}
    {step === 'error' && <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 12 }}>✗</div>
      <div style={{ fontSize: 16, color: '#EF4444', marginBottom: 8 }}>{message}</div>
      <button onClick={reset} style={{ background: '#1a1f2e', color: '#e2e8f0', border: '1px solid #2a3042', borderRadius: 12, padding: '12px 32px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Riprova</button>
    </div>}
  </div>
}
