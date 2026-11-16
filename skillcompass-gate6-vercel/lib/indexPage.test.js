'use strict';
// اختبارات صفحة index.html الفعلية: تُحمَّل سكربتاتها في vm مع DOM وهمي بسيط.
// تغطي: التسجيل بدون كلمة مرور، migration للملف القديم، وسيناريوهات محاكاة التسويق.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── DOM وهمي minimal: كل id يُنشأ عند أول قراءة ──
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : !!force; on ? this.set.add(c) : this.set.delete(c); return on; }
}
class FakeEl {
  constructor(id = '') {
    this.id = id; this.style = {}; this.value = ''; this.className = ''; this.innerHTML = '';
    this.classList = new ClassList(); this.attrs = {}; this.children = []; this.listeners = {};
    this._text = '';
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
}
class MemStorage {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
}

function htmlDefaultValue(id) {
  const tag = HTML.match(new RegExp('<(input|textarea|select)[^>]*\\sid="' + id + '"[^>]*>'));
  if (!tag) return null;
  const v = tag[0].match(/\svalue="([^"]*)"/);
  return v ? v[1] : null;
}

// يحمّل الصفحة بسكربتاتها بالترتيب نفسه الموجود في index.html.
// localStorage/sessionStorage يمكن مشاركتهما بين تحميلين لمحاكاة إعادة فتح الصفحة.
function loadPage({ local = new MemStorage(), session = new MemStorage() } = {}) {
  const els = new Map();
  const logs = [];
  // كل عنصر يبدأ بالقيمة الافتراضية الحقيقية من HTML (مثلاً value="0" لحقول الإنفاق)
  const getEl = (id) => {
    if (!els.has(id)) {
      const el = new FakeEl(id);
      const def = htmlDefaultValue(id);
      if (def !== null) el.value = def;
      els.set(id, el);
    }
    return els.get(id);
  };
  const document = {
    getElementById: getEl,
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: () => [],
    querySelector: () => null,
    body: getEl('body'),
    addEventListener() {},
  };
  const consoleSpy = {};
  ['log', 'warn', 'error', 'info', 'debug'].forEach((m) => {
    consoleSpy[m] = (...args) => logs.push([m, args.map(String).join(' ')]);
  });
  const sandbox = {
    document, console: consoleSpy, localStorage: local, sessionStorage: session,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    scrollTo() {}, addEventListener() {}, requestAnimationFrame: (f) => 0,
    fetch: () => { throw new Error('network is not allowed in page tests'); },
    alert() {}, Intl, URL, Date, Math, JSON, Number, String, Set, Map, Array, Object, Promise, RegExp,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  const re = /<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(HTML))) {
    const code = m[1] ? fs.readFileSync(path.join(ROOT, m[1]), 'utf8') : m[2];
    vm.runInContext(code, ctx, { filename: m[1] || 'index.html-inline' });
  }
  const g = (expr) => vm.runInContext(expr, ctx);
  return { ctx, g, els, getEl, local, session, logs, sandbox };
}

const PROFILE_KEY = 'skillcompass_profile';
const PROGRESS_KEY = 'skillcompass_progress';
const MKT_KEY = 'skillcompass_mktsim';
const RAW_PASSWORD = 'Hunter2-Raw-Pass';

// الحالة الافتراضية لمحاكاة التسويق كما ينشئها الصفحة نفسها (restartMktSimulation)
const DEFAULT_MKT = {
  phase: 1, budget: 0, selectedCampaign: null, selectedAge: null, selectedInterest: null,
  adSpend: { facebook: 0, instagram: 0, tiktok: 0, google: 0 }, selectedCreative: null,
  totalClicks: 0, totalConversions: 0, totalRevenue: 0, totalSpend: 0, scores: {},
  started: false, coinsAwarded: false, budgetConfirmed: false,
  simulationStartedAt: null, simulationResultsReady: false,
};

function seedStorage({ profile, progress, mkt } = {}) {
  const seed = {};
  if (profile) seed[PROFILE_KEY] = JSON.stringify(profile);
  if (progress) seed[PROGRESS_KEY] = JSON.stringify(progress);
  if (mkt) seed[MKT_KEY] = JSON.stringify({ ...DEFAULT_MKT, ...mkt, adSpend: { ...DEFAULT_MKT.adSpend, ...(mkt.adSpend || {}) } });
  return new MemStorage(seed);
}

const MARKETING_PROFILE = { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' };
const unlockedProgress = (skillCoins) => ({
  completedLessons: [], quizPassedLessons: [], skillCoins, lastQuizResult: null,
  progressSkill: 'marketing',
  simulationUnlocked: { marketing: true },
});

// ───────── Phase 1: التسجيل وتخزين كلمة المرور ─────────

test('نموذج التسجيل لم يعد يحتوي حقل كلمة المرور ويُوضّح أنه ملف محلي', () => {
  assert.equal(HTML.includes('id="reg-password"'), false);
  assert.equal(HTML.includes('type="password"'), false);
  assert.equal(HTML.includes('<label>كلمة المرور'), false);
  assert.match(HTML, /ملف تعليمي محلي/);
  assert.match(HTML, /ليس حساباً آمناً/);
});

test('بعد التسجيل: لا كلمة مرور ولا Hash في localStorage أو sessionStorage، ولا في Console', () => {
  const { g, getEl, local, session, logs } = loadPage({ local: seedStorage(), session: new MemStorage() });
  getEl('reg-name').value = 'سارة';
  getEl('reg-email').value = 'sara@example.com';
  g('handleRegistration()');

  const stored = JSON.parse(local.getItem(PROFILE_KEY));
  assert.equal(stored.name, 'سارة');
  assert.equal(stored.email, 'sara@example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'password'), false);
  assert.equal(session.length, 0, 'sessionStorage يجب أن يبقى فارغاً');
  for (const k of [...local.map.keys()]) {
    assert.equal(local.map.get(k).includes(RAW_PASSWORD), false, k);
  }
  assert.equal(JSON.stringify(logs).includes(RAW_PASSWORD), false);
});

test('إعادة التسجيل أو تحديث الملف لا تصفر العملات ولا تقدم الدروس أو بيانات المحاكاة', () => {
  const progress = {
    completedLessons: [1, 2, 3], quizPassedLessons: [1, 2], skillCoins: 40,
    lastQuizResult: { score: 8 }, progressSkill: 'marketing',
    lessonProgressBySkill: { ecommerce: { completedLessons: [7], quizPassedLessons: [7] } },
    simulationUnlocked: { marketing: true },
  };
  const local = seedStorage({ profile: { ...MARKETING_PROFILE, password: RAW_PASSWORD }, progress });
  const before = local.getItem(PROGRESS_KEY);
  const { g, getEl, sandbox } = loadPage({ local });
  sandbox.confirm = () => true; // تغيير البريد يتطلب موافقة صريحة (هوية الملف)
  getEl('reg-name').value = 'سارة الجديدة';
  getEl('reg-email').value = 'sara.new@example.com';
  g('handleRegistration()');
  const savedProfile = JSON.parse(local.getItem(PROFILE_KEY));
  assert.equal(savedProfile.name, 'سارة الجديدة');
  assert.equal(savedProfile.email, 'sara.new@example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(savedProfile, 'password'), false);
  assert.equal(local.getItem(PROGRESS_KEY), before, 'مفتاح التقدم يجب ألا يتغير بسبب تحديث الملف');
  assert.equal(g('userProgress.skillCoins'), 40);
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), [1, 2, 3]);
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), [1, 2]);
});

