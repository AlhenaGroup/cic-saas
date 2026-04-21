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
      // Se ha 1 solo permesso attivo, salto il menu e vado diretto
      const active = Object.keys(d.permissions || {}).filter(k => d.permissions[k])
      if (active.length === 1) {
        goTo(active[0] === 'presenza' ? 'presenza' : active[0])
      } else {
        setStep('menu')
      }
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

    {step === 'pin' && <PinPad pin={pin} onDigit={handlePin} onClear={clearPin} loading={loading} />}

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

    {step === 'done' && <DonePanel message={message} employee={employee} onReset={reset} />}
    {step === 'error' && <ErrorPanel message={message} onReset={reset} />}
  </div>
}

function stepLabel(s) {
  return { presenza: 'Timbratura presenza', consumo: 'Consumo personale', trasferimento: 'Spostamento merce', inventario: 'Inventario', done: 'Fatto', error: 'Errore' }[s] || ''
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
  const items = [
    { k: 'presenza', icon: '🕐', label: 'Timbra presenza', color: '#10B981' },
    { k: 'consumo', icon: '🍪', label: 'Consumo personale', color: '#F59E0B' },
    { k: 'trasferimento', icon: '🔀', label: 'Spostamento merce', color: '#3B82F6' },
    { k: 'inventario', icon: '📋', label: 'Inventario', color: '#8B5CF6' },
  ].filter(i => permissions[i.k === 'trasferimento' ? 'spostamenti' : i.k])

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

// ─── CONSUMO PERSONALE ──────────────────────────────────────────────
function ConsumoPanel({ pin, locale, onDone, onBack }) {
  const [articles, setArticles] = useState([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const d = await apiCall({ action: 'articles', pin, locale })
        setArticles(d.items || [])
      } catch (e) { setErr(e.message) }
    })()
  }, [pin, locale])

  const filtered = q ? articles.filter(a => a.nome_articolo.toLowerCase().includes(q.toLowerCase())) : articles

  const submit = async () => {
    if (!selected || !qty) return
    setLoading(true); setErr('')
    try {
      await apiCall({ action: 'consumo', pin, locale, nome_articolo: selected.nome_articolo, quantita: Number(qty), unita: selected.unita, note })
      onDone(`Registrato consumo: ${qty} ${selected.unita || ''} di ${selected.nome_articolo}`)
    } catch (e) { setErr(e.message); setLoading(false) }
  }

  return <div style={{ maxWidth: 360, width: '100%' }}>
    {!selected ? <>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca articolo..."
        style={{ width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 10, outline: 'none' }} />
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Nessun articolo trovato</div>}
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
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Giacenza: {Number(selected.quantita || 0).toFixed(1)} {selected.unita || ''}</div>
      </div>
      <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Quantità ({selected.unita || ''})</label>
      <input type="number" step="0.01" value={qty} onChange={e => setQty(e.target.value)}
        style={{ width: '100%', padding: '14px', fontSize: 18, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 10, outline: 'none', textAlign: 'center' }} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (opz.)"
        style={{ width: '100%', padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 12, outline: 'none' }} />
      {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setSelected(null)} disabled={loading}
          style={{ flex: 1, padding: '14px', borderRadius: 10, border: '1px solid #2a3042', background: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>← Cambia</button>
        <button onClick={submit} disabled={loading || !qty || Number(qty) <= 0}
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
function InventarioPanel({ pin, locale, onDone, onBack }) {
  const [inventory, setInventory] = useState(null)
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
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

  const filtered = q ? items.filter(a => a.nome_articolo.toLowerCase().includes(q.toLowerCase())) : items
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
      style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: '1px solid #2a3042', background: '#1a1f2e', color: '#e2e8f0', marginBottom: 10, outline: 'none' }} />
    {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}
    <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
      {filtered.map(a => (
        <div key={a.nome_articolo} style={{ background: '#1a1f2e', borderRadius: 10, padding: 10, marginBottom: 6, border: `1px solid ${a.giacenza_reale != null ? '#10B98144' : '#2a3042'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.nome_articolo}</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>teorico: {Number(a.giacenza_teorica || 0).toFixed(1)}</div>
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
      ))}
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
