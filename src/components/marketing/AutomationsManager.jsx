// Automations: lista + editor visuale (canvas semplice) con palette nodi.
// Editor: lista verticale di nodi con connettori; non drag&drop pixel-perfect ma chiaro e funzionale.

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

const TRIGGERS = [
  { key: 'nuova_prenotazione',         label: 'Nuova prenotazione' },
  { key: 'cambio_stato_prenotazione',  label: 'Cambio stato prenotazione' },
  { key: 'conto_ricevuto',             label: 'Conto ricevuto' },
  { key: 'applicazione_tag',           label: 'Applicazione tag' },
  { key: 'compleanno',                 label: 'Compleanno' },
  { key: 'iscrizione_fidelity',        label: 'Iscrizione fidelity' },
  { key: 'nuovo_ordine',               label: 'Nuovo ordine' },
  { key: 'cambio_stato_ordine',        label: 'Cambio stato ordine' },
  { key: 'compilazione_sondaggio',     label: 'Compilazione sondaggio' },
]

const NODES = [
  { tipo: 'invia_email',       label: 'Invia email',       icon: '✉️',  c: '#3B82F6' },
  { tipo: 'invia_whatsapp',    label: 'Invia WhatsApp',    icon: '💬',  c: '#25D366' },
  { tipo: 'invia_sms',         label: 'Invia SMS',         icon: '📱',  c: '#8B5CF6' },
  { tipo: 'modifica_tag',      label: 'Modifica tag',      icon: '🏷️',  c: '#F59E0B' },
  { tipo: 'punti_fidelity',    label: 'Punti fidelity',    icon: '⭐',  c: '#FFD700' },
  { tipo: 'invia_promozione',  label: 'Invia promozione',  icon: '🎟️',  c: '#EC4899' },
  { tipo: 'invito_recensione', label: 'Invito recensione', icon: '⭐',  c: '#10B981' },
  { tipo: 'invito_sondaggio',  label: 'Invito sondaggio',  icon: '📋',  c: '#06B6D4' },
  { tipo: 'invia_webhook',     label: 'Invia webhook',     icon: '🔌',  c: '#94A3B8' },
  { tipo: 'attesa',            label: 'Attesa',            icon: '⏱️',  c: '#F59E0B' },
  { tipo: 'condizione',        label: 'Condizione',        icon: '🔀',  c: '#8B5CF6' },
  { tipo: 'fine',              label: 'Fine',              icon: '🛑',  c: '#EF4444' },
]

function nodeMeta(tipo) { return NODES.find(n => n.tipo === tipo) || { label: tipo, c: '#94A3B8', icon: '•' } }