test('التسجيل لا يقبل الاسم بدون بريد ولا يحفظ شيئاً، ولا يطلب كلمة مرور', () => {
  const { g, getEl, local } = loadPage({ local: seedStorage() });
  getEl('reg-name').value = 'سارة';
  getEl('reg-email').value = '';
  g('handleRegistration()');
  assert.equal(local.getItem(PROFILE_KEY), null);
  assert.equal(getEl('reg-error').textContent, 'جميع الحقول مطلوبة');
});

test('migration عند تحميل الصفحة تحذف password وتحفظ التقدم القديم غير المنسوب دون منحه لمهارة تلقائياً', () => {
  const progress = { completedLessons: [1, 2], quizPassedLessons: [1], skillCoins: 35, lastQuizResult: null };
  const local = seedStorage({
    profile: { ...MARKETING_PROFILE, password: RAW_PASSWORD },
    progress,
  });
  const progressBefore = local.getItem(PROGRESS_KEY);
  const { g, logs } = loadPage({ local });

  const after = JSON.parse(local.getItem(PROFILE_KEY));
  assert.equal(Object.prototype.hasOwnProperty.call(after, 'password'), false);
  assert.equal(after.name, 'سارة');
  assert.equal(after.email, 'sara@example.com');
  assert.equal(after.skill, 'marketing');
  // التقدم محفوظ في منطقة غير منسوبة؛ لا نحتسبه تلقائياً لمهارة قد تكون خاطئة.
  const progAfter = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.equal(progressBefore === null, false);
  assert.deepEqual(progAfter.completedLessons, []);
  assert.deepEqual(progAfter.quizPassedLessons, []);
  assert.deepEqual(progAfter.legacyUnassignedProgress.completedLessons, [1, 2]);
  assert.deepEqual(progAfter.legacyUnassignedProgress.quizPassedLessons, [1]);
  assert.equal(progAfter.legacyUnassignedProgress.reason, 'legacy_progress_without_skill_marker');
  assert.equal(progAfter.progressSkill, 'marketing');
  assert.equal(progAfter.skillCoins, 35);
  assert.equal(g('userProgress.skillCoins'), 35);
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.completedLessons')), [1, 2]);
  assert.equal(JSON.stringify(logs).includes(RAW_PASSWORD), false);
});

// ───────── Phase 2: محاكاة التسويق عند رصيد صفر ─────────

test('رصيد صفر في مرحلة الميزانية: تظهر رسالة توضح السبب وزر دروس التسويق', () => {
  const { g, getEl } = loadPage({ local: seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0) }) });
  g("navigateTo('page10')");
  assert.equal(g('mktState.phase'), 1);
  // ننتقل إلى المرحلة 3 كما يفعل المستخدم
  g('mktState.phase = 3; saveMktState(); renderMarketingSim();');
  assert.equal(getEl('mkt-no-budget').style.display, 'block');
  assert.match(HTML, /لا يمكن بدء الحملة: رصيدك 0 SkillCoins/);
  assert.equal(getEl('mkt-budget').textContent, '0');
});

test('رصيد صفر: تأكيد الميزانية لا يخصم شيئاً ويعرض رسالة الرصيد', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0), mkt: { phase: 3 } });
  const { g, getEl } = loadPage({ local });
  getEl('mkt-ad-facebook').value = '10';
  g('confirmMktBudget()');
  assert.equal(getEl('mkt-error-budget').textContent, g('MarketingBudget.BUDGET_MESSAGES.no_balance'));
  assert.equal(getEl('mkt-error-budget').classList.contains('show'), true);
  assert.equal(g('userProgress.skillCoins'), 0);
  assert.equal(g('mktState.budgetConfirmed'), false);
});

test('زر الذهاب إلى دروس التسويق يفتح أول درس تسويق غير مجتاز دون منح عملات', () => {
  const { g } = loadPage({ local: seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0) }) });
  g('goToMarketingLessons()');
  assert.equal(g('currentLessonIndex'), 0);
  assert.equal(g("document.getElementById('page6').classList.contains('active')"), true);
  assert.equal(g('userProgress.skillCoins'), 0);
});

test('زر دروس التسويق يتخطى الدروس المجتازة ويحترم قفل الدرس السابق', () => {
  const progress = { ...unlockedProgress(0), quizPassedLessons: [1] };
  const { g } = loadPage({ local: seedStorage({ profile: MARKETING_PROFILE, progress }) });
  g('goToMarketingLessons()');
  assert.equal(g('currentLessonIndex'), 1);
});

