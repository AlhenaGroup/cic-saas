// Modulo Marketing / CRM — wrapper con sotto-tab.
// La dashboard è il backoffice del marketing: setup, configurazione, analytics.
// Le azioni operative (accetta/rifiuta prenotazione, scan promo) vivono nel POS.

import { useState, useEffect } from 'react'
import CustomersManager from '../components/marketing/CustomersManager'
import PromotionsManager from '../components/marketing/PromotionsManager'

const SUBTABS = [
  { key: 'clienti', label: 'Clienti' },
  { key: 'promo',   label: 'Promozioni' },
  // prossimi step:
  // { key: 'prenotaz', label: 'Prenotazioni' },
  // { key: 'campagne', label: 'Campagne' },
  // { key: 'fidelity', label: 'Fidelity' },
  // { key: 'reviews',  label: 'Recensioni' },
  // { key: 'centralino', label: 'Centralino' },
]

export default function MarketingModule({ sp, sps }) {
  const [tab, setTab] = useState(() => localStorage.getItem('mkt_tab') || 'clienti')
  useEffect(() => { localStorage.setItem('mkt_tab', tab) }, [tab])

  return <div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {SUBTABS.map(t => <button key={t.key} onClick={() => setTab(t.key)} style={{
        padding: '8px 16px', fontSize: 13, fontWeight: 600,
        background: tab === t.key ? '#F59E0B' : '#1a1f2e',
        color: tab === t.key ? '#0f1420' : '#cbd5e1',
        border: '1px solid ' + (tab === t.key ? '#F59E0B' : '#2a3042'),
        borderRadius: 8, cursor: 'pointer'
      }}>{t.label}</button>)}
    </div>

    {tab === 'clienti' && <CustomersManager sp={sp} sps={sps} />}
    {tab === 'promo'   && <PromotionsManager sp={sp} sps={sps} />}
  </div>
}
