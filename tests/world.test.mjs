import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWorld, savePlace, removePlace, ancestors, descendants } from '../src/world.mjs';
const example = JSON.parse(await readFile(new URL('./fixtures/porto-aurora.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(example);

test('world round-trip keeps generic hierarchy and descriptive details', () => {
  const world = validateWorld(JSON.parse(JSON.stringify(example)));
  assert.deepEqual(ancestors(world, 'sala-fundos').map(p => p.type), ['Planeta', 'País', 'Cidade', 'Estabelecimento', 'Sala']);
  assert.equal(world.places.find(p => p.id === 'porto-aurora').details.populacao, 12000);
  assert.equal(descendants(world, 'arvandor').size, example.places.length - 1);
});
test('create a root and child, then move an entire branch without losing descriptions', () => {
  let world = savePlace(fresh(), { id: 'nave', parentId: null, name: 'Nave Aurora', type: 'Nave', description: 'Uma estação móvel.', details: {} });
  world = savePlace(world, { id: 'ponte', parentId: 'nave', name: 'Ponte', type: 'Compartimento', details: { gravidade: 'Artificial' } });
  const market = { ...world.places.find(p => p.id === 'mercado'), parentId: 'ponte' };
  world = savePlace(world, market, market.id);
  assert.deepEqual(ancestors(world, 'sala-fundos').map(p => p.id), ['nave', 'ponte', 'mercado', 'sala-fundos']);
  assert.equal(world.places.find(p => p.id === 'mercado').description, market.description);
  assert.equal(example.places.length, 16);
});
test('reject self parenting, descendant parenting, duplicate IDs and missing parents', () => {
  for (const parentId of ['arvandor', 'sala-fundos', 'missing']) {
    const world = fresh(); world.places[0].parentId = parentId;
    assert.throws(() => validateWorld(world), /Ciclo|inexistente/);
  }
  const world = fresh(); world.places.push({ ...world.places[0] });
  assert.throws(() => validateWorld(world), /duplicado/);
  assert.throws(() => savePlace(fresh(), { ...example.places[0], id: 'changed' }, 'arvandor'), /preservado/);
});
test('deletion protects nested places; leaves can be removed', () => {
  assert.throws(() => removePlace(fresh(), 'mercado'), /internos|NPCs/);
  const world = removePlace(fresh(), 'sala-fundos');
  assert.equal(world.places.length, example.places.length - 1);
  assert.equal(world.places.some(p => p.id === 'mercado'), true);
  assert.throws(() => removePlace(world, 'missing'), /encontrado/);
});
test('world format accepts empty worlds and arbitrary place types; excludes other domains', () => {
  assert.deepEqual(validateWorld({ schemaVersion: 1, name: 'Vazio', places: [] }).places, []);
  for (const key of ['items', 'inventory', 'missions', 'rewards']) {
    assert.throws(() => validateWorld({ ...fresh(), [key]: [] }), /não suportado/);
    const world = fresh(); world.places[0][key] = [];
    assert.throws(() => validateWorld(world), /não suportado/);
  }
  for (const invalid of [null, [], {}, { ...fresh(), schemaVersion: 2 }]) assert.throws(() => validateWorld(invalid));
});
test('world size, depth and details limits return validation errors', () => {
  const tooDeep = { schemaVersion: 1, name: 'Profundo', places: Array.from({ length: 65 }, (_, i) => ({ id: 'p' + i, parentId: i ? 'p' + (i - 1) : null, name: 'Lugar', type: 'Espaço' })) };
  assert.throws(() => validateWorld(tooDeep), /64 níveis/);
  const world = fresh(); world.places[0].details = [];
  assert.throws(() => validateWorld(world), /objeto JSON/);
  const big = { schemaVersion: 1, name: 'Grande', places: Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, parentId: null, name: 'Lugar', type: 'Espaço', description: 'á'.repeat(5000) })) };
  assert.throws(() => validateWorld(big), /240 KB/);
});

test('coordinates are relative to the parent, optional as a pair and bounded; JSON round-trip preserves zero and 100', () => {
  const world = fresh(); world.places[0].x = 0; world.places[0].y = 100;
  world.places[1].x = 0; world.places[1].y = 100;
  const next = validateWorld(world);
  assert.equal(next.places[0].x, 0); assert.equal(next.places[0].y, 100);
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(next))),next);
  assert.equal(ancestors(next,'sala-fundos').length,5);
  for (const [x,y] of [[-1,50],[101,0],[5,null],[null,5],['5',50],[NaN,30],[Infinity,30]]) {
    const bad = fresh();bad.places[0].x=x;bad.places[0].y=y;assert.throws(() => validateWorld(bad),/X|Posição/);
  }
  const old = fresh();delete old.places[0].x;delete old.places[0].y;
  assert.equal(validateWorld(old).places[0].x,null);
  assert.equal(validateWorld(old).places[0].y,null);
});
