import { useState, useEffect, useMemo, useCallback } from 'react'
import { S, Card, KPI, fmt, fmtN } from '../shared/styles.jsx'

// ─── Segmentazione RFM ─────────────────────────────────────────────────────
// Recency   = giorni dall'ultima visita (lower = better)
// Frequency = numero visite totali
// Monetary  = totale speso
//
// 6 segmenti:
//   🟢 champion   — F>=5  AND R<=30  AND M>=100
//   🔵 loyal      — F>=3  AND R<=60
//   🟡 at_risk    — F>=2  AND R>=60  AND R<=180
//   🔴 lost       — R>180
//   ⭐ new        — creato <30 giorni AND F==1
//   😐 one_timer  — F==1 AND creato >=30 giorni

const SEGMENTS = {
  champion:  { label: '🟢 Champion',   color: '#10B981', desc: 'Visita spesso, di recente, spende tanto' },
  loyal:     { label: '🔵 Loyal',      color: '#3B82F6', desc: 'Cliente fedele, frequente' },
  at_risk:   { label: '🟡 At Risk',    color: '#F59E0B', desc: 'Buon cliente ma assente da 60+ giorni' },
  lost:      { label: '🔴 Lost',       color: '#EF4444', desc: 'Nessuna visita da oltre 180 giorni' },
  new:       { label: '⭐ New',        color: '#8B5CF6', desc: 'Prima visita nell\'ultimo mese' },
  one_timer: { label: '😐 One-Timer',  color: '#64748b', desc: 'Una sola visita, mai tornato' }
}

function daysSince(dateStr) {
  if (!dateStr) return 9999
  const d = new Date(typeof dateStr === 'string' ? dateStr.replace(' ', 'T') : dateStr)
  if (isNaN(d.getTime())) return 9999
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function classifyCustomer(c) {
  const R = daysSince(c.lastReserve || c.lastSeen)
  const F = Number(c.visit || 0)
  const M = Number(c.reserveTotalAmount || 0)
  const createdDays = daysSince(c.creation)

  if (F >= 5 && R <= 30 && M >= 100) return 'champion'
  if (F >= 3 && R <= 60)              return 'loyal'
  if (F >= 2 && R >= 60 && R <= 180)  return 'at_risk'
  if (R > 180)                         return 'lost'
  if (createdDays < 30 && F === 1)    return 'new'
  if (F === 1)                         return 'one_timer'
  if (F >= 2 && R <= 60)              return 'loyal'
  return 'one_timer'
}

// ─── Storage keys ──────────────────────────────────────────────────────────
const LS_TOKEN     = 'cic_plateform_token'
const LS_LOCATIONS = 'cic_plateform_locations'     // map {id: {name, lastSync, count}}
const LS_CACHE     = 'cic_plateform_cache_v2'      // array of customers (all locations merged)
// legacy keys (v1 → auto-migration)
const LS_LOCATION_LEGACY = 'cic_plateform_location_id'
const LS_CACHE_LEGACY    = 'cic_plateform_cache'

function loadLocations() {
  try {
    const m = JSON.parse(localStorage.getItem(LS_LOCATIONS) || 'null')
    if (m && typeof m === 'object') return m
  } catch {}
  return {}
}
function saveLocations(map) {
  try { localStorage.setItem(LS_LOCATIONS, JSON.stringify(map)) } catch {}
}
function loadCache() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CACHE) || 'null')
    if (Array.isArray(arr)) return arr
  } catch {}
  return []
}
function saveCache(arr) {
  try { localStorage.setItem(LS_CACHE, JSON.stringify(arr)) } catch (e) { console.error('cache save failed', e) }
}

// Auto-migrazione dal vecchio formato (single locationID) al nuovo (map)
function migrateLegacy() {
  const newCache = loadCache()
  const newLocations = loadLocations()
  if (newCache.length > 0 || Object.keys(newLocations).length > 0) return { migrated: false }

  const legacyLoc = localStorage.getItem(LS_LOCATION_LEGACY)
  let legacyCache = null
  try { legacyCache = JSON.parse(localStorage.getItem(LS_CACHE_LEGACY) || 'null') } catch {}
  if (!legacyLoc || !legacyCache?.customers) return { migrated: false }

  // Salva il contenuto nel nuovo formato
  const list = legacyCache.customers || []
  saveCache(list)
  saveLocations({
    [legacyLoc]: {
      name: 'Locale ' + legacyLoc,
      lastSync: legacyCache.syncedAt || new Date().toISOString(),
      count: list.length
    }
  })
  // Non cancelliamo i legacy subito, lasciamo come backup per una PR
  return { migrated: true, count: list.length }
}

