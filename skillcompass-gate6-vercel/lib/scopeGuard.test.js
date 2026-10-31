const test = require('node:test');
const assert = require('node:assert/strict');
const { isDirectLessonConcept } = require('./scopeGuard');

test('ecommerce lesson 1 accepts customer-interest validation wording', () => {
  assert.equal(
    isDirectLessonConcept('ecommerce', 1, 'كيف أتحقق من اهتمام العملاء بمنتج؟'),
    true
  );
});

test('ecommerce lesson 1 accepts dropshipping definition wording', () => {
  assert.equal(
    isDirectLessonConcept('ecommerce', 1, 'ما معنى الدروب شيبينغ؟'),
    true
  );
});

test('cooking question is not a direct lesson 1 concept', () => {
  assert.equal(
    isDirectLessonConcept('ecommerce', 1, 'كيف أطبخ الكسكس؟'),
    false
  );
});

test('unrelated question remains outside the direct lesson concepts', () => {
  assert.equal(
    isDirectLessonConcept('ecommerce', 1, 'ما عاصمة اليابان؟'),
    false
  );
});
