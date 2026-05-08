// Chiusure & Versamenti
// Una tabella per locale + tabella totale aggregata.
// Colonne: Data | Corrispettivo | Fatture | POS | Satispay | Contanti
//
// Sorgenti:
// - corrispettivo: daily_stats.revenue (auto, modificabile via override in closures)
// - fatture_emesse: manuale (closures.fatture_emesse)
// - pos / satispay: prima tenta da attendance_checklist_responses (label "pos"/"satispay"
//   nel jsonb risposte), altrimenti manuale (closures.pos / .satispay)
// - contanti: calcolato = corrispettivo + fatture - pos - satispay
//
// Edit inline su tutte le celle eccetto Contanti (calcolato).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card, fmtD } from './shared/styles.jsx'

const COLS = [
  { k: 'data',           label: 'Data',          editable: false },
  { k: 'corrispettivo',  label: 'Corrispettivo', editable: true,  source: 'cassa' },
  { k: 'fatture_emesse', label: 'Fatture',       editable: true,  source: 'manuale' },
  { k: 'pos',            label: 'POS',           editable: true,  source: 'checklist' },
  { k: 'satispay',       label: 'Satispay',      editable: true,  source: 'checklist' },
  { k: 'contanti',       label: 'Contanti',      editable: false, source: 'calc' },
]

