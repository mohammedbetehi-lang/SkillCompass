'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const previous = { key:process.env.OPENROUTER_API_KEY, flag:process.env.AI_TEACHER_DISABLE_REASONING, model:process.env.OPENROUTER_MODEL, vercel:process.env.VERCEL_ENV };
delete process.env.OPENROUTER_MODEL;
process.env.OPENROUTER_API_KEY = 'offline-test-only';
process.env.VERCEL_ENV = 'preview';
const handler = require('./ai-teacher');
const direct = 'كيف أحسب سعر بيع يغطي كل التكاليف؟';
const realFetch = global.fetch, realSetTimeout = global.setTimeout, realNow = Date.now;
const calls = [];
function reply(json) { return { ok:true, status:200, json:async()=>json }; }
function completion(finish = 'stop') { return {choices:[{finish_reason:finish,message:{content:'إجابة تعليمية تجريبية'}}]}; }
async function run(question, fn = handler) {
  const res = { statusCode:200, status(n){this.statusCode=n;return this}, json(v){this.body=v;return this} };
  await fn({method:'POST',body:{skillId:'ecommerce',lessonId:4,question}},res); return res;
}
test.after(() => {
  global.fetch=realFetch; global.setTimeout=realSetTimeout; Date.now=realNow;
  for (const [name,value] of [['OPENROUTER_API_KEY',previous.key],['AI_TEACHER_DISABLE_REASONING',previous.flag],['OPENROUTER_MODEL',previous.model],['VERCEL_ENV',previous.vercel]]) {
    if(value===undefined) delete process.env[name]; else process.env[name]=value;
  }
});
test.beforeEach(() => {
  calls.length=0; global.setTimeout=realSetTimeout; Date.now=realNow; process.env.VERCEL_ENV='preview';
  global.fetch=async (_url,opts) => {calls.push(opts); return reply(completion());};
});
test('Preview opt-in applies only to Qwen 3.7 tutor request', async () => {
  process.env.AI_TEACHER_DISABLE_REASONING='true'; const r=await run(direct); assert.equal(r.body.allowed,true); assert.equal(calls.length,1);
  const body=JSON.parse(calls[0].body); assert.deepEqual(body.reasoning,{enabled:false}); assert.equal(body.max_tokens,1024); assert.ok(calls[0].signal);
});
test('classifier request is unaffected by tutor flag but shares the request budget signal', async () => {
  process.env.AI_TEACHER_DISABLE_REASONING='true'; global.fetch=async (_url,opts)=>{ calls.push(opts); return reply({choices:[{message:{content:JSON.stringify({in_scope:false,reason:'out'})}}]}); };
  const r=await run('ما عاصمة اليابان؟'); assert.equal(r.body.allowed,false); assert.equal(calls.length,1);
  const body=JSON.parse(calls[0].body); assert.equal(body.reasoning,undefined); assert.equal(body.max_tokens,80); assert.ok(calls[0].signal,'classifier must be bound to the request budget');
});
for (const flag of [undefined,'not-valid']) test(`missing/invalid flag ${flag} preserves prior tutor options`, async () => {
  if(flag===undefined) delete process.env.AI_TEACHER_DISABLE_REASONING; else process.env.AI_TEACHER_DISABLE_REASONING=flag;
  await run(direct); const body=JSON.parse(calls[0].body); assert.deepEqual(body.reasoning,{effort:'low'}); assert.equal(body.max_tokens,8192);
});
test('aborted tutor is a timeout regardless of exception name', async () => {
  process.env.AI_TEACHER_DISABLE_REASONING='true'; global.setTimeout=(fn,ms,...args)=>realSetTimeout(fn,1,...args);
  global.fetch=async (_url,opts)=>{calls.push(opts); return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('other error name')); if(opts.signal.aborted) abort(); else opts.signal.addEventListener('abort',abort,{once:true});});};
  const r=await run(direct); assert.equal(calls.length,1); assert.equal(r.statusCode,504); assert.equal(r.body.error,'ai_timeout'); assert.equal(r.body.allowed,undefined);
});
test('insufficient remaining time does not send tutor or any other request', async () => {
  let n=0; Date.now=()=>++n===1 ? 1000 : 24001;
  const r=await run(direct); assert.equal(r.statusCode,504); assert.equal(r.body.error,'ai_timeout'); assert.equal(calls.length,0);
});
test('a different tutor model is not given disabled reasoning', async () => {
  process.env.AI_TEACHER_DISABLE_REASONING='true'; process.env.OPENROUTER_MODEL='other/provider-model';
  delete require.cache[require.resolve('./ai-teacher')]; const otherHandler=require('./ai-teacher');
  const r=await run(direct,otherHandler); assert.equal(r.body.allowed,true); const body=JSON.parse(calls[0].body);
  assert.equal(body.model,'other/provider-model'); assert.deepEqual(body.reasoning,{effort:'low'}); assert.equal(body.max_tokens,8192);
  delete process.env.OPENROUTER_MODEL;
});
for (const reason of ['length','content_filter','tool_calls']) test(`non-normal finish ${reason} is not presented as a complete answer`, async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply(completion(reason));};
  const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'incomplete_generation'); assert.equal(r.body.answer,undefined);
});
test('normal finish is accepted with the actual answer', async () => {
  const r=await run(direct); assert.equal(r.body.allowed,true); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
});
// ── سياسة finish_reason ──
test('finish_reason null with non-empty content is accepted and logged as missing', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_url,opts)=>{calls.push(opts); return reply(completion(null));};
    const r=await run(direct); assert.equal(r.statusCode,200); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
    assert.ok(logged.some(l=>l.includes('finish_reason_missing')), 'missing finish_reason must be logged');
  });
});
test('finish_reason field absent with non-empty content is accepted', async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply({choices:[{message:{content:'إجابة تعليمية تجريبية'}}]});};
  const r=await run(direct); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
});
test('finish_reason null with empty content returns the safe fallback, not a complete answer', async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply({choices:[{finish_reason:null,message:{content:''}}]});};
  const r=await run(direct); assert.equal(r.body.fallback,true); assert.match(r.body.answer,/مشغول/);
});
// ── حماية الاقتطاع عند غياب finish_reason: completion_tokens مقارنةً بـmax_tokens ──
const noFinish = (usage, extra = {}) => reply({choices:[{message:{content:'إجابة تعليمية تجريبية'}, ...extra}], ...(usage === undefined ? {} : {usage})});
function defaultTutorMode(){ delete process.env.AI_TEACHER_DISABLE_REASONING; }
test('missing finish_reason with completion_tokens exactly equal to max_tokens is rejected as truncated', async () => {
  defaultTutorMode();
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({completion_tokens:8192});};
    const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'incomplete_generation'); assert.equal(r.body.answer,undefined);
    const line=logged.find(l=>l.includes('incomplete_generation')); assert.ok(line,'rejection must be logged');
    assert.ok(line.includes('"completion_tokens":8192') && line.includes('"max_tokens":8192'));
  });
});
test('missing finish_reason with completion_tokens one below max_tokens is accepted and logged', async () => {
  defaultTutorMode();
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({completion_tokens:8191});};
    const r=await run(direct); assert.equal(r.statusCode,200); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
    const line=logged.find(l=>l.includes('finish_reason_missing')); assert.ok(line,'missing finish_reason must be logged');
    assert.ok(line.includes('"usage_available":true') && line.includes('"completion_tokens":8191'));
  });
});
test('missing finish_reason with completion_tokens above max_tokens is rejected', async () => {
  defaultTutorMode();
  global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({completion_tokens:8193});};
  const r=await run(direct); assert.equal(r.body.error,'incomplete_generation'); assert.equal(r.body.answer,undefined);
});
test('null finish_reason with completion_tokens equal to max_tokens is rejected', async () => {
  defaultTutorMode();
  global.fetch=async (_u,opts)=>{calls.push(opts); return reply({choices:[{finish_reason:null,message:{content:'إجابة تعليمية تجريبية'}}],usage:{completion_tokens:8192}});};
  const r=await run(direct); assert.equal(r.body.error,'incomplete_generation'); assert.equal(r.body.answer,undefined);
});
test('missing finish_reason without usage is accepted but logged as usage unavailable', async () => {
  defaultTutorMode();
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish(undefined);};
    const r=await run(direct); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
    const line=logged.find(l=>l.includes('finish_reason_missing')); assert.ok(line);
    assert.ok(line.includes('"usage_available":false') && line.includes('"completion_tokens":null'), 'must not claim completeness');
  });
});
test('missing finish_reason with usage lacking completion_tokens is accepted as unavailable', async () => {
  defaultTutorMode();
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({prompt_tokens:10});};
    const r=await run(direct); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
    assert.ok(logged.some(l=>l.includes('"usage_available":false')));
  });
});
test('non-numeric completion_tokens is treated as unavailable, not compared', async () => {
  defaultTutorMode();
  global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({completion_tokens:'9000'});};
  const r=await run(direct); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
});
test('a stop finish_reason is never subject to the token-limit check', async () => {
  defaultTutorMode();
  global.fetch=async (_u,opts)=>{calls.push(opts); return reply({choices:[{finish_reason:'stop',message:{content:'إجابة تعليمية تجريبية'}}],usage:{completion_tokens:8192}});};
  const r=await run(direct); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
});
test('reasoning-disabled preview uses max_tokens 1024 as the truncation threshold', async () => {
  process.env.AI_TEACHER_DISABLE_REASONING='true';
  global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({completion_tokens:1024});};
  const r=await run(direct); assert.equal(JSON.parse(calls[0].body).max_tokens,1024); assert.equal(r.body.error,'incomplete_generation');
  global.fetch=async (_u,opts)=>{calls.push(opts); return noFinish({completion_tokens:1023});};
  const r2=await run(direct); assert.equal(r2.body.answer,'إجابة تعليمية تجريبية');
  defaultTutorMode();
});
test('finish_reason length never exposes partial text', async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply({choices:[{finish_reason:'length',message:{content:'نص مقطوع'}}]});};
  const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'incomplete_generation'); assert.equal(r.body.answer,undefined);
});
test('unknown string finish_reason is rejected and its logged value is sanitized', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_url,opts)=>{calls.push(opts); return reply({choices:[{finish_reason:'bad<<ZZ>>',message:{content:'نص'}}]});};
    const r=await run(direct); assert.equal(r.body.error,'incomplete_generation');
    const line=logged.find(l=>l.includes('incomplete_generation')); assert.ok(line,'rejection must be logged');
    assert.ok(line.includes('"finish_reason":"badZZ"'), 'only the sanitized token is logged');
    assert.equal(line.includes('<'), false);
  });
});
// ── ميزانية مشتركة للمصنّف والمعلم ──
test('classifier that never answers is aborted by the shared budget: ai_timeout, no tutor call', async () => {
  global.setTimeout=(fn,ms,...args)=>realSetTimeout(fn,1,...args);
  global.fetch=async (_url,opts)=>{calls.push(opts); return new Promise((_,rej)=>{const ab=()=>rej(new Error('aborted')); if(opts.signal.aborted) ab(); else opts.signal.addEventListener('abort',ab,{once:true});});};
  const r=await run('اشرح الفكرة من فضلك');
  assert.equal(r.statusCode,504); assert.equal(r.body.error,'ai_timeout'); assert.equal(r.body.allowed,undefined); assert.equal(calls.length,1);
});
test('classifier and tutor share one budget signal', async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); const body=JSON.parse(opts.body);
    if (body.max_tokens===80) return reply({choices:[{message:{content:JSON.stringify({in_scope:true,reason:'ok'})}}]});
    return reply(completion());};
  const r=await run('اشرح الفكرة من فضلك'); assert.equal(r.body.allowed,true); assert.equal(calls.length,2);
  assert.ok(calls[0].signal); assert.strictEqual(calls[0].signal, calls[1].signal);
});
test('the budget timer is cleared on success and on the failure path', async () => {
  const handles=[], cleared=[]; const realClear=global.clearTimeout;
  global.setTimeout=(fn,ms,...a)=>{const h=realSetTimeout(fn,ms,...a); handles.push(h); return h;};
  global.clearTimeout=(h)=>{cleared.push(h); return realClear(h);};
  try {
    await run(direct);
    global.fetch=async()=>{throw new Error('offline simulated network failure');};
    await run(direct);
    assert.ok(handles.length>=2, 'each request arms a budget timer');
    for (const h of handles) assert.ok(cleared.includes(h), 'every budget timer must be cleared');
  } finally {
    global.clearTimeout=realClear; global.setTimeout=realSetTimeout;
  }
});
test('timeout is rendered as an error and does not complete a lesson', async () => {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  const fn=html.slice(html.indexOf('async function askAiTeacher()'), html.indexOf('\nfunction completeCurrentLesson()',html.indexOf('async function askAiTeacher()')));
  const display={textContent:'',classList:{add(){}}}; const input={value:direct}; const progress={completedLessons:[]};
  const context={isQuizActive:false,document:{getElementById:id=>id==='ai-teacher-question'?input:display},SKILL_DATABASE:{ecommerce:{lessons:[{id:4}]}},userProfile:{skill:'ecommerce'},currentLessonIndex:0,window:{activeSimContext:null},userProgress:progress,fetch:async()=>({json:async()=>({error:'ai_timeout'})})};
  vm.createContext(context); vm.runInContext(fn,context); await context.askAiTeacher();
  assert.match(display.textContent,/انتهت مهلة/); assert.deepEqual(progress.completedLessons,[]);
});
test('classifier finishing late never triggers a tutor request', async () => {
  let time=1000; Date.now=()=>time;
  global.fetch=async (_url,opts)=>{ calls.push(opts); time=24001; return reply({choices:[{message:{content:JSON.stringify({in_scope:true})}}]}); };
  const r=await run('اشرح الفكرة من فضلك'); assert.equal(calls.length,1); assert.equal(JSON.parse(calls[0].body).max_tokens,80); assert.equal(r.body.error,'ai_timeout');
});
test('network failures without an aborted signal remain server errors', async () => {
  global.fetch=async ()=>{throw new Error('offline simulated network failure');};
  const r=await run(direct); assert.equal(r.statusCode,500); assert.equal(r.body.error,'server_error');
});
test('Production never disables reasoning even with the opt-in flag', async () => {
  process.env.VERCEL_ENV='production'; process.env.AI_TEACHER_DISABLE_REASONING='true';
  const r=await run(direct); const body=JSON.parse(calls[0].body);
  assert.equal(r.body.allowed,true); assert.deepEqual(body.reasoning,{effort:'low'}); assert.equal(body.max_tokens,8192);
});
test('HTTP 200 provider error without choices is classified safely', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply({error:{message:'PRIVATE QUESTION AND SECRET SHOULD NOT BE LOGGED', code:'sensitive'}});};
  try {
    const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'provider_error');
    assert.equal(r.body.answer,undefined); assert.equal(logged.length,1); assert.match(logged[0],/provider_error/);
    assert.doesNotMatch(logged[0],/PRIVATE|SECRET|sensitive/);
  } finally { console.error=realError; }
});
test('unexpected provider exception is not logged verbatim', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  global.fetch=async ()=>{throw new Error('RAW_SECRET '+direct+' offline-test-only');};
  try { const r=await run(direct); assert.equal(r.statusCode,500); assert.equal(r.body.error,'server_error');
    assert.equal(logged.length,1); assert.match(logged[0],/tutor_internal_error/); assert.doesNotMatch(logged[0],/RAW_SECRET|offline-test-only/); assert.equal(logged[0].includes(direct),false);
  } finally {console.error=realError;}
});
for (const [status, error, pattern] of [[504,'ai_timeout',/انتهت مهلة/],[502,'provider_error',/مزوّد/],[502,'ai_unavailable',/مزوّد/],[502,'incomplete_generation',/لم تكتمل/]]) {
  test(`UI displays ${error} from HTTP ${status} without completing lesson`, async () => {
    const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
    const fn=html.slice(html.indexOf('async function askAiTeacher()'),html.indexOf('\nfunction completeCurrentLesson()',html.indexOf('async function askAiTeacher()')));
    const display={textContent:'',classList:{add(){}}}, input={value:direct}, progress={completedLessons:[]};
    const context={isQuizActive:false,document:{getElementById:id=>id==='ai-teacher-question'?input:display},SKILL_DATABASE:{ecommerce:{lessons:[{id:4}]}},userProfile:{skill:'ecommerce'},currentLessonIndex:0,window:{activeSimContext:null},userProgress:progress,fetch:async()=>({ok:false,status,json:async()=>({error})})};
    vm.createContext(context); vm.runInContext(fn,context); await context.askAiTeacher();
    assert.match(display.textContent,pattern); assert.deepEqual(progress.completedLessons,[]);
  });
}

