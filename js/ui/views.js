// 화면 렌더링 (PRD 7장). 이벤트는 data-act 속성으로 app.js에서 처리한다.
import { esc, fmtGpa, fmtPct, fmtCr, delta, gradeBadge, courseGrade, tag, icon, lockMark } from './h.js';
import { state, activeScenario, currentScenario, settings, isSim } from '../store.js';
import {
  summarize, sortSemesters, semName, semShort, isSeasonal, trend, distribution, cumulative, percentile, waivedCredits, allCourses,
} from '../domain/calc.js';
import { checkRegistration } from '../domain/registration.js';
import { targetAnalysis, planAdvice } from '../domain/advisor.js';
import { planLists, applyPlans, compareRetakeVsWaive, retakeEffects, findCourse, retakeSemesterImpact } from '../domain/rules.js';
import { DELIVERY_LABEL, LETTERS, categoryInfo, WAIVABLE_LABEL, gradePoint } from '../domain/grades.js';

// ── 공통 계산 캐시 (렌더 1회분) ──
function ctx() {
  const scn = activeScenario();
  const st = settings();
  const sum = summarize(scn, st);
  const reg = checkRegistration(scn, st);
  const cur = currentScenario();
  const curSum = scn === cur ? sum : summarize(cur, st);
  return { scn, st, sum, reg, cur, curSum, sim: scn.kind === 'simulation' };
}

function semSub(s, stats) {
  if (s.isPlanned) return '예정 학기';
  if (isSeasonal(s)) return '누적에만 반영';
  const parts = [];
  if (s.gradeLevel) parts.push(`${s.gradeLevel}학년`);
  if (stats.pending > 0) parts.push('수강 중');
  return parts.join(' · ') || '정규학기';
}

export function semTitle(s) {
  return `${semName(s)}${s.gradeLevel && !isSeasonal(s) ? ` · ${s.gradeLevel}학년` : ''}`;
}

// ── 사이드바 ──
function sidebar(c) {
  const r = state.ui.route;
  const sems = sortSemesters(c.scn.semesters).reverse();
  const navItem = (name, label) => `<button type="button" data-act="nav" data-route="${name}" ${r.name === name ? 'aria-current="page"' : ''}>${label}</button>`;
  return `<aside class="sidebar" aria-label="사이드바">
    <div class="brand"><div class="brand-mark">4.5</div><div class="brand-name">성적 관리</div></div>
    <nav class="nav" aria-label="주 메뉴">
      ${navItem('dashboard', c.sim ? '시뮬레이션 개요' : '대시보드')}
      ${navItem('plans', '재수강·학점포기')}
      ${navItem('settings', '설정')}
    </nav>
    <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-height:0">
      <div class="sem-list-head"><b>학기</b><span>평점 · 학점</span></div>
      <div class="sem-list">
        ${sems.map((s) => {
          const stt = c.sum.semStats.get(s.id);
          const errs = c.reg.bySem.get(s.id)?.errors.length;
          return `<button type="button" class="sem-item${s.isPlanned ? ' planned' : ''}" data-act="open-sem" data-id="${esc(s.id)}" ${r.name === 'semester' && r.id === s.id ? 'aria-current="page"' : ''}>
            <span class="sem-item-main"><span class="sem-item-name">${esc(semName(s))}</span><span class="sem-item-sub">${esc(semSub(s, stt))}${errs ? ' · <span style="color:var(--danger)">⚠ 오류</span>' : ''}</span></span>
            <span class="sem-item-gpa">${fmtGpa(stt.gpa)}</span>
            <span class="sem-item-cr">${fmtCr(stt.applied)}</span>
            <span class="sem-item-lock">${s.locked ? lockMark(14) : ''}</span>
          </button>`;
        }).join('') || '<p class="muted small" style="padding:12px">아직 학기가 없습니다</p>'}
      </div>
    </div>
    <button type="button" class="add-sem" data-act="add-sem">+ ${c.sim ? '학기 추가' : '학기 추가'}</button>
  </aside>`;
}

// ── 탭 바 ──
function tabs(c) {
  const st = c.st;
  return `<div class="tabs" role="tablist" aria-label="시나리오">
    <button type="button" class="menu-btn" data-act="drawer" aria-label="학기 목록 열기">${icon.menu()}</button>
    ${state.data.scenarios.map((s) => {
      const sel = s.id === c.scn.id;
      const errs = s.kind === 'simulation' ? checkRegistration(s, st).errors.length : 0;
      return `<button type="button" class="tab" role="tab" aria-selected="${sel}" data-act="tab" data-id="${esc(s.id)}">${esc(s.name)}${errs ? '<span class="tab-warn" aria-label="수강신청 조건 오류">!</span>' : ''}${sel && s.kind === 'simulation' ? `<span class="tab-more" data-act="tab-menu" role="button" aria-label="탭 메뉴">${icon.dots(16)}</span>` : ''}</button>`;
    }).join('')}
    <button type="button" class="tab-add" data-act="add-sim" aria-label="시뮬레이션 추가">+</button>
    <span class="tabs-spacer"></span>
    ${state.data.scenarios.length > 1 ? '<button type="button" class="tab-tool" data-act="nav" data-route="compare">비교 보기</button>' : ''}
  </div>`;
}

