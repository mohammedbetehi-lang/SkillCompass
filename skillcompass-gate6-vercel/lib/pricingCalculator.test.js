'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  calculatePrice, parseAmount, parseFeePercent, decimalToString, formatNumber,
  MAX_AMOUNT, MAX_DECIMALS, MAX_INPUT_LENGTH,
} = require('./pricingCalculator');

const ok = (cost, feePercent, targetNet) => {
  const r = calculatePrice({ cost, feePercent, targetNet });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};

// ── مرجع مستقل للتحقق (لا يستخدم أي دالة من الوحدة المختبَرة) ──
// يحوّل نصاً عشرياً إلى { n, s } بـBigInt.
function refDecimal(text) {
  const [i, f = ''] = String(text).split('.');
  return { n: BigInt(i + f), s: f.length };
}
function refScaled(d, S) {
  return d.n * 10n ** BigInt(S - d.s);
}
// يتحقق أن النتيجة الناجحة دقيقة حسابياً:
// 1) السعر العملي هو أصغر دينار صحيح يحقق الهدف (بالمقارنة الصحيحة).
// 2) الصافي المعاد يساوي السعر − الرسوم − التكلفة بالضبط، والصافي >= الهدف.
function assertExactInvariants(r, cost, feePercent, targetNet) {
  const c = refDecimal(cost), f = refDecimal(feePercent), t = refDecimal(targetNet);
  const S = Math.max(c.s, f.s, t.s);
  const C = refScaled(c, S), F = refScaled(f, S), T = refScaled(t, S);
  const ONE = 10n ** BigInt(S);
  const D = 100n * ONE - F;
  const N = 100n * (C + T);
  const P = BigInt(r.practicalPrice);

  assert.ok(P * D >= N, `price ${P} does not cover the exact requirement`);
  assert.ok((P - 1n) * D < N, `price ${P} is not the smallest integer that works`);

  const U = 10n ** BigInt(S + 2);
  const feeU = refScaled(refDecimal(r.feeAmount), S + 2);
  const netU = refScaled(refDecimal(r.actualNet), S + 2);
  assert.equal(feeU, P * F, 'fee amount must equal P × fee ÷ 100 exactly');
  assert.equal(netU, P * U - feeU - 100n * C, 'net must equal price − fee − cost exactly');
  assert.ok(netU >= 100n * T, `net ${r.actualNet} is below target ${targetNet}`);
}

// ── اختبار القبول الإلزامي ──
test('acceptance: cost 2600, fee 2.5%, target 1000 gives 3693 practical price and net >= target', () => {
  const r = ok('2600', '2.5', '1000');
  assert.equal(r.exactPrice, '3692.307692307692');
  assert.equal(r.practicalPrice, '3693');
  assert.equal(r.feeAmount, '92.325');
  assert.equal(r.actualNet, '1000.675');
  assert.equal(r.meetsTarget, true);
  assertExactInvariants(r, '2600', '2.5', '1000');
});

test('acceptance: the reported wrong example 3600 is NOT what the calculator returns', () => {
  const r = ok('2600', '2.5', '1000');
  assert.notEqual(r.practicalPrice, '3600');
  assert.ok(Number(r.actualNet) > 1000, 'a price of 3600 would net only about 910, which is below target');
});

// ── الحالات الدقيقة المطلوبة بعد الإصلاح ──
test('case A: cost 1000, fee 0, target 0.0000004 gives practical price 1001 (not 1000)', () => {
  const r = ok('1000', '0', '0.0000004');
  assert.equal(r.practicalPrice, '1001');
  assert.equal(r.meetsTarget, true);
  assertExactInvariants(r, '1000', '0', '0.0000004');
});

test('case B: cost 0, fee 0, target 0.0000004 gives practical price 1', () => {
  const r = ok('0', '0', '0.0000004');
  assert.equal(r.practicalPrice, '1');
  assertExactInvariants(r, '0', '0', '0.0000004');
});

