import { defaultCombat, combatFromSRD, upgradeSRDCombat } from './combat.js';
export const SYSTEM = 'dnd-5.5e-2024';
export const TYPES = { npc: 'Персонаж', location: 'Место', faction: 'Фракция', hook: 'Зацепка', item: 'Предмет', note: 'Заметка', monster: 'Существо', spell: 'Заклинание', rule: 'Правило' };
export const ROLES = { hero: 'Герой', ally: 'Союзник', enemy: 'Противник', neutral: 'Нейтральный' };
export const SOUND_KINDS = { music: 'Музыка', ambience: 'Атмосфера', effect: 'Звуковой эффект' };
export const defaultStats = () => ({ ac: 10, maxHp: 10, initiativeBonus: 0, speed: '30 фт', role: 'enemy', combat: defaultCombat() });
export const emptySoundboard = () => ({ masterVolume: 0.7, tracks: [], moods: [] });
export const HOOKS = { open: 'Открыта', active: 'Развивается', done: 'Завершена' };
export const SESSION_STATUS = { planned: 'Готовится', playing: 'Идёт игра', done: 'Завершена' };
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const emptyBattle = () => ({ combatants: [], round: 1, activeId: null, started: false, history: [], rolls: [] });
export function createCampaign(name, summary = '') {
  return { id: uid(), name: name.trim(), summary, system: SYSTEM, rulesSource: 'srd-5.2.1', archived: false, createdAt: now(), updatedAt: now(), revision: 0, schemaVersion: 4, assistant: {messages: []}, encounters: [], soundboard: emptySoundboard(), entries: [], sessions: [], events: [], battle: emptyBattle() };
}
export function createEntry(type, name, text = '') {
  return { id: uid(), type, name, text, tags: [], links: [], pinned: false, stats: defaultStats(), status: 'open', updatedAt: now() };
}
export function createSession(name, date = '') {
  return { id: uid(), name, date, status: 'planned', plan: '', recap: '', links: [] };
}
export function createCombatant(name, hp, initiative) {
  return { id: uid(), name: name.trim(), hp, maxHp: hp, tempHp: 0, initiative, conditions: '', concentration: false, ac: 10, role: 'enemy', initiativeBonus: 0, effects: [], notes: '', speed: '', combat: defaultCombat(), trackHp: true, concentrationChecks: [] };
}
export function changeBattle(battle, action) {
  if (action.type === 'undo') {
    if (!battle.history.length) return structuredClone(battle);
    return { ...structuredClone(battle.history.at(-1)), history: structuredClone(battle.history.slice(0, -1)) };
  }
  const next = structuredClone(battle);
  const { history, ...snapshot } = structuredClone(battle);
  next.history = [...history.slice(-19), snapshot];
  const target = next.combatants.find(c => c.id === action.id);
  switch (action.type) {
    case 'add': next.combatants.push(structuredClone(action.combatant)); break;
    case 'add-many': next.combatants.push(...structuredClone(action.combatants)); break;
    case 'record-roll':
      if(action.initiative!==undefined){
        if(!target || !Number.isSafeInteger(action.initiative) || Math.abs(action.initiative)>1000)throw new Error('Неверная инициатива.');
        target.initiative=action.initiative;
      }
      next.rolls = [...next.rolls.slice(-29), structuredClone(action.roll)]; break;
    case 'start':
      if (!next.combatants.length) return structuredClone(battle);
      next.combatants.sort((a, b) => b.initiative - a.initiative);
      next.started = true; next.round = 1; next.activeId = next.combatants[0].id; break;
    case 'next':
    case 'previous': {
      if (!next.started || !next.combatants.length) return structuredClone(battle);
      const index = next.combatants.findIndex(c => c.id === next.activeId);
      const step = action.type === 'next' ? 1 : -1;
      if (index === 0 && step === -1 && next.round === 1) return structuredClone(battle);
      const position = index + step;
      if (position >= next.combatants.length) next.round += 1;
      if (position < 0) next.round -= 1;
      next.activeId = next.combatants[(position + next.combatants.length) % next.combatants.length].id;
      break;
    }
    case 'remove': {
      const index = next.combatants.findIndex(c => c.id === action.id);
      if (index < 0) return structuredClone(battle);
      next.combatants.splice(index, 1);
      if (next.activeId === action.id) {
        if (index >= next.combatants.length && next.combatants.length) next.round += 1;
        next.activeId = next.combatants[index % next.combatants.length]?.id ?? null;
      }
      if (!next.combatants.length) { next.started = false; next.activeId = null; next.round = 1; }
      break;
    }
    case 'move': {
      const index = next.combatants.findIndex(c => c.id === action.id);
      const other = index + action.direction;
      if (index < 0 || other < 0 || other >= next.combatants.length) return structuredClone(battle);
      [next.combatants[index], next.combatants[other]] = [next.combatants[other], next.combatants[index]];
      break;
    }
    case 'damage':
    case 'heal': {
      if (!target || !Number.isSafeInteger(action.amount) || action.amount < 0 || action.amount > 100000) throw new Error('Введите целое число от 0 до 100000.');
      if (action.type === 'heal') target.hp = Math.min(target.maxHp, target.hp + action.amount);
      else {
        if (target.concentration && action.amount > 0) target.concentrationChecks.push(Math.min(30, Math.max(10, Math.floor(action.amount / 2))));
        const absorbed = Math.min(target.tempHp, action.amount);
        target.tempHp -= absorbed;
        target.hp = Math.max(0, target.hp - (action.amount - absorbed));
      }
      break;
    }
    case 'sort': next.combatants.sort((a, b) => b.initiative - a.initiative); break;
    case 'roll':
      for (const c of next.combatants) if (Object.hasOwn(action.values, c.id)) c.initiative = action.values[c.id];
      if(action.rolls)next.rolls=[...next.rolls,...structuredClone(action.rolls)].slice(-30);
      break;
    case 'effect-add':
      if (!target) return structuredClone(battle);
      target.effects.push({ id: uid(), name: action.name, expiresRound: action.rounds === null ? null : next.round + action.rounds, source: action.source || '', reminder: action.reminder || '' });
      break;
    case 'effect-remove':
      if (!target) return structuredClone(battle);
      target.effects = target.effects.filter(e => e.id !== action.effectId); break;
    case 'load':
      if (next.started) throw new Error('Завершите текущий бой перед загрузкой заготовки.');
      next.combatants = action.combatants.map(c => ({ ...structuredClone(c), id: uid(), hp: c.maxHp, tempHp: 0, effects: [], concentration: false, concentrationChecks: [] }));
      next.round = 1; next.activeId = null; next.rolls = []; break;
    case 'edit':
      if (!target) return structuredClone(battle);
      Object.assign(target, action.values); if (!target.concentration) target.concentrationChecks = []; break;
    case 'clear': return { ...emptyBattle(), history: next.history };
    default: throw new Error('Неизвестное действие боя.');
  }
  return next;
}