// ── 차트 ──
function chart(points) {
  const W = 520, H = 260, x0 = 44, x1 = 504, y0 = 16, y1 = 222;
  const vals = points.flatMap((p) => [p.semGpa, p.cumGpa]).filter((v) => v != null);
  if (!vals.length) return '<p class="muted small">성적이 입력되면 추이가 표시됩니다.</p>';
  const lo = Math.min(3.0, Math.floor(Math.min(...vals) * 2) / 2), hi = 4.5;
  const n = points.length;
  const X = (i) => Math.round(n === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1));
  const Y = (v) => Math.round(y0 + ((hi - v) / (hi - lo)) * (y1 - y0));
  const grid = [];
  for (let v = hi; v >= lo - 1e-9; v -= 0.5) grid.push(v);
  const line = (key, color, dotR, filled) => {
    const pts = points.map((p, i) => ({ i, v: p[key], planned: p.planned })).filter((p) => p.v != null);
    const solid = pts.filter((p) => !p.planned);
    const lastSolid = solid[solid.length - 1];
    const dashed = pts.filter((p) => p.planned);
    const path = (arr) => arr.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ');
    let out = '';
    if (solid.length > 1) out += `<polyline points="${path(solid)}" fill="none" stroke="${color}" stroke-width="2"/>`;
    if (dashed.length) out += `<polyline points="${path(lastSolid ? [lastSolid, ...dashed] : dashed)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 4"/>`;
    out += pts.map((p) => filled
      ? `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="${dotR}" fill="${color}"/>`
      : `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="${dotR}" fill="var(--surface)" stroke="${color}" stroke-width="2"/>`).join('');
    return out;
  };
  const step = n > 10 ? Math.ceil(n / 8) : 1;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="학기 평점과 누적 평점 추이 선 차트">
    ${grid.map((v) => `<line x1="${x0 - 8}" x2="${x1 + 8}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line-soft)"/><text x="${x0 - 14}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${v.toFixed(1)}</text>`).join('')}
    ${line('semGpa', 'var(--accent)', 3.5, false)}
    ${line('cumGpa', 'var(--ink)', 3, true)}
    ${points.map((p, i) => (i % step === 0 || i === n - 1 ? `<text x="${X(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(p.label)}</text>` : '')).join('')}
    ${points.map((p) => `<title>${esc(p.label)}</title>`).slice(0, 0).join('')}
  </svg>`;
}

function trendPoints(scn, st) {
  return trend(scn, st).map((t) => ({ label: semShort(t.sem), semGpa: t.semGpa, cumGpa: t.cumGpa, planned: !!t.sem.isPlanned }));
}

function chartCard(c) {
  return `<section class="card">
    <div class="card-head"><h2>학기별 추이</h2>
      <div class="legend"><span><i style="background:var(--accent)"></i>학기 평점</span><span><i style="background:var(--ink)"></i>누적 평점</span>${c.sim ? '<span><i style="background:repeating-linear-gradient(90deg,var(--muted) 0 4px,transparent 4px 7px)"></i>예상</span>' : ''}</div>
    </div>
    ${chart(trendPoints(c.scn, c.st))}
    <p class="foot-note">계절학기는 누적 선에만 반영됩니다.</p>
  </section>`;
}

function waiveGauge(c) {
  const used = c.sum.waived, lim = c.st.waiveLimit;
  const cells = Array.from({ length: Math.max(1, Math.ceil(lim)) }, (_, i) => `<span class="${i < used ? 'on' : ''}"></span>`).join('');
  return `<section class="card">
    <div class="card-head"><h2>학점포기 사용량</h2><span class="mono" style="font-size:14px"><b>${fmtCr(used)}</b> / ${fmtCr(lim)}학점</span></div>
    <div class="gauge" style="--n:${Math.max(1, Math.ceil(lim))}" role="img" aria-label="학점포기 ${used} / ${lim}학점">${cells}</div>
    <span class="foot-note">4학년 · 유효 학기성적 6학기 이상부터 신청 가능 · 포기한 과목은 재수강 불가</span>
  </section>`;
}

function distCard(c) {
  const rows = distribution(c.scn);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const bar = (g) => (g.startsWith('A') ? 'var(--accent)' : g.startsWith('B') ? 'var(--accent-bar)' : g === 'F' ? 'var(--danger-bar)' : g === 'P' ? 'var(--ok-bar)' : 'var(--faint)');
  return `<section class="card" style="flex:1">
    <h2>성적 분포</h2>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${rows.map((r) => `<div class="dist-row">${gradeBadge(r.grade)}<span class="dist-bar"><span style="width:${Math.round((r.n / max) * 100)}%;background:${bar(r.grade)}"></span></span><span class="dist-n">${r.n}과목</span></div>`).join('')}
    </div>
  </section>`;
}

function banners(c) {
  let out = '';
  if (state.ui.saveError) {
    out += `<div class="banner danger" role="alert"><span>${esc(state.ui.saveError)}</span><button type="button" class="btn sm danger" data-act="export">지금 내보내기</button></div>`;
  }
  const hasData = state.data.scenarios.some((s) => s.semesters.some((x) => x.courses.length));
  const last = c.st.lastBackupAt ? new Date(c.st.lastBackupAt) : null;
  const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
  if (hasData && (days == null || days > 30) && state.ui.route.name === 'dashboard' && !c.sim) {
    out += `<div class="banner"><span>${days == null ? '아직 백업한 적이 없습니다.' : `마지막 백업이 ${days}일 전입니다.`} 아이패드 데이터 보호를 위해 JSON 백업을 권장합니다.</span><button type="button" class="btn sm" data-act="export">JSON 내보내기</button></div>`;
  }
  return out;
}

// ── 대시보드 (현재 탭) ──
function dashboard(c) {
  const sems = sortSemesters(c.scn.semesters);
  if (!sems.length) {
    return `${banners(c)}<div class="empty">
      <div class="empty-icon">${icon.book()}</div>
      <h2>첫 학기를 추가해 보세요</h2>
      <p style="margin:0">학기를 만들고 과목과 성적을 넣으면 평점·백분위·이수 학점이 바로 계산됩니다.</p>
      <button type="button" class="btn primary" data-act="add-sem">첫 학기 추가</button>
      <button type="button" class="btn ghost" data-act="import">백업 파일 가져오기</button>
    </div>`;
  }
  const s = c.sum;
  const regs = sems.filter((x) => { const t = c.sum.semStats.get(x.id); return !isSeasonal(x) && t.gpa != null && t.pending === 0; });
  const last = regs[regs.length - 1], prev = regs[regs.length - 2];
  const lastSt = last ? s.semStats.get(last.id) : null;
  const prevSt = prev ? s.semStats.get(prev.id) : null;
  const inProgress = sems.filter((x) => s.semStats.get(x.id).pending > 0).map(semName);
  return `${banners(c)}
  <div class="page-head"><h1>대시보드</h1><span class="muted" style="font-size:13px">${inProgress.length ? `${esc(inProgress.join(', '))} 수강 중 · ` : ''}계산은 한양대 학사 규정 기준</span></div>
  <div class="stat-grid">
    <div class="stat"><span class="stat-label">누적 평점 · 증명용</span>
      <span class="stat-value"><span class="stat-num">${fmtGpa(s.gpa)}</span><span class="stat-unit">/ ${c.st.scale}</span></span>
      <span class="stat-foot">포기 전 ${fmtGpa(s.preWaiveGpa)} · 전공 ${fmtGpa(s.majorGpa)}</span></div>
    <div class="stat"><span class="stat-label">누적 백분위</span>
      <span class="stat-value"><span class="stat-num">${fmtPct(s.percentile)}</span></span>
      <span class="stat-foot">${c.st.percentile.base} + 평점 × ${c.st.percentile.mult}</span></div>
    <div class="stat"><span class="stat-label">총 이수 학점</span>
      <span class="stat-value"><span class="stat-num">${fmtCr(s.earned)}</span></span>
      <span class="stat-foot">${s.pending ? `수강 중 ${fmtCr(s.pending)}학점 별도` : 'F·NP·W 제외, 재수강은 1번만'}</span></div>
    <div class="stat"><span class="stat-label">직전 학기 평점</span>
      <span class="stat-value"><span class="stat-num">${fmtGpa(lastSt?.gpa)}</span>${prevSt ? delta(lastSt.gpa, prevSt.gpa) : ''}</span>
      <span class="stat-foot">${last ? esc(semName(last)) + (lastSt.honors ? ` · ${lastSt.honors}` : '') : '정규학기 성적 없음'}</span></div>
  </div>
  <div class="dash-grid">
    ${chartCard(c)}
    <div class="stack">${waiveGauge(c)}${distCard(c)}</div>
  </div>`;
}

// ── 과목 행 ──
function courseRow(c, x, sem, { compact = false } = {}) {
  const rt = c.sum.rt;
  const disc = rt.discarded.get(x.id);
  const errs = c.reg.byCourse.get(x.id) || [];
  const hasErr = errs.some((e) => e.level === 'error');
  const sub = [];
  if (x.track) sub.push(esc(x.track));
  if (x.delivery && x.delivery !== 'offline') sub.push(esc(DELIVERY_LABEL[x.delivery]));
  if (x.retakeOf) {
    const o = findCourse(c.scn, x.retakeOf);
    if (o) sub.push(`원과목 ${esc(semName(o.s))} ${esc(o.c.grade || '미정')}${rt.discarded.has(o.c.id) ? ' → 폐기' : ''}${x.courseCode && o.c.courseCode && x.courseCode.toUpperCase() !== o.c.courseCode.toUpperCase() ? ' · 학수번호 다름' : x.courseCode && o.c.courseCode ? ' · 학수번호 일치' : ''}`);
    else sub.push('원과목 연결 끊김');
    if (x.grade === 'A+') sub.push('A0까지 인정');
  }
  if (disc) sub.push(`재수강으로 폐기 → ${esc(semShort(disc.s))} ${esc(disc.c.grade)}`);
  if (x.waived) sub.push(`학점포기${x.waivedAt ? ` ${esc(x.waivedAt)}` : ''} · 포기 전 성적 보관`);
  if (x.plan === 'retake') sub.push(`재수강 예정${x.planGrade ? ` (예상 ${esc(x.planGrade)})` : ''}`);
  if (x.plan === 'waive' && !x.waived) sub.push('포기 예정');
  const tags = [tag(x.category)];
  if (x.isRequired) tags.push(tag('필수', 'strong'));
  if (x.retakeOf) tags.push(tag('재수강', 'accent'));
  if (x.assumption && c.sim) tags.push(tag('가정', 'assume'));
  if (hasErr) tags.push(tag('규칙 위반', 'danger'));
  const errLine = errs.map((e) => esc(e.msg)).join(' · ');
  return `<div class="crow clickable${x.assumption && c.sim ? ' assumed' : ''}${hasErr ? ' error' : ''}" data-act="course-open" data-id="${esc(x.id)}" data-sem="${esc(sem.id)}" tabindex="0" aria-label="${esc(x.name)} 수정">
    <span class="cname"><span class="cname-main${disc ? ' strike' : ''}">${esc(x.name)}</span>
      <span class="cname-sub"><span class="mlabel">${fmtCr(x.credits)}학점 · ${x.gradingType === 'letter' ? '등급' : 'P/F'}${sub.length ? ' · ' : ''}</span>${sub.join(' · ')}</span>
      ${errLine ? `<span class="cname-sub err">${errLine}</span>` : ''}</span>
    <span class="tags">${tags.join('')}</span>
    <span class="num">${fmtCr(x.credits)}</span>
    <span class="ceval">${x.gradingType === 'letter' ? '등급' : 'P/F'}</span>
    <span class="cgrade">${courseGrade(x, { discarded: !!disc })}</span>
    <button type="button" class="icon-btn" data-act="course-menu" data-id="${esc(x.id)}" data-sem="${esc(sem.id)}" aria-label="${esc(x.name)} 메뉴">${icon.dots()}</button>
  </div>`;
}

function courseTable(c, sem) {
  if (!sem.courses.length) return `<div class="card" style="align-items:center;text-align:center;color:var(--muted)">과목이 없습니다</div>`;
  return `<section class="ctable" aria-label="과목 목록">
    <div class="crow head"><span>과목명</span><span>이수구분</span><span style="text-align:right">학점</span><span>평가</span><span>성적</span><span></span></div>
    ${sem.courses.map((x) => courseRow(c, x, sem)).join('')}
  </section>`;
}

// ── 학기 상세 ──
function semesterPage(c, sem) {
  if (!sem) return `<div class="empty"><h2>학기를 찾을 수 없습니다</h2><button class="btn" data-act="nav" data-route="dashboard">대시보드로</button></div>`;
  const stt = c.sum.semStats.get(sem.id);
  const seasonal = isSeasonal(sem);
  const regInfo = c.reg.bySem.get(sem.id);
  const modeLabel = { keep: '성적확인서 기준', exclude: '폐기 과목 제외', replace: '재수강 성적 반영' }[c.st.retakeMode];
  let sub = '';
  if (sem.locked && !c.sim) sub = `${esc(sem.lockedAt || '')} 성적 확정 · 수정하려면 잠금을 해제하세요`;
  else if (sem.locked && c.sim) sub = '확정된 학기 · 시뮬레이션에서는 바꿔볼 수 있습니다 (현재 탭에는 영향 없음)';
  else if (sem.isPlanned) sub = '예정 학기 · 예상 성적으로 계산합니다';
  else if (stt.pending) sub = `미정 ${sem.courses.filter((x) => x.grade == null && !x.waived).length}과목 · 성적이 나오면 확정해 잠그세요`;
  const actions = [];
  if (!c.sim && !sem.isPlanned) {
    actions.push(sem.locked
      ? `<button type="button" class="btn" data-act="unlock-sem" data-id="${esc(sem.id)}">${icon.lock()}잠금 해제</button>`
      : `<button type="button" class="btn primary" data-act="lock-sem" data-id="${esc(sem.id)}">${icon.lock()}성적 확정</button>`);
  }
  actions.push(`<button type="button" class="btn" data-act="sem-menu" data-id="${esc(sem.id)}" aria-label="학기 메뉴">${icon.dots()}</button>`);
  const canAdd = !(sem.locked && !c.sim);
  return `${banners(c)}
  <div class="page-head">
    <div>
      <div class="title-row"><h1>${esc(semTitle(sem))}</h1>${sem.locked ? lockMark(16) : ''}${sem.isPlanned ? tag('예정', 'assume') : ''}${seasonal ? tag('계절학기', 'soft') : ''}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>
    <div class="head-actions">${actions.join('')}</div>
  </div>
  ${seasonal ? '<div class="banner"><span>계절학기 성적은 학기 평점에 포함되지 않고 누적 평점·이수 학점에만 반영됩니다.</span></div>' : ''}
  ${retakeSemesterImpact(c.scn, c.st).filter((i) => i.sem.id === sem.id).map((i) => `<div class="card" style="gap:8px"><h2>재수강 계획이 이 학기 평점에 주는 영향</h2>${impactHtml(i, c.st, { names: true })}<span class="foot-note">재수강 예정 성적 기준 · 어느 옵션이 맞는지는 포털 확인 후 설정에서 고르세요</span></div>`).join('')}
  ${regInfo ? [...regInfo.errors.filter((e) => !e.courseId).map((e) => `<div class="banner danger">${icon.warn(16)}<span>${esc(e.msg)}</span></div>`), ...regInfo.warnings.filter((e) => !e.courseId).map((e) => `<div class="banner">${esc(e.msg)}</div>`)].join('') : ''}
  <div class="stat-grid cols-3">
    <div class="stat"><span class="stat-label">${seasonal ? '계절학기 평점 · 누적에만 반영' : `학기 평점 · ${modeLabel}`}</span>
      <span class="stat-value" style="align-items:center;gap:10px"><span class="stat-num">${fmtGpa(stt.gpa)}</span>${stt.honors ? tag(stt.honors, 'accent') : ''}</span></div>
    <div class="stat"><span class="stat-label">신청 / 이수 학점</span>
      <span class="stat-value"><span class="stat-num">${fmtCr(stt.applied)}</span><span class="stat-unit">/ ${fmtCr(stt.earned)}</span></span></div>
    <div class="stat"><span class="stat-label">등급평가 / P·F</span>
      <span class="stat-value"><span class="stat-num">${fmtCr(stt.letterCr)}</span><span class="stat-unit">/ ${fmtCr(stt.pfCr)}학점</span></span></div>
  </div>
  ${courseTable(c, sem)}
  ${canAdd ? `<div class="sticky-add"><button type="button" class="btn dashed block" data-act="add-course" data-sem="${esc(sem.id)}">+ 과목 추가</button></div>`
    : '<p class="foot-note">확정된 학기에서는 과목 추가 버튼이 숨겨집니다. 학점포기는 과목 메뉴 › 학점포기 적용으로 따로 처리합니다.</p>'}`;
}

// ── 시뮬레이션 개요 ──
function simPage(c) {
  const planned = sortSemesters(c.scn.semesters).filter((s) => s.isPlanned);
  const tgt = state.ui.target && state.ui.target.scnId === c.scn.id ? state.ui.target : null;
  return `${banners(c)}
  <div class="page-head">
    <div><div class="title-row"><h1>${esc(c.scn.name)}</h1>${tag('가정', 'assume')}</div>
    <div class="sub">여기서 바꾼 내용은 현재 탭에 영향을 주지 않습니다 · 점선은 가정이 들어간 항목</div></div>
    <div class="head-actions"><button type="button" class="btn" data-act="pull-from-current">현재에서 불러오기</button><button type="button" class="btn" data-act="apply-to-current">현재에 반영</button></div>
  </div>
  <div class="actions-row">
    <button type="button" class="btn primary" data-act="add-planned">+ 예정 학기 추가</button>
    <button type="button" class="btn" data-act="advisor">재수강·학점포기 추천</button>
    <button type="button" class="btn" data-act="target">목표 평점 역산</button>
  </div>
  ${advisorSection(c)}
  ${tgt ? targetCard(c, tgt) : ''}
  ${planned.length ? planned.map((s) => plannedCard(c, s)).join('') : `<div class="card assumed" style="align-items:flex-start">
      <h2>다음 학기 계획</h2>
      <p class="muted" style="margin:0">① 예정 학기 추가 → ② 재수강·학점포기에서 "재수강 예정"으로 고른 과목이 자동으로 들어옴 → ③ 새 과목 추가 → ④ 조건 검사와 예상 평점 확인</p>
      <button type="button" class="btn" data-act="add-planned">+ 예정 학기 추가</button></div>`}
  ${chartCard(c)}`;
}

function targetCard(c, tt) {
  const a = targetAnalysis(c.scn, c.st, tt.target, tt.credits, { retakeGrade: state.ui.advisor?.grade });
  const T = tt.target.toFixed(2);
  const r0 = a.rows[0];
  const head = r0.already
    ? `계획 없이도 이미 누적 <b class="mono">${T}</b> 이상입니다.`
    : r0.possible
      ? `누적 <b class="mono">${T}</b>이 되려면 다음 <b class="mono">${fmtCr(tt.credits)}</b>학점에서 평균 <b class="mono">${r0.need.toFixed(2)}</b> 필요`
      : `다음 <b class="mono">${fmtCr(tt.credits)}</b>학점을 모두 ${c.st.scale}로 받아도 누적 ${T}에 닿지 않습니다. ${c.st.scale}만 받아도 최소 <b class="mono">${r0.minMax}</b>학점이 필요합니다.`;
  const needCell = (r) => (r.already ? '<span class="status-ok">달성</span>' : r.possible ? `<b>${r.need.toFixed(2)}</b>` : `<span class="status-err">불가</span> <span class="small muted">(${r.need.toFixed(2)})</span>`);
  const minCell = (n, r) => (r.already ? '0' : n == null ? '<span class="muted">불가</span>' : n > 60 ? `<span class="muted">${n}학점 (사실상 불가)</span>` : `${n}학점`);
  return `<section class="card" id="target"><div class="card-head"><h2>목표 평점 역산 · 누적 ${T}</h2>
      <div style="display:flex;gap:4px"><button type="button" class="btn sm" data-act="target">바꾸기</button><button type="button" class="icon-btn" data-act="close-target" aria-label="닫기">${icon.close(18)}</button></div></div>
    <p style="margin:0">${head}</p>
    <div style="overflow-x:auto"><table class="table-plain">
      <thead><tr><th></th><th>지금 누적</th><th>다음 ${fmtCr(tt.credits)}학점 필요 평균</th><th>${c.st.scale}로 받으면 최소</th><th>A0로 받으면 최소</th></tr></thead>
      <tbody>${a.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${fmtGpa(r.gpa)}</td><td>${needCell(r)}</td><td>${minCell(r.minMax, r)}</td><td>${minCell(r.minA0, r)}</td></tr>`).join('')}</tbody>
    </table></div>
    <span class="foot-note">등급평가 학점 기준 · 재수강 과목 학점은 따로 · 재수강은 ${esc(state.ui.advisor?.grade || c.st.retakeCap)} 가정 · "최소"는 그 성적만 받을 때 필요한 새 학점 수</span></section>`;
}

