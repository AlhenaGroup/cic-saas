import { useState } from 'react'
import { S, KPI, Card, fmtD } from './shared/styles.jsx'

const sevColors = {
  high: { c: '#EF4444', bg: 'rgba(239,68,68,.12)', label: 'Alta' },
  medium: { c: '#F59E0B', bg: 'rgba(245,158,11,.12)', label: 'Media' },
  low: { c: '#10B981', bg: 'rgba(16,185,129,.12)', label: 'Bassa' },
}

const typeConfig = {
  'Eliminazione Documento': { icon: '', color: '#EF4444' },
  'Eliminazione ordine': { icon: '', color: '#EF4444' },
  'Applicazione/Modifica Sconto': { icon: '', color: '#F59E0B' },
  'Spostamento': { icon: '', color: '#3B82F6' },
  'Apertura Cassetto': { icon: '', color: '#64748b' },
}

export default function MonitoringTab({ events = [] }) {
  const [filter, setFilter] = useState('tutte')

  const iS = S.input

  // Classifica ogni evento
  const classified = events.map(ev => {
    const tipo = ev.type || 'Altro'
    const cfg = typeConfig[tipo] || { icon: '', color: '#94a3b8' }
    return { ...ev, ...cfg, tipo }
  })

  const filtered = filter === 'tutte' ? classified :
    classified.filter(l => l.tipo.toLowerCase().includes(filter))

  const counts = { eliminazioni: 0, sconti: 0, spostamenti: 0, cassetto: 0, altro: 0 }
  classified.forEach(l => {
    if (l.tipo.includes('Eliminazione')) counts.eliminazioni++
    else if (l.tipo.includes('Sconto')) counts.sconti++
    else if (l.tipo.includes('Spostamento')) counts.spostamenti++
    else if (l.tipo.includes('Cassetto')) counts.cassetto++
    else counts.altro++
  })

  return <>
    {/* KPI */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Totale operazioni" icon="" value={classified.length} sub="nel periodo" accent='#3B82F6' />
      <KPI label="Eliminazioni" icon="" value={counts.eliminazioni} sub="documenti annullati" accent='#EF4444' />
      <KPI label="Sconti" icon="" value={counts.sconti} sub="applicati" accent='#F59E0B' />
      <KPI label="Spostamenti" icon="" value={counts.spostamenti} sub="ordini/doc" accent='#3B82F6' />
      <KPI label="Apertura cassetto" icon="" value={counts.cassetto} sub="operazioni" accent='#64748b' />
    </div>

    {/* Filtri */}
    <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {[
        { key: 'tutte', label: 'Tutte', count: classified.length, color: '#3B82F6' },
        { key: 'eliminazione', label: 'Eliminazioni', count: counts.eliminazioni, color: '#EF4444' },
        { key: 'sconto', label: 'Sconti', count: counts.sconti, color: '#F59E0B' },
        { key: 'spostamento', label: 'Spostamenti', count: counts.spostamenti, color: '#3B82F6' },
        { key: 'cassetto', label: 'Cassetto', count: counts.cassetto, color: '#64748b' },
      ].map(f => (
        <button key={f.key} onClick={() => setFilter(filter === f.key ? 'tutte' : f.key)} style={{ ...iS, padding: '4px 12px', fontSize: 11, fontWeight: filter === f.key ? 700 : 400, color: filter === f.key ? f.color : '#94a3b8', background: filter === f.key ? f.color + '18' : 'transparent', border: filter === f.key ? `1px solid ${f.color}` : '1px solid #2a3042' }}>
          {f.label} ({f.count})
        </button>
      ))}
    </div>

    {/* Tabella */}
    <Card title="Monitoring Log" badge={filtered.length + ' operazioni'}>
      {classified.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}></div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>Nessuna operazione sospetta nel periodo</div>
          <div style={{ fontSize: 12, color: '#475569', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            Le operazioni vengono rilevate automaticamente dai dati CiC: annulli/resi, sconti applicati sui prodotti, aperture cassetto, spostamenti ordini.
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Data', 'Ora', 'Locale', 'Utente', 'Operazione', 'Dettagli', 'Importo', 'Severità'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.slice(0, 200).map((l, i) => {
                const sev = sevColors[l.severity] || sevColors.low
                return <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: l.severity === 'high' ? 'rgba(239,68,68,.04)' : 'transparent' }}>
                  <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.date || '—'}</td>
                  <td style={{ ...S.td, color: '#94a3b8', whiteSpace: 'nowrap' }}>{l.time || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{l.locale || '—'}</td>
                  <td style={{ ...S.td, fontWeight: 500 }}>{l.user || '—'}</td>
                  <td style={S.td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>{l.icon}</span>
                      <span style={{ fontWeight: 600, color: l.color }}>{l.tipo}</span>
                    </span>
                  </td>
                  <td style={{ ...S.td, color: '#94a3b8', fontSize: 12, maxWidth: 400 }}>{l.description || '—'}</td>
                  <td style={{ ...S.td, color: '#EF4444', fontWeight: 600 }}>{l.amount ? fmtD(l.amount) : '—'}</td>
                  <td style={S.td}><span style={S.badge(sev.c, sev.bg)}>{sev.label}</span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  </>
}