const ymd = (d) => d.toISOString().split('T')[0]
// Giornata operativa: cutoff 05:00 (Europe/Rome). Una checklist USCITA fatta
// alle 02:30 della notte del 16 appartiene al giorno operativo 15 (chiusura serale del 15).
// Restituisce 'YYYY-MM-DD' in fuso orario locale dopo aver sottratto 5h.
const operatingDayLocal = (tsStr) => {
  if (!tsStr) return null
  const d = new Date(tsStr)
  if (isNaN(d.getTime())) return null
  d.setHours(d.getHours() - 5)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const parseEur = (v) => {
  if (v == null || v === '') return 0
  const s = String(v).replace(',', '.').replace(/[^\d.\-]/g, '')
  return Number(s) || 0
}

// Estrae POS/Satispay/Fatture da risposte checklist (best-effort: cerca per label).
// Cicla su TUTTE le checklist passate (un locale puo' averne piu' d'una, es. REMEMBEER ha
// "Sala · Chiusura" con i campi monetari e "Cucina · Chiusura" senza).
function extractFromChecklist(responses, checklists) {
  if (!responses?.length) return { pos: null, satispay: null, fatture: null }
  let pos = null, satispay = null, fatture = null
  // Indicizza items per checklist_id
  const itemsByChecklist = {}
  for (const c of (checklists || [])) {
    itemsByChecklist[c.id] = Array.isArray(c.items) ? c.items : []
  }
  for (const r of responses) {
    if (r.skipped) continue
    const items = itemsByChecklist[r.checklist_id] || []
    const ans = r.risposte || {}
    for (const it of items) {
      const label = (it.label || '').toLowerCase()
      const id = String(it.id || '')
      const v = ans[id]
      if (v == null || v === '') continue
      const n = parseEur(v)
      if (pos == null && /\bpos\b|carta|bancomat/i.test(label)) pos = n
      if (satispay == null && /satispay|saty/i.test(label)) satispay = n
      if (fatture == null && /\bfatture?\b/i.test(label)) fatture = n
    }
  }
  return { pos, satispay, fatture }
}

export default function ChiusureView({ from, to, sps = [] }) {
  const [closures, setClosures] = useState([])
  const [dailyStats, setDailyStats] = useState([])
  const [checklists, setChecklists] = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null) // 'locale|data' chiave riga in salvataggio
  const [error, setError] = useState('')
  const [view, setView] = useState(() => localStorage.getItem('chiusure_view') || '') // '' (= primo locale) | nome locale
  useEffect(() => { localStorage.setItem('chiusure_view', view) }, [view])

  const localesAvail = useMemo(() => (sps || []).map(s => s.description || s.name).filter(Boolean), [sps])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [{ data: cl }, { data: ds }, { data: ck }, { data: rsp }] = await Promise.all([
        supabase.from('closures').select('*').gte('data', from).lte('data', to),
        supabase.from('daily_stats').select('date,salespoint_name,revenue,bill_count,receipt_details').gte('date', from).lte('date', to),
        supabase.from('attendance_checklists').select('id,locale,momento,items').eq('momento', 'uscita').eq('attivo', true),
        // Estende la finestra fino al mattino successivo a `to`: locali che chiudono dopo
        // mezzanotte salvano la checklist USCITA con created_at del giorno dopo.
        // Il filtro per giorno operativo viene poi applicato in buildRow.
        supabase.from('attendance_checklist_responses').select('checklist_id,locale,created_at,risposte,skipped').gte('created_at', from + 'T00:00:00').lte('created_at', (() => {
          const d = new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]
        })() + 'T23:59:59'),
      ])
      setClosures(cl || [])
      setDailyStats(ds || [])
      setChecklists(ck || [])
      setResponses(rsp || [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [from, to])
  useEffect(() => { load() }, [load])

  // Genera lista date (incluse) tra from e to
  const dates = useMemo(() => {
    const out = []
    const start = new Date(from + 'T00:00:00')
    const end = new Date(to + 'T00:00:00')
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(ymd(d))
    return out
  }, [from, to])

  // Per ogni locale × data, costruisce riga con valori effettivi (override > checklist > daily_stats)
  // CORRISPETTIVO = solo scontrini fiscali (non fatture); FATTURE = sum di receipt_details con isInvoice=true
  const buildRow = useCallback((locale, dateStr) => {
    const cl = closures.find(c => c.locale === locale && c.data === dateStr)
    const ds = dailyStats.find(d => d.salespoint_name === locale && d.date === dateStr)
    const cklUscitaList = checklists.filter(c => c.locale === locale)
    // Una checklist USCITA appartiene al giorno operativo basato sul cutoff 05:00.
    // Es. response salvata il 2026-01-16T02:30 = giornata operativa 2026-01-15 (chiusura
    // serale del 15 protrattasi oltre mezzanotte). Cosi' REMEMBEER non prende per sbaglio
    // i valori della notte successiva attribuendoli al giorno corrente.
    const dayResponses = responses.filter(r => r.locale === locale && operatingDayLocal(r.created_at) === dateStr)
    const fromChecklist = extractFromChecklist(dayResponses, cklUscitaList)

    // Suddivisione automatica scontrini vs fatture da receipt_details
    let corrAuto = null, fatAuto = null
    if (ds) {
      const rd = Array.isArray(ds.receipt_details) ? ds.receipt_details : []
      if (rd.length > 0) {
        let sc = 0, inv = 0
        for (const r of rd) {
          const t = Number(r.totale) || 0
          if (r.isInvoice) inv += t
          else sc += t
        }
        corrAuto = sc
        fatAuto = inv
      } else {
        // Fallback: nessun receipt_details, usa revenue come corrispettivo
        corrAuto = Number(ds.revenue) || 0
        fatAuto = 0
      }
    }

    const corrispettivo = cl?.corrispettivo != null ? Number(cl.corrispettivo) : corrAuto
    // Per le fatture: prima override, poi cassa (isInvoice), poi checklist (fallback se cassa non ne ha)
    const fatturaCassaPresente = fatAuto != null && fatAuto > 0
    const fatture = cl?.fatture_emesse != null
      ? Number(cl.fatture_emesse)
      : (fatturaCassaPresente ? fatAuto : (fromChecklist.fatture != null ? fromChecklist.fatture : fatAuto))
    const pos = cl?.pos != null ? Number(cl.pos) : (fromChecklist.pos)
    const satispay = cl?.satispay != null ? Number(cl.satispay) : (fromChecklist.satispay)

    const corrN = corrispettivo || 0
    const fatN = fatture || 0
    const posN = pos || 0
    const satyN = satispay || 0
    const contanti = corrN + fatN - posN - satyN

    return {
      locale, data: dateStr,
      corrispettivo, fatture_emesse: fatture, pos, satispay, contanti,
      // Origine dei dati per UI
      sourceCorr: cl?.corrispettivo != null ? 'manuale' : (corrAuto != null ? 'cassa' : null),
      sourceFat:  cl?.fatture_emesse != null ? 'manuale' : (fatturaCassaPresente ? 'cassa' : (fromChecklist.fatture != null ? 'checklist' : null)),
      sourcePos:  cl?.pos != null ? 'manuale' : (fromChecklist.pos != null ? 'checklist' : null),
      sourceSaty: cl?.satispay != null ? 'manuale' : (fromChecklist.satispay != null ? 'checklist' : null),
    }
  }, [closures, dailyStats, checklists, responses])

  const upsertCell = async (locale, dateStr, field, value) => {
    const num = value === '' || value == null ? null : parseEur(value)
    setSaving(locale + '|' + dateStr)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const existing = closures.find(c => c.locale === locale && c.data === dateStr)
      if (existing) {
        const { data, error } = await supabase.from('closures')
          .update({ [field]: num, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select()
        if (error) throw error
        setClosures(prev => prev.map(c => c.id === existing.id ? (data?.[0] || c) : c))
      } else {
        const row = { user_id: user.id, locale, data: dateStr, [field]: num }
        const { data, error } = await supabase.from('closures').insert(row).select()
        if (error) throw error
        if (data?.[0]) setClosures(prev => [...prev, data[0]])
      }
    } catch (e) { setError(e.message) }
    setSaving(null)
  }

  // Tabelle per ogni locale + totale aggregato
  const allRows = useMemo(() => {
    const m = {}
    for (const loc of localesAvail) m[loc] = dates.map(d => buildRow(loc, d))
    return m
  }, [localesAvail, dates, buildRow])

  const totalRows = useMemo(() => {
    return dates.map(d => {
      let corr = 0, fat = 0, pos = 0, saty = 0
      let hasCorr = false, hasFat = false, hasPos = false, hasSaty = false
      for (const loc of localesAvail) {
        const r = allRows[loc]?.find(x => x.data === d)
        if (!r) continue
        if (r.corrispettivo != null) { corr += Number(r.corrispettivo) || 0; hasCorr = true }
        if (r.fatture_emesse != null) { fat += Number(r.fatture_emesse) || 0; hasFat = true }
        if (r.pos != null) { pos += Number(r.pos) || 0; hasPos = true }
        if (r.satispay != null) { saty += Number(r.satispay) || 0; hasSaty = true }
      }
      return { data: d, corrispettivo: hasCorr ? corr : null, fatture_emesse: hasFat ? fat : null, pos: hasPos ? pos : null, satispay: hasSaty ? saty : null, contanti: corr + fat - pos - saty }
    })
  }, [dates, localesAvail, allRows])

  if (loading) return <Card title="Chiusure & Versamenti"><div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div></Card>

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}

    {/* Filtro locale */}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginRight: 4 }}>Locale:</span>
      {localesAvail.map(loc => {
        const active = view === loc || (!localesAvail.includes(view) && loc === localesAvail[0])
        return <ViewBtn key={loc} label={loc} active={active} onClick={() => setView(loc)}/>
      })}
    </div>

    <Legend/>

    {/* Tabella del locale selezionato (default: primo locale) */}
    {(() => {
      const selected = localesAvail.includes(view) ? view : localesAvail[0]
      if (!selected) return null
      return <ClosureTable title={selected} rows={allRows[selected] || []} editable
        savingKey={saving} onEdit={(field, dateStr, val) => upsertCell(selected, dateStr, field, val)}/>
    })()}

    {/* Tabella TOTALE sempre alla fine (visibile solo se piu' locali) */}
    {localesAvail.length > 1 && (
      <ClosureTable title="TOTALE — tutti i locali aggregati" rows={totalRows} editable={false} accent="#10B981"/>
    )}
  </div>
}

