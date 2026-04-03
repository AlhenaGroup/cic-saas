import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { getToken, getSalesPoints, getReportData } from '../lib/cicApi'

const fmt    = n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0})
const fmtD   = n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2})
const fmtN   = n => Number(n||0).toLocaleString('it-IT')
const pct    = (v,t) => t>0?(v/t*100).toFixed(1)+'%':'—'
const today      = () => new Date().toISOString().split('T')[0]
const monthStart = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01' }
const C = ['#F59E0B','#3B82F6','#10B981','#8B5CF6','#EC4899','#F97316','#06B6D4','#84CC16','#EF4444','#A78BFA']

const S = { // shared inline styles
  card: {background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:12,padding:'1.25rem 1.5rem'},
  th:   {padding:'8px 14px',textAlign:'left',fontWeight:500,fontSize:11,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em'},
  td:   {padding:'11px 14px',borderBottom:'1px solid #1a1f2e',fontSize:13},
  badge:(c,bg)=>({background:bg,color:c,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}),
  input:{fontSize:13,padding:'6px 10px',border:'1px solid #2a3042',borderRadius:6,background:'#0f1420',color:'#e2e8f0',outline:'none'},
}

function KPI({label,value,sub,icon,accent='#F59E0B',trend}) {
  return <div style={{...S.card,position:'relative',overflow:'hidden'}}>
    <div style={{position:'absolute',top:0,left:0,width:3,height:'100%',background:accent,borderRadius:'12px 0 0 12px'}}/>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
      <span style={{fontSize:11,fontWeight:600,color:'#64748b',textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</span>
      <span style={{fontSize:18}}>{icon}</span>
    </div>
    <div style={{fontSize:26,fontWeight:700,color:'#f1f5f9',letterSpacing:'-0.03em',marginBottom:4}}>{value}</div>
    {sub&&<div style={{fontSize:12,color:'#94a3b8'}}>{sub}</div>}
    {trend!=null&&<div style={{marginTop:6,fontSize:11,color:trend>=0?'#10B981':'#EF4444',fontWeight:600}}>{trend>=0?'▲':'▼'} {Math.abs(trend).toFixed(1)}%</div>}
  </div>
}

function Card({title,badge,children,extra}) {
  return <div style={S.card}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.1rem'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <h3 style={{margin:0,fontSize:14,fontWeight:600,color:'#e2e8f0'}}>{title}</h3>
        {badge&&<span style={S.badge('#F59E0B','rgba(245,158,11,.15)')}>{badge}</span>}
      </div>
      {extra}
    </div>
    {children}
  </div>
}

function Bar2({label,value,max,color,pct:p}) {
  const w = max>0?Math.max(value/max*100,0):0
  return <div style={{marginBottom:12}}>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
      <span style={{fontSize:13,color:'#cbd5e1'}}>{label}</span>
      <div style={{display:'flex',gap:12}}>
        {p!=null&&<span style={{fontSize:12,color:'#F59E0B',fontWeight:600}}>{p}%</span>}
        <span style={{fontSize:13,fontWeight:600,color:'#f1f5f9'}}>{fmt(value)}</span>
      </div>
    </div>
    <div style={{height:4,background:'#0f1420',borderRadius:2}}>
      <div style={{height:'100%',width:w+'%',background:color,borderRadius:2,transition:'width .6s ease'}}/>
    </div>
  </div>
}

const Tip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null
  return <div style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,padding:'10px 14px',fontSize:12}}>
    <div style={{color:'#64748b',marginBottom:4}}>{label}</div>
    {payload.map((p,i)=><div key={i} style={{color:'#f1f5f9',fontWeight:600}}>{p.name==='ricavi'?fmt(p.value):fmtN(p.value)}{p.name==='scontrini'?' sc.':''}</div>)}
  </div>
}

function Loader() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'4rem',gap:12}}>
    <div style={{width:28,height:28,borderRadius:'50%',border:'2px solid #2a3042',borderTopColor:'#F59E0B',animation:'spin .7s linear infinite'}}/>
    <span style={{fontSize:13,color:'#64748b'}}>Caricamento...</span>
  </div>
}

