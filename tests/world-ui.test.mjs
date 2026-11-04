import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './legacy-worker.mjs';
const storageKey = '3det-adaptavel-worlds-v2';

test('UI workflow: create, edit, move, delete/undo, import/apply, reload and escape content', async () => {
  // Event harness checks UI state and requests, not browser rendering or layout.
  const handlers = new Map(), nodes = new Map(), stored = new Map([['3det-adaptavel-session-v1', 'combat-session-untouched']]);
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { addEventListener(type, fn) { handlers.set(selector + ':' + type, [fn]); }, focus() {}, click() {}, innerHTML: '' });
    return nodes.get(selector);
  };
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.document = { addEventListener(type, fn) { handlers.set(type, [...(handlers.get(type) || []), fn]); }, querySelector: node };
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  globalThis.fetch = (path, init = {}) => worker.fetch(new Request('https://simulator.test' + path, init));
  let ui, markup = '', render = () => { markup = ui.html(); };
  const dispatch = async (type, target) => { for (const fn of handlers.get(type) || []) await fn({ target, preventDefault() {} }); };
  const click = async dataset => { const button = { dataset, disabled: false }; await dispatch('click', { closest: () => button }); };
  const input = async (field, value) => dispatch('input', { id: '', dataset: { worldField: field }, value });
  const collection = () => JSON.parse(stored.get(storageKey));
  const snapshot = () => { const data = collection(); return data.worlds.find(entry => entry.id === data.activeWorldId).world; };
  try {
    const source = (await readFile(new URL('../src/world-ui.mjs', import.meta.url), 'utf8')).replace("from '/world.mjs'", 'from ' + JSON.stringify(new URL('../src/world.mjs', import.meta.url).href));
    const { createWorldUI } = await import('data:text/javascript;base64,' + Buffer.from(source.replace("from '/npc-ui.mjs'", 'from ' + JSON.stringify(new URL('../src/npc-ui.mjs', import.meta.url).href))).toString('base64'));
    ui = createWorldUI({ render, toast() {} }); await ui.init(); render();
    const exampleCount = snapshot().places.length;
    assert.match(markup, /Mundo de Arvandor/);
    await click({ environmentOpen: collection().activeWorldId });
    assert.match(markup, /Porto Aurora/);
    await click({ worldSelect: 'porto-aurora' });
    await click({ worldAction: 'new-child' });
    await input('id', 'observatorio'); await input('name', '<img src=x onerror=alert(1)>'); await input('type', 'Observatório'); await input('description', 'Perto do cais');
    await dispatch('submit', { id: 'place-form' });
    assert.equal(snapshot().places.find(p => p.id === 'observatorio').parentId, 'porto-aurora');
    assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.doesNotMatch(markup, /<img src=x/);
    await click({ worldAction: 'edit' });
    assert.doesNotMatch(markup, /<option value="observatorio"/);
    await input('parentId', 'sala-fundos'); await dispatch('submit', { id: 'place-form' });
    assert.equal(snapshot().places.find(p => p.id === 'observatorio').parentId, 'sala-fundos');
    await click({ worldSelect: 'mercado' }); await click({ worldAction: 'edit' });
    assert.doesNotMatch(markup, /<option value="(?:mercado|sala-fundos|observatorio)"/);
    await click({ worldAction: 'cancel' }); await click({ worldSelect: 'observatorio' });
    await click({ worldAction: 'delete' }); assert.equal(snapshot().places.length, exampleCount);
    await click({ worldAction: 'undo' }); assert.equal(snapshot().places.length, exampleCount + 1);
    const before = stored.get(storageKey);
    await click({ worldAction: 'json' });
    await dispatch('input', { id: 'world-json', dataset: {}, value: '{bad' });
    await click({ worldAction: 'apply' }); assert.match(markup, /JSON inválido/); assert.equal(stored.get(storageKey), before);
    const replacement = { schemaVersion: 1, name: 'Nave', places: [{ id: 'nave', parentId: null, name: 'Aurora', type: 'Nave', details: {} }] };
    const fileTarget = { files: [{ size: 500, text: async () => JSON.stringify(replacement) }], value: 'file' };
    await dispatch('#world-file:change', fileTarget); assert.equal(fileTarget.value, '');
    await click({ worldAction: 'apply' }); assert.match(markup, /Confirmar substituição/); assert.equal(snapshot().places.length, exampleCount + 1);
    await click({ worldAction: 'replace' }); assert.equal(snapshot().places.length, 1);
    assert.equal(stored.get('3det-adaptavel-session-v1'), 'combat-session-untouched');
    // A second environment starts empty and edits never affect the first one.
    const firstId = collection().activeWorldId;
    const firstWorld = structuredClone(snapshot());
    await click({ worldAction: 'list' }); assert.match(markup, /Abrir lugares/);
    await click({ worldAction: 'new-environment' });
    await dispatch('input', { id: 'environment-name', dataset: { environmentField: 'name' }, value: 'Reino Novo' });
    await dispatch('input', { id: 'environment-description', dataset: { environmentField: 'description' }, value: 'Segundo cenário' });
    await dispatch('submit', { id: 'environment-form' });
    assert.equal(collection().worlds.length, 2); assert.equal(snapshot().places.length, 0);
    const secondId = collection().activeWorldId;
    await click({ worldAction: 'new-root' }); await input('id', 'nave'); await input('name', 'Mesmo ID, outro lugar'); await input('type', 'Cidade');
    await dispatch('submit', { id: 'place-form' });
    assert.equal(snapshot().places.length, 1);
    assert.deepEqual(collection().worlds.find(entry => entry.id === firstId).world, firstWorld);
    await click({ worldAction: 'list' }); await click({ environmentEdit: secondId });
    await dispatch('input', { id: 'environment-name', dataset: { environmentField: 'name' }, value: 'Reino Editado' });
    await dispatch('submit', { id: 'environment-form' });
    assert.equal(snapshot().name, 'Reino Editado'); assert.equal(snapshot().places.length, 1);
    await click({ environmentOpen: firstId }); assert.deepEqual(snapshot(), firstWorld);
    // Import-as-new adds a third environment, including when place IDs overlap.
    await click({ worldAction: 'list' }); await click({ worldAction: 'new-json' });
    await dispatch('#world-file:change', { files: [{ size: 500, text: async () => JSON.stringify({ ...replacement, name: 'Terceiro cenário' }) }], value: 'file' });
    await click({ worldAction: 'apply' }); assert.match(markup, /Adicionar cenário/);
    assert.equal(collection().worlds.length, 2);
    await click({ worldAction: 'replace' }); assert.equal(collection().worlds.length, 3);
    assert.deepEqual(collection().worlds.find(entry => entry.id === firstId).world, firstWorld);
    assert.equal(collection().worlds.find(entry => entry.id === secondId).world.name, 'Reino Editado');
    // Replace only this third environment, preserving its siblings.
    await click({ worldAction: 'json' });
    await dispatch('input', { id: 'world-json', dataset: {}, value: JSON.stringify({ schemaVersion: 1, name: 'Terceiro substituído', places: [] }) });
    await click({ worldAction: 'apply' }); await click({ worldAction: 'replace' });
    assert.equal(collection().worlds.length, 3); assert.equal(snapshot().places.length, 0);
    assert.deepEqual(collection().worlds.find(entry => entry.id === firstId).world, firstWorld);
    assert.equal(stored.get('3det-adaptavel-session-v1'), 'combat-session-untouched');
    const restored = createWorldUI({ render() {}, toast() {} }); await restored.init();
    assert.match(restored.html(), /Reino Editado/); assert.match(restored.html(), /Terceiro substituído/); assert.match(restored.html(), /Nave/);
  } finally { Object.assign(globalThis, originals); }
});


