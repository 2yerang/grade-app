// 재수강·학점포기 통합 추천 (PRD 5.2·5.3 확장), 목표 평점 역산 (F-14)
import { cumulative, percentile, waivedCredits, allCourses, round2 } from './calc.js';
import { planLists, withoutPlans, applyPlans, cloneScenario, findCourse } from './rules.js';
import { effectivePoint, gradePoint } from './grades.js';

const NODE_LIMIT = 400000;
const EPS = 1e-9;

function combinations(arr, k, start = 0, pick = [], out = []) {
  if (pick.length === k) { out.push([...pick]); return out; }
  for (let i = start; i < arr.length; i++) {
    pick.push(arr[i]);
    combinations(arr, k, i + 1, pick, out);
    pick.pop();
  }
  return out;
}

/** 기준선(base)에 재수강·포기 선택을 적용한 사본 */
export function applyChoice(base, retakeIds, waiveIds, grade) {
  const x = cloneScenario(base);
  const virtual = { id: '__advice', year: 9999, term: '1', courses: [], isPlanned: true, locked: false };
  for (const s of x.semesters) {
    for (const c of s.courses) {
      if (waiveIds.has(c.id)) c.waived = true;
      if (retakeIds.has(c.id)) virtual.courses.push({ ...c, id: `${c.id}__adv`, retakeOf: c.id, grade, plan: 'none', waived: false });
    }
  }
  if (virtual.courses.length) x.semesters.push(virtual);
  return x;
}

/**
 * 재수강 과목 수(k)별로 누적 평점이 가장 높아지는 "재수강 + 학점포기" 조합.
 * - 이미 세운 계획도 후보로 다시 넣고 기준선(계획 없음)에서 계산한다.
 * - 재수강은 retakeGrade(기본: 상한 A0)를 받는다고 가정한다.
 * - 같은 결과의 다른 조합은 alts로 묶는다.
 */
export function planAdvice(scn, settings, { retakeGrade, maxRetake = 4 } = {}) {
  const base = withoutPlans(scn);
  const cum = cumulative(base, settings);
  const grade = retakeGrade || settings.retakeCap;
  const gR = Math.min(gradePoint(grade, settings), gradePoint(settings.retakeCap, settings));
  const remain = Math.max(0, settings.waiveLimit - waivedCredits(base));

  // 지금 세운 계획
  const curRetake = new Set(), curWaive = new Set();
  for (const { c } of allCourses(scn)) {
    if (c.plan === 'retake') curRetake.add(c.id);
    if (c.plan === 'waive') curWaive.add(c.id);
  }
  const current = {
    retakeIds: curRetake, waiveIds: curWaive,
    gpa: cumulative(applyPlans(base), settings).gpa,
  };
  if (cum.gpa == null) return { baseGpa: null, remain, grade, current, rows: [], nRetake: 0, nWaive: 0 };

  const L = planLists(base, settings);
  const R = L.retake
    .map((x) => ({ c: x.c, s: x.s, p: effectivePoint(x.c, settings), cr: x.c.credits }))
    .filter((x) => x.p < gR)
    .sort((a, b) => (gR - b.p) * b.cr - (gR - a.p) * a.cr);
  const W = L.waive
    .filter((x) => settings.advisorIncludeConditional || !x.conditional)
    .map((x) => ({ c: x.c, s: x.s, p: effectivePoint(x.c, settings), cr: x.c.credits, conditional: x.conditional, retakeNeeded: x.retakeNeeded }))
    .filter((x) => x.p < settings.scale && x.cr <= remain)
    .sort((a, b) => a.p - b.p || b.cr - a.cr);

  const P = cum.points, C = cum.gradedCredits;
  let nodes = 0;
  const better = (a, b) => {
    if (!b) return true;
    if (a.v > b.v + EPS) return true;
    if (a.v < b.v - EPS) return false;
    if (a.wc !== b.wc) return a.wc < b.wc; // 포기 학점은 적을수록 (되돌릴 수 없음)
    return a.cond < b.cond; // 조건부 과목은 적을수록
  };
  const same = (a, b) => Math.abs(a.v - b.v) < EPS && a.wc === b.wc && a.cond === b.cond;

  const rows = [];
  let prevGpa = null;
  for (let k = 0; k <= Math.min(maxRetake, R.length); k++) {
    let best = null, ties = [];
    for (const S of combinations(R, k)) {
      const sIds = new Set(S.map((x) => x.c.id));
      const P1 = P + S.reduce((a, x) => a + (gR - x.p) * x.cr, 0);
      const cands = W.filter((x) => !sIds.has(x.c.id));
      const pick = [];
      const visit = (wp, wc, cond) => {
        const v = C - wc > 0 ? (P1 - wp) / (C - wc) : -1;
        const cur = { v, wc, cond, S, Wset: [...pick] };
        if (better(cur, best)) { best = cur; ties = [cur]; } else if (same(cur, best) && ties.length < 6) ties.push(cur);
      };
      const dfs = (i, wp, wc, cond) => {
        if (++nodes > NODE_LIMIT) return;
        visit(wp, wc, cond);
        for (let j = i; j < cands.length; j++) {
          const x = cands[j];
          if (wc + x.cr > remain) continue;
          pick.push(x);
          dfs(j + 1, wp + x.p * x.cr, wc + x.cr, cond + (x.conditional ? 1 : 0));
          pick.pop();
        }
      };
      dfs(0, 0, 0, 0);
    }
    if (!best) continue;
    const rIds = new Set(best.S.map((x) => x.c.id));
    const wIds = new Set(best.Wset.map((x) => x.c.id));
    const gpa = cumulative(applyChoice(base, rIds, wIds, grade), settings).gpa; // 실제 계산으로 확인
    if (prevGpa != null && gpa <= prevGpa + EPS) break; // 재수강을 늘려도 더 오르지 않음
    prevGpa = gpa;
    // 같은 결과의 다른 조합: 재수강·포기 역할별로 무엇을 무엇으로 바꾸는지
    const diff = (a, b) => {
      const ia = new Set(a.map((x) => x.c.id)), ib = new Set(b.map((x) => x.c.id));
      return { out: a.filter((x) => !ib.has(x.c.id)).map((x) => x.c), in: b.filter((x) => !ia.has(x.c.id)).map((x) => x.c) };
    };
    const alts = ties.slice(1).map((t) => ({ retake: diff(best.S, t.S), waive: diff(best.Wset, t.Wset) }))
      .filter((a) => a.retake.out.length || a.retake.in.length || a.waive.out.length || a.waive.in.length);
    const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    rows.push({
      k: best.S.length,
      retakes: best.S,
      waives: best.Wset,
      waiveCredits: best.Wset.reduce((a, x) => a + x.cr, 0),
      gpa,
      percentile: percentile(gpa, settings),
      delta: round2(gpa - cum.gpa),
      alts,
      conditional: best.Wset.filter((x) => x.conditional),
      retakeNeeded: best.Wset.filter((x) => x.retakeNeeded).reduce((a, x) => a + x.cr, 0),
      matchesCurrent: eqSet(rIds, curRetake) && eqSet(wIds, curWaive),
    });
  }
  return { baseGpa: cum.gpa, remain, grade, current, rows, nRetake: R.length, nWaive: W.length, truncated: nodes > NODE_LIMIT };
}

