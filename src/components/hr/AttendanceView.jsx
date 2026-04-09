import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmtN } from '../shared/styles.jsx'

const DAYS = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']

function weekMonday(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + 1 + offset * 7)
  return d.toISOString().split('T')[0]
}

export default function AttendanceView({ employees, shifts, sp, sps }) {
  const [weekStart, setWeekStart] = useState(weekMonday())
  const [attendance, setAttendance] = useState([])
  const [qrLocale, setQrLocale] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const canvasRef = useRef(null)

  const iS = S.input
  const locale = sp === 'all' ? null : sps.find(s => String(s.id) === sp)?.description || sp
  const filteredEmps = locale ? employees.filter(e => (e.locale||'').split(',').some(l => l.trim() === locale) && e.stato === 'Attivo') : employees.filter(e => e.stato === 'Attivo')

  const loadAttendance = useCallback(async () => {
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const { data } = await supabase.from('attendance').select('*')
      .gte('timestamp', weekStart + 'T00:00:00')
      .lt('timestamp', weekEnd.toISOString().split('T')[0] + 'T00:00:00')
      .order('timestamp')
    setAttendance(data || [])
  }, [weekStart])

  useEffect(() => { loadAttendance() }, [loadAttendance])

  // Genera QR code
  const generateQR = async (localeName) => {
    const baseUrl = window.location.origin
    const url = `${baseUrl}/timbra?locale=${encodeURIComponent(localeName)}`
    setQrUrl(url)
    setQrLocale(localeName)
    try {
      const QRCode = (await import('qrcode')).default
      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, url, { width: 250, margin: 2, color: { dark: '#0f1420', light: '#ffffff' } })
      }
    } catch (e) { console.warn('QR generation failed', e) }
  }

  // Calcola ore per dipendente per giorno
  const getAttendanceForDay = (empId, dayOffset) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + dayOffset)
    const ds = date.toISOString().split('T')[0]
    const dayRecords = attendance.filter(a => a.employee_id === empId && a.timestamp?.startsWith(ds)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    let entrata = null, uscita = null, ore = 0
    for (const r of dayRecords) {
      if (r.tipo === 'entrata' && !entrata) entrata = r.timestamp
      if (r.tipo === 'uscita' && entrata) {
        uscita = r.timestamp
        ore += (new Date(uscita) - new Date(entrata)) / 3600000
        entrata = null
      }
    }
    const entrataTime = dayRecords.find(r => r.tipo === 'entrata')?.timestamp
    const uscitaTime = dayRecords.filter(r => r.tipo === 'uscita').pop()?.timestamp

    return {
      entrata: entrataTime ? new Date(entrataTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null,
      uscita: uscitaTime ? new Date(uscitaTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null,
      ore: Math.round(ore * 10) / 10,
      incompleta: !!entrata && !uscita // entrata senza uscita
    }
  }

  const prevWeek = () => setWeekStart(weekMonday(Math.round((new Date(weekStart) - new Date(weekMonday())) / 604800000) - 1))
  const nextWeek = () => setWeekStart(weekMonday(Math.round((new Date(weekStart) - new Date(weekMonday())) / 604800000) + 1))

  const weekLabel = () => {
    const start = new Date(weekStart)
    const end = new Date(start); end.setDate(end.getDate() + 6)
    return start.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' — ' + end.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  }

  // Totali
  const totalHoursWeek = filteredEmps.reduce((sum, emp) => {
    for (let d = 0; d < 7; d++) sum += getAttendanceForDay(emp.id, d).ore
    return sum
  }, 0)

  return <>
    {/* QR Code Generator */}
    <Card title="QR Code Timbratura" extra={
      <div style={{ display: 'flex', gap: 8 }}>
        {sps.map(s => <button key={s.id} onClick={() => generateQR(s.description || s.name)}
          style={{ ...iS, background: qrLocale === (s.description || s.name) ? '#F59E0B' : '#1a1f2e', color: qrLocale === (s.description || s.name) ? '#0f1420' : '#e2e8f0', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>
          {s.description || s.name}
        </button>)}
      </div>
    }>
      {qrLocale ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 12 }}>
            <canvas ref={canvasRef} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>{qrLocale}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12, wordBreak: 'break-all', maxWidth: 300 }}>{qrUrl}</div>
            <button onClick={() => { if (canvasRef.current) { const a = document.createElement('a'); a.download = `QR_${qrLocale}.png`; a.href = canvasRef.current.toDataURL(); a.click() } }}
              style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>Scarica PNG</button>
          </div>
        </div>
      ) : (
        <div style={{ color: '#475569', textAlign: 'center', padding: 16, fontSize: 13 }}>Seleziona un locale per generare il QR code di timbratura.</div>
      )}
    </Card>

    {/* Presenze reali settimanali */}
    <div style={{ marginTop: 12 }}>
      <Card title="Presenze reali" badge={Math.round(totalHoursWeek) + 'h totali'} extra={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={prevWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>◀</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 130, textAlign: 'center' }}>{weekLabel()}</span>
          <button onClick={nextWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>▶</button>
          <button onClick={loadAttendance} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11, marginLeft: 8 }}>Aggiorna</button>
        </div>
      }>
        {filteredEmps.length === 0 ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: 20, fontSize: 13 }}>Nessun dipendente attivo.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                <th style={{ ...S.th, width: 140 }}>Dipendente</th>
                {DAYS.map(d => <th key={d} style={{ ...S.th, textAlign: 'center' }}>{d}</th>)}
                <th style={{ ...S.th, textAlign: 'right' }}>Ore</th>
              </tr></thead>
              <tbody>
                {filteredEmps.map(emp => {
                  let totOre = 0
                  return <tr key={emp.id}>
                    <td style={{ ...S.td, fontWeight: 500, fontSize: 12 }}>{emp.nome}</td>
                    {DAYS.map((_, day) => {
                      const att = getAttendanceForDay(emp.id, day)
                      totOre += att.ore
                      const date = new Date(weekStart)
                      date.setDate(date.getDate() + day)
                      const ds = date.toISOString().split('T')[0]
                      const dayRecs = attendance.filter(a => a.employee_id === emp.id && a.timestamp?.startsWith(ds))
                      const entrataRec = dayRecs.find(r => r.tipo === 'entrata')
                      const uscitaRec = [...dayRecs].filter(r => r.tipo === 'uscita').pop()

                      const updateTime = async (id, oldTs, newTime) => {
                        if (!newTime || !id) return
                        const newTs = ds + 'T' + newTime + ':00'
                        await supabase.from('attendance').update({ timestamp: newTs }).eq('id', id)
                        loadAttendance()
                      }
                      const addEntry = async () => {
                        await supabase.from('attendance').insert({ employee_id: emp.id, timestamp: ds + 'T09:00:00', tipo: 'entrata', locale: emp.locale?.split(',')[0] || '' })
                        loadAttendance()
                      }
                      const addExit = async () => {
                        await supabase.from('attendance').insert({ employee_id: emp.id, timestamp: ds + 'T18:00:00', tipo: 'uscita', locale: emp.locale?.split(',')[0] || '' })
                        loadAttendance()
                      }
                      const deleteDay = async () => {
                        for (const r of dayRecs) await supabase.from('attendance').delete().eq('id', r.id)
                        loadAttendance()
                      }

                      const bgColor = att.entrata && att.uscita ? 'rgba(16,185,129,.08)' : att.incompleta ? 'rgba(245,158,11,.08)' : 'transparent'
                      return <td key={day} style={{ ...S.td, textAlign: 'center', padding: '3px 2px', minWidth: 90, background: bgColor }}>
                        {att.entrata ? (
                          <div style={{ fontSize: 10 }}>
                            <input type="time" defaultValue={entrataRec ? new Date(entrataRec.timestamp).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : ''}
                              onBlur={e => updateTime(entrataRec?.id, entrataRec?.timestamp, e.target.value)}
                              style={{ ...iS, width: 68, fontSize: 10, padding: '1px 3px', color: '#10B981', fontWeight: 600, textAlign: 'center' }} />
                            {att.uscita ? (
                              <input type="time" defaultValue={uscitaRec ? new Date(uscitaRec.timestamp).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : ''}
                                onBlur={e => updateTime(uscitaRec?.id, uscitaRec?.timestamp, e.target.value)}
                                style={{ ...iS, width: 68, fontSize: 10, padding: '1px 3px', color: '#94a3b8', textAlign: 'center', marginTop: 2 }} />
                            ) : (
                              <button onClick={addExit} style={{ display: 'block', margin: '2px auto 0', fontSize: 8, color: '#F59E0B', background: 'transparent', border: '1px solid #F59E0B33', borderRadius: 3, padding: '1px 6px', cursor: 'pointer' }}>+usc</button>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 1 }}>
                              {att.ore > 0 && <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 9 }}>{att.ore}h</span>}
                              <button onClick={deleteDay} style={{ background: 'none', border: 'none', color: '#47556966', cursor: 'pointer', fontSize: 9, padding: 0 }}>✕</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={addEntry} style={{ background: 'transparent', border: '1px dashed #2a304266', borderRadius: 4, color: '#475569', cursor: 'pointer', fontSize: 10, padding: '6px 4px', width: '100%' }} title="Aggiungi timbratura">+</button>
                        )}
                      </td>
                    })}
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: '#F59E0B', fontSize: 12 }}>{Math.round(totOre * 10) / 10}h</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  </>
}
