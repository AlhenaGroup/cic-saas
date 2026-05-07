-- ============================================================
-- Staff Access — patch 1
-- ============================================================
-- Aggiorna le RLS policies di tabelle che erano state saltate nella
-- migration originale staff-access.sql:
--   - manual_articles (semilavorati)
--   - tabelle child via parent (warehouse_*_items, warehouse_aliases, warehouse_prices, customer_tags)
--   - tabelle marketing minori (automations, campaigns, reservations, surveys, reviews, centralino_*)
--
-- Idempotente: tutti i CREATE POLICY hanno DROP POLICY IF EXISTS prima.
-- ============================================================

BEGIN;

-- ─── manual_articles (Semilavorati) ──────────────────────────
DROP POLICY IF EXISTS "own_manual_articles" ON public.manual_articles;
DROP POLICY IF EXISTS "ma_s" ON public.manual_articles;
DROP POLICY IF EXISTS "ma_i" ON public.manual_articles;
DROP POLICY IF EXISTS "ma_u" ON public.manual_articles;
DROP POLICY IF EXISTS "ma_d" ON public.manual_articles;
CREATE POLICY "ma_s" ON public.manual_articles FOR SELECT USING (can_access(user_id, 'mag.semilavorati', false));
CREATE POLICY "ma_i" ON public.manual_articles FOR INSERT WITH CHECK (can_access(user_id, 'mag.semilavorati', true));
CREATE POLICY "ma_u" ON public.manual_articles FOR UPDATE USING (can_access(user_id, 'mag.semilavorati', true)) WITH CHECK (can_access(user_id, 'mag.semilavorati', true));
CREATE POLICY "ma_d" ON public.manual_articles FOR DELETE USING (can_access(user_id, 'mag.semilavorati', true));

-- ─── warehouse_invoice_items (via parent) ────────────────────
DROP POLICY IF EXISTS "via_parent_wit" ON public.warehouse_invoice_items;
DROP POLICY IF EXISTS "wit_s" ON public.warehouse_invoice_items;
DROP POLICY IF EXISTS "wit_i" ON public.warehouse_invoice_items;
DROP POLICY IF EXISTS "wit_u" ON public.warehouse_invoice_items;
DROP POLICY IF EXISTS "wit_d" ON public.warehouse_invoice_items;
CREATE POLICY "wit_s" ON public.warehouse_invoice_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouse_invoices i WHERE i.id = warehouse_invoice_items.invoice_id
          AND (can_access(i.user_id, 'mag.fatture', false) OR can_access(i.user_id, 'conta.fatture', false) OR can_access(i.user_id, 'mag.articoli', false)))
);
CREATE POLICY "wit_i" ON public.warehouse_invoice_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_invoices i WHERE i.id = warehouse_invoice_items.invoice_id
          AND (can_access(i.user_id, 'mag.fatture', true) OR can_access(i.user_id, 'conta.fatture', true) OR can_access(i.user_id, 'mag.articoli', true)))
);
CREATE POLICY "wit_u" ON public.warehouse_invoice_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouse_invoices i WHERE i.id = warehouse_invoice_items.invoice_id
          AND (can_access(i.user_id, 'mag.fatture', true) OR can_access(i.user_id, 'conta.fatture', true) OR can_access(i.user_id, 'mag.articoli', true)))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_invoices i WHERE i.id = warehouse_invoice_items.invoice_id
          AND (can_access(i.user_id, 'mag.fatture', true) OR can_access(i.user_id, 'conta.fatture', true) OR can_access(i.user_id, 'mag.articoli', true)))
);
CREATE POLICY "wit_d" ON public.warehouse_invoice_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.warehouse_invoices i WHERE i.id = warehouse_invoice_items.invoice_id
          AND (can_access(i.user_id, 'mag.fatture', true) OR can_access(i.user_id, 'conta.fatture', true) OR can_access(i.user_id, 'mag.articoli', true)))
);

