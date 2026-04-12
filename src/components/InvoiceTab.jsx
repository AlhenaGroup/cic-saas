import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { S, KPI, Card, fmt, fmtD } from './shared/styles.jsx'
import { handleInvoiceFile } from '../lib/invoiceParsers.js'

export default function InvoiceTab({ sps, fatSearch, setFatSearch }) {
  const [cicInvoices, setCicInvoices] = useState([])
  const [fatLoading, setFatLoading] = useState(false)
  const [localeMap, setLocaleMap] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_invoice_locales') || '{}') } catch { return {} } })
  const [expandedFat, setExpandedFat] = useState(null)
  const [xmlContent, setXmlContent] = useState(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  // Upload file state
  const [uploadPreview, setUploadPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileInputRef = { current: null }

  const iS = S.input

  const [sessionCookie, setSessionCookie] = useState(() => localStorage.getItem('cic_session_cookie') || '')
  const [showCookieInput, setShowCookieInput] = useState(false)

  const loadCicInvoices = async () => {
    if (!sessionCookie) { setShowCookieInput(true); return }
    setFatLoading(true)
    try {
      const r = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', sessionCookie }) })
      if (r.ok) {
        const d = await r.json()
        setCicInvoices(d.invoices || [])
        if (d.invoices?.length) localStorage.setItem('cic_session_cookie', sessionCookie)
      } else {
        const d = await r.json().catch(() => ({}))
        if (d.needsSession) setShowCookieInput(true)
      }
    } catch {}
    setFatLoading(false)
  }

  const saveCookie = () => {
    localStorage.setItem('cic_session_cookie', sessionCookie)
    setShowCookieInput(false)
    loadCicInvoices()
  }

  const downloadXml = async (inv) => {
    setXmlLoading(true); setXmlContent(null)
    try {
      const r = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'xml', sessionCookie, invoiceId: inv.id, spId: inv.salespoint_id }) })
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
    {/* Cookie CiC input */}
    {showCookieInput && <div style={{ ...S.card, marginBottom: 12, borderLeft: '3px solid #F59E0B' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>Connessione a Cassa in Cloud</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
        Per caricare le fatture serve il cookie di sessione CiC. Apri <a href="https://fo.cassanova.com" target="_blank" style={{ color: '#F59E0B' }}>fo.cassanova.com</a>,
        poi apri la console del browser (F12 → Console) e digita: <code style={{ background: '#0f1420', padding: '2px 6px', borderRadius: 4 }}>document.cookie</code> — copia il risultato e incollalo qui.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={sessionCookie} onChange={e => setSessionCookie(e.target.value)} placeholder="Incolla il cookie di sessione CiC..." style={{ ...iS, flex: 1 }} />
        <button onClick={saveCookie} disabled={!sessionCookie} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Connetti</button>
        <button onClick={() => setShowCookieInput(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Chiudi</button>
      </div>
    </div>}

    {/* Upload file fattura */}
    <Card title="📤 Carica fattura da file" badge="XML · CSV · PDF" extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }}
          disabled={uploading}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >{uploading ? '...' : '📤 Seleziona file'}</button>
        <input
          type="file"
          accept=".xml,.csv,.pdf"
          ref={el => fileInputRef.current = el}
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setUploading(true); setUploadMsg(null)
            try {
              const parsed = await handleInvoiceFile(file)
              setUploadPreview(parsed)
            } catch (err) {
              setUploadMsg({ ok: false, text: err.message })
            } finally { setUploading(false) }
          }}
        />
      </div>
    }>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        Carica una fattura, DDT o nota di credito in formato XML (FatturaPA), CSV o PDF. Le righe verranno lette automaticamente e salvate nel magazzino.
      </div>

      {uploadMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6,
          background: uploadMsg.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
          border: `1px solid ${uploadMsg.ok ? '#10B981' : '#EF4444'}`,
          color: uploadMsg.ok ? '#10B981' : '#EF4444', fontSize: 12,
        }}>{uploadMsg.text}</div>
      )}

      {uploadPreview && (
        <div style={{ background: '#131825', borderRadius: 8, padding: 16, border: '1px solid #F59E0B' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Anteprima fattura</div>
            <span style={S.badge(
              uploadPreview.format === 'PDF' ? '#F59E0B' : '#10B981',
              uploadPreview.format === 'PDF' ? 'rgba(245,158,11,.15)' : 'rgba(16,185,129,.15)'
            )}>{uploadPreview.format} {uploadPreview.format === 'PDF' ? '⚠ verifica' : '✓'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Fornitore</label>
              <input value={uploadPreview.fornitore} onChange={e => setUploadPreview(p => ({ ...p, fornitore: e.target.value }))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Data</label>
              <input type="date" value={uploadPreview.data} onChange={e => setUploadPreview(p => ({ ...p, data: e.target.value }))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Numero</label>
              <input value={uploadPreview.numero} onChange={e => setUploadPreview(p => ({ ...p, numero: e.target.value }))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Tipo</label>
              <select value={uploadPreview.tipo_doc} onChange={e => setUploadPreview(p => ({ ...p, tipo_doc: e.target.value }))} style={{ ...iS, width: '100%', marginBottom: 8 }}>
                <option value="fattura">Fattura</option>
                <option value="nota_credito">Nota di credito</option>
                <option value="ddt">DDT</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10, fontSize: 12, color: '#94a3b8' }}>
            {uploadPreview.righe.filter(r => r.selected).length} righe selezionate · Totale: <strong style={{ color: '#F59E0B' }}>{fmt(uploadPreview.righe.filter(r => r.selected).reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0))}</strong>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                <th style={{ ...S.th, width: 30 }}></th>
                <th style={S.th}>Descrizione</th>
                <th style={S.th}>Qty</th>
                <th style={S.th}>UM</th>
                <th style={S.th}>Prezzo unit.</th>
                <th style={S.th}>Totale</th>
              </tr></thead>
              <tbody>
                {uploadPreview.righe.map((r, i) => (
                  <tr key={i} style={{ opacity: r.selected ? 1 : 0.4 }}>
                    <td style={S.td}>
                      <input type="checkbox" checked={r.selected} onChange={() => {
                        setUploadPreview(p => ({ ...p, righe: p.righe.map((rr, j) => j === i ? { ...rr, selected: !rr.selected } : rr) }))
                      }} style={{ accentColor: '#F59E0B' }} />
                    </td>
                    <td style={{ ...S.td, fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome_fattura}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{r.quantita || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.unita || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{r.prezzo_unitario ? fmt(r.prezzo_unitario) : '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, fontWeight: 600 }}>{fmt(r.prezzo_totale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setUploadPreview(null); setUploadMsg(null) }}
              style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 14px', fontSize: 12 }}>Annulla</button>
            <button onClick={async () => {
              setUploading(true); setUploadMsg(null)
              try {
                const { data: { user } } = await supabase.auth.getUser()
                const selectedRows = uploadPreview.righe.filter(r => r.selected)
                const totale = selectedRows.reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0)
                const { data: inv, error: invErr } = await supabase.from('warehouse_invoices').insert({
                  user_id: user.id, data: uploadPreview.data || new Date().toISOString().split('T')[0],
                  numero: uploadPreview.numero || '', fornitore: uploadPreview.fornitore || '',
                  locale: '', totale: Math.round(totale * 100) / 100,
                  tipo_doc: uploadPreview.tipo_doc || 'fattura', stato: 'bozza',
                }).select('id').single()
                if (invErr) throw new Error(invErr.message)
                if (selectedRows.length > 0) {
                  const { error: itErr } = await supabase.from('warehouse_invoice_items').insert(
                    selectedRows.map(r => ({
                      invoice_id: inv.id, nome_fattura: r.nome_fattura,
                      quantita: Number(r.quantita) || 0, unita: r.unita || '',
                      prezzo_unitario: Number(r.prezzo_unitario) || 0,
                      prezzo_totale: Number(r.prezzo_totale) || 0, stato_match: 'non_abbinato',
                    }))
                  )
                  if (itErr) throw new Error(itErr.message)
                }
                setUploadMsg({ ok: true, text: `Fattura salvata con ${selectedRows.length} righe (visibile in Magazzino → Fatture)` })
                setUploadPreview(null)
              } catch (err) {
                setUploadMsg({ ok: false, text: err.message })
              } finally { setUploading(false) }
            }} disabled={uploading || !uploadPreview.righe.some(r => r.selected)}
              style={{
                ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 700, fontSize: 12,
                cursor: uploadPreview.righe.some(r => r.selected) ? 'pointer' : 'not-allowed',
              }}>{uploading ? 'Salvataggio...' : '💾 Salva fattura + righe'}</button>
          </div>
        </div>
      )}
    </Card>

    <Card title="Fatture passive da CiC" badge={fatLoading ? 'Caricamento...' : cicInvoices.length + ' fatture'} extra={
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="🔍 Fornitore / N° doc..." value={fatSearch} onChange={e => setFatSearch(e.target.value)} style={{ ...iS, width: 200 }} />
        <button onClick={() => sessionCookie ? loadCicInvoices() : setShowCookieInput(true)} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 600 }}>{sessionCookie ? 'Aggiorna' : 'Configura CiC'}</button>
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
