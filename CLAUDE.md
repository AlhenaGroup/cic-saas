# CLAUDE.md

Istruzioni per Claude in ogni sessione di lavoro su questo repo.

> **Stato corrente / diario lavori in corso** → leggi anche `SESSION.md` (cosa è stato fatto di recente, cosa è in sospeso, ultimi commit). Aggiornare a ogni milestone.

## Prodotto

**CIC SaaS** — piattaforma gestionale per ristoranti. Oggi usata da Alhena Group come cliente pilota, in traiettoria per diventare prodotto venduto a terzi ristoratori.

Moduli:
- **Dashboard** — KPI vendite, scontrini, categorie, IVA, reparti
- **Magazzino** — Fatture, Articoli, Ricette (con food cost), Giacenze, Inventario, Ordini, Prezzi
- **Personale (HR)** — Dipendenti, Documenti, Calendario, Presenze, Turni, Orari consigliati
- **Marketing** — Task, RFM Segmentation, Reputation
- **Budget** — Overview, Input driver-based, Forecast, Analisi scostamenti CE, Simulatore scenari
- **Conto Economico** — F&B cost, mappature, indicatori
- **Timbratura** (pagina pubblica `/timbra`) — QR + PIN + GPS
- **Monitoring** — Log attività da Monitoring Log CiC

## Stack

- **Frontend**: React 18 + Vite, single-page
- **Backend**: Vercel serverless functions (`/api/*.js`)
- **DB + Auth**: Supabase (Postgres + Auth email/password + RLS)
- **Deploy**: Vercel (rebuild auto su push `main`)
- **Integrazioni**: CiC (POS), TS Digital (fatture elettroniche), HERA (utenze), Google Sheets (timbrature)

## Clienti reali

**Alhena Group** (P.IVA 12266890016, CF proprietario FSCSMN98H12G674S — Simone Fusca):
- REMEMBEER — Piazza San Donato 35, Pinerolo
- CASA DE AMICIS — Piazza San Donato 43, Pinerolo
- BIANCOLATTE (ex FIORIO, rinominato 04/2026) — Piazza San Donato 32, Pinerolo
- LABORATORIO — Via Trento 1, Pinerolo (centro produzione)
- UFFICIO AMMINISTRAZIONE — Via Trento 33, Pinerolo

Mapping contatori HERA (POD/PDR) per auto-assegnazione fatture utenze: vedi `memory/reference_hera_contatori.md` nelle memorie utente.

## Branch e deploy

- `main` → produzione (Vercel auto-deploy)
- `feat/budget-module` → branch di sviluppo integrato con tutte le feature accumulate

**Regola di Filippo**: nessuna modifica deve rimanere in locale. Flusso sempre:

1. `git add` + `git commit` su `feat/budget-module`
2. `git checkout main` + `git merge feat/budget-module --ff-only`
3. `git push origin main`
4. `git checkout feat/budget-module` + `git push origin feat/budget-module`

In alternativa da worktree separati (ne esistono in `.claude/worktrees/`), fare i passi equivalenti nei percorsi giusti.

Prima di iniziare una sessione, **fare sempre `git fetch origin`** per evitare stati locali obsoleti (capitato in passato).

## Convenzioni codice

