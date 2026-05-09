// Vista log /timbra: aiuta a capire cosa succede quando un dipendente
// dice "ho timbrato" ma in DB non c'e' niente.
// Mostra: errori rete, GPS denied, errori server, abbandono pagina, blocchi GPS.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const ERROR_TYPE_LABEL = {
  network:      { label: 'Rete assente',      color: '#EF4444' },
  gps:          { label: 'GPS',                color: '#F59E0B' },
  'server-4xx': { label: 'Errore server (4xx)',color: '#EF4444' },
  'server-5xx': { label: 'Errore server (5xx)',color: '#EF4444' },
  abandon:      { label: 'Pagina chiusa',      color: '#8B5CF6' },
  client:       { label: 'Errore app',         color: '#EF4444' },
}

const LEVEL_COLOR = { error: '#EF4444', warning: '#F59E0B', info: '#3B82F6' }

function fmtDT(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
         d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function TimbraLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterEmp, setFilterEmp] = useState('')
  const [filterLocale, setFilterLocale] = useState('')
  const [filterDays, setFilterDays] = useState(7)
  const [openLog, setOpenLog] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const since = new Date(Date.now() - filterDays * 86400000).toISOString()
      const { data, error: err } = await supabase.from('timbra_logs')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500)
      if (err) throw err
      setLogs(data || [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [filterDays])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => logs.filter(l => {
    if (filterLevel && l.level !== filterLevel) return false
    if (filterType && l.error_type !== filterType) return false
    if (filterEmp && !((l.employee_name || '').toLowerCase().includes(filterEmp.toLowerCase()))) return false
    if (filterLocale && l.locale !== filterLocale) return false
    return true
  }), [logs, filterLevel, filterType, filterEmp, filterLocale])

  const localesAvail = useMemo(() => [...new Set(logs.map(l => l.locale).filter(Boolean))].sort(), [logs])

  const stats = useMemo(() => {
    const s = { tot: logs.length, errori: 0, network: 0, gps: 0, server: 0, abandon: 0 }
    for (const l of logs) {
      if (l.level === 'error') s.errori++
      if (l.error_type === 'network') s.network++
      if (l.error_type === 'gps') s.gps++
      if (l.error_type?.startsWith('server')) s.server++
      if (l.error_type === 'abandon') s.abandon++
    }
    return s
  }, [logs])

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <KPI label={`Eventi (${filterDays}gg)`} value={stats.tot} accent="#3B82F6"/>
      <KPI label="Errori" value={stats.errori} accent="#EF4444"/>
      <KPI label="Rete assente" value={stats.network} accent="#EF4444" onClick={() => setFilterType('network')}/>
      <KPI label="GPS" value={stats.gps} accent="#F59E0B" onClick={() => setFilterType('gps')}/>
      <KPI label="Pagina chiusa" value={stats.abandon} accent="#8B5CF6" onClick={() => setFilterType('abandon')}/>
    </div>

    <Card title="Log eventi /timbra" badge={loading ? '…' : (filtered.length + ' di ' + logs.length)} extra={
      <button onClick={load} style={{ padding: '6px 12px', fontSize: 12, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
        ↻ Ricarica
      </button>
    }>
      <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', padding: 10, borderRadius: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
        <strong style={{ color: '#3B82F6' }}>Cosa significa:</strong> qui finiscono i tentativi falliti o sospetti su <code>/timbra</code>.
        Se un dipendente dice "ho timbrato ma non si vede", cerca qui il suo nome o il suo PIN — puoi vedere se c'era un problema di rete, GPS, o se ha chiuso l'app prima di confermare.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select value={filterDays} onChange={e => setFilterDays(Number(e.target.value))} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value={1}>Ultimo giorno</option>
          <option value={7}>Ultimi 7 giorni</option>
          <option value={30}>Ultimi 30 giorni</option>
          <option value={90}>Ultimi 90 giorni</option>
        </select>
        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i livelli</option>
          <option value="error">Solo errori</option>
          <option value="warning">Solo warning</option>
          <option value="info">Solo info</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i tipi</option>
          {Object.keys(ERROR_TYPE_LABEL).map(k => <option key={k} value={k}>{ERROR_TYPE_LABEL[k].label}</option>)}
        </select>
        <input placeholder="Filtra per nome dipendente…" value={filterEmp} onChange={e => setFilterEmp(e.target.value)}
          style={{ ...S.input, fontSize: 12, padding: '6px 10px', flex: '1 1 200px', minWidth: 180 }}/>
        {localesAvail.length > 0 && <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i locali</option>
          {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
        </select>}
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        {logs.length === 0 ? 'Nessun evento ancora — i log iniziano dal deploy della funzione.' : 'Nessun evento con questi filtri.'}
      </div>}

      {!loading && filtered.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Quando', 'Livello', 'Tipo', 'Dipendente', 'Locale', 'Azione', 'Messaggio'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(l => {
              const t = ERROR_TYPE_LABEL[l.error_type] || { label: l.error_type || '—', color: 'var(--text3)' }
              const lc = LEVEL_COLOR[l.level] || 'var(--text3)'
              return <tr key={l.id} onClick={() => setOpenLog(l)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDT(l.created_at)}</td>
                <td style={{ ...S.td }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: lc + '22', color: lc, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{l.level}</span>
                </td>
                <td style={{ ...S.td }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: t.color + '22', color: t.color, fontSize: 10, fontWeight: 600 }}>{t.label}</span>
                </td>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  {l.employee_name || <span style={{ color: 'var(--text3)' }}>?</span>}
                  {l.pin_last4 && <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6, fontFamily: 'monospace' }}>•••{l.pin_last4}</span>}
                </td>
                <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{l.locale || '—'}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>{l.action}</td>
                <td style={{ ...S.td, fontSize: 12, color: 'var(--text)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.message}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </Card>

    {openLog && <LogDetailModal log={openLog} onClose={() => setOpenLog(null)}/>}
  </div>
}

function KPI({ label, value, accent, onClick }) {
  return <div onClick={onClick} style={{
    background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid ' + accent,
    borderRadius: 8, padding: 12, cursor: onClick ? 'pointer' : 'default',
  }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
  </div>
}

function LogDetailModal({ log, onClose }) {
  const t = ERROR_TYPE_LABEL[log.error_type] || { label: log.error_type || '—', color: 'var(--text3)' }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 640, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>Evento {log.action}</h3>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fmtDT(log.created_at)}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row label="Tipo errore" value={<span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: t.color + '22', color: t.color, fontSize: 12, fontWeight: 700 }}>{t.label}</span>}/>
        <Row label="Livello" value={log.level}/>
        <Row label="Messaggio" value={log.message}/>
        <Row label="Dipendente" value={log.employee_name || '—'}/>
        <Row label="PIN (last 4)" value={log.pin_last4 || '—'}/>
        <Row label="Locale" value={log.locale || '—'}/>
        <Row label="Step" value={log.step || '—'}/>
        <Row label="Online" value={log.online == null ? '—' : (log.online ? 'sì' : 'no')}/>
        <Row label="GPS" value={log.gps_status || '—'}/>
        <Row label="HTTP status" value={log.http_status ?? '—'}/>
        <Row label="User agent" value={<span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{log.user_agent || '—'}</span>}/>
        {log.payload && <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Payload</div>
          <pre style={{ fontSize: 11, background: 'var(--surface2)', padding: 10, borderRadius: 6, overflow: 'auto', color: 'var(--text2)' }}>{JSON.stringify(log.payload, null, 2)}</pre>
        </div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Chiudi</button>
      </div>
    </div>
  </div>
}

function Row({ label, value }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 12 }}>
    <span style={{ color: 'var(--text3)' }}>{label}</span>
    <span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right', flex: 1 }}>{value}</span>
  </div>
}
