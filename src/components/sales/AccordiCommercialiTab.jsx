// Tab Vendite → Accordi commerciali
// Lista accordi del tenant con progress bar + stato + CTA "Nuovo accordo".
// Persistenza UI: stato sotto-vista (lista/wizard/detail) e filtri in localStorage.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmt, fmtN } from '../shared/styles.jsx'
import AccordoWizard from './AccordoWizard'
import AccordoDetail from './AccordoDetail'

const STATUS_LABELS = {
  draft:     { l: 'Bozza',     bg: 'var(--bg)',     fg: 'var(--text2)' },
  active:    { l: 'Attivo',    bg: 'var(--blue-bg)', fg: 'var(--blue-text)' },
  achieved:  { l: 'Raggiunto', bg: 'var(--green-bg)', fg: 'var(--green)' },
  failed:    { l: 'Fallito',   bg: 'var(--red-bg)',  fg: 'var(--red)' },
  expired:   { l: 'Scaduto',   bg: 'var(--bg)',     fg: 'var(--text3)' },
  renewed:   { l: 'Rinnovato', bg: 'var(--bg)',     fg: 'var(--text3)' },
}

const PROGRESS_STATUS = {
  on_track:             { l: 'In linea',  color: '#10B981', icon: '🟢' },
  at_risk:              { l: 'A rischio', color: '#F59E0B', icon: '🟡' },
  off_track:            { l: 'In ritardo',color: '#EF4444', icon: '🔴' },
  achieved:             { l: 'Raggiunto', color: '#10B981', icon: '✅' },
  expired_not_achieved: { l: 'Scaduto',   color: '#6B7280', icon: '❌' },
  no_target:            { l: '—',         color: '#6B7280', icon: '·' },
  no_data:              { l: 'Poco dato', color: '#6B7280', icon: '·' },
}

const METRIC_LABELS = {
  volume_liters:  'litri',
  volume_pieces:  'pezzi',
  revenue_eur:    '€ fatturato',
  mix_percentage: '% mix',
}

const TYPE_LABELS = {
  rappel:          'Rappel fine periodo',
  free_goods:      'Premio merce',
  tiered_discount: 'Scaglioni progressivi',
  mix_target:      'Mix target',
  flat_bonus:      'Bonus una tantum',
  volume_discount: 'Sconto volume',
}

