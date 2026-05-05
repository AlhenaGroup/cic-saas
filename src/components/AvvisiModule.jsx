// Modulo Avvisi (top-level)
// 2 sub-tab: Feed (eventi recenti) + Configurazione (regole on/off + threshold)
//
// Le regole sono codificate in ALERT_RULES qui sotto. Ognuna ha:
// - key univoca (es. 'magazzino.sotto_soglia')
// - categoria: vendite/magazzino/hr/produzione
// - label, descrizione, livello default
// - thresholds: campi configurabili (numero/giorni/percentuale)
//
// Gli eventi vengono generati da api/alert-cron (cron giornaliero) e/o
// da trigger inline in altri moduli (es. produzione resa anomala).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card } from './shared/styles.jsx'
import SubTabsBar from './SubTabsBar'

const iS = S.input

export const ALERT_RULES = [
  // ── VENDITE ──
  { key: 'vendite.giornaliero_anomalo', categoria: 'vendite', label: 'Ricavi giornalieri sotto media',
    descr: 'Notifica quando i ricavi del giorno sono sotto la media settimanale di una percentuale configurabile.',
    livello: 'warning',
    thresholds: [{ key: 'percentuale', label: 'Soglia (%)', default: 20, suffix: '% sotto media' }],
  },
  { key: 'vendite.scontrino_medio_basso', categoria: 'vendite', label: 'Scontrino medio anomalo',
    descr: 'Avviso quando lo scontrino medio del giorno è significativamente diverso dalla media periodo.',
    livello: 'info',
    thresholds: [{ key: 'percentuale', label: 'Variazione (%)', default: 15, suffix: '% di scarto' }],
  },
  { key: 'vendite.no_vendite_dopo', categoria: 'vendite', label: 'Nessuna vendita dopo le X',
    descr: 'Alert se non ci sono scontrini per più di N minuti dopo un orario di solito attivo.',
    livello: 'critical',
    thresholds: [{ key: 'minuti_inattivita', label: 'Minuti inattività', default: 60, suffix: 'min' }],
  },

  // ── MAGAZZINO ──
  { key: 'magazzino.sotto_soglia', categoria: 'magazzino', label: 'Articolo sotto scorta minima',
    descr: 'Notifica quando un articolo scende sotto la scorta minima impostata in StockView.',
    livello: 'warning',
    thresholds: [],
  },
  { key: 'magazzino.allerta_prezzi', categoria: 'magazzino', label: 'Aumento prezzo articolo',
    descr: 'Notifica quando il prezzo medio di un articolo aumenta oltre la soglia rispetto al precedente.',
    livello: 'warning',
    thresholds: [{ key: 'percentuale', label: 'Aumento min (%)', default: 10, suffix: '%' }],
  },
  { key: 'magazzino.scadenze_imminenti', categoria: 'magazzino', label: 'Lotti in scadenza',
    descr: 'Avviso per lotti production_batches con scadenza nelle prossime N ore.',
    livello: 'warning',
    thresholds: [{ key: 'ore', label: 'Anticipo (ore)', default: 24, suffix: 'h' }],
  },

  // ── HR ──
  { key: 'hr.no_timbratura_entrata', categoria: 'hr', label: 'Dipendente non ha timbrato entrata',
    descr: 'Alert se un dipendente con turno pianificato non ha timbrato entrata entro N minuti.',
    livello: 'warning',
    thresholds: [{ key: 'minuti_ritardo', label: 'Ritardo min (min)', default: 15, suffix: 'min' }],
  },
  { key: 'hr.documento_in_scadenza', categoria: 'hr', label: 'Documento dipendente in scadenza',
    descr: 'Notifica quando un employee_documents ha scadenza nei prossimi N giorni.',
    livello: 'info',
    thresholds: [{ key: 'giorni_anticipo', label: 'Anticipo (gg)', default: 30, suffix: 'gg' }],
  },
  { key: 'hr.sforamento_ore_contratto', categoria: 'hr', label: 'Ore lavorate oltre contratto',
    descr: 'Avviso quando un dipendente ha lavorato più ore di quelle previste dal contratto settimanale.',
    livello: 'warning',
    thresholds: [{ key: 'percentuale', label: 'Soglia oltre (%)', default: 10, suffix: '%' }],
  },

  // ── PRODUZIONE ──
  { key: 'produzione.resa_anomala', categoria: 'produzione', label: 'Resa lotto anomala',
    descr: 'Notifica quando la quantità prodotta di un lotto è troppo diversa dalla resa attesa della scheda.',
    livello: 'warning',
    thresholds: [{ key: 'percentuale', label: 'Scarto min (%)', default: 20, suffix: '% (±)' }],
  },
  { key: 'produzione.durata_anomala', categoria: 'produzione', label: 'Durata produzione troppo breve',
    descr: 'Alert quando la durata di un lotto è meno della metà della durata attesa della scheda.',
    livello: 'warning',
    thresholds: [{ key: 'percentuale_min', label: 'Soglia min (%)', default: 50, suffix: '% del previsto' }],
  },
  { key: 'produzione.doppia_stesso_turno', categoria: 'produzione', label: 'Stessa ricetta 2 volte stesso turno',
    descr: 'Avviso quando lo stesso dipendente registra 2+ lotti della stessa ricetta nello stesso giorno.',
    livello: 'info',
    thresholds: [],
  },
  { key: 'produzione.checklist_ko', categoria: 'produzione', label: 'Checklist HACCP con risposte KO',
    descr: 'Notifica per ogni lotto che ha almeno una risposta KO nella checklist HACCP.',
    livello: 'critical',
    thresholds: [],
  },
]

