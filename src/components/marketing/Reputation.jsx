import { useState, useEffect, useCallback } from 'react'
import { S, Card, KPI, fmtN } from '../shared/styles.jsx'

// ─── Storage keys ──────────────────────────────────────────────────────────
const LS_GOOGLE_REFRESH = 'cic_google_refresh_token'
const LS_GOOGLE_EMAIL   = 'cic_google_account_email'
const LS_GOOGLE_LOCS    = 'cic_google_locations'        // cache delle location [{name,title,placeId,...}]
const LS_TA_URLS        = 'cic_tripadvisor_urls'        // map {label: url}
const LS_TA_CACHE       = 'cic_tripadvisor_cache'       // map {url: {rating,reviewCount,reviews,fetchedAt}}
const LS_GBP_CACHE      = 'cic_gbp_place_cache'         // map {placeId: {rating,count,reviews,fetchedAt}}

function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v } catch { return fallback }
}
function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

// ─── Star display ──────────────────────────────────────────────────────────
function Stars({ rating, max = 5 }) {
  if (rating == null || isNaN(rating)) return <span style={{ color: '#64748b', fontSize: 12 }}>—</span>
  const full = Math.floor(rating)
  const half = rating - full >= 0.25 && rating - full < 0.75
  const empty = max - full - (half ? 1 : 0)
  return <span style={{ letterSpacing: '.05em' }}>
    {'★'.repeat(full)}{half ? '☆' : ''}{'☆'.repeat(empty)}
  </span>
}

function ratingColor(r) {
  if (r == null) return '#64748b'
  if (r >= 4.5) return '#10B981'
  if (r >= 4.0) return '#84CC16'
  if (r >= 3.5) return '#F59E0B'
  if (r >= 3.0) return '#F97316'
  return '#EF4444'
}

