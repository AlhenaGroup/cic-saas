// Inventario v2: multi sub-location, tipi "apertura" e "regolare".
// Crea riga in warehouse_inventories + articoli in warehouse_inventory_items.
// Alla chiusura applica movimenti di correzione (o apertura) su article_stock.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmtD, fmtN } from '../shared/styles.jsx'
import {
  getSubLocationsMap, subLocationsFor, applyInventoryClose, applyInventoryOpening,
} from '../../lib/warehouse.js'

const iS = S.input

export default function InventoryManager({ sp, sps }) {
  const [inventories, setInventories] = useState([])
  const [loading, setLoading] = useState(true)
  const [subMap, setSubMap] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [openInv, setOpenInv] = useState(null)

  const selectedLocaleName = (!sp || sp === 'all') ? null :
    (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: invs }, map] = await Promise.all([
      supabase.from('warehouse_inventories').select('*').order('data', { ascending: false }).limit(30),
      getSubLocationsMap(),
    ])
    setInventories(invs || [])
    setSubMap(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return <>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      <button onClick={() => setShowNew(true)} disabled={!selectedLocaleName}
        style={{ ...iS, background: selectedLocaleName ? '#10B981' : '#1a1f2e', color: selectedLocaleName ? '#0f1420' : '#64748b', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: selectedLocaleName ? 'pointer' : 'not-allowed' }}>
        + Nuovo inventario
      </button>
      {!selectedLocaleName && <span style={{ fontSize: 12, color: '#64748b' }}>Seleziona un locale nell'header</span>}
    </div>

    <Card title="Sessioni inventario" badge={inventories.length + ' totali'}>
      {loading ? (
        <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
      ) : inventories.length === 0 ? (
        <div style={{ padding: 24, color: '#64748b', textAlign: 'center', lineHeight: 1.6, fontSize: 13 }}>
          Nessun inventario.<br/>
          <span style={{ fontSize: 11 }}>
            Il primo inventario di un locale dovrebbe essere di tipo <strong>🎯 Apertura</strong>: definisce le giacenze di partenza senza generare correzioni.<br/>
            Gli inventari successivi confrontano la giacenza teorica (da fatture + vendite) con quella reale e applicano le correzioni.
          </span>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Data', 'Locale', 'Sub', 'Tipo', 'Stato', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {inventories.map(inv => {
              const meta = (() => { try { return JSON.parse(inv.note || '{}') } catch { return {} } })()
              return <tr key={inv.id} onClick={() => setOpenInv(inv)} style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{inv.data}</td>
                <td style={S.td}>{meta.locale || '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{meta.sub_location || 'principale'}</td>
                <td style={S.td}>
                  {meta.tipo === 'apertura'
                    ? <span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>🎯 Apertura</span>
                    : <span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>📋 Regolare</span>}
                </td>
                <td style={S.td}>
                  {inv.stato === 'chiuso'
                    ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>✓ Chiuso</span>
                    : <span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>⏳ In corso</span>}
                </td>
                <td style={{ ...S.td, color: '#64748b' }}>→</td>
              </tr>
            })}
          </tbody>
        </table>
      )}
    </Card>

    {showNew && selectedLocaleName && (
      <NewInventoryModal locale={selectedLocaleName}
        subLocations={subLocationsFor(subMap, selectedLocaleName)}
        onClose={() => setShowNew(false)}
        onCreated={(inv) => { setShowNew(false); load(); setOpenInv(inv) }} />
    )}

    {openInv && (
      <InventoryDetail inventory={openInv} onClose={() => setOpenInv(null)} onChange={load} />
    )}
  </>
}

