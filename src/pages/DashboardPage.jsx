import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getToken, getSoldByDepartment, getSoldByCategory, getSoldByTax } from '../lib/cicApi'

const fmt = n => Number(n||0).toLocaleString('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:2})
const fmtN = n => Number(n||0).toLocaleString('it-IT',{maximumFractionDigits:0})
const pct = (v,t) => t>0?(v/t*100).toFixed(1)+'%':'—'
const today = () => new Date().toISOString().split('T')[0]
const monthStart = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01' }

function KpiCard({label,value,sub,color='var(--blue)'}) {
  return <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'1rem 1.25rem',boxShadow:'var(--shadow)'}}>
    <div style={{fontSize:'11px',fontWeight:'500',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'6px'}}>{label}</div>
    <div style={{fontSize:'22px',fontWeight:'600',color,letterSpacing:'-0.02em'}}>{value}</div>
    {sub && <div style={{fontSize:'12px',color:'var(--text3)',marginTop:'3px'}}>{sub}</div>}
  </div>
}

function BarRow({label,value,total,color='var(--blue)'}) {
  const w = total>0?Math.max(value/total*100,2):0
  return <div style={{marginBottom:'12px'}}>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'5px'}}>
      <span style={{fontSize:'13px'}}>{label}</span>
      <span style={{fontSize:'13px',fontWeight:'500'}}>{fmt(value)}</span>
    </div>
    <div style={{height:'4px',background:'var(--surface2)',borderRadius:'2px',overflow:'hidden'}}>
      <div style={{height:'100%',width:w+'%',background:color,borderRadius:'2px',transition:'width .6s ease'}} />
    </div>
  </div>
}

function Section({title,children}) {
  return <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'1.25rem',boxShadow:'var(--shadow)'}}>
    <div style={{fontSize:'13px',fontWeight:'500',marginBottom:'1rem'}}>{title}</div>
    {children}
  </div>
}

function Loader() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'3rem',flexDirection:'column',gap:'12px'}}>
    <div style={{width:'28px',height:'28px',borderRadius:'50%',border:'2px solid var(--border-md)',borderTopColor:'var(--blue)',animation:'spin .7s linear infinite'}} />
    <div style={{fontSize:'13px',color:'var(--text3)'}}>Caricamento dati...</div>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
}

