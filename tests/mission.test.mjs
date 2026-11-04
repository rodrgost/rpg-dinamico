import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVE_TYPES, validateMissionDocument, validateMission, missionProgress, assertMissionLocations, createMissionTemplate, missionLLMPrompt, pendingDependencies } from '../src/mission.mjs';
import worker from './legacy-worker.mjs';
const environments = [{ id: 'reino', name: 'Reino', places: [{ id: 'praca', name: 'Praça' }] }, { id: 'nave', name: 'Nave', places: [{ id: 'ponte', name: 'Ponte' }] }];
const fresh = () => ({ schemaVersion: 1, id: 'missao-1', environmentId: 'reino', name: 'Pedido de ajuda', description: 'Uma missão adaptável.', objectives: OBJECTIVE_TYPES.map(t => ({ id: 'objetivo-' + t.id, type: t.id, title: t.name, description: '', target: '', placeId: null, completionCriteria: 'Condição acordada na mesa.', status: 'pending' })) });

test('mission requires an existing environment; environment renames do not change references', () => {
  const mission = fresh();
  assert.throws(() => validateMission({ ...mission, environmentId: '' }, environments), /Cenário obrigatório/);
  assert.throws(() => validateMission({ ...mission, environmentId: 'missing' }, environments), /Cenário não encontrado/);
  assert.throws(() => validateMission(mission, []), /Cenário não encontrado/);
  assert.equal(validateMission(mission, [{ ...environments[0], name: 'Novo nome' }]).environmentId, 'reino');
});
test('all objective types are generic, portable JSON and independent of combat rules', () => {
  const mission = validateMission(fresh(), environments);
  assert.equal(mission.objectives.length, 6);
  assert.deepEqual(validateMission(JSON.parse(JSON.stringify(mission)), environments), mission);
  const spaceMission = { ...mission, environmentId: 'nave' };
  assert.equal(validateMission(spaceMission, environments).environmentId, 'nave');
  assert.equal(validateMission({ ...mission, environmentId: 'empty' }, [{ id: 'empty', places: [] }]).objectives.length, 6);
});
test('optional places must exist in the mission environment, even when IDs exist elsewhere', () => {
  const mission = fresh(); mission.objectives[0].placeId = 'ponte';
  assert.throws(() => validateMission(mission, environments), /não pertence/);
  mission.objectives[0].placeId = 'praca'; assert.equal(validateMission(mission, environments).objectives[0].placeId, 'praca');
  assert.throws(() => validateMission({ ...mission, environmentId: 'nave' }, environments), /não pertence/);
});
test('mission rejects empty objectives, duplicate IDs, invalid type/status and unknown fields', () => {
  assert.throws(() => validateMissionDocument({ ...fresh(), objectives: [] }), /1 a 50/);
  const mission = fresh(); mission.objectives.push(structuredClone(mission.objectives[0]));
  assert.throws(() => validateMissionDocument(mission), /duplicado/);
  for (const patch of [{ title: '   ' }, { type: 'invalid' }, { status: 'invalid' }, { action: 'unimplemented' }]) {
    const candidate = fresh(); Object.assign(candidate.objectives[0], patch); assert.throws(() => validateMissionDocument(candidate));
  }
  assert.throws(() => validateMissionDocument({ ...fresh(), rewards: [] }), /não suportado/);
});
test('manual progress is derived from objectives and reopening one reopens the mission', () => {
  const m = fresh(); assert.deepEqual(missionProgress(m), { completed: 0, total: 6, percent: 0, status: 'pending' });
  m.objectives[0].status = 'in_progress'; assert.equal(missionProgress(m).status, 'in_progress');
  m.objectives.forEach(o => { o.status = 'completed'; }); assert.equal(missionProgress(m).status, 'completed');
  m.objectives[0].status = 'pending'; assert.equal(missionProgress(m).status, 'in_progress'); assert.equal(missionProgress(m).completed, 5);
});
test('environment edits protect referenced places but permit renames, moves and unreferenced deletions', () => {
  const m = fresh(); m.objectives[0].placeId = 'praca';
  assert.throws(() => assertMissionLocations([m], 'reino', { places: [] }), /Pedido de ajuda/);
  assert.doesNotThrow(() => assertMissionLocations([m], 'nave', { places: [] }));
  assert.doesNotThrow(() => assertMissionLocations([m], 'reino', { places: [{ id: 'praca', name: 'Renomeada', parentId: 'castelo' }] }));
  m.objectives[0].placeId = null; assert.doesNotThrow(() => assertMissionLocations([m], 'reino', { places: [] }));
});
test('mission server API validates references and exposes independent browser modules', async () => {
  for (const asset of ['/mission.mjs', '/mission-ui.mjs']) assert.equal((await worker.fetch(new Request('https://simulator.test' + asset))).status, 200);
  const post = mission => worker.fetch(new Request('https://simulator.test/api/mission', { method: 'POST', body: JSON.stringify({ mission, environments }) }));
  const response = await post(fresh()); assert.equal(response.status, 200); assert.equal((await response.json()).environmentId, 'reino');
  const failed = await post({ ...fresh(), environmentId: 'missing' }); assert.equal(failed.status, 400); assert.match((await failed.json()).error, /Cenário não encontrado/);
});

