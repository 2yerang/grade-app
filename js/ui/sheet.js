// 과목 입력 시트 (PRD 7.3, 9장 검증)
import { esc, icon, fmtCr } from './h.js';
import { openModal } from './dialogs.js';
import { LETTERS, DELIVERY, TRACKS, categoryInfo, gradePoint } from '../domain/grades.js';
import { retakeOriginOptions, findCourse } from '../domain/rules.js';
import { semName, allCourses } from '../domain/calc.js';

const GROUPS = [
  ['major', '주전공 · 경영공학'],
  ['liberal', '교양'],
  ['elective', '선택'],
  ['other', '기타'],
];

function blankDraft(keep = {}) {
  return {
    name: '', courseCode: '', creditsText: '3', category: keep.category || '', isRequired: false,
    delivery: keep.delivery || 'offline', track: '', gradingType: 'letter', grade: null,
    isRetake: false, retakeOf: '',
  };
}

function draftFrom(c) {
  return {
    name: c.name, courseCode: c.courseCode || '', creditsText: fmtCr(c.credits), category: c.category, isRequired: !!c.isRequired,
    delivery: c.delivery || 'offline', track: c.track || '', gradingType: c.gradingType, grade: c.grade,
    isRetake: !!c.retakeOf, retakeOf: c.retakeOf || '',
  };
}

function parseCredits(t) {
  const n = Number(String(t).trim());
  if (!String(t).trim() || !isFinite(n)) return null;
  return n;
}

function validate(d, ctx) {
  const err = {}, warn = [];
  if (!d.name.trim()) err.name = '과목명을 입력하세요';
  else if (d.name.trim().length > 50) err.name = '과목명은 50자 이내로 입력하세요';
  const cr = parseCredits(d.creditsText);
  if (cr == null || cr < 0.5 || cr > 6 || Math.round(cr * 2) !== cr * 2) err.credits = '0.5~6 사이, 0.5 단위로 입력하세요';
  if (!d.category) err.category = '이수구분을 선택하세요';
  if (d.isRetake && !d.retakeOf) err.retakeOf = '재수강 원과목을 선택하세요';

  const nm = d.name.trim().replace(/\s+/g, '');
  if (nm && ctx.sem.courses.some((c) => c.id !== ctx.course?.id && c.name.replace(/\s+/g, '') === nm)) {
    warn.push('같은 학기에 같은 과목명이 있습니다 (저장은 됩니다)');
  }
  if (d.isRetake && d.retakeOf) {
    const o = findCourse(ctx.scn, d.retakeOf);
    if (o) {
      if (d.courseCode && o.c.courseCode && d.courseCode.trim().toUpperCase() !== o.c.courseCode.trim().toUpperCase()) {
        warn.push('학수번호가 같아야 성적상승재수강으로 인정됩니다');
      }
      if (d.grade === 'A+') warn.push('재수강은 A0까지 인정됩니다 — A0로 계산합니다');
      const capP = Math.min(gradePoint(d.grade, ctx.settings) ?? -1, gradePoint(ctx.settings.retakeCap, ctx.settings));
      const oP = gradePoint(o.c.grade, ctx.settings);
      if (d.grade && d.gradingType === 'letter' && capP < oP) warn.push('재수강 성적이 원래 성적보다 낮아 원래 성적이 남고, 재수강 쪽이 폐기됩니다');
    }
  }
  return { err, warn, credits: cr };
}

