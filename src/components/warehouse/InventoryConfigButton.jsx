// Bottone + popover modale per configurare la modalità di conteggio inventario
// di un articolo. Usato in: ArticoliTab, InventoryManager, TimbraPage (mobile).

import { useState, useEffect } from 'react'
import { upsertConfig, deleteConfig } from '../../lib/inventoryConfig'

export default function InventoryConfigButton({ locale, nomeArticolo, currentConfig, onSaved, label = '', size = 'sm', style = {} }) {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setCfg({
        modalita: currentConfig?.modalita || 'unita',
        volume_pezzo: currentConfig?.volume_pezzo || 0.75,
        unita_pezzo: currentConfig?.unita_pezzo || 'pz',
        unita_apertura: currentConfig?.unita_apertura || 'ml',
      })
    }
  }, [open, currentConfig])

  const save = async () => {
    setSaving(true)
    try {
      await upsertConfig({
        locale, nome_articolo: nomeArticolo,
        ...cfg,
      })
      onSaved && onSaved()
      setOpen(false)
    } catch (e) { alert('Errore: ' + e.message) }
    finally { setSaving(false) }
  }

  const reset = async () => {
    if (!confirm('Riportare a modalità unità (litri come oggi)?')) return
    try {
      await deleteConfig(locale, nomeArticolo)
      onSaved && onSaved()
      setOpen(false)
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const hasConfig = currentConfig?.modalita === 'pezzi'
  const btnStyle = size === 'sm'
    ? { width: 24, height: 24, padding: 0, fontSize: 12, background: hasConfig ? '#F59E0B22' : 'transparent', color: hasConfig ? '#F59E0B' : '#94a3b8', border: '1px solid ' + (hasConfig ? '#F59E0B55' : '#2a3042'), borderRadius: 4, cursor: 'pointer', ...style }
    : { padding: '6px 10px', fontSize: 12, background: hasConfig ? '#F59E0B22' : '#1a1f2e', color: hasConfig ? '#F59E0B' : '#cbd5e1', border: '1px solid ' + (hasConfig ? '#F59E0B55' : '#2a3042'), borderRadius: 5, cursor: 'pointer', ...style }

  return <>
    <button onClick={(e) => { e.stopPropagation(); setOpen(true) }} title={hasConfig ? `Pezzi: ${currentConfig.volume_pezzo} L/pz` : 'Configura conteggio inventario'} style={btnStyle}>
      {label}
    </button>

    {open && cfg && <div onClick={() => setOpen(false)} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>Conteggio inventario</h3>
          <button onClick={() => setOpen(false)} style={closeBtn}></button>
        </div>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 12 }}><b>{nomeArticolo}</b></div>

        {/* Modalità */}
        <div style={{ marginBottom: 14 }}>
          <div style={lab}>Modalità conteggio</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setCfg({ ...cfg, modalita: 'unita' })} style={pill(cfg.modalita === 'unita')}>
              <div style={{ fontWeight: 600 }}>Unità ricetta</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>Un solo numero (litri/kg)</div>
            </button>
            <button onClick={() => setCfg({ ...cfg, modalita: 'pezzi' })} style={pill(cfg.modalita === 'pezzi')}>
              <div style={{ fontWeight: 600 }}>Pezzi + aperto</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>Bottiglie chiuse + residuo</div>
            </button>
          </div>
        </div>

        {cfg.modalita === 'pezzi' && <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <Field label="Volume per pezzo (litri)">
              <input type="number" step="0.01" value={cfg.volume_pezzo} onChange={e => setCfg({ ...cfg, volume_pezzo: e.target.value })} placeholder="0.75" style={input} />
            </Field>
            <Field label="Etichetta UI">
              <input value={cfg.unita_pezzo} onChange={e => setCfg({ ...cfg, unita_pezzo: e.target.value })} placeholder="pz" style={input} />
            </Field>
          </div>

          <div style={{ marginBottom: 12 }}>
            <Field label="Unità per il residuo aperto">
              <select value={cfg.unita_apertura} onChange={e => setCfg({ ...cfg, unita_apertura: e.target.value })} style={input}>
                <option value="ml">millilitri (ml)</option>
                <option value="cl">centilitri (cl)</option>
                <option value="l">litri (l)</option>
                <option value="g">grammi (g)</option>
                <option value="kg">chilogrammi (kg)</option>
              </select>
            </Field>
          </div>

          <div style={hint}>
            <b>Esempio:</b> bottiglia di vino da 75cl volume_pezzo = <code>0.75</code>, residuo aperto in <code>ml</code>.
            All'inventario inserirai "12 bottiglie chiuse + 350 ml aperti" calcolo automatico = <b>9.35 L</b>.
          </div>
        </>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          {hasConfig && <button onClick={reset} style={btn('#EF444422', '#EF4444', '#EF444455')}>Reset a unità</button>}
          <div style={{ flex: 1 }} />
          <button onClick={() => setOpen(false)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
          <button onClick={save} disabled={saving} style={btn(saving ? '#64748b' : '#F59E0B', '#0f1420', saving ? '#64748b' : '#F59E0B')}>{saving ? '…' : 'Salva'}</button>
        </div>
      </div>
    </div>}
  </>
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modal = { width: 'min(480px, 95%)', background: '#1a1f2e', padding: 20, borderRadius: 12, border: '1px solid #2a3042', color: '#e2e8f0' }
const closeBtn = { width: 28, height: 28, padding: 0, fontSize: 14, background: '#0f1420', color: '#cbd5e1', border: '1px solid #2a3042', borderRadius: 4, cursor: 'pointer' }
const lab = { fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }
const input = { fontSize: 13, padding: '6px 10px', border: '1px solid #2a3042', borderRadius: 6, background: '#0f1420', color: '#e2e8f0', outline: 'none', width: '100%' }
const hint = { fontSize: 11, color: '#94a3b8', background: '#0f1420', padding: 10, borderRadius: 6, lineHeight: 1.5, marginTop: 8 }

function pill(active) {
  return {
    flex: 1, padding: '10px 12px', textAlign: 'left',
    background: active ? '#F59E0B' : '#0f1420', color: active ? '#0f1420' : '#cbd5e1',
    border: '1px solid ' + (active ? '#F59E0B' : '#2a3042'), borderRadius: 8, cursor: 'pointer',
    fontSize: 12,
  }
}

function btn(bg, color, border) {
  return { padding: '7px 14px', fontSize: 13, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}

function Field({ label, children }) {
  return <label style={{ display: 'block' }}>
    <div style={lab}>{label}</div>
    {children}
  </label>
}
