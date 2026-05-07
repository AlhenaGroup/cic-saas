// Modale per creare un articolo "placeholder" (in attesa di fattura).
// Usato sia da RecipeManager (ingredienti ricetta) sia da ManualArticlesManager (ingredienti semilavorati).

import { useState } from 'react'
import { S } from '../shared/styles.jsx'

const iS = S.input
const UM_OPTIONS = ['KG', 'g', 'LT', 'cl', 'ml', 'PZ', 'CONF', 'M', 'CM']
const MAG_OPTIONS = ['food', 'beverage', 'materiali', 'attrezzatura', 'altro']

export default function CreatePlaceholderModal({ initialName = '', onCancel, onCreate }) {
  const [nome, setNome] = useState(initialName || '')
  const [unita, setUnita] = useState('KG')
  const [prezzo, setPrezzo] = useState('')
  const [magazzino, setMagazzino] = useState('food')
  const valid = nome.trim().length > 0

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, padding: 22, maxWidth: 440, width: '100%', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Articolo in attesa di fattura</h3>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5 }}>
            Crea un articolo usabile subito nelle ricette/semilavorati. Quando arriverà una fattura con descrizione che matcha, il prezzo medio reale sostituirà quello stimato.
          </div>
        </div>
        <Field label="Nome articolo *">
          <input style={iS} value={nome} onChange={e => setNome(e.target.value)} autoFocus />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Unità di misura">
            <select style={iS} value={unita} onChange={e => setUnita(e.target.value)}>
              {UM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Magazzino target">
            <select style={iS} value={magazzino} onChange={e => setMagazzino(e.target.value)}>
              {MAG_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <Field label={`Prezzo stimato per ${unita}  ·  facoltativo`}>
          <input type="number" step="0.01" placeholder="es. 12.50" style={iS} value={prezzo} onChange={e => setPrezzo(e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Lascia vuoto se non sai il prezzo: il food cost sarà 0 finché non arriva la fattura.</div>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCancel} style={{ ...iS, padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer' }}>Annulla</button>
          <button onClick={() => valid && onCreate({ nome: nome.trim(), unita, prezzo_stimato: prezzo, magazzino })} disabled={!valid}
            style={{ ...iS, padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--text)', color: 'var(--surface)', border: 'none', cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : 0.5 }}>
            Crea e usa
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 10 }}>
    <label style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
    {children}
  </div>
}
