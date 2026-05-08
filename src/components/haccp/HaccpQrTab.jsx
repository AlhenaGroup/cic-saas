// HACCP → QR ispezioni
// Genera token configurabili da condividere con ispettori esterni.
// Scope completamente personalizzabile: documenti (per categoria/locale),
// lotti (periodo + locali), registri (template + periodo), attestati (tipi + nomi).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'
import { HACCP_CATEGORIES } from './HaccpDocumentsTab'
import { CERT_TYPES } from './HaccpCorsiTab'

function genToken() {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 32)
}

function fmtDT(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

const FREQ_OPTS = [
  { val: 1, label: '1 giorno' },
  { val: 7, label: '7 giorni' },
  { val: 30, label: '30 giorni' },
]

export default function HaccpQrTab({ sps = [] }) {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showQr, setShowQr] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('haccp_qr_tokens').select('*').order('created_at', { ascending: false })
    setTokens(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const revoca = async (t) => {
    if (!confirm(`Revocare il link "${t.nome}"? Gli ispettori non potranno più accedere.`)) return
    await supabase.from('haccp_qr_tokens').update({ attivo: false }).eq('id', t.id)
    await load()
  }
  const elimina = async (t) => {
    if (!confirm(`Eliminare definitivamente il link "${t.nome}"?`)) return
    await supabase.from('haccp_qr_tokens').delete().eq('id', t.id)
    await load()
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Card title="QR ispezioni HACCP" extra={
      <button onClick={() => setCreating(true)}
        style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        + Genera nuovo link
      </button>
    }>
      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}

      {!loading && tokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        Nessun link generato. Crea il primo link condivisibile per ispettori NAS / ASL / Ispettorato del lavoro.
      </div>}

      {!loading && tokens.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Nome ispezione', 'Destinatario', 'Cosa include', 'Scade', 'Accessi', 'Stato', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {tokens.map(t => {
              const scaduto = new Date(t.scadenza_at) < new Date()
              const attivo = t.attivo && !scaduto
              const summary = []
              if (t.scope?.documenti_categorie?.length || t.scope?.includi_documenti) summary.push('📄 Documenti')
              if (t.scope?.lotti_periodo_giorni > 0) summary.push(`🏷 Lotti ${t.scope.lotti_periodo_giorni}gg`)
              if (t.scope?.registri_periodo_giorni > 0) summary.push(`📊 Registri ${t.scope.registri_periodo_giorni}gg`)
              if (t.scope?.attestati_tipi?.length || t.scope?.includi_attestati) summary.push('🎓 Attestati')
              return <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', opacity: attivo ? 1 : 0.5 }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{t.nome}</td>
                <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{t.destinatario || '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>{summary.join(' · ') || '—'}</td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {fmtDT(t.scadenza_at)}
                  {scaduto && <div style={{ fontSize: 10, color: '#EF4444', fontWeight: 700 }}>SCADUTO</div>}
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  <strong>{t.accessi_count}</strong>
                  {t.ultimo_accesso_at && <div style={{ fontSize: 10, color: 'var(--text3)' }}>ultimo: {fmtDT(t.ultimo_accesso_at)}</div>}
                </td>
                <td style={{ ...S.td }}>
                  <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: (attivo ? '#10B981' : '#EF4444') + '22', color: attivo ? '#10B981' : '#EF4444', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                    {attivo ? 'Attivo' : (scaduto ? 'Scaduto' : 'Revocato')}
                  </span>
                </td>
                <td style={{ ...S.td }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setShowQr(t)} disabled={!attivo}
                      style={{ background: 'transparent', color: attivo ? '#3B82F6' : 'var(--text3)', border: '1px solid var(--border)', cursor: attivo ? 'pointer' : 'not-allowed', fontSize: 11, padding: '4px 10px', borderRadius: 6, fontWeight: 600 }}>
                      Link / QR
                    </button>
                    {t.attivo && !scaduto && <button onClick={() => revoca(t)}
                      style={{ background: 'transparent', color: '#F59E0B', border: '1px solid rgba(245,158,11,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>
                      Revoca
                    </button>}
                    <button onClick={() => elimina(t)}
                      style={{ background: 'transparent', color: '#EF4444', border: '1px solid rgba(220,38,38,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>
                      Elimina
                    </button>
                  </div>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </Card>

    {creating && <CreateTokenModal sps={sps}
      onClose={() => setCreating(false)}
      onCreated={async (t) => { setCreating(false); await load(); setShowQr(t) }}/>}

    {showQr && <ShowLinkModal token={showQr} onClose={() => setShowQr(null)}/>}
  </div>
}

function CreateTokenModal({ sps, onClose, onCreated }) {
  const [f, setF] = useState({
    nome: '',
    destinatario: '',
    durata_giorni: 7,
    // Documenti
    includi_documenti: false,
    documenti_categorie: [],
    documenti_locali: [],
    // Lotti
    includi_lotti: false,
    lotti_periodo_giorni: 90,
    lotti_locali: [],
    // Registri
    includi_registri: false,
    registri_periodo_giorni: 30,
    registri_template_ids: [],
    mostra_anomalie: true,
    // Attestati
    includi_attestati: false,
    attestati_tipi: [],
    attestati_includi_employees: true,
  })
  const [templates, setTemplates] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('haccp_log_templates').select('id, nome').order('nome')
      setTemplates(data || [])
    })()
  }, [])

  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)

  const toggleArr = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

  const save = async () => {
    setErr('')
    if (!f.nome.trim()) { setErr('Nome ispezione obbligatorio'); return }
    if (!f.includi_documenti && !f.includi_lotti && !f.includi_registri && !f.includi_attestati) {
      setErr('Includi almeno una categoria di dati'); return
    }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const scope = {}
      if (f.includi_documenti) {
        scope.includi_documenti = true
        if (f.documenti_categorie.length > 0) scope.documenti_categorie = f.documenti_categorie
        if (f.documenti_locali.length > 0) scope.documenti_locali = f.documenti_locali
      }
      if (f.includi_lotti) {
        scope.lotti_periodo_giorni = Number(f.lotti_periodo_giorni) || 90
        if (f.lotti_locali.length > 0) scope.lotti_locali = f.lotti_locali
      }
      if (f.includi_registri) {
        scope.registri_periodo_giorni = Number(f.registri_periodo_giorni) || 30
        if (f.registri_template_ids.length > 0) scope.registri_template_ids = f.registri_template_ids
        scope.mostra_anomalie = !!f.mostra_anomalie
      }
      if (f.includi_attestati) {
        scope.includi_attestati = true
        if (f.attestati_tipi.length > 0) scope.attestati_tipi = f.attestati_tipi
        scope.attestati_includi_employees = !!f.attestati_includi_employees
      }
      const scadenza = new Date(Date.now() + Number(f.durata_giorni) * 86400000).toISOString()
      const { data, error } = await supabase.from('haccp_qr_tokens').insert({
        user_id: user.id,
        token: genToken(),
        nome: f.nome.trim(),
        destinatario: f.destinatario || null,
        scope,
        scadenza_at: scadenza,
      }).select().single()
      if (error) throw error
      onCreated(data)
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { ...S.input, width: '100%' }

  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Nuovo link ispezione HACCP</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Nome ispezione *">
            <input style={inp} placeholder='es. "Visita NAS gennaio 2026"' value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })}/>
          </Field>
          <Field label="Validità">
            <select style={inp} value={f.durata_giorni} onChange={e => setF({ ...f, durata_giorni: Number(e.target.value) })}>
              {FREQ_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Destinatario (opzionale)">
          <input style={inp} placeholder='es. "ASL TO3 / Dr. Rossi"' value={f.destinatario} onChange={e => setF({ ...f, destinatario: e.target.value })}/>
        </Field>

        {/* DOCUMENTI */}
        <Block title="📄 Documenti aziendali" enabled={f.includi_documenti} onToggle={() => setF({ ...f, includi_documenti: !f.includi_documenti })}>
          <div style={{ marginBottom: 10 }}>
            <Subtitle>Categorie da includere (vuoto = tutte)</Subtitle>
            <ChipGrid>
              {HACCP_CATEGORIES.map(c => <Chip key={c.key} active={f.documenti_categorie.includes(c.key)} color={c.color}
                onClick={() => setF({ ...f, documenti_categorie: toggleArr(f.documenti_categorie, c.key) })}>{c.label}</Chip>)}
            </ChipGrid>
          </div>
          {allLocali.length > 0 && <div>
            <Subtitle>Locali (vuoto = tutti)</Subtitle>
            <ChipGrid>
              {allLocali.map(l => <Chip key={l} active={f.documenti_locali.includes(l)}
                onClick={() => setF({ ...f, documenti_locali: toggleArr(f.documenti_locali, l) })}>{l}</Chip>)}
            </ChipGrid>
          </div>}
        </Block>

        {/* LOTTI */}
        <Block title="🏷 Lotti produzione" enabled={f.includi_lotti} onToggle={() => setF({ ...f, includi_lotti: !f.includi_lotti })}>
          <Field label="Periodo (ultimi N giorni)">
            <input type="number" style={inp} value={f.lotti_periodo_giorni} onChange={e => setF({ ...f, lotti_periodo_giorni: e.target.value })}/>
          </Field>
          {allLocali.length > 0 && <div style={{ marginTop: 10 }}>
            <Subtitle>Locali (vuoto = tutti)</Subtitle>
            <ChipGrid>
              {allLocali.map(l => <Chip key={l} active={f.lotti_locali.includes(l)}
                onClick={() => setF({ ...f, lotti_locali: toggleArr(f.lotti_locali, l) })}>{l}</Chip>)}
            </ChipGrid>
          </div>}
        </Block>

        {/* REGISTRI */}
        <Block title="📊 Registri autocontrollo" enabled={f.includi_registri} onToggle={() => setF({ ...f, includi_registri: !f.includi_registri })}>
          <Field label="Periodo (ultimi N giorni)">
            <input type="number" style={inp} value={f.registri_periodo_giorni} onChange={e => setF({ ...f, registri_periodo_giorni: e.target.value })}/>
          </Field>
          {templates.length > 0 && <div style={{ marginTop: 10 }}>
            <Subtitle>Template registri (vuoto = tutti)</Subtitle>
            <ChipGrid>
              {templates.map(t => <Chip key={t.id} active={f.registri_template_ids.includes(t.id)}
                onClick={() => setF({ ...f, registri_template_ids: toggleArr(f.registri_template_ids, t.id) })}>{t.nome}</Chip>)}
            </ChipGrid>
          </div>}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.mostra_anomalie} onChange={e => setF({ ...f, mostra_anomalie: e.target.checked })}/>
            Includi compilazioni con anomalie (consigliato per trasparenza)
          </label>
        </Block>

        {/* ATTESTATI */}
        <Block title="🎓 Attestati formativi dipendenti" enabled={f.includi_attestati} onToggle={() => setF({ ...f, includi_attestati: !f.includi_attestati })}>
          <Subtitle>Tipi corso da includere (vuoto = tutti)</Subtitle>
          <ChipGrid>
            {CERT_TYPES.map(t => <Chip key={t.key} active={f.attestati_tipi.includes(t.key)} color={t.color}
              onClick={() => setF({ ...f, attestati_tipi: toggleArr(f.attestati_tipi, t.key) })}>{t.label}</Chip>)}
          </ChipGrid>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.attestati_includi_employees} onChange={e => setF({ ...f, attestati_includi_employees: e.target.checked })}/>
            Mostra nome e ruolo del dipendente intestatario (consigliato per ispezioni)
          </label>
        </Block>

        {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Annulla</button>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {saving ? 'Genero…' : 'Genera link'}
        </button>
      </div>
    </div>
  </div>
}

