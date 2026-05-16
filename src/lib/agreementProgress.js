// Calcolo avanzamento accordi commerciali.
//
// Pura funzione: prende l'accordo + le sue righe-fattura matchate dal DB
// e ritorna stato + proiezione + gap-to-win.
//
// Le query SQL stanno in /api/agreements.js (server) — qui solo logica
// di aggregazione + classificazione che è facile da testare in isolation.
//
// Metriche supportate:
//   revenue_eur     → somma prezzo_totale (€ netto) delle righe
//   volume_pieces   → somma quantita (pezzi/casse/bottiglie)
//   volume_liters   → somma quantita × fattore_conversione_litri
//                     (richiede products.unita_misura = 'l' o equivalente,
//                      altrimenti somma totale_um se già in litri)
//   mix_percentage  → percentuale per articolo sul totale del fornitore.
//                     Confronta col target weight di ogni agreement_item.

/**
 * Aggrega le righe fattura nella metrica dell'accordo.
 *
 * @param {string} metric - revenue_eur | volume_pieces | volume_liters | mix_percentage
 * @param {Array} lines - righe fattura: { quantita, prezzo_totale, totale_um, unita, product_id, nome_articolo, categoria?, ... }
 * @returns {number} valore aggregato in unità della metrica
 */
export function aggregateLines(metric, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 0;

  switch (metric) {
    case 'revenue_eur':
      return lines.reduce((sum, l) => sum + Number(l.prezzo_totale || 0), 0);

    case 'volume_pieces':
      return lines.reduce((sum, l) => sum + Number(l.quantita || 0), 0);

    case 'volume_liters': {
      // Strategia: se la riga ha totale_um e l'unità del prodotto è litri/l → usa totale_um.
      // Altrimenti fallback su quantita (best-effort).
      return lines.reduce((sum, l) => {
        const u = String(l.unita || l.unita_misura || '').toLowerCase().trim();
        const isLiters = u === 'l' || u === 'lt' || u === 'litri' || u === 'litro';
        if (isLiters && l.totale_um != null) return sum + Number(l.totale_um);
        if (isLiters) return sum + Number(l.quantita || 0);
        // Se l'unità non è litri non possiamo convertire senza fattore → ignoriamo riga
        return sum;
      }, 0);
    }

    case 'mix_percentage':
      // Per il mix calcoliamo separatamente in computeMixProgress. Qui restituiamo
      // semplicemente il totale (revenue) come "base" per il rapporto percentuale.
      return lines.reduce((sum, l) => sum + Number(l.prezzo_totale || 0), 0);

    default:
      return 0;
  }
}

/**
 * Determina il tier "corrente" (l'ultimo raggiunto) e il "prossimo" (gap-to-win).
 *
 * @param {Array} tiers - lista scaglioni ordinati per threshold asc: { threshold, reward_*, sort_order }
 * @param {number} currentValue
 * @returns {{ currentTier: object|null, nextTier: object|null, gap: number|null }}
 */
export function resolveTiers(tiers, currentValue) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { currentTier: null, nextTier: null, gap: null };
  }
  const sorted = [...tiers].sort((a, b) => Number(a.threshold) - Number(b.threshold));
  let currentTier = null;
  let nextTier = null;
  for (const t of sorted) {
    if (currentValue >= Number(t.threshold)) {
      currentTier = t;
    } else {
      nextTier = t;
      break;
    }
  }
  const gap = nextTier ? Math.max(0, Number(nextTier.threshold) - currentValue) : null;
  return { currentTier, nextTier, gap };
}

/**
 * Proiezione lineare a fine periodo (regola del tre semplice).
 * Se siamo al 40% del tempo e abbiamo accumulato X, a 100% del tempo
 * accumuleremo X / 0.4. Cap: niente proiezione finché abbiamo <5% del tempo passato
 * (troppo poca data per estrapolare in modo sensato).
 */
export function linearProjection({ currentValue, startDate, endDate, today = new Date() }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = today instanceof Date ? today : new Date(today);
  const total = end - start;
  const elapsed = Math.max(0, Math.min(total, now - start));
  if (total <= 0) return currentValue;
  const ratio = elapsed / total;
  if (ratio < 0.05) return null;     // troppo poco tempo per estrapolare
  if (ratio >= 1)  return currentValue;
  return currentValue / ratio;
}

/**
 * Classifica lo stato dell'accordo basato su proiezione vs target.
 *
 * @returns 'on_track' | 'at_risk' | 'off_track' | 'achieved' | 'expired_not_achieved' | 'no_target' | 'no_data'
 */
