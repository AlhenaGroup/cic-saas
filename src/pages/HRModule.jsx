import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { S, KPI, Card } from '../components/shared/styles.jsx'
import EmployeeProfile from '../components/hr/EmployeeProfile'
import ShiftAssistant from '../components/hr/ShiftAssistant'
import HRCalendar from '../components/hr/HRCalendar'
import AttendanceView from '../components/hr/AttendanceView'
import ChecklistManager from '../components/hr/ChecklistManager'
import TaskManager from '../components/hr/TaskManager'

export default function HRModule({ staffSchedule, setStaffSchedule, saveSchedule, sp, sps }) {
  const [employees, setEmployees]       = useState([])
  const [empDocs, setEmpDocs]           = useState([])
  const [showEmpForm, setShowEmpForm]   = useState(false)
  const [editEmp, setEditEmp]           = useState(null)
  const [empForm, setEmpForm]           = useState({nome:'',ruolo:'',locale:'',telefono:'',email:'',pin:''})
  const [showDocForm, setShowDocForm]   = useState(false)
  const [docForm, setDocForm]           = useState({employee_id:'',tipo:'Contratto',nome:'',scadenza:'',file:null})
  const [hrLoading, setHrLoading]       = useState(false)
  const [selectedEmp, setSelectedEmp]   = useState(null)

  const iS = S.input

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase.from('employees').select('*').order('created_at')
    setEmployees(data || [])
  }, [])
  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from('employee_documents').select('*').order('scadenza', { ascending: true, nullsFirst: false })
    setEmpDocs(data || [])
  }, [])

  useEffect(() => { loadEmployees(); loadDocs() }, [loadEmployees, loadDocs])

  const saveEmployee = async () => {
    setHrLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (editEmp) {
      await supabase.from('employees').update({ ...empForm, locale: empForm.locale || sp }).eq('id', editEmp.id)
    } else {
      await supabase.from('employees').insert({ ...empForm, user_id: user.id, locale: empForm.locale || (sps.find(s=>String(s.id)===sp)?.description) || '' })
    }
    setEmpForm({nome:'',ruolo:'',locale:'',telefono:'',email:'',pin:''}); setShowEmpForm(false); setEditEmp(null)
    await loadEmployees(); setHrLoading(false)
  }
  const deleteEmployee = async (id) => {
    await supabase.from('employees').delete().eq('id', id)
    await loadEmployees(); await loadDocs()
  }
  const saveDoc = async () => {
    setHrLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    let filePath = null
    if (docForm.file) {
      const ext = docForm.file.name.split('.').pop()
      const path = `${user.id}/${Date.now()}.${ext}`
      await supabase.storage.from('documents').upload(path, docForm.file)
      filePath = path
    }
    await supabase.from('employee_documents').insert({
      employee_id: docForm.employee_id, user_id: user.id,
      tipo: docForm.tipo, nome: docForm.nome,
      scadenza: docForm.scadenza || null, file_path: filePath
    })
    setDocForm({employee_id:'',tipo:'Contratto',nome:'',scadenza:'',file:null}); setShowDocForm(false)
    await loadDocs(); setHrLoading(false)
    // Trigger parsing se è un file parsabile
    if (filePath && ['pdf','xlsx','xls','doc','docx'].some(e => filePath.endsWith(e))) {
      const { data: docs } = await supabase.from('employee_documents').select('id').eq('file_path', filePath).limit(1)
      if (docs?.[0]) {
        fetch('/api/parse-document', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ file_path: filePath, doc_id: docs[0].id, doc_type: docForm.tipo }) }).then(() => loadDocs()).catch(() => {})
      }
    }
  }
  const deleteDoc = async (doc) => {
    if (doc.file_path) await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('employee_documents').delete().eq('id', doc.id)
    await loadDocs()
  }
  const downloadDoc = async (filePath) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(filePath, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // Filtro per locale selezionato
  const locale = sp === 'all' ? null : sps.find(s => String(s.id) === sp)?.description || sp
  const filteredEmps = locale ? employees.filter(e => (e.locale||'').split(',').some(l => l.trim() === locale)) : employees
  const filteredDocs = locale ? empDocs.filter(d => { const emp = employees.find(e => e.id === d.employee_id); return !emp || (emp.locale||'').split(',').some(l => l.trim() === locale) }) : empDocs

  const now = new Date()
  const in30 = new Date(now); in30.setDate(in30.getDate()+30)
  const scadProssime = filteredDocs.filter(d=>d.scadenza && new Date(d.scadenza) <= in30 && new Date(d.scadenza) >= now)
  const giorniA = (d) => { const diff = Math.round((new Date(d)-now)/86400000); return diff }
  const scadColor = (d) => { const g=giorniA(d); return g<0?'#EF4444':g<30?'#EF4444':g<90?'#F59E0B':'#94a3b8' }
  const scadBg = (d) => { const g=giorniA(d); return g<0?'rgba(239,68,68,.12)':g<30?'rgba(239,68,68,.12)':g<90?'rgba(245,158,11,.12)':'rgba(148,163,184,.1)' }
  const formStyle = {...iS, width:'100%', marginBottom:8}

  // Se un dipendente è selezionato, mostra il profilo
  if (selectedEmp) {
    return <EmployeeProfile employee={selectedEmp} onClose={()=>setSelectedEmp(null)} onUpdate={loadEmployees} sps={sps}/>
  }

  return <>
    {/* Calendario */}
    <HRCalendar employees={employees}/>
    <div style={{marginTop:16}}/>

    {/* Task module */}
    <TaskManager sp={sp} sps={sps} employees={filteredEmps}/>
    <div style={{marginTop:16}}/>

    {/* KPI dinamici */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:'1.25rem'}}>
      <KPI label="Dipendenti" icon="👤" value={filteredEmps.filter(e=>e.stato==='Attivo').length} sub="attivi" accent='#3B82F6'/>
      <KPI label="Documenti" icon="📁" value={filteredDocs.length} sub="caricati" accent='#10B981'/>
      <KPI label="Scadenze" icon="📅" value={scadProssime.length} sub="nei prossimi 30gg" accent='#F59E0B'/>
    </div>

    {/* Dipendenti CRUD */}
    <div style={{marginTop:12}}>
      <Card title="Dipendenti" extra={
        <button onClick={()=>{setShowEmpForm(true);setEditEmp(null);setEmpForm({nome:'',ruolo:'',locale:'',telefono:'',email:'',pin:''})}} style={{...iS,background:'#3B82F6',color:'#fff',border:'none',padding:'5px 14px',fontWeight:600,fontSize:12}}>+ Aggiungi</button>
      }>
        {showEmpForm&&<div style={{background:'#131825',borderRadius:8,padding:16,marginBottom:16,border:'1px solid #2a3042'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
            <input placeholder="Nome *" value={empForm.nome} onChange={e=>setEmpForm(p=>({...p,nome:e.target.value}))} style={formStyle}/>
            <input placeholder="Ruolo" value={empForm.ruolo} onChange={e=>setEmpForm(p=>({...p,ruolo:e.target.value}))} style={formStyle}/>
            <div style={{...formStyle,display:'flex',gap:12,alignItems:'center',padding:'8px 10px'}}>
              <span style={{fontSize:11,color:'#64748b'}}>Locali:</span>
              {sps.map(s=>{
                const name = s.description||s.name
                const locales = (empForm.locale||'').split(',').filter(Boolean)
                const checked = locales.includes(name)
                return <label key={s.id} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#e2e8f0',cursor:'pointer'}}>
                  <input type="checkbox" checked={checked} onChange={()=>{
                    const next = checked ? locales.filter(l=>l!==name) : [...locales, name]
                    setEmpForm(p=>({...p,locale:next.join(',')}))
                  }}/>
                  {name}
                </label>
              })}
            </div>
            <input placeholder="Telefono" value={empForm.telefono} onChange={e=>setEmpForm(p=>({...p,telefono:e.target.value}))} style={formStyle}/>
            <input placeholder="Email" value={empForm.email} onChange={e=>setEmpForm(p=>({...p,email:e.target.value}))} style={formStyle}/>
            <input placeholder="PIN 4 cifre" value={empForm.pin||''} onChange={e=>setEmpForm(p=>({...p,pin:e.target.value.replace(/\D/g,'').substring(0,4)}))} style={formStyle} maxLength={4}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={saveEmployee} disabled={!empForm.nome||hrLoading} style={{...iS,background:'#10B981',color:'#fff',border:'none',padding:'6px 16px',fontWeight:600,flex:1}}>{editEmp?'Salva':'Aggiungi'}</button>
              <button onClick={()=>{setShowEmpForm(false);setEditEmp(null)}} style={{...iS,color:'#64748b',border:'1px solid #2a3042',padding:'6px 12px'}}>Annulla</button>
            </div>
          </div>
        </div>}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
            {['Nome','Ruolo','Locale','Telefono','Email','Stato',''].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filteredEmps.length===0&&<tr><td colSpan={7} style={{...S.td,color:'#475569',textAlign:'center',padding:20}}>Nessun dipendente. Clicca "+ Aggiungi" per inserirne uno.</td></tr>}
            {filteredEmps.map((d)=>(
              <tr key={d.id}>
                <td style={{...S.td,fontWeight:500,color:'#3B82F6',cursor:'pointer'}} onClick={()=>setSelectedEmp(d)}>{d.nome}</td>
                <td style={{...S.td,color:'#94a3b8'}}>{d.ruolo}</td>
                <td style={{...S.td,fontSize:12,color:'#64748b'}}>{d.locale}</td>
                <td style={{...S.td,fontSize:12,color:'#94a3b8'}}>{d.telefono||'—'}</td>
                <td style={{...S.td,fontSize:12,color:'#94a3b8'}}>{d.email||'—'}</td>
                <td style={S.td}><span style={S.badge(d.stato==='Attivo'?'#10B981':'#EF4444',d.stato==='Attivo'?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)')}>{d.stato==='Attivo'?'✓':''} {d.stato}</span></td>
                <td style={{...S.td,whiteSpace:'nowrap'}}>
                  <button onClick={()=>{setEditEmp(d);setEmpForm({nome:d.nome,ruolo:d.ruolo||'',locale:d.locale||'',telefono:d.telefono||'',email:d.email||'',pin:d.pin||''});setShowEmpForm(true)}} style={{background:'none',border:'none',color:'#3B82F6',cursor:'pointer',fontSize:12,marginRight:8}}>Modifica</button>
                  <button onClick={()=>{if(confirm('Eliminare '+d.nome+'?'))deleteEmployee(d.id)}} style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:12}}>Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>

    {/* Documenti e scadenze */}
    <div style={{marginTop:12}}>
      <Card title="Documenti e scadenze" extra={
        <button onClick={()=>{setShowDocForm(true);setDocForm({employee_id:employees[0]?.id||'',tipo:'Contratto',nome:'',scadenza:'',file:null})}} disabled={!employees.length} style={{...iS,background:'#F59E0B',color:'#0f1420',border:'none',padding:'5px 14px',fontWeight:600,fontSize:12}}>Carica documento</button>
      }>
        {showDocForm&&<div style={{background:'#131825',borderRadius:8,padding:16,marginBottom:16,border:'1px solid #2a3042'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10}}>
            <select value={docForm.employee_id} onChange={e=>setDocForm(p=>({...p,employee_id:e.target.value}))} style={formStyle}>
              <option value="">Dipendente...</option>
              {employees.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <select value={docForm.tipo} onChange={e=>setDocForm(p=>({...p,tipo:e.target.value}))} style={formStyle}>
              {['Contratto','Busta paga','Documento identita','Certificato','Altro'].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Nome documento" value={docForm.nome} onChange={e=>setDocForm(p=>({...p,nome:e.target.value}))} style={formStyle}/>
            <input type="date" value={docForm.scadenza} onChange={e=>setDocForm(p=>({...p,scadenza:e.target.value}))} style={formStyle} title="Scadenza"/>
          </div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            <input type="file" accept=".pdf,.jpg,.png,.doc,.docx,.xlsx,.xls" onChange={e=>setDocForm(p=>({...p,file:e.target.files[0]||null}))} style={{fontSize:12,color:'#94a3b8'}}/>
            <button onClick={saveDoc} disabled={!docForm.employee_id||!docForm.nome||hrLoading} style={{...iS,background:'#10B981',color:'#fff',border:'none',padding:'6px 16px',fontWeight:600}}>Salva</button>
            <button onClick={()=>setShowDocForm(false)} style={{...iS,color:'#64748b',border:'1px solid #2a3042',padding:'6px 12px'}}>Annulla</button>
          </div>
        </div>}
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:'1px solid #2a3042'}}>
            {['Dipendente','Tipo','Nome','Scadenza','File',''].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filteredDocs.length===0&&<tr><td colSpan={6} style={{...S.td,color:'#475569',textAlign:'center',padding:20}}>Nessun documento caricato.</td></tr>}
            {filteredDocs.map((d)=>{
              const emp = employees.find(e=>e.id===d.employee_id)
              const g = d.scadenza ? giorniA(d.scadenza) : null
              return <tr key={d.id}>
                <td style={{...S.td,fontWeight:500}}>{emp?.nome||'—'}</td>
                <td style={{...S.td,color:'#94a3b8'}}>{d.tipo}</td>
                <td style={S.td}>{d.nome}</td>
                <td style={S.td}>{d.scadenza?<span style={S.badge(scadColor(d.scadenza),scadBg(d.scadenza))}>{d.scadenza} ({g<0?'scaduto':g+'gg'})</span>:'—'}</td>
                <td style={S.td}>{d.file_path?<button onClick={()=>downloadDoc(d.file_path)} style={{background:'none',border:'none',color:'#3B82F6',cursor:'pointer',fontSize:12}}>Scarica</button>:'—'}</td>
                <td style={S.td}><button onClick={()=>{if(confirm('Eliminare documento?'))deleteDoc(d)}} style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:12}}>Elimina</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </Card>
    </div>

    {/* Timbrature + QR + Presenze reali */}
    <div style={{marginTop:12}}>
      <AttendanceView employees={employees} shifts={[]} sp={sp} sps={sps}/>
    </div>

    {/* Checklist timbratura */}
    <div style={{marginTop:12}}>
      <ChecklistManager sp={sp} sps={sps}/>
    </div>

    {/* Assistente Turni + Costi */}
    <div style={{marginTop:12}}>
      <ShiftAssistant employees={employees} sp={sp} sps={sps} staffSchedule={staffSchedule} setStaffSchedule={setStaffSchedule} saveSchedule={saveSchedule}/>
    </div>
  </>
}