export function removeEntry(campaign, id) {
  campaign.entries = campaign.entries.filter(e => e.id !== id);
  for (const item of [...campaign.entries, ...campaign.sessions, ...campaign.events]) item.links = item.links.filter(link => link !== id);
}

export function demoCampaign() {
  const c = createCampaign('Тайны Тихой гавани', 'У маяка снова горит свет. Но смотритель пропал двадцать лет назад.');
  const npc = createEntry('npc', 'Мира Вейл', 'Хозяйка «Солёного ветра».\nЦель: найти пропавшего брата.\nМанера: крутит серебряную монету, когда волнуется.\nСекрет: видела корабль без команды у старого маяка.');
  npc.tags = ['союзник', 'гавань']; npc.stats.role = 'ally';
  const place = createEntry('location', 'Старый маяк', 'На утёсе пахнет водорослями и озоном.\nОпасность: лестница частично обрушилась.\nЗацепка: по ночам свет складывается в знакомые символы.');
  const hook = createEntry('hook', 'Кто зажигает огонь?', 'Рыбаки боятся выходить в море. Мира просит выяснить, кто вернулся в маяк.');
  hook.links = [npc.id, place.id]; hook.tags = ['главная линия'];
  const session = createSession('Огонь на пустом берегу');
  session.plan = '1. Начало в таверне: мокрый посыльный приносит пустое письмо.\n2. Разговор с Мирой и слухи рыбаков.\n3. Дорога к маяку: следы на песке ведут из моря.\n4. На вершине — огонь, который не греет.';
  session.links = [npc.id, place.id, hook.id];
  c.entries = [npc, place, hook]; c.sessions = [session];
  c.events = [{ id: uid(), text: 'Рыбаки заметили свет в заброшенном маяке. Начало новой истории.', createdAt: now(), sessionId: null, links: [place.id] }];
  c.battle.combatants = [createCombatant('Страж маяка', 18, 12), { ...createCombatant('Путник', 24, 16), role: 'hero' }];
  return c;
}


