'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILE_KEY, sanitizeProfile, migrateStoredProfile } = require('./localProfile');

// تخزين وهمي بسيط بالواجهة نفسها لـlocalStorage
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const OLD_PROFILE = {
  name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner',
  password: 'OldRawPassword123',
};
const PROGRESS = JSON.stringify({ completedLessons: [1, 2], quizPassedLessons: [1], skillCoins: 35 });

test('migration يحذف خاصية password من ملف قديم ويُبقي الاسم والبريد والمهارة والمستوى', () => {
  const storage = memoryStorage({ [PROFILE_KEY]: JSON.stringify(OLD_PROFILE) });
  assert.equal(migrateStoredProfile(storage), true);
  const after = JSON.parse(storage.getItem(PROFILE_KEY));
  assert.equal(Object.prototype.hasOwnProperty.call(after, 'password'), false);
  assert.deepEqual(after, { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' });
});

test('migration لا تمس مفتاح التقدم وSkillCoins', () => {
  const storage = memoryStorage({
    [PROFILE_KEY]: JSON.stringify(OLD_PROFILE),
    skillcompass_progress: PROGRESS,
  });
  migrateStoredProfile(storage);
  assert.equal(storage.getItem('skillcompass_progress'), PROGRESS);
  assert.equal(JSON.parse(storage.getItem('skillcompass_progress')).skillCoins, 35);
});

test('migration لا تكتب شيئاً إذا لم تكن هناك كلمة مرور قديمة', () => {
  const clean = JSON.stringify({ name: 'علي', email: 'ali@example.com' });
  const storage = memoryStorage({ [PROFILE_KEY]: clean });
  let writes = 0;
  const orig = storage.setItem;
  storage.setItem = (k, v) => { writes++; orig(k, v); };
  assert.equal(migrateStoredProfile(storage), false);
  assert.equal(writes, 0);
  assert.equal(storage.getItem(PROFILE_KEY), clean);
});

test('migration تعيد false ولا تلمس بيانات غير قابلة للقراءة أو غير ملف', () => {
  const broken = '{not json password';
  const storage = memoryStorage({ [PROFILE_KEY]: broken });
  assert.equal(migrateStoredProfile(storage), false);
  assert.equal(storage.getItem(PROFILE_KEY), broken);

  const empty = memoryStorage();
  assert.equal(migrateStoredProfile(empty), false);

  const arr = memoryStorage({ [PROFILE_KEY]: '["password"]' });
  assert.equal(migrateStoredProfile(arr), false);
});

test('migration تعيد false إذا تعذّرت القراءة', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() {} };
  assert.equal(migrateStoredProfile(throwing), false);
});

test('sanitizeProfile لا يعدّل الكائن الأصلي', () => {
  const original = { ...OLD_PROFILE };
  const cleaned = sanitizeProfile(original);
  assert.equal(original.password, 'OldRawPassword123');
  assert.equal('password' in cleaned, false);
  assert.equal(cleaned.name, 'سارة');
});

test('كلمة المرور لا تبقى في أي قيمة مخزنة بعد migration', () => {
  const storage = memoryStorage({ [PROFILE_KEY]: JSON.stringify(OLD_PROFILE) });
  migrateStoredProfile(storage);
  const dump = [...storage._map.values()].join('\n');
  assert.equal(dump.includes('OldRawPassword123'), false);
});
