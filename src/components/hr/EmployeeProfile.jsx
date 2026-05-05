import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmt, fmtD, fmtN } from '../shared/styles.jsx'

// Calcola ore lavorate da ora_inizio e ora_fine (gestisce superamento mezzanotte)
function calcShiftHours(inizio, fine) {
  if (!inizio || !fine) return 0
  const [h1, m1] = inizio.split(':').map(Number)
  const [h2, m2] = fine.split(':').map(Number)
  let startMin = h1 * 60 + (m1 || 0)
  let endMin = h2 * 60 + (m2 || 0)
  if (endMin <= startMin) endMin += 24 * 60
  return Math.round((endMin - startMin) / 60 * 10) / 10
}

export default function EmployeeProfile({ employee, onClose, onUpdate, sps = [] }) {
  const [emp, setEmp] = useState(employee)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [payHistory, setPayHistory] = useState([])
  const [timeOff, setTimeOff] = useState([])
  const [subTab, setSubTab] = useState('info')
  const [showPayForm, setShowPayForm] = useState(false)
  const [payForm, setPayForm] = useState({mese:'',retribuzione_lorda:'',retribuzione_netta:'',costo_azienda:'',ore_lavorate:'',ore_straordinario:'',note:''})
  const [showTimeOffForm, setShowTimeOffForm] = useState(false)
  const [timeOffForm, setTimeOffForm] = useState({tipo:'ferie',data_inizio:'',data_fine:'',ore:'',stato:'approvato',note:''})
  const [shifts, setShifts] = useState([])
  const [attendance, setAttendance] = useState([])

  const iS = S.input

  const loadPayHistory = useCallback(async () => {
    const { data } = await supabase.from('employee_pay_history').select('*').eq('employee_id', employee.id).order('mese', { ascending: false })
    setPayHistory(data || [])
  }, [employee.id])

  const loadTimeOff = useCallback(async () => {
    const { data } = await supabase.from('employee_time_off').select('*').eq('employee_id', employee.id).order('data_inizio', { ascending: false })
    setTimeOff(data || [])
  }, [employee.id])

  const loadShifts = useCallback(async () => {
    const { data } = await supabase.from('employee_shifts').select('*').eq('employee_id', employee.id).order('settimana', { ascending: false })
    setShifts(data || [])
  }, [employee.id])

  const loadAttendance = useCallback(async () => {
    const { data } = await supabase.from('attendance').select('*').eq('employee_id', employee.id).order('timestamp', { ascending: false }).limit(200)
    setAttendance(data || [])
  }, [employee.id])

  useEffect(() => { loadPayHistory(); loadTimeOff(); loadShifts(); loadAttendance() }, [loadPayHistory, loadTimeOff, loadShifts, loadAttendance])

  const startEdit = () => { setForm({...emp}); setEditing(true) }
  const saveEdit = async () => {
    const { id, created_at, user_id, ...fields } = form
    await supabase.from('employees').update(fields).eq('id', emp.id)
    setEmp({...emp, ...fields}); setEditing(false)
    if (onUpdate) onUpdate()
  }

  const savePay = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('employee_pay_history').upsert({
      user_id: user.id, employee_id: emp.id, mese: payForm.mese + '-01',
      retribuzione_lorda: Number(payForm.retribuzione_lorda) || null,
      retribuzione_netta: Number(payForm.retribuzione_netta) || null,
      costo_azienda: Number(payForm.costo_azienda) || null,
      ore_lavorate: Number(payForm.ore_lavorate) || null,
      ore_straordinario: Number(payForm.ore_straordinario) || null,
      note: payForm.note
    }, { onConflict: 'employee_id,mese' })
    setShowPayForm(false); setPayForm({mese:'',retribuzione_lorda:'',retribuzione_netta:'',costo_azienda:'',ore_lavorate:'',ore_straordinario:'',note:''})
    await loadPayHistory()
  }

  const saveTimeOff = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('employee_time_off').insert({
      user_id: user.id, employee_id: emp.id,
      tipo: timeOffForm.tipo, data_inizio: timeOffForm.data_inizio, data_fine: timeOffForm.data_fine,
      ore: Number(timeOffForm.ore) || null, stato: timeOffForm.stato, note: timeOffForm.note
    })
    setShowTimeOffForm(false); setTimeOffForm({tipo:'ferie',data_inizio:'',data_fine:'',ore:'',stato:'approvato',note:''})
    await loadTimeOff()
  }

  const deleteTimeOff = async (id) => {
    await supabase.from('employee_time_off').delete().eq('id', id)
    await loadTimeOff()
  }

  const tabStyle = (t) => ({padding:'6px 14px',borderRadius:6,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',
    background:subTab===t?'#F59E0B':'transparent',color:subTab===t?'#0f1420':'#64748b',transition:'all .2s'})
  const formStyle = {...iS, width:'100%', marginBottom:8}

  // Calcoli saldi
  const oreContrattualiMese = (emp.ore_contrattuali || 0) * 4.33
  const totOreLavorate = payHistory.reduce((s,p) => s + (Number(p.ore_lavorate) || 0), 0)
  const totStraordinario = payHistory.reduce((s,p) => s + (Number(p.ore_straordinario) || 0), 0)
  const ferieTotali = timeOff.filter(t => t.tipo === 'ferie')
  const permessiTotali = timeOff.filter(t => t.tipo === 'permesso')
  const bancaOre = timeOff.filter(t => t.tipo === 'banca_ore')
  const oreFerie = ferieTotali.reduce((s,t) => s + (Number(t.ore) || 8), 0)
  const orePermessi = permessiTotali.reduce((s,t) => s + (Number(t.ore) || 8), 0)

  return <div style={{...S.card, position:'relative'}}>
    {/* Header */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:48,height:48,borderRadius:'50%',background:'#2a3042',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:700,color:'#F59E0B'}}>
          {emp.nome?.charAt(0)?.toUpperCase()}
        </div>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:'#f1f5f9'}}>{emp.nome}</div>
          <div style={{fontSize:12,color:'#94a3b8'}}>{emp.ruolo} - {emp.locale}</div>
        </div>
        <span style={S.badge(emp.stato==='Attivo'?'#10B981':'#EF4444',emp.stato==='Attivo'?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)')}>{emp.stato}</span>
      </div>
      <div style={{display:'flex',gap:8}}>
        {!editing&&<button onClick={startEdit} style={{...iS,background:'#3B82F6',color:'#fff',border:'none',padding:'5px 14px',fontWeight:600,fontSize:12}}>Modifica</button>}
        <button onClick={onClose} style={{...iS,color:'#64748b',border:'1px solid #2a3042',padding:'5px 12px',fontSize:12}}>Chiudi</button>
      </div>
    </div>

    {/* Sub-tabs */}
    <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'1px solid #2a3042',paddingBottom:8,flexWrap:'wrap'}}>
      {[['info','Anagrafica'],['paga','Compensi'],['timeoff','Ferie/Permessi'],['ore','Banca Ore'],['consumi','🍪 Consumi'],['produzioni','🥘 Produzioni'],['permessi','🔐 Permessi app']].map(([k,l])=>
        <button key={k} onClick={()=>setSubTab(k)} style={tabStyle(k)}>{l}</button>
      )}
    </div>

    {/* ANAGRAFICA */}
    {subTab==='info'&&<>
      {editing ? (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
          {[['nome','Nome *'],['ruolo','Ruolo'],['telefono','Telefono'],['email','Email'],['cf','Codice Fiscale'],
            ['indirizzo','Indirizzo'],['iban','IBAN'],['tipo_contratto','Tipo Contratto'],['livello','Livello CCNL'],
            ['ore_contrattuali','Ore settimanali'],['costo_orario','Costo orario €'],['retribuzione_lorda','Retribuzione lorda €']
          ].map(([k,l])=>
            <input key={k} placeholder={l} value={form[k]||''} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} style={formStyle}/>
          )}
          <div style={{...formStyle,display:'flex',gap:12,alignItems:'center',padding:'8px 10px'}}>
            <span style={{fontSize:11,color:'#64748b'}}>Locali:</span>
            {sps.map(s=>{
              const name = s.description||s.name
              const locales = (form.locale||'').split(',').filter(Boolean)
              const checked = locales.includes(name)
              return <label key={s.id} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#e2e8f0',cursor:'pointer'}}>
                <input type="checkbox" checked={checked} onChange={()=>{
                  const next = checked ? locales.filter(l=>l!==name) : [...locales, name]
                  setForm(p=>({...p,locale:next.join(',')}))
                }}/>
                {name}
              </label>
            })}
          </div>
          <input type="date" value={form.data_nascita||''} onChange={e=>setForm(p=>({...p,data_nascita:e.target.value}))} style={formStyle} title="Data nascita"/>
          <input type="date" value={form.data_assunzione||''} onChange={e=>setForm(p=>({...p,data_assunzione:e.target.value}))} style={formStyle} title="Data assunzione"/>
          <input type="date" value={form.data_fine_contratto||''} onChange={e=>setForm(p=>({...p,data_fine_contratto:e.target.value}))} style={formStyle} title="Fine contratto"/>
          <textarea placeholder="Note" value={form.note||''} onChange={e=>setForm(p=>({...p,note:e.target.value}))} style={{...formStyle,gridColumn:'1/4',minHeight:60}} />
          <div style={{display:'flex',gap:8}}>
            <button onClick={saveEdit} style={{...iS,background:'#10B981',color:'#fff',border:'none',padding:'6px 16px',fontWeight:600}}>Salva</button>
            <button onClick={()=>setEditing(false)} style={{...iS,color:'#64748b',border:'1px solid #2a3042',padding:'6px 12px'}}>Annulla</button>
          </div>
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
          {[['Telefono',emp.telefono],['Email',emp.email],['Codice Fiscale',emp.cf],['Indirizzo',emp.indirizzo],['IBAN',emp.iban],
            ['Tipo Contratto',emp.tipo_contratto],['Livello CCNL',emp.livello],['Ore settimanali',emp.ore_contrattuali],
            ['Costo orario',emp.costo_orario?fmtD(emp.costo_orario):null],['Retribuzione lorda',emp.retribuzione_lorda?fmtD(emp.retribuzione_lorda):null],
            ['Data nascita',emp.data_nascita],['Data assunzione',emp.data_assunzione],['Fine contratto',emp.data_fine_contratto]
          ].map(([l,v])=>
            <div key={l}>
              <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{l}</div>
              <div style={{fontSize:13,color:v?'#e2e8f0':'#475569'}}>{v||'—'}</div>
            </div>
          )}
          {emp.note&&<div style={{gridColumn:'1/4'}}>
            <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Note</div>
            <div style={{fontSize:13,color:'#e2e8f0'}}>{emp.note}</div>
          </div>}
        </div>
      )}
    </>}

    {/* COMPENSI */}
    {subTab==='paga'&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
        <KPI label="Retribuzione lorda" icon="💶" value={emp.retribuzione_lorda?fmtD(emp.retribuzione_lorda):'—'} sub="mensile" accent='#F59E0B'/>
        <KPI label="Costo orario" icon="⏱️" value={emp.costo_orario?fmtD(emp.costo_orario):'—'} sub="azienda" accent='#3B82F6'/>
        <KPI label="Mesi registrati" icon="📊" value={payHistory.length} sub="storico" accent='#10B981'/>
      </div>

      <Card title="Storico compensi" extra={
        <button onClick={()=>setShowPayForm(true)} style={{...iS,background:'#3B82F6',color:'#fff',border:'none',padding:'4px 12px',fontWeight:600,fontSize:11}}>+ Aggiungi mese</button>
      }>
        {showPayForm&&<div style={{background:'#131825',borderRadius:8,padding:12,marginBottom:12,border:'1px solid #2a3042'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:8}}>
            <input type="month" value={payForm.mese} onChange={e=>setPayForm(p=>({...p,mese:e.target.value}))} style={formStyle} title="Mese"/>
            <input type="number" placeholder="Lordo €" value={payForm.retribuzione_lorda} onChange={e=>setPayForm(p=>({...p,retribuzione_lorda:e.target.value}))} style={formStyle}/>
            <input type="number" placeholder="Netto €" value={payForm.retribuzione_netta} onChange={e=>setPayForm(p=>({...p,retribuzione_netta:e.target.value}))} style={formStyle}/>
            <input type="number" placeholder="Costo azienda €" value={payForm.costo_azienda} onChange={e=>setPayForm(p=>({...p,costo_azienda:e.target.value}))} style={formStyle}/>
            <input type="number" placeholder="Ore lavorate" value={payForm.ore_lavorate} onChange={e=>setPayForm(p=>({...p,ore_lavorate:e.target.value}))} style={formStyle}/>
            <input type="number" placeholder="Straordinario" value={payForm.ore_straordinario} onChange={e=>setPayForm(p=>({...p,ore_straordinario:e.target.value}))} style={formStyle}/>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={savePay} disabled={!payForm.mese} style={{...iS,background:'#10B981',color:'#fff',border:'none',padding:'5px 14px',fontWeight:600,fontSize:11}}>Salva</button>
            <button onClick={()=>setShowPayForm(false)} style={{...iS,color:'#64748b',border:'1px solid #2a3042',padding:'5px 10px',fontSize:11}}>Annulla</button>
          </div>
        </div>}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
            {['Mese','Lordo','Netto','Costo Azienda','Ore','Straord.','Note'].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {payHistory.length===0&&<tr><td colSpan={7} style={{...S.td,color:'#475569',textAlign:'center',padding:16}}>Nessun dato. Aggiungi un mese.</td></tr>}
            {payHistory.map(p=><tr key={p.id}>
              <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{p.mese?.substring(0,7)}</td>
              <td style={{...S.td,fontWeight:500}}>{p.retribuzione_lorda?fmtD(p.retribuzione_lorda):'—'}</td>
              <td style={S.td}>{p.retribuzione_netta?fmtD(p.retribuzione_netta):'—'}</td>
              <td style={S.td}>{p.costo_azienda?fmtD(p.costo_azienda):'—'}</td>
              <td style={{...S.td,color:'#94a3b8'}}>{p.ore_lavorate||'—'}</td>
              <td style={{...S.td,color:'#94a3b8'}}>{p.ore_straordinario||'—'}</td>
              <td style={{...S.td,color:'#64748b',fontSize:11}}>{p.note||''}</td>
            </tr>)}
          </tbody>
        </table>
      </Card>
    </>}

    {/* FERIE / PERMESSI */}
    {subTab==='timeoff'&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
        <KPI label="Giorni ferie usati" icon="🏖️" value={ferieTotali.length} sub={oreFerie+' ore'} accent='#F59E0B'/>
        <KPI label="Permessi usati" icon="📋" value={permessiTotali.length} sub={orePermessi+' ore'} accent='#3B82F6'/>
        <KPI label="Malattia" icon="🏥" value={timeOff.filter(t=>t.tipo==='malattia').length} sub="giorni" accent='#EF4444'/>
      </div>

      <Card title="Registro ferie e permessi" extra={
        <button onClick={()=>setShowTimeOffForm(true)} style={{...iS,background:'#3B82F6',color:'#fff',border:'none',padding:'4px 12px',fontWeight:600,fontSize:11}}>+ Aggiungi</button>
      }>
        {showTimeOffForm&&<div style={{background:'#131825',borderRadius:8,padding:12,marginBottom:12,border:'1px solid #2a3042'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:8}}>
            <select value={timeOffForm.tipo} onChange={e=>setTimeOffForm(p=>({...p,tipo:e.target.value}))} style={formStyle}>
              {['ferie','permesso','malattia','banca_ore'].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <input type="date" value={timeOffForm.data_inizio} onChange={e=>setTimeOffForm(p=>({...p,data_inizio:e.target.value}))} style={formStyle} title="Dal"/>
            <input type="date" value={timeOffForm.data_fine} onChange={e=>setTimeOffForm(p=>({...p,data_fine:e.target.value}))} style={formStyle} title="Al"/>
            <input type="number" placeholder="Ore" value={timeOffForm.ore} onChange={e=>setTimeOffForm(p=>({...p,ore:e.target.value}))} style={formStyle}/>
            <select value={timeOffForm.stato} onChange={e=>setTimeOffForm(p=>({...p,stato:e.target.value}))} style={formStyle}>
              {['richiesto','approvato','rifiutato'].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={saveTimeOff} disabled={!timeOffForm.data_inizio||!timeOffForm.data_fine} style={{...iS,background:'#10B981',color:'#fff',border:'none',padding:'5px 14px',fontWeight:600,fontSize:11}}>Salva</button>
            <button onClick={()=>setShowTimeOffForm(false)} style={{...iS,color:'#64748b',border:'1px solid #2a3042',padding:'5px 10px',fontSize:11}}>Annulla</button>
          </div>
        </div>}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
            {['Tipo','Dal','Al','Ore','Stato',''].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {timeOff.length===0&&<tr><td colSpan={6} style={{...S.td,color:'#475569',textAlign:'center',padding:16}}>Nessun dato registrato.</td></tr>}
            {timeOff.map(t=>{
              const colors = {ferie:'#F59E0B',permesso:'#3B82F6',malattia:'#EF4444',banca_ore:'#8B5CF6'}
              const statColors = {approvato:'#10B981',richiesto:'#F59E0B',rifiutato:'#EF4444'}
              return <tr key={t.id}>
                <td style={S.td}><span style={S.badge(colors[t.tipo]||'#94a3b8',(colors[t.tipo]||'#94a3b8')+'22')}>{t.tipo}</span></td>
                <td style={{...S.td,color:'#e2e8f0'}}>{t.data_inizio}</td>
                <td style={{...S.td,color:'#94a3b8'}}>{t.data_fine}</td>
                <td style={{...S.td,color:'#94a3b8'}}>{t.ore||'—'}</td>
                <td style={S.td}><span style={S.badge(statColors[t.stato]||'#94a3b8',(statColors[t.stato]||'#94a3b8')+'22')}>{t.stato}</span></td>
                <td style={S.td}><button onClick={()=>{if(confirm('Eliminare?'))deleteTimeOff(t.id)}} style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:11}}>Elimina</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </Card>
    </>}

    {/* BANCA ORE */}
    {subTab==='ore'&&(()=>{
      // Calcola ore reali dalle timbrature raggruppate per giorno
      const attByDay = {}
      for (const a of attendance) {
        const day = a.timestamp?.substring(0,10)
        if (!day) continue
        if (!attByDay[day]) attByDay[day] = []
        attByDay[day].push(a)
      }
      let totRealHours = 0
      const dailyHours = Object.entries(attByDay).map(([day, records]) => {
        records.sort((a,b) => a.timestamp.localeCompare(b.timestamp))
        let hours = 0, entrata = null
        for (const r of records) {
          if (r.tipo === 'entrata' && !entrata) entrata = r.timestamp
          if (r.tipo === 'uscita' && entrata) { hours += (new Date(r.timestamp) - new Date(entrata)) / 3600000; entrata = null }
        }
        totRealHours += hours
        const entrataR = records.find(r => r.tipo === 'entrata')
        const uscitaR = [...records].reverse().find(r => r.tipo === 'uscita')
        return { day, hours: Math.round(hours*10)/10, entrata: entrataR?.timestamp, uscita: uscitaR?.timestamp, locale: records[0]?.locale }
      }).sort((a,b) => b.day.localeCompare(a.day))
      totRealHours = Math.round(totRealHours*10)/10

      return <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        <KPI label="Ore contrattuali" icon="📄" value={emp.ore_contrattuali||'—'} sub="settimanali" accent='#3B82F6'/>
        <KPI label="Ore reali timbrate" icon="⏱️" value={totRealHours+'h'} sub={dailyHours.length+' giorni'} accent='#10B981'/>
        <KPI label="Ore da turni" icon="📅" value={shifts.reduce((s,sh)=>s+calcShiftHours(sh.ora_inizio,sh.ora_fine),0)+'h'} sub={shifts.length+' turni'} accent='#8B5CF6'/>
        <KPI label="Tot. straordinario" icon="⚡" value={totStraordinario||'—'} sub="ore extra" accent='#F59E0B'/>
      </div>

      {/* Timbrature reali per giorno — editabili */}
      <Card title="Ore reali (da timbrature)" badge={totRealHours+'h totali'} extra={
        <button onClick={() => {
          const today = new Date().toISOString().split('T')[0]
          const newRec = { employee_id: employee.id, timestamp: today+'T09:00:00', tipo: 'entrata', locale: emp.locale?.split(',')[0] || '' }
          supabase.from('attendance').insert(newRec).then(() => loadAttendance())
        }} style={{...S.input,background:'#3B82F6',color:'#fff',border:'none',padding:'4px 12px',fontWeight:600,fontSize:11}}>+ Aggiungi ore</button>
      }>
        {dailyHours.length === 0 ? (
          <div style={{color:'#475569',textAlign:'center',padding:16,fontSize:13}}>Nessuna timbratura registrata. Clicca "+ Aggiungi ore" per inserire manualmente.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
              {['Data','Entrata','Uscita','Ore','Locale',''].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {dailyHours.slice(0,30).map(d => {
                const entrataTime = d.entrata ? new Date(d.entrata).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : ''
                const uscitaTime = d.uscita ? new Date(d.uscita).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : ''
                const entrataId = attendance.find(a => a.timestamp === d.entrata)?.id
                const uscitaId = attendance.find(a => a.timestamp === d.uscita)?.id

                const updateTime = async (id, timestamp, newTime) => {
                  if (!newTime || !id) return
                  const day = timestamp.substring(0,10)
                  const newTs = day + 'T' + newTime + ':00'
                  await supabase.from('attendance').update({ timestamp: newTs }).eq('id', id)
                  loadAttendance()
                }

                const addExit = async () => {
                  const day = d.day
                  await supabase.from('attendance').insert({ employee_id: employee.id, timestamp: day+'T18:00:00', tipo: 'uscita', locale: d.locale || '' })
                  loadAttendance()
                }

                const deleteDay = async () => {
                  const dayRecords = attendance.filter(a => a.timestamp?.startsWith(d.day) && a.employee_id === employee.id)
                  for (const r of dayRecords) {
                    await supabase.from('attendance').delete().eq('id', r.id)
                  }
                  loadAttendance()
                }

                return <tr key={d.day}>
                  <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{new Date(d.day+'T12:00:00').toLocaleDateString('it-IT',{weekday:'short',day:'2-digit',month:'2-digit'})}</td>
                  <td style={S.td}>
                    <input type="time" value={entrataTime} onChange={e => updateTime(entrataId, d.entrata, e.target.value)}
                      style={{...S.input,width:80,fontSize:12,padding:'2px 6px',color:'#10B981',fontWeight:600}} />
                  </td>
                  <td style={S.td}>
                    {d.uscita ? (
                      <input type="time" value={uscitaTime} onChange={e => updateTime(uscitaId, d.uscita, e.target.value)}
                        style={{...S.input,width:80,fontSize:12,padding:'2px 6px',color:'#94a3b8'}} />
                    ) : (
                      <button onClick={addExit} style={{...S.input,fontSize:10,padding:'2px 8px',color:'#F59E0B',border:'1px solid #F59E0B',background:'transparent'}}>+ Uscita</button>
                    )}
                  </td>
                  <td style={{...S.td,fontWeight:600,color:d.hours>0?'#e2e8f0':'#475569'}}>{d.hours>0?d.hours+'h':'—'}</td>
                  <td style={{...S.td,color:'#64748b',fontSize:11}}>{d.locale}</td>
                  <td style={S.td}>
                    <button onClick={deleteDay} style={{background:'transparent',border:'none',color:'#475569',cursor:'pointer',fontSize:14}} title="Elimina">🗑️</button>
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        )}
      </Card>
      {dailyHours.length > 0 && <div style={{marginTop:12}}/>}

      {/* Turni pianificati */}
      {shifts.length > 0 && <Card title="Turni pianificati">
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
            {['Settimana','Giorno','Dalle','Alle','Ore','Locale'].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {shifts.slice(0,20).map(sh=>{
              const hours = calcShiftHours(sh.ora_inizio, sh.ora_fine)
              const days=['Lun','Mar','Mer','Gio','Ven','Sab','Dom']
              return <tr key={sh.id}>
                <td style={{...S.td,color:'#F59E0B',fontWeight:600}}>{sh.settimana}</td>
                <td style={{...S.td,fontWeight:500}}>{days[sh.giorno]||sh.giorno}</td>
                <td style={{...S.td,color:'#10B981'}}>{sh.ora_inizio?.substring(0,5)}</td>
                <td style={{...S.td,color:'#94a3b8'}}>{sh.ora_fine?.substring(0,5)}</td>
                <td style={{...S.td,fontWeight:600}}>{hours}h</td>
                <td style={{...S.td,color:'#64748b',fontSize:11}}>{sh.locale}</td>
              </tr>
            })}
          </tbody>
        </table>
      </Card>}
      {shifts.length > 0 && <div style={{marginTop:12}}/>}

      <Card title="Distribuzione ore (storico compensi)">
        {payHistory.length === 0 ? (
          <div style={{color:'#475569',textAlign:'center',padding:20,fontSize:13}}>Inserisci i dati nello storico compensi per vedere la distribuzione ore.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
              {['Mese','Ore contrattuali','Ore lavorate','Straordinario','Differenza'].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {payHistory.map(p => {
                const contratto = oreContrattualiMese
                const lavorate = Number(p.ore_lavorate) || 0
                const diff = lavorate - contratto
                return <tr key={p.id}>
                  <td style={{...S.td,fontWeight:600,color:'#F59E0B'}}>{p.mese?.substring(0,7)}</td>
                  <td style={{...S.td,color:'#94a3b8'}}>{contratto.toFixed(0)}</td>
                  <td style={{...S.td,fontWeight:500}}>{lavorate||'—'}</td>
                  <td style={{...S.td,color:'#F59E0B'}}>{p.ore_straordinario||'0'}</td>
                  <td style={{...S.td,fontWeight:600,color:diff>=0?'#10B981':'#EF4444'}}>{diff>=0?'+':''}{diff.toFixed(0)}h</td>
                </tr>
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>})()}

    {/* PERMESSI APP DIPENDENTE */}
    {subTab==='consumi' && <ConsumiTab emp={emp} />}
    {subTab==='produzioni' && <ProduzioniTab emp={emp} />}
    {subTab==='permessi' && <PermessiTab emp={emp} onSaved={(newPerms)=>{ setEmp({...emp, permissions: newPerms}); if (onUpdate) onUpdate() }} />}
  </div>
}

function PermessiTab({ emp, onSaved }) {
  const perms = emp.permissions || { presenza: true, inventario: false, spostamenti: false, consumo: false }
  // Normalizza il formato vecchio (singolo id) in array
  const normalize = (x) => {
    const next = { ...x }
    if (next.checklist_entrata_id && !next.checklist_entrata_ids) next.checklist_entrata_ids = [next.checklist_entrata_id]
    if (next.checklist_uscita_id  && !next.checklist_uscita_ids)  next.checklist_uscita_ids  = [next.checklist_uscita_id]
    if (!next.checklist_entrata_ids) next.checklist_entrata_ids = []
    if (!next.checklist_uscita_ids)  next.checklist_uscita_ids  = []
    delete next.checklist_entrata_id
    delete next.checklist_uscita_id
    return next
  }
  const [p, setP] = useState(normalize(perms))
  const [saving, setSaving] = useState(false)
  const [checklists, setChecklists] = useState([])

  // Carica TUTTE le checklist attive (di qualsiasi locale) — il dipendente
  // può lavorare su più locali e quindi avere checklist di più locali.
  useEffect(() => {
    supabase.from('attendance_checklists').select('id,nome,locale,reparto,momento,attivo')
      .eq('attivo', true).order('locale').order('reparto').order('momento')
      .then(({ data }) => setChecklists(data || []))
  }, [])

  const toggle = (k) => setP(prev => ({ ...prev, [k]: !prev[k] }))
  const toggleChecklist = (key, id) => setP(prev => {
    const arr = Array.isArray(prev[key]) ? prev[key] : []
    return { ...prev, [key]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] }
  })
  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('employees').update({ permissions: p }).eq('id', emp.id)
    setSaving(false)
    if (error) { alert('Errore: ' + error.message); return }
    if (onSaved) onSaved(p)
    alert('Permessi salvati')
  }

  const items = [
    { k: 'presenza',    t: '🕐 Timbratura presenza', d: 'Il dipendente puo\' bollare entrata/uscita dal QR' },
    { k: 'consumo',     t: '🍪 Consumo personale', d: 'Puo\' registrare consumi personali (scarica dal magazzino e crea log per dipendente)' },
    { k: 'spostamenti', t: '🔀 Spostamenti tra locali', d: 'Puo\' spostare merce da un locale all\'altro (es. REMEMBEER → CASA DE AMICIS)' },
    { k: 'inventario',  t: '📋 Inventario', d: 'Puo\' aprire, contare e chiudere inventari del locale' },
    { k: 'produzione',  t: '🥘 Produzione', d: 'Puo\' avviare e completare lotti di produzione interna (tiramisù, farinate, salse, ecc.) con tracking durata, foto e checklist HACCP' },
    { k: 'task_create',   t: '➕ Crea task',   d: 'Puo\' creare nuove task one-shot dal calendario /timbra e assegnarle a se\' o ai sottoposti' },
    { k: 'task_dispatch', t: '↪ Smista task', d: 'Puo\' ricevere task dalla direzione e smistarle ai propri sottoposti (richiede manager_id sui sottoposti)' },
  ]

  // Raggruppa per locale → mostro una sezione per locale per leggibilità
  const groupByLocale = (list) => {
    const map = {}
    for (const c of list) { (map[c.locale] = map[c.locale] || []).push(c) }
    return map
  }
  const entrataByLoc = groupByLocale(checklists.filter(c => c.momento === 'entrata'))
  const uscitaByLoc  = groupByLocale(checklists.filter(c => c.momento === 'uscita'))

  const renderChecklistGroup = (key, byLoc, accent) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Object.entries(byLoc).length === 0 && (
        <div style={{ fontSize: 11, color: '#64748b' }}>Nessuna checklist disponibile.</div>
      )}
      {Object.entries(byLoc).map(([loc, list]) => (
        <div key={loc} style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{loc}</div>
          {list.map(c => {
            const checked = (p[key] || []).includes(c.id)
            return <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={checked} onChange={() => toggleChecklist(key, c.id)} style={{ accentColor: accent }} />
              <span style={{ color: checked ? accent : '#e2e8f0', fontWeight: checked ? 600 : 400 }}>
                {c.reparto} · {c.nome}
              </span>
            </label>
          })}
        </div>
      ))}
    </div>
  )

  return <Card title="Permessi app dipendente" badge={Object.values(p).filter(v => v === true).length + '/5 abilitati'}>
    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>
      Definisci cosa puo\' fare <strong style={{ color: '#e2e8f0' }}>{emp.nome}</strong> dopo aver inserito il PIN sulla pagina di timbratura.
      Il menu delle azioni nell\'app mobile verra\' filtrato automaticamente.
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(it => (
        <label key={it.k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: p[it.k] ? 'rgba(16,185,129,.06)' : '#131825', border: `1px solid ${p[it.k] ? '#10B981' : '#2a3042'}`, borderRadius: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!p[it.k]} onChange={() => toggle(it.k)} style={{ marginTop: 3, accentColor: '#10B981', width: 18, height: 18 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: p[it.k] ? '#10B981' : '#e2e8f0' }}>{it.t}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{it.d}</div>
          </div>
        </label>
      ))}
    </div>

    {/* Checklist obbligatorie entrata/uscita */}
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #2a3042' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>📋 Checklist obbligatorie alla timbratura</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
        Seleziona le checklist che <strong style={{ color: '#e2e8f0' }}>{emp.nome}</strong> dovrà compilare quando timbra.
        Se lavora su più locali, seleziona la checklist di ognuno: il sistema mostrerà automaticamente quella giusta in base al locale dove sta timbrando.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700, marginBottom: 6 }}>🟢 All'entrata ({(p.checklist_entrata_ids || []).length})</div>
          {renderChecklistGroup('checklist_entrata_ids', entrataByLoc, '#10B981')}
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 700, marginBottom: 6 }}>🔴 All'uscita ({(p.checklist_uscita_ids || []).length})</div>
          {renderChecklistGroup('checklist_uscita_ids', uscitaByLoc, '#EF4444')}
        </div>
      </div>
      {checklists.length === 0 && (
        <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 8 }}>
          Nessuna checklist attiva. Creale prima nella sezione "📋 Checklist timbratura" del modulo Personale.
        </div>
      )}
    </div>

    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
      <button onClick={save} disabled={saving}
        style={{ background: '#F59E0B', color: '#0f1420', border: 'none', padding: '8px 18px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: saving ? 'wait' : 'pointer' }}>
        {saving ? 'Salvo...' : 'Salva permessi'}
      </button>
    </div>
  </Card>
}


// ─── CONSUMI PERSONALI ───────────────────────────────────────────────
// Storico dei consumi del dipendente, ricostruito da article_movement
// con fonte='consumo_dipendente' e riferimento_id=emp.id.
// Il riferimento_label contiene già il prodotto consumato e le porzioni
// (es. 'Consumo Mario Rossi · Pizza Margherita x2').
function ConsumiTab({ emp }) {
  const [consumi, setConsumi] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.from('article_movement')
        .select('id, created_at, locale, valore_totale, riferimento_label, note')
        .eq('riferimento_id', emp.id)
        .eq('fonte', 'consumo_dipendente')
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancelled) return
      // Raggruppo per timestamp+riferimento_label (un consumo = N righe ingredienti)
      const groups = {}
      for (const m of data || []) {
        const key = m.riferimento_label + '|' + m.created_at.substring(0, 19)
        if (!groups[key]) {
          groups[key] = {
            id: m.id, created_at: m.created_at, locale: m.locale,
            riferimento_label: m.riferimento_label, note: m.note,
            valore_totale: 0,
          }
        }
        groups[key].valore_totale += Number(m.valore_totale || 0)
      }
      // Estraggo nome prodotto + porzioni dal label
      const list = Object.values(groups).map(g => {
        // Pattern: 'Consumo <nome dipendente> · <prodotto>[ x<porzioni>]'
        const m = (g.riferimento_label || '').match(/^Consumo .+? · (.+?)(?:\s+x(\d+))?$/)
        return { ...g, prodotto: m?.[1] || g.riferimento_label, porzioni: m?.[2] ? Number(m[2]) : 1 }
      }).sort((a, b) => b.created_at.localeCompare(a.created_at))
      setConsumi(list)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [emp.id])

  // Statistiche
  const totConsumi = consumi.reduce((s, c) => s + c.porzioni, 0)
  const totValore = consumi.reduce((s, c) => s + (c.valore_totale || 0), 0)
  const today = new Date().toISOString().substring(0, 10)
  const oggi = consumi.filter(c => c.created_at.substring(0, 10) === today).length
  // Ultimi 30 giorni
  const trenta = new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10)
  const last30 = consumi.filter(c => c.created_at.substring(0, 10) >= trenta).length

  return <Card title='🍪 Consumi personali' badge={loading ? 'Caricamento…' : consumi.length + ' totali'}>
    {!loading && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <KPI label='Totali' icon='🍪' value={totConsumi} sub='porzioni' accent='#F59E0B' />
        <KPI label='Oggi' icon='📅' value={oggi} sub='consumi' accent='#10B981' />
        <KPI label='Ultimi 30gg' icon='📊' value={last30} sub='consumi' accent='#3B82F6' />
        <KPI label='Valore' icon='💰' value={fmtD(totValore)} sub='magazzino' accent='#EF4444' />
      </div>
    )}
    {loading ? (
      <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
    ) : consumi.length === 0 ? (
      <div style={{ padding: 24, color: '#64748b', textAlign: 'center', fontSize: 13 }}>Nessun consumo registrato.</div>
    ) : (
      <div style={{ overflowX: 'auto', maxHeight: 460 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#131825' }}>
            <tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Data', 'Locale', 'Prodotto', 'Porzioni', 'Valore', 'Note'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {consumi.map(c => {
              const dt = new Date(c.created_at)
              return <tr key={c.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 11, color: '#94a3b8' }}>
                  {dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  <span style={{ color: '#475569', marginLeft: 6 }}>{dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                </td>
                <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{c.locale || '—'}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{c.prodotto}</td>
                <td style={{ ...S.td, fontWeight: 700, color: '#F59E0B' }}>{c.porzioni}x</td>
                <td style={{ ...S.td, fontWeight: 600, color: '#EF4444' }}>{c.valore_totale > 0 ? fmtD(c.valore_totale) : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note || '—'}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}
  </Card>
}


// ─── PRODUZIONI ──────────────────────────────────────────────────────
// Storico lotti production_batches creati dal dipendente (operatore_id = emp.id)
function ProduzioniTab({ emp }) {
  const [batches, setBatches] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [b, r] = await Promise.all([
        supabase.from('production_batches').select('*').eq('operatore_id', emp.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('production_recipes').select('id,nome,resa_quantita,resa_unita,durata_attesa_minuti'),
      ])
      if (cancelled) return
      setBatches(b.data || [])
      setRecipes(r.data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [emp.id])

  const recipesById = Object.fromEntries(recipes.map(r => [r.id, r]))

  // Statistiche
  const totLotti = batches.length
  const today = new Date().toISOString().slice(0, 10)
  const oggi = batches.filter(b => b.data_produzione === today).length
  const trenta = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const last30 = batches.filter(b => b.data_produzione >= trenta).length
  const totDurata = batches.reduce((s, b) => s + (Number(b.durata_minuti) || 0), 0)
  const mediaDurata = totLotti > 0 ? Math.round(totDurata / totLotti) : 0

  // Anomalie
  const getAnomalie = (b) => {
    const anom = []
    const recipe = recipesById[b.recipe_id]
    if (recipe) {
      if (recipe.resa_quantita && b.quantita_prodotta) {
        const ratio = Number(b.quantita_prodotta) / Number(recipe.resa_quantita)
        if (ratio < 0.8 || ratio > 1.2) anom.push(`Resa ${Math.round(ratio * 100)}%`)
      }
      if (recipe.durata_attesa_minuti && b.durata_minuti && b.durata_minuti < recipe.durata_attesa_minuti * 0.5) {
        anom.push(`Solo ${b.durata_minuti}'`)
      }
    }
    if (b.checklist_haccp && typeof b.checklist_haccp === 'object') {
      const ko = Object.values(b.checklist_haccp).filter(v => v === false).length
      if (ko > 0) anom.push(`${ko} check KO`)
    }
    return anom
  }

  return <Card title='🥘 Produzioni' badge={loading ? 'Caricamento…' : totLotti + ' lotti totali'}>
    {!loading && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <KPI label='Lotti totali' icon='🥘' value={totLotti} sub='prodotti' accent='#EF4444' />
        <KPI label='Oggi' icon='📅' value={oggi} sub='lotti' accent='#10B981' />
        <KPI label='Ultimi 30gg' icon='📊' value={last30} sub='lotti' accent='#3B82F6' />
        <KPI label='Durata media' icon='⏱' value={mediaDurata + " '"} sub='per lotto' accent='#F59E0B' />
      </div>
    )}
    {loading ? (
      <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
    ) : totLotti === 0 ? (
      <div style={{ padding: 24, color: '#64748b', textAlign: 'center', fontSize: 13 }}>Nessun lotto registrato.</div>
    ) : (
      <div style={{ overflowX: 'auto', maxHeight: 500 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#131825' }}>
            <tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Data', 'Lotto', 'Prodotto', 'Locale', 'Quantità', 'Durata', 'Anomalie'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {batches.map(b => {
              const dt = b.data_produzione
              const ora = (b.ora_produzione || '').slice(0, 5)
              const recipe = recipesById[b.recipe_id]
              const anomalie = getAnomalie(b)
              return <tr key={b.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {dt} <span style={{ color: '#64748b', marginLeft: 4 }}>{ora}</span>
                </td>
                <td style={{ ...S.td, fontFamily: 'monospace', color: '#3B82F6', fontWeight: 600 }}>
                  {b.lotto}
                  {b.da_mobile && <span title='Da mobile' style={{ marginLeft: 4, fontSize: 11 }}>📱</span>}
                </td>
                <td style={{ ...S.td, fontWeight: 600 }}>{recipe?.nome || '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{b.locale_produzione}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{b.quantita_prodotta} {b.unita || ''}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{b.durata_minuti != null ? b.durata_minuti + ' min' : '—'}</td>
                <td style={S.td}>
                  {anomalie.length === 0 ? (
                    <span style={{ color: '#475569', fontSize: 11 }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      {anomalie.map((a, i) => (
                        <span key={i} style={{ ...S.badge('#F59E0B', 'rgba(245,158,11,.12)'), fontSize: 10 }}>⚠ {a}</span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}
  </Card>
}
