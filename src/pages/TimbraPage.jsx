import { useState, useEffect, useCallback } from 'react'

const API = '/api/attendance'
const ALL_LOCALI = ['REMEMBEER', 'CASA DE AMICIS', 'BIANCOLATTE']

const bgColor = '#0f1420'
const accent = '#F59E0B'

async function apiCall(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Errore di connessione')
  return d
}

export default function TimbraPage() {
  const params = new URLSearchParams(window.location.search)
  const locale = params.get('locale') || 'LOCALE'

  // Manifest PWA e' gia' generato dallo script inline in index.html al page load
  // (scelto in base al path) per evitare race condition con Chrome/Safari.
  // Qui aggiorno solo il titolo se cambia il locale durante la sessione.
  useEffect(() => { document.title = locale ? 'Timbra · ' + locale : 'Timbra' }, [locale])

  const [pin, setPin] = useState('')
  const [step, setStep] = useState('pin') // pin | menu | presenza | consumo | trasferimento | inventario | done | error
  const [employee, setEmployee] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [suggestedTipo, setSuggestedTipo] = useState('entrata')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('waiting')
  const [coords, setCoords] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsStatus('ok') },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  const handlePin = (d) => {
    if (pin.length >= 4) return
    const np = pin + d
    setPin(np)
    if (np.length === 4) verifyPin(np)
  }
  const clearPin = () => setPin('')

  const verifyPin = async (p) => {
    setLoading(true); setMessage('')
    try {
      const d = await apiCall({ action: 'verify', pin: p, locale })
      setEmployee(d.employee)
      setPermissions(d.permissions || {})
      setSuggestedTipo(d.suggestedTipo)
      // Carico storico timbrature (sempre utile)
      try {
        const h = await apiCall({ action: 'history', pin: p, locale })
        setHistory(h.records || [])
      } catch {}
      // Mostro sempre il menu: anche se ha 1 solo permesso, ci sono
      // comunque le viste informative (turni/ore/ferie) disponibili.
      setStep('menu')
    } catch (e) { setMessage(e.message); setStep('error'); setPin('') }
    setLoading(false)
  }

  const goTo = (s) => { setStep(s); setMessage('') }
  const reset = () => {
    setPin(''); setStep('pin'); setEmployee(null); setPermissions({})
    setMessage(''); setHistory([])
  }

  const timbra = async (tipo) => {
    if (gpsStatus !== 'ok') { setMessage('GPS non disponibile. Attiva la localizzazione.'); return }
    setLoading(true); setMessage('')
    try {
      const d = await apiCall({ action: 'timbra', pin, locale, tipo, lat: coords?.lat, lng: coords?.lng })
      setMessage(`${tipo.toUpperCase()} registrata alle ${new Date(d.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`)
      setStep('done')
    } catch (e) { setMessage(e.message) }
    setLoading(false)
  }

  return <div style={{ minHeight: '100vh', background: bgColor, fontFamily: "'DM Sans',system-ui,sans-serif", color: '#e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px' }}>
    <div style={{ textAlign: 'center', marginBottom: 16 }}>
      <div style={{ width: 40, height: 40, background: accent, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: bgColor, fontSize: 16, marginBottom: 8 }}>C</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{step === 'pin' ? 'Accesso' : step === 'menu' ? 'Cosa vuoi fare?' : stepLabel(step)}</div>
      <div style={{ fontSize: 14, color: '#94a3b8' }}>{locale}</div>
      {step === 'pin' && <div style={{ marginTop: 8, fontSize: 11 }}>
        {gpsStatus === 'loading' && <span style={{ color: '#F59E0B' }}>Localizzazione…</span>}
        {gpsStatus === 'ok' && <span style={{ color: '#10B981' }}>GPS attivo</span>}
        {gpsStatus === 'error' && <span style={{ color: '#EF4444' }}>Attiva la localizzazione</span>}
      </div>}
    </div>

    {step === 'pin' && <>
      <PinPad pin={pin} onDigit={handlePin} onClear={clearPin} loading={loading} />
      <InstallBanner />
    </>}

    {step === 'menu' && employee && <MainMenu
      employee={employee} permissions={permissions} onChoose={goTo} onReset={reset}
    />}

    {step === 'presenza' && employee && <PresenzaPanel
      employee={employee} suggestedTipo={suggestedTipo} history={history}
      onTimbra={timbra} onBack={() => goTo('menu')} loading={loading} message={message} gpsStatus={gpsStatus}
    />}

    {step === 'consumo' && <ConsumoPanel pin={pin} locale={locale} employee={employee}
      onDone={(msg) => { setMessage(msg); setStep('done') }} onBack={() => goTo('menu')} />}

    {step === 'trasferimento' && <TrasferimentoPanel pin={pin} locale={locale} employee={employee}
      onDone={(msg) => { setMessage(msg); setStep('done') }} onBack={() => goTo('menu')} />}

    {step === 'inventario' && <InventarioPanel pin={pin} locale={locale} employee={employee}
      onDone={(msg) => { setMessage(msg); setStep('done') }} onBack={() => goTo('menu')} />}

    {step === 'miei-turni' && <MieiTurniPanel pin={pin} onBack={() => goTo('menu')} />}
    {step === 'mie-ore' && <MieOrePanel pin={pin} onBack={() => goTo('menu')} />}
    {step === 'mie-ferie' && <MieFeriePanel pin={pin} onBack={() => goTo('menu')} />}

    {step === 'done' && <DonePanel message={message} employee={employee} onReset={reset} />}
    {step === 'error' && <ErrorPanel message={message} onReset={reset} />}
  </div>
}