-- ─── warehouse_inventory_items (via parent) ──────────────────
DROP POLICY IF EXISTS "via_parent_wii" ON public.warehouse_inventory_items;
DROP POLICY IF EXISTS "wii_s" ON public.warehouse_inventory_items;
DROP POLICY IF EXISTS "wii_i" ON public.warehouse_inventory_items;
DROP POLICY IF EXISTS "wii_u" ON public.warehouse_inventory_items;
DROP POLICY IF EXISTS "wii_d" ON public.warehouse_inventory_items;
CREATE POLICY "wii_s" ON public.warehouse_inventory_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouse_inventories v WHERE v.id = warehouse_inventory_items.inventory_id AND can_access(v.user_id, 'mag.inventario', false))
);
CREATE POLICY "wii_i" ON public.warehouse_inventory_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_inventories v WHERE v.id = warehouse_inventory_items.inventory_id AND can_access(v.user_id, 'mag.inventario', true))
);
CREATE POLICY "wii_u" ON public.warehouse_inventory_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouse_inventories v WHERE v.id = warehouse_inventory_items.inventory_id AND can_access(v.user_id, 'mag.inventario', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_inventories v WHERE v.id = warehouse_inventory_items.inventory_id AND can_access(v.user_id, 'mag.inventario', true))
);
CREATE POLICY "wii_d" ON public.warehouse_inventory_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.warehouse_inventories v WHERE v.id = warehouse_inventory_items.inventory_id AND can_access(v.user_id, 'mag.inventario', true))
);

-- ─── warehouse_order_items (via parent) ──────────────────────
DROP POLICY IF EXISTS "via_parent_woi" ON public.warehouse_order_items;
DROP POLICY IF EXISTS "woi_s" ON public.warehouse_order_items;
DROP POLICY IF EXISTS "woi_i" ON public.warehouse_order_items;
DROP POLICY IF EXISTS "woi_u" ON public.warehouse_order_items;
DROP POLICY IF EXISTS "woi_d" ON public.warehouse_order_items;
CREATE POLICY "woi_s" ON public.warehouse_order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouse_orders o WHERE o.id = warehouse_order_items.order_id AND can_access(o.user_id, 'mag.ordini', false))
);
CREATE POLICY "woi_i" ON public.warehouse_order_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_orders o WHERE o.id = warehouse_order_items.order_id AND can_access(o.user_id, 'mag.ordini', true))
);
CREATE POLICY "woi_u" ON public.warehouse_order_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouse_orders o WHERE o.id = warehouse_order_items.order_id AND can_access(o.user_id, 'mag.ordini', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_orders o WHERE o.id = warehouse_order_items.order_id AND can_access(o.user_id, 'mag.ordini', true))
);
CREATE POLICY "woi_d" ON public.warehouse_order_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.warehouse_orders o WHERE o.id = warehouse_order_items.order_id AND can_access(o.user_id, 'mag.ordini', true))
);

-- ─── warehouse_recipe_items (via parent) ─────────────────────
DROP POLICY IF EXISTS "via_parent_wri" ON public.warehouse_recipe_items;
DROP POLICY IF EXISTS "wri_s" ON public.warehouse_recipe_items;
DROP POLICY IF EXISTS "wri_i" ON public.warehouse_recipe_items;
DROP POLICY IF EXISTS "wri_u" ON public.warehouse_recipe_items;
DROP POLICY IF EXISTS "wri_d" ON public.warehouse_recipe_items;
CREATE POLICY "wri_s" ON public.warehouse_recipe_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouse_recipes r WHERE r.id = warehouse_recipe_items.recipe_id AND can_access(r.user_id, 'mag.ricette', false))
);
CREATE POLICY "wri_i" ON public.warehouse_recipe_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_recipes r WHERE r.id = warehouse_recipe_items.recipe_id AND can_access(r.user_id, 'mag.ricette', true))
);
CREATE POLICY "wri_u" ON public.warehouse_recipe_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouse_recipes r WHERE r.id = warehouse_recipe_items.recipe_id AND can_access(r.user_id, 'mag.ricette', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_recipes r WHERE r.id = warehouse_recipe_items.recipe_id AND can_access(r.user_id, 'mag.ricette', true))
);
CREATE POLICY "wri_d" ON public.warehouse_recipe_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.warehouse_recipes r WHERE r.id = warehouse_recipe_items.recipe_id AND can_access(r.user_id, 'mag.ricette', true))
);