// ─── Componente ────────────────────────────────────────────────────────────
export default function Reputation({ sp, sps, from, to }) {
  const [googleRefresh, setGoogleRefresh] = useState(() => localStorage.getItem(LS_GOOGLE_REFRESH) || '')
  const [googleEmail,   setGoogleEmail]   = useState(() => localStorage.getItem(LS_GOOGLE_EMAIL) || '')
  const [googleLocs,    setGoogleLocs]    = useState(() => loadJson(LS_GOOGLE_LOCS, []))
  const [gbpCache,      setGbpCache]      = useState(() => loadJson(LS_GBP_CACHE, {}))

  const [taUrls,   setTaUrls]   = useState(() => loadJson(LS_TA_URLS, {
    'CASA DE AMICIS': 'https://www.tripadvisor.it/Restaurant_Review-g616182-d26451105-Reviews-Casa_De_Amicis-Pinerolo_Province_of_Turin_Piedmont.html',
    'REMEMBEER':      'https://www.tripadvisor.it/Restaurant_Review-g616182-d4570375-Reviews-Remembeer-Pinerolo_Province_of_Turin_Piedmont.html'
  }))
  const [taCache, setTaCache] = useState(() => loadJson(LS_TA_CACHE, {}))

  const [loading, setLoading] = useState({})
  const [error,   setError]   = useState('')

  const iS = S.input

  // Persistenza
  useEffect(() => { saveJson(LS_GOOGLE_LOCS, googleLocs) }, [googleLocs])
  useEffect(() => { saveJson(LS_GBP_CACHE, gbpCache) }, [gbpCache])
  useEffect(() => { saveJson(LS_TA_URLS, taUrls) }, [taUrls])
  useEffect(() => { saveJson(LS_TA_CACHE, taCache) }, [taCache])

  // ─── Google OAuth popup flow ─────────────────────────────────────────────
  const connectGoogle = () => {
    const popup = window.open('/api/reputation?action=oauth-start', 'google-oauth', 'width=520,height=640,left=' + (window.innerWidth - 520) / 2 + ',top=' + (window.innerHeight - 640) / 2)
    const listener = (e) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === 'google-oauth-success') {
        localStorage.setItem(LS_GOOGLE_REFRESH, e.data.refresh_token)
        if (e.data.email) localStorage.setItem(LS_GOOGLE_EMAIL, e.data.email)
        setGoogleRefresh(e.data.refresh_token)
        setGoogleEmail(e.data.email || '')
        window.removeEventListener('message', listener)
        popup?.close()
        // Auto-fetch delle location
        setTimeout(() => fetchGoogleLocations(e.data.refresh_token), 200)
      } else if (e.data.type === 'google-oauth-error') {
        setError('Google OAuth: ' + e.data.error)
        window.removeEventListener('message', listener)
      }
    }
    window.addEventListener('message', listener)
  }

  const disconnectGoogle = () => {
    if (!confirm('Disconnettere Google? Dovrai rifare l\'OAuth per riconnetterti.')) return
    localStorage.removeItem(LS_GOOGLE_REFRESH)
    localStorage.removeItem(LS_GOOGLE_EMAIL)
    setGoogleRefresh('')
    setGoogleEmail('')
    setGoogleLocs([])
  }

  const fetchGoogleLocations = useCallback(async (token) => {
    const rt = token || googleRefresh
    if (!rt) return
    setLoading(l => ({ ...l, google: true })); setError('')
    try {
      // 1. Lista accounts
      const accRes = await fetch('/api/reputation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-accounts', refreshToken: rt })
      })
      const accData = await accRes.json()
      if (!accRes.ok) throw new Error(accData.error || 'list-accounts failed')
      const accounts = accData.accounts || []
      if (accounts.length === 0) {
        setError('Nessun account Business Profile trovato. Assicurati di essere Manager/Proprietario di almeno una scheda Google.')
        setLoading(l => ({ ...l, google: false }))
        return
      }

      // 2. Per ogni account, lista le locations
      const allLocs = []
      for (const acc of accounts) {
        const locRes = await fetch('/api/reputation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list-locations', refreshToken: rt, accountName: acc.name })
        })
        const locData = await locRes.json()
        if (locRes.ok && locData.locations) {
          allLocs.push(...locData.locations.map(l => ({ ...l, accountName: acc.name, accountLabel: acc.accountName })))
        }
      }
      setGoogleLocs(allLocs)

      // 3. Per ogni location con placeId, fetch rating/count da Places API
      const newCache = { ...gbpCache }
      for (const loc of allLocs) {
        if (!loc.placeId) continue
        try {
          const pdRes = await fetch('/api/reputation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'place-details', placeId: loc.placeId })
          })
          const pdData = await pdRes.json()
          if (pdRes.ok) {
            newCache[loc.placeId] = { ...pdData, fetchedAt: new Date().toISOString() }
          }
        } catch {}
      }
      setGbpCache(newCache)
    } catch (e) {
      setError('Google: ' + e.message)
    }
    setLoading(l => ({ ...l, google: false }))
  }, [googleRefresh, gbpCache])

  // ─── TripAdvisor fetch ───────────────────────────────────────────────────
  const fetchTripadvisor = async (label, url) => {
    if (!url) return
    setLoading(l => ({ ...l, ['ta_' + label]: true })); setError('')
    try {
      const r = await fetch('/api/reputation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tripadvisor', url })
      })
      const data = await r.json()
      if (data.blocked) {
        setError(`TripAdvisor: ${data.message}`)
      } else if (data.error) {
        setError(`TripAdvisor ${label}: ${data.error}`)
      } else {
        setTaCache(prev => ({ ...prev, [url]: { ...data, fetchedAt: new Date().toISOString() } }))
      }
    } catch (e) {
      setError(`TripAdvisor ${label}: ` + e.message)
    }
    setLoading(l => ({ ...l, ['ta_' + label]: false }))
  }

  const fetchAllTripadvisor = async () => {
    for (const [label, url] of Object.entries(taUrls)) {
      if (url) await fetchTripadvisor(label, url)
    }
  }

  const updateTaUrl = (label, url) => {
    setTaUrls(prev => ({ ...prev, [label]: url }))
  }
  const addTaLocation = () => {
    const label = prompt('Nome del locale (es. BIANCOLATTE):')
    if (!label) return
    setTaUrls(prev => ({ ...prev, [label]: '' }))
  }
  const removeTaLocation = (label) => {
    if (!confirm('Rimuovere ' + label + '?')) return
    setTaUrls(prev => { const n = { ...prev }; delete n[label]; return n })
  }

  // ─── KPI riassuntivi ─────────────────────────────────────────────────────
  const googleRatings = googleLocs.map(l => {
    const cache = l.placeId ? gbpCache[l.placeId] : null
    return cache?.rating || null
  }).filter(r => r != null)
  const avgGoogleRating = googleRatings.length
    ? googleRatings.reduce((a, b) => a + b, 0) / googleRatings.length
    : null
  const totalGoogleReviews = googleLocs.reduce((tot, l) => {
    const cache = l.placeId ? gbpCache[l.placeId] : null
    return tot + (cache?.userRatingCount || 0)
  }, 0)

  const taRatings = Object.values(taUrls).map(url => taCache[url]?.rating).filter(r => r != null)
  const avgTaRating = taRatings.length ? taRatings.reduce((a, b) => a + b, 0) / taRatings.length : null
  const totalTaReviews = Object.values(taUrls).reduce((tot, url) => tot + (taCache[url]?.reviewCount || 0), 0)

  // ─── Render ──────────────────────────────────────────────────────────────
  return <>
    {error && <div style={{
      background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#FCA5A5', marginBottom: 12
    }}>{error}</div>}

    {/* KPI summary */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
      <div style={{ ...S.card, padding: 14, borderLeft: `3px solid ${ratingColor(avgGoogleRating)}` }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>🔴 Google</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>{avgGoogleRating ? avgGoogleRating.toFixed(2) : '—'}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{totalGoogleReviews} recensioni · {googleLocs.length} locali</div>
      </div>
      <div style={{ ...S.card, padding: 14, borderLeft: `3px solid ${ratingColor(avgTaRating)}` }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>🟢 TripAdvisor</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>{avgTaRating ? avgTaRating.toFixed(2) : '—'}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{totalTaReviews} recensioni · {Object.keys(taUrls).length} locali</div>
      </div>
      <div style={{ ...S.card, padding: 14, borderLeft: '3px solid #64748b' }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>🟠 TheFork</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#64748b' }}>—</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>In configurazione (next PR)</div>
      </div>
      <div style={{ ...S.card, padding: 14, borderLeft: '3px solid #F59E0B' }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>📊 Media complessiva</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: ratingColor((avgGoogleRating + avgTaRating) / 2) }}>
          {(avgGoogleRating || avgTaRating)
            ? (((avgGoogleRating || 0) + (avgTaRating || 0)) / ((avgGoogleRating ? 1 : 0) + (avgTaRating ? 1 : 0))).toFixed(2)
            : '—'}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>su {googleRatings.length + taRatings.length} sorgenti</div>
      </div>
    </div>

    {/* ─── Google Business Profile ─────────────────────────────────────────── */}
    <Card
      title="🔴 Google Business Profile"
      badge={googleRefresh ? `Connesso ${googleEmail || ''}` : 'Non connesso'}
      extra={<div style={{ display: 'flex', gap: 8 }}>
        {googleRefresh ? <>
          <button
            onClick={() => fetchGoogleLocations()}
            disabled={loading.google}
            style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 14px', fontWeight: 600, cursor: loading.google ? 'wait' : 'pointer' }}
          >{loading.google ? 'Aggiornamento…' : '⚡ Aggiorna'}</button>
          <button
            onClick={disconnectGoogle}
            style={{ ...iS, color: '#EF4444', border: '1px solid rgba(239,68,68,.3)', padding: '6px 12px', cursor: 'pointer' }}
          >Disconnetti</button>
        </> : <button
          onClick={connectGoogle}
          style={{ ...iS, background: '#4285F4', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
        >🔑 Connetti Google</button>}
      </div>}
    >
      {!googleRefresh ? (
        <div style={{ padding: 16, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          Clicca <strong>Connetti Google</strong> per autorizzare l'accesso al tuo Business Profile.
          Riceverai una popup Google dove accettare i permessi. Dopo l'autorizzazione vedrai la lista dei locali che gestisci con rating e numero di recensioni.
          <br /><br />
          <span style={{ color: '#64748b', fontSize: 11 }}>
            ⚠️ Se ricevi "app non verificata": è normale in modalità Test. Clicca "Avanzate" → "Vai a Reputation (non sicura)" → Continua.
          </span>
        </div>
      ) : googleLocs.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
          {loading.google ? 'Caricamento locations…' : 'Nessuna location caricata. Clicca "Aggiorna".'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, padding: 4 }}>
          {googleLocs.map(loc => {
            const pd = loc.placeId ? gbpCache[loc.placeId] : null
            return (
              <div key={loc.name} style={{ ...S.card, padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>{loc.title || 'Senza titolo'}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{loc.address || '—'}</div>
                {pd?.rating ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: ratingColor(pd.rating) }}>{pd.rating.toFixed(1)}</div>
                    <div>
                      <div style={{ color: ratingColor(pd.rating), fontSize: 14 }}><Stars rating={pd.rating} /></div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{pd.userRatingCount} recensioni</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {pd?.warning || 'Rating non disponibile (richiede GOOGLE_PLACES_API_KEY su Vercel)'}
                  </div>
                )}
                {pd?.reviews && pd.reviews.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px solid #1e2636', paddingTop: 10 }}>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Ultima recensione</div>
                    <div style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>"{(pd.reviews[0].text || '').substring(0, 160)}..."</div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>— {pd.reviews[0].authorName} · {pd.reviews[0].relativeTime}</div>
                  </div>
                )}
                {loc.newReviewUri && (
                  <a href={loc.newReviewUri} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#3B82F6', marginTop: 8, display: 'inline-block' }}>
                    ↗ Apri scheda Google
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>

    {/* ─── TripAdvisor ─────────────────────────────────────────────────────── */}
    <Card
      title="🟢 TripAdvisor"
      badge={`${Object.keys(taUrls).length} locali`}
      extra={<div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={fetchAllTripadvisor}
          disabled={Object.keys(loading).some(k => k.startsWith('ta_') && loading[k])}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
        >⚡ Aggiorna tutti</button>
        <button
          onClick={addTaLocation}
          style={{ ...iS, color: '#10B981', border: '1px solid rgba(16,185,129,.3)', padding: '6px 12px', cursor: 'pointer' }}
        >+ Aggiungi locale</button>
      </div>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, padding: 4 }}>
        {Object.entries(taUrls).map(([label, url]) => {
          const cache = taCache[url]
          const isLoading = loading['ta_' + label]
          return (
            <div key={label} style={{ ...S.card, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', flex: 1 }}>{label}</div>
                <button onClick={() => removeTaLocation(label)} title="Rimuovi" style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>
              </div>
              <input
                value={url}
                onChange={e => updateTaUrl(label, e.target.value)}
                placeholder="https://www.tripadvisor.it/Restaurant_Review-..."
                style={{ ...iS, width: '100%', fontSize: 10, marginBottom: 8 }}
              />
              {cache ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: ratingColor(cache.rating) }}>{cache.rating?.toFixed(1) || '—'}</div>
                    <div>
                      <div style={{ color: ratingColor(cache.rating), fontSize: 14 }}><Stars rating={cache.rating} /></div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{cache.reviewCount} recensioni</div>
                    </div>
                  </div>
                  {cache.reviews && cache.reviews.length > 0 && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #1e2636', paddingTop: 10 }}>
                      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Ultima recensione</div>
                      <div style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>"{(cache.reviews[0].text || '').substring(0, 160)}..."</div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>— {cache.reviews[0].authorName}</div>
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: '#475569', marginTop: 6 }}>Aggiornato: {new Date(cache.fetchedAt).toLocaleString('it-IT')}</div>
                </>
              ) : (
                <button
                  onClick={() => fetchTripadvisor(label, url)}
                  disabled={!url || isLoading}
                  style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 600, cursor: 'pointer', width: '100%' }}
                >{isLoading ? 'Caricamento…' : '📥 Fetch'}</button>
              )}
            </div>
          )
        })}
      </div>
    </Card>

    {/* ─── TheFork placeholder ─────────────────────────────────────────────── */}
    <Card title="🟠 TheFork" badge="In sviluppo">
      <div style={{ padding: 16, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        Integrazione TheFork nella prossima PR quando mi passerai i 3 URL delle schede pubbliche.
      </div>
    </Card>
  </>
}