test('existing single-world storage migrates once without altering its places or combat', async () => {
  const legacyWorld = JSON.parse(await readFile(new URL('./fixtures/porto-aurora.json', import.meta.url), 'utf8'));
  legacyWorld.name = 'Meu cenário existente'; legacyWorld.places[0].description = 'Texto preservado';
  const legacy = JSON.stringify({ world: legacyWorld, selectedId: 'sala-fundos' });
  const stored = new Map([['3det-adaptavel-world-v1', legacy], ['3det-adaptavel-session-v1', 'combat']]);
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.document = { addEventListener() {}, querySelector: () => ({ addEventListener() {} }) };
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  globalThis.fetch = () => { throw new Error('Migration should not fetch the example'); };
  try {
    const source = (await readFile(new URL('../src/world-ui.mjs', import.meta.url), 'utf8')).replace("from '/world.mjs'", 'from ' + JSON.stringify(new URL('../src/world.mjs', import.meta.url).href));
    const { createWorldUI } = await import('data:text/javascript;base64,' + Buffer.from(source.replace("from '/npc-ui.mjs'", 'from ' + JSON.stringify(new URL('../src/npc-ui.mjs', import.meta.url).href))).toString('base64'));
    const ui = createWorldUI({ render() {}, toast() {} }); await ui.init();
    let data = JSON.parse(stored.get(storageKey));
    assert.equal(data.worlds.length, 1); assert.deepEqual(data.worlds[0].world, legacyWorld); assert.equal(data.worlds[0].selectedId, 'sala-fundos');
    const restored = createWorldUI({ render() {}, toast() {} }); await restored.init();
    data = JSON.parse(stored.get(storageKey)); assert.equal(data.worlds.length, 1);
    assert.match(restored.html(), /Meu cenário existente/);
    assert.equal(stored.get('3det-adaptavel-world-v1'), legacy); assert.equal(stored.get('3det-adaptavel-session-v1'), 'combat');
  } finally { Object.assign(globalThis, originals); }
});
