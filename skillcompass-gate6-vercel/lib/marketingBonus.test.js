'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('./marketingBonus.js');

const skill = {
  lessons: [
    { id: 1, quiz: [{}, {}, {}, {}, {}] },
    { id: 2, quiz: [{}, {}, {}, {}, {}] },
    { id: 3, quiz: [{}, {}, {}, {}, {}] },
  ],
};
const PROFILE_ID = 'profile-A';
const profile = { name: 'سارة', email: 'sara@example.com', skill: 'marketing', profileId: PROFILE_ID };
const fullProgress = (extra = {}) => ({
  completedLessons: [1, 2, 3], quizPassedLessons: [1, 2, 3], skillCoins: 100,
  progressSkill: 'marketing', ...extra,
});
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);

// تخزين مزيّف: يمكن أن يفشل الكتابة، أو يتجاهلها بصمت (قراءة الرجوع تكشفها)
function fakeStorage({ failWrites = 0, silentDrop = false } = {}) {
  const map = new Map();
  let remainingFailures = failWrites;
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (remainingFailures > 0) { remainingFailures -= 1; throw new Error('QuotaExceededError'); }
      if (!silentDrop) map.set(k, String(v));
    },
  };
}
const PK = 'skillcompass_profile';
const GK = 'skillcompass_progress';

// ---------- هوية الملف ----------
test('withProfileId يُنشئ معرّفاً للملف المفتقد ولا يعدّل المدخل', () => {
  const legacy = { name: 'سارة', email: 'sara@example.com', skill: 'marketing' };
  const withId = B.withProfileId(legacy, () => 'new-id');
  assert.equal(withId.profileId, 'new-id');
  assert.equal(legacy.profileId, undefined, 'المدخل لم يُعدَّل');
});

test('withProfileId يُبقي المعرّف الموجود ثابتاً ولا يستبدله', () => {
  const same = B.withProfileId(profile, () => 'should-not-be-used');
  assert.equal(same, profile);
  assert.equal(same.profileId, PROFILE_ID);
});

test('hasProfileIdentity: الملف الفارغ لا هوية له', () => {
  assert.equal(B.hasProfileIdentity({}), false);
  assert.equal(B.hasProfileIdentity({ skill: 'marketing' }), true);
  assert.equal(B.hasProfileIdentity(null), false);
});

// ---------- الشروط ----------
test('المتطلبات تُستخرج من بيانات المسار لا من رقم ثابت', () => {
  const r = B.getRequiredItems(skill);
  assert.deepEqual(r.lessonIds, [1, 2, 3]);
  assert.deepEqual(r.quizIds, [1, 2, 3]);
});

test('تقدم جزئي لا يمنح المكافأة', () => {
  const p = { completedLessons: [1, 2], quizPassedLessons: [1, 2], skillCoins: 50, progressSkill: 'marketing' };
  const r = B.claimPathBonus(profile, p, skill, 'marketing', NOW);
  assert.equal(r.code, 'not_complete');
  assert.equal(r.progress, p);
});

test('إكمال الدروس دون اجتياز كل الاختبارات لا يمنح المكافأة', () => {
  const p = { completedLessons: [1, 2, 3], quizPassedLessons: [1, 2], skillCoins: 0, progressSkill: 'marketing' };
  assert.equal(B.claimPathBonus(profile, p, skill, 'marketing', NOW).code, 'not_complete');
});

test('درس بلا اختبار يتطلب الإكمال فقط، ومسار بلا دروس لا يُمنح فيه شيء', () => {
  const s = { lessons: [{ id: 1 }, { id: 2, quiz: [] }] };
  const p = { completedLessons: [1, 2], quizPassedLessons: [], skillCoins: 0, progressSkill: 'marketing' };
  assert.equal(B.claimPathBonus(profile, p, s, 'marketing', NOW).code, 'granted');
  assert.equal(B.claimPathBonus(profile, p, { lessons: [] }, 'marketing', NOW).code, 'not_complete');
});

test('اكتمال كل المتطلبات يمنح 100 بالضبط، ويسجل العلامة داخل التقدم نفسه', () => {
  const r = B.claimPathBonus(profile, fullProgress(), skill, 'marketing', NOW);
  assert.equal(r.ok, true);
  assert.equal(r.amount, 100);
  assert.equal(r.progress.skillCoins, 200);
  assert.deepEqual(r.progress.marketingPathBonus, { profileId: PROFILE_ID, amount: 100, grantedAt: new Date(NOW).toISOString() });
});

test('ملف بلا profileId لا يُمنح له شيء (المعرّف شرط لتسجيل العلامة)', () => {
  const { profileId, ...noId } = profile;
  assert.equal(B.claimPathBonus(noId, fullProgress(), skill, 'marketing', NOW).code, 'no_profile_id');
});

