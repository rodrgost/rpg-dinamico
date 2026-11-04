import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './legacy-worker.mjs';
const send = (path, body) => worker.fetch(new Request('https://simulator.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const get = path => worker.fetch(new Request('https://simulator.test' + path));
const rules = await (await get('/rules/3det-adaptavel.json')).json();
const make = (id, stats) => ({ id, name: id, attributes: stats, abilities: [], fields: { perfil: 'Aventureiro' } });
test('page and browser assets are self-contained and all referenced routes work', async () => {
  for (const path of ['/', '/app.js', '/style.css', '/engine.mjs', '/rules/3det-adaptavel.json']) { const response = await get(path); assert.equal(response.status, 200, path); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.ok((await response.text()).length > 500); }
  const page = await (await get('/')).text(); assert.match(page, /lang="pt-BR"/); assert.match(page, /Só você/); assert.match(page, /aria-live/);
});
test('main API flow: load JSON, create two characters, simulate a round, restore and reset PV', async () => {
  assert.equal((await send('/api/rules', { rules })).status, 200);
  const a = await (await send('/api/character', { rules, character: make('Cael', { forca: 3, habilidade: 2, resistencia: 2, armadura: 1, poderFogo: 0 }) })).json();
  const b = await (await send('/api/character', { rules, character: make('Lira', { forca: 0, habilidade: 3, resistencia: 2, armadura: 1, poderFogo: 2 }) })).json();
  assert.equal(a.hp, 10); assert.equal(b.hp, 10);
  const response = await send('/api/round', { rules, combatants: [a, b], choices: [{ actionId: 'attack_melee' }, { actionId: 'attack_ranged' }], mode: 'seeded', seed: 42 });
  assert.equal(response.status, 200); const round = await response.json(); assert.equal(round.events.length, 2); assert.equal(round.initiative.length, 2); assert.ok(round.characters.some(c => c.hp < 10));
  const wounded = round.characters.find(c => c.hp < 10);
  const restored = await (await send('/api/character', { rules, character: wounded, current: true })).json(); assert.equal(restored.hp, wounded.hp);
  const reset = await (await send('/api/character', { rules, character: wounded })).json(); assert.equal(reset.hp, 10);
});
test('invalid JSON, rules and overspent characters return useful errors', async () => {
  const invalid = await send('/api/rules', '{bad'); assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /JSON inválido/);
  const noSchema = await send('/api/rules', { rules: {} }); assert.equal(noSchema.status, 400); assert.match((await noSchema.json()).error, /schemaVersion/);
  const invalidChar = await send('/api/character', { rules, character: make('X', { forca: 5, habilidade: 5, resistencia: 5, armadura: 5, poderFogo: 5 }) }); assert.equal(invalidChar.status, 400); assert.match((await invalidChar.json()).error, /excedido/);
  assert.equal((await get('/missing')).status, 404);
});
test('body size limits and HEAD responses', async () => {
  assert.equal((await send('/api/rules', 'x'.repeat(256001))).status, 413);
  const head = await worker.fetch(new Request('https://simulator.test/', { method: 'HEAD' })); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('world assets and independent JSON API support editing and reject hierarchy errors', async () => {
  for (const path of ['/world.mjs', '/world-ui.mjs', '/worlds/example.json']) assert.equal((await get(path)).status, 200);
  const world = await (await get('/worlds/example.json')).json();
  const valid = await send('/api/world', { world });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).places.length, world.places.length);
  world.places[0].parentId = 'sala-fundos';
  const cyclic = await send('/api/world', { world });
  assert.equal(cyclic.status, 400); assert.match((await cyclic.json()).error, /Ciclo/);
  const invalid = await send('/api/world', { world: { schemaVersion: 1, name: 'X', places: [], items: [] } });
  assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /não suportado/);
});
