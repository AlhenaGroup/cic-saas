-- ============================================================
-- Staff Access — patch 2
-- ============================================================
-- ArticoliTab, MovementsView, StockView, PriceAnalysis nel frontend fanno
-- query con `warehouse_invoices!inner(...)` (PostgREST inner-join sul padre).
-- Servono permessi di SELECT sul padre warehouse_invoices anche per gli
-- staff che hanno solo permessi sui figli (mag.articoli, mag.movimenti,
-- mag.giacenze, mag.prezzi).
--
-- Soluzione: la SELECT su warehouse_invoices passa se lo staff ha QUALSIASI
-- permesso sui sub-tab Magazzino o Contabilita' che usano le fatture come
-- "sorgente di verita'". L'INSERT/UPDATE/DELETE restano stretti su
-- mag.fatture / conta.fatture.
-- ============================================================

BEGIN;

-- warehouse_invoices: SELECT esteso a tutti i sub-tab che ne dipendono
DROP POLICY IF EXISTS "wi_s" ON public.warehouse_invoices;
CREATE POLICY "wi_s" ON public.warehouse_invoices FOR SELECT USING (
  can_access(user_id, 'mag.fatture',     false) OR
  can_access(user_id, 'conta.fatture',   false) OR
  can_access(user_id, 'mag.articoli',    false) OR
  can_access(user_id, 'mag.giacenze',    false) OR
  can_access(user_id, 'mag.movimenti',   false) OR
  can_access(user_id, 'mag.prezzi',      false) OR
  can_access(user_id, 'mag.ricette',     false) OR
  can_access(user_id, 'mag.semilavorati',false) OR
  can_access(user_id, 'mag.cruscotto',   false) OR
  can_access(user_id, 'conta.ce',        false)
);

-- warehouse_products: stesso pattern (Articoli e altri sub-tab leggono prodotti)
DROP POLICY IF EXISTS "wp_s" ON public.warehouse_products;
CREATE POLICY "wp_s" ON public.warehouse_products FOR SELECT USING (
  can_access(user_id, 'mag.prodotti',     false) OR
  can_access(user_id, 'mag.articoli',     false) OR
  can_access(user_id, 'mag.giacenze',     false) OR
  can_access(user_id, 'mag.movimenti',    false) OR
  can_access(user_id, 'mag.prezzi',       false) OR
  can_access(user_id, 'mag.cruscotto',    false)
);

-- recipes: SELECT visibile anche se lo staff ha solo Cruscotto (per food cost view)
DROP POLICY IF EXISTS "rec_s" ON public.recipes;
CREATE POLICY "rec_s" ON public.recipes FOR SELECT USING (
  can_access(user_id, 'mag.ricette',      false) OR
  can_access(user_id, 'mag.cruscotto',    false) OR
  can_access(user_id, 'mag.semilavorati', false)
);

-- manual_articles: visibile anche da Ricette (Ricette mostra semilavorati come ingredienti)
DROP POLICY IF EXISTS "ma_s" ON public.manual_articles;
CREATE POLICY "ma_s" ON public.manual_articles FOR SELECT USING (
  can_access(user_id, 'mag.semilavorati', false) OR
  can_access(user_id, 'mag.ricette',      false)
);

COMMIT;
