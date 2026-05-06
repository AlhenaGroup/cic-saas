// Widget "Morning Briefing" per la Panoramica.
// 3 componenti indipendenti, ognuno e' un widget aggiungibile alla griglia:
//
//   <BriefingIeri sps={sps}/>     KPI di ieri vs stesso giorno settimana scorsa
//   <BriefingOggi sps={sps}/>     Cosa aspetta l'imprenditore oggi
//   <BriefingAttenzione sps={sps}/>  Allarmi: sotto scorta / scadenze / recensioni
//
// Tutti mobile-first: grid 1 colonna su <640, 2-4 su desktop.
// Pescano dati da Supabase (daily_stats, tasks, employee_documents, article_stock,
// staff_schedules, calendar_events). Niente chiamate live al CiC.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S, fmt, fmtN } from './shared/styles.jsx'
import { getFromDailyStats } from '../lib/cicApi.js'

// ── Helpers data ───────────────────────────────────────────────────
function ymd(d) { return d.toISOString().split('T')[0] }
function ieri() { const d = new Date(); d.setDate(d.getDate() - 1); return d }
function oggi() { return new Date() }
function sevenDaysAgo(refDate) {
  const d = new Date(refDate); d.setDate(d.getDate() - 7); return d
}
function fmtDate(d) {
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ─── BRIEFING IERI ────────────────────────────────────────────────
export function BriefingIeri({ sps = [], sp = 'all' }) {
  const [d, setD] = useState({ today: null, prev: null, loading: true })
  const ie = ieri()
  const ie7 = sevenDaysAgo(ie)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const ids = sp === 'all' ? [] : [parseInt(sp)]
      const [today, prev] = await Promise.all([
        getFromDailyStats(ymd(ie), ymd(ie), ids),
        getFromDailyStats(ymd(ie7), ymd(ie7), ids),
      ])
      if (!cancel) setD({ today, prev, loading: false })
    })()
    return () => { cancel = true }
  }, [sp])

  const t = d.today, p = d.prev
  const ricavi = t?.totale || 0
  const ricaviPrev = p?.totale || 0
  const cop = t?.coperti || 0
  const copPrev = p?.coperti || 0
  const medio = t?.copertoMedio || 0
  const medioPrev = p?.copertoMedio || 0
  const close = t?.fiscalCloseTime || null
  const closePrev = p?.fiscalCloseTime || null

  return <div style={{ ...S.card }}>
    <BriefingHeader
      tag="Ieri è andata..."
      date={fmtDate(ie)}
    />
    {d.loading ? (
      <Loader/>
    ) : !t ? (
      <EmptyState text="Nessun dato per ieri (forse il sync non ha ancora processato)."/>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 8 }}>
        <Metric label="Ricavi" value={fmt(ricavi)} delta={delta(ricavi, ricaviPrev, 'eur')} positive="up"/>
        <Metric label="Coperti" value={fmtN(cop)} delta={delta(cop, copPrev, 'num')} positive="up"/>
        <Metric label="Coperto medio" value={fmt(medio)} delta={delta(medio, medioPrev, 'eur')} positive="up"/>
        <Metric label="Chiusura cassa" value={close || '—'} delta={timeDelta(close, closePrev)} positive="lower"/>
      </div>
    )}
    {!d.loading && t && p && (
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, fontStyle: 'italic' }}>
        Confronto con stesso giorno settimana scorsa ({fmtDate(ie7)})
      </div>
    )}
  </div>
}

