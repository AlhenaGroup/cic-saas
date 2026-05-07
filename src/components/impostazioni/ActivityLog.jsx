// Impostazioni → Attività
// L'imprenditore vede chi ha fatto cosa nei moduli a cui ha dato accesso allo staff.
//
// Sorgente: tabella audit_log (popolata da trigger DB su tutte le tabelle multi-tenant).
// RLS: solo owner legge il proprio log.

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const iS = S.input

// Mapping table_name → modulo umano (per UI). Coerente con permissions.js
const TABLE_TO_MODULE = {
  recipes:                       'Magazzino → Ricette',
  manual_articles:               'Magazzino → Semilavorati',
  warehouse_invoices:            'Contabilità / Magazzino → Fatture',
  warehouse_invoice_items:       'Contabilità / Magazzino → Fatture',
  warehouse_products:            'Magazzino → Prodotti',
  warehouse_locations:           'Magazzino → Prodotti',
  warehouse_stock:               'Magazzino → Giacenze',
  warehouse_movements:           'Magazzino → Movimenti',
  warehouse_inventories:         'Magazzino → Inventario',
  warehouse_inventory_items:     'Magazzino → Inventario',
  warehouse_orders:              'Magazzino → Ordini',
  warehouse_order_items:         'Magazzino → Ordini',
  warehouse_recipes:             'Magazzino → Ricette',
  warehouse_recipe_items:        'Magazzino → Ricette',
  warehouse_prices:              'Magazzino → Prezzi',
  warehouse_aliases:             'Magazzino → Prodotti',
  production_recipes:            'Magazzino → Produzione',
  production_batches:            'Magazzino → Produzione',
  article_allergens:             'Magazzino → Articoli',
  item_rules:                    'Magazzino → Fatture (regole)',
  attendance:                    'HR → Presenze',
  attendance_checklists:         'HR → Checklist',
  attendance_checklist_responses:'HR → Checklist',
  employees:                     'HR → Dipendenti',
  employee_documents:            'HR → Documenti',
  employee_pay_history:          'HR → Dipendenti (paga)',
  employee_shifts:               'HR → Turni',
  employee_time_off:             'HR → Calendario / Ferie',
  calendar_events:               'HR → Calendario',
  staff_schedules:               'HR → Turni',
  personnel_costs:               'HR → Turni (costi)',
  budget_periods:                'Contabilità → Budget',
  budget_scenarios:              'Contabilità → Budget',
  budget_rows:                   'Contabilità → Budget',
  manual_costs:                  'Contabilità → Conto Economico',
  tag_definitions:               'Marketing → Clienti (tag)',
  customers:                     'Marketing → Clienti',
  customer_tags:                 'Marketing → Clienti',
  promotions:                    'Marketing → Promozioni',
  promotion_redemptions:         'Marketing → Promozioni',
  fidelity_programs:             'Marketing → Fidelity',
  fidelity_rewards:              'Marketing → Fidelity',
  fidelity_movements:            'Marketing → Fidelity',
  daily_report_settings:         'Impostazioni → Notifiche',
  alert_rules:                   'Avvisi → Configurazione',
  user_settings:                 'Impostazioni → Generale',
}
function tableLabel(t) { return TABLE_TO_MODULE[t] || t }

const ACTION_META = {
  INSERT: { label: 'Creato',    color: '#10B981', icon: '＋' },
  UPDATE: { label: 'Modificato', color: '#3B82F6', icon: '✎' },
  DELETE: { label: 'Eliminato', color: '#EF4444', icon: '×' },
}

function formatTs(ts) {
  const d = new Date(ts)
  const today = new Date(); today.setHours(0,0,0,0)
  const dDay = new Date(d); dDay.setHours(0,0,0,0)
  const diff = (today - dDay) / 86400000
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (diff === 0) return 'Oggi ' + hm
  if (diff === 1) return 'Ieri ' + hm
  if (diff < 7) return d.toLocaleDateString('it-IT', { weekday: 'long' }) + ' ' + hm
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + hm
}

