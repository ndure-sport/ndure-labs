// All pricing rules live here. The browser shows a quote for instant feedback,
// but the server always recomputes it from the same config before charging,
// so a visitor can never change what they pay.

export type AddonKey = 'call' | 'plan';

export type PricingConfig = {
  tiers: { min: number; unit: number }[]; // price per session from `min` sessions up
  partner: number;
  addons: { key: AddonKey; name: string; desc: string; price: number; enabled: boolean }[];
  anchor: number;
  showAnchor: boolean;
  maxQty: number;
};

export const DEFAULT_PRICING: PricingConfig = {
  tiers: [
    { min: 1, unit: 99 },
    { min: 3, unit: 85 },
    { min: 5, unit: 76 },
    { min: 10, unit: 69 }
  ],
  partner: 79,
  addons: [
    { key: 'call', name: 'Coach follow up call', desc: '30 minutes, two weeks after your session.', price: 39, enabled: false },
    { key: 'plan', name: '8 week training plan', desc: 'Built on your zones, for TrainingPeaks or Zwift.', price: 49, enabled: false }
  ],
  anchor: 250,
  showAnchor: true,
  maxQty: 10
};

export type QuoteInput = { qty: number; partner: boolean; addons: string[] };

export type QuoteLine = { label: string; sub: string; amount: number; kind: 'item' | 'discount' };

export type Quote = {
  qty: number;
  unit: number;
  single: number;
  saving: number;
  total: number;
  partner: boolean;
  addons: AddonKey[];
  lines: QuoteLine[];
  next: { more: number; unit: number } | null;
};

export function unitFor(config: PricingConfig, qty: number): number {
  const sorted = [...config.tiers].sort((a, b) => a.min - b.min);
  let unit = sorted[0].unit;
  for (const t of sorted) if (qty >= t.min) unit = t.unit;
  return unit;
}

export function quote(config: PricingConfig, input: QuoteInput): Quote {
  const qty = Math.trunc(Number(input.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > config.maxQty) {
    throw new Error(`Number of sessions must be between 1 and ${config.maxQty}.`);
  }
  const sorted = [...config.tiers].sort((a, b) => a.min - b.min);
  const single = sorted[0].unit;
  const unit = unitFor(config, qty);
  const saving = qty * (single - unit);

  const enabled = new Map(config.addons.filter((a) => a.enabled).map((a) => [a.key, a]));
  const addons = [...new Set(input.addons)].filter((k): k is AddonKey => enabled.has(k as AddonKey));

  const lines: QuoteLine[] = [
    { label: `Lactate session × ${qty}`, sub: `€${single} each`, amount: qty * single, kind: 'item' }
  ];
  if (saving > 0) {
    lines.push({ label: `Price for ${qty} sessions`, sub: `€${unit} per session`, amount: -saving, kind: 'discount' });
  }
  if (input.partner) {
    lines.push({ label: 'Training partner', sub: 'Same session', amount: config.partner, kind: 'item' });
  }
  for (const k of addons) {
    const a = enabled.get(k)!;
    lines.push({ label: a.name, sub: '', amount: a.price, kind: 'item' });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const nextTier = sorted.find((t) => t.min > qty);
  return {
    qty,
    unit,
    single,
    saving,
    total,
    partner: !!input.partner,
    addons,
    lines,
    next: nextTier ? { more: nextTier.min - qty, unit: nextTier.unit } : null
  };
}

// Sanity checks so a typo in Airtable can't put a broken price live.
export function validateConfig(c: PricingConfig): string[] {
  const errors: string[] = [];
  const sorted = [...c.tiers].sort((a, b) => a.min - b.min);
  if (sorted.length === 0 || sorted[0].min !== 1) errors.push('There must be a price for 1 session.');
  for (const t of sorted) {
    if (!Number.isFinite(t.unit) || t.unit <= 0) errors.push(`Price for ${t.min}+ sessions must be above 0.`);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].unit > sorted[i - 1].unit) {
      errors.push(`Price for ${sorted[i].min}+ sessions is higher than for ${sorted[i - 1].min}+.`);
    }
  }
  if (!(c.partner > 0)) errors.push('Partner price must be above 0.');
  return errors;
}

// ---------- Airtable ----------
// Table with two columns: Key (text) and Value (number or text).
// Keys: price_1, price_3, price_5, price_10, partner, addon_call, addon_plan,
//       addon_call_enabled, addon_plan_enabled, anchor, show_anchor

let cache: { at: number; config: PricingConfig } | null = null;
const CACHE_MS = 60_000;

export function configFromRows(rows: Record<string, unknown>, base: PricingConfig = DEFAULT_PRICING): PricingConfig {
  const num = (k: string, fallback: number) => {
    const v = rows[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (k: string, fallback: boolean) => {
    const v = rows[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return ['1', 'true', 'yes', 'ja', 'on'].includes(v.trim().toLowerCase());
    return fallback;
  };
  const tiers = base.tiers.map((t) => ({ min: t.min, unit: num(`price_${t.min}`, t.unit) }));
  return {
    ...base,
    tiers,
    partner: num('partner', base.partner),
    anchor: num('anchor', base.anchor),
    showAnchor: bool('show_anchor', base.showAnchor),
    addons: base.addons.map((a) => ({
      ...a,
      price: num(`addon_${a.key}`, a.price),
      enabled: bool(`addon_${a.key}_enabled`, a.enabled)
    }))
  };
}

export async function loadPricing(): Promise<PricingConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.config;
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_PRICING_TABLE || 'Pricing';
  if (!token || !base) return DEFAULT_PRICING;

  try {
    const res = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?pageSize=100`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = (await res.json()) as { records: { fields: Record<string, unknown> }[] };
    const rows: Record<string, unknown> = {};
    for (const r of data.records) {
      const key = String(r.fields.Key ?? '').trim();
      if (key) rows[key] = r.fields.Value;
    }
    const config = configFromRows(rows);
    const errors = validateConfig(config);
    if (errors.length) {
      // Keep the last good prices rather than going live with a broken table.
      console.error('Pricing table rejected:', errors.join(' '));
      return cache?.config ?? DEFAULT_PRICING;
    }
    cache = { at: Date.now(), config };
    return config;
  } catch (e) {
    console.error('Could not load pricing from Airtable, using last known prices.', e);
    return cache?.config ?? DEFAULT_PRICING;
  }
}