function plannedCard(c, s) {
  const stt = c.sum.semStats.get(s.id);
  const info = c.reg.bySem.get(s.id);
  const nErr = info ? info.errors.length : 0;
  return `<section class="card assumed plan-sem">
    <div class="card-head">
      <div class="title-row" style="display:flex;gap:8px;align-items:center"><h2 style="font-size:17px">${esc(semTitle(s))}</h2>${tag('예정', 'assume')}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="${nErr ? 'status-err' : 'status-ok'}" style="font-size:13px">${nErr ? `⚠ 오류 ${nErr}건` : '수강신청 조건 통과'}</span>
        <button type="button" class="icon-btn" data-act="sem-menu" data-id="${esc(s.id)}" aria-label="학기 메뉴">${icon.dots()}</button>
      </div>
    </div>
    <span class="muted" style="font-size:13px">신청 <b class="mono">${fmtCr(stt.applied)}</b>학점 · 예상 학기 평점 <b class="mono">${fmtGpa(stt.gpa)}</b></span>
    ${info ? info.errors.filter((e) => !e.courseId).map((e) => `<span class="fld-err">${esc(e.msg)}</span>`).join('') : ''}
    ${courseTable(c, s)}
    <button type="button" class="btn dashed" data-act="add-course" data-sem="${esc(s.id)}">+ 과목 추가</button>
  </section>`;
}

