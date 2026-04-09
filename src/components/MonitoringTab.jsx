import { useState, useEffect } from 'react'
import { S, KPI, Card, fmt, fmtD } from './shared/styles.jsx'

const sevColors = {
  high: { c: '#EF4444', bg: 'rgba(239,68,68,.12)', label: 'Alta' },
  medium: { c: '#F59E0B', bg: 'rgba(245,158,11,.12)', label: 'Media' },
  low: { c: '#10B981', bg: 'rgba(16,185,129,.12)', label: 'Bassa' },
}

function classifyLog(log) {
  const op = (log.operation || log.action || '').toLowerCase()
  const detail = (log.description || log.details || log.message || '')
  if (op.includes('eliminazione ordine') || op.includes('delete order') || op.includes('cancellazione ordine')) {
    const daPagare = detail.toLowerCase().includes('da pagare')
    return { tipo: 'Eliminazione ordine', icon: '🗑️', severity: daPagare ? 'high' : 'medium', color: '#EF4444' }
  }
  if (op.includes('eliminazione documento') || op.includes('delete document') || op.includes('cancellazione documento')) {
    return { tipo: 'Eliminazione documento', icon: '📄', severity: 'high', color: '#EF4444' }
  }
  if (op.includes('sconto') || op.includes('discount')) {
    const match = detail.match(/(\d+)%/)
    const pct = match ? parseInt(match[1]) : 0
    return { tipo: 'Sconto', icon: '🏷️', severity: pct > 30 ? 'medium' : 'low', color: '#F59E0B' }
  }
  if (op.includes('spostamento') || op.includes('move') || op.includes('trasferimento')) {
    return { tipo: 'Spostamento', icon: '↔️', severity: 'medium', color: '#3B82F6' }
  }
  if (op.includes('apertura cassetto') || op.includes('open drawer') || op.includes('cassetto')) {
    return { tipo: 'Apertura cassetto', icon: '🗃️', severity: 'low', color: '#64748b' }
  }
  return { tipo: log.operation || 'Altro', icon: '📋', severity: 'low', color: '#94a3b8' }
}

