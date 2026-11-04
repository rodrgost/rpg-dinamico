import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './legacy-worker.mjs';
import { validateMission } from '../src/mission.mjs';
const WORLD_KEY = '3det-adaptavel-worlds-v2', KEY = '3det-adaptavel-missions-v1';
async function moduleFrom(path, dependency) {
  let source = await readFile(new URL('../src/' + path, import.meta.url), 'utf8');
  source = source.replace("from '/" + dependency + "'", 'from ' + JSON.stringify(new URL('../src/' + dependency, import.meta.url).href));
  return import('data:text/javascript;base64,' + Buffer.from(source.replace("from '/npc-ui.mjs'", 'from ' + JSON.stringify(new URL('../src/npc-ui.mjs', import.meta.url).href))).toString('base64'));
}
function harness(initial = []) {
  const handlers = new Map(), nodes = new Map(), stored = new Map(initial), notices = [], downloads = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { clicks: 0, addEventListener(type, fn) { handlers.set(selector + ':' + type, [fn]); }, focus() {}, click() { this.clicks++; }, remove() {}, innerHTML: '' });
    return nodes.get(selector);
  };
  const original = { document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.document = { addEventListener(type, fn) { handlers.set(type, [...(handlers.get(type) || []), fn]); }, querySelector: node, createElement: () => ({ click() { downloads.push({ href: this.href, filename: this.download }); } }) };
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  globalThis.fetch = (path, init = {}) => worker.fetch(new Request('https://simulator.test' + path, init));
  const dispatch = async (type, target) => { for (const fn of handlers.get(type) || []) await fn({ target, preventDefault() {} }); };
  return { stored, notices, node, dispatch, downloads, readDownload: async index => (await original.fetch(downloads[index].href)).text(), toast: (...args) => notices.push(args), click: dataset => dispatch('click', { closest: () => ({ dataset, disabled: false }) }), input: (dataset, value, id = '') => dispatch('input', { id, dataset, value }), change: (dataset, value, id = '') => dispatch('change', { id, dataset, value }), restore: () => Object.assign(globalThis, original) };
}