-- ─── warehouse_aliases (via parent product) ──────────────────
DROP POLICY IF EXISTS "via_parent_wia" ON public.warehouse_aliases;
DROP POLICY IF EXISTS "wia_s" ON public.warehouse_aliases;
DROP POLICY IF EXISTS "wia_i" ON public.warehouse_aliases;
DROP POLICY IF EXISTS "wia_u" ON public.warehouse_aliases;
DROP POLICY IF EXISTS "wia_d" ON public.warehouse_aliases;
CREATE POLICY "wia_s" ON public.warehouse_aliases FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_aliases.product_id AND can_access(p.user_id, 'mag.prodotti', false))
);
CREATE POLICY "wia_i" ON public.warehouse_aliases FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_aliases.product_id AND can_access(p.user_id, 'mag.prodotti', true))
);
CREATE POLICY "wia_u" ON public.warehouse_aliases FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_aliases.product_id AND can_access(p.user_id, 'mag.prodotti', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_aliases.product_id AND can_access(p.user_id, 'mag.prodotti', true))
);
CREATE POLICY "wia_d" ON public.warehouse_aliases FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_aliases.product_id AND can_access(p.user_id, 'mag.prodotti', true))
);

-- ─── warehouse_prices (via parent product) ───────────────────
DROP POLICY IF EXISTS "via_parent_wp" ON public.warehouse_prices;
DROP POLICY IF EXISTS "wpr_s" ON public.warehouse_prices;
DROP POLICY IF EXISTS "wpr_i" ON public.warehouse_prices;
DROP POLICY IF EXISTS "wpr_u" ON public.warehouse_prices;
DROP POLICY IF EXISTS "wpr_d" ON public.warehouse_prices;
CREATE POLICY "wpr_s" ON public.warehouse_prices FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_prices.product_id AND can_access(p.user_id, 'mag.prezzi', false))
);
CREATE POLICY "wpr_i" ON public.warehouse_prices FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_prices.product_id AND can_access(p.user_id, 'mag.prezzi', true))
);
CREATE POLICY "wpr_u" ON public.warehouse_prices FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_prices.product_id AND can_access(p.user_id, 'mag.prezzi', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_prices.product_id AND can_access(p.user_id, 'mag.prezzi', true))
);
CREATE POLICY "wpr_d" ON public.warehouse_prices FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.warehouse_products p WHERE p.id = warehouse_prices.product_id AND can_access(p.user_id, 'mag.prezzi', true))
);

-- ─── customer_tags (via parent customer) ─────────────────────
DROP POLICY IF EXISTS "own_cust_tags" ON public.customer_tags;
DROP POLICY IF EXISTS "ct_s" ON public.customer_tags;
DROP POLICY IF EXISTS "ct_i" ON public.customer_tags;
DROP POLICY IF EXISTS "ct_u" ON public.customer_tags;
DROP POLICY IF EXISTS "ct_d" ON public.customer_tags;
CREATE POLICY "ct_s" ON public.customer_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND can_access(c.user_id, 'mkt.clienti', false))
);
CREATE POLICY "ct_i" ON public.customer_tags FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND can_access(c.user_id, 'mkt.clienti', true))
);
CREATE POLICY "ct_u" ON public.customer_tags FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND can_access(c.user_id, 'mkt.clienti', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND can_access(c.user_id, 'mkt.clienti', true))
);
CREATE POLICY "ct_d" ON public.customer_tags FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tags.customer_id AND can_access(c.user_id, 'mkt.clienti', true))
);

-- ─── budget_rows (via parent budget_periods) ─────────────────
DROP POLICY IF EXISTS "via_parent_br" ON public.budget_rows;
DROP POLICY IF EXISTS "br_s" ON public.budget_rows;
DROP POLICY IF EXISTS "br_i" ON public.budget_rows;
DROP POLICY IF EXISTS "br_u" ON public.budget_rows;
DROP POLICY IF EXISTS "br_d" ON public.budget_rows;
CREATE POLICY "br_s" ON public.budget_rows FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.budget_periods p WHERE p.id = budget_rows.budget_period_id AND can_access(p.user_id, 'conta.bud', false))
);
CREATE POLICY "br_i" ON public.budget_rows FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.budget_periods p WHERE p.id = budget_rows.budget_period_id AND can_access(p.user_id, 'conta.bud', true))
);
CREATE POLICY "br_u" ON public.budget_rows FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.budget_periods p WHERE p.id = budget_rows.budget_period_id AND can_access(p.user_id, 'conta.bud', true))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.budget_periods p WHERE p.id = budget_rows.budget_period_id AND can_access(p.user_id, 'conta.bud', true))
);
CREATE POLICY "br_d" ON public.budget_rows FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.budget_periods p WHERE p.id = budget_rows.budget_period_id AND can_access(p.user_id, 'conta.bud', true))
);