function ShowLinkModal({ token, onClose }) {
  const url = `${window.location.origin}/haccp/qr/${token.token}`
  const [copied, setCopied] = useState(false)
  const [qrSvg, setQrSvg] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const QRCode = await import('qrcode')
        const svg = await QRCode.toString(url, { type: 'svg', width: 280, margin: 2 })
        setQrSvg(svg)
      } catch (e) { console.error('qr:', e) }
    })()
  }, [url])

  const copy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 480, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{token.nome}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        {qrSvg ? <div style={{ background: '#fff', padding: 16, borderRadius: 12 }} dangerouslySetInnerHTML={{ __html: qrSvg }}/>
          : <div style={{ width: 280, height: 280, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>Generazione QR…</div>}

        <div style={{ width: '100%' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Link condivisibile</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={url} style={{ ...S.input, flex: 1, fontSize: 11 }} onFocus={e => e.target.select()}/>
            <button onClick={copy} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, background: copied ? '#10B981' : 'var(--text)', color: copied ? '#fff' : 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
              {copied ? '✓ Copiato' : 'Copia'}
            </button>
          </div>
        </div>

        <div style={{ background: 'rgba(59,130,246,.08)', border: '1px dashed rgba(59,130,246,.3)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text2)', width: '100%' }}>
          <strong style={{ color: '#3B82F6' }}>Come usarlo:</strong> mostra il QR all'ispettore o invia il link via email/WhatsApp.
          Vedrà solo i dati che hai abilitato nello scope. Validità: <strong>{fmtDT(token.scadenza_at)}</strong>.
        </div>
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: '#3B82F6', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', textDecoration: 'none' }}>
          Apri preview ↗
        </a>
        <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Chiudi</button>
      </div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <div>
    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{label}</div>
    {children}
  </div>
}
function Subtitle({ children }) {
  return <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>{children}</div>
}
function ChipGrid({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
}
function Chip({ active, color, onClick, children }) {
  const c = color || '#3B82F6'
  return <button onClick={onClick} style={{
    padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 14, cursor: 'pointer',
    border: '1px solid ' + (active ? c : 'var(--border)'),
    background: active ? c + '22' : 'transparent',
    color: active ? c : 'var(--text2)',
  }}>{children}</button>
}
function Block({ title, enabled, onToggle, children }) {
  return <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: enabled ? 12 : 0 }}>
      <input type="checkbox" checked={enabled} onChange={onToggle}/>
      {title}
    </label>
    {enabled && <div>{children}</div>}
  </div>
}
