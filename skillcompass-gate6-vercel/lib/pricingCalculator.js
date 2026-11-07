'use strict';
// حاسبة تسعير حتمية: كل الحسابات هنا بـJavaScript، ولا يُستخدم أي نموذج ذكاء اصطناعي.
// تعمل في المتصفح (window.PricingCalculator) وفي Node.js (module.exports) للاختبار.

const MAX_AMOUNT = 1e9;          // أقصى قيمة بالدينار
const MAX_FEE_EXCLUSIVE = 100;   // نسبة الرسوم يجب أن تكون أقل من 100%
const ROUND_DECIMALS = 6;        // تقليل ضوضاء الأعداد العشرية قبل التقريب

const ERROR_MESSAGES = {
  empty: 'هذا الحقل مطلوب',
  not_a_number: 'أدخل رقماً صحيحاً (بالأرقام، ونقطة للكسور فقط)',
  negative: 'لا يُقبل رقم سالب',
  too_large: 'القيمة كبيرة جداً',
  fee_out_of_range: 'يجب أن تكون نسبة الرسوم أقل من 100%',
};

// يحوّل الأرقام العربية-الهندية إلى لاتينية، ويقبل نقطة أو فاصلة عشرية عربية (٫) فقط.
// الفاصلة اللاتينية (,) ترفض: "2,600" قد تُقرأ كـ2.6 خطأً، فنرفضها بدل التخمين.
function toLatinDigits(text) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.');
}

// يحلل قيمة رقمية غير سالبة. يعيد { value } أو { error }.
function parseAmount(raw) {
  if (raw === null || raw === undefined) return { error: 'empty' };
  const trimmed = String(raw).trim();
  if (trimmed === '') return { error: 'empty' };
  if (trimmed.startsWith('-') || trimmed.startsWith('−')) return { error: 'negative' };
  const latin = toLatinDigits(trimmed);
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(latin)) return { error: 'not_a_number' };
  const value = Number(latin);
  if (!Number.isFinite(value)) return { error: 'not_a_number' };
  if (value > MAX_AMOUNT) return { error: 'too_large' };
  return { value };
}

// يحلل نسبة الرسوم: تقبل لاحقة % اختيارية، وتشترط 0 <= النسبة < 100.
function parseFeePercent(raw) {
  if (raw === null || raw === undefined) return { error: 'empty' };
  const withoutSuffix = String(raw).trim().replace(/%$/, '').trim();
  const parsed = parseAmount(withoutSuffix);
  if (parsed.error) return parsed;
  if (parsed.value >= MAX_FEE_EXCLUSIVE) return { error: 'fee_out_of_range' };
  return { value: parsed.value };
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// يُعيد حاصل الحساب بالأرقام (دون تنسيق). القيم المُدخلة يجب أن تكون أرقاماً صالحة.
function computeNumbers(cost, feePercent, targetNet) {
  const exactPrice = roundTo((cost + targetNet) / (1 - feePercent / 100), ROUND_DECIMALS);
  // التقريب إلى الأعلى لأقرب دينار. التقريب أولاً لمنع ظهور 3601 بسبب ضوضاء عائمة.
  const practicalPrice = Math.ceil(exactPrice);
  const feeAmount = roundTo(practicalPrice * feePercent / 100, ROUND_DECIMALS);
  const actualNet = roundTo(practicalPrice - feeAmount - cost, ROUND_DECIMALS);
  return {
    exactPrice,
    practicalPrice,
    feeAmount,
    actualNet,
    meetsTarget: actualNet + 1e-9 >= targetNet,
  };
}

// الواجهة العامة: تستقبل النصوص كما يكتبها المستخدم وتعيد نتيجة أو أخطاء لكل حقل.
// لا تعدّل الكائن المُدخل، ولا تحفظ شيئاً.
function calculatePrice(input) {
  const source = input || {};
  const cost = parseAmount(source.cost);
  const fee = parseFeePercent(source.feePercent);
  const target = parseAmount(source.targetNet);

  const errors = {};
  if (cost.error) errors.cost = cost.error;
  if (fee.error) errors.feePercent = fee.error;
  if (target.error) errors.targetNet = target.error;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const numbers = computeNumbers(cost.value, fee.value, target.value);
  const steps = [
    `سعر البيع الدقيق = (التكلفة + الربح المستهدف) ÷ (1 − الرسوم ÷ 100) = (${cost.value} + ${target.value}) ÷ (1 − ${fee.value} ÷ 100) = ${formatNumber(numbers.exactPrice, 4)} دج`,
    `سعر البيع العملي = أقرب دينار صحيح إلى الأعلى = ${numbers.practicalPrice} دج`,
    `قيمة الرسوم = ${numbers.practicalPrice} × ${fee.value}% = ${formatNumber(numbers.feeAmount, 3)} دج`,
    `الربح الصافي الفعلي = ${numbers.practicalPrice} − ${formatNumber(numbers.feeAmount, 3)} − ${cost.value} = ${formatNumber(numbers.actualNet, 3)} دج`,
  ];
  const assumptions = [
    'الرسوم تُحسب من سعر البيع العملي، لا من التكلفة.',
    'الربح الصافي = سعر البيع − الرسوم − التكلفة الإجمالية.',
    'لا تشمل الحسبة ضرائب أو عمولات أو شحناً غير المذكورة في التكلفة.',
    'الأرقام افتراضية ما لم تكن موثقة من مصدر فعلي.',
  ];

  return {
    ok: true,
    inputs: { cost: cost.value, feePercent: fee.value, targetNet: target.value },
    exactPrice: numbers.exactPrice,
    practicalPrice: numbers.practicalPrice,
    feeAmount: numbers.feeAmount,
    actualNet: numbers.actualNet,
    meetsTarget: numbers.meetsTarget,
    steps,
    assumptions,
  };
}

// تنسيق عرض: حتى عدد محدد من الكسور، بدون أصفار زائدة.
function formatNumber(value, digits = 3) {
  const fixed = Number(value).toFixed(digits);
  if (!fixed.includes('.')) return fixed;          // أعداد صحيحة (digits = 0) تبقى كما هي
  return fixed.replace(/\.?0+$/, '') || '0';        // يحذف الأصفار الزائدة بعد الفاصلة فقط
}

const api = { calculatePrice, parseAmount, parseFeePercent, formatNumber, ERROR_MESSAGES, MAX_AMOUNT };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.PricingCalculator = api;
}
