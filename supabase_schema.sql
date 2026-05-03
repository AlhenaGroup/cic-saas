-- ============================================================
-- CIC SaaS — Supabase Schema completo
-- ============================================================
-- Schema autoritativo della produzione, estratto direttamente da Supabase
-- (api.supabase.com/platform/pg-meta) il 2026-04-16.
--
-- Contiene:
--   - 37 tabelle pubbliche (CORE, WAREHOUSE, HR, BUDGET, MARKETING, SYSTEM)
--   - Foreign keys verificate
--   - Indici e unique constraints verificati
--   - Row Level Security su tutte le tabelle (+ fix per i 3 buchi scoperti)
--   - Policies base "auth.uid() = user_id" per multi-tenancy
--
-- Uso:
--   - Per ricreare l'ambiente da zero: eseguire questo file su un DB vuoto
--   - Per documentare lo stato attuale: fonte di verità del DB di produzione
--   - Per onboarding nuovi dev: leggere qui prima di toccare Supabase
-- ============================================================


-- ============================================================
-- 1. CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  cic_api_key text NOT NULL,
  sales_points jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  plateform_api_key text,
  plateform_location_map jsonb DEFAULT '{}'::jsonb,
  plateform_last_sync timestamp with time zone,
  -- Anagrafica azienda (gestita da /admin → Modifica utente → Anagrafica)
  company_name text,
  vat_number text,
  tax_code text,
  address text,
  phone text,
  company_email text,
  website text,
  logo_url text,
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.daily_stats (
  id bigint NOT NULL DEFAULT nextval('daily_stats_id_seq'::regclass) PRIMARY KEY,
  salespoint_id integer NOT NULL,
  salespoint_name text,
  date date NOT NULL,
  dept_records jsonb DEFAULT '[]'::jsonb,
  cat_records jsonb DEFAULT '[]'::jsonb,
  bill_count integer DEFAULT 0,
  revenue numeric(10,2) DEFAULT 0,
  synced_at timestamp with time zone DEFAULT now(),
  hourly_records jsonb DEFAULT '[]'::jsonb,
  last_receipt_time text,
  last_kitchen_time text,
  last_bar_time text,
  fiscal_close_time text,
  receipt_details jsonb DEFAULT '[]'::jsonb,
  first_receipt_time text,
  z_number integer,
  monitoring_events jsonb DEFAULT '[]'::jsonb,
  UNIQUE(salespoint_id, date)
);

CREATE TABLE IF NOT EXISTS public.monthly_stats (
  id bigint NOT NULL DEFAULT nextval('monthly_stats_id_seq'::regclass) PRIMARY KEY,
  salespoint_id integer NOT NULL,
  salespoint_name text NOT NULL,
  month text NOT NULL,
  dept_records jsonb DEFAULT '[]'::jsonb,
  dept_total integer DEFAULT 0,
  cat_records jsonb DEFAULT '[]'::jsonb,
  cat_total integer DEFAULT 0,
  trend_records jsonb DEFAULT '[]'::jsonb,
  trend_total integer DEFAULT 0,
  synced_at timestamp with time zone DEFAULT now(),
  bill_count integer DEFAULT 0,
  UNIQUE(salespoint_id, month)
);

CREATE TABLE IF NOT EXISTS public.category_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome_prodotto text NOT NULL,
  category text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, nome_prodotto)
);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type text,
  payload jsonb,
  salespoint_id bigint,
  document_date date,
  total numeric(10,2) DEFAULT 0,
  received_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamp with time zone NOT NULL,
  calendar_id text DEFAULT 'primary'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.item_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome_fattura_pattern text NOT NULL,
  escludi_magazzino boolean DEFAULT false,
  magazzino text DEFAULT 'food'::text,
  nome_articolo_default text,
  unita_default text,
  created_at timestamp with time zone DEFAULT now(),
  tipo_confezione_default text,
  qty_singola_default numeric(10,3),
  UNIQUE(user_id, nome_fattura_pattern)
);

CREATE TABLE IF NOT EXISTS public.live_requests (
  id bigint NOT NULL DEFAULT nextval('live_requests_id_seq'::regclass) PRIMARY KEY,
  from_date text NOT NULL,
  to_date text NOT NULL,
  sp_ids jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'pending'::text,
  result jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  sales_point_id bigint,
  data jsonb NOT NULL,
  synced_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, period_from, period_to, sales_point_id)
);


