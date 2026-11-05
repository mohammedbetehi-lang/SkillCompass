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
test('classifier request is unaffected by tutor flag', async () => {
  process.env.AI_TEACHER_DISABLE_REASONING='true'; global.fetch=async (_url,opts)=>{ calls.push(opts); return reply({choices:[{message:{content:JSON.stringify({in_scope:false,reason:'out'})}}]}); };
  const r=await run('ما عاصمة اليابان؟'); assert.equal(r.body.allowed,false); assert.equal(calls.length,1);
  const body=JSON.parse(calls[0].body); assert.equal(body.reasoning,undefined); assert.equal(body.max_tokens,80); assert.equal(calls[0].signal,undefined);
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
for (const reason of ['length',null,'content_filter']) test(`non-normal finish ${reason} is not presented as a complete answer`, async () => {
  global.fetch=async (_url,opts)=>{calls.push(opts); return reply(completion(reason));};
  const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'incomplete_generation'); assert.equal(r.body.answer,undefined);
});
test('normal finish is accepted with the actual answer', async () => {
  const r=await run(direct); assert.equal(r.body.allowed,true); assert.equal(r.body.answer,'إجابة تعليمية تجريبية');
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

// ── تشخيص أخطاء المزوّد: حقول موثقة فقط، بحدود قراءة، بلا تسريب ──
function parsedLog(logged){ const line=logged.find(l=>l.includes('provider_')); return JSON.parse(line.slice(line.indexOf('{'))); }
test('HTTP 429 logs documented metadata and Retry-After, never message or raw payload', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  const body={error:{code:429,message:'PRIVATE MESSAGE '+direct,metadata:{error_type:'rate_limit_exceeded',provider_code:'429',provider_name:'DeepInfra',raw:'SECRET RAW',flagged_input:'PRIVATE FLAG'}}};
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:429,headers:new Map([['retry-after','30']]),text:async()=>JSON.stringify(body)};};
  try {
    const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'ai_unavailable');
    const e=parsedLog(logged);
    assert.equal(e.http_status,429); assert.equal(e.error_code,429); assert.equal(e.error_type,'rate_limit_exceeded');
    assert.equal(e.provider_code,'429'); assert.equal(e.provider_name,'DeepInfra'); assert.equal(e.retry_after,'30'); assert.equal(e.category,'rate_limit');
    assert.doesNotMatch(logged[0],/PRIVATE|SECRET|offline-test-only/); assert.equal(logged[0].includes(direct),false);
    assert.equal(r.body.provider_name,undefined);
  } finally {console.error=realError;}
});
for (const [status, limit_source, category] of [[402,undefined,'insufficient_credits'],[402,'openrouter_in_flight_budget','budget_limit']]) {
  test(`402 classified as ${category}`, async () => {
    const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
    const md=limit_source?{limit_source}:{};
    global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status,text:async()=>JSON.stringify({error:{code:402,message:'x',metadata:md}})};};
    try { const r=await run(direct); assert.equal(r.body.error,'ai_unavailable'); assert.equal(parsedLog(logged).category,category); }
    finally {console.error=realError;}
  });
}
test('invalid JSON error body logs only status and never throws', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:502,text:async()=>'<html>PRIVATE gateway page</html>'};};
  try { const r=await run(direct); assert.equal(r.statusCode,502); const e=parsedLog(logged); assert.equal(e.http_status,502); assert.equal(e.error_type,undefined); assert.doesNotMatch(logged[0],/PRIVATE/); }
  finally {console.error=realError;}
});
test('oversized error body is not parsed or logged', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  const big=JSON.stringify({error:{code:429,message:'A'.repeat(20000),metadata:{error_type:'rate_limit_exceeded'}}});
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:429,text:async()=>big};};
  try { const r=await run(direct); assert.equal(r.statusCode,502); const e=parsedLog(logged); assert.equal(e.error_type,undefined); assert.equal(e.category,'rate_limit'); assert.doesNotMatch(logged[0],/AAAA/); }
  finally {console.error=realError;}
});
test('streamed error body is read up to the cap and then cancelled', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  let cancelled=false; let pulls=0; const enc=new TextEncoder();
  const chunk=enc.encode('x'.repeat(4096));
  const body={getReader(){return {read:async()=>{pulls++; return {done:false,value:chunk};}, cancel:async()=>{cancelled=true;}};}};
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:429,body};};
  try { const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(cancelled,true); assert.ok(pulls<=6); assert.equal(parsedLog(logged).category,'rate_limit'); }
  finally {console.error=realError;}
});
test('streamed small error body is parsed through the stream reader', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  const enc=new TextEncoder(); const bytes=enc.encode(JSON.stringify({error:{code:503,metadata:{error_type:'provider_unavailable',provider_name:'Novita'}}}));
  let sent=false; const body={getReader(){return {read:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes}), cancel:async()=>{}};}};
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:503,body};};
  try { await run(direct); const e=parsedLog(logged); assert.equal(e.error_type,'provider_unavailable'); assert.equal(e.provider_name,'Novita'); assert.equal(e.category,'provider_capacity'); }
  finally {console.error=realError;}
});
test('hostile metadata values are sanitized before logging', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  const evil={error:{code:'NaN',metadata:{error_type:'x"}\n<script>'+'a'.repeat(100),provider_code:{nested:'SECRET'},provider_name:'Deep\nInfra'}}};
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:429,text:async()=>JSON.stringify(evil)};};
  try { await run(direct); const e=parsedLog(logged); assert.equal(e.error_code,undefined); assert.match(e.error_type,/^[A-Za-z0-9._:\-]{1,40}$/); assert.equal(e.error_type.length,40); assert.equal(e.provider_code,undefined); assert.equal(e.provider_name,'DeepInfra'); assert.doesNotMatch(logged[0],/SECRET|<script>/); }
  finally {console.error=realError;}
});