function NewInventoryModal({ locale, subLocations, onClose, onCreated }) {
  const [sub, setSub] = useState(subLocations[0] || 'principale')
  const [data, setData] = useState(new Date().toISOString().split('T')[0])
  const [tipo, setTipo] = useState('regolare')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('non autenticato')

      const { data: stockRows } = await supabase.from('article_stock').select('*')
        .eq('locale', locale).eq('sub_location', sub)
      const articoli = (stockRows || [])
      const articoliFiltered = tipo === 'apertura' ? articoli : articoli.filter(s => Number(s.quantita) > 0)

      const note = JSON.stringify({ locale, sub_location: sub, tipo })
      const { data: inv, error: invErr } = await supabase.from('warehouse_inventories').insert({
        user_id: user.id, data, stato: 'in_corso', note,
      }).select().single()
      if (invErr) throw invErr

      if (articoliFiltered.length > 0) {
        // Per aggirare product_id NOT NULL: usiamo stock.id come product_id (dummy)
        const items = articoliFiltered.map(s => ({
          inventory_id: inv.id,
          product_id: s.id,
          giacenza_teorica: tipo === 'apertura' ? 0 : Number(s.quantita || 0),
          giacenza_reale: null,
          note: JSON.stringify({
            nome_articolo: s.nome_articolo, unita: s.unita,
            prezzo_medio: s.prezzo_medio, sub_location: sub, locale,
          }),
        }))
        const { error: itErr } = await supabase.from('warehouse_inventory_items').insert(items)
        if (itErr) console.warn('Errore items:', itErr.message)
      }
      onCreated(inv)
    } catch (e) { alert(e.message); setCreating(false) }
  }

  return <Modal onClose={onClose} title="+ Nuovo inventario" maxWidth={520}>
    <Field label="Locale"><input value={locale} disabled style={{ ...iS, width: '100%', color: '#94a3b8' }} /></Field>
    <Field label="Sub-location">
      <select value={sub} onChange={e => setSub(e.target.value)} style={{ ...iS, width: '100%' }}>
        {subLocations.map(sl => <option key={sl} value={sl}>{sl}</option>)}
      </select>
    </Field>
    <Field label="Data"><input type="date" value={data} onChange={e => setData(e.target.value)} style={{ ...iS, width: '100%' }} /></Field>
    <Field label="Tipo">
      <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...iS, width: '100%' }}>
        <option value="regolare">📋 Regolare (confronta teorica, applica correzioni)</option>
        <option value="apertura">🎯 Apertura (fissa le giacenze di partenza, no correzioni)</option>
      </select>
    </Field>
    {tipo === 'apertura' && (
      <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, padding: 12, fontSize: 11, color: '#60A5FA', marginBottom: 16, lineHeight: 1.5 }}>
        <strong>🎯 Inventario di apertura:</strong> usalo SOLO la prima volta. Definirà le giacenze di partenza per questo locale/sub-location senza generare correzioni.
      </div>
    )}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
      <button onClick={create} disabled={creating}
        style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: creating ? 'wait' : 'pointer' }}>
        {creating ? 'Creo…' : 'Avanti → Conta articoli'}
      </button>
    </div>
  </Modal>
}

