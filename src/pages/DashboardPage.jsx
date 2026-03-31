import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { getToken, getSalesPoints, getReportData } from '../lib/cicApi'

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt   = n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0})
const fmtDec= n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2})
const fmtN  = n => Number(n||0).toLocaleString('it-IT')
const today      = () => new Date().toISOString().split('T')[0]
const monthStart = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01' }
const COLORS = ['#F59E0B','#3B82F6','#10B981','#8B5CF6','#EC4899','#F97316','#06B6D4','#84CC16']

// ── Sub-components ──────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, accent='#F59E0B', trend }) {
  return (
    <div style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:12,padding:'1.25rem 1.5rem',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,width:3,height:'100%',background:accent,borderRadius:'12px 0 0 12px'}}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <span style={{fontSize:11,fontWeight:600,color:'#64748b',textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</span>
        <span style={{fontSize:18}}>{icon}</span>
      </div>
      <div style={{fontSize:28,fontWeight:700,color:'#f1f5f9',letterSpacing:'-0.03em',marginBottom:4}}>{value}</div>
      {sub && <div style={{fontSize:12,color:'#94a3b8'}}>{sub}</div>}
      {trend!=null && (
        <div style={{marginTop:8,fontSize:11,color:trend>=0?'#10B981':'#EF4444',fontWeight:600}}>
          {trend>=0?'▲':'▼'} {Math.abs(trend).toFixed(1)}% vs mese prec.
        </div>
      )}
    </div>
  )
}

function SectionCard({ title, badge, children, action }) {
  return (
    <div style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:12,padding:'1.5rem'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <h3 style={{margin:0,fontSize:14,fontWeight:600,color:'#e2e8f0'}}>{title}</h3>
          {badge && <span style={{background:'rgba(245,158,11,.15)',color:'#F59E0B',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,textTransform:'uppercase',letterSpacing:'.06em'}}>{badge}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function HBarRow({ label, value, max, color, index, extra }) {
  const pct = max>0?Math.max(value/max*100,0):0
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:5,alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}}/>
          <span style={{fontSize:13,color:'#cbd5e1'}}>{label}</span>
        </div>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          {extra && <span style={{fontSize:12,color:'#64748b'}}>{extra}</span>}
          <span style={{fontSize:13,fontWeight:600,color:'#f1f5f9'}}>{fmt(value)}</span>
        </div>
      </div>
      <div style={{height:5,background:'#0f1420',borderRadius:3,overflow:'hidden'}}>
        <div style={{height:'100%',width:pct+'%',background:color,borderRadius:3,transition:'width .8s cubic-bezier(.4,0,.2,1)'}}/>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null
  return (
    <div style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,padding:'10px 14px',boxShadow:'0 8px 32px rgba(0,0,0,.4)'}}>
      <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>{label}</div>
      {payload.map((p,i) => (
        <div key={i} style={{fontSize:13,color:'#f1f5f9',fontWeight:600}}>
          {p.name==='ricavi' ? fmt(p.value) : fmtN(p.value)}{p.name==='scontrini'?' scontrini':''}
        </div>
      ))}
    </div>
  )
}