test('empty provider answer returns the safe fallback instead of throwing', async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply({choices:[{finish_reason:'stop',message:{content:''}}]});};
  const r=await run(direct); assert.equal(r.statusCode,200); assert.equal(r.body.allowed,true); assert.equal(r.body.fallback,true);
  assert.equal(r.body.debug_id,undefined); assert.match(r.body.answer,/مشغول/);
});
test('tutor system prompt carries the pedagogy rules without changing generation limits', async () => {
  delete process.env.AI_TEACHER_DISABLE_REASONING; await run(direct); const body=JSON.parse(calls[0].body); const sys=body.messages[0].content;
  assert.match(sys,/التكلفة × \(1 \+ الزيادة\)/); assert.match(sys,/التكلفة ÷ \(1 − الهامش\)/);
  assert.match(sys,/الدينار الجزائري/); assert.match(sys,/لا تقدّم نسب رسوم بوابات الدفع/);
  assert.equal(body.max_tokens,8192); assert.deepEqual(body.reasoning,{effort:'low'});
});

// ── تشخيص أخطاء المزوّد: حقول موثقة فقط، قراءة Stream محدودة، بلا تسريب ──
function parsedLog(logged){ const line=logged.find(l=>l.includes('provider_')); return JSON.parse(line.slice(line.indexOf('{'))); }
function streamOf(...parts){
  const enc=new TextEncoder(); let i=0; const state={cancelled:false};
  const body={getReader(){return {read:async()=>{ return i<parts.length?{done:false,value:typeof parts[i]==='string'?enc.encode(parts[i++]):parts[i++]}:{done:true};}, cancel:async()=>{state.cancelled=true;}};}};
  return {body,state};
}
function withLog(fn){ const realError=console.error, logged=[]; console.error=(...a)=>logged.push(a.join(' ')); return fn(logged).finally(()=>{console.error=realError;}); }
function errBody(obj){ return streamOf(JSON.stringify(obj)).body; }