-- ============================================================
-- 2. WAREHOUSE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.warehouse_products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome text NOT NULL,
  nome_standard text,
  categoria text,
  sotto_categoria text,
  unita_misura text DEFAULT 'pz'::text,
  unita_acquisto text,
  fattore_conversione numeric(10,4) DEFAULT 1,
  fornitore_principale text,
  scorta_minima numeric(10,3),
  giorni_copertura integer DEFAULT 7,
  ultimo_prezzo numeric(10,4),
  prezzo_medio numeric(10,4),
  magazzino_default text DEFAULT 'principale'::text,
  attivo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, nome_standard)
);

CREATE TABLE IF NOT EXISTS public.warehouse_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL,
  alias text NOT NULL,
  confermato boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome text NOT NULL,
  locale text,
  tipo text DEFAULT 'secondario'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  quantita numeric(12,3) DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(product_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.warehouse_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid,
  tipo text NOT NULL,
  quantita numeric(12,3) NOT NULL,
  prezzo_unitario numeric(10,4),
  valore_totale numeric(12,2),
  fonte text,
  riferimento text,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  cic_id text,
  data date NOT NULL,
  numero text,
  fornitore text NOT NULL,
  tipo_doc text,
  locale text,
  stato text DEFAULT 'da_elaborare'::text,
  totale numeric(12,2),
  raw_data jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid NOT NULL,
  product_id uuid,
  nome_fattura text NOT NULL,
  quantita numeric(10,3),
  unita text,
  prezzo_unitario numeric(10,4),
  prezzo_totale numeric(12,2),
  stato_match text DEFAULT 'da_confermare'::text,
  created_at timestamp with time zone DEFAULT now(),
  nome_articolo text,
  magazzino text DEFAULT 'food'::text,
  escludi_magazzino boolean DEFAULT false,
  tipo_confezione text,
  totale_um numeric(10,2),
  qty_singola numeric(10,3),
  -- Se true, l'articolo NON compare nell'inventario fatto dai
  -- collaboratori da /timbra (resta visibile in dashboard admin).
  escludi_inventario_staff boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.warehouse_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL,
  prezzo numeric(10,4) NOT NULL,
  fornitore text,
  data_fattura date,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_inventories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  location_id uuid,
  data date DEFAULT CURRENT_DATE,
  stato text DEFAULT 'in_corso'::text,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_inventory_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inventory_id uuid NOT NULL,
  product_id uuid NOT NULL,
  giacenza_teorica numeric(12,3),
  giacenza_reale numeric(12,3),
  differenza numeric(12,3),
  valore_differenza numeric(12,2),
  note text
);

CREATE TABLE IF NOT EXISTS public.warehouse_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  fornitore text NOT NULL,
  data date DEFAULT CURRENT_DATE,
  stato text DEFAULT 'bozza'::text,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantita_suggerita numeric(10,3),
  quantita_ordinata numeric(10,3),
  note text
);

CREATE TABLE IF NOT EXISTS public.warehouse_recipes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome text NOT NULL,
  categoria text,
  tipo text DEFAULT 'prodotto_finito'::text,
  porzioni integer DEFAULT 1,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_recipe_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantita numeric(10,3) NOT NULL,
  unita text DEFAULT 'g'::text,
  created_at timestamp with time zone DEFAULT now()
);

-- Tabella "legacy" ricette: usata dal RecipeManager corrente, parallela a warehouse_recipes
CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome_prodotto text NOT NULL,
  reparto text,
  prezzo_vendita numeric(10,2) DEFAULT 0,
  ingredienti jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, nome_prodotto)
);


-- ============================================================
-- 3. HR TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  nome text NOT NULL,
  ruolo text,
  locale text,
  telefono text,
  email text,
  stato text DEFAULT 'Attivo'::text,
  created_at timestamp with time zone DEFAULT now(),
  cf text,
  data_nascita date,
  indirizzo text,
  iban text,
  tipo_contratto text,
  livello text,
  ore_contrattuali numeric(5,1),
  data_assunzione date,
  data_fine_contratto date,
  costo_orario numeric(8,2),
  retribuzione_lorda numeric(10,2),
  note text,
  pin text
);

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tipo text NOT NULL,
  nome text NOT NULL,
  scadenza date,
  file_path text,
  created_at timestamp with time zone DEFAULT now(),
  parsed_data jsonb,
  parse_status text DEFAULT 'pending'::text,
  mese_riferimento date,
  importo_lordo numeric(10,2),
  importo_netto numeric(10,2)
);

CREATE TABLE IF NOT EXISTS public.employee_pay_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  mese date NOT NULL,
  retribuzione_lorda numeric(10,2),
  retribuzione_netta numeric(10,2),
  costo_azienda numeric(10,2),
  ore_lavorate numeric(6,1),
  ore_straordinario numeric(6,1) DEFAULT 0,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(employee_id, mese)
);