// ─── Componente ────────────────────────────────────────────────────────────
export default function RFMSegmentation({ sp, sps, from, to }) {
  // migration on mount (prima di inizializzare lo state)
  useEffect(() => { migrateLegacy() }, [])

  const [token,     setToken]     = useState(() => localStorage.getItem(LS_TOKEN) || '')
  const [locations, setLocations] = useState(() => loadLocations())
  const [cache,     setCache]     = useState(() => loadCache())
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [progress,  setProgress]  = useState(null) // { locId, page, maxPages }
  const [filter,    setFilter]    = useState('all')
  const [locFilter, setLocFilter] = useState('all') // filtro per locale
  const [search,    setSearch]    = useState('')
  const [showSetup, setShowSetup] = useState(false)

  // Campi form add-location
  const [newLocId,   setNewLocId]   = useState('')
  const [newLocName, setNewLocName] = useState('')

  const iS = S.input

  // Persistenza
  useEffect(() => { if (token) localStorage.setItem(LS_TOKEN, token) }, [token])
  useEffect(() => { saveLocations(locations) }, [locations])

  // Mostra setup automaticamente se mancano token o locali
  useEffect(() => {
    if (!token || Object.keys(locations).length === 0) setShowSetup(true)
  }, [token, locations])

  // ─── Sync di un singolo locale ───────────────────────────────────────────
  const syncLocation = useCallback(async (locId, locName) => {
    if (!token) { setError('Token richiesto'); return }
    setLoading(true); setError('')
    setProgress({ locId, page: 0, maxPages: 1 })
    try {
      // Pagina 1
      const r0 = await fetch('/api/plateform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-page', token, locationID: locId, page: 1 })
      })
      const j0 = await r0.json()
      if (!r0.ok) throw new Error(j0.error || 'Errore sync pagina 1')
      const maxPages = j0.maxPages || 1
      const totalRecords = j0.totalRecords || 0
      setProgress({ locId, page: 1, maxPages })

      const locCustomers = [...(j0.list || [])]
      for (let p = 2; p <= maxPages && p <= 200; p++) {
        setProgress({ locId, page: p, maxPages })
        const r = await fetch('/api/plateform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list-page', token, locationID: locId, page: p })
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Errore pagina ' + p)
        locCustomers.push(...(j.list || []))
      }

      // Aggiorna cache: rimuove i vecchi record di questo locale, aggiunge i nuovi
      const currentCache = loadCache()
      const filtered = currentCache.filter(c => Number(c.locationID) !== Number(locId))
      const newCache = [...filtered, ...locCustomers]
      saveCache(newCache)
      setCache(newCache)

      // Aggiorna metadata locale
      setLocations(prev => ({
        ...prev,
        [locId]: {
          name: locName || prev[locId]?.name || ('Locale ' + locId),
          lastSync: new Date().toISOString(),
          count: locCustomers.length,
          totalRecords
        }
      }))
      setShowSetup(false)
    } catch (e) {
      setError('Sync fallito: ' + e.message)
    }
    setLoading(false)
    setProgress(null)
  }, [token])

  const syncAll = useCallback(async () => {
    const entries = Object.entries(locations)
    for (const [locId, meta] of entries) {
      await syncLocation(locId, meta.name)
    }
  }, [locations, syncLocation])

  const addLocation = () => {
    const id = newLocId.trim()
    const name = newLocName.trim() || ('Locale ' + id)
    if (!id || isNaN(Number(id))) { setError('ID locale non valido'); return }
    if (locations[id]) { setError('Locale già presente'); return }
    setLocations(prev => ({ ...prev, [id]: { name, lastSync: null, count: 0 } }))
    setNewLocId(''); setNewLocName(''); setError('')
    // Auto-sync subito
    syncLocation(id, name)
  }

  const removeLocation = (locId) => {
    if (!confirm('Rimuovere questo locale e i suoi clienti dalla cache?')) return
    const newLocations = { ...locations }
    delete newLocations[locId]
    setLocations(newLocations)
    const newCache = loadCache().filter(c => Number(c.locationID) !== Number(locId))
    saveCache(newCache)
    setCache(newCache)
  }

  const doTest = async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/plateform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', token })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Test fallito')
      if (!j.ok) throw new Error('Token non valido: ' + (j.message || ''))
      setError('✓ Connessione OK.')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  // ─── RFM compute ─────────────────────────────────────────────────────────
  const classified = useMemo(() => {
    const list = locFilter === 'all'
      ? cache
      : cache.filter(c => Number(c.locationID) === Number(locFilter))
    return list.map(c => ({
      ...c,
      __segment: classifyCustomer(c),
      __recency: daysSince(c.lastReserve || c.lastSeen),
      __frequency: Number(c.visit || 0),
      __monetary: Number(c.reserveTotalAmount || 0)
    }))
  }, [cache, locFilter])

  const counts = useMemo(() => {
    const c = { champion: 0, loyal: 0, at_risk: 0, lost: 0, new: 0, one_timer: 0 }
    classified.forEach(r => { c[r.__segment] = (c[r.__segment] || 0) + 1 })
    return c
  }, [classified])

  const sources = useMemo(() => {
    const s = {}
    classified.forEach(r => { const src = r.source || 'sconosciuto'; s[src] = (s[src] || 0) + 1 })
    return s
  }, [classified])

  const contattabili = useMemo(() => classified.filter(c =>
    c.flagMarketing === 1 && c.flagUnsubscribe !== 1 && c.flagBlacklist !== 1
  ).length, [classified])

  const totalSpesa = useMemo(() => classified.reduce((a, c) => a + c.__monetary, 0), [classified])

  const filtered = useMemo(() => {
    let list = classified
    if (filter !== 'all') list = list.filter(c => c.__segment === filter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.lastname || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.mobile || '').includes(q)
      )
    }
    return list.slice(0, 500)
  }, [classified, filter, search])

  const exportCsv = () => {
    const rows = filter === 'all' ? classified : classified.filter(c => c.__segment === filter)
    if (!rows.length) return
    const header = ['nome', 'cognome', 'email', 'telefono', 'locale_id', 'visite', 'ultima_visita', 'totale_speso', 'coperto_medio', 'segmento', 'marketing', 'source', 'tags']
    const lines = [header.join(',')]
    rows.forEach(r => {
      lines.push([
        (r.name || '').replace(/,/g, ';'),
        (r.lastname || '').replace(/,/g, ';'),
        r.email || '',
        r.mobile || '',
        r.locationID || '',
        r.__frequency,
        (r.lastReserve || r.lastSeen || '').substring(0, 10),
        (r.__monetary || 0).toFixed(2),
        (r.reserveAverageCoverAmount || 0).toFixed(2),
        r.__segment,
        r.flagMarketing === 1 ? 'SI' : 'NO',
        r.source || '',
        (r.tags || []).join('|')
      ].join(','))
    })
    const csv = '\uFEFF' + lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const locSuffix = locFilter === 'all' ? 'tutti' : `loc${locFilter}`
    a.download = `clienti_${locSuffix}_${filter}_${new Date().toISOString().substring(0, 10)}.csv`
    a.click()
  }

  // ─── Render: setup pannello ──────────────────────────────────────────────
  if (showSetup) {
    return <>
      <Card title="⚙️ Configurazione Plateform" badge={Object.keys(locations).length ? 'Aggiungi locali' : 'Prima sincronizzazione'}>
        <div style={{ padding: '8px 4px' }}>
          <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 16, lineHeight: 1.6 }}>
            Puoi sincronizzare <strong>più locali Plateform</strong> contemporaneamente. Ogni locale ha il suo <strong>locationID</strong> (numero visibile in alto a destra su admin.plateform.app, es. "Casa De Amicis (2129)" o "Remembeer (3287)").
          </div>

          {/* Token */}
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
            1️⃣ Token di accesso Plateform
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, lineHeight: 1.5 }}>
            Apri <a href="https://admin.plateform.app/vue/customers" target="_blank" rel="noreferrer" style={{ color: '#F59E0B' }}>admin.plateform.app</a> →
            premi <code style={{ background: '#0f1420', padding: '2px 6px', borderRadius: 4 }}>F12</code> →
            <strong> Application</strong> → <strong>Cookies</strong> →
            cerca <code style={{ background: '#0f1420', padding: '2px 6px', borderRadius: 4 }}>user-panel</code> e copia il Value (32 car.).
          </div>
          <input
            type="password"
            placeholder="32 caratteri esadecimali..."
            value={token}
            onChange={e => setToken(e.target.value.trim())}
            style={{ ...iS, width: '100%', marginBottom: 16 }}
          />

          {/* Locali già configurati */}
          {Object.keys(locations).length > 0 && <>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
              📍 Locali configurati
            </div>
            <div style={{ marginBottom: 16 }}>
              {Object.entries(locations).map(([id, meta]) => (
                <div key={id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: '#0f1420', borderRadius: 6, marginBottom: 6,
                  border: '1px solid #1e2636'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>{meta.name} <span style={{ color: '#64748b', fontWeight: 400 }}>(#{id})</span></div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                      {meta.lastSync
                        ? `${meta.count} clienti · ultimo sync ${new Date(meta.lastSync).toLocaleString('it-IT')}`
                        : 'Mai sincronizzato'}
                    </div>
                  </div>
                  <button
                    onClick={() => syncLocation(id, meta.name)}
                    disabled={loading}
                    style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
                  >
                    {loading && progress?.locId === id ? `${progress.page}/${progress.maxPages}` : '⚡ Sync'}
                  </button>
                  <button
                    onClick={() => removeLocation(id)}
                    disabled={loading}
                    title="Rimuovi"
                    style={{ background: 'none', border: '1px solid #2a3042', color: '#EF4444', padding: '3px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer' }}
                  >🗑</button>
                </div>
              ))}
            </div>
          </>}

          {/* Form aggiungi nuovo locale */}
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
            ➕ Aggiungi nuovo locale
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Location ID (es. 3287)"
              value={newLocId}
              onChange={e => setNewLocId(e.target.value.trim())}
              style={{ ...iS, width: 180 }}
            />
            <input
              placeholder="Nome (es. REMEMBEER)"
              value={newLocName}
              onChange={e => setNewLocName(e.target.value)}
              style={{ ...iS, flex: 1 }}
            />
            <button
              onClick={addLocation}
              disabled={!token || !newLocId || loading}
              style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: (!token || !newLocId || loading) ? 0.5 : 1 }}
            >Aggiungi + Sync</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={doTest}
              disabled={!token || loading}
              style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '8px 16px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: (!token || loading) ? 0.5 : 1 }}
            >
              {loading ? '…' : '🧪 Testa connessione'}
            </button>
            {Object.keys(locations).length > 0 && <>
              <button
                onClick={syncAll}
                disabled={loading}
                style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '8px 16px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.5 : 1 }}
              >⚡ Sincronizza tutti</button>
              <button
                onClick={() => setShowSetup(false)}
                style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '8px 14px', cursor: 'pointer' }}
              >← Torna alla vista</button>
            </>}
          </div>

          {error && <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 6,
            background: error.startsWith('✓') ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
            border: `1px solid ${error.startsWith('✓') ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
            color: error.startsWith('✓') ? '#10B981' : '#FCA5A5',
            fontSize: 12
          }}>{error}</div>}
        </div>
      </Card>
    </>
  }

  // ─── Render: vista principale ────────────────────────────────────────────
  const allLocIds = Object.keys(locations)
  const totalCustomers = cache.length

  return <>
    {/* Banner stato sync */}
    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span>✓ <strong style={{ color: '#94a3b8' }}>{totalCustomers}</strong> clienti su {allLocIds.length} {allLocIds.length === 1 ? 'locale' : 'locali'}</span>
      {allLocIds.map(id => (
        <span key={id} style={{ color: '#64748b' }}>
          · <strong style={{ color: '#cbd5e1' }}>{locations[id].name}</strong>: {locations[id].count} clienti
        </span>
      ))}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => setShowSetup(true)}
        style={{ ...iS, color: '#94a3b8', border: '1px solid #2a3042', padding: '3px 10px', fontSize: 10, cursor: 'pointer' }}
      >⚙️ Gestisci locali</button>
      <button
        onClick={syncAll}
        disabled={loading}
        style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '3px 12px', fontSize: 10, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
      >
        {loading && progress ? `${progress.locId}: ${progress.page}/${progress.maxPages}` : '⚡ Ri-sincronizza tutti'}
      </button>
    </div>

    {error && !error.startsWith('✓') && <div style={{
      background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#FCA5A5', marginBottom: 12
    }}>{error}</div>}

    {/* KPI segmenti */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
      <KPI label="🟢 Champion"  icon="🟢" value={counts.champion}  sub={SEGMENTS.champion.desc}  accent="#10B981" />
      <KPI label="🔵 Loyal"     icon="🔵" value={counts.loyal}     sub={SEGMENTS.loyal.desc}     accent="#3B82F6" />
      <KPI label="🟡 At Risk"   icon="🟡" value={counts.at_risk}   sub={SEGMENTS.at_risk.desc}   accent="#F59E0B" />
      <KPI label="🔴 Lost"      icon="🔴" value={counts.lost}      sub={SEGMENTS.lost.desc}      accent="#EF4444" />
      <KPI label="⭐ New"       icon="⭐" value={counts.new}       sub={SEGMENTS.new.desc}       accent="#8B5CF6" />
      <KPI label="😐 One-Timer" icon="😐" value={counts.one_timer} sub={SEGMENTS.one_timer.desc} accent="#64748b" />
    </div>

    {/* Stats riassuntive */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
      <div style={{ ...S.card, padding: 14, borderLeft: '3px solid #10B981' }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Contattabili</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>{fmtN(contattabili)}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>con consenso marketing, non in blacklist</div>
      </div>
      <div style={{ ...S.card, padding: 14, borderLeft: '3px solid #3B82F6' }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Canali acquisizione</div>
        <div style={{ fontSize: 12, color: '#f1f5f9', marginTop: 4 }}>
          {Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: '#cbd5e1' }}>{k}</span>
              <span style={{ color: '#64748b', fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...S.card, padding: 14, borderLeft: '3px solid #F59E0B' }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Totale spesa CRM</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>{fmt(totalSpesa)}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>cumulativo su {classified.length} clienti</div>
      </div>
    </div>

    {/* Filtri: locale + segmento + ricerca + export */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Filtro locale */}
      <select value={locFilter} onChange={e => setLocFilter(e.target.value)} style={iS}>
        <option value="all">📍 Tutti i locali ({totalCustomers})</option>
        {allLocIds.map(id => (
          <option key={id} value={id}>{locations[id].name} ({locations[id].count || 0})</option>
        ))}
      </select>
      {/* Filtro segmento */}
      <select value={filter} onChange={e => setFilter(e.target.value)} style={iS}>
        <option value="all">📋 Tutti segmenti ({classified.length})</option>
        {Object.entries(SEGMENTS).map(([k, v]) => (
          <option key={k} value={k}>{v.label} ({counts[k] || 0})</option>
        ))}
      </select>
      <input
        placeholder="🔍 Cerca nome, email, telefono..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ ...iS, width: 240 }}
      />
      <div style={{ flex: 1 }} />
      <button
        onClick={exportCsv}
        disabled={!classified.length}
        style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
      >📥 Esporta CSV ({filter === 'all' ? classified.length : counts[filter] || 0})</button>
    </div>

    {/* Tabella clienti */}
    <Card title="Clienti" badge={`${filtered.length} mostrati${filtered.length >= 500 ? ' (prime 500)' : ''}`}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome', 'Contatto', 'Locale', 'Visite', 'Ultima', 'Speso', 'Segmento', 'Flag'].map(h =>
              <th key={h} style={S.th}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#64748b', padding: 20 }}>
                Nessun cliente corrispondente ai filtri.
              </td></tr>
            ) : filtered.map((c, i) => {
              const seg = SEGMENTS[c.__segment] || SEGMENTS.one_timer
              const locMeta = locations[String(c.locationID)]
              return (
                <tr key={c.elasticCustomerID || i} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...S.td, fontWeight: 500 }}>
                    {c.name} {c.lastname}
                    {c.flagVip === 1 && <span style={{ marginLeft: 6, fontSize: 10 }}>⭐</span>}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>
                    <div>{c.email || '—'}</div>
                    <div>{c.mobile || '—'}</div>
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>
                    {locMeta?.name || ('Loc ' + c.locationID)}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{c.__frequency}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>
                    {c.__recency >= 9999 ? '—' : `${c.__recency}gg fa`}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600, color: '#F59E0B' }}>{fmt(c.__monetary)}</td>
                  <td style={S.td}>
                    <span style={S.badge(seg.color, seg.color + '22')}>{seg.label}</span>
                  </td>
                  <td style={{ ...S.td, fontSize: 10 }}>
                    {c.flagMarketing === 1 && <span title="Consenso marketing" style={{ color: '#10B981' }}>📧 </span>}
                    {c.flagUnsubscribe === 1 && <span title="Disiscritto" style={{ color: '#EF4444' }}>🚫 </span>}
                    {c.flagBlacklist === 1 && <span title="Blacklist" style={{ color: '#EF4444' }}>⛔ </span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  </>
}