// ── 429: مصدر الخطأ يُستنتج من أدلة كافية فقط، والترويسات بيانات مستقلة ──
test('text()-only response is never read; diagnostics come from status and headers only', async () => {
  await withLog(async (logged) => {
    let textCalled=false;
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after','5']]),text:async()=>{textCalled=true; return JSON.stringify({error:{code:429,metadata:{provider_code:'429',error_type:'rate_limit_exceeded'}}});}};};
    const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(textCalled,false);
    const e=parsedLog(logged); assert.equal(e.retry_after_seconds,5); assert.equal(e.provider_code,undefined); assert.equal(e.category,'unknown_rate_limit');
  });
});
test('429 with all three documented X-RateLimit headers is platform_rate_limit', async () => {
  await withLog(async (logged) => {
    const headers=new Map([['x-ratelimit-limit','20'],['x-ratelimit-remaining','0'],['x-ratelimit-reset','1700000000']]);
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers,body:errBody({error:{code:429,message:'PRIVATE '+direct}})};};
    await run(direct); const e=parsedLog(logged);
    assert.equal(e.category,'platform_rate_limit'); assert.equal(e.ratelimit_limit,'20'); assert.equal(e.ratelimit_remaining,'0'); assert.equal(e.ratelimit_reset,'1700000000');
    assert.doesNotMatch(logged[0],/PRIVATE/);
  });
});
test('a single X-RateLimit header is not conclusive: remaining-only stays unknown_rate_limit', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['x-ratelimit-remaining','0']]),body:errBody({error:{code:429}})};};
    await run(direct); const e=parsedLog(logged);
    assert.equal(e.category,'unknown_rate_limit'); assert.equal(e.ratelimit_remaining,'0'); assert.equal(e.ratelimit_limit,undefined);
  });
});
test('provider_code alone is not conclusive: unknown_rate_limit', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:errBody({error:{code:429,metadata:{provider_code:'429',provider_name:'DeepInfra'}}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.category,'unknown_rate_limit'); assert.equal(e.provider_code,'429');
  });
});
test('provider_code with error_type rate_limit_exceeded is provider_rate_limit; raw payload never logged', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after','30']]),body:errBody({error:{code:429,message:'PRIVATE MSG',metadata:{error_type:'rate_limit_exceeded',provider_code:'429',provider_name:'DeepInfra',raw:'SECRET RAW',flagged_input:'PRIVATE FLAG'}}})};};
    const r=await run(direct); assert.equal(r.body.error,'ai_unavailable'); const e=parsedLog(logged);
    assert.equal(e.category,'provider_rate_limit'); assert.equal(e.error_type,'rate_limit_exceeded'); assert.equal(e.provider_name,'DeepInfra'); assert.equal(e.retry_after_seconds,30);
    assert.doesNotMatch(logged[0],/SECRET|PRIVATE|raw/); assert.equal(r.body.provider_name,undefined);
    assert.equal(calls.length,1);  // لا إعادة محاولة تلقائية
  });
});
test('429 without any evidence is unknown_rate_limit', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:errBody({error:{code:429}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'unknown_rate_limit');
  });
});
test('oversized rate-limit header values are capped to 20 characters', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['x-ratelimit-remaining','9'.repeat(200)]]),body:errBody({})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.ratelimit_remaining.length,20); assert.equal(e.category,'unknown_rate_limit');
  });
});

