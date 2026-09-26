import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createCombatant, createEntry, createSession, changeBattle, emptyBattle, demoCampaign, removeEntry, now, uid } from '../app/domain.js';
import { exportCampaign, importCampaign, validateCampaign } from '../app/backup.js';

function battle() {
  let b = emptyBattle();
  for (const [name, hp, initiative] of [['A', 20, 18], ['B', 10, 10]]) b = changeBattle(b, { type: 'add', combatant: createCombatant(name, hp, initiative) });
  return changeBattle(b, { type: 'start' });
}
test('turns cross round boundaries and previous does not precede round one', () => {
  let b = battle(); const first = b.activeId;
  assert.deepEqual(changeBattle(b, { type: 'previous' }), b);
  b = changeBattle(changeBattle(b, { type: 'next' }), { type: 'next' });
  assert.equal(b.round, 2); assert.equal(b.activeId, first);
  b = changeBattle(b, { type: 'previous' }); assert.equal(b.round, 1); assert.equal(b.activeId, b.combatants[1].id);
});
test('damage consumes temporary HP, cannot go below zero, undo restores both', () => {
  let b = battle(); const id = b.activeId;
  b = changeBattle(b, { type: 'edit', id, values: { tempHp: 5 } });
  const before = structuredClone(b);
  b = changeBattle(b, { type: 'damage', id, amount: 8 });
  assert.equal(b.combatants[0].hp, 17); assert.equal(b.combatants[0].tempHp, 0);
  assert.deepEqual(changeBattle(b, { type: 'undo' }), before);
  b = changeBattle(b, { type: 'damage', id, amount: 100 }); assert.equal(b.combatants[0].hp, 0);
  b = changeBattle(b, { type: 'heal', id, amount: 100 }); assert.equal(b.combatants[0].hp, 20);
  assert.throws(() => changeBattle(b, { type: 'damage', id, amount: -1 }));
});
test('removing active and final participants leaves a valid turn', () => {
  let b = battle(); b = changeBattle(b, { type: 'next' });
  b = changeBattle(b, { type: 'remove', id: b.activeId });
  assert.equal(b.round, 2); assert.equal(b.activeId, b.combatants[0].id);
  b = changeBattle(b, { type: 'remove', id: b.activeId });
  assert.equal(b.activeId, null); assert.equal(b.started, false); assert.equal(b.combatants.length, 0);
  assert.equal(changeBattle(b, { type: 'undo' }).combatants.length, 1);
});
test('same creature instances are independent, ties preserve chosen order', () => {
  let b = emptyBattle();
  for (let i = 0; i < 2; i++) b = changeBattle(b, { type: 'add', combatant: createCombatant('Страж', 10, 10) });
  const ids = b.combatants.map(c => c.id);
  b = changeBattle(b, { type: 'move', id: ids[1], direction: -1 });
  b = changeBattle(b, { type: 'start' }); assert.equal(b.activeId, ids[1]);
  b = changeBattle(b, { type: 'damage', id: ids[1], amount: 4 });
  assert.deepEqual(b.combatants.map(c => c.hp), [6, 10]);
});
test('export roundtrip remaps all references including battle undo history', () => {
  const original = demoCampaign(); original.battle = battle();
  original.battle = changeBattle(original.battle, { type: 'damage', id: original.battle.activeId, amount: 4 });
  original.events[0].sessionId = original.sessions[0].id;
  const snapshot = structuredClone(original);
  const imported = importCampaign(exportCampaign(original));
  assert.notEqual(imported.id, original.id); assert.deepEqual(original, snapshot);
  assert.notEqual(imported.battle.activeId, original.battle.activeId);
  assert.equal(imported.events[0].sessionId, imported.sessions[0].id);
  assert.equal(imported.events[0].links[0], imported.entries[1].id);
  assert.equal(imported.battle.combatants[0].hp, 16);
  const undone = changeBattle(imported.battle, { type: 'undo' });
  assert.equal(undone.combatants[0].hp, 20); assert.equal(undone.activeId, imported.battle.activeId);
  assert.equal(importCampaign(exportCampaign(original)).id === imported.id, false);
});
test('import rejects corrupt versions, dangling references, duplicate IDs and invalid numbers', () => {
  const source = JSON.parse(exportCampaign(demoCampaign()));
  for (const mutate of [
    x => x.formatVersion = 22,
    x => x.campaign.entries[0].links.push('missing'),
    x => x.campaign.entries[1].id = x.campaign.entries[0].id,
    x => x.campaign.events[0].sessionId = 'missing',
    x => x.campaign.battle.combatants[0].hp = -1,
    x => x.campaign.battle.round = 0,
    x => x.campaign.battle.activeId = 'missing',
    x => x.campaign.entries[0].type = '__proto__',
    x => x.campaign.battle.history.push({ ...x.campaign.battle, combatants: [], started: true, activeId: 'missing' }),
  ]) {
    const input = structuredClone(source); mutate(input);
    assert.throws(() => importCampaign(JSON.stringify(input)));
  }
  assert.throws(() => importCampaign('{broken'));
  assert.throws(() => importCampaign(' '.repeat(5 * 1024 * 1024 + 1)));
});
test('deleting an entry cleans backlinks across entries, sessions and journal', () => {
  const c = demoCampaign(); const id = c.entries[1].id;
  removeEntry(c, id); validateCampaign(c);
  assert.ok([...c.entries, ...c.sessions, ...c.events].every(x => !x.links.includes(id)));
});
test('new campaign has independent arrays and bounded undo history', () => {
  const a = createCampaign('A'), b = createCampaign('B');
  a.entries.push(createEntry('note', 'Только A')); assert.equal(b.entries.length, 0);
  a.sessions.push(createSession('Сессия')); a.events.push({ id: uid(), createdAt: now(), text: 'Факт', sessionId: a.sessions[0].id, links: [a.entries[0].id] });
  a.battle = battle();
  for (let i = 0; i < 40; i++) a.battle = changeBattle(a.battle, { type: 'next' });
  assert.equal(a.battle.history.length, 20); validateCampaign(a);
});