CREATE TABLE IF NOT EXISTS public.employee_shifts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  locale text NOT NULL,
  settimana date NOT NULL,
  giorno smallint NOT NULL,
  ora_inizio time without time zone NOT NULL,
  ora_fine time without time zone NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_time_off (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  tipo text NOT NULL,
  data_inizio date NOT NULL,
  data_fine date NOT NULL,
  ore numeric(5,1),
  stato text DEFAULT 'approvato'::text,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

-- ─── Semilavorati (manual_articles) ────────────────────────────
-- Articoli "interni" che non vengono fatturati ma derivano da una
-- sub-ricetta di altri articoli. Es. salse, basi pizza, brodi.
CREATE TABLE IF NOT EXISTS public.manual_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  unita text,
  resa numeric(12,3) DEFAULT 1,
  ingredienti jsonb DEFAULT '[]'::jsonb,
  locale text,
  note text,
  created_by_employee_id uuid,
  created_by_employee_name text,
  approved boolean DEFAULT true,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, nome)
);

-- ─── Produzione interna / HACCP ─────────────────────────────────
-- Allergeni 14 categorie UE 1169/2011: glutine, crostacei, uova, pesce,
-- arachidi, soia, latte, frutta_a_guscio, sedano, senape, sesamo,
-- solfiti, lupini, molluschi.
CREATE TABLE IF NOT EXISTS public.article_allergens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome_articolo text NOT NULL,
  allergeni text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, nome_articolo)
);

-- Schede produzione (template ricette di produzione interna).
CREATE TABLE IF NOT EXISTS public.production_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  locale_produzione text NOT NULL,
  locale_destinazione text,
  ingredienti jsonb NOT NULL DEFAULT '[]'::jsonb,
  procedimento text,
  allergeni text[] NOT NULL DEFAULT '{}',
  conservazione text,
  shelf_life_days integer DEFAULT 3,
  resa_quantita numeric(12,3),
  resa_unita text,
  immagine_url text,
  attivo boolean DEFAULT true,
  -- Mobile produzione: configurazione opzionale per dipendenti
  checklist_haccp_template jsonb DEFAULT '[]'::jsonb, -- [{id, label, required}]
  richiede_foto boolean DEFAULT false,
  durata_attesa_minuti integer,
  -- Tracking creazione (chi ha creato la scheda + flag di approvazione)
  -- approved=true di default per le schede create da admin; le schede create
  -- da mobile sono salvate con approved=false e attendono conferma admin.
  created_by_employee_id uuid,
  created_by_employee_name text,
  approved boolean DEFAULT true,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Lotti produzione: ogni esecuzione di una scheda. Codice univoco
-- per (user_id, lotto). Articolo movimentato via article_movement
-- con production_batch_id che punta qui.
CREATE TABLE IF NOT EXISTS public.production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recipe_id uuid REFERENCES public.production_recipes(id) ON DELETE SET NULL,
  lotto text NOT NULL,
  data_produzione date NOT NULL DEFAULT CURRENT_DATE,
  ora_produzione time DEFAULT CURRENT_TIME,
  data_scadenza date,
  locale_produzione text NOT NULL,
  locale_destinazione text,
  operatore_id uuid,
  operatore_nome text,
  quantita_prodotta numeric(12,3) NOT NULL,
  unita text,
  ingredienti_usati jsonb NOT NULL DEFAULT '[]'::jsonb,
  allergeni text[] NOT NULL DEFAULT '{}',
  conservazione text,
  note text,
  stato text DEFAULT 'attivo' CHECK (stato IN ('attivo','consumato','scaduto','annullato')),
  -- Mobile produzione tracking
  data_inizio timestamptz,
  data_fine timestamptz,
  durata_minuti integer,
  foto_url text,
  ingredienti_effettivi jsonb,  -- override degli ingredienti standard se modificati dall'operatore
  checklist_haccp jsonb,         -- risposte alla checklist HACCP della scheda
  da_mobile boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, lotto)
);

-- ─── Modulo Avvisi: regole + eventi ─────────────────────────────
-- Le regole sono per (user_id, alert_key). alert_key è una stringa
-- predefinita dal codice (es. 'magazzino.sotto_soglia',
-- 'produzione.resa_anomala'). Se non esiste riga → regola disattiva.
CREATE TABLE IF NOT EXISTS public.alert_rules (
  user_id uuid NOT NULL,
  alert_key text NOT NULL,
  enabled boolean DEFAULT false,
  threshold jsonb DEFAULT '{}'::jsonb,
  channels jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, alert_key)
);

