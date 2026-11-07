'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculatePrice, parseAmount, parseFeePercent, formatNumber, MAX_AMOUNT } = require('./pricingCalculator');

const ok = (cost, feePercent, targetNet) => {
  const r = calculatePrice({ cost, feePercent, targetNet });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};

// ── اختبار القبول الإلزامي ──
test('acceptance: cost 2600, fee 2.5%, target 1000 gives 3693 practical price and net >= target', () => {
  const r = ok('2600', '2.5', '1000');
  assert.equal(formatNumber(r.exactPrice, 4), '3692.3077');
  assert.equal(r.practicalPrice, 3693);
  assert.equal(formatNumber(r.feeAmount, 3), '92.325');
  assert.equal(formatNumber(r.actualNet, 3), '1000.675');
  assert.equal(r.meetsTarget, true);
  assert.ok(r.actualNet >= 1000);
});

test('acceptance: the reported wrong example 3600 is NOT what the calculator returns', () => {
  const r = ok('2600', '2.5', '1000');
  assert.notEqual(r.practicalPrice, 3600);
  assert.ok(r.actualNet > 1000, 'a price of 3600 would net only about 910, which is below target');
});

// ── نسبة الرسوم صفر ──
test('zero fee: exact integer price is not rounded up', () => {
  const r = ok('2600', '0', '1000');
  assert.equal(r.exactPrice, 3600);
  assert.equal(r.practicalPrice, 3600);
  assert.equal(r.feeAmount, 0);
  assert.equal(r.actualNet, 1000);
  assert.equal(r.meetsTarget, true);
});

test('zero fee with zero cost and zero target gives zero price', () => {
  const r = ok('0', '0', '0');
  assert.equal(r.practicalPrice, 0);
  assert.equal(r.actualNet, 0);
});

// ── حدود التقريب ──
test('rounding: exact value just above an integer rounds up to the next dinar', () => {
  // 1000 / 0.995 = 1005.025... ← يجب أن يصبح 1006
  const r = ok('1000', '0.5', '0');
  assert.equal(r.practicalPrice, 1006);
  assert.equal(r.meetsTarget, true);
});

test('rounding: float noise above an integer does not add an extra dinar', () => {
  // المجموع 1000.0000000001 ينتج تقريباً 1000 بعد التقريب إلى 6 منازل
  const r = ok('1000.0000000001', '0', '0');
  assert.equal(r.practicalPrice, 1000);
});

test('rounding: exact value of 2 with fifty percent fee stays 2', () => {
  const r = ok('1', '50', '0');
  assert.equal(r.exactPrice, 2);
  assert.equal(r.practicalPrice, 2);
});

test('rounding: practical price is always the smallest integer that meets the target', () => {
  const costs = ['0', '1', '99.5', '2600', '12345.67'];
  const fees = ['0', '0.5', '2.5', '7', '19.99', '99.99'];
  const targets = ['0', '1', '1000', '5555.55'];
  for (const c of costs) for (const f of fees) for (const t of targets) {
    const r = ok(c, f, t);
    assert.ok(r.actualNet + 1e-9 >= Number(t), `net below target for ${c}/${f}/${t}`);
    assert.ok(r.practicalPrice - 1 < r.exactPrice - 1e-9 || r.practicalPrice === r.exactPrice,
      `price not minimal for ${c}/${f}/${t}`);
  }
});

// ── حدود نسبة الرسوم ──
test('fee 99.99% is accepted and produces a large price', () => {
  const r = ok('1', '99.99', '0');
  assert.equal(r.practicalPrice, 10000);
});

