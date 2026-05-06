// Widget Checklist per la Panoramica.
// Mostra lo stato delle compilazioni della SERA PRIMA (di default) per ogni
// locale e momento (entrata/uscita). Click sull'header del widget apre un
// modale fullscreen con tutte le risposte dettagliate.
//
// Configurazione (settings persistiti in localStorage):
//   - momento: 'entrata' | 'uscita' | 'both'      (default 'uscita')
//   - locali:  array di nomi locale da mostrare    (default tutti)
//   - whenLabel: 'ieri sera' | 'oggi mattina'     (puramente cosmetico)

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S, fmtN } from './shared/styles.jsx'

const STORAGE_KEY = 'cic_widget_checklist_cfg'

function loadCfg() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveCfg(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)) } catch {}
}

// Calcola la data della "sera prima" rispetto a oggi (YYYY-MM-DD).
function ieriDate() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
function oggiDate() {
  return new Date().toISOString().split('T')[0]
}

export default function ChecklistWidget({ sps = [] }) {
  const [cfg, setCfg] = useState(() => ({
    momento: 'uscita',
    locali: null, // null = tutti
    target: 'ieri', // 'ieri' | 'oggi'
    ...loadCfg(),
  }))
  useEffect(() => { saveCfg(cfg) }, [cfg])

  const [showSettings, setShowSettings] = useState(false)
  const [data, setData] = useState({ checklists: [], responses: [], loading: true })
  const [openDetail, setOpenDetail] = useState(null) // { checklist, responses }

  // Locali da considerare
  const localiFiltrati = useMemo(() => {
    const all = (sps || []).map(s => s.description || s.name).filter(Boolean)
    return cfg.locali ? all.filter(l => cfg.locali.includes(l)) : all
  }, [sps, cfg.locali])

  // Carica checklist attive + risposte del giorno target
  useEffect(() => {
    let cancel = false
    ;(async () => {
      setData(d => ({ ...d, loading: true }))
      const targetDate = cfg.target === 'oggi' ? oggiDate() : ieriDate()

      // Filtro momento
      let q = supabase.from('attendance_checklists').select('*').eq('attivo', true)
      if (cfg.momento !== 'both') q = q.eq('momento', cfg.momento)
      const { data: cls } = await q
      const checklists = (cls || []).filter(c => localiFiltrati.includes(c.locale))
      if (checklists.length === 0) {
        if (!cancel) setData({ checklists: [], responses: [], loading: false })
        return
      }

      const ids = checklists.map(c => c.id)
      const { data: resps } = await supabase.from('attendance_checklist_responses')
        .select('*').in('checklist_id', ids)
        .gte('created_at', targetDate + 'T00:00:00')
        .lte('created_at', targetDate + 'T23:59:59')

      if (!cancel) setData({ checklists, responses: resps || [], loading: false })
    })()
    return () => { cancel = true }
  }, [cfg.momento, cfg.target, localiFiltrati.join(',')])

  const targetLabel = cfg.target === 'oggi' ? "Oggi è andata..." : "Ieri sera è andata..."
  const targetSub = cfg.target === 'oggi'
    ? new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) })()

  // Raggruppa per locale + momento
  const grouped = useMemo(() => {
    const out = {}
    for (const cl of data.checklists) {
      const key = cl.locale + '|' + cl.momento
      if (!out[key]) out[key] = { locale: cl.locale, momento: cl.momento, checklists: [], responses: [] }
      out[key].checklists.push(cl)
      const myResps = data.responses.filter(r => r.checklist_id === cl.id && !r.skipped)
      out[key].responses.push(...myResps)
    }
    return Object.values(out).sort((a, b) =>
      a.locale.localeCompare(b.locale) || a.momento.localeCompare(b.momento)
    )
  }, [data])

  return <div style={{ ...S.card, gridColumn: 'span 3' }}>
    {/* Header */}
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
          Checklist · {cfg.momento === 'both' ? 'tutte' : cfg.momento}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2, letterSpacing: '-0.01em' }}>
          {targetLabel}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, textTransform: 'capitalize' }}>
          {targetSub}
        </div>
      </div>
      <button onClick={() => setShowSettings(true)}
        title="Configura widget"
        style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
        Configura
      </button>
    </div>

    {/* Lista locali / momenti */}
    {data.loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Caricamento…</div>}

    {!data.loading && grouped.length === 0 && (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        Nessuna checklist attiva per il filtro selezionato.
      </div>
    )}

    {!data.loading && grouped.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {grouped.map(g => {
          const fatte = g.responses.length
          const totaleAttesa = g.checklists.length // semplificazione: 1 risposta attesa per checklist (può estendersi)
          const ok = fatte >= totaleAttesa
          const ts = g.responses.length > 0
            ? new Date(Math.max(...g.responses.map(r => new Date(r.created_at).getTime())))
            : null
          const lastBy = g.responses.length > 0
            ? g.responses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].employee_name
            : null
          return (
            <button key={g.locale + g.momento}
              onClick={() => setOpenDetail({ group: g, all: data })}
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderLeft: '3px solid ' + (ok ? 'var(--green)' : 'var(--red)'),
                borderRadius: 'var(--radius-control)', padding: 12, textAlign: 'left',
                cursor: 'pointer', fontFamily: 'inherit', minHeight: 78,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{g.locale}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: ok ? 'var(--green-bg)' : 'var(--red-bg)',
                  color: ok ? 'var(--green-text)' : 'var(--red-text)',
                  textTransform: 'uppercase', letterSpacing: '.05em',
                }}>{ok ? 'Fatta' : 'Mancante'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {g.momento === 'entrata' ? 'Apertura' : 'Chiusura'} · {fatte}/{totaleAttesa} risposte
              </div>
              {lastBy && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  Da {lastBy} · {ts ? ts.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
              )}
            </button>
          )
        })}
      </div>
    )}

    {showSettings && (
      <ChecklistWidgetSettings cfg={cfg} sps={sps} onSave={(c) => { setCfg(c); setShowSettings(false) }} onClose={() => setShowSettings(false)}/>
    )}

    {openDetail && (
      <ChecklistDetailModal group={openDetail.group} all={openDetail.all} cfg={cfg} onClose={() => setOpenDetail(null)}/>
    )}
  </div>
}

