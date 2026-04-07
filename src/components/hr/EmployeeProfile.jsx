import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmt, fmtD, fmtN } from '../shared/styles.jsx'

export default function EmployeeProfile({ employee, onClose, onUpdate }) {
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

  const iS = S.input

  const loadPayHistory = useCallback(async () => {
    const { data } = await supabase.from('employee_pay_history').select('*').eq('employee_id', employee.id).order('mese', { ascending: false })
    setPayHistory(data || [])
  }, [employee.id])

  const loadTimeOff = useCallback(async () => {
    const { data } = await supabase.from('employee_time_off').select('*').eq('employee_id', employee.id).order('data_inizio', { ascending: false })
    setTimeOff(data || [])
  }, [employee.id])

  useEffect(() => { loadPayHistory(); loadTimeOff() }, [loadPayHistory, loadTimeOff])

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
    <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'1px solid #2a3042',paddingBottom:8}}>
      {[['info','Anagrafica'],['paga','Compensi'],['timeoff','Ferie/Permessi'],['ore','Banca Ore']].map(([k,l])=>
        <button key={k} onClick={()=>setSubTab(k)} style={tabStyle(k)}>{l}</button>
      )}
    </div>

    {/* ANAGRAFICA */}
    {subTab==='info'&&<>
      {editing ? (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
          {[['nome','Nome *'],['ruolo','Ruolo'],['locale','Locale'],['telefono','Telefono'],['email','Email'],['cf','Codice Fiscale'],
            ['indirizzo','Indirizzo'],['iban','IBAN'],['tipo_contratto','Tipo Contratto'],['livello','Livello CCNL'],
            ['ore_contrattuali','Ore settimanali'],['costo_orario','Costo orario €'],['retribuzione_lorda','Retribuzione lorda €']
          ].map(([k,l])=>
            <input key={k} placeholder={l} value={form[k]||''} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} style={formStyle}/>
          )}
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
    {subTab==='ore'&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
        <KPI label="Ore contrattuali" icon="📄" value={emp.ore_contrattuali||'—'} sub="settimanali" accent='#3B82F6'/>
        <KPI label="Tot. ore lavorate" icon="⏱️" value={totOreLavorate||'—'} sub="da storico compensi" accent='#10B981'/>
        <KPI label="Tot. straordinario" icon="⚡" value={totStraordinario||'—'} sub="ore extra" accent='#F59E0B'/>
      </div>

      <Card title="Distribuzione ore">
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
    </>}
  </div>
}
