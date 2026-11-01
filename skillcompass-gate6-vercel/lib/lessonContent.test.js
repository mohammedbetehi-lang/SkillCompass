const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LESSON_CONTENT,
  resolveLessonContent,
  buildLessonContext
} = require('./lessonContent');

test('server curriculum contains all 32 lessons across four tracks', () => {
  const counts = Object.fromEntries(
    Object.entries(LESSON_CONTENT).map(([skillId, lessons]) => [skillId, Object.keys(lessons).length])
  );
  assert.deepEqual(counts, {
    ecommerce: 8,
    marketing: 8,
    project: 8,
    finance: 8
  });
});

test('every lesson has a title and substantive lesson content', () => {
  for (const [skillId, lessons] of Object.entries(LESSON_CONTENT)) {
    for (const [lessonId, lesson] of Object.entries(lessons)) {
      assert.ok(lesson.title, `missing title: ${skillId}:${lessonId}`);
      assert.ok(lesson.content.length >= 500, `content too short: ${skillId}:${lessonId}`);
    }
  }
});

test('lesson resolver rejects unknown tracks and lesson numbers', () => {
  assert.equal(resolveLessonContent('unknown', 1), null);
  assert.equal(resolveLessonContent('ecommerce', 99), null);
  assert.equal(resolveLessonContent('ecommerce', 4).title, 'التكلفة والتسعير');
});

test('built context contains the selected lesson title, goal, and content', () => {
  const context = buildLessonContext('finance', 6);
  assert.match(context, /الأهداف المالية/);
  assert.match(context, /هدف\/وصف الدرس/);
  assert.match(context, /محتوى الدرس/);
  assert.match(context, /SMART|ذكي/);
});

test('lesson content is selected by the requested lesson, not a client supplied text', () => {
  const ecommerce = buildLessonContext('ecommerce', 4);
  const marketing = buildLessonContext('marketing', 2);
  assert.match(ecommerce, /التكلفة والتسعير/);
  assert.match(marketing, /الجمهور المستهدف/);
  assert.doesNotMatch(ecommerce, /الجمهور المستهدف/);
});