test('complete generated model covers all objective types, alternatives and dependencies with valid environment references', () => {
  for (const environment of [...environments, { id: 'empty', name: 'Vazio', places: [] }]) {
    const model = createMissionTemplate(environment);
    assert.deepEqual(validateMission(model, [environment]), model);
    assert.deepEqual(new Set(model.objectives.map(o => o.type)), new Set(OBJECTIVE_TYPES.map(t => t.id)));
    assert.equal(model.objectives[0].alternatives.length, 3);
    assert.ok(model.objectives.some(o => o.dependsOn.length === 0));
    assert.ok(model.objectives.some(o => o.dependsOn.length === 1));
    assert.ok(model.objectives.some(o => o.dependsOn.length === 2));
    const prompt = missionLLMPrompt(environment);
    assert.ok(prompt.includes(JSON.stringify(model, null, 2)));
    assert.match(prompt, /Retorne SOMENTE um objeto JSON válido/);
    assert.match(prompt, /Todos os objetivos são obrigatórios/);
  }
});
test('dependencies reject self references, cycles, missing and repeated IDs, without imposing list order', () => {
  const model = createMissionTemplate(environments[0]);
  for (const deps of [['proteger-acesso'], ['missing'], ['obter-registro', 'obter-registro']]) {
    const m = structuredClone(model); m.objectives[0].dependsOn = deps; assert.throws(() => validateMissionDocument(m));
  }
  const circular = structuredClone(model); circular.objectives[2].dependsOn = ['investigar-origem'];
  assert.throws(() => validateMissionDocument(circular), /Ciclo/);
  const reversed = { ...model, objectives: [...model.objectives].reverse() };
  assert.equal(validateMissionDocument(reversed).objectives[0].id, 'registrar-solucao');
});
test('dependent objectives only start after all prerequisites and reopening prerequisites cannot invalidate completed work', () => {
  const m = createMissionTemplate(environments[0]);
  const dependent = m.objectives.find(o => o.id === 'investigar-origem'), prerequisite = m.objectives.find(o => o.id === 'obter-registro');
  assert.equal(pendingDependencies(m, dependent).length, 1);
  dependent.status = 'in_progress'; assert.throws(() => validateMissionDocument(m), /exige/);
  prerequisite.status = 'completed'; assert.doesNotThrow(() => validateMissionDocument(m));
  prerequisite.status = 'pending'; assert.throws(() => validateMissionDocument(m), /pré-requisito/);
  const last = m.objectives.at(-1); assert.equal(pendingDependencies(m, last).length, 2);
});
test('one realized alternative completes its objective, with ID and location validation', () => {
  const m = createMissionTemplate(environments[0]), o = m.objectives[0];
  o.status = 'completed'; assert.throws(() => validateMission(m, environments), /escolha a alternativa/);
  o.completedAlternativeId = 'negociar'; assert.equal(validateMission(m, environments).objectives[0].status, 'completed');
  assert.equal(missionProgress(m).completed, 1);
  o.completedAlternativeId = 'missing'; assert.throws(() => validateMissionDocument(m), /completedAlternativeId/);
  o.completedAlternativeId = 'negociar'; o.alternatives[0].placeId = 'ponte'; assert.throws(() => validateMission(m, environments), /não pertence/);
  o.placeId = null; o.alternatives[0].placeId = 'praca'; assert.throws(() => assertMissionLocations([m], 'reino', { places: [] }), /alternativa|lugar inicial/);
  o.alternatives.push(structuredClone(o.alternatives[0])); assert.throws(() => validateMissionDocument(m), /duplicado/);
});
test('existing missions remain valid and preserve completion with absent branching fields', () => {
  const old = fresh(); old.objectives[0].status = 'completed';
  const normalized = validateMissionDocument(old);
  assert.equal(normalized.objectives[0].status, 'completed');
  assert.deepEqual(normalized.objectives[0].dependsOn, []); assert.deepEqual(normalized.objectives[0].alternatives, []); assert.equal(normalized.objectives[0].completedAlternativeId, null);
});