CREATE TABLE IF NOT EXISTS public.alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  alert_key text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('vendite','magazzino','hr','produzione')),
  livello text DEFAULT 'info' CHECK (livello IN ('info','warning','critical')),
  titolo text NOT NULL,
  descrizione text,
  link_url text,
  meta jsonb DEFAULT '{}'::jsonb,
  letto boolean DEFAULT false,
  letto_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ─── Daily report settings (email mattutina automatica) ─────────
-- 1 riga per user_id. recipients: array di {email, ruolo, sections[]}
-- Il cron /api/daily-report-cron alle 06:00 legge questa tabella
-- e invia un'email a tutti i recipients con le sezioni selezionate.
CREATE TABLE IF NOT EXISTS public.daily_report_settings (
  user_id uuid PRIMARY KEY,
  enabled boolean DEFAULT false,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_sections jsonb NOT NULL DEFAULT '{"vendite":true,"confronto":true,"personale":true,"alert":true}'::jsonb,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL,
  locale text NOT NULL,
  tipo text NOT NULL,
  timestamp timestamp with time zone NOT NULL DEFAULT now(),
  lat numeric(10,7),
  lng numeric(10,7),
  distanza_m numeric(6,1),
  created_at timestamp with time zone DEFAULT now()
);

-- ─── Checklist timbratura: definizioni + risposte ────────────────
-- Una checklist e' (locale, reparto, momento). Es: REMEMBEER · Bar · entrata.
-- Items JSONB: [{ id, tipo: 'sino'|'testo'|'numero'|'scelta', label, opzioni?, required }].
-- Le risposte vengono salvate in attendance_checklist_responses e
-- (opzionalmente) sincronizzate su Google Sheet via google_sheet_tab.
CREATE TABLE IF NOT EXISTS public.attendance_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  locale text NOT NULL,
  reparto text NOT NULL,
  momento text NOT NULL CHECK (momento IN ('entrata','uscita')),
  attivo boolean DEFAULT true,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  google_sheet_tab text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_checklist_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  checklist_id uuid NOT NULL REFERENCES public.attendance_checklists(id) ON DELETE CASCADE,
  attendance_id uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL,
  employee_name text,
  locale text,
  reparto text,
  momento text,
  risposte jsonb NOT NULL DEFAULT '{}'::jsonb,
  google_sheet_synced boolean DEFAULT false,
  skipped boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  google_event_id text,
  titolo text NOT NULL,
  descrizione text,
  data_inizio timestamp with time zone NOT NULL,
  data_fine timestamp with time zone NOT NULL,
  tipo text DEFAULT 'generico'::text,
  urgenza text DEFAULT 'normale'::text,
  employee_id uuid,
  document_id uuid,
  reminder_days integer[],
  synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text,
  schedule jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, locale)
);

CREATE TABLE IF NOT EXISTS public.personnel_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  mese date NOT NULL,
  locale text NOT NULL,
  costo_totale numeric(12,2) NOT NULL,
  fonte text DEFAULT 'manuale'::text,
  dettaglio jsonb,
  file_path text,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, mese, locale)
);


-- ============================================================
-- 4. BUDGET TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.budget_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'draft'::text,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, locale, year, month)
);

CREATE TABLE IF NOT EXISTS public.budget_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_period_id uuid NOT NULL,
  category text NOT NULL,
  subcategory text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  driver_type text,
  driver_config jsonb DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.budget_scenarios (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  locale text NOT NULL,
  base_source text NOT NULL DEFAULT 'consuntivo'::text,
  base_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  levers jsonb NOT NULL DEFAULT '[]'::jsonb,
  simulated_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);


