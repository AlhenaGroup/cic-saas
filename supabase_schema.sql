-- Tabella settings utente con Row Level Security
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  cic_api_key TEXT NOT NULL,
  sales_points JSONB DEFAULT '[]',
  created_at TIMESTAMPTY NOT(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own settings" ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own settings" ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own settings" ON user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own settings" ON user_settings FOR DELETE USING (auth.uid() = user_id);

-- Plateform integration (CRM + RFM)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS plateform_api_key TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS plateform_location_map JSONB DEFAULT '{}'::jsonb;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS plateform_last_sync TIMESTAMPTZ;

-- ─── Marketing module ───────────────────────────────────────────────────────
-- Task marketing con priorità, scadenze, tipo, locale
CREATE TABLE IF NOT EXISTS marketing_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  titolo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'altro',             -- campagna | contenuto | review | altro
  locale TEXT,                                     -- id o descrizione del salespoint, NULL = tutti
  scadenza DATE,                                   -- NULL = senza scadenza
  priorita TEXT NOT NULL DEFAULT 'planned',        -- urgent | soon | planned
  stato TEXT NOT NULL DEFAULT 'open',              -- open | done
  note TEXT,
  auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,                                     -- origine del task auto-generato (es. 'rfm_at_risk')
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_marketing_tasks_user ON marketing_tasks(user_id, stato, priorita);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_scadenza ON marketing_tasks(scadenza) WHERE stato = 'open';

ALTER TABLE marketing_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own mkt tasks"   ON marketing_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own mkt tasks" ON marketing_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own mkt tasks" ON marketing_tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own mkt tasks" ON marketing_tasks FOR DELETE USING (auth.uid() = user_id);

-- Clienti importati da Plateform via CSV export
CREATE TABLE IF NOT EXISTS plateform_customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- external id from Plateform (elasticCustomerID if available, else composite name+mobile hash)
  external_id TEXT NOT NULL,
  -- anagrafica
  nome TEXT,
  cognome TEXT,
  email TEXT,
  telefono TEXT,
  citta TEXT,
  -- locale di appartenenza Plateform
  locale TEXT,                                     -- es. "CASA DE AMICIS"
  location_id INTEGER,                             -- Plateform locationID numeric
  -- RFM raw data
  visite INTEGER DEFAULT 0,
  ultima_visita DATE,
  prima_visita DATE,
  totale_speso NUMERIC(10, 2) DEFAULT 0,
  coperto_medio NUMERIC(10, 2) DEFAULT 0,
  coperti_totali INTEGER DEFAULT 0,
  -- flags marketing
  flag_marketing BOOLEAN DEFAULT FALSE,
  flag_privacy BOOLEAN DEFAULT FALSE,
  flag_unsubscribe BOOLEAN DEFAULT FALSE,
  flag_blacklist BOOLEAN DEFAULT FALSE,
  flag_vip BOOLEAN DEFAULT FALSE,
  -- metadata
  source TEXT,                                     -- canale acquisizione Plateform
  tags TEXT[],
  note TEXT,
  -- computed RFM segment (overridden on each import)
  rfm_segment TEXT,                                -- champion | loyal | at_risk | lost | new | one_timer
  rfm_score INTEGER,
  -- timestamps
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_plat_cust_user     ON plateform_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_plat_cust_segment  ON plateform_customers(user_id, rfm_segment);
CREATE INDEX IF NOT EXISTS idx_plat_cust_locale   ON plateform_customers(user_id, locale);
CREATE INDEX IF NOT EXISTS idx_plat_cust_lastvis  ON plateform_customers(user_id, ultima_visita DESC);

ALTER TABLE plateform_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own plat customers"   ON plateform_customers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own plat customers" ON plateform_customers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own plat customers" ON plateform_customers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own plat customers" ON plateform_customers FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- BUDGET, FORECAST & SIMULATORE DIREZIONALE (Fase 1)
-- ─────────────────────────────────────────────────────────────────────────────

-- Budget mensile per locale (1 record per user × locale × anno × mese)
CREATE TABLE IF NOT EXISTS budget_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  locale TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, locale, year, month)
);
CREATE INDEX IF NOT EXISTS idx_budget_periods_user ON budget_periods(user_id, locale, year, month);
ALTER TABLE budget_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own budget periods"   ON budget_periods FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own budget periods" ON budget_periods FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own budget periods" ON budget_periods FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own budget periods" ON budget_periods FOR DELETE USING (auth.uid() = user_id);

-- Righe del budget: una per categoria (ricavi, food, beverage, materiali, personale, struttura)
CREATE TABLE IF NOT EXISTS budget_rows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_period_id UUID REFERENCES budget_periods(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  driver_type TEXT,
  driver_config JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_rows_period ON budget_rows(budget_period_id, category);
ALTER TABLE budget_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own budget rows" ON budget_rows FOR SELECT
  USING (EXISTS (SELECT 1 FROM budget_periods p WHERE p.id = budget_period_id AND p.user_id = auth.uid()));
CREATE POLICY "Users insert own budget rows" ON budget_rows FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM budget_periods p WHERE p.id = budget_period_id AND p.user_id = auth.uid()));
CREATE POLICY "Users update own budget rows" ON budget_rows FOR UPDATE
  USING (EXISTS (SELECT 1 FROM budget_periods p WHERE p.id = budget_period_id AND p.user_id = auth.uid()));
CREATE POLICY "Users delete own budget rows" ON budget_rows FOR DELETE
  USING (EXISTS (SELECT 1 FROM budget_periods p WHERE p.id = budget_period_id AND p.user_id = auth.uid()));

-- Scenari del simulatore (base + leve salvate per uso futuro)
CREATE TABLE IF NOT EXISTS budget_scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  locale TEXT NOT NULL,
  base_source TEXT NOT NULL DEFAULT 'consuntivo',
  base_values JSONB NOT NULL DEFAULT '{}',
  levers JSONB NOT NULL DEFAULT '[]',
  simulated_values JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_scenarios_user ON budget_scenarios(user_id, locale);
ALTER TABLE budget_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own scenarios"   ON budget_scenarios FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own scenarios" ON budget_scenarios FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own scenarios" ON budget_scenarios FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own scenarios" ON budget_scenarios FOR DELETE USING (auth.uid() = user_id);

-- Mappature categorie apprese (nome_prodotto → categoria CE)
CREATE TABLE IF NOT EXISTS category_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome_prodotto TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, nome_prodotto)
);
CREATE INDEX IF NOT EXISTS idx_catmap_user ON category_mappings(user_id);
ALTER TABLE category_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own mappings" ON category_mappings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own mappings" ON category_mappings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own mappings" ON category_mappings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own mappings" ON category_mappings FOR DELETE USING (auth.uid() = user_id);

-- Colonna nome_articolo per mappare descrizione fornitore → nome interno
ALTER TABLE warehouse_invoice_items ADD COLUMN IF NOT EXISTS nome_articolo TEXT;
