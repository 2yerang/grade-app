// 앱 진입점: 이벤트 → 동작 → 저장 → 다시 그리기
import { state, load, save, activeScenario, currentScenario, settings, isSim, uid, today, exportJson, normalize, mergeData, emptyData, nowIso } from './store.js';
import { renderApp, semTitle } from './ui/views.js';
import { mountLayer, confirmDialog, alertDialog, promptDialog, actionSheet, pickDialog, toast } from './ui/dialogs.js';
import { openCourseSheet } from './ui/sheet.js';
import { esc, icon, fmtGpa, fmtCr } from './ui/h.js';
import { TERMS, TERM_BY_ID, LETTERS, categoryInfo } from './domain/grades.js';
import { semName, sortSemesters, cumulative, waivedCredits, allCourses, isSeasonal } from './domain/calc.js';
import { waiveCheck, findCourse, cloneScenario, nextTerm, syncFromCurrent } from './domain/rules.js';
import { planAdvice } from './domain/advisor.js';

const root = document.getElementById('root');
mountLayer(document.getElementById('layer'));

function render() { renderApp(root); }
function commit() { save(); render(); }
const st = () => settings();

function go(route) {
  state.ui.route = route;
  state.ui.drawer = false;
  render();
  const c = root.querySelector('.content');
  if (c) c.scrollTop = 0;
}

function applyTheme() {
  const t = st().theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  // 테마를 직접 고른 경우 두 meta(라이트/다크용) 모두 같은 색으로
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const forDark = (m.getAttribute('media') || '').includes('dark');
    m.setAttribute('content', t === 'system' ? (forDark ? '#181C23' : '#FFFFFF') : dark ? '#181C23' : '#FFFFFF');
  });
}

function semById(scn, id) { return scn.semesters.find((s) => s.id === id); }

// ── 잠금 ──
async function ensureUnlocked(sem) {
  if (isSim() || !sem.locked) return true;
  const ok = await confirmDialog({
    title: '확정된 학기입니다',
    body: `${esc(semName(sem))} 성적은 확정되었습니다. 잠금을 해제하고 수정하겠습니까?`,
    note: '해제 후 다시 잠그는 건 직접 해야 합니다.',
    ok: '잠금 해제',
    iconHtml: icon.lock(18),
  });
  if (!ok) return false;
  sem.locked = false;
  sem.lockedAt = null;
  commit();
  return true;
}

async function lockSemester(sem) {
  const pend = sem.courses.filter((c) => c.grade == null && !c.waived).length;
  if (pend) return alertDialog({ title: '확정할 수 없습니다', body: `미정 과목 ${pend}개가 있습니다. 성적을 모두 입력한 뒤 확정하세요.` });
  if (!sem.courses.length) return alertDialog({ title: '확정할 수 없습니다', body: '과목이 없는 학기입니다.' });
  sem.locked = true;
  sem.lockedAt = today();
  commit();
  toast(`${semName(sem)} 성적을 확정했습니다`);
}