test('case C: cost 999999.9999999, fee 0, target 0.0000001 gives 1000000 and the target is met', () => {
  const r = ok('999999.9999999', '0', '0.0000001');
  assert.equal(r.practicalPrice, '1000000');
  assert.equal(r.actualNet, '0.0000001');
  assert.equal(r.meetsTarget, true);
  assertExactInvariants(r, '999999.9999999', '0', '0.0000001');
});

test('case D: cost 1e9, fee 77%, target 1e9 is accepted with the exact integer price 8695652174', () => {
  const r = ok('1000000000', '77', '1000000000');
  assert.equal(r.practicalPrice, '8695652174');
  assert.equal(r.meetsTarget, true);
  assertExactInvariants(r, '1000000000', '77', '1000000000');
});

test('case E: the acceptance triple reproduces the exact fee and net', () => {
  const r = ok('2600', '2.5', '1000');
  assert.equal(r.practicalPrice, '3693');
  assert.equal(r.feeAmount, '92.325');
  assert.equal(r.actualNet, '1000.675');
});

// ── نسبة الرسوم صفر ──
test('zero fee: exact integer price is not rounded up', () => {
  const r = ok('2600', '0', '1000');
  assert.equal(r.exactPrice, '3600');
  assert.equal(r.practicalPrice, '3600');
  assert.equal(r.feeAmount, '0');
  assert.equal(r.actualNet, '1000');
  assert.equal(r.meetsTarget, true);
});

test('zero fee with zero cost and zero target gives zero price', () => {
  const r = ok('0', '0', '0');
  assert.equal(r.practicalPrice, '0');
  assert.equal(r.actualNet, '0');
  assert.equal(r.feeAmount, '0');
});

test('zero cost is allowed when the target is positive', () => {
  const r = ok('0', '0', '500');
  assert.equal(r.practicalPrice, '500');
});

// ── حدود التقريب ──
test('rounding: exact value just above an integer rounds up to the next dinar', () => {
  // 1000 / 0.995 = 1005.025... ← يجب أن يصبح 1006
  const r = ok('1000', '0.5', '0');
  assert.equal(r.practicalPrice, '1006');
  assert.equal(r.meetsTarget, true);
  assertExactInvariants(r, '1000', '0.5', '0');
});

test('rounding: a trailing run of zeros does not add a dinar', () => {
  assert.equal(ok('1000.0000000000', '0', '0').practicalPrice, '1000');
  assert.equal(ok('1000.00', '0', '0').practicalPrice, '1000');
});

test('rounding: a real fraction of 1e-10 above an integer does add a dinar', () => {
  // 1000.0000000001 حقيقياً أكبر من 1000، فالسعر الصحيح 1001 (لا 1000 كما كان سابقاً بسبب التقريب إلى 6 منازل)
  const r = ok('1000.0000000001', '0', '0');
  assert.equal(r.practicalPrice, '1001');
  assertExactInvariants(r, '1000.0000000001', '0', '0');
});

test('rounding: exact value of 2 with fifty percent fee stays 2', () => {
  const r = ok('1', '50', '0');
  assert.equal(r.exactPrice, '2');
  assert.equal(r.practicalPrice, '2');
});

test('rounding: practical price is always the smallest integer that meets the target (120 combinations)', () => {
  const costs = ['0', '1', '99.5', '2600', '12345.67'];
  const fees = ['0', '0.5', '2.5', '7', '19.99', '99.99'];
  const targets = ['0', '1', '1000', '5555.55'];
  let count = 0;
  for (const c of costs) for (const f of fees) for (const t of targets) {
    const r = ok(c, f, t);
    assertExactInvariants(r, c, f, t);
    count += 1;
  }
  assert.equal(count, 120, 'every combination in the grid must be accepted');
});

// ── حدود نسبة الرسوم ──
test('fee 99.99% is accepted and produces a large price', () => {
  const r = ok('1', '99.99', '0');
  assert.equal(r.practicalPrice, '10000');
});

test('fee 99.99% with a small cost and a small target is accepted (result is safe)', () => {
  const r = ok('1', '99.99', '1');
  assert.equal(r.practicalPrice, '20000');
  assert.equal(r.meetsTarget, true);
});