test('مهارة أخرى أو تقدم بلا مهارة مسجلة لا يُحتسب', () => {
  assert.equal(B.claimPathBonus(profile, fullProgress({ progressSkill: 'ecommerce' }), skill, 'marketing', NOW).code, 'wrong_skill');
  assert.equal(B.claimPathBonus({ ...profile, skill: 'ecommerce' }, fullProgress(), skill, 'marketing', NOW).code, 'wrong_skill');
});

// ---------- منع التكرار ----------
test('استدعاء ثانٍ بعد الاستلام لا يمنح شيئاً', () => {
  const first = B.claimPathBonus(profile, fullProgress(), skill, 'marketing', NOW);
  const second = B.claimPathBonus(profile, first.progress, skill, 'marketing', NOW);
  assert.equal(second.code, 'already_claimed');
  assert.equal(second.progress.skillCoins, 200);
});

test('الاستدعاء المتكرر عشر مرات يمنح مرة واحدة فقط', () => {
  let p = fullProgress();
  for (let i = 0; i < 10; i++) p = B.claimPathBonus(profile, p, skill, 'marketing', NOW).progress;
  assert.equal(p.skillCoins, 200);
});

test('إعادة ضبط التقدم لا تُلغي العلامة: لا منح مجدداً حتى لو اكتمل المسار', () => {
  const claimed = B.claimPathBonus(profile, fullProgress(), skill, 'marketing', NOW).progress;
  const reset = { ...claimed, completedLessons: [], quizPassedLessons: [], skillCoins: 0 };
  assert.equal(B.claimPathBonus(profile, reset, skill, 'marketing', NOW).code, 'already_claimed');
  assert.equal(B.claimPathBonus(profile, { ...fullProgress({ skillCoins: 0 }), marketingPathBonus: claimed.marketingPathBonus }, skill, 'marketing', NOW).code, 'already_claimed');
});

test('تغيير البريد في الملف نفسه (المعرّف ثابت) لا يعيد المنح', () => {
  const claimed = B.claimPathBonus(profile, fullProgress(), skill, 'marketing', NOW).progress;
  const renamed = { ...profile, email: 'new@example.com' };
  assert.equal(B.claimPathBonus(renamed, claimed, skill, 'marketing', NOW).code, 'already_claimed');
});

test('ملف جديد بمعرّف مختلف لا يرث العلامة ويستحق مكافأته مرة واحدة', () => {
  const claimed = B.claimPathBonus(profile, fullProgress(), skill, 'marketing', NOW).progress;
  const other = { ...profile, profileId: 'profile-B' };
  const r = B.claimPathBonus(other, fullProgress({ marketingPathBonus: claimed.marketingPathBonus }), skill, 'marketing', NOW);
  assert.equal(r.code, 'granted');
  assert.equal(r.progress.marketingPathBonus.profileId, 'profile-B');
});

test('علامة تالفة (ليست كائناً) تمنع المنح تجنباً للتكرار', () => {
  assert.equal(B.claimPathBonus(profile, fullProgress({ marketingPathBonus: 'x' }), skill, 'marketing', NOW).code, 'already_claimed');
});

test('رصيد تالف: لا منح، ولا استبدال للقيمة بصفر، والقيمة الأصلية تبقى كما هي', () => {
  for (const bad of ['abc', '40', null, -5, 1.5, undefined]) {
    const p = fullProgress({ skillCoins: bad });
    const r = B.claimPathBonus(profile, p, skill, 'marketing', NOW);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.code, 'untrusted_balance');
    assert.equal(r.progress.skillCoins, bad, 'القيمة الأصلية محفوظة في الكائن المُعاد');
  }
});

test('الدوال لا تعدّل المدخلات الأصلية', () => {
  const p = fullProgress();
  B.claimPathBonus(profile, p, skill, 'marketing', NOW);
  assert.equal(p.skillCoins, 100);
  assert.equal(p.marketingPathBonus, undefined);
});

// ---------- الحفظ الفاشل ----------
test('commitValue: الكتابة الناجحة تُقرأ للتأكد', () => {
  const s = fakeStorage();
  assert.equal(B.commitValue(s, GK, { a: 1 }).ok, true);
  assert.equal(s.map.get(GK), '{"a":1}');
});

