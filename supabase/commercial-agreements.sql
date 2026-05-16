-- ============================================================
-- Accordi Commerciali Fornitori
-- ============================================================
-- Modulo "controllo di gestione" per censire i contratti con i fornitori
-- (rappel, premio merce, scaglioni, mix target, bonus, sconto volume) e
-- tracciarne l'avanzamento in tempo reale a partire dalle fatture di
-- acquisto già presenti in warehouse_invoices.
--
-- Tabelle (additive, zero impatto sul codice esistente):
--   suppliers                       — anagrafica fornitori
--   commercial_agreements           — contratti quadro
--   agreement_tiers                 — scaglioni opzionali (target → premio)
--   agreement_items                 — articoli/categorie inclusi nel target
--   agreement_progress_snapshots    — storicizzazione (per sparkline)
--
-- Modifica leggera su warehouse_invoices: aggiunge supplier_id opzionale
-- (FK a suppliers) per il match. Il campo legacy 'fornitore' (text) resta
-- per retrocompatibilità; il match si fa anche fuzzy via suppliers.match_aliases.
--
-- RLS: ogni utente vede SOLO i propri dati (user_id = auth.uid()).
--
-- ESEGUI QUESTO FILE SU SUPABASE (SQL Editor) IN UN'UNICA TRANSAZIONE.
-- ============================================================

BEGIN;

-- ─── 1. Suppliers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  vat_number      text,
  contact_email   text,
  contact_phone   text,
  notes           text,
  -- alias testuali usati per matchare il campo legacy warehouse_invoices.fornitore
  match_aliases   text[] NOT NULL DEFAULT '{}',
  category        text,  -- es. 'beverage', 'food', 'caffè', 'non-food' — solo informativo
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS suppliers_user_idx ON public.suppliers(user_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_owner_all ON public.suppliers;
CREATE POLICY suppliers_owner_all ON public.suppliers
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ─── 2. Commercial agreements ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commercial_agreements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id        uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  -- nullable = vale per tutti i locali dell'utente; popolato = solo quelli
  -- Il valore è il NOME del locale come appare in warehouse_invoices.locale
  -- (es. ["CASA DE AMICIS", "REMEMBEER"]) — non l'ID intero del salespoint.
  locales            text[],
  name               text NOT NULL,
  description        text,
  notes              text,
  agreement_type     text NOT NULL CHECK (agreement_type IN (
                       'rappel',           -- sconto retroattivo su totale
                       'free_goods',       -- merce omaggio a soglia
                       'tiered_discount',  -- scaglioni progressivi
                       'mix_target',       -- % mix su articoli
                       'flat_bonus',       -- bonus una tantum
                       'volume_discount'   -- sconto immediato per volume
                     )),
  metric             text NOT NULL CHECK (metric IN (
                       'volume_liters', 'volume_pieces', 'revenue_eur', 'mix_percentage'
                     )),
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft', 'active', 'achieved', 'failed', 'expired', 'renewed'
                     )),
  reward_type        text CHECK (reward_type IN (
                       'discount_pct', 'discount_amount', 'free_goods', 'cash_bonus'
                     )),
  reward_value       numeric(12, 2),
  reward_description text,
  contract_file_url  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS agreements_user_idx          ON public.commercial_agreements(user_id);
CREATE INDEX IF NOT EXISTS agreements_supplier_idx      ON public.commercial_agreements(supplier_id);
CREATE INDEX IF NOT EXISTS agreements_status_idx        ON public.commercial_agreements(user_id, status);
CREATE INDEX IF NOT EXISTS agreements_active_period_idx ON public.commercial_agreements(user_id, start_date, end_date) WHERE status = 'active';

ALTER TABLE public.commercial_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agreements_owner_all ON public.commercial_agreements;
CREATE POLICY agreements_owner_all ON public.commercial_agreements
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ─── 3. Agreement tiers (scaglioni opzionali) ─────────────────────
CREATE TABLE IF NOT EXISTS public.agreement_tiers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id       uuid NOT NULL REFERENCES public.commercial_agreements(id) ON DELETE CASCADE,
  threshold          numeric(14, 2) NOT NULL,  -- valore soglia espresso nella metrica dell'accordo
  reward_type        text CHECK (reward_type IN (
                       'discount_pct', 'discount_amount', 'free_goods', 'cash_bonus'
                     )),
  reward_value       numeric(12, 2),
  reward_description text,
  sort_order         int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiers_agreement_idx ON public.agreement_tiers(agreement_id, sort_order);

