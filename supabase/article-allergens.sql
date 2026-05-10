-- ============================================================
-- Allergeni per articolo magazzino
-- ============================================================
-- Mappa nome_articolo -> lista allergeni (Reg. UE 1169/2011).
-- Una riga per articolo unico per user_id. Diventa fonte di verita' per:
--   - ricette finite (recipes)
--   - semilavorati (manual_articles)
--   - schede produzione (production_recipes)
--   - lotti (production_batches, ereditati dalla scheda)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.article_allergens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome_articolo text NOT NULL,
  allergeni jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- array di chiavi: glutine,crostacei,uova,pesce,arachidi,soia,latte,
    -- frutta_a_guscio,sedano,senape,sesamo,solfiti,lupini,molluschi
  source text NOT NULL DEFAULT 'manual',  -- 'manual' (utente) | 'auto' (keyword match)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, nome_articolo)
);

CREATE INDEX IF NOT EXISTS article_allergens_user_idx ON public.article_allergens(user_id);

ALTER TABLE public.article_allergens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "art_allerg_s" ON public.article_allergens;
DROP POLICY IF EXISTS "art_allerg_i" ON public.article_allergens;
DROP POLICY IF EXISTS "art_allerg_u" ON public.article_allergens;
DROP POLICY IF EXISTS "art_allerg_d" ON public.article_allergens;

CREATE POLICY "art_allerg_s" ON public.article_allergens FOR SELECT USING (
  user_id = auth.uid() OR public.can_access(user_id, 'mag.articoli', false)
);
CREATE POLICY "art_allerg_i" ON public.article_allergens FOR INSERT WITH CHECK (
  user_id = auth.uid() OR public.can_access(user_id, 'mag.articoli', true)
);
CREATE POLICY "art_allerg_u" ON public.article_allergens FOR UPDATE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'mag.articoli', true)
) WITH CHECK (user_id = auth.uid() OR public.can_access(user_id, 'mag.articoli', true));
CREATE POLICY "art_allerg_d" ON public.article_allergens FOR DELETE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'mag.articoli', true)
);

COMMIT;
