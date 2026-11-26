// 등급표, 학기·수업 유형·이수구분 기본값 (PRD 3장, 6장)

export const LETTERS = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F'];
export const PF_GRADES = ['P', 'NP'];

export const DEFAULT_POINTS = {
  'A+': 4.5, 'A0': 4.0, 'B+': 3.5, 'B0': 3.0, 'C+': 2.5, 'C0': 2.0, 'D+': 1.5, 'D0': 1.0, 'F': 0,
};

export const TERMS = [
  { id: '1', label: '1학기', short: '1', seasonal: false, order: 0 },
  { id: 'summer', label: '여름계절', short: '여름', seasonal: true, order: 1 },
  { id: '2', label: '2학기', short: '2', seasonal: false, order: 2 },
  { id: 'winter', label: '겨울계절', short: '겨울', seasonal: true, order: 3 },
];
export const TERM_BY_ID = Object.fromEntries(TERMS.map((t) => [t.id, t]));

export const DELIVERY = [
  { id: 'offline', label: '대면' },
  { id: 'elearning_a', label: 'e-러닝 A형' },
  { id: 'elearning_b', label: 'e-러닝 B형' },
  { id: 'elearning_c', label: 'e-러닝 C형' },
  { id: 'elearning_d', label: 'e-러닝 D형' },
  { id: 'online_other', label: '기타 온라인' },
];
export const DELIVERY_LABEL = Object.fromEntries(DELIVERY.map((d) => [d.id, d.label]));

export const TRACKS = ['Basic', 'Data Science', 'Business & Operations Management', 'Technology Management'];

// group: major | liberal | elective | other
export const DEFAULT_CATEGORIES = [
  { name: '전공기초(필수)', waivable: 'conditional', group: 'major', major: true },
  { name: '전공핵심', waivable: 'yes', group: 'major', major: true, requiredFlag: true },
  { name: '전공심화', waivable: 'yes', group: 'major', major: true, requiredFlag: true },
  { name: '핵심교양', waivable: 'yes', group: 'liberal', retakeNeeded: true },
  { name: '교양필수', waivable: 'conditional', group: 'liberal' },
  { name: '일반선택', waivable: 'no', group: 'elective' },
  { name: '타전공일반선택', waivable: 'yes', group: 'elective', otherMajor: true },
];

export const WAIVABLE_LABEL = { yes: '가능', conditional: '조건부', no: '불가' };

export function defaultSettings() {
  return {
    admissionYear: null,
    scale: 4.5,
    gradePoints: { ...DEFAULT_POINTS },
    retakeCap: 'A0',
    waiveLimit: 9,
    percentile: { base: 55, mult: 10 },
    retakeMode: 'keep', // keep | exclude | replace
    waiveSemesterMode: 'exclude', // 학점포기 과목의 학기 평점: exclude(성적증명서 기준) | include(원래 기록)
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: {
      elearningC: { on: true, value: 1 },
      maxCredits: { on: false, value: null },
      seasonalLimit: { on: true, offCredits: 6, offCourses: 2, onCredits: 9, onCourses: 3 },
      seasonalPrev: { on: true },
      retakeTarget: { on: true },
      retakeCount: { on: true, value: 2 },
      duplicate: { on: true },
    },
    advisorIncludeConditional: true,
    theme: 'system',
    lastBackupAt: null,
  };
}

export function gradePoint(grade, settings) {
  const p = settings.gradePoints[grade];
  return typeof p === 'number' ? p : null;
}

export function isLetter(grade) {
  return LETTERS.includes(grade);
}

/** 재수강 과목은 상한(A0)까지만 인정 */
export function effectivePoint(course, settings) {
  const p = gradePoint(course.grade, settings);
  if (p == null) return null;
  if (course.retakeOf) {
    const cap = gradePoint(settings.retakeCap, settings);
    if (cap != null) return Math.min(p, cap);
  }
  return p;
}

export function categoryInfo(settings, name) {
  return settings.categories.find((c) => c.name === name) || { name, waivable: 'no', group: 'other' };
}