test('UI integration: create/edit mission, multiple objectives, immutable template, JSON import, persistence and location protection', async () => {
  // Exercises the actual event handlers and Worker API; does not claim a browser layout check.
  const h = harness([['3det-adaptavel-session-v1', 'combat-preserved']]);
  try {
    const { createWorldUI } = await moduleFrom('world-ui.mjs', 'world.mjs');
    const { createMissionUI } = await moduleFrom('mission-ui.mjs', 'mission.mjs');
    let missionUI, markup = '', worldMarkup = '';
    const render = () => { if (missionUI) markup = missionUI.html(); worldMarkup = worldUI.html(); };
    const worldUI = createWorldUI({ render, toast: h.toast, beforeWorldChange: (id, next) => missionUI?.assertEnvironmentChange(id, next) });
    missionUI = createMissionUI({ render, toast: h.toast, getEnvironments: worldUI.getEnvironments, getActiveEnvironmentId: worldUI.getActiveEnvironmentId });
    await worldUI.init(); missionUI.init(); render();
    const firstWorldId = worldUI.getActiveEnvironmentId(), originalWorlds = h.stored.get(WORLD_KEY);
    const saved = () => JSON.parse(h.stored.get(KEY)).missions;
    assert.match(markup, /Criar primeira missão/);
    await h.click({ missionAction: 'new' });await h.dispatch('change',{dataset:{formulaMode:''},checked:false});
    await h.input({ missionField: 'name' }, '<script>Pedido</script>');
    await h.input({ missionField: 'description' }, 'Uma missão no cenário.');
    const firstObjective = markup.match(/data-objective-id="([^"]+)"/)[1];
    await h.input({ objectiveId: firstObjective, objectiveField: 'title' }, 'Defender o mercado');
    await h.input({ objectiveId: firstObjective, objectiveField: 'target' }, 'Grupo de invasores');
    await h.input({ objectiveId: firstObjective, objectiveField: 'completionCriteria' }, 'Proteger todos os presentes.');
    await h.change({ objectiveId: firstObjective, objectiveField: 'placeId' }, 'sala-fundos');
    await h.click({ missionAction: 'add-objective' });
    const objectiveIds = [...new Set([...markup.matchAll(/data-objective-id="([^"]+)"/g)].map(m => m[1]))];
    const secondObjective = objectiveIds[1];
    await h.change({ objectiveId: secondObjective, objectiveField: 'type' }, 'investigate');
    await h.input({ objectiveId: secondObjective, objectiveField: 'title' }, 'Investigar a origem');
    await h.dispatch('submit', { id: 'mission-form' });
    assert.equal(saved().length, 1); assert.equal(saved()[0].environmentId, firstWorldId); assert.equal(saved()[0].objectives.length, 2);
    assert.match(markup, /&lt;script&gt;Pedido&lt;\/script&gt;/); assert.doesNotMatch(markup, /<script>Pedido/);
    assert.equal(h.stored.get(WORLD_KEY), originalWorlds); assert.equal(h.stored.get('3det-adaptavel-session-v1'), 'combat-preserved');
    const missionId = saved()[0].id;
    await h.change({ objectiveStatus: firstObjective }, 'completed'); await h.change({ objectiveStatus: secondObjective }, 'completed');
    assert.match(markup, /Progresso em Aventuras/); assert.equal(saved()[0].objectives[0].status, 'pending');
    assert.doesNotMatch(markup, /data-objective-status=/);
    // Editing a linked environment may not remove the referenced leaf.
    await h.click({ environmentOpen: firstWorldId }); await h.click({ worldSelect: 'sala-fundos' });
    await h.click({ worldAction: 'delete' });
    assert.ok(worldUI.getEnvironments()[0].places.some(p => p.id === 'sala-fundos'));
    assert.match(h.notices.at(-1)[0], /é usado pelo objetivo/);
    // Replacing environment JSON also respects mission references.
    await h.click({ worldAction: 'json' });
    await h.input({}, JSON.stringify({ schemaVersion: 1, name: 'Substituição vazia', places: [] }), 'world-json');
    await h.click({ worldAction: 'apply' }); await h.click({ worldAction: 'replace' });
    assert.ok(worldUI.getEnvironments()[0].places.some(p => p.id === 'sala-fundos'));
    // Create an independent environment; editing mission clears location references explicitly.
    await h.click({ worldAction: 'list' }); await h.click({ worldAction: 'new-environment' });
    await h.input({ environmentField: 'name' }, 'Estação espacial'); await h.dispatch('submit', { id: 'environment-form' });
    const secondWorldId = worldUI.getActiveEnvironmentId();
    await h.click({ missionEdit: missionId });
    await h.change({}, secondWorldId, 'mission-environment');
    await h.dispatch('submit', { id: 'mission-form' });
    assert.equal(saved()[0].environmentId, secondWorldId); assert.equal(saved()[0].objectives[0].placeId, null);
    await h.click({ environmentOpen: firstWorldId }); await h.click({ worldSelect: 'sala-fundos' }); await h.click({ worldAction: 'delete' });
    assert.equal(worldUI.getEnvironments().find(e => e.id === firstWorldId).places.some(p => p.id === 'sala-fundos'), false);
    // Import creates a new entity even when the JSON ID matches an existing mission.
    const beforeImport = structuredClone(saved()[0]);
    await h.click({ missionAction: 'list' }); await h.click({ missionAction: 'import' });
    await h.input({}, '{bad', 'mission-json'); await h.click({ missionAction: 'validate-json' }); assert.match(markup, /JSON inválido/); assert.equal(saved().length, 1);
    const portable = { ...beforeImport, environmentId: 'unknown-environment', name: 'Missão importada' };
    await h.dispatch('#mission-file:change', { files: [{ size: 500, text: async () => JSON.stringify(portable) }], value: 'file' });
    await h.click({ missionAction: 'validate-json' }); assert.match(markup, /Cenário não encontrado/);
    await h.change({}, secondWorldId, 'mission-json-environment'); await h.click({ missionAction: 'validate-json' });
    assert.match(markup, /Adicionar como nova missão/); assert.equal(saved().length, 1);
    await h.click({ missionAction: 'apply-import' }); assert.equal(saved().length, 2); assert.notEqual(saved()[0].id, saved()[1].id); assert.deepEqual(saved()[0], beforeImport);
    // Edit only the selected imported mission through JSON; invalid edits never persist.
    await h.click({ missionAction: 'json' }); const updated = { ...saved()[1], name: 'Missão editada via JSON' };
    await h.input({}, JSON.stringify(updated), 'mission-json'); await h.click({ missionAction: 'validate-json' }); await h.click({ missionAction: 'apply-import' });
    assert.equal(saved()[1].name, updated.name); assert.deepEqual(saved()[0], beforeImport);
    await h.click({ missionAction: 'list' });assert.match(markup,/data-mission-delete=/);await h.click({ missionDelete: missionId }); assert.equal(saved().length, 1); await h.click({ missionAction: 'undo' }); assert.equal(saved().length, 2);
    const restored = createMissionUI({ render() {}, toast: h.toast, getEnvironments: worldUI.getEnvironments, getActiveEnvironmentId: worldUI.getActiveEnvironmentId });
    restored.init(); assert.match(restored.html(), /Missão editada via JSON/); assert.match(restored.html(), /Estação espacial/);
    assert.equal(h.stored.get('3det-adaptavel-session-v1'), 'combat-preserved');
  } finally { h.restore(); }
});

test('no environment blocks mission creation; corrupt saved collection is preserved', async () => {
  const h = harness();
  try {
    const { createMissionUI } = await moduleFrom('mission-ui.mjs', 'mission.mjs');
    let ui, markup = '';
    ui = createMissionUI({ render: () => { markup = ui.html(); }, toast: h.toast, getEnvironments: () => [], getActiveEnvironmentId: () => null });
    ui.init(); markup = ui.html(); assert.match(markup, /data-mission-action="new" disabled/);
    await h.click({ missionAction: 'new' });await h.dispatch('change',{dataset:{formulaMode:''},checked:false}); assert.match(markup, /Crie um cenário/); assert.equal(h.stored.has(KEY), false);
    h.stored.set(KEY, '{broken');
    const broken = createMissionUI({ render() {}, toast: h.toast, getEnvironments: () => [], getActiveEnvironmentId: () => null });
    broken.init(); assert.match(broken.html(), /cópia existente foi preservada/); assert.equal(h.stored.get(KEY), '{broken');
  } finally { h.restore(); }
});

test('LLM workflow: download contextual complete model, open file picker directly, import and keep progress in adventures', async () => {
  const h = harness();
  try {
    const { createMissionUI } = await moduleFrom('mission-ui.mjs', 'mission.mjs');
    const envs = [{ id: 'world-1', name: 'Reino', places: [] }, { id: 'world-2', name: 'Estação Aurora', description: 'Um posto científico distante.', places: [{ id: 'lab', name: 'Laboratório', description: 'Pesquisa biológica', details: { gravidade: 'Reduzida' } }] }];
    let ui, markup = '';
    const render = () => { markup = ui.html(); };
    ui = createMissionUI({ render, toast: h.toast, getEnvironments: () => envs, getActiveEnvironmentId: () => envs[0].id });
    ui.init(); render(); assert.match(markup, /Importar JSON/); assert.match(markup, /Colar JSON/); assert.match(markup, /Modelo para outro LLM/);
    await h.click({ missionAction: 'guide' }); await h.change({}, 'world-2', 'mission-model-environment');
    assert.match(markup, /Baixar modelo .json/); assert.match(markup, /Copiar instruções completas/);
    await h.click({ missionAction: 'download-model' }); await h.click({ missionAction: 'download-prompt' });
    assert.equal(h.downloads[0].filename, 'missao-modelo-completo.json'); assert.equal(h.downloads[1].filename, 'instrucoes-missao-llm.txt');
    const raw = await h.readDownload(0), model = JSON.parse(raw), prompt = await h.readDownload(1);
    assert.equal(model.environmentId, 'world-2'); assert.deepEqual(validateMission(model, envs), model);
    assert.match(prompt, /Pesquisa biológica/); assert.match(prompt, /Reduzida/); assert.match(prompt, /completedAlternativeId/);
    await h.click({ missionAction: 'import' }); assert.equal(h.node('#mission-file').clicks, 1);
    await h.dispatch('#mission-file:change', { files: [{ size: raw.length, text: async () => raw }], value: 'file' });
    await h.click({ missionAction: 'validate-json' }); assert.match(markup, /Adicionar como nova missão/);
    await h.click({ missionAction: 'apply-import' });
    const saved = () => JSON.parse(h.stored.get(KEY)).missions[0];
    assert.equal(saved().environmentId, 'world-2'); assert.equal(saved().objectives.length, 6);
    assert.match(markup, /Aguardando:/); assert.match(markup, /Alternativas — basta realizar uma/);
    await h.change({ objectiveStatus: 'investigar-origem' }, 'in_progress');
    assert.equal(saved().objectives.find(o => o.id === 'investigar-origem').status, 'pending');
    await h.change({ objectiveAlternative: 'proteger-acesso' }, 'negociar');
    await h.change({ objectiveStatus: 'proteger-acesso' }, 'completed');
    assert.equal(saved().objectives[0].completedAlternativeId, null); assert.equal(saved().objectives[0].status, 'pending');
    assert.doesNotMatch(markup, /data-objective-status=|data-objective-alternative=/);
    await h.click({ missionAction: 'list' }); const before = h.node('#mission-file').clicks;
    await h.click({ missionAction: 'paste' }); assert.equal(h.node('#mission-file').clicks, before);
    assert.match(markup, /Cole aqui o JSON/);
  } finally { h.restore(); }
});

test('Porto Aurora example previews with real environment ID, saves as new mission, downloads and edits without touching environment',async()=>{
  const h = harness();
  try {
    const { createMissionUI } = await moduleFrom('mission-ui.mjs','mission.mjs');
    const world = JSON.parse(await readFile(new URL('./fixtures/porto-aurora.json',import.meta.url),'utf8'));
    const env = {...world,id:'actual-world-id'};
    let ui,markup='';ui=createMissionUI({render(){markup=ui.html();},toast:h.toast,getEnvironments:()=>[env],getActiveEnvironmentId:()=>env.id});ui.init();markup=ui.html();
    const original = JSON.stringify(env);
    assert.match(markup,/Carregar missão de exemplo/);
    await h.click({missionAction:'porto-example'});
    assert.match(markup,/Noite das Marés/);assert.match(markup,/24 objetivo/);assert.match(markup,/Adicionar como nova missão/);
    assert.equal(h.stored.has(KEY),false);
    await h.click({missionAction:'apply-import'});
    const saved=()=>JSON.parse(h.stored.get(KEY)).missions;
    assert.equal(saved().length,1);assert.equal(saved()[0].environmentId,env.id);assert.equal(saved()[0].objectives.length,24);
    assert.equal(JSON.stringify(env),original);
    await h.click({missionAction:'download'});
    const downloaded=JSON.parse(await h.readDownload(0));assert.deepEqual(downloaded,saved()[0]);
    await h.click({missionEdit:saved()[0].id});await h.input({missionField:'name'},'Minha versão');await h.dispatch('submit',{id:'mission-form'});assert.equal(saved()[0].name,'Minha versão');
    await h.click({missionAction:'list'});await h.click({missionAction:'porto-example'});await h.click({missionAction:'apply-import'});
    assert.equal(saved().length,2);assert.notEqual(saved()[0].id,saved()[1].id);assert.equal(saved()[0].name,'Minha versão');
    await h.click({missionAction:'guide'});await h.click({missionAction:'download-model'});
    const complete=JSON.parse(await h.readDownload(1));assert.equal(complete.objectives.length,24);assert.equal(complete.environmentId,env.id);
  }finally{h.restore();}
});
test('mission example falls back to a generic calculated mission for other scenarios',async()=>{
 const h=harness();try{
  const {createMissionUI}=await moduleFrom('mission-ui.mjs','mission.mjs');let ui,markup='';
  ui=createMissionUI({render(){markup=ui.html();},toast:h.toast,getEnvironments:()=>[{id:'old-world',name:'Mundo antigo',places:[]}],getActiveEnvironmentId:()=> 'old-world'});ui.init();
  await h.click({missionAction:'porto-example'});assert.match(markup,/Modelo completo: um pedido de ajuda/);assert.match(markup,/Adicionar como nova missão/);assert.equal(h.stored.has(KEY),false);
 }finally{h.restore();}
});

test('Eriador example chooser previews and imports each thematic mission without changing the scenario',async()=>{
 const h=harness();try{
  const {createMissionUI}=await moduleFrom('mission-ui.mjs','mission.mjs');const world=JSON.parse(await readFile(new URL('../src/world.json',import.meta.url),'utf8'));const env={...world,id:'eriador-ui'};let ui,markup='';
  ui=createMissionUI({render(){markup=ui.html();},toast:h.toast,getEnvironments:()=>[env],getActiveEnvironmentId:()=>env.id});ui.init();
  const before=JSON.stringify(env);await h.click({missionAction:'eriador-examples'});assert.match(markup,/O Caminho das Sombras/);assert.match(markup,/Cartas do Conselho/);assert.match(markup,/As Provisões de Edoras/);assert.equal(h.stored.has(KEY),false);
  for(const id of ['eriador-caminho-das-sombras','eriador-cartas-do-conselho','eriador-provisoes-de-edoras']){
    await h.click({missionAction:'eriador-examples'});await h.click({missionAction:'eriador-model',exampleId:id});assert.match(markup,/Adicionar como nova missão/);await h.click({missionAction:'apply-import'});
  }
  assert.equal(ui.getMissions().length,3);assert.ok(ui.getMissions().every(m=>m.environmentId===env.id && m.execution==='formula'));assert.equal(JSON.stringify(env),before);
  await h.click({missionAction:'guide'});assert.match(markup,/O Caminho das Sombras/);assert.match(markup,/26 ações/);
 }finally{h.restore();}
});
