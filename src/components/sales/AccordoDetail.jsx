// Detail page accordo commerciale.
// Mostra: progress bar prominente, gap-to-win, scaglioni con check, fatture collegate.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt, fmtN } from '../shared/styles.jsx'
import { formatMetric, formatPeriod } from './AccordiCommercialiTab'

const PROGRESS_COLOR = {
  on_track: '#10B981', at_risk: '#F59E0B', off_track: '#EF4444',
  achieved: '#10B981', expired_not_achieved: '#6B7280',
  no_target: '#6B7280', no_data: '#6B7280',
}
const PROGRESS_LABEL = {
  on_track: '🟢 In linea con il target',
  at_risk: '🟡 A rischio',
  off_track: '🔴 In ritardo sul target',
  achieved: '✅ Target raggiunto',
  expired_not_achieved: '❌ Scaduto senza raggiungere',
  no_target: '—',
  no_data: 'Troppo poco dato per stimare',
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

export default function AccordoDetail({ id, onBack, onEdit }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    apiCall('get', { id })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  async function onDelete() {
    if (!confirm('Eliminare definitivamente questo accordo? Lo storico fatture resta invariato.')) return
    try { await apiCall('delete', { id }); onBack() }
    catch (e) { alert('Errore: ' + e.message) }
  }

  async function onActivate() {
    try {
      const payload = { ...data.agreement, tiers: data.tiers, items: data.items, status: 'active', id }
      await apiCall('upsert', { agreement: payload })
      onBack()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>
  if (error)  return <div style={{ padding: '2rem', color: 'var(--red)' }}>Errore: {error}</div>
  if (!data?.agreement) return null

  const a = data.agreement
  const p = data.progress
  const tiers = (data.tiers || []).sort((x, y) => Number(x.threshold) - Number(y.threshold))
  const progColor = PROGRESS_COLOR[p?.status_indicator] || '#6B7280'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 13, padding: 6 }}>
          ← Lista accordi
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={onEdit} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', marginRight: 8 }}>
          Modifica
        </button>
        {a.status === 'draft' && (
          <button onClick={onActivate} style={{ background: '#10B981', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginRight: 8 }}>
            Attiva ✓
          </button>
        )}
        <button onClick={onDelete} style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          Elimina
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{a.name}</h2>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
          {a.suppliers?.name && <span>📦 {a.suppliers.name}</span>}
          <span>📅 {formatPeriod(a.start_date, a.end_date)}</span>
          <span>🏷️ {a.agreement_type}</span>
          <span style={{ color: progColor, fontWeight: 600 }}>{PROGRESS_LABEL[p?.status_indicator]}</span>
        </div>
      </div>

      {/* Progress bar prominente */}
      <Card title="Avanzamento">
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
              {formatMetric(p?.current_value, a.metric)}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text2)' }}>
              target <strong>{formatMetric(p?.target_value, a.metric)}</strong>
            </div>
          </div>
          <div style={{ height: 14, background: 'var(--bg)', borderRadius: 7, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: Math.min(100, p?.percentage_complete || 0) + '%',
              background: progColor,
              borderRadius: 7,
              transition: 'width .4s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
            <span>{Math.round(p?.percentage_complete || 0)}% completato</span>
            <span>{fmtN(p?.days_elapsed)} / {fmtN(p?.total_days)} giorni</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 16 }}>
          <MiniStat
            label="Gap al prossimo scaglione"
            value={p?.gap_to_next_tier != null ? formatMetric(p.gap_to_next_tier, a.metric) : 'Tutti raggiunti'}
            hint={p?.next_tier ? `Premio: ${describeReward(p.next_tier)}` : null}
            color={p?.gap_to_next_tier > 0 ? '#F59E0B' : '#10B981'}
          />
          <MiniStat
            label="Proiezione fine periodo"
            value={p?.linear_projection != null ? formatMetric(p.linear_projection, a.metric) : '—'}
            hint={p?.linear_projection != null && p?.target_value > 0
              ? `${Math.round((p.linear_projection / p.target_value) * 100)}% del target`
              : null}
            color={progColor}
          />
          <MiniStat
            label="Giorni rimanenti"
            value={fmtN(p?.days_remaining)}
            hint={p?.days_remaining > 0 ? `su ${fmtN(p?.total_days)} totali` : 'periodo concluso'}
            color="var(--text3)"
          />
        </div>
      </Card>

      {tiers.length > 0 && (
        <Card title={`Scaglioni (${tiers.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={S.th}>#</th>
              <th style={S.th}>Soglia</th>
              <th style={S.th}>Premio</th>
              <th style={S.th}>Stato</th>
            </tr></thead>
            <tbody>
              {tiers.map((t, i) => {
                const reached = (p?.current_value || 0) >= Number(t.threshold)
                return (
                  <tr key={t.id || i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--text3)' }}>{i + 1}</td>
                    <td style={S.td}>{formatMetric(t.threshold, a.metric)}</td>
                    <td style={S.td}>{describeReward(t)}</td>
                    <td style={S.td}>
                      {reached
                        ? <span style={S.badge('var(--green)', 'var(--green-bg)')}>✓ raggiunto</span>
                        : <span style={S.badge('var(--text3)', 'var(--bg)')}>in attesa</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card title={`Fatture collegate (${data.lines_count})`}>
        {data.lines_count === 0 ? (
          <div style={{ padding: '1.5rem 0', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
            Nessuna fattura del fornitore nel periodo dell'accordo.
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            <strong>{data.lines_count}</strong> righe fattura conteggiate per il calcolo dell'avanzamento.
          </div>
        )}
      </Card>

      {a.description && (
        <Card title="Note">
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text2)' }}>{a.description}</div>
        </Card>
      )}
    </div>
  )
}

function MiniStat({ label, value, hint, color }) {
  return (
    <div style={S.card}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function describeReward(t) {
  if (!t) return '—'
  if (t.reward_description) return t.reward_description
  if (t.reward_type === 'discount_pct' && t.reward_value != null) return `${t.reward_value}% di sconto`
  if (t.reward_type === 'discount_amount' && t.reward_value != null) return `${fmt(t.reward_value)} di sconto`
  if (t.reward_type === 'free_goods') return 'merce omaggio'
  if (t.reward_type === 'cash_bonus' && t.reward_value != null) return `${fmt(t.reward_value)} cash`
  return '—'
}