-- ─── manual_costs (Conto Economico) ──────────────────────────
DROP POLICY IF EXISTS "own_manual_costs" ON public.manual_costs;
DROP POLICY IF EXISTS "mc_s" ON public.manual_costs;
DROP POLICY IF EXISTS "mc_i" ON public.manual_costs;
DROP POLICY IF EXISTS "mc_u" ON public.manual_costs;
DROP POLICY IF EXISTS "mc_d" ON public.manual_costs;
CREATE POLICY "mc_s" ON public.manual_costs FOR SELECT USING (can_access(user_id, 'conta.ce', false));
CREATE POLICY "mc_i" ON public.manual_costs FOR INSERT WITH CHECK (can_access(user_id, 'conta.ce', true));
CREATE POLICY "mc_u" ON public.manual_costs FOR UPDATE USING (can_access(user_id, 'conta.ce', true)) WITH CHECK (can_access(user_id, 'conta.ce', true));
CREATE POLICY "mc_d" ON public.manual_costs FOR DELETE USING (can_access(user_id, 'conta.ce', true));

-- ─── Marketing minori ────────────────────────────────────────
DROP POLICY IF EXISTS "own_reservations" ON public.reservations;
DROP POLICY IF EXISTS "res_s" ON public.reservations;
DROP POLICY IF EXISTS "res_i" ON public.reservations;
DROP POLICY IF EXISTS "res_u" ON public.reservations;
DROP POLICY IF EXISTS "res_d" ON public.reservations;
CREATE POLICY "res_s" ON public.reservations FOR SELECT USING (can_access(user_id, 'mkt.prenotaz', false));
CREATE POLICY "res_i" ON public.reservations FOR INSERT WITH CHECK (can_access(user_id, 'mkt.prenotaz', true));
CREATE POLICY "res_u" ON public.reservations FOR UPDATE USING (can_access(user_id, 'mkt.prenotaz', true)) WITH CHECK (can_access(user_id, 'mkt.prenotaz', true));
CREATE POLICY "res_d" ON public.reservations FOR DELETE USING (can_access(user_id, 'mkt.prenotaz', true));

DROP POLICY IF EXISTS "own_automations" ON public.automations;
DROP POLICY IF EXISTS "au_s" ON public.automations;
DROP POLICY IF EXISTS "au_i" ON public.automations;
DROP POLICY IF EXISTS "au_u" ON public.automations;
DROP POLICY IF EXISTS "au_d" ON public.automations;
CREATE POLICY "au_s" ON public.automations FOR SELECT USING (can_access(user_id, 'mkt.automazioni', false));
CREATE POLICY "au_i" ON public.automations FOR INSERT WITH CHECK (can_access(user_id, 'mkt.automazioni', true));
CREATE POLICY "au_u" ON public.automations FOR UPDATE USING (can_access(user_id, 'mkt.automazioni', true)) WITH CHECK (can_access(user_id, 'mkt.automazioni', true));
CREATE POLICY "au_d" ON public.automations FOR DELETE USING (can_access(user_id, 'mkt.automazioni', true));

DROP POLICY IF EXISTS "own_campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "cmp_s" ON public.campaigns;
DROP POLICY IF EXISTS "cmp_i" ON public.campaigns;
DROP POLICY IF EXISTS "cmp_u" ON public.campaigns;
DROP POLICY IF EXISTS "cmp_d" ON public.campaigns;
CREATE POLICY "cmp_s" ON public.campaigns FOR SELECT USING (can_access(user_id, 'mkt.campagne', false));
CREATE POLICY "cmp_i" ON public.campaigns FOR INSERT WITH CHECK (can_access(user_id, 'mkt.campagne', true));
CREATE POLICY "cmp_u" ON public.campaigns FOR UPDATE USING (can_access(user_id, 'mkt.campagne', true)) WITH CHECK (can_access(user_id, 'mkt.campagne', true));
CREATE POLICY "cmp_d" ON public.campaigns FOR DELETE USING (can_access(user_id, 'mkt.campagne', true));