function ViewBtn({ label, active, onClick, accent }) {
  const c = accent || 'var(--text)'
  return <button onClick={onClick}
    style={{
      padding: '7px 14px', fontSize: 12, fontWeight: 600,
      background: active ? c : 'transparent',
      color: active ? (accent ? '#0f1420' : 'var(--surface)') : 'var(--text2)',
      border: '1px solid ' + (active ? c : 'var(--border)'),
      borderRadius: 8, cursor: 'pointer',
    }}>{label}</button>
}

const SOURCE_COLOR = {
  cassa:     '#3B82F6',  // blu = dato auto dal gestionale di cassa CiC
  checklist: '#10B981',  // verde = dato auto da checklist chiusura
  manuale:   '#F59E0B',  // arancione = override manuale dell'imprenditore
  calc:      'var(--text3)',
}

function Legend() {
  const items = [
    { c: SOURCE_COLOR.cassa,     l: 'Da cassa (CiC)' },
    { c: SOURCE_COLOR.checklist, l: 'Da checklist chiusura' },
    { c: SOURCE_COLOR.manuale,   l: 'Modificato manualmente' },
  ]
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
    <strong style={{ color: 'var(--text2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>Origine dato</strong>
    {items.map(it => (
      <span key={it.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, border: '2px solid ' + it.c, background: it.c + '15' }}/>
        <span style={{ color: 'var(--text2)' }}>{it.l}</span>
      </span>
    ))}
  </div>
}

function ClosureTable({ title, rows, editable, onEdit, savingKey, accent }) {
  // Totali colonna (somma dei valori non-null)
  const totals = useMemo(() => {
    const t = { corrispettivo: 0, fatture_emesse: 0, pos: 0, satispay: 0, contanti: 0 }
    for (const r of rows) {
      t.corrispettivo += Number(r.corrispettivo) || 0
      t.fatture_emesse += Number(r.fatture_emesse) || 0
      t.pos += Number(r.pos) || 0
      t.satispay += Number(r.satispay) || 0
      t.contanti += Number(r.contanti) || 0
    }
    return t
  }, [rows])

  return <Card title={title} accent={accent}>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {COLS.map(c => <th key={c.k} style={{ ...S.th, fontSize: 10 }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const rowKey = r.data
            const isSaving = savingKey === (title + '|' + r.data)
            return <tr key={rowKey} style={{ borderBottom: '1px solid var(--border)', opacity: isSaving ? 0.6 : 1 }}>
              <td style={{ ...S.td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {new Date(r.data + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })}
              </td>
              {COLS.slice(1).map(c => {
                const val = r[c.k]
                const isContanti = c.k === 'contanti'
                const sourceFlag = c.k === 'corrispettivo' ? r.sourceCorr
                                 : c.k === 'fatture_emesse' ? r.sourceFat
                                 : c.k === 'pos' ? r.sourcePos
                                 : c.k === 'satispay' ? r.sourceSaty
                                 : null
                if (!editable || isContanti || !onEdit) {
                  return <td key={c.k} style={{ ...S.td, fontWeight: isContanti ? 700 : 500, color: isContanti ? '#10B981' : 'var(--text)' }}>
                    {val == null ? <span style={{ color: 'var(--text3)' }}>—</span> : fmtD(Number(val) || 0)}
                  </td>
                }
                return <td key={c.k} style={{ ...S.td, padding: '4px 6px', position: 'relative' }}>
                  <EditableCell value={val} onCommit={(v) => onEdit(c.k, r.data, v)} sourceFlag={sourceFlag}/>
                </td>
              })}
            </tr>
          })}
          {rows.length === 0 && <tr><td colSpan={COLS.length} style={{ ...S.td, textAlign: 'center', color: 'var(--text3)', padding: 20, fontStyle: 'italic' }}>Nessun giorno nel periodo</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
            <td style={{ ...S.td, fontWeight: 700, fontSize: 11 }}>TOTALE</td>
            <td style={{ ...S.td, fontWeight: 700 }}>{fmtD(totals.corrispettivo)}</td>
            <td style={{ ...S.td, fontWeight: 700 }}>{fmtD(totals.fatture_emesse)}</td>
            <td style={{ ...S.td, fontWeight: 700 }}>{fmtD(totals.pos)}</td>
            <td style={{ ...S.td, fontWeight: 700 }}>{fmtD(totals.satispay)}</td>
            <td style={{ ...S.td, fontWeight: 800, color: '#10B981' }}>{fmtD(totals.contanti)}</td>
          </tr>
        </tfoot>}
      </table>
    </div>
    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, fontStyle: 'italic' }}>
      Contanti = Corrispettivo + Fatture − POS − Satispay. Click su una cella per modificarla. I valori dal gestionale di cassa o dalla checklist
      sono auto-popolati se disponibili; ogni override viene salvato e ha priorità.
    </div>
  </Card>
}

