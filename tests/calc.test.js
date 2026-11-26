import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../js/domain/grades.js';
import { summarize, semesterStats, buildRetake, cumulative } from '../js/domain/calc.js';
import { waiveCheck, planLists, retakeOriginOptions, applyPlans, compareRetakeVsWaive, retakeSemesterImpact, syncFromCurrent } from '../js/domain/rules.js';
import { checkRegistration } from '../js/domain/registration.js';
import { planAdvice, requiredAverage, targetAnalysis, pendingLetterCredits } from '../js/domain/advisor.js';

let n = 0;
const C = (o) => ({ id: `c${++n}`, name: o.name || `과목${n}`, credits: 3, category: '전공핵심', isRequired: false, delivery: 'offline',
  plan: 'none', gradingType: 'letter', grade: null, retakeOf: null, waived: false, ...o });
const S = (year, term, courses, o = {}) => ({ id: `s${year}_${term}`, year, term, courses, locked: false, isPlanned: false, ...o });
const scn = (...semesters) => ({ id: 'current', kind: 'current', semesters });
const st = defaultSettings();

test('PRD 4장 예시: A+ 3, B0 3, P 2 → 3.75 / 92.5 / 8학점', () => {
  const s = scn(S(2024, '1', [C({ grade: 'A+' }), C({ grade: 'B0' }), C({ gradingType: 'pf', grade: 'P', credits: 2 })]));
  const r = summarize(s, st);
  assert.equal(r.gpa, 3.75);
  assert.equal(r.percentile, 92.5);
  assert.equal(r.earned, 8);
});

test('F는 0점으로 평점에 포함, 이수 학점 제외 / NP는 둘 다 제외', () => {
  const s = scn(S(2024, '1', [C({ grade: 'A0' }), C({ grade: 'F' }), C({ gradingType: 'pf', grade: 'NP' })]));
  const r = summarize(s, st);
  assert.equal(r.gpa, 2.0);
  assert.equal(r.earned, 3);
});

test('등급평가 과목이 없으면 평점 null', () => {
  const s = scn(S(2024, '1', [C({ gradingType: 'pf', grade: 'P' })]));
  assert.equal(summarize(s, st).gpa, null);
});

test('소수점 셋째 자리 반올림', () => {
  // (4.5*3 + 3.5*3 + 3.0*1) / 7 = 27/7 = 3.857 → 3.86
  const s = scn(S(2024, '1', [C({ grade: 'A+' }), C({ grade: 'B+' }), C({ grade: 'B0', credits: 1 })]));
  assert.equal(summarize(s, st).gpa, 3.86);
});

test('재수강: 좋은 성적 1개만 누적, A+는 A0로 계산, 학점 중복 없음', () => {
  const orig = C({ grade: 'C+', name: '통계학' });
  const re = C({ grade: 'A+', name: '통계학', retakeOf: orig.id });
  const other = C({ grade: 'A0' });
  const s = scn(S(2024, '1', [orig, other]), S(2025, '1', [re]));
  const r = summarize(s, st);
  assert.equal(r.gpa, 4.0); // (4.0*3 + 4.0*3)/6
  assert.equal(r.earned, 6);
  assert.ok(r.rt.discarded.has(orig.id));
  // 학기 평점: 원래 기록 유지
  assert.equal(r.semStats.get('s2024_1').gpa, 3.25);
});

test('재수강 성적이 더 낮으면 원래 성적이 남는다', () => {
  const orig = C({ grade: 'C+' });
  const re = C({ grade: 'D0', retakeOf: orig.id });
  const s = scn(S(2024, '1', [orig]), S(2025, '1', [re]));
  const rt = buildRetake(s, st);
  assert.ok(rt.discarded.has(re.id));
  assert.equal(cumulative(s, st).gpa, 2.5);
});

test('재수강 옵션: 제외 / 새 성적 반영', () => {
  const orig = C({ grade: 'C0' });
  const keep = C({ grade: 'A0' });
  const re = C({ grade: 'B+', retakeOf: orig.id });
  const s = scn(S(2024, '1', [orig, keep]), S(2025, '1', [re, C({ grade: 'B0' })]));
  const sem1 = s.semesters[0], sem2 = s.semesters[1];
  assert.equal(semesterStats(s, sem1, st, null, 'keep').gpa, 3.0);
  assert.equal(semesterStats(s, sem1, st, null, 'exclude').gpa, 4.0);
  assert.equal(semesterStats(s, sem1, st, null, 'replace').gpa, 3.75);
  assert.equal(semesterStats(s, sem2, st, null, 'replace').gpa, 3.0); // 재수강 과목은 원래 학기로 이동
  assert.equal(semesterStats(s, sem2, st, null, 'keep').gpa, 3.25);
});

