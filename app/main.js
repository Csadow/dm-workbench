import { TYPES, HOOKS, SESSION_STATUS, uid, now, createCampaign, createEntry, createSession, createCombatant, changeBattle, removeEntry, demoCampaign } from './domain.js';
import { listCampaigns, saveCampaign } from './storage.js';
import { exportCampaign, importCampaign, MAX_IMPORT_BYTES } from './backup.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
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
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
const button = (action, label, cls = '', id = '') => `<button type="button" class="${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${label}</button>`;
const dateLabel = value => value ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Дата не выбрана';
const fullDate = value => new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const navItems = [['overview', 'home', 'Обзор'], ['knowledge', 'book', 'База знаний'], ['sessions', 'calendar', 'Сессии'], ['combat', 'sword', 'Бой'], ['journal', 'journal', 'Хроника']];
let campaigns = [], activeId = null, view = 'campaigns', query = '', filter = '', busy = false, dirty = false, offlineReady = false, installPrompt;
let toastTimer;
function active() { return campaigns.find(c => c.id === activeId); }
function toast(text, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').className = `visible ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, error ? 15000 : 4500);
}
function failure(error) {
  const text = error?.name === 'QuotaExceededError' ? 'Недостаточно места. Изменения не сохранены. Освободите место и повторите.' : error?.message || 'Не удалось сохранить данные. Попробуйте ещё раз.';
  toast(text, true);
  if ($('#form-error')) $('#form-error').textContent = text;
}
async function persist(next, insert = false) {
  if (busy) throw new Error('Дождитесь завершения сохранения.');
  busy = true; document.body.classList.add('saving');
  try {
    const saved = await saveCampaign(next, { insert });
    campaigns = [saved, ...campaigns.filter(c => c.id !== saved.id)];
    return saved;
  } finally { busy = false; document.body.classList.remove('saving'); }
}
async function mutate(fn) {
  const next = structuredClone(active()); fn(next); await persist(next); render();
}
function linkedNames(links) {
  return links.map(id => { const entry = active().entries.find(e => e.id === id); return entry ? button('entry', esc(entry.name), 'link-chip', id) : ''; }).join('');
}
function sectionHead(eyebrow, title, description, actions = '') {
  return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div><div class="actions">${actions}</div></header>`;
}
function empty(title, text, action = '') {
  return `<div class="empty">${icon('book')}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}
