import { useState, useEffect } from 'react'
import { S, KPI, Card, fmt, fmtD } from './shared/styles.jsx'
import { handleInvoiceFile } from '../lib/invoiceParsers.js'
import { supabase } from '../lib/supabase'

export default function InvoiceTab({ sp, sps, from, to, fatSearch, setFatSearch }) {
  // TS Digital invoices
  const [tsInvoices, setTsInvoices] = useState([])
  const [tsLoading, setTsLoading] = useState(false)
  const [tsError, setTsError] = useState(null)
  const [expandedTs, setExpandedTs] = useState(null)
  const [tsXmlContent, setTsXmlContent] = useState(null)
  const [tsXmlLoading, setTsXmlLoading] = useState(false)
  // Locale assignment (localStorage persisted)
  const [tsLocaleMap, setTsLocaleMap] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_ts_invoice_locales') || '{}') } catch { return {} } })
  // Upload file state (multi-file)
  const [uploadPreviews, setUploadPreviews] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileInputRef = { current: null }

  const iS = S.input

  // ─── TS Digital: carica fatture passive ────────────────────────────
  const loadTsInvoices = async () => {
    setTsLoading(true)
    setTsError(null)
    try {
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ts-list' }),
      })
      if (r.ok) {
        const d = await r.json()
        setTsInvoices(d.invoices || [])
      } else {
        const d = await r.json().catch(() => ({}))
        setTsError(d.error || 'Errore ' + r.status)
      }
    } catch (e) { setTsError(e.message) }
    setTsLoading(false)
  }

  useEffect(() => { loadTsInvoices() }, [])

  // ─── Locale assignment ─────────────────────────────────────────────
  const setTsInvoiceLocale = (hubId, locale) => {
    const newMap = { ...tsLocaleMap, [hubId]: locale }
    setTsLocaleMap(newMap)
    localStorage.setItem('cic_ts_invoice_locales', JSON.stringify(newMap))
  }

  // ─── XML download ──────────────────────────────────────────────────
  const downloadTsXml = async (inv) => {
    setTsXmlLoading(true); setTsXmlContent(null)
    try {
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ts-download', hubId: inv.hubId, ownerId: inv.ownerId, format: 'XML' }),
      })
      if (r.ok) {
        const d = await r.json()
        setTsXmlContent(d.content)
      } else { setTsXmlContent('XML non disponibile.') }
    } catch { setTsXmlContent('Errore download XML.') }
    setTsXmlLoading(false)
  }

  const saveTsXmlFile = (inv) => {
    if (!tsXmlContent || tsXmlContent.length < 100) return
    const blob = new Blob([tsXmlContent], { type: 'application/xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = inv.fileName || inv.docId + '.xml'
    a.click()
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

  // ─── Filtri ────────────────────────────────────────────────────────
  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps.find(s => String(s.id) === String(sp))?.description || sps.find(s => String(s.id) === String(sp))?.name || null)

  const tsFiltered = tsInvoices.filter(f => {
    // Filtro date (from/to dalla dashboard)
    if (from && f.docDate && f.docDate < from) return false
    if (to && f.docDate && f.docDate > to) return false
    // Filtro locale
    if (selectedLocaleName) {
      const assigned = tsLocaleMap[f.hubId]
      if (!assigned || assigned !== selectedLocaleName) return false
    }
    // Filtro ricerca
    if (fatSearch && !f.senderName?.toLowerCase().includes(fatSearch.toLowerCase()) && !f.docId?.includes(fatSearch)) return false
    return true
  })

  const unassignedCount = tsInvoices.filter(f => {
    if (from && f.docDate && f.docDate < from) return false
    if (to && f.docDate && f.docDate > to) return false
    return !tsLocaleMap[f.hubId]
  }).length

  return <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Fatture" icon="📄" value={tsFiltered.length} sub={tsLoading ? 'caricamento...' : (selectedLocaleName || 'tutti')} accent='#3B82F6' />
      <KPI label="Da assegnare" icon="📋" value={unassignedCount} sub="senza locale" accent='#F97316' />
      <KPI label="Totale importo" icon="💰" value={fmtD(tsFiltered.reduce((s, f) => s + (f.detail?.totalAmount || 0), 0))} sub={tsFiltered.length + ' fatture'} accent='#10B981' />
    </div>

    {tsError && (
      <div style={{ ...S.card, marginBottom: 12, borderLeft: '3px solid #EF4444', fontSize: 12, color: '#EF4444' }}>
        Errore TS Digital: {tsError}
      </div>
    )}

    {/* Upload file fatture (multi-file) */}
    <Card title="📤 Carica fatture da file" badge="XML · CSV · PDF" extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }}
          disabled={uploading}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >{uploading ? '...' : '📤 Seleziona file'}</button>
        <input
          type="file"
          accept=".xml,.csv,.pdf"
          multiple
          ref={el => fileInputRef.current = el}
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            if (!files.length) return
            setUploading(true); setUploadMsg(null)
            const results = [], errors = []
            for (const file of files) {
              try {
                const parsed = await handleInvoiceFile(file)
                parsed._id = Math.random().toString(36).slice(2, 9)
                parsed._expanded = files.length === 1
                parsed._filename = file.name
                results.push(parsed)
              } catch (err) { errors.push(`${file.name}: ${err.message}`) }
            }
            if (results.length > 0) setUploadPreviews(prev => [...prev, ...results])
            if (errors.length > 0) setUploadMsg({ ok: false, text: errors.join(' · ') })
            setUploading(false)
          }}
        />
      </div>
    }>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        Seleziona una o piu fatture, DDT o note di credito (XML, CSV, PDF). Le righe verranno salvate nel magazzino.
      </div>

      {uploadMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6,
          background: uploadMsg.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
          border: `1px solid ${uploadMsg.ok ? '#10B981' : '#EF4444'}`,
          color: uploadMsg.ok ? '#10B981' : '#EF4444', fontSize: 12,
        }}>{uploadMsg.text}</div>
      )}

      {uploadPreviews.length > 0 && (
        <div style={{ border: '1px solid #F59E0B', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ background: '#F59E0B', color: '#0f1420', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{uploadPreviews.length} fatture da importare</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { setUploadPreviews([]); setUploadMsg(null) }}
                style={{ background: 'rgba(0,0,0,.2)', border: 'none', color: '#0f1420', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Annulla tutte</button>
              <button onClick={async () => {
                setUploading(true); setUploadMsg(null)
                const { data: { user } } = await supabase.auth.getUser()
                let saved = 0, totalRows = 0, errors = []
                for (const preview of uploadPreviews) {
                  try {
                    const selectedRows = preview.righe.filter(r => r.selected)
                    if (selectedRows.length === 0) continue
                    const totale = selectedRows.reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0)
                    const { data: inv, error: invErr } = await supabase.from('warehouse_invoices').insert({
                      user_id: user.id, data: preview.data || new Date().toISOString().split('T')[0],
                      numero: preview.numero || '', fornitore: preview.fornitore || '',
                      locale: '', totale: Math.round(totale * 100) / 100,
                      tipo_doc: preview.tipo_doc || 'fattura', stato: 'bozza',
                    }).select('id').single()
                    if (invErr) throw new Error(invErr.message)
                    const { error: itErr } = await supabase.from('warehouse_invoice_items').insert(
                      selectedRows.map(r => ({ invoice_id: inv.id, nome_fattura: r.nome_fattura, quantita: Number(r.quantita) || 0, unita: r.unita || '', prezzo_unitario: Number(r.prezzo_unitario) || 0, prezzo_totale: Number(r.prezzo_totale) || 0, stato_match: 'non_abbinato' }))
                    )
                    if (itErr) throw new Error(itErr.message)
                    saved++; totalRows += selectedRows.length
                  } catch (err) { errors.push(`${preview.fornitore || preview._filename}: ${err.message}`) }
                }
                setUploadPreviews([])
                setUploadMsg(errors.length > 0
                  ? { ok: false, text: `${saved} salvate, ${errors.length} errori: ${errors.join(' · ')}` }
                  : { ok: true, text: `${saved} fatture salvate con ${totalRows} righe (visibili in Magazzino → Fatture)` })
                setUploading(false)
              }} disabled={uploading}
                style={{ background: '#0f1420', border: 'none', color: '#10B981', padding: '4px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >{uploading ? 'Salvataggio...' : '💾 Salva tutte'}</button>
            </div>
          </div>
          {uploadPreviews.map(preview => {
            const selRows = preview.righe.filter(r => r.selected)
            const selTot = selRows.reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0)
            return <div key={preview._id} style={{ borderTop: '1px solid #2a3042' }}>
              <div onClick={() => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, _expanded: !p._expanded } : p))}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#131825', cursor: 'pointer' }}>
                <span style={{ color: '#64748b', fontSize: 12 }}>{preview._expanded ? '▼' : '▶'}</span>
                <span style={S.badge(preview.format === 'PDF' ? '#F59E0B' : '#10B981', preview.format === 'PDF' ? 'rgba(245,158,11,.15)' : 'rgba(16,185,129,.15)')}>{preview.format}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{preview.fornitore || preview._filename || '—'}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{preview.numero ? `N. ${preview.numero}` : ''}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{preview.data}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>{fmt(selTot)}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{selRows.length} righe</span>
                <button onClick={e => { e.stopPropagation(); setUploadPreviews(prev => prev.filter(p => p._id !== preview._id)) }}
                  style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
              {preview._expanded && (
                <div style={{ padding: '12px 14px', background: '#0f1420' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 8, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Fornitore</label>
                      <input value={preview.fornitore} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, fornitore: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Data</label>
                      <input type="date" value={preview.data} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, data: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Numero</label>
                      <input value={preview.numero} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, numero: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2 }}>Tipo</label>
                      <select value={preview.tipo_doc} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, tipo_doc: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }}>
                        <option value="fattura">Fattura</option><option value="nota_credito">Nota di credito</option><option value="ddt">DDT</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                        <th style={{ ...S.th, width: 30 }}></th><th style={S.th}>Descrizione</th><th style={S.th}>Qty</th><th style={S.th}>UM</th><th style={S.th}>P. unit.</th><th style={S.th}>Totale</th>
                      </tr></thead>
                      <tbody>
                        {preview.righe.map((r, i) => (
                          <tr key={i} style={{ opacity: r.selected ? 1 : 0.4 }}>
                            <td style={S.td}><input type="checkbox" checked={r.selected} onChange={() => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, righe: p.righe.map((rr, j) => j === i ? { ...rr, selected: !rr.selected } : rr) } : p))} style={{ accentColor: '#F59E0B' }} /></td>
                            <td style={{ ...S.td, fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome_fattura}</td>
                            <td style={{ ...S.td, fontSize: 12 }}>{r.quantita || '—'}</td>
                            <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.unita || '—'}</td>
                            <td style={{ ...S.td, fontSize: 12 }}>{r.prezzo_unitario ? fmt(r.prezzo_unitario) : '—'}</td>
                            <td style={{ ...S.td, fontSize: 12, fontWeight: 600 }}>{fmt(r.prezzo_totale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          })}
        </div>
      )}
    </Card>

    {/* Fatture TS Digital */}
    <Card title="Fatture passive — TS Digital" badge={tsLoading ? 'Caricamento...' : tsFiltered.length + ' fatture'} extra={
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="🔍 Fornitore / N° doc..." value={fatSearch} onChange={e => setFatSearch(e.target.value)} style={{ ...iS, width: 200 }} />
        <button onClick={loadTsInvoices} disabled={tsLoading} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600, fontSize: 12 }}>
          {tsLoading ? '...' : 'Aggiorna'}
        </button>
      </div>
    }>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['', 'Data', 'Fornitore', 'N° Doc', 'Tipo', 'Importo', 'Stato', 'Locale', 'XML'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {tsFiltered.length === 0 && !tsLoading && <tr><td colSpan={9} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessuna fattura nel periodo selezionato.</td></tr>}
            {[...tsFiltered].sort((a, b) => (b.docDate || '').localeCompare(a.docDate || '')).slice(0, 100).map((f, i) => {
              const isExpanded = expandedTs === f.hubId
              return <><tr key={f.hubId || i}
                onClick={() => { setExpandedTs(isExpanded ? null : f.hubId); if (!isExpanded) setTsXmlContent(null) }}
                style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e', background: isExpanded ? '#131825' : 'transparent' }}>
                <td style={{ ...S.td, width: 24, color: '#64748b' }}>{isExpanded ? '▼' : '▶'}</td>
                <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{f.docDate}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{f.senderName || '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{f.docId || '—'}</td>
                <td style={S.td}><span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>{f.detail?.td || 'TD01'}</span></td>
                <td style={{ ...S.td, fontWeight: 600 }}>{f.detail?.totalAmount != null ? fmt(f.detail.totalAmount) : '—'}</td>
                <td style={S.td}><span style={S.badge(
                  f.currentStatusName === 'A_DISPOSIZIONE' ? '#10B981' : '#F59E0B',
                  f.currentStatusName === 'A_DISPOSIZIONE' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)'
                )}>{f.currentStatusName === 'A_DISPOSIZIONE' ? 'Ricevuta' : (f.currentStatusName || '—')}</span></td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <select value={tsLocaleMap[f.hubId] || ''} onChange={e => setTsInvoiceLocale(f.hubId, e.target.value)} style={{ ...iS, fontSize: 11, padding: '3px 6px' }}>
                    <option value="">— assegna —</option>
                    {sps.map(s => <option key={s.id} value={s.description || s.name}>{s.description || s.name}</option>)}
                  </select>
                </td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <button onClick={() => downloadTsXml(f)} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11 }}>XML</button>
                </td>
              </tr>
              {isExpanded && <tr key={'ts-d-' + (f.hubId || i)}><td colSpan={9} style={{ padding: '8px 14px 12px 38px', background: '#131825' }}>
                {!tsXmlContent && !tsXmlLoading && <button onClick={() => downloadTsXml(f)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600, fontSize: 12 }}>Carica dettaglio fattura (XML)</button>}
                {tsXmlLoading && <div style={{ padding: 12, color: '#F59E0B', fontSize: 12 }}>Caricamento XML...</div>}
                {tsXmlContent && tsXmlContent.length > 100 && (() => {
                  const lines = parseXmlLines(tsXmlContent)
                  return lines.length > 0 ? <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{lines.length} righe</span>
                      <button onClick={() => saveTsXmlFile(f)} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11 }}>Scarica XML</button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        {['Descrizione', 'Qty', 'UM', 'Prezzo unit.', 'Prezzo tot.', 'IVA %'].map(h => <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 8px' }}>{h}</th>)}
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
                  </> : <div style={{ padding: 8, fontSize: 12, color: '#94a3b8' }}>XML caricato ma nessuna riga trovata.</div>
                })()}
                {tsXmlContent && tsXmlContent.length <= 100 && <div style={{ padding: 8, fontSize: 12, color: '#EF4444' }}>{tsXmlContent}</div>}
              </td></tr>}
              </>
            })}
          </tbody>
        </table>
      </div>
    </Card>
  </>
}
