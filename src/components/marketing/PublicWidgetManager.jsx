// Widget pubblico prenotazioni — gestione config dalla dashboard.
// Backoffice di /api/reservations-public e della pagina pubblica /prenota/:slug.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'

async function api(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'API error')
  return j
}

const BASE_URL = (typeof window !== 'undefined' ? window.location.origin : '')

export default function PublicWidgetManager({ sp, sps }) {
  const localesAvail = useMemo(() => {
    const raw = sps && sps.length ? sps.map(s => s.name) : ["REMEMBEER", "CASA DE AMICIS", "BIANCOLATTE", "LABORATORIO"]
    return [...new Set(raw)]
  }, [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_widget_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_widget_locale', locale) }, [locale])

  const [widget, setWidget] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState('')

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [w, st] = await Promise.all([
        api('/api/public-widget', { action: 'get', locale }),
        api('/api/public-widget', { action: 'stats', locale, days: 30 }),
      ])
      setWidget(w.widget || null)
      setStats(st.stats || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  const openEditor = () => setEditing(widget ? { ...widget } : {
    locale,
    slug: '',
    nome_visualizzato: locale,
    attivo: false,
    pax_max: 12,
    durata_default_min: 90,
    colore_primario: '#F59E0B',
    occasioni: ['Compleanno', 'Anniversario', 'Cena di lavoro'],
    messaggio_benvenuto: '',
    gdpr_text: 'Acconsento a ricevere comunicazioni promozionali (compleanno, eventi). Posso disiscrivermi in qualsiasi momento.',
  })

  const onSave = async () => {
    if (!editing) return
    if (!editing.nome_visualizzato) return alert('Inserisci il nome visualizzato')
    try {
      await api('/api/public-widget', { action: 'upsert', widget: { ...editing, locale } })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onToggle = async () => {
    if (!widget) return
    try {
      await api('/api/public-widget', { action: 'toggle', id: widget.id, attivo: !widget.attivo })
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async () => {
    if (!widget) return
    if (!confirm(`Eliminare widget pubblico per ${locale}? L'URL pubblico smetterà di funzionare.`)) return
    try {
      await api('/api/public-widget', { action: 'delete', id: widget.id })
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const publicUrl = widget?.slug ? `${BASE_URL}/prenota/${widget.slug}` : null
  const embedSnippet = widget?.slug ? `<iframe src="${publicUrl}" width="100%" height="900" frameborder="0" style="border:0;max-width:560px"></iframe>` : null

  const copy = (text, key) => {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(key); setTimeout(() => setCopied(''), 1500) })
      .catch(() => alert('Copia fallita'))
  }

  const addOccasione = () => setEditing({ ...editing, occasioni: [...(editing.occasioni || []), ''] })
  const updateOccasione = (i, v) => {
    const arr = [...(editing.occasioni || [])]; arr[i] = v
    setEditing({ ...editing, occasioni: arr })
  }
  const removeOccasione = (i) => setEditing({ ...editing, occasioni: (editing.occasioni || []).filter((_, j) => j !== i) })

  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Widget pubblico prenotazioni</h2>
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>· pagina embed-abile sul sito del ristorante</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={() => setShowHelp(!showHelp)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>?</button>
    </div>

    {showHelp && <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14, fontSize: 12, color: 'var(--text)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Come funziona</div>
      <ol style={{ marginLeft: 20, lineHeight: 1.7 }}>
        <li>Configura un widget per il locale: nome visualizzato, slug (parte finale dell'URL), branding.</li>
        <li>L'URL pubblico sarà <code>{BASE_URL}/prenota/&lt;slug&gt;</code> — i clienti lo aprono dal sito/Google/social.</li>
        <li>Le prenotazioni arrivano in <strong>Marketing → Prenotazioni</strong> con stato "pending" e source "public_widget".</li>
        <li>Se hai un'automazione con trigger <code>nuova_prenotazione</code>, parte automaticamente (es. conferma email/WhatsApp).</li>
        <li>Puoi <strong>embed-are</strong> il widget come iframe nel sito del ristorante (snippet HTML fornito sotto).</li>
      </ol>
    </div>}

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: 'var(--text2)', fontSize: 12 }}>Caricamento…</div>}

    {/* Stato widget */}
    {!loading && (
      <div style={{ background: 'var(--bg)', border: '1px solid ' + (widget?.attivo ? '#10B98155' : '#2a3042'), borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 999, fontWeight: 700,
            background: widget?.attivo ? '#10B98122' : '#94A3B822',
            color: widget?.attivo ? '#10B981' : '#94A3B8',
          }}>{widget?.attivo ? 'ATTIVO' : 'NON ATTIVO'}</span>
          {widget?.slug && <code style={{ fontSize: 13, fontWeight: 600, background: 'var(--surface)', padding: '4px 10px', borderRadius: 4 }}>/prenota/{widget.slug}</code>}
          {!widget && <span style={{ color: 'var(--text3)', fontSize: 13 }}>Nessun widget configurato per <strong>{locale}</strong></span>}
          <div style={{ flex: 1 }} />
          {widget && <>
            <button onClick={onToggle} style={btn(widget.attivo ? '#94A3B822' : '#10B98122', widget.attivo ? '#94A3B8' : '#10B981', widget.attivo ? '#94A3B855' : '#10B98155')}>{widget.attivo ? 'Disattiva' : 'Attiva'}</button>
            <button onClick={onDelete} style={btn('#EF444422', '#EF4444', '#EF444455')}>Elimina</button>
          </>}
          <button onClick={openEditor} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>{widget ? 'Modifica' : 'Configura'}</button>
        </div>

        {widget && <>
          {/* Info card */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12, marginBottom: 14 }}>
            <Stat label="Nome visualizzato" value={widget.nome_visualizzato || '—'} />
            <Stat label="Max persone" value={`${widget.pax_max} pax`} />
            <Stat label="Durata default" value={`${widget.durata_default_min} min`} />
            <Stat label="Occasioni" value={(widget.occasioni || []).length > 0 ? widget.occasioni.join(', ') : '—'} />
          </div>

          {/* URL + embed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Link pubblico</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: '#F59E0B', fontSize: 13, fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }}>{publicUrl}</a>
                <button onClick={() => copy(publicUrl, 'url')} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>
                  {copied === 'url' ? '✓ Copiato' : 'Copia link'}
                </button>
                <a href={publicUrl} target="_blank" rel="noreferrer" style={{ ...btn('#1a1f2e', '#cbd5e1', '#2a3042'), textDecoration: 'none', display: 'inline-block' }}>Apri preview</a>
              </div>
            </div>

            <div style={{ padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Snippet iframe (per incollare nel sito)</div>
              <code style={{ display: 'block', padding: 10, background: 'var(--bg)', borderRadius: 4, fontSize: 11, color: 'var(--text)', wordBreak: 'break-all', marginBottom: 8 }}>{embedSnippet}</code>
              <button onClick={() => copy(embedSnippet, 'embed')} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>
                {copied === 'embed' ? '✓ Copiato' : 'Copia snippet HTML'}
              </button>
            </div>
          </div>
        </>}
      </div>
    )}

    {/* Stats prenotazioni dal widget 30gg */}
    {stats && (
      <>
        <h3 style={{ margin: '20px 0 10px', fontSize: 15 }}>Prenotazioni da widget · ultimi 30 giorni</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <KPI label="Totale" value={stats.totale} />
          <KPI label="Coperti" value={stats.coperti} accent="#3B82F6" />
          <KPI label="In attesa" value={stats.per_stato.pending || 0} accent="#F59E0B" />
          <KPI label="Confermate" value={stats.per_stato.confirmed || 0} accent="#10B981" />
          <KPI label="Completate" value={stats.per_stato.completed || 0} accent="#10B981" />
          <KPI label="Annullate" value={(stats.per_stato.cancelled || 0) + (stats.per_stato.no_show || 0)} accent="#EF4444" />
        </div>
      </>
    )}

    {/* Drawer config */}
    {editing && <Drawer onClose={() => setEditing(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editing.id ? 'Modifica widget' : 'Configura widget'}</h3>

      <Section title="Identificazione">
        <Field label="Nome visualizzato (visibile ai clienti)">
          <input value={editing.nome_visualizzato || ''} onChange={e => setEditing({ ...editing, nome_visualizzato: e.target.value })} placeholder="Es. Biancolatte Pinerolo" style={{ ...S.input, width: '100%' }} />
        </Field>
        <div style={{ marginTop: 8 }}>
          <Field label="Slug (parte finale dell'URL)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{BASE_URL}/prenota/</span>
              <input value={editing.slug || ''} onChange={e => setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="biancolatte" style={{ ...S.input, flex: 1 }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Auto-generato dal nome se lasciato vuoto. Solo lettere minuscole, numeri e trattini.
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Regole prenotazione">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Max persone per prenotazione">
            <input type="number" min={1} max={50} value={editing.pax_max || 12} onChange={e => setEditing({ ...editing, pax_max: Number(e.target.value || 12) })} style={S.input} />
          </Field>
          <Field label="Durata default (minuti)">
            <input type="number" min={30} max={300} step={15} value={editing.durata_default_min || 90} onChange={e => setEditing({ ...editing, durata_default_min: Number(e.target.value || 90) })} style={S.input} />
          </Field>
        </div>
      </Section>

      <Section title="Branding">
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'end' }}>
          <Field label="Colore primario">
            <input type="color" value={editing.colore_primario || '#F59E0B'} onChange={e => setEditing({ ...editing, colore_primario: e.target.value })} style={{ ...S.input, height: 38, padding: 2 }} />
          </Field>
          <Field label="Messaggio benvenuto (opzionale, in cima al form)">
            <input value={editing.messaggio_benvenuto || ''} onChange={e => setEditing({ ...editing, messaggio_benvenuto: e.target.value })} placeholder="Es. Prenota online: confermiamo entro 1 ora" style={{ ...S.input, width: '100%' }} />
          </Field>
        </div>
      </Section>

      <Section title="Occasioni selezionabili (opzionale)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(editing.occasioni || []).map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input value={o} onChange={e => updateOccasione(i, e.target.value)} placeholder="Es. Compleanno" style={{ ...S.input, flex: 1 }} />
              <button onClick={() => removeOccasione(i)} style={btn('#EF444422', '#EF4444', '#EF444455')}>×</button>
            </div>
          ))}
          <button onClick={addOccasione} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>+ Aggiungi occasione</button>
        </div>
      </Section>

      <Section title="GDPR — testo opt-in marketing">
        <textarea value={editing.gdpr_text || ''} onChange={e => setEditing({ ...editing, gdpr_text: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 70, fontFamily: 'inherit' }} placeholder="Testo del consenso marketing mostrato accanto al checkbox" />
      </Section>

      <div style={{ marginTop: 14, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
        <Toggle checked={!!editing.attivo} onChange={v => setEditing({ ...editing, attivo: v })} label="Widget attivo (accetta prenotazioni pubbliche)" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button onClick={() => setEditing(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
      </div>
    </Drawer>}
  </div>
}

function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}
function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}
function Section({ title, children }) {
  return <div style={{ marginTop: 14, padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
    {children}
  </div>
}
function Toggle({ checked, onChange, label }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    {label}
  </label>
}
function Stat({ label, value }) {
  return <div>
    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{value}</div>
  </div>
}
function KPI({ label, value, accent = '#F59E0B' }) {
  return <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: accent }} />
    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
  </div>
}
function Drawer({ children, onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(640px, 100%)', height: '100%', background: 'var(--surface)', padding: 20, overflowY: 'auto', borderLeft: '1px solid var(--border)' }}>
      {children}
    </div>
  </div>
}