test('محاكاة كاملة: رصيد صفر ← دروس ← كسب عملات حقيقية ← العودة ← خصم مرة واحدة ← استكمال', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0) });
  let page = loadPage({ local });
  let { g, getEl } = page;

  // 1) رصيد صفر: الرسالة والزر
  g("navigateTo('page10')");
  g('mktState.phase = 3; saveMktState(); renderMarketingSim();');
  assert.equal(getEl('mkt-no-budget').style.display, 'block');

  // 2) إدخال إنفاق ثم محاولة التأكيد: يُرفض ولا يُخصم شيء
  getEl('mkt-ad-facebook').value = '4';
  getEl('mkt-ad-instagram').value = '3';
  g('confirmMktBudget()');
  assert.equal(g('userProgress.skillCoins'), 0);

  // 3) الذهاب لدروس التسويق وإكمال درس حقيقي (المكافأة الحالية للدرس: 10)
  g('goToMarketingLessons()');
  g('completeCurrentLesson()');
  assert.equal(g('userProgress.skillCoins'), 10, 'العملات من مسار الدرس الحقيقي فقط');

  // 4) إعادة فتح الصفحة (محاكاة: تحميل جديد من التخزين نفسه) ثم العودة للمحاكاة
  page = loadPage({ local });
  ({ g, getEl } = page);
  g("navigateTo('page10')");
  assert.equal(getEl('mkt-no-budget').style.display, 'none', 'الرسالة تختفي بعد كسب الرصيد');
  assert.equal(getEl('mkt-budget').textContent, '10');
  assert.equal(getEl('mkt-ad-facebook').value, '4', 'اختيارات الإنفاق محفوظة');
  assert.equal(getEl('mkt-ad-instagram').value, '3');

  // 5) إنفاق أعلى من الرصيد (7 > 10 لا، 4+3=7 ≤ 10 ✓) → نعدّل إلى أعلى من الرصيد أولاً
  getEl('mkt-ad-facebook').value = '8';
  g('confirmMktBudget()');
  assert.match(getEl('mkt-error-budget').textContent, /لا يمكن أن يتجاوز الإنفاق/);
  assert.equal(g('userProgress.skillCoins'), 10);

  // 6) إنفاق ضمن الرصيد: خصم مرة واحدة
  getEl('mkt-ad-facebook').value = '6';
  getEl('mkt-ad-instagram').value = '4';
  g('confirmMktBudget()');
  assert.equal(g('userProgress.skillCoins'), 0);
  assert.equal(g('mktState.budgetConfirmed'), true);
  assert.equal(g('mktState.totalSpend'), 10);
  assert.equal(g('mktState.phase'), 4);

  // 7) تأكيد متكرر أو العودة للمرحلة 3 لا يخصم مرة أخرى
  g('confirmMktBudget()');
  g('mktState.phase = 3; saveMktState(); renderMarketingSim();');
  g('confirmMktBudget()');
  assert.equal(g('userProgress.skillCoins'), 0);
  assert.equal(JSON.parse(local.getItem(PROGRESS_KEY)).skillCoins, 0, 'الخصم محفوظ مرة واحدة');

  // 8) المحاكاة تكمل: المرحلة 4 مفتوحة
  g("navigateTo('page10')");
  assert.equal(g('mktState.phase'), 4);
});

test('رصيد موجب أقل من الإنفاق: رسالة تجاوز الرصيد دون خصم', () => {
  const { g, getEl } = loadPage({
    local: seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(5), mkt: { phase: 3 } }),
  });
  g("navigateTo('page10')");
  getEl('mkt-ad-google').value = '6';
  g('confirmMktBudget()');
  assert.equal(getEl('mkt-error-budget').textContent, g('MarketingBudget.BUDGET_MESSAGES.exceeds_balance'));
  assert.equal(g('userProgress.skillCoins'), 5);
});

test('إنفاق صفر أو غير صالح: رسالة واضحة دون خصم', () => {
  const { g, getEl } = loadPage({
    local: seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(20), mkt: { phase: 3 } }),
  });
  g("navigateTo('page10')");
  g('confirmMktBudget()');
  assert.equal(getEl('mkt-error-budget').textContent, g('MarketingBudget.BUDGET_MESSAGES.empty_spend'));
  assert.equal(g('userProgress.skillCoins'), 20);
});

test('الإنفاق المدخل يبقى بعد إعادة فتح الصفحة قبل التأكيد', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0), mkt: { phase: 3 } });
  let { g, getEl } = loadPage({ local });
  g("navigateTo('page10')");
  getEl('mkt-ad-tiktok').value = '2';
  g('updateMktAdTotal()');

  ({ g, getEl } = loadPage({ local }));
  g("navigateTo('page10')");
  assert.equal(getEl('mkt-ad-tiktok').value, '2');
});

// ───────── تقدم المستخدم والبيانات الأخرى لا تتأثر ─────────

test('محاكاة التسويق لا تغيّر مكافآت الدروس: الدرس يعطي 10 والاختبار يعطي 25 كما كان', () => {
  const src = HTML;
  assert.match(src, /userProgress\.skillCoins = \(userProgress\.skillCoins \|\| 0\) \+ 10;/);
  assert.match(src, /userProgress\.skillCoins = \(userProgress\.skillCoins \|\| 0\) \+ 25;/);
  assert.match(src, /const coins = score >= 90 \? 60 : score >= 75 \? 40 : score >= 60 \? 20 : 0;/);
});

test('اجتياز جميع دروس التسويق: لا يعيد الزر إلى الدرس الأول وتظهر رسالة واضحة', () => {
  const allIds = Array.from(loadPage().g('SKILL_DATABASE.marketing.lessons.map(l => l.id)'));
  const progress = { ...unlockedProgress(0), quizPassedLessons: allIds, completedLessons: allIds };
  const { g, getEl } = loadPage({ local: seedStorage({ profile: MARKETING_PROFILE, progress, mkt: { phase: 3 } }) });
  g("navigateTo('page10')");
  g('mktState.phase = 3; saveMktState(); renderMarketingSim();');

  // الزر مخفي والنص يوضح الحالة
  assert.equal(getEl('mkt-go-lessons').style.display, 'none');
  assert.match(getEl('mkt-no-budget-text').textContent, /اجتزت جميع دروس التسويق/);

  // استدعاء الدالة مباشرة لا ينقل إلى درس ولا يمنح عملات
  g('currentLessonIndex = 0; goToMarketingLessons();');
  assert.equal(getEl('page6').classList.contains('active'), false);
  assert.equal(getEl('app-toast').textContent, 'اجتزت جميع دروس التسويق، ولا توجد مكافآت دروس جديدة متاحة حالياً.');
  assert.equal(g('userProgress.skillCoins'), 0);
});

test('زر Google غير متاح: معطّل وبلا معالج نقر', () => {
  const idx = HTML.indexOf('التسجيل باستخدام Google');
  const before = HTML.slice(Math.max(0, idx - 200), idx);
  assert.match(before, /disabled/);
  assert.equal(before.includes('googleLogin()'), false);
  assert.match(HTML.slice(idx, idx + 60), /غير متاح حالياً/);
});

