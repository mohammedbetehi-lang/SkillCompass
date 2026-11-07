'use strict';
// حاسبة تسعير حتمية بحساب عشري دقيق (BigInt). كل الحسابات هنا بـJavaScript، ولا يُستخدم أي نموذج ذكاء اصطناعي.
// لا تُحوَّل المدخلات ولا النتائج الوسيطة إلى Number؛ القيم العشرية تبقى أعداداً صحيحة مُقياسة.
// تعمل في المتصفح (window.PricingCalculator) وفي Node.js (module.exports) للاختبار.

const MAX_AMOUNT = 1e9;          // أقصى قيمة بالدينار للتكلفة والربح المطلوب
const MAX_FEE_EXCLUSIVE = 100;   // نسبة الرسوم يجب أن تكون أقل من 100%
const MAX_DECIMALS = 10;         // أقصى عدد منازل عشرية في المدخل (بعد حذف الأصفار الزائدة في الطرف)
const MAX_INPUT_LENGTH = 32;     // أقصى طول لنص المدخل بعد حذف المسافات

const MAX_AMOUNT_BIG = BigInt(MAX_AMOUNT);

const ERROR_MESSAGES = {
  empty: 'هذا الحقل مطلوب',
  not_a_number: 'أدخل رقماً صحيحاً (بالأرقام، ونقطة للكسور فقط)',
  negative: 'لا يُقبل رقم سالب',
  too_large: 'القيمة كبيرة جداً (الحد الأقصى 1,000,000,000 دج)',
  too_long: 'الرقم طويل جداً (الحد الأقصى 32 خانة)',
  too_many_decimals: 'عدد المنازل العشرية أكبر من المسموح (الحد الأقصى 10 منازل)',
  fee_out_of_range: 'يجب أن تكون نسبة الرسوم أقل من 100%',
  target_not_met: 'تعذّر التحقق من أن الربح الفعلي يحقق الهدف، فلم تُعرض نتيجة',
};

// يحوّل الأرقام العربية-الهندية إلى لاتينية، ويقبل نقطة أو فاصلة عشرية عربية (٫) فقط.
// الفاصلة اللاتينية (,) ترفض: "2,600" قد تُقرأ كـ2.6 خطأً، فنرفضها بدل التخمين.
function toLatinDigits(text) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.');
}

// يحلل عدداً عشرياً غير سالب إلى { n, s } حيث القيمة = n ÷ 10^s، دون أي Number.
// يعيد { decimal } أو { error }.
function parseAmount(raw) {
  if (raw === null || raw === undefined) return { error: 'empty' };
  const trimmed = String(raw).trim();
  if (trimmed === '') return { error: 'empty' };
  if (trimmed.startsWith('-') || trimmed.startsWith('−')) return { error: 'negative' };
  const latin = toLatinDigits(trimmed);
  if (latin.length > MAX_INPUT_LENGTH) return { error: 'too_long' };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(latin)) return { error: 'not_a_number' };
  const [intRaw, fracRaw = ''] = latin.split('.');
  const frac = fracRaw.replace(/0+$/, '');   // الأصفار الزائدة في الطرف لا تغيّر القيمة
  if (frac.length > MAX_DECIMALS) return { error: 'too_many_decimals' };
  const s = frac.length;
  const n = BigInt((intRaw || '0') + frac);
  if (n > MAX_AMOUNT_BIG * 10n ** BigInt(s)) return { error: 'too_large' };
  return { decimal: { n, s } };
}

// يحلل نسبة الرسوم: تقبل لاحقة % اختيارية، وتشترط 0 <= النسبة < 100.
function parseFeePercent(raw) {
  if (raw === null || raw === undefined) return { error: 'empty' };
  const withoutSuffix = String(raw).trim().replace(/%$/, '').trim();
  const parsed = parseAmount(withoutSuffix);
  if (parsed.error) return parsed;
  const { n, s } = parsed.decimal;
  if (n >= BigInt(MAX_FEE_EXCLUSIVE) * 10n ** BigInt(s)) return { error: 'fee_out_of_range' };
  return { decimal: parsed.decimal };
}

// نص عشري قانوني من { n, s } بلا أصفار زائدة (للعرض وللرسائل فقط).
function decimalToString(decimal) {
  return toDecimalString(decimal.n, decimal.s);
}

function toDecimalString(n, s) {
  const digits = n.toString();
  if (s === 0) return digits;
  const padded = digits.padStart(s + 1, '0');
  const intPart = padded.slice(0, padded.length - s);
  const frac = padded.slice(padded.length - s).replace(/0+$/, '');
  return frac === '' ? intPart : `${intPart}.${frac}`;
}

// قيمة مُقياسة بالعدد s من المنازل إلى مقياس مشترك S (لا فقدان دقة لأن S أكبر من s دائماً).
function scaleTo(decimal, S) {
  return decimal.n * 10n ** BigInt(S - decimal.s);
}

// أصغر عدد صحيح >= a ÷ b، مع a >= 0 و b > 0. بدون أي تقريب عائم.
function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

