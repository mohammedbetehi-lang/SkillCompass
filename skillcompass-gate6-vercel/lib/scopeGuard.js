From c7921dfed290cee944aed20690b5e004d6e8a003 Mon Sep 17 00:00:00 2001
From: Manus <dev-agent@manus.ai>
Date: Fri, 30 Oct 2026 17:27:12 +0000
Subject: [PATCH] Fix false negatives for direct marketing lesson questions

---
 skillcompass-gate6-vercel/lib/scopeGuard.js | 40 +++++++++-
 skillcompass-gate6-vercel/test-full.js      | 81 ++++++++++++++-------
 2 files changed, 91 insertions(+), 30 deletions(-)

diff --git a/skillcompass-gate6-vercel/lib/scopeGuard.js b/skillcompass-gate6-vercel/lib/scopeGuard.js
index 3a26e4c..248adbf 100644
--- a/skillcompass-gate6-vercel/lib/scopeGuard.js
+++ b/skillcompass-gate6-vercel/lib/scopeGuard.js
@@ -54,6 +54,21 @@ const SIM_SPECIFIC_KEYWORDS = {
   ],
 };

+// مفاهيم مؤكدة في دروس محددة: تُقبل فقط عندما يصوغ الطالب سؤالاً تعليمياً
+// مباشراً عنها. هذا يمنع المصنف من رفض مفهوم موجود حرفياً في الدرس، مع عدم
+// تحويل مجرد ذكر كلمة إلى تصريح عام بالسؤال.
+const DIRECT_LESSON_CONCEPTS = {
+  marketing: {
+    1: ['roas', 'عائد الإنفاق الإعلاني'],
+  }