test('계절학기: 학기 우수 표시 없음, 누적에는 반영', () => {
  const s = scn(S(2024, '1', [C({ grade: 'B0' })]), S(2024, 'summer', [C({ grade: 'A+' })]));
  const r = summarize(s, st);
  assert.equal(r.gpa, 3.75);
  assert.equal(r.semStats.get('s2024_summer').honors, null);
});

test('우수 4.00 이상, 우등 3.75~4.00', () => {
  const a = scn(S(2024, '1', [C({ grade: 'A0' })]));
  const b = scn(S(2024, '1', [C({ grade: 'A0' }), C({ grade: 'B+' })]));
  assert.equal(summarize(a, st).semStats.get('s2024_1').honors, '우수');
  assert.equal(summarize(b, st).semStats.get('s2024_1').honors, '우등');
});

test('학점포기: W는 누적·이수에서 빠지고 포기 전 평점은 유지', () => {
  const w = C({ grade: 'C0', waived: true });
  const s = scn(S(2024, '1', [C({ grade: 'A0' }), w]));
  const r = summarize(s, st);
  assert.equal(r.gpa, 4.0);
  assert.equal(r.preWaiveGpa, 3.0);
  assert.equal(r.earned, 3);
  assert.equal(r.waived, 3);
});

test('학점포기: 학기 평점(원래 기록)·졸업평점에는 포함, 성적증명서·이수 학점에서는 제외', () => {
  const s = scn(S(2024, '1', [C({ grade: 'A0' }), C({ grade: 'C0', waived: true })]));
  const r = summarize(s, st);
  const t = r.semStats.get('s2024_1');
  assert.equal(t.gpa, 3.0); // 원래 기록
  assert.equal(t.certGpa, 4.0); // 성적증명서 기준
  assert.equal(t.earned, 3);
  assert.equal(t.waivedCr, 3);
  assert.equal(r.gpa, 4.0); // 누적(증명용)
  assert.equal(r.preWaiveGpa, 3.0); // 졸업평점
});

test('학점포기 제약: P/F·필수 지정·일반선택·재수강·한도', () => {
  const pf = C({ gradingType: 'pf', grade: 'P' });
  const req = C({ grade: 'B0', isRequired: true });
  const gen = C({ grade: 'B0', category: '일반선택' });
  const cond = C({ grade: 'B0', category: '교양필수' });
  const orig = C({ grade: 'C0' });
  const re = C({ grade: 'A0', retakeOf: orig.id });
  const big = C({ grade: 'B0', credits: 6 });
  const used = C({ grade: 'C0', credits: 6, waived: true });
  const s = scn(S(2024, '1', [pf, req, gen, cond, orig, big, used]), S(2025, '1', [re]));
  assert.equal(waiveCheck(s, st, pf).ok, false);
  assert.equal(waiveCheck(s, st, req).ok, false);
  assert.equal(waiveCheck(s, st, gen).ok, false);
  assert.equal(waiveCheck(s, st, orig).ok, false);
  assert.equal(waiveCheck(s, st, big).ok, false); // 6 + 6 > 9
  const c = waiveCheck(s, st, cond);
  assert.equal(c.ok, true);
  assert.equal(c.conditional, true);
});

test('재수강 원과목 목록: C+ 이하, 포기 과목 제외', () => {
  const a = C({ grade: 'C+' }), b = C({ grade: 'B0' }), f = C({ grade: 'F' }), w = C({ grade: 'D0', waived: true });
  const s = scn(S(2024, '1', [a, b, f, w]));
  const ids = retakeOriginOptions(s, st).map((x) => x.c.id);
  assert.deepEqual(ids.sort(), [a.id, f.id].sort());
});

test('후보 목록: 계획 상태에 따라 반대쪽 잠금', () => {
  const x = C({ grade: 'C0', category: '전공심화', plan: 'retake' });
  const s = scn(S(2024, '1', [x]));
  const L = planLists(s, st);
  assert.equal(L.retake[0].blocked, null);
  assert.equal(L.waive[0].blocked, '재수강 예정 과목');
  const cmp = compareRetakeVsWaive(s, st, x);
  assert.equal(cmp.retake, 4.0);
  assert.equal(cmp.waive, null);
});

test('시뮬레이션: 재수강·포기 계획을 세운 과목도 후보 목록에 남아 해제할 수 있다', () => {
  const a = C({ grade: 'C+', plan: 'retake', planGrade: 'A0' });
  const auto = C({ grade: 'A0', retakeOf: a.id, autoFromPlan: a.id, assumption: 'retake' });
  const w = C({ grade: 'B0', category: '전공심화', plan: 'waive', waived: true, assumption: 'waive' });
  const s = scn(S(2024, '1', [a, w]), S(2027, '1', [auto], { isPlanned: true }));
  const L = planLists(s, st);
  assert.ok(L.retake.some((x) => x.c.id === a.id));
  assert.ok(L.waive.some((x) => x.c.id === w.id && x.c === w)); // 원본 객체를 돌려준다
  assert.ok(!L.waive.some((x) => x.c.id === auto.id));
});