// ── limit_source: التصنيف يعتمد على القيمة نفسها، والقيم غير المعروفة آمنة ──
const LIMIT_CASES=[
  ['openrouter_in_flight_budget','in_flight_budget'],
  ['openrouter_credits','credits'],
  ['openrouter_key_limit','key_limit'],
  ['openrouter_guardrail_budget','guardrail_budget'],
  ['openrouter_workspace_budget','workspace_budget'],
  ['openrouter_brand_new_limit','unknown_limit_source'],
];
for (const status of [402,403]) for (const [ls,cat] of LIMIT_CASES) {
  test(`limit_source ${ls} with HTTP ${status} -> ${cat}, status logged separately`, async () => {
    await withLog(async (logged) => {
      global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status,body:errBody({error:{code:status,metadata:{limit_source:ls}}})};};
      const r=await run(direct); assert.equal(r.body.error,'ai_unavailable'); const e=parsedLog(logged);
      assert.equal(e.category,cat); assert.equal(e.http_status,status);
    });
  });
}
test('openrouter_key_limit with 403 is key_limit, not auth', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:403,body:errBody({error:{code:403,metadata:{limit_source:'openrouter_key_limit'}}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.category,'key_limit'); assert.notEqual(e.category,'auth_invalid');
  });
});
test('402 without limit_source or documented error_type is unknown_payment_error', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'unknown_payment_error');
  });
});
test('402 with documented error_type payment_required is payment_required', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{error_type:'payment_required'}}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.category,'payment_required'); assert.equal(e.http_status,402);
  });
});
test('402 with a known limit_source keeps limit_source priority over error_type', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{error_type:'payment_required',limit_source:'openrouter_key_limit'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'key_limit');
  });
});
test('402 with unrecognized limit_source is unknown_limit_source, not a payment guess', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{limit_source:'openrouter_mystery'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'unknown_limit_source');
  });
});
test('403 without limit_source or documented error_type is forbidden_other', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:403,body:errBody({error:{code:403}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'forbidden_other');
  });
});

