import { useState, useEffect, useCallback } from 'react'
import { S, KPI, Card, fmt, fmtD } from './shared/styles.jsx'
import { handleInvoiceFile } from '../lib/invoiceParsers.js'
import { supabase } from '../lib/supabase'
import { loadAndSyncAssignments, saveAssignment } from '../lib/invoiceAssignments.js'

export default function InvoiceTab({ sp, sps, from, to, fatSearch, setFatSearch }) {
  // TS Digital invoices (paginazione server-side)
  const [tsInvoices, setTsInvoices] = useState([])
  const [tsLoading, setTsLoading] = useState(false)
  const [tsError, setTsError] = useState(null)
  const [tsPage, setTsPage] = useState(0)
  const [tsPages, setTsPages] = useState([null]) // array di continuationToken per ogni pagina (index 0 = null = prima pagina)
  const [tsHasNext, setTsHasNext] = useState(false)
  // Cache completa di tutte le pagine: pre-fetch in background per filtri/conteggi globali
  const [tsAllInvoices, setTsAllInvoices] = useState(null)
  const [tsAllLoading, setTsAllLoading] = useState(false)
  const [expandedTs, setExpandedTs] = useState(null)
  const [tsXmlContent, setTsXmlContent] = useState(null)
  const [tsXmlLoading, setTsXmlLoading] = useState(false)
  // Locale assignment (localStorage persisted)
  const [tsLocaleMap, setTsLocaleMap] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_ts_invoice_locales') || '{}') } catch { return {} } })
  // Auto-assigned (non confermate dall'utente) — hubId set
  const [tsAutoAssigned, setTsAutoAssigned] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_ts_auto_assigned') || '{}') } catch { return {} } })
  // Item-level locale overrides: "hubId:lineIdx" locale (quando diverso dalla fattura)
  const [tsItemLocaleMap, setTsItemLocaleMap] = useState(() => { try { return JSON.parse(localStorage.getItem('cic_ts_item_locales') || '{}') } catch { return {} } })
  // Parsed XML lines per invoice espansa
  const [expandedLines, setExpandedLines] = useState([])
  // Filtro "solo da assegnare"
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false)
  // Upload file state (multi-file)
  const [uploadPreviews, setUploadPreviews] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileInputRef = { current: null }

  const iS = S.input

  // ─── TS Digital: carica fatture passive ────────────────────────────
  const loadTsPage = async (pageIdx) => {
    setTsLoading(true)
    setTsError(null)
    try {
      const ct = tsPages[pageIdx] || null
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ts-list', continuationToken: ct }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setTsError(d.error || 'Errore ' + r.status)
      } else {
        const d = await r.json()
        setTsInvoices(d.invoices || [])
        setTsHasNext(d.hasNext || false)
        // Salva il continuationToken per la pagina successiva
        if (d.hasNext && d.continuationToken) {
          setTsPages(prev => {
            const next = [...prev]
            next[pageIdx + 1] = d.continuationToken
            return next
          })
        }
        setTsPage(pageIdx)
      }
    } catch (e) { setTsError(e.message) }
    setTsLoading(false)
  }

  // Prefetch di tutte le pagine in background — STREAMING:
  // aggiorno tsAllInvoices ad ogni pagina caricata cosi' l'utente vede
  // i risultati crescere progressivamente invece di aspettare la fine.
  const loadAllPages = useCallback(async () => {
    if (tsAllLoading) return
    setTsAllLoading(true)
    try {
      const acc = []
      let ct = null
      let pageCount = 0
      do {
        const r = await fetch('/api/invoices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ts-list', continuationToken: ct }),
        })
        if (!r.ok) break
        const d = await r.json()
        acc.push(...(d.invoices || []))
        pageCount++
        // Aggiorna lo stato ogni pagina (streaming) — l'UI vede crescere il dataset
        setTsAllInvoices([...acc])
        ct = d.hasNext ? d.continuationToken : null
        if (pageCount > 200) break // safety cap
      } while (ct)
    } catch (e) { console.warn('[InvoiceTab] loadAllPages:', e.message) }
    setTsAllLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadTsPage(0)
    const t = setTimeout(() => { loadAllPages() }, 1500)
    // Sync assegnazioni da DB (cross-device)
    ;(async () => {
      try {
        const { localeMap, autoAssigned, itemMap } = await loadAndSyncAssignments()
        setTsLocaleMap(localeMap)
        setTsAutoAssigned(autoAssigned)
        setTsItemLocaleMap(itemMap)
      } catch (e) { console.warn('[InvoiceTab] sync assignments:', e.message) }
    })()
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── HERA auto-assign per POD/PDR ─────────────────────────────────
  const HERA_POD_MAP = {
    'IT001E01488580': 'Alhena Group',      // Laboratorio
    'IT001E01490244': 'CASA DE AMICIS',
    'IT001E04347093': 'REMEMBEER',
    'IT001E01490223': 'BIANCOLATTE',
    '15910000041301': 'Alhena Group',      // Ufficio amm. gas
    '15910000050731': 'REMEMBEER',         // gas
    '3041560782': 'CASA DE AMICIS',
    '3041562164': 'REMEMBEER',
    '3041568067': 'BIANCOLATTE',
    '3041626717': 'Alhena Group',
    '3041626999': 'REMEMBEER',
  }

  const autoAssignHera = async (invoices, currentMap) => {
    const heraInvs = invoices.filter(f => /hera/i.test(f.senderName || '') && !currentMap[f.hubId])
    if (heraInvs.length === 0) return currentMap
    let updated = { ...currentMap }
    const autoNew = {}
    for (const inv of heraInvs) {
      // Scarica XML per trovare POD/PDR
      try {
        const r = await fetch('/api/invoices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ts-download', hubId: inv.hubId, ownerId: inv.ownerId, format: 'XML' }),
        })
        if (!r.ok) continue
        const { content: xml } = await r.json()
        // Cerca POD o PDR nel XML
        for (const [code, locale] of Object.entries(HERA_POD_MAP)) {
          if (xml && xml.includes(code)) { updated[inv.hubId] = locale; autoNew[inv.hubId] = true; break }
        }
      } catch {}
    }
    if (Object.keys(updated).length > Object.keys(currentMap).length) {
      setTsLocaleMap(updated)
      const autoMap = { ...tsAutoAssigned, ...autoNew }
      setTsAutoAssigned(autoMap)
      // Salva nuove auto-assignments su DB
      for (const hubId in autoNew) {
        if (updated[hubId]) {
          try { await saveAssignment(hubId, { locale: updated[hubId], autoAssigned: true }) } catch {}
        }
      }
    }
    return updated
  }

  // Auto-assign HERA quando le fatture vengono caricate
  useEffect(() => {
    if (tsInvoices.length > 0) autoAssignHera(tsInvoices, tsLocaleMap)
  }, [tsInvoices])

  // ─── Locale assignment (sync DB + LS) ──────────────────────────────
  const setTsInvoiceLocale = async (hubId, locale) => {
    const newMap = { ...tsLocaleMap, [hubId]: locale }
    setTsLocaleMap(newMap)
    const newAuto = { ...tsAutoAssigned }
    delete newAuto[hubId]
    setTsAutoAssigned(newAuto)
    const newItemMap = { ...tsItemLocaleMap }
    Object.keys(newItemMap).forEach(k => { if (k.startsWith(hubId + ':')) delete newItemMap[k] })
    setTsItemLocaleMap(newItemMap)
    // Salva su DB (cross-device)
    await saveAssignment(hubId, { locale, autoAssigned: false, itemOverrides: {} })
  }

  const setTsItemLocale = async (hubId, lineIdx, locale) => {
    const key = hubId + ':' + lineIdx
    const invoiceLocale = tsLocaleMap[hubId] || ''
    const newItemMap = { ...tsItemLocaleMap }
    if (locale === invoiceLocale || !locale) {
      delete newItemMap[key]
    } else {
      newItemMap[key] = locale
    }
    setTsItemLocaleMap(newItemMap)
    // Costruisci items per questo hubId da salvare su DB
    const items = {}
    for (const k in newItemMap) {
      if (k.startsWith(hubId + ':')) items[k.substring(hubId.length + 1)] = newItemMap[k]
    }
    await saveAssignment(hubId, { itemOverrides: items })
  }

  // Helper: locale effettivo di una riga
  const getItemLocale = (hubId, lineIdx) => {
    return tsItemLocaleMap[hubId + ':' + lineIdx] || tsLocaleMap[hubId] || ''
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

  // ─── Filtri sull'intero archivio (se cache pronta), altrimenti pagina corrente ──
  const selectedLocaleName = (!sp || sp === 'all') ? null : (sps.find(s => String(s.id) === String(sp))?.description || sps.find(s => String(s.id) === String(sp))?.name || null)
  const sourceInvoices = tsAllInvoices || tsInvoices
  const usingFullCache = !!tsAllInvoices

  const filterFn = (f) => {
    if (showOnlyUnassigned && tsLocaleMap[f.hubId]) return false
    // Filtro per locale selezionato (solo se locale specifico, non 'all')
    if (selectedLocaleName) {
      const assigned = tsLocaleMap[f.hubId]
      if (!assigned || assigned !== selectedLocaleName) return false
    }
    if (fatSearch && !f.senderName?.toLowerCase().includes(fatSearch.toLowerCase()) && !f.docId?.includes(fatSearch)) return false
    // Filtro periodo (header globale): docDate e' "YYYY-MM-DD"
    const d = (f.docDate || '').slice(0, 10)
    if (from && d && d < from) return false
    if (to && d && d > to) return false
    return true
  }
  const tsFiltered = sourceInvoices.filter(filterFn)

  // Paginazione client-side se abbiamo la cache completa
  const PAGE_SIZE = 100
  const totalPages = usingFullCache ? Math.max(1, Math.ceil(tsFiltered.length / PAGE_SIZE)) : null
  const safePage = usingFullCache ? Math.min(tsPage, totalPages - 1) : tsPage
  const tsPaginated = usingFullCache ? tsFiltered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE) : tsFiltered

  // Conteggi globali coerenti
  const unassignedCount = sourceInvoices.filter(f => {
    if (selectedLocaleName) {
      // Quando filtro per locale, "da assegnare" sono solo quelle non assegnate al locale corrente
      return !tsLocaleMap[f.hubId]
    }
    return !tsLocaleMap[f.hubId]
  }).length
  const autoCount = sourceInvoices.filter(f => tsAutoAssigned[f.hubId]).length

  return <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Fatture" icon="" value={tsFiltered.length} sub={tsLoading ? 'caricamento...' : (showOnlyUnassigned ? 'solo da assegnare' : (selectedLocaleName || 'tutti'))} accent='#3B82F6' />
      <div onClick={() => setShowOnlyUnassigned(!showOnlyUnassigned)} style={{ cursor: 'pointer' }}>
        <KPI label={showOnlyUnassigned ? 'Filtro attivo' : 'Da assegnare'} icon="" value={unassignedCount} sub={showOnlyUnassigned ? 'click per mostrare tutte' : 'click per filtrare'} accent={showOnlyUnassigned ? '#10B981' : '#F97316'} />
      </div>
      <KPI label="Totale importo" icon="" value={fmtD(tsFiltered.reduce((s, f) => {
        const isNC = f.detail?.td === 'TD04' || f.detail?.td === 'TD05'
        return s + (isNC ? -Math.abs(f.detail?.totalAmount || 0) : (f.detail?.totalAmount || 0))
      }, 0))} sub={tsFiltered.length + ' fatture'} accent='#10B981' />
    </div>

    {tsError && (
      <div style={{ ...S.card, marginBottom: 12, borderLeft: '3px solid #EF4444', fontSize: 12, color: '#EF4444' }}>
        Errore TS Digital: {tsError}
      </div>
    )}

    {/* Upload file fatture (multi-file) */}
    <Card title="Carica fatture da file" badge="XML · CSV · PDF" extra={
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }}
          disabled={uploading}
          style={{ ...iS, background: '#F59E0B', color: 'var(--text)', border: 'none', padding: '6px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >{uploading ? '...' : 'Seleziona file'}</button>
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
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
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
          <div style={{ background: '#F59E0B', color: 'var(--text)', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{uploadPreviews.length} fatture da importare</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { setUploadPreviews([]); setUploadMsg(null) }}
                style={{ background: 'rgba(0,0,0,.2)', border: 'none', color: 'var(--text)', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Annulla tutte</button>
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
                  : { ok: true, text: `${saved} fatture salvate con ${totalRows} righe (visibili in Magazzino Fatture)` })
                setUploading(false)
              }} disabled={uploading}
                style={{ background: 'var(--bg)', border: 'none', color: '#10B981', padding: '4px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >{uploading ? 'Salvataggio...' : 'Salva tutte'}</button>
            </div>
          </div>
          {uploadPreviews.map(preview => {
            const selRows = preview.righe.filter(r => r.selected)
            const selTot = selRows.reduce((s, r) => s + (Number(r.prezzo_totale) || 0), 0)
            return <div key={preview._id} style={{ borderTop: '1px solid var(--border)' }}>
              <div onClick={() => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, _expanded: !p._expanded } : p))}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface2)', cursor: 'pointer' }}>
                <span style={{ color: 'var(--text3)', fontSize: 12 }}>{preview._expanded ? '' : ''}</span>
                <span style={S.badge(preview.format === 'PDF' ? '#F59E0B' : '#10B981', preview.format === 'PDF' ? 'rgba(245,158,11,.15)' : 'rgba(16,185,129,.15)')}>{preview.format}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{preview.fornitore || preview._filename || '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{preview.numero ? `N. ${preview.numero}` : ''}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{preview.data}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>{fmt(selTot)}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{selRows.length} righe</span>
                <button onClick={e => { e.stopPropagation(); setUploadPreviews(prev => prev.filter(p => p._id !== preview._id)) }}
                  style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
              {preview._expanded && (
                <div style={{ padding: '12px 14px', background: 'var(--bg)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 8, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>Fornitore</label>
                      <input value={preview.fornitore} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, fornitore: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>Data</label>
                      <input type="date" value={preview.data} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, data: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>Numero</label>
                      <input value={preview.numero} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, numero: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>Tipo</label>
                      <select value={preview.tipo_doc} onChange={e => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, tipo_doc: e.target.value } : p))} style={{ ...iS, width: '100%', marginBottom: 8 }}>
                        <option value="fattura">Fattura</option><option value="nota_credito">Nota di credito</option><option value="ddt">DDT</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ ...S.th, width: 30 }}></th><th style={S.th}>Descrizione</th><th style={S.th}>Qty</th><th style={S.th}>UM</th><th style={S.th}>P. unit.</th><th style={S.th}>Totale</th>
                      </tr></thead>
                      <tbody>
                        {preview.righe.map((r, i) => (
                          <tr key={i} style={{ opacity: r.selected ? 1 : 0.4 }}>
                            <td style={S.td}><input type="checkbox" checked={r.selected} onChange={() => setUploadPreviews(prev => prev.map(p => p._id === preview._id ? { ...p, righe: p.righe.map((rr, j) => j === i ? { ...rr, selected: !rr.selected } : rr) } : p))} style={{ accentColor: '#F59E0B' }} /></td>
                            <td style={{ ...S.td, fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome_fattura}</td>
                            <td style={{ ...S.td, fontSize: 12 }}>{r.quantita || '—'}</td>
                            <td style={{ ...S.td, fontSize: 12, color: 'var(--text3)' }}>{r.unita || '—'}</td>
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
    <Card title="Fatture passive — TS Digital" badge={tsLoading ? 'Caricamento...' : (usingFullCache ? `${tsFiltered.length} · Pag. ${safePage + 1}/${totalPages}` : `Pagina ${tsPage + 1}`)} extra={
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input placeholder="Fornitore / N° doc..." value={fatSearch} onChange={e => setFatSearch(e.target.value)} style={{ ...iS, width: 200 }} />
        <button onClick={() => loadTsPage(0)} disabled={tsLoading} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 600, fontSize: 12 }}>
          {tsLoading ? '...' : 'Ricarica'}
        </button>
      </div>
    }>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['', 'Data', 'Fornitore', 'N° Doc', 'Tipo', 'Importo', 'Stato', 'Locale', 'XML'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {tsFiltered.length === 0 && !tsLoading && <tr><td colSpan={9} style={{ ...S.td, color: 'var(--text3)', textAlign: 'center', padding: 20 }}>Nessuna fattura nel periodo selezionato.</td></tr>}
            {[...tsPaginated].sort((a, b) => (b.docDate || '').localeCompare(a.docDate || '')).map((f, i) => {
              const isExpanded = expandedTs === f.hubId
              const isNotaCredito = f.detail?.td === 'TD04' || f.detail?.td === 'TD05'
              const displayAmount = f.detail?.totalAmount != null ? (isNotaCredito ? -Math.abs(f.detail.totalAmount) : f.detail.totalAmount) : null
              return <><tr key={f.hubId || i}
                onClick={async () => {
                  if (isExpanded) { setExpandedTs(null); setExpandedLines([]); setTsXmlContent(null); return }
                  setExpandedTs(f.hubId); setExpandedLines([]); setTsXmlContent(null)
                  // Auto-scarica XML e parsa righe
                  setTsXmlLoading(true)
                  try {
                    const r = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'ts-download', hubId: f.hubId, ownerId: f.ownerId, format: 'XML' }) })
                    if (r.ok) { const d = await r.json(); setTsXmlContent(d.content); setExpandedLines(parseXmlLines(d.content)) }
                  } catch {} finally { setTsXmlLoading(false) }
                }}
                style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e', background: isExpanded ? '#131825' : (isNotaCredito ? 'rgba(16,185,129,.04)' : 'transparent') }}>
                <td style={{ ...S.td, width: 24, color: 'var(--text3)' }}>{isExpanded ? '' : ''}</td>
                <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{f.docDate}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{f.senderName || '—'}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12 }}>{f.docId || '—'}</td>
                <td style={S.td}><span style={S.badge(
                  isNotaCredito ? '#10B981' : '#3B82F6',
                  isNotaCredito ? 'rgba(16,185,129,.12)' : 'rgba(59,130,246,.12)'
                )}>{f.detail?.td || 'TD01'}{isNotaCredito ? ' NC' : ''}</span></td>
                <td style={{ ...S.td, fontWeight: 600, color: isNotaCredito ? '#10B981' : undefined }}>{displayAmount != null ? fmt(displayAmount) : '—'}</td>
                <td style={S.td}><span style={S.badge(
                  f.currentStatusName === 'A_DISPOSIZIONE' ? '#10B981' : '#F59E0B',
                  f.currentStatusName === 'A_DISPOSIZIONE' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)'
                )}>{f.currentStatusName === 'A_DISPOSIZIONE' ? 'Ricevuta' : (f.currentStatusName || '—')}</span></td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <select value={tsLocaleMap[f.hubId] || ''} onChange={e => setTsInvoiceLocale(f.hubId, e.target.value)}
                    style={{ ...iS, fontSize: 11, padding: '3px 6px',
                      color: tsAutoAssigned[f.hubId] ? '#F59E0B' : '#e2e8f0',
                      borderColor: tsAutoAssigned[f.hubId] ? '#F59E0B' : '#2a3042',
                    }}>
                    <option value="">— assegna —</option>
                    <option value="Alhena Group">Alhena Group (tutti)</option>
                    {sps.map(s => <option key={s.id} value={s.description || s.name}>{s.description || s.name}</option>)}
                  </select>
                  {tsAutoAssigned[f.hubId] && <span style={{ fontSize: 9, color: '#F59E0B', display: 'block', marginTop: 2 }}>auto</span>}
                </td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <button onClick={() => downloadTsXml(f)} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11 }}>XML</button>
                </td>
              </tr>
              {isExpanded && <tr key={'ts-d-' + (f.hubId || i)}><td colSpan={9} style={{ padding: '8px 14px 12px 38px', background: 'var(--surface2)' }}>
                {tsXmlLoading && <div style={{ padding: 12, color: '#F59E0B', fontSize: 12 }}>Caricamento righe...</div>}
                {expandedLines.length > 0 && <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {expandedLines.length} righe — locale default: <strong style={{ color: '#F59E0B' }}>{tsLocaleMap[f.hubId] || 'non assegnato'}</strong>
                    </span>
                    <button onClick={() => saveTsXmlFile(f)} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '4px 12px', fontWeight: 600, fontSize: 11 }}>Scarica XML</button>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      {['Descrizione', 'Qty', 'UM', 'P. unit.', 'P. tot.', 'IVA', 'Locale'].map(h => <th key={h} style={{ ...S.th, fontSize: 10, padding: '6px 8px' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {expandedLines.map((l, j) => {
                        const itemLocale = getItemLocale(f.hubId, j)
                        const isOverridden = !!tsItemLocaleMap[f.hubId + ':' + j]
                        return <tr key={j} style={{ background: isOverridden ? 'rgba(245,158,11,.06)' : 'transparent' }}>
                          <td style={{ ...S.td, fontSize: 12, fontWeight: 500, padding: '6px 8px' }}>{l.descrizione}</td>
                          <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{l.quantita}</td>
                          <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)', padding: '6px 8px' }}>{l.um}</td>
                          <td style={{ ...S.td, fontSize: 12, padding: '6px 8px' }}>{l.prezzoUnitario ? Number(l.prezzoUnitario).toFixed(2) + ' €' : ''}</td>
                          <td style={{ ...S.td, fontSize: 12, fontWeight: 600, padding: '6px 8px' }}>{l.prezzoTotale ? Number(l.prezzoTotale).toFixed(2) + ' €' : ''}</td>
                          <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)', padding: '6px 8px' }}>{l.aliquotaIVA}%</td>
                          <td style={{ ...S.td, padding: '6px 8px' }} onClick={e => e.stopPropagation()}>
                            <select value={itemLocale} onChange={e => setTsItemLocale(f.hubId, j, e.target.value)}
                              style={{ ...iS, fontSize: 10, padding: '2px 4px', width: 110, background: isOverridden ? 'rgba(245,158,11,.2)' : '#0f1420', color: 'var(--text)' }}>
                              <option value="">— default —</option>
                              <option value="Alhena Group">Alhena Group</option>
                              {sps.map(s => <option key={s.id} value={s.description || s.name}>{s.description || s.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      })}
                    </tbody>
                  </table>
                </>}
                {!tsXmlLoading && expandedLines.length === 0 && tsXmlContent && <div style={{ padding: 8, fontSize: 12, color: 'var(--text2)' }}>Nessuna riga trovata nel XML.</div>}
                {!tsXmlLoading && !tsXmlContent && <div style={{ padding: 8, fontSize: 12, color: 'var(--text3)' }}>Caricamento...</div>}
              </td></tr>}
              </>
            })}
          </tbody>
        </table>
      </div>

      {/* Paginazione */}
      {usingFullCache ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '0 4px' }}>
          <button onClick={() => setTsPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
            style={{ ...iS, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: safePage === 0 ? 'not-allowed' : 'pointer',
              background: safePage === 0 ? '#1a1f2e' : '#3B82F6', color: safePage === 0 ? '#475569' : '#fff', border: 'none' }}>Precedente</button>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            Pagina <strong style={{ color: 'var(--text)' }}>{safePage + 1}/{totalPages}</strong>
            {' · '}{tsFiltered.length} fatture {selectedLocaleName ? `su ${selectedLocaleName}` : 'totali'}
          </span>
          <button onClick={() => setTsPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
            style={{ ...iS, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: safePage >= totalPages - 1 ? 'not-allowed' : 'pointer',
              background: safePage >= totalPages - 1 ? '#1a1f2e' : '#3B82F6', color: safePage >= totalPages - 1 ? '#475569' : '#fff', border: 'none' }}>Successiva </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '0 4px' }}>
          <button onClick={() => loadTsPage(tsPage - 1)} disabled={tsPage === 0 || tsLoading}
            style={{ ...iS, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: tsPage === 0 ? 'not-allowed' : 'pointer',
              background: tsPage === 0 ? '#1a1f2e' : '#3B82F6', color: tsPage === 0 ? '#475569' : '#fff', border: 'none' }}>Precedente</button>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            Pagina <strong style={{ color: 'var(--text)' }}>{tsPage + 1}</strong>
            {' · '}{tsInvoices.length} fatture
            {tsAllLoading && <span style={{ marginLeft: 8, color: '#F59E0B' }}>⟳ caricamento completo…</span>}
          </span>
          <button onClick={() => loadTsPage(tsPage + 1)} disabled={!tsHasNext || tsLoading}
            style={{ ...iS, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: !tsHasNext ? 'not-allowed' : 'pointer',
              background: !tsHasNext ? '#1a1f2e' : '#3B82F6', color: !tsHasNext ? '#475569' : '#fff', border: 'none' }}>Successiva </button>
        </div>
      )}
    </Card>
  </>
}
