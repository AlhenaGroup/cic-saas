// Modulo Impostazioni
// Sotto-tab: Generale, Integrazioni, Notifiche, Account
// Per ora layout + placeholder; il contenuto sostantive lo riempiremo
// progressivamente (alcune cose esistono già altrove e vanno spostate qui).

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card } from './shared/styles.jsx'
import SubTabsBar from './SubTabsBar'
import DailyReportSettings from './DailyReportSettings'

const iS = S.input

const TABS = [
  { key: 'generale',     label: 'Generale' },
  { key: 'integrazioni', label: 'Integrazioni' },
  { key: 'notifiche',    label: 'Notifiche' },
  { key: 'account',      label: 'Account' },
]

export default function ImpostazioniModule({ settings, sps }) {
  // NON persistito: rientro parte dal primo sub-tab (Generale)
  const [tab, setTab] = useState('generale')

  return <div>
    <SubTabsBar tabs={TABS} value={tab} onChange={setTab} />
    {tab === 'generale'     && <GeneraleTab settings={settings} sps={sps} />}
    {tab === 'integrazioni' && <IntegrazioniTab settings={settings} />}
    {tab === 'notifiche'    && <NotificheTab />}
    {tab === 'account'      && <AccountTab />}
  </div>
}

// ─── Generale ───────────────────────────────────────────────────
function GeneraleTab({ settings, sps }) {
  // Rilegge da DB perché `settings` da DashboardPage potrebbe essere obsoleto
  // dopo che l'admin modifica l'anagrafica
  const [s, setS] = useState(settings)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle()
        if (!cancelled && data) setS(data)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return <>
    <Card title="Anagrafica azienda" badge={loading ? 'Caricamento…' : null}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 4 }}>
        <Field label="Ragione sociale" value={s?.company_name || '—'} />
        <Field label="Partita IVA" value={s?.vat_number || '—'} />
        <Field label="Codice fiscale" value={s?.tax_code || '—'} />
        <Field label="Indirizzo sede" value={s?.address || '—'} />
        <Field label="Telefono" value={s?.phone || '—'} />
        <Field label="Email" value={s?.company_email || '—'} />
        <Field label="Sito web" value={s?.website || '—'} />
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 12, padding: '0 4px' }}>
        I dati anagrafici possono essere modificati solo dall'admin del piano. Contatta supporto.
      </div>
    </Card>

    <div style={{ marginTop: 12 }}/>

    <Card title="Locali" badge={(sps || []).length + ' locali attivi'}>
      {(sps || []).length === 0 ? (
        <div style={{ padding: 20, color: '#64748b', fontSize: 13, textAlign: 'center' }}>Nessun locale configurato.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome', 'ID CiC', 'Stato'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {sps.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{s.description || s.name || '—'}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', color: '#94a3b8' }}>{s.id}</td>
                <td style={S.td}><span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Attivo</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>

    <div style={{ marginTop: 12 }}/>

    <Card title="Formati e preferenze">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: 4 }}>
        <Field label="Fuso orario" value="Europe/Rome" />
        <Field label="Lingua" value="Italiano" />
        <Field label="Valuta" value="EUR (€)" />
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 12, padding: '0 4px' }}>
        Personalizzazioni multi-lingua e multi-valuta in arrivo nelle prossime release.
      </div>
    </Card>
  </>
}

