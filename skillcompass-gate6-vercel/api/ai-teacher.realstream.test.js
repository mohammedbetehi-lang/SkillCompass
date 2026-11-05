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
// يرصد استدعاءات reader.read() و reader.cancel() التي ينفّذها الكود المختبَر على Stream حقيقي.
function spyOnReads(stream) {
  const counts = { reads: 0, cancels: 0 };
  const getReader = stream.getReader.bind(stream);
  stream.getReader = (...args) => {
    const reader = getReader(...args);
    const read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
    reader.read = (...a) => { counts.reads++; return read(...a); };
    reader.cancel = (...a) => { counts.cancels++; return cancel(...a); };
    return reader;
  };
  return counts;
}
// Response حقيقي بجسم ReadableStream حقيقي
function errorResponse(status, chunks, headers = {}) {
  const stream = new ReadableStream({
    start(controller) { for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c); controller.close(); },
  });
  return new Response(stream, { status, headers });
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

test('real stream: body one byte over the cap is not parsed and the code cancels the open stream', async () => {
  const head = '{"error":{"code":429,"metadata":{"error_type":"rate_limit_exceeded"}},"pad":"';
  const tail = '"}';
  const text = head + 'p'.repeat(16385 - Buffer.byteLength(head) - Buffer.byteLength(tail)) + tail;
  const bytes = enc.encode(text);
  assert.equal(bytes.byteLength, 16385);
  // chunk أولى دون الحد، والثانية تتجاوزه. الـStream لا يُغلق، فالإلغاء قابل للرصد.
  const parts = [bytes.subarray(0, 16000), bytes.subarray(16000)];
  let pulls = 0; let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulls++; if (pulls <= parts.length) controller.enqueue(parts[pulls - 1]); },
    cancel() { cancelled = true; },
  });
  const counts = spyOnReads(stream);
  global.fetch = async () => new Response(stream, { status: 429 });
  // حارس: إن لم يتوقف الكود عن القراءة يفشل الاختبار بوضوح بدل أن يعلّق.
  const guard = new Promise((_, rej) => realSetTimeout(() => rej(new Error('reader was never stopped')), 2000));
  const r = await Promise.race([run(), guard]); assert.equal(r.body.error, 'ai_unavailable');
  assert.equal(cancelled, true, 'the code under test must cancel the real stream');
  assert.equal(counts.reads, 2, 'reading must stop right after the chunk that exceeds the cap');
  assert.equal(providerLog().error_type, undefined);
  assert.equal(providerLog().category, 'unknown_rate_limit');
});

test('real stream: several consecutive chunks that exceed the cap in total are cancelled', async () => {
  const chunk = new Uint8Array(6000).fill(0x61);
  let produced = 0; let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { produced++; if (produced <= 10) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  });
  const counts = spyOnReads(stream);
  global.fetch = async () => new Response(stream, { status: 429 });
  await run();
  assert.equal(cancelled, true);
  assert.equal(counts.reads, 3, `reads: ${counts.reads}; expected 3 (6000, 12000, then 18000 exceeds 16384)`);
  assert.equal(counts.cancels, 1);
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

// fetch الحقيقي يُلغي جسم الرد عند إلغاء signal الطلب. نحاكي ذلك بإنهاء الـStream بخطأ عند abort.
// لا يُضبط أي مؤشر إلغاء هنا: الإلغاء يُنسب فقط إلى استدعاءات الكود المختبَر (reader.cancel) عبر spyOnReads.
function bodyBoundToSignal(signal) {
  return new ReadableStream({
    start(controller) {
      const abort = () => controller.error(new Error('aborted'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    },
  });
}

test('real stream: abort via timeout errors the body, the code cancels its reader, and yields ai_timeout', async () => {
  global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, 5, ...args);
  let counts;
  global.fetch = async (_u, opts) => { const stream = bodyBoundToSignal(opts.signal); counts = spyOnReads(stream); return new Response(stream, { status: 429 }); };
  const started = Date.now();
  const r = await run();
  assert.equal(r.statusCode, 504); assert.equal(r.body.error, 'ai_timeout');
  assert.ok(Date.now() - started < 5000, 'must not hang');
  assert.equal(counts.cancels, 1, 'readBodyCapped must cancel its reader after the abort');
});

test('real stream: abort while headers are pending, body is created already aborted, yields ai_timeout', async () => {
  global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, 1, ...args);
  global.fetch = async (_u, opts) => {
    // مهلة قصيرة تنتهي قبل أن يقرأ الكود الجسم: نحاكي تأخر الجسم بعد الرؤوس.
    await new Promise(r => realSetTimeout(r, 20));
    return new Response(bodyBoundToSignal(opts.signal), { status: 500 });
  };
  const r = await run();
  assert.equal(r.statusCode, 504); assert.equal(r.body.error, 'ai_timeout');
});