// ─── Settings modal ────────────────────────────────────────────────
function ChecklistWidgetSettings({ cfg, sps, onSave, onClose }) {
  const [draft, setDraft] = useState(cfg)
  const allLocali = (sps || []).map(s => s.description || s.name).filter(Boolean)
  const sel = draft.locali === null ? allLocali : draft.locali
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Configura widget Checklist</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer', padding: 4 }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Cosa mostrare</label>
          <select value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })} style={inp}>
            <option value="ieri">Ieri sera (com'è andata)</option>
            <option value="oggi">Oggi (apertura)</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Momento</label>
          <select value={draft.momento} onChange={e => setDraft({ ...draft, momento: e.target.value })} style={inp}>
            <option value="uscita">Solo uscita (chiusura)</option>
            <option value="entrata">Solo entrata (apertura)</option>
            <option value="both">Tutte (entrata + uscita)</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Locali</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
            {allLocali.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nessun locale</div>}
            {allLocali.map(loc => {
              const checked = sel.includes(loc)
              return <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => {
                  const next = checked ? sel.filter(l => l !== loc) : [...sel, loc]
                  setDraft({ ...draft, locali: next.length === allLocali.length ? null : next })
                }}/>
                {loc}
              </label>
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSec}>Annulla</button>
          <button onClick={() => onSave(draft)} style={btnPri}>Salva</button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail modal: tutte le risposte del gruppo locale+momento ─────
function ChecklistDetailModal({ group, all, cfg, onClose }) {
  const [openId, setOpenId] = useState(null)
  const headerLabel = (cfg.target === 'oggi' ? 'Oggi' : 'Ieri') + ' · ' + group.locale + ' · ' + (group.momento === 'entrata' ? 'apertura' : 'chiusura')
  const responsesByCl = useMemo(() => {
    const m = {}
    for (const cl of group.checklists) {
      m[cl.id] = { checklist: cl, responses: all.responses.filter(r => r.checklist_id === cl.id) }
    }
    return Object.values(m)
  }, [group, all])

  return (
    <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--surface)', borderRadius: '16px 16px 0 0' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)', textTransform: 'capitalize' }}>{headerLabel}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--text2)', cursor: 'pointer', padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          {responsesByCl.map(({ checklist, responses }) => (
            <div key={checklist.id} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                {checklist.nome} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {checklist.reparto}</span>
              </div>
              {responses.length === 0 && (
                <div style={{ padding: 12, background: 'var(--red-bg)', color: 'var(--red-text)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                  Nessuna risposta ricevuta
                </div>
              )}
              {responses.map(r => {
                const isOpen = openId === r.id
                const ts = new Date(r.created_at)
                const ans = r.risposte || {}
                const items = Array.isArray(checklist.items) ? checklist.items : []
                return (
                  <div key={r.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
                    <button onClick={() => setOpenId(isOpen ? null : r.id)}
                      style={{ width: '100%', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: 12, background: 'transparent', border: 'none', fontFamily: 'inherit', textAlign: 'left' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.employee_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {ts.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <span style={{ color: 'var(--text2)', fontSize: 14 }}>{isOpen ? '▾' : '▸'}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                          <tbody>
                            {items.map(it => {
                              const v = ans[it.id]
                              const display = v == null || v === '' ? '—' : (typeof v === 'boolean' ? (v ? 'Sì' : 'No') : Array.isArray(v) ? v.join(', ') : String(v))
                              return (
                                <tr key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '6px 4px', color: 'var(--text2)', verticalAlign: 'top', width: '60%' }}>{it.label || it.id}</td>
                                  <td style={{ padding: '6px 4px', color: 'var(--text)', fontWeight: 500 }}>{display}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }
const inp = { ...S.input, width: '100%' }
const btnPri = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 'var(--radius-control)', cursor: 'pointer' }
const btnSec = { padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)', cursor: 'pointer' }
