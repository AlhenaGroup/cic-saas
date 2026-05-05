// Storico movimenti: tabella filtrabile + export CSV

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmtD, fmtN } from '../shared/styles.jsx'
import { exportToXlsx, exportToCsv, exportToPdf, ExportButtons } from '../../lib/exporters'

const iS = S.input

const TIPO_CONFIG = {
  carico: { l: '+Carico', c: '#10B981', bg: 'rgba(16,185,129,.15)', sign: '+' },
  scarico: { l: '−Scarico', c: '#EF4444', bg: 'rgba(239,68,68,.15)', sign: '−' },
  correzione: { l: 'Correzione', c: '#F59E0B', bg: 'rgba(245,158,11,.15)', sign: '±' },
  apertura: { l: 'Apertura', c: '#3B82F6', bg: 'rgba(59,130,246,.15)', sign: '=' },
  trasferimento_in: { l: 'Trasf.in', c: '#06B6D4', bg: 'rgba(6,182,212,.15)', sign: '+' },
  trasferimento_out: { l: 'Trasf.out', c: '#8B5CF6', bg: 'rgba(139,92,246,.15)', sign: '−' },
}

export default function MovementsView({ sp, sps, from, to }) {
  const [moves, setMoves] = useState([])
  const [loading, setLoading] = useState(true)
  const [fTipo, setFTipo] = useState('tutti')
  const [fFonte, setFFonte] = useState('tutte')
  const [search, setSearch] = useState('')

  const selectedLocaleName = (!sp || sp === 'all') ? null :
    (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('article_movement').select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (selectedLocaleName) q = q.eq('locale', selectedLocaleName)
    if (from) q = q.gte('created_at', from + 'T00:00:00')
    if (to) q = q.lte('created_at', to + 'T23:59:59')
    const { data } = await q
    setMoves(data || [])
    setLoading(false)
  }, [selectedLocaleName, from, to])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    return moves.filter(m => {
      if (fTipo !== 'tutti' && m.tipo !== fTipo) return false
      if (fFonte !== 'tutte' && m.fonte !== fFonte) return false
      if (search) {
        const s = search.toLowerCase()
        if (!m.nome_articolo.toLowerCase().includes(s) &&
            !(m.riferimento_label || '').toLowerCase().includes(s) &&
            !(m.note || '').toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [moves, fTipo, fFonte, search])

  const totValore = filtered.reduce((acc, m) => acc + Math.abs(Number(m.valore_totale || 0)), 0)

  const buildExportData = () => {
    const headers = ['Data', 'Tipo', 'Articolo', 'Quantità', 'UM', '€/UM', 'Valore', 'Locale', 'Sub', 'Fonte', 'Riferimento', 'Note']
    const rows = filtered.map(m => [
      new Date(m.created_at).toLocaleString('it-IT'),
      m.tipo, m.nome_articolo, m.quantita, m.unita || '',
      m.prezzo_unitario || '', m.valore_totale || '',
      m.locale, m.sub_location,
      m.fonte, m.riferimento_label || '', m.note || '',
    ])
    const filename = `movimenti_${from || 'all'}_${to || 'all'}`
    return { headers, rows, filename }
  }
  const onExcel = () => { const { headers, rows, filename } = buildExportData(); exportToXlsx(filename, headers, rows, { sheetName: 'Movimenti' }) }
  const onCsv = () => { const { headers, rows, filename } = buildExportData(); exportToCsv(filename, headers, rows) }
  const onPdf = () => {
    const { headers, rows } = buildExportData()
    const titolo = `Movimenti magazzino · ${selectedLocaleName || 'Tutti i locali'} · ${from || '—'} ${to || '—'}`
    exportToPdf(titolo, headers, rows)
  }

  return <>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={iS}>
        <option value="tutti">Tutti i tipi</option>
        <option value="carico">Carichi</option>
        <option value="scarico">Scarichi</option>
        <option value="correzione">Correzioni</option>
        <option value="apertura">Apertura</option>
        <option value="trasferimento_out">Trasferimenti</option>
      </select>
      <select value={fFonte} onChange={e => setFFonte(e.target.value)} style={iS}>
        <option value="tutte">Tutte le fonti</option>
        <option value="fattura">Fattura</option>
        <option value="scontrino">Scontrino</option>
        <option value="inventario">Inventario</option>
        <option value="manuale">Manuale</option>
        <option value="trasferimento">Trasferimento</option>
      </select>
      <input placeholder="Articolo, riferimento, note..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...iS, flex: 1, maxWidth: 300 }} />
      <ExportButtons onExcel={onExcel} onCsv={onCsv} onPdf={onPdf} disabled={filtered.length === 0} size="lg" />
    </div>

    <Card title="Storico movimenti"
      badge={`${filtered.length}/${moves.length} · ${fmtD(totValore)} valore lordo`}>
      {loading ? (
        <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 24, color: '#64748b', textAlign: 'center' }}>Nessun movimento nel periodo.</div>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 600 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#131825' }}><tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Data', 'Tipo', 'Articolo', 'Qty', '€/UM', 'Valore', 'Locale', 'Fonte'].map(h =>
                <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map(m => {
                const cfg = TIPO_CONFIG[m.tipo] || { l: m.tipo, c: '#94a3b8', bg: 'rgba(148,163,184,.15)', sign: '' }
                const dt = new Date(m.created_at)
                return <tr key={m.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                    {dt.toLocaleDateString('it-IT')} {dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(cfg.c, cfg.bg)}>{cfg.l}</span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 500 }}>{m.nome_articolo}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: cfg.c }}>
                    {cfg.sign}{fmtN(m.quantita)} {m.unita || ''}
                  </td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>{m.prezzo_unitario ? fmtD(m.prezzo_unitario) : '—'}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: '#F59E0B' }}>{m.valore_totale ? fmtD(m.valore_totale) : '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>
                    {m.locale}{m.sub_location && m.sub_location !== 'principale' ? ' / ' + m.sub_location : ''}
                    {m.sub_location_target && <span style={{ color: '#64748b' }}> {m.sub_location_target}</span>}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.riferimento_label || m.fonte}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  </>
}