// ─── BRIEFING OGGI ────────────────────────────────────────────────
export function BriefingOggi({ sps = [], sp = 'all' }) {
  const [d, setD] = useState({ loading: true })
  const tg = oggi()

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const targetDate = ymd(tg)
      const localeName = sp === 'all' ? null : (sps.find(s => String(s.id) === String(sp))?.description)

      // Coperti attesi: media degli ultimi 4 stessi-giorni-settimana
      const days = []
      for (let w = 1; w <= 4; w++) {
        const x = new Date(tg); x.setDate(x.getDate() - 7 * w); days.push(ymd(x))
      }
      const ids = sp === 'all' ? [] : [parseInt(sp)]
      const histPromises = days.map(d => getFromDailyStats(d, d, ids).catch(() => null))
      const hist = await Promise.all(histPromises)
      const validCop = hist.filter(h => h && h.coperti > 0).map(h => h.coperti)
      const copertiAttesi = validCop.length ? Math.round(validCop.reduce((a, b) => a + b, 0) / validCop.length) : null

      // Staff in turno oggi (employee_shifts)
      const dow = (tg.getDay() + 6) % 7 // 0=Lun
      const monday = new Date(tg); monday.setDate(monday.getDate() - dow)
      const weekKey = ymd(monday)
      let qShifts = supabase.from('employee_shifts').select('*, employees(nome,locale,ruolo)').eq('settimana', weekKey).eq('giorno', dow)
      const { data: shifts } = await qShifts
      const staff = (shifts || []).filter(s => !localeName || (s.employees?.locale || '').includes(localeName))
      // Dedup per dipendente (un dip puo' avere piu' turni nello stesso giorno)
      const empIds = new Set(staff.map(s => s.employee_id))
      const staffNomi = [...new Set(staff.map(s => s.employees?.nome).filter(Boolean))]

      // Task del giorno
      let qTasks = supabase.from('tasks').select('id,title,priority,assigned_employee_ids,locale,status').eq('due_date', targetDate)
      if (localeName) qTasks = qTasks.eq('locale', localeName)
      const { data: tasks } = await qTasks
      const taskList = tasks || []
      const urgenti = taskList.filter(t => t.priority === 'urgente' || t.priority === 'alta').length
      const fatte = taskList.filter(t => t.status === 'fatta').length

      // Eventi calendario (HR + scadenze documenti)
      let qEvents = supabase.from('calendar_events').select('id,titolo,tipo,urgenza').gte('data_inizio', targetDate + 'T00:00:00').lte('data_inizio', targetDate + 'T23:59:59')
      const { data: events } = await qEvents

      if (!cancel) setD({
        copertiAttesi,
        staffCount: empIds.size,
        staffNomi,
        taskList,
        urgenti, fatte,
        events: events || [],
        loading: false,
      })
    })()
    return () => { cancel = true }
  }, [sp])

  return <div style={{ ...S.card }}>
    <BriefingHeader tag="Oggi cosa mi aspetta" date={fmtDate(tg)}/>
    {d.loading ? <Loader/> : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 8 }}>
        <Metric label="Coperti attesi" value={d.copertiAttesi != null ? '~' + d.copertiAttesi : '—'} sub={d.copertiAttesi != null ? 'media 4 settimane' : 'storia insufficiente'}/>
        <Metric label="Staff in turno" value={d.staffCount} sub={d.staffNomi.slice(0, 3).join(', ') + (d.staffNomi.length > 3 ? ` +${d.staffNomi.length - 3}` : '') || 'nessuno'}/>
        <Metric label="Task" value={d.taskList.length} sub={d.urgenti > 0 ? `${d.urgenti} urgenti` : `${d.fatte} fatte`} accent={d.urgenti > 0 ? 'var(--red)' : 'var(--text2)'}/>
        <Metric label="Eventi" value={d.events.length} sub={d.events.length > 0 ? d.events.slice(0, 1).map(e => e.titolo).join(', ') : 'nessuno'}/>
      </div>
    )}
  </div>
}

