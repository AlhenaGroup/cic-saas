// Stack chart statistiche prenotazioni: per stato, per sorgente, per motivo visita (coperti).
// Usa Recharts già presente in altri moduli.

import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'

async function api(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'API error')
  return j
}

const COLORS_STATO = {
  pending:   '#94A3B8',
  confirmed: '#3B82F6',
  seated:    '#06B6D4',
  completed: '#10B981',
  no_show:   '#EF4444',
  cancelled: '#71717A',
  waitlist:  '#8B5CF6',
}
const LABEL_STATO = {
  pending: 'In attesa', confirmed: 'Confermata', seated: 'A tavolo',
  completed: 'Completata', no_show: 'No-show', cancelled: 'Cancellata', waitlist: 'Lista attesa',
}

const COLORS_SOURCE = {
  web: '#8B5CF6', google: '#4285F4', telefono: '#F59E0B',
  'walk-in': '#EC4899', manual: '#94A3B8', pos: '#10B981',
}

const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4', '#EF4444', '#84CC16', '#A78BFA', '#F97316', '#94A3B8', '#71717A']

function colorFor(key, idx, palette = PALETTE) {
  return COLORS_STATO[key] || COLORS_SOURCE[key] || palette[idx % palette.length]
}

function fmtDate(d) {
  const dt = new Date(d)
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

export default function ReservationsStats({ locale, from, to }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!locale || !from || !to) return
    setLoading(true)
    try {
      const fromIso = from + 'T00:00:00Z'
      const toIso = to + 'T23:59:59Z'
      const r = await api('/api/reservations', { action: 'stats', locale, from: fromIso, to: toIso })
      setStats(r.stats || null)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [locale, from, to])

  useEffect(() => { reload() }, [reload])

  if (loading) return <div style={{ color: 'var(--text2)', fontSize: 12, textAlign: 'center', padding: 20 }}>Caricamento grafici…</div>
  if (!stats || stats.series_stato.length === 0) return null

  return <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
    <ChartCard title="Prenotazioni per stato" subtitle="numero prenotazioni nel periodo">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={stats.series_stato}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => LABEL_STATO[v] || v} />
          {stats.keys.stati.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="a" fill={colorFor(k, i)} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Totals totals={stats.totals.stato} labels={LABEL_STATO} />
    </ChartCard>

    <ChartCard title="Prenotazioni per sorgente" subtitle="canale di acquisizione">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={stats.series_source}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {stats.keys.sources.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="a" fill={colorFor(k, i)} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Totals totals={stats.totals.source} />
    </ChartCard>

    <ChartCard title="Coperti per motivo visita" subtitle="totale pax raggruppato per occasione">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={stats.series_occasione}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {stats.keys.occasioni.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="a" fill={colorFor(k, i)} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Totals totals={stats.totals.coperti_occasione} />
    </ChartCard>
  </div>
}

function ChartCard({ title, subtitle, children }) {
  return <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
      {subtitle && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{subtitle}</span>}
    </div>
    {children}
  </div>
}

function Totals({ totals, labels = {} }) {
  const entries = Object.entries(totals || {}).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const tot = entries.reduce((s, [, v]) => s + v, 0)
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid #1a1f2e' }}>
    {entries.map(([k, v]) => (
      <div key={k} style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
        padding: '4px 9px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ color: 'var(--text)' }}>{labels[k] || k}</span>
        <b style={{ color: '#F59E0B' }}>{v}</b>
        <span style={{ color: 'var(--text3)' }}>({tot > 0 ? Math.round(v / tot * 100) : 0}%)</span>
      </div>
    ))}
  </div>
}

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text)',
}
