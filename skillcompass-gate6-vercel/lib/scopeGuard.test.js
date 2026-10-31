const test = require('node:test');
const assert = require('node:assert/strict');
const { isDirectLessonConcept } = require('./scopeGuard');

const accepted = [
  ['ecommerce', 1, 'كيف أختبر الطلب على منتج قبل شراء مخزون كبير؟'],
  ['ecommerce', 1, 'ما معنى الدروب شيبينغ؟'],
  ['ecommerce', 2, 'كيف أستخدم Google Trends للتحقق من فكرة منتج؟'],
  ['ecommerce', 3, 'كيف أحلل نقاط ضعف المنافسين في متجري؟'],
  ['ecommerce', 4, 'كيف أحسب سعر بيع يغطي كل التكاليف؟'],
  ['ecommerce', 5, 'متى أعيد طلب المخزون قبل أن ينفد؟'],
  ['ecommerce', 6, 'كيف أحسب تكلفة اكتساب العميل CAC؟'],
  ['ecommerce', 7, 'كيف أكتب وصف منتج يقنع العميل بالشراء؟'],
  ['ecommerce', 8, 'ما المؤشرات التي يجب مراقبتها أسبوعيًا لإدارة المتجر؟'],
  ['marketing', 1, 'كيف أقيس نجاح التسويق الرقمي؟'],
  ['marketing', 2, 'كيف أحدد الجمهور المستهدف؟'],
  ['marketing', 3, 'كيف أبني عرض القيمة الفريد؟'],
  ['marketing', 4, 'كيف أضع جدول نشر المحتوى؟'],
  ['marketing', 5, 'كيف أحسن أداء الإعلانات المدفوعة؟'],
  ['marketing', 6, 'كيف أحسن معدل التحويل في صفحة الهبوط؟'],
  ['marketing', 7, 'كيف أحلل نتائج الحملة التسويقية؟'],
  ['marketing', 8, 'كيف أبني استراتيجية تسويق متكاملة؟'],
  ['project', 1, 'ما مراحل دورة حياة المشروع؟'],
  ['project', 2, 'كيف أمنع زحف نطاق المشروع؟'],
  ['project', 3, 'كيف أقسم المشروع إلى مهام باستخدام WBS؟'],
  ['project', 4, 'كيف أحدد المسار الحرج للمشروع؟'],
  ['project', 5, 'كيف أقدر ميزانية المشروع؟'],
  ['project', 6, 'كيف أقيم مخاطر المشروع؟'],
  ['project', 7, 'كيف أتابع تقدم المشروع وأقيس الأداء؟'],
  ['project', 8, 'ما الدروس المستفادة بعد إغلاق المشروع؟'],
  ['finance', 1, 'ما الفرق بين الدخل الإجمالي والدخل الصافي؟'],
  ['finance', 2, 'كيف أطبق قاعدة 50/30/20 في ميزانيتي؟'],
  ['finance', 3, 'كيف أتحكم في المصاريف الصغيرة؟'],
  ['finance', 4, 'كيف أبني صندوق طوارئ؟'],
  ['finance', 5, 'كيف أضع خطة سداد الديون؟'],
  ['finance', 6, 'كيف أحدد هدفًا ماليًا ذكيًا؟'],
  ['finance', 7, 'ما أهمية تنويع الاستثمار؟'],
  ['finance', 8, 'كيف أبني خطة مالية شخصية؟'],
];

for (const [skillId, lessonId, question] of accepted) {
  test(`direct lesson concept: ${skillId} lesson ${lessonId} — ${question}`, () => {
    assert.equal(isDirectLessonConcept(skillId, lessonId, question), true);
  });
}

test('a concept from another lesson is not accepted as a direct match', () => {
  assert.equal(isDirectLessonConcept('ecommerce', 2, 'كيف أحسب سعر بيع يغطي كل التكاليف؟'), false);
});

test('cooking question is not a direct lesson concept', () => {
  assert.equal(isDirectLessonConcept('ecommerce', 1, 'كيف أطبخ الكسكس؟'), false);
});

test('unrelated question is not a direct lesson concept', () => {
  assert.equal(isDirectLessonConcept('finance', 4, 'ما عاصمة اليابان؟'), false);
});
