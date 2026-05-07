import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useIsAdmin } from '../lib/features'
import { S, Card } from '../components/shared/styles.jsx'

const iS = S.input

// Catalogo tab e widget conosciuti (per popolare le checkbox nei piani).
// Allineato con la nuova gerarchia top-level (vendite/conta/imp wrapper).
// Le keys legacy (scontrini/cat/rep/iva/fat/susp) sono mantenute per
// backward compat con piani esistenti.
const TAB_CATALOG = [
  { key: 'ov', label: 'Panoramica' },
  { key: 'vendite', label: 'Vendite' },
  { key: 'mag', label: 'Magazzino' },
  { key: 'hr', label: 'HR' },
  { key: 'prod', label: 'Produttività' },
  { key: 'conta', label: 'Contabilità' },
  { key: 'mkt', label: 'Marketing' },
  { key: 'ce', label: 'Conto Economico' },
  { key: 'bud', label: 'Budget' },
  { key: 'avvisi', label: 'Avvisi' },
  { key: 'imp', label: 'Impostazioni' },
  // ── Legacy (backward compat) ──
  { key: 'scontrini', label: '[legacy] Scontrini' },
  { key: 'cat', label: '[legacy] Categorie' },
  { key: 'rep', label: '[legacy] Reparti' },
  { key: 'iva', label: '[legacy] IVA' },
  { key: 'fat', label: '[legacy] Fatture' },
  { key: 'susp', label: '[legacy] Movimenti' },
]

// Widget noti per tab (preliminare; verranno espansi con il refactor Step 4)
const WIDGET_CATALOG = {
  ov: [
    { key: 'kpi.ricavi', label: 'KPI Ricavi totali' },
    { key: 'kpi.scontrini', label: 'KPI Scontrini' },
    { key: 'kpi.medio', label: 'KPI Scontrino medio' },
    { key: 'kpi.coperti', label: 'KPI Coperti' },
    { key: 'kpi.reparti', label: 'KPI Reparti attivi' },
    { key: 'chart.trend', label: 'Andamento ricavi e coperti' },
    { key: 'chart.depts', label: 'Ripartizione reparti' },
    { key: 'chart.top_depts', label: 'Top reparti' },
    { key: 'chart.top_cats', label: 'Top categorie' },
  ],
  iva: [
    { key: 'iva.saldo_top', label: 'Saldo grande in alto' },
    { key: 'iva.cards_aliquota', label: 'Card per aliquota' },
    { key: 'iva.tabella', label: 'Tabella riepilogo dettagliato' },
    { key: 'iva.backfill', label: 'Bottone manutenzione backfill' },
  ],
  mag: [
    { key: 'mag.cruscotto', label: 'Cruscotto magazzino' },
    { key: 'mag.fatture', label: 'Fatture' },
    { key: 'mag.prodotti', label: 'Prodotti CiC' },
    { key: 'mag.articoli', label: 'Articoli' },
    { key: 'mag.semilavorati', label: 'Semilavorati' },
    { key: 'mag.ricette', label: 'Ricette' },
    { key: 'mag.produzione', label: 'Produzione (HACCP)' },
    { key: 'mag.giacenze', label: 'Giacenze' },
    { key: 'mag.movimenti', label: 'Movimenti' },
    { key: 'mag.inventario', label: 'Inventario' },
    { key: 'mag.ordini', label: 'Ordini' },
    { key: 'mag.prezzi', label: 'Prezzi' },
    { key: 'mag.matrice_eisenhower', label: 'Matrice Eisenhower (advanced)' },
  ],
  hr: [
    { key: 'hr.dipendenti', label: 'Dipendenti' },
    { key: 'hr.documenti', label: 'Documenti' },
    { key: 'hr.calendario', label: 'Calendario' },
    { key: 'hr.presenze', label: 'Presenze reali' },
    { key: 'hr.turni', label: 'Turni' },
    { key: 'hr.checklist', label: 'Checklist timbratura' },
  ],
  conta: [
    { key: 'conta.fatture', label: 'Fatture passive' },
    { key: 'conta.iva', label: 'IVA' },
    { key: 'conta.chiusure', label: 'Chiusure & Versamenti' },
  ],
  vendite: [
    { key: 'vendite.scontrini', label: 'Scontrini cliccabili' },
    { key: 'vendite.categorie', label: 'Categorie' },
    { key: 'vendite.reparti', label: 'Reparti' },
  ],
  imp: [
    { key: 'imp.generale', label: 'Anagrafica azienda + locali' },
    { key: 'imp.integrazioni', label: 'Status integrazioni' },
    { key: 'imp.notifiche', label: 'Resoconto giornaliero & alert' },
    { key: 'imp.account', label: 'Profilo + cambio password' },
  ],
}

