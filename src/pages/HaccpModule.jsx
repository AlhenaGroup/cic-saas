// Modulo HACCP — top-level
//
// Sub-tabs:
//   - documenti  (FASE 1 — questa) Archivio DVR/SCIA/manuale/manutenzioni con scadenze
//   - corsi      (FASE 2) Attestati e corsi dipendenti
//   - registri   (FASE 3) Manuale autocontrollo (temperature, pulizie) compilabile da /timbra
//   - lotti      (FASE 4) Vista lotti produzione filtrabile (placeholder iniziale)
//   - ispezioni  (FASE 5) QR code per NAS/ASL/Ispettorato
//
// Per ora solo "documenti" è implementato; gli altri mostrano placeholder.

import { useState, useEffect } from 'react'
import SubTabsBar from '../components/SubTabsBar'
import HaccpDocumentsTab from '../components/haccp/HaccpDocumentsTab'
import HaccpCorsiTab from '../components/haccp/HaccpCorsiTab'
import HaccpLottiTab from '../components/haccp/HaccpLottiTab'
import { Card } from '../components/shared/styles.jsx'
import { useStaffPerms, canAccess } from '../lib/permissions'

const ALL_SUB_TABS = [
  { key: 'documenti', label: 'Documenti aziendali' },
  { key: 'corsi',     label: 'Corsi & Attestati' },
  { key: 'registri',  label: 'Registri autocontrollo' },
  { key: 'lotti',     label: 'Lotti produzione' },
  { key: 'ispezioni', label: 'QR ispezioni' },
]

export default function HaccpModule({ sps, sp }) {
  const staffPerms = useStaffPerms()
  const SUB_TABS = staffPerms ? ALL_SUB_TABS.filter(t => canAccess(staffPerms, 'haccp.' + t.key, false)) : ALL_SUB_TABS
  const [tab, setTab] = useState(SUB_TABS[0]?.key || 'documenti')
  useEffect(() => {
    if (SUB_TABS.length > 0 && !SUB_TABS.some(t => t.key === tab)) setTab(SUB_TABS[0].key)
  }, [SUB_TABS, tab])

  return <div>
    <SubTabsBar tabs={SUB_TABS} value={tab} onChange={setTab}/>

    {tab === 'documenti' && <HaccpDocumentsTab sps={sps} sp={sp}/>}
    {tab === 'corsi' && <HaccpCorsiTab sps={sps} sp={sp}/>}
    {tab === 'registri' && <Placeholder title="Registri autocontrollo"
      description="Template di registro HACCP (temperatura frigoriferi, pulizia banco, sanificazione, ecc.). Il personale compila da /timbra; tu vedi lo storico qui."/>}
    {tab === 'lotti' && <HaccpLottiTab sps={sps} sp={sp}/>}
    {tab === 'ispezioni' && <Placeholder title="QR ispezioni"
      description="Genera QR code per Ispettorato del lavoro (contratti+paghe+attestati), NAS/ASL (lotti+manuale HACCP+manutenzioni), Sicurezza (DVR+attestati). Lo scansionano e vedono solo i documenti che hai abilitato."/>}
  </div>
}

function Placeholder({ title, description }) {
  return <Card title={title}>
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text2)' }}>
      <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 540, margin: '0 auto', fontStyle: 'italic' }}>
        {description}
      </div>
      <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        Sezione in arrivo (fase successiva)
      </div>
    </div>
  </Card>
}
