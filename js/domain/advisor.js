// 재수강·학점포기 통합 추천 (PRD 5.3), 목표 평점 역산 (F-14)
import { cumulative, percentile, waivedCredits, allCourses, round2 } from './calc.js';
import { planLists, withoutPlans, applyPlans, cloneScenario } from './rules.js';
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

/**
 * 기준선(base)에 재수강·포기 선택을 적용한 사본
 * @param retakes Map<courseId, grade>
 * @param waiveIds Set<courseId>
 */
export function applyChoice(base, retakes, waiveIds) {
  const x = cloneScenario(base);
  const virtual = { id: '__advice', year: 9999, term: '1', courses: [], isPlanned: true, locked: false };
  for (const s of x.semesters) {
    for (const c of s.courses) {
      if (waiveIds.has(c.id)) c.waived = true;
      if (retakes.has(c.id)) virtual.courses.push({ ...c, id: `${c.id}__adv`, retakeOf: c.id, grade: retakes.get(c.id), plan: 'none', waived: false });
    }
  }
  if (virtual.courses.length) x.semesters.push(virtual);
  return x;
}

// 동점이면 포기 학점이 적은 쪽(되돌릴 수 없음), 조건부 과목이 적은 쪽
const better = (a, b) => {
  if (!b) return true;
  if (a.v > b.v + EPS) return true;
  if (a.v < b.v - EPS) return false;
  if (a.wc !== b.wc) return a.wc < b.wc;
  return a.cond < b.cond;
};
const same = (a, b) => Math.abs(a.v - b.v) < EPS && a.wc === b.wc && a.cond === b.cond;

/** 포기 조합 탐색: (P, C)에서 budget 학점 이내로 평점을 가장 높이는 조합들을 acc에 모은다 */
function searchWaives(P, C, cands, budget, S, acc, counter) {
  const pick = [];
  const dfs = (i, wp, wc, cond) => {
    if (++counter.n > NODE_LIMIT) return;
    const cur = { v: C - wc > 0 ? (P - wp) / (C - wc) : -1, wc, cond, S, Wset: [...pick] };
    if (better(cur, acc.best)) { acc.best = cur; acc.ties = [cur]; } else if (same(cur, acc.best) && acc.ties.length < 6) acc.ties.push(cur);
    for (let j = i; j < cands.length; j++) {
      const x = cands[j];
      if (wc + x.cr > budget) continue;
      pick.push(x);
      dfs(j + 1, wp + x.p * x.cr, wc + x.cr, cond + (x.conditional ? 1 : 0));
      pick.pop();
    }
  };
  dfs(0, 0, 0, 0);
}

const diff = (a, b) => {
  const ia = new Set(a.map((x) => x.c.id)), ib = new Set(b.map((x) => x.c.id));
  return { out: a.filter((x) => !ib.has(x.c.id)).map((x) => x.c), in: b.filter((x) => !ia.has(x.c.id)).map((x) => x.c) };
};
const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * 재수강·학점포기 추천.
 * mode 'free'  : 재수강 과목 수(k)별로 "재수강 + 포기" 최적 조합 (이미 세운 계획도 다시 후보로)
 * mode 'fixed' : 내가 고른 재수강 예정 과목은 그대로(각자 예상 성적) 두고, 포기만 포기 학점(3·6·9…)별 최적 조합
 * 등록된 과목과 입력한 예상 성적은 그대로 반영된다(성적 미정 과목은 평점에서 빠짐).
 */
