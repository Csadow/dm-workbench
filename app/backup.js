import { SYSTEM, TYPES, HOOKS, SESSION_STATUS, uid, now } from './domain.js';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
function check(value, message) { if (!value) throw new Error(`Файл кампании: ${message}`); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function str(value, label, max = 100000) { check(typeof value === 'string' && value.length <= max, `неверное поле «${label}».`); }
function integer(value, min = 0, max = 100000) { check(Number.isSafeInteger(value) && value >= min && value <= max, 'неверное числовое значение.'); }
function array(value, label, max = 10000) { check(Array.isArray(value) && value.length <= max, `неверный список «${label}».`); }
function date(value) { str(value, 'дата', 50); check(Number.isFinite(Date.parse(value)), 'неверная дата.'); }
function id(value) { str(value, 'ID', 100); check(/^[a-zA-Z0-9_-]+$/.test(value), 'неверный ID.'); }
function named(value) { check(object(value), 'ожидалась запись.'); id(value.id); str(value.name, 'название', 200); check(value.name.trim().length > 0, 'пустое название.'); }
function unique(items) { check(new Set(items).size === items.length, 'повторяющиеся ID или ссылки.'); }
function refs(links, entries) { array(links, 'ссылки'); unique(links); for (const link of links) check(entries.has(link), 'ссылка на отсутствующую запись.'); }
function battleState(b) {
  check(object(b), 'неверный бой.'); array(b.combatants, 'участники', 300); integer(b.round, 1, 1000000);
  check(typeof b.started === 'boolean', 'неверный статус боя.');
  for (const c of b.combatants) {
    named(c); integer(c.maxHp, 1); integer(c.hp, 0, c.maxHp); integer(c.tempHp); integer(c.initiative, -1000, 1000);
    str(c.conditions, 'состояния', 1000); check(typeof c.concentration === 'boolean', 'неверная концентрация.');
  }
  unique(b.combatants.map(c => c.id));
  check(b.started ? b.combatants.some(c => c.id === b.activeId) : b.activeId === null, 'неверный текущий участник.');
}
export function validateCampaign(c) {
  named(c); str(c.summary, 'описание');
  check(c.system === SYSTEM && c.rulesSource === 'srd-5.2.1', 'эта версия правил пока не поддерживается.');
  check(typeof c.archived === 'boolean', 'неверный статус архива.'); integer(c.revision, 0, Number.MAX_SAFE_INTEGER);
  date(c.createdAt); date(c.updatedAt);
  array(c.entries, 'записи'); array(c.sessions, 'сессии'); array(c.events, 'события');
  const entryIds = new Set(c.entries.map(e => e?.id)); const sessionIds = new Set(c.sessions.map(s => s?.id));
  unique([c.id, ...c.entries.map(e => e?.id), ...c.sessions.map(s => s?.id), ...c.events.map(e => e?.id)]);
  for (const e of c.entries) {
    named(e); check(Object.hasOwn(TYPES, e.type), 'неверный тип записи.'); check(Object.hasOwn(HOOKS, e.status), 'неверный статус зацепки.');
    str(e.text, 'текст'); date(e.updatedAt); array(e.tags, 'теги', 30); e.tags.forEach(t => str(t, 'тег', 100)); refs(e.links, entryIds);
  }
  for (const s of c.sessions) {
    named(s); check(Object.hasOwn(SESSION_STATUS, s.status), 'неверный статус сессии.');
    str(s.date, 'дата сессии', 10); check(s.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isFinite(Date.parse(s.date)), 'неверная дата сессии.');
    str(s.plan, 'план'); str(s.recap, 'итоги'); refs(s.links, entryIds);
  }
  for (const e of c.events) {
    check(object(e), 'неверное событие.'); id(e.id); str(e.text, 'событие'); date(e.createdAt); refs(e.links, entryIds);
    check(e.sessionId === null || sessionIds.has(e.sessionId), 'ссылка на отсутствующую сессию.');
  }
  battleState(c.battle); array(c.battle.history, 'история боя', 20); c.battle.history.forEach(battleState);
  const documentIds = new Set([c.id, ...c.entries.map(e => e.id), ...c.sessions.map(s => s.id), ...c.events.map(e => e.id)]);
  for (const state of [c.battle, ...c.battle.history]) {
    check(state.combatants.every(participant => !documentIds.has(participant.id)), 'ID участника совпадает с ID документа.');
  }
  return c;
}
export function exportCampaign(campaign) {
  validateCampaign(campaign);
  const text = JSON.stringify({ application: 'dm-workbench', formatVersion: 1, exportedAt: now(), campaign }, null, 2);
  check(new TextEncoder().encode(text).length <= MAX_IMPORT_BYTES, 'кампания превышает лимит прототипа 5 МБ. Сократите объём текста.');
  return text;
}
export function importCampaign(text) {
  check(new TextEncoder().encode(text).length <= MAX_IMPORT_BYTES, 'размер больше 5 МБ.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Не удалось прочитать JSON. Выберите файл экспорта DM Workbench.'); }
  check(object(data) && data.application === 'dm-workbench', 'неизвестный формат.');
  check(data.formatVersion === 1, 'версия формата не поддерживается. Исходные кампании не изменены.');
  date(data.exportedAt); const c = validateCampaign(data.campaign);
  const ids = new Map();
  const remap = old => { if (!ids.has(old)) ids.set(old, uid()); return ids.get(old); };
  c.id = remap(c.id);
  for (const e of [...c.entries, ...c.sessions, ...c.events]) {
    e.id = remap(e.id); e.links = e.links.map(remap);
    if (e.sessionId) e.sessionId = remap(e.sessionId);
  }
  for (const state of [c.battle, ...c.battle.history]) {
    for (const combatant of state.combatants) combatant.id = remap(combatant.id);
    if (state.activeId) state.activeId = remap(state.activeId);
  }
  c.name = `${c.name.slice(0, 170)} — копия`; c.archived = false; c.revision = 0; c.updatedAt = now();
  return validateCampaign(c);
}
