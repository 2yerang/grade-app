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
    <label class="check-row"><input type="checkbox" name="isRetake" ${d.isRetake ? 'checked' : ''}>
      <div><span>재수강 과목</span><span class="fld-hint">원과목을 고르면 과목명·학수번호·학점·이수구분·필수 지정·수업 유형·트랙을 그대로 가져옵니다 · C+ 이하만 · 최대 A0</span></div></label>
    ${d.isRetake ? `<div class="fld">
      <label class="fld-label" for="f_orig">원과목</label>
      <select class="input${showErr && err.retakeOf ? ' err' : ''}" id="f_orig" name="retakeOf">
        <option value="">선택하세요</option>
        ${origins.map(({ c, s }) => `<option value="${esc(c.id)}" ${d.retakeOf === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(semName(s))} · ${esc(c.grade)} · ${fmtCr(c.credits)}학점</option>`).join('')}
      </select>
      ${origins.length ? '' : '<span class="fld-hint">재수강할 수 있는 C+ 이하 과목이 없습니다</span>'}
      ${ctx.filledFrom && d.retakeOf ? `<span class="fld-hint" style="color:var(--accent-ink)">원과목(${esc(ctx.filledFrom)}) 정보를 가져왔습니다. 바뀐 게 있으면 아래에서 고치세요.</span>` : ''}
      ${e('retakeOf')}
    </div>` : ''}
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
    ${warn.map((w) => `<div class="fld-warn">${esc(w)}</div>`).join('')}
  </div>
  <div class="sheet-foot">
    <span class="kbd-hint">키보드: Tab 이동 · ←→ 선택 · Enter 저장${ctx.course ? '' : ' · ⇧Enter 하나 더'}</span>
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
  nd.isRetake = !!(rt && rt.checked);
  if (nd.isRetake && nd.gradingType !== 'letter') { nd.gradingType = 'letter'; if (nd.grade && !LETTERS.includes(nd.grade)) nd.grade = null; } // 재수강은 등급평가만
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
    const key = box.contains(document.activeElement) ? stopKey(document.activeElement) : lastStop;
    box.innerHTML = render(d, ctx, showErr);
    box.querySelector('.sheet-body').scrollTop = top;
    if (key && kbd) focusStop(key); // 키보드로 쓰는 중이면 다시 그린 뒤에도 같은 칸에 포커스
  };

  // ── 키보드 (아이패드 블루투스 키보드) ──
  // Safari는 Tab으로 버튼·라디오(칩)를 건너뛰므로 직접 순서를 관리한다.
  let kbd = false, lastStop = null;
  const stops = () => {
    const out = [], seen = new Set();
    for (const el of box.querySelectorAll('.sheet-body input, .sheet-body select, .sheet-foot button')) {
      if (el.disabled) continue;
      const k = stopKey(el);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  };
  function stopKey(el) {
    if (!el) return null;
    if (el.type === 'radio') return `r:${el.name}`;
    if (el.name) return `n:${el.name}`;
    if (el.dataset && el.dataset.dlg) return `b:${el.dataset.dlg}`;
    return null;
  }
  function focusStop(k) {
    let el = null;
    if (k.startsWith('r:')) {
      const n = k.slice(2);
      el = box.querySelector(`input[name="${n}"]:checked`) || box.querySelector(`input[name="${n}"]`);
    } else if (k.startsWith('n:')) el = box.querySelector(`[name="${k.slice(2)}"]`);
    else if (k.startsWith('b:')) el = box.querySelector(`[data-dlg="${k.slice(2)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      (el.closest('.chip, .check-row, .fld') || el).scrollIntoView({ block: 'nearest' });
      lastStop = k;
    }
    return !!el;
  }
  box.addEventListener('focusin', (e) => { const k = stopKey(e.target); if (k) lastStop = k; });
  box.addEventListener('pointerdown', (e) => {
    kbd = false;
    box.classList.remove('kbd-nav');
    const inp = e.target.closest('label')?.querySelector('input') || e.target.closest('input, select, button');
    const k = stopKey(inp);
    if (k) lastStop = k;
  });
  const onKey = (e) => {
    if (!box.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (document.getElementById('layer').lastElementChild !== box.parentElement) return; // 위에 다른 창이 열림
    const t = e.target;
    if (e.key === 'Tab') {
      e.preventDefault();
      kbd = true;
      box.classList.add('kbd-nav');
      const list = stops();
      const cur = box.contains(t) ? stopKey(t) : lastStop;
      let i = list.indexOf(cur);
      i = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      focusStop(list[i]);
      return;
    }
    if (t.type === 'radio' && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      kbd = true;
      const group = [...box.querySelectorAll(`input[name="${t.name}"]`)];
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      const next = group[(group.indexOf(t) + dir + group.length) % group.length];
      next.checked = true;
      next.focus({ preventScroll: true });
      next.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if ((t.type === 'radio' || t.type === 'checkbox') && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      kbd = true;
      if (t.type === 'checkbox') t.checked = !t.checked; else t.checked = true;
      t.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // Enter(텍스트 칸) 또는 ⌘/Ctrl+Enter → 저장
    if (e.key === 'Enter' && ((t.tagName === 'INPUT' && t.type === 'text' && !e.isComposing) || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      box.querySelector(e.shiftKey && !ctx.course ? '[data-dlg="saveMore"]' : '[data-dlg="save"]')?.click();
    }
  };
  document.addEventListener('keydown', onKey, true);
  /** 원과목의 과목 정보(이름·학수번호·학점·이수구분·필수 지정·수업 유형·트랙)를 그대로 가져온다. 성적은 비워 둔다. */
  function fillFromOrigin() {
    const o = findCourse(ctx.scn, d.retakeOf);
    if (!o) return;
    const c = o.c;
    d.name = c.name;
    d.courseCode = c.courseCode || d.courseCode;
    d.creditsText = fmtCr(c.credits);
    d.category = c.category;
    d.isRequired = !!c.isRequired;
    d.delivery = c.delivery || d.delivery;
    d.track = c.track || '';
    d.gradingType = 'letter';
    ctx.filledFrom = `${semName(o.s)} ${c.grade}`;
  }
  box.addEventListener('change', (e) => {
    const n = e.target.name;
    if (!n || e.target.type === 'text' || e.target.tagName === 'INPUT' && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
    if (n === 'creditsQuick') box.querySelector('[name="creditsCustom"]').value = '';
    d = readDraft(box, d);
    // 재수강 체크 시: 입력한 과목명과 같은 C+ 이하 과목이 있으면 원과목으로 자동 선택
    if (n === 'isRetake' && d.isRetake && !d.retakeOf) {
      const nm = d.name.trim().replace(/\s+/g, '');
      const opts = retakeOriginOptions(ctx.scn, ctx.settings, { excludeSemId: ctx.sem.id, excludeCourseId: ctx.course?.id });
      const hit = nm ? opts.filter((x) => x.c.name.replace(/\s+/g, '') === nm) : [];
      if (hit.length) d.retakeOf = hit[hit.length - 1].c.id; else if (opts.length === 1) d.retakeOf = opts[0].c.id;
      if (d.retakeOf) fillFromOrigin();
    }
    if (n === 'retakeOf' && d.retakeOf) fillFromOrigin();
    rerender();
  });
  box.addEventListener('input', (e) => {
    if (e.target.name === 'creditsCustom' && e.target.value.trim()) {
      box.querySelectorAll('[name="creditsQuick"]').forEach((r) => { r.checked = false; });
    }
  });
}
