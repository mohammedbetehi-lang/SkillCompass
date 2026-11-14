// ميزانية محاكاة التسويق: الرصيد هو رصيد SkillCoins الحقيقي فقط.
// لا رصيد وهمي، ولا منح مجانية، والخصم يحدث مرة واحدة فقط عند تأكيد الميزانية.
// يعمل في المتصفح (window.MarketingBudget) وفي Node.js (module.exports) للاختبار.
(function () {
'use strict';
const BUDGET_MESSAGES = {
  no_balance: 'رصيدك الحالي 0 SkillCoins، ولا يمكن بدء الحملة بلا رصيد. اكسب SkillCoins من دروس التسويق ثم عُد لإكمال المحاكاة.',
  invalid_amount: 'الرجاء إدخال مبالغ صحيحة غير سالبة لكل منصة',
  empty_spend: 'الرجاء توزيع مبلغ أكبر من صفر على منصة واحدة على الأقل',
  exceeds_balance: 'لا يمكن أن يتجاوز الإنفاق الرصيد المتاح من SkillCoins',
};

// الرصيد المتاح من الملف الحالي. أي قيمة غير صالحة تُعامل كصفر.
function getAvailableBudget(progress) {
  const coins = Number(progress && progress.skillCoins);
  return Number.isFinite(coins) && coins > 0 ? coins : 0;
}

// يحدد حالة الإنفاق المدخل مقابل الرصيد، ويعيد رمز الحالة.
function getBudgetStatus(balance, total) {
  if (!(balance > 0)) return 'no_balance';
  if (!Number.isFinite(total) || total < 0) return 'invalid_amount';
  if (total === 0) return 'empty_spend';
  if (total > balance) return 'exceeds_balance';
  return 'ok';
}

// تأكيد الميزانية. يعيد { ok, code, mkt, progress } دون تعديل المدخلات.
// إذا كانت الميزانية مؤكدة سابقاً فلا يحدث أي خصم جديد أبداً.
function confirmBudget(mkt, progress, total) {
  if (mkt.budgetConfirmed) {
    return { ok: true, code: 'already_confirmed', mkt: { ...mkt, phase: 4 }, progress };
  }
  const balance = getAvailableBudget(progress);
  const code = getBudgetStatus(balance, total);
  if (code !== 'ok') {
    return { ok: false, code, mkt, progress };
  }
  const remaining = balance - total;
  return {
    ok: true,
    code: 'ok',
    mkt: { ...mkt, totalSpend: total, budget: remaining, budgetConfirmed: true, phase: 4 },
    progress: { ...progress, skillCoins: remaining },
  };
}

const api = { BUDGET_MESSAGES, getAvailableBudget, getBudgetStatus, confirmBudget };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.MarketingBudget = api;
}
})();