export const CATEGORIE = [
  { key: 'vendite',     label: 'Vendite',     color: '#3B82F6' },
  { key: 'magazzino',   label: 'Magazzino',   color: '#F59E0B' },
  { key: 'hr',          label: 'HR',          color: '#8B5CF6' },
  { key: 'produzione',  label: 'Produzione',  color: '#EF4444' },
]
const CAT_BY_KEY = Object.fromEntries(CATEGORIE.map(c => [c.key, c]))

const LIVELLI = {
  info:     { l: 'Info',     color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  warning:  { l: 'Warning',  color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  critical: { l: 'Critico',  color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
}

const SUB_TABS = [
  { key: 'feed',       label: 'Feed avvisi' },
  { key: 'config',     label: 'Configurazione regole' },
]

export default function AvvisiModule() {
  // NON persistito: rientro parte dal primo sub-tab (Feed)
  const [tab, setTab] = useState('feed')

  return <div>
    <SubTabsBar tabs={SUB_TABS} value={tab} onChange={setTab} />
    {tab === 'feed' && <FeedTab />}
    {tab === 'config' && <ConfigTab />}
  </div>
}

// ─── FEED ──────────────────────────────────────────────────────
function FeedTab() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [filterLetto, setFilterLetto] = useState('non_letti')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('alert_events').select('*').order('created_at', { ascending: false }).limit(200)
    const { data } = await q
    setEvents(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => events.filter(e => {
    if (filterCat && e.categoria !== filterCat) return false
    if (filterLetto === 'non_letti' && e.letto) return false
    if (filterLetto === 'letti' && !e.letto) return false
    return true
  }), [events, filterCat, filterLetto])

  const markRead = async (id) => {
    await supabase.from('alert_events').update({ letto: true, letto_at: new Date().toISOString() }).eq('id', id)
    setEvents(prev => prev.map(e => e.id === id ? { ...e, letto: true } : e))
  }

  const markAllRead = async () => {
    if (!confirm('Marcare tutti come letti?')) return
    const unread = events.filter(e => !e.letto).map(e => e.id)
    if (unread.length === 0) return
    await supabase.from('alert_events').update({ letto: true, letto_at: new Date().toISOString() }).in('id', unread)
    load()
  }

  const dismissAll = async () => {
    if (!confirm('Eliminare tutti gli avvisi visibili? Operazione irreversibile.')) return
    const ids = filtered.map(e => e.id)
    if (ids.length === 0) return
    await supabase.from('alert_events').delete().in('id', ids)
    load()
  }

  const unreadCount = events.filter(e => !e.letto).length

  return <Card title='Feed avvisi' badge={loading ? '...' : `${unreadCount} non letti su ${events.length}`} extra={
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={markAllRead} disabled={unreadCount === 0}
        style={{ ...iS, padding: '5px 10px', fontSize: 11, cursor: unreadCount ? 'pointer' : 'not-allowed', opacity: unreadCount ? 1 : 0.5 }}>
        Segna tutti come letti
      </button>
    </div>
  }>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={iS}>
        <option value=''>Tutte le categorie</option>
        {CATEGORIE.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <select value={filterLetto} onChange={e => setFilterLetto(e.target.value)} style={iS}>
        <option value='non_letti'>Solo non letti</option>
        <option value='letti'>Solo letti</option>
        <option value=''>Tutti</option>
      </select>
      <button onClick={load} style={{ ...iS, padding: '5px 12px', cursor: 'pointer' }}>Aggiorna</button>
    </div>

    {loading ? (
      <div style={{ padding: 30, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
    ) : filtered.length === 0 ? (
      <div style={{ padding: 40, color: '#64748b', textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
        {events.length === 0 ? <>
          Nessun avviso ancora generato.<br/>
          <span style={{ fontSize: 11 }}>Vai in <strong>Configurazione regole</strong> per attivare le regole che ti interessano. Gli avvisi compariranno qui quando il sistema le rileverà.</span>
        </> : 'Nessun avviso con i filtri correnti.'}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(e => {
          const cat = CAT_BY_KEY[e.categoria]
          const liv = LIVELLI[e.livello] || LIVELLI.info
          return <div key={e.id} style={{
            background: e.letto ? '#131825' : '#1a1f2e',
            border: `1px solid ${e.letto ? '#2a3042' : liv.color + '44'}`,
            borderLeft: `4px solid ${liv.color}`,
            borderRadius: 8, padding: 12,
            opacity: e.letto ? 0.6 : 1,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {cat && <span style={{ ...S.badge(cat.color, cat.color + '22'), fontSize: 10 }}>{cat.label}</span>}
                <span style={{ ...S.badge(liv.color, liv.bg), fontSize: 10 }}>{liv.l}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>{new Date(e.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                {!e.letto && <button onClick={() => markRead(e.id)} style={{ background: 'none', border: '1px solid #2a3042', color: '#94a3b8', padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Segna letto</button>}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{e.titolo}</div>
            {e.descrizione && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{e.descrizione}</div>}
            {e.link_url && (
              <a href={e.link_url} style={{ fontSize: 11, color: '#3B82F6', textDecoration: 'underline' }}>
                Vedi dettaglio 
              </a>
            )}
          </div>
        })}
      </div>
    )}

    {filtered.length > 0 && (
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #2a3042', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={dismissAll}
          style={{ ...iS, color: '#EF4444', padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
          Elimina tutti i {filtered.length} avvisi visibili
        </button>
      </div>
    )}
  </Card>
}

// ─── CONFIGURAZIONE ────────────────────────────────────────────
function ConfigTab() {
  const [rules, setRules] = useState({}) // alert_key row
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data } = await supabase.from('alert_rules').select('*').eq('user_id', user.id)
    const map = {}
    ;(data || []).forEach(r => { map[r.alert_key] = r })
    setRules(map)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const isEnabled = (key) => !!rules[key]?.enabled
  const getThreshold = (key, thKey, def) => {
    const v = rules[key]?.threshold?.[thKey]
    return v != null ? v : def
  }
  const isChannelEnabled = (key, channel) => {
    const ch = rules[key]?.channels
    if (!Array.isArray(ch) || ch.length === 0) return channel === 'dashboard'
    return ch.includes(channel)
  }

  const updateRule = async (alert_key, patch) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const existing = rules[alert_key] || {
      user_id: user.id, alert_key,
      enabled: false, threshold: {}, channels: ['dashboard'],
    }
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() }
    await supabase.from('alert_rules').upsert({ ...next, user_id: user.id }, { onConflict: 'user_id,alert_key' })
    setRules(prev => ({ ...prev, [alert_key]: next }))
  }

  const toggleEnabled = (key) => updateRule(key, { enabled: !isEnabled(key) })
  const setThreshold = (key, thKey, val) => {
    const cur = rules[key]?.threshold || {}
    updateRule(key, { threshold: { ...cur, [thKey]: val === '' ? null : Number(val) } })
  }
  const toggleChannel = (key, channel) => {
    let cur = rules[key]?.channels
    if (!Array.isArray(cur) || cur.length === 0) cur = ['dashboard']
    const next = cur.includes(channel) ? cur.filter(c => c !== channel) : [...cur, channel]
    updateRule(key, { channels: next })
  }

  const enableAllInCategory = async (cat) => {
    setSaving(true)
    const keys = ALERT_RULES.filter(r => r.categoria === cat).map(r => r.key)
    for (const k of keys) { await updateRule(k, { enabled: true }) }
    setSaving(false); setMsg('Tutte le regole di ' + cat + ' attivate'); setTimeout(() => setMsg(''), 2000)
  }
  const disableAllInCategory = async (cat) => {
    setSaving(true)
    const keys = ALERT_RULES.filter(r => r.categoria === cat).map(r => r.key)
    for (const k of keys) { await updateRule(k, { enabled: false }) }
    setSaving(false); setMsg('Tutte le regole di ' + cat + ' disattivate'); setTimeout(() => setMsg(''), 2000)
  }

  if (loading) return <div style={{ padding: 30, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>

  return <>
    <div style={{ marginBottom: 14, padding: 14, background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
      Attiva le regole di alert che ti interessano. Per ognuna puoi scegliere la <strong style={{ color: '#e2e8f0' }}>soglia</strong> e i <strong style={{ color: '#e2e8f0' }}>canali di notifica</strong> (Dashboard = compare nel feed, Email = aggiunto al resoconto giornaliero).
      Le regole disattivate non generano avvisi e non occupano spazio.
    </div>
    {msg && <div style={{ marginBottom: 10, padding: 8, background: 'rgba(16,185,129,.1)', borderRadius: 6, color: '#10B981', fontSize: 12 }}>{msg}</div>}

    {CATEGORIE.map(cat => {
      const rules4cat = ALERT_RULES.filter(r => r.categoria === cat.key)
      const activeCount = rules4cat.filter(r => isEnabled(r.key)).length
      return <Card key={cat.key} title={cat.label} badge={`${activeCount}/${rules4cat.length} attive`} extra={
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => enableAllInCategory(cat.key)} disabled={saving}
            style={{ ...iS, padding: '4px 10px', fontSize: 10, cursor: 'pointer' }}>Attiva tutto</button>
          <button onClick={() => disableAllInCategory(cat.key)} disabled={saving}
            style={{ ...iS, padding: '4px 10px', fontSize: 10, cursor: 'pointer' }}>Disattiva tutto</button>
        </div>
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules4cat.map(rule => {
            const enabled = isEnabled(rule.key)
            const liv = LIVELLI[rule.livello] || LIVELLI.info
            return <div key={rule.key} style={{
              background: enabled ? 'rgba(16,185,129,.04)' : '#131825',
              border: `1px solid ${enabled ? '#10B98144' : '#2a3042'}`,
              borderRadius: 8, padding: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <input type='checkbox' checked={enabled} onChange={() => toggleEnabled(rule.key)} style={{ marginTop: 3, accentColor: '#10B981', width: 18, height: 18 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{rule.label}</div>
                    <span style={{ ...S.badge(liv.color, liv.bg), fontSize: 10 }}>{liv.l}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: enabled ? 10 : 0 }}>{rule.descr}</div>
                  {enabled && (
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                      {rule.thresholds.length > 0 && rule.thresholds.map(th => (
                        <label key={th.key} style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {th.label}:
                          <input type='number' value={getThreshold(rule.key, th.key, th.default)}
                            onChange={e => setThreshold(rule.key, th.key, e.target.value)}
                            style={{ ...iS, width: 70, padding: '4px 6px', fontSize: 11, textAlign: 'center' }} />
                          <span style={{ fontSize: 10, color: '#64748b' }}>{th.suffix}</span>
                        </label>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                        <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>Canali:</span>
                        {[
                          { v: 'dashboard', l: 'Dashboard' },
                          { v: 'email', l: 'Email' },
                        ].map(c => {
                          const sel = isChannelEnabled(rule.key, c.v)
                          return <button key={c.v} onClick={() => toggleChannel(rule.key, c.v)}
                            style={{ ...iS, padding: '3px 10px', fontSize: 10, fontWeight: 600,
                              background: sel ? '#3B82F6' : 'transparent',
                              color: sel ? '#fff' : '#94a3b8',
                              border: sel ? 'none' : '1px solid #2a3042',
                              cursor: 'pointer' }}>
                            {c.l}
                          </button>
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          })}
        </div>
      </Card>
    })}
  </>
}
