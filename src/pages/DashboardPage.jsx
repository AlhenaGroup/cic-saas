import { useState, useEffect, useCallback } from 'react'
import { ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { getToken, getSalesPoints, getReportData, getFromDailyStats } from '../lib/cicApi'
import { fmt, fmtD, fmtN, pct, today, monthStart, prevPeriod, deltaFmt, C, S, KPI, Card, Bar2, Tip, Loader } from '../components/shared/styles.jsx'
import HRModule from './HRModule'
import WarehouseModule from './WarehouseModule'
import MarketingModule from './MarketingModule'
import BudgetModule from './BudgetModule'
import InvoiceTab from '../components/InvoiceTab'
import ContoEconomico from '../components/ContoEconomico'
import MonitoringTab from '../components/MonitoringTab'

export default function DashboardPage({ settings }) {
  const [token, setToken]         = useState(null)
  const [from,  setFrom]          = useState(() => localStorage.getItem('cic_from') || monthStart())
  const [to,    setTo]            = useState(() => localStorage.getItem('cic_to') || today())
  const [sp,    setSp]            = useState(() => localStorage.getItem('cic_sp') || 'all')
  const [sps,   setSps]           = useState(() => {
    const raw = Array.isArray(settings?.sales_points) ? settings.sales_points : []
    // Rinomina FIORIO → BIANCOLATTE
    return raw.map(s => ({...s, description: s.description === 'FIORIO' ? 'BIANCOLATTE' : s.description, name: s.name === 'FIORIO' ? 'BIANCOLATTE' : s.name }))
  })
  const [data,  setData]          = useState(null)
  const [loading,setLoading]      = useState(true)
  const [error,  setError]        = useState('')
  const [tab,    setTab]          = useState(() => localStorage.getItem('cic_tab') || 'ov')
  const [recSearch,setRecSearch]  = useState('')
  const [fatSearch,setFatSearch]  = useState('')
  const [fatFilter,setFatFilter]  = useState('all')
  const [prodRep,setProdRep]      = useState('tutti')
  // Confronto periodo
  const [from2, setFrom2]         = useState(() => localStorage.getItem('cic_from2') || '')
  const [to2,   setTo2]           = useState(() => localStorage.getItem('cic_to2') || '')
  const [prevData, setPrevData]   = useState(null)
  // Staff per fascia oraria (da Supabase)
  const [staffSchedule, setStaffSchedule] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cic_staff_schedule') || '{}') } catch { return {} }
  })
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
      // Carica dati periodo di confronto
      const pp = (from2 && to2) ? { from: from2, to: to2 } : prevPeriod(from, to)
      if (!from2) setFrom2(pp.from)
      if (!to2) setTo2(pp.to)
      try {
        const pd = await getFromDailyStats(pp.from, pp.to, spf)
        setPrevData(pd)
      } catch { setPrevData(null) }
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  },[token,from,to,sp,sps,from2,to2])
  useEffect(()=>{load()},[load])

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
  const susp   = data?.suspicious||[]
  const fat    = data?.fatture||[]
  const ce     = data?.ce||{}
  const isDemo = data?.isDemo===true

  // ─── Marketing tasks urgent badge ────────────────────────────────────────
  const [mktUrgentCount, setMktUrgentCount] = useState(0)
  const loadMktBadge = useCallback(async () => {
    try {
      const today = new Date()
      const tomorrow = new Date(today.getTime() + 86400000)
      const tomorrowStr = tomorrow.toISOString().slice(0, 10)
      const { count } = await supabase
        .from('marketing_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('stato', 'open')
        .not('scadenza', 'is', null)
        .lte('scadenza', tomorrowStr)
      setMktUrgentCount(count || 0)
    } catch { /* tabella non ancora presente: fallback silenzioso */ }
  }, [])
  useEffect(() => { loadMktBadge() }, [loadMktBadge])
  // Refresh del badge quando si torna sulla tab marketing o si lascia la tab
  useEffect(() => { if (tab === 'mkt' || tab === 'ov') loadMktBadge() }, [tab, loadMktBadge])

  const iS = S.input
  const tS = (t) => ({padding:'8px 16px',borderRadius:6,fontSize:13,fontWeight:500,cursor:'pointer',border:'none',
    background:tab===t?'#F59E0B':'transparent',color:tab===t?'#0f1420':'#64748b',transition:'all .2s',position:'relative'})

  const TABS=[['ov','📊 Panoramica'],['scontrini','🧾 Scontrini'],['cat','🏷️ Categorie'],
              ['iva','📋 IVA'],['rep','🏪 Reparti'],['susp','⚠️ Movimenti'],
              ['fat','📄 Fatture'],['mag','📦 Magazzino'],['prod','⏱️ Produttività'],['ce','📊 Conto Econ.'],['bud','💰 Budget'],['hr','👥 Personale'],['mkt','📣 Marketing']]

  return <div style={{minHeight:'100vh',background:'#0f1420',fontFamily:"'DM Sans',system-ui,sans-serif",color:'#e2e8f0'}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
      @keyframes spin{to{transform:rotate(360deg)}}
      *{box-sizing:border-box} input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.4)}
      select option{background:#1a1f2e} ::-webkit-scrollbar{width:5px;height:5px}
      ::-webkit-scrollbar-track{background:#0f1420} ::-webkit-scrollbar-thumb{background:#2a3042;border-radius:3px}
      tr:hover td{background:#1e2636!important}
    `}</style>

    {/* Header */}
    <div style={{background:'#131825',borderBottom:'1px solid #1e2636',padding:'0 1.5rem',height:56,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:100}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:28,height:28,background:'#F59E0B',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#0f1420',fontSize:13}}>C</div>
        <span style={{fontSize:15,fontWeight:700,letterSpacing:'-0.01em'}}>CIC Analytics</span>
        {sps.length>0&&<select value={sp} onChange={e=>setSp(e.target.value)} style={{...iS,paddingLeft:10}}>
          <option value="all">📍 Tutti i locali</option>
          {sps.map(s=><option key={s.id} value={s.id}>{s.description||s.name}</option>)}
        </select>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        {isDemo&&<span style={S.badge('#F59E0B','rgba(245,158,11,.12)')}>DEMO</span>}
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={iS}/>
        <span style={{color:'#2a3042'}}>—</span>
        <input type="date" value={to}   onChange={e=>setTo(e.target.value)}   style={iS}/>
        <span style={{color:'#475569',fontSize:11,marginLeft:8}}>vs</span>
        <input type="date" value={from2} onChange={e=>setFrom2(e.target.value)} style={{...iS,fontSize:11,padding:'4px 6px',width:120}} title="Confronta dal"/>
        <span style={{color:'#2a3042'}}>—</span>
        <input type="date" value={to2}   onChange={e=>setTo2(e.target.value)}   style={{...iS,fontSize:11,padding:'4px 6px',width:120}} title="Confronta al"/>
        <button onClick={load} style={{...iS,background:'#F59E0B',color:'#0f1420',fontWeight:600,border:'none',padding:'6px 16px'}}>Aggiorna</button>
        <button onClick={()=>supabase.auth.signOut()} style={{...iS,color:'#475569',border:'1px solid #2a3042',padding:'6px 12px'}}>Esci</button>
      </div>
    </div>

    {/* Tabs nav */}
    <div style={{background:'#131825',borderBottom:'1px solid #1e2636',padding:'0 1.5rem',display:'flex',gap:2,overflowX:'auto'}}>
      {TABS.map(([t,l])=>(
        <button key={t} onClick={()=>setTab(t)} style={tS(t)}>
          {l}
          {t==='mkt'&&mktUrgentCount>0&&<span style={{
            marginLeft:6,background:'#EF4444',color:'#fff',borderRadius:10,
            padding:'1px 7px',fontSize:10,fontWeight:700,verticalAlign:'middle'
          }}>{mktUrgentCount}</span>}
        </button>
      ))}
    </div>

    <div style={{padding:'1.5rem',maxWidth:1400,margin:'0 auto'}}>
      {error&&<div style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:'12px 16px',fontSize:13,color:'#FCA5A5',marginBottom:'1.5rem'}}>{error}</div>}
      {isDemo&&<div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.15)',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#D97706',marginBottom:'1.25rem'}}>
        ⚡ Modalità demo — dati simulati. Quando CiC abilita l'API, si aggiornano automaticamente.
      </div>}

      {loading?<Loader/>:<>

      {/* ── PANORAMICA ── */}
      {tab==='ov'&&<>
        {/* KPI Cards 3x2 */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Ricavi totali" icon="💶" value={fmt(totale)} sub={dRicavi?<span style={{color:dRicavi.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dRicavi.label}</span>:from+' → '+to} accent='#F59E0B' trend={dRicavi?.pct}/>
          <KPI label="Scontrini" icon="🧾" value={fmtN(data?.scontrini)} sub={dScontrini?<span style={{color:dScontrini.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dScontrini.label}</span>:'documenti'} accent='#3B82F6' trend={dScontrini?.pct}/>
          <KPI label="Scontrino medio" icon="📈" value={fmtD(data?.medio)} sub="per documento" accent='#10B981'/>
          <KPI label="Coperti totali" icon="🍽️" value={fmtN(coperti)} sub={dCoperti?<span style={{color:dCoperti.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dCoperti.label}</span>:'persone'} accent='#F97316' trend={dCoperti?.pct}/>
          <KPI label="Coperto medio" icon="💰" value={fmtD(copertoMedio)} sub={dCopertoMedio?<span style={{color:dCopertoMedio.positive?'#10B981':'#EF4444',fontSize:11,fontWeight:600}}>{dCopertoMedio.label}</span>:'incasso / coperto'} accent='#8B5CF6' trend={dCopertoMedio?.pct}/>
          <KPI label="Reparti attivi" icon="🏷️" value={depts.filter(d=>d.profit>0).length} sub="con vendite" accent='#06B6D4'/>
        </div>

        {/* Giorno migliore / peggiore */}
        {trend.length>0&&(()=>{
          const best = trend.reduce((a,b)=>b.ricavi>a.ricavi?b:a, trend[0])
          const worst = trend.filter(t=>t.ricavi>0).reduce((a,b)=>b.ricavi<a.ricavi?b:a, trend.find(t=>t.ricavi>0)||trend[0])
          return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1.25rem'}}>
            <div style={{...S.card,borderLeft:'3px solid #10B981'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#10B981',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Giorno migliore</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:20,fontWeight:700,color:'#f1f5f9'}}>{fmt(best.ricavi)}</div>
                  <div style={{fontSize:12,color:'#94a3b8'}}>{new Date(best.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</div>
                </div>
                {best.coperti>0&&<div style={{textAlign:'right'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#cbd5e1'}}>{fmtN(best.coperti)}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>coperti</div>
                </div>}
              </div>
            </div>
            <div style={{...S.card,borderLeft:'3px solid #EF4444'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#EF4444',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Giorno peggiore</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:20,fontWeight:700,color:'#f1f5f9'}}>{fmt(worst.ricavi)}</div>
                  <div style={{fontSize:12,color:'#94a3b8'}}>{new Date(worst.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</div>
                </div>
                {worst.coperti>0&&<div style={{textAlign:'right'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#cbd5e1'}}>{fmtN(worst.coperti)}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>coperti</div>
                </div>}
              </div>
            </div>
          </div>
        })()}

        {/* Grafico trend ricavi + coperti */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:12,marginBottom:12}}>
          <Card title="Andamento ricavi e coperti" badge={isDemo?'Demo':null}>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={trend} margin={{top:5,right:10,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={false}/>
                <XAxis dataKey="label" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} interval={Math.max(1,Math.floor(trend.length/7))}/>
                <YAxis yAxisId="left" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} width={38}/>
                <YAxis yAxisId="right" orientation="right" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} width={30}/>
                <Tooltip content={<Tip/>}/>
                <Bar yAxisId="right" dataKey="coperti" fill="rgba(249,115,22,.3)" name="coperti" radius={[2,2,0,0]}/>
                <Line yAxisId="left" type="monotone" dataKey="ricavi" stroke="#F59E0B" strokeWidth={2} dot={false} name="ricavi"/>
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Ripartizione reparti">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={depts.filter(d=>d.profit>0)} dataKey="profit" nameKey="description" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {depts.filter(d=>d.profit>0).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                </Pie>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12}}/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Card title="Top reparti">
            {depts.filter(d=>d.profit>0).slice(0,5).map((d,i)=><Bar2 key={i} label={d.description} value={d.profit} max={depts[0]?.profit||1} color={C[i%C.length]} pct={totale>0?(d.profit/totale*100).toFixed(1):0}/>)}
          </Card>
          <Card title="Top categorie">
            {cats.slice(0,5).map((c,i)=><Bar2 key={i} label={c.description} value={c.total||0} max={cats[0]?.total||1} color={C[(i+3)%C.length]}/>)}
          </Card>
        </div>
      </>}

      {/* ── SCONTRINI ── */}
      {tab==='scontrini'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Totale" value={fmt(totale)} sub="periodo" accent='#F59E0B'/>
          <KPI label="N° scontrini" value={fmtN(data?.scontrini)} sub="emessi" accent='#3B82F6'/>
          <KPI label="Medio" value={fmtD(data?.medio)} sub="per scontrino" accent='#10B981'/>
        </div>
        <Card title="Lista scontrini" badge={recs.length + ' comande'} extra={
          <input placeholder="🔍 Cerca..." value={recSearch} onChange={e=>setRecSearch(e.target.value)} style={{...iS,width:220}}/>
        }>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['N°','Data','Apertura','Chiusura','Locale','Tavolo','Cop.','Articoli','Totale'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {recs.filter(r=>!recSearch||r.locale?.toLowerCase().includes(recSearch.toLowerCase())||r.id.includes(recSearch)||(r.tavolo||'').toLowerCase().includes(recSearch.toLowerCase())).slice(0,100).map((r,i)=>(
                  <tr key={i}>
                    <td style={{...S.td,color:'#475569',fontWeight:600}}>{r.id}</td>
                    <td style={S.td}>{r.date}</td>
                    <td style={{...S.td,color:'#10B981',fontWeight:500}}>{r.time||'—'}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.chiusura||'—'}</td>
                    <td style={S.td}>{r.locale}</td>
                    <td style={{...S.td,color:'#F59E0B'}}>{r.tavolo||'—'}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.coperti||'—'}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.items} art.</td>
                    <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{fmtD(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>}

      {/* ── CATEGORIE ── */}
      {tab==='cat'&&<>
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
                <Tooltip formatter={v=>fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12}}/>
                <Bar dataKey="total" name="Ricavi" radius={[0,4,4,0]}>
                  {cats.slice(0,8).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </>}

      {/* ── IVA ── */}
      {tab==='iva'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          {taxes.map((t,i)=>{
            const lordo=(t.taxable||0)+(t.tax_amount||0)
            return <div key={i} style={S.card}>
              <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Aliquota IVA {t.rate}%</div>
              <div style={{fontSize:26,fontWeight:700,color:'#f1f5f9',marginBottom:4}}>{fmt(t.taxable)}</div>
              <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>Imponibile</div>
              <div style={{height:1,background:'#2a3042',marginBottom:12}}/>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                <span style={{color:'#64748b'}}>IVA</span><span style={{color:'#EF4444',fontWeight:600}}>{fmt(t.tax_amount)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}>
                <span style={{color:'#94a3b8'}}>Totale lordo</span><span style={{color:'#F59E0B',fontWeight:700}}>{fmt(lordo)}</span>
              </div>
            </div>
          })}
        </div>
        <Card title="Riepilogo IVA completo">
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
              {['Aliquota','Imponibile','IVA','Totale lordo','% sul totale'].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {taxes.map((t,i)=>{const l=(t.taxable||0)+(t.tax_amount||0);return(
                <tr key={i}><td style={S.td}><span style={S.badge('#F59E0B','rgba(245,158,11,.15)')}>{t.rate}%</span></td>
                  <td style={S.td}>{fmt(t.taxable)}</td>
                  <td style={{...S.td,color:'#EF4444'}}>{fmt(t.tax_amount)}</td>
                  <td style={{...S.td,fontWeight:600}}>{fmt(l)}</td>
                  <td style={{...S.td,color:'#64748b'}}>{pct(l,totale)}</td>
                </tr>
              )})}
            </tbody>
            <tfoot><tr style={{borderTop:'2px solid #2a3042',background:'#131825'}}>
              <td style={{...S.td,fontWeight:700}}>Totale</td>
              <td style={{...S.td,fontWeight:600}}>{fmt(taxes.reduce((s,t)=>s+(t.taxable||0),0))}</td>
              <td style={{...S.td,fontWeight:600,color:'#EF4444'}}>{fmt(taxes.reduce((s,t)=>s+(t.tax_amount||0),0))}</td>
              <td style={{...S.td,fontWeight:700,color:'#F59E0B',fontSize:14}}>{fmt(totale)}</td>
              <td style={{...S.td,fontWeight:600}}>100%</td>
            </tr></tfoot>
          </table>
        </Card>
      </>}

      {/* ── REPARTI ── */}
      {tab==='rep'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          {depts.filter(d=>d.profit>0).map((d,i)=>(
            <div key={i} style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                <span style={{fontSize:13,fontWeight:600}}>{d.description}</span>
                <div style={{width:8,height:8,borderRadius:'50%',background:C[i%C.length]}}/>
              </div>
              <div style={{fontSize:26,fontWeight:700,marginBottom:4}}>{fmt(d.profit)}</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                <span style={{color:'#64748b'}}>{fmtN(d.qty||0)} pz</span>
                <span style={{color:'#F59E0B',fontWeight:600}}>{totale>0?(d.profit/totale*100).toFixed(1):0}%</span>
              </div>
              <div style={{marginTop:8,height:3,background:'#0f1420',borderRadius:2}}>
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
              <Tooltip formatter={v=>fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="profit" name="Ricavi" radius={[4,4,0,0]}>
                {depts.filter(d=>d.profit>0).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </>}

      {/* ── MOVIMENTI / MONITORING LOG ── */}
      {tab==='susp'&&<MonitoringTab events={data?.monitoringEvents||[]}/>}

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
            return { tipo: 'Eliminazione ordine', icon: '🗑️', severity: daPagare ? 'high' : 'medium', color: '#EF4444' }
          }
          if (op.includes('eliminazione documento') || op.includes('delete document') || op.includes('cancellazione documento')) {
            return { tipo: 'Eliminazione documento', icon: '📄', severity: 'high', color: '#EF4444' }
          }
          if (op.includes('sconto') || op.includes('discount')) {
            const match = detail.match(/(\d+)%/)
            const pct = match ? parseInt(match[1]) : 0
            return { tipo: 'Sconto', icon: '🏷️', severity: pct > 30 ? 'medium' : 'low', color: '#F59E0B' }
          }
          if (op.includes('spostamento') || op.includes('move') || op.includes('trasferimento')) {
            return { tipo: 'Spostamento', icon: '↔️', severity: 'medium', color: '#3B82F6' }
          }
          if (op.includes('apertura cassetto') || op.includes('open drawer') || op.includes('cassetto')) {
            return { tipo: 'Apertura cassetto', icon: '🗃️', severity: 'low', color: '#64748b' }
          }
          return { tipo: log.operation || 'Altro', icon: '📋', severity: 'low', color: '#94a3b8' }
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>Connessione a Cassa in Cloud</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
            Per caricare i monitoring logs serve il cookie di sessione CiC. Apri <a href="https://fo.cassanova.com" target="_blank" style={{ color: '#F59E0B' }}>fo.cassanova.com</a>,
            poi F12 → Console → digita: <code style={{ background: '#0f1420', padding: '2px 6px', borderRadius: 4 }}>document.cookie</code>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={monCookie} onChange={e => setMonCookie(e.target.value)} placeholder="Incolla il cookie..." style={{ ...iS, flex: 1 }} />
            <button onClick={() => { localStorage.setItem('cic_session_cookie', monCookie); setShowMonCookie(false); loadLogs() }} disabled={!monCookie} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Connetti</button>
            <button onClick={() => setShowMonCookie(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Chiudi</button>
          </div>
        </div>}

        {/* KPI */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Totale operazioni" icon="📋" value={classified.length} sub="nel periodo" accent='#3B82F6'/>
          <KPI label="Eliminazioni" icon="🗑️" value={counts.eliminazioni} sub="ordini/documenti" accent='#EF4444'/>
          <KPI label="Sconti" icon="🏷️" value={counts.sconti} sub="applicati" accent='#F59E0B'/>
          <KPI label="Spostamenti" icon="↔️" value={counts.spostamenti} sub="ordini/doc" accent='#3B82F6'/>
          <KPI label="Apertura cassetto" icon="🗃️" value={counts.cassetto} sub="operazioni" accent='#64748b'/>
        </div>

        {/* Filtri */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { key: 'tutte', label: 'Tutte', count: classified.length, color: '#3B82F6' },
            { key: 'eliminazione', label: '🗑️ Eliminazioni', count: counts.eliminazioni, color: '#EF4444' },
            { key: 'sconto', label: '🏷️ Sconti', count: counts.sconti, color: '#F59E0B' },
            { key: 'spostamento', label: '↔️ Spostamenti', count: counts.spostamenti, color: '#3B82F6' },
            { key: 'cassetto', label: '🗃️ Cassetto', count: counts.cassetto, color: '#64748b' },
          ].map(f => (
            <button key={f.key} onClick={() => setMonFilter(f.key)} style={{ ...iS, padding: '4px 12px', fontSize: 11, fontWeight: monFilter === f.key ? 700 : 400, color: monFilter === f.key ? f.color : '#94a3b8', background: monFilter === f.key ? f.color + '18' : 'transparent', border: monFilter === f.key ? `1px solid ${f.color}` : '1px solid #2a3042' }}>
              {f.label} ({f.count})
            </button>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            <button onClick={loadLogs} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>
              {monCookie ? '🔄 Aggiorna' : '⚙️ Configura CiC'}
            </button>
          </div>
        </div>

        {/* Tabella */}
        <Card title="Monitoring Log" badge={monLoading ? 'Caricamento...' : filtered.length + ' operazioni'}>
          {monLoading ? <div style={{ textAlign: 'center', padding: 20, color: '#F59E0B', fontSize: 12 }}>Caricamento logs da CiC...</div> :
          classified.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: '#475569', fontSize: 13 }}>
            {monCookie ? 'Nessuna operazione nel periodo selezionato' : 'Clicca "Configura CiC" per collegare il monitoring log'}
          </div> :
          <div style={{ overflowX: 'auto' }}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['Data','Ora','Locale','Utente','Operazione','Dettagli','Severità'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.slice(0, 200).map((l, i) => {
                  const sev = sevColors[l.severity] || sevColors.low
                  return <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: l.severity === 'high' ? 'rgba(239,68,68,.04)' : 'transparent' }}>
                    <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.dateStr}</td>
                    <td style={{ ...S.td, color: '#94a3b8', whiteSpace: 'nowrap' }}>{l.timeStr}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{l.locale}</td>
                    <td style={{ ...S.td, fontWeight: 500 }}>{l.utente}</td>
                    <td style={S.td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{l.icon}</span>
                        <span style={{ fontWeight: 600, color: l.color }}>{l.tipo}</span>
                      </span>
                    </td>
                    <td style={{ ...S.td, color: '#94a3b8', fontSize: 12, maxWidth: 400 }}>{l.dettaglio}</td>
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
      {tab==='fat'&&<InvoiceTab sp={sp} sps={sps} from={from} to={to} fatSearch={fatSearch} setFatSearch={setFatSearch}/>}

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
          <KPI label="Totale fatture" icon="📄" value={cicInvoices.length} sub="da CiC" accent='#3B82F6'/>
          <KPI label="Da assegnare" icon="📋" value={cicInvoices.filter(f=>!localeMap[f.id]||localeMap[f.id]==='Alhena Group').length} sub="senza locale" accent='#F97316'/>
          <KPI label="Assegnate" icon="✓" value={cicInvoices.filter(f=>localeMap[f.id]&&localeMap[f.id]!=='Alhena Group').length} sub="con locale" accent='#10B981'/>
        </div>
        <Card title="Fatture passive da CiC" badge={fatLoading?'Caricamento...':cicInvoices.length+' fatture'} extra={
          <div style={{display:'flex',gap:8}}>
            <input placeholder="🔍 Fornitore / N° doc..." value={fatSearch} onChange={e=>setFatSearch(e.target.value)} style={{...iS,width:200}}/>
            <button onClick={loadCicInvoices} style={{...iS,background:'#F59E0B',color:'#0f1420',border:'none',padding:'6px 16px',fontWeight:600}}>Aggiorna</button>
          </div>
        }>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['','Data','Fornitore','N° Doc','Tipo','Stato','Locale','XML'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {cicInvoices.length===0&&!fatLoading&&<tr><td colSpan={8} style={{...S.td,color:'#475569',textAlign:'center',padding:20}}>Nessuna fattura. Clicca "Aggiorna" per caricare da CiC. Serve essere loggati su fo.cassanova.com.</td></tr>}
                {filtered.slice(0,50).map((f,i)=><React.Fragment key={f.id||i}>
                  <tr onClick={()=>{setExpandedFat(expandedFat===f.id?null:f.id);if(expandedFat!==f.id){setXmlContent(null)}}} style={{cursor:'pointer',borderBottom:'1px solid #1a1f2e'}}>
                    <td style={{...S.td,width:24,color:'#64748b'}}>{expandedFat===f.id?'▼':'▶'}</td>
                    <td style={{...S.td,color:'#F59E0B',fontWeight:600}}>{f.date}</td>
                    <td style={{...S.td,fontWeight:500}}>{f.sender?.name||'—'}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{f.number}</td>
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
                  {expandedFat===f.id&&<tr><td colSpan={8} style={{padding:'0 14px 12px 38px',background:'#131825'}}>
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
                            <td style={{...S.td,fontSize:11,color:'#64748b',padding:'6px 8px'}}>{l.um}</td>
                            <td style={{...S.td,fontSize:12,padding:'6px 8px'}}>{l.prezzoUnitario?Number(l.prezzoUnitario).toFixed(2)+'€':''}</td>
                            <td style={{...S.td,fontSize:12,fontWeight:600,padding:'6px 8px'}}>{l.prezzoTotale?Number(l.prezzoTotale).toFixed(2)+'€':''}</td>
                            <td style={{...S.td,fontSize:11,color:'#94a3b8',padding:'6px 8px'}}>{l.aliquotaIVA}%</td>
                          </tr>)}
                        </tbody>
                      </table> : <div style={{padding:8,fontSize:12,color:'#94a3b8'}}>XML caricato ma nessuna riga trovata.</div>
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
      {tab==='mag'&&<WarehouseModule sp={sp} sps={sps}/>}

      {/* ── PRODUTTIVITÀ ORARIA ── */}
      {tab==='prod'&&(()=>{
        const prodColor = v => v < sogliaRed ? '#EF4444' : v < sogliaYel ? '#F59E0B' : '#10B981'
        const prodLabel = v => v < sogliaRed ? 'Sotto soglia' : v < sogliaYel ? 'Attenzione' : 'OK'
        const oreWithProd = ore.map(o => {
          const staff = staffSchedule[o.ora] || 0
          const prodOraria = staff > 0 ? o.ricavi / staff : 0
          return { ...o, staff, oreLavorate: staff, prodOraria }
        })
        const totOreDay = oreWithProd.reduce((s,o) => s + o.oreLavorate, 0)
        const totIncassoOre = oreWithProd.reduce((s,o) => s + o.ricavi, 0)
        const mediaGiornaliera = totOreDay > 0 ? totIncassoOre / totOreDay : 0
        // Dividi per n. giorni nel periodo per media giornaliera
        const nDays = trend.length || 1
        const mediaGiorn = totOreDay > 0 ? (totIncassoOre / nDays) / totOreDay : 0

        return <>
        {/* Box informativi */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Chiusura cassa" icon="🔒" value={data?.fiscalCloseTime || '—'} sub={'Z-'+(data?.zNumber||'—')} accent='#EF4444'/>
          <KPI label="Ultima cucina/pizzeria" icon="🍕" value={data?.lastKitchenTime || '—'} sub="comanda" accent='#F59E0B'/>
          <KPI label="Ultima bar" icon="🍺" value={data?.lastBarTime || '—'} sub="comanda" accent='#3B82F6'/>
          <KPI label="Apertura" icon="🟢" value={data?.firstReceiptTime || '—'} sub="primo scontrino" accent='#10B981'/>
        </div>

        {/* Target e soglie */}
        <div style={{...S.card,marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:24,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'#64748b'}}>Target €/h:</span>
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
            <span style={{fontSize:12,color:'#64748b'}}>Media giornaliera:</span>
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
              <Tooltip formatter={(v,name)=>name==='prodOraria'?v.toFixed(1)+' €/h':fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12,color:'#f1f5f9'}} labelStyle={{color:'#94a3b8'}} itemStyle={{color:'#f1f5f9'}}/>
              <Bar dataKey="ricavi" name="Ricavi" radius={[3,3,0,0]}>
                {oreWithProd.filter(o=>o.ricavi>0).map((o,i)=><Cell key={i} fill={o.staff>0?prodColor(o.prodOraria):'#F59E0B'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Tabella dettaglio */}
        <div style={{marginTop:12}}>
          <Card title="Dettaglio per fascia oraria">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['Ora','Ricavi','Scontrini','Personale','Ore lavorate','Prod. oraria','Stato'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {oreWithProd.filter(o=>o.ricavi>0).map((o,i)=>{
                  const pc = prodColor(o.prodOraria)
                  return <tr key={i}>
                    <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{o.ora}</td>
                    <td style={{...S.td,fontWeight:600}}>{fmt(o.ricavi)}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{o.scontrini}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{o.staff || '—'}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{o.oreLavorate || '—'}</td>
                    <td style={{...S.td,fontWeight:700,color:o.staff>0?pc:'#475569'}}>{o.staff>0?o.prodOraria.toFixed(1)+' €/h':'—'}</td>
                    <td style={S.td}>{o.staff>0?<span style={{...S.badge(pc,pc+'22'),fontSize:10}}>{prodLabel(o.prodOraria)}</span>:'—'}</td>
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
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['','Tavolo','Aperta','Chiusa','Coperti','Totale','Articoli','Reparto'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(data?.receiptDetails||[]).map((r,i)=><>
                  <tr key={i} onClick={()=>setExpandedReceipt(expandedReceipt===i?null:i)} style={{cursor:'pointer',borderBottom:'1px solid #1a1f2e'}}>
                    <td style={{...S.td,width:24,color:'#64748b'}}>{expandedReceipt===i?'▼':'▶'}</td>
                    <td style={{...S.td,fontWeight:600,color:'#e2e8f0'}}>{r.tavolo||'—'}</td>
                    <td style={{...S.td,fontWeight:600,color:'#10B981'}}>{r.aperturaComanda||r.ora}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.chiusuraComanda||r.ora}</td>
                    <td style={{...S.td,color:'#F59E0B',fontWeight:600}}>{r.coperti||'—'}</td>
                    <td style={{...S.td,fontWeight:600}}>{fmt(r.totale)}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.items?.length||0} art.</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{[...new Set(r.items?.map(it=>it.reparto).filter(Boolean))].join(', ')||'—'}</td>
                  </tr>
                  {expandedReceipt===i&&<tr key={'d'+i}><td colSpan={8} style={{padding:'0 14px 12px 38px',background:'#131825'}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead><tr>
                        {['Prodotto','Qtà','Prezzo','Reparto'].map(h=><th key={h} style={{...S.th,fontSize:10,padding:'6px 10px'}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {(r.items||[]).map((it,j)=><tr key={j}>
                          <td style={{...S.td,fontSize:12,fontWeight:500,padding:'6px 10px'}}>{it.nome}</td>
                          <td style={{...S.td,fontSize:12,color:'#94a3b8',padding:'6px 10px'}}>{it.qty}x</td>
                          <td style={{...S.td,fontSize:12,fontWeight:500,padding:'6px 10px'}}>{fmt(it.prezzo)}</td>
                          <td style={{...S.td,fontSize:11,color:'#64748b',padding:'6px 10px'}}>{it.reparto||'—'}</td>
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
      {tab==='ce'&&<ContoEconomico ce={ce} from={from} to={to}/>}

      {tab==='bud'&&<BudgetModule sp={sp} sps={sps} from={from} to={to}/>}

      {/* ── PERSONALE ── */}
      {tab==='hr'&&<HRModule staffSchedule={staffSchedule} setStaffSchedule={setStaffSchedule} saveSchedule={saveSchedule} sp={sp} sps={sps}/>}

      {/* ── MARKETING ── */}
      {tab==='mkt'&&<MarketingModule sp={sp} sps={sps} from={from} to={to} onTasksChange={loadMktBadge}/>}

      </>}
    </div>
  </div>
}