export function planAdvice(scn, settings, { retakeGrade, maxRetake = 4, mode = 'free' } = {}) {
  const base = withoutPlans(scn);
  const cap = gradePoint(settings.retakeCap, settings);
  const grade = retakeGrade || settings.retakeCap;
  const gR = Math.min(gradePoint(grade, settings), cap);
  const remain = Math.max(0, settings.waiveLimit - waivedCredits(base));

  const curRetake = new Set(), curWaive = new Set();
  for (const { c } of allCourses(scn)) {
    if (c.plan === 'retake') curRetake.add(c.id);
    if (c.plan === 'waive') curWaive.add(c.id);
  }
  const current = { retakeIds: curRetake, waiveIds: curWaive, gpa: cumulative(applyPlans(base), settings).gpa };
  const baseCum = cumulative(base, settings);
  const empty = { baseGpa: baseCum.gpa, remain, grade, current, rows: [], mode, fixed: [] };
  if (baseCum.gpa == null) return empty;

  const L = planLists(base, settings);
  const W = L.waive
    .filter((x) => settings.advisorIncludeConditional || !x.conditional)
    .map((x) => ({ c: x.c, s: x.s, p: effectivePoint(x.c, settings), cr: x.c.credits, conditional: x.conditional, retakeNeeded: x.retakeNeeded }))
    .filter((x) => x.p < settings.scale && x.cr <= remain)
    .sort((a, b) => a.p - b.p || b.cr - a.cr);
  const counter = { n: 0 };

  const makeRow = (acc, retakeList, label) => {
    const best = acc.best;
    const rMap = new Map(retakeList.map((x) => [x.c.id, x.grade]));
    const wIds = new Set(best.Wset.map((x) => x.c.id));
    const gpa = cumulative(applyChoice(base, rMap, wIds), settings).gpa; // 실제 계산으로 확인
    return {
      label,
      k: retakeList.length,
      retakes: retakeList,
      waives: best.Wset,
      waiveCredits: best.wc,
      gpa,
      percentile: percentile(gpa, settings),
      delta: round2(gpa - baseCum.gpa),
      alts: acc.ties.slice(1).map((t) => ({ retake: diff(best.S, t.S), waive: diff(best.Wset, t.Wset) }))
        .filter((a) => a.retake.out.length || a.waive.out.length),
      conditional: best.Wset.filter((x) => x.conditional),
      retakeNeeded: best.Wset.filter((x) => x.retakeNeeded).reduce((a, x) => a + x.cr, 0),
      matchesCurrent: eqSet(new Set(rMap.keys()), curRetake) && eqSet(wIds, curWaive),
    };
  };

  const rows = [];
  if (mode === 'fixed') {
    // 내가 고른 재수강: 각자 예상 성적(상한 적용)으로 고정
    const fixed = [];
    for (const { c, s } of allCourses(base)) {
      if (c.plan !== 'retake') continue;
      const g = c.planGrade || settings.retakeCap;
      fixed.push({ c, s, p: effectivePoint(c, settings), cr: c.credits, grade: gradePoint(g, settings) > cap ? settings.retakeCap : g });
    }
    const fixedIds = new Set(fixed.map((x) => x.c.id));
    const withFixed = cumulative(applyChoice(base, new Map(fixed.map((x) => [x.c.id, x.grade])), new Set()), settings);
    const cands = W.filter((x) => !fixedIds.has(x.c.id));
    const levels = [...new Set([0, ...[3, 6, 9, 12].filter((v) => v < remain), remain])].sort((a, b) => a - b);
    let prevKey = null;
    for (const lv of levels) {
      const acc = { best: null, ties: [] };
      searchWaives(withFixed.points, withFixed.gradedCredits, cands, lv, fixed, acc, counter);
      if (!acc.best) continue;
      const key = acc.best.Wset.map((x) => x.c.id).sort().join('|');
      if (key === prevKey) continue; // 한도를 늘려도 같은 조합
      prevKey = key;
      rows.push(makeRow(acc, fixed, acc.best.wc ? `포기 ${fmtNum(acc.best.wc)}학점` : '포기 안 함'));
    }
    return { ...empty, rows, fixed, baseGpa: baseCum.gpa, truncated: counter.n > NODE_LIMIT };
  }

  // free: 재수강 과목 수별
  const R = L.retake
    .map((x) => ({ c: x.c, s: x.s, p: effectivePoint(x.c, settings), cr: x.c.credits, grade }))
    .filter((x) => x.p < gR)
    .sort((a, b) => (gR - b.p) * b.cr - (gR - a.p) * a.cr);
  let prevGpa = null;
  for (let k = 0; k <= Math.min(maxRetake, R.length); k++) {
    const acc = { best: null, ties: [] };
    for (const S of combinations(R, k)) {
      const sIds = new Set(S.map((x) => x.c.id));
      const P1 = baseCum.points + S.reduce((a, x) => a + (gR - x.p) * x.cr, 0);
      searchWaives(P1, baseCum.gradedCredits, W.filter((x) => !sIds.has(x.c.id)), remain, S, acc, counter);
    }
    if (!acc.best) continue;
    const row = makeRow(acc, acc.best.S, k ? `재수강 ${k}과목` : '재수강 없이');
    if (prevGpa != null && row.gpa <= prevGpa + EPS) break; // 재수강을 늘려도 더 오르지 않음
    prevGpa = row.gpa;
    rows.push(row);
  }
  return { ...empty, rows, truncated: counter.n > NODE_LIMIT };
}
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 기본 추천 모드: 재수강 예정 과목이 있으면 'fixed' */
export function defaultAdviceMode(scn) {
  return allCourses(scn).some(({ c }) => c.plan === 'retake') ? 'fixed' : 'free';
}