export default function MonitoringTab({ from, to }) {
  const [monLogs, setMonLogs] = useState([])
  const [monLoading, setMonLoading] = useState(false)
  const [monFilter, setMonFilter] = useState('tutte')
  const [monCookie, setMonCookie] = useState(() => localStorage.getItem('cic_session_cookie') || '')
  const [showCookie, setShowCookie] = useState(false)

  const iS = S.input

  const loadLogs = async () => {
    if (!monCookie) { setShowCookie(true); return }
    setMonLoading(true)
    try {
      const r = await fetch('/api/cic', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logs', sessionCookie: monCookie, from, to, limit: 500 }) })
      if (r.ok) {
        const d = await r.json()
        setMonLogs(d.records || d.logs || d || [])
        localStorage.setItem('cic_session_cookie', monCookie)
      } else {
        const d = await r.json().catch(() => ({}))
        if (d.needsSession || d.error) setShowCookie(true)
      }
    } catch { setShowCookie(true) }
    setMonLoading(false)
  }

  useEffect(() => { loadLogs() }, [from, to])

  // Classifica ogni log
  const classified = monLogs.map(log => {
    const cls = classifyLog(log)
    const dt = log.datetime || log.date || ''
    const dateStr = typeof dt === 'string' ? dt.substring(0, 10) : ''
    const timeStr = typeof dt === 'string' && dt.includes('T') ? dt.substring(11, 19) : (typeof dt === 'string' ? dt.substring(11) : '')
    return {
      ...log, ...cls, dateStr, timeStr,
      locale: log.salesPoint?.description || log.salesPoint?.name || log.salespoint || '—',
      utente: log.user?.username || log.user?.name || log.username || log.user || '—',
      dettaglio: log.description || log.details || log.message || '—',
    }
  })

  const filtered = monFilter === 'tutte' ? classified :
    classified.filter(l => l.tipo.toLowerCase().includes(monFilter))

  const counts = { eliminazioni: 0, sconti: 0, spostamenti: 0, cassetto: 0, altro: 0 }
  classified.forEach(l => {
    if (l.tipo.includes('Eliminazione')) counts.eliminazioni++
    else if (l.tipo === 'Sconto') counts.sconti++
    else if (l.tipo === 'Spostamento') counts.spostamenti++
    else if (l.tipo.includes('cassetto')) counts.cassetto++
    else counts.altro++
  })

  return <>
    {/* Cookie input */}
    {showCookie && <div style={{ ...S.card, marginBottom: 12, borderLeft: '3px solid #F59E0B' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>Connessione a Cassa in Cloud</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
        Per caricare i monitoring logs serve il cookie di sessione CiC. Apri <a href="https://fo.cassanova.com" target="_blank" style={{ color: '#F59E0B' }}>fo.cassanova.com</a>,
        poi F12 → Console → digita: <code style={{ background: '#0f1420', padding: '2px 6px', borderRadius: 4 }}>document.cookie</code>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={monCookie} onChange={e => setMonCookie(e.target.value)} placeholder="Incolla il cookie..." style={{ ...iS, flex: 1 }} />
        <button onClick={() => { localStorage.setItem('cic_session_cookie', monCookie); setShowCookie(false); loadLogs() }} disabled={!monCookie} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Connetti</button>
        <button onClick={() => setShowCookie(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Chiudi</button>
      </div>
    </div>}

    {/* KPI */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Totale operazioni" icon="📋" value={classified.length} sub="nel periodo" accent='#3B82F6' />
      <KPI label="Eliminazioni" icon="🗑️" value={counts.eliminazioni} sub="ordini/documenti" accent='#EF4444' />
      <KPI label="Sconti" icon="🏷️" value={counts.sconti} sub="applicati" accent='#F59E0B' />
      <KPI label="Spostamenti" icon="↔️" value={counts.spostamenti} sub="ordini/doc" accent='#3B82F6' />
      <KPI label="Apertura cassetto" icon="🗃️" value={counts.cassetto} sub="operazioni" accent='#64748b' />
    </div>

    {/* Filtri */}
    <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {[
        { key: 'tutte', label: 'Tutte', count: classified.length, color: '#3B82F6' },
        { key: 'eliminazione', label: '🗑️ Eliminazioni', count: counts.eliminazioni, color: '#EF4444' },
        { key: 'sconto', label: '🏷️ Sconti', count: counts.sconti, color: '#F59E0B' },
        { key: 'spostamento', label: '↔️ Spostamenti', count: counts.spostamenti, color: '#3B82F6' },
        { key: 'cassetto', label: '🗃️ Cassetto', count: counts.cassetto, color: '#64748b' },
      ].map(f => (
        <button key={f.key} onClick={() => setMonFilter(monFilter === f.key ? 'tutte' : f.key)} style={{ ...iS, padding: '4px 12px', fontSize: 11, fontWeight: monFilter === f.key ? 700 : 400, color: monFilter === f.key ? f.color : '#94a3b8', background: monFilter === f.key ? f.color + '18' : 'transparent', border: monFilter === f.key ? `1px solid ${f.color}` : '1px solid #2a3042' }}>
          {f.label} ({f.count})
        </button>
      ))}
      <div style={{ marginLeft: 'auto' }}>
        <button onClick={() => monCookie ? loadLogs() : setShowCookie(true)} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>
          {monCookie ? '🔄 Aggiorna' : '⚙️ Configura CiC'}
        </button>
      </div>
    </div>

    {/* Tabella */}
    <Card title="Monitoring Log" badge={monLoading ? 'Caricamento...' : filtered.length + ' operazioni'}>
      {monLoading ? <div style={{ textAlign: 'center', padding: 20, color: '#F59E0B', fontSize: 12 }}>Caricamento logs da CiC...</div> :
      classified.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: '#475569', fontSize: 13 }}>
        {monCookie ? 'Nessuna operazione nel periodo selezionato' : 'Clicca "Configura CiC" per collegare il monitoring log'}
      </div> :
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Data', 'Ora', 'Locale', 'Utente', 'Operazione', 'Dettagli', 'Severità'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.slice(0, 200).map((l, i) => {
              const sev = sevColors[l.severity] || sevColors.low
              return <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: l.severity === 'high' ? 'rgba(239,68,68,.04)' : 'transparent' }}>
                <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.dateStr}</td>
                <td style={{ ...S.td, color: '#94a3b8', whiteSpace: 'nowrap' }}>{l.timeStr}</td>
                <td style={{ ...S.td, fontSize: 12 }}>{l.locale}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{l.utente}</td>
                <td style={S.td}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>{l.icon}</span>
                    <span style={{ fontWeight: 600, color: l.color }}>{l.tipo}</span>
                  </span>
                </td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 12, maxWidth: 400 }}>{l.dettaglio}</td>
                <td style={S.td}><span style={S.badge(sev.c, sev.bg)}>{sev.label}</span></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </Card>
  </>
}
