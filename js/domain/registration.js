// 수강신청 조건 검사 (PRD 5.4) — 예정 학기 대상. 계절학기 한도는 모든 학기에 경고.
import { TERM_BY_ID } from './grades.js';
import { isSeasonal, semKey, allCourses, buildRetake } from './calc.js';

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 계절학기 바로 앞 정규학기 */
function prevRegular(scn, sem) {
  const target = sem.term === 'summer' ? { year: sem.year, term: '1' } : { year: sem.year, term: '2' };
  return scn.semesters.find((s) => s.year === target.year && s.term === target.term) || null;
}

/**
 * @returns {{ errors: Array<{semId, courseId?, msg}>, warnings: Array<{semId, courseId?, msg}>,
 *             bySem: Map<string,{errors:[],warnings:[]}>, byCourse: Map<string,{level,msg}[]> }}
 */
export function checkRegistration(scn, settings) {
  const R = settings.rules;
  const errors = [], warnings = [];
  const add = (level, semId, courseId, msg) => (level === 'error' ? errors : warnings).push({ semId, courseId, msg });

  for (const sem of scn.semesters) {
    const planned = !!sem.isPlanned;
    const seasonal = isSeasonal(sem);
    const cs = sem.courses;
    const credits = cs.reduce((a, c) => a + c.credits, 0);

    if (planned && !seasonal && R.elearningC.on) {
      const cc = cs.filter((c) => c.delivery === 'elearning_c');
      if (cc.length > R.elearningC.value) {
        for (const c of cc) add('error', sem.id, c.id, `e-러닝 C형은 학기당 ${R.elearningC.value}과목`);
      }
    }
    if (planned && !seasonal && R.maxCredits.on && R.maxCredits.value) {
      if (credits > R.maxCredits.value) add('error', sem.id, null, `최대 신청 학점 ${R.maxCredits.value}학점 초과 (${credits}학점)`);
    }
    if (seasonal && R.seasonalLimit.on && cs.length) {
      const online = cs.some((c) => c.delivery !== 'offline');
      const maxCr = online ? R.seasonalLimit.onCredits : R.seasonalLimit.offCredits;
      const maxN = online ? R.seasonalLimit.onCourses : R.seasonalLimit.offCourses;
      if (credits > maxCr || cs.length > maxN) {
        add(planned ? 'error' : 'warning', sem.id, null,
          `계절학기 한도 ${online ? '온라인 병행' : '대면만'} ${maxCr}학점·${maxN}과목 (현재 ${credits}학점·${cs.length}과목)`);
      }
    }
    if (planned && seasonal && R.seasonalPrev.on) {
      const prev = prevRegular(scn, sem);
      if (prev) {
        for (const c of cs) {
          const hit = prev.courses.some((p) => (c.courseCode && p.courseCode && norm(c.courseCode) === norm(p.courseCode)) || norm(p.name) === norm(c.name));
          if (hit) add('error', sem.id, c.id, `직전 ${TERM_BY_ID[prev.term].label}에 수강한 과목은 바로 이은 계절학기에 신청할 수 없습니다`);
        }
      }
    }
    if (planned && R.duplicate.on) {
      const seen = new Map();
      for (const c of cs) {
        const k = norm(c.name);
        if (seen.has(k)) add('warning', sem.id, c.id, '같은 학기에 같은 과목명이 있습니다');
        else seen.set(k, c);
      }
    }
  }

  // 재수강 횟수 (2025학번부터 과목당 2회, 필수·F 과목 제외)
  if (R.retakeCount.on && settings.admissionYear && settings.admissionYear >= 2025) {
    const rt = buildRetake(scn, settings);
    for (const [root, members] of rt.groups) {
      if (members.length < 2) continue;
      const orig = rt.byId.get(root)?.c;
      const exempt = (orig && orig.isRequired) || members.some((m) => m.c.grade === 'F');
      if (exempt) continue;
      const retakes = members.filter((m) => m.c.id !== root).sort((a, b) => semKey(a.s) - semKey(b.s));
      retakes.slice(R.retakeCount.value).forEach((m) =>
        add(m.s.isPlanned ? 'error' : 'warning', m.s.id, m.c.id, `재수강은 과목당 ${R.retakeCount.value}회까지입니다`));
    }
  }

  // 학점포기한 과목의 재수강
  for (const { c, s } of allCourses(scn)) {
    if (!c.retakeOf) continue;
    const orig = allCourses(scn).find((x) => x.c.id === c.retakeOf);
    if (orig && orig.c.waived) add('error', s.id, c.id, '학점포기한 과목은 재수강할 수 없습니다');
  }

  const bySem = new Map(), byCourse = new Map();
  const put = (level) => (e) => {
    if (!bySem.has(e.semId)) bySem.set(e.semId, { errors: [], warnings: [] });
    bySem.get(e.semId)[level === 'error' ? 'errors' : 'warnings'].push(e);
    if (e.courseId) {
      if (!byCourse.has(e.courseId)) byCourse.set(e.courseId, []);
      byCourse.get(e.courseId).push({ level, msg: e.msg });
    }
  };
  errors.forEach(put('error'));
  warnings.forEach(put('warning'));
  return { errors, warnings, bySem, byCourse };
}