// ── 학기 ──
function termOptions() { return TERMS.map((t) => ({ value: t.id, label: t.label })); }
const levelOptions = [{ value: '', label: '선택 안 함' }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n}학년` }))];

async function addSemester({ planned = false } = {}) {
  const scn = activeScenario();
  const nx = nextTerm(scn);
  const last = sortSemesters(scn.semesters).filter((s) => s.gradeLevel).pop();
  const v = await promptDialog({
    title: planned ? '예정 학기 추가' : '학기 추가',
    body: planned ? '시뮬레이션 안에서만 쓰는 예정 학기입니다.' : '',
    fields: [
      { name: 'year', label: '연도', type: 'number', value: nx.year },
      { name: 'term', label: '학기', type: 'select', value: nx.term, options: termOptions() },
      { name: 'gradeLevel', label: '학년 (선택)', type: 'select', value: last ? String(last.gradeLevel) : '', options: levelOptions },
    ],
    ok: '추가',
    validate: (x) => {
      const y = Number(x.year);
      if (!Number.isInteger(y) || y < 1990 || y > 2100) return '연도를 올바르게 입력하세요';
      if (scn.semesters.some((s) => s.year === y && s.term === x.term)) return '이미 있는 학기입니다';
      return null;
    },
  });
  if (!v) return;
  const sem = {
    id: `sem_${v.year}_${v.term}_${Math.random().toString(36).slice(2, 5)}`, year: Number(v.year), term: v.term,
    isSeasonal: TERM_BY_ID[v.term].seasonal, gradeLevel: v.gradeLevel ? Number(v.gradeLevel) : null,
    locked: false, lockedAt: null, isPlanned: planned || isSim(), courses: [],
  };
  scn.semesters.push(sem);
  save();
  go({ name: 'semester', id: sem.id });
}

async function editSemester(sem) {
  if (!(await ensureUnlocked(sem))) return;
  const scn = activeScenario();
  const v = await promptDialog({
    title: '학기 편집',
    fields: [
      { name: 'year', label: '연도', type: 'number', value: sem.year },
      { name: 'term', label: '학기', type: 'select', value: sem.term, options: termOptions() },
      { name: 'gradeLevel', label: '학년 (선택)', type: 'select', value: sem.gradeLevel ? String(sem.gradeLevel) : '', options: levelOptions },
    ],
    ok: '저장',
    validate: (x) => {
      const y = Number(x.year);
      if (!Number.isInteger(y) || y < 1990 || y > 2100) return '연도를 올바르게 입력하세요';
      if (scn.semesters.some((s) => s !== sem && s.year === y && s.term === x.term)) return '이미 있는 학기입니다';
      return null;
    },
  });
  if (!v) return;
  sem.year = Number(v.year);
  sem.term = v.term;
  sem.isSeasonal = TERM_BY_ID[v.term].seasonal;
  sem.gradeLevel = v.gradeLevel ? Number(v.gradeLevel) : null;
  commit();
}

async function deleteSemester(sem) {
  if (!(await ensureUnlocked(sem))) return;
  const ok = await confirmDialog({
    title: '학기 삭제', body: `${esc(semName(sem))}을(를) 삭제합니다. 과목 ${sem.courses.length}개가 함께 삭제됩니다.`, ok: '삭제', danger: true,
  });
  if (!ok) return;
  const scn = activeScenario();
  const ids = new Set(sem.courses.map((c) => c.id));
  scn.semesters = scn.semesters.filter((s) => s !== sem);
  let unlinked = 0;
  for (const { c } of allCourses(scn)) {
    if (c.retakeOf && ids.has(c.retakeOf)) { c.retakeOf = null; unlinked++; }
    if (c.autoFromPlan) { /* 원과목이 지워졌으면 그대로 둠 */ }
  }
  for (const s of scn.semesters) for (const c of s.courses) if (c.plan === 'retake' && sem.courses.some((x) => x.autoFromPlan === c.id)) c.plan = 'none';
  save();
  go({ name: 'dashboard' });
  if (unlinked) toast(`재수강 연결 ${unlinked}건이 끊겼습니다`);
}

async function semMenu(sem) {
  const a = await actionSheet({
    title: semTitle(sem),
    actions: [
      { id: 'edit', label: '학기 편집', hint: '연도 · 학기 · 학년' },
      ...(!isSim() && !sem.isPlanned ? [sem.locked ? { id: 'unlock', label: '잠금 해제' } : { id: 'lock', label: '성적 확정 (잠금)' }] : []),
      { id: 'delete', label: '학기 삭제', danger: true },
    ],
  });
  if (a === 'edit') editSemester(sem);
  if (a === 'delete') deleteSemester(sem);
  if (a === 'lock') lockSemester(sem);
  if (a === 'unlock') ensureUnlocked(sem);
}

// ── 과목 ──
function openSheet(sem, course) {
  const scn = activeScenario();
  openCourseSheet({
    scn, scnName: scn.name, sem, course, settings: st(), sim: isSim(),
    onSave: (data, existing) => {
      const sim = isSim();
      if (existing) {
        Object.assign(existing, data);
        if (sim && !existing.assumption) existing.assumption = sem.isPlanned ? 'planned' : 'edited';
      } else {
        sem.courses.push({
          id: uid('crs'), ...data, plan: 'none', planGrade: null, waived: false, waivedAt: null,
          assumption: sim ? (sem.isPlanned ? 'planned' : 'edited') : null, autoFromPlan: null,
        });
      }
      if (data.retakeOf) {
        const o = findCourse(scn, data.retakeOf);
        if (o && o.c.plan === 'retake' && !sim) o.c.plan = 'none';
      }
      commit();
      toast(existing ? '수정했습니다' : `${data.name} 추가`);
    },
  });
}

async function openCourse(semId, id) {
  const scn = activeScenario();
  const sem = semById(scn, semId);
  const c = sem?.courses.find((x) => x.id === id);
  if (!c) return;
  if (!(await ensureUnlocked(sem))) return;
  openSheet(sem, c);
}

async function deleteCourse(sem, c) {
  if (!(await ensureUnlocked(sem))) return;
  const ok = await confirmDialog({ title: '과목 삭제', body: `${esc(c.name)} (${fmtCr(c.credits)}학점)을 삭제합니다. 수강철회한 과목도 삭제로 처리합니다.`, ok: '삭제', danger: true });
  if (!ok) return;
  const scn = activeScenario();
  const snapshot = JSON.stringify(scn.semesters);
  sem.courses = sem.courses.filter((x) => x !== c);
  let unlinked = 0;
  for (const { c: x } of allCourses(scn)) if (x.retakeOf === c.id) { x.retakeOf = null; unlinked++; }
  if (c.autoFromPlan) { const o = findCourse(scn, c.autoFromPlan); if (o) o.c.plan = 'none'; }
  commit();
  toast(`${c.name} 삭제${unlinked ? ` · 재수강 연결 ${unlinked}건 해제` : ''}`, {
    action: '실행 취소', ms: 5000,
    onAction: () => { scn.semesters = JSON.parse(snapshot); commit(); },
  });
}

async function courseMenu(semId, id) {
  const scn = activeScenario();
  const sem = semById(scn, semId);
  const c = sem?.courses.find((x) => x.id === id);
  if (!c) return;
  const sim = isSim();
  const chk = waiveCheck(scn, st(), c);
  const actions = [
    { id: 'edit', label: '수정', hint: sem.locked && !sim ? '잠긴 학기 — 잠금 해제 후 수정' : '' },
    { id: 'retake', label: '재수강 연결', hint: c.retakeOf ? '원과목 바꾸기·해제' : '이 과목이 재수강이면 원과목 선택' },
  ];
  if (c.waived) actions.push({ id: 'unwaive', label: sim ? '학점포기 가정 해제' : '학점포기 해제', hint: '실수로 적용한 경우' });
  else actions.push({ id: 'waive', label: sim ? '학점포기 가정' : '학점포기 적용', hint: chk.ok ? (chk.conditional ? '조건부 — 개설 여부 확인 필요' : '잠금과 관계없이 적용') : chk.reason, disabled: !chk.ok });
  actions.push({ id: 'delete', label: '삭제', danger: true });
  const a = await actionSheet({ title: c.name, sub: `${semName(sem)} · ${c.category} · ${fmtCr(c.credits)}학점 · ${c.waived ? 'W' : c.grade || '미정'}`, actions });
  if (a === 'edit' || a === 'retake') openCourse(semId, id);
  if (a === 'delete') deleteCourse(sem, c);
  if (a === 'waive') applyWaive(c);
  if (a === 'unwaive') unWaive(c);
}

// ── 학점포기 ──
async function applyWaive(c) {
  const scn = activeScenario();
  const sim = isSim();
  const chk = waiveCheck(scn, st(), c);
  if (!chk.ok) return alertDialog({ title: '학점포기할 수 없습니다', body: esc(chk.reason) });
  if (!sim && !scn.waiveReqConfirmed) {
    const ok = await confirmDialog({
      title: '학점포기 신청 요건', body: '학점포기는 4학년이면서 유효한 학기성적이 6학기 이상이어야 신청할 수 있습니다. 요건을 충족했나요?', ok: '충족했습니다',
    });
    if (!ok) return;
    scn.waiveReqConfirmed = true;
    save();
  }
  if (chk.conditional) {
    const ok = await confirmDialog({
      title: '개설 여부 확인', body: `${esc(c.category)} 과목은 해당 학기에 개설되지 않은 과목만 학점포기할 수 있습니다. 이번 학기에 개설되지 않은 과목인가요?`, ok: '미개설 과목입니다',
    });
    if (!ok) return;
  }
  const before = cumulative(scn, st()).gpa;
  const x = cloneScenario(scn);
  findCourse(x, c.id).c.waived = true;
  const after = cumulative(x, st()).gpa;
  if (!sim) {
    const ok = await confirmDialog({
      title: '학점포기 적용',
      body: `${esc(c.name)} (${esc(c.grade)}, ${fmtCr(c.credits)}학점)에 W를 붙이고 누적 평점·이수 학점에서 뺍니다. 누적 <b class="mono">${fmtGpa(before)} → ${fmtGpa(after)}</b>`,
      note: `학점포기는 한 번 하면 되돌릴 수 없습니다. 포털에서 실제로 신청한 뒤에 적용하세요.${chk.retakeNeeded ? ' 핵심교양은 포기한 만큼 다시 이수해야 합니다.' : ''} 포기한 과목은 재수강할 수 없습니다.`,
      ok: '적용', danger: true,
    });
    if (!ok) return;
  }
  c.waived = true;
  c.waivedAt = sim ? null : today();
  if (c.plan === 'waive' || c.plan === 'none') c.plan = sim ? 'waive' : 'none';
  if (sim && !c.assumption) c.assumption = 'waive';
  commit();
  toast(`${c.name} 학점포기 ${sim ? '가정' : '적용'} · 누적 ${fmtGpa(after)}${chk.retakeNeeded ? ' · 재이수 필요' : ''}`);
}

async function unWaive(c) {
  const sim = isSim();
  if (!sim) {
    const ok = await confirmDialog({ title: '학점포기 해제', body: `${esc(c.name)}의 W를 지우고 원래 성적 ${esc(c.grade)}로 되돌립니다.`, note: '실수로 적용한 경우에만 해제하세요.', ok: '해제' });
    if (!ok) return;
  }
  c.waived = false;
  c.waivedAt = null;
  if (c.plan === 'waive') c.plan = 'none';
  if (c.assumption === 'waive') c.assumption = null;
  commit();
}

// ── 재수강·포기 계획 ──
function ensurePlannedSemester(scn) {
  let s = sortSemesters(scn.semesters).find((x) => x.isPlanned && !isSeasonal(x));
  if (!s) {
    const nx = nextTerm(scn);
    s = { id: `sem_${nx.year}_${nx.term}_${Math.random().toString(36).slice(2, 5)}`, year: nx.year, term: nx.term, isSeasonal: false, gradeLevel: null, locked: false, lockedAt: null, isPlanned: true, courses: [] };
    scn.semesters.push(s);
  }
  return s;
}

/** 시뮬레이션: 재수강 예정 과목을 예정 학기에 자동으로 넣는다 */
function addAutoRetake(scn, c) {
  const s = ensurePlannedSemester(scn);
  s.courses.push({
    id: uid('crs'), name: c.name, credits: c.credits, category: c.category, isRequired: c.isRequired, delivery: c.delivery, track: c.track,
    plan: 'none', planGrade: null, gradingType: 'letter', grade: c.planGrade, retakeOf: c.id, courseCode: c.courseCode,
    waived: false, waivedAt: null, assumption: 'retake', autoFromPlan: c.id,
  });
  return s;
}

/** 탭의 재수강·포기 계획을 모두 해제 (시뮬레이션의 자동 재수강 과목·포기 가정 포함) */
function clearPlans(scn) {
  const sim = scn.kind === 'simulation';
  for (const s of scn.semesters) s.courses = s.courses.filter((x) => !x.autoFromPlan);
  for (const { c } of allCourses(scn)) {
    if (c.plan === 'waive' && sim) { c.waived = false; c.waivedAt = null; if (c.assumption === 'waive') c.assumption = null; }
    c.plan = 'none';
  }
}

/** 추천 계획을 탭에 적용 */
function applyPlanSet(scn, row, grade) {
  const sim = scn.kind === 'simulation';
  clearPlans(scn);
  for (const x of row.retakes) {
    const c = findCourse(scn, x.c.id)?.c;
    if (!c) continue;
    c.plan = 'retake';
    c.planGrade = grade;
    if (sim) addAutoRetake(scn, c);
  }
  for (const x of row.waives) {
    const c = findCourse(scn, x.c.id)?.c;
    if (!c) continue;
    c.plan = 'waive';
    if (sim) { c.waived = true; c.waivedAt = null; if (!c.assumption) c.assumption = 'waive'; }
  }
}

async function togglePlan(kind, id) {
  const scn = activeScenario();
  const sim = isSim();
  const f = findCourse(scn, id);
  if (!f) return;
  const c = f.c;
  if (kind === 'retake') {
    if (c.plan === 'retake') {
      c.plan = 'none';
      if (sim) for (const s of scn.semesters) s.courses = s.courses.filter((x) => x.autoFromPlan !== c.id);
      return commit();
    }
    if (c.plan === 'waive' || c.waived) return alertDialog({ title: '변경할 수 없습니다', body: '포기 예정 과목입니다. 먼저 학점포기 계획을 해제하세요.' });
    c.plan = 'retake';
    c.planGrade = c.planGrade || st().retakeCap;
    if (sim) {
      const s = addAutoRetake(scn, c);
      commit();
      return toast(`${semName(s)}에 재수강 과목을 넣었습니다`);
    }
    return commit();
  }
  // waive
  if (sim && (c.waived || c.plan === 'waive')) return unWaive(c);
  if (!sim && c.plan === 'waive') { c.plan = 'none'; return commit(); }
  if (c.plan === 'retake') return alertDialog({ title: '변경할 수 없습니다', body: '재수강 예정 과목입니다. 먼저 재수강 계획을 해제하세요.' });
  if (sim) return applyWaive(c);
  const chk = waiveCheck(scn, st(), c, { ignoreLimit: true });
  if (!chk.ok) return alertDialog({ title: '학점포기할 수 없습니다', body: esc(chk.reason) });
  const plannedCr = allCourses(scn).filter(({ c: x }) => x.plan === 'waive' && !x.waived).reduce((a, { c: x }) => a + x.credits, 0);
  const remain = st().waiveLimit - waivedCredits(scn) - plannedCr;
  if (c.credits > remain) return alertDialog({ title: '한도를 넘습니다', body: `학점포기 한도를 넘습니다. 남은 한도 ${fmtCr(Math.max(0, remain))}학점` });
  if (chk.conditional) {
    const ok = await confirmDialog({ title: '개설 여부 확인', body: `${esc(c.category)} 과목은 해당 학기에 개설되지 않은 과목만 학점포기할 수 있습니다. 미개설 과목인가요?`, ok: '미개설 과목입니다' });
    if (!ok) return;
  }
  c.plan = 'waive';
  commit();
}

function setPlanGrade(id, g) {
  const scn = activeScenario();
  const f = findCourse(scn, id);
  if (!f) return;
  f.c.planGrade = g;
  for (const { c } of allCourses(scn)) if (c.autoFromPlan === id) c.grade = g;
  commit();
}

// ── 시뮬레이션 탭 ──
function nextSimName(prefix = '시뮬레이션') {
  const nums = state.data.scenarios.map((s) => Number((s.name.match(new RegExp(`^${prefix} (\\d+)$`)) || [])[1] || 0));
  return `${prefix} ${Math.max(0, ...nums) + 1}`;
}

function createSim(from, name, mutate) {
  const x = cloneScenario(from);
  x.id = uid('sim');
  x.name = name;
  x.kind = 'simulation';
  x.createdAt = x.updatedAt = nowIso();
  if (from.kind === 'current') for (const { c } of allCourses(x)) { c.assumption = null; }
  mutate && mutate(x);
  state.data.scenarios.push(x);
  state.ui.active = x.id;
  save();
  go({ name: 'dashboard' });
  return x;
}

async function tabMenu() {
  const scn = activeScenario();
  if (scn.kind !== 'simulation') return;
  const a = await actionSheet({
    title: scn.name,
    actions: [
      { id: 'rename', label: '이름 변경' },
      { id: 'dup', label: '복제' },
      { id: 'pull', label: '현재에서 불러오기', hint: '현재 탭에 추가·수정한 학기·과목·성적을 이 시뮬레이션으로' },
      { id: 'apply', label: '현재에 반영', hint: '예정 학기 과목·학점포기를 골라 현재 탭으로' },
      { id: 'compare', label: '비교 보기' },
      { id: 'delete', label: '삭제', danger: true },
    ],
  });
  if (a === 'rename') {
    const v = await promptDialog({ title: '이름 변경', fields: [{ name: 'name', label: '탭 이름', value: scn.name }], ok: '저장', validate: (x) => (!x.name ? '이름을 입력하세요' : x.name.length > 20 ? '20자 이내로 입력하세요' : null) });
    if (v) { scn.name = v.name; commit(); }
  }
  if (a === 'dup') createSim(scn, `${scn.name} 복제`);
  if (a === 'apply') applyToCurrent();
  if (a === 'pull') pullFromCurrent();
  if (a === 'compare') go({ name: 'compare' });
  if (a === 'delete') {
    const n = allCourses(scn).length;
    const ok = await confirmDialog({ title: '시뮬레이션 삭제', body: `${esc(scn.name)} 탭을 삭제합니다. 과목 ${n}개가 함께 삭제됩니다.`, ok: '삭제', danger: true });
    if (!ok) return;
    state.data.scenarios = state.data.scenarios.filter((s) => s !== scn);
    state.ui.active = 'current';
    save();
    go({ name: 'dashboard' });
  }
}

async function pullFromCurrent() {
  const sim = activeScenario();
  if (sim.kind !== 'simulation') return;
  const dry = cloneScenario(sim);
  const n = syncFromCurrent(dry, currentScenario());
  if (!n.addedSem && !n.addedCourse && !n.updated && !n.removed) return toast('현재 탭과 다른 점이 없습니다');
  const parts = [];
  if (n.addedSem) parts.push(`새 학기 ${n.addedSem}개`);
  if (n.addedCourse) parts.push(`새 과목 ${n.addedCourse}개`);
  if (n.updated) parts.push(`바뀐 과목 ${n.updated}개`);
  if (n.removed) parts.push(`현재 탭에서 지운 과목 ${n.removed}개 삭제`);
  const ok = await confirmDialog({
    title: '현재에서 불러오기',
    body: `현재 탭의 변경을 ${esc(sim.name)}에 가져옵니다: ${parts.join(', ')}.`,
    note: '이 시뮬레이션에서 직접 바꾼 과목(가정 표시), 예정 학기, 재수강·포기 계획은 그대로 둡니다.',
    ok: '불러오기',
  });
  if (!ok) return;
  syncFromCurrent(sim, currentScenario());
  commit();
  toast(`불러왔습니다 · ${parts.join(', ')}`);
}

async function applyToCurrent() {
  const sim = activeScenario();
  const cur = currentScenario();
  const items = [];
  for (const s of sortSemesters(sim.semesters).filter((x) => x.isPlanned)) {
    for (const c of s.courses) {
      const curSem = cur.semesters.find((x) => x.year === s.year && x.term === s.term);
      const dup = curSem && curSem.courses.some((x) => x.id === c.id || x.name === c.name);
      items.push({ value: `c:${s.id}:${c.id}`, label: `${semName(s)} · ${c.name}${c.retakeOf ? ' (재수강)' : ''}`, hint: dup ? '현재 탭에 이미 있음' : curSem?.locked ? '현재 탭의 해당 학기가 잠겨 있음' : `${fmtCr(c.credits)}학점 · ${c.category} · 성적은 미정으로`, disabled: dup || curSem?.locked, checked: !dup && !curSem?.locked });
    }
  }
  for (const { c, s } of allCourses(sim)) {
    if (!c.waived || s.isPlanned) continue;
    const cc = findCourse(cur, c.id);
    if (!cc || cc.c.waived) continue;
    const chk = waiveCheck(cur, st(), cc.c);
    items.push({ value: `w:${c.id}`, label: `학점포기 · ${c.name} ${c.grade} ${fmtCr(c.credits)}학점`, hint: chk.ok ? '실제로 신청한 뒤에만 반영하세요 (되돌릴 수 없음)' : chk.reason, disabled: !chk.ok, checked: false });
  }
  const picked = await pickDialog({ title: '현재에 반영', body: '가져올 항목을 고르세요. 예상 성적은 "미정"으로 들어갑니다.', items, ok: '가져오기', empty: '가져올 예정 학기 과목이나 학점포기가 없습니다.' });
  if (!picked || !picked.length) return;
  const waives = picked.filter((p) => p.startsWith('w:'));
  if (waives.length && !cur.waiveReqConfirmed) {
    const ok = await confirmDialog({ title: '학점포기 신청 요건', body: '4학년이면서 유효한 학기성적이 6학기 이상이어야 합니다. 요건을 충족했고 포털에서 실제로 신청했나요?', ok: '네, 신청했습니다' });
    if (!ok) return;
    cur.waiveReqConfirmed = true;
  }
  let nc = 0, nw = 0;
  for (const p of picked) {
    if (p.startsWith('c:')) {
      const [, semId, cid] = p.split(':');
      const s = semById(sim, semId);
      const c = s?.courses.find((x) => x.id === cid);
      if (!c) continue;
      let cs = cur.semesters.find((x) => x.year === s.year && x.term === s.term);
      if (!cs) {
        cs = { id: `sem_${s.year}_${s.term}_${Math.random().toString(36).slice(2, 5)}`, year: s.year, term: s.term, isSeasonal: TERM_BY_ID[s.term].seasonal, gradeLevel: s.gradeLevel, locked: false, lockedAt: null, isPlanned: false, courses: [] };
        cur.semesters.push(cs);
      }
      if (cs.locked) continue;
      const exists = !!findCourse(cur, c.id);
      const orig = c.retakeOf ? findCourse(cur, c.retakeOf) : null;
      cs.courses.push({ ...c, id: exists ? uid('crs') : c.id, grade: null, assumption: null, autoFromPlan: null, plan: 'none', planGrade: null, waived: false, waivedAt: null, retakeOf: orig ? c.retakeOf : null });
      if (orig && orig.c.plan === 'retake') orig.c.plan = 'none';
      nc++;
    } else {
      const cc = findCourse(cur, p.slice(2));
      if (!cc) continue;
      if (!waiveCheck(cur, st(), cc.c).ok) continue;
      cc.c.waived = true;
      cc.c.waivedAt = today();
      cc.c.plan = 'none';
      nw++;
    }
  }
  commit();
  toast(`현재 탭에 과목 ${nc}개${nw ? `, 학점포기 ${nw}건` : ''}을 반영했습니다`);
}

function runAdvisor() {
  const scn = activeScenario();
  state.ui.advisor = { scnId: scn.id, grade: state.ui.advisor?.grade || st().retakeCap };
  render();
  root.querySelector('#advice')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function adviceRow(idx) {
  const scn = activeScenario();
  const adv = state.ui.advisor;
  if (!adv) return null;
  const r = planAdvice(scn, st(), { retakeGrade: adv.grade });
  return { row: r.rows[idx], grade: r.grade };
}

async function applyAdvice(idx, asNew) {
  const x = adviceRow(idx);
  if (!x?.row) return;
  const { row, grade } = x;
  const from = activeScenario();
  const desc = `재수강 ${row.retakes.length}과목 · 학점포기 ${fmtCr(row.waiveCredits)}학점`;
  if (asNew) {
    createSim(from, nextSimName('추천 계획'), (s) => applyPlanSet(s, row, grade));
    state.ui.advisor = { scnId: activeScenario().id, grade };
    render();
    return toast(`${desc}을 적용한 시뮬레이션을 만들었습니다`);
  }
  const hasPlan = allCourses(from).some(({ c }) => c.plan !== 'none');
  if (hasPlan) {
    const ok = await confirmDialog({ title: '추천 계획 적용', body: `지금 고른 재수강·포기 계획을 지우고 추천 계획(${desc})으로 바꿉니다.`, ok: '바꾸기' });
    if (!ok) return;
  }
  applyPlanSet(from, row, grade);
  commit();
  toast(from.kind === 'simulation' ? `${desc}을 이 탭에 적용했습니다` : `${desc}을 계획으로 표시했습니다 (실제 학점포기는 과목 메뉴에서)`);
}

async function runTarget() {
  const scn = activeScenario();
  const g = cumulative(scn, st()).gpa;
  const prev = state.ui.target;
  const v = await promptDialog({
    title: '목표 평점 역산',
    fields: [
      { name: 'target', label: '목표 누적 평점', type: 'number', value: prev ? prev.target.toFixed(2) : g != null ? Math.min(4.5, Math.ceil((g + 0.05) * 10) / 10).toFixed(2) : '4.00' },
      { name: 'credits', label: '다음 학기 등급평가 학점', type: 'number', value: prev ? String(prev.credits) : '18' },
    ],
    ok: '계산',
    validate: (x) => {
      const t = Number(x.target), c = Number(x.credits);
      if (!(t > 0 && t <= st().scale)) return `목표는 0~${st().scale} 사이로 입력하세요`;
      if (!(c > 0 && c <= 30)) return '학점을 올바르게 입력하세요';
      return null;
    },
  });
  if (!v) return;
  state.ui.target = { scnId: scn.id, target: Number(v.target), credits: Number(v.credits) };
  render();
  root.querySelector('#target')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ── 설정 ──
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

function onSettingChange(el) {
  const path = el.dataset.set;
  let v = el.value.trim();
  if (el.dataset.type === 'int' || el.dataset.type === 'num') {
    if (v === '') v = null;
    else {
      const n = Number(v);
      if (!isFinite(n) || (el.dataset.type === 'int' && !Number.isInteger(n)) || n < 0) {
        el.classList.add('err');
        toast('숫자를 올바르게 입력하세요');
        return;
      }
      v = n;
    }
    if (v == null && !['admissionYear', 'rules.maxCredits.value'].includes(path)) { render(); return; }
  }
  setPath(st(), path, v);
  commit();
}

async function editPoints() {
  const gp = st().gradePoints;
  const v = await promptDialog({
    title: '등급별 평점',
    fields: LETTERS.map((g) => ({ name: g, label: g, type: 'number', value: gp[g] })),
    ok: '저장',
    validate: (x) => (LETTERS.some((g) => !(Number(x[g]) >= 0 && Number(x[g]) <= st().scale) || x[g] === '') ? `0~${st().scale} 사이 숫자로 입력하세요` : null),
  });
  if (!v) return;
  for (const g of LETTERS) gp[g] = Number(v[g]);
  commit();
}

async function addCategory() {
  const v = await promptDialog({
    title: '이수구분 추가',
    fields: [
      { name: 'name', label: '이름', value: '' },
      { name: 'waivable', label: '학점포기', type: 'select', value: 'no', options: [{ value: 'yes', label: '가능' }, { value: 'conditional', label: '조건부' }, { value: 'no', label: '불가' }] },
      { name: 'group', label: '그룹', type: 'select', value: 'other', options: [{ value: 'major', label: '전공 (전공 평점 포함)' }, { value: 'liberal', label: '교양' }, { value: 'elective', label: '선택' }, { value: 'other', label: '기타' }] },
    ],
    ok: '추가',
    validate: (x) => (!x.name ? '이름을 입력하세요' : st().categories.some((c) => c.name === x.name) ? '이미 있는 이수구분입니다' : null),
  });
  if (!v) return;
  st().categories.push({ name: v.name, waivable: v.waivable, group: v.group, major: v.group === 'major' });
  commit();
}

async function delCategory(idx) {
  const cat = st().categories[idx];
  if (!cat) return;
  const used = state.data.scenarios.some((s) => allCourses(s).some(({ c }) => c.category === cat.name));
  if (used) return alertDialog({ title: '삭제할 수 없습니다', body: `${esc(cat.name)}을(를) 쓰는 과목이 있습니다. 과목의 이수구분을 먼저 바꾸세요.` });
  st().categories.splice(idx, 1);
  commit();
}

// ── 데이터 ──
function importFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let data;
    try {
      data = normalize(JSON.parse(await f.text()));
    } catch (e) {
      return alertDialog({ title: '가져오기 실패', body: `파일 형식이 올바르지 않습니다: ${esc(e.message)}<br>기존 데이터는 그대로 유지됩니다.` });
    }
    const n = data.scenarios.reduce((a, s) => a + allCourses(s).length, 0);
    const mode = await actionSheet({
      title: '가져오기 방식', sub: `${f.name} · 탭 ${data.scenarios.length}개 · 과목 ${n}개`,
      actions: [
        { id: 'overwrite', label: '덮어쓰기', hint: '지금 데이터를 모두 이 파일로 바꿉니다' },
        { id: 'merge', label: '합치기', hint: '없는 학기·과목·탭만 추가합니다 (설정은 유지)' },
      ],
    });
    if (!mode) return;
    if (mode === 'overwrite') {
      const ok = await confirmDialog({ title: '덮어쓰기', body: '지금 데이터가 모두 바뀝니다. 계속할까요?', ok: '덮어쓰기', danger: true });
      if (!ok) return;
      state.data = data;
    } else mergeData(data);
    state.ui.active = 'current';
    applyTheme();
    save();
    go({ name: 'dashboard' });
    toast('가져오기 완료');
  };
  inp.click();
}

async function resetAll() {
  const a = await confirmDialog({ title: '전체 초기화', body: '모든 탭·학기·과목·설정을 지웁니다. 먼저 JSON으로 내보내 두기를 권장합니다.', ok: '계속', danger: true });
  if (!a) return;
  const b = await confirmDialog({ title: '정말 지울까요?', body: '이 작업은 되돌릴 수 없습니다.', ok: '전체 삭제', danger: true });
  if (!b) return;
  state.data = emptyData();
  state.ui.active = 'current';
  applyTheme();
  save();
  go({ name: 'dashboard' });
}

// ── 이벤트 ──
root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || !root.contains(t)) return;
  const act = t.dataset.act;
  const id = t.dataset.id;
  const scn = activeScenario();
  e.stopPropagation();
  switch (act) {
    case 'nav': return go({ name: t.dataset.route });
    case 'drawer': state.ui.drawer = !state.ui.drawer; return render();
    case 'tab':
      if (state.ui.active === id) return;
      state.ui.active = id;
      save();
      if (state.ui.route.name === 'semester' && !semById(activeScenario(), state.ui.route.id)) state.ui.route = { name: 'dashboard' };
      return go(state.ui.route);
    case 'tab-menu': return tabMenu();
    case 'add-sim': return createSim(currentScenario(), nextSimName());
    case 'open-sem': return go({ name: 'semester', id });
    case 'add-sem': return addSemester({ planned: isSim() });
    case 'add-planned': return addSemester({ planned: true });
    case 'add-course': {
      const sem = semById(scn, t.dataset.sem);
      if (sem) ensureUnlocked(sem).then((ok) => ok && openSheet(sem));
      return;
    }
    case 'course-open': return openCourse(t.dataset.sem, id);
    case 'course-menu': return courseMenu(t.dataset.sem, id);
    case 'sem-menu': return semMenu(semById(scn, id));
    case 'lock-sem': return lockSemester(semById(scn, id));
    case 'unlock-sem': return ensureUnlocked(semById(scn, id));
    case 'export': exportJson(); render(); return toast('백업 파일을 저장했습니다 (파일 앱 › 다운로드)');
    case 'import': return importFile();
    case 'reset': return resetAll();
    case 'advisor': return runAdvisor();
    case 'advice-apply': return applyAdvice(Number(t.dataset.idx), false);
    case 'advice-new': return applyAdvice(Number(t.dataset.idx), true);
    case 'advice-grade': state.ui.advisor = { ...state.ui.advisor, grade: t.dataset.v }; return render();
    case 'close-advisor': state.ui.advisor = null; return render();
    case 'target': return runTarget();
    case 'close-target': state.ui.target = null; return render();
    case 'apply-to-current': return applyToCurrent();
    case 'pull-from-current': return pullFromCurrent();
    case 'plan': return togglePlan(t.dataset.kind, id);
    case 'expand': state.ui.expanded[id] = !state.ui.expanded[id]; return render();
    case 'plans-seg': state.ui.plansSeg = t.dataset.v; return render();
    case 'toggle-excluded': state.ui.showExcluded = !state.ui.showExcluded; return render();
    case 'toggle': setPath(st(), t.dataset.path, !getPath(st(), t.dataset.path)); return commit();
    case 'theme': st().theme = t.dataset.v; applyTheme(); return commit();
    case 'edit-points': return editPoints();
    case 'add-category': return addCategory();
    case 'del-category': return delCategory(Number(t.dataset.idx));
    default:
  }
});

root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set) return onSettingChange(t);
  const a = t.dataset.actChange;
  if (a === 'plan-grade') return setPlanGrade(t.dataset.id, t.value);
  if (a === 'compare-pick') {
    const sel = [...root.querySelectorAll('[data-act-change="compare-pick"]:checked')].map((x) => x.value);
    if (sel.length > 3) { t.checked = false; return toast('최대 3개까지 비교할 수 있습니다'); }
    if (sel.length < 2) { t.checked = true; return toast('2개 이상 골라야 합니다'); }
    state.ui.compare = sel;
    return render();
  }
});

root.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.crow[data-act]')) { e.preventDefault(); e.target.click(); }
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
window.addEventListener('storage', (e) => { if (e.key === 'grade-webapp:v1') { load(); render(); } });

// ── 시작 ──
load();
applyTheme();
render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 등록 실패', e));
}

// 디버그/테스트용
window.__gradeApp = { state, render };
export { categoryInfo };
