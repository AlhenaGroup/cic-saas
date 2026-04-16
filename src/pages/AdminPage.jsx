import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useIsAdmin } from '../lib/features'
import { S, Card } from '../components/shared/styles.jsx'

const iS = S.input

// Catalogo tab e widget conosciuti (per popolare le checkbox nei piani)
const TAB_CATALOG = [
  { key: 'ov', label: '📊 Panoramica' },
  { key: 'scontrini', label: '🧾 Scontrini' },
  { key: 'cat', label: '🏷️ Categorie' },
  { key: 'iva', label: '📋 IVA' },
  { key: 'rep', label: '🏪 Reparti' },
  { key: 'susp', label: '⚠️ Movimenti' },
  { key: 'fat', label: '📄 Fatture' },
  { key: 'mag', label: '🏠 Magazzino' },
  { key: 'prod', label: '⏱️ Produttività' },
  { key: 'ce', label: '📊 Conto Econ.' },
  { key: 'hr', label: '👥 Personale' },
  { key: 'mkt', label: '🎯 Marketing' },
  { key: 'bud', label: '💰 Budget' },
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
    { key: 'mag.ricette', label: 'Ricette' },
    { key: 'mag.giacenze', label: 'Giacenze' },
    { key: 'mag.inventario', label: 'Inventario' },
    { key: 'mag.ordini', label: 'Ordini' },
    { key: 'mag.prezzi', label: 'Prezzi' },
    { key: 'mag.matrice_eisenhower', label: 'Matrice Eisenhower (advanced)' },
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

function UsersList({ onEditUser }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { users } = await adminCall('list-users')
      setUsers(users)
    } catch (e) { alert(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()))

  return <Card title={`Utenti (${users.length})`} extra={
    <input placeholder="🔍 Cerca email..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...iS, width: 220 }} />
  }>
    {loading && <div style={{ padding: 20, color: '#64748b' }}>Caricamento…</div>}
    {!loading && (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Email', 'Piano', 'Stato', 'Valido fino', 'Ultimo login', 'Admin', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id}>
              <td style={{ ...S.td, fontWeight: 500 }}>{u.email}</td>
              <td style={S.td}>
                {u.plan ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>{u.plan.plan_id}</span>
                        : <span style={{ color: '#64748b', fontSize: 11 }}>nessuno</span>}
              </td>
              <td style={S.td}>
                {u.plan?.active === false ? <span style={S.badge('#EF4444', 'rgba(239,68,68,.12)')}>SOSP.</span>
                  : u.plan?.trial_until ? <span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>TRIAL</span>
                  : u.plan ? <span style={{ color: '#10B981' }}>● Attivo</span> : '—'}
              </td>
              <td style={{ ...S.td, fontSize: 12 }}>{u.plan?.valid_until || '—'}</td>
              <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('it-IT') : '—'}</td>
              <td style={S.td}>{u.admin_role ? <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.15)')}>{u.admin_role}</span> : ''}</td>
              <td style={S.td}>
                <button onClick={() => onEditUser(u)} style={{ ...iS, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>Modifica</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
}

function EditUser({ user, plans, onClose, onSaved }) {
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
      onSaved()
      onClose()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 700, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ padding: 20, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Modifica utente · {user.email}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Piano</div>
            <select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...iS, width: '100%' }}>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
          </label>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Stato</div>
            <select value={active ? 'on' : 'off'} onChange={e => setActive(e.target.value === 'on')} style={{ ...iS, width: '100%' }}>
              <option value="on">Attivo</option>
              <option value="off">Sospeso</option>
            </select>
          </label>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Trial fino</div>
            <input type="date" value={trialUntil} onChange={e => setTrialUntil(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Valido fino</div>
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
        </div>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Note interne</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...iS, width: '100%', resize: 'vertical' }} />
        </label>

        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>🟢 Extra: tab inclusi oltre al piano</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TAB_CATALOG.map(t => (
              <label key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8', background: extraTabs.includes(t.key) ? 'rgba(16,185,129,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={extraTabs.includes(t.key)} onChange={() => toggle(extraTabs, setExtraTabs, t.key)} />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>🔴 Esclusi: tab tolti dal piano</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TAB_CATALOG.map(t => (
              <label key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8', background: excludeTabs.includes(t.key) ? 'rgba(239,68,68,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={excludeTabs.includes(t.key)} onChange={() => toggle(excludeTabs, setExcludeTabs, t.key)} />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16, borderTop: '1px solid #2a3042' }}>
          <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
          <button onClick={save} disabled={saving} style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Salvo…' : '💾 Salva'}
          </button>
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
      <button onClick={newPlan} style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: 'pointer' }}>+ Nuovo piano</button>
    }>
      {loading && <div style={{ padding: 20, color: '#64748b' }}>Caricamento…</div>}
      {!loading && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['ID', 'Nome', 'Prezzo/mese', 'Prezzo/anno', 'Tab', 'Widget', 'Default', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {plans.map(p => {
              const tabs = p.features?.tabs?.length || 0
              const wAll = (p.features?.widgets || []).includes('*')
              return <tr key={p.id}>
                <td style={{ ...S.td, fontFamily: 'monospace', color: '#94a3b8' }}>{p.id}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{p.name}</td>
                <td style={S.td}>{p.price_monthly != null ? '€ ' + p.price_monthly : '—'}</td>
                <td style={S.td}>{p.price_yearly != null ? '€ ' + p.price_yearly : '—'}</td>
                <td style={S.td}>{tabs}</td>
                <td style={S.td}>{wAll ? 'tutti (*)' : (p.features?.widgets?.length || 0)}</td>
                <td style={S.td}>{p.is_default ? '⭐' : ''}</td>
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

  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ padding: 20, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{plan.id ? 'Modifica' : 'Nuovo'} piano</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 16 }}>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>ID (immutabile)</div>
            <input value={id} onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} disabled={!!plan.id} style={{ ...iS, width: '100%', fontFamily: 'monospace' }} placeholder="es. starter" />
          </label>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Nome visualizzato</div>
            <input value={name} onChange={e => setName(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
        </div>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Descrizione</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...iS, width: '100%', resize: 'vertical' }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Prezzo mensile (€)</div>
            <input type="number" value={priceMonthly} onChange={e => setPriceMonthly(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Prezzo annuo (€)</div>
            <input type="number" value={priceYearly} onChange={e => setPriceYearly(e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-end', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            Default per nuovi utenti
          </label>
        </div>

        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>📑 Tab inclusi</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TAB_CATALOG.map(t => (
              <label key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#cbd5e1', background: tabs.includes(t.key) ? 'rgba(16,185,129,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={tabs.includes(t.key)} onChange={() => toggle(tabs, setTabs, t.key)} />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>🧩 Widget inclusi</span>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={allWidgets} onChange={e => setAllWidgets(e.target.checked)} />
              Tutti i widget (*)
            </label>
          </div>
          {!allWidgets && (
            <div>
              {Object.entries(WIDGET_CATALOG).map(([tabKey, ws]) => (
                <details key={tabKey} style={{ marginBottom: 6, background: '#0a0e16', borderRadius: 6, padding: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>
                    {TAB_CATALOG.find(t => t.key === tabKey)?.label || tabKey} ({ws.filter(w => widgets.includes(w.key)).length}/{ws.length})
                  </summary>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {ws.map(w => (
                      <label key={w.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8', background: widgets.includes(w.key) ? 'rgba(16,185,129,.15)' : '#1a1f2e', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 16, borderTop: '1px solid #2a3042' }}>
          {plan.id ? <button onClick={del} disabled={saving} style={{ ...iS, color: '#EF4444', cursor: 'pointer', padding: '8px 14px' }}>🗑 Elimina</button> : <span/>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
            <button onClick={save} disabled={saving} style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Salvo…' : '💾 Salva piano'}
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

  if (loading) return <div style={{ minHeight: '100vh', background: '#0f1420', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Verifico permessi…</div>
  if (!isAdmin) return <div style={{ minHeight: '100vh', background: '#0f1420', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#EF4444' }}>
    <div style={{ fontSize: 48 }}>🔒</div>
    <div>Accesso negato. Solo gli admin possono entrare qui.</div>
    <a href="/" style={{ color: '#F59E0B' }}>Torna alla dashboard</a>
  </div>

  const tS = (t) => ({
    padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
    background: tab === t ? '#F59E0B' : 'transparent', color: tab === t ? '#0f1420' : '#64748b',
  })

  return <div style={{ minHeight: '100vh', background: '#0f1420', color: '#e2e8f0', fontFamily: "'DM Sans',system-ui,sans-serif" }}>
    <div style={{ background: '#131825', borderBottom: '1px solid #1e2636', padding: '0 1.5rem', height: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>⚙️ Admin · CIC SaaS</span>
      <a href="/" style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>← Torna alla dashboard</a>
      <button onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')} style={{ ...iS, color: '#475569', border: '1px solid #2a3042', padding: '6px 12px', cursor: 'pointer' }}>Esci</button>
    </div>
    <div style={{ background: '#131825', borderBottom: '1px solid #1e2636', padding: '0 1.5rem', display: 'flex', gap: 4 }}>
      <button onClick={() => setTab('users')} style={tS('users')}>👥 Utenti</button>
      <button onClick={() => setTab('plans')} style={tS('plans')}>🎁 Piani</button>
    </div>
    <div style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      {tab === 'users' && <UsersList onEditUser={u => setEditingUser(u)} />}
      {tab === 'plans' && <PlansList />}
    </div>
    {editingUser && plans.length > 0 && (
      <EditUser user={editingUser} plans={plans} onClose={() => setEditingUser(null)} onSaved={() => setReloadKey(k => k + 1)} />
    )}
  </div>
}
