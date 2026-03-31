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
