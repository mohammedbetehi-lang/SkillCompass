// lib/curriculum.js
//
// Authoritative, server-side curriculum index used ONLY by the Scope Guard
// to decide whether a student's question belongs to the current lesson.
//
// IMPORTANT: this is intentionally a lightweight index (titles + keywords),
// not the full lesson content. The frontend already has the full content in
// SKILL_DATABASE (skillcompass_fixed.html). We do NOT trust the frontend to
// tell us what the lesson is "about" — the backend resolves skillId/lessonId
// against this file itself, so a manipulated request body can't widen scope.

const CURRICULUM = {
  ecommerce: {
    name: "التجارة الإلكترونية",
    keywords: ["تجارة إلكترونية", "متجر", "منتج", "عميل", "بيع", "شحن", "مخزون", "ربح", "تاجر"],
    lessons: {
      1: { title: "أساسيات التجارة الإلكترونية", keywords: ["دروبشيبينغ", "dropshipping", "مخزون خاص", "نموذج عمل", "b2c"] },
      2: { title: "اختيار المنتج والسوق", keywords: ["اختيار منتج", "طلب السوق", "google trends", "منافسة", "بحث عن منتج"] },
      3: { title: "تحليل المنافسين", keywords: ["تحليل منافسين", "تقييمات سلبية", "منافس", "ميزة تنافسية"] },
      4: { title: "التكلفة والتسعير", keywords: ["تسعير", "تكلفة", "رسوم بوابة الدفع", "إرجاعات", "سعر البيع"] },
      5: { title: "المخزون وإدارة رأس المال", keywords: ["مخزون", "رأس مال", "إعادة طلب", "معدل بيع", "توريد"] },
      6: { title: "التسويق واكتساب العملاء", keywords: ["اكتساب عملاء", "cac", "aov", "إعلانات", "محتوى عضوي", "مؤثرين"] },
      7: { title: "بناء عرض البيع", keywords: ["صفحة منتج", "وصف منتج", "تقييمات", "سياسة إرجاع", "عرض بيع"] },
      8: { title: "إدارة المتجر واتخاذ القرار", keywords: ["إدارة متجر", "توسع", "معدل إرجاع", "ربح صافي"] },
    },
  },
  marketing: {
    name: "التسويق الرقمي",
    keywords: ["تسويق", "إعلان", "حملة", "عميل", "جمهور", "محتوى", "تحويل", "منصة"],
    lessons: {
      1: { title: "أساسيات التسويق الرقمي", keywords: ["roas", "عائد الإنفاق الإعلاني", "إعجابات", "مبيعات"] },
      2: { title: "فهم العميل والجمهور المستهدف", keywords: ["استهداف", "جمهور", "عميل مثالي", "فئة عمرية", "اهتمامات"] },
      3: { title: "بناء العرض والرسالة التسويقية", keywords: ["رسالة تسويقية", "عرض قيمة فريد", "uvp", "ميزة", "فائدة"] },
      4: { title: "المحتوى وSocial Media", keywords: ["محتوى", "سوشيال ميديا", "محتوى تعليمي", "دليل اجتماعي", "اتساق النشر"] },
      5: { title: "الإعلانات المدفوعة", keywords: ["إعلانات مدفوعة", "ctr", "cpc", "a/b testing", "اختبار إعلانات"] },
      6: { title: "Landing Pages وConversion", keywords: ["صفحة هبوط", "landing page", "معدل تحويل", "conversion", "cta"] },
      7: { title: "Analytics وقياس الأداء", keywords: ["تحليلات", "analytics", "قياس أداء", "رحلة العميل", "بيانات"] },
      8: { title: "بناء استراتيجية تسويق متكاملة", keywords: ["استراتيجية تسويق", "رسالة موحدة", "خطة تسويقية متكاملة"] },
    },
  },
  project: {
    name: "إدارة المشاريع",
    keywords: ["مشروع", "مهمة", "فريق", "جدول زمني", "ميزانية", "مخاطر", "مدير مشروع"],
    lessons: {
      1: { title: "أساسيات إدارة المشاريع", keywords: ["مراحل مشروع", "بدء", "تخطيط", "تنفيذ", "إغلاق"] },
      2: { title: "تحديد الهدف والنطاق", keywords: ["نطاق مشروع", "زحف النطاق", "scope creep", "أهداف مشروع"] },
      3: { title: "تقسيم المشروع إلى مهام", keywords: ["تقسيم مهام", "wbs", "مهمة محددة", "مسؤول مهمة"] },
      4: { title: "الوقت والجدولة", keywords: ["جدولة", "مسار حرج", "critical path", "هامش أمان"] },
      5: { title: "الموارد والميزانية", keywords: ["ميزانية مشروع", "احتياطي طوارئ", "موارد", "تكلفة مشروع"] },
      6: { title: "إدارة المخاطر", keywords: ["إدارة مخاطر", "خطر", "احتمال", "تأثير", "خطة بديلة"] },
      7: { title: "متابعة الأداء وحل المشاكل", keywords: ["متابعة أداء", "انحراف", "تقدم مشروع", "حل مشاكل"] },
      8: { title: "إغلاق المشروع وتحليل النتائج", keywords: ["إغلاق مشروع", "دروس مستفادة", "تقييم مشروع"] },
    },
  },
  finance: {
    name: "المالية الشخصية",
    keywords: ["مال", "دخل", "مصروف", "ادخار", "استثمار", "ميزانية", "دين", "مالية شخصية"],
    lessons: {
      1: { title: "فهم المال والدخل والمصروف", keywords: ["دخل صافي", "دخل إجمالي", "راتب", "خصومات"] },
      2: { title: "بناء الميزانية", keywords: ["ميزانية شخصية", "50/30/20", "احتياجات ورغبات"] },
      3: { title: "التحكم فالمصاريف", keywords: ["تسرب مالي", "اشتراكات", "مصاريف صغيرة", "كشف حساب"] },
      4: { title: "الادخار وصندوق الطوارئ", keywords: ["صندوق طوارئ", "ادخار", "طوارئ مالية"] },
      5: { title: "الديون وإدارتها", keywords: ["ديون", "بطاقة ائتمان", "فائدة", "سداد ديون"] },
      6: { title: "الأهداف المالية", keywords: ["هدف مالي", "smart", "ادخار محدد", "تحويل تلقائي"] },
      7: { title: "فهم المخاطر والاستثمار بشكل عام", keywords: ["استثمار", "مخاطرة", "عائد", "تنويع", "diversification"] },
      8: { title: "بناء خطة مالية شخصية", keywords: ["خطة مالية", "أولويات مالية", "ترتيب مالي"] },
    },
  },
};

/**
 * Resolve skill + lesson metadata server-side from IDs only.
 * Never trust a client-supplied title/content for scope decisions.
 */
function resolveLesson(skillId, lessonId) {
  const skill = CURRICULUM[skillId];
  if (!skill) return null;
  const lesson = skill.lessons[lessonId];
  if (!lesson) return null;
  return {
    skillId,
    skillName: skill.name,
    skillKeywords: skill.keywords,
    lessonId: Number(lessonId),
    lessonTitle: lesson.title,
    lessonKeywords: lesson.keywords,
  };
}

module.exports = { CURRICULUM, resolveLesson };