// ─── BRIEFING ATTENZIONE ──────────────────────────────────────────
export function BriefingAttenzione({ sps = [], sp = 'all' }) {
  const [d, setD] = useState({ loading: true, alerts: [] })

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const localeName = sp === 'all' ? null : (sps.find(s => String(s.id) === String(sp))?.description)
      const tg = oggi()
      const in30 = new Date(tg); in30.setDate(in30.getDate() + 30)
      const tgStr = ymd(tg), in30Str = ymd(in30)

      const alerts = []

      // 1. Articoli sotto scorta (article_stock con quantita < scorta_min, se la colonna esiste)
      try {
        let qStock = supabase.from('article_stock').select('nome_articolo,quantita,unita,locale').lt('quantita', 1)
        if (localeName) qStock = qStock.eq('locale', localeName)
        const { data: stock } = await qStock.limit(20)
        ;(stock || []).slice(0, 5).forEach(s => alerts.push({
          kind: 'stock',
          icon: '!',
          text: `${s.nome_articolo} sotto scorta (${s.quantita} ${s.unita})${localeName ? '' : ' · ' + s.locale}`,
        }))
      } catch {}

      // 2. Documenti dipendenti in scadenza nei prossimi 30gg
      try {
        const { data: docs } = await supabase.from('employee_documents').select('id,nome,tipo,scadenza,employee_id,employees(nome)').gte('scadenza', tgStr).lte('scadenza', in30Str).order('scadenza').limit(20)
        ;(docs || []).slice(0, 5).forEach(doc => {
          const days = Math.ceil((new Date(doc.scadenza) - tg) / 86400000)
          alerts.push({
            kind: 'doc',
            icon: '!',
            text: `${doc.tipo} ${doc.nome} di ${doc.employees?.nome || '?'} scade fra ${days}gg`,
          })
        })
      } catch {}

      // 3. Recensioni negative ultimo giorno
      try {
        const yest = ymd(ieri())
        const { data: revs } = await supabase.from('reviews').select('id,author_name,rating,text,created_at').lte('rating', 3).gte('created_at', yest + 'T00:00:00').limit(10)
        ;(revs || []).slice(0, 3).forEach(r => alerts.push({
          kind: 'review',
          icon: '!',
          text: `Recensione ${r.rating}★ di ${r.author_name || 'anonimo'}`,
        }))
      } catch {}

      // 4. Task scadute non completate
      try {
        let qTasks = supabase.from('tasks').select('id,title,due_date,status').lt('due_date', tgStr).neq('status', 'fatta').neq('status', 'saltata')
        if (localeName) qTasks = qTasks.eq('locale', localeName)
        const { data: tasks } = await qTasks.limit(10)
        ;(tasks || []).slice(0, 3).forEach(t => {
          const days = Math.ceil((tg - new Date(t.due_date)) / 86400000)
          alerts.push({
            kind: 'task',
            icon: '!',
            text: `Task "${t.title}" scaduta da ${days}g`,
          })
        })
      } catch {}

      if (!cancel) setD({ loading: false, alerts })
    })()
    return () => { cancel = true }
  }, [sp])

  return <div style={{ ...S.card }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Attenzione</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>Cosa serve la mia attenzione</div>
      </div>
      {!d.loading && (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
          background: d.alerts.length ? 'var(--red-bg)' : 'var(--green-bg)',
          color: d.alerts.length ? 'var(--red-text)' : 'var(--green-text)',
        }}>{d.alerts.length} avvis{d.alerts.length === 1 ? 'o' : 'i'}</span>
      )}
    </div>
    {d.loading && <Loader/>}
    {!d.loading && d.alerts.length === 0 && (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Tutto in ordine. Nessun allarme oggi.
      </div>
    )}
    {!d.loading && d.alerts.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {d.alerts.map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', background: 'var(--surface2)',
            borderLeft: '3px solid var(--red)', borderRadius: 'var(--radius-control)',
            fontSize: 13, color: 'var(--text)',
          }}>
            <span style={{ fontWeight: 700, color: 'var(--red)', fontSize: 14, lineHeight: 1, minWidth: 14 }}>{a.icon}</span>
            <span style={{ flex: 1 }}>{a.text}</span>
          </div>
        ))}
      </div>
    )}
  </div>
}

// ─── Helpers UI ────────────────────────────────────────────────────
function BriefingHeader({ tag, date }) {
  return <div style={{ marginBottom: 4 }}>
    <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
      {tag}
    </div>
    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, textTransform: 'capitalize' }}>{date}</div>
  </div>
}

function Metric({ label, value, delta, sub, accent = 'var(--text)', positive = 'up' }) {
  return <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius-control)', padding: 12 }}>
    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, letterSpacing: '-0.01em' }}>{value}</div>
    {delta && <DeltaBadge {...delta} positive={positive}/>}
    {!delta && sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{sub}</div>}
  </div>
}

function DeltaBadge({ raw, pct, positive = 'up' }) {
  const isUp = raw >= 0
  // 'positive': se 'up' allora positivo = saliamo. Se 'lower' positivo = scendiamo (es. orario chiusura prima e' meglio? a discrezione, qui assumo neutro).
  const isGood = positive === 'up' ? isUp : !isUp
  const color = isGood ? 'var(--green)' : 'var(--red)'
  const sign = isUp ? '+' : ''
  return <div style={{ marginTop: 6, fontSize: 11, color, fontWeight: 600 }}>
    {sign}{typeof raw === 'string' ? raw : Math.round(raw).toLocaleString('it-IT')}
    {pct != null && ` (${sign}${pct.toFixed(1)}%)`}
  </div>
}

function Loader() {
  return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Caricamento…</div>
}

function EmptyState({ text }) {
  return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>{text}</div>
}

function delta(curr, prev, kind = 'num') {
  if (!prev || prev === 0) return null
  const raw = curr - prev
  const pct = (raw / prev) * 100
  return { raw, pct }
}

function timeDelta(curr, prev) {
  if (!curr || !prev) return null
  // Confronta orari "HH:MM"
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const diff = toMin(curr) - toMin(prev)
  if (diff === 0) return null
  return { raw: (diff > 0 ? '+' : '') + diff + ' min', pct: null }
}