export function classifyStatus({ currentValue, targetValue, projection, today, endDate }) {
  const now = today instanceof Date ? today : new Date(today);
  const end = new Date(endDate);
  const expired = now > end;

  if (targetValue == null || targetValue <= 0) return 'no_target';
  if (currentValue >= targetValue) return 'achieved';
  if (expired) return 'expired_not_achieved';
  if (projection == null) return 'no_data';

  const pct = projection / targetValue;
  if (pct >= 1)    return 'on_track';
  if (pct >= 0.8)  return 'at_risk';
  return 'off_track';
}

/**
 * Helper: somma "giorni trascorsi" e "giorni rimanenti" del periodo.
 */
export function periodTiming({ startDate, endDate, today = new Date() }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = today instanceof Date ? today : new Date(today);
  const dayMs = 86_400_000;
  const totalDays = Math.max(1, Math.round((end - start) / dayMs));
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((now - start) / dayMs)));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  return { totalDays, elapsedDays, remainingDays };
}

/**
 * Calcolo principale: prende l'accordo, i suoi tiers e le righe fattura filtrate,
 * e ritorna l'oggetto progress completo (consumabile direttamente dall'UI).
 *
 * @param {object} agreement - riga commercial_agreements: { metric, start_date, end_date, reward_value, ... }
 * @param {Array} tiers - righe agreement_tiers
 * @param {Array} lines - righe warehouse_invoice_items filtrate da getInvoicesForAgreement
 * @param {Date} [today]
 * @returns {object} { current_value, target_value, percentage_complete, gap_to_next_tier,
 *                     days_elapsed, days_remaining, linear_projection, status_indicator,
 *                     current_tier, next_tier }
 */
export function computeProgress(agreement, tiers, lines, today = new Date()) {
  const currentValue = aggregateLines(agreement.metric, lines);

  // Target: se ci sono tiers, target = soglia del prossimo non raggiunto.
  //         Altrimenti reward_value (per accordi flat).
  const tierResolve = resolveTiers(tiers, currentValue);
  const targetValue =
    tierResolve.nextTier != null
      ? Number(tierResolve.nextTier.threshold)
      : tierResolve.currentTier != null
        ? Number(tierResolve.currentTier.threshold)  // target finale raggiunto = stessa soglia
        : Number(agreement.reward_value || 0);

  const timing = periodTiming({
    startDate: agreement.start_date,
    endDate:   agreement.end_date,
    today,
  });

  const projection = linearProjection({
    currentValue,
    startDate: agreement.start_date,
    endDate:   agreement.end_date,
    today,
  });

  const status_indicator = classifyStatus({
    currentValue,
    targetValue,
    projection,
    today,
    endDate: agreement.end_date,
  });

  const percentage_complete = targetValue > 0
    ? Math.min(100, (currentValue / targetValue) * 100)
    : 0;

  return {
    current_value:        currentValue,
    target_value:         targetValue,
    percentage_complete,
    gap_to_next_tier:     tierResolve.gap,
    days_elapsed:         timing.elapsedDays,
    days_remaining:       timing.remainingDays,
    total_days:           timing.totalDays,
    linear_projection:    projection,
    status_indicator,
    current_tier:         tierResolve.currentTier,
    next_tier:            tierResolve.nextTier,
  };
}

/**
 * Mix percentage: calcola percentuale per ogni articolo target e confronta col weight.
 * Usato per agreement_type='mix_target'.
 *
 * @param {Array} agreementItems - { item_reference_id, item_label, weight }
 * @param {Array} lines - righe fattura del fornitore (tutte, non solo target)
 * @returns {Array<{ item_label, target_pct, current_pct, met }>}
 */
export function computeMixProgress(agreementItems, lines) {
  const totalRevenue = lines.reduce((s, l) => s + Number(l.prezzo_totale || 0), 0);
  if (totalRevenue <= 0) return agreementItems.map((it) => ({
    item_label: it.item_label,
    target_pct: Number(it.weight || 0),
    current_pct: 0,
    met: false,
  }));

  return agreementItems.map((it) => {
    const itemRevenue = lines
      .filter((l) => String(l.product_id || '') === String(it.item_reference_id || ''))
      .reduce((s, l) => s + Number(l.prezzo_totale || 0), 0);
    const current_pct = (itemRevenue / totalRevenue) * 100;
    const target_pct = Number(it.weight || 0);
    return {
      item_label: it.item_label,
      target_pct,
      current_pct,
      met: current_pct >= target_pct,
    };
  });
}
