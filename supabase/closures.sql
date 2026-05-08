-- ============================================================
-- Chiusure & Versamenti — tabella per giorno × locale
-- ============================================================
-- Memorizza chiusure giornaliere con valori manuali (override) e calcolati.
-- Permette all'imprenditore di rivedere/correggere POS/Satispay/Fatture
-- quando il personale ha sbagliato in checklist.
--
-- Calcolo contanti (lato app, non SQL): corrispettivo + fatture - pos - satispay
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  locale text NOT NULL,
  data date NOT NULL,
  corrispettivo numeric(12,2),       -- totale incassi cassa (auto da daily_stats, override possibile)
  fatture_emesse numeric(12,2),       -- fatture attive emesse nel giorno (manuale)
  pos numeric(12,2),                  -- da checklist o manuale
  satispay numeric(12,2),             -- da checklist o manuale
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS closures_unique_idx ON public.closures (user_id, locale, data);
CREATE INDEX IF NOT EXISTS closures_user_data_idx ON public.closures (user_id, data DESC);

ALTER TABLE public.closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cl_s" ON public.closures;
DROP POLICY IF EXISTS "cl_i" ON public.closures;
DROP POLICY IF EXISTS "cl_u" ON public.closures;
DROP POLICY IF EXISTS "cl_d" ON public.closures;
CREATE POLICY "cl_s" ON public.closures FOR SELECT USING (
  public.can_access(user_id, 'conta.chiusure', false)
);
CREATE POLICY "cl_i" ON public.closures FOR INSERT WITH CHECK (
  public.can_access(user_id, 'conta.chiusure', true)
);
CREATE POLICY "cl_u" ON public.closures FOR UPDATE USING (
  public.can_access(user_id, 'conta.chiusure', true)
) WITH CHECK (public.can_access(user_id, 'conta.chiusure', true));
CREATE POLICY "cl_d" ON public.closures FOR DELETE USING (
  public.can_access(user_id, 'conta.chiusure', true)
);

COMMIT;
