import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card, fmt } from './shared/styles.jsx'

const iS = S.input

// ─── Componente ────────────────────────────────────────────────────────────
// from/to arrivano dal selettore globale dell'header (dashboard)
export default function IvaTab({ sp, sps, from, to }) {
  const [debito, setDebito] = useState({})   // { '22.00': { imponibile, imposta } }
  const [credito, setCredito] = useState({}) // idem
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState('')

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

  return <div>
    {/* ─── Indicazione periodo (impostato dall'header globale) ───────────── */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem', fontSize: 11, color: 'var(--text3)' }}>
      <span>Periodo IVA: <strong style={{ color: 'var(--text)' }}>{from} {to}</strong></span>
      <span style={{ marginLeft: 'auto', fontSize: 10, fontStyle: 'italic' }}>
        Cambia il periodo dalla tendina nell'header in alto
      </span>
    </div>

    {/* ─── Saldo grande in alto ────────────────────────────────────────── */}
    <div style={{ ...S.card, marginBottom: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: saldoColor }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: 16, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>IVA a debito (vendite)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#EF4444' }}>{fmt(totDebitoImp)}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>su imponibile {fmt(totDebitoImponibile)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>IVA a credito (acquisti)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#10B981' }}>{fmt(totCreditoImp)}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>su imponibile {fmt(totCreditoImponibile)}</div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{saldoLabel}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: saldoColor, letterSpacing: '-0.02em' }}>{fmt(Math.abs(saldo))}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {saldo > 0 ? 'Da versare entro il 16 del mese successivo' : saldo < 0 ? 'Riportabile a credito periodo successivo' : '—'}
          </div>
        </div>
      </div>
    </div>

    {/* ─── Loader ──────────────────────────────────────────────────────── */}
    {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Calcolo IVA…</div>}

    {/* ─── Cards per aliquota ──────────────────────────────────────────── */}
    {!loading && aliquote.length === 0 && (
      <div style={{ ...S.card, textAlign: 'center', color: 'var(--text3)', padding: 30 }}>
        Nessun dato IVA in questo periodo. Verifica che ci siano scontrini in <code>{from} {to}</code>.
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
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>Aliquota {parseFloat(a)}%</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: sCol }}>{s >= 0 ? '+' : ''}{fmt(s)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>Debito (vendite)</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#EF4444' }}>{fmt(d.imposta)}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>imp. {fmt(d.imponibile)}</div>
              </div>
              <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>Credito (acquisti)</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#10B981' }}>{fmt(c.imposta)}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>imp. {fmt(c.imponibile)}</div>
              </div>
            </div>
          </div>
        })}
      </div>

      {/* ─── Tabella riepilogo completa ─────────────────────────────────── */}
      <Card title="Riepilogo IVA dettagliato">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
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
          <tfoot><tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
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
          <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 4 }}>Manutenzione IVA</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            Le fatture importate prima dell'aggiornamento non hanno il dettaglio IVA per aliquota.
            Ricalcola scaricando di nuovo l'XML da TS Digital.
          </div>
          {backfillMsg && <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 6 }}>{backfillMsg}</div>}
        </div>
        <button onClick={runBackfill} disabled={backfilling}
          style={{ ...iS, background: '#F59E0B', color: 'var(--text)', border: 'none', padding: '8px 16px', fontWeight: 600, fontSize: 12, cursor: backfilling ? 'wait' : 'pointer', opacity: backfilling ? 0.6 : 1 }}>
          {backfilling ? '⏳ In corso…' : 'Aggiorna IVA fatture vecchie'}
        </button>
      </div>
    </div>
  </div>
}
