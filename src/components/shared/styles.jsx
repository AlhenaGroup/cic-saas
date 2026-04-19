import { useState, useEffect } from 'react'

// Hook per layout responsive: ritorna true sotto un breakpoint (default 640px = mobile).
export function useIsMobile(bp = 640) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= bp)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= bp)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [bp])
  return isMobile
}

export const fmt  = n => Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:true})+' €'
export const fmtD = n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2})
export const fmtN = n => Number(n||0).toLocaleString('it-IT')
export const pct  = (v,t) => t>0?(v/t*100).toFixed(1)+'%':'—'

export const today      = () => new Date().toISOString().split('T')[0]
export const monthStart = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01' }

export function prevPeriod(from, to) {
  const f = new Date(from), t = new Date(to)
  const days = Math.round((t - f) / 86400000) + 1
  const pTo = new Date(f); pTo.setDate(pTo.getDate() - 1)
  const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - days + 1)
  return { from: pFrom.toISOString().split('T')[0], to: pTo.toISOString().split('T')[0] }
}

export function deltaFmt(curr, prev) {
  if (!prev) return null
  const diff = curr - prev
  const pctVal = prev > 0 ? ((curr - prev) / prev * 100) : 0
  const sign = diff >= 0 ? '+' : ''
  return { diff, pct: pctVal, label: `${sign}${Math.round(diff).toLocaleString('it-IT')} (${sign}${pctVal.toFixed(1)}%)`, positive: diff >= 0 }
}

export const C = ['#F59E0B','#3B82F6','#10B981','#8B5CF6','#EC4899','#F97316','#06B6D4','#84CC16','#EF4444','#A78BFA']

export const S = {
  card: {background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:12,padding:'1.25rem 1.5rem'},
  th:   {padding:'8px 14px',textAlign:'left',fontWeight:500,fontSize:11,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em'},
  td:   {padding:'11px 14px',borderBottom:'1px solid #1a1f2e',fontSize:13},
  badge:(c,bg)=>({background:bg,color:c,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}),
  input:{fontSize:13,padding:'6px 10px',border:'1px solid #2a3042',borderRadius:6,background:'#0f1420',color:'#e2e8f0',outline:'none'},
}

export function KPI({label,value,sub,icon,accent='#F59E0B',trend}) {
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

export function Card({title,badge,children,extra}) {
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

export function Bar2({label,value,max,color,pct:p}) {
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

export const Tip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null
  return <div style={{background:'#1a1f2e',border:'1px solid #2a3042',borderRadius:8,padding:'10px 14px',fontSize:12}}>
    <div style={{color:'#64748b',marginBottom:4}}>{label}</div>
    {payload.map((p,i)=><div key={i} style={{color:'#f1f5f9',fontWeight:600}}>{p.name==='ricavi'?fmt(p.value):fmtN(p.value)}{p.name==='scontrini'?' sc.':''}</div>)}
  </div>
}

export function Loader() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'4rem',gap:12}}>
    <div style={{width:28,height:28,borderRadius:'50%',border:'2px solid #2a3042',borderTopColor:'#F59E0B',animation:'spin .7s linear infinite'}}/>
    <span style={{fontSize:13,color:'#64748b'}}>Caricamento...</span>
  </div>
}