// ───────── استعادة الإنفاق بعد Refresh (القيم الافتراضية الحقيقية للحقول) ─────────

test('الحقول تبدأ بالقيمة الافتراضية من HTML (0) وليست فارغة', () => {
  const { getEl } = loadPage({ local: seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0) }) });
  assert.equal(getEl('mkt-ad-facebook').value, '0');
  assert.equal(getEl('mkt-ad-instagram').value, '0');
});

test('الإنفاق المحفوظ (5 و3) يعود بعد Refresh حتى مع الافتراضي 0 في الحقول', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(10), mkt: { phase: 3 } });
  let { g, getEl } = loadPage({ local });
  g("navigateTo('page10')");
  getEl('mkt-ad-facebook').value = '5';
  getEl('mkt-ad-instagram').value = '3';
  g('updateMktAdTotal()');
  assert.equal(g('mktState.adSpend.facebook'), 5);

  // Refresh: تحميل جديد من التخزين نفسه
  ({ g, getEl } = loadPage({ local }));
  g("navigateTo('page10')");
  assert.equal(getEl('mkt-ad-facebook').value, '5');
  assert.equal(getEl('mkt-ad-instagram').value, '3');
});

test('استدعاء updateMktAdTotal قبل الاستعادة لا يمحو القيم المحفوظة بالأصفار الافتراضية', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(10), mkt: { phase: 3, adSpend: { facebook: 5, instagram: 3 } } });
  const { g, getEl } = loadPage({ local });
  g('updateMktAdTotal()'); // قبل أي navigateTo
  assert.equal(getEl('mkt-ad-facebook').value, '5');
  assert.equal(g('mktState.adSpend.facebook'), 5);
  assert.equal(JSON.parse(local.getItem(MKT_KEY)).adSpend.facebook, 5);
});

test('تعديل أثناء الجلسة لا تكتبه الاستعادة فوق القيم الجديدة', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(10), mkt: { phase: 3, adSpend: { facebook: 5 } } });
  const { g, getEl } = loadPage({ local });
  g("navigateTo('page10')");
  getEl('mkt-ad-facebook').value = '7';
  g('updateMktAdTotal()');
  g("navigateTo('page10')"); // إعادة عرض داخل الجلسة نفسها
  assert.equal(getEl('mkt-ad-facebook').value, '7');
  assert.equal(g('mktState.adSpend.facebook'), 7);
});

test('سيناريو Refresh الكامل: 5 و3 ← Refresh ← درس (+10) ← العودة ← التأكيد يخصم 8 فيبقى 2', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(0), mkt: { phase: 3 } });
  let { g, getEl } = loadPage({ local });
  g("navigateTo('page10')");
  getEl('mkt-ad-facebook').value = '5';
  getEl('mkt-ad-instagram').value = '3';
  g('updateMktAdTotal()');
  assert.equal(g('userProgress.skillCoins'), 0);

  ({ g, getEl } = loadPage({ local }));          // Refresh
  g("navigateTo('page10')");
  assert.equal(getEl('mkt-ad-facebook').value, '5');
  assert.equal(getEl('mkt-ad-instagram').value, '3');

  g('goToMarketingLessons()');
  g('completeCurrentLesson()');
  assert.equal(g('userProgress.skillCoins'), 10);

  g("navigateTo('page10')");
  assert.equal(getEl('mkt-ad-facebook').value, '5');
  assert.equal(getEl('mkt-ad-instagram').value, '3');
  assert.equal(getEl('mkt-budget').textContent, '10');

  g('confirmMktBudget()');
  assert.equal(g('userProgress.skillCoins'), 2, '10 - (5+3) = 2');
  assert.equal(g('mktState.totalSpend'), 8);
  assert.equal(g('mktState.budgetConfirmed'), true);
  assert.equal(JSON.parse(local.getItem(PROGRESS_KEY)).skillCoins, 2);
});

test('إعادة الضبط تمسح حقول الإنفاق المعروضة مع الحالة', () => {
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: unlockedProgress(10), mkt: { phase: 3, adSpend: { facebook: 5 } } });
  const { g, getEl } = loadPage({ local });
  g('restartMktSimulation()');
  assert.equal(getEl('mkt-ad-facebook').value, '0');
  assert.equal(g('mktState.adSpend.facebook'), 0);
});

// ───────── تقدم الدروس مرتبط بالمهارة ─────────

test('تغيير المسار مع الاحتفاظ بالتقدم: اجتياز التجارة لا يُعتبر اجتياز التسويق بالمعرّف نفسه', () => {
  const ecomIds = Array.from(loadPage().g("SKILL_DATABASE.ecommerce.lessons.slice(0, 8).map(l => l.id)"));
  const progress = {
    completedLessons: ecomIds, quizPassedLessons: ecomIds, skillCoins: 40, lastQuizResult: null,
    progressSkill: 'ecommerce', simulationUnlocked: {},
  };
  const local = seedStorage({ profile: { name: 'سارة', email: 'sara@example.com', skill: 'ecommerce', level: 'beginner', goal: 'x', style: 'x' }, progress });
  const { g } = loadPage({ local });

  // المستخدم يعيد الاختيار من الويزارد ويختار التسويق
  g("wizardSelections = { goal: 'x', skill: 'marketing', level: 'beginner', style: 'x' }; submitAssessment();");
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), [], 'لا اجتياز موروث للتسويق');
  assert.equal(g('getSimulationGate("page10").unlocked'), false, 'بوابة التسويق مقفلة');
  assert.equal(g('userProgress.skillCoins'), 40, 'العملات محفوظة');

  // التقدم القديم في التجارة محفوظ ويعود عند العودة إليها
  const saved = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.deepEqual(saved.lessonProgressBySkill.ecommerce.quizPassedLessons, ecomIds);
  g("wizardSelections = { goal: 'x', skill: 'ecommerce', level: 'beginner', style: 'x' }; submitAssessment();");
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), ecomIds, 'تقدم التجارة يعود كما كان');
});