export default function DashboardPage({ settings }) {
  const [token, setToken]         = useState(null)
  const [from,  setFrom]          = useState(() => localStorage.getItem('cic_from') || monthStart())
  const [to,    setTo]            = useState(() => localStorage.getItem('cic_to') || today())
  const [sp,    setSp]            = useState(() => localStorage.getItem('cic_sp') || 'all')
  const [sps,   setSps]           = useState(Array.isArray(settings?.sales_points)?settings.sales_points:[])
  const [data,  setData]          = useState(null)
  const [loading,setLoading]      = useState(true)
  const [error,  setError]        = useState('')
  const [tab,    setTab]          = useState(() => localStorage.getItem('cic_tab') || 'ov')
  const [recSearch,setRecSearch]  = useState('')
  const [fatSearch,setFatSearch]  = useState('')
  const [fatFilter,setFatFilter]  = useState('all')
  const [prodRep,setProdRep]      = useState('tutti')
  // Persisti filtro in localStorage
  useEffect(() => { localStorage.setItem('cic_from', from) }, [from])
  useEffect(() => { localStorage.setItem('cic_to', to) }, [to])
  useEffect(() => { localStorage.setItem('cic_sp', sp) }, [sp])
  useEffect(() => { localStorage.setItem('cic_tab', tab) }, [tab])



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
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  },[token,from,to,sp,sps])
  useEffect(()=>{load()},[load])

  const totale = data?.totale||0
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

  const iS = S.input
  const tS = (t) => ({padding:'8px 16px',borderRadius:6,fontSize:13,fontWeight:500,cursor:'pointer',border:'none',
    background:tab===t?'#F59E0B':'transparent',color:tab===t?'#0f1420':'#64748b',transition:'all .2s'})

  const TABS=[['ov','📊 Panoramica'],['scontrini','🧾 Scontrini'],['cat','🏷️ Categorie'],
              ['iva','📋 IVA'],['rep','🏪 Reparti'],['susp','⚠️ Movimenti'],
              ['fat','📄 Fatture'],['prod','⏱️ Produttività'],['ce','📊 Conto Econ.'],['hr','👥 Personale']]

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
        <button onClick={load} style={{...iS,background:'#F59E0B',color:'#0f1420',fontWeight:600,border:'none',padding:'6px 16px'}}>Aggiorna</button>
        <button onClick={()=>supabase.auth.signOut()} style={{...iS,color:'#475569',border:'1px solid #2a3042',padding:'6px 12px'}}>Esci</button>
      </div>
    </div>

    {/* Tabs nav */}
    <div style={{background:'#131825',borderBottom:'1px solid #1e2636',padding:'0 1.5rem',display:'flex',gap:2,overflowX:'auto'}}>
      {TABS.map(([t,l])=><button key={t} onClick={()=>setTab(t)} style={tS(t)}>{l}</button>)}
    </div>

    <div style={{padding:'1.5rem',maxWidth:1400,margin:'0 auto'}}>
      {error&&<div style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:'12px 16px',fontSize:13,color:'#FCA5A5',marginBottom:'1.5rem'}}>{error}</div>}
      {isDemo&&<div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.15)',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#D97706',marginBottom:'1.25rem'}}>
        ⚡ Modalità demo — dati simulati. Quando CiC abilita l'API, si aggiornano automaticamente.
      </div>}

      {loading?<Loader/>:<>

      {/* ── PANORAMICA ── */}
      {tab==='ov'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:'1.5rem'}}>
          <KPI label="Ricavi totali"   icon="💶" value={fmt(totale)}            sub={from+' → '+to} accent='#F59E0B' trend={8.3}/>
          <KPI label="Scontrini"       icon="🧾" value={fmtN(data?.scontrini)} sub="documenti"     accent='#3B82F6' trend={5.1}/>
          <KPI label="Scontrino medio" icon="📈" value={fmtD(data?.medio)}     sub="per documento" accent='#10B981' trend={2.8}/>
          <KPI label="Reparti attivi"  icon="🏷️" value={depts.filter(d=>d.profit>0).length} sub="con vendite" accent='#8B5CF6'/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:12,marginBottom:12}}>
          <Card title="Andamento ricavi" badge={isDemo?'Demo':null}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{top:5,right:10,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={false}/>
                <XAxis dataKey="label" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} interval={Math.max(1,Math.floor(trend.length/7))}/>
                <YAxis tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} width={38}/>
                <Tooltip content={<Tip/>}/>
                <Line type="monotone" dataKey="ricavi" stroke="#F59E0B" strokeWidth={2} dot={false} name="ricavi"/>
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Ripartizione reparti">
            <ResponsiveContainer width="100%" height={220}>
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
        <Card title="Lista scontrini" extra={
          <input placeholder="🔍 Cerca..." value={recSearch} onChange={e=>setRecSearch(e.target.value)} style={{...iS,width:220}}/>
        }>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['N°','Data','Ora','Locale','Articoli','Totale','Pagamento'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {recs.filter(r=>!recSearch||r.locale?.toLowerCase().includes(recSearch.toLowerCase())||r.id.includes(recSearch)).slice(0,30).map((r,i)=>(
                  <tr key={i}>
                    <td style={{...S.td,color:'#475569',fontWeight:600}}>{r.id}</td>
                    <td style={S.td}>{r.date}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.time}</td>
                    <td style={S.td}>{r.locale}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{r.items} art.</td>
                    <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{fmtD(r.total)}</td>
                    <td style={S.td}><span style={S.badge(r.payment==='Carta'?'#3B82F6':r.payment==='Satispay'?'#8B5CF6':'#10B981',r.payment==='Carta'?'rgba(59,130,246,.15)':r.payment==='Satispay'?'rgba(139,92,246,.15)':'rgba(16,185,129,.15)')}>{r.payment}</span></td>
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

      {/* ── MOVIMENTI SOSPETTI ── */}
      {tab==='susp'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Alert totali" icon="⚠️" value={susp.length} sub="nel periodo" accent='#EF4444'/>
          <KPI label="Alta priorità" icon="🔴" value={susp.filter(s=>s.severity==='high').length} sub="richiedono attenzione" accent='#EF4444'/>
          <KPI label="Annulli" icon="🚫" value={susp.filter(s=>s.type==='Annullo').length} sub="scontrini annullati" accent='#F97316'/>
        </div>
        <Card title="Movimenti sospetti">
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
              {['Tipo','Descrizione','Importo','Data','Operatore','Priorità'].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {susp.map((s,i)=>(
                <tr key={i}>
                  <td style={S.td}><span>{s.icon}</span> <span style={{fontWeight:500,marginLeft:6}}>{s.type}</span></td>
                  <td style={{...S.td,color:'#94a3b8'}}>{s.desc}</td>
                  <td style={{...S.td,color:'#EF4444',fontWeight:600}}>{fmtD(s.amount)}</td>
                  <td style={{...S.td,color:'#94a3b8'}}>{s.date}</td>
                  <td style={S.td}>{s.user}</td>
                  <td style={S.td}>
                    <span style={S.badge(s.severity==='high'?'#EF4444':'#F59E0B',s.severity==='high'?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)')}>
                      {s.severity==='high'?'Alta':'Media'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </>}

      {/* ── FATTURE PASSIVE ── */}
      {tab==='fat'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Totale fatture" icon="📄" value={fat.length} sub="nel periodo" accent='#3B82F6'/>
          <KPI label="Da registrare" icon="📋" value={fat.filter(f=>f.statoContabile.includes('Da')).length} sub="in attesa" accent='#F97316'/>
          <KPI label="Importo totale" icon="💶" value={fmt(fat.reduce((s,f)=>s+(f.imponibile||0)+(f.iva||0),0))} sub="imponibile+IVA" accent='#10B981'/>
        </div>
        <Card title="Fatture passive" extra={
          <div style={{display:'flex',gap:8}}>
            <input placeholder="🔍 Fornitore..." value={fatSearch} onChange={e=>setFatSearch(e.target.value)} style={{...iS,width:180}}/>
            <select value={fatFilter} onChange={e=>setFatFilter(e.target.value)} style={iS}>
              <option value="all">Tutti gli stati</option>
              <option value="da">Da registrare</option>
              <option value="reg">Registrate</option>
            </select>
          </div>
        }>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['Data','Fornitore','N° Doc','Tipo','Locale','Imponibile','IVA','Stato SDI','Stato Contab.'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {fat.filter(f=>{
                  if(fatSearch&&!f.fornitore.toLowerCase().includes(fatSearch.toLowerCase())&&!f.numero.includes(fatSearch)) return false
                  if(fatFilter==='da'&&!f.statoContabile.includes('Da')) return false
                  if(fatFilter==='reg'&&!f.statoContabile.includes('Registrata')) return false
                  return true
                }).slice(0,25).map((f,i)=>(
                  <tr key={i}>
                    <td style={{...S.td,color:'#94a3b8'}}>{f.date}</td>
                    <td style={{...S.td,fontWeight:500}}>{f.fornitore}</td>
                    <td style={{...S.td,color:'#64748b'}}>{f.numero}</td>
                    <td style={S.td}><span style={S.badge('#3B82F6','rgba(59,130,246,.12)')}>{f.tipo}</span></td>
                    <td style={{...S.td,fontSize:12,color:'#94a3b8'}}>{f.locale}</td>
                    <td style={{...S.td,fontWeight:600}}>{fmtD(f.imponibile)}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{fmtD(f.iva)}</td>
                    <td style={S.td}>{f.statoSDI}</td>
                    <td style={S.td}><span style={S.badge(f.statoContabile.includes('Da')?'#F59E0B':'#10B981',f.statoContabile.includes('Da')?'rgba(245,158,11,.12)':'rgba(16,185,129,.12)')}>{f.statoContabile}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>}

      {/* ── PRODUTTIVITÀ ORARIA ── */}
      {tab==='prod'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Ora di punta" icon="⏰" value={ore.reduce((m,o)=>o.ricavi>m.ricavi?o:m,{ricavi:0,ora:'—'}).ora} sub="massimo incasso" accent='#F59E0B'/>
          <KPI label="Media oraria" icon="📊" value={fmt(ore.length?ore.reduce((s,o)=>s+o.ricavi,0)/ore.filter(o=>o.ricavi>0).length:0)} sub="nelle ore attive" accent='#3B82F6'/>
          <KPI label="Ore attive" icon="⚡" value={ore.filter(o=>o.ricavi>0).length} sub="su 24 ore" accent='#10B981'/>
        </div>
        <Card title="Produttività oraria" extra={
          <select value={prodRep} onChange={e=>setProdRep(e.target.value)} style={iS}>
            <option value="tutti">Tutti i reparti</option>
            {depts.filter(d=>d.profit>0).map(d=><option key={d.description} value={d.description}>{d.description}</option>)}
          </select>
        }>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ore} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={false}/>
              <XAxis dataKey="ora" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:10,fill:'#475569'}} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} tickLine={false} axisLine={false} width={42}/>
              <Tooltip formatter={v=>fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="ricavi" name="Ricavi" fill="#F59E0B" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <div style={{marginTop:12}}>
          <Card title="Dettaglio orario">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['Ora','Ricavi','Scontrini','Incasso medio'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ore.filter(o=>o.ricavi>0).map((o,i)=>(
                  <tr key={i}>
                    <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{o.ora}</td>
                    <td style={{...S.td,fontWeight:600}}>{fmt(o.ricavi)}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{o.scontrini}</td>
                    <td style={S.td}>{fmtD(o.scontrini>0?o.ricavi/o.scontrini:0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </>}

      {/* ── CONTO ECONOMICO ── */}
      {tab==='ce'&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Ricavi"    icon="💶" value={fmt(ce.ricavi)}   sub="totale venduto"      accent='#10B981' trend={8.3}/>
          <KPI label="Food cost" icon="🍕" value={fmt(ce.foodCost)} sub={pct(ce.foodCost,ce.ricavi)+' dei ricavi'} accent='#F59E0B'/>
          <KPI label="Bev. cost" icon="🍺" value={fmt(ce.bevCost)}  sub={pct(ce.bevCost,ce.ricavi)+' dei ricavi'}  accent='#3B82F6'/>
          <KPI label="MOL"       icon="📊" value={fmt(ce.mol)}      sub={pct(ce.mol,ce.ricavi)+' margine'}         accent='#10B981' trend={ce.molPct-65}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Card title="Conto Economico">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['Voce','Importo','% Ricavi'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  {label:'📈 RICAVI',        val:ce.ricavi,   bold:true, color:'#10B981'},
                  {label:'🍕 Food cost',      val:-ce.foodCost, color:'#EF4444'},
                  {label:'🍺 Beverage cost',  val:-ce.bevCost,  color:'#EF4444'},
                  {label:'📦 Mat. consumo',   val:-ce.matCost,  color:'#EF4444'},
                  {label:'👥 Personale',      val:-ce.persCost, color:'#EF4444'},
                  {label:'🏗️ Struttura',      val:-ce.strCost,  color:'#EF4444'},
                  {label:'── TOTALE COSTI',  val:-ce.totCosti, bold:true, color:'#EF4444'},
                  {label:'📊 MOL',            val:ce.mol,       bold:true, color:'#10B981'},
                ].map((r,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #1a1f2e',background:r.bold?'#131825':'transparent'}}>
                    <td style={{...S.td,fontWeight:r.bold?700:400}}>{r.label}</td>
                    <td style={{...S.td,fontWeight:r.bold?700:500,color:r.color||'#e2e8f0'}}>{fmt(Math.abs(r.val))}</td>
                    <td style={{...S.td,color:'#64748b'}}>{pct(Math.abs(r.val),ce.ricavi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Composizione costi">
            <div style={{marginBottom:16}}>
              {[
                {label:'Food cost',     val:ce.foodCost, color:'#F59E0B'},
                {label:'Beverage cost', val:ce.bevCost,  color:'#3B82F6'},
                {label:'Mat. consumo',  val:ce.matCost,  color:'#8B5CF6'},
                {label:'Struttura',     val:ce.strCost,  color:'#EC4899'},
                {label:'Personale',     val:ce.persCost, color:'#10B981'},
              ].map((r,i)=><Bar2 key={i} label={r.label} value={r.val} max={ce.totCosti||1} color={r.color} pct={ce.totCosti>0?(r.val/ce.totCosti*100).toFixed(1):0}/>)}
            </div>
            <div style={{borderTop:'1px solid #2a3042',paddingTop:12,display:'flex',justifyContent:'space-between',fontSize:13}}>
              <span style={{color:'#94a3b8'}}>MOL %</span>
              <span style={{color:'#10B981',fontWeight:700,fontSize:16}}>{ce.molPct?.toFixed(1)}%</span>
            </div>
          </Card>
        </div>
      </>}

      {/* ── PERSONALE ── */}
      {tab==='hr'&&<>
        <div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.15)',borderRadius:8,padding:'14px 16px',fontSize:13,color:'#D97706',marginBottom:'1.25rem'}}>
          👥 Il modulo Personale è disponibile nell'app overlay su <a href="https://fo.cassanova.com" target="_blank" style={{color:'#F59E0B'}}>fo.cassanova.com</a> dove puoi gestire dipendenti, documenti, orari, buste paga e calendario presenze.
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
          <KPI label="Dipendenti" icon="👤" value="4" sub="attivi" accent='#3B82F6'/>
          <KPI label="Documenti" icon="📁" value="12" sub="caricati" accent='#10B981'/>
          <KPI label="Scadenze" icon="📅" value="2" sub="nei prossimi 30gg" accent='#F59E0B'/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Card title="Dipendenti">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
                {['Nome','Ruolo','Locale','Stato'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  {nome:'Gianmarco Incarbone',ruolo:'Bar/Sala',locale:'REMEMBEER',   stato:'Attivo'},
                  {nome:'Filippo Secchi',     ruolo:'Cucina',  locale:'CASA DE AMICIS',stato:'Attivo'},
                  {nome:'Mario Rossi',        ruolo:'Sala',    locale:'FIORIO',       stato:'Attivo'},
                  {nome:'Luigi Verdi',        ruolo:'Pizzeria',locale:'REMEMBEER',   stato:'Attivo'},
                ].map((d,i)=>(
                  <tr key={i}>
                    <td style={{...S.td,fontWeight:500}}>{d.nome}</td>
                    <td style={{...S.td,color:'#94a3b8'}}>{d.ruolo}</td>
                    <td style={{...S.td,fontSize:12,color:'#64748b'}}>{d.locale}</td>
                    <td style={S.td}><span style={S.badge('#10B981','rgba(16,185,129,.12)')}>✓ {d.stato}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Scadenze documentali">
            {[
              {doc:'Contratto Gianmarco Incarbone',scad:'30/06/2026',giorni:91,alert:false},
              {doc:'Busta paga Filippo Secchi',    scad:'30/04/2026',giorni:30,alert:true },
              {doc:'Contratto Mario Rossi',        scad:'31/12/2026',giorni:275,alert:false},
            ].map((s,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid #1e2636'}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500,marginBottom:2}}>{s.doc}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>Scade: {s.scad}</div>
                </div>
                <span style={S.badge(s.alert?'#EF4444':'#94a3b8',s.alert?'rgba(239,68,68,.12)':'rgba(148,163,184,.1)')}>
                  {s.giorni}gg
                </span>
              </div>
            ))}
          </Card>
        </div>
      </>}

      </>}
    </div>
  </div>
}
