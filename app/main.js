import * as screens from './screens.js';
import { SoundMixer, prepareAudio } from './audio.js';
import { esc, icon, button, sectionHead, empty } from './ui.js';
import { ROLES, SOUND_KINDS, fromEntry, createEncounter, d20, TYPES, HOOKS, SESSION_STATUS, uid, now, createCampaign, createEntry, createSession, createCombatant, changeBattle, removeEntry, demoCampaign } from './domain.js';
import { listCampaigns, saveCampaign, loadCampaignBundle } from './storage.js';
import { exportCampaign, importBundle, encodeAssets, MAX_IMPORT_BYTES } from './backup.js';

const $ = selector => document.querySelector(selector);
const dateLabel = value => value ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Дата не выбрана';
const fullDate = value => new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const navItems = [['overview', 'home', 'Обзор'], ['knowledge', 'book', 'База знаний'], ['sessions', 'calendar', 'Сессии'], ['combat', 'sword', 'Бой'], ['journal', 'journal', 'Хроника'], ['sound', 'music', 'Музыка и звуки']];
let campaigns = [], activeId = null, view = 'campaigns', query = '', filter = '', busy = false, dirty = false, offlineReady = false, installPrompt;
let toastTimer, submitting = false;
let selected = '', pinnedOnly = false, tagFilter = '', sort = 'recent';
const knowledgeState = () => ({query, filter, selected, pinnedOnly, tagFilter, sort});
const mixer = new SoundMixer(refreshAudio, failure);
function refreshAudio() {
  const c = active();
  if ($('#audio-dock-root')) $('#audio-dock-root').innerHTML = screens.audioDock(c, mixer);
  for (const track of c?.soundboard.tracks || []) {
    const card = document.querySelector(`[data-track-card="${track.id}"]`);
    if (!card) continue;
    card.classList.toggle('playing', mixer.playing(track.id));
    const slider = card.querySelector('[data-volume]');
    if (slider && slider !== document.activeElement) { slider.value = Math.round(mixer.level(track.id,track.volume)*100); slider.nextElementSibling.value = slider.value+'%'; }
    if (track.kind !== 'effect') card.querySelector('[data-action="play-sound"]').textContent = mixer.playing(track.id) ? 'Ⅱ Пауза' : '▶ Воспроизвести';
  }
}
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
async function persist(next, insert = false, options = {}) {
  if (busy) throw new Error('Дождитесь завершения сохранения.');
  busy = true; document.body.classList.add('saving');
  try {
    const saved = await saveCampaign(next, { insert, ...options });
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
function knowledgePage() { return screens.knowledgePage(active(), knowledgeState()); }
function entriesList() { return screens.entriesList(active(), knowledgeState()); }
function sessionsPage() {
  return `${sectionHead('ПОДГОТОВКА И ИГРА', 'Ваши сессии', 'План — отправная точка. Историю напишет ваша группа.', button('new-session', icon('plus') + ' Новая сессия', 'primary'))}<div class="session-list">${active().sessions.map((s, i) => `<article class="panel session-row"><div class="session-number">${String(i + 1).padStart(2, '0')}</div><div class="grow"><span class="badge">${SESSION_STATUS[s.status]}</span><h2>${esc(s.name)}</h2><p class="muted">${dateLabel(s.date)} · ${s.links.length} связанных материалов</p><p class="clamp">${esc(s.status === 'done' ? s.recap : s.plan)}</p></div>${button('session', 'Открыть ' + icon('arrow'), 'secondary', s.id)}</article>`).join('') || empty('Первая встреча впереди', 'Запишите начало, возможные сцены и вопросы для игроков.', button('new-session', 'Подготовить сессию', 'primary'))}</div>`;
}
function eventList(events) {
  return events.map(e => `<article class="event" id="event-${e.id}"><span class="timeline-dot"></span><div><span class="muted tiny">${fullDate(e.createdAt)}${e.sessionId ? ' · ' + esc(active().sessions.find(s => s.id === e.sessionId)?.name || '') : ''}</span><p class="preline">${esc(e.text)}</p><div class="tags">${linkedNames(e.links)}</div></div></article>`).join('');
}
function journalPage() {
  return `${sectionHead('ПАМЯТЬ ВАШЕГО МИРА', 'Хроника', 'Что решили герои. Кого встретили. Что изменилось навсегда.', button('new-event', icon('plus') + ' Записать событие', 'primary'))}<section class="panel">${eventList([...active().events].reverse()) || empty('Всё ещё впереди', 'Сохраняйте короткие факты во время игры, а после связывайте их с персонажами и местами.')}</section>`;
}
function combatPage() { return screens.combatPage(active()); }
function soundPage() { return screens.soundPage(active(), mixer); }
function render() {
  if (mixer.campaignId !== (active()?.id || null)) { selected = ''; query = ''; filter = ''; tagFilter = ''; pinnedOnly = false; }
  mixer.setCampaign(active());
  const c = active();
  if (!c && view !== 'campaigns' && view !== 'help') view = 'campaigns';
  const page = { campaigns: campaignsPage, overview: overviewPage, knowledge: knowledgePage, sessions: sessionsPage, sound: soundPage, journal: journalPage, combat: combatPage, help: helpPage }[view];
  $('#app').innerHTML = `<aside class="sidebar"><a href="#" class="brand" data-action="campaigns"><span class="brand-icon">${icon('dice')}</span><span>DM Workbench<small>МАСТЕРСКАЯ ИСТОРИЙ</small></span></a><button class="campaign-switch" data-action="campaigns">${icon('folder')}<span>${c ? esc(c.name) : 'Все кампании'}<small>${c ? 'Выбрать другую кампанию' : 'Ваши миры и приключения'}</small></span><span>⌄</span></button><div class="nav-label">${c ? 'КАМПАНИЯ' : 'МАСТЕРСКАЯ'}</div><nav aria-label="Основная навигация">${(c ? navItems : [['campaigns', 'folder', 'Мои кампании']]).map(([key, glyph, label]) => `<button data-action="nav" data-view="${key}" class="nav-item ${view === key ? 'selected' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${key === 'knowledge' ? `<span class="nav-count">${c.entries.length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom">${c ? button('export', icon('download') + ' Сохранить в файл', 'nav-item') : ''}${button('help', icon('settings') + ' Данные и установка', 'nav-item')}<div class="local-status"><span class="dot"></span><div>Ваш мир — у вас<small id="offline-status">${offlineReady ? 'Готово к работе без сети' : 'Данные хранятся локально'}</small></div></div></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Мастерская <span>/</span> ${c ? esc(c.name) : 'Кампании'}</span><span class="save-status"><span class="dot"></span> <span id="save-label">${navigator.onLine ? 'Локальное хранение' : 'Без интернета'}</span></span></header><main id="main" tabindex="-1">${page()}</main><footer>DM WORKBENCH <span>Создавайте истории, которые хочется помнить.</span><span>Версия 0.2</span></footer><div id="audio-dock-root">${screens.audioDock(c, mixer)}</div></div>`;
}
function helpPage() {
  return `${sectionHead('ВАША МАСТЕРСКАЯ', 'Данные и установка', 'Кампании остаются на этом устройстве.')}<div class="overview-grid"><section class="panel"><h2>Работа без интернета</h2><p>Откройте приложение с интернетом и дождитесь сообщения «Готово к работе без сети». После этого заметки, поиск, сессии и бой доступны автономно.</p><p><strong>${offlineReady ? '✓ Приложение готово к работе без сети' : 'Офлайн-подготовка ещё не завершена'}</strong></p>${button('install', 'Установить приложение', 'primary')}<p class="muted">В Chrome или Edge используйте значок установки в адресной строке. Если установка недоступна, работайте в обычной вкладке браузера.</p></section><section class="panel"><h2>Резервная копия</h2><p>Сохраните кампанию в файл после игры. Очистка данных сайта удаляет локальные кампании. Файл экспорта храните отдельно. В него входят загруженные музыка и звуки.</p><p>Импорт добавляет независимую копию. Изменения между устройствами автоматически не объединяются.</p><div class="actions">${active() ? button('export', icon('download') + ' Экспорт кампании', 'primary') : ''}${button('import', icon('upload') + ' Импорт', 'secondary')}</div><hr><p class="muted" id="persistence-status">Можно попросить браузер защитить хранилище от автоматической очистки.</p>${button('persist-storage', 'Защитить локальные данные', 'secondary')}</section></div><section class="panel"><h2>Быстрее с клавиатуры</h2><p><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd> — поиск в базе знаний открытой кампании. <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> — сохранить открытый редактор. <kbd>Esc</kbd> — закрыть его; при несохранённых изменениях появится вопрос.</p></section><section class="panel"><h2>Правила и границы прототипа</h2><p>Целевая система — D&D 5.5e (правила 2024 года). Полного справочника правил в прототипе пока нет. Инициативу можно бросить кнопкой d20. Эффекты — напоминания до начала указанного раунда; сопротивления, спасброски и эффекты концентрации решает мастер.</p><p>Тексты записей сохраняются кнопкой «Сохранить». Действия боя сохраняются автоматически. До закрытия редактора можно скопировать свой текст, если запись не удалась.</p></section>`;
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
    event.preventDefault(); if (busy || submitting) return;
    const submit = form.querySelector('[type=submit]'); submit.disabled = true; submitting = true;
    try { await onSubmit(new FormData(form)); dirty = false; dialog.close(); render(); toast('Сохранено на устройстве'); }
    catch (error) { failure(error); }
    finally { submit.disabled = false; submitting = false; }
  });
  dialog.showModal();
}
function closeDialog() {
  if (busy || submitting) return;
  if (dirty && !confirm('Закрыть без сохранения изменений?')) return;
  dirty = false; $('#editor').close();
}
$('#editor').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
window.addEventListener('beforeunload', event => { if (dirty || busy || submitting) { event.preventDefault(); event.returnValue = ''; } });
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
  openDialog(e ? 'Запись базы знаний' : 'Новая запись', field('Название', 'name', initial.name, { required: true }) + `<div class="form-grid">${selectField('Тип', 'type', TYPES, initial.type)}${selectField('Статус зацепки', 'status', HOOKS, initial.status)}</div>` + `<details ${['npc','monster'].includes(initial.type) ? 'open' : ''}><summary>Характеристики для боя (персонажи и существа)</summary><div class="form-grid">${field('Класс доспеха','ac',initial.stats.ac,{type:'number',max:100,required:true})}${field('Максимум HP','maxHp',initial.stats.maxHp,{type:'number',min:1,required:true})}${field('Бонус инициативы','initiativeBonus',initial.stats.initiativeBonus,{type:'number',min:-100,max:100,required:true})}${selectField('Сторона','role',ROLES,initial.stats.role)}${field('Скорость','speed',initial.stats.speed,{maxLength:100})}</div></details>` + field('Текст', 'text', initial.text, { area: true, rows: 8 }) + field('Теги через запятую', 'tags', initial.tags.join(', '), { maxLength: 1000 }) + linksField(initial.links, initial.id) + (backlinks.length ? `<section class="backlinks"><h3>Где упоминается</h3>${backlinks.join('')}</section>` : ''), async data => {
    const next = structuredClone(active());
    const updated = { ...initial, stats: {ac:Number(data.get('ac')),maxHp:Number(data.get('maxHp')),initiativeBonus:Number(data.get('initiativeBonus')),role:data.get('role'),speed:data.get('speed')}, name: data.get('name').trim(), type: data.get('type'), status: data.get('status'), text: data.get('text'), tags: [...new Set(data.get('tags').split(',').map(s => s.trim()).filter(Boolean))], links: data.getAll('links'), updatedAt: now() };
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
  openDialog(c ? 'Участник боя' : 'Добавить участника', field('Имя', 'name', c?.name || '', { required: true }) + `<div class="form-grid">${field('Максимум HP', 'maxHp', c?.maxHp || 10, { type: 'number', min: 1, required: true })}${field('Инициатива', 'initiative', c?.initiative || 0, { type: 'number', min: -1000, max: 1000, required: true })}${c ? field('Текущие HP', 'hp', c.hp, { type: 'number', required: true }) + field('Временные HP', 'tempHp', c.tempHp, { type: 'number', required: true }) : ''}</div>` + `<div class="form-grid">${field('Класс доспеха','ac',c?.ac ?? 10,{type:'number',max:100,required:true})}${field('Бонус инициативы','initiativeBonus',c?.initiativeBonus ?? 0,{type:'number',min:-100,max:100,required:true})}${selectField('Сторона','role',ROLES,c?.role || 'enemy')}</div>` + field('Действия и заметки','notes',c?.notes || '',{area:true,rows:3}) + field('Состояния', 'conditions', c?.conditions || '', { maxLength: 1000 }) + `<label class="checkbox"><input type="checkbox" name="concentration" ${c?.concentration ? 'checked' : ''}> Концентрация</label>`, async data => {
    const values = { ac:Number(data.get('ac')),initiativeBonus:Number(data.get('initiativeBonus')),role:data.get('role'),notes:data.get('notes'), name: data.get('name').trim(), maxHp: Number(data.get('maxHp')), initiative: Number(data.get('initiative')), hp: Number(data.get(c ? 'hp' : 'maxHp')), tempHp: Number(data.get('tempHp') || 0), conditions: data.get('conditions'), concentration: data.has('concentration') };
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
function soundEditor(id) {
  const track=active().soundboard.tracks.find(t=>t.id===id);
  openDialog(track?'Настройки аудио':'Добавить аудио',field('Название','name',track?.name || '',{required:true})+selectField('Назначение','kind',SOUND_KINDS,track?.kind || 'music')+`<label class="checkbox"><input type="checkbox" name="loop" ${track?.loop !== false?'checked':''}>Повторять (для короткого эффекта выключите)</label>`+(!track?'<label class="field">Аудиофайл<input type="file" name="audio" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm" required></label><p class="muted tiny">До 20 МБ на файл, 60 МБ на кампанию. Файл копируется на устройство.</p>':''),async data=>{
    const next=structuredClone(active()), assets=[];
    if(track) Object.assign(next.soundboard.tracks.find(t=>t.id===id),{name:data.get('name').trim(),kind:data.get('kind'),loop:data.has('loop')});
    else {
      const file=data.get('audio'),blob=await prepareAudio(file),assetId=uid();
      next.soundboard.tracks.push({id:uid(),assetId,name:data.get('name').trim(),fileName:file.name,kind:data.get('kind'),mime:blob.type,bytes:blob.size,volume:0.7,loop:data.has('loop')});
      assets.push({id:assetId,campaignId:next.id,blob});
    }
    await persist(next,false,{assets}); if(track) mixer.stop(track.id);
  },{after:track?button('delete-sound','Удалить аудио','danger-text',id):''});
}
async function exportActive() {
  // Reload the committed record so another tab's latest changes are included.
  const {campaign: current, assets} = await loadCampaignBundle(activeId);
  const text = exportCampaign(current, await encodeAssets(assets));
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
    case 'entry': selected = id; view = 'knowledge'; render(); break;
    case 'edit-entry': entryEditor(id); break;
    case 'pin-entry': await mutate(c => { const e = c.entries.find(e => e.id === id); e.pinned = !e.pinned; }); break;
    case 'jump-event': view = 'journal'; render(); document.getElementById(`event-${id}`)?.scrollIntoView({block:'center'}); break;
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
    case 'damage': case 'heal': {
      const input = document.querySelector(`[data-hp-input="${id}"]`);
      if (!input?.value) { healthEditor(id, action); break; }
      if (!input.checkValidity()) { input.reportValidity(); break; }
      const amount = Math.floor(Number(input.value) * (action === 'damage' ? Number(document.querySelector(`[data-damage-scale="${id}"]`).value) : 1));
      const concentration = active().battle.combatants.find(p => p.id === id).concentration;
      await mutate(c => { c.battle = changeBattle(c.battle, {type:action,id,amount}); });
      if (concentration && action === 'damage' && amount > 0) toast('Получен урон: проверьте концентрацию участника.');
      break;
    }
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
    case 'go-sound': view = 'sound'; render(); break;
    case 'combat-library': view = 'knowledge'; filter = ''; query = ''; render(); toast('Откройте персонажа или существо и нажмите «Добавить в бой».'); break;
    case 'entry-to-combat': await mutate(c => { c.battle = changeBattle(c.battle,{type:'add',combatant:fromEntry(c.entries.find(e=>e.id===id))}); }); toast('Участник добавлен в бой'); break;
    case 'roll-one': case 'roll-enemies': await mutate(c => { c.battle = changeBattle(c.battle,{type:'roll',values:Object.fromEntries(c.battle.combatants.filter(p=>action==='roll-one'?p.id===id:p.role==='enemy').map(p=>[p.id,d20()+p.initiativeBonus]))}); }); break;
    case 'sort-battle': await mutate(c=>{c.battle=changeBattle(c.battle,{type:'sort'});}); break;
    case 'add-effect': openDialog('Эффект участника',field('Название','name','',{required:true}) + field('Раундов до напоминания (пусто — бессрочно)','rounds','',{type:'number',min:1,max:10000}), async data=>{await mutate(c=>{c.battle=changeBattle(c.battle,{type:'effect-add',id,name:data.get('name').trim(),rounds:data.get('rounds')===''?null:Number(data.get('rounds'))});});}); break;
    case 'remove-effect': await mutate(c=>{c.battle=changeBattle(c.battle,{type:'effect-remove',id,effectId:el.dataset.effect});}); break;
    case 'save-encounter':
      if (!active().battle.combatants.length) return toast('Сначала добавьте участников.');
      openDialog('Заготовка встречи',field('Название','name','',{required:true}),async data=>{await mutate(c=>c.encounters.push(createEncounter(data.get('name'),c.battle)));}); break;
    case 'load-encounter':
      if (active().battle.started) throw new Error('Завершите текущий бой перед загрузкой заготовки.');
      if (active().battle.combatants.length && !confirm('Заменить текущий состав встречи? Действие можно отменить.')) return;
      await mutate(c=>{c.battle=changeBattle(c.battle,{type:'load',combatants:c.encounters.find(e=>e.id===id).combatants});}); break;
    case 'delete-encounter': if(confirm('Удалить заготовку встречи?')) await mutate(c=>{c.encounters=c.encounters.filter(e=>e.id!==id);}); break;
    case 'new-sound': soundEditor(); break;
    case 'edit-sound': soundEditor(id); break;
    case 'play-sound': await mixer.toggle(active().soundboard.tracks.find(t=>t.id===id),activeId); break;
    case 'stop-audio': mixer.stopAll(); break;
    case 'play-mood': await mixer.playMood(active().soundboard.moods.find(m=>m.id===id),active()); break;
    case 'save-mood': {
      const layers = mixer.activeLayers().filter(l=>active().soundboard.tracks.find(t=>t.id===l.trackId).kind!=='effect');
      if(!layers.length) return toast('Сначала включите музыку или атмосферу.');
      openDialog('Сохранить звуковую сцену',field('Название','name','',{required:true}),async data=>{await mutate(c=>c.soundboard.moods.push({id:uid(),name:data.get('name').trim(),layers}));}); break;
    }
    case 'delete-mood': if(confirm('Удалить звуковую сцену?')) await mutate(c=>{c.soundboard.moods=c.soundboard.moods.filter(m=>m.id!==id);}); break;
    case 'delete-sound': {
      if(!confirm('Удалить аудиофайл и его ссылки в звуковых сценах?')) return;
      const next=structuredClone(active()), track=next.soundboard.tracks.find(t=>t.id===id);
      next.soundboard.tracks=next.soundboard.tracks.filter(t=>t.id!==id);
      next.soundboard.moods=next.soundboard.moods.map(m=>({...m,layers:m.layers.filter(l=>l.trackId!==id)})).filter(m=>m.layers.length);
      await persist(next,false,{deleteAssets:[track.assetId]}); mixer.stop(id); dirty=false; $('#editor').close(); render(); break;
    }
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
  event.preventDefault(); if (busy || submitting) return;
  handleAction(el).catch(failure);
});
document.addEventListener('keydown', event => {
  if(busy) return;
  if(view==='combat' && !$('#editor').open && !event.target.closest('input,textarea,select,[contenteditable]') && ['ArrowLeft','ArrowRight'].includes(event.key)) {event.preventDefault(); handleAction({dataset:{action:event.key==='ArrowRight'?'next-turn':'previous-turn'}}).catch(failure);}
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === 'Enter' && $('#editor').open) { event.preventDefault(); $('#edit-form').requestSubmit(); }
  if (event.key.toLowerCase() === 'k' && active() && !$('#editor').open) {
    event.preventDefault(); view = 'knowledge'; render(); $('#search').focus();
  }
});
document.addEventListener('input', event => {
  if (event.target.dataset.volume) {
    const id=event.target.dataset.volume, value=Number(event.target.value)/100;
    if(id==='master') mixer.setMaster(value); else mixer.setVolume(id,value);
    event.target.nextElementSibling.value = Math.round(value*100)+'%';
  }
  if (event.target.id === 'search') { query = event.target.value; $('#entries').innerHTML = entriesList(); }
});
document.addEventListener('change', event => {
  const el=event.target;
  if(el.id==='type-filter') filter=el.value;
  if(el.id==='tag-filter') tagFilter=el.value;
  if(el.id==='entry-sort') sort=el.value;
  if(el.id==='pinned-filter') pinnedOnly=el.checked;
  if(['type-filter','tag-filter','entry-sort','pinned-filter'].includes(el.id)) $('#entries').innerHTML=entriesList();
  if(el.dataset.volume) {
    const id=el.dataset.volume,value=Number(el.value)/100;
    mutate(c=>{if(id==='master') c.soundboard.masterVolume=value; else c.soundboard.tracks.find(t=>t.id===id).volume=value;}).catch(error=>{mixer.setCampaign(active()); for(const t of active().soundboard.tracks) mixer.setVolume(t.id,t.volume); render(); failure(error);});
  }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Файл больше 100 МБ.');
    const {campaign:c,assets} = importBundle(await file.text()); await persist(c, true, {assets}); activeId = c.id; view = 'overview'; render(); toast('Кампания импортирована как отдельная копия');
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