// ─── Helper API admin ──────────────────────────────────────────────────────
async function adminCall(action, body = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('non autenticato')
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({ action, ...body }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || 'admin error ' + r.status)
  return data
}

// ─── Componenti UI ─────────────────────────────────────────────────────────

function UsersList({ onEditUser, refreshKey }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { users } = await adminCall('list-users')
      setUsers(users)
    } catch (e) { alert(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload, refreshKey])

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()))

  return <>
    <Card title={`Utenti (${users.length})`} extra={
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input placeholder="Cerca email..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...iS, width: 200 }} />
      <button onClick={() => setShowNew(true)} style={{ ...iS, background: '#10B981', color: 'var(--text)', fontWeight: 600, border: 'none', padding: '6px 12px', cursor: 'pointer' }}>
        + Nuovo cliente
      </button>
    </div>
  }>
    {loading && <div style={{ padding: 20, color: 'var(--text3)' }}>Caricamento…</div>}
    {!loading && (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
          {['Email', 'Piano', 'Stato', 'Valido fino', 'Ultimo login', 'Admin', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id}>
              <td style={{ ...S.td, fontWeight: 500 }}>{u.email}</td>
              <td style={S.td}>
                {u.plan ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>{u.plan.plan_id}</span>
                        : <span style={{ color: 'var(--text3)', fontSize: 11 }}>nessuno</span>}
              </td>
              <td style={S.td}>
                {u.plan?.active === false ? <span style={S.badge('#EF4444', 'rgba(239,68,68,.12)')}>SOSP.</span>
                  : u.plan?.trial_until ? <span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>TRIAL</span>
                  : u.plan ? <span style={{ color: '#10B981' }}>Attivo</span> : '—'}
              </td>
              <td style={{ ...S.td, fontSize: 12 }}>{u.plan?.valid_until || '—'}</td>
              <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('it-IT') : '—'}</td>
              <td style={S.td}>{u.admin_role ? <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.15)')}>{u.admin_role}</span> : ''}</td>
              <td style={S.td}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => onEditUser(u)} style={{ ...iS, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>Modifica</button>
                  <button onClick={async () => {
                    if (u.admin_role) { alert('Non posso eliminare un admin da qui. Rimuovi prima il ruolo da Supabase.'); return }
                    if (!confirm(`Eliminare definitivamente ${u.email}?\n\nVerranno cancellati: account, settings, piano, override, layout. Operazione irreversibile.`)) return
                    try { await adminCall('delete-user', { user_id: u.id }); alert('Utente eliminato'); reload() }
                    catch (e) { alert('Errore: ' + e.message) }
                  }}
                    title="Elimina utente"
                    style={{ ...iS, fontSize: 11, padding: '4px 8px', cursor: 'pointer', color: '#EF4444' }}>Elimina</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    </Card>
    {showNew && <NewUser onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />}
  </>
}

// IMPORTANTE: Field deve stare FUORI da NewUser, altrimenti ogni render
// lo ricrea come "nuovo componente" e React rimonta gli input perdendo il focus.
function Field({ label, hint, children }) {
  return <label style={{ display: 'block', marginBottom: 12 }}>
    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
      {label} {hint && <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {hint}</span>}
    </div>
    {children}
  </label>
}

function NewUser({ onClose, onCreated }) {
  const [email, setEmail] = useState('')
  const [planId, setPlanId] = useState('')
  const [trialUntil, setTrialUntil] = useState('')
  const [validUntil, setValidUntil] = useState('')
  // Anagrafica azienda
  const [companyName, setCompanyName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [taxCode, setTaxCode] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [website, setWebsite] = useState('')
  // Integrazioni
  const [cicApiKey, setCicApiKey] = useState('')
  const [tsId, setTsId] = useState('')
  const [tsSecret, setTsSecret] = useState('')
  const [tsOwner, setTsOwner] = useState('')
  const [plateformKey, setPlateformKey] = useState('')
  const [salesPoints, setSalesPoints] = useState([])
  const [plans, setPlans] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCic, setShowCic] = useState(false)
  const [showTsSecret, setShowTsSecret] = useState(false)
  const [showPlateform, setShowPlateform] = useState(false)

  useEffect(() => {
    adminCall('list-plans').then(d => {
      setPlans(d.plans || [])
      const def = (d.plans || []).find(p => p.is_default)
      if (def) setPlanId(def.id)
    }).catch(() => {})
  }, [])

  const trySyncCic = async () => {
    if (!cicApiKey) { alert('Inserisci prima la chiave CiC'); return }
    setSyncing(true)
    try {
      const { salespoints } = await adminCall('sync-salespoints', { cic_api_key: cicApiKey })
      setSalesPoints(salespoints || [])
      alert(`Trovati ${salespoints?.length || 0} locali`)
    } catch (e) { alert(e.message) }
    setSyncing(false)
  }

  const submit = async () => {
    if (!email || !email.includes('@')) { alert('Email non valida'); return }
    setCreating(true)
    try {
      const data = await adminCall('invite-user', {
        email: email.trim().toLowerCase(),
        plan_id: planId || undefined,
        valid_until: validUntil || null,
        trial_until: trialUntil || null,
        cic_api_key: cicApiKey || null,
        sales_points: salesPoints.length ? salesPoints : undefined,
        ts_digital_id: tsId || null,
        ts_digital_secret: tsSecret || null,
        ts_digital_owner: tsOwner || null,
        plateform_api_key: plateformKey || null,
      })
      // Salva anagrafica subito dopo l'invito (richiede user_id)
      if (data?.user_id && (companyName || vatNumber || taxCode || address || phone || companyEmail || website)) {
        try {
          await adminCall('set-user-settings', {
            user_id: data.user_id,
            company_name: companyName || null,
            vat_number: vatNumber || null,
            tax_code: taxCode || null,
            address: address || null,
            phone: phone || null,
            company_email: companyEmail || null,
            website: website || null,
          })
        } catch (e) { console.warn('anagrafica non salvata:', e.message) }
      }
      alert(`Cliente creato.\n\nUna email di benvenuto è stata inviata a ${email}\ncon il link per impostare la password.`)
      onCreated()
    } catch (e) { alert('Errore: ' + e.message) }
    setCreating(false)
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '92vh', overflow: 'auto' }}>
      <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>+ Nuovo cliente</h3>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Riceverà una email per impostare la password al primo accesso
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <div style={{ padding: 20 }}>
        {/* DATI BASE */}
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 12 }}>Account</div>
          <Field label="Email del cliente *" hint="obbligatoria">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@esempio.it" style={{ ...iS, width: '100%' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Piano">
              <select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...iS, width: '100%' }}>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Trial fino">
              <input type="date" value={trialUntil} onChange={e => setTrialUntil(e.target.value)} style={{ ...iS, width: '100%' }} />
            </Field>
            <Field label="Valido fino">
              <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={{ ...iS, width: '100%' }} />
            </Field>
          </div>
        </div>

        {/* ANAGRAFICA AZIENDA */}
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#10B981', marginBottom: 4 }}>Anagrafica azienda</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 12 }}>
            Tutti i campi sono opzionali e modificabili in qualsiasi momento da "Modifica utente"
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="Ragione sociale">
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="es. Alhena Group SRL" style={{ ...iS, width: '100%' }} />
            </Field>
            <Field label="Telefono">
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="es. 0121 1234567" style={{ ...iS, width: '100%' }} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Partita IVA">
              <input value={vatNumber} onChange={e => setVatNumber(e.target.value)} placeholder="11 cifre" style={{ ...iS, width: '100%', fontFamily: 'monospace' }} />
            </Field>
            <Field label="Codice Fiscale">
              <input value={taxCode} onChange={e => setTaxCode(e.target.value.toUpperCase())} placeholder="" style={{ ...iS, width: '100%', fontFamily: 'monospace', textTransform: 'uppercase' }} />
            </Field>
          </div>
          <Field label="Indirizzo sede">
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Via Roma 1, 10064 Pinerolo TO" style={{ ...iS, width: '100%' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Email aziendale (PEC/contatto)">
              <input type="email" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} placeholder="info@azienda.it" style={{ ...iS, width: '100%' }} />
            </Field>
            <Field label="Sito web">
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" style={{ ...iS, width: '100%' }} />
            </Field>
          </div>
        </div>

        {/* INTEGRAZIONI */}
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6', marginBottom: 4 }}>Integrazioni esterne</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 12 }}>
            Tutte opzionali — puoi compilarle ora o aggiungerle dopo da "Modifica utente"
          </div>

          {/* CIC */}
          <Field label="Chiave API CiC (Cassa in Cloud)" hint="back-office CiC > Settings > API">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type={showCic ? 'text' : 'password'} value={cicApiKey} onChange={e => setCicApiKey(e.target.value)}
                placeholder="es. 577e0bcc-f44e-4f5a-..." style={{ ...iS, flex: 1, fontFamily: 'monospace' }} />
              <button onClick={() => setShowCic(!showCic)} style={{ ...iS, padding: '6px 10px', cursor: 'pointer' }}>{showCic ? 'Nascondi' : 'Mostra'}</button>
              <button onClick={trySyncCic} disabled={syncing || !cicApiKey} style={{ ...iS, background: '#3B82F6', color: '#fff', fontWeight: 600, border: 'none', padding: '6px 12px', cursor: syncing ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                {syncing ? 'Attendi…' : 'Sincronizza locali'}
              </button>
            </div>
            {salesPoints.length > 0 && (
              <div style={{ marginTop: 8, padding: 8, background: '#0a0e16', borderRadius: 4, fontSize: 11, color: 'var(--text2)' }}>
                {salesPoints.length} locali sincronizzati: {salesPoints.map(s => s.description || s.name).join(', ')}
              </div>
            )}
          </Field>

          {/* TS Digital */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="TS Digital ID" hint="b2b-auth-service.agyo.io">
              <input value={tsId} onChange={e => setTsId(e.target.value)} placeholder="es. ccff31e7-a883-..." style={{ ...iS, width: '100%', fontFamily: 'monospace' }} />
            </Field>
            <Field label="TS Digital Secret">
              <div style={{ display: 'flex', gap: 4 }}>
                <input type={showTsSecret ? 'text' : 'password'} value={tsSecret} onChange={e => setTsSecret(e.target.value)} placeholder="es. e4de10bd-04d5-..." style={{ ...iS, flex: 1, fontFamily: 'monospace' }} />
                <button onClick={() => setShowTsSecret(!showTsSecret)} style={{ ...iS, padding: '6px 10px', cursor: 'pointer' }}>{showTsSecret ? 'Nascondi' : 'Mostra'}</button>
              </div>
            </Field>
          </div>
          <Field label="TS Digital Owner (Codice Fiscale azienda)" hint="es. FSCSMN98H12G674S">
            <input value={tsOwner} onChange={e => setTsOwner(e.target.value.toUpperCase())} placeholder="" style={{ ...iS, width: '100%', fontFamily: 'monospace', textTransform: 'uppercase' }} />
          </Field>

          {/* Plateform */}
          <Field label="Chiave API Plateform" hint="opzionale, per CRM/RFM">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type={showPlateform ? 'text' : 'password'} value={plateformKey} onChange={e => setPlateformKey(e.target.value)} placeholder="" style={{ ...iS, flex: 1, fontFamily: 'monospace' }} />
              <button onClick={() => setShowPlateform(!showPlateform)} style={{ ...iS, padding: '6px 10px', cursor: 'pointer' }}>{showPlateform ? 'Nascondi' : 'Mostra'}</button>
            </div>
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
          <button onClick={submit} disabled={creating || !email} style={{ ...iS, background: creating ? '#1a1f2e' : '#10B981', color: creating ? '#94a3b8' : '#0f1420', fontWeight: 600, border: 'none', padding: '8px 22px', cursor: creating ? 'wait' : 'pointer' }}>
            {creating ? 'Creo…' : 'Crea & invita per email'}
          </button>
        </div>
      </div>
    </div>
  </div>
}

function EditUser({ user, plans, onClose, onSaved }) {
  const [section, setSection] = useState('plan') // plan | anagrafica | features | cic
  const [planId, setPlanId] = useState(user.plan?.plan_id || (plans.find(p => p.is_default)?.id || plans[0]?.id))
  const [validUntil, setValidUntil] = useState(user.plan?.valid_until || '')
  const [trialUntil, setTrialUntil] = useState(user.plan?.trial_until || '')
  const [active, setActive] = useState(user.plan?.active !== false)
  const [notes, setNotes] = useState(user.plan?.notes || '')
  const [extraTabs, setExtraTabs] = useState(user.overrides?.extra?.tabs || [])
  const [excludeTabs, setExcludeTabs] = useState(user.overrides?.exclude?.tabs || [])
  const [extraWidgets, setExtraWidgets] = useState(user.overrides?.extra?.widgets || [])
  const [excludeWidgets, setExcludeWidgets] = useState(user.overrides?.exclude?.widgets || [])
  const [saving, setSaving] = useState(false)

  // Settings condivise (CiC + anagrafica + altre integrazioni)
  const [cicApiKey, setCicApiKey] = useState('')
  const [salesPoints, setSalesPoints] = useState([])
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [syncingSp, setSyncingSp] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // Anagrafica azienda
  const [companyName, setCompanyName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [taxCode, setTaxCode] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [website, setWebsite] = useState('')

  // Carica le settings (CiC + anagrafica) la prima volta che si apre una sezione che ne ha bisogno
  const loadSettings = useCallback(async () => {
    try {
      const { settings } = await adminCall('get-user-settings', { user_id: user.id })
      setCicApiKey(settings?.cic_api_key || '')
      setSalesPoints(Array.isArray(settings?.sales_points) ? settings.sales_points : [])
      setCompanyName(settings?.company_name || '')
      setVatNumber(settings?.vat_number || '')
      setTaxCode(settings?.tax_code || '')
      setAddress(settings?.address || '')
      setPhone(settings?.phone || '')
      setCompanyEmail(settings?.company_email || '')
      setWebsite(settings?.website || '')
      setSettingsLoaded(true)
    } catch (e) { alert(e.message) }
  }, [user.id])
  useEffect(() => {
    if ((section === 'cic' || section === 'anagrafica') && !settingsLoaded) loadSettings()
  }, [section, settingsLoaded, loadSettings])

  const syncSalespoints = async () => {
    if (!cicApiKey) { alert('Inserisci prima la chiave API CiC'); return }
    setSyncingSp(true)
    try {
      const { salespoints } = await adminCall('sync-salespoints', { cic_api_key: cicApiKey })
      setSalesPoints(salespoints || [])
      alert(`Sincronizzati ${salespoints?.length || 0} locali da CiC`)
    } catch (e) { alert(e.message) }
    setSyncingSp(false)
  }

  const toggle = (arr, setArr, val) => setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])

  const save = async () => {
    setSaving(true)
    try {
      await adminCall('update-user-plan', {
        user_id: user.id, plan_id: planId,
        valid_until: validUntil || null,
        trial_until: trialUntil || null,
        active, notes,
      })
      await adminCall('set-overrides', {
        user_id: user.id,
        extra: { tabs: extraTabs, widgets: extraWidgets },
        exclude: { tabs: excludeTabs, widgets: excludeWidgets },
      })
      // Salva settings CiC + anagrafica se sono state caricate (= utente ha aperto il tab cic o anagrafica)
      if (settingsLoaded) {
        await adminCall('set-user-settings', {
          user_id: user.id,
          cic_api_key: cicApiKey || null,
          sales_points: salesPoints,
          company_name: companyName || null,
          vat_number: vatNumber || null,
          tax_code: taxCode || null,
          address: address || null,
          phone: phone || null,
          company_email: companyEmail || null,
          website: website || null,
        })
      }
      onSaved()
      onClose()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  const sBtn = (s) => ({
    padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: section === s ? '#F59E0B' : 'transparent',
    color: section === s ? '#0f1420' : '#94a3b8',
    borderBottom: section === s ? '2px solid #F59E0B' : '2px solid transparent',
  })

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Modifica utente · {user.email}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      {/* Tab di sezione */}
      <div style={{ display: 'flex', gap: 4, padding: '0 20px', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        <button onClick={() => setSection('plan')} style={sBtn('plan')}>Piano &amp; stato</button>
        <button onClick={() => setSection('anagrafica')} style={sBtn('anagrafica')}>Anagrafica</button>
        <button onClick={() => setSection('features')} style={sBtn('features')}>Override tab</button>
        <button onClick={() => setSection('cic')} style={sBtn('cic')}>Configurazione CiC</button>
      </div>

      <div style={{ padding: 20 }}>
        {section === 'plan' && <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Piano</div>
              <select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...iS, width: '100%' }}>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
              </select>
            </label>
            <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Stato</div>
              <select value={active ? 'on' : 'off'} onChange={e => setActive(e.target.value === 'on')} style={{ ...iS, width: '100%' }}>
                <option value="on">Attivo</option>
                <option value="off">Sospeso</option>
              </select>
            </label>
            <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Trial fino</div>
              <input type="date" value={trialUntil} onChange={e => setTrialUntil(e.target.value)} style={{ ...iS, width: '100%' }} />
            </label>
            <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Valido fino</div>
              <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={{ ...iS, width: '100%' }} />
            </label>
          </div>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Note interne</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...iS, width: '100%', resize: 'vertical' }} />
          </label>
        </>}

        {section === 'features' && <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#10B981', marginBottom: 8 }}>Extra: tab inclusi oltre al piano</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TAB_CATALOG.map(t => (
                <label key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)', background: extraTabs.includes(t.key) ? 'rgba(16,185,129,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={extraTabs.includes(t.key)} onChange={() => toggle(extraTabs, setExtraTabs, t.key)} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginBottom: 8 }}>Esclusi: tab tolti dal piano</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TAB_CATALOG.map(t => (
                <label key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)', background: excludeTabs.includes(t.key) ? 'rgba(239,68,68,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={excludeTabs.includes(t.key)} onChange={() => toggle(excludeTabs, setExcludeTabs, t.key)} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        </>}

        {section === 'anagrafica' && <>
          {!settingsLoaded && <div style={{ padding: 12, color: 'var(--text3)' }}>Carico…</div>}
          {settingsLoaded && <>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>
              Dati anagrafici dell'azienda cliente. Verranno mostrati nel modulo Impostazioni Generale.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Ragione sociale</div>
                <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="es. Alhena Group SRL" style={{ ...iS, width: '100%' }} />
              </label>
              <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Telefono</div>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="" style={{ ...iS, width: '100%' }} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Partita IVA</div>
                <input value={vatNumber} onChange={e => setVatNumber(e.target.value)} placeholder="11 cifre" style={{ ...iS, width: '100%', fontFamily: 'monospace' }} />
              </label>
              <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Codice Fiscale</div>
                <input value={taxCode} onChange={e => setTaxCode(e.target.value.toUpperCase())} placeholder="" style={{ ...iS, width: '100%', fontFamily: 'monospace', textTransform: 'uppercase' }} />
              </label>
            </div>
            <label style={{ display: 'block', marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Indirizzo sede</div>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Via, città, CAP" style={{ ...iS, width: '100%' }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Email aziendale (PEC/contatto)</div>
                <input type="email" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} style={{ ...iS, width: '100%' }} />
              </label>
              <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Sito web</div>
                <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" style={{ ...iS, width: '100%' }} />
              </label>
            </div>
          </>}
        </>}

        {section === 'cic' && <>
          {!settingsLoaded && <div style={{ padding: 12, color: 'var(--text3)' }}>Carico…</div>}
          {settingsLoaded && <>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Chiave API CiC <span style={{ color: 'var(--text3)' }}>(la trovi nel back-office Cassa in Cloud)</span></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type={showApiKey ? 'text' : 'password'} value={cicApiKey} onChange={e => setCicApiKey(e.target.value)}
                  placeholder="es. 577e0bcc-f44e-4f5a-b7b6-..."
                  style={{ ...iS, flex: 1, fontFamily: 'monospace' }} />
                <button onClick={() => setShowApiKey(!showApiKey)} style={{ ...iS, padding: '6px 10px', cursor: 'pointer' }} title={showApiKey ? 'Nascondi' : 'Mostra'}>
                  {showApiKey ? 'Nascondi' : 'Mostra'}
                </button>
              </div>
            </label>

            <div style={{ marginBottom: 12 }}>
              <button onClick={syncSalespoints} disabled={syncingSp || !cicApiKey}
                style={{ ...iS, background: syncingSp ? '#1a1f2e' : '#3B82F6', color: syncingSp ? '#94a3b8' : '#fff', fontWeight: 600, border: 'none', padding: '8px 14px', cursor: syncingSp ? 'wait' : 'pointer' }}>
                {syncingSp ? 'Sincronizzo…' : 'Sincronizza locali da CiC'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 10 }}>
                Verifica la chiave + scarica la lista locali del cliente
              </span>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Locali (sales_points) sincronizzati</div>
              {salesPoints.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', padding: 12, background: '#0a0e16', borderRadius: 6 }}>
                  Nessun locale. Inserisci la chiave API e clicca "Sincronizza".
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['ID', 'Descrizione', 'Nome'].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {salesPoints.map(s => (
                      <tr key={s.id || s.description}>
                        <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--text2)' }}>{s.id}</td>
                        <td style={{ ...S.td, fontWeight: 500 }}>{s.description}</td>
                        <td style={{ ...S.td, color: 'var(--text2)' }}>{s.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>}
        </>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 16 }}>
          <button
            onClick={async () => {
              if (user.admin_role) { alert('Non posso eliminare un admin da qui.'); return }
              if (!confirm(`Eliminare definitivamente ${user.email}?\n\nVerranno cancellati: account, settings, piano, override, layout. Operazione irreversibile.`)) return
              setSaving(true)
              try { await adminCall('delete-user', { user_id: user.id }); alert('Utente eliminato'); onSaved(); onClose() }
              catch (e) { alert('Errore: ' + e.message) }
              setSaving(false)
            }}
            disabled={saving || !!user.admin_role}
            style={{ ...iS, color: '#EF4444', cursor: saving ? 'wait' : 'pointer', padding: '8px 14px' }}
            title={user.admin_role ? 'Non eliminabile (admin)' : 'Elimina utente'}>
            Elimina utente
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
            <button onClick={save} disabled={saving} style={{ ...iS, background: '#F59E0B', color: 'var(--text)', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Salvo…' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
}

function PlansList() {
  const [plans, setPlans] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { plans } = await adminCall('list-plans')
      setPlans(plans)
    } catch (e) { alert(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const newPlan = () => setEditing({
    id: '', name: '', description: '',
    price_monthly: '', price_yearly: '',
    features: { tabs: [], widgets: [] }, is_default: false,
  })

  return <>
    <Card title={`Piani (${plans.length})`} extra={
      <button onClick={newPlan} style={{ ...iS, background: '#10B981', color: 'var(--text)', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: 'pointer' }}>+ Nuovo piano</button>
    }>
      {loading && <div style={{ padding: 20, color: 'var(--text3)' }}>Caricamento…</div>}
      {!loading && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['ID', 'Nome', 'Prezzo/mese', 'Prezzo/anno', 'Tab', 'Widget', 'Default', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {plans.map(p => {
              const tabs = p.features?.tabs?.length || 0
              const wAll = (p.features?.widgets || []).includes('*')
              return <tr key={p.id}>
                <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--text2)' }}>{p.id}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{p.name}</td>
                <td style={S.td}>{p.price_monthly != null ? '€ ' + p.price_monthly : '—'}</td>
                <td style={S.td}>{p.price_yearly != null ? '€ ' + p.price_yearly : '—'}</td>
                <td style={S.td}>{tabs}</td>
                <td style={S.td}>{wAll ? 'tutti (*)' : (p.features?.widgets?.length || 0)}</td>
                <td style={S.td}>{p.is_default ? <span style={{ color: '#F59E0B', fontWeight: 700 }}></span> : ''}</td>
                <td style={S.td}>
                  <button onClick={() => setEditing(p)} style={{ ...iS, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>Modifica</button>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      )}
    </Card>
    {editing && <EditPlan plan={editing} onClose={() => setEditing(null)} onSaved={reload} />}
  </>
}

function EditPlan({ plan, onClose, onSaved }) {
  const [id, setId] = useState(plan.id)
  const [name, setName] = useState(plan.name)
  const [description, setDescription] = useState(plan.description || '')
  const [priceMonthly, setPriceMonthly] = useState(plan.price_monthly ?? '')
  const [priceYearly, setPriceYearly] = useState(plan.price_yearly ?? '')
  const [isDefault, setIsDefault] = useState(plan.is_default || false)
  const [tabs, setTabs] = useState(plan.features?.tabs || [])
  const [widgets, setWidgets] = useState(plan.features?.widgets || [])
  const [allWidgets, setAllWidgets] = useState((plan.features?.widgets || []).includes('*'))
  const [saving, setSaving] = useState(false)

  const toggle = (arr, setArr, val) => setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])

  const save = async () => {
    if (!id || !name) { alert('ID e Nome sono obbligatori'); return }
    setSaving(true)
    try {
      await adminCall('save-plan', {
        id, name, description,
        price_monthly: priceMonthly === '' ? null : priceMonthly,
        price_yearly: priceYearly === '' ? null : priceYearly,
        features: { tabs, widgets: allWidgets ? ['*'] : widgets },
        is_default: isDefault,
      })
      onSaved(); onClose()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  const del = async () => {
    if (!confirm(`Eliminare il piano "${name}"?`)) return
    setSaving(true)
    try {
      await adminCall('delete-plan', { id })
      onSaved(); onClose()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{plan.id ? 'Modifica' : 'Nuovo'} piano</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 16 }}>
          <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>ID (immutabile)</div>
            <input value={id} onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} disabled={!!plan.id} style={{ ...iS, width: '100%', fontFamily: 'monospace' }} placeholder="es. starter" />
          </label>
          <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Nome visualizzato</div>
            <input value={name} onChange={e => setName(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
        </div>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Descrizione</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...iS, width: '100%', resize: 'vertical' }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Prezzo mensile (€)</div>
            <input type="number" value={priceMonthly} onChange={e => setPriceMonthly(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label><div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Prezzo annuo (€)</div>
            <input type="number" value={priceYearly} onChange={e => setPriceYearly(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-end', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            Default per nuovi utenti
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Tab inclusi</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TAB_CATALOG.map(t => (
              <label key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text)', background: tabs.includes(t.key) ? 'rgba(16,185,129,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={tabs.includes(t.key)} onChange={() => toggle(tabs, setTabs, t.key)} />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Widget inclusi</span>
            <label style={{ fontSize: 11, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={allWidgets} onChange={e => setAllWidgets(e.target.checked)} />
              Tutti i widget (*)
            </label>
          </div>
          {!allWidgets && (
            <div>
              {Object.entries(WIDGET_CATALOG).map(([tabKey, ws]) => (
                <details key={tabKey} style={{ marginBottom: 6, background: '#0a0e16', borderRadius: 6, padding: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>
                    {TAB_CATALOG.find(t => t.key === tabKey)?.label || tabKey} ({ws.filter(w => widgets.includes(w.key)).length}/{ws.length})
                  </summary>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {ws.map(w => (
                      <label key={w.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)', background: widgets.includes(w.key) ? 'rgba(16,185,129,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                        <input type="checkbox" checked={widgets.includes(w.key)} onChange={() => toggle(widgets, setWidgets, w.key)} />
                        {w.label}
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {plan.id ? <button onClick={del} disabled={saving} style={{ ...iS, color: '#EF4444', cursor: 'pointer', padding: '8px 14px' }}>Elimina</button> : <span/>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
            <button onClick={save} disabled={saving} style={{ ...iS, background: '#F59E0B', color: 'var(--text)', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Salvo…' : 'Salva piano'}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
}

// ─── Pagina principale ────────────────────────────────────────────────────
export default function AdminPage() {
  const { isAdmin, loading } = useIsAdmin()
  const [tab, setTab] = useState('users')
  const [plans, setPlans] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Carica i piani all'avvio (servono al modal di edit utente)
  const loadPlans = useCallback(async () => {
    try {
      const { plans } = await adminCall('list-plans')
      setPlans(plans)
    } catch (e) { /* silently */ }
  }, [])
  useEffect(() => { if (isAdmin) loadPlans() }, [isAdmin, loadPlans, reloadKey])

  if (loading) return <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)' }}>Verifico permessi…</div>
  if (!isAdmin) return <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#EF4444' }}>
    <div style={{ fontSize: 24, fontWeight: 700 }}>Accesso negato</div>
    <div>Solo gli admin possono entrare qui.</div>
    <a href="/" style={{ color: '#F59E0B' }}>Torna alla dashboard</a>
  </div>

  const tS = (t) => ({
    padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
    background: tab === t ? '#F59E0B' : 'transparent', color: tab === t ? '#0f1420' : '#64748b',
  })

  return <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'DM Sans',system-ui,sans-serif" }}>
    <div style={{ background: 'var(--surface2)', borderBottom: '1px solid #1e2636', padding: '0 1.5rem', height: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>Admin · CIC SaaS</span>
      <a href="/" style={{ marginLeft: 'auto', color: 'var(--text2)', fontSize: 12 }}>Torna alla dashboard</a>
      <button onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')} style={{ ...iS, color: 'var(--text3)', border: '1px solid var(--border)', padding: '6px 12px', cursor: 'pointer' }}>Esci</button>
    </div>
    <div style={{ background: 'var(--surface2)', borderBottom: '1px solid #1e2636', padding: '0 1.5rem', display: 'flex', gap: 4 }}>
      <button onClick={() => setTab('users')} style={tS('users')}>Utenti</button>
      <button onClick={() => setTab('plans')} style={tS('plans')}>Piani</button>
    </div>
    <div style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      {tab === 'users' && <UsersList onEditUser={u => setEditingUser(u)} refreshKey={reloadKey} />}
      {tab === 'plans' && <PlansList />}
    </div>
    {editingUser && plans.length > 0 && (
      <EditUser user={editingUser} plans={plans} onClose={() => setEditingUser(null)} onSaved={() => setReloadKey(k => k + 1)} />
    )}
  </div>
}
