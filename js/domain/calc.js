// 평점·백분위·이수 학점 계산 (PRD 4장). 평점은 저장하지 않고 매번 계산한다.
import { TERM_BY_ID, effectivePoint, categoryInfo } from './grades.js';

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;

export function semKey(s) {
  return s.year * 10 + TERM_BY_ID[s.term].order;
}
export function isSeasonal(s) {
  return TERM_BY_ID[s.term].seasonal;
}
export function sortSemesters(sems) {
  return [...sems].sort((a, b) => semKey(a) - semKey(b));
}
export function semName(s) {
  return `${s.year}년 ${TERM_BY_ID[s.term].label}`;
}
export function semShort(s) {
  const t = TERM_BY_ID[s.term];
  const yy = String(s.year).slice(2);
  return t.seasonal ? `${yy} ${t.short}` : `${yy}-${t.short}`;
}

/** [{c, s}] 학기 순서대로 */
export function allCourses(scn) {
  const out = [];
  for (const s of sortSemesters(scn.semesters)) for (const c of s.courses) out.push({ c, s });
  return out;
}

/**
 * 재수강 묶음을 만든다.
 * - 묶음: retakeOf를 따라 올라간 최초 원과목(root) 기준
 * - 경쟁: 등급평가 + 성적 있음 + 학점포기 아님
 * - 평점이 높은 쪽 1개만 남고 나머지는 폐기(동점이면 나중 과목)
 */
export function buildRetake(scn, settings) {
  const list = allCourses(scn);
  const byId = new Map(list.map((x) => [x.c.id, x]));
  const rootOf = new Map();
  const findRoot = (id) => {
    const seen = new Set();
    let cur = id;
    while (true) {
      const x = byId.get(cur);
      if (!x || !x.c.retakeOf || !byId.has(x.c.retakeOf) || seen.has(cur)) return cur;
      seen.add(cur);
      cur = x.c.retakeOf;
    }
  };
  const groups = new Map();
  for (const x of list) {
    const root = findRoot(x.c.id);
    rootOf.set(x.c.id, root);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(x);
  }
  const winner = new Map(); // root -> {c,s}
  const discarded = new Map(); // courseId -> winner {c,s}
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const comp = members.filter(
      (x) => x.c.gradingType === 'letter' && x.c.grade != null && !x.c.waived,
    );
    if (comp.length === 0) continue;
    let best = comp[0];
    for (const x of comp.slice(1)) {
      const a = effectivePoint(x.c, settings);
      const b = effectivePoint(best.c, settings);
      if (a > b || (a === b && semKey(x.s) >= semKey(best.s))) best = x;
    }
    winner.set(root, best);
    for (const x of comp) if (x !== best) discarded.set(x.c.id, best);
  }
  const groupOf = (id) => {
    const r = rootOf.get(id);
    const g = groups.get(r);
    return g && g.length > 1 ? g : null;
  };
  return { byId, rootOf, groups, winner, discarded, groupOf };
}

/** 이수구분: 원과목 기준, 원과목이 타전공일반선택이면 재수강 과목 기준 */
export function effectiveCategory(c, rt, settings) {
  const root = rt.rootOf.get(c.id);
  if (!root || root === c.id) return c.category;
  const orig = rt.byId.get(root)?.c;
  if (!orig) return c.category;
  return categoryInfo(settings, orig.category).otherMajor ? c.category : orig.category;
}

/**
 * 누적(증명용) 평점.
 * opts.ignoreWaive: 졸업평점 (학점포기 과목 포함)
 * opts.filter: (c) => boolean  등급평가 과목 필터 (전공 평점 등)
 */
export function cumulative(scn, settings, opts = {}) {
  const rt = opts.rt || buildRetake(scn, settings);
  let pts = 0, gradedCr = 0, earned = 0, pending = 0;
  for (const { c } of allCourses(scn)) {
    if (c.waived && !opts.ignoreWaive) continue;
    if (rt.discarded.has(c.id)) continue;
    if (c.grade == null) { pending += c.credits; continue; }
    if (c.gradingType === 'letter') {
      if (opts.filter && !opts.filter(c, rt)) continue;
      const p = effectivePoint(c, settings);
      if (p == null) continue;
      pts += p * c.credits;
      gradedCr += c.credits;
      if (c.grade !== 'F') earned += c.credits;
    } else if (c.grade === 'P') {
      if (opts.filter && !opts.filter(c, rt)) continue;
      earned += c.credits;
    }
  }
  return { gpa: gradedCr > 0 ? round2(pts / gradedCr) : null, gradedCredits: gradedCr, points: pts, earned, pending };
}

export function percentile(gpa, settings) {
  if (gpa == null) return null;
  return round1(settings.percentile.base + gpa * settings.percentile.mult);
}