export default function AutomationsManager({ sp, sps }) {
  const localesAvail = useMemo(() => (sps && sps.length ? sps.map(s => s.name) : ['REMEMBEER', 'CASA DE AMICIS', 'BIANCOLATTE', 'LABORATORIO']), [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_aut_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_aut_locale', locale) }, [locale])

  const [list, setList] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(null)       // { automation, nodes }
  const [showNew, setShowNew] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [a, t] = await Promise.all([
        api('/api/automations', { action: 'list', locale }),
        api('/api/automations', { action: 'list-templates' }),
      ])
      setList(a.automations || [])
      setTemplates(t.templates || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  const openEditor = async (id) => {
    try {
      const r = await api('/api/automations', { action: 'get', id })
      setEditing({ automation: r.automation, nodes: r.nodes })
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const toggleAttivo = async (a) => {
    try {
      await api('/api/automations', { action: 'update-meta', id: a.id, attivo: !a.attivo })
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async (a) => {
    if (!confirm(`Eliminare "${a.nome}"?`)) return
    try {
      await api('/api/automations', { action: 'delete', id: a.id })
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const createNew = async (data) => {
    try {
      const r = await api('/api/automations', { action: 'create', automation: { ...data, locale } })
      setShowNew(false)
      openEditor(r.automation.id)
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const createFromTemplate = async (key) => {
    try {
      const r = await api('/api/automations', { action: 'create-from-template', locale, template_key: key })
      setShowTemplates(false)
      openEditor(r.automation.id)
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── UI ──────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Automazioni</h2>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>· workflow trigger-based</span>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={() => setShowTemplates(true)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Template</button>
      <button onClick={() => setShowNew(true)} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuova automazione</button>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {!loading && list.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: '#64748b', fontSize: 13 }}>
        Nessuna automazione. Crea una nuova o parti da un template ("Benvenuto", "Ci manchi 30gg", "Auguri compleanno", ecc.).
      </div>
    )}

    {!loading && list.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(a => {
          const trg = TRIGGERS.find(t => t.key === a.trigger_event)
          return <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#0f1420', border: '1px solid ' + (a.attivo ? '#10B98155' : '#2a3042'), borderRadius: 8 }}>
            <button onClick={() => toggleAttivo(a)} style={{
              width: 36, height: 20, padding: 0, borderRadius: 999,
              background: a.attivo ? '#10B981' : '#2a3042',
              border: 'none', cursor: 'pointer', position: 'relative',
            }}>
              <span style={{ position: 'absolute', top: 2, left: a.attivo ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
            </button>
            <div onClick={() => openEditor(a.id)} style={{ flex: 1, cursor: 'pointer' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{a.nome}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Trigger: {trg?.label || a.trigger_event} · Esecuzioni: {a.esecuzioni_totali}
                {a.template_key && <span style={{ marginLeft: 8, color: '#F59E0B' }}>preset</span>}
              </div>
            </div>
            <button onClick={() => onDelete(a)} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>×</button>
          </div>
        })}
      </div>
    )}

    {/* Modal new automation */}
    {showNew && <NewAutomationModal onClose={() => setShowNew(false)} onCreate={createNew} />}

    {/* Modal templates */}
    {showTemplates && <Modal onClose={() => setShowTemplates(false)} title="Template precostruiti">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.map(t => (
          <div key={t.key} onClick={() => createFromTemplate(t.key)} style={{
            padding: 14, background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, cursor: 'pointer'
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t.nome}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{t.descrizione}</div>
          </div>
        ))}
      </div>
    </Modal>}

    {/* Editor */}
    {editing && <AutomationEditor data={editing} onClose={() => { setEditing(null); reload() }} />}
  </div>
}

// ─── Nuova automazione (form base) ───────────────────────────────────
function NewAutomationModal({ onClose, onCreate }) {
  const [nome, setNome] = useState('')
  const [trigger, setTrigger] = useState('cambio_stato_prenotazione')
  return <Modal onClose={onClose} title="Nuova automazione">
    <Field label="Nome"><input value={nome} onChange={e => setNome(e.target.value)} placeholder="Es. Promemoria 60gg dormienti" style={{ ...S.input, width: '100%' }} /></Field>
    <div style={{ marginTop: 10 }}>
      <Field label="Trigger event"><select value={trigger} onChange={e => setTrigger(e.target.value)} style={{ ...S.input, width: '100%' }}>
        {TRIGGERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select></Field>
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
      <button onClick={onClose} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
      <button onClick={() => nome.trim() && onCreate({ nome: nome.trim(), trigger_event: trigger })} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Crea</button>
    </div>
  </Modal>
}

// ─── Editor automazione: vista verticale del grafo + palette ─────────
function AutomationEditor({ data, onClose }) {
  const [aut, setAut] = useState(data.automation)
  const [nodes, setNodes] = useState(data.nodes)
  const [editingNode, setEditingNode] = useState(null)

  const reload = async () => {
    const r = await api('/api/automations', { action: 'get', id: aut.id })
    setAut(r.automation); setNodes(r.nodes)
  }

  // Trova trigger e ricostruisci la sequenza lineare main (next[0]) per visualizzazione semplice
  const trigger = nodes.find(n => n.tipo === 'trigger')

  const linearChain = useMemo(() => {
    if (!trigger) return []
    const visited = new Set()
    const out = []
    let cur = trigger
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id)
      out.push(cur)
      const nextId = (cur.next_node_ids || [])[0]
      cur = nextId ? nodes.find(n => n.id === nextId) : null
    }
    return out
  }, [trigger, nodes])

  const orphans = nodes.filter(n => n.tipo !== 'trigger' && !linearChain.find(c => c.id === n.id))

  const addNode = async (tipo) => {
    if (!trigger) return
    // trova ultimo nodo della catena (escluso 'fine' se presente)
    const last = linearChain[linearChain.length - 1]
    const newY = (last?.pos_y || 50) + 130
    const r = await api('/api/automations', { action: 'node-upsert', node: {
      automation_id: aut.id, tipo, pos_x: 200, pos_y: newY, config: defaultConfig(tipo),
    }})
    // collega last → new
    if (last) {
      const newNext = [...(last.next_node_ids || []).filter(x => x !== r.node.id), r.node.id]
      await api('/api/automations', { action: 'node-upsert', node: { ...last, id: last.id, next_node_ids: newNext } })
    }
    reload()
  }

  const updateNode = async (n, patch) => {
    await api('/api/automations', { action: 'node-upsert', node: { ...n, ...patch } })
    reload()
  }

  const deleteNode = async (n) => {
    if (n.tipo === 'trigger') return alert('Il nodo trigger non si elimina')
    if (!confirm(`Eliminare il nodo "${nodeMeta(n.tipo).label}"?`)) return
    await api('/api/automations', { action: 'node-delete', id: n.id, automation_id: aut.id })
    reload()
  }

  const updateMeta = async (patch) => {
    const r = await api('/api/automations', { action: 'update-meta', id: aut.id, ...patch })
    setAut(r.automation)
  }

  return <Drawer onClose={onClose} wide>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <button onClick={onClose} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>← Torna</button>
      <input value={aut.nome} onBlur={e => e.target.value !== aut.nome && updateMeta({ nome: e.target.value })}
        onChange={e => setAut({ ...aut, nome: e.target.value })}
        style={{ ...S.input, flex: 1, fontSize: 16, fontWeight: 600 }} />
      <button onClick={() => updateMeta({ attivo: !aut.attivo })} style={btn(aut.attivo ? '#10B981' : '#1a1f2e', aut.attivo ? '#0f1420' : '#cbd5e1', aut.attivo ? '#10B981' : '#2a3042')}>
        {aut.attivo ? '✓ Attiva' : 'Disattiva'}
      </button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14 }}>
      {/* Palette */}
      <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>Aggiungi nodo</div>
        {NODES.map(n => (
          <button key={n.tipo} onClick={() => addNode(n.tipo)} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
            background: '#1a1f2e', border: '1px solid #2a3042', borderRadius: 6, cursor: 'pointer',
            fontSize: 12, color: '#cbd5e1', marginBottom: 4, textAlign: 'left',
          }}>
            <span style={{ fontSize: 14 }}>{n.icon}</span>
            <span style={{ flex: 1 }}>{n.label}</span>
          </button>
        ))}
      </div>

      {/* Canvas (vista lineare) */}
      <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 8, padding: 16, minHeight: 400 }}>
        {linearChain.map((n, i) => (
          <div key={n.id}>
            <NodeCard node={n} aut={aut} onClick={() => n.tipo !== 'trigger' && setEditingNode(n)}
              onEditTrigger={() => setEditingNode(n)} onDelete={() => deleteNode(n)} />
            {i < linearChain.length - 1 && <Connector />}
          </div>
        ))}
        {orphans.length > 0 && <>
          <div style={{ marginTop: 20, padding: 8, background: '#1a1f2e', borderRadius: 6, fontSize: 11, color: '#94a3b8' }}>
            Nodi scollegati: {orphans.length}
          </div>
          {orphans.map(n => <NodeCard key={n.id} node={n} aut={aut} onClick={() => setEditingNode(n)} onDelete={() => deleteNode(n)} />)}
        </>}
      </div>
    </div>

    {/* Modal edit nodo */}
    {editingNode && <NodeEditor node={editingNode} aut={aut}
      onSave={async (patch) => { await updateNode(editingNode, patch); setEditingNode(null) }}
      onClose={() => setEditingNode(null)} />}
  </Drawer>
}

function NodeCard({ node, aut, onClick, onEditTrigger, onDelete }) {
  const m = nodeMeta(node.tipo)
  const isTrigger = node.tipo === 'trigger'
  return <div onClick={onClick} style={{
    background: '#1a1f2e', border: '1px solid ' + (isTrigger ? '#F59E0B' : '#2a3042'),
    borderRadius: 10, padding: 12, cursor: onClick ? 'pointer' : 'default',
    display: 'flex', alignItems: 'center', gap: 12,
  }}>
    <span style={{ fontSize: 20, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.c + '22', borderRadius: 8 }}>{m.icon}</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{isTrigger ? `Trigger: ${TRIGGERS.find(t => t.key === aut.trigger_event)?.label || aut.trigger_event}` : m.label}</div>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{nodeSummary(node)}</div>
    </div>
    {!isTrigger && onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>×</button>}
  </div>
}

function Connector() {
  return <div style={{ width: 2, height: 24, background: '#2a3042', margin: '0 auto' }} />
}

function nodeSummary(n) {
  const c = n.config || {}
  switch (n.tipo) {
    case 'attesa':         return `Attendi ${c.value || 0} ${c.unit || 'min'}`
    case 'invia_email':    return c.oggetto ? `"${c.oggetto.slice(0, 50)}"` : 'Email'
    case 'invia_whatsapp': return c.contenuto ? `"${c.contenuto.slice(0, 60)}"` : 'WhatsApp'
    case 'invia_sms':      return c.contenuto ? `"${c.contenuto.slice(0, 60)}"` : 'SMS'
    case 'modifica_tag':   return `${c.action || 'add'} tag${c.tag_nome ? ` "${c.tag_nome}"` : ''}`
    case 'punti_fidelity': return c.punti_per_euro ? `${c.punti_per_euro} pt per €` : `+${c.punti_fissi || 0} punti`
    case 'condizione':     return c.field ? `${c.field} ${c.op || '=='} ${c.value}` : 'Condizione'
    case 'fine':           return 'Termina automazione'
    default:               return ''
  }
}

function defaultConfig(tipo) {
  switch (tipo) {
    case 'attesa':         return { unit: 'hour', value: 1 }
    case 'invia_email':    return { oggetto: '', contenuto: 'Ciao {nome},\n\n' }
    case 'invia_whatsapp': return { contenuto: 'Ciao {nome}!' }
    case 'invia_sms':      return { contenuto: 'Ciao {nome}!' }
    case 'modifica_tag':   return { action: 'add', tag_nome: '' }
    case 'punti_fidelity': return { punti_per_euro: 1 }
    case 'condizione':     return { field: 'pax', op: '>=', value: 4 }
    case 'invia_webhook':  return { url: '', method: 'POST' }
    default: return {}
  }
}

// ─── Editor singolo nodo ──────────────────────────────────────────────
function NodeEditor({ node, aut, onSave, onClose }) {
  const [config, setConfig] = useState(node.config || {})

  const m = nodeMeta(node.tipo)
  const isTrigger = node.tipo === 'trigger'

  return <Modal onClose={onClose} title={isTrigger ? 'Trigger' : m.label}>
    {isTrigger ? <TriggerEditor aut={aut} onSave={async (patch) => {
      await api('/api/automations', { action: 'update-meta', id: aut.id, ...patch })
      onClose()
    }} /> : (
      <>
        {node.tipo === 'attesa' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Valore"><input type="number" value={config.value || 0} onChange={e => setConfig({ ...config, value: Number(e.target.value || 0) })} style={S.input} /></Field>
          <Field label="Unità"><select value={config.unit || 'hour'} onChange={e => setConfig({ ...config, unit: e.target.value })} style={S.input}>
            <option value="min">minuti</option>
            <option value="hour">ore</option>
            <option value="day">giorni</option>
          </select></Field>
        </div>}

        {node.tipo === 'invia_email' && <>
          <Field label="Oggetto"><input value={config.oggetto || ''} onChange={e => setConfig({ ...config, oggetto: e.target.value })} style={{ ...S.input, width: '100%' }} /></Field>
          <div style={{ marginTop: 10 }}>
            <Field label="Contenuto · {nome} {cognome} {locale}">
              <textarea value={config.contenuto || ''} onChange={e => setConfig({ ...config, contenuto: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 130, fontFamily: 'inherit' }} />
            </Field>
          </div>
        </>}

        {(node.tipo === 'invia_whatsapp' || node.tipo === 'invia_sms') && <Field label="Contenuto · {nome} {cognome} {locale}">
          <textarea value={config.contenuto || ''} onChange={e => setConfig({ ...config, contenuto: e.target.value })} style={{ ...S.input, width: '100%', minHeight: 110, fontFamily: 'inherit' }} />
        </Field>}

        {node.tipo === 'modifica_tag' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <Field label="Azione"><select value={config.action || 'add'} onChange={e => setConfig({ ...config, action: e.target.value })} style={S.input}>
            <option value="add">Aggiungi</option>
            <option value="remove">Rimuovi</option>
          </select></Field>
          <Field label="Nome tag (deve esistere)"><input value={config.tag_nome || ''} onChange={e => setConfig({ ...config, tag_nome: e.target.value })} placeholder="VIP" style={S.input} /></Field>
        </div>}

        {node.tipo === 'punti_fidelity' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Punti fissi (opz)"><input type="number" value={config.punti_fissi || 0} onChange={e => setConfig({ ...config, punti_fissi: Number(e.target.value || 0) })} style={S.input} /></Field>
          <Field label="Punti per €1 (opz)"><input type="number" step="0.01" value={config.punti_per_euro || 0} onChange={e => setConfig({ ...config, punti_per_euro: Number(e.target.value || 0) })} style={S.input} /></Field>
        </div>}

        {node.tipo === 'condizione' && <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Field label="Campo payload"><input value={config.field || ''} onChange={e => setConfig({ ...config, field: e.target.value })} placeholder="pax | importo | stato_to" style={S.input} /></Field>
            <Field label="Operatore"><select value={config.op || '=='} onChange={e => setConfig({ ...config, op: e.target.value })} style={S.input}>
              <option value="==">=</option>
              <option value="!=">≠</option>
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value=">=">≥</option>
              <option value="<=">≤</option>
            </select></Field>
            <Field label="Valore"><input value={config.value || ''} onChange={e => setConfig({ ...config, value: e.target.value })} style={S.input} /></Field>
          </div>
        </>}

        {node.tipo === 'invia_webhook' && <>
          <Field label="URL"><input value={config.url || ''} onChange={e => setConfig({ ...config, url: e.target.value })} placeholder="https://..." style={{ ...S.input, width: '100%' }} /></Field>
          <div style={{ marginTop: 10 }}>
            <Field label="Method"><select value={config.method || 'POST'} onChange={e => setConfig({ ...config, method: e.target.value })} style={S.input}>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
              <option value="PUT">PUT</option>
            </select></Field>
          </div>
        </>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
          <button onClick={() => onSave({ config })} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
        </div>
      </>
    )}
  </Modal>
}

function TriggerEditor({ aut, onSave }) {
  const [evt, setEvt] = useState(aut.trigger_event)
  const [filters, setFilters] = useState(aut.trigger_filters || {})
  return <>
    <Field label="Trigger event"><select value={evt} onChange={e => setEvt(e.target.value)} style={{ ...S.input, width: '100%' }}>
      {TRIGGERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select></Field>

    {evt === 'cambio_stato_prenotazione' && <div style={{ marginTop: 10 }}>
      <Field label="Filtra per stato finale (opz)">
        <select value={filters.stato_to || ''} onChange={e => setFilters({ ...filters, stato_to: e.target.value || undefined })} style={{ ...S.input, width: '100%' }}>
          <option value="">Qualsiasi</option>
          <option value="confirmed">Confermata</option>
          <option value="seated">A tavolo</option>
          <option value="completed">Completata</option>
          <option value="no_show">No-show</option>
          <option value="cancelled">Cancellata</option>
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
        <input type="checkbox" checked={!!filters.solo_prima_visita} onChange={e => setFilters({ ...filters, solo_prima_visita: e.target.checked || undefined })} />
        Solo alla prima visita del cliente
      </label>
    </div>}

    <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
      <button onClick={() => onSave({ trigger_event: evt, trigger_filters: filters })} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
    </div>
  </>
}

// ─── helpers ─────────────────────────────────────────────────────────
function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}
function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}
function Modal({ children, onClose, title }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 95%)', maxHeight: '85vh', overflowY: 'auto', background: '#1a1f2e', padding: 20, borderRadius: 12, border: '1px solid #2a3042' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>{title}</h3>
        <button onClick={onClose} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>✕</button>
      </div>
      {children}
    </div>
  </div>
}
function Drawer({ children, onClose, wide = false }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: wide ? 'min(900px, 100%)' : 'min(620px, 100%)', height: '100%', background: '#1a1f2e', padding: 20, overflowY: 'auto', borderLeft: '1px solid #2a3042' }}>
      {children}
    </div>
  </div>
}
