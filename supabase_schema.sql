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