export function adviceFor(c) {
  const adv = state.ui.advisor;
  if (!adv || adv.scnId !== c.scn.id) return null;
  return planAdvice(c.scn, c.st, { retakeGrade: adv.grade });
}

function advisorSection(c) {
  const r = adviceFor(c);
  if (!r) return '';
  const cap = gradePoint(c.st.retakeCap, c.st);
  const gradeOpts = LETTERS.filter((g) => gradePoint(g, c.st) <= cap).slice(0, 3);
  const cur = r.current;
  const curDesc = cur.retakeIds.size || cur.waiveIds.size
    ? `지금 고른 계획: 재수강 ${cur.retakeIds.size}과목 · 포기 ${cur.waiveIds.size}과목 → 누적 <b class="mono">${fmtGpa(cur.gpa)}</b>`
    : '아직 고른 계획이 없습니다';
  const pill = (x, kind) => {
    const picked = kind === 'r' ? cur.retakeIds.has(x.c.id) : cur.waiveIds.has(x.c.id);
    return `<span class="pill${picked ? ' picked' : ''}" title="${esc(semName(x.s))}">${esc(x.c.name)} ${gradeBadge(x.c.grade)}${kind === 'r' ? ` → ${gradeBadge(r.grade)}` : ` <span class="mono small">${fmtCr(x.cr)}학점</span>`}${picked ? '<span class="pill-mark" aria-label="선택함">✓</span>' : ''}</span>`;
  };
  const last = r.rows.length - 1;
  const rows = r.rows.map((row, i) => {
    const notes = [];
    for (const x of row.conditional) notes.push(`${esc(x.c.name)}: ${esc(x.c.category)}는 해당 학기 미개설 과목일 때만 포기 가능`);
    if (row.retakeNeeded) notes.push(`핵심교양 ${fmtCr(row.retakeNeeded)}학점 재이수 필요`);
    const names = (l) => l.map((x) => esc(x.name)).join('·');
    const alts = row.alts.slice(0, 3).map((a) => [
      a.retake.out.length ? `재수강 ${names(a.retake.out)} 대신 ${names(a.retake.in)}` : '',
      a.waive.out.length ? `포기 ${names(a.waive.out)} 대신 ${names(a.waive.in)}` : '',
    ].filter(Boolean).join(', '));
    return `<article class="advice-row${i === last ? ' best' : ''}">
      <div class="advice-head">
        <div class="advice-title"><b>${row.k ? `재수강 ${row.k}과목` : '재수강 없이'}</b><span class="muted"> + ${row.waiveCredits ? `학점포기 ${fmtCr(row.waiveCredits)}학점` : '포기 없음'}</span>
          ${i === last ? tag('가장 높음', 'accent') : ''}${row.matchesCurrent ? tag('지금 계획과 같음', 'ok') : ''}</div>
        <div class="advice-num"><span class="big-num" style="font-size:24px">${fmtGpa(row.gpa)}</span>${delta(row.gpa, r.baseGpa)}<span class="muted small">백분위 ${fmtPct(row.percentile)}</span></div>
      </div>
      <div class="advice-line"><span class="advice-k">재수강</span>${row.retakes.length ? row.retakes.map((x) => pill(x, 'r')).join('') : '<span class="muted small">없음</span>'}</div>
      <div class="advice-line"><span class="advice-k">학점포기</span>${row.waives.length ? row.waives.map((x) => pill(x, 'w')).join('') : '<span class="muted small">없음</span>'}</div>
      ${alts.length ? `<div class="small muted">같은 결과: ${alts.join(' / ')}</div>` : ''}
      ${notes.map((n) => `<div class="small" style="color:var(--danger)">${n}</div>`).join('')}
      <div class="actions-row">
        ${row.matchesCurrent ? '' : `<button type="button" class="btn sm primary" data-act="advice-apply" data-idx="${i}">이 탭에 적용</button>`}
        <button type="button" class="btn sm" data-act="advice-new" data-idx="${i}">새 시뮬레이션으로</button>
      </div>
    </article>`;
  }).join('');
  return `<section class="card" id="advice">
    <div class="card-head"><h2>재수강·학점포기 추천</h2><button type="button" class="icon-btn" data-act="close-advisor" aria-label="닫기">${icon.close(18)}</button></div>
    <span class="foot-note">이미 고른 계획도 후보에 다시 넣고, 계획이 없는 상태(누적 ${fmtGpa(r.baseGpa)})에서 다시 계산했습니다. 재수강 과목 수마다 누적 평점이 가장 높은 조합 하나씩입니다.</span>
    <div class="actions-row">
      <span class="small muted">재수강 예상 성적</span>
      <div class="seg" role="group" aria-label="재수강 예상 성적">${gradeOpts.map((g) => `<button type="button" data-act="advice-grade" data-v="${g}" aria-pressed="${r.grade === g}">${g}</button>`).join('')}</div>
      <span class="small muted">포기 한도 남음 ${fmtCr(r.remain)}학점</span>
    </div>
    <div class="small">${curDesc}</div>
    ${r.rows.length ? `<div class="advice-list">${rows}</div>` : '<p class="muted" style="margin:0">추천할 재수강·학점포기 후보가 없습니다.</p>'}
    <span class="foot-note">✓ 표시는 지금 고른 계획에 이미 들어 있는 과목 · 재수강을 늘릴수록 다음 학기 부담도 커집니다 · 학점포기는 되돌릴 수 없으니 실제 신청 전 꼭 확인하세요</span>
  </section>`;
}

