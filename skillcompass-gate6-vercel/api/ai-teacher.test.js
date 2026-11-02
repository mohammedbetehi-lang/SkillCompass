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
test('non-success provider HTTP logs only safe metadata, never the response body or question', async () => {
  const realError=console.error, logged=[]; console.error=(...args)=>logged.push(args.join(' '));
  let bodyRead=false;
  global.fetch=async (_url,opts)=>{calls.push(opts); return {ok:false,status:429,text:async()=>{bodyRead=true;return 'RAW_RESPONSE_SECRET '+direct;}};};
  try {
    const r=await run(direct); assert.equal(r.statusCode,502); assert.equal(r.body.error,'ai_unavailable');
    assert.equal(bodyRead,false); assert.equal(logged.length,1); assert.match(logged[0],/provider_http_error/); assert.match(logged[0],/429/);
    assert.doesNotMatch(logged[0],/RAW_RESPONSE_SECRET|offline-test-only/); assert.equal(logged[0].includes(direct),false);
  } finally {console.error=realError;}
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
