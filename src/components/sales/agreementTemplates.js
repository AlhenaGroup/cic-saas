// Template di esempio per categoria fornitore (no brand reali).
// Usati dal wizard per pre-compilare un nuovo accordo con valori tipici
// del settore. L'owner poi modifica liberamente.
//
// Tutti i template sono "agnostici": niente nomi reali tipo Partesa/Coca-Cola,
// solo categorie merceologiche (beverage/birra/food/caffè/cantina).

const yearStart = () => new Date().getFullYear() + '-01-01'
const yearEnd   = () => new Date().getFullYear() + '-12-31'
const monthsAhead = (n) => {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

export const AGREEMENT_TEMPLATES = [
  {
    key: 'rappel_beverage',
    category: 'Beverage',
    icon: '🍷',
    title: 'Rappel beverage annuale',
    summary: 'Sconto retroattivo a fine anno al raggiungimento di una soglia di fatturato con un fornitore beverage (vini, distillati, mixer).',
    example: 'Es. 3% sul totale ordinato se ≥ 50.000 € nell\'anno solare.',
    preset: {
      name: '',
      description: 'Rappel annuale beverage — sconto retroattivo a fine anno.',
      agreement_type: 'rappel',
      metric: 'revenue_eur',
      start_date: yearStart(),
      end_date: yearEnd(),
      reward_type: 'discount_pct',
      reward_value: 3,
      reward_description: 'Sconto retroattivo sul totale fatturato',
      tiers: [{ threshold: 50000, reward_type: 'discount_pct', reward_value: 3, reward_description: '3% sul totale anno' }],
    },
  },
  {
    key: 'free_goods_birra',
    category: 'Birra',
    icon: '🍺',
    title: 'Premio merce / omaggi birra',
    summary: 'Casse o bottiglie omaggio al raggiungimento di un volume in litri (tipico per birre fusto/bottiglia).',
    example: 'Es. ogni 200 L acquistati → 6 bottiglie omaggio.',
    preset: {
      name: '',
      description: 'Premio merce — bottiglie/casse omaggio a soglia volume.',
      agreement_type: 'free_goods',
      metric: 'volume_liters',
      start_date: yearStart(),
      end_date: yearEnd(),
      reward_type: 'free_goods',
      reward_value: null,
      reward_description: '',
      tiers: [
        { threshold: 200, reward_type: 'free_goods', reward_value: 6,  reward_description: '6 bottiglie omaggio' },
        { threshold: 500, reward_type: 'free_goods', reward_value: 18, reward_description: '18 bottiglie + 1 polo brand' },
      ],
    },
  },
  {
    key: 'tiered_food',
    category: 'Food',
    icon: '🥘',
    title: 'Scaglioni progressivi food',
    summary: 'Sconti crescenti a fasce di fatturato. Tipico per fornitori food generalisti.',
    example: 'Es. 0-10k = 0% · 10-20k = 2% · 20-35k = 4% · oltre = 6%.',
    preset: {
      name: '',
      description: 'Scaglioni progressivi food — sconto crescente con il fatturato.',
      agreement_type: 'tiered_discount',
      metric: 'revenue_eur',
      start_date: yearStart(),
      end_date: yearEnd(),
      reward_type: null,
      reward_value: null,
      reward_description: '',
      tiers: [
        { threshold: 10000, reward_type: 'discount_pct', reward_value: 2, reward_description: '2% di sconto retroattivo' },
        { threshold: 20000, reward_type: 'discount_pct', reward_value: 4, reward_description: '4% di sconto retroattivo' },
        { threshold: 35000, reward_type: 'discount_pct', reward_value: 6, reward_description: '6% di sconto retroattivo' },
      ],
    },
  },
  {
    key: 'flat_bonus_caffe',
    category: 'Caffè / esposizione',
    icon: '☕',
    title: 'Bonus esposizione / esclusiva',
    summary: 'Contributo una tantum per visibilità del brand (esposizione, esclusiva, vetrina, menu).',
    example: 'Es. 1.500 € all\'anno per esposizione brand su menu.',
    preset: {
      name: '',
      description: 'Bonus contrattuale per esposizione/esclusiva del brand.',
      agreement_type: 'flat_bonus',
      metric: 'revenue_eur',
      start_date: yearStart(),
      end_date: yearEnd(),
      reward_type: 'cash_bonus',
      reward_value: 1500,
      reward_description: 'Bonus una tantum per esposizione brand',
      tiers: [],
    },
  },
  {
    key: 'volume_discount_short',
    category: 'Beverage / stagionale',
    icon: '🍹',
    title: 'Sconto volume periodo breve',
    summary: 'Sconto immediato in fattura quando l\'ordine supera una certa soglia. Utile per spinte stagionali (estate, festività).',
    example: 'Es. 3 mesi, 5% sconto da 100 L in su.',
    preset: {
      name: '',
      description: 'Sconto immediato a soglia volume su periodo breve.',
      agreement_type: 'volume_discount',
      metric: 'volume_liters',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: monthsAhead(3),
      reward_type: 'discount_pct',
      reward_value: 5,
      reward_description: 'Sconto 5% immediato sopra soglia',
      tiers: [{ threshold: 100, reward_type: 'discount_pct', reward_value: 5, reward_description: '5% in fattura' }],
    },
  },
  {
    key: 'blank',
    category: 'Da zero',
    icon: '✏️',
    title: 'Parti da vuoto',
    summary: 'Configura tutto manualmente. Scegli questa opzione se il tuo accordo non rientra negli schemi sopra.',
    example: null,
    preset: null,
  },
]