test('ملف قديم بلا progressSkill: يحفظ التقدم غير المنسوب ولا يمنحه تلقائياً للمهارة الحالية', () => {
  const ids = [1, 2, 3];
  const local = seedStorage({
    profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' },
    progress: { completedLessons: ids, quizPassedLessons: [1], skillCoins: 35, lastQuizResult: null },
  });
  const { g } = loadPage({ local });
  assert.equal(g('userProgress.progressSkill'), 'marketing');
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.completedLessons')), ids);
  assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.quizPassedLessons')), [1]);
  assert.equal(g('userProgress.skillCoins'), 35);
  const saved = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.equal(saved.progressSkill, 'marketing');
  assert.deepEqual(saved.legacyUnassignedProgress.completedLessons, ids);
});

test('progressSkill فارغ أو null لا يجعل تقدم legacy موثوق الإسناد', () => {
  for (const marker of [null, '']) {
    const local = rawStorage({
      skillcompass_profile: { ...BASE_PROFILE, skill: 'marketing' },
      skillcompass_progress: { completedLessons: [1, 2], quizPassedLessons: [1], skillCoins: 18, progressSkill: marker },
    });
    const { g } = loadPage({ local });
    assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
    assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
    assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.completedLessons')), [1, 2]);
    assert.equal(g('userProgress.skillCoins'), 18);
  }
});

for (const marker of ['__proto__', 'constructor', 'toString', 'unknown']) {
  test(`progressSkill غير معروف (${marker}): يُعزل التقدم ولا يُفقد أو يُنسب لمسار آخر`, () => {
    const local = rawStorage({
      skillcompass_profile: { ...BASE_PROFILE, skill: 'marketing' },
      skillcompass_progress: {
        completedLessons: [1, 2, 3],
        quizPassedLessons: [1, 2],
        skillCoins: 18,
        progressSkill: marker,
      },
    });
    const { g } = loadPage({ local });

    assert.equal(g('userProgress.progressSkill'), 'marketing', 'تُستخدم علامة المسار المعروفة من الملف الشخصي');
    assert.deepEqual(Array.from(g('userProgress.completedLessons')), [], 'لا يُنسب التقدم المشكوك فيه للتسويق');
    assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
    assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.completedLessons')), [1, 2, 3]);
    assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.quizPassedLessons')), [1, 2]);
    assert.equal(g('userProgress.skillCoins'), 18, 'رصيد العملات لا يتغير');

    const saved = JSON.parse(local.getItem(PROGRESS_KEY));
    assert.deepEqual(saved.legacyUnassignedProgress.completedLessons, [1, 2, 3]);
    assert.deepEqual(saved.legacyUnassignedProgress.quizPassedLessons, [1, 2]);
    assert.equal(Object.prototype.hasOwnProperty.call(saved.lessonProgressBySkill, marker), false);

    g("wizardSelections = { goal: 'x', skill: 'project', level: 'beginner', style: 'x' }; submitAssessment();");
    assert.deepEqual(Array.from(g('userProgress.completedLessons')), [], 'تبديل المسار لا يستعيد بيانات العلامة المجهولة');
    assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
    assert.equal(g('userProgress.skillCoins'), 18);
  });
}

test('lessonProgressBySkill يقبل المفاتيح الخاصة كبيانات عادية دون تغيير prototype', () => {
  const snapshots = JSON.parse('{"__proto__":{"completedLessons":[7],"quizPassedLessons":[7]},"constructor":{"completedLessons":[6],"quizPassedLessons":[6]},"toString":{"completedLessons":[5],"quizPassedLessons":[5]}}');
  const local = rawStorage({
    skillcompass_profile: BASE_PROFILE,
    skillcompass_progress: {
      completedLessons: [1],
      quizPassedLessons: [1],
      skillCoins: 12,
      progressSkill: 'ecommerce',
      lessonProgressBySkill: snapshots,
    },
  });
  const { g } = loadPage({ local });

  assert.equal(g('Object.getPrototypeOf(userProgress.lessonProgressBySkill) === null'), true);
  assert.equal(g('Object.prototype.hasOwnProperty.call(userProgress.lessonProgressBySkill, "__proto__")'), true);
  assert.equal(g('Object.prototype.hasOwnProperty.call(userProgress.lessonProgressBySkill, "constructor")'), true);
  assert.equal(g('Object.prototype.hasOwnProperty.call(userProgress.lessonProgressBySkill, "toString")'), true);

  g("wizardSelections = { goal: 'x', skill: 'marketing', level: 'beginner', style: 'x' }; submitAssessment();");
  const saved = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.deepEqual(saved.lessonProgressBySkill.__proto__.quizPassedLessons, [7]);
  assert.deepEqual(saved.lessonProgressBySkill.constructor.quizPassedLessons, [6]);
  assert.deepEqual(saved.lessonProgressBySkill.toString.quizPassedLessons, [5]);
  assert.equal(saved.progressSkill, 'marketing');
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
});

test('التقدم القديم غير المنسوب لا ينتقل إلى مهارة جديدة عند تبديل المسار', () => {
  const local = seedStorage({
    profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' },
    progress: { completedLessons: [1, 2, 3], quizPassedLessons: [1], skillCoins: 35 },
  });
  const { g } = loadPage({ local });
  g("wizardSelections = { goal: 'x', skill: 'ecommerce', level: 'beginner', style: 'x' }; submitAssessment();");
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.completedLessons')), [1, 2, 3]);
  assert.equal(g('userProgress.skillCoins'), 35);
});

// ───────── بيانات تقدم تالفة أو ناقصة: لا تعطّل التحميل، ولا تفقد skillCoins ─────────

// تخزين بقيم JSON خام (لتمرير null أو نص أو أنواع خاطئة كما هي في localStorage)
function rawStorage(entries) {
  const seed = {};
  for (const [k, v] of Object.entries(entries)) seed[k] = typeof v === 'string' && v.startsWith('RAW:') ? v.slice(4) : JSON.stringify(v);
  return new MemStorage(seed);
}

const BASE_PROFILE = { name: 'سارة', email: 'sara@example.com', skill: 'ecommerce', level: 'beginner', goal: 'x', style: 'x' };

