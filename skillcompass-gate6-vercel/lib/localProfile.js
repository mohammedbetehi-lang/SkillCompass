// الملف التعليمي المحلي: يحفظ الاسم والبريد وإعدادات المسار فقط على هذا الجهاز.
// لا يخزّن كلمة المرور ولا أي نسخة منها (Hash أو غيرها). ليس نظام تسجيل دخول ولا حساباً آمناً.
// يعمل في المتصفح (window.LocalProfile) وفي Node.js (module.exports) للاختبار.
(function () {
'use strict';
const PROFILE_KEY = 'skillcompass_profile';
const FORBIDDEN_PROFILE_KEYS = ['password'];

// يُعيد نسخة من الملف بلا الحقول الممنوعة، دون تعديل الكائن الأصلي.
function sanitizeProfile(profile) {
  const copy = {};
  Object.keys(profile || {}).forEach((key) => {
    if (!FORBIDDEN_PROFILE_KEYS.includes(key)) copy[key] = profile[key];
  });
  return copy;
}

// ينظّف الملف المحفوظ محلياً (migration). يحذف الحقول الممنوعة فقط، ويُبقي كل شيء آخر
// (الاسم، البريد، المهارة، المستوى، والتقدم وSkillCoins في مفتاح منفصل لا يُمسّ).
// يعيد true إذا تغيّر شيء، ويعيد false دون أي تعديل إذا لم يكن هناك ما يُحذف أو كانت البيانات غير قابلة للقراءة.
function migrateStoredProfile(storage) {
  let raw;
  try {
    raw = storage.getItem(PROFILE_KEY);
  } catch (e) {
    return false;
  }
  if (raw === null || raw === undefined) return false;

  let profile;
  try {
    profile = JSON.parse(raw);
  } catch (e) {
    return false; // لا نعدّل ما لا نفهمه
  }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;

  const hasForbidden = FORBIDDEN_PROFILE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(profile, key));
  if (!hasForbidden) return false;

  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(sanitizeProfile(profile)));
  } catch (e) {
    return false;
  }
  return true;
}

const api = { PROFILE_KEY, FORBIDDEN_PROFILE_KEYS, sanitizeProfile, migrateStoredProfile };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.LocalProfile = api;
}
})();