test('fee 99.99% with cost 12345.67 and target 5555.55 is accepted and exact', () => {
  const r = ok('12345.67', '99.99', '5555.55');
  assertExactInvariants(r, '12345.67', '99.99', '5555.55');
});

test('fee 99.9999999% with cost 1 gives exactly 1000000000', () => {
  const r = ok('1', '99.9999999', '0');
  assert.equal(r.practicalPrice, '1000000000');
  assertExactInvariants(r, '1', '99.9999999', '0');
});

test('fee 99.99% with cost 5e5 gives an exact price of 5000000000', () => {
  const r = ok('500000', '99.99', '0');
  assert.equal(r.practicalPrice, '5000000000');
  assertExactInvariants(r, '500000', '99.99', '0');
});

test('fee 99.9999999999% (ten decimals) with 1e9 inputs stays exact beyond Number precision', () => {
  const r = ok('1000000000', '99.9999999999', '1000000000');
  assert.equal(r.practicalPrice, '2000000000000000000000');
  assertExactInvariants(r, '1000000000', '99.9999999999', '1000000000');
});

test('large normal result above 9e9 is accepted and exact, not rejected for Number limits', () => {
  const r = ok('1000000000', '78', '1000000000');
  assert.equal(r.practicalPrice, '9090909091');
  assertExactInvariants(r, '1000000000', '78', '1000000000');
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
  assert.equal(decimalToString(parseFeePercent('2.5%').decimal), '2.5');
  assert.equal(decimalToString(parseFeePercent(' 2.5 % ').decimal), '2.5');
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
  assert.equal(decimalToString(parseAmount(String(MAX_AMOUNT)).decimal), '1000000000');
  assert.equal(parseAmount('1000000000.5').error, 'too_large', 'a fraction above the maximum is also too large');
});

// ── المدخلات العربية ──
test('Arabic-Indic digits and the Arabic decimal separator are accepted', () => {
  assert.equal(decimalToString(parseAmount('٢٦٠٠').decimal), '2600');
  assert.equal(decimalToString(parseAmount('٢٫٥').decimal), '2.5');
  assert.equal(parseFeePercent('٢٫٥٪').error, 'not_a_number', 'Arabic percent sign is not a supported suffix');
});

test('Arabic inputs give the same exact result as Latin inputs', () => {
  const arabic = calculatePrice({ cost: '٢٦٠٠', feePercent: '٢٫٥', targetNet: '١٠٠٠' });
  const latin = calculatePrice({ cost: '2600', feePercent: '2.5', targetNet: '1000' });
  assert.deepEqual(arabic, latin);
});

// ── حدود طول المدخلات ومنازلها ──
test('input longer than the maximum length is rejected as too long', () => {
  assert.equal(parseAmount('0'.repeat(MAX_INPUT_LENGTH + 1) + '7').error, 'too_long');
  assert.equal(parseAmount('٠'.repeat(MAX_INPUT_LENGTH + 1)).error, 'too_long', 'length is checked after digit conversion');
});

test('input exactly at the maximum length is accepted', () => {
  assert.equal(decimalToString(parseAmount('0'.repeat(MAX_INPUT_LENGTH)).decimal), '0');
});

test('more decimals than the maximum are rejected, but trailing zeros do not count', () => {
  assert.equal(parseAmount('0.' + '0'.repeat(MAX_DECIMALS - 1) + '1').error, undefined, `${MAX_DECIMALS} decimals are allowed`);
  assert.equal(parseAmount('0.' + '0'.repeat(MAX_DECIMALS) + '1').error, 'too_many_decimals');
  assert.equal(decimalToString(parseAmount('1.00000000000').decimal), '1', 'eleven zeros after the point are not significant');
});

test('a fee with too many decimals is reported on the fee field', () => {
  const r = calculatePrice({ cost: '1', feePercent: '0.00000000001', targetNet: '0' });
  assert.equal(r.errors.feePercent, 'too_many_decimals');
});