// ── error_type وerror.code: الموثق فقط، والنصي والرقمي منفصلان عن HTTP status ──
for (const [status, et, cat] of [[401,'authentication','auth_invalid'],[402,'payment_required','payment_required'],[403,'permission_denied','permission_denied'],[503,'provider_overloaded','provider_capacity'],[503,'provider_unavailable','provider_capacity'],[504,'timeout','timeout']]) {
  test(`documented error_type ${et} with HTTP ${status} -> ${cat}`, async () => {
    await withLog(async (logged) => {
      global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status,body:errBody({error:{code:status,metadata:{error_type:et}}})};};
      await run(direct); const e=parsedLog(logged); assert.equal(e.category,cat); assert.equal(e.error_type,et);
    });
  });
}
test('undocumented error_type is logged as sanitized text but never given a category', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:500,body:errBody({error:{code:500,metadata:{error_type:'invented_kind_xyz'}}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.error_type,'invented_kind_xyz'); assert.equal(e.category,'other');
  });
});
test('numeric error.code is separate from HTTP status; textual error.code is kept as name', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:429}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.error_code,429); assert.equal(e.http_status,402);
  });
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:500,body:errBody({error:{code:'authentication_failed'}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.error_code,undefined); assert.equal(e.error_code_kind,'text'); assert.equal(e.http_status,500); assert.doesNotMatch(logged[0],/authentication_failed/);
  });
});
test('out-of-range numeric error.code is dropped', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:500,body:errBody({error:{code:9999}})};};
    await run(direct); assert.equal(parsedLog(logged).error_code,undefined);
  });
});

