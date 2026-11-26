// 상태 + 저장(localStorage) + 백업 (PRD 8장, F-07)
import { defaultSettings, DEFAULT_CATEGORIES } from './domain/grades.js';

const KEY = 'grade-webapp:v1';
export const VERSION = 1;

export const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const nowIso = () => new Date().toISOString();

export function emptyData() {
  return {
    version: VERSION,
    scenarios: [{ id: 'current', name: '현재', kind: 'current', createdAt: nowIso(), updatedAt: nowIso(), semesters: [] }],
    settings: defaultSettings(),
  };
}

/** 가져오기·불러오기 시 형식 검사 + 빠진 값 채우기 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('JSON 객체가 아닙니다');
  if (raw.version !== VERSION) throw new Error(`지원하지 않는 버전입니다 (version: ${raw.version})`);
  if (!Array.isArray(raw.scenarios)) throw new Error('scenarios 목록이 없습니다');
  const base = defaultSettings();
  const s = { ...base, ...(raw.settings || {}) };
  s.gradePoints = { ...base.gradePoints, ...(s.gradePoints || {}) };
  s.percentile = { ...base.percentile, ...(s.percentile || {}) };
  s.rules = Object.fromEntries(Object.entries(base.rules).map(([k, v]) => [k, { ...v, ...((s.rules || {})[k] || {}) }]));
  if (!Array.isArray(s.categories) || !s.categories.length) s.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  const scenarios = raw.scenarios.map((sc) => {
    if (!sc || !Array.isArray(sc.semesters)) throw new Error('시나리오 형식이 올바르지 않습니다');
    return {
      id: String(sc.id), name: String(sc.name || '시뮬레이션'), kind: sc.id === 'current' ? 'current' : 'simulation',
      createdAt: sc.createdAt || nowIso(), updatedAt: sc.updatedAt || nowIso(), waiveReqConfirmed: !!sc.waiveReqConfirmed,
      semesters: sc.semesters.map((se) => {
        if (!se || typeof se.year !== 'number' || !['1', 'summer', '2', 'winter'].includes(se.term) || !Array.isArray(se.courses)) {
          throw new Error('학기 형식이 올바르지 않습니다');
        }
        return {
          id: String(se.id), year: se.year, term: se.term, isSeasonal: se.term === 'summer' || se.term === 'winter',
          gradeLevel: se.gradeLevel ?? null, locked: !!se.locked, lockedAt: se.lockedAt || null, isPlanned: !!se.isPlanned,
          courses: se.courses.map((c) => {
            if (!c || typeof c.name !== 'string' || typeof c.credits !== 'number') throw new Error('과목 형식이 올바르지 않습니다');
            return {
              id: String(c.id), name: c.name, credits: c.credits, category: c.category || '일반선택', isRequired: !!c.isRequired,
              delivery: c.delivery || 'offline', track: c.track || null, plan: c.plan || 'none', planGrade: c.planGrade || null,
              gradingType: c.gradingType === 'pf' ? 'pf' : 'letter', grade: c.grade ?? null, retakeOf: c.retakeOf || null,
              courseCode: c.courseCode || null, waived: !!c.waived, waivedAt: c.waivedAt || null,
              assumption: c.assumption || null, autoFromPlan: c.autoFromPlan || null,
            };
          }),
        };
      }),
    };
  });
  if (!scenarios.some((x) => x.id === 'current')) throw new Error('현재 탭 데이터가 없습니다');
  return { version: VERSION, scenarios, settings: s };
}

export const state = {
  data: emptyData(),
  ui: {
    active: 'current',
    route: { name: 'dashboard' },
    drawer: false,
    saveError: null,
    toast: null,
    advice: {}, // { grade, mode: 'fixed' | 'free' }
    target: null, // { target, credits }
    back: null,
    plansSeg: 'retake',
    expanded: {},
    compare: [],
    showExcluded: false,
  },
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state.data = normalize(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    state.ui.saveError = '저장된 데이터를 불러오지 못했습니다. 백업 파일에서 가져오기를 해 주세요.';
  }
  try {
    const ui = JSON.parse(localStorage.getItem(KEY + ':ui') || '{}');
    if (ui.active && state.data.scenarios.some((s) => s.id === ui.active)) state.ui.active = ui.active;
  } catch { /* 무시 */ }
}

export function save() {
  try {
    const scn = activeScenario();
    if (scn) scn.updatedAt = nowIso();
    localStorage.setItem(KEY, JSON.stringify(state.data));
    localStorage.setItem(KEY + ':ui', JSON.stringify({ active: state.ui.active }));
    state.ui.saveError = null;
    return true;
  } catch (e) {
    console.error(e);
    state.ui.saveError = '저장에 실패했습니다. 지금 바로 JSON으로 내보내 두세요.';
    return false;
  }
}

export function activeScenario() {
  return state.data.scenarios.find((s) => s.id === state.ui.active) || state.data.scenarios[0];
}
export function currentScenario() {
  return state.data.scenarios.find((s) => s.id === 'current');
}
export const settings = () => state.data.settings;
export const isSim = () => activeScenario().kind === 'simulation';

export function exportJson() {
  state.data.settings.lastBackupAt = nowIso();
  save();
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grades-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** 합치기: 같은 id 시나리오는 학기·과목 단위로 없는 것만 추가 */
export function mergeData(incoming) {
  for (const sc of incoming.scenarios) {
    const mine = state.data.scenarios.find((x) => x.id === sc.id);
    if (!mine) { state.data.scenarios.push(sc); continue; }
    for (const se of sc.semesters) {
      const ms = mine.semesters.find((x) => x.id === se.id || (x.year === se.year && x.term === se.term));
      if (!ms) { mine.semesters.push(se); continue; }
      for (const c of se.courses) if (!ms.courses.some((x) => x.id === c.id)) ms.courses.push(c);
    }
  }
}
