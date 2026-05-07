import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import TimbraPage from './pages/TimbraPage'
import AdminPage from './pages/AdminPage'
import WaitingPage from './pages/WaitingPage'
import SetPasswordPage from './pages/SetPasswordPage'
import LottoPage from './pages/LottoPage'
import SurveyPage from './pages/SurveyPage'

// Detect magic link arrivato dal supabase auth redirect (invite o recovery).
// Nel hash dopo '#' c'e' qualcosa tipo: access_token=...&type=invite&...
function getMagicLinkType() {
  const hash = window.location.hash || ''
  if (!hash || !hash.includes('access_token=')) return null
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const type = params.get('type')
  if (type === 'invite' || type === 'recovery' || type === 'signup') return type
  return null
}

export default function App() {
  // Routing: /timbra pagina pubblica timbratura
  if (window.location.pathname === '/timbra' || window.location.search.includes('timbra=1')) {
    return <TimbraPage />
  }
  // Routing: /lotto/<codice> pagina pubblica tracciabilità lotto produzione (per ASL/clienti)
  if (window.location.pathname.startsWith('/lotto/')) {
    const code = decodeURIComponent(window.location.pathname.slice('/lotto/'.length).split('/')[0])
    return <LottoPage code={code} />
  }
  // Routing: /survey/<token> pagina pubblica compilazione sondaggio NPS
  if (window.location.pathname.startsWith('/survey/')) {
    const token = decodeURIComponent(window.location.pathname.slice('/survey/'.length).split('/')[0])
    return <SurveyPage token={token} />
  }
  // Routing: /admin pagina admin (richiede login + flag is_admin)
  const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
  const [session, setSession] = useState(undefined)
  const [settings, setSettings] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [magicLinkType, setMagicLinkType] = useState(() => getMagicLinkType())
  const lastFetchedUserId = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      // PASSWORD_RECOVERY = utente arrivato da link "password dimenticata"
      if (event === 'PASSWORD_RECOVERY') setMagicLinkType('recovery')
      // Evita re-render inutili se l'utente è lo stesso (es. TOKEN_REFRESHED al ritorno sul tab)
      setSession(prev => {
        if (prev?.user?.id === newSession?.user?.id && prev?.access_token === newSession?.access_token) return prev
        return newSession
      })
      if (!newSession) { setSettings(null); setMagicLinkType(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setSettings(null); lastFetchedUserId.current = null; return }
    // Skip refetch se le settings sono già state caricate per questo utente
    if (lastFetchedUserId.current === session.user.id) return
    lastFetchedUserId.current = session.user.id
    setLoadingSettings(true)
    ;(async () => {
      try {
        // Per uno staff: leggi user_settings dell'OWNER (employees.user_id),
        // non quelle dello staff stesso (che non esistono).
        const isStaff = session.user.user_metadata?.staff === true
        let ownerUserId = session.user.id
        if (isStaff) {
          const { data: emp } = await supabase
            .from('employees')
            .select('user_id')
            .eq('auth_user_id', session.user.id)
            .eq('stato', 'Attivo')
            .maybeSingle()
          if (emp?.user_id) ownerUserId = emp.user_id
        }
        const { data } = await supabase
          .from('user_settings')
          .select('*')
          .eq('user_id', ownerUserId)
          .maybeSingle()
        setSettings(data)
      } catch { setSettings(null) }
      finally { setLoadingSettings(false) }
    })()
  }, [session])

  const Spinner = () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2px solid var(--border-md)', borderTopColor: 'var(--blue)', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (session === undefined) return <Spinner />
  if (!session) return <AuthPage />
  // Magic link da invito o reset password pagina dedicata per impostare/cambiare password
  if (magicLinkType) return <SetPasswordPage mode={magicLinkType} email={session.user.email} />
  // /admin: serve essere loggati ma NON serve aver configurato la dashboard cliente
  if (isAdminRoute) return <AdminPage />
  // Mostra Spinner solo al PRIMO caricamento settings; i refetch successivi
  // (es. dopo TOKEN_REFRESHED) avvengono in background senza smontare la dashboard
  if (settings === null && loadingSettings) return <Spinner />
  // Account non ancora configurato dall'admin pagina di attesa
  // (la chiave CiC viene impostata da postmaster@alhenagroup.com tramite /admin)
  if (!settings?.cic_api_key) return <WaitingPage email={session.user.email} />
  return <DashboardPage settings={settings} />
}