ALTER TABLE public.agreement_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiers_owner_all ON public.agreement_tiers;
CREATE POLICY tiers_owner_all ON public.agreement_tiers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.commercial_agreements a WHERE a.id = agreement_id AND a.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.commercial_agreements a WHERE a.id = agreement_id AND a.user_id = auth.uid())
  );


-- ─── 4. Agreement items (articoli/categorie inclusi) ──────────────
-- item_type:
--   'product'  → item_reference_id = warehouse_products.id (uuid in text)
--   'category' → item_reference_id = nome categoria libera
--   'brand'    → item_reference_id = nome brand libero
--   'all'      → tutti gli articoli del fornitore (item_reference_id = null)
CREATE TABLE IF NOT EXISTS public.agreement_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id       uuid NOT NULL REFERENCES public.commercial_agreements(id) ON DELETE CASCADE,
  item_type          text NOT NULL CHECK (item_type IN ('product', 'category', 'brand', 'all')),
  item_reference_id  text,
  item_label         text,    -- snapshot leggibile (es. "Aperol 70cl", "Birre", "Coca-Cola")
  weight             numeric(5, 2),  -- per mix_target: peso percentuale richiesto sul totale
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_agreement_idx ON public.agreement_items(agreement_id);

ALTER TABLE public.agreement_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_owner_all ON public.agreement_items;
CREATE POLICY items_owner_all ON public.agreement_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.commercial_agreements a WHERE a.id = agreement_id AND a.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.commercial_agreements a WHERE a.id = agreement_id AND a.user_id = auth.uid())
  );


-- ─── 5. Agreement progress snapshots (storico per grafici) ────────
CREATE TABLE IF NOT EXISTS public.agreement_progress_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id        uuid NOT NULL REFERENCES public.commercial_agreements(id) ON DELETE CASCADE,
  snapshot_date       date NOT NULL,
  current_value       numeric(14, 2) NOT NULL,
  percentage_complete numeric(5, 2),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS snapshots_agreement_idx ON public.agreement_progress_snapshots(agreement_id, snapshot_date DESC);

ALTER TABLE public.agreement_progress_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snapshots_owner_all ON public.agreement_progress_snapshots;
CREATE POLICY snapshots_owner_all ON public.agreement_progress_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.commercial_agreements a WHERE a.id = agreement_id AND a.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.commercial_agreements a WHERE a.id = agreement_id AND a.user_id = auth.uid())
  );


-- ─── 6. warehouse_invoices: aggiungi supplier_id opzionale ────────
-- Colonna nullable, niente CHECK, niente default fisso → zero impatto sul codice
-- esistente che continua a leggere/scrivere il campo 'fornitore' (text).
ALTER TABLE public.warehouse_invoices
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS warehouse_invoices_supplier_idx ON public.warehouse_invoices(supplier_id) WHERE supplier_id IS NOT NULL;


-- ─── 7. Backfill suppliers da warehouse_invoices.fornitore ────────
-- Per ogni utente, prendi i fornitori distinti dalle sue fatture esistenti
-- e crea record suppliers. Il nome originale del campo finisce anche in
-- match_aliases così il match futuro vede il legacy come alias.
INSERT INTO public.suppliers (user_id, name, match_aliases)
SELECT DISTINCT
  wi.user_id,
  TRIM(wi.fornitore)            AS name,
  ARRAY[TRIM(wi.fornitore)]     AS match_aliases
FROM public.warehouse_invoices wi
WHERE wi.fornitore IS NOT NULL
  AND TRIM(wi.fornitore) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.user_id = wi.user_id
      AND lower(s.name) = lower(TRIM(wi.fornitore))
  );


-- ─── 8. Backfill supplier_id su fatture esistenti ─────────────────
-- Associa ogni fattura al supplier appena creato (match case-insensitive sul nome).
UPDATE public.warehouse_invoices wi
SET supplier_id = s.id
FROM public.suppliers s
WHERE wi.supplier_id IS NULL
  AND s.user_id = wi.user_id
  AND lower(s.name) = lower(TRIM(wi.fornitore));


-- ─── 9. Trigger updated_at ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_suppliers ON public.suppliers;
CREATE TRIGGER set_updated_at_suppliers BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_agreements ON public.commercial_agreements;
CREATE TRIGGER set_updated_at_agreements BEFORE UPDATE ON public.commercial_agreements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


NOTIFY pgrst, 'reload schema';

COMMIT;