- Stile inline styles (niente CSS moduli né Tailwind al momento)
- Formatter italiani: `fmt`, `fmtD`, `fmtN` da `src/components/shared/styles.jsx`
- Palette `C` per grafici, `S` per stili condivisi
- Lingua UI: **italiano** sempre
- Commit message: prefissi `feat:`, `fix:`, `chore:`, in italiano (o inglese breve), descrittivi
- **Non aggiungere commenti superflui** se il codice parla da solo
- **Non creare file .md di documentazione** senza richiesta esplicita (questo CLAUDE.md è l'eccezione)

## Persistenza UI

Pattern già in uso — replicare per qualsiasi nuovo componente con tab/stato navigazionale:

```js
const [tab, setTab] = useState(() => localStorage.getItem('xxx_tab') || 'default')
useEffect(() => { localStorage.setItem('xxx_tab', tab) }, [tab])
```

Cache in memoria con TTL per evitare refetch al remount (vedi `RecipeManager.jsx` come riferimento).

## Stato attuale prodotto (2026-04-16)

**Funzionante:**
- Tutti i moduli elencati sopra sono in produzione
- Alhena Group usa giornalmente la piattaforma

**NON pronto per vendita a terzi — roadmap produzione:**

### Sprint 1 (settimana 1-2) — Fondamenta
- [ ] Aggiornare `supabase_schema.sql` con TUTTE le 34 tabelle (oggi ne ha solo 7)
- [ ] Audit sistematico RLS su tutte le tabelle con 2 account test
- [ ] Creare `CLAUDE.md` ✅ (questo file)

### Sprint 2 (settimana 3-4) — Commercial
- [ ] Setup Stripe + pagamenti ricorrenti
- [ ] Piani tariffari (Starter/Pro/Enterprise)
- [ ] Trial 14 giorni
- [ ] Fatture in Cloud (o Aruba) per SDI
- [ ] Onboarding wizard per nuovi utenti (collega CiC, imposta locali)

### Sprint 3 (settimana 5-6) — Legal & support
- [ ] iubenda Privacy + Cookie + T&S
- [ ] DPA modello da firmare clienti
- [ ] Email support@ su Google Workspace
- [ ] Crisp widget in-app
- [ ] Sentry integrato frontend + API
- [ ] Landing page minima (home, prezzi, richiesta demo)

### Sprint 4+ — Scalabilità
- [ ] Ruoli/permessi granulari (owner/contabile/manager/dipendente)
- [ ] Audit log
- [ ] Backup settimanali esterni su B2/S3
- [ ] Caching server-side per query pesanti
- [ ] Paginazione su TUTTE le liste
- [ ] Admin panel per impersonare utenti e debugging

## Come lavoriamo insieme

1. Leggi prima `MEMORY.md` (nelle memorie utente) + questo file
2. Fai `git fetch origin` per stato aggiornato
3. Per task complesse: proponi approccio prima di fare lunghe modifiche
4. **Push sempre** dopo ogni lavoro completato — niente modifiche in locale
5. Aggiorna la roadmap qui sopra quando completi sprint o li cambi
6. Se c'è un bug o comportamento strano, **chiedi sempre** il contesto (cosa vede l'utente, console errors) prima di tirare a indovinare

## Provider esterni (marketing/CRM)

Architettura **all-Twilio** (decisione 2026-05-12) per scalabilità SaaS:

| Modulo | Provider | Env vars Vercel |
|---|---|---|
| Voice / IVR / parallel ring / segreteria | **Twilio Voice** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (numero IT comprato su console) |
| WhatsApp (utility + marketing) | **Twilio WhatsApp** | `TWILIO_WHATSAPP_FROM` (es. `whatsapp:+14155238886` sandbox, o numero approvato Meta) |
| Email transactional + mass | **SendGrid** (gruppo Twilio) | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` |
| SMS | — | skip |
| Google Calendar (sync turni HR) | Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` |

**Email/DKIM**: di default mittente globale via env (`SENDGRID_FROM_EMAIL`). Per DKIM custom per cliente (`prenotazioni@biancolatte.it`) usare SendGrid "Domain Authentication" + 3 record CNAME sul DNS del dominio cliente.

**Webhook Twilio IVR**: `https://cic-saas.vercel.app/api/twilio-webhook?step=voice` (settare in Twilio Console sul numero comprato).

**NB**: Gmail send NON è più usato — il flusso Google OAuth resta SOLO per Calendar. La colonna `email` su `google_tokens` è legacy ma innocua.

## Riferimenti rapidi

- Repo GitHub: https://github.com/AlhenaGroup/cic-saas
- Ambiente produzione: Vercel (da `main`)
- DB: Supabase (URL `https://afdochrjbmxnhviidzpb.supabase.co`)
- Service key: in `api/attendance.js` linea 4 — utilizzabile per leggere/scrivere via REST (non per DDL)
- User ID admin: `4bedef4d-cf04-4c34-b614-dd0b78b496be`
- DDL (ALTER, CREATE INDEX, ecc.): aprire Chrome MCP su `https://supabase.com/dashboard/project/afdochrjbmxnhviidzpb/sql/new`
- File schema (da aggiornare): `supabase_schema.sql`
- Shared styles: `src/components/shared/styles.jsx`
- API client CiC: `src/lib/cicApi.js`
- Cache IndexedDB già esistente: `src/lib/idbCache.js` (poco usato, espandere)

## Convenzioni operative consolidate