async function apiCall(action, body = {}) {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  const r = await fetch('/api/agreements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, ...body }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'API error')
  return j
}

export default function AccordiCommercialiTab() {
  const [view, setView] = useState(() => ({ kind: 'list' }))   // {kind:'list'} | {kind:'wizard', editId?} | {kind:'detail', id}
  const [agreements, setAgreements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState(() => localStorage.getItem('agr_filter_status') || '')
  const [search, setSearch] = useState('')

  useEffect(() => { localStorage.setItem('agr_filter_status', filterStatus) }, [filterStatus])

  async function reload() {
    setLoading(true); setError('')
    try {
      const j = await apiCall('list', { status: filterStatus || undefined })
      setAgreements(j.agreements || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [filterStatus])

  const stats = useMemo(() => {
    const active = agreements.filter((a) => a.status === 'active').length
    const atRisk = agreements.filter((a) => ['at_risk', 'off_track'].includes(a.progress?.status_indicator)).length
    const totReward = agreements
      .filter((a) => a.status === 'active' && a.reward_value)
      .reduce((s, a) => s + Number(a.reward_value || 0), 0)
    return { active, atRisk, totReward }
  }, [agreements])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return agreements
    return agreements.filter((a) =>
      a.name?.toLowerCase().includes(q) ||
      a.suppliers?.name?.toLowerCase().includes(q),
    )
  }, [agreements, search])

  // ─── Sub-views ────────────────────────────────────────────────────
  if (view.kind === 'wizard') {
    return <AccordoWizard
      editId={view.editId}
      onCancel={() => setView({ kind: 'list' })}
      onSaved={() => { setView({ kind: 'list' }); reload() }}
    />
  }
  if (view.kind === 'detail') {
    return <AccordoDetail
      id={view.id}
      onBack={() => { setView({ kind: 'list' }); reload() }}
      onEdit={() => setView({ kind: 'wizard', editId: view.id })}
    />
  }

  // ─── Lista ────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.25rem' }}>
        <KPI label="Attivi"            value={fmtN(stats.active)}   sub="accordi in corso" accent='var(--blue)' />
        <KPI label="A rischio"         value={fmtN(stats.atRisk)}   sub="proiezione sotto target" accent='#F59E0B' />
        <KPI label="Premi in palio"    value={fmt(stats.totReward)} sub="valore dichiarato" accent='#10B981' />
      </div>

      <Card
        title="Accordi commerciali"
        badge={fmtN(filtered.length) + ' totali'}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Cerca per nome o fornitore..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...S.input, width: 240 }}
            />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={S.input}>
              <option value="">Tutti gli stati</option>
              <option value="draft">Bozza</option>
              <option value="active">Attivo</option>
              <option value="achieved">Raggiunto</option>
              <option value="failed">Fallito</option>
              <option value="expired">Scaduto</option>
            </select>
            <button
              onClick={() => setView({ kind: 'wizard' })}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-control)', padding: '8px 14px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
              + Nuovo accordo
            </button>
          </div>
        }
      >
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>Errore: {error}</div>}
        {loading && <div style={{ fontSize: 13, color: 'var(--text3)', padding: '2rem 0', textAlign: 'center' }}>Caricamento…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 6 }}>
              {agreements.length === 0 ? 'Nessun accordo censito ancora.' : 'Nessun accordo matcha i filtri.'}
            </div>
            {agreements.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
                Censisci qui i contratti firmati con i tuoi fornitori (rappel, premi merce, scaglioni a soglia).
                Il sistema traccia l'avanzamento in tempo reale dalle fatture di acquisto e ti avvisa quando un premio è a portata di mano.
              </div>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={S.th}>Accordo</th>
                <th style={S.th}>Fornitore</th>
                <th style={S.th}>Tipo</th>
                <th style={S.th}>Periodo</th>
                <th style={S.th}>Avanzamento</th>
                <th style={S.th}>Stato</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {filtered.map((a) => <AgreementRow key={a.id} agreement={a} onOpen={() => setView({ kind: 'detail', id: a.id })} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function AgreementRow({ agreement, onOpen }) {
  const st = STATUS_LABELS[agreement.status] || STATUS_LABELS.draft
  const prog = agreement.progress
  const progSt = prog ? (PROGRESS_STATUS[prog.status_indicator] || PROGRESS_STATUS.no_target) : null
  const pct = prog?.percentage_complete ?? 0
  const metricLabel = METRIC_LABELS[agreement.metric] || agreement.metric
  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
      <td style={S.td}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{agreement.name}</div>
        {agreement.description && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{agreement.description.slice(0, 80)}</div>
        )}
      </td>
      <td style={S.td}>{agreement.suppliers?.name || '—'}</td>
      <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{TYPE_LABELS[agreement.agreement_type] || agreement.agreement_type}</td>
      <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>
        {formatPeriod(agreement.start_date, agreement.end_date)}
      </td>
      <td style={S.td}>
        {prog ? (
          <div style={{ minWidth: 160 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: 'var(--text2)' }}>
                {formatMetric(prog.current_value, agreement.metric)} / {formatMetric(prog.target_value, agreement.metric)}
              </span>
              <span style={{ color: progSt?.color, fontWeight: 600 }}>{Math.round(pct)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3 }}>
              <div style={{
                height: '100%', width: Math.min(100, pct) + '%',
                background: progSt?.color || 'var(--text3)', borderRadius: 3, transition: 'width .3s',
              }} />
            </div>
            {prog.gap_to_next_tier > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                {formatMetric(prog.gap_to_next_tier, agreement.metric)} {metricLabel} al prossimo scaglione
              </div>
            )}
          </div>
        ) : <span style={{ fontSize: 11, color: 'var(--text3)' }}>—</span>}
      </td>
      <td style={S.td}>
        <span style={S.badge(st.fg, st.bg)}>{st.l}</span>
        {progSt && agreement.status === 'active' && (
          <div style={{ fontSize: 10, color: progSt.color, marginTop: 4 }}>
            {progSt.icon} {progSt.l}
          </div>
        )}
      </td>
      <td style={{ ...S.td, textAlign: 'right' }}>
        <span style={{ color: 'var(--text3)', fontSize: 16 }}>›</span>
      </td>
    </tr>
  )
}

function formatPeriod(start, end) {
  if (!start || !end) return '—'
  const fmt = (d) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
  return `${fmt(start)} → ${fmt(end)}`
}

function formatMetric(value, metric) {
  if (value == null) return '—'
  const n = Number(value)
  if (metric === 'revenue_eur') {
    return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
  }
  if (metric === 'volume_liters') {
    return n.toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' L'
  }
  if (metric === 'volume_pieces') {
    return n.toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' pz'
  }
  if (metric === 'mix_percentage') {
    return n.toFixed(1) + '%'
  }
  return n.toLocaleString('it-IT')
}

// Re-export per uso esterno se servisse
export { formatMetric, formatPeriod }