test('Porto Aurora default spans all city places, has 24 mandatory objectives and can complete in free order through peaceful alternatives', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createPortoAuroraMission, supportsPortoAuroraMission } = await import('../src/mission.mjs');
  const world = JSON.parse(await readFile(new URL('./fixtures/porto-aurora.json',import.meta.url),'utf8'));
  const env = {id:'real-environment-id',...world};
  assert.equal(supportsPortoAuroraMission(env),true);
  const m = createPortoAuroraMission(env);
  assert.equal(m.environmentId,env.id);assert.equal(m.objectives.length,24);
  assert.equal(m.objectives.filter(o => !o.dependsOn.length).length,18);
  assert.equal(m.objectives.filter(o => o.alternatives.length).length,3);
  assert.deepEqual(new Set(m.objectives.map(o => o.type)),new Set(OBJECTIVE_TYPES.map(t => t.id)));
  assert.ok(m.objectives.every(o => o.status === 'pending' && o.completedAlternativeId === null));
  for (const p of world.places.filter(p => p.parentId === 'porto-aurora')) assert.ok(m.objectives.some(o => o.placeId === p.id),p.name);
  assert.ok(m.objectives.some(o => o.placeId === 'sala-fundos'));
  assert.deepEqual(createMissionTemplate(env,'portable-id'),{...m,id:'portable-id'});
  assert.match(missionLLMPrompt(env),/Noite das Marés/);
  const progress = structuredClone(m);
  for (let i=0;i<24;i++) {
    const next = [...progress.objectives].reverse().find(o => o.status !== 'completed' && o.dependsOn.every(id => progress.objectives.find(p => p.id === id).status === 'completed'));
    assert.ok(next,'there must be an achievable next objective');
    if (next.alternatives.length) next.completedAlternativeId = next.alternatives.find(a => a.type !== 'combat').id;
    next.status = 'completed';validateMission(progress,[env]);
  }
  assert.equal(missionProgress(progress).status,'completed');
  assert.equal(m.objectives[0].status,'pending');
  const bad = {...env,places:env.places.filter(p => p.id !== 'farol')};
  assert.equal(supportsPortoAuroraMission(bad),false);assert.throws(() => createPortoAuroraMission(bad),/cenário atualizado/);
  const moved = structuredClone(env);moved.places.find(p => p.id === 'farol').parentId='eldoria';assert.equal(supportsPortoAuroraMission(moved),false);
});