for (const field of ['completedLessons', 'quizPassedLessons']) {
  for (const [label, bad] of [['مفقودة', undefined], ['null', null], ['نص', 'RAW:"1,2,3"'], ['رقم', 7], ['كائن', { 1: 1 }]]) {
    test(`${field} ${label}: التحميل يعمل وتصبح قائمة صالحة`, () => {
      const progress = { skillCoins: 40, lastQuizResult: { score: 3 }, simulationUnlocked: { marketing: true } };
      if (bad !== undefined) progress[field] = bad;
      const local = rawStorage({ skillcompass_profile: BASE_PROFILE, skillcompass_progress: progress });
      const { g } = loadPage({ local });
      assert.equal(Array.isArray(g(`userProgress.${field}`)), true);
      assert.equal(g('userProgress.skillCoins'), 40, 'skillCoins محفوظة');
      assert.deepEqual(g('userProgress.lastQuizResult'), { score: 3 }, 'الحقول الأخرى محفوظة');
      assert.equal(g('userProgress.simulationUnlocked.marketing'), true);
    });
  }
}

test('القوائم تُنظّف: الأرقام الصالحة فقط دون تكرار، والقيم التالفة داخل المصفوفة تُسقط', () => {
  const local = rawStorage({
    skillcompass_profile: BASE_PROFILE,
    skillcompass_progress: { quizPassedLessons: [1, 1, 'x', null, 2, NaN], completedLessons: [3], skillCoins: 5, progressSkill: 'ecommerce' },
  });
  const { g } = loadPage({ local });
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), [1, 2]);
  assert.equal(g('userProgress.skillCoins'), 5);
});

for (const [label, bad] of [['مفقودة', undefined], ['null', null], ['مصفوفة', [1, 2]], ['نص', 'RAW:"broken"'], ['رقم', 42]]) {
  test(`lessonProgressBySkill ${label}: التحميل يعمل ويصبح كائناً فارغاً`, () => {
    const progress = { completedLessons: [1], quizPassedLessons: [1], skillCoins: 12, progressSkill: 'ecommerce' };
    if (bad !== undefined) progress.lessonProgressBySkill = bad;
    const local = rawStorage({ skillcompass_profile: BASE_PROFILE, skillcompass_progress: progress });
    const { g } = loadPage({ local });
    assert.equal(g('typeof userProgress.lessonProgressBySkill'), 'object');
    assert.equal(Array.isArray(g('userProgress.lessonProgressBySkill')), false);
    assert.equal(g('userProgress.skillCoins'), 12);
  });
}

test('لقطة تالفة لمهارة مع لقطة سليمة لأخرى: السليمة تُستعاد، والتالفة لا تُقرأ ولا تنهار', () => {
  const local = rawStorage({
    skillcompass_profile: BASE_PROFILE,
    skillcompass_progress: {
      completedLessons: [1, 2, 3, 4, 5, 6, 7, 8], quizPassedLessons: [1, 2, 3, 4, 5, 6, 7, 8], skillCoins: 60,
      progressSkill: 'ecommerce',
      lessonProgressBySkill: {
        marketing: { completedLessons: [1], quizPassedLessons: [1] },   // سليمة
        project: 'RAW:"corrupt"',                                       // تالفة
      },
    },
  });
  const { g } = loadPage({ local });

  // إلى التالفة: تبدأ فارغة دون انهيار
  g("wizardSelections = { goal: 'x', skill: 'project', level: 'beginner', style: 'x' }; submitAssessment();");
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
  assert.equal(g('userProgress.skillCoins'), 60);

  // إلى السليمة: تُستعاد كما هي
  g("wizardSelections = { goal: 'x', skill: 'marketing', level: 'beginner', style: 'x' }; submitAssessment();");
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), [1]);
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), [1]);
  assert.equal(g('userProgress.skillCoins'), 60);
});

test('دورة تبديل: التجارة ← التسويق ← التجارة ← التسويق تعيد تقدم كل مهارة بدقة وتبقى العملات', () => {
  const ecom = [1, 2, 3, 4, 5, 6, 7, 8];
  const local = rawStorage({
    skillcompass_profile: BASE_PROFILE,
    skillcompass_progress: { completedLessons: ecom, quizPassedLessons: ecom, skillCoins: 100, progressSkill: 'ecommerce' },
  });
  const { g } = loadPage({ local });
  const choose = (skill) => g(`wizardSelections = { goal: 'x', skill: '${skill}', level: 'beginner', style: 'x' }; submitAssessment();`);

  choose('marketing');
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
  g('userProgress.completedLessons = [1, 2]; userProgress.quizPassedLessons = [1]; userProgress.skillCoins += 35; safeSetItem("skillcompass_progress", userProgress);');
  assert.equal(g('userProgress.skillCoins'), 135);

  choose('ecommerce');
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), ecom, 'تقدم التجارة كما كان');
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), ecom);
  assert.equal(g('userProgress.skillCoins'), 135, 'العملات لا تتأثر بتبديل المهارة');

  choose('marketing');
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), [1], 'تقدم التسويق كما تركته');
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), [1, 2]);

  const stored = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.equal(stored.progressSkill, 'marketing');
  assert.deepEqual(stored.lessonProgressBySkill.ecommerce.quizPassedLessons, ecom, 'لقطة التجارة محفوظة في التخزين');
  assert.equal(stored.skillCoins, 135);
});

