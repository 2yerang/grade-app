// Promise 기반 확인 창 / 입력 창 / 액션 시트 / 토스트
import { esc, icon } from './h.js';

let root = null;
export function mountLayer(el) { root = el; }

/** 공용 모달. render(el) 후 클릭 시 data-dlg 값을 onAction에 넘긴다. */
export function openModal({ html, className = 'dialog', center = true, onAction, onClose, label }) {
  const scrim = document.createElement('div');
  scrim.className = `scrim${center ? ' center' : ''}`;
  const box = document.createElement('div');
  box.className = className;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  if (label) box.setAttribute('aria-label', label);
  box.innerHTML = html;
  scrim.appendChild(box);
  root.appendChild(scrim);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* */ }
    onClose && onClose(v);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && root.lastElementChild === scrim) { e.preventDefault(); close(null); }
  };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) { close(null); return; }
    const t = e.target.closest('[data-dlg]');
    if (t && box.contains(t) && !t.disabled) onAction && onAction(t.dataset.dlg, t, box, close);
  });
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    onAction && onAction('submit', e.target, box, close);
  });
  setTimeout(() => {
    const f = box.querySelector('[autofocus]') || box.querySelector('input, select, button.btn.primary, button.btn.accent, button.btn.danger-solid');
    f && f.focus({ preventScroll: true });
  }, 30);
  return { box, close };
}

export function confirmDialog({ title, body = '', note = '', ok = '확인', cancel = '취소', danger = false, iconHtml = '' }) {
  return new Promise((resolve) => {
    openModal({
      label: title,
      html: `<h2>${iconHtml ? `<span class="dlg-icon">${iconHtml}</span>` : ''}${esc(title)}</h2>
        ${body ? `<p>${body}</p>` : ''}${note ? `<p class="note">${note}</p>` : ''}
        <div class="dialog-actions">
          ${cancel ? `<button type="button" class="btn" data-dlg="no">${esc(cancel)}</button>` : ''}
          <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-dlg="yes">${esc(ok)}</button>
        </div>`,
      onAction: (a, t, box, close) => close(a === 'yes'),
      onClose: (v) => resolve(!!v),
    });
  });
}

export const alertDialog = (o) => confirmDialog({ ok: '확인', cancel: null, ...o });

/**
 * fields: [{name, label, type:'text'|'number'|'select', value, options:[{value,label}], step, min, max, placeholder, hint}]
 * validate(values) → 오류 문자열 | null
 */
export function promptDialog({ title, body = '', fields, ok = '확인', validate }) {
  return new Promise((resolve) => {
    const fhtml = fields.map((f, i) => {
      const id = `pf_${f.name}`;
      const ctl = f.type === 'select'
        ? `<select class="input" id="${id}" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input class="input" id="${id}" name="${f.name}" type="${f.type === 'number' ? 'text' : 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${i === 0 ? 'autofocus' : ''} autocomplete="off">`;
      return `<label for="${id}">${esc(f.label)}${ctl}${f.hint ? `<span class="fld-hint">${esc(f.hint)}</span>` : ''}</label>`;
    }).join('');
    openModal({
      label: title,
      html: `<form novalidate><h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ''}
        <div class="form-grid" style="margin-top:12px">${fhtml}</div>
        <p class="fld-err" data-err hidden></p>
        <div class="dialog-actions"><button type="button" class="btn" data-dlg="no">취소</button><button type="submit" class="btn primary">${esc(ok)}</button></div></form>`,
      onAction: (a, t, box, close) => {
        if (a === 'no') return close(null);
        if (a !== 'submit') return;
        const vals = {};
        for (const f of fields) vals[f.name] = box.querySelector(`[name="${f.name}"]`).value.trim();
        const err = validate ? validate(vals) : null;
        if (err) { const e = box.querySelector('[data-err]'); e.textContent = err; e.hidden = false; return; }
        close(vals);
      },
      onClose: (v) => resolve(v || null),
    });
  });
}

/** actions: [{id, label, hint, danger, disabled}] */
export function actionSheet({ title, sub = '', actions }) {
  return new Promise((resolve) => {
    openModal({
      label: title,
      html: `<h2>${esc(title)}</h2>${sub ? `<p class="note">${esc(sub)}</p>` : ''}
        <div class="action-list">${actions.map((a) => `<button type="button" data-dlg="${esc(a.id)}" class="${a.danger ? 'danger' : ''}" ${a.disabled ? 'disabled' : ''}><span>${esc(a.label)}</span>${a.hint ? `<span class="hint">${esc(a.hint)}</span>` : ''}</button>`).join('')}</div>
        <div class="dialog-actions"><button type="button" class="btn" data-dlg="__cancel">닫기</button></div>`,
      onAction: (a, t, box, close) => close(a === '__cancel' ? null : a),
      onClose: (v) => resolve(v || null),
    });
  });
}

/** 체크 목록 선택 */
export function pickDialog({ title, body = '', items, ok = '확인', empty = '선택할 항목이 없습니다' }) {
  return new Promise((resolve) => {
    const list = items.length
      ? items.map((it, i) => `<label class="check-row"><input type="checkbox" value="${esc(it.value)}" ${it.checked ? 'checked' : ''} ${it.disabled ? 'disabled' : ''}><div><span>${esc(it.label)}</span>${it.hint ? `<span class="fld-hint">${esc(it.hint)}</span>` : ''}</div></label>`).join('')
      : `<p class="note">${esc(empty)}</p>`;
    openModal({
      label: title,
      html: `<h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ''}<div class="pick-list">${list}</div>
        <div class="dialog-actions"><button type="button" class="btn" data-dlg="no">취소</button><button type="button" class="btn primary" data-dlg="yes" ${items.length ? '' : 'disabled'}>${esc(ok)}</button></div>`,
      onAction: (a, t, box, close) => {
        if (a === 'no') return close(null);
        close([...box.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value));
      },
      onClose: (v) => resolve(v || null),
    });
  });
}

// ── 토스트 ──
let toastEl = null, toastTimer = null;
export function toast(msg, { action, onAction, ms = 5000 } = {}) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  if (action) toastEl.querySelector('button').addEventListener('click', () => { hide(); onAction && onAction(); });
  document.body.appendChild(toastEl);
  const hide = () => { if (toastEl) { toastEl.remove(); toastEl = null; } };
  toastTimer = setTimeout(hide, ms);
}

export { icon };