/** 성적 미정(수강 중·예정)인 등급평가 학점 */
export function pendingLetterCredits(scn) {
  let n = 0;
  for (const { c } of allCourses(scn)) if (c.grade == null && !c.waived && c.gradingType === 'letter') n += c.credits;
  return n;
}

/** (P, C) 상태에서 목표 T까지: 남은 credits학점 필요 평균 + 평균 a로만 받을 때 최소 학점 */
function reach(cum, T, credits, settings) {
  const gap = T * cum.gradedCredits - cum.points;
  const minAt = (a) => (gap <= 1e-9 ? 0 : a <= T + 1e-9 ? null : Math.ceil(gap / (a - T) - 1e-9));
  const need = credits > 0 ? (T * (cum.gradedCredits + credits) - cum.points) / credits : null;
  return {
    gpa: cum.gpa,
    need: need == null ? null : round2(need),
    possible: need != null && need <= settings.scale + 1e-9,
    already: gap <= 1e-9,
    minMax: minAt(settings.scale),
    minA0: minAt(gradePoint('A0', settings)),
  };
}

/**
 * 목표 평점 역산. 등록된 과목·입력한 예상 성적은 그대로 반영하고,
 * credits = 앞으로 성적이 정해질 등급평가 학점(기본: 성적 미정 과목 학점, 없으면 호출 쪽 기본값).
 * 계획 없이 / 지금 고른 재수강·포기 반영 / 추천 계획 반영
 */
export function targetAnalysis(scn, settings, target, credits, { retakeGrade, mode } = {}) {
  const base = withoutPlans(scn);
  const rows = [{ key: 'base', label: '계획 없이', ...reach(cumulative(base, settings), target, credits, settings) }];
  const hasPlan = allCourses(scn).some(({ c }) => c.plan === 'retake' || c.plan === 'waive');
  if (hasPlan) rows.push({ key: 'plan', label: '지금 고른 재수강·포기 반영', ...reach(cumulative(applyPlans(base), settings), target, credits, settings) });
  const adv = planAdvice(scn, settings, { retakeGrade, mode: mode || defaultAdviceMode(scn) });
  const best = adv.rows[adv.rows.length - 1];
  if (best && (best.k || best.waives.length) && !best.matchesCurrent) {
    const rMap = new Map(best.retakes.map((x) => [x.c.id, x.grade]));
    rows.push({
      key: 'best', label: `추천 계획 반영 (재수강 ${best.k} · 포기 ${fmtNum(best.waiveCredits)}학점)`,
      ...reach(cumulative(applyChoice(base, rMap, new Set(best.waives.map((x) => x.c.id))), settings), target, credits, settings),
    });
  }
  return { target, credits, rows };
}

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
