// Helper export uniformi per Excel / CSV / PDF.
// UI standard: 3 bottoni con icone (verde) · (blu) · (rosso).
//
// USO:
//   import { exportToXlsx, exportToCsv, exportToPdf, ExportButtons } from '../../lib/exporters'
//   exportToXlsx('miofile', ['Col1','Col2'], [['a','b']])
//   exportToCsv ('miofile', ['Col1','Col2'], [['a','b']])
//   exportToPdf ('Titolo',  ['Col1','Col2'], [['a','b']])
//   <ExportButtons onExcel={()=>...} onCsv={()=>...} onPdf={()=>...} />

import * as XLSX from 'xlsx'
import { S } from '../components/shared/styles.jsx'

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * Salva un file .xlsx. `rows` può includere una riga finale di totali.
 * @param {string} filename — senza estensione
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @param {object} [opts] { sheetName, colWidths }
 */
export function exportToXlsx(filename, headers, rows, opts = {}) {
  const data = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(data)
  if (opts.colWidths) ws['!cols'] = opts.colWidths.map(w => ({ wch: w }))
  Object.keys(ws).forEach(k => {
    if (!k.startsWith('!')) {
      ws[k].s = ws[k].s || {}
      ws[k].s.alignment = { wrapText: true, vertical: 'top' }
    }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Foglio1')
  XLSX.writeFile(wb, filename + '.xlsx')
}

/**
 * Salva un file .csv (separatore `;`, UTF-8 con BOM, escape RFC 4180).
 * Compatibile Excel italiano (apre direttamente con doppio click).
 */
export function exportToCsv(filename, headers, rows) {
  const data = [headers, ...rows]
  const csv = data.map(row => row.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Apre una finestra con la tabella formattata in HTML A4 landscape e lancia
 * window.print(). L'utente può salvare come PDF dal dialog di stampa.
 * @param {string} titolo — titolo nella stampa (h1)
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @param {object} [opts] { sottotitolo, footerRow, orientation }
 */
export function exportToPdf(titolo, headers, rows, opts = {}) {
  const orient = opts.orientation || 'landscape'
  const sottotitolo = opts.sottotitolo || `Generato il ${new Date().toLocaleString('it-IT')}`
  const w = window.open('', '_blank')
  if (!w) {
    alert('Popup bloccato — abilita i popup per la stampa.')
    return false
  }
  let html = `<html><head><title>${escapeHtml(titolo)}</title><style>
    @page { size: A4 ${orient}; margin: 10mm; }
    body { font-family: Arial, sans-serif; padding: 0; color: #333; font-size: 9px; }
    h1 { font-size: 15px; margin: 0 0 4px; }
    h2 { font-size: 10px; color: #666; font-weight: normal; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; }
    th { background: #f1f5f9; padding: 4px 3px; border: 1px solid #ccc; font-weight: 600; font-size: 9px; text-align: left; }
    td { padding: 4px 3px; border: 1px solid #ddd; vertical-align: top; font-size: 8px; white-space: pre-line; }
    tr.totrow { background: #e2e8f0; font-weight: 700; }
    tr.totrow td { background: #e2e8f0; }
  </style></head><body>
    <h1>${escapeHtml(titolo)}</h1>
    <h2>${escapeHtml(sottotitolo)}</h2>
    <table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>`
  rows.forEach(r => {
    html += '<tr>' + r.map(c => `<td>${escapeHtml(c).replace(/\n/g, '<br/>')}</td>`).join('') + '</tr>'
  })
  if (opts.footerRow) {
    html += '<tr class="totrow">' + opts.footerRow.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>'
  }
  html += '</tbody></table></body></html>'
  w.document.write(html)
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 300)
  return true
}

/**
 * Set di 3 bottoni standard. Stesso ordine ovunque: Excel · CSV · PDF.
 * Tutti accettano onClick. Disabilitabili tramite `disabled`.
 */
export function ExportButtons({ onExcel, onCsv, onPdf, disabled = false, size = 'sm' }) {
  const iS = S.input
  const padding = size === 'lg' ? '6px 16px' : '4px 12px'
  const fontSize = size === 'lg' ? 12 : 11
  const base = { ...iS, fontWeight: 700, border: 'none', padding, fontSize, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }
  return (
    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {onExcel && <button onClick={onExcel} disabled={disabled}
        style={{ ...base, background: '#10B981', color: '#0f1420' }}
        title="Scarica Excel">Excel</button>}
      {onCsv && <button onClick={onCsv} disabled={disabled}
        style={{ ...base, background: '#3B82F6', color: '#fff' }}
        title="Scarica CSV">CSV</button>}
      {onPdf && <button onClick={onPdf} disabled={disabled}
        style={{ ...base, background: '#EF4444', color: '#fff' }}
        title="Stampa o salva come PDF">PDF</button>}
    </div>
  )
}