// Old records are upgraded in memory; the next successful transaction commits them.
// Reading never deletes or overwrites an existing campaign.
export function migrateCampaign(input) {
  const c = structuredClone(input);
  if (c.schemaVersion === 4) {
    for(const e of c.entries)e.stats.combat=upgradeSRDCombat(e.stats.combat,e.text,e.id);
    for(const state of [c.battle,...c.battle.history,...c.encounters])for(const p of state.combatants)p.combat=upgradeSRDCombat(p.combat,p.notes,p.id);
    return c;
  }
  if (![undefined, 1, 2, 3].includes(c.schemaVersion)) throw new Error('Версия данных кампании новее приложения.');
  if (c.schemaVersion === undefined || c.schemaVersion === 1) {
    c.assistant = {messages: []}; c.encounters = []; c.soundboard = emptySoundboard();
    for (const e of c.entries) { e.pinned = false; e.stats = defaultStats(); }
    for (const state of [c.battle, ...c.battle.history]) {
      for (const p of state.combatants) Object.assign(p, { ac: 10, role: 'enemy', initiativeBonus: 0, effects: [], notes: '' });
    }
  }
  if (c.schemaVersion === 2) c.assistant = {messages: []};
  c.schemaVersion = 4;
  for (const e of c.entries) e.stats.combat ||= combatFromSRD(e.text);
  for (const state of [c.battle, ...c.battle.history, ...c.encounters]) {
    if ('round' in state) state.rolls ||= [];
    for (const p of state.combatants) {
      p.combat ||= combatFromSRD(p.notes); p.speed ||= ''; p.trackHp ??= true; p.concentrationChecks ||= [];
      for (const e of p.effects) { e.source ||= ''; e.reminder ||= ''; }
    }
  }
  return c;
}
export function fromEntry(entry) {
  return { ...createCombatant(entry.name, entry.stats.maxHp, 0), ac: entry.stats.ac, role: entry.stats.role, initiativeBonus: entry.stats.initiativeBonus, notes: entry.text, speed: entry.stats.speed, combat: structuredClone(entry.stats.combat || defaultCombat()) };
}
export function combatantsFromEntry(entry,count,battle) {
  if(!Number.isInteger(count)||count<1||count>20)throw new Error('Количество существ: от 1 до 20.');
  if(battle.combatants.length+count>300)throw new Error('В бою может быть не больше 300 участников.');
  const names=new Set(battle.combatants.map(p=>p.name)),base=entry.name.slice(0,190);
  return Array.from({length:count},()=>{
    const p=fromEntry(entry);let number=1;
    if(count>1||names.has(p.name)){while(names.has(`${base} ${number}`))number++;p.name=`${base} ${number}`;}
    names.add(p.name);return p;
  });
}
export function createEncounter(name, battle) {
  return { id: uid(), name: name.trim(), combatants: battle.combatants.map(c => ({ ...structuredClone(c), id: uid(), hp: c.maxHp, tempHp: 0, effects: [], concentration: false, concentrationChecks: [] })) };
}
export function d20() {
  const number = new Uint32Array(1);
  do { crypto.getRandomValues(number); } while (number[0] >= 4294967280);
  return number[0] % 20 + 1;
}
export function effectRemaining(effect, round) {
  return effect.expiresRound === null ? null : Math.max(0, effect.expiresRound - round);
}
