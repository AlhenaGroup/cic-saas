import { useState, useEffect } from 'react'
import { S, KPI, Card, fmt, fmtD } from './shared/styles.jsx'

export default function InvoiceTab({ sps, fatSearch, setFatSearch }) {
  const [cicInvoices, setCicInvoices] = useState([])
  const [fatLoading, setFatLoading] = useState(false)
  const [localeMap, setLocaleMap] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_invoice_locales') || '{}') } catch { return {} } })
  const [expandedFat, setExpandedFat] = useState(null)
  const [xmlContent, setXmlContent] = useState(null)
  const [xmlLoading, setXmlLoading] = useState(false)

  const iS = S.input

  const loadCicInvoices = async () => {
    setFatLoading(true)
    try {
      const r = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', sessionCookie: document.cookie }) })
      if (r.ok) {
        const d = await r.json()
        setCicInvoices(d.invoices || [])
      }
    } catch {}
    setFatLoading(false)
  }

  const downloadXml = async (inv) => {
    setXmlLoading(true); setXmlContent(null)
    try {
      const r = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'xml', sessionCookie: document.cookie, invoiceId: inv.id, spId: inv.salespoint_id }) })
      if (r.ok) {
        const d = await r.json()
        setXmlContent(d.xml)
      } else { setXmlContent('XML non disponibile al momento.') }
    } catch { setXmlContent('Errore nel download XML.') }
    setXmlLoading(false)
  }

  const saveXmlFile = (inv) => {
    if (!xmlContent || xmlContent.length < 100) return
    const blob = new Blob([xmlContent], { type: 'application/xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (inv.filename || inv.number + '.xml'); a.click()
  }

  const setInvoiceLocale = (invId, locale) => {
    const newMap = { ...localeMap, [invId]: locale }
    setLocaleMap(newMap)
    localStorage.setItem('cic_invoice_locales', JSON.stringify(newMap))
  }

  const parseXmlLines = (xml) => {
    if (!xml || xml.length < 100) return []
    const lines = []
    const lineRegex = /<DettaglioLinee>([\s\S]*?)<\/DettaglioLinee>/g
    let match
    while ((match = lineRegex.exec(xml)) !== null) {
      const block = match[1]
      const get = (tag) => { const m = block.match(new RegExp('<' + tag + '>(.*?)</' + tag + '>')); return m ? m[1] : '' }
      lines.push({ descrizione: get('Descrizione'), quantita: get('Quantita'), um: get('UnitaMisura'), prezzoUnitario: get('PrezzoUnitario'), prezzoTotale: get('PrezzoTotale'), aliquotaIVA: get('AliquotaIVA') })
    }
    return lines
  }

  useEffect(() => { loadCicInvoices() }, [])

  const filtered = cicInvoices.filter(f => {
    if (fatSearch && !f.sender?.name?.toLowerCase().includes(fatSearch.toLowerCase()) && !f.number?.includes(fatSearch)) return false
    return true
  })

  return <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Totale fatture" icon="📄" value={cicInvoices.length} sub="da CiC" accent='#3B82F6' />
      <KPI label="Da assegnare" icon="📋" value={cicInvoices.filter(f => !localeMap[f.id] || localeMap[f.id] === 'Alhena Group').length} sub="senza locale" accent='#F97316' />
      <KPI label="Assegnate" icon="✓" value={cicInvoices.filter(f => localeMap[f.id] && localeMap[f.id] !== 'Alhena Group').length} sub="con locale" accent='#10B981' />
    </div>
    <Card title="Fatture passive da CiC" badge={fatLoading ? 'Caricamento...' : cicInvoices.length + ' fatture'} extra={
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="🔍 Fornitore / N° doc..." value={fatSearch} onChange={e => setFatSearch(e.target.value)} style={{ ...iS, width: 200 }} />
        <button onClick={loadCicInvoices} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Aggiorna</button>
      </div>
    }>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['', 'Data', 'Fornitore', 'N° Doc', 'Tipo', 'Stato', 'Locale', 'XML'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {cicInvoices.length === 0 && !fatLoading && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessuna fattura. Clicca "Aggiorna" per caricare da CiC. Serve essere loggati su fo.cassanova.com nella stessa sessione browser.</td></tr>}
            {filtered.slice(0, 50).map((f, i) => <>
              <tr key={f.id || i} onClick={() => { setExpandedFat(expandedFat === f.id ? null : f.id); if (expandedFat !== f.id) setXmlContent(null) }} style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, width: 24, color: '#64748b' }}>{expandedFat === f.id ? '▼' : '▶'}</td>
                <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{f.date}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{f.sender?.name || '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{f.number}</td>
                <td style={S.td}><span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>{f.doc_type || 'TD01'}</span></td>
                <td style={S.td}><span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>{f.current_status?.name || '—'}</span></td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <select value={localeMap[f.id] || 'Alhena Group'} onChange={e => setInvoiceLocale(f.id, e.target.value)} style={{ ...iS, fontSize: 11, padding: '3px 6px' }}>
                    <option value="Alhena Group">Alhena Group</option>
                    {sps.map(s => <option key={s.id} value={s.description || s.name}>{s.description || s.name}</option>)}
                  </select>
                </td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <button onClick={() => downloadXml(f)} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11 }}>Scarica</button>
                </td>
              </tr>
              {expandedFat === f.id && <tr key={'d' + (f.id || i)}><td colSpan={8} style={{ padding: '8px 14px 12px 38px', background: '#131825' }}>
                {!xmlContent && !xmlLoading && <button onClick={() => downloadXml(f)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600, fontSize: 12 }}>Carica dettaglio fattura (XML)</button>}
                {xmlLoading && <div style={{ padding: 12, color: '#F59E0B', fontSize: 12 }}>Caricamento XML...</div>}
                {xmlContent && xmlContent.length > 100 && (() => {
                  const lines = parseXmlLines(xmlContent)
                  return lines.length > 0 ? <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{lines.length} righe</span>
                      <button onClick={() => saveXmlFile(f)} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11 }}>Scarica XML</button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        {['Descrizione', 'Qtà', 'UM', 'Prezzo unit.', 'Prezzo tot.', 'IVA %'].map(h => <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 8px' }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {lines.map((l, j) => <tr key={j}>
                          <td style={{ ...S.td, fontSize: 12, fontWeight: 500, padding: '6px 8px' }}>{l.descrizione}</td>
                          <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{l.quantita}</td>
                          <td style={{ ...S.td, fontSize: 11, color: '#64748b', padding: '6px 8px' }}>{l.um}</td>
                          <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{l.prezzoUnitario ? Number(l.prezzoUnitario).toFixed(2) + ' €' : ''}</td>
                          <td style={{ ...S.td, fontSize: 12, fontWeight: 600, padding: '6px 8px' }}>{l.prezzoTotale ? Number(l.prezzoTotale).toFixed(2) + ' €' : ''}</td>
                          <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', padding: '6px 8px' }}>{l.aliquotaIVA}%</td>
                        </tr>)}
                      </tbody>
                    </table>
                  </> : <div style={{ padding: 8, fontSize: 12, color: '#94a3b8' }}>XML caricato ma nessuna riga articolo trovata.</div>
                })()}
                {xmlContent && xmlContent.length <= 100 && <div style={{ padding: 8, fontSize: 12, color: '#EF4444' }}>{xmlContent}</div>}
              </td></tr>}
            </>)}
          </tbody>
        </table>
      </div>
    </Card>
  </>
}