// ── Retry-After: ثواني، HTTP-date، قيم خاطئة وطويلة ──
for (const [raw, expected] of [['120',120],['0',0],['  45  ',45],['1.5',undefined],['-5',undefined],['soon',undefined],['9999999999',undefined],['x'.repeat(200),undefined],['Thu, 05 Nov 2099 00:00:00 GMT',undefined],['Thu, 05 Nov 2026 04:01:30 PST',undefined],['Thu, 05 Nov 2026 99:99:99 GMT',undefined]]) {
  test(`Retry-After ${String(raw).slice(0,30)} -> ${expected}`, async () => {
    await withLog(async (logged) => {
      global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after',raw]]),body:errBody({error:{code:429}})};};
      await run(direct); const e=parsedLog(logged); assert.equal(e.retry_after_seconds,expected);
      if (expected === undefined) {
        // قيمة خاطئة: لا تُسجَّل خاماً مهما كان طولها
        // الفحص على السجل كاملاً. الحاجة غير فارغة، لأن needle فارغ يطابق كل نص ويفشل دائماً.
        const needle = String(raw).trim();
        assert.ok(needle.length > 0, 'needle must not be empty');
        assert.equal(JSON.stringify(logged).includes(needle), false, 'invalid raw Retry-After must not be logged in any line');
      } else {
        // قيمة صالحة: تُسجَّل كرقم، لا كنص
        assert.strictEqual(typeof e.retry_after_seconds, 'number');
      }
    });
  });
}
test('Retry-After as HTTP-date is logged as seconds, the raw date is never logged', async () => {
  await withLog(async (logged) => {
    const future=new Date(Date.now()+90000).toUTCString();
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after',future]]),body:errBody({error:{code:429}})};};
    await run(direct); const e=parsedLog(logged);
    assert.ok(e.retry_after_seconds>=85 && e.retry_after_seconds<=90, String(e.retry_after_seconds));
    assert.doesNotMatch(JSON.stringify(logged),/GMT/);
  });
});
test('invalid Retry-After is omitted and not logged', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after','SOON-ish <b>'.repeat(10)]]),body:errBody({error:{code:429}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.retry_after_seconds,undefined); assert.doesNotMatch(JSON.stringify(logged),/SOON|<b>/);
  });
});
test('unparseable Retry-After with a unique marker: key omitted and marker never logged', async () => {
  await withLog(async (logged) => {
    const marker='RA-MARKER-7f3k';
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after',marker]]),body:errBody({error:{code:429}})};};
    await run(direct); const e=parsedLog(logged);
    assert.equal('retry_after_seconds' in e, false, 'unparseable value must not produce a retry_after_seconds key');
    assert.equal(JSON.stringify(logged).includes(marker), false, 'raw Retry-After must not appear in any log line');
  });
});
test('numeric Retry-After "3" is logged as the number 3, not a string', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after','3']]),body:errBody({error:{code:429}})};};
    await run(direct); const e=parsedLog(logged);
    assert.strictEqual(typeof e.retry_after_seconds, 'number');
    assert.strictEqual(e.retry_after_seconds, 3);
  });
});

