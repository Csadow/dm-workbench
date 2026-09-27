export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  spark: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/>',
  music: '<path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="15" rx="3" ry="2"/>',
  pin: '<path d="m9 3 8 2-2 5 3 4-7-1-4 4-1-3 3-5ZM6 17l-3 4"/>',

  dice: '<path d="m12 2 9 5v10l-9 5-9-5V7Z M12 2l5 8-5 12-5-12ZM3 7l4 3h10l4-3M3 17l9-2 9 2M7 10l5 5 5-5"/>',
  home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
  book: '<path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h3"/>',
  sword: '<path d="m4 3 4 1 12 12-4 4L4 8Zm-1 16 4-4m10-12-4 1-3 3m7 4 3-3 1-5M3 15l6 6m6-6 6 6"/>',
  journal: '<path d="M5 3h14v18H5ZM2 7h5m-5 5h5m-5 5h5m4-10h6m-6 5h6m-6 5h4"/>',
  folder: '<path d="M3 5h7l2 3h9v12H3Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
export const button = (action, label, cls = '', id = '') => `<button type="button" class="${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${label}</button>`;

export function sectionHead(eyebrow, title, description, actions = '') {
  return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div><div class="actions">${actions}</div></header>`;
}
export function empty(title, text, action = '') {
  return `<div class="empty">${icon('book')}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}
