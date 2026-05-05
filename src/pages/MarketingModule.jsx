// Modulo Marketing / CRM — wrapper con sotto-tab.
// La dashboard è il backoffice del marketing: setup, configurazione, analytics.
// Le azioni operative (accetta/rifiuta prenotazione, scan promo) vivono nel POS.

import { useState, useEffect } from 'react'
import CustomersManager from '../components/marketing/CustomersManager'
import PromotionsManager from '../components/marketing/PromotionsManager'
import FidelityManager from '../components/marketing/FidelityManager'
import ReservationsManager from '../components/marketing/ReservationsManager'
import CentralinoManager from '../components/marketing/CentralinoManager'
import CampaignsManager from '../components/marketing/CampaignsManager'
import ReviewsManager from '../components/marketing/ReviewsManager'
import AutomationsManager from '../components/marketing/AutomationsManager'
import SurveysManager from '../components/marketing/SurveysManager'

const SUBTABS = [
  { key: 'prenotaz',   label: 'Prenotazioni' },
  { key: 'clienti',    label: 'Clienti' },
  { key: 'automazioni', label: 'Automazioni' },
  { key: 'campagne',   label: 'Campagne' },
  { key: 'promo',      label: 'Promozioni' },
  { key: 'fidelity',   label: 'Fidelity' },
  { key: 'sondaggi',   label: 'Sondaggi' },
  { key: 'reviews',    label: 'Recensioni' },
  { key: 'centralino', label: 'Centralino' },
]

export default function MarketingModule({ sp, sps }) {
  // NON persistito: rientro parte dal primo sub-tab (Prenotazioni)
  const [tab, setTab] = useState('prenotaz')

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

    {tab === 'prenotaz'    && <ReservationsManager sp={sp} sps={sps} />}
    {tab === 'clienti'     && <CustomersManager sp={sp} sps={sps} />}
    {tab === 'automazioni' && <AutomationsManager sp={sp} sps={sps} />}
    {tab === 'campagne'    && <CampaignsManager sp={sp} sps={sps} />}
    {tab === 'promo'       && <PromotionsManager sp={sp} sps={sps} />}
    {tab === 'fidelity'    && <FidelityManager sp={sp} sps={sps} />}
    {tab === 'sondaggi'    && <SurveysManager sp={sp} sps={sps} />}
    {tab === 'reviews'     && <ReviewsManager sp={sp} sps={sps} />}
    {tab === 'centralino'  && <CentralinoManager sp={sp} sps={sps} />}
  </div>
}