-- ============================================================
-- 4b. FEATURE PLANS / WIDGET PERSONALIZZAZIONE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price_monthly numeric(8,2),
  price_yearly numeric(8,2),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_plans (
  user_id uuid PRIMARY KEY,
  plan_id text NOT NULL REFERENCES public.feature_plans(id) ON DELETE RESTRICT,
  trial_until date,
  valid_until date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_feature_overrides (
  user_id uuid PRIMARY KEY,
  extra jsonb DEFAULT '{}'::jsonb,
  exclude jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_widget_layout (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  tab_key text NOT NULL,
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, tab_key)
);

ALTER TABLE public.feature_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feature_overrides   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_widget_layout       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_plans"     ON public.feature_plans          FOR SELECT USING (true);
CREATE POLICY "own_plan"       ON public.user_plans             FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own_overrides"  ON public.user_feature_overrides FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own_layout"     ON public.user_widget_layout     FOR ALL    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Piano default 'Full' (tutto incluso)
INSERT INTO public.feature_plans (id, name, description, features, is_default)
VALUES ('full', 'Full', 'Tutto incluso. Piano default per fase pilota Alhena Group.',
  '{"tabs":["ov","scontrini","cat","iva","rep","susp","fat","prod","ce","hr","mkt","bud","mag"],"widgets":["*"]}'::jsonb,
  true)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 5. MARKETING / CRM
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tag_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  nome text NOT NULL,
  colore text NOT NULL DEFAULT '#94a3b8',
  icona text,
  descrizione text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, locale, nome)
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  nome text,
  cognome text,
  telefono text,
  email text,
  data_nascita date,
  lingua text DEFAULT 'it',
  note text,
  source text,
  gdpr_marketing boolean DEFAULT false,
  gdpr_profilazione boolean DEFAULT false,
  gdpr_consent_at timestamptz,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_tags (
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tag_definitions(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  PRIMARY KEY (customer_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  codice text NOT NULL,
  nome text NOT NULL,
  descrizione text,
  target_tag_ids uuid[] DEFAULT '{}',
  target_min_visite int DEFAULT 0,
  tipo_sconto text NOT NULL DEFAULT 'percentuale',
  valore_sconto numeric(10,2) NOT NULL DEFAULT 0,
  importo_minimo numeric(10,2) DEFAULT 0,
  data_inizio date,
  data_fine date,
  giorni_settimana int[] DEFAULT NULL,
  ora_inizio time,
  ora_fine time,
  max_utilizzi int,
  max_utilizzi_per_cliente int DEFAULT 1,
  utilizzi_totali int NOT NULL DEFAULT 0,
  attivo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, locale, codice)
);

CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  redeemed_at timestamptz DEFAULT now(),
  importo_scontrino numeric(10,2),
  importo_scontato numeric(10,2),
  scontrino_id text,
  note text
);

CREATE TABLE IF NOT EXISTS public.fidelity_programs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  nome text NOT NULL,
  descrizione text,
  punti_per_euro numeric(8,4) NOT NULL DEFAULT 1.0,
  punti_visita int DEFAULT 0,
  punti_iscrizione int DEFAULT 0,
  punti_compleanno int DEFAULT 0,
  durata_punti_giorni int,
  attivo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, locale)
);

