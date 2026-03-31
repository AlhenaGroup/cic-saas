import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getToken, getReportData } from '../lib/cicApi'

const fmt  = n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:2})
const fmtN = n => Number(n||0).toLocaleString('it-IT',{maximumFractionDigits:0})
const pct  = (v,t) => t>0?(v/t*100).toFixed(1)+'%':'—'
const today      = () => new Date().toISOString().split('T')[0]
const monthStart = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01' }

function KpiCard({label,value,sub,color='#3B82F6'}) {
  return <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'1rem 1.25rem',boxShadow:'0 1px 2px rgba(0,0,0,.04)'}}>
    <div style={{fontSize:'11px',fontWeight:'500',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>{label}</div>
    <div style={{fontSize:'22px',fontWeight:'600',color,letterSpacing:'-0.02em'}}>{value}</div>
    {sub&&<div style={{fontSize:'12px',color:'#94a3b8',marginTop:3}}>{sub}</div>}
  </div>
}

function BarRow({label,value,total,color='#3B82F6'}) {
  const w = total>0?Math.max(value/total*100,2):0
  return <div style={{marginBottom:12}}>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
      <span style={{fontSize:'13px'}}>{label}</span>
      <span style={{fontSize:'13px',fontWeight:'500'}}>{fmt(value)}</span>
    </div>
    <div style={{height:4,background:'#f1f5f9',borderRadius:2}}>
      <div style={{height:'100%',width:w+'%',background:color,borderRadius:2,transition:'width .5s ease'}}/>
    </div>
  </div>
}

function Section({title,children}) {
  return <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'1.25rem',boxShadow:'0 1px 2px rgba(0,0,0,.04)'}}>
    <div style={{fontSize:'13px',fontWeight:'500',marginBottom:'1rem'}}>{title}</div>
    {children}
  </div>
}