// ─── Integrazioni ───────────────────────────────────────────────
function IntegrazioniTab({ settings }) {
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  // Default: ultimi 7 giorni
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0] })()
  const [syncFrom, setSyncFrom] = useState(weekAgo)
  const [syncTo, setSyncTo] = useState(today)

  const doResync = async () => {
    if (!settings?.cic_api_key) { setSyncMsg({ ok: false, text: 'API key CiC mancante' }); return }
    setSyncing(true); setSyncMsg(null)
    try {
      const r = await fetch(`/api/sync-cron?apiKey=${encodeURIComponent(settings.cic_api_key)}&from=${syncFrom}&to=${syncTo}`)
      if (!r.ok) throw new Error('Sync fallito (status ' + r.status + ')')
      setSyncMsg({ ok: true, text: 'Re-Sync completato per il periodo ' + syncFrom + ' → ' + syncTo })
    } catch (e) {
      setSyncMsg({ ok: false, text: 'Errore: ' + e.message })
    } finally { setSyncing(false) }
  }

  const integrazioni = [
    {
      id: 'cic',
      nome: 'CiC POS',
      descr: 'Sincronizzazione vendite, scontrini, categorie e reparti dal POS Cassanova.',
      stato: settings?.cic_api_key ? 'connected' : 'disconnected',
    },
    {
      id: 'tsdigital',
      nome: 'TS Digital',
      descr: 'Importazione fatture elettroniche passive da Agyo / TeamSystem.',
      stato: 'connected',
    },
    {
      id: 'google_calendar',
      nome: 'Google Calendar',
      descr: 'Sincronizzazione turni HR con calendario Google personale.',
      stato: 'pending',
    },
    {
      id: 'google_gmail',
      nome: 'Google Gmail',
      descr: 'Invio resoconto giornaliero e altre email automatiche dal tuo Gmail.',
      stato: 'pending',
    },
    {
      id: 'hera',
      nome: 'HERA Utenze',
      descr: 'Auto-assegnazione fatture utenze (POD/PDR) ai locali corrispondenti.',
      stato: 'connected',
    },
  ]

  const STATO = {
    connected:    { l: 'Connesso',     c: '#10B981', bg: 'rgba(16,185,129,.12)' },
    pending:      { l: 'Da configurare', c: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
    disconnected: { l: 'Disconnesso',  c: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  }

  return <>
  {/* Card Re-Sync CiC */}
  <Card title="Re-Sync dati CiC" badge={settings?.cic_api_key ? 'API key OK' : 'API key mancante'}>
    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
      Forza la risincronizzazione dei dati POS Cassanova per un periodo specifico.
      Utile dopo importazione manuale di scontrini o se il sync notturno non ha catturato tutto.
    </div>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Periodo:</span>
      <input type="date" value={syncFrom} onChange={e => setSyncFrom(e.target.value)} style={iS}/>
      <span style={{ color: '#475569' }}>—</span>
      <input type="date" value={syncTo} onChange={e => setSyncTo(e.target.value)} style={iS}/>
      <button onClick={doResync} disabled={syncing || !settings?.cic_api_key}
        style={{
          ...iS, padding: '6px 16px', fontWeight: 600, border: 'none', cursor: syncing ? 'wait' : 'pointer',
          background: syncing ? '#1a1f2e' : '#10B981',
          color: syncing ? '#94a3b8' : '#0f1420',
        }}>
        {syncing ? 'Sync in corso…' : 'Re-Sync'}
      </button>
    </div>
    {syncMsg && (
      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 12,
        background: syncMsg.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
        border: '1px solid ' + (syncMsg.ok ? '#10B981' : '#EF4444'),
        color: syncMsg.ok ? '#10B981' : '#EF4444',
      }}>{syncMsg.text}</div>
    )}
  </Card>

  <div style={{ marginTop: 12 }}/>

  <Card title="Integrazioni esterne" badge={`${integrazioni.filter(i => i.stato === 'connected').length}/${integrazioni.length} connesse`}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      {integrazioni.map(i => {
        const s = STATO[i.stato]
        return <div key={i.id} style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{i.nome}</div>
            <span style={S.badge(s.c, s.bg)}>{s.l}</span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 10 }}>{i.descr}</div>
          <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>
            Configurazione dettagliata in arrivo nelle prossime release.
          </div>
        </div>
      })}
    </div>
  </Card>
  </>
}

