// ─── Feature flags & widget abilitati per utente ────────────────────────────
//
// Architettura:
// - feature_plans: catalogo dei piani (Full, Starter, Pro, ecc.) con set di
//   tab/widget abilitati come jsonb { tabs: [...], widgets: [...] }.
//   Il valore '*' per widgets significa "tutti i widget di tutti i tab".
// - user_plans: assegnazione utente → piano (uno per utente).
// - user_feature_overrides: extra/escludi rispetto al piano (per casi singoli).
// - user_widget_layout: ordine + visibilita' widget personalizzati dal cliente.
//
// Hook esposti:
//   useUserPlan()             → { plan, features, loading }
//   useFeature('tab.iva')     → boolean
//   useFeature('widget.kpi.ricavi') → boolean
//   useUserLayout(tabKey)     → { layout, setLayout, loading } (per Step 5)

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './supabase'

// ─── Cache in memoria delle feature dell'utente corrente ───────────────────
let _cache = null  // { user_id, features: { tabs:Set, widgets:Set, allWidgets:bool } }
const _listeners = new Set()

function notify() {
  for (const fn of _listeners) {
    try { fn() } catch {}
  }
}

async function loadFeaturesFromDb() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    _cache = null; notify(); return null
  }
  // 1) Piano dell'utente
  const { data: up } = await supabase
    .from('user_plans')
    .select('plan_id, active, valid_until, feature_plans!inner(features)')
    .eq('user_id', user.id)
    .single()
  // Se nessun piano assegnato → 'full' di default (dietro le quinte)
  let planFeatures = up?.feature_plans?.features || null
  if (!planFeatures) {
    const { data: defPlan } = await supabase
      .from('feature_plans')
      .select('features')
      .eq('is_default', true)
      .limit(1).single()
    planFeatures = defPlan?.features || { tabs: [], widgets: [] }
  }
  // 2) Override dell'utente
  const { data: ov } = await supabase
    .from('user_feature_overrides')
    .select('extra, exclude')
    .eq('user_id', user.id)
    .maybeSingle()
  const extra = ov?.extra || { tabs: [], widgets: [] }
  const exclude = ov?.exclude || { tabs: [], widgets: [] }

  // 3) Combinazione finale
  const tabs = new Set([...(planFeatures.tabs || []), ...(extra.tabs || [])])
  ;(exclude.tabs || []).forEach(t => tabs.delete(t))
  const widgets = new Set([...(planFeatures.widgets || []), ...(extra.widgets || [])])
  ;(exclude.widgets || []).forEach(w => widgets.delete(w))
  const allWidgets = widgets.has('*')

  _cache = { user_id: user.id, features: { tabs, widgets, allWidgets } }
  notify()
  return _cache.features
}

// Hook principale: ritorna { features, loading, reload }
export function useUserPlan() {
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(!_cache)

  useEffect(() => {
    const trigger = () => setTick(t => t + 1)
    _listeners.add(trigger)
    if (!_cache) {
      loadFeaturesFromDb().finally(() => setLoading(false))
    }
    return () => { _listeners.delete(trigger) }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    await loadFeaturesFromDb()
    setLoading(false)
  }, [])

  return { features: _cache?.features || null, loading, reload }
}

// ─── Hook helper: useFeature('tab.iva') o useFeature('widget.kpi.ricavi') ──
export function useFeature(key) {
  const { features } = useUserPlan()
  return useMemo(() => {
    if (!features) return true // fallback ottimistico in caricamento
    if (key.startsWith('tab.')) {
      const id = key.slice(4)
      return features.tabs.has(id)
    }
    if (key.startsWith('widget.')) {
      const id = key.slice(7)
      return features.allWidgets || features.widgets.has(id)
    }
    return true
  }, [features, key])
}

// ─── Layout widget personalizzato (Step 5: drag&drop) ──────────────────────
export function useUserLayout(tabKey) {
  const [layout, setLayoutState] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLayoutState([]); setLoading(false); return }
      const { data } = await supabase
        .from('user_widget_layout')
        .select('layout')
        .eq('user_id', user.id)
        .eq('tab_key', tabKey)
        .maybeSingle()
      if (!alive) return
      setLayoutState(data?.layout || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [tabKey])

  const setLayout = useCallback(async (newLayout) => {
    setLayoutState(newLayout)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_widget_layout').upsert({
      user_id: user.id,
      tab_key: tabKey,
      layout: newLayout,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tab_key' })
  }, [tabKey])

  return { layout, setLayout, loading }
}

// Reset cache quando l'utente fa logout o cambia (chiamato da App.jsx)
export function clearFeaturesCache() {
  _cache = null
  notify()
}

// ─── Admin ─────────────────────────────────────────────────────────────────
let _adminCache = null  // { user_id, role } | { isAdmin: false }
const _adminListeners = new Set()

async function loadAdminFromDb() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { _adminCache = { isAdmin: false }; for (const fn of _adminListeners) fn(); return }
  const { data } = await supabase
    .from('admins')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  _adminCache = data ? { isAdmin: true, role: data.role, user_id: user.id } : { isAdmin: false }
  for (const fn of _adminListeners) fn()
}

export function useIsAdmin() {
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(_adminCache === null)
  useEffect(() => {
    const trigger = () => setTick(t => t + 1)
    _adminListeners.add(trigger)
    if (_adminCache === null) {
      loadAdminFromDb().finally(() => setLoading(false))
    }
    return () => { _adminListeners.delete(trigger) }
  }, [])
  return { isAdmin: _adminCache?.isAdmin === true, role: _adminCache?.role, loading }
}

export function clearAdminCache() {
  _adminCache = null
  for (const fn of _adminListeners) fn()
}
