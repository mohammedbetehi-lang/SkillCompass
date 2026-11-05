'use strict';
// اختبارات readBodyCapped عبر ReadableStream وResponse حقيقيين من Node.js (بلا Mock للدفق).
// لا يُرسل أي طلب حقيقي: fetch هنا يعيد Response محلياً فقط.
const test = require('node:test');
const assert = require('node:assert/strict');

const previous = { key: process.env.OPENROUTER_API_KEY, flag: process.env.AI_TEACHER_DISABLE_REASONING, vercel: process.env.VERCEL_ENV, model: process.env.OPENROUTER_MODEL };
delete process.env.OPENROUTER_MODEL;
process.env.OPENROUTER_API_KEY = 'offline-test-only';
process.env.VERCEL_ENV = 'preview';
const handler = require('./ai-teacher');
const direct = 'كيف أحسب سعر بيع يغطي كل التكاليف؟';

const realFetch = global.fetch;
const realSetTimeout = global.setTimeout;
const logs = [];
const realError = console.error;
console.error = (...a) => logs.push(a.join(' '));

test.after(() => {
  global.fetch = realFetch; global.setTimeout = realSetTimeout; console.error = realError;
  for (const [name, value] of [['OPENROUTER_API_KEY', previous.key], ['AI_TEACHER_DISABLE_REASONING', previous.flag], ['VERCEL_ENV', previous.vercel], ['OPENROUTER_MODEL', previous.model]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
test.beforeEach(() => { logs.length = 0; global.setTimeout = realSetTimeout; });

async function run(fn = handler) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
  await fn({ method: 'POST', body: { skillId: 'ecommerce', lessonId: 4, question: direct } }, res);
  return res;
}
function providerLog() {
  const line = logs.find(l => l.includes('provider_'));
  return line ? JSON.parse(line.slice(line.indexOf('{'))) : null;
}
const enc = new TextEncoder();
// Response حقيقي بجسم ReadableStream حقيقي
function errorResponse(status, chunks, headers = {}) {
  const stream = new ReadableStream({
    start(controller) { for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c); controller.close(); },
  });
  return new Response(stream, { status, headers });
}
// ReadableStream يُعلن أنه مفتوح ولا يُغلق أبداً، ويسجّل الإلغاء
function hangingResponse(status, onCancel) {
  const stream = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel(reason) { onCancel(reason); },
  });
  return new Response(stream, { status });
}

test('real stream: small body under the cap is read and parsed', async () => {
  const body = JSON.stringify({ error: { code: 429, metadata: { error_type: 'rate_limit_exceeded', provider_code: '429' } } });
  global.fetch = async () => errorResponse(429, [body]);
  const r = await run(); assert.equal(r.body.error, 'ai_unavailable');
  const e = providerLog(); assert.equal(e.error_type, 'rate_limit_exceeded'); assert.equal(e.category, 'provider_rate_limit');
});

test('real stream: body of exactly 16384 bytes is accepted', async () => {
  const head = '{"error":{"code":429,"metadata":{"error_type":"rate_limit_exceeded","provider_code":"429"}},"pad":"';
  const tail = '"}';
  const text = head + 'p'.repeat(16384 - Buffer.byteLength(head) - Buffer.byteLength(tail)) + tail;
  assert.equal(Buffer.byteLength(text), 16384);
  global.fetch = async () => errorResponse(429, [text]);
  await run(); assert.equal(providerLog().error_type, 'rate_limit_exceeded');
});

test('real stream: body one byte over the cap is not parsed and the stream is cancelled', async () => {
  const head = '{"error":{"code":429,"metadata":{"error_type":"rate_limit_exceeded"}},"pad":"';
  const tail = '"}';
  const text = head + 'p'.repeat(16385 - Buffer.byteLength(head) - Buffer.byteLength(tail)) + tail;
  assert.equal(Buffer.byteLength(text), 16385);
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) { c.enqueue(enc.encode(text)); c.close(); },
    cancel() { cancelled = true; },
  });
  global.fetch = async () => new Response(stream, { status: 429 });
  const r = await run(); assert.equal(r.body.error, 'ai_unavailable');
  assert.equal(providerLog().error_type, undefined);
  assert.equal(providerLog().category, 'unknown_rate_limit');
});

test('real stream: several consecutive chunks that exceed the cap in total are cancelled', async () => {
  const chunk = new Uint8Array(6000).fill(0x61);
  let pulled = 0; let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulled++; if (pulled <= 10) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  });
  global.fetch = async () => new Response(stream, { status: 429 });
  await run();
  assert.equal(cancelled, true);
  assert.ok(pulled <= 4, `pulled ${pulled} chunks, expected the cap to stop reading early`);
});

test('real stream: several small chunks under the cap are concatenated and parsed', async () => {
  const body = JSON.stringify({ error: { code: 503, metadata: { error_type: 'provider_unavailable', provider_name: 'Novita' } } });
  const parts = [];
  for (let i = 0; i < body.length; i += 7) parts.push(body.slice(i, i + 7));
  global.fetch = async () => errorResponse(503, parts);
  await run(); const e = providerLog();
  assert.equal(e.error_type, 'provider_unavailable'); assert.equal(e.provider_name, 'Novita'); assert.equal(e.category, 'provider_capacity');
});

test('real stream: read error mid-stream is handled without throwing and returns the fallback', async () => {
  const stream = new ReadableStream({
    start(c) { c.enqueue(enc.encode('{"error":')); },
    pull(c) { c.error(new Error('socket reset')); },
  });
  global.fetch = async () => new Response(stream, { status: 502 });
  const r = await run();
  assert.equal(r.statusCode, 502); assert.equal(r.body.error, 'ai_unavailable');
  assert.equal(providerLog().category, 'provider_capacity');
});

// fetch الحقيقي يُلغي جسم الرد عند إلغاء signal الطلب. نحاكي ذلك بربط الـsignal بالـStream نفسه.
function bodyBoundToSignal(signal, onCancel) {
  return new ReadableStream({
    start(controller) {
      const abort = () => { const err = new Error('aborted'); controller.error(err); onCancel(); };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    },
  });
}

test('real stream: abort via timeout errors the body stream and yields ai_timeout without hanging', async () => {
  let cancelled = false;
  global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, 5, ...args);
  global.fetch = async (_u, opts) => new Response(bodyBoundToSignal(opts.signal, () => { cancelled = true; }), { status: 429 });
  const started = Date.now();
  const r = await run();
  assert.equal(r.statusCode, 504); assert.equal(r.body.error, 'ai_timeout');
  assert.ok(Date.now() - started < 5000, 'must not hang');
  assert.equal(cancelled, true);
});

test('real stream: a signal already aborted before the body is read yields ai_timeout', async () => {
  global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, 1, ...args);
  global.fetch = async (_u, opts) => {
    // مهلة قصيرة تنتهي قبل أن يقرأ الكود الجسم: نحاكي تأخر الجسم بعد الرؤوس.
    await new Promise(r => realSetTimeout(r, 20));
    return new Response(bodyBoundToSignal(opts.signal, () => {}), { status: 500 });
  };
  const r = await run();
  assert.equal(r.statusCode, 504); assert.equal(r.body.error, 'ai_timeout');
});
