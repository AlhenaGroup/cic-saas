// Impostazioni → Team / Accessi
// L'imprenditore (owner) gestisce l'accesso alla dashboard dei propri dipendenti:
// email, PIN, permessi granulari per modulo + sub-tab (None / R / RW).
//
// Backend: scrive direttamente in `employees.email`, `employees.pin`,
// `employees.module_permissions` (RLS owner permette).
// Login dipendente: vedi /api/staff-auth

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'
import { MODULES, SUB_TABS } from '../../lib/permissions'

const iS = S.input

export default function TeamAccess({ sps }) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // employee in edit (con bozza permessi)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadError('')
    // Provo prima con tutti i campi nuovi (auth_user_id, module_permissions);
    // se la migration non e' applicata, ricado su select * e mostro un avviso.
    let { data, error } = await supabase.from('employees')
      .select('id, nome, email, pin, ruolo, locale, stato, auth_user_id, module_permissions')
      .order('nome')
    if (error) {
      // Fallback: vecchio schema senza colonne nuove
      const r = await supabase.from('employees').select('*').order('nome')
      data = r.data || []
      setLoadError('Per attivare la gestione accessi devi prima applicare la migration SQL (vedi supabase/staff-access.sql).')
    }
    setEmployees(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!search) return employees
    const q = search.toLowerCase()
    return employees.filter(e => (e.nome || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q))
  }, [employees, search])

  const countModuli = (perms) => {
    if (!perms) return 0
    return Object.keys(perms).filter(k => perms[k] === 'r' || perms[k] === 'rw').length
  }

  return <Card title="Team / Accessi" badge={loading ? '…' : (employees.length + ' dipendenti')} extra={
    <input placeholder="Cerca per nome o email…" value={search} onChange={e => setSearch(e.target.value)}
      style={{ ...iS, fontSize: 12, padding: '4px 10px', width: 220 }} />
  }>
    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.5 }}>
      I dipendenti accedono alla dashboard via <strong>email + PIN</strong> dalla pagina di login (link "Accedi con PIN").
      Per ogni modulo puoi scegliere se non accessibile, in sola lettura, oppure modificabile.
      Il tab Permessi della scheda dipendente HR continua a gestire i permessi del menu /timbra (timbratura, consumo, ecc.).
    </div>
    {loadError && (
      <div style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', color: '#92400E', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12, lineHeight: 1.5 }}>
        ⚠ {loadError}
      </div>
    )}

    {loading ? (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>
    ) : filtered.length === 0 ? (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Nessun dipendente. Aggiungili da <strong>HR → Dipendenti</strong>, poi torna qui per assegnare email + PIN + permessi.
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Nome', 'Email', 'PIN', 'Stato', 'Moduli', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{e.nome}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12 }}>{e.email || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }}>{e.pin ? '••' + String(e.pin).slice(-2) : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                <td style={{ ...S.td, fontSize: 11 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, background: e.stato === 'Attivo' ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.15)', color: e.stato === 'Attivo' ? '#10B981' : 'var(--text3)', fontWeight: 600 }}>{e.stato || '—'}</span>
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {countModuli(e.module_permissions) > 0 ? <strong style={{ color: '#10B981' }}>{countModuli(e.module_permissions)}</strong> : <span style={{ color: 'var(--text3)' }}>0</span>}
                  {e.auth_user_id && <span title="Account dashboard creato" style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(59,130,246,.15)', color: '#3B82F6' }}>ACCOUNT</span>}
                </td>
                <td style={S.td}>
                  <button onClick={() => setEditing({ ...e, module_permissions: e.module_permissions || {} })}
                    style={{ ...iS, color: '#3B82F6', border: '1px solid var(--border)', padding: '4px 12px', cursor: 'pointer', fontSize: 11 }}>
                    Modifica
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {editing && <EditModal employee={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} sps={sps} />}
  </Card>
}