function Loader() {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'4rem',gap:16}}>
      <div style={{width:32,height:32,borderRadius:'50%',border:'2px solid #2a3042',borderTopColor:'#F59E0B',animation:'spin .7s linear infinite'}}/>
      <div style={{fontSize:13,color:'#64748b'}}>Caricamento dati in corso...</div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function DashboardPage({ settings }) {
  const [token,      setToken]      = useState(null)
  const [from,       setFrom]       = useState(monthStart())
  const [to,         setTo]         = useState(today())
  const [selectedSp, setSelectedSp] = useState('all')
  const [salesPoints,setSalesPoints]= useState(Array.isArray(settings?.sales_points)?settings.sales_points:[])
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [activeTab,  setActiveTab]  = useState('overview')

  useEffect(() => {
    getToken(settings.cic_api_key)
      .then(async t => {
        setToken(t)
        if (!salesPoints.length) {
          const sp = await getSalesPoints(t)
          setSalesPoints(sp)
        }
      })
      .catch(e => setError('Errore autenticazione: '+e.message))
  }, [settings.cic_api_key])

  const loadData = useCallback(async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const spFilter = selectedSp==='all' ? [] : [parseInt(selectedSp)]
      const d = await getReportData(token, { from, to, idsSalesPoint: spFilter }, salesPoints)
      setData(d)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }, [token, from, to, selectedSp, salesPoints])

  useEffect(() => { loadData() }, [loadData])

  const totale   = data?.totale    || 0
  const depts    = data?.depts     || []
  const cats     = data?.cats      || []
  const taxes    = data?.taxes     || []
  const trend    = data?.trend     || []
  const topProds = data?.topProducts || []
  const isDemo   = data?.isDemo    === true

  const iStyle = {
    fontSize:13,padding:'6px 10px',border:'1px solid #2a3042',
    borderRadius:6,background:'#0f1420',color:'#e2e8f0',cursor:'pointer',outline:'none'
  }
  const tabStyle = (t) => ({
    padding:'8px 16px',borderRadius:6,fontSize:13,fontWeight:500,cursor:'pointer',border:'none',
    background: activeTab===t ? '#F59E0B' : 'transparent',
    color: activeTab===t ? '#0f1420' : '#64748b',
    transition:'all .2s'
  })

  return (
    <div style={{minHeight:'100vh',background:'#0f1420',fontFamily:"'DM Sans',system-ui,sans-serif",color:'#e2e8f0'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes spin { to { transform:rotate(360deg) } }
        * { box-sizing:border-box }
        input[type=date]::-webkit-calendar-picker-indicator { filter:invert(.4) }
        select option { background:#1a1f2e }
        ::-webkit-scrollbar { width:6px; height:6px }
        ::-webkit-scrollbar-track { background:#0f1420 }
        ::-webkit-scrollbar-thumb { background:#2a3042; border-radius:3px }
      `}</style>

      {/* Header */}
      <div style={{background:'#131825',borderBottom:'1px solid #1e2636',padding:'0 1.5rem',height:60,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:100,backdropFilter:'blur(10px)'}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:28,height:28,background:'#F59E0B',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'#0f1420'}}>C</div>
            <span style={{fontSize:15,fontWeight:700,color:'#f1f5f9',letterSpacing:'-0.01em'}}>CIC Analytics</span>
          </div>
          {salesPoints.length > 0 && (
            <select value={selectedSp} onChange={e=>setSelectedSp(e.target.value)} style={{...iStyle,paddingLeft:10}}>
              <option value="all">📍 Tutti i locali</option>
              {salesPoints.map(sp=><option key={sp.id} value={sp.id}>{sp.description||sp.name}</option>)}
            </select>
          )}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {isDemo && <span style={{background:'rgba(245,158,11,.12)',color:'#F59E0B',fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,border:'1px solid rgba(245,158,11,.25)',letterSpacing:'.06em'}}>DEMO</span>}
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={iStyle}/>
          <span style={{color:'#2a3042',fontSize:16}}>—</span>
          <input type="date" value={to}   onChange={e=>setTo(e.target.value)}   style={iStyle}/>
          <button onClick={loadData} style={{...iStyle,background:'#F59E0B',color:'#0f1420',fontWeight:600,border:'none',padding:'6px 16px'}}>Aggiorna</button>
          <button onClick={()=>supabase.auth.signOut()} style={{...iStyle,color:'#475569',padding:'6px 12px'}}>Esci</button>
        </div>
      </div>

      {/* Nav tabs */}
      <div style={{background:'#131825',borderBottom:'1px solid #1e2636',padding:'0 1.5rem',display:'flex',gap:4}}>
        {[['overview','📊 Overview'],['reparti','🏷️ Reparti'],['prodotti','🍕 Prodotti'],['iva','📋 IVA']].map(([t,l])=>(
          <button key={t} onClick={()=>setActiveTab(t)} style={tabStyle(t)}>{l}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:'1.5rem',maxWidth:1400,margin:'0 auto'}}>
        {error && <div style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:'12px 16px',fontSize:13,color:'#FCA5A5',marginBottom:'1.5rem'}}>{error}</div>}
        {isDemo && <div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.15)',borderRadius:8,padding:'10px 16px',fontSize:12,color:'#92400e',marginBottom:'1.5rem',display:'flex',alignItems:'center',gap:8}}>
          <span>⚡</span><span style={{color:'#D97706'}}>Modalità dimostrativa — i dati mostrati sono simulati. Quando il supporto CiC attiva l'accesso completo all'API, questa schermata si popolerà con i tuoi dati reali automaticamente.</span>
        </div>}

        {loading ? <Loader/> : <>
          {/* ── OVERVIEW ── */}
          {activeTab==='overview' && <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:'1.5rem'}}>
              <KpiCard label="Ricavi totali"   icon="💶" value={fmt(totale)}            sub={from+' → '+to}                      accent='#F59E0B' trend={8.3}/>
              <KpiCard label="Scontrini"       icon="🧾" value={fmtN(data?.scontrini)} sub="documenti emessi"                   accent='#3B82F6' trend={5.1}/>
              <KpiCard label="Scontrino medio" icon="📈" value={fmtDec(data?.medio)}   sub="per documento"                      accent='#10B981' trend={2.8}/>
              <KpiCard label="Reparti attivi"  icon="🏷️" value={depts.filter(d=>d.profit>0).length} sub="con vendite nel periodo" accent='#8B5CF6'/>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:12,marginBottom:12}}>
              <SectionCard title="Andamento ricavi" badge={isDemo?'Demo':null}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trend} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" vertical={false}/>
                    <XAxis dataKey="label" tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} interval={Math.floor(trend.length/7)}/>
                    <YAxis tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} width={40}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Line type="monotone" dataKey="ricavi" stroke="#F59E0B" strokeWidth={2} dot={false} name="ricavi"/>
                  </LineChart>
                </ResponsiveContainer>
              </SectionCard>

              <SectionCard title="Ripartizione reparti">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={depts.filter(d=>d.profit>0)} dataKey="profit" nameKey="description" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                      {depts.filter(d=>d.profit>0).map((d,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Tooltip formatter={(v)=>fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12}}/>
                  </PieChart>
                </ResponsiveContainer>
              </SectionCard>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <SectionCard title="Top reparti per ricavo">
                {depts.filter(d=>d.profit>0).slice(0,6).map((d,i)=>(
                  <HBarRow key={i} label={d.description} value={d.profit} max={depts[0]?.profit||1} color={COLORS[i%COLORS.length]} extra={d.qty ? fmtN(d.qty)+' pz' : null}/>
                ))}
              </SectionCard>
              <SectionCard title="Top categorie per ricavo">
                {cats.slice(0,6).map((c,i)=>(
                  <HBarRow key={i} label={c.description} value={c.total||c.totalSold||0} max={cats[0]?.total||cats[0]?.totalSold||1} color={COLORS[(i+3)%COLORS.length]}/>
                ))}
              </SectionCard>
            </div>
          </>}

          {/* ── REPARTI ── */}
          {activeTab==='reparti' && <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.5rem'}}>
              {depts.filter(d=>d.profit>0).map((d,i)=>(
                <div key={i} style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:12,padding:'1.25rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                    <span style={{fontSize:13,fontWeight:600,color:'#e2e8f0'}}>{d.description}</span>
                    <div style={{width:8,height:8,borderRadius:'50%',background:COLORS[i%COLORS.length]}}/>
                  </div>
                  <div style={{fontSize:26,fontWeight:700,color:'#f1f5f9',marginBottom:4}}>{fmt(d.profit)}</div>
                  <div style={{display:'flex',justifyContent:'space-between'}}>
                    <span style={{fontSize:12,color:'#64748b'}}>{fmtN(d.qty||0)} pezzi</span>
                    <span style={{fontSize:12,color:'#F59E0B',fontWeight:600}}>
                      {totale>0?(d.profit/totale*100).toFixed(1):0}%
                    </span>
                  </div>
                  <div style={{marginTop:10,height:3,background:'#0f1420',borderRadius:2}}>
                    <div style={{height:'100%',width:(totale>0?d.profit/totale*100:0)+'%',background:COLORS[i%COLORS.length],borderRadius:2}}/>
                  </div>
                </div>
              ))}
            </div>
            <SectionCard title="Confronto reparti">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={depts.filter(d=>d.profit>0)} margin={{top:5,right:20,left:0,bottom:5}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" horizontal={true} vertical={false}/>
                  <XAxis dataKey="description" tick={{fontSize:11,fill:'#475569'}} tickLine={false} axisLine={false}/>
                  <YAxis tick={{fontSize:10,fill:'#475569'}} tickLine={false} axisLine={false} tickFormatter={v=>'€'+Math.round(v/1000)+'k'} width={45}/>
                  <Tooltip formatter={v=>fmt(v)} contentStyle={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,fontSize:12}}/>
                  <Bar dataKey="profit" name="Ricavi" radius={[4,4,0,0]}>
                    {depts.filter(d=>d.profit>0).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          </>}

          {/* ── PRODOTTI ── */}
          {activeTab==='prodotti' && <>
            <SectionCard title="Top prodotti per ricavo" badge={isDemo?'Demo':null}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{borderBottom:'1px solid #1e2636'}}>
                  {['#','Prodotto','Quantità venduta','Ricavo totale','Prezzo medio'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left',fontWeight:500,fontSize:11,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {topProds.map((p,i)=>(
                    <tr key={i} style={{borderBottom:'1px solid #1a1f2e'}} onMouseEnter={e=>e.currentTarget.style.background='#1e2636'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'12px',color:'#475569',fontWeight:600}}>{i+1}</td>
                      <td style={{padding:'12px',color:'#e2e8f0',fontWeight:500}}>{p.name}</td>
                      <td style={{padding:'12px',color:'#94a3b8'}}>{fmtN(p.qty)} pz</td>
                      <td style={{padding:'12px',color:'#F59E0B',fontWeight:600}}>{fmt(p.revenue)}</td>
                      <td style={{padding:'12px',color:'#94a3b8'}}>{fmtDec(p.qty>0?p.revenue/p.qty:0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </>}

          {/* ── IVA ── */}
          {activeTab==='iva' && <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.5rem'}}>
              {taxes.map((t,i)=>(
                <div key={i} style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:12,padding:'1.25rem'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Aliquota IVA {t.rate}%</div>
                  <div style={{fontSize:24,fontWeight:700,color:'#f1f5f9',marginBottom:4}}>{fmt(t.taxable)}</div>
                  <div style={{fontSize:12,color:'#64748b'}}>Imponibile</div>
                  <div style={{height:1,background:'#2a3042',margin:'12px 0'}}/>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                    <span style={{color:'#64748b'}}>IVA</span>
                    <span style={{color:'#EF4444',fontWeight:600}}>{fmt(t.tax_amount)}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginTop:6}}>
                    <span style={{color:'#94a3b8',fontWeight:500}}>Totale lordo</span>
                    <span style={{color:'#F59E0B',fontWeight:700}}>{fmt((t.taxable||0)+(t.tax_amount||0))}</span>
                  </div>
                </div>
              ))}
            </div>
            <SectionCard title="Riepilogo IVA">
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{borderBottom:'1px solid #1e2636'}}>
                  {['Aliquota','Imponibile','IVA','Totale lordo','% sul totale'].map(h=>(
                    <th key={h} style={{padding:'10px 16px',textAlign:'left',fontWeight:500,fontSize:11,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {taxes.map((t,i)=>{
                    const lordo=(t.taxable||0)+(t.tax_amount||0)
                    return <tr key={i} style={{borderBottom:'1px solid #1a1f2e'}} onMouseEnter={e=>e.currentTarget.style.background='#1e2636'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'14px 16px'}}><span style={{background:'rgba(245,158,11,.15)',color:'#F59E0B',padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:600}}>{t.rate}%</span></td>
                      <td style={{padding:'14px 16px',color:'#e2e8f0'}}>{fmt(t.taxable)}</td>
                      <td style={{padding:'14px 16px',color:'#EF4444'}}>{fmt(t.tax_amount)}</td>
                      <td style={{padding:'14px 16px',fontWeight:600,color:'#f1f5f9'}}>{fmt(lordo)}</td>
                      <td style={{padding:'14px 16px',color:'#64748b'}}>{totale>0?(lordo/totale*100).toFixed(1)+'%':'—'}</td>
                    </tr>
                  })}
                </tbody>
                <tfoot><tr style={{borderTop:'2px solid #2a3042',background:'#131825'}}>
                  <td style={{padding:'14px 16px',fontWeight:700,color:'#f1f5f9'}}>Totale</td>
                  <td style={{padding:'14px 16px',fontWeight:600,color:'#e2e8f0'}}>{fmt(taxes.reduce((s,t)=>s+(t.taxable||0),0))}</td>
                  <td style={{padding:'14px 16px',fontWeight:600,color:'#EF4444'}}>{fmt(taxes.reduce((s,t)=>s+(t.tax_amount||0),0))}</td>
                  <td style={{padding:'14px 16px',fontWeight:700,color:'#F59E0B',fontSize:15}}>{fmt(totale)}</td>
                  <td style={{padding:'14px 16px',fontWeight:600,color:'#f1f5f9'}}>100%</td>
                </tr></tfoot>
              </table>
            </SectionCard>
          </>}
        </>}
      </div>
    </div>
  )
}