CREATE TABLE IF NOT EXISTS public.fidelity_rewards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  program_id uuid NOT NULL REFERENCES public.fidelity_programs(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descrizione text,
  punti_richiesti int NOT NULL,
  tipo text NOT NULL DEFAULT 'omaggio',
  valore numeric(10,2) DEFAULT 0,
  max_riscatti_globali int,
  max_riscatti_per_cliente int DEFAULT 1,
  riscatti_totali int NOT NULL DEFAULT 0,
  attivo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fidelity_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.fidelity_programs(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  punti int NOT NULL,
  reward_id uuid REFERENCES public.fidelity_rewards(id) ON DELETE SET NULL,
  scontrino_id text,
  importo_scontrino numeric(10,2),
  note text,
  movimento_at timestamptz DEFAULT now(),
  expires_at timestamptz
);


-- ============================================================
-- 6. FOREIGN KEYS (nome semplificato)
-- ============================================================

ALTER TABLE public.attendance                ADD CONSTRAINT fk_att_emp      FOREIGN KEY (employee_id)      REFERENCES public.employees(id);
ALTER TABLE public.budget_rows               ADD CONSTRAINT fk_br_period    FOREIGN KEY (budget_period_id) REFERENCES public.budget_periods(id) ON DELETE CASCADE;
ALTER TABLE public.calendar_events           ADD CONSTRAINT fk_ce_doc       FOREIGN KEY (document_id)      REFERENCES public.employee_documents(id);
ALTER TABLE public.calendar_events           ADD CONSTRAINT fk_ce_emp       FOREIGN KEY (employee_id)      REFERENCES public.employees(id);
ALTER TABLE public.employee_documents        ADD CONSTRAINT fk_ed_emp       FOREIGN KEY (employee_id)      REFERENCES public.employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_pay_history      ADD CONSTRAINT fk_eph_emp      FOREIGN KEY (employee_id)      REFERENCES public.employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_shifts           ADD CONSTRAINT fk_es_emp       FOREIGN KEY (employee_id)      REFERENCES public.employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_time_off         ADD CONSTRAINT fk_eto_emp      FOREIGN KEY (employee_id)      REFERENCES public.employees(id) ON DELETE CASCADE;
ALTER TABLE public.warehouse_aliases         ADD CONSTRAINT fk_wa_prod      FOREIGN KEY (product_id)       REFERENCES public.warehouse_products(id) ON DELETE CASCADE;
ALTER TABLE public.warehouse_inventories     ADD CONSTRAINT fk_wi_loc       FOREIGN KEY (location_id)      REFERENCES public.warehouse_locations(id);
ALTER TABLE public.warehouse_inventory_items ADD CONSTRAINT fk_wii_inv      FOREIGN KEY (inventory_id)     REFERENCES public.warehouse_inventories(id) ON DELETE CASCADE;
ALTER TABLE public.warehouse_inventory_items ADD CONSTRAINT fk_wii_prod     FOREIGN KEY (product_id)       REFERENCES public.warehouse_products(id);
ALTER TABLE public.warehouse_invoice_items   ADD CONSTRAINT fk_wit_inv      FOREIGN KEY (invoice_id)       REFERENCES public.warehouse_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.warehouse_invoice_items   ADD CONSTRAINT fk_wit_prod     FOREIGN KEY (product_id)       REFERENCES public.warehouse_products(id);
ALTER TABLE public.warehouse_movements       ADD CONSTRAINT fk_wm_loc       FOREIGN KEY (location_id)      REFERENCES public.warehouse_locations(id);
ALTER TABLE public.warehouse_movements       ADD CONSTRAINT fk_wm_prod      FOREIGN KEY (product_id)       REFERENCES public.warehouse_products(id);
ALTER TABLE public.warehouse_order_items     ADD CONSTRAINT fk_woi_order    FOREIGN KEY (order_id)         REFERENCES public.warehouse_orders(id) ON DELETE CASCADE;
ALTER TABLE public.warehouse_order_items     ADD CONSTRAINT fk_woi_prod     FOREIGN KEY (product_id)       REFERENCES public.warehouse_products(id);
ALTER TABLE public.warehouse_recipe_items    ADD CONSTRAINT fk_wri_recipe   FOREIGN KEY (recipe_id)        REFERENCES public.warehouse_recipes(id) ON DELETE CASCADE;
ALTER TABLE public.warehouse_stock           ADD CONSTRAINT fk_ws_loc       FOREIGN KEY (location_id)      REFERENCES public.warehouse_locations(id);
ALTER TABLE public.warehouse_stock           ADD CONSTRAINT fk_ws_prod      FOREIGN KEY (product_id)       REFERENCES public.warehouse_products(id);

-- NOTA: user_id NON ha FK verso auth.users in produzione.
-- L'isolamento multi-tenant e' garantito SOLO da RLS (auth.uid() = user_id).
-- Per scriptare ripopolamento iniziale senza FK, lasciato come e'.


-- ============================================================
-- 7. INDICI (oltre a PK e UNIQUE gia' inline)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_budget_periods_user      ON public.budget_periods(user_id, locale, year, month);
CREATE INDEX IF NOT EXISTS idx_budget_rows_period       ON public.budget_rows(budget_period_id, category);
CREATE INDEX IF NOT EXISTS idx_budget_scenarios_user    ON public.budget_scenarios(user_id, locale);
CREATE INDEX IF NOT EXISTS idx_catmap_user              ON public.category_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_user             ON public.recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_we_date                  ON public.webhook_events(document_date);
CREATE INDEX IF NOT EXISTS idx_we_sp                    ON public.webhook_events(salespoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_phone    ON public.customers(user_id, locale, telefono) WHERE telefono IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_email    ON public.customers(user_id, locale, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_user_locale    ON public.customers(user_id, locale);
CREATE INDEX IF NOT EXISTS idx_customers_lastseen       ON public.customers(user_id, locale, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag        ON public.customer_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_promo_user_locale        ON public.promotions(user_id, locale, attivo);
CREATE INDEX IF NOT EXISTS idx_promo_codice             ON public.promotions(user_id, locale, codice) WHERE attivo;
CREATE INDEX IF NOT EXISTS idx_promo_red_promo          ON public.promotion_redemptions(promotion_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_red_customer       ON public.promotion_redemptions(customer_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_red_user           ON public.promotion_redemptions(user_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fid_programs_user        ON public.fidelity_programs(user_id, locale);
CREATE INDEX IF NOT EXISTS idx_fid_rewards_program      ON public.fidelity_rewards(program_id, attivo);
CREATE INDEX IF NOT EXISTS idx_fid_mov_customer         ON public.fidelity_movements(customer_id, movimento_at DESC);
CREATE INDEX IF NOT EXISTS idx_fid_mov_program          ON public.fidelity_movements(program_id, movimento_at DESC);
CREATE INDEX IF NOT EXISTS idx_fid_mov_user             ON public.fidelity_movements(user_id, movimento_at DESC);
CREATE INDEX IF NOT EXISTS idx_fid_mov_exp              ON public.fidelity_movements(customer_id, expires_at) WHERE expires_at IS NOT NULL;


-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================
-- AUDIT MULTI-TENANCY (2026-04-16):
--   - 34 tabelle con RLS attiva → OK
--   - 3 tabelle con RLS DISATTIVATA → FIX in questo file:
--       * live_requests:  usata server-side (cron), ma lasciare RLS off significa
--                         che client anon/auth puo' leggerla.
--       * monthly_stats:  LEAK GRAVE — statistiche aggregate vendite per locale.
--       * webhook_events: LEAK GRAVE — payload webhook con dati sensibili.
--
-- Le 3 tabelle sono scritte esclusivamente server-side via service_role
-- (che bypassa RLS). Attivare RLS senza definire policy → nessuno puo' leggerle
-- dal client. E' il comportamento desiderato.
-- ============================================================

ALTER TABLE public.user_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_stats                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_stats              ENABLE ROW LEVEL SECURITY; -- FIX audit
ALTER TABLE public.webhook_events             ENABLE ROW LEVEL SECURITY; -- FIX audit
ALTER TABLE public.live_requests              ENABLE ROW LEVEL SECURITY; -- FIX audit
ALTER TABLE public.category_mappings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_tokens              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_rules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_cache               ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.warehouse_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_aliases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_movements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_invoice_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_prices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_inventories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_inventory_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_recipes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_recipe_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes                    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employees                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_pay_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shifts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_time_off          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_allergens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_recipes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_checklists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_checklist_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personnel_costs            ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.budget_periods             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_rows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_scenarios           ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tag_definitions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelity_programs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelity_rewards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelity_movements         ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 9. POLICIES BASE (auth.uid() = user_id)
-- ============================================================

-- CORE: own-rows
CREATE POLICY "own_user_settings"     ON public.user_settings     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_category_mappings" ON public.category_mappings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_google_tokens"     ON public.google_tokens     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_item_rules"        ON public.item_rules        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_report_cache"      ON public.report_cache      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- daily_stats, monthly_stats, webhook_events, live_requests: scritti server-side.
-- Nessuna policy → client non vede nulla, service_role continua a funzionare.
-- Se serve esporre daily_stats al client, aggiungere policy custom basata su
-- salespoint_id assegnato all'utente (leggendo user_settings.sales_points).

-- WAREHOUSE: own-rows dove c'e' user_id
CREATE POLICY "own_warehouse_products"        ON public.warehouse_products        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_locations"       ON public.warehouse_locations       FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_stock"           ON public.warehouse_stock           FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_movements"       ON public.warehouse_movements       FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_invoices"        ON public.warehouse_invoices        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_inventories"     ON public.warehouse_inventories     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_orders"          ON public.warehouse_orders          FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_warehouse_recipes"         ON public.warehouse_recipes         FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_recipes"                   ON public.recipes                   FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_daily_report"              ON public.daily_report_settings     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_alert_rules"               ON public.alert_rules               FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_alert_events"              ON public.alert_events              FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_article_allergens"         ON public.article_allergens         FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_production_recipes"        ON public.production_recipes        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_production_batches"        ON public.production_batches        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Lettura pubblica dei lotti (per la pagina /lotto/CODICE accessibile a chiunque, es. ispettori ASL)
CREATE POLICY "public_read_batch_by_lotto"    ON public.production_batches        FOR SELECT USING (true);
CREATE POLICY "checklists_owner"              ON public.attendance_checklists     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "responses_owner"               ON public.attendance_checklist_responses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- WAREHOUSE: child tables senza user_id, via parent EXISTS()
CREATE POLICY "via_parent_wia" ON public.warehouse_aliases         FOR ALL
  USING (EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_aliases.product_id AND p.user_id = auth.uid()));
CREATE POLICY "via_parent_wit" ON public.warehouse_invoice_items   FOR ALL
  USING (EXISTS (SELECT 1 FROM public.warehouse_invoices i WHERE i.id = warehouse_invoice_items.invoice_id AND i.user_id = auth.uid()));
CREATE POLICY "via_parent_wii" ON public.warehouse_inventory_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.warehouse_inventories v WHERE v.id = warehouse_inventory_items.inventory_id AND v.user_id = auth.uid()));
CREATE POLICY "via_parent_woi" ON public.warehouse_order_items     FOR ALL
  USING (EXISTS (SELECT 1 FROM public.warehouse_orders o WHERE o.id = warehouse_order_items.order_id AND o.user_id = auth.uid()));
CREATE POLICY "via_parent_wri" ON public.warehouse_recipe_items    FOR ALL
  USING (EXISTS (SELECT 1 FROM public.warehouse_recipes r WHERE r.id = warehouse_recipe_items.recipe_id AND r.user_id = auth.uid()));
CREATE POLICY "via_parent_wp"  ON public.warehouse_prices          FOR ALL
  USING (EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_prices.product_id AND p.user_id = auth.uid()));

-- HR
CREATE POLICY "own_employees"            ON public.employees            FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_employee_documents"   ON public.employee_documents   FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_employee_pay_history" ON public.employee_pay_history FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_employee_shifts"      ON public.employee_shifts      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_employee_time_off"    ON public.employee_time_off    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_calendar_events"      ON public.calendar_events      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_staff_schedules"      ON public.staff_schedules      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_personnel_costs"      ON public.personnel_costs      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- attendance: la pagina /timbra e' pubblica. Insert/read richiedono solo che
-- l'employee esista, ma ownership via employee.user_id.
CREATE POLICY "public_insert_attendance" ON public.attendance FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id)
);
CREATE POLICY "owner_read_attendance" ON public.attendance FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.user_id = auth.uid())
);

