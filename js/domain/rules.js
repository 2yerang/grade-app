// 재수강·학점포기 규칙 (PRD 3.1, 4장, 5.2)
import { categoryInfo, gradePoint, effectivePoint } from './grades.js';
import { allCourses, buildRetake, cumulative, waivedCredits, semKey, sortSemesters, isSeasonal, semesterStats } from './calc.js';

export function findCourse(scn, id) {
  for (const s of scn.semesters) {
    const c = s.courses.find((x) => x.id === id);
    if (c) return { c, s };
  }
  return null;
}

function isRetakeTargetGrade(grade, settings) {
  if (!settings.rules.retakeTarget.on) return true;
  const p = gradePoint(grade, settings);
  const cplus = gradePoint('C+', settings);
  return p != null && p <= cplus;
}

/** 과목이 재수강 묶음에 들어있는지 (원과목이든 재수강이든) */
export function inRetakeGroup(scn, c, rt) {
  if (c.retakeOf) return true;
  return allCourses(scn).some(({ c: x }) => x.retakeOf === c.id);
}

/**
 * 재수강 원과목 후보: 등급평가 + C+ 이하(F 포함) + 포기 안 함 + 포기 예정 아님
 * 이미 묶음에서 C+ 초과 성적으로 남은 경우는 제외
 */
export function retakeOriginOptions(scn, settings, { excludeSemId, excludeCourseId } = {}) {
  const rt = buildRetake(scn, settings);
  const out = [];
  for (const { c, s } of allCourses(scn)) {
    if (s.id === excludeSemId || c.id === excludeCourseId) continue;
    if (c.gradingType !== 'letter' || c.grade == null || c.waived || c.plan === 'waive') continue;
    if (!isRetakeTargetGrade(c.grade, settings)) continue;
    const root = rt.rootOf.get(c.id);
    const w = rt.winner.get(root);
    if (w && w.c.id !== c.id) continue; // 묶음의 대표(남은 쪽)만 노출
    out.push({ c, s });
  }
  return out;
}

/**
 * 학점포기 가능 여부
 * @returns {{ok:boolean, reason?:string, conditional?:boolean, retakeNeeded?:boolean}}
 */
export function waiveCheck(scn, settings, c, { ignoreLimit = false } = {}) {
  const cat = categoryInfo(settings, c.category);
  const res = { ok: false, conditional: cat.waivable === 'conditional', retakeNeeded: !!cat.retakeNeeded };
  if (c.waived) return { ...res, reason: '이미 학점포기한 과목입니다' };
  if (c.gradingType !== 'letter') return { ...res, reason: 'P/F 과목은 학점포기할 수 없습니다' };
  if (c.grade == null) return { ...res, reason: '성적이 나온 과목만 학점포기할 수 있습니다' };
  if (c.plan === 'retake') return { ...res, reason: '재수강 예정 과목입니다. 먼저 재수강 계획을 해제하세요' };
  if (inRetakeGroup(scn, c)) return { ...res, reason: '재수강한 과목은 학점포기할 수 없습니다' };
  if (c.isRequired) return { ...res, reason: '필수 지정 과목은 포기할 수 없습니다' };
  if (cat.waivable === 'no') return { ...res, reason: `${c.category} 과목은 학점포기 대상이 아닙니다` };
  if (!ignoreLimit) {
    const remain = settings.waiveLimit - waivedCredits(scn);
    if (c.credits > remain) return { ...res, reason: `학점포기 한도를 넘습니다 (남은 한도 ${remain}학점)` };
  }
  return { ...res, ok: true };
}

/** 재수강 후보 판정 (5.2) */
export function retakeCheck(scn, settings, c) {
  if (c.gradingType !== 'letter') return { ok: false, reason: 'P/F 과목' };
  if (c.grade == null) return { ok: false, reason: '성적 미정' };
  if (c.waived) return { ok: false, reason: '학점포기한 과목은 재수강할 수 없습니다' };
  if (c.plan === 'waive') return { ok: false, reason: '포기 예정 과목' };
  if (!isRetakeTargetGrade(c.grade, settings)) return { ok: false, reason: 'C+ 초과' };
  const rt = buildRetake(scn, settings);
  const root = rt.rootOf.get(c.id);
  const w = rt.winner.get(root);
  if (w && w.c.id !== c.id) return { ok: false, reason: '재수강으로 폐기된 과목' };
  if (c.assumption === 'retake' || c.autoFromPlan) return { ok: false, reason: '가정 재수강 과목' };
  return { ok: true };
}

