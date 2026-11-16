// مكافأة إكمال مسار التسويق: 100 SkillCoins إضافية تُمنح مرة واحدة لكل ملف محلي.
//
// التصميم:
// - هوية الملف: profileId داخل الملف الشخصي، يُنشأ مرة واحدة ويبقى عند تعديل البريد.
// - علامة الاستلام: كائن marketingPathBonus داخل كائن التقدم نفسه، بجانب skillCoins.
//   هكذا يُكتب الرصيد والعلامة معاً بعملية تخزين واحدة على مفتاح واحد.
// - لا يُعتبر شيء مستلماً إلا إذا نجح الحفظ وتأكد منه بقراءة الرجوع.
//
// هذه حماية ضمن التخزين المحلي فقط، وليست ضماناً من جهة خادم.
// يعمل في المتصفح (window.MarketingBonus) وفي Node.js (module.exports) للاختبار.
(function () {
'use strict';
const PATH_BONUS_AMOUNT = 100;
const RECORD_FIELD = 'marketingPathBonus';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}
function toIdList(v) {
  return Array.isArray(v) ? v : [];
}

// معرّف ثابت للملف. يستخدم crypto.randomUUID إن وُجد، وإلا احتياطياً عشوائياً محلياً.
function newProfileId() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

// هل في الملف بيانات تعريفية؟ الملف الفارغ لا يحصل على معرّف.
function hasProfileIdentity(profile) {
  return isPlainObject(profile) && (isNonEmptyString(profile.email) || isNonEmptyString(profile.name) || isNonEmptyString(profile.skill));
}

// يعيد نسخة بمعرّف إن كان مفقوداً، وإلا الكائن نفسه. لا يعدّل المدخل.
function withProfileId(profile, makeId) {
  if (!isPlainObject(profile) || isNonEmptyString(profile.profileId)) return profile;
  return { ...profile, profileId: (makeId || newProfileId)() };
}

// المتطلبات الإلزامية من بيانات المسار: إكمال كل درس، واجتياز اختباره إن كان له اختبار.
function getRequiredItems(skill) {
  const lessons = skill && Array.isArray(skill.lessons) ? skill.lessons : [];
  const lessonIds = lessons.map((l) => l.id);
  const quizIds = lessons.filter((l) => Array.isArray(l.quiz) && l.quiz.length > 0).map((l) => l.id);
  return { lessonIds, quizIds };
}

function isPathComplete(skill, progress) {
  const { lessonIds, quizIds } = getRequiredItems(skill);
  if (lessonIds.length === 0) return false;
  const completed = new Set(toIdList(progress && progress.completedLessons));
  const passed = new Set(toIdList(progress && progress.quizPassedLessons));
  return lessonIds.every((id) => completed.has(id)) && quizIds.every((id) => passed.has(id));
}

// يحسب المنح دون أي حفظ. يعيد { ok, code, amount, progress }.
// علامة مرتبطة بملف آخر لا تمنع هذا الملف، لكن علامة تالفة (ليست كائناً) تمنع المنح تجنباً للتكرار.
function claimPathBonus(profile, progress, skill, skillKey, now) {
  const fail = (code) => ({ ok: false, code, amount: 0, progress });
  if (!isPlainObject(profile)) return fail('no_profile');
  if (!isNonEmptyString(profile.profileId)) return fail('no_profile_id');
  if (!isPlainObject(progress)) return fail('no_progress');
  if (progress.progressSkill !== skillKey || profile.skill !== skillKey) return fail('wrong_skill');
  // رصيد غير صالح: لا منح، ولا استبدال للقيمة بصفر (التشخيص في lib/skillCoins.js)
  if (!(typeof progress.skillCoins === 'number' && Number.isSafeInteger(progress.skillCoins) && progress.skillCoins >= 0)) return fail('untrusted_balance');
  const record = progress[RECORD_FIELD];
  if (record !== undefined && record !== null) {
    if (!isPlainObject(record) || record.profileId === profile.profileId) return fail('already_claimed');
  }
  if (!isPathComplete(skill, progress)) return fail('not_complete');

  const current = progress.skillCoins;
  const grantedAt = new Date(now === undefined ? Date.now() : now).toISOString();
  return {
    ok: true,
    code: 'granted',
    amount: PATH_BONUS_AMOUNT,
    progress: {
      ...progress,
      skillCoins: current + PATH_BONUS_AMOUNT,
      [RECORD_FIELD]: { profileId: profile.profileId, amount: PATH_BONUS_AMOUNT, grantedAt },
    },
  };
}

// أي كتابة لتقدم الدروس والاختبارات يجب أن تحمل علامة الاستلام الموجودة في التخزين.
// إن غابت العلامة من الكائن الجديد (إعادة ضبط أو كتابة من كائن قديم) تُنقل من التخزين الحالي.
// تعيد الكائن نفسه إن لم يلزم أي نقل، ولا تعدّل المدخلات. storedRaw: النص الخام المحفوظ أو null.
function keepBonusRecord(nextProgress, storedRaw) {
  if (!isPlainObject(nextProgress)) return nextProgress;
  if (nextProgress[RECORD_FIELD] !== undefined) return nextProgress;
  if (typeof storedRaw !== 'string') return nextProgress;
  let stored;
  try { stored = JSON.parse(storedRaw); } catch (e) { return nextProgress; }
  if (!isPlainObject(stored) || stored[RECORD_FIELD] === undefined) return nextProgress;
  return { ...nextProgress, [RECORD_FIELD]: stored[RECORD_FIELD] };
}

// حفظ قيمة واحدة مع قراءة الرجوع للتأكد. لا يعدّل الكائن المُمرَّر.
function commitValue(storage, key, value) {
  const raw = JSON.stringify(value);
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) return { ok: false, code: 'readback_mismatch' };
    return { ok: true, code: 'saved' };
  } catch (e) {
    return { ok: false, code: 'write_failed' };
  }
}

// التنسيق الكامل: ينشئ المعرّف إن لزم (ويحفظه أولاً)، ثم يحسب المنح، ثم يحفظ التقدم مرة واحدة.
// لا تُحدَّث الحالة في الصفحة إلا إذا عاد ok: true.
function awardPathBonus(opts) {
  const { storage, profileKey, progressKey, profile, progress, skill, skillKey, now, makeId } = opts;
  let current = profile;
  if (hasProfileIdentity(current) && !isNonEmptyString(current.profileId)) {
    const withId = withProfileId(current, makeId);
    if (!commitValue(storage, profileKey, withId).ok) {
      return { ok: false, code: 'profile_save_failed', amount: 0, profile: current, progress };
    }
    current = withId;
  }
  const claim = claimPathBonus(current, progress, skill, skillKey, now);
  if (!claim.ok) return { ok: false, code: claim.code, amount: 0, profile: current, progress };
  if (!commitValue(storage, progressKey, claim.progress).ok) {
    return { ok: false, code: 'progress_save_failed', amount: 0, profile: current, progress };
  }
  return { ok: true, code: 'granted', amount: claim.amount, profile: current, progress: claim.progress };
}

const api = {
  PATH_BONUS_AMOUNT, RECORD_FIELD,
  newProfileId, hasProfileIdentity, withProfileId,
  getRequiredItems, isPathComplete, claimPathBonus, commitValue, awardPathBonus, keepBonusRecord,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.MarketingBonus = api;
}
})();