function InventoryDetail({ inventory, onClose, onChange }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const meta = (() => { try { return JSON.parse(inventory.note || '{}') } catch { return {} } })()
  const isApertura = meta.tipo === 'apertura'
  const isChiuso = inventory.stato === 'chiuso'

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('warehouse_inventory_items')
      .select('*').eq('inventory_id', inventory.id)
    const enriched = (data || []).map(it => {
      let m = {}
      try { m = JSON.parse(it.note || '{}') } catch {}
      return { ...it, ...m }
    })
    setItems(enriched)
    setLoading(false)
  }, [inventory.id])

  useEffect(() => { load() }, [load])

  const updateReale = async (itemId, val) => {
    const newReal = val === '' ? null : Number(val)
    const item = items.find(i => i.id === itemId)
    const diff = newReal != null ? newReal - Number(item.giacenza_teorica || 0) : null
    const valDiff = diff != null && item.prezzo_medio ? Math.round(diff * Number(item.prezzo_medio) * 100) / 100 : null
    await supabase.from('warehouse_inventory_items').update({
      giacenza_reale: newReal, differenza: diff, valore_differenza: valDiff,
    }).eq('id', itemId)
    load()
  }

  const closeInventory = async () => {
    if (!confirm(isApertura
      ? 'Confermi apertura inventario? Le giacenze reali saranno impostate come partenza.'
      : 'Confermi chiusura inventario? Le correzioni verranno applicate al magazzino.'))
      return
    setSaving(true)
    try {
      const rows = items
        .filter(it => it.giacenza_reale != null)
        .map(it => ({
          ...it,
          locale: meta.locale,
          sub_location: meta.sub_location || 'principale',
          inv_date: inventory.data,
        }))
      if (isApertura) await applyInventoryOpening(inventory.id, rows)
      else await applyInventoryClose(inventory.id, rows)
      await supabase.from('warehouse_inventories').update({ stato: 'chiuso' }).eq('id', inventory.id)
      onChange()
      onClose()
    } catch (e) { alert(e.message); setSaving(false) }
  }

  const filtered = search
    ? items.filter(i => (i.nome_articolo || '').toLowerCase().includes(search.toLowerCase()))
    : items

  const stats = useMemo(() => {
    let contati = 0, diffCount = 0, diffVal = 0, byStaff = 0, userAdded = 0
    items.forEach(it => {
      if (it.giacenza_reale != null) contati++
      if (it.counted_by_name) byStaff++
      if (it.is_user_added) userAdded++
      const d = Number(it.giacenza_reale || 0) - Number(it.giacenza_teorica || 0)
      if (Math.abs(d) > 0.001) diffCount++
      if (it.valore_differenza) diffVal += Number(it.valore_differenza)
    })
    return { contati, diffCount, diffVal, byStaff, userAdded }
  }, [items])

  const userAddedItems = useMemo(() => items.filter(it => it.is_user_added), [items])

  return <Modal onClose={onClose}
    title={`📋 Inventario ${inventory.data}`}
    subtitle={`${meta.locale || '—'}${meta.sub_location && meta.sub_location !== 'principale' ? ' / ' + meta.sub_location : ''} · ${isApertura ? '🎯 Apertura' : '📋 Regolare'} · ${isChiuso ? 'Chiuso' : 'In corso'}`}
    maxWidth={880}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${3 + (stats.byStaff > 0 ? 1 : 0) + (stats.userAdded > 0 ? 1 : 0)}, 1fr)`, gap: 10, marginBottom: 14 }}>
      <KpiMini label="Articoli contati" value={`${stats.contati}/${items.length}`} />
      {stats.byStaff > 0 && <KpiMini label="Da collaboratori" value={`${stats.byStaff}/${stats.contati}`} color="#3B82F6" />}
      {stats.userAdded > 0 && <KpiMini label="Aggiunti dallo staff" value={stats.userAdded} color="#10B981" />}
      {!isApertura && <KpiMini label="Differenze" value={stats.diffCount} />}
      {!isApertura && <KpiMini label="Valore diff." value={fmtD(stats.diffVal)} color={stats.diffVal < 0 ? '#EF4444' : '#10B981'} />}
      {isApertura && <KpiMini label="Tipo" value="🎯 Apertura" color="#3B82F6" />}
      {isApertura && <KpiMini label="Effetto" value="No correzioni" color="#94a3b8" />}
    </div>

    {userAddedItems.length > 0 && (
      <div style={{ marginBottom: 14, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#10B981', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          ➕ Articoli aggiunti dai collaboratori durante l'inventario
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>({userAddedItems.length})</span>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
          Questi articoli non erano in giacenza né in fattura — alla chiusura inventario verranno creati come carichi sullo stock.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid rgba(16,185,129,.3)' }}>
            {['Articolo', 'Magazzino', 'UM', 'Quantità', 'Aggiunto da', ''].map(h => <th key={h} style={{ ...S.th, color: '#10B981' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {userAddedItems.map(it => {
              const ts = it.counted_at ? new Date(it.counted_at) : null
              const tsStr = ts ? ts.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
              return <tr key={it.id} style={{ borderBottom: '1px solid rgba(16,185,129,.15)' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{it.nome_articolo}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 11 }}>{it.magazzino || '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{it.unita || '—'}</td>
                <td style={{ ...S.td, fontWeight: 700, color: '#10B981' }}>{it.giacenza_reale != null ? fmtN(it.giacenza_reale) : '—'}</td>
                <td style={{ ...S.td, fontSize: 11 }}>
                  <div style={{ color: '#3B82F6', fontWeight: 600 }}>{it.counted_by_name || '—'}</div>
                  {tsStr && <div style={{ color: '#64748b', fontSize: 10 }}>{tsStr}</div>}
                </td>
                <td style={S.td}>
                  {!isChiuso && <button onClick={async () => {
                    if (!confirm(`Eliminare "${it.nome_articolo}" dall'inventario?`)) return
                    await supabase.from('warehouse_inventory_items').delete().eq('id', it.id)
                    load()
                  }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>✕</button>}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {!isChiuso && (
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input placeholder="🔍 Cerca articolo..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...iS, flex: 1 }} />
      </div>
    )}

    {loading ? (
      <div style={{ padding: 20, color: '#64748b' }}>Caricamento…</div>
    ) : items.length === 0 ? (
      <div style={{ padding: 20, color: '#64748b', fontSize: 12 }}>
        Nessun articolo nell'inventario. Probabilmente il locale non ha giacenze registrate.
        Per iniziare, aggiungi movimenti manuali o importa fatture con locale assegnato.
      </div>
    ) : (
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#131825' }}>
            <tr style={{ borderBottom: '1px solid #2a3042' }}>
              {(isApertura
                ? ['Articolo', 'UM', 'Giac. reale', 'Valore', 'Contato da']
                : ['Articolo', 'UM', 'Teorica', 'Reale', 'Diff', 'Valore diff', 'Contato da']
              ).map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map(it => {
              const teo = Number(it.giacenza_teorica || 0)
              const real = it.giacenza_reale == null ? '' : Number(it.giacenza_reale)
              const diff = real === '' ? null : real - teo
              const valDiff = diff != null && it.prezzo_medio ? diff * Number(it.prezzo_medio) : null
              const byCollab = !!it.counted_by_name
              const collabBg = byCollab ? 'rgba(59,130,246,.08)' : 'transparent'
              const collabColor = byCollab ? '#3B82F6' : '#e2e8f0'
              const ts = it.counted_at ? new Date(it.counted_at) : null
              const tsStr = ts ? ts.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
              return <tr key={it.id} style={{ borderBottom: '1px solid #1a1f2e', background: collabBg }}>
                <td style={{ ...S.td, fontWeight: 500 }}>{it.nome_articolo || '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{it.unita || '—'}</td>
                {!isApertura && <td style={{ ...S.td, color: '#94a3b8' }}>{fmtN(teo)}</td>}
                <td style={{ ...S.td, padding: 4 }}>
                  {isChiuso ? <span style={{ color: collabColor, fontWeight: byCollab ? 700 : 500 }}>{real}</span> : (
                    <input type="number" step="0.01"
                      defaultValue={real}
                      key={it.id + '-' + real}
                      onBlur={e => updateReale(it.id, e.target.value)}
                      style={{ ...iS, width: 80, textAlign: 'center', color: collabColor, fontWeight: byCollab ? 700 : 500, borderColor: byCollab ? '#3B82F6' : '#2a3042' }}
                      title={byCollab ? `Contato da ${it.counted_by_name} il ${tsStr}` : ''} />
                  )}
                </td>
                {!isApertura && <td style={{ ...S.td, color: diff > 0 ? '#10B981' : diff < 0 ? '#EF4444' : '#94a3b8', fontWeight: 600 }}>
                  {diff == null ? '—' : (diff > 0 ? '+' : '') + fmtN(diff)}
                </td>}
                {!isApertura && <td style={{ ...S.td, color: valDiff > 0 ? '#10B981' : valDiff < 0 ? '#EF4444' : '#94a3b8', fontWeight: 600 }}>
                  {valDiff == null ? '—' : fmtD(valDiff)}
                </td>}
                {isApertura && <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>
                  {real === '' ? '—' : fmtD(Number(real) * Number(it.prezzo_medio || 0))}
                </td>}
                <td style={{ ...S.td, fontSize: 11 }}>
                  {byCollab
                    ? <div style={{ color: '#3B82F6' }}>
                        <div style={{ fontWeight: 600 }}>👤 {it.counted_by_name}</div>
                        {tsStr && <div style={{ color: '#64748b', fontSize: 10 }}>{tsStr}</div>}
                      </div>
                    : <span style={{ color: '#475569' }}>—</span>}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {!isChiuso && (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a3042' }}>
        <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Chiudi senza salvare</button>
        <button onClick={closeInventory} disabled={saving}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Applico…' : (isApertura ? '✓ Conferma apertura' : '✓ Chiudi e correggi')}
        </button>
      </div>
    )}
  </Modal>
}

function KpiMini({ label, value, color = '#F59E0B' }) {
  return <div style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 10 }}>
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
  </div>
}

function Modal({ title, subtitle, maxWidth = 560, onClose, children }) {
  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth }}>
      <div style={{ padding: 16, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <label style={{ display: 'block', marginBottom: 10 }}>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
    {children}
  </label>
}