/** 재수강·학점포기 관리 화면의 목록 */
export function planLists(scn, settings) {
  const retake = [], waive = [], excluded = [];
  // 계획 자체의 효과(자동 재수강 과목, 포기 가정)는 빼고 후보를 판단한다
  const base = withoutPlans(scn);
  for (const { c: bc, s } of allCourses(base)) {
    if (s.isPlanned || bc.grade == null || bc.waived) continue;
    const c = findCourse(scn, bc.id).c;
    const free = { ...bc, plan: 'none' };
    const r = retakeCheck(base, settings, free);
    const w = waiveCheck(base, settings, free, { ignoreLimit: true });
    if (r.ok) retake.push({ c, s, blocked: c.plan === 'waive' ? '포기 예정 과목' : null });
    if (w.ok) waive.push({ c, s, blocked: c.plan === 'retake' ? '재수강 예정 과목' : null, conditional: w.conditional, retakeNeeded: w.retakeNeeded });
    if (!r.ok && !w.ok) {
      let reason = w.reason;
      if (c.gradingType !== 'letter') reason = 'P/F';
      else if (c.isRequired) reason = '필수 지정';
      else if (categoryInfo(settings, c.category).waivable === 'no') reason = c.category;
      else if (/재수강한/.test(w.reason)) reason = '재수강 묶음';
      excluded.push({ c, s, reason });
    }
  }
  waive.sort((a, b) => effectivePoint(a.c, settings) - effectivePoint(b.c, settings));
  return { retake, waive, excluded };
}

// ── 계획 반영(가상) ─────────────────────────────────────────────

export function cloneScenario(scn) {
  return JSON.parse(JSON.stringify(scn));
}

/**
 * 계획(재수강 예정·포기 예정)의 효과를 뺀 기준선 사본.
 * 자동으로 넣은 재수강 과목을 지우고, 포기 예정으로 가정한 W를 되돌린다. plan 표시는 남긴다.
 */
export function withoutPlans(scn) {
  const x = cloneScenario(scn);
  for (const s of x.semesters) {
    s.courses = s.courses.filter((c) => !c.autoFromPlan);
    for (const c of s.courses) if (c.plan === 'waive') c.waived = false;
  }
  return x;
}

/** plan 상태를 가상으로 적용한 시나리오 사본 (현재 탭의 "계획 반영 시" 수치용) */
export function applyPlans(scn, { only, kinds = ['retake', 'waive'] } = {}) {
  const x = cloneScenario(scn);
  const virtual = { id: '__plan', year: 9999, term: '1', courses: [], isPlanned: true, locked: false };
  for (const s of x.semesters) {
    for (const c of s.courses) {
      if (only && c.id !== only.id) continue;
      const plan = only ? only.plan : c.plan;
      if (!kinds.includes(plan)) continue;
      if (plan === 'waive') c.waived = true;
      if (plan === 'retake') {
        const exists = x.semesters.some((ss) => ss.courses.some((cc) => cc.retakeOf === c.id));
        if (!exists) {
          virtual.courses.push({ ...c, id: `${c.id}__rt`, retakeOf: c.id, grade: c.planGrade || 'A0', plan: 'none', waived: false });
        }
      }
    }
  }
  if (virtual.courses.length) x.semesters.push(virtual);
  return x;
}

/** 양쪽 후보 과목: 재수강 시 vs 포기 시 누적 */
export function compareRetakeVsWaive(scn, settings, c) {
  // 이 과목의 기존 계획 효과(자동 재수강 과목, 포기 가정)를 뺀 기준선에서 비교
  const base = cloneScenario(scn);
  for (const s of base.semesters) {
    s.courses = s.courses.filter((x) => x.autoFromPlan !== c.id);
    for (const x of s.courses) if (x.id === c.id) { x.waived = false; x.plan = 'none'; x.planGrade = c.planGrade; }
  }
  const a = cumulative(applyPlans(base, { only: { id: c.id, plan: 'retake' } }), settings).gpa;
  const b = cumulative(applyPlans(base, { only: { id: c.id, plan: 'waive' } }), settings).gpa;
  return { retake: a, waive: b, base: cumulative(base, settings).gpa };
}

/** 재수강 효과: 이 재수강 과목이 없을 때 대비 누적 변화 */
export function retakeEffects(scn, settings) {
  const base = cumulative(scn, settings).gpa;
  const out = [];
  for (const { c, s } of allCourses(scn)) {
    if (!c.retakeOf || c.grade == null) continue;
    if (!(s.isPlanned || c.assumption)) continue;
    const x = cloneScenario(scn);
    for (const ss of x.semesters) ss.courses = ss.courses.filter((cc) => cc.id !== c.id);
    const without = cumulative(x, settings).gpa;
    const orig = findCourse(scn, c.retakeOf);
    out.push({ c, s, orig, delta: base != null && without != null ? Math.round((base - without) * 100) / 100 : null });
  }
  return out;
}

/**
 * 재수강 계획이 원래 학기의 학기 평점을 어떻게 바꾸는지 (재수강 옵션별).
 * 대상: 재수강 예정(plan) 과목 + 예정 학기에 넣은 재수강 과목의 원과목.
 * @returns {Array<{sem, courses, before, keep, exclude, replace, current}>}  학기 순
 */
