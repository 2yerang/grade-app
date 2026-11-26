import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../js/domain/grades.js';
import { summarize, semesterStats, buildRetake, cumulative } from '../js/domain/calc.js';
import { waiveCheck, planLists, retakeOriginOptions, applyPlans, compareRetakeVsWaive } from '../js/domain/rules.js';
import { checkRegistration } from '../js/domain/registration.js';
import { waiveAdvice, requiredAverage } from '../js/domain/advisor.js';

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

test('학점포기 추천: 9학점 이내, 상승폭 순', () => {
  const s = scn(S(2024, '1', [
    C({ grade: 'A+' }), C({ grade: 'A+' }), C({ grade: 'C0' }), C({ grade: 'B0' }), C({ grade: 'D0', isRequired: true }),
    C({ grade: 'C+', category: '일반선택' }), C({ grade: 'B+' }), C({ grade: 'C+', credits: 6 }),
  ]));
  const r = waiveAdvice(s, st);
  assert.ok(r.results.length > 0 && r.results.length <= 3);
  for (const x of r.results) {
    assert.ok(x.credits <= 9);
    assert.ok(x.delta > 0);
    assert.ok(!x.items.some((i) => i.c.isRequired || i.c.category === '일반선택'));
  }
  assert.ok(r.results[0].gpa >= r.results[1].gpa);
});

test('목표 평점 역산', () => {
  const s = scn(S(2024, '1', [C({ grade: 'B+', credits: 18 })]));
  const r = requiredAverage(s, st, 4.0, 18);
  assert.equal(r.need, 4.5);
  assert.equal(r.possible, true);
});