// ── دقة المخرجات ──
test('output strings carry the exact fee and net with no hidden rounding', () => {
  // ربح ورسوم بعشرة منازل: كل منزلة يجب أن تظهر
  const r = ok('1000', '0.0000000001', '0');
  assertExactInvariants(r, '1000', '0.0000000001', '0');
  assert.match(r.feeAmount, /^\d+(\.\d+)?$/);
  assert.match(r.actualNet, /^\d+(\.\d+)?$/);
});

test('case A display: exact price 1000.0000004 is shown in full while the practical price is 1001', () => {
  const r = ok('1000', '0', '0.0000004');
  assert.equal(r.exactPrice, '1000.0000004', 'exact value shown with its real fraction, trailing zeros removed');
  assert.equal(r.practicalPrice, '1001', 'the decision uses the exact integer ceiling');
  assert.ok(r.steps[0].includes('≈ 1000.0000004'), 'the approximation sign is kept in the steps');
});

test('exactPrice shows at most 12 decimals, rounded, with no trailing zeros', () => {
  // 1 / 0.995 = 1.00502512562814070351... ← 12 منازل مقرّبة: 1.005025125628
  const r = ok('1', '0.5', '0');
  assert.equal(r.exactPrice, '1.005025125628');
  assert.equal(r.practicalPrice, '2');
  assert.ok(!r.exactPrice.includes('.') || !r.exactPrice.endsWith('0'), 'no trailing zero');
  assert.ok(r.exactPrice.split('.')[1].length <= 12);
});

test('exactPrice of a tiny fraction at the input precision limit keeps all its digits', () => {
  // أصغر منزلة مسموحة في المدخل (10 منازل) تبقى ظاهرة كاملة في السعر الحسابي
  const r = ok('0.0000000001', '0', '0');
  assert.equal(r.exactPrice, '0.0000000001');
  assert.equal(r.practicalPrice, '1');
  assertExactInvariants(r, '0.0000000001', '0', '0');
});

test('a tiny fraction added to a large cost is displayed with its exact digits', () => {
  const r = ok('1000', '0', '0.0000000001');
  assert.equal(r.exactPrice, '1000.0000000001');
  assert.equal(r.practicalPrice, '1001');
});

// ── خاصية عامة: كل نتيجة ناجحة تحقق الربح المطلوب حسابياً ──
test('every successful result meets the target exactly (deterministic pseudo-random sweep)', () => {
  let seed = 20260107;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const randomDecimal = (maxInt, maxDecimals) => {
    const intPart = Math.floor(rnd() ** 2 * maxInt);
    const d = Math.floor(rnd() * (maxDecimals + 1));
    let frac = '';
    for (let k = 0; k < d; k += 1) frac += Math.floor(rnd() * 10);
    return frac ? `${intPart}.${frac}` : String(intPart);
  };
  const intMaxes = [1e3, 1e6, 1e9];
  let accepted = 0;
  for (let i = 0; i < 1500; i += 1) {
    const cost = randomDecimal(intMaxes[i % 3], i % 4);
    const target = randomDecimal(intMaxes[(i >> 2) % 3], (i >> 1) % 8);
    const fee = randomDecimal(99, [0, 2, 4, 7][i % 4]);
    const r = calculatePrice({ cost, feePercent: fee, targetNet: target });
    assert.equal(r.ok, true, `unexpected rejection ${cost}/${fee}/${target}: ${JSON.stringify(r.errors)}`);
    assertExactInvariants(r, cost, fee, target);
    accepted += 1;
  }
  assert.equal(accepted, 1500);
});

// ── سلامة الدالة ──
test('input object is not mutated and the function is pure', () => {
  const input = Object.freeze({ cost: '2600', feePercent: '2.5', targetNet: '1000' });
  const first = calculatePrice(input);
  const second = calculatePrice(input);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(input), ['cost', 'feePercent', 'targetNet']);
});

