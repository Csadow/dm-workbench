import { SYSTEM, TYPES, HOOKS, SESSION_STATUS, ROLES, SOUND_KINDS, migrateCampaign, uid, now } from './domain.js';
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_CAMPAIGN_AUDIO_BYTES = 60 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/webm', 'audio/aac'];
function check(value, message) { if (!value) throw new Error(`Файл кампании: ${message}`); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function str(value, label, max = 100000) { check(typeof value === 'string' && value.length <= max, `неверное поле «${label}».`); }
function integer(value, min = 0, max = 100000) { check(Number.isSafeInteger(value) && value >= min && value <= max, 'неверное числовое значение.'); }
function volume(value) { check(Number.isFinite(value) && value >= 0 && value <= 1, 'неверная громкость.'); }
function array(value, label, max = 10000) { check(Array.isArray(value) && value.length <= max, `неверный список «${label}».`); }
function date(value) { str(value, 'дата', 50); check(Number.isFinite(Date.parse(value)), 'неверная дата.'); }
function id(value) { str(value, 'ID', 100); check(/^[a-zA-Z0-9_-]+$/.test(value), 'неверный ID.'); }
function named(value) { check(object(value), 'ожидалась запись.'); id(value.id); str(value.name, 'название', 200); check(value.name.trim().length > 0, 'пустое название.'); }
function unique(items) { check(new Set(items).size === items.length, 'повторяющиеся ID или ссылки.'); }
function refs(links, entries) { array(links, 'ссылки'); unique(links); for (const link of links) check(entries.has(link), 'ссылка на отсутствующую запись.'); }
function stats(value) {
  check(object(value), 'неверные характеристики.'); integer(value.ac, 0, 100); integer(value.maxHp, 1); integer(value.initiativeBonus, -100, 100);
  check(Object.hasOwn(ROLES, value.role), 'неверная роль участника.');
}
function combatants(items) {
  array(items, 'участники', 300);
  const identifiers = [];
  for (const c of items) {
    named(c); stats(c); integer(c.hp, 0, c.maxHp); integer(c.tempHp); integer(c.initiative, -1000, 1000);
    str(c.conditions, 'состояния', 1000); str(c.notes, 'боевые заметки'); check(typeof c.concentration === 'boolean', 'неверная концентрация.');
    array(c.effects, 'эффекты', 30); identifiers.push(c.id);
    for (const effect of c.effects) {
      named(effect); identifiers.push(effect.id);
      if (effect.expiresRound !== null) integer(effect.expiresRound, 1, 2000000);
    }
  }
  unique(identifiers);
}
function battleState(b) {
  check(object(b), 'неверный бой.'); combatants(b.combatants); integer(b.round, 1, 1000000);
  check(typeof b.started === 'boolean', 'неверный статус боя.');
  check(b.started ? b.combatants.some(c => c.id === b.activeId) : b.activeId === null, 'неверный текущий участник.');
}
export function validateCampaign(c) {
  named(c); str(c.summary, 'описание'); check(c.schemaVersion === 3, 'неизвестная схема данных.');
  check(c.system === SYSTEM && c.rulesSource === 'srd-5.2.1', 'эта версия правил пока не поддерживается.');
  check(typeof c.archived === 'boolean', 'неверный статус архива.'); integer(c.revision, 0, Number.MAX_SAFE_INTEGER);
  date(c.createdAt); date(c.updatedAt);
  check(object(c.assistant), 'нет истории помощника.'); array(c.assistant.messages, 'переписка', 100);
  for (const m of c.assistant.messages) {
    check(object(m), 'неверное сообщение.'); id(m.id); check(['user','assistant'].includes(m.role), 'неверная роль сообщения.');
    str(m.text, 'сообщение', 16000); str(m.model, 'модель', 120); date(m.createdAt); array(m.sources, 'источники', 30); m.sources.forEach(s => str(s, 'источник', 500));
  }
  array(c.entries, 'записи'); array(c.sessions, 'сессии'); array(c.events, 'события'); array(c.encounters, 'заготовки', 100);
  check(object(c.soundboard), 'нет звуковой панели.');
  array(c.soundboard.tracks, 'аудиофайлы', 100); array(c.soundboard.moods, 'звуковые сцены', 100); volume(c.soundboard.masterVolume);
  const entryIds = new Set(c.entries.map(e => e?.id)); const sessionIds = new Set(c.sessions.map(s => s?.id));
  const documents = [c, ...c.assistant.messages, ...c.entries, ...c.sessions, ...c.events, ...c.encounters, ...c.soundboard.tracks, ...c.soundboard.moods];
  unique(documents.map(e => e?.id));
  for (const e of c.entries) {
    named(e); check(Object.hasOwn(TYPES, e.type), 'неверный тип записи.'); check(Object.hasOwn(HOOKS, e.status), 'неверный статус зацепки.');
    str(e.text, 'текст'); date(e.updatedAt); array(e.tags, 'теги', 30); e.tags.forEach(t => str(t, 'тег', 100)); refs(e.links, entryIds);
    check(typeof e.pinned === 'boolean', 'неверное закрепление.'); stats(e.stats); str(e.stats.speed, 'скорость', 100);
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
  for (const encounter of c.encounters) { named(encounter); combatants(encounter.combatants); }
  const documentIds = new Set(documents.map(e => e.id));
  for (const state of [c.battle, ...c.battle.history, ...c.encounters]) {
    check(state.combatants.every(p => !documentIds.has(p.id) && p.effects.every(e => !documentIds.has(e.id))), 'боевой ID совпадает с ID документа.');
  }
  for (const track of c.soundboard.tracks) {
    named(track); id(track.assetId); str(track.fileName, 'имя файла', 500);
    check(Object.hasOwn(SOUND_KINDS, track.kind), 'неверный тип звука.');
    check(AUDIO_TYPES.includes(track.mime), 'неподдерживаемый формат аудио.');
    integer(track.bytes, 1, MAX_AUDIO_BYTES); volume(track.volume); check(typeof track.loop === 'boolean', 'неверный режим повтора.');
  }
  unique(c.soundboard.tracks.map(t => t.assetId));
  check(c.soundboard.tracks.reduce((n, t) => n + t.bytes, 0) <= MAX_CAMPAIGN_AUDIO_BYTES, 'аудио кампании превышает 60 МБ.');
  const tracks = new Set(c.soundboard.tracks.map(t => t.id));
  for (const mood of c.soundboard.moods) {
    named(mood); array(mood.layers, 'слои сцены', 16); unique(mood.layers.map(l => l?.trackId));
    for (const layer of mood.layers) { check(object(layer) && tracks.has(layer.trackId), 'сцена ссылается на отсутствующий звук.'); volume(layer.volume); }
  }
  return c;
}
export function validateDocument(campaign) {
  validateCampaign(campaign);
  check(new TextEncoder().encode(JSON.stringify(campaign)).length <= MAX_DOCUMENT_BYTES, 'текст и данные кампании превышают лимит 5 МБ.');
}
export async function encodeAssets(assets) {
  const encoded = [];
  for (const asset of assets) {
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    encoded.push({ id: asset.id, mime: asset.blob.type, base64: btoa(binary) });
  }
  return encoded;
}
function checkAssets(c, assets) {
  array(assets, 'аудиоданные', 100); unique(assets.map(a => a?.id));
  const expected = new Map(c.soundboard.tracks.map(t => [t.assetId, t]));
  check(assets.length === expected.size, 'не все аудиофайлы включены в копию.');
  const blobs = [];
  for (const asset of assets) {
    check(object(asset), 'неверные аудиоданные.'); id(asset.id);
    const track = expected.get(asset.id);
    check(track && asset.mime === track.mime, 'аудиофайл не соответствует записи.');
    str(asset.base64, 'аудиоданные', Math.ceil(MAX_AUDIO_BYTES / 3) * 4);
    check(asset.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64), 'повреждённый аудиофайл.');
    let binary;
    try { binary = atob(asset.base64); } catch { throw new Error('Файл кампании: повреждённый аудиофайл.'); }
    check(binary.length === track.bytes, 'размер аудиофайла не совпадает.');
    blobs.push({ id: asset.id, campaignId: c.id, blob: new Blob([Uint8Array.from(binary, ch => ch.charCodeAt(0))], { type: asset.mime }) });
  }
  return blobs;
}
export function exportCampaign(campaign, assets = []) {
  validateDocument(campaign); checkAssets(campaign, assets);
  const text = JSON.stringify({ application: 'dm-workbench', formatVersion: 3, exportedAt: now(), campaign, assets }, null, 2);
  check(new TextEncoder().encode(text).length <= MAX_IMPORT_BYTES, 'копия превышает лимит 100 МБ.');
  return text;
}
export function importBundle(text) {
  check(new TextEncoder().encode(text).length <= MAX_IMPORT_BYTES, 'размер больше 100 МБ.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Не удалось прочитать JSON. Выберите файл экспорта DM Workbench.'); }
  check(object(data) && data.application === 'dm-workbench', 'неизвестный формат.');
  check([1, 2, 3].includes(data.formatVersion), 'версия формата не поддерживается. Исходные кампании не изменены.');
  date(data.exportedAt);
  const c = data.formatVersion < 3 ? migrateCampaign(data.campaign) : data.campaign;
  validateDocument(c);
  const assets = checkAssets(c, data.assets || []);
  const ids = new Map();
  const remap = old => { if (!ids.has(old)) ids.set(old, uid()); return ids.get(old); };
  c.id = remap(c.id);
  for (const m of c.assistant.messages) m.id = remap(m.id);
  for (const e of [...c.entries, ...c.sessions, ...c.events]) {
    e.id = remap(e.id); e.links = e.links.map(remap);
    if (e.sessionId) e.sessionId = remap(e.sessionId);
  }
  for (const state of [c.battle, ...c.battle.history, ...c.encounters]) {
    if (state.id) state.id = remap(state.id);
    for (const combatant of state.combatants) {
      combatant.id = remap(combatant.id);
      for (const effect of combatant.effects) effect.id = remap(effect.id);
    }
    if (state.activeId) state.activeId = remap(state.activeId);
  }
  for (const track of c.soundboard.tracks) { track.id = remap(track.id); track.assetId = remap(track.assetId); }
  for (const mood of c.soundboard.moods) { mood.id = remap(mood.id); for (const layer of mood.layers) layer.trackId = remap(layer.trackId); }
  for (const asset of assets) { asset.id = remap(asset.id); asset.campaignId = c.id; }
  c.name = `${c.name.slice(0, 170)} — копия`; c.archived = false; c.revision = 0; c.updatedAt = now();
  validateDocument(c);
  return { campaign: c, assets };
}
export const importCampaign = text => importBundle(text).campaign;