function radio(name, value, checked, label, cls = '') {
  return `<label class="chip ${cls}"><input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}

function render(d, ctx, showErr) {
  const { err, warn } = validate(d, ctx);
  const e = (k) => (showErr && err[k] ? `<span class="fld-err">${esc(err[k])}</span>` : '');
  const cat = d.category ? categoryInfo(ctx.settings, d.category) : null;
  const cats = ctx.settings.categories;
  const catChips = GROUPS.map(([g, label]) => {
    const list = cats.filter((c) => (c.group || 'other') === g);
    if (!list.length) return '';
    return `<span class="group-label">${esc(label)}</span>${list.map((c) => radio('category', c.name, d.category === c.name, c.name)).join('')}`;
  }).join('');
  const gradeLabel = ctx.sim ? '예상 성적' : '성적';
  const gradeOpts = d.gradingType === 'letter'
    ? `<div class="grade-grid">${LETTERS.map((g) => radio('grade', g, d.grade === g, g, 'grade')).join('')}${radio('grade', '', d.grade == null, '미정 · 수강 중', 'wide')}</div>`
    : `<div class="grade-grid">${radio('grade', 'P', d.grade === 'P', 'P', 'grade')}${radio('grade', 'NP', d.grade === 'NP', 'NP', 'grade')}${radio('grade', '', d.grade == null, '미정')}</div>`;

  const origins = retakeOriginOptions(ctx.scn, ctx.settings, { excludeSemId: ctx.sem.id, excludeCourseId: ctx.course?.id })
    .filter((x) => x.c.retakeOf !== ctx.course?.id);
  if (d.retakeOf && !origins.some((x) => x.c.id === d.retakeOf)) {
    const cur = findCourse(ctx.scn, d.retakeOf);
    if (cur) origins.unshift(cur);
  }
  const names = [...new Set(allCourses(ctx.scn).map((x) => x.c.name))];

  return `
  <div class="sheet-head">
    <div><h1>${ctx.course ? '과목 수정' : '과목 추가'}</h1><span class="muted small">${esc(semName(ctx.sem))} · ${ctx.sim ? esc(ctx.scnName) : '현재'}</span></div>
    <button type="button" class="icon-btn" data-dlg="close" aria-label="닫기">${icon.close()}</button>
  </div>
  <div class="sheet-body">
    <div class="fld">
      <label class="fld-label" for="f_name">과목명 <span class="req">*</span></label>
      <input class="input${showErr && err.name ? ' err' : ''}" id="f_name" name="name" value="${esc(d.name)}" list="f_names" autocomplete="off" maxlength="50" ${ctx.course ? '' : 'autofocus'}>
      <datalist id="f_names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      ${e('name') || '<span class="fld-hint">이전에 입력한 과목명이 자동완성됩니다</span>'}
    </div>
    <div class="fld">
      <label class="fld-label" for="f_code">학수번호 (선택)</label>
      <input class="input" id="f_code" name="courseCode" value="${esc(d.courseCode)}" placeholder="예: IIE3012" autocomplete="off" autocapitalize="characters">
      <span class="fld-hint">재수강 시 원과목과 같아야 성적상승재수강으로 인정됩니다</span>
    </div>
    <div class="fld">
      <span class="fld-label">학점 <span class="req">*</span></span>
      <div class="chips">
        ${['1', '2', '3', '4'].map((v) => radio('creditsQuick', v, d.creditsText === v, v)).join('')}
        <input class="input${showErr && err.credits ? ' err' : ''}" style="width:120px" name="creditsCustom" inputmode="decimal" placeholder="직접 입력" aria-label="학점 직접 입력" value="${['1', '2', '3', '4'].includes(d.creditsText) ? '' : esc(d.creditsText)}">
      </div>
      ${e('credits') || '<span class="fld-hint">0.5 단위, 0.5~6학점</span>'}
    </div>
    <div class="fld">
      <span class="fld-label">이수구분 <span class="req">*</span></span>
      <div class="chips">${catChips}</div>
      <span class="fld-hint">부전공·복수전공 구분은 개발 예정</span>
      ${e('category')}
    </div>
    ${cat && cat.requiredFlag ? `
    <label class="check-row"><input type="checkbox" name="isRequired" ${d.isRequired ? 'checked' : ''}>
      <div><span>학과 필수 지정 과목</span><span class="fld-hint">체크하면 학점포기 불가 · 후보와 추천에서 빠집니다</span></div></label>` : ''}
    <div class="fld">
      <span class="fld-label">수업 유형</span>
      <div class="chips">${DELIVERY.map((x) => radio('delivery', x.id, d.delivery === x.id, x.label)).join('')}</div>
    </div>
    <div class="fld">
      <span class="fld-label">트랙 (선택)</span>
      <div class="chips">${radio('track', '', !d.track, '없음')}${TRACKS.map((t) => radio('track', t, d.track === t, t)).join('')}</div>
    </div>
    <div class="fld">
      <span class="fld-label">평가 방식</span>
      <div class="chips">${radio('gradingType', 'letter', d.gradingType === 'letter', '등급 (A+~F)')}${radio('gradingType', 'pf', d.gradingType === 'pf', 'P / F')}</div>
    </div>
    <div class="fld">
      <span class="fld-label">${gradeLabel}</span>
      ${gradeOpts}
    </div>
    ${d.gradingType === 'letter' ? `
    <label class="check-row"><input type="checkbox" name="isRetake" ${d.isRetake ? 'checked' : ''}>
      <div><span>재수강 과목</span><span class="fld-hint">C+ 이하 과목만 원과목으로 고를 수 있습니다 · 최대 A0 · 좋은 성적 하나만 누적에 반영</span></div></label>
    ${d.isRetake ? `<div class="fld">
      <label class="fld-label" for="f_orig">원과목</label>
      <select class="input${showErr && err.retakeOf ? ' err' : ''}" id="f_orig" name="retakeOf">
        <option value="">선택하세요</option>
        ${origins.map(({ c, s }) => `<option value="${esc(c.id)}" ${d.retakeOf === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(semName(s))} · ${esc(c.grade)} · ${fmtCr(c.credits)}학점</option>`).join('')}
      </select>
      ${origins.length ? '' : '<span class="fld-hint">재수강할 수 있는 C+ 이하 과목이 없습니다</span>'}
      ${e('retakeOf')}
    </div>` : ''}` : ''}
    ${warn.map((w) => `<div class="fld-warn">${esc(w)}</div>`).join('')}
  </div>
  <div class="sheet-foot">
    ${ctx.course ? '' : '<button type="button" class="btn" data-dlg="saveMore">저장 후 하나 더</button>'}
    <button type="button" class="btn primary" data-dlg="save">저장</button>
  </div>`;
}

function readDraft(box, d) {
  const val = (n) => box.querySelector(`[name="${n}"]:checked`)?.value;
  const nd = { ...d };
  nd.name = box.querySelector('[name="name"]').value;
  nd.courseCode = box.querySelector('[name="courseCode"]').value.trim();
  const custom = box.querySelector('[name="creditsCustom"]').value.trim();
  nd.creditsText = custom || val('creditsQuick') || '';
  nd.category = val('category') || '';
  const req = box.querySelector('[name="isRequired"]');
  nd.isRequired = req ? req.checked : false;
  nd.delivery = val('delivery') || 'offline';
  nd.track = val('track') || '';
  nd.gradingType = val('gradingType') || 'letter';
  const g = val('grade');
  nd.grade = g ? g : null;
  const allowed = nd.gradingType === 'letter' ? LETTERS : ['P', 'NP'];
  if (nd.grade && !allowed.includes(nd.grade)) nd.grade = null; // 평가 방식 변경 시 미정으로
  const rt = box.querySelector('[name="isRetake"]');
  nd.isRetake = nd.gradingType === 'letter' && !!(rt && rt.checked);
  const ro = box.querySelector('[name="retakeOf"]');
  nd.retakeOf = nd.isRetake ? (ro ? ro.value : d.retakeOf) : '';
  return nd;
}

/**
 * ctx: { scn, scnName, sem, course?, settings, sim, onSave(data, course) }
 */
export function openCourseSheet(ctx) {
  let d = ctx.course ? draftFrom(ctx.course) : blankDraft();
  let showErr = false;
  const { box } = openModal({
    className: 'sheet', center: false, label: ctx.course ? '과목 수정' : '과목 추가',
    html: render(d, ctx, showErr),
    onAction: (a, t, box, close) => {
      if (a === 'close') return close();
      if (a === 'save' || a === 'saveMore') {
        d = readDraft(box, d);
        const v = validate(d, ctx);
        if (Object.keys(v.err).length) { showErr = true; rerender(); return; }
        const data = {
          name: d.name.trim(), courseCode: d.courseCode || null, credits: v.credits, category: d.category,
          isRequired: categoryInfo(ctx.settings, d.category).requiredFlag ? d.isRequired : false,
          delivery: d.delivery, track: d.track || null, gradingType: d.gradingType, grade: d.grade,
          retakeOf: d.isRetake ? d.retakeOf : null,
        };
        ctx.onSave(data, ctx.course);
        if (a === 'saveMore') {
          d = blankDraft({ category: d.category, delivery: d.delivery });
          showErr = false;
          rerender();
          box.querySelector('[name="name"]').focus();
        } else close();
      }
    },
  });
  const rerender = () => {
    const body = box.querySelector('.sheet-body');
    const top = body ? body.scrollTop : 0;
    box.innerHTML = render(d, ctx, showErr);
    box.querySelector('.sheet-body').scrollTop = top;
  };
  box.addEventListener('change', (e) => {
    const n = e.target.name;
    if (!n || e.target.type === 'text' || e.target.tagName === 'INPUT' && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
    if (n === 'creditsQuick') box.querySelector('[name="creditsCustom"]').value = '';
    d = readDraft(box, d);
    if (n === 'retakeOf' && d.retakeOf) {
      const o = findCourse(ctx.scn, d.retakeOf);
      if (o) {
        if (!d.name.trim()) d.name = o.c.name;
        if (!d.courseCode && o.c.courseCode) d.courseCode = o.c.courseCode;
        if (!d.category) d.category = o.c.category;
        d.creditsText = d.creditsText || fmtCr(o.c.credits);
      }
    }
    rerender();
  });
  box.addEventListener('input', (e) => {
    if (e.target.name === 'creditsCustom' && e.target.value.trim()) {
      box.querySelectorAll('[name="creditsQuick"]').forEach((r) => { r.checked = false; });
    }
  });
}