test('all invalid fields are reported together', () => {
  const r = calculatePrice({ cost: 'x', feePercent: '100', targetNet: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { cost: 'not_a_number', feePercent: 'fee_out_of_range', targetNet: 'empty' });
});

test('steps and assumptions are present and show the formula', () => {
  const r = ok('2600', '2.5', '1000');
  assert.equal(r.steps.length, 4);
  assert.ok(r.steps[0].includes('(2600 + 1000)'));
  assert.ok(r.steps[0].includes('≈ 3692.307692307692'));
  assert.ok(r.steps[1].includes('3693'));
  assert.ok(r.assumptions.some((a) => a.includes('سعر البيع العملي')));
});

test('every error message the calculator can return is defined in Arabic', () => {
  const { ERROR_MESSAGES } = require('./pricingCalculator');
  for (const key of ['empty', 'not_a_number', 'negative', 'too_large', 'too_long', 'too_many_decimals', 'fee_out_of_range', 'target_not_met']) {
    assert.ok(typeof ERROR_MESSAGES[key] === 'string' && ERROR_MESSAGES[key].length > 0, key);
  }
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


// ── سلوك الصفحة: تشغيل السكربت الحقيقي للصفحة على DOM مبسّط ──
const vm = require('node:vm');

function makeFakeDom() {
  class El {
    constructor(id) {
      this.id = id; this.attrs = {}; this.hidden = false; this.className = '';
      this.children = []; this.listeners = {}; this._text = '';
      this.value = '';
    }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get firstChild() { return this.children[0] || null; }
    appendChild(c) { this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    fire(type) { (this.listeners[type] || []).forEach((fn) => fn({ preventDefault() {} })); }
  }
  const byId = {};
  const get = (id) => (byId[id] = byId[id] || new El(id));
  const document = {
    getElementById: get,
    createElement: (tag) => new El(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  };
  return { document, get };
}

function loadPage(calc) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pricing-calculator.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'page must have exactly one inline script');
  const { document, get } = makeFakeDom();
  const context = { window: { PricingCalculator: calc }, document };
  vm.runInNewContext(scripts[0][1], context);
  return { get, html };
}

test('page: a result-level error is shown in the alert element and hides the result card', () => {
  const real = require('./pricingCalculator');
  const stub = {
    ...real,
    calculatePrice: () => ({ ok: false, errors: { result: 'target_not_met' } }),
  };
  const { get, html } = loadPage(stub);
  get('cost').value = '2600'; get('fee').value = '2.5'; get('target').value = '1000';
  get('cost').fire('input');

  assert.match(html, /id="result-error" role="alert"/, 'the result error element must be an alert region');
  assert.equal(get('result-error').textContent, real.ERROR_MESSAGES.target_not_met);
  assert.equal(get('result-card').hidden, true, 'result card must be hidden on a result error');
  assert.equal(get('steps-card').hidden, true, 'steps card must be hidden on a result error');
  assert.equal(get('practical-price').children.length, 0, 'no stale price may remain');
});

test('page: the result error is cleared when the next calculation succeeds', () => {
  const real = require('./pricingCalculator');
  let fail = true;
  const stub = {
    ...real,
    calculatePrice: (input) => (fail ? { ok: false, errors: { result: 'target_not_met' } } : real.calculatePrice(input)),
  };
  const { get } = loadPage(stub);
  get('cost').value = '2600'; get('fee').value = '2.5'; get('target').value = '1000';
  get('cost').fire('input');
  assert.equal(get('result-error').textContent, real.ERROR_MESSAGES.target_not_met);

  fail = false;
  get('cost').fire('input');
  assert.equal(get('result-error').textContent, '', 'stale result error must be cleared');
  assert.equal(get('result-card').hidden, false, 'result card must be visible again');
});

test('page: field errors still appear next to their own field and not in the result alert', () => {
  const { get } = loadPage(require('./pricingCalculator'));
  get('cost').value = 'abc'; get('fee').value = '2.5'; get('target').value = '1000';
  get('cost').fire('input');
  assert.equal(get('cost-error').textContent, require('./pricingCalculator').ERROR_MESSAGES.not_a_number);
  assert.equal(get('cost').getAttribute('aria-invalid'), 'true');
  assert.equal(get('result-error').textContent, '', 'a field error must not be duplicated in the result alert');
  assert.equal(get('result-card').hidden, true);
});

test('page: a valid input renders the exact result through the real calculator', () => {
  const { get } = loadPage(require('./pricingCalculator'));
  get('cost').value = '2600'; get('fee').value = '2.5'; get('target').value = '1000';
  get('cost').fire('input');
  assert.equal(get('result-card').hidden, false);
  assert.equal(get('practical-price').children[0].textContent, '3693');
  assert.equal(get('fee-amount').children[0].textContent, '92.325');
  assert.equal(get('actual-net').children[0].textContent, '1000.675');
  assert.equal(get('result-error').textContent, '');
});

// ── خاصية العرض: السعر الدقيق المعروض لا يناقض السعر العملي ──
// إذا ظهر السعر الدقيق عدداً صحيحاً فيجب أن يساوي السعر العملي؛ وإن كان غير صحيح فلا يمكن أن يُعرض عدداً صحيحاً.
test('display invariant: an integer-looking exact price always equals the practical price', () => {
  const r0 = ok('1000', '0', '0.0000004');
  assert.equal(r0.exactPrice, '1000.0000004', 'non-integer exact value must not be shown as an integer');
  assert.equal(r0.practicalPrice, '1001');
  // جزء صحيح صفري مع كسر: السعر العملي = 0 + 1
  const z = ok('0', '0', '0.0000000001');
  assert.equal(z.exactPrice, '0.0000000001');
  assert.equal(z.practicalPrice, '1');

  let seed = 424242;
  // Math.imul يضرب بأعداد صحيحة 32-bit دون فقدان دقة، بخلاف الضرب العادي الذي يتجاوز 2^53
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const digits = (k) => Array.from({ length: k }, () => Math.floor(rnd() * 10)).join('');
  const extremes = [
    ['0', '0', '0.0000000001'], ['1000000000', '99.9999999999', '0.0000000001'],
    ['0.0000000001', '99.9999999999', '0.0000000001'], ['999999.9999999999', '0.0000000001', '0.0000000001'],
  ];
  const cases = [...extremes];
  for (let i = 0; i < 2000; i += 1) {
    cases.push([String(Math.floor(rnd() * 1e9)) + '.' + digits(i % 11),
      String(Math.floor(rnd() * 9999) / 100),
      String(Math.floor(rnd() * 1e9)) + '.' + digits(i % 11)]);
  }
  let checked = 0;
  for (const [cost, fee, target] of cases) {
    const r = calculatePrice({ cost, feePercent: fee, targetNet: target });
    if (!r.ok) continue;
    checked += 1;
    const input = 'cost=' + cost + ', fee=' + fee + ', target=' + target;
    const practical = BigInt(r.practicalPrice);
    const [intText] = r.exactPrice.split('.');
    const exactIntPart = BigInt(intText);
    if (!r.exactPrice.includes('.')) {
      // سعر دقيق بلا فاصلة عشرية: يجب أن يساوي السعر العملي تماماً
      assert.equal(BigInt(r.exactPrice), practical,
        'exactPrice "' + r.exactPrice + '" has no decimal point but practicalPrice "' + r.practicalPrice + '" differs; ' + input);
    } else {
      // سعر دقيق بفاصلة عشرية: السعر العملي هو جزؤه الصحيح زائد واحد (التقريب إلى الأعلى)
      assert.equal(practical, exactIntPart + 1n,
        'practicalPrice "' + r.practicalPrice + '" must equal integer part ' + exactIntPart + ' + 1 of exactPrice "' + r.exactPrice + '"; ' + input);
    }
    assert.ok(exactIntPart <= practical,
      'display integer part ' + exactIntPart + ' is above practicalPrice "' + r.practicalPrice + '"; ' + input);
  }
  assert.ok(checked > 1000, 'only ' + checked + ' valid cases were checked');
});