test('계획 반영(가상)', () => {
  const a = C({ grade: 'A0' });
  const b = C({ grade: 'C0', plan: 'retake', planGrade: 'B+' });
  const s = scn(S(2024, '1', [a, b]));
  assert.equal(cumulative(applyPlans(s), st).gpa, 3.75);
});

test('수강신청 조건: e-러닝 C형 2과목, 계절 한도', () => {
  const s = scn(
    S(2027, '1', [C({ delivery: 'elearning_c' }), C({ delivery: 'elearning_c' }), C({})], { isPlanned: true }),
    S(2027, 'summer', [C({}), C({}), C({})], { isPlanned: true }),
  );
  const r = checkRegistration(s, st);
  assert.equal(r.errors.filter((e) => /e-러닝/.test(e.msg)).length, 2);
  assert.equal(r.errors.filter((e) => /계절학기 한도/.test(e.msg)).length, 1);
});

test('계절학기 직전 정규학기 수강 과목 신청 불가', () => {
  const s = scn(S(2027, '1', [C({ name: '회계원리' })], { isPlanned: true }), S(2027, 'summer', [C({ name: '회계원리' })], { isPlanned: true }));
  assert.equal(checkRegistration(s, st).errors.length, 1);
});

test('통합 추천: 재수강 수별 최적, 필수·일반선택 포기 제외, 9학점 이내', () => {
  const s = scn(S(2024, '1', [
    C({ grade: 'A+' }), C({ grade: 'A+' }), C({ grade: 'C0' }), C({ grade: 'B0' }), C({ grade: 'D0', isRequired: true }),
    C({ grade: 'C+', category: '일반선택' }), C({ grade: 'B+' }), C({ grade: 'C+', credits: 6 }),
  ]));
  const r = planAdvice(s, st);
  assert.ok(r.rows.length >= 2);
  assert.equal(r.rows[0].k, 0);
  for (const row of r.rows) {
    assert.ok(row.waiveCredits <= 9);
    assert.ok(!row.waives.some((x) => x.c.isRequired || x.c.category === '일반선택'));
    const ids = new Set(row.retakes.map((x) => x.c.id));
    assert.ok(!row.waives.some((x) => ids.has(x.c.id))); // 한 과목은 하나만
  }
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].gpa > r.rows[i - 1].gpa);
  // 재수강 1과목이면 효과가 가장 큰 D0(필수, 포기 불가) 과목
  assert.equal(r.rows[1].retakes[0].c.grade, 'D0');
});

test('통합 추천: B0를 두고 B+를 포기하지 않는다', () => {
  const s = scn(S(2024, '1', [C({ grade: 'A0', credits: 12 }), C({ grade: 'B+' }), C({ grade: 'B0' })]), );
  const st2 = { ...st, waiveLimit: 3 };
  const r = planAdvice(s, st2, { maxRetake: 0 });
  assert.deepEqual(r.rows[0].waives.map((x) => x.c.grade), ['B0']);
});

test('통합 추천: 이미 세운 계획도 후보에 다시 넣고 한도를 쓰지 않은 것으로 본다', () => {
  const a = C({ grade: 'C0', category: '전공심화', plan: 'waive', waived: true, assumption: 'waive' });
  const b = C({ grade: 'D0', category: '전공심화' });
  const s = scn(S(2024, '1', [C({ grade: 'A0', credits: 12 }), a, b, C({ grade: 'B0', category: '전공심화', credits: 3 })]));
  const r = planAdvice(s, { ...st, waiveLimit: 6 }, { maxRetake: 0 });
  assert.equal(r.remain, 6);
  assert.deepEqual(r.rows[0].waives.map((x) => x.c.grade).sort(), ['C0', 'D0']);
  assert.equal(r.rows[0].matchesCurrent, false);
});

test('추천 (내 재수강 고정): 재수강 예정 과목은 포기 후보에서 빠지고 포기 학점별로 나온다', () => {
  const r1 = C({ grade: 'C0', category: '전공심화', plan: 'retake', planGrade: 'B+' });
  const s = scn(S(2024, '1', [C({ grade: 'A0', credits: 12 }), r1, C({ grade: 'D0', category: '전공심화' }), C({ grade: 'C+', category: '전공핵심' }), C({ grade: 'B0', category: '전공핵심' })]));
  const r = planAdvice(s, st, { mode: 'fixed' });
  assert.equal(r.rows[0].label, '포기 안 함');
  for (const row of r.rows) {
    assert.deepEqual(row.retakes.map((x) => [x.c.id, x.grade]), [[r1.id, 'B+']]); // 내 예상 성적 그대로
    assert.ok(!row.waives.some((x) => x.c.id === r1.id));
  }
  assert.deepEqual(r.rows.map((x) => x.waiveCredits), [0, 3, 6, 9]);
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].gpa > r.rows[i - 1].gpa);
});

