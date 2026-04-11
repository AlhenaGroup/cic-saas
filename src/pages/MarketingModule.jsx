import { useState, useEffect } from 'react'
import { S, Card } from '../components/shared/styles.jsx'

// [id, label, description shown in placeholder]
const SUBS = [
  ['rep',  '⭐ Reputation',    'Rating Google / TripAdvisor / TheFork, trend recensioni, alert soglia rating'],
  ['crm',  '👥 CRM + RFM',     'Segmentazione clienti Champion / Loyal / At Risk / Lost / New / One-Timer con export CSV'],
  ['reat', '💌 Riattivazione', 'Suggerimenti automatici di campagne SMS/email per ogni segmento RFM'],
  ['ads',  '📣 Meta Ads',      'KPI campagne Meta (ROAS, CPM, CPC, CTR) + consigli automatici sul budget'],
  ['cal',  '📅 Calendario',    'Piano editoriale mensile con suggerimenti festività italiane e gap'],
  ['task', '✅ Task',          'Promemoria marketing con priorità, scadenze e task auto-generati']
]

export default function MarketingModule({ sp, sps, from, to }) {
  const [sub, setSub] = useState(() => localStorage.getItem('cic_mkt_sub') || 'task')
  useEffect(() => { localStorage.setItem('cic_mkt_sub', sub) }, [sub])

  const subBtn = (t) => ({
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: sub === t ? '#F59E0B' : 'transparent',
    color: sub === t ? '#0f1420' : '#94a3b8',
    transition: 'all .2s',
    whiteSpace: 'nowrap'
  })

  const current = SUBS.find(([t]) => t === sub) || SUBS[0]
  const localeName = sp === 'all'
    ? 'Tutti i locali'
    : (sps.find(s => String(s.id) === String(sp))?.description || sp)

  // first "word" of the label is the emoji — extract it for the big placeholder icon
  const parts = current[1].split(' ')
  const bigIcon = parts[0]
  const shortTitle = parts.slice(1).join(' ')

  return <>
    {/* Sub-tab bar */}
    <div style={{
      background: '#131825',
      borderRadius: 8,
      padding: 6,
      display: 'flex',
      gap: 4,
      marginBottom: 16,
      overflowX: 'auto',
      border: '1px solid #1e2636'
    }}>
      {SUBS.map(([t, l]) => (
        <button key={t} onClick={() => setSub(t)} style={subBtn(t)}>{l}</button>
      ))}
    </div>

    {/* Read-only context: locale attivo + date range ereditati dai filtri globali */}
    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
      📍 <strong style={{ color: '#94a3b8' }}>{localeName}</strong>
      {'  ·  '}
      🗓 {from} → {to}
    </div>

    {/* Placeholder section — verrà sostituita dalle PR successive */}
    <Card title={current[1]} badge="🚧 In sviluppo">
      <div style={{ padding: '32px 8px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 14, opacity: .3 }}>{bigIcon}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>
          {shortTitle}
        </div>
        <div style={{
          fontSize: 12,
          color: '#64748b',
          maxWidth: 520,
          margin: '0 auto',
          lineHeight: 1.5
        }}>
          {current[2]}
        </div>
        <div style={{
          fontSize: 11,
          color: '#475569',
          marginTop: 20,
          padding: '6px 14px',
          border: '1px dashed #2a3042',
          borderRadius: 6,
          display: 'inline-block'
        }}>
          Questa sezione sarà disponibile nelle prossime release
        </div>
      </div>
    </Card>
  </>
}
