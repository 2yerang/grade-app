// 학점포기 추천 (PRD 5.3), 목표 평점 역산 (F-14)
import { cumulative, percentile, waivedCredits, allCourses, round2 } from './calc.js';
import { waiveCheck, cloneScenario } from './rules.js';
import { effectivePoint } from './grades.js';

const NODE_LIMIT = 300000;

export function waiveAdvice(scn, settings, { top = 3 } = {}) {
  const base = cumulative(scn, settings);
  if (base.gpa == null) return { base, results: [], remain: 0 };
  const remain = settings.waiveLimit - waivedCredits(scn);
  const cands = [];
  for (const { c, s } of allCourses(scn)) {
    if (s.isPlanned) continue;
    const chk = waiveCheck(scn, settings, c, { ignoreLimit: true });
    if (!chk.ok) continue;
    if (c.plan === 'retake' || c.plan === 'waive') continue;
    if (chk.conditional && !settings.advisorIncludeConditional) continue;
    if (c.credits > remain) continue;
    const p = effectivePoint(c, settings);
    if (p >= settings.scale) continue; // 만점 과목은 포기해도 오르지 않음
    cands.push({ c, s, p, chk });
  }
  cands.sort((a, b) => a.p - b.p || b.c.credits - a.c.credits);

  // 학점 가중 합으로 빠르게 평가
  const P = base.points, C = base.gradedCredits;
  const results = [];
  let nodes = 0;
  const pick = [];
  const dfs = (i, cr, pts, gcr) => {
    if (++nodes > NODE_LIMIT) return;
    if (pick.length) {
      const gpa = C - gcr > 0 ? round2((P - pts) / (C - gcr)) : null;
      if (gpa != null && gpa > base.gpa) results.push({ items: [...pick], credits: cr, gpa });
    }
    for (let j = i; j < cands.length; j++) {
      const x = cands[j];
      if (cr + x.c.credits > remain) continue;
      pick.push(x);
      dfs(j + 1, cr + x.c.credits, pts + x.p * x.c.credits, gcr + x.c.credits);
      pick.pop();
    }
  };
  dfs(0, 0, 0, 0);

  results.sort((a, b) => b.gpa - a.gpa || a.credits - b.credits || a.items.length - b.items.length);
  const out = [];
  const seen = new Set();
  for (const r of results) {
    const key = r.items.map((x) => x.c.id).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    // 실제 계산으로 검증 (재수강 묶음 등 반영)
    const x = cloneScenario(scn);
    const ids = new Set(r.items.map((i) => i.c.id));
    for (const s of x.semesters) for (const c of s.courses) if (ids.has(c.id)) c.waived = true;
    const real = cumulative(x, settings).gpa;
    out.push({
      ...r,
      gpa: real,
      percentile: percentile(real, settings),
      delta: round2(real - base.gpa),
      retakeNeeded: r.items.filter((i) => i.chk.retakeNeeded).reduce((a, i) => a + i.c.credits, 0),
      conditional: r.items.some((i) => i.chk.conditional),
    });
    if (out.length >= top) break;
  }
  return { base, results: out, remain, truncated: nodes > NODE_LIMIT };
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