export function retakeSemesterImpact(scn, settings) {
  const origIds = new Set();
  const base = cloneScenario(scn);
  for (const s of base.semesters) {
    s.courses = s.courses.filter((c) => {
      const planned = c.autoFromPlan || (s.isPlanned && c.retakeOf);
      if (planned && c.retakeOf) origIds.add(c.retakeOf);
      return !planned;
    });
  }
  for (const { c } of allCourses(scn)) if (c.plan === 'retake') origIds.add(c.id);
  if (!origIds.size) return [];
  const planned = applyPlans(scn, { kinds: ['retake'] });
  const rtB = buildRetake(base, settings), rtP = buildRetake(planned, settings);
  const bySem = new Map();
  for (const id of origIds) {
    const f = findCourse(scn, id);
    if (!f || f.s.isPlanned) continue;
    if (!bySem.has(f.s.id)) bySem.set(f.s.id, { sem: f.s, courses: [] });
    bySem.get(f.s.id).courses.push(f.c);
  }
  const out = [];
  for (const [semId, x] of bySem) {
    const bs = base.semesters.find((s) => s.id === semId);
    const ps = planned.semesters.find((s) => s.id === semId);
    const at = (mode) => semesterStats(planned, ps, settings, rtP, mode).gpa;
    out.push({
      ...x,
      before: semesterStats(base, bs, settings, rtB).gpa,
      keep: at('keep'), exclude: at('exclude'), replace: at('replace'),
      current: at(settings.retakeMode),
    });
  }
  return out.sort((a, b) => semKey(a.sem) - semKey(b.sem));
}

/**
 * 현재 탭의 변경(새 학기·과목, 바뀐 성적, 삭제, 잠금)을 시뮬레이션으로 불러온다. sim을 직접 바꾼다.
 * 시뮬레이션에서 직접 바꾼(가정) 과목, 예정 학기, 자동 재수강 과목, 재수강·포기 계획은 그대로 둔다.
 * @returns {{addedSem, addedCourse, updated, removed}}
 */
export function syncFromCurrent(sim, cur) {
  const n = { addedSem: 0, addedCourse: 0, updated: 0, removed: 0 };
  const FIELDS = ['name', 'credits', 'category', 'isRequired', 'delivery', 'track', 'gradingType', 'grade', 'retakeOf', 'courseCode'];
  const curIds = new Set(allCourses(cur).map((x) => x.c.id));
  const simCourse = new Map(allCourses(sim).map((x) => [x.c.id, x]));
  for (const cs of cur.semesters) {
    let ss = sim.semesters.find((s) => s.id === cs.id) || sim.semesters.find((s) => s.year === cs.year && s.term === cs.term);
    if (!ss) {
      ss = { ...cloneScenario({ s: cs }).s, courses: [] };
      sim.semesters.push(ss);
      n.addedSem++;
    } else if (!ss.isPlanned) {
      ss.locked = cs.locked; ss.lockedAt = cs.lockedAt; ss.gradeLevel = cs.gradeLevel;
    }
    for (const cc of cs.courses) {
      const hit = simCourse.get(cc.id);
      if (!hit) {
        ss.courses.push({ ...JSON.parse(JSON.stringify(cc)), assumption: null, autoFromPlan: null });
        n.addedCourse++;
        continue;
      }
      const sc = hit.c;
      if (sc.assumption) continue; // 시뮬레이션에서 바꾼 과목은 유지
      let changed = false;
      for (const f of FIELDS) if (sc[f] !== cc[f]) { sc[f] = cc[f]; changed = true; }
      if (sc.plan !== 'waive' && (sc.waived !== cc.waived || sc.waivedAt !== cc.waivedAt)) { sc.waived = cc.waived; sc.waivedAt = cc.waivedAt; changed = true; }
      if (changed) n.updated++;
    }
  }
  for (const s of sim.semesters) {
    if (s.isPlanned) continue;
    const before = s.courses.length;
    s.courses = s.courses.filter((c) => c.assumption || c.autoFromPlan || curIds.has(c.id));
    n.removed += before - s.courses.length;
  }
  const curSemKeys = new Set(cur.semesters.flatMap((s) => [s.id, `${s.year}_${s.term}`]));
  const keep = (s) => s.isPlanned || s.courses.length || curSemKeys.has(s.id) || curSemKeys.has(`${s.year}_${s.term}`);
  sim.semesters = sim.semesters.filter(keep);
  // 끊긴 재수강 연결 정리
  const ids = new Set(allCourses(sim).map((x) => x.c.id));
  for (const { c } of allCourses(sim)) if (c.retakeOf && !ids.has(c.retakeOf)) c.retakeOf = null;
  return n;
}

/** 다음 정규/계절 학기 (예정 학기 추가 기본값) */
export function nextTerm(scn) {
  const sems = sortSemesters(scn.semesters);
  if (!sems.length) {
    const now = new Date();
    return { year: now.getFullYear(), term: now.getMonth() < 6 ? '1' : '2' };
  }
  const last = sems[sems.length - 1];
  // 정규학기 기준으로 다음 정규학기
  if (last.term === '1' || last.term === 'summer') return { year: last.year, term: '2' };
  return { year: last.year + 1, term: '1' };
}

export function lastRegularGrades(scn) {
  return sortSemesters(scn.semesters).filter((s) => !isSeasonal(s));
}

export { semKey, effectivePoint };
