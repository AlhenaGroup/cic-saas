import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card, fmt, fmtD, pct } from './shared/styles.jsx'

const iS = S.input

// ─── Helpers periodo ───────────────────────────────────────────────────────
// Formati ref:
//   giorno      → "YYYY-MM-DD"
//   settimana   → "YYYY-MM-DD" (data del lunedi della settimana)
//   mensile     → "YYYY-MM"
//   trimestrale → "YYYY-Q[1-4]"
//   anno        → "YYYY"

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

function startOfWeekMonday(date) {
  const d = new Date(date)
  const day = d.getDay() || 7 // domenica = 0 → 7
  if (day !== 1) d.setDate(d.getDate() - (day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function periodRange(type, ref) {
  if (type === 'giorno') return { from: ref, to: ref }
  if (type === 'settimana') {
    const start = new Date(ref)
    const end = new Date(start); end.setDate(start.getDate() + 6)
    return { from: ref, to: ymd(end) }
  }
  if (type === 'mensile') {
    const [y, m] = ref.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  if (type === 'trimestrale') {
    const [y, q] = ref.split('-Q').map(Number)
    const sm = (q - 1) * 3 + 1, em = sm + 2
    const last = new Date(y, em, 0).getDate()
    return { from: `${y}-${String(sm).padStart(2, '0')}-01`, to: `${y}-${String(em).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  // anno
  return { from: `${ref}-01-01`, to: `${ref}-12-31` }
}

function shiftPeriod(type, ref, dir) {
  if (type === 'giorno') {
    const d = new Date(ref); d.setDate(d.getDate() + dir); return ymd(d)
  }
  if (type === 'settimana') {
    const d = new Date(ref); d.setDate(d.getDate() + dir * 7); return ymd(d)
  }
  if (type === 'mensile') {
    const [y, m] = ref.split('-').map(Number)
    const d = new Date(y, m - 1 + dir, 1)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  }
  if (type === 'trimestrale') {
    const [y, q] = ref.split('-Q').map(Number)
    let nq = q + dir, ny = y
    while (nq < 1) { nq += 4; ny-- }
    while (nq > 4) { nq -= 4; ny++ }
    return ny + '-Q' + nq
  }
  return String(Number(ref) + dir)
}

function periodLabel(type, ref) {
  if (type === 'giorno') {
    return new Date(ref).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  if (type === 'settimana') {
    const start = new Date(ref)
    const end = new Date(start); end.setDate(start.getDate() + 6)
    const sameMonth = start.getMonth() === end.getMonth()
    const startStr = start.toLocaleDateString('it-IT', { day: 'numeric', month: sameMonth ? undefined : 'short' })
    const endStr = end.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    return `${startStr} – ${endStr}`
  }
  if (type === 'mensile') {
    const [y, m] = ref.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
  }
  if (type === 'trimestrale') {
    const [y, q] = ref.split('-Q').map(Number)
    return `${q}° trimestre ${y}`
  }
  return `Anno ${ref}`
}

function defaultRef(type) {
  const d = new Date()
  if (type === 'giorno') return ymd(d)
  if (type === 'settimana') return ymd(startOfWeekMonday(d))
  if (type === 'mensile') return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  if (type === 'trimestrale') return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1)
  return String(d.getFullYear())
}

// Preset rapidi: ognuno restituisce { type, ref } da applicare
function preset(name) {
  const today = new Date()
  if (name === 'oggi') return { type: 'giorno', ref: ymd(today) }
  if (name === 'ieri') {
    const d = new Date(today); d.setDate(d.getDate() - 1)
    return { type: 'giorno', ref: ymd(d) }
  }
  if (name === 'sett_corr') return { type: 'settimana', ref: ymd(startOfWeekMonday(today)) }
  if (name === 'sett_scorsa') {
    const d = startOfWeekMonday(today); d.setDate(d.getDate() - 7)
    return { type: 'settimana', ref: ymd(d) }
  }
  if (name === 'mese_corr') return { type: 'mensile', ref: defaultRef('mensile') }
  if (name === 'mese_scorso') {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    return { type: 'mensile', ref: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }
  }
  if (name === 'trim_corr') return { type: 'trimestrale', ref: defaultRef('trimestrale') }
  if (name === 'trim_scorso') {
    const q = Math.floor(today.getMonth() / 3) + 1
    let pq = q - 1, py = today.getFullYear()
    if (pq < 1) { pq = 4; py-- }
    return { type: 'trimestrale', ref: py + '-Q' + pq }
  }
  if (name === 'anno_corr') return { type: 'anno', ref: defaultRef('anno') }
  if (name === 'anno_scorso') return { type: 'anno', ref: String(today.getFullYear() - 1) }
  return { type: 'mensile', ref: defaultRef('mensile') }
}

const PRESETS = [
  { key: 'oggi', label: 'Oggi' },
  { key: 'ieri', label: 'Ieri' },
  { key: 'sett_corr', label: 'Sett. corrente' },
  { key: 'sett_scorsa', label: 'Sett. scorsa' },
  { key: 'mese_corr', label: 'Mese in corso' },
  { key: 'mese_scorso', label: 'Mese scorso' },
  { key: 'trim_corr', label: 'Trim. corrente' },
  { key: 'trim_scorso', label: 'Trim. scorso' },
  { key: 'anno_corr', label: 'Anno in corso' },
  { key: 'anno_scorso', label: 'Anno scorso' },
]

// Quale preset corrisponde allo stato (type, ref)? Restituisce key o null.
function activePreset(type, ref) {
  for (const p of PRESETS) {
    const x = preset(p.key)
    if (x.type === type && x.ref === ref) return p.key
  }
  return null
}

// ─── Componente ────────────────────────────────────────────────────────────
export default function IvaTab({ sp, sps }) {
  const [periodType, setPeriodType] = useState(() => localStorage.getItem('iva_period_type') || 'mensile')
  const [refDate, setRefDate] = useState(() => {
    const saved = localStorage.getItem('iva_ref_date')
    // Accetta YYYY-MM-DD (giorno/settimana), YYYY-MM (mensile), YYYY-Q[1-4], YYYY (anno)
    if (saved && saved.match(/^\d{4}(-\d{2}(-\d{2})?|-Q[1-4])?$/)) return saved
    return defaultRef(localStorage.getItem('iva_period_type') || 'mensile')
  })
  const [debito, setDebito] = useState({})   // { '22.00': { imponibile, imposta } }
  const [credito, setCredito] = useState({}) // idem
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState('')

  useEffect(() => { localStorage.setItem('iva_period_type', periodType) }, [periodType])
  useEffect(() => { localStorage.setItem('iva_ref_date', refDate) }, [refDate])

  const { from, to } = useMemo(() => periodRange(periodType, refDate), [periodType, refDate])
  const localeName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
    setLoading(true)
    // ─── A) IVA a DEBITO: somma da daily_stats.receipt_details nel range ────
    let dsQ = supabase.from('daily_stats').select('date, receipt_details, salespoint_name')
      .gte('date', from).lte('date', to)
    if (sp && sp !== 'all') {
      const asNum = Number(sp)
      if (!Number.isNaN(asNum) && String(asNum) === String(sp)) dsQ = dsQ.eq('salespoint_id', asNum)
      else if (localeName) dsQ = dsQ.eq('salespoint_name', localeName)
    }
    const { data: dsRows } = await dsQ
    const debitoMap = {}
    ;(dsRows || []).forEach(row => {
      ;(row.receipt_details || []).forEach(receipt => {
        ;(receipt.items || []).forEach(item => {
          const rate = Number(item.tax?.rate ?? item.iva ?? 0)
          const price = Number(item.totalPrice ?? item.prezzo ?? 0)
          if (price === 0) return
          const taxable = price / (1 + rate / 100)
          const tax = price - taxable
          const key = rate.toFixed(2)
          if (!debitoMap[key]) debitoMap[key] = { imponibile: 0, imposta: 0 }
          debitoMap[key].imponibile += taxable
          debitoMap[key].imposta += tax
        })
      })
    })
    Object.keys(debitoMap).forEach(k => {
      debitoMap[k].imponibile = Math.round(debitoMap[k].imponibile * 100) / 100
      debitoMap[k].imposta = Math.round(debitoMap[k].imposta * 100) / 100
    })

    // ─── B) IVA a CREDITO: somma da warehouse_invoices.iva_breakdown nel range ─
    let invQ = supabase.from('warehouse_invoices').select('iva_breakdown, locale, data')
      .gte('data', from).lte('data', to)
    if (localeName) invQ = invQ.eq('locale', localeName)
    const { data: invRows } = await invQ
    const creditoMap = {}
    ;(invRows || []).forEach(inv => {
      const bd = inv.iva_breakdown || {}
      Object.entries(bd).forEach(([rate, vals]) => {
        const key = parseFloat(rate).toFixed(2)
        if (!creditoMap[key]) creditoMap[key] = { imponibile: 0, imposta: 0 }
        creditoMap[key].imponibile += Number(vals.imponibile || 0)
        creditoMap[key].imposta += Number(vals.imposta || 0)
      })
    })
    Object.keys(creditoMap).forEach(k => {
      creditoMap[k].imponibile = Math.round(creditoMap[k].imponibile * 100) / 100
      creditoMap[k].imposta = Math.round(creditoMap[k].imposta * 100) / 100
    })

    setDebito(debitoMap)
    setCredito(creditoMap)
    setLoading(false)
  }, [from, to, sp, localeName])

  useEffect(() => { load() }, [load])

  // Lancia backfill iva_breakdown su fatture esistenti (chiamato in loop)
  const runBackfill = async () => {
    setBackfilling(true); setBackfillMsg('')
    let totalUpdated = 0, iter = 0
    try {
      while (true) {
        iter++
        const r = await fetch('/api/invoices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'backfill-iva-breakdown' })
        })
        const d = await r.json()
        if (!r.ok) { setBackfillMsg('Errore: ' + (d.error || r.status)); break }
        totalUpdated += (d.updated || 0)
        setBackfillMsg(`Iter ${iter}: aggiornate ${d.updated}, totali ${totalUpdated}, restanti ~${d.remaining}`)
        if (!d.hasMore || iter > 30) break
      }
      setBackfillMsg(`Backfill completato. Totale aggiornate: ${totalUpdated}`)
      await load()
    } catch (e) {
      setBackfillMsg('Errore: ' + e.message)
    }
    setBackfilling(false)
  }

  // ─── Aggregati per render ───────────────────────────────────────────────
  const aliquote = useMemo(() => {
    const all = new Set([...Object.keys(debito), ...Object.keys(credito)])
    return [...all].sort((a, b) => parseFloat(a) - parseFloat(b))
  }, [debito, credito])

  const totDebitoImp = aliquote.reduce((s, a) => s + (debito[a]?.imposta || 0), 0)
  const totCreditoImp = aliquote.reduce((s, a) => s + (credito[a]?.imposta || 0), 0)
  const saldo = totDebitoImp - totCreditoImp
  const totDebitoImponibile = aliquote.reduce((s, a) => s + (debito[a]?.imponibile || 0), 0)
  const totCreditoImponibile = aliquote.reduce((s, a) => s + (credito[a]?.imponibile || 0), 0)

  // Color saldo
  const saldoColor = saldo > 0 ? '#EF4444' : saldo < 0 ? '#10B981' : '#94a3b8'
  const saldoLabel = saldo > 0 ? 'IVA da versare' : saldo < 0 ? 'Credito IVA' : 'Pareggio'

  const currentPreset = activePreset(periodType, refDate)
  const TYPE_ICONS = { giorno: '📅', settimana: '🗓️', mensile: '📅', trimestrale: '📆', anno: '🗂️' }
  const TYPE_LABELS = { giorno: 'Giorno', settimana: 'Settimana', mensile: 'Mese', trimestrale: 'Trimestre', anno: 'Anno' }

  return <div>
    {/* ─── Riga 1: preset rapidi ─────────────────────────────────────────── */}
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {PRESETS.map(p => {
        const active = currentPreset === p.key
        return <button key={p.key}
          onClick={() => { const x = preset(p.key); setPeriodType(x.type); setRefDate(x.ref) }}
          style={{
            padding: '5px 11px', fontSize: 11, fontWeight: active ? 700 : 500,
            cursor: 'pointer',
            background: active ? '#F59E0B' : '#1a1f2e',
            color: active ? '#0f1420' : '#94a3b8',
            border: '1px solid ' + (active ? '#F59E0B' : '#2a3042'),
            borderRadius: 6,
            transition: 'all .15s'
          }}>
          {p.label}
        </button>
      })}
      {/* Tendina alternativa per accesso rapido */}
      <select value={currentPreset || ''}
        onChange={e => { if (!e.target.value) return; const x = preset(e.target.value); setPeriodType(x.type); setRefDate(x.ref) }}
        style={{ ...iS, fontSize: 11, padding: '5px 8px', marginLeft: 'auto' }}>
        <option value="">Periodo personalizzato</option>
        {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </div>

    {/* ─── Riga 2: tipo + frecce navigazione + range ─────────────────────── */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {TYPE_ICONS[periodType]} {TYPE_LABELS[periodType]}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1a1f2e', border: '1px solid #2a3042', borderRadius: 6, padding: 2 }}>
        <button onClick={() => setRefDate(shiftPeriod(periodType, refDate, -1))} title="Periodo precedente"
          style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '4px 10px', fontSize: 14 }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', minWidth: 200, textAlign: 'center', textTransform: 'capitalize' }}>
          {periodLabel(periodType, refDate)}
        </span>
        <button onClick={() => setRefDate(shiftPeriod(periodType, refDate, 1))} title="Periodo successivo"
          style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '4px 10px', fontSize: 14 }}>›</button>
      </div>
      <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>{from} → {to}</span>
    </div>

    {/* ─── Saldo grande in alto ────────────────────────────────────────── */}
    <div style={{ ...S.card, marginBottom: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: saldoColor }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: 16, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>IVA a debito (vendite)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#EF4444' }}>{fmt(totDebitoImp)}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>su imponibile {fmt(totDebitoImponibile)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>IVA a credito (acquisti)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#10B981' }}>{fmt(totCreditoImp)}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>su imponibile {fmt(totCreditoImponibile)}</div>
        </div>
        <div style={{ borderLeft: '1px solid #2a3042', paddingLeft: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{saldoLabel}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: saldoColor, letterSpacing: '-0.02em' }}>{fmt(Math.abs(saldo))}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {saldo > 0 ? 'Da versare entro il 16 del mese successivo' : saldo < 0 ? 'Riportabile a credito periodo successivo' : '—'}
          </div>
        </div>
      </div>
    </div>

    {/* ─── Loader ──────────────────────────────────────────────────────── */}
    {loading && <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>Calcolo IVA…</div>}

    {/* ─── Cards per aliquota ──────────────────────────────────────────── */}
    {!loading && aliquote.length === 0 && (
      <div style={{ ...S.card, textAlign: 'center', color: '#64748b', padding: 30 }}>
        Nessun dato IVA in questo periodo. Verifica che ci siano scontrini in <code>{from} → {to}</code>.
      </div>
    )}
    {!loading && aliquote.length > 0 && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: '1.25rem' }}>
        {aliquote.map(a => {
          const d = debito[a] || { imponibile: 0, imposta: 0 }
          const c = credito[a] || { imponibile: 0, imposta: 0 }
          const s = d.imposta - c.imposta
          const sCol = s > 0 ? '#EF4444' : s < 0 ? '#10B981' : '#94a3b8'
          return <div key={a} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Aliquota {parseFloat(a)}%</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: sCol }}>{s >= 0 ? '+' : ''}{fmt(s)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: '#0f1420', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>Debito (vendite)</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#EF4444' }}>{fmt(d.imposta)}</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>imp. {fmt(d.imponibile)}</div>
              </div>
              <div style={{ background: '#0f1420', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>Credito (acquisti)</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#10B981' }}>{fmt(c.imposta)}</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>imp. {fmt(c.imponibile)}</div>
              </div>
            </div>
          </div>
        })}
      </div>

      {/* ─── Tabella riepilogo completa ─────────────────────────────────── */}
      <Card title="Riepilogo IVA dettagliato">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Aliquota', 'Imp. vendite', 'IVA debito', 'Imp. acquisti', 'IVA credito', 'Saldo'].map(h =>
              <th key={h} style={S.th}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {aliquote.map(a => {
              const d = debito[a] || { imponibile: 0, imposta: 0 }
              const c = credito[a] || { imponibile: 0, imposta: 0 }
              const s = d.imposta - c.imposta
              return <tr key={a}>
                <td style={S.td}><span style={S.badge('#F59E0B', 'rgba(245,158,11,.15)')}>{parseFloat(a)}%</span></td>
                <td style={S.td}>{fmt(d.imponibile)}</td>
                <td style={{ ...S.td, color: '#EF4444', fontWeight: 600 }}>{fmt(d.imposta)}</td>
                <td style={S.td}>{fmt(c.imponibile)}</td>
                <td style={{ ...S.td, color: '#10B981', fontWeight: 600 }}>{fmt(c.imposta)}</td>
                <td style={{ ...S.td, fontWeight: 700, color: s > 0 ? '#EF4444' : s < 0 ? '#10B981' : '#94a3b8' }}>
                  {s > 0 ? '+' : ''}{fmt(s)}
                </td>
              </tr>
            })}
          </tbody>
          <tfoot><tr style={{ borderTop: '2px solid #2a3042', background: '#131825' }}>
            <td style={{ ...S.td, fontWeight: 700 }}>Totale</td>
            <td style={{ ...S.td, fontWeight: 600 }}>{fmt(totDebitoImponibile)}</td>
            <td style={{ ...S.td, fontWeight: 700, color: '#EF4444' }}>{fmt(totDebitoImp)}</td>
            <td style={{ ...S.td, fontWeight: 600 }}>{fmt(totCreditoImponibile)}</td>
            <td style={{ ...S.td, fontWeight: 700, color: '#10B981' }}>{fmt(totCreditoImp)}</td>
            <td style={{ ...S.td, fontWeight: 800, fontSize: 14, color: saldoColor }}>{saldo > 0 ? '+' : ''}{fmt(saldo)}</td>
          </tr></tfoot>
        </table>
      </Card>
    </>}

    {/* ─── Backfill IVA breakdown su vecchie fatture ───────────────────── */}
    <div style={{ ...S.card, marginTop: 16, background: 'rgba(245,158,11,.05)', borderColor: 'rgba(245,158,11,.25)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 4 }}>⚙️ Manutenzione IVA</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            Le fatture importate prima dell'aggiornamento non hanno il dettaglio IVA per aliquota.
            Ricalcola scaricando di nuovo l'XML da TS Digital.
          </div>
          {backfillMsg && <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 6 }}>{backfillMsg}</div>}
        </div>
        <button onClick={runBackfill} disabled={backfilling}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '8px 16px', fontWeight: 600, fontSize: 12, cursor: backfilling ? 'wait' : 'pointer', opacity: backfilling ? 0.6 : 1 }}>
          {backfilling ? '⏳ In corso…' : '🔁 Aggiorna IVA fatture vecchie'}
        </button>
      </div>
    </div>
  </div>
}