function stepLabel(s) {
  return {
    presenza: 'Timbratura presenza', consumo: 'Consumo personale',
    trasferimento: 'Spostamento merce', inventario: 'Inventario',
    'miei-turni': 'I miei turni', 'mie-ore': 'Le mie ore', 'mie-ferie': 'Le mie ferie',
    done: 'Fatto', error: 'Errore',
  }[s] || ''
}

// ─── PIN PAD ───────────────────────────────────────────────────────
function PinPad({ pin, onDigit, onClear, loading }) {
  return <div style={{ maxWidth: 320, width: '100%' }}>
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
    <div className="keep-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'C'].map((n, i) => n === null ? <div key={i} /> :
        <button key={i} onClick={() => n === 'C' ? onClear() : onDigit(String(n))} disabled={loading}
          style={{ height: 56, borderRadius: 12, border: 'none', fontSize: 22, fontWeight: 600, cursor: 'pointer',
            background: n === 'C' ? '#EF4444' : '#1a1f2e', color: n === 'C' ? '#fff' : '#e2e8f0' }}>{n}</button>
      )}
    </div>
    {loading && <div style={{ textAlign: 'center', marginTop: 16, color: '#F59E0B' }}>Verifica…</div>}
  </div>
}

// ─── MENU AZIONI ────────────────────────────────────────────────────
function MainMenu({ employee, permissions, onChoose, onReset }) {
  // Azioni operative filtrate dai permessi
  const azioni = [
    { k: 'presenza', icon: '🕐', label: 'Timbra presenza', color: '#10B981' },
    { k: 'consumo', icon: '🍪', label: 'Consumo personale', color: '#F59E0B' },
    { k: 'trasferimento', icon: '🔀', label: 'Spostamento merce', color: '#3B82F6' },
    { k: 'inventario', icon: '📋', label: 'Inventario', color: '#8B5CF6' },
  ].filter(i => permissions[i.k === 'trasferimento' ? 'spostamenti' : i.k])
  // Viste info personali: sempre visibili (sola lettura dei propri dati)
  const info = [
    { k: 'miei-turni', icon: '📆', label: 'I miei turni', color: '#3B82F6' },
    { k: 'mie-ore', icon: '⏱', label: 'Le mie ore', color: '#10B981' },
    { k: 'mie-ferie', icon: '🏖️', label: 'Le mie ferie', color: '#F97316' },
  ]
  const items = [...azioni, ...info]

  return <div style={{ maxWidth: 360, width: '100%' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 16, padding: 20, marginBottom: 16, textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#2a3042', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: accent, marginBottom: 10 }}>
        {employee.nome?.charAt(0)?.toUpperCase()}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{employee.nome}</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{employee.ruolo || '—'}</div>
    </div>
    {items.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      Nessun permesso abilitato. Contatta l'amministratore.
    </div>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
      {items.map(it => (
        <button key={it.k} onClick={() => onChoose(it.k)}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 12, border: `2px solid ${it.color}`, background: '#1a1f2e', color: '#e2e8f0', fontSize: 16, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ fontSize: 24 }}>{it.icon}</span>
          <span style={{ flex: 1 }}>{it.label}</span>
          <span style={{ color: it.color }}>→</span>
        </button>
      ))}
    </div>
    <button onClick={onReset} style={{ marginTop: 16, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>Esci</button>
  </div>
}

// ─── PRESENZA ───────────────────────────────────────────────────────
function PresenzaPanel({ employee, suggestedTipo, history, onTimbra, onBack, loading, message, gpsStatus }) {
  return <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 16, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{employee.nome}</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>GPS: {gpsStatus === 'ok' ? '✓' : '⚠ ' + gpsStatus}</div>
    </div>
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      <button onClick={() => onTimbra('entrata')} disabled={loading}
        style={{ flex: 1, height: 56, borderRadius: 12, border: '2px solid #10B981', fontSize: 16, fontWeight: 700, cursor: 'pointer',
          background: suggestedTipo === 'entrata' ? '#10B981' : '#1a1f2e', color: suggestedTipo === 'entrata' ? '#fff' : '#10B981' }}>ENTRATA</button>
      <button onClick={() => onTimbra('uscita')} disabled={loading}
        style={{ flex: 1, height: 56, borderRadius: 12, border: '2px solid #EF4444', fontSize: 16, fontWeight: 700, cursor: 'pointer',
          background: suggestedTipo === 'uscita' ? '#EF4444' : '#1a1f2e', color: suggestedTipo === 'uscita' ? '#fff' : '#EF4444' }}>USCITA</button>
    </div>
    {message && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: 12, fontSize: 13, color: '#FCA5A5', marginBottom: 12 }}>{message}</div>}
    <button onClick={onBack} style={{ background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '8px 20px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Indietro</button>
    {history.length > 0 && <div style={{ marginTop: 20, textAlign: 'left' }}>
      <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Oggi</div>
      {history.map((h, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e2636', fontSize: 13 }}>
        <span style={{ color: h.tipo === 'entrata' ? '#10B981' : '#EF4444', fontWeight: 600 }}>{h.tipo.toUpperCase()}</span>
        <span style={{ color: '#94a3b8' }}>{new Date(h.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>)}
    </div>}
  </div>
}

// ─── CONSUMO PERSONALE (ricette) ────────────────────────────────────
function ConsumoPanel({ pin, locale, onDone, onBack }) {
  const [recipes, setRecipes] = useState([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [porzioni, setPorzioni] = useState('1')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [repFilter, setRepFilter] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const d = await apiCall({ action: 'recipes', pin })
        setRecipes(d.recipes || [])
      } catch (e) { setErr(e.message) }
    })()
  }, [pin])

  const reparti = [...new Set(recipes.map(r => r.reparto).filter(Boolean))].sort()
  const filtered = recipes.filter(r => {
    if (q && !r.nome_prodotto.toLowerCase().includes(q.toLowerCase())) return false
    if (repFilter && r.reparto !== repFilter) return false
    return true
  })

  const submit = async () => {
    if (!selected || !porzioni) return
    setLoading(true); setErr('')
    try {
      const d = await apiCall({ action: 'consumo', pin, locale, nome_prodotto: selected.nome_prodotto, porzioni: Number(porzioni), note })
      const n = d.porzioni > 1 ? d.porzioni + 'x ' : ''
      onDone(`Registrato consumo: ${n}${selected.nome_prodotto}`)
    } catch (e) { setErr(e.message); setLoading(false) }
  }

  return <div style={{ maxWidth: 400, width: '100%' }}>
    {!selected ? <>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca prodotto..."
        style={{ width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 8, outline: 'none' }} />
      {reparti.length > 1 && <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10, paddingBottom: 4 }}>
        <button onClick={() => setRepFilter('')}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 16, border: 'none', background: !repFilter ? accent : '#1a1f2e', color: !repFilter ? bgColor : '#94a3b8', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Tutto</button>
        {reparti.map(r => (
          <button key={r} onClick={() => setRepFilter(r === repFilter ? '' : r)}
            style={{ padding: '6px 12px', fontSize: 12, borderRadius: 16, border: 'none', background: repFilter === r ? accent : '#1a1f2e', color: repFilter === r ? bgColor : '#94a3b8', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>{r}</button>
        ))}
      </div>}
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Nessuna ricetta trovata</div>}
        {filtered.map(r => (
          <button key={r.id} onClick={() => setSelected(r)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '12px 14px', marginBottom: 6, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{r.nome_prodotto}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{r.reparto || ''} {r.ingredienti?.length ? '· ' + r.ingredienti.length + ' ingr.' : ''}</div>
            </div>
            {r.prezzo_vendita > 0 && <span style={{ color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>€ {Number(r.prezzo_vendita).toFixed(2)}</span>}
          </button>
        ))}
      </div>
    </> : <>
      <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.nome_prodotto}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{selected.reparto || ''}</div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>Ingredienti che verranno scaricati:</div>
        <div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
          {(selected.ingredienti || []).map((i, idx) => (
            <div key={idx}>• {i.nome_articolo}: {i.quantita} {i.unita}</div>
          ))}
        </div>
      </div>
      <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Quante porzioni?</label>
      <div className="keep-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
        {[1, 2, 3, 5].map(n => (
          <button key={n} onClick={() => setPorzioni(String(n))}
            style={{ padding: '12px', borderRadius: 10, border: '1px solid #2a3042', background: Number(porzioni) === n ? accent : '#1a1f2e', color: Number(porzioni) === n ? bgColor : '#e2e8f0', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>{n}x</button>
        ))}
      </div>
      <input type="number" step="1" min="1" value={porzioni} onChange={e => setPorzioni(e.target.value)}
        style={{ width: '100%', padding: '12px', fontSize: 16, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 10, outline: 'none', textAlign: 'center' }} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (opz.)"
        style={{ width: '100%', padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 12, outline: 'none' }} />
      {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setSelected(null)} disabled={loading}
          style={{ flex: 1, padding: '14px', borderRadius: 10, border: '1px solid #2a3042', background: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>← Cambia</button>
        <button onClick={submit} disabled={loading || !porzioni || Number(porzioni) <= 0}
          style={{ flex: 2, padding: '14px', borderRadius: 10, border: 'none', background: '#F59E0B', color: bgColor, fontSize: 15, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Registro…' : 'Conferma consumo'}
        </button>
      </div>
    </>}
    <button onClick={onBack} style={{ marginTop: 16, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Menu</button>
  </div>
}

// ─── TRASFERIMENTO ──────────────────────────────────────────────────
function TrasferimentoPanel({ pin, locale, onDone, onBack }) {
  const [localeTo, setLocaleTo] = useState(ALL_LOCALI.find(l => l !== locale) || '')
  const [articles, setArticles] = useState([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const loadArticles = useCallback(async () => {
    try {
      const d = await apiCall({ action: 'articles', pin, locale })
      setArticles(d.items || [])
    } catch (e) { setErr(e.message) }
  }, [pin, locale])
  useEffect(() => { loadArticles() }, [loadArticles])

  const filtered = q ? articles.filter(a => a.nome_articolo.toLowerCase().includes(q.toLowerCase())) : articles

  const submit = async () => {
    if (!selected || !qty || !localeTo) return
    setLoading(true); setErr('')
    try {
      await apiCall({ action: 'trasferimento', pin, locale_from: locale, locale_to: localeTo, nome_articolo: selected.nome_articolo, quantita: Number(qty), unita: selected.unita, note })
      onDone(`Trasferiti ${qty} ${selected.unita || ''} di ${selected.nome_articolo} da ${locale} a ${localeTo}`)
    } catch (e) { setErr(e.message); setLoading(false) }
  }

  return <div style={{ maxWidth: 360, width: '100%' }}>
    <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13 }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>Da: <strong style={{ color: '#e2e8f0' }}>{locale}</strong></div>
      <label style={{ color: '#94a3b8' }}>A:</label>
      <select value={localeTo} onChange={e => setLocaleTo(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: '1px solid #2a3042', background: '#0f1420', color: '#e2e8f0', marginTop: 6 }}>
        {ALL_LOCALI.filter(l => l !== locale).map(l => <option key={l} value={l}>{l}</option>)}
      </select>
    </div>
    {!selected ? <>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca articolo..."
        style={{ width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 10, outline: 'none' }} />
      <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Nessun articolo in {locale}</div>}
        {filtered.map(a => (
          <button key={a.nome_articolo} onClick={() => setSelected(a)}
            style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '12px 14px', marginBottom: 6, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left' }}>
            <span>{a.nome_articolo}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{Number(a.quantita || 0).toFixed(1)} {a.unita || ''}</span>
          </button>
        ))}
      </div>
    </> : <>
      <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{selected.nome_articolo}</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Disponibili: {Number(selected.quantita || 0).toFixed(1)} {selected.unita || ''}</div>
      </div>
      <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Quantità da spostare ({selected.unita || ''})</label>
      <input type="number" step="0.01" value={qty} onChange={e => setQty(e.target.value)}
        style={{ width: '100%', padding: '14px', fontSize: 18, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 10, outline: 'none', textAlign: 'center' }} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (opz.)"
        style={{ width: '100%', padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 12, outline: 'none' }} />
      {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setSelected(null)} disabled={loading}
          style={{ flex: 1, padding: '14px', borderRadius: 10, border: '1px solid #2a3042', background: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>← Cambia</button>
        <button onClick={submit} disabled={loading || !qty || Number(qty) <= 0}
          style={{ flex: 2, padding: '14px', borderRadius: 10, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Sposto…' : 'Conferma spostamento'}
        </button>
      </div>
    </>}
    <button onClick={onBack} style={{ marginTop: 16, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Menu</button>
  </div>
}

// ─── INVENTARIO ─────────────────────────────────────────────────────
// Magazzini standard + colori coerenti con WarehouseModule (ArticoliTab).
// Articoli con magazzino mancante finiscono in "Altro" come fallback.
const MAG_OPTIONS = [
  { key: 'tutti',          label: 'Tutti',         color: '#94a3b8', bg: 'rgba(148,163,184,.15)' },
  { key: 'food',           label: 'Food',          color: '#F59E0B', bg: 'rgba(245,158,11,.15)' },
  { key: 'beverage',       label: 'Beverage',      color: '#3B82F6', bg: 'rgba(59,130,246,.15)' },
  { key: 'materiali',      label: 'Materiali',     color: '#8B5CF6', bg: 'rgba(139,92,246,.15)' },
  { key: 'attrezzatura',   label: 'Attrezzatura',  color: '#10B981', bg: 'rgba(16,185,129,.15)' },
  { key: 'altro',          label: 'Altro',         color: '#64748b', bg: 'rgba(100,116,139,.15)' },
]
const MAG_BADGE = Object.fromEntries(MAG_OPTIONS.map(m => [m.key, m]))

// Risolve la chiave magazzino di un articolo (null/'' → 'altro')
const magKeyOf = (a) => {
  const m = (a.magazzino || '').toLowerCase().trim()
  return m || 'altro'
}

function InventarioPanel({ pin, locale, onDone, onBack }) {
  const [inventory, setInventory] = useState(null)
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [magFilter, setMagFilter] = useState('tutti')
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState({})

  const open = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const d = await apiCall({ action: 'inv-open', pin, locale })
      setInventory(d.inventory)
      const items = await apiCall({ action: 'inv-articles', pin, inventory_id: d.inventory.id })
      setItems(items.items || [])
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [pin, locale])
  useEffect(() => { open() }, [open])

  // Conteggio articoli per magazzino (per badge sui chip)
  const countByMag = items.reduce((acc, a) => {
    const k = magKeyOf(a)
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  countByMag.tutti = items.length

  const todoCount = items.filter(i => i.giacenza_reale == null || Number.isNaN(Number(i.giacenza_reale))).length

  const filtered = items.filter(a => {
    if (q && !a.nome_articolo.toLowerCase().includes(q.toLowerCase())) return false
    if (magFilter !== 'tutti' && magKeyOf(a) !== magFilter) return false
    if (onlyTodo && a.giacenza_reale != null && !Number.isNaN(Number(a.giacenza_reale))) return false
    return true
  })
  const counted = items.filter(i => i.giacenza_reale != null && !Number.isNaN(Number(i.giacenza_reale))).length

  const saveCount = async (nome_articolo, val, unita, prezzo_medio) => {
    setSaving(s => ({ ...s, [nome_articolo]: true }))
    try {
      await apiCall({ action: 'inv-count', pin, inventory_id: inventory.id, nome_articolo, giacenza_reale: Number(val), unita, prezzo_medio })
      setItems(prev => prev.map(x => x.nome_articolo === nome_articolo ? { ...x, giacenza_reale: Number(val) } : x))
    } catch (e) { alert(e.message) }
    setSaving(s => ({ ...s, [nome_articolo]: false }))
  }

  const chiudi = async () => {
    if (!confirm('Chiudere l\'inventario? Verranno applicate le correzioni al magazzino.')) return
    setLoading(true)
    try {
      const d = await apiCall({ action: 'inv-close', pin, inventory_id: inventory.id })
      onDone(`Inventario chiuso. ${d.correzioni} correzioni applicate.`)
    } catch (e) { setErr(e.message); setLoading(false) }
  }

  if (loading && !inventory) return <div style={{ color: '#F59E0B', padding: 20 }}>Caricamento…</div>

  return <div style={{ maxWidth: 400, width: '100%' }}>
    {inventory && <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Inventario {inventory.data}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{counted} / {items.length} articoli contati</div>
      </div>
      <button onClick={chiudi} disabled={loading || counted === 0}
        style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', background: counted > 0 ? '#10B981' : '#2a3042', color: counted > 0 ? '#fff' : '#64748b', cursor: counted > 0 ? 'pointer' : 'not-allowed' }}>
        Chiudi
      </button>
    </div>}
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca..."
      style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 8, outline: 'none' }} />
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 8, WebkitOverflowScrolling: 'touch' }} className="keep-grid">
      {MAG_OPTIONS.filter(m => m.key === 'tutti' || (countByMag[m.key] || 0) > 0).map(m => {
        const active = magFilter === m.key
        return <button key={m.key} onClick={() => setMagFilter(m.key)}
          style={{ flex: '0 0 auto', padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 999,
            border: `1px solid ${active ? m.color : '#2a3042'}`,
            background: active ? m.bg : 'transparent',
            color: active ? m.color : '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {m.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{countByMag[m.key] || 0}</span>
        </button>
      })}
    </div>
    <button onClick={() => setOnlyTodo(v => !v)}
      style={{ width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, marginBottom: 10,
        border: `1px solid ${onlyTodo ? '#F59E0B' : '#2a3042'}`,
        background: onlyTodo ? 'rgba(245,158,11,.15)' : 'transparent',
        color: onlyTodo ? '#F59E0B' : '#94a3b8', cursor: 'pointer' }}>
      {onlyTodo ? '☑ Mostra solo da contare' : '☐ Mostra solo da contare'} ({todoCount})
    </button>
    {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}
    <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
      {filtered.length === 0 && <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>Nessun articolo in questo magazzino.</div>}
      {filtered.map(a => {
        const mag = MAG_BADGE[magKeyOf(a)] || MAG_BADGE.altro
        return <div key={a.nome_articolo} style={{ background: '#1a1f2e', borderRadius: 10, padding: 10, marginBottom: 6, border: `1px solid ${a.giacenza_reale != null ? '#10B98144' : '#2a3042'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, minWidth: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: mag.color, background: mag.bg, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '.04em', flexShrink: 0 }}>{mag.label}</span>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome_articolo}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="number" step="0.01" placeholder="Conta reale"
              defaultValue={a.giacenza_reale ?? ''}
              onBlur={e => { if (e.target.value !== '') saveCount(a.nome_articolo, e.target.value, a.unita, a.prezzo_medio) }}
              style={{ flex: 1, padding: '10px 12px', fontSize: 16, borderRadius: 8, border: '1px solid #2a3042', background: '#0f1420', color: '#e2e8f0', outline: 'none', textAlign: 'center' }} />
            <span style={{ padding: '10px 12px', fontSize: 12, color: '#94a3b8' }}>{a.unita || ''}</span>
            {saving[a.nome_articolo] && <span style={{ padding: '10px', color: '#F59E0B', fontSize: 12 }}>…</span>}
          </div>
        </div>
      })}
    </div>
    <button onClick={onBack} style={{ marginTop: 12, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Menu</button>
  </div>
}

// ─── FEEDBACK ───────────────────────────────────────────────────────
function DonePanel({ message, employee, onReset }) {
  return <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
    <div style={{ fontSize: 64, marginBottom: 12 }}>✓</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981', marginBottom: 8 }}>{message}</div>
    <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24 }}>{employee?.nome}</div>
    <button onClick={onReset} style={{ background: accent, color: bgColor, border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Torna al PIN</button>
  </div>
}

function ErrorPanel({ message, onReset }) {
  return <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
    <div style={{ fontSize: 64, marginBottom: 12 }}>✗</div>
    <div style={{ fontSize: 16, color: '#EF4444', marginBottom: 8 }}>{message}</div>
    <button onClick={onReset} style={{ background: '#1a1f2e', color: '#e2e8f0', border: '1px solid #2a3042', borderRadius: 12, padding: '12px 32px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Riprova</button>
  </div>
}

// ─── INFO PERSONALI ─────────────────────────────────────────────────
const DAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

function MieiTurniPanel({ pin, onBack }) {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => { (async () => {
    try { const d = await apiCall({ action: 'my-shifts', pin }); setShifts(d.shifts || []) }
    catch (e) { setErr(e.message) }
    setLoading(false)
  })() }, [pin])

  // Trova la settimana corrente
  const today = new Date()
  const dow = today.getDay() || 7
  const monday = new Date(today); monday.setDate(today.getDate() - (dow - 1))
  const mondayStr = monday.toISOString().substring(0, 10)

  return <div style={{ maxWidth: 400, width: '100%' }}>
    {loading && <div style={{ color: '#F59E0B', padding: 20, textAlign: 'center' }}>Caricamento…</div>}
    {err && <div style={{ color: '#EF4444', padding: 12 }}>{err}</div>}
    {!loading && shifts.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Nessun turno pianificato.</div>}
    {shifts.slice(0, 6).map(s => {
      const isCurrent = s.settimana === mondayStr
      const giorni = s.giorni || {}
      return <div key={s.id} style={{ background: '#1a1f2e', borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${isCurrent ? '#10B981' : '#2a3042'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isCurrent ? '#10B981' : '#e2e8f0' }}>
            {isCurrent ? '📌 Settimana corrente' : 'Settimana del ' + new Date(s.settimana).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
          </div>
          {s.ore_totali && <div style={{ fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>{s.ore_totali}h</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, fontSize: 11 }}>
          {DAYS_IT.map((d, i) => {
            const g = giorni[d.toLowerCase()] || giorni[String(i)] || {}
            const inizio = g.inizio || g.entrata || ''
            const fine = g.fine || g.uscita || ''
            const libero = !inizio && !fine
            return <div key={d} style={{ background: libero ? '#131825' : '#2a3042', padding: '6px 4px', borderRadius: 6, textAlign: 'center', border: libero ? '1px dashed #2a3042' : '1px solid #10B98144' }}>
              <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>{d}</div>
              {libero ? <div style={{ color: '#475569', fontSize: 10 }}>—</div> : <>
                <div style={{ color: '#10B981', fontWeight: 600, fontSize: 10 }}>{inizio}</div>
                <div style={{ color: '#EF4444', fontSize: 10 }}>{fine}</div>
              </>}
            </div>
          })}
        </div>
      </div>
    })}
    <button onClick={onBack} style={{ marginTop: 12, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Menu</button>
  </div>
}

function MieOrePanel({ pin, onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => { (async () => {
    try { const d = await apiCall({ action: 'my-hours', pin }); setData(d) }
    catch (e) { setErr(e.message) }
    setLoading(false)
  })() }, [pin])

  return <div style={{ maxWidth: 400, width: '100%' }}>
    {loading && <div style={{ color: '#F59E0B', padding: 20, textAlign: 'center' }}>Caricamento…</div>}
    {err && <div style={{ color: '#EF4444', padding: 12 }}>{err}</div>}
    {data && <>
      <div className="keep-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 12 }}>
        <StatBox label="Oggi" value={data.today + 'h'} color="#10B981" />
        <StatBox label="Questa settimana" value={data.week + 'h'} color="#3B82F6" />
        <StatBox label="Mese corrente" value={data.month + 'h'} color="#F59E0B" />
        <StatBox label="Anno" value={data.year + 'h'} color="#8B5CF6" />
      </div>
      <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Ultimi 30 giorni lavorati</div>
        {(data.days || []).length === 0 && <div style={{ color: '#64748b', fontSize: 12, padding: 10, textAlign: 'center' }}>Nessuna timbratura</div>}
        {(data.days || []).map(d => (
          <div key={d.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e2636', fontSize: 13 }}>
            <div>
              <div style={{ color: '#e2e8f0' }}>{new Date(d.day).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{(d.locali || []).join(', ')}</div>
            </div>
            <div style={{ color: '#F59E0B', fontWeight: 700 }}>{d.hours}h</div>
          </div>
        ))}
      </div>
    </>}
    <button onClick={onBack} style={{ marginTop: 12, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Menu</button>
  </div>
}

function MieFeriePanel({ pin, onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => { (async () => {
    try { const d = await apiCall({ action: 'my-timeoff', pin }); setData(d) }
    catch (e) { setErr(e.message) }
    setLoading(false)
  })() }, [pin])

  return <div style={{ maxWidth: 400, width: '100%' }}>
    {loading && <div style={{ color: '#F59E0B', padding: 20, textAlign: 'center' }}>Caricamento…</div>}
    {err && <div style={{ color: '#EF4444', padding: 12 }}>{err}</div>}
    {data && <>
      <div className="keep-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 12 }}>
        <StatBox label="Ferie residue" value={data.ferieResiduiGiorni + ' gg'} sub={data.ferieResiduiOre + 'h'} color="#F97316" big />
        <StatBox label="Ferie usate" value={data.ferieUsateOre + 'h'} sub="quest'anno" color="#F59E0B" />
        <StatBox label="Permessi usati" value={data.permessiUsatiOre + 'h'} sub="quest'anno" color="#3B82F6" />
        <StatBox label="Ore contr." value={data.oreContrattualiSettimanali + 'h'} sub="settimanali" color="#8B5CF6" />
      </div>
      <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Registro ferie/permessi</div>
        {(data.registro || []).length === 0 && <div style={{ color: '#64748b', fontSize: 12, padding: 10, textAlign: 'center' }}>Nessun dato</div>}
        {(data.registro || []).slice(0, 20).map(t => {
          const colors = { ferie: '#F59E0B', permesso: '#3B82F6', malattia: '#EF4444', banca_ore: '#8B5CF6' }
          const statColors = { approvato: '#10B981', richiesto: '#F59E0B', rifiutato: '#EF4444' }
          const c = colors[t.tipo] || '#94a3b8'
          const sc = statColors[t.stato] || '#94a3b8'
          return <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid #1e2636', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: c, background: c + '22', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>{t.tipo}</span>
            <div style={{ flex: 1, fontSize: 12 }}>
              <div style={{ color: '#e2e8f0' }}>{t.data_inizio}{t.data_fine && t.data_fine !== t.data_inizio ? ' → ' + t.data_fine : ''}</div>
              {t.ore && <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.ore}h</div>}
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: sc }}>{t.stato}</span>
          </div>
        })}
      </div>
    </>}
    <button onClick={onBack} style={{ marginTop: 12, width: '100%', background: 'none', border: '1px solid #2a3042', borderRadius: 8, padding: '10px', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Menu</button>
  </div>
}

function StatBox({ label, value, sub, color, big }) {
  return <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 14, borderLeft: `3px solid ${color}` }}>
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: big ? 24 : 20, fontWeight: 700, color }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
  </div>
}

// ─── BANNER INSTALLAZIONE PWA ───────────────────────────────────────
function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    // Se l'app gira gia' in modalita' standalone, nascondi banner
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (standalone) { setInstalled(true); return }
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null) }
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return null

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/(crios|fxios)/i.test(navigator.userAgent)
  const isAndroid = /android/i.test(navigator.userAgent)

  const install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setDeferredPrompt(null)
  }

  return <div style={{ marginTop: 24, padding: '14px 16px', background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 12, maxWidth: 360, width: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 22 }}>📱</span>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#60A5FA' }}>Installa l'app sul telefono</div>
    </div>
    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 10 }}>
      Un'icona nella home per aprire Timbra con un tocco, senza barre del browser.
    </div>
    {deferredPrompt && <button onClick={install}
      style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#3B82F6', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
      Installa adesso
    </button>}
    {!deferredPrompt && isIos && <button onClick={() => setShowIosHelp(v => !v)}
      style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #3B82F6', background: 'transparent', color: '#60A5FA', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
      {showIosHelp ? 'Nascondi istruzioni' : 'Come si fa su iPhone'}
    </button>}
    {!deferredPrompt && isAndroid && <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
      Tocca il menu ⋮ del browser → <strong style={{ color: '#e2e8f0' }}>Aggiungi a schermata Home</strong> / <strong style={{ color: '#e2e8f0' }}>Installa app</strong>.
    </div>}
    {!deferredPrompt && !isIos && !isAndroid && <div style={{ fontSize: 11, color: '#94a3b8' }}>
      Apri questa pagina dal tuo telefono per installare l'app.
    </div>}
    {showIosHelp && <div style={{ marginTop: 10, padding: 10, background: '#131825', borderRadius: 8, fontSize: 11, color: '#cbd5e1', lineHeight: 1.7 }}>
      1. Tocca il bottone <strong>Condividi</strong> <span style={{ fontSize: 14 }}>⎙</span> in basso (Safari).<br />
      2. Scorri e tocca <strong>"Aggiungi alla schermata Home"</strong>.<br />
      3. Dai un nome (es. "Timbra") e tocca <strong>Aggiungi</strong>.<br />
      <span style={{ color: '#F59E0B' }}>Importante:</span> deve essere Safari, non Chrome.
    </div>}
  </div>
}