test('fee exactly 100% is rejected', () => {
  const r = calculatePrice({ cost: '10', feePercent: '100', targetNet: '1' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.feePercent, 'fee_out_of_range');
});

test('fee above 100% is rejected', () => {
  assert.equal(parseFeePercent('150').error, 'fee_out_of_range');
});

test('negative fee is rejected as negative', () => {
  assert.equal(parseFeePercent('-1').error, 'negative');
});

test('fee with a percent sign is accepted', () => {
  assert.equal(parseFeePercent('2.5%').value, 2.5);
  assert.equal(parseFeePercent(' 2.5 % ').value, 2.5);
});

// ── القيم الفارغة وغير الرقمية والسالبة ──
test('empty, null, undefined and whitespace-only values report empty', () => {
  for (const raw of ['', '   ', null, undefined]) {
    assert.equal(parseAmount(raw).error, 'empty', `raw=${JSON.stringify(raw)}`);
  }
  assert.equal(calculatePrice({ cost: '', feePercent: '2', targetNet: '1' }).errors.cost, 'empty');
});

test('non-numeric text is rejected', () => {
  for (const raw of ['abc', '12abc', '1e3', 'Infinity', 'NaN', '0x10']) {
    assert.equal(parseAmount(raw).error, 'not_a_number', `raw=${raw}`);
  }
});

test('a Latin comma is rejected rather than guessed as a decimal separator', () => {
  assert.equal(parseAmount('2,600').error, 'not_a_number');
  assert.equal(parseAmount('2,6').error, 'not_a_number');
});

test('negative amounts are rejected', () => {
  assert.equal(parseAmount('-5').error, 'negative');
  assert.equal(parseAmount('−5').error, 'negative');
  assert.equal(calculatePrice({ cost: '-1', feePercent: '2', targetNet: '1' }).errors.cost, 'negative');
});

test('amounts above the maximum are rejected as too large', () => {
  assert.equal(parseAmount(String(MAX_AMOUNT + 1)).error, 'too_large');
  assert.equal(parseAmount(String(MAX_AMOUNT)).value, MAX_AMOUNT);
});

test('Arabic-Indic digits and the Arabic decimal separator are accepted', () => {
  assert.equal(parseAmount('٢٦٠٠').value, 2600);
  assert.equal(parseAmount('٢٫٥').value, 2.5);
  assert.equal(parseFeePercent('٢٫٥٪').error, 'not_a_number', 'Arabic percent sign is not a supported suffix');
});

test('zero cost is allowed when the target is positive', () => {
  const r = ok('0', '0', '500');
  assert.equal(r.practicalPrice, 500);
});

test('all invalid fields are reported together', () => {
  const r = calculatePrice({ cost: 'x', feePercent: '100', targetNet: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { cost: 'not_a_number', feePercent: 'fee_out_of_range', targetNet: 'empty' });
});

// ── سلامة الدالة ──
test('input object is not mutated and the function is pure', () => {
  const input = Object.freeze({ cost: '2600', feePercent: '2.5', targetNet: '1000' });
  const first = calculatePrice(input);
  const second = calculatePrice(input);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(input), ['cost', 'feePercent', 'targetNet']);
});

test('steps and assumptions are present and show the formula', () => {
  const r = ok('2600', '2.5', '1000');
  assert.equal(r.steps.length, 4);
  assert.ok(r.steps[0].includes('(2600 + 1000)'));
  assert.ok(r.steps[1].includes('3693'));
  assert.ok(r.assumptions.some((a) => a.includes('سعر البيع العملي')));
});

test('formatNumber trims zeros and keeps integers intact', () => {
  assert.equal(formatNumber(100, 0), '100');
  assert.equal(formatNumber(3600, 4), '3600');
  assert.equal(formatNumber(1000.675, 3), '1000.675');
  assert.equal(formatNumber(92.5, 3), '92.5');
});

// ── الصفحة لا تستخدم innerHTML مع مدخلات ──
test('the calculator page renders results with textContent only', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pricing-calculator.html'), 'utf8');
  assert.equal(/innerHTML/.test(html), false, 'page must not use innerHTML');
  assert.ok(html.includes('lib/pricingCalculator.js'), 'page must load the calculator module');
  assert.ok(/dir="rtl"/.test(html), 'page must be RTL');
  assert.ok(/name="viewport"/.test(html), 'page must declare a viewport for phones');
});
