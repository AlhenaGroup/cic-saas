# CLAUDE.md

Istruzioni per Claude in ogni sessione di lavoro su questo repo.

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

## Riferimenti rapidi

- Repo GitHub: https://github.com/AlhenaGroup/cic-saas
- Ambiente produzione: Vercel (da `main`)
- DB: Supabase
- File schema (da aggiornare): `supabase_schema.sql`
- Shared styles: `src/components/shared/styles.jsx`
- API client CiC: `src/lib/cicApi.js`
- Cache IndexedDB già esistente: `src/lib/idbCache.js` (poco usato, espandere)
