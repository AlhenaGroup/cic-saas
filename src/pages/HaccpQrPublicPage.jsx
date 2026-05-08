// Pagina pubblica per ispettori (NAS/ASL/Ispettorato/Sicurezza/altro).
// URL: /haccp/qr/{token}
// Nessun login. Carica i dati abilitati dallo scope del token e li mostra in
// un layout stampabile e leggibile.

import { useEffect, useState } from 'react'

const CATEGORIE_LABEL = {
  dvr: 'DVR — Documento Valutazione Rischi',
  manuale_haccp: 'Manuale HACCP',
  organigramma: 'Organigramma sicurezza',
  scia_commerciale: 'SCIA commerciale',
  scia_sanitaria: 'SCIA sanitaria',
  autorizzazioni: 'Autorizzazioni / licenze',
  manutenzione_estintori: 'Manutenzione estintori',
  manutenzione_cappe: 'Manutenzione cappe',
  manutenzione_impianti: 'Manutenzione impianti',
  potabilita: 'Analisi potabilità acqua',
  disinfestazione: 'Disinfestazione',
  contratti_servizi: 'Contratti servizi',
  altro: 'Altro',
}
const ATTESTATO_LABEL = {
  haccp_alimentarista: 'HACCP alimentarista',
  haccp_responsabile: 'HACCP responsabile',
  antincendio_basso: 'Antincendio basso',
  antincendio_medio: 'Antincendio medio',
  antincendio_alto: 'Antincendio alto',
  primo_soccorso: 'Primo soccorso',
  rspp: 'RSPP',
  rls: 'RLS',
  sicurezza_generale: 'Sicurezza generale',
  sicurezza_specifica: 'Sicurezza specifica',
  altro: 'Altro',
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDT(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}
function daysTo(s) {
  if (!s) return null
  const t = new Date(); t.setHours(0,0,0,0)
  const d = new Date(s + 'T12:00:00')
  return Math.round((d - t) / 86400000)
}

export default function HaccpQrPublicPage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/haccp-qr?token=${encodeURIComponent(token)}`)
        const j = await r.json()
        if (cancelled) return
        if (!r.ok) { setError(j.error || 'Errore'); setLoading(false); return }
        setData(j); setLoading(false)
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (loading) return <div style={{ minHeight: '100vh', background: '#fff', color: '#111', fontFamily: 'system-ui', padding: 40, textAlign: 'center' }}>
    <div style={{ fontSize: 14, color: '#666' }}>Caricamento documenti…</div>
  </div>

  if (error) return <div style={{ minHeight: '100vh', background: '#fff', color: '#111', fontFamily: 'system-ui', padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ maxWidth: 480, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
      <h1 style={{ fontSize: 22, marginBottom: 12, color: '#dc2626' }}>{error}</h1>
      <p style={{ fontSize: 14, color: '#666' }}>
        Questo link potrebbe essere stato revocato, essere scaduto o non essere mai esistito.
        Contatta l'azienda per un nuovo link.
      </p>
    </div>
  </div>

  return <div style={{ minHeight: '100vh', background: '#f5f5f5', color: '#111', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '20px 16px' }}>
    <style>{`@media print { body { background: #fff !important } .no-print { display: none !important } }`}</style>
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>Ispezione HACCP</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{data.intestazione.nome}</h1>
            {data.azienda?.nome && <div style={{ fontSize: 14, color: '#444', marginTop: 4 }}>Azienda: <strong>{data.azienda.nome}</strong></div>}
            {data.intestazione.destinatario && <div style={{ fontSize: 14, color: '#444', marginTop: 2 }}>Destinatario: <strong>{data.intestazione.destinatario}</strong></div>}
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: '#666' }}>
            <div>Generato: {fmtDT(data.intestazione.generato_il)}</div>
            <div>Valido fino: {fmtDT(data.intestazione.scadenza_at)}</div>
          </div>
        </div>
        <button onClick={() => window.print()} className="no-print"
          style={{ marginTop: 16, padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#111', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          🖨 Stampa documento
        </button>
      </div>

      {/* Documenti */}
      {data.documenti?.length > 0 && <Section title={`Documenti aziendali (${data.documenti.length})`}>
        <table style={tableSt}>
          <thead><tr>
            {['Categoria', 'Titolo', 'Locale', 'Emesso', 'Scadenza', 'Resp/Forn', 'File'].map(h => <th key={h} style={thSt}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.documenti.map(d => {
              const dt = daysTo(d.scadenza)
              const scadColor = dt == null ? '#666' : dt < 0 ? '#dc2626' : dt <= 90 ? '#f59e0b' : '#16a34a'
              return <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={tdSt}><strong>{CATEGORIE_LABEL[d.categoria] || d.categoria}</strong></td>
                <td style={tdSt}>{d.titolo}{d.note && <div style={{ fontSize: 11, color: '#666' }}>{d.note}</div>}</td>
                <td style={tdSt}>{d.locale || <span style={{ color: '#999' }}>aziendale</span>}</td>
                <td style={tdSt}>{fmtDate(d.data_emissione)}</td>
                <td style={{ ...tdSt, color: scadColor, fontWeight: 600 }}>
                  {d.scadenza ? <>{fmtDate(d.scadenza)}{dt != null && <div style={{ fontSize: 10 }}>{dt < 0 ? `Scaduto ${Math.abs(dt)}gg fa` : `tra ${dt}gg`}</div>}</> : '—'}
                </td>
                <td style={tdSt}>{[d.responsabile, d.fornitore].filter(Boolean).join(' / ') || '—'}</td>
                <td style={tdSt}>{d.file_url ? <a href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>📄 Apri</a> : '—'}</td>
              </tr>
            })}
          </tbody>
        </table>
      </Section>}

      {/* Lotti produzione */}
      {data.lotti?.length > 0 && <Section title={`Lotti produzione (${data.lotti.length})`}>
        <table style={tableSt}>
          <thead><tr>
            {['Lotto', 'Prodotto', 'Quantità', 'Data prod.', 'Scadenza', 'Locale', 'Operatore', 'Allergeni'].map(h => <th key={h} style={thSt}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.lotti.map(b => <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ ...tdSt, fontFamily: 'monospace', fontWeight: 600 }}>{b.lotto}</td>
              <td style={tdSt}>{b.recipe_nome || '?'}</td>
              <td style={tdSt}>{b.quantita_prodotta} {b.unita || ''}</td>
              <td style={tdSt}>{fmtDate(b.data_produzione)}{b.ora_produzione && ` ${(b.ora_produzione || '').slice(0,5)}`}</td>
              <td style={tdSt}>{b.data_scadenza ? fmtDate(b.data_scadenza) : '—'}</td>
              <td style={tdSt}>{b.locale_produzione}{b.locale_destinazione && b.locale_destinazione !== b.locale_produzione && ` → ${b.locale_destinazione}`}</td>
              <td style={tdSt}>{b.operatore_nome || '—'}</td>
              <td style={tdSt}>{b.allergeni?.length > 0 ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>⚠ {b.allergeni.join(', ')}</span> : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </Section>}

      {/* Registri autocontrollo */}
      {data.registri?.length > 0 && data.registri.some(r => r.entries?.length > 0) && <Section title={`Registri autocontrollo`}>
        {data.registri.filter(r => r.entries?.length > 0).map(r => <div key={r.id} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>{r.nome} <span style={{ fontSize: 11, color: '#666', fontWeight: 400 }}>({r.entries.length} compilazioni)</span></h3>
          {r.descrizione && <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{r.descrizione}</div>}
          <table style={tableSt}>
            <thead><tr>
              <th style={thSt}>Data / Ora</th>
              <th style={thSt}>Operatore</th>
              <th style={thSt}>Locale</th>
              {(r.fields || []).map(f => <th key={f.key} style={thSt}>{f.label}</th>)}
              <th style={thSt}>Anomalia</th>
            </tr></thead>
            <tbody>
              {r.entries.map(e => <tr key={e.id} style={{ borderBottom: '1px solid #eee', background: e.anomalia ? '#fef2f2' : 'transparent' }}>
                <td style={tdSt}>{fmtDate(e.data_compilazione)}<br/><span style={{ fontSize: 10, color: '#666' }}>{(e.ora_compilazione || '').slice(0,5)}</span></td>
                <td style={tdSt}>{e.operatore_nome || '—'}</td>
                <td style={tdSt}>{e.locale || '—'}</td>
                {(r.fields || []).map(f => {
                  const v = e.values?.[f.key]
                  let display = v
                  let outOfRange = false
                  if (f.type === 'boolean') display = v === true ? '✓' : v === false ? '✗' : '—'
                  else if (f.type === 'number' && v != null && v !== '') {
                    const n = Number(v)
                    if ((f.min != null && n < Number(f.min)) || (f.max != null && n > Number(f.max))) outOfRange = true
                  }
                  return <td key={f.key} style={{ ...tdSt, color: outOfRange ? '#dc2626' : '#111', fontWeight: outOfRange ? 700 : 400 }}>
                    {display ?? '—'}{outOfRange && ' ⚠'}
                  </td>
                })}
                <td style={tdSt}>{e.anomalia ? <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ ANOMALIA</span> : <span style={{ color: '#16a34a' }}>OK</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>)}
      </Section>}

      {/* Attestati */}
      {data.attestati?.length > 0 && <Section title={`Attestati formativi (${data.attestati.length})`}>
        <table style={tableSt}>
          <thead><tr>
            {['Tipo corso', 'Titolo', 'Dipendente', 'Emesso', 'Scadenza', 'Ente', 'File'].map(h => <th key={h} style={thSt}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.attestati.map(c => {
              const dt = daysTo(c.scadenza)
              const scadColor = dt == null ? '#666' : dt < 0 ? '#dc2626' : dt <= 90 ? '#f59e0b' : '#16a34a'
              return <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={tdSt}><strong>{ATTESTATO_LABEL[c.tipo] || c.tipo}</strong></td>
                <td style={tdSt}>{c.titolo}{c.durata_ore && <div style={{ fontSize: 11, color: '#666' }}>{c.durata_ore}h</div>}</td>
                <td style={tdSt}>
                  {c.employee_nome || <span style={{ color: '#999' }}>—</span>}
                  {c.employee_ruolo && <div style={{ fontSize: 11, color: '#666' }}>{c.employee_ruolo}</div>}
                </td>
                <td style={tdSt}>{fmtDate(c.data_emissione)}</td>
                <td style={{ ...tdSt, color: scadColor, fontWeight: 600 }}>
                  {c.scadenza ? <>{fmtDate(c.scadenza)}{dt != null && <div style={{ fontSize: 10 }}>{dt < 0 ? `Scaduto ${Math.abs(dt)}gg fa` : `tra ${dt}gg`}</div>}</> : '—'}
                </td>
                <td style={tdSt}>{c.ente_erogante || '—'}</td>
                <td style={tdSt}>{c.file_url ? <a href={c.file_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>📄 Apri</a> : '—'}</td>
              </tr>
            })}
          </tbody>
        </table>
      </Section>}

      {/* Empty state */}
      {(!data.documenti?.length && !data.lotti?.length && !data.attestati?.length && !data.registri?.some(r => r.entries?.length)) && <Section title="Nessun dato">
        <div style={{ padding: 30, textAlign: 'center', color: '#666' }}>
          Questo link non include alcun documento. Contatta l'azienda per richiedere uno scope esteso.
        </div>
      </Section>}

      <div style={{ textAlign: 'center', fontSize: 11, color: '#999', marginTop: 30, paddingBottom: 30 }}>
        Documento generato dalla piattaforma gestionale Convivia · valido fino al {fmtDT(data.intestazione.scadenza_at)}
      </div>
    </div>
  </div>
}

const tableSt = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const thSt = { textAlign: 'left', padding: '8px 6px', borderBottom: '2px solid #ccc', fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }
const tdSt = { padding: '8px 6px', verticalAlign: 'top' }

function Section({ title, children }) {
  return <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 20, marginBottom: 16 }}>
    <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>{title}</h2>
    <div style={{ overflowX: 'auto' }}>{children}</div>
  </div>
}
