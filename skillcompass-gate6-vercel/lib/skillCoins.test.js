'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./skillCoins.js');

test('لا يوجد تقدم محفوظ: رصيد 0 صالح (مستخدم جديد)', () => {
  const r = S.inspectStoredProgress(null);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'absent');
  assert.equal(r.value, 0);
});

test('رصيد صحيح يُقبل كما هو', () => {
  const r = S.inspectStoredProgress(JSON.stringify({ skillCoins: 380 }));
  assert.equal(r.ok, true);
  assert.equal(r.value, 380);
});

test('كل صورة تالفة تُرفض بسبب محدد، ولا تُحوَّل إلى صفر', () => {
  const cases = [
    ['{bad json', 'unreadable_json'],
    ['[]', 'not_object'],
    ['null', 'not_object'],
    ['"text"', 'not_object'],
    [JSON.stringify({ completedLessons: [] }), 'missing'],
    [JSON.stringify({ skillCoins: '40' }), 'not_number'],
    [JSON.stringify({ skillCoins: null }), 'not_number'],
    [JSON.stringify({ skillCoins: { n: 1 } }), 'not_number'],
    [JSON.stringify({ skillCoins: [40] }), 'not_number'],
    [JSON.stringify({ skillCoins: 1.5 }), 'not_integer'],
    [JSON.stringify({ skillCoins: -5 }), 'negative'],
  ];
  for (const [raw, code] of cases) {
    const r = S.inspectStoredProgress(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(r.code, code, raw);
    assert.equal(r.value, undefined, 'لا قيمة بديلة');
    assert.ok(r.detail && r.detail.length > 0, 'تشخيص نصي موجود');
  }
});

test('قيمة "40" النصية لا تُحوَّل تلقائياً إلى الرقم 40', () => {
  const r = S.inspectStoredProgress(JSON.stringify({ skillCoins: '40' }));
  assert.equal(r.ok, false);
  assert.equal(r.value, undefined);
});

test('الفحص لا يعدّل النص المُمرَّر', () => {
  const raw = JSON.stringify({ skillCoins: 'abc', other: 1 });
  const before = raw;
  S.inspectStoredProgress(raw);
  assert.equal(raw, before);
});

test('isTrustedBalance: عدد صحيح آمن >= 0 فقط', () => {
  assert.equal(S.isTrustedBalance(0), true);
  assert.equal(S.isTrustedBalance(380), true);
  for (const bad of ['380', null, undefined, NaN, Infinity, -1, 1.2, {}, [1]]) {
    assert.equal(S.isTrustedBalance(bad), false, String(bad));
  }
});