export default function DashboardPage({ settings }) {
  const [token, setToken] = useState(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [selectedSp, setSelectedSp] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const salesPoints = settings?.sales_points || []

  useEffect(() => {
    getToken(settings.cic_api_key).then(setToken).catch(e => setError('Errore autenticazione: ' + e.message))
  }, [settings.cic_api_key])

  const loadData = useCallback(async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const spFilter = selectedSp === 'all' ? salesPoints.map(s => s.id) : [parseInt(selectedSp)]
      const [depts, cats, taxes] = await Promise.all([
        getSoldByDepartment(token, { from, to, idsSalesPoint: spFilter }),
        getSoldByCategory(token, { from, to, idsSalesPoint: spFilter }),
        getSoldByTax(token, { from, to, idsSalesPoint: spFilter }),
      ])
      const totale = depts.reduce((s,d) => s+(d.profit||0), 0)
      const scontrini = depts.reduce((s,d) => s+(d.billCount||0), 0)
      setData({ depts, cats, taxes, totale, scontrini, medio: scontrini>0?totale/scontrini:0 })
    } catch(e) { setError('Errore: ' + e.message) } finally { setLoading(false) }
  }, [token, from, to, selectedSp, salesPoints])

  useEffect(() => { loadData() }, [loadData])

  const totale = data?.totale||0
  const depts = data?.depts||[]
  const cats = data?.cats||[]
  const taxes = data?.taxes||[]

  const iStyle = { fontSize:'13px', padding:'5px 9px', border:'1px solid var(--border-md)', borderRadius:'var(--radius-sm)', background:'var(--surface)', color:'var(--text)', cursor:'pointer' }

  return <div style={{minHeight:'100vh',background:'var(--bg)'}}>
    <div style={{background:'var(--surface)',borderBottom:'1px solid var(--border)',padding:'0 1.5rem',display:'flex',alignItems:'center',justifyContent:'space-between',height:'56px',position:'sticky',top:0,zIndex:10}}>
      <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
        <span style={{fontSize:'15px',fontWeight:'600',letterSpacing:'-0.01em'}}>CIC Dashboard</span>
        {salesPoints.length > 0 && (
          <select value={selectedSp} onChange={e => setSelectedSp(e.target.value)} style={iStyle}>
            <option value="all">Tutti i locali</option>
            {salesPoints.map(sp => <option key={sp.id} value={sp.id}>{sp.name||sp.description||'Locale '+sp.id}</option>)}
          </select>
        )}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={iStyle} />
        <span style={{fontSize:'13px',color:'var(--text3)'}}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={iStyle} />
        <button onClick={loadData} style={{...iStyle, background:'var(--blue)', color:'#fff', border:'none', fontWeight:'500'}}>Aggiorna</button>
        <button onClick={() => supabase.auth.signOut()} style={{...iStyle, background:'transparent', color:'var(--text3)'}}>Esci</button>
      </div>
    </div>

    <div style={{padding:'1.5rem',maxWidth:'1200px',margin:'0 auto'}}>
      {error && <div style={{background:'var(--red-bg)',border:'1px solid rgba(153,27,27,.15)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:'13px',color:'var(--red)',marginBottom:'1.25rem'}}>{error}</div>}
      {loading ? <Loader /> : <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'12px',marginBottom:'1.25rem'}}>
          <KpiCard label="Ricavi totali" value={fmt(totale)} sub={from+' → '+to} />
          <KpiCard label="Scontrini" value={fmtN(data?.scontrini)} sub="documenti emessi" color="var(--text)" />
          <KpiCard label="Scontrino medio" value={fmt(data?.medio)} sub="per documento" color="var(--green)" />
          <KpiCard label="Reparti attivi" value={depts.filter(d=>d.profit>0).length} sub="con ricavi" color="var(--text)" />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'1.25rem'}}>
          <Section title="Venduto per reparto">
            {depts.length===0 ? <div style={{fontSize:'13px',color:'var(--text3)',textAlign:'center',padding:'1rem'}}>Nessun dato</div>
              : depts.filter(d=>d.profit>0).sort((a,b)=>b.profit-a.profit).map((d,i) => <BarRow key={i} label={d.department?.description||'Reparto'} value={d.profit} total={totale} color={i===0?'var(--blue)':i===1?'#6B7FCC':'#9BA8D9'} />)}
          </Section>
          <Section title="Venduto per categoria">
            {cats.length===0 ? <div style={{fontSize:'13px',color:'var(--text3)',textAlign:'center',padding:'1rem'}}>Nessun dato</div>
              : cats.filter(c=>c.totalSold>0).sort((a,b)=>b.totalSold-a.totalSold).slice(0,8).map((c,i) => <BarRow key={i} label={c.category?.description||'Categoria'} value={c.totalSold} total={cats.reduce((s,x)=>s+(x.totalSold||0),0)} color={i===0?'#16A34A':i===1?'#4ADE80':'#86EFAC'} />)}
          </Section>
        </div>
        <Section title="Riepilogo IVA">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Aliquota IVA','Imponibile','IVA','Totale lordo','% sul totale'].map(h => <th key={h} style={{padding:'6px 12px 10px',textAlign:'left',fontWeight:'500',fontSize:'11px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.04em'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {taxes.length===0 ? <tr><td colSpan={5} style={{padding:'1rem',textAlign:'center',color:'var(--text3)'}}>Nessun dato</td></tr>
                  : taxes.map((t,i) => {
                    const lordo=(t.taxable||0)+(t.tax||0)
                    return <tr key={i} style={{borderBottom:'1px solid var(--border)'}} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'10px 12px',fontWeight:'500'}}>{t.tax?.rate??'—'}%</td>
                      <td style={{padding:'10px 12px'}}>{fmt(t.taxable)}</td>
                      <td style={{padding:'10px 12px',color:'var(--text2)'}}>{fmt(lordo-(t.taxable||0))}</td>
                      <td style={{padding:'10px 12px',fontWeight:'500'}}>{fmt(lordo)}</td>
                      <td style={{padding:'10px 12px',color:'var(--text3)'}}>{pct(lordo,totale)}</td>
                    </tr>
                  })}
              </tbody>
              {taxes.length>0 && <tfoot><tr style={{borderTop:'2px solid var(--border)',background:'var(--surface2)'}}>
                <td style={{padding:'10px 12px',fontWeight:'500'}}>Totale</td>
                <td style={{padding:'10px 12px',fontWeight:'500'}}>{fmt(taxes.reduce((s,t)=>s+(t.taxable||0),0))}</td>
                <td style={{padding:'10px 12px'}} />
                <td style={{padding:'10px 12px',fontWeight:'500',color:'var(--blue)'}}>{fmt(totale)}</td>
                <td style={{padding:'10px 12px',fontWeight:'500'}}>100%</td>
              </tr></tfoot>}
            </table>
          </div>
        </Section>
      </>}
    </div>
  </div>
}
