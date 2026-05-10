// Gestione chiavi API per integrazioni esterne (POS, sviluppatori, ecc.)
// Genera chiavi sha256-hashed: la chiave plaintext si vede SOLO al momento
// della generazione, poi solo prefix + hash sono in DB.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const SCOPES_CATALOG = [
  { key: 'customers.read',   label: 'Clienti CRM (lettura)',          group: 'CRM' },
  { key: 'customers.write',  label: 'Clienti CRM (scrittura)',        group: 'CRM' },
  { key: 'sales.read',       label: 'Vendite/scontrini (lettura)',    group: 'Vendite' },
  { key: 'sales.write',      label: 'Vendite/scontrini (scrittura)',  group: 'Vendite' },
  { key: 'loyalty.read',     label: 'Programma fedeltà (lettura)',    group: 'Fedeltà' },
  { key: 'loyalty.write',    label: 'Programma fedeltà (scrittura)',  group: 'Fedeltà' },
  { key: 'promotions.read',  label: 'Promozioni (lettura)',           group: 'Promozioni' },
]

const TIPI = [
  { v: 'pos',         l: 'POS', d: 'Cassa registratori / POS' },
  { v: 'dev',         l: 'Developer', d: 'Sviluppatore / integratore esterno' },
  { v: 'integration', l: 'Integration', d: 'Sistema terzo (e-commerce, ERP, ecc.)' },
]

function fmtDT(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
         d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

// Crypto: genera chiave random + sha256 hash
async function generateKey() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  const raw = Array.from(arr).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 40)
  const key = 'pk_live_' + raw
  // sha256 via SubtleCrypto
  const enc = new TextEncoder().encode(key)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return { key, hash, prefix: key.slice(0, 12) }
}

