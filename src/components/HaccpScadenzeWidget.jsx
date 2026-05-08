// Widget HACCP per la Panoramica: documenti in scadenza nei prossimi 90gg + scaduti.
// Click su una riga -> apre il tab HACCP (semplice navigazione localStorage).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S } from './shared/styles.jsx'

const CATEGORIE_LABEL = {
  dvr: 'DVR',
  scia_commerciale: 'SCIA commerciale',
  scia_sanitaria: 'SCIA sanitaria',
  manuale_haccp: 'Manuale HACCP',
  organigramma: 'Organigramma',
  manutenzione_estintori: 'Manutenzione estintori',
  manutenzione_cappe: 'Manutenzione cappe',
  manutenzione_impianti: 'Manutenzione impianti',
  potabilita: 'Analisi potabilità',
  disinfestazione: 'Disinfestazione',
  autorizzazioni: 'Autorizzazioni',
  contratti_servizi: 'Contratti servizi',
  altro: 'Altro',
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr); d.setHours(0,0,0,0)
  const today = new Date(); today.setHours(0,0,0,0)
  return Math.floor((d - today) / (1000*60*60*24))
}

export default function HaccpScadenzeWidget() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]
      const in90 = new Date(Date.now() + 90*86400000).toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('haccp_documents')
        .select('id, categoria, titolo, locale, scadenza, responsabile, fornitore')
        .not('scadenza', 'is', null)
        .lte('scadenza', in90)
        .order('scadenza', { ascending: true })
      if (cancelled) return
      if (error) { console.error('haccp widget:', error); setDocs([]); setLoading(false); return }
      setDocs(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) return <div style={{ padding: 12, color: 'var(--text3)', fontSize: 12 }}>Caricamento…</div>

  if (docs.length === 0) {
    return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
      Nessun documento HACCP in scadenza nei prossimi 90 giorni.
    </div>
  }

  const goHaccp = () => {
    try { localStorage.setItem('cic_main_tab', 'haccp') } catch {}
    window.location.reload()
  }

  const scaduti = docs.filter(d => daysUntil(d.scadenza) < 0)
  const urgenti = docs.filter(d => { const n = daysUntil(d.scadenza); return n >= 0 && n <= 30 })
  const prossimi = docs.filter(d => { const n = daysUntil(d.scadenza); return n > 30 && n <= 90 })

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {scaduti.length > 0 && <Section label="Scaduti" color="#EF4444" docs={scaduti} onClick={goHaccp}/>}
    {urgenti.length > 0 && <Section label="Entro 30gg" color="#F59E0B" docs={urgenti} onClick={goHaccp}/>}
    {prossimi.length > 0 && <Section label="Entro 90gg" color="#10B981" docs={prossimi} onClick={goHaccp}/>}
  </div>
}

function Section({ label, color, docs, onClick }) {
  return <div>
    <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
      {label} · {docs.length}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {docs.map(d => {
        const n = daysUntil(d.scadenza)
        const dataFmt = d.scadenza ? new Date(d.scadenza).toLocaleDateString('it-IT') : ''
        return <div key={d.id} onClick={onClick} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
          background: 'var(--card2)', borderRadius: 6, cursor: 'pointer',
          borderLeft: `3px solid ${color}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.titolo}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {CATEGORIE_LABEL[d.categoria] || d.categoria}
              {d.locale ? ' · ' + d.locale : ' · Tutti i locali'}
              {d.fornitore ? ' · ' + d.fornitore : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
            <div style={{ fontWeight: 600, color }}>{n < 0 ? `${Math.abs(n)}gg fa` : `tra ${n}gg`}</div>
            <div>{dataFmt}</div>
          </div>
        </div>
      })}
    </div>
  </div>
}