function campaignCards(archived) {
  return campaigns.filter(c => c.archived === archived).map(c => `<article class="campaign-card"><div class="card-top"><span class="badge">D&D 5.5e</span><span class="muted tiny">${dateLabel(c.updatedAt)}</span></div><div class="campaign-emblem">${icon('dice')}</div><h2>${esc(c.name)}</h2><p class="muted clamp">${esc(c.summary || 'Каждая история начинается с первого шага.')}</p><div class="card-meta"><span>${c.entries.length} записей</span><span>${c.sessions.length} сессий</span></div><div class="card-bottom">${button('open', `Открыть кампанию ${icon('arrow')}`, 'primary', c.id)}${button('archive', archived ? 'Вернуть' : 'В архив', 'quiet', c.id)}</div></article>`).join('');
}
function campaignsPage() {
  return `${sectionHead('ВАШИ МИРЫ', 'Мастерская историй', 'Место для миров, которые вы создаёте вместе.', button('import', `${icon('upload')} Импорт`, 'secondary') + button('new-campaign', `${icon('plus')} Новая кампания`, 'primary'))}
  <section class="welcome-banner"><div><span class="badge light">ВАШ СЛЕДУЮЩИЙ БОЛЬШОЙ СЮЖЕТ</span><h2>Подготовьте мир.<br>Оставьте место неожиданному.</h2><p>Персонажи, заметки и приключения — под рукой.<br>Даже когда интернет остался за пределами таверны.</p></div><div class="banner-art" aria-hidden="true">${icon('dice')}<span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="star s1">✦</span><span class="star s2">✧</span></div></section>
  <div class="section-title"><h2>Ваши кампании <span class="count">${campaigns.filter(c => !c.archived).length}</span></h2><span class="muted tiny">Сохраняются на этом устройстве</span></div>
  <div class="campaign-grid">${campaignCards(false)}<button class="new-card" data-action="new-campaign">${icon('plus')}<strong>Начать новую историю</strong><span>Создайте мир для своей группы</span></button></div>
  ${!campaigns.length ? `<div class="demo-callout"><div><strong>Хотите сначала осмотреться?</strong><p class="muted">В «Тихой гавани» уже есть персонажи, зацепка и план первой сессии.</p></div>${button('demo', 'Открыть пример', 'secondary')}</div>` : ''}
  ${campaigns.some(c => c.archived) ? `<details class="archive"><summary>Архив кампаний (${campaigns.filter(c => c.archived).length})</summary><div class="campaign-grid">${campaignCards(true)}</div></details>` : ''}`;
}
function overviewPage() {
  const c = active(), session = c.sessions.find(s => s.status === 'playing') || c.sessions.find(s => s.status === 'planned');
  const hooks = c.entries.filter(e => e.type === 'hook' && e.status !== 'done');
  return `${sectionHead('СТОЛ МАСТЕРА · D&D 5.5e', esc(c.name), esc(c.summary || 'История ждёт следующего хода.'), button('campaign-settings', icon('settings') + ' Настройки', 'secondary'))}
  <div class="stats"><div><span>База знаний</span><strong>${c.entries.length}<small> записей</small></strong></div><div><span>История группы</span><strong>${c.sessions.filter(s => s.status === 'done').length}<small> сессий сыграно</small></strong></div><div><span>Открытые возможности</span><strong>${hooks.length}<small> зацепок</small></strong></div></div>
  <div class="overview-grid"><section class="panel session-spotlight"><p class="eyebrow">${session?.status === 'playing' ? 'СЕЙЧАС ЗА СТОЛОМ' : 'СЛЕДУЮЩАЯ СЕССИЯ'}</p><h2>${esc(session?.name || 'Каким будет начало?')}</h2><p class="muted">${session ? dateLabel(session.date) : 'Соберите сцены и нужные материалы в одном месте.'}</p>${session ? `<p class="preline clamp">${esc(session.plan || 'Добавьте план, чтобы не упустить главное.')}</p>` : ''}<div class="actions">${button(session ? 'session' : 'new-session', session ? 'Открыть подготовку ' + icon('arrow') : icon('plus') + ' Подготовить сессию', 'primary', session?.id || '')}${button('go-combat', icon('sword') + ' К бою', 'secondary')}</div></section><section class="panel"><div class="section-title"><h2>Нити сюжета</h2>${button('new-hook', icon('plus') + '<span class=sr-only>Новая зацепка</span>', 'icon-button')}</div>${hooks.slice(0, 4).map(e => `<button class="list-item" data-action="entry" data-id="${e.id}"><span class="dot amber"></span><span><strong>${esc(e.name)}</strong><small>${HOOKS[e.status]}</small></span>${icon('arrow')}</button>`).join('') || '<p class="muted">Добавьте вопрос, тайну или обещание, к которым группа ещё вернётся.</p>'}</section></div>
  <div class="overview-grid"><section class="panel"><div class="section-title"><h2>Последние события</h2>${button('new-event', 'Записать событие', 'text-button')}</div>${eventList(c.events.slice(-3).reverse()) || '<p class="muted">Решения игроков становятся историей здесь.</p>'}</section><section class="panel"><p class="eyebrow">ПОД РУКОЙ</p><h2>Дайте миру детали</h2><p class="muted">Цель персонажа, странная примета места, неожиданный союзник.</p><div class="quick-grid">${button('new-npc', icon('book') + ' Персонаж', 'secondary')}${button('new-location', icon('folder') + ' Место', 'secondary')}${button('new-note', icon('journal') + ' Заметка', 'secondary')}</div></section></div>`;
}
function knowledgePage() {
  return `${sectionHead('БИБЛИОТЕКА КАМПАНИИ', 'База знаний', 'У каждого места есть история. У каждого персонажа — причина.', button('new-entry', icon('plus') + ' Добавить запись', 'primary'))}<div class="search-row"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Найти по названию, тексту или тегам…" aria-label="Поиск в базе знаний" value="${esc(query)}"></label><select id="type-filter" aria-label="Тип записи"><option value="">Все типы</option>${Object.entries(TYPES).map(([key, label]) => `<option value="${key}" ${key === filter ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div id="entries" class="entry-grid">${entriesList()}</div>`;
}
function entriesList() {
  const entries = active().entries.filter(e => (!filter || e.type === filter) && `${e.name} ${e.text} ${e.tags.join(' ')}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  return entries.map(e => `<button class="entry-card" data-action="entry" data-id="${e.id}"><span class="type-icon type-${e.type}">${icon(e.type === 'location' ? 'folder' : e.type === 'note' ? 'journal' : 'book')}</span><span class="badge">${TYPES[e.type]}</span><h2>${esc(e.name)}</h2><p class="muted clamp">${esc(e.text || 'История этой записи ещё не написана.')}</p><div class="tags">${e.tags.map(t => `<span>#${esc(t)}</span>`).join('')}${e.type === 'hook' ? `<span>${HOOKS[e.status]}</span>` : ''}</div></button>`).join('') || empty(query || filter ? 'Ничего не найдено' : 'Мир начинается с деталей', query || filter ? 'Попробуйте другой запрос или тип записи.' : 'Создайте первого персонажа, место или заметку.', !query && !filter ? button('new-entry', 'Добавить запись', 'primary') : '');
}
function sessionsPage() {
  return `${sectionHead('ПОДГОТОВКА И ИГРА', 'Ваши сессии', 'План — отправная точка. Историю напишет ваша группа.', button('new-session', icon('plus') + ' Новая сессия', 'primary'))}<div class="session-list">${active().sessions.map((s, i) => `<article class="panel session-row"><div class="session-number">${String(i + 1).padStart(2, '0')}</div><div class="grow"><span class="badge">${SESSION_STATUS[s.status]}</span><h2>${esc(s.name)}</h2><p class="muted">${dateLabel(s.date)} · ${s.links.length} связанных материалов</p><p class="clamp">${esc(s.status === 'done' ? s.recap : s.plan)}</p></div>${button('session', 'Открыть ' + icon('arrow'), 'secondary', s.id)}</article>`).join('') || empty('Первая встреча впереди', 'Запишите начало, возможные сцены и вопросы для игроков.', button('new-session', 'Подготовить сессию', 'primary'))}</div>`;
}
function eventList(events) {
  return events.map(e => `<article class="event" id="event-${e.id}"><span class="timeline-dot"></span><div><span class="muted tiny">${fullDate(e.createdAt)}${e.sessionId ? ' · ' + esc(active().sessions.find(s => s.id === e.sessionId)?.name || '') : ''}</span><p class="preline">${esc(e.text)}</p><div class="tags">${linkedNames(e.links)}</div></div></article>`).join('');
}
function journalPage() {
  return `${sectionHead('ПАМЯТЬ ВАШЕГО МИРА', 'Хроника', 'Что решили герои. Кого встретили. Что изменилось навсегда.', button('new-event', icon('plus') + ' Записать событие', 'primary'))}<section class="panel">${eventList([...active().events].reverse()) || empty('Всё ещё впереди', 'Сохраняйте короткие факты во время игры, а после связывайте их с персонажами и местами.')}</section>`;
}
function combatPage() {
  const b = active().battle;
  return `${sectionHead('ЗА ИГРОВЫМ СТОЛОМ', 'Бой', 'Следите за ходами. Оставьте внимание на истории.', button('new-combatant', icon('plus') + ' Участник', 'primary'))}
  <div class="combat-toolbar"><div><span class="eyebrow">${b.started ? 'РАУНД' : 'ПОДГОТОВКА'}</span><strong>${b.started ? b.round : 'Расставьте участников'}</strong></div><div class="actions">${b.started ? button('previous-turn', '← Назад', 'secondary') + button('next-turn', 'Следующий ход ' + icon('arrow'), 'primary') : button('start-battle', 'Начать бой', 'primary')}${button('undo-battle', 'Отменить', 'secondary')}${button('clear-battle', 'Завершить', 'quiet')}</div></div>
  <p class="muted tiny">Порядок при равной инициативе можно изменить стрелками. Новый участник во время боя добавляется в конец очереди.</p>
  <div class="combatants">${b.combatants.map((c, i) => `<article class="combatant ${b.activeId === c.id ? 'current' : ''}"><div class="initiative"><span>Иниц.</span><strong>${c.initiative}</strong></div><div class="combatant-name"><span class="tiny ${b.activeId === c.id ? 'turn-label' : 'muted'}">${b.activeId === c.id ? 'СЕЙЧАС ХОДИТ' : `УЧАСТНИК ${i + 1}`}</span><h2>${esc(c.name)}</h2><p class="muted tiny">${esc(c.conditions || 'Без состояний')}${c.concentration ? ' · Концентрация' : ''}</p></div><div class="health"><span><strong>${c.hp}</strong> / ${c.maxHp} HP${c.tempHp ? ` <small>+${c.tempHp} врем.</small>` : ''}</span><div class="health-track"><i style="width:${Math.round(c.hp / c.maxHp * 100)}%"></i></div></div><div class="actions combat-actions">${button('damage', '− Урон', 'damage', c.id)}${button('heal', '+ Лечение', 'healing', c.id)}${button('edit-combatant', 'Править', 'quiet', c.id)}<button class="icon-button" data-action="move-up" data-id="${c.id}" aria-label="Поднять ${esc(c.name)} в очереди" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" data-action="move-down" data-id="${c.id}" aria-label="Опустить ${esc(c.name)} в очереди" ${i === b.combatants.length - 1 ? 'disabled' : ''}>↓</button></div></article>`).join('') || empty('Соберите участников встречи', 'Добавьте героев и противников. Карта для ведения боя не обязательна.', button('new-combatant', 'Добавить участника', 'primary'))}</div>
  <div class="note-strip">${icon('journal')}<p>Изменения боя сохраняются сразу. Завершение добавит запись в хронику кампании.</p>${button('new-event', 'Записать событие', 'text-button')}</div>`;
}
function render() {
  const c = active();
  if (!c && view !== 'campaigns' && view !== 'help') view = 'campaigns';
  const page = { campaigns: campaignsPage, overview: overviewPage, knowledge: knowledgePage, sessions: sessionsPage, journal: journalPage, combat: combatPage, help: helpPage }[view];
  $('#app').innerHTML = `<aside class="sidebar"><a href="#" class="brand" data-action="campaigns"><span class="brand-icon">${icon('dice')}</span><span>DM Workbench<small>МАСТЕРСКАЯ ИСТОРИЙ</small></span></a><button class="campaign-switch" data-action="campaigns">${icon('folder')}<span>${c ? esc(c.name) : 'Все кампании'}<small>${c ? 'Выбрать другую кампанию' : 'Ваши миры и приключения'}</small></span><span>⌄</span></button><div class="nav-label">${c ? 'КАМПАНИЯ' : 'МАСТЕРСКАЯ'}</div><nav aria-label="Основная навигация">${(c ? navItems : [['campaigns', 'folder', 'Мои кампании']]).map(([key, glyph, label]) => `<button data-action="nav" data-view="${key}" class="nav-item ${view === key ? 'selected' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${key === 'knowledge' ? `<span class="nav-count">${c.entries.length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom">${c ? button('export', icon('download') + ' Сохранить в файл', 'nav-item') : ''}${button('help', icon('settings') + ' Данные и установка', 'nav-item')}<div class="local-status"><span class="dot"></span><div>Ваш мир — у вас<small id="offline-status">${offlineReady ? 'Готово к работе без сети' : 'Данные хранятся локально'}</small></div></div></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Мастерская <span>/</span> ${c ? esc(c.name) : 'Кампании'}</span><span class="save-status"><span class="dot"></span> <span id="save-label">${navigator.onLine ? 'Локальное хранение' : 'Без интернета'}</span></span></header><main id="main" tabindex="-1">${page()}</main><footer>DM WORKBENCH <span>Создавайте истории, которые хочется помнить.</span><span>Прототип 0.1</span></footer></div>`;
}
function helpPage() {
  return `${sectionHead('ВАША МАСТЕРСКАЯ', 'Данные и установка', 'Кампании остаются на этом устройстве.')}<div class="overview-grid"><section class="panel"><h2>Работа без интернета</h2><p>Откройте приложение с интернетом и дождитесь сообщения «Готово к работе без сети». После этого заметки, поиск, сессии и бой доступны автономно.</p><p><strong>${offlineReady ? '✓ Приложение готово к работе без сети' : 'Офлайн-подготовка ещё не завершена'}</strong></p>${button('install', 'Установить приложение', 'primary')}<p class="muted">В Chrome или Edge используйте значок установки в адресной строке. Если установка недоступна, работайте в обычной вкладке браузера.</p></section><section class="panel"><h2>Резервная копия</h2><p>Сохраните кампанию в файл после игры. Очистка данных сайта удаляет локальные кампании. Файл экспорта храните отдельно.</p><p>Импорт добавляет независимую копию. Изменения между устройствами автоматически не объединяются.</p><div class="actions">${active() ? button('export', icon('download') + ' Экспорт кампании', 'primary') : ''}${button('import', icon('upload') + ' Импорт', 'secondary')}</div><hr><p class="muted" id="persistence-status">Можно попросить браузер защитить хранилище от автоматической очистки.</p>${button('persist-storage', 'Защитить локальные данные', 'secondary')}</section></div><section class="panel"><h2>Быстрее с клавиатуры</h2><p><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd> — поиск в базе знаний открытой кампании. <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> — сохранить открытый редактор. <kbd>Esc</kbd> — закрыть его; при несохранённых изменениях появится вопрос.</p></section><section class="panel"><h2>Правила и границы прототипа</h2><p>Целевая система — D&D 5.5e (правила 2024 года). Полного справочника правил в прототипе пока нет. Инициатива и состояния задаются вручную; сопротивления, спасброски и эффекты концентрации решает мастер.</p><p>Тексты записей сохраняются кнопкой «Сохранить». Действия боя сохраняются автоматически. До закрытия редактора можно скопировать свой текст, если запись не удалась.</p></section>`;
}
function field(label, name, value = '', options = {}) {
  const attrs = `name="${name}" ${options.required ? 'required' : ''} ${options.type === 'number' ? `min="${options.min ?? 0}" max="${options.max ?? 100000}" step="1"` : ''}`;
  return `<label class="field">${label}${options.area ? `<textarea ${attrs} rows="${options.rows || 6}" maxlength="100000">${esc(value)}</textarea>` : `<input ${attrs} type="${options.type || 'text'}" value="${esc(value)}" maxlength="${options.maxLength || 200}">`}</label>`;
}
function selectField(label, name, values, selected) {
  return `<label class="field">${label}<select name="${name}">${Object.entries(values).map(([key, text]) => `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}
function linksField(selected = [], exclude = '') {
  const entries = active().entries.filter(e => e.id !== exclude);
  return `<fieldset class="links-field"><legend>Связанные записи</legend>${entries.length ? `<div class="link-options">${entries.map(e => `<label><input type="checkbox" name="links" value="${e.id}" ${selected.includes(e.id) ? 'checked' : ''}><span>${esc(e.name)}</span></label>`).join('')}</div>` : '<p class="muted tiny">Здесь появятся записи из базы знаний.</p>'}</fieldset>`;
}
function openDialog(title, content, onSubmit, { saveLabel = 'Сохранить', after = '' } = {}) {
  const dialog = $('#editor'); dirty = false;
  dialog.innerHTML = `<form id="edit-form"><header class="dialog-header"><div><p class="eyebrow">DM WORKBENCH</p><h2 id="dialog-title">${title}</h2></div><button type="button" class="icon-button" data-action="close" aria-label="Закрыть">×</button></header><div class="dialog-body">${content}<p id="form-error" role="alert"></p></div><div class="dialog-footer">${after}<span class="grow"></span>${button('close', 'Отмена', 'secondary')}<button type="submit" class="primary">${saveLabel}</button></div></form>`;
  const form = $('#edit-form');
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try { await onSubmit(new FormData(form)); dirty = false; dialog.close(); render(); toast('Сохранено на устройстве'); }
    catch (error) { failure(error); }
    finally { submit.disabled = false; }
  });
  dialog.showModal();
}
function closeDialog() {
  if (busy) return;
  if (dirty && !confirm('Закрыть без сохранения изменений?')) return;
  dirty = false; $('#editor').close();
}
$('#editor').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
function campaignEditor(existing = null) {
  openDialog(existing ? 'Настройки кампании' : 'Новая история', field('Название кампании', 'name', existing?.name, { required: true }) + field('О чём эта история?', 'summary', existing?.summary, { area: true, rows: 4 }) + '<p class="muted tiny">D&D 5.5e · Локальная кампания · Без синхронизации</p>', async data => {
    const name = data.get('name').trim(); if (!name) throw new Error('Введите название кампании.');
    const c = existing ? structuredClone(existing) : createCampaign(name);
    c.name = name; c.summary = data.get('summary');
    await persist(c, !existing); activeId = c.id; view = 'overview';
  }, { saveLabel: existing ? 'Сохранить' : 'Создать кампанию' });
}
const templates = { npc: 'Цель: \nМанера: \nСекрет: ', location: 'Впечатление: \nОпасность: \nЗацепка: ', hook: 'Вопрос: \nКто вовлечён: \nВозможные последствия: ' };
function entryEditor(id, type = 'note') {
  const e = active().entries.find(e => e.id === id); const initial = e || createEntry(type, '', templates[type] || '');
  const backlinks = e ? [
    ...active().entries.filter(x => x.links.includes(e.id)).map(x => button('follow-entry', esc(`${TYPES[x.type]}: ${x.name}`), 'backlink-button', x.id)),
    ...active().sessions.filter(x => x.links.includes(e.id)).map(x => button('follow-session', esc(`Сессия: ${x.name}`), 'backlink-button', x.id)),
    ...active().events.filter(x => x.links.includes(e.id)).map(x => button('follow-event', esc(`Событие: ${x.text.slice(0, 100)}`), 'backlink-button', x.id)),
  ] : [];
  openDialog(e ? 'Запись базы знаний' : 'Новая запись', field('Название', 'name', initial.name, { required: true }) + `<div class="form-grid">${selectField('Тип', 'type', TYPES, initial.type)}${selectField('Статус зацепки', 'status', HOOKS, initial.status)}</div>` + field('Текст', 'text', initial.text, { area: true, rows: 8 }) + field('Теги через запятую', 'tags', initial.tags.join(', '), { maxLength: 1000 }) + linksField(initial.links, initial.id) + (backlinks.length ? `<section class="backlinks"><h3>Где упоминается</h3>${backlinks.join('')}</section>` : ''), async data => {
    const next = structuredClone(active());
    const updated = { ...initial, name: data.get('name').trim(), type: data.get('type'), status: data.get('status'), text: data.get('text'), tags: [...new Set(data.get('tags').split(',').map(s => s.trim()).filter(Boolean))], links: data.getAll('links'), updatedAt: now() };
    next.entries = e ? next.entries.map(x => x.id === e.id ? updated : x) : [...next.entries, updated];
    await persist(next);
  }, { after: e ? button('delete-entry', 'Удалить запись', 'danger-text', e.id) : '' });
}
function sessionEditor(id) {
  const s = active().sessions.find(s => s.id === id); const initial = s || createSession('');
  openDialog(s ? 'Подготовка и итоги' : 'Новая сессия', field('Название', 'name', initial.name, { required: true }) + `<div class="form-grid">${field('Дата', 'date', initial.date, { type: 'date' })}${selectField('Статус', 'status', SESSION_STATUS, initial.status)}</div>` + field('План и сцены', 'plan', initial.plan, { area: true, rows: 7 }) + '<p class="muted tiny">Запишите сцены списком: начало, участники, зацепки и возможные последствия.</p>' + linksField(initial.links) + field('Что произошло на самом деле', 'recap', initial.recap, { area: true, rows: 5 }), async data => {
    const next = structuredClone(active());
    const updated = { ...initial, name: data.get('name').trim(), date: data.get('date'), status: data.get('status'), plan: data.get('plan'), recap: data.get('recap'), links: data.getAll('links') };
    next.sessions = s ? next.sessions.map(x => x.id === s.id ? updated : x) : [...next.sessions, updated];
    await persist(next);
  });
}
function eventEditor() {
  openDialog('Событие кампании', field('Что произошло?', 'text', '', { area: true, required: true, rows: 5 }) + selectField('Сессия', 'sessionId', { '': 'Вне сессии', ...Object.fromEntries(active().sessions.map(s => [s.id, s.name])) }, active().sessions.find(s => s.status === 'playing')?.id || '') + linksField(), async data => {
    if (!data.get('text').trim()) throw new Error('Запишите событие.');
    const next = structuredClone(active()); next.events.push({ id: uid(), text: data.get('text'), sessionId: data.get('sessionId') || null, links: data.getAll('links'), createdAt: now() }); await persist(next);
  }, { saveLabel: 'Записать в хронику' });
}
function combatantEditor(id) {
  const c = active().battle.combatants.find(c => c.id === id);
  openDialog(c ? 'Участник боя' : 'Добавить участника', field('Имя', 'name', c?.name || '', { required: true }) + `<div class="form-grid">${field('Максимум HP', 'maxHp', c?.maxHp || 10, { type: 'number', min: 1, required: true })}${field('Инициатива', 'initiative', c?.initiative || 0, { type: 'number', min: -1000, max: 1000, required: true })}${c ? field('Текущие HP', 'hp', c.hp, { type: 'number', required: true }) + field('Временные HP', 'tempHp', c.tempHp, { type: 'number', required: true }) : ''}</div>` + field('Состояния и заметки', 'conditions', c?.conditions || '', { maxLength: 1000 }) + `<label class="checkbox"><input type="checkbox" name="concentration" ${c?.concentration ? 'checked' : ''}> Концентрация</label>`, async data => {
    const values = { name: data.get('name').trim(), maxHp: Number(data.get('maxHp')), initiative: Number(data.get('initiative')), hp: Number(data.get(c ? 'hp' : 'maxHp')), tempHp: Number(data.get('tempHp') || 0), conditions: data.get('conditions'), concentration: data.has('concentration') };
    if (values.hp > values.maxHp) throw new Error('Текущие HP не могут быть больше максимальных.');
    const next = structuredClone(active());
    next.battle = changeBattle(next.battle, c ? { type: 'edit', id, values } : { type: 'add', combatant: { ...createCombatant(values.name, values.maxHp, values.initiative), ...values } });
    await persist(next);
  }, { after: c ? button('remove-combatant', 'Убрать из боя', 'danger-text', id) : '' });
}
function healthEditor(id, type) {
  const c = active().battle.combatants.find(c => c.id === id);
  openDialog(`${type === 'damage' ? 'Урон' : 'Лечение'}: ${esc(c.name)}`, `<p class="muted">Сейчас ${c.hp} / ${c.maxHp} HP${c.tempHp ? ` и ${c.tempHp} временных HP` : ''}.</p>` + field('Количество', 'amount', '', { type: 'number', required: true, min: 0 }), async data => {
    const next = structuredClone(active()); next.battle = changeBattle(next.battle, { type, id, amount: Number(data.get('amount')) }); await persist(next);
  }, { saveLabel: 'Применить' });
}
async function exportActive() {
  // Reload the committed record so another tab's latest changes are included.
  const current = (await listCampaigns()).find(c => c.id === activeId);
  const text = exportCampaign(current);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `${current.name.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 60)}-${now().slice(0, 10)}.dmw.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('Файл экспорта подготовлен. Сохраните его отдельно от приложения.');
}
async function handleAction(el) {
  const action = el.dataset.action, id = el.dataset.id;
  switch (action) {
    case 'nav': view = el.dataset.view; query = ''; filter = ''; render(); break;
    case 'campaigns': view = 'campaigns'; activeId = null; campaigns = await listCampaigns(); render(); break;
    case 'open': activeId = id; view = 'overview'; render(); break;
    case 'help': view = 'help'; render(); break;
    case 'go-combat': view = 'combat'; render(); break;
    case 'new-campaign': campaignEditor(); break;
    case 'campaign-settings': campaignEditor(active()); break;
    case 'demo': { const c = demoCampaign(); await persist(c, true); activeId = c.id; view = 'overview'; render(); break; }
    case 'archive': {
      const c = structuredClone(campaigns.find(c => c.id === id));
      c.archived = !c.archived; await persist(c); render(); toast(c.archived ? 'Кампания перенесена в архив' : 'Кампания возвращена'); break;
    }
    case 'new-entry': entryEditor(); break;
    case 'new-hook': entryEditor(null, 'hook'); break;
    case 'new-npc': entryEditor(null, 'npc'); break;
    case 'new-location': entryEditor(null, 'location'); break;
    case 'new-note': entryEditor(null, 'note'); break;
    case 'entry': entryEditor(id); break;
    case 'follow-entry': case 'follow-session': case 'follow-event':
      closeDialog(); if ($('#editor').open) return;
      if (action === 'follow-entry') entryEditor(id);
      else if (action === 'follow-session') sessionEditor(id);
      else { view = 'journal'; render(); document.getElementById(`event-${id}`)?.scrollIntoView({ block: 'center' }); }
      break;
    case 'delete-entry':
      if (confirm('Удалить запись? Ссылки на неё в заметках, сессиях и хронике будут убраны.')) {
        await mutate(c => removeEntry(c, id)); dirty = false; $('#editor').close(); toast('Запись удалена');
      } break;
    case 'new-session': sessionEditor(); break;
    case 'session': sessionEditor(id); break;
    case 'new-event': eventEditor(); break;
    case 'new-combatant': combatantEditor(); break;
    case 'edit-combatant': combatantEditor(id); break;
    case 'damage': case 'heal': healthEditor(id, action); break;
    case 'remove-combatant':
      await mutate(c => { c.battle = changeBattle(c.battle, { type: 'remove', id }); }); dirty = false; $('#editor').close(); break;
    case 'start-battle':
      if (!active().battle.combatants.length) return toast('Сначала добавьте участников.');
      await mutate(c => { c.battle = changeBattle(c.battle, { type: 'start' }); }); break;
    case 'next-turn': case 'previous-turn': case 'undo-battle':
      await mutate(c => { c.battle = changeBattle(c.battle, { type: { 'next-turn': 'next', 'previous-turn': 'previous', 'undo-battle': 'undo' }[action] }); }); break;
    case 'move-up': case 'move-down':
      await mutate(c => { c.battle = changeBattle(c.battle, { type: 'move', id, direction: action === 'move-up' ? -1 : 1 }); }); break;
    case 'clear-battle':
      if (!active().battle.combatants.length) return toast('Участников пока нет.');
      if (confirm('Завершить бой и записать его в хронику? Текущая очередь будет очищена.')) await mutate(c => {
        c.events.push({ id: uid(), createdAt: now(), sessionId: c.sessions.find(s => s.status === 'playing')?.id || null, links: [], text: `Бой завершён. Раунд ${c.battle.round}.\n${c.battle.combatants.map(x => `${x.name}: ${x.hp}/${x.maxHp} HP`).join('\n')}` });
        // A completed battle is a boundary: do not undo across its journal entry.
        c.battle = changeBattle(c.battle, { type: 'clear' }); c.battle.history = [];
      }); break;
    case 'close': closeDialog(); break;
    case 'export': await exportActive(); break;
    case 'import': $('#import-file').click(); break;
    case 'persist-storage': {
      const granted = await navigator.storage?.persist?.();
      $('#persistence-status').textContent = granted ? 'Постоянное хранение разрешено. Резервные копии всё равно сохраняйте отдельно.' : 'Браузер не предоставил защиту. Регулярно экспортируйте кампании в файл.'; break;
    }
    case 'install':
      if (installPrompt) { await installPrompt.prompt(); installPrompt = null; }
      else toast('Используйте значок установки в адресной строке Chrome или Edge. Приложение также работает в обычной вкладке.'); break;
  }
}
document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el) return;
  event.preventDefault(); if (busy) return;
  handleAction(el).catch(failure);
});
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || busy) return;
  if (event.key === 'Enter' && $('#editor').open) { event.preventDefault(); $('#edit-form').requestSubmit(); }
  if (event.key.toLowerCase() === 'k' && active() && !$('#editor').open) {
    event.preventDefault(); view = 'knowledge'; render(); $('#search').focus();
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; $('#entries').innerHTML = entriesList(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'type-filter') { filter = event.target.value; $('#entries').innerHTML = entriesList(); }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Файл больше 5 МБ.');
    const c = importCampaign(await file.text()); await persist(c, true); activeId = c.id; view = 'overview'; render(); toast('Кампания импортирована как отдельная копия');
  } catch (error) { failure(error); }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
for (const name of ['online', 'offline']) window.addEventListener(name, () => { if ($('#save-label')) $('#save-label').textContent = navigator.onLine ? 'Локальное хранение' : 'Без интернета'; });
async function boot() {
  try { campaigns = await listCampaigns(); render(); }
  catch (error) {
    $('#app').innerHTML = `<main class="loading"><h1>Не удалось открыть хранилище</h1><p>${esc(error.message)}</p><p>Разрешите хранение данных сайта в браузере и обновите страницу.</p><button onclick="location.reload()">Повторить</button></main>`; return;
  }
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready;
      offlineReady = true;
      if ($('#offline-status')) $('#offline-status').textContent = 'Готово к работе без сети';
    } catch { toast('Не удалось подготовить запуск без сети. Откройте приложение через HTTPS или localhost.', true); }
  }
}
boot();
