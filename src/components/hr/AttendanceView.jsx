import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { S, KPI, Card, fmtN } from '../shared/styles.jsx'

const DAYS = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom']

function weekMonday(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + 1 + offset * 7)
  return d.toISOString().split('T')[0]
}

// Converte una data "YYYY-MM-DD" + ora "HH:mm" (locale browser) in ISO UTC.
// La colonna attendance.timestamp e' TIMESTAMPTZ → Postgres salva sempre UTC.
// Per coerenza tra scrittura e lettura, convertiamo l'ora digitata (intesa
// come ora locale Europe/Rome) nell'istante UTC corrispondente.
function localDateTimeToIsoUtc(ds, hhmm) {
  if (!ds || !hhmm || !hhmm.includes(':')) return null
  const [y, m, d] = ds.split('-').map(Number)
  const [h, mm] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, mm, 0).toISOString()
}

// Somma N giorni a una data "YYYY-MM-DD" restando nel formato stringa.
// NON passa da Date.toISOString() per evitare shift di timezone (il bug che
// tagliava 24h dal range fetch del DayManager).
function addDaysStr(ds, n) {
  if (!ds) return ds
  const [y, m, d] = ds.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
}

// Come sopra, ma interpreta ds come "giorno operativo". Se l'ora e' prima
// del cutoff (es. 03:00 con cutoff=5), il giorno calendar corrispondente e'
// ds+1 (perche' 03:00 del 18/04 appartiene al giorno operativo del 17/04).
function localDateTimeToIsoUtcForOperatingDay(ds, hhmm, cutoff) {
  if (!ds || !hhmm || !hhmm.includes(':')) return null
  const [h] = hhmm.split(':').map(Number)
  if (h < cutoff) {
    return localDateTimeToIsoUtc(addDaysStr(ds, 1), hhmm)
  }
  return localDateTimeToIsoUtc(ds, hhmm)
}

// Formatta un timestamp (con tz o UTC) in ora Europe/Rome HH:mm
function hmFromTsTz(ts) {
  if (typeof ts !== 'string' || ts.length < 16) return ''
  try {
    return new Date(ts).toLocaleTimeString('it-IT', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
    })
  } catch { return ts.substring(11, 16) }
}

// I locali notturni chiudono dopo mezzanotte. Una timbratura prima di questa
// ora (in Europe/Rome) appartiene al "giorno operativo" precedente.
// Es: cutoff=5 → uscita 03:00 del 18/04 conta come turno del 17/04.
const OPERATING_DAY_CUTOFF_HOUR = 5

