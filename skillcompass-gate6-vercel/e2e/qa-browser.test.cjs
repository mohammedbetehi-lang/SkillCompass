'use strict';
// اختبارات متصفح حقيقية (Chromium عبر Playwright) — تُشغَّل محلياً فقط، وليست ضمن CI:
//   node --test e2e/qa-browser.test.cjs
// تخدم الملفات من خادم محلي على 127.0.0.1، وتُحجب كل الطلبات الخارجية (لا شبكة ولا مفاتيح).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

// يحدد هل المسار (بعد الحل الحقيقي) داخل جذر المشروع الحقيقي
function isInsideRoot(p) {
  const base = fs.realpathSync(ROOT);
  const rel = path.relative(base, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// طلب خام إلى الخادم المحلي (المسار كما هو بلا تطبيع) ويعيد الحالة والمحتوى
function getRaw(rawPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

const ROOT = path.join(__dirname, '..');
// لقطات الشاشة اختيارية: تُكتب فقط إذا حُدّد QA_SHOTS_DIR (لا تُنشأ داخل المستودع)
const SHOTS = process.env.QA_SHOTS_DIR || '';
const VIEWPORTS = [
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];
const RAW_PASSWORD = 'Hunter2-Raw-Pass';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

let server, base;
let browserP;
const getBrowser = () => (browserP ||= chromium.launch());

test.before(async () => {
  // جذر المشروع الحقيقي (بعد حل أي روابط رمزية في مسار المشروع نفسه)
  const ROOT_REAL = fs.realpathSync(ROOT);
  const isInside = (base, target) => {
    const rel = path.relative(base, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  server = http.createServer((req, res) => {
    const notFound = () => { res.writeHead(404); res.end('not found'); };
    // المسار الخام بدون تطبيع URL (حتى لا تختفي محاولات ../)، ثم فك الترميز
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      res.writeHead(400); res.end('bad request'); return;
    }
    // (1) تحقق نصي: المسار المنطقي يجب أن يقع داخل ROOT
    const file = path.resolve(ROOT, urlPath === '/' ? 'index.html' : '.' + urlPath);
    if (!isInside(ROOT, file)) return notFound();
    if (!fs.existsSync(file)) return notFound();
    // (2) تحقق الوجهة الحقيقية: الروابط الرمزية تُحل هنا، ويجب أن تبقى الوجهة داخل جذر المشروع الحقيقي
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      return notFound();
    }
    if (!isInside(ROOT_REAL, real)) return notFound();
    if (fs.statSync(real).isDirectory()) return notFound();
    res.writeHead(200, { 'content-type': TYPES[path.extname(real)] || 'application/octet-stream' });
    fs.createReadStream(real).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
});

test.after(async () => {
  if (browserP) await (await browserP).close();
  if (server) server.close();
});

// يفتح صفحة جديدة بعرض محدد ويسجل كل الأخطاء: Console وpageerror وفشل تحميل الملفات المحلية.
async function openPage(vp) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar' });
  const page = await context.newPage();
  const report = { consoleIssues: [], pageErrors: [], localFailures: [], blockedExternal: [], allConsole: [] };
  page.on('console', (msg) => {
    const text = msg.text();
    report.allConsole.push(`${msg.type()}: ${text}`);
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const loc = msg.location().url || '';
      if (loc && !loc.startsWith(base)) report.blockedExternal.push(text);
      else report.consoleIssues.push(`${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', (err) => report.pageErrors.push(String(err && err.message)));
  page.on('requestfailed', (req) => {
    if (req.url().startsWith(base)) report.localFailures.push(`${req.url()} ${req.failure() && req.failure().errorText}`);
  });
  page.on('response', (res) => {
    if (res.url().startsWith(base) && res.status() >= 400) report.localFailures.push(`${res.status()} ${res.url()}`);
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    report.blockedExternal.push(`blocked ${url}`);
    return route.abort();
  });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  return { context, page, report };
}

// يكتب بيانات localStorage ثم يعيد تحميل الصفحة ليقرأها السكربت كما يحدث لمستخدم حقيقي.
async function seedAndReload(page, items) {
  await page.evaluate((entries) => {
    localStorage.clear();
    sessionStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, items);
  await page.reload({ waitUntil: 'load' });
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`), scale: 'device' }) : null);
const expectClean = (report) => {
  assert.deepEqual(report.pageErrors, [], 'pageerror');
  assert.deepEqual(report.consoleIssues, [], 'console errors/warnings');
  assert.deepEqual(report.localFailures, [], 'local file load failures');
};
const mktIds = (page) => page.evaluate(() => SKILL_DATABASE.marketing.lessons.map((l) => l.id));

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] التسجيل الجديد دون كلمة مرور، وفحص Console`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      // الوصول إلى نموذج التسجيل عبر الدالة نفسها التي يستدعيها زر «إنشاء حساب» في الصفحة 3
      await page.evaluate(() => navigateTo('page4'));
      await page.waitForSelector('#reg-name', { state: 'visible' });
      assert.equal(await page.locator('#reg-password').count(), 0, 'لا يوجد حقل كلمة مرور');
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      assert.match(await page.locator('#page4').innerText(), /ليس حساباً آمناً/);
      assert.equal(await page.locator('#page4 button', { hasText: 'Google' }).first().isDisabled(), true);
      assert.equal(await noOverflow(page), true, 'لا تمرير أفقي');
      await shot(page, `${vp.name}-register`);

      await page.fill('#reg-name', 'سارة');
      await page.fill('#reg-email', 'sara@example.com');
      await page.click('text=إنشاء الملف المحلي');
      await page.waitForTimeout(300);

      const stored = await page.evaluate(() => ({
        profile: localStorage.getItem('skillcompass_profile'),
        sessionCount: sessionStorage.length,
        all: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
      }));
      const profile = JSON.parse(stored.profile);
      assert.equal(profile.name, 'سارة');
      assert.equal(profile.email, 'sara@example.com');
      assert.equal(Object.prototype.hasOwnProperty.call(profile, 'password'), false);
      assert.equal(stored.sessionCount, 0, 'sessionStorage فارغ');
      for (const v of Object.values(stored.all)) assert.equal(String(v).includes(RAW_PASSWORD), false);
      assert.equal(report.allConsole.some((l) => l.includes(RAW_PASSWORD)), false);
      expectClean(report);
    } finally {
      await context.close();
    }
  });

  test(`[${vp.name}] Migration لملف قديم يحتوي password مع الحفاظ على التقدم وSkillCoins`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      const progress = JSON.stringify({ completedLessons: [1, 2], quizPassedLessons: [1], skillCoins: 35, lastQuizResult: null });
      await seedAndReload(page, {
        skillcompass_profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner', password: RAW_PASSWORD },
        skillcompass_progress: progress,
      });
      const r = await page.evaluate(() => ({
        profile: JSON.parse(localStorage.getItem('skillcompass_profile')),
        progress: JSON.parse(localStorage.getItem('skillcompass_progress')),
        coins: userProgress.skillCoins,
        completed: userProgress.completedLessons,
        all: Object.values(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))).join('\n'),
      }));
      assert.equal(Object.prototype.hasOwnProperty.call(r.profile, 'password'), false);
      assert.equal(r.profile.name, 'سارة');
      assert.equal(r.profile.email, 'sara@example.com');
      assert.equal(r.profile.skill, 'marketing');
      assert.deepEqual(r.progress.completedLessons, [1, 2], 'التقدم لم يُفقد');
      assert.deepEqual(r.progress.quizPassedLessons, [1]);
      assert.equal(r.progress.skillCoins, 35);
      assert.equal(r.coins, 35);
      assert.deepEqual(r.completed, [1, 2]);
      assert.equal(r.all.includes(RAW_PASSWORD), false);
      assert.equal(report.allConsole.some((l) => l.includes(RAW_PASSWORD)), false);
      expectClean(report);
    } finally {
      await context.close();
    }
  });

  test(`[${vp.name}] رحلة التسويق: رصيد صفر ← الدروس ← كسب العملات ← العودة ← خصم مرة واحدة ← متابعة`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      await seedAndReload(page, {
        skillcompass_profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' },
        skillcompass_progress: { completedLessons: [], quizPassedLessons: [], skillCoins: 0, lastQuizResult: null, simulationUnlocked: { marketing: true } },
      });
      await page.evaluate(() => navigateTo('page10'));

      // المرحلتان 1 و2 بالنقر
      await page.locator('.product-card').first().click();
      await page.click('text=تأكيد الاختيار');
      await page.locator('#mkt-age-options .option-card').first().click();
      await page.locator('#mkt-interest-options .option-card').first().click();
      await page.click('text=تأكيد الاستهداف');

      // 1) رصيد صفر في المرحلة 3
      assert.equal(await page.locator('#mkt-no-budget').isVisible(), true);
      assert.match(await page.locator('#mkt-no-budget-title').innerText(), /0 SkillCoins/);
      assert.equal(await noOverflow(page), true, 'لا تمرير أفقي في بطاقة الرصيد صفر');
      await shot(page, `${vp.name}-marketing-zero-balance`);

      // 2) محاولة التأكيد برصيد صفر
      await page.fill('#mkt-ad-facebook', '5');
      await page.click('#mkt-confirm-budget');
      assert.match(await page.locator('#mkt-error-budget').innerText(), /رصيدك الحالي 0 SkillCoins/);
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 0);

      // 3) الذهاب إلى الدروس
      await page.click('#mkt-go-lessons');
      assert.equal(await page.evaluate(() => document.getElementById('page6').classList.contains('active')), true);
      assert.ok((await page.locator('#lesson-title').innerText()).trim().length > 0);

      // 4) كسب العملات من درس حقيقي
      await page.click('#btn-complete-lesson');
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 10);

      // 5) العودة للمحاكاة: الرسالة تختفي والرصيد يتحدث واختيارات الإنفاق محفوظة
      await page.evaluate(() => navigateTo('page10'));
      assert.equal(await page.locator('#mkt-no-budget').isVisible(), false);
      assert.equal(await page.locator('#mkt-budget').innerText(), '10');
      assert.equal(await page.inputValue('#mkt-ad-facebook'), '5');

      // 6) إنفاق أعلى من الرصيد: يُرفض
      await page.fill('#mkt-ad-facebook', '6');
      await page.fill('#mkt-ad-instagram', '5');
      await page.click('#mkt-confirm-budget');
      assert.match(await page.locator('#mkt-error-budget').innerText(), /لا يمكن أن يتجاوز الإنفاق/);
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 10);

      // 7) إنفاق ضمن الرصيد: خصم واحد
      await page.fill('#mkt-ad-facebook', '4');
      await page.fill('#mkt-ad-instagram', '6');
      await page.click('#mkt-confirm-budget');
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 0);
      assert.equal(await page.locator('#mkt-phase-4').isVisible(), true);

      // 8) تأكيد متكرر ثم إعادة تحميل: لا خصم ثانٍ
      await page.evaluate(() => { confirmMktBudget(); mktState.phase = 3; saveMktState(); renderMarketingSim(); });
      await page.click('#mkt-confirm-budget');
      await page.reload({ waitUntil: 'load' });
      await page.evaluate(() => navigateTo('page10'));
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 0, 'الخصم مرة واحدة فقط');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('skillcompass_progress')).skillCoins), 0);

      // 9) متابعة المحاكاة: اختيار أسلوب الإعلان وإطلاقها
      await page.locator('#mkt-creative-options .option-card').first().click();
      await page.click('text=إطلاق الحملة');
      await page.waitForSelector('#mkt-phase-8', { state: 'visible', timeout: 20000 });
      await shot(page, `${vp.name}-marketing-finished`);

      expectClean(report);
    } finally {
      await context.close();
    }
  });

  test(`[${vp.name}] Refresh حقيقي: الإنفاق 5 و3 يعود، ثم درس (+10) وتأكيد يخصم 8 فيبقى 2`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      await seedAndReload(page, {
        skillcompass_profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' },
        skillcompass_progress: { completedLessons: [], quizPassedLessons: [], skillCoins: 0, lastQuizResult: null, simulationUnlocked: { marketing: true } },
      });
      // 1) افتح المحاكاة برصيد صفر وصل إلى المرحلة 3
      await page.evaluate(() => navigateTo('page10'));
      await page.locator('.product-card').first().click();
      await page.click('text=تأكيد الاختيار');
      await page.locator('#mkt-age-options .option-card').first().click();
      await page.locator('#mkt-interest-options .option-card').first().click();
      await page.click('text=تأكيد الاستهداف');
      assert.equal(await page.locator('#mkt-no-budget').isVisible(), true);

      // 2) أدخل 5 في Facebook و3 في Instagram  3) تأكد من الحفظ
      await page.fill('#mkt-ad-facebook', '5');
      await page.fill('#mkt-ad-instagram', '3');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('skillcompass_mktsim')).adSpend);
      assert.equal(saved.facebook, 5);
      assert.equal(saved.instagram, 3);

      // 4) Refresh حقيقي للمتصفح  5) افتح المحاكاة مجدداً
      await page.reload({ waitUntil: 'load' });
      await page.evaluate(() => navigateTo('page10'));

      // 6) القيم 5 و3 عادت (الحقول كانت ستظهر 0 لولا الاستعادة)
      assert.equal(await page.inputValue('#mkt-ad-facebook'), '5');
      assert.equal(await page.inputValue('#mkt-ad-instagram'), '3');
      assert.equal(await page.locator('#mkt-phase-3').isVisible(), true);

      // 7) اجتز درساً واكسب 10 SkillCoins
      await page.evaluate(() => goToMarketingLessons());
      await page.click('#btn-complete-lesson');
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 10);

      // 8) ارجع إلى الميزانية وتأكد من بقاء القيم
      await page.evaluate(() => navigateTo('page10'));
      assert.equal(await page.inputValue('#mkt-ad-facebook'), '5');
      assert.equal(await page.inputValue('#mkt-ad-instagram'), '3');
      assert.equal(await page.locator('#mkt-budget').innerText(), '10');

      // 9) أكمل التأكيد: 10 - (5+3) = 2، خصم واحد
      await page.click('#mkt-confirm-budget');
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 2);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('skillcompass_progress')).skillCoins), 2);
      assert.equal(await page.evaluate(() => mktState.totalSpend), 8);
      assert.equal(await page.locator('#mkt-phase-4').isVisible(), true);
      assert.equal(await noOverflow(page), true);
      expectClean(report);
    } finally {
      await context.close();
    }
  });

  test(`[${vp.name}] اكتمال جميع دروس التسويق: لا عودة إلى الدرس الأول ورسالة واضحة`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      const ids = await mktIds(page);
      await seedAndReload(page, {
        skillcompass_profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' },
        skillcompass_progress: { completedLessons: ids, quizPassedLessons: ids, skillCoins: 0, lastQuizResult: null, simulationUnlocked: { marketing: true } },
      });
      await page.evaluate(() => { navigateTo('page10'); mktState.phase = 3; saveMktState(); renderMarketingSim(); });
      assert.equal(await page.locator('#mkt-go-lessons').isVisible(), false);
      assert.match(await page.locator('#mkt-no-budget-text').innerText(), /اجتزت جميع دروس التسويق/);
      assert.equal(await noOverflow(page), true);
      await shot(page, `${vp.name}-marketing-all-passed`);

      await page.evaluate(() => goToMarketingLessons());
      assert.equal(await page.evaluate(() => document.getElementById('page6').classList.contains('active')), false);
      assert.match(await page.locator('#app-toast').innerText(), /اجتزت جميع دروس التسويق/);
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 0);
      expectClean(report);
    } finally {
      await context.close();
    }
  });
}

// يمرّ بالويزارد الحقيقي (4 خطوات بالنقر) ويختار المهارة المطلوبة، ثم يصل إلى صفحة المسار.
async function runWizard(page, skill) {
  await page.evaluate(() => navigateTo('page2'));
  // الويزارد يبقى على خطوته الأخيرة عند العودة (سلوك الصفحة الحالي): نرجع بزر «السابق» كما يفعل المستخدم
  for (let i = 0; i < 4; i++) {
    const current = await page.evaluate(() => [...document.querySelectorAll('[id^="step-"]')].findIndex((e) => getComputedStyle(e).display !== 'none') + 1);
    if (current === 1) break;
    await page.locator(`#step-${current} button`, { hasText: 'السابق' }).click();
  }
  await page.locator('#step-1 .option-card').first().click();
  await page.locator('#step-1 button', { hasText: 'التالي' }).click();
  await page.locator(`#step-2 .option-card[onclick*="'${skill}'"]`).click();
  await page.locator('#step-2 button', { hasText: 'التالي' }).click();
  await page.locator('#step-3 .option-card').first().click();
  await page.locator('#step-3 button', { hasText: 'التالي' }).click();
  await page.locator('#step-4 .option-card').first().click();
  await page.click('text=عرض المسار التعليمي');
  await page.waitForSelector('#page3.active', { state: 'visible' });
}

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] تبديل المهارة عبر الويزارد: تقدم كل مهارة يبقى منفصلاً والعملات محفوظة بعد Refresh`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      const ecomIds = [1, 2, 3, 4, 5, 6, 7, 8];
      await seedAndReload(page, {
        skillcompass_profile: { name: 'سارة', email: 'sara@example.com', skill: 'ecommerce', level: 'beginner' },
        skillcompass_progress: { completedLessons: ecomIds, quizPassedLessons: ecomIds, skillCoins: 40, lastQuizResult: null, progressSkill: 'ecommerce' },
      });

      // 1) التبديل إلى التسويق: لا اجتياز موروث، والمحاكاة مقفلة
      await runWizard(page, 'marketing');
      assert.deepEqual(await page.evaluate(() => userProgress.quizPassedLessons), []);
      await page.evaluate(() => navigateTo('page10'));
      assert.equal(await page.evaluate(() => document.getElementById('page10').classList.contains('active')), false, 'بوابة التسويق مقفلة');
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 40);

      // 2) درس تسويق حقيقي: +10
      await page.evaluate(() => goToMarketingLessons());
      await page.click('#btn-complete-lesson');
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 50);

      // 3) العودة إلى التجارة: تقدمها كما كان
      await runWizard(page, 'ecommerce');
      assert.deepEqual(await page.evaluate(() => userProgress.quizPassedLessons), ecomIds);
      assert.deepEqual(await page.evaluate(() => userProgress.completedLessons), ecomIds);
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 50);

      // 4) Refresh ثم التسويق: تقدم التسويق (درس واحد مكتمل) محفوظ ولم يتسرب منه شيء
      await page.reload({ waitUntil: 'load' });
      const afterReload = await page.evaluate(() => ({ skill: userProfile.skill, active: userProgress.progressSkill, passed: userProgress.quizPassedLessons, coins: userProgress.skillCoins }));
      assert.equal(afterReload.skill, 'ecommerce');
      assert.equal(afterReload.active, 'ecommerce');
      assert.deepEqual(afterReload.passed, ecomIds);
      assert.equal(afterReload.coins, 50);
      await runWizard(page, 'marketing');
      assert.deepEqual(await page.evaluate(() => userProgress.completedLessons), [1], 'درس التسويق المكتمل محفوظ');
      assert.deepEqual(await page.evaluate(() => userProgress.quizPassedLessons), []);
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 50);
      expectClean(report);
    } finally {
      await context.close();
    }
  });

  test(`[${vp.name}] بيانات تقدم تالفة: التطبيق يحمّل ويعمل والعملات لا تضيع`, async () => {
    const { context, page, report } = await openPage(vp);
    try {
      await seedAndReload(page, {
        skillcompass_profile: { name: 'سارة', email: 'sara@example.com', skill: 'marketing', level: 'beginner' },
        skillcompass_progress: { completedLessons: null, quizPassedLessons: 'x', skillCoins: 40, progressSkill: 'marketing', lessonProgressBySkill: 'bad' },
      });
      assert.equal(await page.evaluate(() => userProgress.skillCoins), 40);
      assert.equal(await page.locator('#header-coin-value').innerText(), '40');
      await page.evaluate(() => navigateTo('page5'));
      assert.equal(await page.evaluate(() => document.getElementById('page5').classList.contains('active')), true);
      expectClean(report);
    } finally {
      await context.close();
    }
  });
}

test('خادم الاختبار يرفض أي مسار يتجاوز مجلد المشروع (404) حتى لو كان الملف موجوداً', async () => {
  // ملف حقيقي خارج ROOT: الرفض يجب أن يأتي من التحقق وليس من عدم وجود الملف
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-outside-'));
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsideFile, 'outside-root');
  const rel = path.relative(ROOT, outsideFile).split(path.sep).join('/');
  const attempts = ['/' + rel, '/' + rel.replace(/\.\./g, '%2e%2e'), '/%2e%2e/' + path.basename(outsideDir) + '/secret.txt'];
  try {
    for (const raw of attempts) {
      const status = await new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: server.address().port, path: raw }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
      });
      assert.equal(status, 404, `expected 404 for ${raw}`);
    }
    // تحقق سلبي: المسار الداخلي المشروع يعمل
    const ok = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/index.html' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
    });
    assert.equal(ok, 200);
    assert.equal(server.address().address, '127.0.0.1', 'الخادم مربوط بـ127.0.0.1');
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('الروابط الرمزية: رابط داخل المشروع يشير إلى ملف خارجه يُرفض (404) دون كشف محتواه', async () => {
  // الملف الخارجي موجود فعلاً، والرفض يجب أن يأتي من التحقق من الوجهة الحقيقية
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-outside-'));
  const outsideFile = path.join(outsideDir, 'secret.txt');
  const SECRET = 'SECRET-OUTSIDE-CONTENT-' + Date.now();
  fs.writeFileSync(outsideFile, SECRET);
  const innerDir = fs.mkdtempSync(path.join(ROOT, 'qa-symlink-'));
  const linkFile = path.join(innerDir, 'link.txt');
  const linkDir = path.join(innerDir, 'linked-dir');
  try {
    assert.equal(fs.existsSync(outsideFile), true, 'الملف الخارجي موجود فعلاً');
    fs.symlinkSync(outsideFile, linkFile);
    fs.symlinkSync(outsideDir, linkDir);
    assert.equal(isInsideRoot(fs.realpathSync(linkFile)), false, 'الوجهة الحقيقية خارج المشروع');

    const relOf = (p) => '/' + path.relative(ROOT, p).split(path.sep).join('/');
    for (const raw of [relOf(linkFile), relOf(path.join(linkDir, 'secret.txt'))]) {
      const { status, body } = await getRaw(raw);
      assert.equal(status, 404, `expected 404 for symlink ${raw}`);
      assert.equal(body.includes(SECRET), false, 'لا يُكشف محتوى الملف الخارجي');
    }
  } finally {
    fs.rmSync(innerDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('الروابط الرمزية داخل المشروع تبقى مسموحة، والمسارات التقليدية المرفوضة ما زالت مرفوضة', async () => {
  const innerDir = fs.mkdtempSync(path.join(ROOT, 'qa-symlink-ok-'));
  const target = path.join(ROOT, 'index.html');
  const innerLink = path.join(innerDir, 'page-link.html');
  try {
    fs.symlinkSync(target, innerLink);
    const ok = await getRaw('/' + path.relative(ROOT, innerLink).split(path.sep).join('/'));
    assert.equal(ok.status, 200, 'رابط داخلي مسموح');
    assert.match(ok.body, /<html/i);

    const home = await getRaw('/index.html');
    assert.equal(home.status, 200);
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fpackage.json', '//etc/passwd', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd']) {
      const r = await getRaw(bad);
      assert.notEqual(r.status, 200, `must reject ${bad}`);
    }
  } finally {
    fs.rmSync(innerDir, { recursive: true, force: true });
  }
});

test('تقرير: الطلبات الخارجية المحجوبة (لا تُحسب كخطأ للتطبيق)', async () => {
  const { context, page, report } = await openPage(VIEWPORTS[0]);
  try {
    await page.waitForTimeout(500);
    console.log('blocked external requests/messages:', JSON.stringify([...new Set(report.blockedExternal)]));
    assert.ok(true);
  } finally {
    await context.close();
  }
});
