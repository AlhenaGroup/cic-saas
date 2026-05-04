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

// Palette grafici: light-friendly. Mantiene compat con il vecchio array C.
export const C = ['#2952CC','#16754A','#92400E','#7C3AED','#DB2777','#EA580C','#0891B2','#65A30D','#DC2626','#6366F1']

export const S = {
  card: {background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-card)',padding:'1.5rem',boxShadow:'var(--shadow)'},
  th:   {padding:'10px 16px',textAlign:'left',fontWeight:500,fontSize:11,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em'},
  td:   {padding:'12px 16px',borderBottom:'1px solid var(--border)',fontSize:13,color:'var(--text)'},
  badge:(c,bg)=>({background:bg,color:c,fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:999,letterSpacing:'.02em'}),
  input:{fontSize:13,padding:'8px 12px',border:'1px solid var(--border-md)',borderRadius:'var(--radius-control)',background:'var(--surface)',color:'var(--text)',outline:'none',fontFamily:'inherit'},
}

export function KPI({label,value,sub,icon,accent='var(--blue)',trend}) {
  return <div style={{...S.card,position:'relative',overflow:'hidden',padding:'1.5rem'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
      <span style={{fontSize:11,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</span>
      {icon&&<span style={{fontSize:16,color:'var(--text3)'}}>{icon}</span>}
    </div>
    <div style={{fontSize:28,fontWeight:600,color:'var(--text)',letterSpacing:'-0.02em',marginBottom:4,fontFamily:'DM Sans, system-ui, sans-serif'}}>{value}</div>
    {sub&&<div style={{fontSize:12,color:'var(--text2)'}}>{sub}</div>}
    {trend!=null&&<div style={{marginTop:8,display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999,background:trend>=0?'var(--green-bg)':'var(--red-bg)',color:trend>=0?'var(--green)':'var(--red)'}}>{trend>=0?'↑':'↓'} {Math.abs(trend).toFixed(1)}%</div>}
  </div>
}

export function Card({title,badge,children,extra}) {
  return <div style={S.card}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <h3 style={{margin:0,fontSize:15,fontWeight:600,color:'var(--text)',letterSpacing:'-0.01em'}}>{title}</h3>
        {badge&&<span style={S.badge('var(--blue-text)','var(--blue-bg)')}>{badge}</span>}
      </div>
      {extra}
    </div>
    {children}
  </div>
}

export function Bar2({label,value,max,color,pct:p}) {
  const w = max>0?Math.max(value/max*100,0):0
  return <div style={{marginBottom:14}}>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
      <span style={{fontSize:13,color:'var(--text2)'}}>{label}</span>
      <div style={{display:'flex',gap:12,alignItems:'baseline'}}>
        {p!=null&&<span style={{fontSize:11,color:'var(--text3)',fontWeight:500}}>{p}%</span>}
        <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{fmt(value)}</span>
      </div>
    </div>
    <div style={{height:6,background:'var(--surface2)',borderRadius:3,overflow:'hidden'}}>
      <div style={{height:'100%',width:w+'%',background:color||'var(--blue)',borderRadius:3,transition:'width .6s ease'}}/>
    </div>
  </div>
}

export const Tip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null
  return <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-control)',padding:'10px 14px',fontSize:12,boxShadow:'var(--shadow-md)'}}>
    <div style={{color:'var(--text3)',marginBottom:6,fontSize:11}}>{label}</div>
    {payload.map((p,i)=><div key={i} style={{color:'var(--text)',fontWeight:600}}>{p.name==='ricavi'?fmt(p.value):fmtN(p.value)}{p.name==='scontrini'?' sc.':''}</div>)}
  </div>
}

export function Loader() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'4rem',gap:12}}>
    <div style={{width:24,height:24,borderRadius:'50%',border:'2px solid var(--border)',borderTopColor:'var(--blue)',animation:'spin .7s linear infinite'}}/>
    <span style={{fontSize:13,color:'var(--text2)'}}>Caricamento...</span>
  </div>
}