/** 학기 평점(성적확인서 기준). 재수강 옵션(mode)에 따라 이전 학기 처리 */
export function semesterStats(scn, sem, settings, rt, mode = settings.retakeMode) {
  rt = rt || buildRetake(scn, settings);
  let applied = 0, pts = 0, gradedCr = 0, earned = 0, pending = 0, letterCr = 0, pfCr = 0;
  let wPts = 0, wCr = 0, waivedCr = 0; // 학점포기 과목 (원래 성적)
  const count = (c, gradeCourse, credits) => {
    const p = effectivePoint(gradeCourse, settings);
    pts += p * credits;
    gradedCr += credits;
    if (gradeCourse.grade !== 'F') earned += credits;
  };
  for (const c of sem.courses) {
    applied += c.credits;
    if (c.gradingType === 'letter') letterCr += c.credits; else pfCr += c.credits;
    // 학점포기: 성적증명서에만 안 보이고 원래 기록(학기 평점·졸업평점)에는 남는다. 이수 학점에서는 빠진다.
    if (c.waived) {
      waivedCr += c.credits;
      const p = c.gradingType === 'letter' ? effectivePoint(c, settings) : null;
      if (p != null) { wPts += p * c.credits; wCr += c.credits; }
      continue;
    }
    if (c.grade == null) { pending += c.credits; continue; }
    if (c.gradingType !== 'letter') { if (c.grade === 'P') earned += c.credits; continue; }
    const win = rt.discarded.get(c.id);
    if (mode === 'keep') { count(c, c, c.credits); continue; }
    if (mode === 'exclude') { if (!win) count(c, c, c.credits); continue; }
    // replace
    const root = rt.rootOf.get(c.id);
    if (win) {
      if (root === c.id) count(c, win.c, win.c.credits); // 원래 학기에 새 성적
      continue;
    }
    const w = rt.winner.get(root);
    if (w && w.c.id === c.id && root !== c.id && rt.discarded.has(root)) continue; // 원래 학기로 옮겨짐
    count(c, c, c.credits);
  }
  const gpa = gradedCr + wCr > 0 ? round2((pts + wPts) / (gradedCr + wCr)) : null; // 원래 기록 (학점포기 포함)
  const certGpa = gradedCr > 0 ? round2(pts / gradedCr) : null; // 성적증명서 기준 (학점포기 제외)
  let honors = null;
  if (!isSeasonal(sem) && gpa != null && pending === 0) {
    if (gpa >= 4.0) honors = '우수';
    else if (gpa >= 3.75) honors = '우등';
  }
  return { applied, earned, gpa, certGpa, waivedCr, gradedCredits: gradedCr + wCr, pending, letterCr, pfCr, honors };
}

export function waivedCredits(scn) {
  let n = 0;
  for (const { c } of allCourses(scn)) if (c.waived) n += c.credits;
  return n;
}

/** 대시보드·결과 패널용 요약 */
export function summarize(scn, settings) {
  const rt = buildRetake(scn, settings);
  const cum = cumulative(scn, settings, { rt });
  const pre = cumulative(scn, settings, { rt: buildRetakeIgnoringWaive(scn, settings), ignoreWaive: true });
  const major = cumulative(scn, settings, {
    rt,
    filter: (c) => !!categoryInfo(settings, effectiveCategory(c, rt, settings)).major,
  });
  const semStats = new Map();
  for (const s of scn.semesters) semStats.set(s.id, semesterStats(scn, s, settings, rt));
  return {
    rt,
    gpa: cum.gpa,
    percentile: percentile(cum.gpa, settings),
    earned: cum.earned,
    pending: cum.pending,
    gradedCredits: cum.gradedCredits,
    preWaiveGpa: pre.gpa,
    majorGpa: major.gpa,
    waived: waivedCredits(scn),
    semStats,
  };
}

function buildRetakeIgnoringWaive(scn, settings) {
  const clone = { ...scn, semesters: scn.semesters.map((s) => ({ ...s, courses: s.courses.map((c) => ({ ...c, waived: false })) })) };
  return buildRetake(clone, settings);
}

/** 학기별 추이: 각 시점까지의 누적 평점 */
export function trend(scn, settings) {
  const sems = sortSemesters(scn.semesters);
  const rt = buildRetake(scn, settings);
  return sems.map((s, i) => {
    const prefix = { ...scn, semesters: sems.slice(0, i + 1) };
    const st = semesterStats(scn, s, settings, rt);
    return {
      sem: s,
      semGpa: isSeasonal(s) ? null : st.gpa,
      cumGpa: cumulative(prefix, settings).gpa,
    };
  });
}

/** 성적 분포 (등급별 과목 수·학점) */
export function distribution(scn) {
  const order = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F', 'P', 'NP'];
  const m = new Map(order.map((g) => [g, { grade: g, n: 0, credits: 0 }]));
  for (const { c } of allCourses(scn)) {
    if (c.grade == null || c.waived) continue;
    const r = m.get(c.grade);
    if (r) { r.n++; r.credits += c.credits; }
  }
  return order.map((g) => m.get(g)).filter((r) => r.n > 0 || ['A+', 'A0', 'B+', 'B0', 'C+', 'F', 'P'].includes(r.grade));
}