function EditableCell({ value, onCommit, sourceFlag }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const sourceColor = SOURCE_COLOR[sourceFlag]
  const sourceLabel = sourceFlag === 'cassa' ? 'Da cassa (CiC)' : sourceFlag === 'checklist' ? 'Da checklist' : sourceFlag === 'manuale' ? 'Modificato manualmente' : 'Click per inserire'
  if (editing) {
    return <input
      autoFocus value={draft} type="text" inputMode="decimal"
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onCommit(draft); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.target.blur() }
        if (e.key === 'Escape') { setEditing(false) }
      }}
      style={{ ...S.input, fontSize: 12, padding: '4px 6px', width: '100%', minWidth: 70, textAlign: 'right', border: '2px solid #3B82F6' }}
    />
  }
  const display = value == null ? null : fmtD(Number(value) || 0)
  return <button onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true) }}
    title={sourceLabel}
    style={{
      width: '100%', padding: '4px 6px', textAlign: 'right',
      background: sourceColor ? sourceColor + '12' : 'transparent',
      border: '2px solid ' + (sourceColor || 'var(--border)'),
      borderStyle: sourceColor ? 'solid' : 'dashed',
      borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
      color: display ? 'var(--text)' : 'var(--text3)',
      fontWeight: sourceFlag === 'manuale' ? 700 : 500,
    }}>
    {display || '—'}
  </button>
}