const MODE_LABEL = { keep: '원래 기록 유지', exclude: '폐기 과목 제외', replace: '새 성적 반영' };

/** 재수강 계획 → 원래 학기 평점 변화 (옵션별) */
function impactHtml(i, st, { names = false } = {}) {
  const m = (k) => {
    const cur = st.retakeMode === k;
    return `<span${cur ? ' class="impact-cur"' : ''}>${MODE_LABEL[k]} <b class="mono">${fmtGpa(i[k])}</b>${cur ? ' (현재 설정)' : ''}</span>`;
  };
  return `<div class="compare-box impact"><span><b>${esc(semName(i.sem))}</b> 학기 평점 <span class="mono">${fmtGpa(i.before)}</span> →${names ? ` <span class="muted">(${i.courses.map((x) => esc(x.name)).join(', ')})</span>` : ''}</span>${m('keep')}${m('exclude')}${m('replace')}</div>`;
}

// ── 결과 패널 (시뮬레이션) ──
function resultPanel(c) {
  const s = c.sum, cs = c.curSum;
  const planned = sortSemesters(c.scn.semesters).filter((x) => x.isPlanned);
  const lastPlanned = planned[planned.length - 1];
  const lp = lastPlanned ? s.semStats.get(lastPlanned.id) : null;
  const effects = retakeEffects(c.scn, c.st);
  const impacts = retakeSemesterImpact(c.scn, c.st);
  const nErr = c.reg.errors.length;
  return `<aside class="result-panel" aria-label="예상 결과">
    <div class="rp-label" style="font-weight:600;color:var(--text-2)">예상 결과 · 현재 대비</div>
    <div class="rp-block"><span class="rp-label">예상 누적 평점</span>
      <div class="rp-row"><span class="big-num">${fmtGpa(s.gpa)}</span>${delta(s.gpa, cs.gpa)}</div>
      <span class="rp-label">현재 ${fmtGpa(cs.gpa)}</span></div>
    <div class="rp-block"><span class="rp-label">예상 백분위</span>
      <div class="rp-row"><span class="big-num" style="font-size:22px">${fmtPct(s.percentile)}</span>${delta(s.percentile, cs.percentile, 1)}</div></div>
    <div class="rp-block"><span class="rp-label">이수 학점</span>
      <div class="rp-row"><span class="big-num" style="font-size:22px">${fmtCr(s.earned)}</span>${delta(s.earned, cs.earned, 0)}</div></div>
    <div class="rp-block"><span class="rp-label">예상 학기 평점</span>
      <div class="rp-row"><span class="big-num" style="font-size:22px">${fmtGpa(lp?.gpa)}</span></div>
      <span class="rp-label">${lastPlanned ? esc(semName(lastPlanned)) : '예정 학기 없음'}</span></div>
    <div class="rp-block"><span class="rp-label">학점포기</span>
      <div class="rp-row"><span class="mono">${fmtCr(s.waived)} / ${fmtCr(c.st.waiveLimit)}학점</span>${s.waived !== cs.waived ? `<span class="muted small">현재 ${fmtCr(cs.waived)}</span>` : ''}</div>
      ${s.waived ? `<span class="rp-label">포기 전 누적 ${fmtGpa(s.preWaiveGpa)}</span>` : ''}</div>
    ${effects.length ? `<div class="rp-block rp-detail"><span class="rp-label">재수강 효과 · 누적 평점</span>
      <div class="rp-list">${effects.map((e) => `<div><span>${esc(e.c.name)} ${esc(e.orig?.c.grade || '')} → ${esc(e.c.grade)}</span>${e.delta != null ? `<span class="delta ${e.delta > 0 ? 'up' : e.delta < 0 ? 'down' : 'zero'}">${e.delta > 0 ? '+' : ''}${e.delta.toFixed(2)}</span>` : ''}</div>`).join('')}</div></div>` : ''}
    ${impacts.length ? `<div class="rp-block rp-detail"><span class="rp-label">재수강 시 이전 학기 평점</span>
      <div class="rp-list">${impacts.map((i) => `<div style="flex-direction:column;gap:2px"><span><b>${esc(semName(i.sem))}</b> <span class="mono">${fmtGpa(i.before)}</span> → <b class="mono">${fmtGpa(i.current)}</b></span>
        <span class="small muted">유지 ${fmtGpa(i.keep)} · 제외 ${fmtGpa(i.exclude)} · 반영 ${fmtGpa(i.replace)}</span></div>`).join('')}</div>
      <span class="rp-label">현재 설정: ${MODE_LABEL[c.st.retakeMode]}</span></div>` : ''}
    <div class="rp-block"><span class="rp-label">수강신청 조건</span>
      <span class="${nErr ? 'status-err' : 'status-ok'}">${nErr ? `⚠ 오류 ${nErr}건` : '통과'}</span>
      ${nErr ? `<div class="rp-list rp-detail">${[...new Set(c.reg.errors.map((e) => e.msg))].map((m) => `<div><span>${esc(m)}</span></div>`).join('')}</div>` : ''}</div>
  </aside>`;
}

