import { useState, useEffect, useCallback } from 'react'
import { ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { useTheme, ThemeIcon } from '../lib/theme.jsx'
import Logo from '../components/Logo'
import { getToken, getSalesPoints, getReportData, getFromDailyStats } from '../lib/cicApi'
import { fmt, fmtD, fmtN, pct, today, monthStart, prevPeriod, deltaFmt, C, S, KPI, Card, Bar2, Tip, Loader } from '../components/shared/styles.jsx'
import HRModule from './HRModule'
import WarehouseModule from './WarehouseModule'
import BudgetModule from './BudgetModule'
import InvoiceTab from '../components/InvoiceTab'
import ContoEconomico from '../components/ContoEconomico'
import IvaTab from '../components/IvaTab'
import WidgetGrid from '../components/WidgetGrid'
import ChecklistWidget from '../components/ChecklistWidget'
import TaskWidget from '../components/TaskWidget'
import HaccpScadenzeWidget from '../components/HaccpScadenzeWidget'
import ChiusureView from '../components/ChiusureView'
import { BriefingIeri, BriefingOggi, BriefingAttenzione } from '../components/MorningBriefing'
import DailyReportSettings from '../components/DailyReportSettings'
import SubTabsBar from '../components/SubTabsBar'
import ImpostazioniModule from '../components/ImpostazioniModule'
import MarketingModule from './MarketingModule'
import HaccpModule from './HaccpModule'
import ReceiptDetailModal from '../components/ReceiptDetailModal'
import AvvisiModule from '../components/AvvisiModule'
import { useUserPlan } from '../lib/features'
import { canAccess, isStaffSession, loadStaffEmployee, StaffPermsProvider } from '../lib/permissions'

// ─── Preset periodo globali (validi per tutti i moduli) ────────────────────
const _ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
function _startOfWeekMonday(date) {
  const d = new Date(date)
  const day = d.getDay() || 7
  if (day !== 1) d.setDate(d.getDate() - (day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}
function presetRange(name) {
  const t = new Date()
  if (name === 'oggi') return { from: _ymd(t), to: _ymd(t) }
  if (name === 'ieri') {
    const d = new Date(t); d.setDate(d.getDate() - 1)
    return { from: _ymd(d), to: _ymd(d) }
  }
  if (name === 'sett_corr') {
    const s = _startOfWeekMonday(t); const e = new Date(s); e.setDate(s.getDate() + 6)
    return { from: _ymd(s), to: _ymd(e) }
  }
  if (name === 'sett_scorsa') {
    const s = _startOfWeekMonday(t); s.setDate(s.getDate() - 7)
    const e = new Date(s); e.setDate(s.getDate() + 6)
    return { from: _ymd(s), to: _ymd(e) }
  }
  if (name === 'mese_corr') {
    const y = t.getFullYear(), m = t.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  if (name === 'mese_scorso') {
    const d = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    const y = d.getFullYear(), m = d.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  if (name === 'trim_corr') {
    const q = Math.floor(t.getMonth() / 3) + 1, sm = (q - 1) * 3 + 1, em = sm + 2, y = t.getFullYear()
    const last = new Date(y, em, 0).getDate()
    return { from: `${y}-${String(sm).padStart(2, '0')}-01`, to: `${y}-${String(em).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  if (name === 'trim_scorso') {
    const cq = Math.floor(t.getMonth() / 3) + 1
    let pq = cq - 1, py = t.getFullYear()
    if (pq < 1) { pq = 4; py-- }
    const sm = (pq - 1) * 3 + 1, em = sm + 2
    const last = new Date(py, em, 0).getDate()
    return { from: `${py}-${String(sm).padStart(2, '0')}-01`, to: `${py}-${String(em).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  if (name === 'anno_corr') return { from: `${t.getFullYear()}-01-01`, to: `${t.getFullYear()}-12-31` }
  if (name === 'anno_scorso') { const y = t.getFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31` } }
  return null
}
const PERIOD_PRESETS = [
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
function activePresetKey(from, to) {
  for (const p of PERIOD_PRESETS) {
    const r = presetRange(p.key)
    if (r && r.from === from && r.to === to) return p.key
  }
  return ''
}

export default function DashboardPage({ settings }) {
  const [theme, toggleTheme] = useTheme()
  const [token, setToken]         = useState(null)
  const [from,  setFrom]          = useState(() => localStorage.getItem('cic_from') || monthStart())
  const [to,    setTo]            = useState(() => localStorage.getItem('cic_to') || today())
  const [sp,    setSp]            = useState(() => localStorage.getItem('cic_sp') || 'all')
  const [sps,   setSps]           = useState(() => {
    const raw = Array.isArray(settings?.sales_points) ? settings.sales_points : []
    // Rinomina FIORIO BIANCOLATTE
    return raw.map(s => ({...s, description: s.description === 'FIORIO' ? 'BIANCOLATTE' : s.description, name: s.name === 'FIORIO' ? 'BIANCOLATTE' : s.name }))
  })
  const [data,  setData]          = useState(null)
  const [loading,setLoading]      = useState(true)
  const [error,  setError]        = useState('')
  const [tab,    setTab]          = useState(() => localStorage.getItem('cic_tab') || 'ov')
  const [showDailyReport, setShowDailyReport] = useState(false)
  const [openReceipt, setOpenReceipt] = useState(null) // scontrino aperto in modal
  const [recSearch,setRecSearch]  = useState('')
  const [fatSearch,setFatSearch]  = useState('')
  const [fatFilter,setFatFilter]  = useState('all')
  const [prodRep,setProdRep]      = useState('tutti')
  // Confronto periodo
  const [from2, setFrom2]         = useState(() => localStorage.getItem('cic_from2') || '')
  const [to2,   setTo2]           = useState(() => localStorage.getItem('cic_to2') || '')
  const [prevData, setPrevData]   = useState(null)
  // Toggle confronto: OFF di default, salvato in localStorage. Quando OFF i KPI non
  // mostrano delta/percentuali e nessun fetch del periodo precedente viene fatto.
  const [compareEnabled, setCompareEnabled] = useState(() => localStorage.getItem('cic_compare') === 'true')
  useEffect(() => { localStorage.setItem('cic_compare', String(compareEnabled)) }, [compareEnabled])
  // Modalita' "personalizzato" forzata: anche se le date combaciano con un preset,
  // la tendina mostra Personalizzato e i date pickers restano visibili
  const [customMode,  setCustomMode]  = useState(false)
  const [customMode2, setCustomMode2] = useState(false)
  // Staff per fascia oraria (da Supabase)
  const [staffSchedule, setStaffSchedule] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cic_staff_schedule') || '{}') } catch { return {} }
  })
  // Ore lavorate reali per fascia oraria, calcolate dalle timbrature (attendance)
  const [workedHoursBySlot, setWorkedHoursBySlot] = useState({}) // { "08:00": 2.5, ... }
  const [personsBySlot, setPersonsBySlot] = useState({}) // { "08:00": 3, ... } dipendenti distinti presenti in fascia
  const [useRealHours, setUseRealHours] = useState(() => localStorage.getItem('cic_use_real_hours') !== 'false')
  useEffect(() => { localStorage.setItem('cic_use_real_hours', useRealHours) }, [useRealHours])
  // Soglie produttivita e target
  const [prodTarget, setProdTarget] = useState(() => Number(localStorage.getItem('cic_prod_target')) || 50)
  const [sogliaRed, setSogliaRed]   = useState(() => Number(localStorage.getItem('cic_soglia_red')) || 35)
  const [expandedReceipt, setExpandedReceipt] = useState(null)
  const [sogliaYel, setSogliaYel]   = useState(() => Number(localStorage.getItem('cic_soglia_yel')) || 47)
  // Persisti filtro in localStorage
  useEffect(() => { localStorage.setItem('cic_from', from) }, [from])
  useEffect(() => { localStorage.setItem('cic_to', to) }, [to])
  useEffect(() => { localStorage.setItem('cic_sp', sp) }, [sp])
  useEffect(() => { localStorage.setItem('cic_tab', tab) }, [tab])
  useEffect(() => { localStorage.setItem('cic_from2', from2) }, [from2])
  useEffect(() => { localStorage.setItem('cic_to2', to2) }, [to2])
  useEffect(() => { localStorage.setItem('cic_staff_schedule', JSON.stringify(staffSchedule)) }, [staffSchedule])
  useEffect(() => { localStorage.setItem('cic_prod_target', prodTarget) }, [prodTarget])
  useEffect(() => { localStorage.setItem('cic_soglia_red', sogliaRed) }, [sogliaRed])
  useEffect(() => { localStorage.setItem('cic_soglia_yel', sogliaYel) }, [sogliaYel])



  // ─── Staff Schedule ──────────────────────────────────────────────────
  const loadSchedule = useCallback(async () => {
    const loc = sp === 'all' ? 'all' : sp
    const { data } = await supabase.from('staff_schedules').select('schedule').eq('locale', loc).maybeSingle()
    if (data?.schedule) { setStaffSchedule(data.schedule); localStorage.setItem('cic_staff_schedule', JSON.stringify(data.schedule)) }
  }, [sp])
  const saveSchedule = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const loc = sp === 'all' ? 'all' : sp
    await supabase.from('staff_schedules').upsert({ user_id: user.id, locale: loc, schedule: staffSchedule, updated_at: new Date().toISOString() }, { onConflict: 'user_id,locale' })
  }

  useEffect(() => { loadSchedule() }, [loadSchedule])

  useEffect(() => {
    getToken(settings.cic_api_key).then(async t => {
      setToken(t)
      if (!sps.length) { const s=await getSalesPoints(t); setSps(s) }
    }).catch(e=>setError('Auth: '+e.message))
  }, [settings.cic_api_key])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const spf = sp==='all'?[]:[ parseInt(sp) ]
      const d = await getReportData(token,{from,to,idsSalesPoint:spf},sps)
      setData(d)
      // Carica dati periodo di confronto SOLO se confronto attivo
      if (compareEnabled) {
        const pp = (from2 && to2) ? { from: from2, to: to2 } : prevPeriod(from, to)
        if (!from2) setFrom2(pp.from)
        if (!to2) setTo2(pp.to)
        try {
          const pd = await getFromDailyStats(pp.from, pp.to, spf)
          setPrevData(pd)
        } catch { setPrevData(null) }
      } else {
        setPrevData(null)
      }
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  },[token,from,to,sp,sps,from2,to2,compareEnabled])
  useEffect(()=>{load()},[load])

  // ─── Carica timbrature nel periodo e calcola ore lavorate per fascia oraria ──
  // Usato nel tab Produttività come denominatore reale al posto del piano teorico.
  useEffect(() => {
    (async () => {
      const localeName = (!sp || sp === 'all') ? null : (sps?.find(s => String(s.id) === String(sp))?.description || null)
      // Range esteso +1 giorno per catturare uscite dopo mezzanotte (turni notturni)
      const toExt = new Date(to); toExt.setDate(toExt.getDate() + 1)
      let q = supabase.from('attendance').select('employee_id, timestamp, tipo, locale')
        .gte('timestamp', from + 'T00:00:00')
        .lt('timestamp', toExt.toISOString().split('T')[0] + 'T00:00:00')
        .order('timestamp')
      if (localeName) q = q.eq('locale', localeName)
      const { data: rows, error } = await q
      if (error || !rows) { setWorkedHoursBySlot({}); setPersonsBySlot({}); return }
      // Raggruppa per dipendente, costruisci blocchi entratauscita
      const byEmp = {}
      rows.forEach(r => {
        if (!byEmp[r.employee_id]) byEmp[r.employee_id] = []
        byEmp[r.employee_id].push(r)
      })
      const hours = {}               // "08:00" -> ore totali lavorate
      const personsSets = {}         // "08:00" -> Set di employee_id presenti
      const addSlotOverlap = (startMs, endMs, empId) => {
        if (!(endMs > startMs)) return
        // Itero a step di 15 minuti: aggiungo 0.25h nella fascia oraria di quel momento
        const STEP = 15 * 60 * 1000
        for (let t = startMs; t < endMs; t += STEP) {
          try {
            const hRome = new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false })
            const h = parseInt(hRome) || 0
            const key = String(h).padStart(2, '0') + ':00'
            const delta = Math.min(STEP, endMs - t) / 3600000
            hours[key] = (hours[key] || 0) + delta
            if (empId) {
              if (!personsSets[key]) personsSets[key] = new Set()
              personsSets[key].add(empId)
            }
          } catch {}
        }
      }
      for (const empId in byEmp) {
        const recs = byEmp[empId]
        let openEntry = null
        for (const r of recs) {
          if (r.tipo === 'entrata') {
            openEntry = r
          } else if (r.tipo === 'uscita' && openEntry) {
            addSlotOverlap(new Date(openEntry.timestamp).getTime(), new Date(r.timestamp).getTime(), empId)
            openEntry = null
          }
        }
      }
      // Tronca per difetto a 2 decimali (mai sovrastimare le ore lavorate)
      for (const k in hours) hours[k] = Math.floor(hours[k] * 100) / 100
      const persons = {}
      for (const k in personsSets) persons[k] = personsSets[k].size
      setWorkedHoursBySlot(hours)
      setPersonsBySlot(persons)
    })()
  }, [from, to, sp, sps])

  const totale = data?.totale||0
  const coperti = data?.coperti||0
  const copertoMedio = data?.copertoMedio||0
  // Confronto
  const dRicavi = deltaFmt(totale, prevData?.totale)
  const dScontrini = deltaFmt(data?.scontrini||0, prevData?.scontrini)
  const dCoperti = deltaFmt(coperti, prevData?.coperti)
  const dCopertoMedio = deltaFmt(copertoMedio, prevData?.copertoMedio)
  const depts  = data?.depts||[]
  const cats   = data?.cats||[]
  const taxes  = data?.taxes||[]
  const trend  = data?.trend||[]
  const prods  = data?.topProducts||[]
  const recs   = data?.scontriniList||[]
  const ore    = data?.prodOre||[]
  // Coperti / ricavi / scontrini per fascia oraria: aggrego dagli scontrini dettaglio
  // usando aperturaComanda (ora di presa ordine al tavolo), NON l'ora di chiusura/pagamento.
  // Per i ricavi questo è il dato corretto per misurare la produttività della fascia.
  const { copertiBySlot, ricaviBySlot, scontriniBySlot, hasReceiptDetails } = (() => {
    const cMap = {}, rMap = {}, sMap = {}
    const rd = data?.receiptDetails || []
    rd.forEach(r => {
      const h = (r.aperturaComanda || '').substring(0, 2)
      if (!h || !/^\d{2}$/.test(h)) return
      const key = h + ':00'
      cMap[key] = (cMap[key] || 0) + (Number(r.coperti) || 0)
      rMap[key] = (rMap[key] || 0) + (Number(r.totale) || 0)
      sMap[key] = (sMap[key] || 0) + 1
    })
    return { copertiBySlot: cMap, ricaviBySlot: rMap, scontriniBySlot: sMap, hasReceiptDetails: rd.length > 0 }
  })()
  const susp   = data?.suspicious||[]
  const fat    = data?.fatture||[]
  const ce     = data?.ce||{}
  const isDemo = data?.isDemo===true
  const isEmpty = data?.isEmpty===true
  const isLive = data?.isLive===true
  const [syncing, setSyncing] = useState(false)
  const forceSync = useCallback(async () => {
    if (!settings?.cic_api_key) return
    setSyncing(true)
    try {
      await fetch(`/api/sync-cron?apiKey=${encodeURIComponent(settings.cic_api_key)}&from=${from}&to=${to}`)
      await load()
    } finally { setSyncing(false) }
  }, [settings?.cic_api_key, from, to, load])


  const iS = S.input
  // Mapping hidden tab top-level tab "padre" che deve restare evidenziato.
  // Quando l'utente sceglie 'ce' o 'bud' dal sub-tab di Contabilita', tab top-level
  // diventa 'ce'/'bud' ma la barra principale deve mostrare "Contabilita" attivo.
  // Stesso per 'prod' (Produttivita') che e' sotto-tab di HR.
  const HIDDEN_TO_PARENT = { ce: 'conta', bud: 'conta' }
  const effectiveTopTab = HIDDEN_TO_PARENT[tab] || tab
  const tS = (t) => ({padding:'10px 16px',borderRadius:'var(--radius-control)',fontSize:13,fontWeight:500,cursor:'pointer',border:'1px solid '+(effectiveTopTab===t?'transparent':'transparent'),
    background:effectiveTopTab===t?'var(--text)':'transparent',color:effectiveTopTab===t?'var(--surface)':'var(--text2)',transition:'all .2s',position:'relative',letterSpacing:'-0.01em'})

  // Ordine top-level e label senza emoji.
  // Vendite include scontrini/categorie/reparti come sotto-tab (gestiti via subTab state).
  // Contabilità include fatture/IVA/chiusure come sotto-tab.
  // 'scontrini', 'cat', 'rep' restano come keys interne ai sotto-tab di Vendite — le keys di
  // ALL_TABS per la barra principale sono solo quelle qui sotto.
  // Ordine top-level richiesto: Panoramica · Contabilita' · Vendite · Magazzino · HR · Marketing · Impostazioni
  // CE/Budget/Produttivita' sono routes interne (raggiungibili via sub-tabs Contabilita' / HR)
  // Avvisi resta nel piano feature flag (puo' apparire o no a seconda del piano)
  const ALL_TABS=[['ov','Panoramica'],['conta','Contabilità'],['vendite','Vendite'],['mag','Magazzino'],['hr','HR'],
              ['haccp','HACCP'],['mkt','Marketing'],['avvisi','Avvisi'],['imp','Impostazioni']]
  // Tabs interne (non visibili in barra ma raggiungibili da sub-tabs):
  // 'ce'   da Contabilita' sub-tab Conto Economico
  // 'bud'  da Contabilita' sub-tab Budget
  // (Produttivita' ora vive dentro HRModule come sub-tab, non e' piu' tab top-level)
  const HIDDEN_TABS = ['ce','bud']
  // Sotto-tab Vendite/Contabilita': NON persistiti — al rientro nel modulo si
  // riparte dal primo sub-tab (Scontrini per Vendite, gestito dal click handler
  // top-level per Contabilita').
  const [vendSubTab, setVendSubTab] = useState('scontrini')
  const [contaSubTab, setContaSubTab] = useState('fatture')
  // Filtra in base al piano dell'utente (feature flag tab.X)
  const { features: planFeatures } = useUserPlan()
  // Sessione corrente: se staff, carica permessi dal record employees
  const [staffEmployee, setStaffEmployee] = useState(null)
  const [staffLoaded, setStaffLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!isStaffSession(session)) { setStaffEmployee(null); setStaffLoaded(true); return }
      const emp = await loadStaffEmployee(supabase)
      if (!cancelled) { setStaffEmployee(emp); setStaffLoaded(true) }
    })()
    return () => { cancelled = true }
  }, [])
  const staffPerms = staffEmployee?.module_permissions || null
  // Filtraggio: prima planFeatures (owner+staff), poi staffPerms (solo staff)
  let TABS = planFeatures ? ALL_TABS.filter(([k]) => planFeatures.tabs.has(k)) : ALL_TABS
  if (staffPerms) TABS = TABS.filter(([k]) => canAccess(staffPerms, k, false))
  // Tab autorizzati: top-level visibili + hidden routes raggiungibili dai sub-tabs
  const ALLOWED_TAB_KEYS = new Set([...TABS.map(([k]) => k), ...HIDDEN_TABS])
  // Se l'utente sta su un tab non piu' autorizzato (ne' visibile ne' hidden route), riporta al primo
  useEffect(() => {
    if (!planFeatures) return
    if (staffEmployee && !staffLoaded) return // attendi caricamento staff perms
    if (TABS.length > 0 && !ALLOWED_TAB_KEYS.has(tab)) setTab(TABS[0][0])
  }, [planFeatures, tab, TABS, staffEmployee, staffLoaded])

  // Compatta produttivita' per widget Panoramica: solo grafico + media giornaliera.
  // Usa le stesse closure di renderProduttivita ma in formato compatto, no toolbar.
  const renderProduttivitaCompact = () => {
    const prodColor = v => v < sogliaRed ? '#EF4444' : v < sogliaYel ? '#F59E0B' : '#10B981'
    const hourKeys = new Set(ore.map(o => o.ora))
    Object.keys(workedHoursBySlot).forEach(k => hourKeys.add(k))
    Object.keys(staffSchedule).forEach(k => hourKeys.add(k))
    Object.keys(ricaviBySlot).forEach(k => hourKeys.add(k))
    const oreMap = Object.fromEntries(ore.map(o => [o.ora, o]))
    const oreWithProd = [...hourKeys].sort().map(ora => {
      const fallback = oreMap[ora] || { ora, ricavi: 0 }
      const ricavi = hasReceiptDetails ? (ricaviBySlot[ora] || 0) : (fallback.ricavi || 0)
      const oreReali = workedHoursBySlot[ora] || 0
      const orePianif = staffSchedule[ora] || 0
      const oreLavorate = useRealHours ? (oreReali > 0 ? oreReali : 0) : orePianif
      const prodOraria = oreLavorate > 0 ? ricavi / oreLavorate : 0
      return { ora, ricavi, staff: oreLavorate, prodOraria }
    }).filter(o => o.ricavi > 0)
    const totOreDay = oreWithProd.reduce((s,o) => s + o.staff, 0)
    const totIncassoOre = oreWithProd.reduce((s,o) => s + o.ricavi, 0)
    const nDays = trend.length || 1
    const mediaGiorn = totOreDay > 0 ? (totIncassoOre / nDays) / totOreDay : 0

    if (oreWithProd.length === 0) {
      return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Nessun dato di vendita oraria per il periodo selezionato.
      </div>
    }

    return <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, flexWrap: 'wrap', fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text3)' }}>Ore:</span>
          <button onClick={() => setUseRealHours(true)}
            style={{ padding: '3px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 4,
              border: '1px solid var(--border)',
              background: useRealHours ? '#10B981' : 'transparent', color: useRealHours ? '#fff' : 'var(--text2)' }}>Reali</button>
          <button onClick={() => setUseRealHours(false)}
            style={{ padding: '3px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 4,
              border: '1px solid var(--border)',
              background: !useRealHours ? '#F59E0B' : 'transparent', color: !useRealHours ? '#fff' : 'var(--text2)' }}>Pianificate</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text3)' }}>Media giornaliera:</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: prodColor(mediaGiorn) }}>{mediaGiorn > 0 ? mediaGiorn.toFixed(1) + ' €/h' : '—'}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={oreWithProd} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="ora" tick={{ fontSize: 10, fill: 'var(--text3)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text3)' }} tickFormatter={v => v + '€'} tickLine={false} axisLine={false} width={42} />
          <Tooltip formatter={(v, name) => name === 'prodOraria' ? v.toFixed(1) + ' €/h' : fmt(v)}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }} />
          <Bar dataKey="ricavi" name="Ricavi" radius={[3, 3, 0, 0]}>
            {oreWithProd.map((o, i) => <Cell key={i} fill={o.staff > 0 ? prodColor(o.prodOraria) : '#F59E0B'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 6, fontSize: 10, color: 'var(--text3)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#10B981' }}/>≥{sogliaYel}€/h</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#F59E0B' }}/>{sogliaRed}-{sogliaYel}€/h</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#EF4444' }}/>&lt;{sogliaRed}€/h</span>
      </div>
    </div>
  }

  // Render del blocco Produttivita' come funzione che ritorna JSX. Viene passato a
  // HRModule come prop renderProduttivita; HRModule lo invoca quando l'utente
  // sceglie il sub-tab "Produttivita'". Closures su tutti i state di DashboardPage.
  const renderProduttivita = () => {
    const prodColor = v => v < sogliaRed ? '#EF4444' : v < sogliaYel ? '#F59E0B' : '#10B981'
    const prodLabel = v => v < sogliaRed ? 'Sotto soglia' : v < sogliaYel ? 'Attenzione' : 'OK'
    const hourKeys = new Set(ore.map(o => o.ora))
    Object.keys(workedHoursBySlot).forEach(k => hourKeys.add(k))
    Object.keys(staffSchedule).forEach(k => hourKeys.add(k))
    Object.keys(personsBySlot).forEach(k => hourKeys.add(k))
    Object.keys(copertiBySlot).forEach(k => hourKeys.add(k))
    Object.keys(ricaviBySlot).forEach(k => hourKeys.add(k))
    const oreMap = Object.fromEntries(ore.map(o => [o.ora, o]))
    const oreWithProd = [...hourKeys].sort().map(ora => {
      const fallback = oreMap[ora] || { ora, ricavi: 0, scontrini: 0 }
      const ricavi = hasReceiptDetails ? (ricaviBySlot[ora] || 0) : (fallback.ricavi || 0)
      const scontrini = hasReceiptDetails ? (scontriniBySlot[ora] || 0) : (fallback.scontrini || 0)
      const oreReali = workedHoursBySlot[ora] || 0
      const orePianif = staffSchedule[ora] || 0
      const persone = personsBySlot[ora] || 0
      const coperti = copertiBySlot[ora] || 0
      const oreLavorate = useRealHours ? (oreReali > 0 ? oreReali : 0) : orePianif
      const prodOraria = oreLavorate > 0 ? ricavi / oreLavorate : 0
      const copPerDip = persone > 0 ? coperti / persone : 0
      return { ora, ricavi, scontrini, staff: oreLavorate, oreLavorate, oreReali, orePianif, persone, coperti, copPerDip, prodOraria }
    })
    const totOreReali = Object.values(workedHoursBySlot).reduce((s, v) => s + (Number(v) || 0), 0)
    const totOreDay = oreWithProd.reduce((s,o) => s + o.oreLavorate, 0)
    const totIncassoOre = oreWithProd.reduce((s,o) => s + o.ricavi, 0)
    const nDays = trend.length || 1
    const mediaGiorn = totOreDay > 0 ? (totIncassoOre / nDays) / totOreDay : 0

    return <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:'1.25rem'}}>
        <KPI label="Chiusura cassa" icon="" value={data?.fiscalCloseTime || '—'} sub={'Z-'+(data?.zNumber||'—')} accent='#EF4444'/>
        <KPI label="Ultima cucina/pizzeria" icon="" value={data?.lastKitchenTime || '—'} sub="comanda" accent='#F59E0B'/>
        <KPI label="Ultima bar" icon="" value={data?.lastBarTime || '—'} sub="comanda" accent='#3B82F6'/>
        <KPI label="Apertura" icon="" value={data?.firstReceiptTime || '—'} sub="primo scontrino" accent='#10B981'/>
      </div>
      <div style={{...S.card,marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:0,border:'1px solid var(--border)',borderRadius:6,overflow:'hidden'}}>
          <button onClick={()=>setUseRealHours(true)}
            title={`Ore reali dalle timbrature (${(Math.floor(totOreReali*100)/100).toFixed(2)}h tot nel periodo)`}
            style={{padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',border:'none',
              background:useRealHours?'var(--green)':'transparent',color:useRealHours?'var(--surface)':'var(--text2)'}}>
            Reali ({(Math.floor(totOreReali*100)/100).toFixed(2)}h)
          </button>
          <button onClick={()=>setUseRealHours(false)}
            title="Ore pianificate dal calendario staff (tab Personale)"
            style={{padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',border:'none',
              background:!useRealHours?'#F59E0B':'transparent',color:!useRealHours?'var(--surface)':'var(--text2)'}}>
            Pianificate
          </button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:12,color:'var(--text2)'}}>Target €/h:</span>
          <input type="number" value={prodTarget} onChange={e=>setProdTarget(Number(e.target.value))} style={{...iS,width:70,textAlign:'center'}}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:12,color:'#EF4444'}}>Rosso &lt;</span>
          <input type="number" value={sogliaRed} onChange={e=>setSogliaRed(Number(e.target.value))} style={{...iS,width:60,textAlign:'center'}}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:12,color:'#F59E0B'}}>Giallo &lt;</span>
          <input type="number" value={sogliaYel} onChange={e=>setSogliaYel(Number(e.target.value))} style={{...iS,width:60,textAlign:'center'}}/>
        </div>
        <span style={{fontSize:12,color:'#10B981'}}>Verde ≥ {sogliaYel}</span>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:12,color:'var(--text2)'}}>Media giornaliera:</span>
          <span style={{fontSize:18,fontWeight:700,color:prodColor(mediaGiorn)}}>{mediaGiorn > 0 ? mediaGiorn.toFixed(1)+' €/h' : '—'}</span>
          {mediaGiorn > 0 && <span style={{fontSize:11,fontWeight:600,color:prodColor(mediaGiorn)}}>{prodLabel(mediaGiorn)}</span>}
        </div>
      </div>
      <Card title="Produttività oraria" badge={isDemo?'Demo':null}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={oreWithProd.filter(o=>o.ricavi>0)} margin={{top:5,right:20,left:0,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="ora" tick={{fontSize:10,fill:'var(--text3)'}} tickLine={false} axisLine={false}/>
            <YAxis tick={{fontSize:10,fill:'var(--text3)'}} tickFormatter={v=>v+'€'} tickLine={false} axisLine={false} width={42}/>
            <Tooltip formatter={(v,name)=>name==='prodOraria'?v.toFixed(1)+' €/h':fmt(v)} contentStyle={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:12,color:'var(--text)'}} labelStyle={{color:'var(--text2)'}} itemStyle={{color:'var(--text)'}}/>
            <Bar dataKey="ricavi" name="Ricavi" radius={[3,3,0,0]}>
              {oreWithProd.filter(o=>o.ricavi>0).map((o,i)=><Cell key={i} fill={o.staff>0?prodColor(o.prodOraria):'#F59E0B'}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <div style={{marginTop:12}}>
        <Card title="Dettaglio per fascia oraria" badge={useRealHours ? 'ore da timbratura' : 'ore pianificate'}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Ora','Ricavi','Coperti','Cop./dip.','Scontrini','Persone','Ore reali','Ore piano','Ore usate','Prod. oraria','Stato'].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {oreWithProd.filter(o=>o.ricavi>0||o.oreReali>0||o.persone>0||o.coperti>0).map((o,i)=>{
                const pc = prodColor(o.prodOraria)
                const mismatch = o.oreReali > 0 && o.orePianif > 0 && Math.abs(o.oreReali - o.orePianif) > 0.5
                return <tr key={i}>
                  <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{o.ora}</td>
                  <td style={{...S.td,fontWeight:600}}>{fmt(o.ricavi)}</td>
                  <td style={{...S.td,color:o.coperti>0?'#F97316':'var(--text3)',fontWeight:o.coperti>0?700:400}}>{o.coperti>0?o.coperti:'—'}</td>
                  <td style={{...S.td,color:o.copPerDip>0?'#A855F7':'var(--text3)',fontWeight:o.copPerDip>0?700:400}}>{o.copPerDip>0?o.copPerDip.toFixed(1):'—'}</td>
                  <td style={{...S.td,color:'var(--text2)'}}>{o.scontrini}</td>
                  <td style={{...S.td,color:o.persone>0?'#3B82F6':'var(--text3)',fontWeight:o.persone>0?700:400}}>{o.persone>0?o.persone:'—'}</td>
                  <td style={{...S.td,color:o.oreReali>0?'#10B981':'var(--text3)',fontWeight:o.oreReali>0?600:400}}>{o.oreReali>0?o.oreReali.toFixed(2)+'h':'—'}</td>
                  <td style={{...S.td,color:o.orePianif>0?'#F59E0B':'var(--text3)'}}>{o.orePianif>0?o.orePianif+'h':'—'}{mismatch&&<span title="Differenza reale/pianificato" style={{marginLeft:4,color:'#EF4444'}}></span>}</td>
                  <td style={{...S.td,fontWeight:600}}>{o.oreLavorate>0?o.oreLavorate.toFixed(2)+'h':'—'}</td>
                  <td style={{...S.td,fontWeight:700,color:o.oreLavorate>0?pc:'var(--text3)'}}>{o.oreLavorate>0?o.prodOraria.toFixed(1)+' €/h':'—'}</td>
                  <td style={S.td}>{o.oreLavorate>0?<span style={{...S.badge(pc,pc+'22'),fontSize:10}}>{prodLabel(o.prodOraria)}</span>:'—'}</td>
                </tr>
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  }

  // Caso staff senza alcun modulo accessibile: mostra schermata informativa,
  // non renderizzare il contenuto di un tab non autorizzato (default 'ov').
  if (staffPerms && TABS.length === 0) {
    return <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,background:'var(--bg)',color:'var(--text)',fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <div style={{maxWidth:480,textAlign:'center'}}>
        <h2 style={{fontSize:18,fontWeight:600,marginBottom:8}}>Nessun modulo accessibile</h2>
        <p style={{fontSize:14,color:'var(--text2)',lineHeight:1.6,marginBottom:24}}>
          Il tuo datore di lavoro non ti ha ancora assegnato accessi alla dashboard.
          Contattalo per configurare i permessi.
        </p>
        <button onClick={() => supabase.auth.signOut()}
          style={{background:'var(--surface)',border:'1px solid var(--border)',color:'var(--text)',padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13}}>
          Esci
        </button>
      </div>
    </div>
  }

  // Se sono uno staff E il tab corrente non e' nei TABS autorizzati,
  // mostra uno spinner: l'useEffect aggiornera' tab al prossimo tick.
  // Cosi' evito di renderizzare un tab non autorizzato (es. 'ov' di default).
  if (staffPerms && TABS.length > 0 && !ALLOWED_TAB_KEYS.has(tab)) {
    return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)'}}>
      <div style={{width:28,height:28,borderRadius:'50%',border:'2px solid var(--border-md)',borderTopColor:'var(--blue)',animation:'spin .7s linear infinite'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  }

  return <StaffPermsProvider value={staffPerms}><div style={{minHeight:'100vh',background:'var(--bg)',fontFamily:"'DM Sans',system-ui,sans-serif",color:'var(--text)'}}>
    <style>{`
      @keyframes spin{to{transform:rotate(360deg)}}
      tr:hover td{background:var(--surface2)}
    `}</style>

    {/* Header */}
    <div className="cic-header m-compact-x m-wrap" style={{background:'var(--surface)',borderBottom:'1px solid var(--border)',padding:'12px 1.75rem',minHeight:60,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',position:'sticky',top:0,zIndex:100}}>
      <div className="cic-header-left m-wrap" style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <Logo size={32} label/>
        {sps.length>0&&<select value={sp} onChange={e=>setSp(e.target.value)} style={{...iS,paddingLeft:10}}>
          <option value="all">Tutti i locali</option>
          {sps.map(s=><option key={s.id} value={s.id}>{s.description||s.name}</option>)}
        </select>}
      </div>
      <div className="cic-header-right m-wrap" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        {isLive&&<span style={S.badge('#3B82F6','rgba(59,130,246,.12)')} title="Dati live da CiC, non ancora salvati su DB">LIVE</span>}
        {isEmpty&&<span style={S.badge('#94a3b8','rgba(148,163,184,.12)')} title="Nessun dato in questo periodo">VUOTO</span>}
        {(() => {
          const presetKey = customMode ? '' : activePresetKey(from, to)
          const showDates = !presetKey
          return <>
            <select value={presetKey}
              onChange={e=>{
                const v = e.target.value
                if (!v) { setCustomMode(true); return }
                const r = presetRange(v); if (r) { setCustomMode(false); setFrom(r.from); setTo(r.to) }
              }}
              style={{...iS,fontSize:12,paddingLeft:10}}
              title="Preset periodo">
              <option value="">Personalizzato</option>
              {PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            {showDates && <>
              <input type="date" value={from} onChange={e=>{ setCustomMode(true); setFrom(e.target.value) }} style={iS}/>
              <span style={{color:'#2a3042'}}>—</span>
              <input type="date" value={to}   onChange={e=>{ setCustomMode(true); setTo(e.target.value) }}   style={iS}/>
            </>}
          </>
        })()}
        {/* Toggle confronto: discreto bottone "+ Confronta" che apre la selezione periodo confronto */}
        <button
          onClick={() => setCompareEnabled(v => !v)}
          style={{
            ...iS, fontSize: 12, padding: '6px 12px', cursor: 'pointer',
            background: compareEnabled ? 'var(--text)' : 'transparent',
            color: compareEnabled ? 'var(--surface)' : 'var(--text2)',
            border: '1px solid ' + (compareEnabled ? 'var(--text)' : 'var(--border)'),
          }}
          title={compareEnabled ? 'Confronto attivo — clicca per disattivare' : 'Attiva confronto con un altro periodo'}>
          {compareEnabled ? 'Confronto' : '+ Confronta'}
        </button>
        {compareEnabled && (() => {
          // 'prev' = stesso periodo precedente del principale
          const ms = 86400000
          const len = (new Date(to) - new Date(from))/ms + 1
          const expectedTo2 = new Date(new Date(from).getTime() - ms)
          const expectedFrom2 = new Date(expectedTo2.getTime() - (len-1)*ms)
          const isPrev = from2 && to2 && _ymd(expectedFrom2) === from2 && _ymd(expectedTo2) === to2
          const presetKey2 = customMode2 ? '' : (isPrev ? 'prev' : (from2 && to2 ? activePresetKey(from2, to2) : ''))
          const showDates2 = !presetKey2
          return <>
            <span style={{color:'var(--text3)',fontSize:11}}>vs</span>
            <select value={presetKey2}
              onChange={e=>{
                const v = e.target.value
                if (!v) { setCustomMode2(true); return }
                if (v === 'prev') {
                  setCustomMode2(false); setFrom2(_ymd(expectedFrom2)); setTo2(_ymd(expectedTo2))
                } else {
                  const r = presetRange(v); if (r) { setCustomMode2(false); setFrom2(r.from); setTo2(r.to) }
                }
              }}
              style={{...iS,fontSize:11,padding:'4px 8px'}}
              title="Preset periodo confronto">
              <option value="">Personalizzato</option>
              <option value="prev">Periodo precedente</option>
              {PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            {showDates2 && <>
              <input type="date" value={from2} onChange={e=>{ setCustomMode2(true); setFrom2(e.target.value) }} style={{...iS,fontSize:11,padding:'4px 6px',width:120}} title="Confronta dal"/>
              <span style={{color:'var(--text3)'}}>—</span>
              <input type="date" value={to2}   onChange={e=>{ setCustomMode2(true); setTo2(e.target.value) }}   style={{...iS,fontSize:11,padding:'4px 6px',width:120}} title="Confronta al"/>
            </>}
          </>
        })()}
        <button onClick={toggleTheme}
          title={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          aria-label="Cambia tema"
          style={{...iS, color:'var(--text2)', border:'1px solid var(--border)', padding:'6px 10px', cursor:'pointer', minWidth: 36, display:'inline-flex', alignItems:'center', justifyContent:'center'}}>
          <ThemeIcon dark={theme === 'dark'}/>
        </button>
        <button onClick={()=>supabase.auth.signOut()} style={{...iS,color:'var(--text3)',border:'1px solid var(--border)',padding:'6px 12px'}}>Esci</button>
      </div>
    </div>

    {/* Tabs nav */}
    <div className="cic-topbar m-compact-x" style={{background:'var(--surface)',borderBottom:'1px solid var(--border)',padding:'10px 1.75rem',display:'flex',gap:6,overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
      {TABS.map(([t,l])=>(
        <button key={t} onClick={()=>{
          // Click top-level: i sub-tab dei moduli (HRModule, WarehouseModule,
          // MarketingModule, ImpostazioniModule, ContoEconomico, BudgetModule,
          // TaskManager) NON sono persistiti — al rimount partono dal primo
          // sub-tab. Per Vendite/Contabilita' i sub-tab sono in DashboardPage:
          // li resetto manualmente al primo quando l'utente arriva da fuori.
          const inConta = tab === 'conta' || tab === 'ce' || tab === 'bud'
          // Contabilita': primo sub-tab = Conto Economico (hidden top-tab 'ce')
          if (t === 'conta') {
            if (!inConta) { setContaSubTab('fatture'); setTab('ce'); return }
            return // gia' dentro, non cambiare nulla
          }
          // Vendite: primo sub-tab = scontrini
          if (t === 'vendite') {
            if (tab !== 'vendite') { setVendSubTab('scontrini'); setTab('vendite'); return }
            return
          }
          setTab(t)
        }} style={{...tS(t),whiteSpace:'nowrap',flexShrink:0}}>
          {l}
        </button>
      ))}
    </div>

    <div className="m-compact" style={{padding:'1.5rem',maxWidth:1400,margin:'0 auto'}}>
      {error&&<div style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:'12px 16px',fontSize:13,color:'#FCA5A5',marginBottom:'1.5rem'}}>{error}</div>}
      {isEmpty&&<div style={{background:'rgba(148,163,184,.06)',border:'1px solid rgba(148,163,184,.2)',borderRadius:8,padding:'12px 16px',fontSize:13,color: 'var(--text2)',marginBottom:'1.25rem',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <span>Nessun dato in questo periodo. Il sync notturno potrebbe non aver ancora processato queste date.</span>
        <button onClick={forceSync} disabled={syncing} style={{...iS,background:syncing?'#1a1f2e':'#10B981',color:syncing?'#94a3b8':'#0f1420',fontWeight:600,border:'none',padding:'6px 14px',cursor:syncing?'wait':'pointer'}}>{syncing?'Sync in corso…':'Forza sync ora'}</button>
      </div>}
      {isLive&&<div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#60A5FA',marginBottom:'1.25rem'}}>
        Dati live da CiC (non ancora salvati nel DB). Il sync notturno li archivierà automaticamente.
      </div>}

      {loading?<Loader/>:<>

      {/* ── PANORAMICA ── */}
      {tab==='ov'&&<>
        {/* KPI Cards 3x2 — personalizzabili dall'utente (drag&drop + show/hide) */}
        <WidgetGrid tabKey="ov" gridStyle={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}} widgets={[
          { id:'kpi.ricavi', label:'Ricavi totali', element:
              <KPI label="Ricavi totali" icon="" value={fmt(totale)} sub={dRicavi?<span style={{color:dRicavi.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dRicavi.label}</span>:from+' '+to} accent='#F59E0B' trend={dRicavi?.pct}/> },
          { id:'kpi.scontrini', label:'Scontrini', element:
              <KPI label="Scontrini" icon="" value={fmtN(data?.scontrini)} sub={dScontrini?<span style={{color:dScontrini.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dScontrini.label}</span>:'documenti'} accent='#3B82F6' trend={dScontrini?.pct}/> },
          { id:'kpi.medio', label:'Scontrino medio', element:
              <KPI label="Scontrino medio" icon="" value={fmtD(data?.medio)} sub="per documento" accent='#10B981'/> },
          { id:'kpi.coperti', label:'Coperti totali', element:
              <KPI label="Coperti totali" icon="" value={fmtN(coperti)} sub={dCoperti?<span style={{color:dCoperti.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dCoperti.label}</span>:'persone'} accent='#F97316' trend={dCoperti?.pct}/> },
          { id:'kpi.coperto_medio', label:'Coperto medio', element:
              <KPI label="Coperto medio" icon="" value={fmtD(copertoMedio)} sub={dCopertoMedio?<span style={{color:dCopertoMedio.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dCopertoMedio.label}</span>:'incasso / coperto'} accent='#8B5CF6' trend={dCopertoMedio?.pct}/> },
          { id:'kpi.reparti', label:'Reparti attivi', element:
              <KPI label="Reparti attivi" icon="" value={depts.filter(d=>d.profit>0).length} sub="con vendite" accent='#06B6D4'/> },
        ]}/>

        {/* Widget di overview "morning briefing" — full-width, configurabili.
            Personalizzabili come gli altri widget (drag&drop, show/hide). */}
        <WidgetGrid tabKey="ov_full" gridStyle={{display:'grid',gridTemplateColumns:'1fr',gap:12,marginBottom:'1.25rem'}} widgets={[
          { id:'briefing.ieri', label:"Ieri è andata...", element:
              <BriefingIeri sps={sps} sp={sp}/> },
          { id:'briefing.oggi', label:'Oggi cosa mi aspetta', element:
              <BriefingOggi sps={sps} sp={sp}/> },
          { id:'briefing.checklist', label:'Checklist (ieri sera / oggi)', element:
              <ChecklistWidget sps={sps}/> },
          { id:'briefing.task', label:'Task (oggi / settimana)', element:
              <TaskWidget sps={sps}/> },
          { id:'briefing.haccp', label:'HACCP (documenti in scadenza)', element:
              <HaccpScadenzeWidget/> },
          { id:'briefing.produttivita', label:'Produttività oraria (€/h)', element:
              renderProduttivitaCompact() },
          { id:'briefing.attenzione', label:'Attenzione (allarmi)', element:
              <BriefingAttenzione sps={sps} sp={sp}/> },
        ]}/>

        {/* Giorno migliore / peggiore */}
        {trend.length>0&&(()=>{
          const best = trend.reduce((a,b)=>b.ricavi>a.ricavi?b:a, trend[0])
          const worst = trend.filter(t=>t.ricavi>0).reduce((a,b)=>b.ricavi<a.ricavi?b:a, trend.find(t=>t.ricavi>0)||trend[0])
          return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1.25rem'}}>
            <div style={{...S.card,borderLeft:'3px solid #10B981'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#10B981',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Giorno migliore</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:20,fontWeight:700,color: 'var(--text)'}}>{fmt(best.ricavi)}</div>
                  <div style={{fontSize:12,color: 'var(--text2)'}}>{new Date(best.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</div>
                </div>
                {best.coperti>0&&<div style={{textAlign:'right'}}>
                  <div style={{fontSize:14,fontWeight:600,color: 'var(--text)'}}>{fmtN(best.coperti)}</div>
                  <div style={{fontSize:11,color: 'var(--text3)'}}>coperti</div>
                </div>}
              </div>
            </div>
            <div style={{...S.card,borderLeft:'3px solid #EF4444'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#EF4444',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Giorno peggiore</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:20,fontWeight:700,color: 'var(--text)'}}>{fmt(worst.ricavi)}</div>
                  <div style={{fontSize:12,color: 'var(--text2)'}}>{new Date(worst.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</div>
                </div>
                {worst.coperti>0&&<div style={{textAlign:'right'}}>
                  <div style={{fontSize:14,fontWeight:600,color: 'var(--text)'}}>{fmtN(worst.coperti)}</div>
                  <div style={{fontSize:11,color: 'var(--text3)'}}>coperti</div>
                </div>}
              </div>
            </div>
          </div>
        })()}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Card title="Top reparti">
            {depts.filter(d=>d.profit>0).slice(0,5).map((d,i)=><Bar2 key={i} label={d.description} value={d.profit} max={depts[0]?.profit||1} color={C[i%C.length]} pct={totale>0?(d.profit/totale*100).toFixed(1):0}/>)}
          </Card>
          <Card title="Top categorie">
            {cats.slice(0,5).map((c,i)=><Bar2 key={i} label={c.description} value={c.total||0} max={cats[0]?.total||1} color={C[(i+3)%C.length]}/>)}
          </Card>
        </div>
      </>}

      {/* ── VENDITE: wrapper con sotto-tab Scontrini/Categorie/Reparti ── */}
      {tab==='vendite'&&<>
        <SubTabsBar
          tabs={[
            { key: 'scontrini', label: 'Scontrini' },
            { key: 'cat',       label: 'Categorie' },
            { key: 'rep',       label: 'Reparti' },
          ].filter(t => !staffPerms || canAccess(staffPerms, 'vendite.' + t.key, false))}
          value={vendSubTab}
          onChange={setVendSubTab}
        />
      </>}

      {/* ── SCONTRINI (dentro Vendite) ── */}
      {tab==='vendite' && vendSubTab==='scontrini'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Totale" value={fmt(totale)} sub="periodo" accent='#F59E0B'/>
          <KPI label="N° scontrini" value={fmtN(data?.scontrini)} sub="emessi" accent='#3B82F6'/>
          <KPI label="Medio" value={fmtD(data?.medio)} sub="per scontrino" accent='#10B981'/>
        </div>
        <Card title="Lista scontrini" badge={recs.length + ' comande'} extra={
          <input placeholder="Cerca..." value={recSearch} onChange={e=>setRecSearch(e.target.value)} style={{...iS,width:220}}/>
        }>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                {['N°','Data','Apertura','Chiusura','Locale','Tavolo','Cop.','Articoli','Totale'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {recs.filter(r=>!recSearch||r.locale?.toLowerCase().includes(recSearch.toLowerCase())||r.id.includes(recSearch)||(r.tavolo||'').toLowerCase().includes(recSearch.toLowerCase())).slice(0,100).map((r,i)=>(
                  <tr key={i} onClick={()=>setOpenReceipt(r)}
                    style={{...(r.isInvoice?{background:'rgba(139,92,246,.06)'}:{}), cursor:'pointer'}}
                    title="Clicca per vedere il dettaglio comanda">
                    <td style={{...S.td,fontWeight:600,color:r.isInvoice?'#8B5CF6':'#3B82F6'}}>
                      {r.isInvoice && <span style={S.badge('#8B5CF6','rgba(139,92,246,.15)')} title="Fattura emessa">FATT</span>}
                      {' '}{r.id}
                    </td>
                    <td style={S.td}>{r.date}</td>
                    <td style={{...S.td,color:'#10B981',fontWeight:500}}>{r.time||'—'}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{r.chiusura||'—'}</td>
                    <td style={S.td}>{r.locale}</td>
                    <td style={{...S.td,color:'#F59E0B'}}>{r.tavolo||'—'}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{r.coperti||'—'}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{r.items} art.</td>
                    <td style={{...S.td,fontWeight:600,color:r.isInvoice?'#8B5CF6':'#F59E0B'}}>{fmtD(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>}

      {/* ── CATEGORIE ── */}
      {tab==='vendite' && vendSubTab==='cat'&&<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1.25rem'}}>
          <Card title="Venduto per categoria">
            {cats.map((c,i)=><Bar2 key={i} label={c.description} value={c.total||0} max={cats[0]?.total||1} color={C[i%C.length]} pct={totale>0?(c.total/totale*100).toFixed(1):0}/>)}
          </Card>
          <Card title="Distribuzione">
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={cats.slice(0,8)} layout="vertical" margin={{left:120,right:20}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={true} horizontal={false}/>
                <XAxis type="number" tick={{fontSize:10,fill:'#475569'}} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} tickLine={false} axisLine={false}/>
                <YAxis type="category" dataKey="description" tick={{fontSize:11,fill:'#cbd5e1'}} tickLine={false} axisLine={false} width={115}/>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{background: 'var(--surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
                <Bar dataKey="total" name="Ricavi" radius={[0,4,4,0]}>
                  {cats.slice(0,8).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </>}

      {/* ── IVA (nuovo: a debito + a credito + saldo, mensile/trimestrale) ── */}
      {/* ── CONTABILITÀ: wrapper con sotto-tab CE/Budget/Fatture/IVA/Chiusure&Versamenti.
           Visibile anche quando tab=='ce' o tab=='bud' cosi' la nav Contabilita' resta in cima. ── */}
      {(tab==='conta'||tab==='ce'||tab==='bud')&&<>
        <SubTabsBar
          tabs={[
            { key: 'ce',        label: 'Conto Economico' },
            { key: 'bud',       label: 'Budget' },
            { key: 'fatture',   label: 'Fatture' },
            { key: 'iva',       label: 'IVA' },
            { key: 'chiusure',  label: 'Chiusure & Versamenti' },
          ].filter(t => !staffPerms || canAccess(staffPerms, 'conta.' + t.key, false))}
          value={tab==='ce' ? 'ce' : tab==='bud' ? 'bud' : contaSubTab}
          onChange={(v) => {
            if (v === 'ce') { setTab('ce'); return }
            if (v === 'bud') { setTab('bud'); return }
            // Per fatture/iva/chiusure: setta tab=='conta' e contaSubTab
            setTab('conta'); setContaSubTab(v)
          }}
        />
      </>}

      {tab==='conta' && contaSubTab==='iva'&&<IvaTab sp={sp} sps={sps} from={from} to={to}/>}
      {tab==='conta' && contaSubTab==='chiusure'&&<ChiusureView from={from} to={to} sps={sps}/>}

      {/* ── REPARTI ── */}
      {tab==='vendite' && vendSubTab==='rep'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          {depts.filter(d=>d.profit>0).map((d,i)=>(
            <div key={i} style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                <span style={{fontSize:13,fontWeight:600}}>{d.description}</span>
                <div style={{width:8,height:8,borderRadius:'50%',background:C[i%C.length]}}/>
              </div>
              <div style={{fontSize:26,fontWeight:700,marginBottom:4}}>{fmt(d.profit)}</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                <span style={{color: 'var(--text3)'}}>{fmtN(d.qty||0)} pz</span>
                <span style={{color:'#F59E0B',fontWeight:600}}>{totale>0?(d.profit/totale*100).toFixed(1):0}%</span>
              </div>
              <div style={{marginTop:8,height:3,background: 'var(--bg)',borderRadius:2}}>
                <div style={{height:'100%',width:(totale>0?d.profit/totale*100:0)+'%',background:C[i%C.length],borderRadius:2}}/>
              </div>
            </div>
          ))}
        </div>
        <Card title="Confronto reparti">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={depts.filter(d=>d.profit>0)} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={false}/>
              <XAxis dataKey="description" tick={{fontSize:11,fill:'#475569'}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:10,fill:'#475569'}} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} tickLine={false} axisLine={false} width={42}/>
              <Tooltip formatter={v=>fmt(v)} contentStyle={{background: 'var(--surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="profit" name="Ricavi" radius={[4,4,0,0]}>
                {depts.filter(d=>d.profit>0).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </>}


      {false&&(()=>{ return null
        const [monLogs, setMonLogs] = useState([])
        const [monLoading, setMonLoading] = useState(false)
        const [monFilter, setMonFilter] = useState('tutte')
        const [monCookie, setMonCookie] = useState(() => localStorage.getItem('cic_session_cookie') || '')
        const [showMonCookie, setShowMonCookie] = useState(false)

        const loadLogs = async () => {
          if (!monCookie) { setShowMonCookie(true); return }
          setMonLoading(true)
          try {
            const r = await fetch('/api/cic', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'logs', sessionCookie: monCookie, from, to, limit: 500 }) })
            if (r.ok) {
              const d = await r.json()
              setMonLogs(d.records || d.logs || d || [])
              localStorage.setItem('cic_session_cookie', monCookie)
            } else {
              const d = await r.json().catch(() => ({}))
              if (d.needsSession) setShowMonCookie(true)
            }
          } catch {}
          setMonLoading(false)
        }

        useEffect(() => { loadLogs() }, [from, to, monCookie])

        // Classifica ogni log per tipo e severità
        const classifyLog = (log) => {
          const op = (log.operation || log.action || '').toLowerCase()
          const detail = (log.description || log.details || log.message || '')
          if (op.includes('eliminazione ordine') || op.includes('delete order') || op.includes('cancellazione ordine')) {
            const daPagare = detail.toLowerCase().includes('da pagare')
            return { tipo: 'Eliminazione ordine', icon: '', severity: daPagare ? 'high' : 'medium', color: '#EF4444' }
          }
          if (op.includes('eliminazione documento') || op.includes('delete document') || op.includes('cancellazione documento')) {
            return { tipo: 'Eliminazione documento', icon: '', severity: 'high', color: '#EF4444' }
          }
          if (op.includes('sconto') || op.includes('discount')) {
            const match = detail.match(/(\d+)%/)
            const pct = match ? parseInt(match[1]) : 0
            return { tipo: 'Sconto', icon: '', severity: pct > 30 ? 'medium' : 'low', color: '#F59E0B' }
          }
          if (op.includes('spostamento') || op.includes('move') || op.includes('trasferimento')) {
            return { tipo: 'Spostamento', icon: '', severity: 'medium', color: '#3B82F6' }
          }
          if (op.includes('apertura cassetto') || op.includes('open drawer') || op.includes('cassetto')) {
            return { tipo: 'Apertura cassetto', icon: '', severity: 'low', color: 'var(--text3)' }
          }
          return { tipo: log.operation || 'Altro', icon: '', severity: 'low', color: 'var(--text2)' }
        }

        const classified = monLogs.map(log => {
          const cls = classifyLog(log)
          const dt = log.datetime || log.date || ''
          const dateStr = typeof dt === 'string' ? dt.substring(0, 10) : ''
          const timeStr = typeof dt === 'string' && dt.includes('T') ? dt.substring(11, 19) : (typeof dt === 'string' ? dt.substring(11) : '')
          return {
            ...log, ...cls, dateStr, timeStr,
            locale: log.salesPoint?.description || log.salesPoint?.name || log.salespoint || '—',
            utente: log.user?.username || log.user?.name || log.username || log.user || '—',
            dettaglio: log.description || log.details || log.message || '—',
          }
        })

        const filtered = monFilter === 'tutte' ? classified :
          classified.filter(l => l.tipo.toLowerCase().includes(monFilter))

        const counts = { eliminazioni: 0, sconti: 0, spostamenti: 0, cassetto: 0, altro: 0 }
        classified.forEach(l => {
          if (l.tipo.includes('Eliminazione')) counts.eliminazioni++
          else if (l.tipo === 'Sconto') counts.sconti++
          else if (l.tipo === 'Spostamento') counts.spostamenti++
          else if (l.tipo.includes('cassetto')) counts.cassetto++
          else counts.altro++
        })

        const sevColors = { high: { c: '#EF4444', bg: 'rgba(239,68,68,.12)', label: 'Alta' }, medium: { c: '#F59E0B', bg: 'rgba(245,158,11,.12)', label: 'Media' }, low: { c: '#10B981', bg: 'rgba(16,185,129,.12)', label: 'Bassa' } }

        return <>
        {/* Cookie input */}
        {showMonCookie && <div style={{ ...S.card, marginBottom: 12, borderLeft: '3px solid #F59E0B' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Connessione a Cassa in Cloud</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
            Per caricare i monitoring logs serve il cookie di sessione CiC. Apri <a href="https://fo.cassanova.com" target="_blank" style={{ color: '#F59E0B' }}>fo.cassanova.com</a>,
            poi F12 Console digita: <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>document.cookie</code>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={monCookie} onChange={e => setMonCookie(e.target.value)} placeholder="Incolla il cookie..." style={{ ...iS, flex: 1 }} />
            <button onClick={() => { localStorage.setItem('cic_session_cookie', monCookie); setShowMonCookie(false); loadLogs() }} disabled={!monCookie} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Connetti</button>
            <button onClick={() => setShowMonCookie(false)} style={{ ...iS, color: 'var(--text3)', border: '1px solid var(--border)', padding: '6px 12px' }}>Chiudi</button>
          </div>
        </div>}

        {/* KPI */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Totale operazioni" icon="" value={classified.length} sub="nel periodo" accent='#3B82F6'/>
          <KPI label="Eliminazioni" icon="" value={counts.eliminazioni} sub="ordini/documenti" accent='#EF4444'/>
          <KPI label="Sconti" icon="" value={counts.sconti} sub="applicati" accent='#F59E0B'/>
          <KPI label="Spostamenti" icon="" value={counts.spostamenti} sub="ordini/doc" accent='#3B82F6'/>
          <KPI label="Apertura cassetto" icon="" value={counts.cassetto} sub="operazioni" accent='#64748b'/>
        </div>

        {/* Filtri */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { key: 'tutte', label: 'Tutte', count: classified.length, color: '#3B82F6' },
            { key: 'eliminazione', label: 'Eliminazioni', count: counts.eliminazioni, color: '#EF4444' },
            { key: 'sconto', label: 'Sconti', count: counts.sconti, color: '#F59E0B' },
            { key: 'spostamento', label: 'Spostamenti', count: counts.spostamenti, color: '#3B82F6' },
            { key: 'cassetto', label: 'Cassetto', count: counts.cassetto, color: 'var(--text3)' },
          ].map(f => (
            <button key={f.key} onClick={() => setMonFilter(f.key)} style={{ ...iS, padding: '4px 12px', fontSize: 11, fontWeight: monFilter === f.key ? 700 : 400, color: monFilter === f.key ? f.color : '#94a3b8', background: monFilter === f.key ? f.color + '18' : 'transparent', border: monFilter === f.key ? `1px solid ${f.color}` : '1px solid var(--border)' }}>
              {f.label} ({f.count})
            </button>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            <button onClick={loadLogs} style={{ ...iS, background: '#F59E0B', color: 'var(--text)', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>
              {monCookie ? 'Aggiorna' : 'Configura CiC'}
            </button>
          </div>
        </div>

        {/* Tabella */}
        <Card title="Monitoring Log" badge={monLoading ? 'Caricamento...' : filtered.length + ' operazioni'}>
          {monLoading ? <div style={{ textAlign: 'center', padding: 20, color: '#F59E0B', fontSize: 12 }}>Caricamento logs da CiC...</div> :
          classified.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text3)', fontSize: 13 }}>
            {monCookie ? 'Nessuna operazione nel periodo selezionato' : 'Clicca "Configura CiC" per collegare il monitoring log'}
          </div> :
          <div style={{ overflowX: 'auto' }}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Data','Ora','Locale','Utente','Operazione','Dettagli','Severità'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.slice(0, 200).map((l, i) => {
                  const sev = sevColors[l.severity] || sevColors.low
                  return <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: l.severity === 'high' ? 'rgba(239,68,68,.04)' : 'transparent' }}>
                    <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.dateStr}</td>
                    <td style={{ ...S.td, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{l.timeStr}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{l.locale}</td>
                    <td style={{ ...S.td, fontWeight: 500 }}>{l.utente}</td>
                    <td style={S.td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{l.icon}</span>
                        <span style={{ fontWeight: 600, color: l.color }}>{l.tipo}</span>
                      </span>
                    </td>
                    <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12, maxWidth: 400 }}>{l.dettaglio}</td>
                    <td style={S.td}><span style={S.badge(sev.c, sev.bg)}>{sev.label}</span></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>}
        </Card>
        </>
      })()}

      {/* ── FATTURE PASSIVE ── */}
      {tab==='conta' && contaSubTab==='fatture'&&<InvoiceTab sp={sp} sps={sps} from={from} to={to} fatSearch={fatSearch} setFatSearch={setFatSearch}/>}

      {/* vecchio tab fatture rimosso - ora usa InvoiceTab */}
      {false&&(()=>{
        const [cicInvoices, setCicInvoices] = useState([])
        const [fatLoading, setFatLoading] = useState(false)
        const [localeMap, setLocaleMap] = useState({}) // invoiceId -> locale assegnato
        const [expandedFat, setExpandedFat] = useState(null)
        const [xmlContent, setXmlContent] = useState(null)
        const [xmlLoading, setXmlLoading] = useState(false)

        const loadCicInvoices = async () => {
          setFatLoading(true)
          try {
            // Prova fo-services via proxy (richiede sessionCookie)
            // Per ora fetch direttamente se siamo su fo.cassanova.com, altrimenti demo
            const stored = localStorage.getItem('cic_invoice_locales')
            if (stored) try { setLocaleMap(JSON.parse(stored)) } catch {}

            const r = await fetch('/api/invoices', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'list', sessionCookie: document.cookie }) })
            if (r.ok) {
              const d = await r.json()
              setCicInvoices(d.invoices || [])
            }
          } catch {}
          setFatLoading(false)
        }

        const downloadXml = async (inv) => {
          setXmlLoading(true); setXmlContent(null)
          try {
            const r = await fetch('/api/invoices', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'xml', sessionCookie: document.cookie, invoiceId: inv.id, spId: inv.salespoint_id }) })
            if (r.ok) {
              const d = await r.json()
              setXmlContent(d.xml)
            } else {
              setXmlContent('XML non disponibile al momento.')
            }
          } catch { setXmlContent('Errore nel download XML.') }
          setXmlLoading(false)
        }

        const setInvoiceLocale = (invId, locale) => {
          const newMap = { ...localeMap, [invId]: locale }
          setLocaleMap(newMap)
          localStorage.setItem('cic_invoice_locales', JSON.stringify(newMap))
        }

        // Parse XML per estrarre righe
        const parseXmlLines = (xml) => {
          if (!xml || xml.length < 100) return []
          const lines = []
          const lineRegex = /<DettaglioLinee>([\s\S]*?)<\/DettaglioLinee>/g
          let match
          while ((match = lineRegex.exec(xml)) !== null) {
            const block = match[1]
            const get = (tag) => { const m = block.match(new RegExp('<' + tag + '>(.*?)</' + tag + '>')); return m ? m[1] : '' }
            lines.push({ descrizione: get('Descrizione'), quantita: get('Quantita'), um: get('UnitaMisura'), prezzoUnitario: get('PrezzoUnitario'), prezzoTotale: get('PrezzoTotale'), aliquotaIVA: get('AliquotaIVA') })
          }
          return lines
        }

        useEffect(() => { loadCicInvoices() }, [])

        const filtered = cicInvoices.filter(f => {
          if (fatSearch && !f.sender?.name?.toLowerCase().includes(fatSearch.toLowerCase()) && !f.number?.includes(fatSearch)) return false
          return true
        })

        return <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Totale fatture" icon="" value={cicInvoices.length} sub="da CiC" accent='#3B82F6'/>
          <KPI label="Da assegnare" icon="" value={cicInvoices.filter(f=>!localeMap[f.id]||localeMap[f.id]==='Alhena Group').length} sub="senza locale" accent='#F97316'/>
          <KPI label="Assegnate" icon="" value={cicInvoices.filter(f=>localeMap[f.id]&&localeMap[f.id]!=='Alhena Group').length} sub="con locale" accent='#10B981'/>
        </div>
        <Card title="Fatture passive da CiC" badge={fatLoading?'Caricamento...':cicInvoices.length+' fatture'} extra={
          <div style={{display:'flex',gap:8}}>
            <input placeholder="Fornitore / N° doc..." value={fatSearch} onChange={e=>setFatSearch(e.target.value)} style={{...iS,width:200}}/>
            <button onClick={loadCicInvoices} style={{...iS,background:'#F59E0B',color: 'var(--text)',border:'none',padding:'6px 16px',fontWeight:600}}>Aggiorna</button>
          </div>
        }>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                {['','Data','Fornitore','N° Doc','Tipo','Stato','Locale','XML'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {cicInvoices.length===0&&!fatLoading&&<tr><td colSpan={8} style={{...S.td,color: 'var(--text3)',textAlign:'center',padding:20}}>Nessuna fattura. Clicca "Aggiorna" per caricare da CiC. Serve essere loggati su fo.cassanova.com.</td></tr>}
                {filtered.slice(0,50).map((f,i)=><React.Fragment key={f.id||i}>
                  <tr onClick={()=>{setExpandedFat(expandedFat===f.id?null:f.id);if(expandedFat!==f.id){setXmlContent(null)}}} style={{cursor:'pointer',borderBottom:'1px solid #1a1f2e'}}>
                    <td style={{...S.td,width:24,color: 'var(--text3)'}}>{expandedFat===f.id?'':''}</td>
                    <td style={{...S.td,color:'#F59E0B',fontWeight:600}}>{f.date}</td>
                    <td style={{...S.td,fontWeight:500}}>{f.sender?.name||'—'}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{f.number}</td>
                    <td style={S.td}><span style={S.badge('#3B82F6','rgba(59,130,246,.12)')}>{f.doc_type||'TD01'}</span></td>
                    <td style={S.td}><span style={S.badge('#10B981','rgba(16,185,129,.12)')}>{f.current_status?.name||'—'}</span></td>
                    <td style={S.td} onClick={e=>e.stopPropagation()}>
                      <select value={localeMap[f.id]||'Alhena Group'} onChange={e=>setInvoiceLocale(f.id,e.target.value)} style={{...iS,fontSize:11,padding:'3px 6px'}}>
                        <option value="Alhena Group">Alhena Group</option>
                        {sps.map(s=><option key={s.id} value={s.description||s.name}>{s.description||s.name}</option>)}
                      </select>
                    </td>
                    <td style={S.td} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>downloadXml(f)} style={{background:'none',border:'none',color:'#3B82F6',cursor:'pointer',fontSize:11}}>Scarica</button>
                    </td>
                  </tr>
                  {expandedFat===f.id&&<tr><td colSpan={8} style={{padding:'0 14px 12px 38px',background: 'var(--surface2)'}}>
                    {!xmlContent&&!xmlLoading&&<button onClick={()=>downloadXml(f)} style={{...iS,background:'#3B82F6',color:'#fff',border:'none',padding:'6px 14px',fontWeight:600,fontSize:12,marginTop:8}}>Carica dettaglio fattura (XML)</button>}
                    {xmlLoading&&<div style={{padding:12,color:'#F59E0B',fontSize:12}}>Caricamento XML...</div>}
                    {xmlContent&&xmlContent.length>100&&(()=>{
                      const lines = parseXmlLines(xmlContent)
                      return lines.length>0 ? <table style={{width:'100%',borderCollapse:'collapse',marginTop:8}}>
                        <thead><tr>
                          {['Descrizione','Qtà','UM','Prezzo unit.','Prezzo tot.','IVA %'].map(h=><th key={h} style={{...S.th,fontSize:10,padding:'6px 8px'}}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {lines.map((l,j)=><tr key={j}>
                            <td style={{...S.td,fontSize:12,fontWeight:500,padding:'6px 8px'}}>{l.descrizione}</td>
                            <td style={{...S.td,fontSize:12,padding:'6px 8px'}}>{l.quantita}</td>
                            <td style={{...S.td,fontSize:11,color: 'var(--text3)',padding:'6px 8px'}}>{l.um}</td>
                            <td style={{...S.td,fontSize:12,padding:'6px 8px'}}>{l.prezzoUnitario?Number(l.prezzoUnitario).toFixed(2)+'€':''}</td>
                            <td style={{...S.td,fontSize:12,fontWeight:600,padding:'6px 8px'}}>{l.prezzoTotale?Number(l.prezzoTotale).toFixed(2)+'€':''}</td>
                            <td style={{...S.td,fontSize:11,color: 'var(--text2)',padding:'6px 8px'}}>{l.aliquotaIVA}%</td>
                          </tr>)}
                        </tbody>
                      </table> : <div style={{padding:8,fontSize:12,color: 'var(--text2)'}}>XML caricato ma nessuna riga trovata.</div>
                    })()}
                    {xmlContent&&xmlContent.length<=100&&<div style={{padding:8,fontSize:12,color:'#EF4444'}}>{xmlContent}</div>}
                  </td></tr>}
                </React.Fragment>)}
              </tbody>
            </table>
          </div>
        </Card>
      </>})()}

      {/* ── MAGAZZINO ── */}
      {tab==='mag'&&<WarehouseModule sp={sp} sps={sps} from={from} to={to}/>}

      {/* ── PRODUTTIVITÀ ORARIA — vive dentro HRModule sub-tab Produttivita' via renderProduttivita prop. Sotto resta del codice morto da ripulire (lasciato dietro `false &&` per evitare diff massicci, sara' pulito al prossimo refactor). ── */}
      {false&&(()=>{
        const prodColor = v => v < sogliaRed ? '#EF4444' : v < sogliaYel ? '#F59E0B' : '#10B981'
        const prodLabel = v => v < sogliaRed ? 'Sotto soglia' : v < sogliaYel ? 'Attenzione' : 'OK'
        // Ore lavorate per fascia: reali dalle timbrature se useRealHours, altrimenti da staffSchedule pianificato
        // Unione di tutte le ore disponibili da qualunque fonte.
        // Ricavi e scontrini sono aggregati per ora di APERTURA COMANDA (presa ordine),
        // non per ora di chiusura/pagamento — vedi ricaviBySlot/scontriniBySlot sopra.
        // Solo se receipt_details non è disponibile, fallback su hourly_records (chiusura).
        const hourKeys = new Set(ore.map(o => o.ora))
        Object.keys(workedHoursBySlot).forEach(k => hourKeys.add(k))
        Object.keys(staffSchedule).forEach(k => hourKeys.add(k))
        Object.keys(personsBySlot).forEach(k => hourKeys.add(k))
        Object.keys(copertiBySlot).forEach(k => hourKeys.add(k))
        Object.keys(ricaviBySlot).forEach(k => hourKeys.add(k))
        const oreMap = Object.fromEntries(ore.map(o => [o.ora, o]))
        const oreWithProd = [...hourKeys].sort().map(ora => {
          const fallback = oreMap[ora] || { ora, ricavi: 0, scontrini: 0 }
          const ricavi = hasReceiptDetails ? (ricaviBySlot[ora] || 0) : (fallback.ricavi || 0)
          const scontrini = hasReceiptDetails ? (scontriniBySlot[ora] || 0) : (fallback.scontrini || 0)
          const oreReali = workedHoursBySlot[ora] || 0
          const orePianif = staffSchedule[ora] || 0
          const persone = personsBySlot[ora] || 0
          const coperti = copertiBySlot[ora] || 0
          const oreLavorate = useRealHours
            ? (oreReali > 0 ? oreReali : 0)
            : orePianif
          const prodOraria = oreLavorate > 0 ? ricavi / oreLavorate : 0
          const copPerDip = persone > 0 ? coperti / persone : 0
          return { ora, ricavi, scontrini, staff: oreLavorate, oreLavorate, oreReali, orePianif, persone, coperti, copPerDip, prodOraria }
        })
        const totOreReali = Object.values(workedHoursBySlot).reduce((s, v) => s + (Number(v) || 0), 0)
        const totOreDay = oreWithProd.reduce((s,o) => s + o.oreLavorate, 0)
        const totIncassoOre = oreWithProd.reduce((s,o) => s + o.ricavi, 0)
        const mediaGiornaliera = totOreDay > 0 ? totIncassoOre / totOreDay : 0
        // Dividi per n. giorni nel periodo per media giornaliera
        const nDays = trend.length || 1
        const mediaGiorn = totOreDay > 0 ? (totIncassoOre / nDays) / totOreDay : 0

        return <>
        {/* Box informativi */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Chiusura cassa" icon="" value={data?.fiscalCloseTime || '—'} sub={'Z-'+(data?.zNumber||'—')} accent='#EF4444'/>
          <KPI label="Ultima cucina/pizzeria" icon="" value={data?.lastKitchenTime || '—'} sub="comanda" accent='#F59E0B'/>
          <KPI label="Ultima bar" icon="" value={data?.lastBarTime || '—'} sub="comanda" accent='#3B82F6'/>
          <KPI label="Apertura" icon="" value={data?.firstReceiptTime || '—'} sub="primo scontrino" accent='#10B981'/>
        </div>

        {/* Target e soglie */}
        <div style={{...S.card,marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
          {/* Toggle Reale / Pianificato */}
          <div style={{display:'flex',gap:0,border:'1px solid var(--border)',borderRadius:6,overflow:'hidden'}}>
            <button onClick={()=>setUseRealHours(true)}
              title={`Ore reali dalle timbrature (${(Math.floor(totOreReali*100)/100).toFixed(2)}h tot nel periodo)`}
              style={{padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',border:'none',
                background:useRealHours?'#10B981':'transparent',color:useRealHours?'#0f1420':'#94a3b8'}}>
              Reali ({(Math.floor(totOreReali*100)/100).toFixed(2)}h)
            </button>
            <button onClick={()=>setUseRealHours(false)}
              title="Ore pianificate dal calendario staff (tab Personale)"
              style={{padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',border:'none',
                background:!useRealHours?'#F59E0B':'transparent',color:!useRealHours?'#0f1420':'#94a3b8'}}>
              Pianificate
            </button>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color: 'var(--text3)'}}>Target €/h:</span>
            <input type="number" value={prodTarget} onChange={e=>setProdTarget(Number(e.target.value))} style={{...iS,width:70,textAlign:'center'}}/>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'#EF4444'}}>Rosso &lt;</span>
            <input type="number" value={sogliaRed} onChange={e=>setSogliaRed(Number(e.target.value))} style={{...iS,width:60,textAlign:'center'}}/>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'#F59E0B'}}>Giallo &lt;</span>
            <input type="number" value={sogliaYel} onChange={e=>setSogliaYel(Number(e.target.value))} style={{...iS,width:60,textAlign:'center'}}/>
          </div>
          <span style={{fontSize:12,color:'#10B981'}}>Verde ≥ {sogliaYel}</span>
          {/* Media giornaliera */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:12,color: 'var(--text3)'}}>Media giornaliera:</span>
            <span style={{fontSize:18,fontWeight:700,color:prodColor(mediaGiorn)}}>{mediaGiorn > 0 ? mediaGiorn.toFixed(1)+' €/h' : '—'}</span>
            {mediaGiorn > 0 && <span style={{fontSize:11,fontWeight:600,color:prodColor(mediaGiorn)}}>{prodLabel(mediaGiorn)}</span>}
          </div>
        </div>

        {/* Grafico */}
        <Card title="Produttività oraria" badge={isDemo?'Demo':null}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={oreWithProd.filter(o=>o.ricavi>0)} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={false}/>
              <XAxis dataKey="ora" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:10,fill:'#475569'}} tickFormatter={v=>v+'€'} tickLine={false} axisLine={false} width={42}/>
              <Tooltip formatter={(v,name)=>name==='prodOraria'?v.toFixed(1)+' €/h':fmt(v)} contentStyle={{background: 'var(--surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:12,color: 'var(--text)'}} labelStyle={{color: 'var(--text2)'}} itemStyle={{color: 'var(--text)'}}/>
              <Bar dataKey="ricavi" name="Ricavi" radius={[3,3,0,0]}>
                {oreWithProd.filter(o=>o.ricavi>0).map((o,i)=><Cell key={i} fill={o.staff>0?prodColor(o.prodOraria):'#F59E0B'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Tabella dettaglio */}
        <div style={{marginTop:12}}>
          <Card title="Dettaglio per fascia oraria" badge={useRealHours ? 'ore da timbratura' : 'ore pianificate'}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Ora','Ricavi','Coperti','Cop./dip.','Scontrini','Persone','Ore reali','Ore piano','Ore usate','Prod. oraria','Stato'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {oreWithProd.filter(o=>o.ricavi>0||o.oreReali>0||o.persone>0||o.coperti>0).map((o,i)=>{
                  const pc = prodColor(o.prodOraria)
                  const mismatch = o.oreReali > 0 && o.orePianif > 0 && Math.abs(o.oreReali - o.orePianif) > 0.5
                  return <tr key={i}>
                    <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{o.ora}</td>
                    <td style={{...S.td,fontWeight:600}}>{fmt(o.ricavi)}</td>
                    <td style={{...S.td,color:o.coperti>0?'#F97316':'#475569',fontWeight:o.coperti>0?700:400}} title={o.coperti>0?`${o.coperti} coperti serviti nella fascia`:''}>{o.coperti>0?o.coperti:'—'}</td>
                    <td style={{...S.td,color:o.copPerDip>0?'#A855F7':'#475569',fontWeight:o.copPerDip>0?700:400}} title={o.copPerDip>0?`${o.coperti} coperti / ${o.persone} dipendente${o.persone===1?'':'i'} = ${o.copPerDip.toFixed(1)} coperti per dipendente`:'Serve sia coperti che timbrature'}>{o.copPerDip>0?o.copPerDip.toFixed(1):'—'}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{o.scontrini}</td>
                    <td style={{...S.td,color:o.persone>0?'#3B82F6':'#475569',fontWeight:o.persone>0?700:400}} title={o.persone>0?`${o.persone} dipendent${o.persone===1?'e':'i'} in turno (almeno parziale) nella fascia`:''}>{o.persone>0?o.persone:'—'}</td>
                    <td style={{...S.td,color:o.oreReali>0?'#10B981':'#475569',fontWeight:o.oreReali>0?600:400}}>{o.oreReali>0?o.oreReali.toFixed(2)+'h':'—'}</td>
                    <td style={{...S.td,color:o.orePianif>0?'#F59E0B':'#475569'}}>{o.orePianif>0?o.orePianif+'h':'—'}{mismatch&&<span title="Differenza reale/pianificato" style={{marginLeft:4,color:'#EF4444'}}></span>}</td>
                    <td style={{...S.td,fontWeight:600}}>{o.oreLavorate>0?o.oreLavorate.toFixed(2)+'h':'—'}</td>
                    <td style={{...S.td,fontWeight:700,color:o.oreLavorate>0?pc:'#475569'}}>{o.oreLavorate>0?o.prodOraria.toFixed(1)+' €/h':'—'}</td>
                    <td style={S.td}>{o.oreLavorate>0?<span style={{...S.badge(pc,pc+'22'),fontSize:10}}>{prodLabel(o.prodOraria)}</span>:'—'}</td>
                  </tr>
                })}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Lista comande */}
        {(data?.receiptDetails||[]).length>0&&<div style={{marginTop:12}}>
          <Card title="Comande del periodo" badge={fmtN((data?.receiptDetails||[]).length)+' comande'}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                {['','Tavolo','Aperta','Chiusa','Coperti','Totale','Articoli','Reparto'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(data?.receiptDetails||[]).map((r,i)=><>
                  <tr key={i} onClick={()=>setExpandedReceipt(expandedReceipt===i?null:i)} style={{cursor:'pointer',borderBottom:'1px solid #1a1f2e'}}>
                    <td style={{...S.td,width:24,color: 'var(--text3)'}}>{expandedReceipt===i?'':''}</td>
                    <td style={{...S.td,fontWeight:600,color: 'var(--text)'}}>{r.tavolo||'—'}</td>
                    <td style={{...S.td,fontWeight:600,color:'#10B981'}}>{r.aperturaComanda||r.ora}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{r.chiusuraComanda||r.ora}</td>
                    <td style={{...S.td,color:'#F59E0B',fontWeight:600}}>{r.coperti||'—'}</td>
                    <td style={{...S.td,fontWeight:600}}>{fmt(r.totale)}</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{r.items?.length||0} art.</td>
                    <td style={{...S.td,color: 'var(--text2)'}}>{[...new Set(r.items?.map(it=>it.reparto).filter(Boolean))].join(', ')||'—'}</td>
                  </tr>
                  {expandedReceipt===i&&<tr key={'d'+i}><td colSpan={8} style={{padding:'0 14px 12px 38px',background: 'var(--surface2)'}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead><tr>
                        {['Prodotto','Qtà','Prezzo','Reparto'].map(h=><th key={h} style={{...S.th,fontSize:10,padding:'6px 10px'}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {(r.items||[]).map((it,j)=><tr key={j}>
                          <td style={{...S.td,fontSize:12,fontWeight:500,padding:'6px 10px'}}>{it.nome}</td>
                          <td style={{...S.td,fontSize:12,color: 'var(--text2)',padding:'6px 10px'}}>{it.qty}x</td>
                          <td style={{...S.td,fontSize:12,fontWeight:500,padding:'6px 10px'}}>{fmt(it.prezzo)}</td>
                          <td style={{...S.td,fontSize:11,color: 'var(--text3)',padding:'6px 10px'}}>{it.reparto||'—'}</td>
                        </tr>)}
                      </tbody>
                    </table>
                  </td></tr>}
                </>)}
              </tbody>
            </table>
          </Card>
        </div>}
      </>})()}

      {/* ── CONTO ECONOMICO ── */}
      {tab==='ce'&&<ContoEconomico ce={ce} from={from} to={to} reload={load} setPeriod={(f,t)=>{ setCustomMode(true); setFrom(f); setTo(t) }}/>}

      {tab==='bud'&&<BudgetModule sp={sp} sps={sps} from={from} to={to}/>}

      {/* ── PERSONALE ── */}
      {tab==='hr'&&<HRModule staffSchedule={staffSchedule} setStaffSchedule={setStaffSchedule} saveSchedule={saveSchedule} sp={sp} sps={sps} renderProduttivita={renderProduttivita}/>}

      {/* ── MARKETING / CRM ── */}
      {tab==='mkt'&&<MarketingModule sp={sp} sps={sps}/>}

      {/* ── HACCP ── */}
      {tab==='haccp'&&<HaccpModule sps={sps} sp={sp}/>}

      {/* ── AVVISI ── */}
      {tab==='avvisi'&&<AvvisiModule/>}

      {/* ── IMPOSTAZIONI ── */}
      {tab==='imp'&&<ImpostazioniModule settings={settings} sps={sps}/>}

      </>}
    </div>

    {showDailyReport && <DailyReportSettings onClose={()=>setShowDailyReport(false)}/>}
    {openReceipt && <ReceiptDetailModal receipt={openReceipt} onClose={()=>setOpenReceipt(null)}/>}
  </div></StaffPermsProvider>
}