// ── Stream: حد 16KB، إلغاء القراءة، مهلة تشمل قراءة الجسم ──
test('body over the 16 KiB cap is cancelled and not parsed', async () => {
  await withLog(async (logged) => {
    const sOver=streamOf(JSON.stringify({error:{code:429,metadata:{error_type:'rate_limit_exceeded',provider_code:'429',provider_name:'X'}},pad:'z'.repeat(16400)}));
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:sOver.body};};
    await run(direct); assert.equal(sOver.state.cancelled,true); assert.equal(parsedLog(logged).error_type,undefined);
  });
});
test('body of exactly 16384 bytes is accepted', async () => {
  await withLog(async (logged) => {
    const head='{"error":{"code":429,"metadata":{"error_type":"rate_limit_exceeded","provider_code":"429"}},"pad":"';
    const tail='"}';
    const padLen=16384-Buffer.byteLength(head)-Buffer.byteLength(tail);
    const text=head+'p'.repeat(padLen)+tail;
    assert.equal(Buffer.byteLength(text),16384);
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:streamOf(text).body};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.error_type,'rate_limit_exceeded'); assert.equal(e.category,'provider_rate_limit');
  });
});
test('streamed error body is read in chunks up to the cap and then cancelled', async () => {
  await withLog(async (logged) => {
    let cancelled=false, pulls=0; const enc=new TextEncoder(); const chunk=enc.encode('x'.repeat(4096));
    const body={getReader(){return {read:async()=>{pulls++; return {done:false,value:chunk};}, cancel:async()=>{cancelled=true;}};}};
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body};};
    await run(direct); assert.equal(cancelled,true); assert.ok(pulls<=5); assert.equal(parsedLog(logged).category,'unknown_rate_limit');
  });
});
test('non-byte chunk is rejected without parsing', async () => {
  await withLog(async (logged) => {
    let cancelled=false;
    const bad={getReader(){return {read:async()=>({done:false,value:'a string chunk'}), cancel:async()=>{cancelled=true;}};}};
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:bad};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.error_type,undefined); assert.equal(cancelled,true);
  });
});
test('timeout while reading the error body yields ai_timeout, not ai_unavailable', async () => {
  const originalSetTimeout = global.setTimeout;
  try {
    await withLog(async (logged) => {
      global.setTimeout=(fn,ms,...args)=>realSetTimeout(fn,1,...args);
      global.fetch=async (_u,opts)=>{calls.push(opts); const sig=opts.signal;
        const body={getReader(){return {read:()=>new Promise((_,rej)=>{ if(sig.aborted) rej(new Error('aborted')); else sig.addEventListener('abort',()=>rej(new Error('aborted')),{once:true}); }), cancel:async()=>{}};}};
        return {ok:false,status:429,body};};
      const r=await run(direct); assert.equal(r.statusCode,504); assert.equal(r.body.error,'ai_timeout'); assert.equal(calls.length,1);
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});
test('hostile metadata values are sanitized before logging', async () => {
  await withLog(async (logged) => {
    const evil={error:{code:'NaN',metadata:{error_type:'x"}\n<script>'+'a'.repeat(100),provider_code:{nested:'SECRET'},provider_name:'Deep\nInfra'}}};
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:errBody(evil)};};
    await run(direct); const e=parsedLog(logged);
    assert.equal(e.error_code,undefined); assert.equal(e.error_code_kind,'text'); assert.doesNotMatch(logged[0],/NaN/);
    assert.match(e.error_type,/^[A-Za-z0-9._:\-]{1,40}$/); assert.equal(e.error_type.length,40);
    assert.equal(e.provider_code,undefined); assert.equal(e.provider_name,'DeepInfra'); assert.doesNotMatch(logged[0],/SECRET|<script>/);
  });
});

// ── أمان عام ──
test('invalid JSON error body logs only status and never throws', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:502,body:streamOf('<html>PRIVATE gateway page</html>').body};};
    const r=await run(direct); assert.equal(r.statusCode,502); const e=parsedLog(logged); assert.equal(e.error_type,undefined); assert.equal(e.category,'provider_capacity'); assert.doesNotMatch(logged[0],/PRIVATE/);
  });
});
test('401 is auth_invalid by status when no other evidence exists', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:401,body:streamOf('{"error":{"code":401}}').body};};
    await run(direct); assert.equal(parsedLog(logged).category,'auth_invalid');
  });
});
test('HTTP 200 provider error logs documented fields only', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return reply({error:{message:'PRIVATE '+direct, code:'sensitive', metadata:{error_type:'provider_unavailable',raw:'SECRET'}}});};
    const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'provider_error');
    assert.doesNotMatch(logged[0],/PRIVATE|SECRET|sensitive/); assert.match(logged[0],/provider_unavailable/);
  });
});

