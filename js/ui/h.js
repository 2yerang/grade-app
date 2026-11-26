// 공용 HTML 헬퍼: 이스케이프, 배지, 아이콘, 숫자 표시
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const attr = esc;

export const fmtGpa = (g) => (g == null ? '—' : g.toFixed(2));
export const fmtPct = (p) => (p == null ? '—' : p.toFixed(1));
export const fmtCr = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function delta(a, b, digits = 2, unit = '') {
  if (a == null || b == null) return '';
  const d = Math.round((a - b) * 10 ** digits) / 10 ** digits;
  if (d === 0) return `<span class="delta zero">± 0${unit}</span>`;
  const cls = d > 0 ? 'up' : 'down';
  return `<span class="delta ${cls}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)}${unit}</span>`;
}

export function gradeTone(grade) {
  if (grade == null) return 'g-dash';
  if (grade === 'A+' || grade === 'A0') return 'g-a';
  if (grade === 'B+' || grade === 'B0') return 'g-b';
  if (['C+', 'C0', 'D+', 'D0'].includes(grade)) return 'g-c';
  if (grade === 'F') return 'g-f';
  if (grade === 'P') return 'g-p';
  return 'g-dash';
}

export function gradeBadge(grade, { dim = false, label } = {}) {
  const text = label ?? (grade == null ? '미정' : grade);
  return `<span class="g ${gradeTone(grade)}${dim ? ' dim' : ''}">${esc(text)}</span>`;
}

/** 과목 성적 표시: W(포기), 미정, 폐기 등 상태 반영 */
export function courseGrade(c, { discarded = false } = {}) {
  if (c.waived) return `<span class="g g-dash">W</span>${c.grade ? gradeBadge(c.grade, { dim: true }) : ''}`;
  if (discarded) return `<span class="g-old">${esc(c.grade)}</span>`;
  return gradeBadge(c.grade);
}

export const tag = (text, cls = '') => `<span class="tag ${cls}">${esc(text)}</span>`;

const svg = (body, size = 18, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icon = {
  lock: (s = 14) => svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', s),
  unlock: (s = 14) => svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>', s),
  dots: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`,
  close: (s = 20) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
  menu: (s = 22) => svg('<path d="M4 7h16M4 12h16M4 17h16"/>', s),
  plus: (s = 18) => svg('<path d="M12 5v14M5 12h14"/>', s),
  book: (s = 28) => svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 8h6"/>', s),
  warn: (s = 18) => svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', s),
  chevron: (s = 16) => svg('<path d="M6 9l6 6 6-6"/>', s),
};

export function lockMark(size = 14) {
  return `<span role="img" aria-label="성적 확정" style="display:inline-flex;color:var(--muted)">${icon.lock(size)}</span>`;
}