// Estrae un nome leggibile del record (per la timeline) — euristiche per le tabelle comuni
function recordTitle(row, tableName) {
  const c = row.changed || {}
  // Per UPDATE c è { campo: [old, new] }; per INSERT/DELETE c è la row
  const get = (key) => {
    const v = c[key]
    if (Array.isArray(v)) return v[1] ?? v[0]
    return v
  }
  const candidates = ['nome_prodotto','nome_articolo','nome','docId','docId','docNumber','numero','titolo','title','codice','email']
  for (const k of candidates) {
    const v = get(k)
    if (v) return String(v)
  }
  // Fallback su record_id
  return row.record_id ? '#' + String(row.record_id).slice(0, 8) : ''
}

// Compatta diff per anteprima inline (per UPDATE)
function diffSummary(changed) {
  if (!changed || typeof changed !== 'object') return null
  const fields = Object.keys(changed)
  if (fields.length === 0) return null
  // Mostra primi 2 campi modificati
  const first = fields.slice(0, 2).map(f => {
    const [oldV, newV] = changed[f] || []
    return `${f}: ${formatVal(oldV)} → ${formatVal(newV)}`
  }).join(' · ')
  if (fields.length > 2) return first + ` (+${fields.length - 2} altri)`
  return first
}

function formatVal(v) {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Sì' : 'No'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40) + (JSON.stringify(v).length > 40 ? '…' : '')
  const s = String(v)
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

function dateAddDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

export default function ActivityLog() {
  const [rows, setRows] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Filtri
  const [filterEmp, setFilterEmp] = useState('all')
  const [filterAction, setFilterAction] = useState('all')
  const [filterModule, setFilterModule] = useState('all')
  const [filterDays, setFilterDays] = useState('30')

  const [detail, setDetail] = useState(null) // riga aperta in dettaglio

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const fromTs = filterDays === 'all' ? null : dateAddDays(new Date(), -Number(filterDays)).toISOString()
    let q = supabase.from('audit_log').select('*').order('ts', { ascending: false }).limit(500)
    if (fromTs) q = q.gte('ts', fromTs)
    if (filterEmp !== 'all') q = q.eq('actor_employee_id', filterEmp)
    if (filterAction !== 'all') q = q.eq('action', filterAction)
    const { data, error } = await q
    if (error) {
      setLoadError('Per attivare il log attività esegui la migration SQL supabase/audit-log.sql.')
      setRows([])
    } else {
      setRows(data || [])
    }
    // Carica anche employees per il filtro
    const empRes = await supabase.from('employees').select('id, nome').order('nome')
    setEmployees(empRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [filterEmp, filterAction, filterDays])

  // Filtro lato client per modulo (perché table_name → module è solo client-side)
  const visibleRows = useMemo(() => {
    if (filterModule === 'all') return rows
    return rows.filter(r => tableLabel(r.table_name).startsWith(filterModule))
  }, [rows, filterModule])

  // Modulo top-level distinti per il filtro
  const moduleOptions = useMemo(() => {
    const set = new Set()
    rows.forEach(r => {
      const lab = tableLabel(r.table_name)
      const top = lab.split('→')[0]?.trim()
      if (top && top !== r.table_name) set.add(top)
    })
    return Array.from(set).sort()
  }, [rows])

  return <Card title="Attività" badge={loading ? '…' : `${visibleRows.length} eventi`} extra={
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} style={{ ...iS, fontSize: 11, padding: '4px 8px' }}>
        <option value="all">Tutti i dipendenti</option>
        {employees.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
      </select>
      <select value={filterModule} onChange={e => setFilterModule(e.target.value)} style={{ ...iS, fontSize: 11, padding: '4px 8px' }}>
        <option value="all">Tutti i moduli</option>
        {moduleOptions.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={filterAction} onChange={e => setFilterAction(e.target.value)} style={{ ...iS, fontSize: 11, padding: '4px 8px' }}>
        <option value="all">Tutte le azioni</option>
        <option value="INSERT">Creazioni</option>
        <option value="UPDATE">Modifiche</option>
        <option value="DELETE">Eliminazioni</option>
      </select>
      <select value={filterDays} onChange={e => setFilterDays(e.target.value)} style={{ ...iS, fontSize: 11, padding: '4px 8px' }}>
        <option value="1">Oggi</option>
        <option value="7">7 giorni</option>
        <option value="30">30 giorni</option>
        <option value="90">90 giorni</option>
        <option value="all">Tutto</option>
      </select>
    </div>
  }>
    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.5 }}>
      Tracciamento di tutte le azioni di creazione, modifica ed eliminazione fatte dai dipendenti
      nei moduli a cui hanno accesso. Le tue azioni (owner) non vengono registrate.
      Click su una riga per il dettaglio dei campi cambiati.
    </div>

    {loadError && (
      <div style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', color: '#92400E', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12, lineHeight: 1.5 }}>
        ⚠ {loadError}
      </div>
    )}

    {loading ? (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>
    ) : visibleRows.length === 0 ? (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
        {loadError ? 'Migration non applicata.' : 'Nessuna attività con i filtri selezionati.'}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleRows.map(r => {
          const m = ACTION_META[r.action] || ACTION_META.UPDATE
          const title = recordTitle(r, r.table_name)
          const summary = r.action === 'UPDATE' ? diffSummary(r.changed) : null
          return <div key={r.id} onClick={() => setDetail(r)}
            style={{
              display: 'grid', gridTemplateColumns: '120px 28px 1fr', gap: 12, alignItems: 'center',
              padding: '10px 12px', cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--blue)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500 }}>{formatTs(r.ts)}</div>
            <div title={m.label} style={{
              width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: m.color + '22', color: m.color, fontWeight: 700, fontSize: 14,
            }}>{m.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{r.actor_name || '—'}</strong>
                <span style={{ color: 'var(--text3)' }}> · {m.label} </span>
                <span style={{ color: 'var(--text2)' }}>{tableLabel(r.table_name)}</span>
                {title && <span style={{ color: 'var(--text)' }}> · {title}</span>}
              </div>
              {summary && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {summary}
              </div>}
            </div>
          </div>
        })}
      </div>
    )}

    {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
  </Card>
}