test('تقدم قديم مختلط بلا علامة مهارة يُحفظ دون نسبته تلقائياً إلى المسار الحالي', () => {
  const local = rawStorage({
    skillcompass_profile: { ...BASE_PROFILE, skill: 'marketing' },
    skillcompass_progress: { completedLessons: [1, 2, 3], quizPassedLessons: [1, 2], skillCoins: 25 },
  });
  const { g } = loadPage({ local });
  assert.equal(g('userProgress.progressSkill'), 'marketing');
  assert.deepEqual(Array.from(g('userProgress.quizPassedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
  assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.quizPassedLessons')), [1, 2]);
  assert.deepEqual(Array.from(g('userProgress.legacyUnassignedProgress.completedLessons')), [1, 2, 3]);
  assert.equal(g('userProgress.skillCoins'), 25);
});

test('ملف شخصي أو تقدم يحويان نصاً بدل كائن: لا انهيار، والقيم الافتراضية تُستخدم', () => {
  const local = rawStorage({ skillcompass_profile: 'RAW:null', skillcompass_progress: 'RAW:"oops"' });
  const { g, logs } = loadPage({ local });
  // المجموعة A: الرصيد المجهول لا يُعامل كصفر (انظر اختبار الرصيد التالف أدناه)
  assert.equal(g('userProgress.skillCoins'), undefined);
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
  assert.equal(logs.filter(([m, t]) => m === 'error' && !t.includes('[SkillCoins]')).length, 0, 'لا انهيار؛ تشخيص SkillCoins المقصود مسموح');
});

// ───────── المجموعة A: حماية SkillCoins، هوية الملف، مكافأة مسار التسويق ─────────
const INTEGRITY_CASES = [
  ['{bad json', 'unreadable_json'],
  [JSON.stringify({ completedLessons: [], quizPassedLessons: [], skillCoins: '40', lastQuizResult: null }), 'not_number'],
  [JSON.stringify({ completedLessons: [], quizPassedLessons: [], skillCoins: -3, lastQuizResult: null }), 'negative'],
  [JSON.stringify({ completedLessons: [], quizPassedLessons: [], skillCoins: 1.5, lastQuizResult: null }), 'not_integer'],
  [JSON.stringify({ completedLessons: [], quizPassedLessons: [], lastQuizResult: null }), 'missing'],
];

test('تقدم محفوظ يحوي نصاً بدل كائن: لا انهيار، ولا يُستبدل الرصيد بصفر، والكتابة مُعلّقة', () => {
  const raw = '"oops"';
  const local = rawStorage({ skillcompass_profile: 'RAW:null', skillcompass_progress: 'RAW:' + raw });
  const { g, logs } = loadPage({ local });
  assert.equal(g('window.__coinsIntegrity.code'), 'not_object');
  assert.equal(g('userProgress.skillCoins'), undefined, 'لا قيمة افتراضية تحل محل الرصيد المجهول');
  assert.equal(g('coinsDisplay()'), '⚠');
  assert.deepEqual(Array.from(g('userProgress.completedLessons')), []);
  assert.equal(logs.filter(([m, t]) => m === 'error' && !t.includes('[SkillCoins]')).length, 0, 'لا أخطاء غير تشخيص SkillCoins');
  assert.equal(local.getItem(PROGRESS_KEY), raw, 'التخزين الأصلي لم يُمس');
});

for (const [raw, code] of INTEGRITY_CASES) {
  test(`رصيد تالف (${code}): لا إكمال درس، ولا كتابة، والتخزين الأصلي كما هو`, () => {
    const local = rawStorage({ skillcompass_profile: MARKETING_PROFILE, skillcompass_progress: 'RAW:' + raw });
    const { g, logs } = loadPage({ local });
    assert.equal(g('window.__coinsIntegrity.code'), code);
    g('completeCurrentLesson()');
    g('submitQuiz()');
    g('safeSetItem("skillcompass_progress", {completedLessons: [1], skillCoins: 0})');
    assert.equal(local.getItem(PROGRESS_KEY), raw, 'لا كتابة فوق بيانات لم نفهمها');
    assert.equal(g('(userProgress.completedLessons || []).length'), 0, 'لا إكمال');
    assert.ok(logs.some(([m, t]) => m === 'error' && t.includes('[SkillCoins]')), 'تشخيص في الكونسول');
  });
}

test('الرصيد التالف لا يمنح مكافأة المسار ولا يُعامل كصفر', () => {
  const raw = JSON.stringify({ completedLessons: [1, 2, 3, 4, 5, 6, 7, 8], quizPassedLessons: [1, 2, 3, 4, 5, 6, 7, 8], skillCoins: 'abc', lastQuizResult: null, progressSkill: 'marketing' });
  const local = rawStorage({ skillcompass_profile: { ...MARKETING_PROFILE, profileId: 'pid-x' }, skillcompass_progress: 'RAW:' + raw });
  const { g } = loadPage({ local });
  assert.equal(g('awardMarketingPathBonusIfEligible()'), false);
  assert.equal(local.getItem(PROGRESS_KEY), raw, 'لا علامة ولا رصيد جديد');
});

test('كتابة تقدم من كائن لا يحمل العلامة تنقلها من التخزين (safeSetItem)', () => {
  const record = { profileId: 'pid-x', amount: 100, grantedAt: 'x' };
  const local = seedStorage({ profile: MARKETING_PROFILE, progress: { skillCoins: 380, marketingPathBonus: record } });
  const { g } = loadPage({ local });
  g('safeSetItem("skillcompass_progress", {completedLessons: [], skillCoins: 380})');
  assert.deepEqual(JSON.parse(local.getItem(PROGRESS_KEY)).marketingPathBonus, record);
});

test('إعادة التسجيل بالبريد نفسه تحافظ على الرصيد والتقدم والعلامة', () => {
  const record = { profileId: 'pid-x', amount: 100, grantedAt: 'x' };
  const local = seedStorage({
    profile: { ...MARKETING_PROFILE, profileId: 'pid-x' },
    progress: { completedLessons: [1, 2], quizPassedLessons: [1], skillCoins: 135, lastQuizResult: null, progressSkill: 'marketing', marketingPathBonus: record },
  });
  const { g, getEl } = loadPage({ local });
  getEl('reg-name').value = 'سارة';
  getEl('reg-email').value = 'SARA@example.com';
  g('handleRegistration()');
  const prog = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.equal(prog.skillCoins, 135);
  assert.deepEqual(prog.completedLessons, [1, 2]);
  assert.deepEqual(prog.marketingPathBonus, record);
  assert.equal(JSON.parse(local.getItem(PROFILE_KEY)).profileId, 'pid-x', 'الهوية ثابتة');
});

test('تغيير البريد في الملف نفسه بتأكيد صريح يحافظ على profileId والمكافأة', () => {
  const record = { profileId: 'pid-x', amount: 100, grantedAt: 'x' };
  const local = seedStorage({
    profile: { ...MARKETING_PROFILE, profileId: 'pid-x' },
    progress: { completedLessons: [1], quizPassedLessons: [1], skillCoins: 380, lastQuizResult: null, progressSkill: 'marketing', marketingPathBonus: record },
  });
  const { g, getEl, sandbox } = loadPage({ local });
  sandbox.confirm = () => true;
  getEl('reg-name').value = 'سارة';
  getEl('reg-email').value = 'new@example.com';
  g('handleRegistration()');
  const prof = JSON.parse(local.getItem(PROFILE_KEY));
  assert.equal(prof.email, 'new@example.com');
  assert.equal(prof.profileId, 'pid-x');
  assert.equal(JSON.parse(local.getItem(PROGRESS_KEY)).skillCoins, 380);
  assert.deepEqual(JSON.parse(local.getItem(PROGRESS_KEY)).marketingPathBonus, record);
});

test('بريد مختلف دون تأكيد صريح لا يدمج الملف: لا تغيير في البريد ولا الهوية ولا الرصيد', () => {
  const local = seedStorage({
    profile: { ...MARKETING_PROFILE, profileId: 'pid-x' },
    progress: { completedLessons: [1], quizPassedLessons: [1], skillCoins: 380, lastQuizResult: null, progressSkill: 'marketing' },
  });
  const before = { profile: local.getItem(PROFILE_KEY), progress: local.getItem(PROGRESS_KEY) };
  const { g, getEl } = loadPage({ local });
  getEl('reg-name').value = 'منى';
  getEl('reg-email').value = 'mona@example.com';
  g('handleRegistration()');
  assert.equal(local.getItem(PROFILE_KEY), before.profile, 'الملف لم يتغير');
  assert.equal(local.getItem(PROGRESS_KEY), before.progress, 'التقدم لم يتغير');
});

test('تأكيد الرفض صراحة يبقي الملف كما هو (confirm يعيد false)', () => {
  const local = seedStorage({ profile: { ...MARKETING_PROFILE, profileId: 'pid-x' }, progress: { skillCoins: 5, completedLessons: [], quizPassedLessons: [], progressSkill: 'marketing' } });
  const before = local.getItem(PROFILE_KEY);
  const { g, getEl, sandbox } = loadPage({ local });
  sandbox.confirm = () => false;
  getEl('reg-name').value = 'منى';
  getEl('reg-email').value = 'mona@example.com';
  g('handleRegistration()');
  assert.equal(local.getItem(PROFILE_KEY), before);
});

test('تسجيل أول مرة لملف بلا بريد لا يطلب تأكيداً', () => {
  const local = seedStorage({ profile: { skill: 'marketing', level: 'beginner' } });
  const { g, getEl, sandbox } = loadPage({ local });
  let asked = false;
  sandbox.confirm = () => { asked = true; return false; };
  getEl('reg-name').value = 'سارة';
  getEl('reg-email').value = 'sara@example.com';
  g('handleRegistration()');
  assert.equal(asked, false);
  assert.equal(JSON.parse(local.getItem(PROFILE_KEY)).email, 'sara@example.com');
});

test('نص تأكيد تغيير البريد يوضح الملف المحلي وعدم التحقق وعدم النقل الآمن', () => {
  const local = seedStorage({
    profile: { ...MARKETING_PROFILE, profileId: 'pid-x' },
    progress: { completedLessons: [1], quizPassedLessons: [1], skillCoins: 380, lastQuizResult: null, progressSkill: 'marketing' },
  });
  const { g, getEl, sandbox } = loadPage({ local });
  let msg = '';
  sandbox.confirm = (m) => { msg = String(m); return false; };
  getEl('reg-name').value = 'سارة';
  getEl('reg-email').value = 'new@example.com';
  g('handleRegistration()');
  for (const phrase of ['الملف المحلي', 'لا يتحقق التطبيق من ملكية البريد', 'ليس تسجيل دخول موثقاً', 'نقلاً آمناً بين حسابات مستقلة']) {
    assert.ok(msg.includes(phrase), 'النص يجب أن يتضمن: ' + phrase);
  }
  assert.equal(local.getItem(PROFILE_KEY), JSON.stringify({ ...MARKETING_PROFILE, profileId: 'pid-x' }), 'الرفض لا يغيّر الملف');
  assert.equal(JSON.parse(local.getItem(PROGRESS_KEY)).skillCoins, 380, 'الرفض لا يغيّر الرصيد');
});

// مكافأة المسار بعد فساد الرصيد: لا منح ولا علامة زوراً، وبعد الإصلاح تُمنح مرة واحدة فقط عبر إعادة العرض
test('رصيد تالف عند اكتمال مسار التسويق: لا منح ولا علامة، وبعد الإصلاح تُمنح مرة واحدة فقط', () => {
  const probe = loadPage({ local: new MemStorage() });
  const lessonIds = Array.from(probe.g('SKILL_DATABASE.marketing.lessons.map(l => l.id)'));
  const quizIds = Array.from(probe.g('SKILL_DATABASE.marketing.lessons.filter(l => Array.isArray(l.quiz) && l.quiz.length > 0).map(l => l.id)'));
  assert.ok(lessonIds.length > 0 && quizIds.length > 0, 'المسار يحوي دروساً واختبارات');
  const base = { completedLessons: lessonIds, quizPassedLessons: quizIds, lastQuizResult: null, progressSkill: 'marketing', simulationUnlocked: { marketing: true } };
  const profile = { ...MARKETING_PROFILE, profileId: 'pid-corrupt-case' };

  // (أ) الرصيد تالف: إعادة العرض لا تمنح شيئاً ولا تكتب شيئاً
  const corrupt = JSON.stringify({ ...base, skillCoins: 'abc' });
  const local = rawStorage({ skillcompass_profile: profile, skillcompass_progress: 'RAW:' + corrupt });
  let page = loadPage({ local });
  assert.equal(page.g('awardMarketingPathBonusIfEligible()'), false);
  assert.equal(local.getItem(PROGRESS_KEY), corrupt, 'التخزين التالف لم يُمس');
  assert.equal(page.g('coinsDisplay()'), '⚠');

  // (ب) بعد إصلاح الرصيد وإعادة العرض: تُمنح المكافأة مرة واحدة
  local.setItem(PROGRESS_KEY, JSON.stringify({ ...base, skillCoins: 40 }));
  page = loadPage({ local });
  assert.equal(page.g('awardMarketingPathBonusIfEligible()'), true);
  let stored = JSON.parse(local.getItem(PROGRESS_KEY));
  assert.equal(stored.skillCoins, 140, 'الرصيد 40 + 100');
  assert.equal(stored.marketingPathBonus.profileId, 'pid-corrupt-case', 'العلامة مرتبطة بهوية الملف');
  assert.equal(stored.marketingPathBonus.amount, 100);

  // (ج) إعادة عرض أخرى: لا منح مجدداً ولا تغيير في الرصيد أو العلامة
  const afterFirstGrant = local.getItem(PROGRESS_KEY);
  page = loadPage({ local });
  assert.equal(page.g('awardMarketingPathBonusIfEligible()'), false);
  assert.equal(local.getItem(PROGRESS_KEY), afterFirstGrant);
  assert.equal(JSON.parse(local.getItem(PROGRESS_KEY)).skillCoins, 140);
});
