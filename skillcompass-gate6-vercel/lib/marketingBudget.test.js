'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BUDGET_MESSAGES, getAvailableBudget, getBudgetStatus, confirmBudget } = require('./marketingBudget');

const freshMkt = () => ({ phase: 3, totalSpend: 0, budget: 0, budgetConfirmed: false, adSpend: { facebook: 10 } });

test('الرصيد صفر أو غير صالح يُعامَل كصفر (لا رصيد وهمي)', () => {
  assert.equal(getAvailableBudget({ skillCoins: 0 }), 0);
  assert.equal(getAvailableBudget({}), 0);
  assert.equal(getAvailableBudget({ skillCoins: -5 }), 0);
  assert.equal(getAvailableBudget({ skillCoins: 'abc' }), 0);
  assert.equal(getAvailableBudget(null), 0);
  assert.equal(getAvailableBudget({ skillCoins: 42 }), 42);
});

test('رصيد صفر: الحالة no_balance ورسالة توضح السبب', () => {
  assert.equal(getBudgetStatus(0, 10), 'no_balance');
  assert.equal(getBudgetStatus(0, 0), 'no_balance');
  assert.match(BUDGET_MESSAGES.no_balance, /0 SkillCoins/);
  assert.match(BUDGET_MESSAGES.no_balance, /اكسب|دروس التسويق/);
});

test('رصيد موجب أقل من الإنفاق: exceeds_balance', () => {
  assert.equal(getBudgetStatus(10, 15), 'exceeds_balance');
});

test('رصيد كافٍ: ok، وإنفاق مساوٍ للرصيد مسموح', () => {
  assert.equal(getBudgetStatus(50, 20), 'ok');
  assert.equal(getBudgetStatus(50, 50), 'ok');
});

test('إنفاق صفر أو قيمة غير صالحة مرفوضة', () => {
  assert.equal(getBudgetStatus(50, 0), 'empty_spend');
  assert.equal(getBudgetStatus(50, NaN), 'invalid_amount');
  assert.equal(getBudgetStatus(50, -1), 'invalid_amount');
});

test('confirmBudget يخصم الإنفاق مرة واحدة ويضبط الرصيد المتبقي', () => {
  const progress = { completedLessons: [1], skillCoins: 50 };
  const r = confirmBudget(freshMkt(), progress, 20);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'ok');
  assert.equal(r.progress.skillCoins, 30);
  assert.equal(r.mkt.budgetConfirmed, true);
  assert.equal(r.mkt.totalSpend, 20);
  assert.equal(r.mkt.budget, 30);
  assert.equal(r.mkt.phase, 4);
  assert.deepEqual(r.progress.completedLessons, [1]); // التقدم لا يُمس
});

test('confirmBudget لا يخصم مرة ثانية بعد التأكيد', () => {
  const first = confirmBudget(freshMkt(), { skillCoins: 50 }, 20);
  const second = confirmBudget(first.mkt, first.progress, 20);
  assert.equal(second.ok, true);
  assert.equal(second.code, 'already_confirmed');
  assert.equal(second.progress.skillCoins, 30);
});

test('confirmBudget لا ينفق أكثر من الرصيد ولا يغيّر شيئاً عند الفشل', () => {
  const mkt = freshMkt();
  const progress = { skillCoins: 10 };
  const r = confirmBudget(mkt, progress, 15);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'exceeds_balance');
  assert.equal(r.progress.skillCoins, 10);
  assert.equal(r.mkt.budgetConfirmed, false);
});

test('رصيد صفر لا يسمح بالتأكيد حتى بإنفاق صغير', () => {
  const r = confirmBudget(freshMkt(), { skillCoins: 0 }, 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_balance');
});

test('confirmBudget لا يعدّل المدخلات الأصلية', () => {
  const mkt = freshMkt();
  const progress = { skillCoins: 50 };
  confirmBudget(mkt, progress, 20);
  assert.equal(progress.skillCoins, 50);
  assert.equal(mkt.budgetConfirmed, false);
});
