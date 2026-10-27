import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING, quote, configFromRows, validateConfig, type PricingConfig } from './pricing.ts';

const withAddons: PricingConfig = {
  ...DEFAULT_PRICING,
  addons: DEFAULT_PRICING.addons.map((a) => ({ ...a, enabled: true }))
};

test('single session costs the single price', () => {
  const q = quote(DEFAULT_PRICING, { qty: 1, partner: false, addons: [] });
  assert.equal(q.total, 99);
  assert.equal(q.saving, 0);
  assert.deepEqual(q.next, { more: 2, unit: 85 });
});

test('tier price applies from its minimum, not only at it', () => {
  assert.equal(quote(DEFAULT_PRICING, { qty: 4, partner: false, addons: [] }).unit, 85);
  assert.equal(quote(DEFAULT_PRICING, { qty: 5, partner: false, addons: [] }).total, 380);
  assert.equal(quote(DEFAULT_PRICING, { qty: 9, partner: false, addons: [] }).unit, 76);
  const ten = quote(DEFAULT_PRICING, { qty: 10, partner: false, addons: [] });
  assert.equal(ten.total, 690);
  assert.equal(ten.saving, 300);
  assert.equal(ten.next, null);
});

test('partner and enabled add ons are added; disabled add ons are ignored', () => {
  const off = quote(DEFAULT_PRICING, { qty: 1, partner: true, addons: ['call', 'plan'] });
  assert.equal(off.total, 99 + 79);
  const on = quote(withAddons, { qty: 1, partner: true, addons: ['call', 'plan', 'plan', 'bogus'] });
  assert.equal(on.total, 99 + 79 + 39 + 49);
  assert.deepEqual(on.addons, ['call', 'plan']);
});

test('lines add up to the total', () => {
  const q = quote(withAddons, { qty: 5, partner: true, addons: ['call'] });
  assert.equal(q.lines.reduce((s, l) => s + l.amount, 0), q.total);
});

test('rejects out of range quantities', () => {
  assert.throws(() => quote(DEFAULT_PRICING, { qty: 0, partner: false, addons: [] }));
  assert.throws(() => quote(DEFAULT_PRICING, { qty: 11, partner: false, addons: [] }));
  assert.throws(() => quote(DEFAULT_PRICING, { qty: Number.NaN, partner: false, addons: [] }));
});

test('Airtable rows override defaults and accept comma decimals and yes/no', () => {
  const c = configFromRows({ price_1: 109, price_5: '79,5', partner: 69, addon_call_enabled: 'yes', show_anchor: 'no' });
  assert.equal(c.tiers.find((t) => t.min === 1)!.unit, 109);
  assert.equal(c.tiers.find((t) => t.min === 5)!.unit, 79.5);
  assert.equal(c.tiers.find((t) => t.min === 3)!.unit, 85);
  assert.equal(c.partner, 69);
  assert.equal(c.addons.find((a) => a.key === 'call')!.enabled, true);
  assert.equal(c.showAnchor, false);
});

test('validation catches a pack that is more expensive than a smaller one', () => {
  const bad = configFromRows({ price_10: 90 });
  assert.ok(validateConfig(bad).length > 0);
  assert.deepEqual(validateConfig(DEFAULT_PRICING), []);
});
