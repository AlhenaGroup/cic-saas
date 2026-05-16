// Widget compatto Accordi commerciali per la Panoramica.
// Mostra gli accordi attivi (o un sottoinsieme scelto dall'utente) con
// progress bar mini + status indicator. L'utente può configurare quali
// accordi monitorare via icona ⚙️ in alto a destra.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmtN } from '../shared/styles.jsx'
import { formatMetric } from './AccordiCommercialiTab'

const PROGRESS_COLOR = {
  on_track: '#10B981', at_risk: '#F59E0B', off_track: '#EF4444',
  achieved: '#10B981', expired_not_achieved: '#6B7280',
  no_target: '#6B7280', no_data: '#6B7280',
}

const STORAGE_KEY = 'accordi_widget_selected_ids'  // null=tutti gli attivi; array=lista specifica

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

export default function AccordiWidget() {
  const [agreements, setAgreements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null   // null = mostra tutti gli attivi
    try { return JSON.parse(raw) } catch { return null }
  })

  useEffect(() => {
    setLoading(true)
    apiCall('list', { status: 'active' })
      .then((j) => setAgreements(j.agreements || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function saveSelection(ids) {
    setSelectedIds(ids)
    if (ids == null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }

  // Lista filtrata: se selectedIds è array, mostra solo quelli; altrimenti tutti
  const visible = useMemo(() => {
    if (selectedIds == null) {
      // Default: top 5 più vicini al traguardo (o a rischio) per non saturare la card
      return [...agreements]
        .sort((a, b) => {
          // Priorità: at_risk/off_track > on_track > altri
          const prioA = priorityOf(a)
          const prioB = priorityOf(b)
          if (prioA !== prioB) return prioB - prioA
          return (b.progress?.percentage_complete || 0) - (a.progress?.percentage_complete || 0)
        })
        .slice(0, 5)
    }
    return agreements.filter((a) => selectedIds.includes(a.id))
  }, [agreements, selectedIds])

  return (
    <Card
      title="Accordi commerciali"
      badge={selectedIds == null
        ? (agreements.length > 5 ? `top 5 di ${agreements.length}` : `${agreements.length} attivi`)
        : `${visible.length} selezionati`}
      extra={
        <button onClick={() => setConfigOpen(true)}
          title="Scegli quali accordi monitorare"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text3)' }}>
          ⚙️
        </button>
      }>
      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>Errore: {error}</div>}
      {loading && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '0.5rem 0' }}>Caricamento…</div>}
      {!loading && agreements.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)', padding: '0.5rem 0' }}>
          Nessun accordo attivo. Crea il primo da <em>Vendite → Accordi commerciali</em>.
        </div>
      )}
      {!loading && agreements.length > 0 && visible.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)', padding: '0.5rem 0' }}>
          Nessun accordo selezionato. Clicca ⚙️ per scegliere quali monitorare.
        </div>
      )}
      {!loading && visible.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {visible.map((a) => <WidgetRow key={a.id} agreement={a} />)}
        </div>
      )}

      {configOpen && (
        <ConfigModal
          agreements={agreements}
          selectedIds={selectedIds}
          onSave={(ids) => { saveSelection(ids); setConfigOpen(false) }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </Card>
  )
}

function priorityOf(a) {
  const s = a.progress?.status_indicator
  if (s === 'off_track' || s === 'at_risk') return 2
  if (s === 'on_track') return 1
  return 0
}

function WidgetRow({ agreement }) {
  const p = agreement.progress
  const color = PROGRESS_COLOR[p?.status_indicator] || '#6B7280'
  const pct = p?.percentage_complete || 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agreement.name}
        </div>
        <div style={{ height: 5, background: 'var(--bg)', borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: color, transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
          <span>{formatMetric(p?.current_value, agreement.metric)} / {formatMetric(p?.target_value, agreement.metric)}</span>
          {p?.gap_to_next_tier > 0 && (
            <span>−{formatMetric(p.gap_to_next_tier, agreement.metric)}</span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, minWidth: 38, textAlign: 'right' }}>
        {Math.round(pct)}%
      </div>
    </div>
  )
}

function ConfigModal({ agreements, selectedIds, onSave, onClose }) {
  const [mode, setMode] = useState(selectedIds == null ? 'all' : 'custom')
  const [picked, setPicked] = useState(() => new Set(selectedIds || agreements.map((a) => a.id)))

  function toggle(id) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setPicked(next)
  }

  function save() {
    if (mode === 'all') onSave(null)
    else onSave(Array.from(picked))
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 10, padding: 20, maxWidth: 480, width: '100%',
        maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Accordi da monitorare</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
          Scegli quali accordi vedere nel widget di Panoramica.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer' }}>
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Mostra automaticamente i più importanti</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Top 5 accordi attivi prioritizzando quelli a rischio</div>
          </div>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
          <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Scelgo io quali vedere</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Seleziona uno o più accordi dalla lista</div>
          </div>
        </label>

        {mode === 'custom' && (
          <div style={{ marginTop: 12 }}>
            {agreements.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '1rem' }}>Nessun accordo disponibile.</div>
            )}
            {agreements.map((a) => (
              <label key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: '1px solid var(--border)', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.suppliers?.name || '—'}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: PROGRESS_COLOR[a.progress?.status_indicator] || '#6B7280' }}>
                  {Math.round(a.progress?.percentage_complete || 0)}%
                </span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
            Annulla
          </button>
          <button onClick={save} style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}