DROP POLICY IF EXISTS "own_surveys" ON public.surveys;
DROP POLICY IF EXISTS "sv_s" ON public.surveys;
DROP POLICY IF EXISTS "sv_i" ON public.surveys;
DROP POLICY IF EXISTS "sv_u" ON public.surveys;
DROP POLICY IF EXISTS "sv_d" ON public.surveys;
CREATE POLICY "sv_s" ON public.surveys FOR SELECT USING (can_access(user_id, 'mkt.sondaggi', false));
CREATE POLICY "sv_i" ON public.surveys FOR INSERT WITH CHECK (can_access(user_id, 'mkt.sondaggi', true));
CREATE POLICY "sv_u" ON public.surveys FOR UPDATE USING (can_access(user_id, 'mkt.sondaggi', true)) WITH CHECK (can_access(user_id, 'mkt.sondaggi', true));
CREATE POLICY "sv_d" ON public.surveys FOR DELETE USING (can_access(user_id, 'mkt.sondaggi', true));

DROP POLICY IF EXISTS "own_reviews" ON public.reviews;
DROP POLICY IF EXISTS "rv_s" ON public.reviews;
DROP POLICY IF EXISTS "rv_i" ON public.reviews;
DROP POLICY IF EXISTS "rv_u" ON public.reviews;
DROP POLICY IF EXISTS "rv_d" ON public.reviews;
CREATE POLICY "rv_s" ON public.reviews FOR SELECT USING (can_access(user_id, 'mkt.reviews', false));
CREATE POLICY "rv_i" ON public.reviews FOR INSERT WITH CHECK (can_access(user_id, 'mkt.reviews', true));
CREATE POLICY "rv_u" ON public.reviews FOR UPDATE USING (can_access(user_id, 'mkt.reviews', true)) WITH CHECK (can_access(user_id, 'mkt.reviews', true));
CREATE POLICY "rv_d" ON public.reviews FOR DELETE USING (can_access(user_id, 'mkt.reviews', true));

DROP POLICY IF EXISTS "own_cent_config" ON public.centralino_config;
DROP POLICY IF EXISTS "cc_s" ON public.centralino_config;
DROP POLICY IF EXISTS "cc_i" ON public.centralino_config;
DROP POLICY IF EXISTS "cc_u" ON public.centralino_config;
DROP POLICY IF EXISTS "cc_d" ON public.centralino_config;
CREATE POLICY "cc_s" ON public.centralino_config FOR SELECT USING (can_access(user_id, 'mkt.centralino', false));
CREATE POLICY "cc_i" ON public.centralino_config FOR INSERT WITH CHECK (can_access(user_id, 'mkt.centralino', true));
CREATE POLICY "cc_u" ON public.centralino_config FOR UPDATE USING (can_access(user_id, 'mkt.centralino', true)) WITH CHECK (can_access(user_id, 'mkt.centralino', true));
CREATE POLICY "cc_d" ON public.centralino_config FOR DELETE USING (can_access(user_id, 'mkt.centralino', true));

DROP POLICY IF EXISTS "own_cent_calls" ON public.centralino_calls;
DROP POLICY IF EXISTS "ck_s" ON public.centralino_calls;
DROP POLICY IF EXISTS "ck_i" ON public.centralino_calls;
DROP POLICY IF EXISTS "ck_u" ON public.centralino_calls;
DROP POLICY IF EXISTS "ck_d" ON public.centralino_calls;
CREATE POLICY "ck_s" ON public.centralino_calls FOR SELECT USING (can_access(user_id, 'mkt.centralino', false));
CREATE POLICY "ck_i" ON public.centralino_calls FOR INSERT WITH CHECK (can_access(user_id, 'mkt.centralino', true));
CREATE POLICY "ck_u" ON public.centralino_calls FOR UPDATE USING (can_access(user_id, 'mkt.centralino', true)) WITH CHECK (can_access(user_id, 'mkt.centralino', true));
CREATE POLICY "ck_d" ON public.centralino_calls FOR DELETE USING (can_access(user_id, 'mkt.centralino', true));

COMMIT;

-- ============================================================
-- Verifica:
--   SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('manual_articles','warehouse_invoice_items') ORDER BY tablename, policyname;
-- ============================================================