function DetailModal({ row, onClose }) {
  const c = row.changed || {}
  const isUpdate = row.action === 'UPDATE'
  const fields = Object.keys(c)
  const m = ACTION_META[row.action] || ACTION_META.UPDATE

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 700 }}>
      <div style={{ padding: 18, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.color + '22', color: m.color, fontWeight: 700, fontSize: 14 }}>{m.icon}</div>
            <h3 style={{ margin: 0, fontSize: 15 }}>{m.label} · {tableLabel(row.table_name)}</h3>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            <strong>{row.actor_name || '—'}</strong> · {formatTs(row.ts)}
            {row.record_id && <span style={{ color: 'var(--text3)' }}> · ID {String(row.record_id).slice(0, 8)}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ padding: 18 }}>
        {fields.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            Nessun dettaglio disponibile.
          </div>
        ) : isUpdate ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              {fields.length} {fields.length === 1 ? 'campo modificato' : 'campi modificati'}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Campo', 'Prima', 'Dopo'].map(h => <th key={h} style={{ ...S.th, fontSize: 10, textAlign: 'left' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {fields.map(f => {
                  const [oldV, newV] = c[f] || []
                  return <tr key={f} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ ...S.td, fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>{f}</td>
                    <td style={{ ...S.td, fontSize: 11, color: '#EF4444', fontFamily: 'monospace', wordBreak: 'break-all' }}>{formatValRich(oldV)}</td>
                    <td style={{ ...S.td, fontSize: 11, color: '#10B981', fontFamily: 'monospace', wordBreak: 'break-all' }}>{formatValRich(newV)}</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              {row.action === 'INSERT' ? 'Dati creati' : 'Dati eliminati'}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {fields
                  .filter(f => !['id','user_id','created_at','updated_at'].includes(f))
                  .map(f => (
                    <tr key={f} style={{ borderBottom: '1px solid #1a1f2e' }}>
                      <td style={{ ...S.td, fontWeight: 600, fontSize: 12, width: '30%' }}>{f}</td>
                      <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--text2)' }}>{formatValRich(c[f])}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  </div>
}

function formatValRich(v) {
  if (v == null) return <span style={{ color: 'var(--text3)' }}>—</span>
  if (typeof v === 'boolean') return v ? 'Sì' : 'No'
  if (typeof v === 'object') {
    return <span title={JSON.stringify(v, null, 2)}>{JSON.stringify(v).slice(0, 80)}{JSON.stringify(v).length > 80 ? '…' : ''}</span>
  }
  return String(v)
}