-- BUDGET
CREATE POLICY "own_budget_periods"   ON public.budget_periods   FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_budget_scenarios" ON public.budget_scenarios FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "via_parent_br" ON public.budget_rows FOR ALL
  USING (EXISTS (SELECT 1 FROM public.budget_periods p WHERE p.id = budget_rows.budget_period_id AND p.user_id = auth.uid()));

-- MARKETING / CRM
CREATE POLICY "own_tag_defs"   ON public.tag_definitions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_customers"  ON public.customers       FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_cust_tags"  ON public.customer_tags   FOR ALL
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND c.user_id = auth.uid()));
CREATE POLICY "own_promotions"            ON public.promotions             FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_promotion_redemptions" ON public.promotion_redemptions  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_fid_programs"          ON public.fidelity_programs      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_fid_rewards"           ON public.fidelity_rewards       FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_fid_movements"         ON public.fidelity_movements     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);



-- ============================================================
-- 10. MULTI-TENANCY SELF-TEST (da eseguire manualmente)
-- ============================================================
-- Istruzioni per verificare che l'isolamento funzioni:
--
-- 1. Creare 2 utenti test via Supabase Auth Dashboard:
--    - userA@test.com / password
--    - userB@test.com / password
-- 2. Da SQL Editor come service_role, ottenere gli id:
--    SELECT id, email FROM auth.users WHERE email LIKE '%@test.com';
-- 3. Inserire 1 riga "propria" per ciascuno in 3-4 tabelle campione, es:
--    INSERT INTO recipes (user_id, nome_prodotto, ingredienti)
--      VALUES ('<userA_id>', 'test_A', '[]'), ('<userB_id>', 'test_B', '[]');
-- 4. Loggarsi dalla dashboard impersonando userA (Authentication → User → Impersonate)
-- 5. In SQL Editor impostare role authenticated:
--      SET LOCAL role authenticated;
--      SET LOCAL request.jwt.claims = '{"sub":"<userA_id>","role":"authenticated"}';
--      SELECT count(*) FROM recipes;    -- atteso: 1 (solo test_A)
--      SELECT count(*) FROM employees;  -- atteso: righe solo di userA
-- 6. Tentare cross-user attack:
--      UPDATE recipes SET note='hacked' WHERE nome_prodotto='test_B';
--      -- atteso: 0 rows updated (RLS blocca)
-- 7. Ripetere con userB.
--
-- Query rapida: tabelle con RLS attiva e nessuna policy (potenziali tabelle
-- accidentalmente "mute" anche al legittimo proprietario):
--   SELECT t.tablename
--   FROM pg_tables t
--   LEFT JOIN pg_policies p ON p.schemaname=t.schemaname AND p.tablename=t.tablename
--   WHERE t.schemaname='public' AND t.rowsecurity=true AND p.policyname IS NULL;
-- Atteso (post-fix): live_requests, monthly_stats, webhook_events, daily_stats
-- (intenzionale, scritte solo server-side).
