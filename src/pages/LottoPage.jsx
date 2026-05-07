// Pagina pubblica /lotto/<codice>
// Accessibile a chiunque (ispettori ASL, clienti, ecc.) tramite QR sull'etichetta.
// Mostra le info essenziali del lotto: nome prodotto, allergeni, scadenza,
// conservazione, ingredienti. Niente PIN richiesto, ma anche niente dati
// personali sensibili (operatore = solo iniziali).

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ALLERGENI_LABELS = {
  glutine: 'GLUTINE', crostacei: 'CROSTACEI', uova: 'UOVA', pesce: 'PESCE',
  arachidi: 'ARACHIDI', soia: 'SOIA', latte: 'LATTE', frutta_a_guscio: 'FRUTTA A GUSCIO',
  sedano: 'SEDANO', senape: 'SENAPE', sesamo: 'SESAMO', solfiti: 'SOLFITI',
  lupini: 'LUPINI', molluschi: 'MOLLUSCHI',
}

export default function LottoPage({ code }) {
  const [batch, setBatch] = useState(undefined) // undefined=loading, null=not_found, object=ok
  const [recipe, setRecipe] = useState(null)

  useEffect(() => {
    if (!code) { setBatch(null); return }
    document.title = 'Lotto ' + code
    ;(async () => {
      const { data: bs } = await supabase.from('production_batches')
        .select('*').eq('lotto', code).limit(1)
      const b = bs?.[0]
      if (!b) { setBatch(null); return }
      setBatch(b)
      if (b.recipe_id) {
        const { data: rs } = await supabase.from('production_recipes')
          .select('nome,procedimento,immagine_url').eq('id', b.recipe_id).limit(1)
        if (rs?.[0]) setRecipe(rs[0])
      }
    })()
  }, [code])

  // Iniziali operatore per privacy (es. "Mario Rossi" "M. R.")
  const operatoreIniziali = (n) => {
    if (!n) return null
    return n.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join(' ')
  }

  const wrapper = {
    minHeight: '100vh', background: '#f8fafc', color: '#0f172a',
    fontFamily: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
    padding: '20px 16px',
  }

  if (batch === undefined) {
    return <div style={wrapper}><div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>Caricamento…</div></div>
  }
  if (batch === null) {
    return <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: '40px auto', background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}></div>
        <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Lotto non trovato</h1>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>
          Il codice <strong style={{ fontFamily: 'monospace' }}>{code}</strong> non corrisponde a nessun lotto registrato.
        </div>
      </div>
    </div>
  }

  const oggi = new Date().toISOString().slice(0, 10)
  const isScaduto = batch.data_scadenza && batch.data_scadenza < oggi
  const giorniMancanti = batch.data_scadenza
    ? Math.ceil((new Date(batch.data_scadenza) - new Date(oggi)) / 86400000)
    : null

  return <div style={wrapper}>
    <div style={{ maxWidth: 540, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)', color: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
        <div style={{ fontSize: 11, opacity: .9, textTransform: 'uppercase', letterSpacing: 1 }}>Tracciabilità lotto</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 6px' }}>{recipe?.nome || 'Prodotto'}</h1>
        <div style={{ fontSize: 13, fontFamily: 'monospace', background: 'rgba(255,255,255,.2)', display: 'inline-block', padding: '4px 10px', borderRadius: 4 }}>
          {batch.lotto}
        </div>
      </div>

      {/* Allergeni - in evidenza */}
      {batch.allergeni?.length > 0 && (
        <div style={{ background: '#fef3c7', border: '2px solid #F59E0B', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#92400e', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>Allergeni</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#7c2d12', lineHeight: 1.6 }}>
            Contiene: {batch.allergeni.map(a => ALLERGENI_LABELS[a] || a.toUpperCase()).join(', ')}
          </div>
          <div style={{ fontSize: 10, color: '#92400e', marginTop: 6 }}>Reg. UE 1169/2011</div>
        </div>
      )}

      {/* Scadenza */}
      {batch.data_scadenza && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1 }}>Scadenza</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: isScaduto ? '#dc2626' : (giorniMancanti != null && giorniMancanti <= 1 ? '#d97706' : '#0f172a') }}>
              {batch.data_scadenza}
            </div>
          </div>
          {giorniMancanti != null && (
            <div style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999,
              background: isScaduto ? '#fee2e2' : (giorniMancanti <= 1 ? '#fef3c7' : '#d1fae5'),
              color: isScaduto ? '#991b1b' : (giorniMancanti <= 1 ? '#92400e' : '#065f46') }}>
              {isScaduto ? `Scaduto da ${Math.abs(giorniMancanti)}gg` : (giorniMancanti === 0 ? 'Scade OGGI' : `Tra ${giorniMancanti}gg`)}
            </div>
          )}
        </div>
      )}

      {/* Info produzione */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Produzione</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13 }}>
          <div style={{ color: 'var(--text3)' }}>Data:</div>
          <div style={{ fontWeight: 600 }}>{batch.data_produzione} {batch.ora_produzione ? batch.ora_produzione.slice(0, 5) : ''}</div>
          <div style={{ color: 'var(--text3)' }}>Locale:</div>
          <div style={{ fontWeight: 600 }}>
            {batch.locale_produzione}
            {batch.locale_destinazione && batch.locale_destinazione !== batch.locale_produzione && ` ${batch.locale_destinazione}`}
          </div>
          <div style={{ color: 'var(--text3)' }}>Quantità:</div>
          <div style={{ fontWeight: 600 }}>{batch.quantita_prodotta} {batch.unita || ''}</div>
          {operatoreIniziali(batch.operatore_nome) && <>
            <div style={{ color: 'var(--text3)' }}>Operatore:</div>
            <div style={{ fontWeight: 600 }}>{operatoreIniziali(batch.operatore_nome)}</div>
          </>}
          {batch.conservazione && <>
            <div style={{ color: 'var(--text3)' }}>Conservazione:</div>
            <div style={{ fontWeight: 600 }}>{batch.conservazione}</div>
          </>}
        </div>
      </div>

      {/* Ingredienti */}
      {batch.ingredienti_usati?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Ingredienti</div>
          <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.7 }}>
            {batch.ingredienti_usati.map((i, idx) => (
              <li key={idx}>
                {i.nome_articolo}
                {i.quantita ? ` — ${i.quantita} ${i.unita || ''}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stato */}
      {batch.stato && batch.stato !== 'attivo' && (
        <div style={{ background: '#fee2e2', borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 12, color: '#991b1b', textAlign: 'center', fontWeight: 600 }}>
          Stato lotto: {batch.stato.toUpperCase()}
        </div>
      )}

      {/* Footer compliance */}
      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text2)', marginTop: 16, lineHeight: 1.5 }}>
        Tracciabilità conforme Reg. CE 852/2004 + UE 1169/2011<br/>
        Sistema: Convivia
      </div>
    </div>
  </div>
}
