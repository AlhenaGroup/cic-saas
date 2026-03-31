import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import SetupPage from './pages/SetupPage'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [settings, setSettings] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (!session) setSettings(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setSettings(null); return }
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

  if (session === undefined || loadingSettings) return <Spinner />
  if (!session) return <AuthPage />
  if (!settings?.cic_api_key) return <SetupPage onSaved={handleSettingsSaved} />
  return <DashboardPage settings={settings} />
}