/** 누적 (P, C) 상태에서 목표 T까지: 다음 credits학점 필요 평균 + 평균 a로 받을 때 최소 학점 */
function reach(cum, T, credits, settings) {
  const gap = T * cum.gradedCredits - cum.points; // 더 필요한 평점×학점
  const minAt = (a) => (gap <= 1e-9 ? 0 : a <= T + 1e-9 ? null : Math.ceil(gap / (a - T) - 1e-9));
  const need = credits > 0 ? (T * (cum.gradedCredits + credits) - cum.points) / credits : null;
  return {
    gpa: cum.gpa,
    need: need == null ? null : round2(need),
    possible: need != null && need <= settings.scale + 1e-9,
    already: gap <= 1e-9,
    minMax: minAt(settings.scale), // 전부 4.5(만점)일 때 최소 학점
    minA0: minAt(gradePoint('A0', settings)),
  };
}

/**
 * 목표 평점 역산: 계획 없이 / 지금 고른 계획 반영 / 추천 최대 계획 반영 세 경우
 */
export function targetAnalysis(scn, settings, target, credits, { retakeGrade } = {}) {
  const base = withoutPlans(scn);
  const rows = [{ key: 'base', label: '계획 없이', ...reach(cumulative(base, settings), target, credits, settings) }];
  const hasPlan = allCourses(scn).some(({ c }) => c.plan === 'retake' || c.plan === 'waive');
  if (hasPlan) rows.push({ key: 'plan', label: '지금 고른 재수강·포기 반영', ...reach(cumulative(applyPlans(base), settings), target, credits, settings) });
  const adv = planAdvice(scn, settings, { retakeGrade });
  const best = adv.rows[adv.rows.length - 1];
  if (best && (best.k || best.waives.length) && !best.matchesCurrent) {
    const rIds = new Set(best.retakes.map((x) => x.c.id)), wIds = new Set(best.waives.map((x) => x.c.id));
    rows.push({
      key: 'best', label: `추천 계획 반영 (재수강 ${best.k} · 포기 ${fmtNum(best.waiveCredits)}학점)`,
      ...reach(cumulative(applyChoice(base, rIds, wIds, adv.grade), settings), target, credits, settings),
    });
  }
  return { target, credits, rows };
}
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 누적 target이 되려면 다음 학기 credits학점에서 필요한 평균 */
export function requiredAverage(scn, settings, target, credits) {
  const base = cumulative(scn, settings);
  const need = (target * (base.gradedCredits + credits) - base.points) / credits;
  return {
    current: base.gpa,
    need: round2(need),
    possible: need <= settings.scale + 1e-9,
    already: need <= 0,
  };
}
