// Fidelity manager: configurazione programma + premi + classifica clienti.
// Backoffice: l'utente configura. POS chiama /api/fidelity per accumulate/redeem.

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

const TIPI_PREMIO = [
  { key: 'omaggio',       label: 'Omaggio (es. caffè, dolce)' },
  { key: 'sconto_fisso',  label: 'Sconto fisso (€)' },
  { key: 'sconto_pct',    label: 'Sconto percentuale (%)' },
  { key: 'menu_speciale', label: 'Menu speciale' },
]

function fmtPremio(r) {
  if (r.tipo === 'sconto_pct')   return `-${r.valore}%`
  if (r.tipo === 'sconto_fisso') return `-${Number(r.valore).toFixed(2)} €`
  if (r.tipo === 'menu_speciale') return 'Menu'
  return r.valore > 0 ? `Omaggio · ~${Number(r.valore).toFixed(2)}€` : 'Omaggio'
}

export default function FidelityManager({ sp, sps }) {
  const localesAvail = useMemo(() => (sps && sps.length ? sps.map(s => s.name) : ['REMEMBEER', 'CASA DE AMICIS', 'BIANCOLATTE', 'LABORATORIO']), [sps])
  const [locale, setLocale] = useState(() => localStorage.getItem('mkt_fid_locale') || (sp?.name) || localesAvail[0])
  useEffect(() => { localStorage.setItem('mkt_fid_locale', locale) }, [locale])

  const [program, setProgram] = useState(null)
  const [rewards, setRewards] = useState([])
  const [topClients, setTopClients] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingReward, setEditingReward] = useState(null)
  const [editingProg, setEditingProg] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const pg = await api('/api/fidelity', { action: 'program-get', locale })
      setProgram(pg.program || null)
      if (pg.program) {
        const [rw, tc] = await Promise.all([
          api('/api/fidelity', { action: 'rewards-list', program_id: pg.program.id }),
          api('/api/fidelity', { action: 'top-clients', locale, limit: 10 }),
        ])
        setRewards(rw.rewards || [])
        setTopClients(tc.top || [])
      } else {
        setRewards([]); setTopClients([])
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  // ── Program edit ───────────────────────────────────────────────────
  const openProgEditor = () => setEditingProg(program ? { ...program } : {
    locale,
    nome: `Punti ${locale}`,
    descrizione: '',
    punti_per_euro: 1,
    punti_visita: 0,
    punti_iscrizione: 50,
    punti_compleanno: 100,
    durata_punti_giorni: 365,
    attivo: true,
  })

  const saveProgram = async () => {
    if (!editingProg?.nome?.trim()) return alert('Nome obbligatorio')
    try {
      await api('/api/fidelity', { action: 'program-upsert', program: { ...editingProg, locale } })
      setEditingProg(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── Reward edit ────────────────────────────────────────────────────
  const openRewardEditor = (r) => setEditingReward(r ? { ...r } : {
    program_id: program?.id,
    locale,
    nome: '',
    descrizione: '',
    punti_richiesti: 100,
    tipo: 'omaggio',
    valore: 0,
    max_riscatti_per_cliente: 1,
    attivo: true,
  })

  const saveReward = async () => {
    if (!editingReward?.nome?.trim()) return alert('Nome obbligatorio')
    if (!editingReward.punti_richiesti) return alert('Punti richiesti obbligatorio')
    try {
      await api('/api/fidelity', { action: 'reward-upsert', reward: { ...editingReward, program_id: program.id, locale } })
      setEditingReward(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const deleteReward = async () => {
    if (!editingReward?.id) return
    if (!confirm('Eliminare il premio?')) return
    try {
      await api('/api/fidelity', { action: 'reward-delete', id: editingReward.id })
      setEditingReward(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  // ── UI ──────────────────────────────────────────────────────────────
  return <div style={S.card}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Fidelity · programma punti</h2>
      <div style={{ flex: 1 }} />
      <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...S.input, padding: '7px 10px' }}>
        {localesAvail.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
    </div>

    {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Caricamento…</div>}

    {/* Programma config */}
    {!loading && !program && (
      <div style={{ textAlign: 'center', padding: 30, background: '#0f1420', borderRadius: 10, border: '1px dashed #2a3042' }}>
        <div style={{ fontSize: 14, color: '#cbd5e1', marginBottom: 12 }}>Nessun programma fidelity configurato per <b>{locale}</b>.</div>
        <button onClick={openProgEditor} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Crea programma</button>
      </div>
    )}

    {!loading && program && (
      <>
        <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
              background: program.attivo ? '#10B98122' : '#94A3B822',
              color: program.attivo ? '#10B981' : '#94A3B8',
            }}>{program.attivo ? 'ATTIVO' : 'OFF'}</span>
            <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>{program.nome}</h3>
            <button onClick={openProgEditor} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Modifica</button>
          </div>
          {program.descrizione && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>{program.descrizione}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: 12 }}>
            <Stat label="€1 spesa" value={`${program.punti_per_euro} pt`} />
            {program.punti_visita > 0 && <Stat label="Bonus visita" value={`+${program.punti_visita} pt`} />}
            {program.punti_iscrizione > 0 && <Stat label="Iscrizione" value={`+${program.punti_iscrizione} pt`} />}
            {program.punti_compleanno > 0 && <Stat label="Compleanno" value={`+${program.punti_compleanno} pt`} />}
            <Stat label="Scadenza" value={program.durata_punti_giorni ? `${program.durata_punti_giorni} gg` : 'Mai'} />
          </div>
        </div>

        {/* Premi */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Premi · {rewards.length}</h3>
          <div style={{ flex: 1 }} />
          <button onClick={() => openRewardEditor(null)} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>+ Nuovo premio</button>
        </div>

        {rewards.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 13, background: '#0f1420', borderRadius: 8 }}>
            Nessun premio configurato. Crea il primo — i clienti potranno riscattarlo dal POS.
          </div>
        )}

        {rewards.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 18 }}>
            {rewards.map(r => (
              <div key={r.id} onClick={() => openRewardEditor(r)} style={{
                background: '#0f1420', border: '1px solid ' + (r.attivo ? '#10B98155' : '#2a3042'),
                borderRadius: 10, padding: 12, cursor: 'pointer', position: 'relative'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{r.nome}</span>
                  <code style={{ background: '#F59E0B22', color: '#F59E0B', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>{r.punti_richiesti} pt</code>
                </div>
                {r.descrizione && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{r.descrizione}</div>}
                <div style={{ fontSize: 12, color: '#cbd5e1' }}>{fmtPremio(r)}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  Riscatti: {r.riscatti_totali}{r.max_riscatti_globali ? `/${r.max_riscatti_globali}` : ''}
                </div>
                {!r.attivo && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, padding: '2px 6px', borderRadius: 999, background: '#94A3B822', color: '#94A3B8', fontWeight: 700 }}>OFF</span>}
              </div>
            ))}
          </div>
        )}

        {/* Top clienti */}
        {topClients.length > 0 && (
          <>
            <h3 style={{ margin: '20px 0 10px', fontSize: 15 }}>Top clienti per saldo punti</h3>
            <div style={{ background: '#0f1420', borderRadius: 8, overflow: 'hidden' }}>
              {topClients.map((tc, i) => (
                <div key={tc.customer?.id || i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderBottom: i < topClients.length - 1 ? '1px solid #1a1f2e' : 'none',
                  fontSize: 13,
                }}>
                  <span style={{ color: '#64748b', fontFamily: 'monospace', minWidth: 24 }}>{i + 1}</span>
                  <span style={{ flex: 1 }}>{[tc.customer?.nome, tc.customer?.cognome].filter(Boolean).join(' ') || tc.customer?.telefono || '(senza nome)'}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{tc.customer?.telefono || '—'}</span>
                  <code style={{ background: '#F59E0B22', color: '#F59E0B', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>{tc.balance} pt</code>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    )}

    {/* Drawer programma */}
    {editingProg && <Drawer onClose={() => setEditingProg(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editingProg.id ? 'Modifica programma' : 'Crea programma fidelity'}</h3>
      <Field label="Nome programma"><input value={editingProg.nome} onChange={e => setEditingProg({ ...editingProg, nome: e.target.value })} placeholder="es. REMEMBEER Stars" style={S.input} /></Field>
      <div style={{ marginTop: 8 }}>
        <Field label="Descrizione (opz)"><textarea value={editingProg.descrizione || ''} onChange={e => setEditingProg({ ...editingProg, descrizione: e.target.value })} style={{ ...S.input, minHeight: 50, fontFamily: 'inherit' }} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Regole accumulo</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Punti per €1 spesa"><input type="number" step="0.01" value={editingProg.punti_per_euro} onChange={e => setEditingProg({ ...editingProg, punti_per_euro: e.target.value })} style={S.input} /></Field>
          <Field label="Bonus per ogni visita"><input type="number" value={editingProg.punti_visita || 0} onChange={e => setEditingProg({ ...editingProg, punti_visita: e.target.value })} style={S.input} /></Field>
          <Field label="Bonus iscrizione (1ª visita)"><input type="number" value={editingProg.punti_iscrizione || 0} onChange={e => setEditingProg({ ...editingProg, punti_iscrizione: e.target.value })} style={S.input} /></Field>
          <Field label="Bonus compleanno"><input type="number" value={editingProg.punti_compleanno || 0} onChange={e => setEditingProg({ ...editingProg, punti_compleanno: e.target.value })} style={S.input} /></Field>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Scadenza punti (giorni, vuoto = mai)"><input type="number" value={editingProg.durata_punti_giorni || ''} onChange={e => setEditingProg({ ...editingProg, durata_punti_giorni: e.target.value })} placeholder="365" style={S.input} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!editingProg.attivo} onChange={e => setEditingProg({ ...editingProg, attivo: e.target.checked })} />
          Programma attivo (POS accumulerà punti al checkout)
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button onClick={() => setEditingProg(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={saveProgram} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
      </div>
    </Drawer>}

    {/* Drawer premio */}
    {editingReward && <Drawer onClose={() => setEditingReward(null)}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editingReward.id ? 'Modifica premio' : 'Nuovo premio'}</h3>
      <Field label="Nome premio"><input value={editingReward.nome} onChange={e => setEditingReward({ ...editingReward, nome: e.target.value })} placeholder="es. Caffè omaggio" style={S.input} /></Field>
      <div style={{ marginTop: 8 }}>
        <Field label="Descrizione (opz)"><input value={editingReward.descrizione || ''} onChange={e => setEditingReward({ ...editingReward, descrizione: e.target.value })} style={S.input} /></Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <Field label="Punti richiesti"><input type="number" value={editingReward.punti_richiesti} onChange={e => setEditingReward({ ...editingReward, punti_richiesti: e.target.value })} style={S.input} /></Field>
        <Field label="Tipo"><select value={editingReward.tipo} onChange={e => setEditingReward({ ...editingReward, tipo: e.target.value })} style={S.input}>
          {TIPI_PREMIO.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select></Field>
        <Field label={editingReward.tipo === 'sconto_pct' ? 'Valore (%)' : 'Valore (€)'}>
          <input type="number" step="0.01" value={editingReward.valore} onChange={e => setEditingReward({ ...editingReward, valore: e.target.value })} style={S.input} />
        </Field>
        <Field label="Max per cliente"><input type="number" value={editingReward.max_riscatti_per_cliente} onChange={e => setEditingReward({ ...editingReward, max_riscatti_per_cliente: Number(e.target.value || 1) })} style={S.input} /></Field>
        <Field label="Max riscatti totali (vuoto = ∞)"><input type="number" value={editingReward.max_riscatti_globali || ''} onChange={e => setEditingReward({ ...editingReward, max_riscatti_globali: e.target.value })} style={S.input} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!editingReward.attivo} onChange={e => setEditingReward({ ...editingReward, attivo: e.target.checked })} />
          Premio attivo (visibile e riscattabile dal POS)
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        {editingReward.id && <button onClick={deleteReward} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>Elimina</button>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditingReward(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
        <button onClick={saveReward} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
      </div>
    </Drawer>}
  </div>
}

function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}

function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}

function Stat({ label, value }) {
  return <div>
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 700, color: '#F59E0B' }}>{value}</div>
  </div>
}

function Drawer({ children, onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100%)', height: '100%', background: '#1a1f2e', padding: 20, overflowY: 'auto', borderLeft: '1px solid #2a3042' }}>
      {children}
    </div>
  </div>
}
