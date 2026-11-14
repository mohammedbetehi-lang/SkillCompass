'use strict';

// Smoke tests against the branch Preview deployment only.
// The deployed function reads its OpenRouter key server-side; this script never reads or sends that key.
const base = process.env.AI_TEACHER_PREVIEW_URL;
if (!base) throw new Error('AI_TEACHER_PREVIEW_URL is required');

const parsedBase = new URL(base);
if (parsedBase.protocol !== 'https:' || !parsedBase.hostname.endsWith('.vercel.app')) {
  throw new Error('Preview URL must be an HTTPS *.vercel.app URL');
}

const headers = { 'content-type': 'application/json' };
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options = {}) {
  const response = await fetch(new URL(path, parsedBase), {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
    redirect: 'manual',
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const error = new Error('Expected JSON from ' + path + '; HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForPreview() {
  let lastStatus = 'no response';
  for (let attempt = 0; attempt < 36; attempt++) {
    try {
      const result = await request('/api/ai-teacher');
      if (result.status === 405 && /POST/.test(result.body.error || '')) return true;
      lastStatus = 'HTTP ' + result.status;
    } catch (error) {
      lastStatus = error.message;
      if (!process.env.VERCEL_AUTOMATION_BYPASS_SECRET && [302, 401, 403].includes(error.status)) {
        console.warn('SKIP: Preview is protected by Vercel Authentication. Add VERCEL_AUTOMATION_BYPASS_SECRET to GitHub Actions Secrets to run POST smoke tests.');
        return false;
      }
    }
    await sleep(5000);
  }
  throw new Error('Preview API did not become ready within 3 minutes: ' + lastStatus);
}

async function main() {
  const ready = await waitForPreview();
  if (!ready) return;

  // Method guard: this route is POST-only.
  const method = await request('/api/ai-teacher');
  assert(method.status === 405, 'GET should return 405, got ' + method.status);
  assert(/POST/.test(method.body.error || ''), '405 response should explain that POST is required');
  console.log('PASS API method guard (GET to POST-only route returns 405)');

  // Input validation must reject an unknown skill before calling any model.
  const invalid = await request('/api/ai-teacher', {
    method: 'POST',
    body: JSON.stringify({
      skillId: '__proto__',
      lessonId: 1,
      question: 'اختبار تحقق من المدخلات',
    }),
  });
  assert(invalid.status === 400, 'invalid skill should return 400, got ' + invalid.status);
  console.log('PASS API input validation (unknown skill returns 400)');

  // Exact direct lesson concept: it should pass scope validation and reach the tutor model.
  const inScope = await request('/api/ai-teacher', {
    method: 'POST',
    body: JSON.stringify({
      skillId: 'ecommerce',
      lessonId: 4,
      question: 'كيف أحسب سعر بيع يغطي كل التكاليف؟',
    }),
  });
  assert(inScope.status === 200, 'in-scope question should return 200, got ' + inScope.status);
  assert(inScope.body.allowed === true, 'in-scope question should be allowed');
  assert(typeof inScope.body.answer === 'string' && inScope.body.answer.trim().length >= 20, 'tutor should return a non-empty answer');
  assert(inScope.body.fallback !== true, 'tutor should return a real model answer, not the fallback');
  console.log('PASS AI Teacher in-scope request (HTTP 200, answer length ' + inScope.body.answer.length + ')');

  // Out-of-scope question: it must be denied by the Scope Guard, not answered by the tutor.
  const outOfScope = await request('/api/ai-teacher', {
    method: 'POST',
    body: JSON.stringify({
      skillId: 'ecommerce',
      lessonId: 4,
      question: 'ما عاصمة اليابان؟',
    }),
  });
  assert(outOfScope.status === 200, 'out-of-scope request should return 200 with a denial, got ' + outOfScope.status);
  assert(outOfScope.body.allowed === false, 'out-of-scope question must be denied');
  assert(typeof outOfScope.body.message === 'string' && outOfScope.body.message.trim().length > 0, 'denial message should be present');
  assert(outOfScope.body.answer === undefined, 'the tutor must not answer an out-of-scope request');
  console.log('PASS AI Teacher scope guard (off-topic question denied without tutor answer)');
}

main().catch((error) => {
  console.error('AI Teacher Preview smoke test failed:', error.message);
  process.exitCode = 1;
});
