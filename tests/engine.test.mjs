import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRules, createCharacter, simulateRound, evaluate, seededRng } from '../src/engine.mjs';
const base = JSON.parse(await readFile(new URL('../src/rules.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(base);
const input = (name, attributes, abilities = []) => ({ id: name, name, attributes, abilities, fields: { perfil: 'Aventureiro', origem: '', historia: '' } });
const hero = () => createCharacter(base, input('Cael', { forca: 3, habilidade: 2, resistencia: 2, armadura: 1, poderFogo: 0 }));
const rival = () => createCharacter(base, input('Lira', { forca: 0, habilidade: 3, resistencia: 2, armadura: 1, poderFogo: 2 }));
const roundInput = () => ({ combatants: [hero(), rival()], choices: [{ actionId: 'attack_melee' }, { actionId: 'attack_ranged' }], mode: 'seeded', seed: 42 });
const seq = values => { let i = 0; return () => { assert.ok(i < values.length, 'Unexpected extra roll'); return (values[i++] - 1) / 6; }; };

test('built-in JSON validates and 8-point characters derive PV and mana', () => {
  assert.equal(validateRules(base), base);
  assert.deepEqual([hero().spent, hero().hp, hero().maxHp, hero().mana], [8, 10, 10, 0]);
  assert.equal(createCharacter(base, input('Zero', { forca: 3, habilidade: 3, resistencia: 0, armadura: 2, poderFogo: 0 })).hp, 0);
});
test('rejects incomplete or overspent budgets, fractional attributes, unknown abilities and invalid selections', () => {
  const c = hero(); c.attributes.forca = 2;
  assert.throws(() => createCharacter(base, c), /Distribua/);
  c.attributes.forca = 4; assert.throws(() => createCharacter(base, c), /excedido/);
  c.attributes.forca = 2.5; assert.throws(() => createCharacter(base, c), /inteiro/);
  const d = hero(); d.abilities = ['not-real']; assert.throws(() => createCharacter(base, d), /desconhecida/);
  d.abilities = []; d.fields.perfil = 'invalid'; assert.throws(() => createCharacter(base, d), /Opção inválida/);
});
test('abilities spend the same budget and add declarative attack/defense/test bonuses', () => {
  const c = createCharacter(base, input('Preciso', { forca: 2, habilidade: 2, resistencia: 2, armadura: 1, poderFogo: 0 }, ['precisao']));
  assert.equal(c.spent, 8); assert.equal(c.bonuses.attack, 1);
  const battle = roundInput(); battle.combatants[0] = c;
  const r = simulateRound(base, battle, seq([6, 1, 1, 1, 1, 1]));
  assert.equal(r.events[0].roll.total, 6);
});
test('seeded rounds repeat exactly and input state remains unchanged', () => {
  const battle = roundInput(), before = structuredClone(battle);
  assert.deepEqual(simulateRound(base, battle), simulateRound(base, battle));
  assert.deepEqual(battle, before);
  assert.deepEqual(Array.from({ length: 8 }, seededRng(42)), Array.from({ length: 8 }, seededRng(42)));
});
test('initiative orders actions and attack/defense ties cause zero damage', () => {
  const rules = copy(); rules.combat.initiative = '1d6';
  const battle = roundInput();
  // Equal initiative keeps roster order. Cael attack 5+1 = 6; Lira defense 4+2 = 6.
  const r = simulateRound(rules, battle, seq([3, 3, 1, 2, 1, 1]));
  assert.equal(r.initiative[0].name, 'Cael');
  assert.equal(r.events[0].hit, false); assert.equal(r.events[0].damage, 0); assert.equal(r.events[0].hpAfter, 10);
});
test('lethal damage clamps PV to zero and skips an incapacitated actor', () => {
  const rules = copy(); rules.combat.damage = '100';
  const r = simulateRound(rules, roundInput(), seq([6, 1, 6, 1]));
  assert.equal(r.events[0].hpAfter, 0); assert.equal(r.events[1].kind, 'skipped'); assert.equal(r.winner, 'Cael'); assert.equal(r.finished, true);
  const battle = roundInput(); battle.combatants[1].hp = 0;
  assert.throws(() => simulateRound(base, battle), /encerrado/);
});
test('attribute tests support dynamic attribute and difficulty with no target damage', () => {
  const battle = roundInput();
  battle.choices = [{ actionId: 'attribute_test', attribute: 'forca', difficulty: 7 }, { actionId: 'attribute_test', attribute: 'habilidade', difficulty: 10 }];
  const r = simulateRound(base, battle, seq([6, 1, 4, 1]));
  assert.equal(r.events[0].roll.total, 7); assert.equal(r.events[0].success, true); assert.equal(r.events[1].success, false);
  assert.deepEqual(r.characters.map(c => c.hp), [10, 10]);
});
test('a different JSON changes attributes, point budget, derived PV, actions and fields', () => {
  const rules = { schemaVersion: 1, id: 'custom', name: 'Minimal', version: '1', attributes: [{ id: 'potencia', name: 'Potência', min: 0, max: 6, defaultValue: 0, cost: 2 }], creation: { totalPoints: 6, requireAllPoints: true, fields: [{ id: 'classe', label: 'Classe', type: 'select', required: true, options: ['Robô', 'Piloto'] }] }, resources: { hp: { max: 'actor.potencia * 4' }, mana: { max: '2' } }, abilities: [], actions: [{ id: 'golpe', name: 'Golpe', kind: 'attack', formula: 'actor.potencia + 1d6' }], combat: { initiative: 'actor.potencia', defense: 'target.potencia', damage: 'max(0, attack_total - defense_total)', hitWhen: '>', tieBreak: 'roster_order', critical: false, fumble: false } };
  validateRules(rules);
  const c = createCharacter(rules, { id: 'a', name: 'Robô A', attributes: { potencia: 3 }, abilities: [], fields: { classe: 'Robô' } });
  const d = createCharacter(rules, { ...c, id: 'b', name: 'Robô B' });
  assert.equal(c.hp, 12); assert.equal(c.mana, 2);
  const r = simulateRound(rules, { combatants: [c, d], choices: [{ actionId: 'golpe' }, { actionId: 'golpe' }], mode: 'seeded', seed: 1 });
  assert.equal(r.events.length, 2); assert.ok(r.events[0].damage > 0);
});
test('safe formula parser rejects JavaScript, unknown variables, division by zero and excessive dice', () => {
  assert.equal(evaluate('max(0, 5 - 3) + floor(7 / 2)', {}).total, 5);
  for (const formula of ['process.exit()', 'actor.constructor', '1; globalThis.hacked = 1', '1 / 0', '99d6', '1d1', 'eval(1)', 'actor.missing']) assert.throws(() => evaluate(formula, { actor: {} }));
  const rules = copy(); rules.actions[0].formula = 'actor.unknown + 1d6'; assert.throws(() => validateRules(rules), /desconhecida/);
  rules.actions[0].formula = '1d6'; rules.combat.critical = true; assert.throws(() => validateRules(rules), /crítico/);
});
test('invalid action/choice/seed/HP is rejected before mutating the combat state', () => {
  const battle = roundInput(); battle.seed = -1; assert.throws(() => simulateRound(base, battle), /Semente/);
  battle.seed = 1; battle.combatants[0].hp = 99; assert.throws(() => simulateRound(base, battle), /PV atuais/);
  battle.combatants[0] = hero(); battle.choices[0].actionId = 'unknown'; assert.throws(() => simulateRound(base, battle), /desconhecida/);
});
test('validation rejects variables unavailable in resource and action phases', () => {
  const rules = copy(); rules.resources.hp.max = 'attackBonus + 10'; assert.throws(() => validateRules(rules), /desconhecida/);
  rules.resources.hp.max = 'actor.resistencia * 5'; rules.actions[0].formula = 'attack_total'; assert.throws(() => validateRules(rules), /desconhecida/);
});