// Restituisce il "giorno operativo" YYYY-MM-DD a cui appartiene il timestamp.
// Conversione fatta in Europe/Rome per gestire DST corretto.
function operatingDayOf(ts) {
  if (typeof ts !== 'string' || ts.length < 10) return null
  try {
    const d = new Date(ts)
    // 'sv-SE' produce ISO-like "YYYY-MM-DD HH:mm:ss"
    const local = d.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' })
    const datePart = local.substring(0, 10)
    const hour = parseInt(local.substring(11, 13)) || 0
    if (hour < OPERATING_DAY_CUTOFF_HOUR) {
      // Sottrai 1 giorno
      const [y, m, day] = datePart.split('-').map(Number)
      const prev = new Date(y, m - 1, day - 1)
      return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0') + '-' + String(prev.getDate()).padStart(2, '0')
    }
    return datePart
  } catch { return ts.substring(0, 10) }
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
    // Range +1 giorno: timbrature notturne (es. uscita alle 03:00 del lunedi
    // successivo) appartengono al "giorno operativo" della domenica della
    // settimana visualizzata. Devono essere caricate per essere conteggiate.
    const weekEndStr = addDaysStr(weekStart, 8)
    const { data } = await supabase.from('attendance').select('*')
      .gte('timestamp', weekStart + 'T00:00:00')
      .lt('timestamp', weekEndStr + 'T00:00:00')
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

  // Helpers tempo (definiti a livello modulo in cima al file)
  const hmFromTs = hmFromTsTz
  const minutesFromHm = (hm) => {
    if (!hm || !hm.includes(':')) return null
    const [h, m] = hm.split(':').map(Number)
    return h * 60 + (m || 0)
  }

  // Abbina timbrature a coppie entrata→uscita in ordine cronologico.
  // Ogni blocco ha un proprio locale (quello dell'entrata).
  // Gestisce:
  //   - entrata senza uscita successiva → blocco "aperto", non contato nelle ore
  //   - uscita senza entrata precedente → ignorata nel calcolo, ma visibile
  //   - turno che scavalca mezzanotte (delta negativo → +24h)
  const buildBlocks = (dayRecords) => {
    const sorted = [...dayRecords].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const blocks = []
    let openEntry = null
    for (const r of sorted) {
      if (r.tipo === 'entrata') {
        if (openEntry) {
          // entrata senza uscita precedente → segnala come "aperta" incompleta
          blocks.push({ entrata: openEntry, uscita: null, locale: openEntry.locale || '', ore: 0, incompleta: true })
        }
        openEntry = r
      } else if (r.tipo === 'uscita') {
        if (openEntry) {
          const eMin = minutesFromHm(hmFromTs(openEntry.timestamp))
          const uMin = minutesFromHm(hmFromTs(r.timestamp))
          let delta = 0
          if (eMin != null && uMin != null) {
            delta = uMin - eMin
            if (delta < 0) delta += 24 * 60
          }
          blocks.push({
            entrata: openEntry,
            uscita: r,
            locale: openEntry.locale || r.locale || '',
            ore: Math.round((delta / 60) * 100) / 100,
            incompleta: false,
          })
          openEntry = null
        } else {
          // uscita orfana (nessuna entrata prima) → ignorata nel totale ma presente
          blocks.push({ entrata: null, uscita: r, locale: r.locale || '', ore: 0, incompleta: true })
        }
      }
    }
    if (openEntry) {
      blocks.push({ entrata: openEntry, uscita: null, locale: openEntry.locale || '', ore: 0, incompleta: true })
    }
    return blocks
  }

  // Ritorna aggregato giornaliero. Se localeFilter != null, somma solo le ore
  // dei blocchi relativi a quel locale.
  const getAttendanceForDay = (empId, dayOffset, localeFilter = null) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + dayOffset)
    const ds = date.toISOString().split('T')[0]
    // Usa il "giorno operativo": una timbratura tra mezzanotte e le 05:00
    // appartiene al turno del giorno precedente (locali notturni).
    const dayRecords = attendance.filter(a =>
      a.employee_id === empId && a.timestamp && operatingDayOf(a.timestamp) === ds
    )
    const blocks = buildBlocks(dayRecords)
    const blocksForLocale = localeFilter ? blocks.filter(b => b.locale === localeFilter) : blocks
    const ore = blocksForLocale.reduce((s, b) => s + (b.ore || 0), 0)
    const hasIncompleta = blocks.some(b => b.incompleta)
    const localiCoinvolti = [...new Set(blocks.map(b => b.locale).filter(Boolean))]
    return {
      ds,
      blocks,
      blocksForLocale,
      dayRecords,
      ore: Math.floor(ore * 100) / 100,
      incompleta: hasIncompleta,
      localiCoinvolti,
    }
  }

  const prevWeek = () => setWeekStart(weekMonday(Math.round((new Date(weekStart) - new Date(weekMonday())) / 604800000) - 1))
  const nextWeek = () => setWeekStart(weekMonday(Math.round((new Date(weekStart) - new Date(weekMonday())) / 604800000) + 1))

  const weekLabel = () => {
    const start = new Date(weekStart)
    const end = new Date(start); end.setDate(end.getDate() + 6)
    return start.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' — ' + end.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  }

  // Quando un locale e' selezionato nell'header, conto solo le ore di quel locale
  const localeFilter = locale || null

  // Totali settimana (filtrati per locale se impostato)
  const totalHoursWeek = filteredEmps.reduce((sum, emp) => {
    for (let d = 0; d < 7; d++) sum += getAttendanceForDay(emp.id, d, localeFilter).ore
    return sum
  }, 0)

  // Stato popup gestione timbrature
  const [managingDay, setManagingDay] = useState(null) // { emp, dayOffset, ds }

  // ─── Export Excel / PDF ────────────────────────────────────────
  const dateLabel = (offset) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + offset)
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit' })
  }
  const buildRows = () => {
    // Per ogni dipendente, una riga: nome + 7 colonne giorno + totale
    return filteredEmps.map(emp => {
      let totOre = 0
      const cells = []
      for (let day = 0; day < 7; day++) {
        const att = getAttendanceForDay(emp.id, day, localeFilter)
        totOre += att.ore
        if (att.blocks.length === 0) {
          cells.push({ ore: 0, text: '', incompleta: false })
        } else {
          // Mostra orari entrata→uscita di ogni blocco + locale + ore
          const lines = att.blocks.map(b => {
            const eH = b.entrata ? hmFromTs(b.entrata.timestamp) : '—'
            const uH = b.uscita ? hmFromTs(b.uscita.timestamp) : '…'
            return `${eH}→${uH} ${b.locale ? '(' + b.locale + ')' : ''}`.trim()
          }).join('\n')
          cells.push({
            ore: att.ore || 0,
            text: lines + (att.ore > 0 ? `\n= ${(att.ore || 0).toFixed(2)}h` : ''),
            incompleta: att.incompleta,
          })
        }
      }
      return { nome: emp.nome, cells, totOre: Math.floor(totOre * 100) / 100 }
    })
  }

  const exportExcel = () => {
    const rows = buildRows()
    const headers = ['Dipendente', ...Array.from({ length: 7 }, (_, i) => DAYS[i] + ' ' + dateLabel(i).split(' ').slice(-1)[0]), 'Totale ore']
    const data = [headers]
    rows.forEach(r => {
      data.push([r.nome, ...r.cells.map(c => c.text || '—'), r.totOre.toFixed(2) + 'h'])
    })
    // Riga totali per giorno
    const dayTot = Array.from({ length: 7 }, (_, day) =>
      rows.reduce((s, r) => s + (r.cells[day]?.ore || 0), 0)
    )
    data.push([
      'TOTALE GIORNO',
      ...dayTot.map(t => (Math.floor(t * 100) / 100).toFixed(2) + 'h'),
      (Math.floor(rows.reduce((s, r) => s + r.totOre, 0) * 100) / 100).toFixed(2) + 'h',
    ])
    const ws = XLSX.utils.aoa_to_sheet(data)
    // Larghezze colonne
    ws['!cols'] = [{ wch: 22 }, ...Array(7).fill({ wch: 24 }), { wch: 12 }]
    // Wrap text per le celle dei giorni
    Object.keys(ws).forEach(k => {
      if (k.startsWith('!')) return
      if (!ws[k].s) ws[k].s = {}
      ws[k].s.alignment = { wrapText: true, vertical: 'top' }
    })
    const wb = XLSX.utils.book_new()
    const sheetName = 'Presenze ' + weekLabel().replace(/[^\w-]/g, '_').slice(0, 24)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    const fileLabel = (locale ? locale + '_' : '') + weekStart
    XLSX.writeFile(wb, `Presenze_${fileLabel}.xlsx`)
  }

  const exportPDF = () => {
    const rows = buildRows()
    const dayTot = Array.from({ length: 7 }, (_, day) =>
      rows.reduce((s, r) => s + (r.cells[day]?.ore || 0), 0)
    )
    const grandTot = Math.floor(rows.reduce((s, r) => s + r.totOre, 0) * 100) / 100
    const titolo = `Presenze reali · ${locale || 'Tutti i locali'} · ${weekLabel()}`
    let html = `<html><head><title>${titolo}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      body { font-family: Arial, sans-serif; padding: 0; color: #333; font-size: 10px; }
      h1 { font-size: 16px; margin: 0 0 6px; }
      h2 { font-size: 11px; color: #666; font-weight: normal; margin: 0 0 14px; }
      table { border-collapse: collapse; width: 100%; }
      th { background: #f1f5f9; padding: 5px 4px; border: 1px solid #ccc; font-weight: 600; font-size: 10px; }
      td { padding: 5px 4px; border: 1px solid #ddd; vertical-align: top; font-size: 9px; white-space: pre-line; }
      td.nome { font-weight: 600; background: #fafafa; }
      td.tot { font-weight: 700; text-align: right; color: #b45309; background: #fef3c7; }
      tr.totrow { background: #e2e8f0; font-weight: 700; }
      .ore { font-weight: 700; color: #b45309; }
      .blocco { display: block; }
    </style></head><body>
    <h1>📋 ${titolo}</h1>
    <h2>Generato il ${new Date().toLocaleString('it-IT')}</h2>
    <table><thead><tr>
      <th style="text-align:left">Dipendente</th>
      ${Array.from({ length: 7 }, (_, i) => `<th>${dateLabel(i)}</th>`).join('')}
      <th>Totale</th>
    </tr></thead><tbody>`
    rows.forEach(r => {
      html += `<tr><td class="nome">${escapeHtml(r.nome)}</td>`
      r.cells.forEach(c => {
        html += `<td>${c.text ? escapeHtml(c.text).replace(/\n/g, '<br/>') : '—'}</td>`
      })
      html += `<td class="tot">${r.totOre.toFixed(2)}h</td></tr>`
    })
    html += `<tr class="totrow"><td class="nome">TOTALE GIORNO</td>`
    dayTot.forEach(t => { html += `<td><span class="ore">${(Math.floor(t * 100) / 100).toFixed(2)}h</span></td>` })
    html += `<td class="tot">${grandTot.toFixed(2)}h</td></tr>`
    html += `</tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Popup bloccato — abilita i popup per stampare.'); return }
    w.document.write(html); w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 300)
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  return <>
    {/* QR Code Generator */}
    <Card title="QR Code Timbratura" extra={
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {sps.map(s => <button key={s.id} onClick={() => generateQR(s.description || s.name)}
          style={{ ...iS, background: qrLocale === (s.description || s.name) ? '#F59E0B' : '#1a1f2e', color: qrLocale === (s.description || s.name) ? '#0f1420' : '#e2e8f0', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>
          {s.description || s.name}
        </button>)}
        {/* QR extra per punti di timbratura non-locale (laboratorio, ecc.) */}
        <button key="laboratorio" onClick={() => generateQR('LABORATORIO')}
          style={{ ...iS, background: qrLocale === 'LABORATORIO' ? '#F59E0B' : '#1a1f2e', color: qrLocale === 'LABORATORIO' ? '#0f1420' : '#e2e8f0', border: '1px dashed #475569', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}
          title="Laboratorio (punto di timbratura, non e' un locale di vendita)">
          🔧 LABORATORIO
        </button>
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
        <div className="m-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={prevWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>◀</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 130, textAlign: 'center' }}>{weekLabel()}</span>
          <button onClick={nextWeek} style={{ ...iS, padding: '4px 10px', fontSize: 12 }}>▶</button>
          <button onClick={loadAttendance} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11, marginLeft: 8 }}>Aggiorna</button>
          <button onClick={exportExcel} disabled={filteredEmps.length === 0}
            style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 700, border: 'none', padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}
            title="Scarica Excel della settimana">📊 Excel</button>
          <button onClick={exportPDF} disabled={filteredEmps.length === 0}
            style={{ ...iS, background: '#EF4444', color: '#fff', fontWeight: 700, border: 'none', padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}
            title="Stampa o salva come PDF">🖨 PDF</button>
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
                      const att = getAttendanceForDay(emp.id, day, localeFilter)
                      totOre += att.ore
                      const date = new Date(weekStart)
                      date.setDate(date.getDate() + day)
                      const nBlocks = att.blocks.length
                      const hasMulti = nBlocks > 1
                      const hasMultipleLocali = att.localiCoinvolti.length > 1
                      const bgColor = att.blocksForLocale.length > 0 && !att.incompleta
                        ? 'rgba(16,185,129,.08)'
                        : att.incompleta ? 'rgba(245,158,11,.08)' : 'transparent'

                      // Riassunto sintetico mostrato nella cella
                      let summaryMain = null
                      let summarySub = null
                      if (nBlocks === 0) {
                        summaryMain = null
                      } else if (nBlocks === 1) {
                        const b = att.blocks[0]
                        const eH = b.entrata ? hmFromTs(b.entrata.timestamp) : '—'
                        const uH = b.uscita ? hmFromTs(b.uscita.timestamp) : '…'
                        summaryMain = eH + '→' + uH
                        summarySub = b.locale || ''
                      } else {
                        summaryMain = nBlocks + ' blocchi'
                        summarySub = hasMultipleLocali ? att.localiCoinvolti.join(' · ') : (att.blocks[0]?.locale || '')
                      }

                      return <td key={day} style={{ ...S.td, textAlign: 'center', padding: '3px 2px', minWidth: 96, background: bgColor }}>
                        {nBlocks > 0 ? (
                          <button onClick={() => setManagingDay({ emp, dayOffset: day, ds: att.ds, date })}
                            title={'Clicca per gestire le timbrature del ' + date.toLocaleDateString('it-IT')}
                            style={{
                              width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
                              padding: 4, textAlign: 'center', color: '#e2e8f0',
                            }}>
                            <div style={{ fontSize: 11, color: '#10B981', fontWeight: 600 }}>{summaryMain}</div>
                            {summarySub && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>{summarySub}</div>}
                            <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700, marginTop: 2 }}>
                              {(att.ore || 0).toFixed(2)}h
                              {hasMulti && <span title="Turno spezzato" style={{ marginLeft: 3, color: '#3B82F6' }}>ℹ︎</span>}
                              {att.incompleta && <span title="Timbratura incompleta" style={{ marginLeft: 3, color: '#EF4444' }}>⚠</span>}
                            </div>
                          </button>
                        ) : (
                          <button onClick={() => setManagingDay({ emp, dayOffset: day, ds: att.ds, date })}
                            style={{ background: 'transparent', border: '1px dashed #2a304266', borderRadius: 4, color: '#475569', cursor: 'pointer', fontSize: 10, padding: '6px 4px', width: '100%' }}
                            title="Aggiungi timbratura">+</button>
                        )}
                      </td>
                    })}
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: '#F59E0B', fontSize: 12 }}>{(Math.floor(totOre * 100) / 100).toFixed(2)}h</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>

    {managingDay && (
      <DayManager
        data={managingDay}
        allLocali={sps.map(s => s.description || s.name)}
        onClose={() => setManagingDay(null)}
        onChange={loadAttendance}
      />
    )}
  </>
}

// ─── Popup gestione timbrature del giorno ──────────────────────────────────
function DayManager({ data, allLocali, onClose, onChange }) {
  const { emp, ds, date } = data
  const [records, setRecords] = useState([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    // Range esteso di +2 giorni calcolato come stringa pura (senza passare
    // da Date.toISOString, che per TZ positive come Europe/Rome toglierebbe
    // 24h reali dal range, escludendo le uscite oltre mezzanotte).
    const dsEnd = addDaysStr(ds, 2)
    const { data: rows } = await supabase.from('attendance').select('*')
      .eq('employee_id', emp.id)
      .gte('timestamp', ds + 'T00:00:00')
      .lt('timestamp', dsEnd + 'T00:00:00')
      .order('timestamp')
    setRecords((rows || []).filter(r => operatingDayOf(r.timestamp) === ds))
  }, [emp.id, ds])
  useEffect(() => { load() }, [load])

  const hm = hmFromTsTz
  const defaultLocale = (emp.locale || '').split(',')[0]?.trim() || allLocali[0] || ''

  const addRec = async (tipo) => {
    setSaving(true)
    const nowH = new Date().getHours()
    const ora = tipo === 'entrata' ? String(nowH).padStart(2, '0') + ':00' : String(Math.min(23, nowH + 1)).padStart(2, '0') + ':00'
    const { error } = await supabase.from('attendance').insert({
      employee_id: emp.id, timestamp: localDateTimeToIsoUtcForOperatingDay(ds, ora, OPERATING_DAY_CUTOFF_HOUR), tipo, locale: defaultLocale,
    })
    setSaving(false)
    if (error) { alert('Errore: ' + error.message); return }
    load(); onChange()
  }

  const updateRec = async (id, patch) => {
    const { error } = await supabase.from('attendance').update(patch).eq('id', id)
    if (error) { alert('Errore aggiornamento: ' + error.message); return }
    load(); onChange()
  }

  const deleteRec = async (id) => {
    if (!confirm('Eliminare questa timbratura?')) return
    const { error } = await supabase.from('attendance').delete().eq('id', id)
    if (error) { alert('Errore eliminazione: ' + error.message); return }
    load(); onChange()
  }

  const deleteAll = async () => {
    if (records.length === 0) return
    if (!confirm(`Eliminare tutte le ${records.length} timbrature del giorno?`)) return
    setSaving(true)
    const { error } = await supabase.from('attendance').delete().in('id', records.map(r => r.id))
    setSaving(false)
    if (error) { alert('Errore eliminazione: ' + error.message); return }
    load(); onChange()
  }

  // Calcola blocchi a coppie per visualizzare totali per locale
  const minutesFromHm = (s) => {
    if (!s || !s.includes(':')) return null
    const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0)
  }
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const blocks = []
  let open = null
  for (const r of sorted) {
    if (r.tipo === 'entrata') {
      if (open) blocks.push({ entrata: open, uscita: null, ore: 0 })
      open = r
    } else if (r.tipo === 'uscita') {
      if (open) {
        const e = minutesFromHm(hm(open.timestamp)); const u = minutesFromHm(hm(r.timestamp))
        let d = 0; if (e != null && u != null) { d = u - e; if (d < 0) d += 24 * 60 }
        blocks.push({ entrata: open, uscita: r, locale: open.locale || r.locale, ore: Math.round(d / 60 * 100) / 100 })
        open = null
      } else blocks.push({ entrata: null, uscita: r, ore: 0 })
    }
  }
  if (open) blocks.push({ entrata: open, uscita: null, ore: 0 })
  const oreByLocale = {}
  blocks.forEach(b => { if (b.locale && b.ore > 0) oreByLocale[b.locale] = (oreByLocale[b.locale] || 0) + b.ore })
  const oreTot = Object.values(oreByLocale).reduce((s, v) => s + v, 0)

  const iS = S.input

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 620 }}>
      <div style={{ padding: 16, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>{emp.nome}</h3>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <div style={{ padding: 16 }}>
        {/* Riepilogo ore per locale */}
        {Object.keys(oreByLocale).length > 0 && (
          <div style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Totale giornata · {(Math.floor(oreTot * 100) / 100).toFixed(2)}h</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(oreByLocale).map(([loc, h]) => (
                <span key={loc} style={{ fontSize: 12, color: '#e2e8f0', background: '#1a1f2e', padding: '4px 10px', borderRadius: 4 }}>
                  {loc}: <strong style={{ color: '#F59E0B' }}>{(Math.floor(h * 100) / 100).toFixed(2)}h</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Lista timbrature */}
        {records.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            Nessuna timbratura per questo giorno.
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Timbrature ({records.length})</div>
            {sorted.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#131825', borderRadius: 6, marginBottom: 4, border: '1px solid #1e2636' }}>
                <select value={r.tipo}
                  onChange={e => updateRec(r.id, { tipo: e.target.value })}
                  style={{ ...iS, fontSize: 11, padding: '4px 6px', width: 90, color: r.tipo === 'entrata' ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  <option value="entrata">Entrata</option>
                  <option value="uscita">Uscita</option>
                </select>
                <input type="time" defaultValue={hm(r.timestamp)}
                  onBlur={e => { if (e.target.value && e.target.value !== hm(r.timestamp)) updateRec(r.id, { timestamp: localDateTimeToIsoUtcForOperatingDay(ds, e.target.value, OPERATING_DAY_CUTOFF_HOUR) }) }}
                  style={{ ...iS, fontSize: 12, padding: '4px 6px', width: 90, textAlign: 'center' }} />
                <select value={r.locale || ''}
                  onChange={e => updateRec(r.id, { locale: e.target.value })}
                  style={{ ...iS, fontSize: 11, padding: '4px 6px', flex: 1 }}>
                  <option value="">(senza locale)</option>
                  {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <button onClick={() => deleteRec(r.id)} title="Elimina"
                  style={{ background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 14, padding: '2px 6px', fontWeight: 700 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Azioni aggiungi */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => addRec('entrata')} disabled={saving}
            style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: saving ? 'wait' : 'pointer', fontSize: 12 }}>
            + Entrata
          </button>
          <button onClick={() => addRec('uscita')} disabled={saving}
            style={{ ...iS, background: '#EF4444', color: '#fff', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: saving ? 'wait' : 'pointer', fontSize: 12 }}>
            + Uscita
          </button>
          {records.length > 0 && (
            <button onClick={deleteAll} disabled={saving} style={{ ...iS, color: '#EF4444', padding: '6px 14px', cursor: saving ? 'wait' : 'pointer', fontSize: 12, marginLeft: 'auto' }}>
              🗑 Elimina tutto
            </button>
          )}
        </div>

        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5, borderTop: '1px solid #2a3042', paddingTop: 10 }}>
          💡 Le ore vengono calcolate abbinando <strong>entrata→uscita</strong> in ordine cronologico.<br/>
          Turni spezzati (es. 10-13 + 18-22) contano solo le ore effettive, non il buco tra i due.<br/>
          Ogni blocco eredita il locale dell'<strong>entrata</strong>.
        </div>
      </div>

      <div style={{ padding: 12, borderTop: '1px solid #2a3042', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: 'pointer' }}>Fatto</button>
      </div>
    </div>
  </div>
}