export default function ApiKeys({ sps = [] }) {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState(null) // chiave appena creata mostrata UNA volta

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.from('api_keys')
      .select('*').order('created_at', { ascending: false })
    if (err) setError(err.message)
    setKeys(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)

  const revoca = async (k) => {
    if (!confirm(`Revocare la chiave "${k.nome}"? Tutte le richieste con questa chiave smetteranno di funzionare.`)) return
    await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', k.id)
    await load()
  }
  const elimina = async (k) => {
    if (!confirm(`Eliminare definitivamente la chiave "${k.nome}"?`)) return
    await supabase.from('api_keys').delete().eq('id', k.id)
    await load()
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Card title="API Keys" badge={loading ? '…' : keys.length + ' chiavi'} extra={
      <button onClick={() => setCreating(true)}
        style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        + Nuova chiave
      </button>
    }>
      <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
        <strong style={{ color: '#3B82F6' }}>Per sviluppatori (Filippo & co.):</strong> queste chiavi permettono al POS o ad altri sistemi
        di leggere/scrivere su Convivia tramite API REST. Endpoint base: <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>https://cic-saas.vercel.app/api/v1?resource={'{...}'}</code>.
        Header auth: <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>Authorization: Bearer pk_live_...</code>.
        La chiave viene mostrata <strong>una sola volta</strong> alla creazione: copiala e salvala in un posto sicuro.
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}

      {!loading && keys.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        Nessuna chiave creata. Click "+ Nuova chiave" per iniziare.
      </div>}

      {!loading && keys.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Nome', 'Tipo', 'Locale', 'Prefix', 'Scopes', 'Ultimo uso', 'Usi', 'Stato', ''].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {keys.map(k => {
              const tipo = TIPI.find(t => t.v === k.tipo) || { l: k.tipo }
              const isActive = !k.revoked_at
              return <tr key={k.id} style={{ borderBottom: '1px solid var(--border)', opacity: isActive ? 1 : 0.5 }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{k.nome}</td>
                <td style={{ ...S.td }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: 'rgba(139,92,246,.15)', color: '#8B5CF6', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{tipo.l}</span>
                </td>
                <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{k.locale || <span style={{ color: 'var(--text3)' }}>tutti</span>}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{k.key_prefix}…</td>
                <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>
                  {(k.scopes || []).length === 0 ? '—' : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {(k.scopes || []).slice(0, 3).map(s => <span key={s} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--surface2)', color: 'var(--text2)' }}>{s}</span>)}
                    {(k.scopes || []).length > 3 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>+{k.scopes.length - 3}</span>}
                  </div>}
                </td>
                <td style={{ ...S.td, fontSize: 11 }}>{fmtDT(k.last_used_at)}</td>
                <td style={{ ...S.td, fontSize: 12, fontWeight: 600 }}>{k.uses_count || 0}</td>
                <td style={{ ...S.td }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: (isActive ? '#10B981' : '#EF4444') + '22', color: isActive ? '#10B981' : '#EF4444', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                    {isActive ? 'Attiva' : 'Revocata'}
                  </span>
                </td>
                <td style={{ ...S.td }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isActive && <button onClick={() => revoca(k)} style={{ background: 'transparent', color: '#F59E0B', border: '1px solid rgba(245,158,11,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Revoca</button>}
                    <button onClick={() => elimina(k)} style={{ background: 'transparent', color: '#EF4444', border: '1px solid rgba(220,38,38,.3)', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>Elimina</button>
                  </div>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </Card>

    {creating && <CreateKeyModal allLocali={allLocali}
      onClose={() => setCreating(false)}
      onCreated={async ({ key }) => { setCreating(false); setRevealedKey(key); await load() }}/>}

    {revealedKey && <RevealedKeyModal apiKey={revealedKey} onClose={() => setRevealedKey(null)}/>}
  </div>
}

function CreateKeyModal({ allLocali, onClose, onCreated }) {
  const [f, setF] = useState({
    nome: '', tipo: 'pos', locale: '',
    scopes: ['customers.read', 'customers.write', 'sales.write', 'loyalty.read', 'loyalty.write', 'promotions.read'],
    note: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const toggleScope = (s) => {
    setF(prev => ({ ...prev, scopes: prev.scopes.includes(s) ? prev.scopes.filter(x => x !== s) : [...prev.scopes, s] }))
  }

  const save = async () => {
    setErr('')
    if (!f.nome.trim()) { setErr('Nome richiesto'); return }
    if (f.scopes.length === 0) { setErr('Seleziona almeno uno scope'); return }
    setSaving(true)
    try {
      const { key, hash, prefix } = await generateKey()
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('api_keys').insert({
        user_id: user.id,
        nome: f.nome.trim(),
        tipo: f.tipo,
        locale: f.locale || null,
        key_prefix: prefix,
        key_hash: hash,
        scopes: f.scopes,
        note: f.note || null,
      })
      if (error) throw error
      onCreated({ key })
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { ...S.input, width: '100%' }
  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 640, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Nuova chiave API</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Nome (descrittivo) *">
          <input style={inp} placeholder='es. "POS REMEMBEER" o "Filippo dev"' value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })}/>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Tipo">
            <select style={inp} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
              {TIPI.map(t => <option key={t.v} value={t.v}>{t.l} — {t.d}</option>)}
            </select>
          </Field>
          <Field label="Locale (vuoto = tutti)">
            <select style={inp} value={f.locale} onChange={e => setF({ ...f, locale: e.target.value })}>
              <option value="">— Tutti i locali —</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Scopes (cosa può fare) *</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {SCOPES_CATALOG.map(s => {
              const active = f.scopes.includes(s.key)
              return <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 6, cursor: 'pointer',
                background: active ? 'rgba(16,185,129,.1)' : 'var(--surface2)',
                border: '1px solid ' + (active ? 'rgba(16,185,129,.3)' : 'var(--border)') }}>
                <input type="checkbox" checked={active} onChange={() => toggleScope(s.key)}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: active ? '#10B981' : 'var(--text)' }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>{s.key}</div>
                </div>
              </label>
            })}
          </div>
        </div>

        <Field label="Note (opzionali)">
          <textarea style={{ ...inp, minHeight: 50 }} placeholder="A chi è stata data, perché, scadenza..." value={f.note} onChange={e => setF({ ...f, note: e.target.value })}/>
        </Field>

        {err && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Annulla</button>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {saving ? 'Genero…' : 'Genera chiave'}
        </button>
      </div>
    </div>
  </div>
}

function RevealedKeyModal({ apiKey, onClose }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(apiKey)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  return <div onClick={() => { if (confirm('Hai copiato la chiave? Non potrai più vederla.')) onClose() }}
    className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 640, width: '100%', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ margin: 0, fontSize: 15, color: '#10B981' }}>✓ Chiave generata</h3>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Copiala adesso. Non potrai più vederla dopo aver chiuso questa finestra.</div>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, padding: 14, fontFamily: 'monospace', fontSize: 13, color: '#10B981', wordBreak: 'break-all' }}>
          {apiKey}
        </div>
        <button onClick={copy} style={{ padding: '10px', fontSize: 13, fontWeight: 700, background: copied ? '#10B981' : 'var(--text)', color: copied ? '#fff' : 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {copied ? '✓ Copiata negli appunti' : '📋 Copia chiave'}
        </button>
        <div style={{ background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', padding: 10, borderRadius: 8, fontSize: 12, color: '#F59E0B' }}>
          ⚠ Conservala in un posto sicuro (1Password, env del POS, ecc.). In DB salviamo solo l'hash sha256 — se la perdi devi generarne una nuova.
        </div>
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => { if (confirm('Hai copiato la chiave? Non potrai più vederla.')) onClose() }}
          style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          Ho copiato, chiudi
        </button>
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