// ─── Notifiche ──────────────────────────────────────────────────
function NotificheTab() {
  const [showDailyReport, setShowDailyReport] = useState(false)
  return <>
    <Card title="Notifiche automatiche">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <NotifCard
          titolo="Resoconto giornaliero"
          descr="Email mattutina con il riepilogo del giorno prima per ogni destinatario configurato (imprenditore, resp. acquisti, HR, ecc.)."
          stato="active"
          onClick={() => setShowDailyReport(true)}
          cta="Configura"
        />
        <NotifCard
          titolo="Reminder scadenze documenti"
          descr="Avviso quando documenti dipendente (contratto, certificato medico, ecc.) stanno per scadere."
          stato="planned"
          cta="In arrivo"
        />
        <NotifCard
          titolo="Alert prezzi"
          descr="Notifica quando un articolo magazzino aumenta di prezzo oltre la soglia configurata."
          stato="planned"
          cta="In arrivo"
        />
        <NotifCard
          titolo="Alert magazzino sotto soglia"
          descr="Notifica quando la giacenza di un articolo scende sotto la scorta minima impostata."
          stato="planned"
          cta="In arrivo"
        />
      </div>
    </Card>

    {showDailyReport && <DailyReportSettings onClose={() => setShowDailyReport(false)} />}
  </>
}

function NotifCard({ titolo, descr, stato, onClick, cta }) {
  const STATO = {
    active:  { c: '#10B981', bg: 'rgba(16,185,129,.12)', l: 'Attiva' },
    planned: { c: '#94a3b8', bg: 'rgba(148,163,184,.12)', l: 'In arrivo' },
  }
  const s = STATO[stato] || STATO.planned
  const isActive = stato === 'active'
  return <div style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 14, opacity: isActive ? 1 : 0.7 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{titolo}</div>
      <span style={S.badge(s.c, s.bg)}>{s.l}</span>
    </div>
    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 10 }}>{descr}</div>
    <button onClick={onClick} disabled={!isActive}
      style={{ ...iS, padding: '5px 12px', fontSize: 11, fontWeight: 600,
        background: isActive ? '#3B82F6' : 'transparent',
        color: isActive ? '#fff' : '#475569',
        border: isActive ? 'none' : '1px solid #2a3042',
        cursor: isActive ? 'pointer' : 'not-allowed' }}>
      {cta || 'Configura'}
    </button>
  </div>
}

// ─── Account ────────────────────────────────────────────────────
function AccountTab() {
  const [user, setUser] = useState(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user || null))
  }, [])

  const changePassword = async () => {
    setMsg(''); setErr('')
    if (pw.length < 8) { setErr('Password almeno 8 caratteri'); return }
    if (pw !== pw2) { setErr('Le password non coincidono'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setMsg('Password aggiornata')
    setPw(''); setPw2('')
    setTimeout(() => setMsg(''), 3000)
  }

  return <>
    <Card title="Profilo">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 4 }}>
        <Field label="Email" value={user?.email || '—'} />
        <Field label="ID utente" value={user?.id || '—'} mono />
        <Field label="Account creato" value={user?.created_at ? new Date(user.created_at).toLocaleDateString('it-IT') : '—'} />
        <Field label="Ultimo accesso" value={user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('it-IT') : '—'} />
      </div>
    </Card>

    <div style={{ marginTop: 12 }}/>

    <Card title="Cambio password">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 520 }}>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Nuova password (min 8)" autoComplete="new-password" style={{ ...iS, width: '100%' }} />
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Conferma password" autoComplete="new-password" style={{ ...iS, width: '100%' }} />
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 12, color: '#10B981' }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, fontSize: 12, color: '#EF4444' }}>{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button onClick={changePassword} disabled={saving || !pw || !pw2}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '7px 18px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: (!pw || !pw2) ? 0.5 : 1 }}>
          {saving ? 'Aggiorno…' : 'Aggiorna password'}
        </button>
      </div>
    </Card>

    <div style={{ marginTop: 12 }}/>

    <Card title="Logout">
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
        Disconnetti la sessione corrente da questo browser.
      </div>
      <button onClick={() => supabase.auth.signOut()}
        style={{ ...iS, background: 'transparent', border: '1px solid #EF4444', color: '#EF4444', padding: '7px 18px', fontWeight: 600, cursor: 'pointer' }}>
        Esci
      </button>
    </Card>
  </>
}

function Field({ label, value, mono }) {
  return <div>
    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
    <div style={{ fontSize: 13, color: '#e2e8f0', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
  </div>
}