// ── 재수강·학점포기 관리 ──
function plansPage(c) {
  const L = planLists(c.scn, c.st);
  const planned = applyPlans(c.scn);
  const pg = cumulative(planned, c.st).gpa;
  const used = waivedCredits(c.scn);
  const plannedWaive = allCourses(c.scn).filter(({ c: x }) => x.plan === 'waive' && !x.waived).reduce((a, { c: x }) => a + x.credits, 0);
  const remain = c.st.waiveLimit - used - plannedWaive;
  const nRetake = allCourses(c.scn).filter(({ c: x }) => x.plan === 'retake').length;
  const waiveIds = new Set(L.waive.map((w) => w.c.id));
  const retakeIds = new Set(L.retake.map((w) => w.c.id));
  const seg = state.ui.plansSeg;
  const impacts = retakeSemesterImpact(c.scn, c.st);

  const row = (item, kind) => {
    const x = item.c;
    const both = waiveIds.has(x.id) && retakeIds.has(x.id);
    const on = kind === 'retake' ? x.plan === 'retake' : x.plan === 'waive' || x.waived;
    const notes = [`${semName(item.s)} · ${fmtCr(x.credits)}학점`];
    if (kind === 'waive' && item.retakeNeeded) notes.push('포기 시 재이수 필요');
    const tags = [tag(x.category)];
    if (x.isRequired) tags.push(tag('필수', 'strong'));
    if (kind === 'waive' && item.conditional) tags.push(tag('조건부', 'soft'));
    const exp = state.ui.expanded[x.id];
    let cmp = '';
    if (both && exp) {
      const r = compareRetakeVsWaive(c.scn, c.st, { ...x, planGrade: x.planGrade || 'A0' });
      cmp = `<div class="compare-box"><span>재수강 시 (${esc(x.planGrade || 'A0')} 가정) <b>${fmtGpa(r.retake)}</b></span><span>포기 시 <b>${fmtGpa(r.waive)}</b></span><span class="muted">계획 없을 때 ${fmtGpa(r.base)}</span></div>`;
    }
    const imp = kind === 'retake' && x.plan === 'retake' ? impacts.find((i) => i.courses.some((y) => y.id === x.id)) : null;
    if (imp) cmp += impactHtml(imp, c.st);
    const gradeSel = kind === 'retake' && x.plan === 'retake'
      ? `<label class="small muted" style="display:flex;align-items:center;gap:6px">예상<select class="input sm" style="width:76px" data-act-change="plan-grade" data-id="${esc(x.id)}">${LETTERS.filter((g) => gradePoint(g, c.st) <= gradePoint(c.st.retakeCap, c.st)).map((g) => `<option ${((x.planGrade || 'A0') === g) ? 'selected' : ''}>${g}</option>`).join('')}</select></label>`
      : '';
    return `<div class="prow${item.blocked ? ' blocked' : ''}">
      <div class="prow-main">
        <div class="prow-info"><span class="prow-name">${esc(x.name)}</span><span class="muted small">${esc(notes.join(' · '))}</span><span class="tags">${tags.join('')}</span></div>
        ${gradeBadge(x.grade)}
        ${item.blocked
          ? `<span class="muted small" style="max-width:96px;text-align:right">${esc(item.blocked)}</span>`
          : `<button type="button" class="plan-btn" aria-pressed="${on}" data-act="plan" data-kind="${kind}" data-id="${esc(x.id)}" ${x.waived && kind === 'waive' && !c.sim ? 'disabled' : ''}>${kind === 'retake' ? '재수강 예정' : x.waived ? '포기함' : '포기 예정'}</button>`}
      </div>
      ${gradeSel || both ? `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${gradeSel}${both ? `<button type="button" class="btn ghost sm" data-act="expand" data-id="${esc(x.id)}">${exp ? '비교 닫기' : '재수강 시 / 포기 시 비교'}</button>` : ''}</div>` : ''}
      ${cmp}
    </div>`;
  };
  const exclCounts = {};
  L.excluded.forEach((e) => { exclCounts[e.reason] = (exclCounts[e.reason] || 0) + 1; });
  return `${banners(c)}
  <div class="page-head"><div><h1>재수강·학점포기</h1><div class="sub">과목마다 계획은 하나만 · 학점포기는 시뮬레이션에서 비교 후 실제 신청한 뒤 현재에 반영</div></div>
    <div class="head-actions"><button type="button" class="btn" data-act="advisor">추천 받기</button><button type="button" class="btn" data-act="target">목표 평점 역산</button></div></div>
  ${state.ui.target && state.ui.target.scnId === c.scn.id ? targetCard(c, state.ui.target) : ''}
  ${advisorSection(c)}
  <div class="plans-summary">
    <div class="stat"><span class="stat-label">학점포기 한도</span><span class="stat-value"><span class="stat-num">${fmtCr(used + plannedWaive)}</span><span class="stat-unit">/ ${fmtCr(c.st.waiveLimit)}학점</span></span><span class="stat-foot">${plannedWaive ? `포기함 ${fmtCr(used)} · 예정 ${fmtCr(plannedWaive)}` : '사용 학점'}</span></div>
    <div class="stat"><span class="stat-label">재수강 예정</span><span class="stat-value"><span class="stat-num">${nRetake}</span><span class="stat-unit">과목</span></span></div>
    <div class="stat"><span class="stat-label">계획 반영 시 누적</span><span class="stat-value"><span class="stat-num">${fmtGpa(pg)}</span></span><span class="stat-foot">현재 탭 ${fmtGpa(c.curSum.gpa)} ${delta(pg, c.curSum.gpa)}</span></div>
    <div class="stat"><span class="stat-label">계획 반영 시 백분위</span><span class="stat-value"><span class="stat-num">${fmtPct(percentile(pg, c.st))}</span></span></div>
  </div>
  <div class="seg plans-seg" role="group" aria-label="목록 전환"><button type="button" data-act="plans-seg" data-v="retake" aria-pressed="${seg === 'retake'}">재수강 후보</button><button type="button" data-act="plans-seg" data-v="waive" aria-pressed="${seg === 'waive'}">학점포기 후보</button></div>
  <div class="plans-cols" data-seg="${seg}">
    <section class="card col-retake"><div class="card-head"><h2>재수강 후보</h2><span class="muted small">등급평가 · C+ 이하</span></div>
      ${L.retake.map((i) => row(i, 'retake')).join('') || '<p class="muted small" style="margin:0">C+ 이하 과목이 없습니다</p>'}</section>
    <section class="card col-waive"><div class="card-head"><h2>학점포기 후보</h2><span class="muted small">남은 한도 ${fmtCr(Math.max(0, remain))}학점</span></div>
      ${L.waive.map((i) => row(i, 'waive')).join('') || '<p class="muted small" style="margin:0">학점포기할 수 있는 과목이 없습니다</p>'}</section>
  </div>
  ${L.excluded.length ? `<section class="card">
    <button type="button" class="btn ghost" style="justify-content:flex-start;padding:0" data-act="toggle-excluded" aria-expanded="${state.ui.showExcluded}">${icon.chevron()} 제외된 과목 ${L.excluded.length}개 <span class="muted small">${Object.entries(exclCounts).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</span></button>
    ${state.ui.showExcluded ? L.excluded.map((e) => `<div class="prow"><div class="prow-main"><div class="prow-info"><span class="prow-name">${esc(e.c.name)}</span><span class="muted small">${esc(semName(e.s))} · ${fmtCr(e.c.credits)}학점 · 제외 이유: ${esc(e.reason)}</span></div>${gradeBadge(e.c.grade)}</div></div>`).join('') : ''}
  </section>` : ''}
  <p class="foot-note">${c.sim ? '시뮬레이션: "재수강 예정"은 예정 학기에 재수강 과목을 자동으로 넣고, "포기 예정"은 W를 가정해 바로 계산합니다.' : '현재 탭: 계획은 표시만 합니다. 실제 학점포기는 학기 상세 › 과목 메뉴 › 학점포기 적용으로 처리하세요.'}</p>`;
}

// ── 비교 보기 ──
function comparePage(c) {
  const all = state.data.scenarios;
  let sel = state.ui.compare.filter((id) => all.some((s) => s.id === id));
  if (sel.length < 2) sel = [...new Set(['current', c.scn.id, ...all.map((s) => s.id)])].slice(0, Math.min(3, all.length));
  state.ui.compare = sel;
  const rows = sel.map((id) => {
    const s = all.find((x) => x.id === id);
    const sm = summarize(s, c.st);
    return { s, sm, err: checkRegistration(s, c.st).errors.length };
  });
  const base = rows[0];
  const line = (label, f, d = 2, unit = '') => `<tr><td>${label}</td>${rows.map((r, i) => `<td>${f(r)}${i > 0 && d != null ? ' ' + delta(rawOf(label, r), rawOf(label, base), d, unit) : ''}</td>`).join('')}</tr>`;
  const rawOf = (label, r) => ({ '누적 평점': r.sm.gpa, '백분위': r.sm.percentile, '이수 학점': r.sm.earned, '학점포기': r.sm.waived })[label];
  return `<div class="page-head"><div><h1>비교 보기</h1><div class="sub">탭 2~3개의 핵심 수치를 나란히 봅니다</div></div></div>
  <div class="chips">${all.map((s) => `<label class="chip"><input type="checkbox" data-act-change="compare-pick" value="${esc(s.id)}" ${sel.includes(s.id) ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}</div>
  <section class="card" style="overflow-x:auto">
    <table class="table-plain">
      <thead><tr><th></th>${rows.map((r) => `<th>${esc(r.s.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${line('누적 평점', (r) => fmtGpa(r.sm.gpa))}
        ${line('백분위', (r) => fmtPct(r.sm.percentile), 1)}
        ${line('이수 학점', (r) => fmtCr(r.sm.earned), 0)}
        ${line('학점포기', (r) => `${fmtCr(r.sm.waived)} / ${fmtCr(c.st.waiveLimit)}`, null)}
        <tr><td>포기 전 누적</td>${rows.map((r) => `<td>${fmtGpa(r.sm.preWaiveGpa)}</td>`).join('')}</tr>
        <tr><td>수강신청 조건</td>${rows.map((r) => `<td>${r.err ? `<span class="status-err">오류 ${r.err}건</span>` : r.s.kind === 'current' ? '—' : '<span class="status-ok">통과</span>'}</td>`).join('')}</tr>
      </tbody>
    </table>
  </section>`;
}

// ── 설정 ──
function sw(path, on, label) {
  return `<button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-act="toggle" data-path="${esc(path)}"></button>`;
}

function settingsPage(c) {
  const st = c.st, R = st.rules;
  const last = st.lastBackupAt ? new Date(st.lastBackupAt) : null;
  const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
  const ay = st.admissionYear;
  const theme = st.theme;
  const isDefaultCat = (name) => ['전공기초(필수)', '전공핵심', '전공심화', '핵심교양', '교양필수', '일반선택', '타전공일반선택'].includes(name);
  return `<div class="page-head"><h1>설정</h1></div>
  <div class="settings">
    <section class="card"><h2>전공 · 학적</h2>
      <div class="field-row"><span class="lbl">본전공<span class="hint">졸업요건 충족 — 졸업사정은 계산하지 않음</span></span><span>경영공학전공</span></div>
      <div class="field-row"><label for="s_ay">입학년도<span class="hint">재수강 횟수 규칙(2025학번부터 과목당 2회) 적용 판단용</span></label>
        <input class="input sm" id="s_ay" inputmode="numeric" data-set="admissionYear" data-type="int" value="${ay ?? ''}" placeholder="예: 2024"></div>
      <div class="field-row"><span class="lbl">부전공 · 복수전공<span class="hint">개발 예정 · 연극영화학과 합격과 요건 확정 후 추가</span></span><button type="button" class="btn sm" disabled>+ 전공 추가</button></div>
    </section>

    <section class="card"><h2>기준값</h2>
      <div class="field-row"><span class="lbl">만점</span><span class="mono">${st.scale}</span></div>
      <div class="field-row"><label for="s_cap">재수강 인정 상한</label>
        <select class="input sm" id="s_cap" data-set="retakeCap">${LETTERS.slice(0, 4).map((g) => `<option ${st.retakeCap === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="field-row"><label for="s_wl">학점포기 한도 (학점)</label>
        <input class="input sm" id="s_wl" inputmode="decimal" data-set="waiveLimit" data-type="num" value="${st.waiveLimit}"></div>
      <div class="field-row"><label>백분위 공식<span class="hint">성적증명서 수치와 한 번 대조하세요 · 기본 55 + 평점 × 10</span></label>
        <span style="display:flex;align-items:center;gap:6px"><input class="input sm" style="width:72px" inputmode="decimal" aria-label="상수" data-set="percentile.base" data-type="num" value="${st.percentile.base}"> + 평점 × <input class="input sm" style="width:72px" inputmode="decimal" aria-label="배수" data-set="percentile.mult" data-type="num" value="${st.percentile.mult}"></span></div>
      <div class="field-row"><span class="lbl">등급별 평점<span class="hint">${LETTERS.map((g) => `${g} ${st.gradePoints[g]}`).join(' · ')}</span></span><button type="button" class="btn sm" data-act="edit-points">편집</button></div>
    </section>

    <section class="card"><h2>재수강 시 이전 학기 평점</h2>
      ${[['keep', '원래 기록 유지', '이전 학기 평점은 원래 성적 그대로 · 기본값 (학교 안내 문구 기준)'], ['exclude', '이전 학기에서 제외', '폐기된 과목을 이전 학기 평점·이수 학점에서 빼고 계산'], ['replace', '이전 학기에 새 성적 반영', '재수강 성적을 원래 학기에 넣어 계산']]
        .map(([v, l, h]) => `<label class="radio-row"><input type="radio" name="retakeMode" value="${v}" data-set="retakeMode" ${st.retakeMode === v ? 'checked' : ''}><span style="display:flex;flex-direction:column;gap:2px"><span>${l}</span><span class="small muted">${h}</span></span></label>`).join('')}
      <p class="foot-note">학기 평점과 우수·우등 표시에만 영향 · 누적 평점(증명용)은 같음</p>
    </section>

    <section class="card"><div class="card-head"><h2>이수구분</h2><button type="button" class="btn sm" data-act="add-category">+ 추가</button></div>
      ${st.categories.map((cat, i) => `<div class="field-row"><span class="lbl">${esc(cat.name)}<span class="hint">${cat.major ? '전공 평점 포함' : ''}${cat.requiredFlag ? ' · 필수 지정 가능' : ''}${cat.retakeNeeded ? ' · 포기 시 재이수 안내' : ''}</span></span>
        <span style="display:flex;gap:8px;align-items:center"><select class="input sm" style="width:110px" aria-label="${esc(cat.name)} 학점포기" data-set="categories.${i}.waivable">${['yes', 'conditional', 'no'].map((w) => `<option value="${w}" ${cat.waivable === w ? 'selected' : ''}>포기 ${WAIVABLE_LABEL[w]}</option>`).join('')}</select>
        ${isDefaultCat(cat.name) ? '' : `<button type="button" class="btn sm danger" data-act="del-category" data-idx="${i}">삭제</button>`}</span></div>`).join('')}
    </section>

    <section class="card"><h2>수강신청 규칙</h2>
      <div class="field-row"><span class="lbl">정규학기 e-러닝 C형<span class="hint">학기당 최대 과목 수</span></span><span style="display:flex;gap:10px;align-items:center"><input class="input sm" style="width:64px" inputmode="numeric" data-set="rules.elearningC.value" data-type="int" value="${R.elearningC.value}" aria-label="e-러닝 C형 최대 과목 수">${sw('rules.elearningC.on', R.elearningC.on, 'e-러닝 C형 규칙')}</span></div>
      <div class="field-row"><span class="lbl">정규학기 최대 신청 학점<span class="hint">수강편람 확인 후 입력</span></span><span style="display:flex;gap:10px;align-items:center"><input class="input sm" style="width:64px" inputmode="decimal" data-set="rules.maxCredits.value" data-type="num" value="${R.maxCredits.value ?? ''}" placeholder="—" aria-label="최대 신청 학점">${sw('rules.maxCredits.on', R.maxCredits.on, '최대 신청 학점 규칙')}</span></div>
      <div class="field-row"><span class="lbl">계절학기 학점·과목 수<span class="hint">대면만 ${R.seasonalLimit.offCredits}학점·${R.seasonalLimit.offCourses}과목 / 온라인 병행 ${R.seasonalLimit.onCredits}학점·${R.seasonalLimit.onCourses}과목</span></span>${sw('rules.seasonalLimit.on', R.seasonalLimit.on, '계절학기 한도 규칙')}</div>
      <div class="field-row"><span class="lbl">계절학기 신청 제한<span class="hint">직전 정규학기 수강 과목은 바로 이은 계절학기에 불가</span></span>${sw('rules.seasonalPrev.on', R.seasonalPrev.on, '계절학기 신청 제한')}</div>
      <div class="field-row"><span class="lbl">재수강 대상<span class="hint">C+ 이하만 원과목으로 선택</span></span>${sw('rules.retakeTarget.on', R.retakeTarget.on, '재수강 대상 규칙')}</div>
      <div class="field-row"><span class="lbl">재수강 횟수<span class="hint">2025학번부터 과목당 ${R.retakeCount.value}회 (필수·F 과목 제외)${ay && ay < 2025 ? ` · 입학년도 ${ay}라 적용 안 됨` : !ay ? ' · 입학년도를 입력하세요' : ''}</span></span>${sw('rules.retakeCount.on', R.retakeCount.on, '재수강 횟수 규칙')}</div>
      <div class="field-row"><span class="lbl">같은 과목 중복<span class="hint">같은 예정 학기에 같은 과목명 — 경고만</span></span>${sw('rules.duplicate.on', R.duplicate.on, '같은 과목 중복 경고')}</div>
    </section>

    <section class="card"><h2>학점포기 추천</h2>
      <div class="field-row"><span class="lbl">조건부 과목 포함<span class="hint">전공기초(필수)·교양필수는 "개설 여부 확인 필요" 표시를 달고 포함</span></span>${sw('advisorIncludeConditional', st.advisorIncludeConditional, '조건부 과목 포함')}</div>
    </section>

    <section class="card"><h2>데이터</h2>
      <div class="field-row"><span class="lbl">마지막 백업<span class="hint">${last ? `${last.toLocaleDateString('ko-KR')} · ${days}일 전${days > 30 ? ' — 백업을 권장합니다' : ''}` : '아직 백업하지 않았습니다'}</span></span>
        <span style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm primary" data-act="export">JSON 내보내기</button><button type="button" class="btn sm" data-act="import">가져오기</button></span></div>
      <div class="field-row"><span class="lbl">전체 초기화<span class="hint">모든 탭·학기·과목·설정을 지웁니다</span></span><button type="button" class="btn sm danger" data-act="reset">전체 초기화</button></div>
      <p class="foot-note">데이터는 이 기기의 브라우저에만 저장됩니다. 아이패드에서는 Safari 공유 › 홈 화면에 추가해서 쓰세요 (Safari와 홈 화면 앱은 저장소가 따로일 수 있으니 한쪽에서만 사용).</p>
    </section>

    <section class="card"><h2>테마</h2>
      <div class="seg" role="group" aria-label="테마">${[['light', '라이트'], ['dark', '다크'], ['system', '시스템']].map(([v, l]) => `<button type="button" data-act="theme" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}</div>
    </section>
  </div>`;
}

// ── 전체 ──
export function renderApp(el) {
  const c = ctx();
  const r = state.ui.route;
  let page = '';
  let withPanel = c.sim && r.name !== 'settings' && r.name !== 'compare';
  if (r.name === 'dashboard') page = c.sim ? simPage(c) : dashboard(c);
  else if (r.name === 'semester') page = semesterPage(c, c.scn.semesters.find((s) => s.id === r.id));
  else if (r.name === 'plans') page = plansPage(c);
  else if (r.name === 'settings') page = settingsPage(c);
  else if (r.name === 'compare') page = comparePage(c);
  const body = el.querySelector('.content');
  const scroll = body && el.dataset.route === JSON.stringify(r) + c.scn.id ? body.scrollTop : 0;
  el.innerHTML = `<div class="app${state.ui.drawer ? ' drawer-open' : ''}">
    ${sidebar(c)}
    ${state.ui.drawer ? '<div class="drawer-scrim" data-act="drawer"></div>' : ''}
    <div class="main">
      ${tabs(c)}
      <div class="body${withPanel ? ' with-panel' : ''}">
        <main class="content" id="content">${page}</main>
        ${withPanel ? resultPanel(c) : ''}
      </div>
    </div>
  </div>`;
  el.dataset.route = JSON.stringify(r) + c.scn.id;
  const nb = el.querySelector('.content');
  if (nb) nb.scrollTop = scroll;
}

export { categoryInfo };
