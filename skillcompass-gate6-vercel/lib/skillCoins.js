// فحص رصيد SkillCoins المحفوظ. لا يحوّل أي قيمة تالفة إلى صفر، ولا يكتب شيئاً.
// الحكم: ok=true فقط لرصيد صحيح (عدد صحيح >= 0) أو لعدم وجود تقدم محفوظ أصلاً (مستخدم جديد).
// أي شيء آخر ok=false مع code يشخّص السبب، وعلى الصفحة أن تمتنع عن منح أو خصم أو كتابة التقدم.
// يعمل في المتصفح (window.SkillCoins) وفي Node.js (module.exports) للاختبار.
(function () {
'use strict';
const PROGRESS_KEY = 'skillcompass_progress';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// وصف قصير للقيمة التالفة للتشخيص فقط (لا يُستخدم في الحساب)
function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return 'number:' + String(v);
  if (typeof v === 'string') return 'string(' + v.length + ' chars)';
  return typeof v;
}

// raw: النص الخام كما هو في التخزين (أو null). لا يعدّله ولا يكتب فيه.
function inspectStoredProgress(raw) {
  if (raw === null || raw === undefined) {
    return { ok: true, code: 'absent', value: 0, detail: 'لا يوجد تقدم محفوظ (مستخدم جديد)' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, code: 'unreadable_json', value: undefined, detail: 'بيانات التقدم ليست JSON صالحاً' };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, code: 'not_object', value: undefined, detail: 'بيانات التقدم ليست كائناً: ' + describe(parsed) };
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'skillCoins')) {
    return { ok: false, code: 'missing', value: undefined, detail: 'حقل skillCoins غير موجود في تقدم محفوظ' };
  }
  const v = parsed.skillCoins;
  if (typeof v !== 'number') {
    return { ok: false, code: 'not_number', value: undefined, detail: 'skillCoins ليس رقماً: ' + describe(v) };
  }
  if (!Number.isSafeInteger(v)) {
    return { ok: false, code: 'not_integer', value: undefined, detail: 'skillCoins ليس عدداً صحيحاً آمناً: ' + String(v) };
  }
  if (v < 0) {
    return { ok: false, code: 'negative', value: undefined, detail: 'skillCoins سالب: ' + String(v) };
  }
  return { ok: true, code: 'ok', value: v, detail: 'رصيد صالح' };
}

// فحص قيمة الرصيد داخل كائن التقدم في الذاكرة (مثلاً قبل منح المكافأة)
function isTrustedBalance(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

const api = { PROGRESS_KEY, inspectStoredProgress, isTrustedBalance };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SkillCoins = api;
}
})();