- **Operating day cutoff = 05:00**: turni notturni che finiscono alle 03:00 contano nel giorno precedente (Europe/Rome, DST safe)
- **Giornata operativa turni HR**: 12:00 → 05:00 del giorno dopo (17 colonne); turni a cavallo mezzanotte salvati come 2 righe in `employee_shifts` (giorno + giorno+1)
- **Ore reali**: troncate per difetto a 2 decimali (`Math.floor(x*100)/100`) — mai sovrastimare
- **Multi-tenancy**: RLS attivo, key `(user_id, locale, sub_location)`. Sub-location default `principale`
- **Coordinate locali timbratura**: REMEMBEER 44.8857895/7.3293777 · CASA DE AMICIS 44.8858039/7.3299022 · LABORATORIO 44.885515/7.329369 · raggio max 50m
- **PWA `/timbra`**: manifest dinamico via script inline in `index.html` (start_url scoped). Path `/timbra` = app dipendenti (solo PIN), altre pagine = dashboard admin
- **Mobile/PWA**: griglie multi-colonna collassano via CSS attribute selector; classe `.keep-grid` per esclusioni (es. numpad PIN). Tabelle scroll-x <=900px. Modali fullscreen `.m-modal-fullscreen`
- **Hover celle timeline turni**: classe `.ts-cell` + figlio `.ts-fill` per il background → la regola globale `tr:hover td{background:...}` non sovrascrive la selezione
- **LABORATORIO**: punto di timbratura non-locale (no incassi, no fatture). Le ore timbrate qui vengono **virtualmente attribuite** al primo locale "vero" della stessa giornata operativa (cerca avanti, poi indietro). Visivamente il blocco resta `(LABORATORIO)`. Logica in `AttendanceView.jsx` — `computeAttribuzione()`

## Schema DB chiave

- `employees` — incluso `pin` (4 cifre) e `permissions jsonb` (`{presenza, inventario, spostamenti, consumo}`)
- `recipes` — `nome_prodotto`, `reparto`, `prezzo_vendita`, `ingredienti jsonb [{nome_articolo, quantita, unita}]`
- `warehouse_invoices` + `warehouse_invoice_items` con `nome_articolo`, `qty_singola`, `totale_um`, `magazzino`, `escludi_magazzino`
- `item_rules` — pattern descrizione fattura → defaults (nome_articolo, magazzino, qty, ecc.). Pattern normalizzato (rimuove lotti, date, codici 4+ cifre)
- `article_stock` + `article_movement` (giacenze + storico append-only)
- `manual_costs` — costi CE manuali (cadenze: settimanale/mensile/bimestrale/trimestrale/semestrale/annuale, `data_riferimento`, `data_fine`)
- `manual_articles` — semilavorati / sub-ricette (`nome`, `unita`, `resa`, `ingredienti jsonb`, `locale`). UNIQUE(user_id, nome). RLS auth.uid = user_id
- `daily_stats` (sync da CiC, con `receipt_details`, `hourly_records`)
- `attendance` (timbrature)
- `employee_shifts` (turni: settimana, giorno 0-6, ora_inizio, ora_fine)
- `personnel_costs`, `category_mappings`
- `warehouse_inventories` + `warehouse_inventory_items` (legacy: `note` JSON contiene `{locale, sub_location, nome_articolo, ...}`. FK su `product_id` rimossa, ora nullable)

## Flusso fatture/magazzino

1. Sync TS Digital → `warehouse_invoices` + items
2. Per ogni riga: utente associa `nome_articolo`, magazzino, qty fatt./tipo/qty singola/UM, escludi sì/no
3. Click 💾 → upsert `item_rules` con pattern normalizzato + setta `stato_match='abbinato'` sulla riga
4. Prossima fattura con stessa descrizione → autocompila in **arancione** (regola), altrimenti **viola**
5. Ricerca globale: prefetch tutte le pagine in background; click apre fattura anche da pagine diverse
6. Formula €/UM: `prezzo_totale / (qty_fatt × qty_tipo × qty_singola)` ovunque (PriceAnalysis, ArticoliTab, RecipeManager)

## Modulo Magazzino tabs

Cruscotto · Fatture · Prodotti · Articoli · **Semilavorati** · Ricette · Giacenze · Movimenti · Inventario · Ordini · Prezzi
- Tab "Movimenti" della **dashboard principale** (sospetti monitoring) → rimosso
- "Articoli" e "Prezzi" leggono direttamente da `warehouse_invoice_items` con `escludi_magazzino=false` (sempre allineati alle esclusioni)
- "Semilavorati": ingredienti prodotti internamente (es. Salsa Remembeer) con sub-ricetta. Costo €/UM = somma costi ingredienti / resa. Possono essere usati come ingredienti in `recipes` (autocomplete con icona 🥣). Ricorsivi (max 8 livelli, protezione cicli). Helper `src/lib/manualArticles.js`

## /timbra (PWA dipendenti, no login)

Menu post-PIN filtrato da `permissions` + viste info sempre visibili:
- 🕐 Timbra presenza · 🍪 Consumo personale (lista RICETTE → esplode ingredienti) · 🔀 Spostamento merce · 📋 Inventario
- 📆 I miei turni (last 6 settimane) · ⏱ Le mie ore (oggi/sett/mese/anno) · 🏖️ Le mie ferie (CCNL 26gg, residui)
- API: `verify`, `timbra`, `history`, `recipes`, `consumo`, `articles`, `trasferimento`, `inv-open`, `inv-articles`, `inv-count`, `inv-close`, `my-shifts`, `my-hours`, `my-timeoff`

