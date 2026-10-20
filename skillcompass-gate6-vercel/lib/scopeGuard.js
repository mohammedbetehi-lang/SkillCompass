
  // Stage 1 — deterministic keyword match against the CURRENT lesson
  // and the CURRENT skill.
  const allKeywords = [
    ...lesson.lessonKeywords,
    lesson.lessonTitle,
    ...(lesson.skillKeywords || [])
  ];

  if (containsAny(question, allKeywords)) {
    return {
      allowed: true,
      skillName: lesson.skillName,
      lessonTitle: lesson.lessonTitle,
      stage: 'keyword_match',
      reason: 'matched_lesson_or_skill_keyword',
    };
  }