function EditModal({ employee, onClose, onSaved, sps }) {
  const [email, setEmail] = useState(employee.email || '')
  const [pin, setPin] = useState(employee.pin || '')
  const [perms, setPerms] = useState(employee.module_permissions || {})
  const [stato, setStato] = useState(employee.stato || 'Attivo')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [showAdvanced, setShowAdvanced] = useState({}) // { mag: true } per mostrare sub-tab

  const setModulePerm = (modKey, value) => {
    setPerms(prev => {
      const next = { ...prev }
      if (value == null) delete next[modKey]
      else next[modKey] = value
      // Se setto modulo, rimuovo eventuali override sub-tab espliciti (che saranno re-inseriti se l'utente li tocca)
      Object.keys(next).forEach(k => {
        if (k.startsWith(modKey + '.')) delete next[k]
      })
      return next
    })
  }
  const setSubPerm = (modKey, subKey, value) => {
    const fullKey = modKey + '.' + subKey
    setPerms(prev => {
      const next = { ...prev }
      if (value == null) delete next[fullKey]
      else next[fullKey] = value
      return next
    })
  }

  const submit = async () => {
    setErr('')
    if (!email.trim()) { setErr('Email obbligatoria per accesso dashboard'); return }
    if (!pin || !/^\d{4,8}$/.test(pin)) { setErr('PIN deve essere 4-8 cifre'); return }
    setSaving(true)
    const { error } = await supabase.from('employees').update({
      email: email.trim().toLowerCase(),
      pin: pin.trim(),
      stato,
      module_permissions: perms,
    }).eq('id', employee.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 720 }}>
      <div style={{ padding: 18, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Permessi dashboard · {employee.nome}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ padding: 18 }}>
        {/* Credenziali */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          <Field label="Email per accesso dashboard">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ ...iS, width: '100%' }} placeholder="mario.rossi@…" />
          </Field>
          <Field label="PIN (4-8 cifre)">
            <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              style={{ ...iS, width: '100%', letterSpacing: '.2em', textAlign: 'center', fontFamily: 'monospace' }} placeholder="••••" />
          </Field>
          <Field label="Stato">
            <select value={stato} onChange={e => setStato(e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="Attivo">Attivo</option>
              <option value="Inattivo">Inattivo</option>
            </select>
          </Field>
        </div>

        {/* Matrice permessi */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
          Permessi per modulo
        </div>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          {MODULES.map(([modKey, modLabel]) => {
            const hasSubs = (SUB_TABS[modKey] || []).length > 0
            const moduleVal = perms[modKey] ?? null
            return <div key={modKey} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{modLabel}</div>
                <PermSelect value={moduleVal} onChange={v => setModulePerm(modKey, v)} />
                {hasSubs && (
                  <button onClick={() => setShowAdvanced(s => ({ ...s, [modKey]: !s[modKey] }))}
                    style={{ ...iS, padding: '2px 8px', fontSize: 10, color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', minWidth: 80 }}>
                    {showAdvanced[modKey] ? '▾ Dettaglio' : '▸ Dettaglio'}
                  </button>
                )}
              </div>
              {showAdvanced[modKey] && hasSubs && (
                <div style={{ marginTop: 8, paddingLeft: 14, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
                  {SUB_TABS[modKey].map(([subKey, subLabel]) => {
                    const fullKey = modKey + '.' + subKey
                    const subVal = perms[fullKey] !== undefined ? perms[fullKey] : null
                    const inheritsFromModule = subVal == null
                    return <div key={subKey} style={{ display: 'contents' }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)', alignSelf: 'center' }}>
                        {subLabel}
                        {inheritsFromModule && moduleVal && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text3)' }}>(eredita: {moduleVal === 'rw' ? 'R+W' : 'R'})</span>}
                      </div>
                      <PermSelect value={subVal} onChange={v => setSubPerm(modKey, subKey, v)} small />
                    </div>
                  })}
                </div>
              )}
            </div>
          })}
        </div>

        {err && <div style={{ marginTop: 12, color: '#EF4444', fontSize: 12 }}>{err}</div>}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} disabled={saving} style={{ ...iS, color: 'var(--text2)', border: '1px solid var(--border)', padding: '7px 14px', cursor: 'pointer' }}>Annulla</button>
        <button onClick={submit} disabled={saving}
          style={{ ...iS, background: '#3B82F6', color: '#fff', fontWeight: 700, border: 'none', padding: '7px 18px', cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Salvo…' : 'Salva'}
        </button>
      </div>
    </div>
  </div>
}

function PermSelect({ value, onChange, small = false }) {
  const opts = [
    { v: null, label: '—',    color: 'var(--text3)' },
    { v: 'r',  label: 'R',    color: '#3B82F6' },
    { v: 'rw', label: 'R+W',  color: '#10B981' },
  ]
  return <div style={{ display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
    {opts.map(o => (
      <button key={String(o.v)} onClick={() => onChange(o.v)}
        style={{
          padding: small ? '2px 8px' : '4px 10px',
          fontSize: small ? 10 : 11,
          fontWeight: 700,
          background: value === o.v ? o.color : 'transparent',
          color: value === o.v ? '#fff' : o.color,
          border: 'none', borderRadius: 4, cursor: 'pointer', minWidth: small ? 36 : 44,
        }}>
        {o.label}
      </button>
    ))}
  </div>
}

function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
    {children}
  </div>
}