test('commitValue: فشل الكتابة يُرجع ok=false ولا يترك شيئاً محفوظاً', () => {
  const s = fakeStorage({ failWrites: 1 });
  const r = B.commitValue(s, GK, { a: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'write_failed');
  assert.equal(s.map.has(GK), false);
});

test('commitValue: كتابة تُتجاهل بصمت تُكشف بقراءة الرجوع', () => {
  const s = fakeStorage({ silentDrop: true });
  assert.equal(B.commitValue(s, GK, { a: 1 }).code, 'readback_mismatch');
});

test('فشل حفظ التقدم: لا رصيد ولا علامة، والمحاولة التالية تمنح مرة واحدة بالضبط', () => {
  const s = fakeStorage({ failWrites: 1 });
  s.map.set(PK, JSON.stringify(profile));
  s.map.set(GK, JSON.stringify(fullProgress()));
  const progressBefore = fullProgress();

  const failed = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile, progress: progressBefore, skill, skillKey: 'marketing', now: NOW });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'progress_save_failed');
  assert.equal(failed.progress.skillCoins, 100, 'الرصيد في الحالة الحالية لم يتغير');
  assert.equal(failed.progress.marketingPathBonus, undefined, 'لا علامة استلام');
  const stored = JSON.parse(s.map.get(GK));
  assert.equal(stored.skillCoins, 100, 'التخزين لم يتغير');
  assert.equal(stored.marketingPathBonus, undefined);

  const retry = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile, progress: failed.progress, skill, skillKey: 'marketing', now: NOW });
  assert.equal(retry.ok, true);
  assert.equal(retry.progress.skillCoins, 200);
  const again = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile, progress: retry.progress, skill, skillKey: 'marketing', now: NOW });
  assert.equal(again.code, 'already_claimed');
  assert.equal(JSON.parse(s.map.get(GK)).skillCoins, 200, 'مرة واحدة فقط');
});

test('فشل حفظ الملف الشخصي عند ترقية المعرّف: لا منح نهائياً', () => {
  const legacy = { name: 'سارة', email: 'sara@example.com', skill: 'marketing' };
  const s = fakeStorage({ failWrites: 1 });
  const r = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile: legacy, progress: fullProgress(), skill, skillKey: 'marketing', makeId: () => 'id-1', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'profile_save_failed');
  assert.equal(r.profile.profileId, undefined);
  assert.equal(s.map.has(GK), false);
});

// ---------- الترقية (المستخدم القديم) ----------
test('مستخدم قديم بلا profileId يحصل على معرّف محفوظ ثم المكافأة مرة واحدة', () => {
  const legacy = { name: 'سارة', email: 'sara@example.com', skill: 'marketing' };
  const s = fakeStorage();
  s.map.set(PK, JSON.stringify(legacy));
  const r = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile: legacy, progress: fullProgress(), skill, skillKey: 'marketing', makeId: () => 'legacy-1', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(s.map.get(PK)).profileId, 'legacy-1', 'المعرّف محفوظ');
  assert.equal(JSON.parse(s.map.get(GK)).marketingPathBonus.profileId, 'legacy-1');
  const again = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile: r.profile, progress: r.progress, skill, skillKey: 'marketing', makeId: () => 'x', now: NOW });
  assert.equal(again.code, 'already_claimed');
});

test('ملف فارغ لا يحصل على معرّف ولا منح', () => {
  const s = fakeStorage();
  const r = B.awardPathBonus({ storage: s, profileKey: PK, progressKey: GK, profile: {}, progress: fullProgress(), skill, skillKey: 'marketing', now: NOW });
  assert.equal(r.ok, false);
  assert.equal(s.map.has(PK), false);
});

// ---------- حماية العلامة من كتابات إعادة الضبط ----------
test('keepBonusRecord: كتابة تقدم بلا علامة تنقل العلامة من التخزين', () => {
  const stored = JSON.stringify({ skillCoins: 380, marketingPathBonus: { profileId: PROFILE_ID, amount: 100 } });
  const reset = { completedLessons: [], quizPassedLessons: [], skillCoins: 380 };
  const kept = B.keepBonusRecord(reset, stored);
  assert.deepEqual(kept.marketingPathBonus, { profileId: PROFILE_ID, amount: 100 });
  assert.equal(reset.marketingPathBonus, undefined, 'المدخل لم يُعدَّل');
});

test('keepBonusRecord: لا ينقل شيئاً إن لم توجد علامة مخزّنة، أو كانت التخزين تالفاً', () => {
  const next = { skillCoins: 5 };
  assert.equal(B.keepBonusRecord(next, null), next);
  assert.equal(B.keepBonusRecord(next, '{bad json'), next);
  assert.equal(B.keepBonusRecord(next, JSON.stringify({ skillCoins: 5 })), next);
});

test('keepBonusRecord: العلامة الجديدة في الكائن تغلب المخزّنة', () => {
  const stored = JSON.stringify({ marketingPathBonus: { profileId: 'old' } });
  const next = { marketingPathBonus: { profileId: 'new' } };
  assert.equal(B.keepBonusRecord(next, stored).marketingPathBonus.profileId, 'new');
});