// الحساب الدقيق. كل المقارنات والقسمة بـBigInt.
// السعر الدقيق = 100·(C+T) ÷ (100·10^S − F)، والسعر العملي = أصغر دينار صحيح >= هذا الكسر.
function computeExact(costD, feeD, targetD) {
  const S = Math.max(costD.s, feeD.s, targetD.s);
  const unitOne = 10n ** BigInt(S);            // دينار واحد في هذا المقياس
  const C = scaleTo(costD, S);
  const F = scaleTo(feeD, S);                  // نسبة الرسوم المئوية × 10^S
  const T = scaleTo(targetD, S);

  const N = 100n * (C + T);
  const D = 100n * unitOne - F;                // موجب دائماً لأن الرسوم < 100%
  const P = ceilDiv(N, D);                     // سعر البيع العملي بالدينار الصحيح

  // الرسوم = P × F ÷ 10^(S+2) دينار. نعبّر عن كل المبالغ بوحدة 10^-(S+2) لتبقى كلها أعداداً صحيحة.
  const unit = 10n ** BigInt(S + 2);
  const feeUnits = P * F;
  const netUnits = P * unit - feeUnits - 100n * C;

  // شرط الربح بالمقارنة الصحيحة: الصافي >= الهدف. التقريب الأعلى يضمنه، والفحص حماية إضافية.
  if (netUnits < 100n * T) return { error: 'target_not_met' };

  // السعر الدقيق للعرض فقط (حتى 12 منزلة عشرية، مقرّب بالقسمة الصحيحة)، ولا يدخل في أي حساب.
  // لا يمر عبر Number: البسط N·10^12 والمقام D أعداد BigInt، والتقريب نصف-إلى-أعلى عبر القسمة الصحيحة.
  const DISPLAY_DECIMALS = 12;
  const displayUnits = (2n * N * 10n ** BigInt(DISPLAY_DECIMALS) + D) / (2n * D);

  return {
    exactPrice: toDecimalString(displayUnits, DISPLAY_DECIMALS),
    practicalPrice: P.toString(),
    feeAmount: toDecimalString(feeUnits, S + 2),
    actualNet: toDecimalString(netUnits, S + 2),
    meetsTarget: true,
  };
}

// الواجهة العامة: تستقبل النصوص كما يكتبها المستخدم وتعيد نتيجة أو أخطاء لكل حقل.
// لا تعدّل الكائن المُدخل، ولا تحفظ شيئاً. كل القيم المعادة نصوص عشرية دقيقة.
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

  const numbers = computeExact(cost.decimal, fee.decimal, target.decimal);
  if (numbers.error) return { ok: false, errors: { result: numbers.error } };

  const costText = decimalToString(cost.decimal);
  const feeText = decimalToString(fee.decimal);
  const targetText = decimalToString(target.decimal);

  const steps = [
    `سعر البيع الدقيق ≈ (التكلفة + الربح المستهدف) ÷ (1 − الرسوم ÷ 100) = (${costText} + ${targetText}) ÷ (1 − ${feeText} ÷ 100) ≈ ${numbers.exactPrice} دج`,
    `سعر البيع العملي = أقرب دينار صحيح إلى الأعلى = ${numbers.practicalPrice} دج`,
    `قيمة الرسوم = ${numbers.practicalPrice} × ${feeText}% = ${numbers.feeAmount} دج`,
    `الربح الصافي الفعلي = ${numbers.practicalPrice} − ${numbers.feeAmount} − ${costText} = ${numbers.actualNet} دج`,
  ];
  const assumptions = [
    'الرسوم تُحسب من سعر البيع العملي، لا من التكلفة.',
    'الربح الصافي = سعر البيع − الرسوم − التكلفة الإجمالية.',
    'لا تشمل الحسبة ضرائب أو عمولات أو شحناً غير المذكورة في التكلفة.',
    'الأرقام افتراضية ما لم تكن موثقة من مصدر فعلي.',
  ];

  return {
    ok: true,
    inputs: { cost: costText, feePercent: feeText, targetNet: targetText },
    exactPrice: numbers.exactPrice,         // للعرض التقريبي فقط
    practicalPrice: numbers.practicalPrice, // عدد صحيح دقيق كنص
    feeAmount: numbers.feeAmount,           // دقيق كنص
    actualNet: numbers.actualNet,           // دقيق كنص
    meetsTarget: numbers.meetsTarget,
    steps,
    assumptions,
  };
}

// تنسيق عام لأرقام Number (للاستعمال خارج الحساب فقط).
function formatNumber(value, digits = 3) {
  const fixed = Number(value).toFixed(digits);
  if (!fixed.includes('.')) return fixed;          // أعداد صحيحة (digits = 0) تبقى كما هي
  return fixed.replace(/\.?0+$/, '') || '0';        // يحذف الأصفار الزائدة بعد الفاصلة فقط
}

const api = {
  calculatePrice,
  parseAmount,
  parseFeePercent,
  decimalToString,
  formatNumber,
  ERROR_MESSAGES,
  MAX_AMOUNT,
  MAX_DECIMALS,
  MAX_INPUT_LENGTH,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.PricingCalculator = api;
}