test('목표 역산: 성적 미정 과목 학점을 남은 학점으로, 예상 성적은 반영', () => {
  const s = scn(S(2024, '1', [C({ grade: 'B0', credits: 15 })]), S(2027, '1', [C({ grade: 'A0', credits: 3 }), C({ grade: null, credits: 6 })], { isPlanned: true }));
  assert.equal(pendingLetterCredits(s), 6);
  const r = targetAnalysis(s, st, 3.5, 6);
  // (3*15 + 4*3) = 57, C = 18 → 3.5*24 - 57 = 27 → 6학점 평균 4.5
  assert.equal(r.rows[0].need, 4.5);
});

test('통합 추천: 같은 결과의 다른 조합은 대안으로 묶는다', () => {
  const s = scn(S(2024, '1', [C({ grade: 'A0', credits: 12 }), C({ name: '가', grade: 'B0' }), C({ name: '나', grade: 'B0' })]));
  const r = planAdvice(s, { ...st, waiveLimit: 3 }, { maxRetake: 0 });
  assert.equal(r.rows[0].waives.length, 1);
  assert.equal(r.rows[0].alts.length, 1);
});

test('현재에서 불러오기: 새 학기·성적 변경·삭제는 가져오고 가정은 유지', () => {
  const a = C({ grade: null }), b = C({ grade: 'B0' }), gone = C({ grade: 'A0' }), edited = C({ grade: 'C0' });
  const cur = scn(S(2024, '1', [a, b, gone, edited]));
  const sim = JSON.parse(JSON.stringify(cur));
  sim.kind = 'simulation';
  sim.semesters[0].courses.find((x) => x.id === edited.id).grade = 'A+';
  sim.semesters[0].courses.find((x) => x.id === edited.id).assumption = 'edited';
  sim.semesters.push(S(2027, '1', [C({ grade: 'A0', assumption: 'planned' })], { isPlanned: true }));
  // 현재 탭에서 변경
  a.grade = 'A0';
  cur.semesters[0].courses = cur.semesters[0].courses.filter((x) => x !== gone);
  cur.semesters.push(S(2025, '1', [C({ grade: 'B+' })]));
  edited.grade = 'D0';
  const n = syncFromCurrent(sim, cur);
  assert.deepEqual(n, { addedSem: 1, addedCourse: 1, updated: 1, removed: 1 });
  const g = (id) => sim.semesters.flatMap((s) => s.courses).find((x) => x.id === id);
  assert.equal(g(a.id).grade, 'A0');
  assert.equal(g(edited.id).grade, 'A+'); // 가정 유지
  assert.equal(g(gone.id), undefined);
  assert.ok(sim.semesters.some((s) => s.isPlanned)); // 예정 학기 유지
});

test('재수강 계획의 학기 평점 영향 (옵션별)', () => {
  const orig = C({ grade: 'C0', plan: 'retake', planGrade: 'A0' });
  const s = scn(S(2024, '1', [orig, C({ grade: 'A0' })]));
  const [x] = retakeSemesterImpact(s, st);
  assert.equal(x.before, 3.0);
  assert.equal(x.keep, 3.0);
  assert.equal(x.exclude, 4.0);
  assert.equal(x.replace, 4.0);
  assert.equal(x.current, 3.0);
});

test('목표 평점 역산: 4.5만 받아도 최소 학점, 계획 반영 비교', () => {
  // 누적 3.0 (18학점), 목표 3.5 → 부족분 9 → 4.5면 최소 9학점, A0면 18학점
  const x = C({ grade: 'D0', credits: 3, category: '전공심화', plan: 'retake', planGrade: 'A0' });
  const s = scn(S(2024, '1', [C({ grade: 'B0', credits: 15 }), { ...x, grade: 'B0' }]));
  const r = targetAnalysis(s, st, 3.5, 18);
  assert.equal(r.rows[0].minMax, 9);
  assert.equal(r.rows[0].minA0, 18);
  assert.equal(r.rows[1].key, 'plan');
  // 목표가 A0(4.0) 이상이면 A0로는 불가
  assert.equal(targetAnalysis(s, st, 4.2, 18).rows[0].minA0, null);
});

test('목표 평점 역산', () => {
  const s = scn(S(2024, '1', [C({ grade: 'B+', credits: 18 })]));
  const r = requiredAverage(s, st, 4.0, 18);
  assert.equal(r.need, 4.5);
  assert.equal(r.possible, true);
});