export default function DashboardPage({ settings }) {
  const [token,      setToken]      = useState(null)
  const [from,       setFrom]       = useState(monthStart())
  const [to,         setTo]         = useState(today())
  const [selectedSp, setSelectedSp] = useState('all')
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [session,    setSession]    = useState(null)
  const salesPoints = Array.isArray(settings?.sales_points) ? settings.sales_points : []

  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}}) => setSession(session))
    getToken(settings.cic_api_key).then(setToken).catch(e => setError('Auth: '+e.message))
  }, [settings.cic_api_key])

  const loadData = useCallback(async () => {
    if (!session) return
    setLoading(true); setError('')
    try {
      const spFilter = selectedSp === 'all' ? [] : [parseInt(selectedSp)]
      const d = await getReportData(session.access_token, { from, to, idsSalesPoint: spFilter })
      setData(d)
    } catch(e) {
      if (e.message === 'SYNC_NEEDED') {
        setError('Nessun dato per questo periodo. Vai su fo.cassanova.com e premi il pulsante "☁ Sync Dashboard" per sincronizzare i dati.')
      } else {
        setError('Errore: '+e.message)
      }
    }
    finally { setLoading(false) }
  }, [session, from, to, selectedSp])

  useEffect(() => { if (session) loadData() }, [loadData, session])

  const totale  = data?.totale   || 0
  const depts   = data?.depts    || []
  const cats    = data?.cats     || []
  const taxes   = data?.taxes    || []
  const iStyle  = {fontSize:'13px',padding:'5px 9px',border:'1px solid #e2e8f0',borderRadius:6,background:'var(--surface)',color:'var(--text)',cursor:'pointer'}

  const syncedAt = data?.synced_at ? new Date(data.synced_at).toLocaleString('it-IT') : null

  return <div style={{minHeight:'100vh',background:'#f8fafc'}}>
    <div style={{background:'var(--surface)',borderBottom:'1px solid #e2e8f0',padding:'0 1.5rem',display:'flex',alignItems:'center',justifyContent:'space-between',height:56,position:'sticky',top:0,zIndex:10}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <span style={{fontSize:'15px',fontWeight:'600',letterSpacing:'-0.01em'}}>CIC Dashboard</span>
        {salesPoints.length>0&&<select value={selectedSp} onChange={e=>setSelectedSp(e.target.value)} style={iStyle}>
          <option value="all">Tutti i locali</option>
          {salesPoints.map(sp=><option key={sp.id} value={sp.id}>{sp.description||sp.name}</option>)}
        </select>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={iStyle}/>
        <span style={{fontSize:'13px',color:'#94a3b8'}}>→</span>
        <input type="date" value={to}   onChange={e=>setTo(e.target.value)}   style={iStyle}/>
        <button onClick={loadData} style={{...iStyle,background:'#3B82F6',color:'#fff',border:'none',fontWeight:'500'}}>Aggiorna</button>
        <button onClick={()=>supabase.auth.signOut()} style={{...iStyle,color:'#94a3b8'}}>Esci</button>
      </div>
    </div>

    <div style={{padding:'1.5rem',maxWidth:1200,margin:'0 auto'}}>
      {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,padding:'10px 14px',fontSize:'13px',color:'#991b1b',marginBottom:'1.25rem',lineHeight:1.5}}>{error}</div>}
      {syncedAt&&<div style={{fontSize:'12px',color:'#94a3b8',marginBottom:'1rem'}}>📡 Ultimo sync: {syncedAt} — <a href="https://fo.cassanova.com" target="_blank" style={{color:'#3B82F6'}}>Sincronizza su fo.cassanova.com</a></div>}
      
      {loading
        ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'3rem',gap:12}}>
            <div style={{width:24,height:24,borderRadius:'50%',border:'2px solid #e2e8f0',borderTopColor:'#3B82F6',animation:'spin .7s linear infinite'}}/>
            <span style={{fontSize:'13px',color:'#94a3b8'}}>Caricamento...</span>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        : <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:'1.25rem'}}>
            <KpiCard label="Ricavi totali"   value={fmt(totale)}           sub={from+' → '+to}/>
            <KpiCard label="Scontrini"       value={fmtN(data?.scontrini)} sub="nel periodo"   color="#1e293b"/>
            <KpiCard label="Scontrino medio" value={fmt(data?.medio)}      sub="per documento" color="#10B981"/>
            <KpiCard label="Reparti attivi"  value={depts.filter(d=>d.profit>0).length} sub="con vendite" color="#1e293b"/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1.25rem'}}>
            <Section title="Venduto per reparto">
              {depts.length===0
                ?<p style={{fontSize:'13px',color:'#94a3b8',textAlign:'center',padding:'1rem',margin:0}}>Nessun dato</p>
                :depts.slice(0,8).map((d,i)=><BarRow key={i} label={d.department?.description||'Reparto'} value={d.profit} total={totale} color={i===0?'#3B82F6':i===1?'#6366F1':'#8B5CF6'}/>)}
            </Section>
            <Section title="Venduto per categoria">
              {cats.length===0
                ?<p style={{fontSize:'13px',color:'#94a3b8',textAlign:'center',padding:'1rem',margin:0}}>Nessun dato</p>
                :cats.slice(0,8).map((c,i)=><BarRow key={i} label={c.category?.description||'Categoria'} value={c.totalSold} total={cats.reduce((s,x)=>s+(x.totalSold||0),0)} color={i===0?'#10B981':i===1?'#34D399':'#6EE7B7'}/>)}
            </Section>
          </div>

          <Section title="Riepilogo IVA">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead><tr style={{borderBottom:'1px solid #e2e8f0'}}>
                {['Aliquota','Imponibile','IVA','Totale','%'].map(h=><th key={h} style={{padding:'6px 12px 10px',textAlign:'left',fontWeight:'500',fontSize:'11px',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.04em'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {taxes.length===0
                  ?<tr><td colSpan={5} style={{padding:'1rem',textAlign:'center',color:'#94a3b8'}}>Nessun dato</td></tr>
                  :taxes.map((t,i)=>{
                    const lordo=(t.taxable||0)+(t.tax_amount||0)
                    return <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'10px 12px',fontWeight:'500'}}>{t.tax?.rate??'—'}{typeof t.tax?.rate === 'number'?'%':''}</td>
                      <td style={{padding:'10px 12px'}}>{fmt(t.taxable)}</td>
                      <td style={{padding:'10px 12px',color:'#64748b'}}>{fmt(t.tax_amount)}</td>
                      <td style={{padding:'10px 12px',fontWeight:'500'}}>{fmt(lordo)}</td>
                      <td style={{padding:'10px 12px',color:'#94a3b8'}}>{pct(lordo,totale)}</td>
                    </tr>
                  })}
              </tbody>
              {taxes.length>0&&<tfoot><tr style={{borderTop:'2px solid #e2e8f0',background:'#f8fafc'}}>
                <td style={{padding:'10px 12px',fontWeight:'500'}}>Totale</td>
                <td style={{padding:'10px 12px',fontWeight:'500'}}>{fmt(taxes.reduce((s,t)=>s+(t.taxable||0),0))}</td>
                <td/>
                <td style={{padding:'10px 12px',fontWeight:'600',color:'#3B82F6'}}>{fmt(totale)}</td>
                <td style={{padding:'10px 12px',fontWeight:'500'}}>100%</td>
              </tr></tfoot>}
            </table>
          </Section>
        </>}
    </div>
  </div>
}
