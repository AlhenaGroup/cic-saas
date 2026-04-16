import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import SetupPage from './pages/SetupPage'
import DashboardPage from './pages/DashboardPage'
import TimbraPage from './pages/TimbraPage'

export default function App() {
  // Routing: /timbra → pagina pubblica timbratura
  if (window.location.pathname === '/timbra' || window.location.search.includes('timbra=1')) {
    return <TimbraPage />
  }
  const [session, setSession] = useState(undefined)
  const [settings, setSettings] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const lastFetchedUserId = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, newSession) => {
      // Evita re-render inutili se l'utente è lo stesso (es. TOKEN_REFRESHED al ritorno sul tab)
      setSession(prev => {
        if (prev?.user?.id === newSession?.user?.id && prev?.access_token === newSession?.access_token) return prev
        return newSession
      })
      if (!newSession) setSettings(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setSettings(null); lastFetchedUserId.current = null; return }
    // Skip refetch se le settings sono già state caricate per questo utente
    if (lastFetchedUserId.current === session.user.id) return
    lastFetchedUserId.current = session.user.id
    setLoadingSettings(true)
    supabase.from('user_settings').select('*').eq('user_id', session.user.id).single()
      .then(({ data }) => { setSettings(data); setLoadingSettings(false) })
      .catch(() => { setSettings(null); setLoadingSettings(false) })
  }, [session])

  function handleSettingsSaved() {
    if (!session?.user) return
    supabase.from('user_settings').select('*').eq('user_id', session.user.id).single()
      .then(({ data }) => setSettings(data))
  }

  const Spinner = () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2px solid var(--border-md)', borderTopColor: 'var(--blue)', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (session === undefined) return <Spinner />
  if (!session) return <AuthPage />
  // Mostra Spinner solo al PRIMO caricamento settings; i refetch successivi
  // (es. dopo TOKEN_REFRESHED) avvengono in background senza smontare la dashboard
  if (settings === null && loadingSettings) return <Spinner />
  if (!settings?.cic_api_key) return <SetupPage onSaved={handleSettingsSaved} />
  return <DashboardPage settings={settings} />
}