// ── القيم الموروثة من Object.prototype لا تُعامل كتصنيفات ──
const INHERITED_KEYS=['constructor','toString','__proto__','hasOwnProperty','valueOf'];
for (const key of INHERITED_KEYS) {
  test(`inherited limit_source "${key}" is unknown_limit_source, not a prototype value`, async () => {
    await withLog(async (logged) => {
      global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{limit_source:key}}})};};
      await run(direct); const e=parsedLog(logged); assert.equal(e.category,'unknown_limit_source'); assert.equal(typeof e.category,'string');
    });
  });
  test(`inherited error_type "${key}" is not categorized and falls back safely`, async () => {
    await withLog(async (logged) => {
      global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:500,body:errBody({error:{code:500,metadata:{error_type:key}}})};};
      await run(direct); const e=parsedLog(logged); assert.equal(e.category,'other'); assert.equal(typeof e.category,'string');
    });
  });
}
test('inherited error_type "constructor" with HTTP 402 falls back to unknown_payment_error', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{error_type:'constructor'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'unknown_payment_error');
  });
});

// ── ترتيب الأولوية: limit_source معروف > 429 > error_type موثق > limit_source غير معروف > HTTP status ──
test('unknown limit_source combined with documented error_type payment_required -> payment_required', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{error_type:'payment_required',limit_source:'openrouter_mystery'}}})};};
    await run(direct); const e=parsedLog(logged); assert.equal(e.category,'payment_required'); assert.equal(e.limit_source,'openrouter_mystery');
  });
});
test('known limit_source still takes priority over documented payment_required', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:402,body:errBody({error:{code:402,metadata:{error_type:'payment_required',limit_source:'openrouter_credits'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'credits');
  });
});
test('known limit_source takes priority over a 429 rate-limit classification', async () => {
  await withLog(async (logged) => {
    const headers=new Map([['x-ratelimit-limit','1'],['x-ratelimit-remaining','0'],['x-ratelimit-reset','9']]);
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,headers,body:errBody({error:{code:429,metadata:{limit_source:'openrouter_key_limit'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'key_limit');
  });
});
test('unknown limit_source with HTTP 429 is classified as a rate limit, not unknown_limit_source', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:429,body:errBody({error:{code:429,metadata:{limit_source:'openrouter_mystery'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'unknown_rate_limit');
  });
});
test('documented error_type timeout beats unknown limit_source', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:504,body:errBody({error:{code:504,metadata:{error_type:'timeout',limit_source:'openrouter_mystery'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'timeout');
  });
});
test('unknown limit_source with no documented error_type is unknown_limit_source even on HTTP 500', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:500,body:errBody({error:{code:500,metadata:{limit_source:'openrouter_mystery'}}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'unknown_limit_source');
  });
});
test('HTTP status is used only when no metadata signal exists', async () => {
  await withLog(async (logged) => {
    global.fetch=async (_u,opts)=>{calls.push(opts); return {ok:false,status:503,body:errBody({error:{code:503}})};};
    await run(direct); assert.equal(parsedLog(logged).category,'provider_capacity');
  });
});