## Conto Economico

- Voci CE cliccabili (drill-down con KPI Da fatture/Manuali/Totale, top fornitori, dettaglio righe)
- `manual_costs` espansi nel periodo (helper `src/lib/manualCosts.js`)
- Selettore mese/anno in cima

## Personale → Turni

- Toggle "Per settimana" / "Per giorno"
- Vista giorno: timeline 12:00→05:00, click=ora intera, doppio click=zoom 4 quarti, salva merge intervalli contigui
- Riga "Staff" pianificato/consigliato (calcolato da `daily_stats` settimana scorsa stesso giorno + `cic_soglia_staff` + `cic_prep_hours`)
- Celle rosse se sovra-staffato

## Personale → Presenze reali

- Toolbar con bottoni **📊 Excel** / **🖨 PDF** apre `ExportModal` con selettore periodo (preset Settimana/Mese corrente/scorso + date pickers)
- Export: 1 riga per dipendente, 1 colonna per ogni giorno del periodo (es. "Lunedì 01/04") con orari `entrata→uscita (locale)` + ore. Riga finale TOTALE GIORNO. PDF in A4 landscape via `window.print()`
- Filtro locale strict: con filtro attivo (es. REMEMBEER), le celle mostrano solo blocchi di REMEMBEER (omettendo etichetta locale, implicita), e i dipendenti che non hanno timbrato lì nel periodo vengono esclusi
- Ore LABORATORIO confluiscono nel locale operativo della giornata (vedi convenzione sopra)
- **Pausa**: nel `DayManager` bottone `+ Pausa` aggiunge una riga di tipo `attendance.tipo='pausa'` (con `pausa_minuti` come durata) tra entrata e uscita. La somma delle pause comprese in un blocco entrata→uscita viene sottratta dalle ore del blocco (mai sotto 0). Le pause fuori da un blocco aperto vengono ignorate. La cella settimanale mostra `⏸N'` se pausa>0; gli export Excel/PDF includono `[-Nm pausa]` accanto agli orari

## Stato dati attuale (snapshot 2026-04-27)

- **Ricette totali**: 791 (508 CASA DE AMICIS + 223 REMEMBEER da Excel: 93 aggiornate + 130 nuove)
- **Articoli magazzino**: ~311 unici da fatture
- **Semilavorati (`manual_articles`)**: 0 — l'utente li crea a mano dal tab Magazzino → 🥣 Semilavorati
- **`article_stock`**: 231 righe da soli carichi (scarichi simulati 1/4-21/4 rimossi)
- **Inventario REMEMBEER**: vuoto — al primo apertura da `/timbra` popolerà con i 145 articoli
- **Ingredienti senza match magazzino** in DB ricette: ~65 totali (food cost = 0 per quelli, finché non arrivano in fattura o sono creati come semilavorati)
- **Sub-location**: nessun locale ne ha configurate, tutto su `principale`
- **Ore reali**: troncate a 2 decimali per difetto (mai sovrastimate)

## File chiave dove probabilmente intervenire

- `src/pages/DashboardPage.jsx` (3000+ righe) — dashboard principale, tabs, KPI, calcolo CE inline
- `src/pages/TimbraPage.jsx` — app dipendenti
- `src/pages/WarehouseModule.jsx` — modulo magazzino + ArticoliTab inline
- `src/components/warehouse/InvoiceManager.jsx` — gestione fatture, normalizePattern, regole
- `src/components/warehouse/RecipeManager.jsx` — ricette + food cost (include semilavorati)
- `src/components/warehouse/ManualArticlesManager.jsx` — semilavorati con sub-ricetta
- `src/lib/manualArticles.js` — helper costo ricorsivo sub-ricette
- `src/components/warehouse/PriceAnalysis.jsx` — analisi prezzi articoli
- `src/components/hr/ShiftAssistant.jsx` — turni settimana/giorno + DailyTimelineEditor + SuggestedSchedule
- `src/components/hr/AttendanceView.jsx` — presenze reali con DayManager
- `src/components/hr/EmployeeProfile.jsx` — scheda dipendente con tab Permessi
- `src/components/ContoEconomico.jsx` + `ManualCostsManager.jsx`
- `src/lib/manualCosts.js` (helper espansione ricorrenze)
- `src/lib/cicApi.js` — calcolo CE include `manual_costs`
- `api/attendance.js` — tutti gli endpoint /timbra
- `index.html` — script inline per manifest PWA dinamico

## Quando aggiornare questo file

Quando finisci una sessione di lavoro significativa, aggiorna la sezione **"Stato dati attuale"** e l'ultima data, ed eventualmente aggiungi note in **"Convenzioni operative consolidate"** se hai introdotto nuove regole. Non riscrivere le sezioni precedenti se restano valide.
