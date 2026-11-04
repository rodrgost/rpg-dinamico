import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdventure, changeAdventure, validateAdventure, adventureMission } from '../src/adventure.mjs';
import { createMissionTemplate } from './legacy-models.mjs';
import worker from './legacy-worker.mjs';
const rules = JSON.parse(await readFile(new URL('../src/rules.json',import.meta.url)));
const world = {schemaVersion:1,name:'Reino',description:'Cenário',places:[]};
const mission = createMissionTemplate({id:'world-1',name:world.name,places:[]});
const character = {id:'hero-1',name:'Heroína',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{origem:'Vale',perfil:'Guardião',historia:''}};
const make = () => createAdventure({name:'Aventura de teste',mission,world,rules,character});
const finish = (a,id) => changeAdventure(a,{type:'objective',id,status:'completed'});
test('adventures copy all templates, start at full HP and remain independent across source edits',() => {
  const source = structuredClone({name:'Nova partida',mission,world,rules,character:{...character,hp:1}});
  const a = createAdventure(source), original = structuredClone(a), b = createAdventure(source);
  source.rules.attributes[0].name = 'Alterado'; source.world.name = 'Outro mundo'; source.mission.objectives[0].title = 'Outro'; source.character.attributes.forca = 0;
  assert.deepEqual(a,original); assert.notEqual(a.id,b.id); assert.equal(a.snapshot.character.hp,10);
  const running = changeAdventure(a,{type:'start'});
  const done = finish(running,'obter-registro');
  assert.equal(a.status,'not_started'); assert.equal(b.progress.find(p => p.id === 'obter-registro').status,'pending');
  assert.equal(done.progress.find(p => p.id === 'obter-registro').status,'completed');
});
test('lifecycle enforces prerequisites and alternatives, completes, reopens, abandons and resumes without losing progress',() => {
  let a = make();
  assert.throws(() => finish(a,'obter-registro'),/Inicie/);
  a = changeAdventure(a,{type:'start'}); const started = a.startedAt;
  assert.throws(() => finish(a,'investigar-origem'),/depend|pré|conclu/i);
  assert.throws(() => finish(a,'proteger-acesso'),/alternativa/i);
  a = changeAdventure(a,{type:'objective',id:'proteger-acesso',alternative:'negociar'});
  a = finish(a,'proteger-acesso'); a = finish(a,'obter-registro'); a = finish(a,'investigar-origem');
  assert.throws(() => changeAdventure(a,{type:'objective',id:'obter-registro',status:'pending'}),/depend|pré|conclu/i);
  a = changeAdventure(a,{type:'abandon'}); assert.equal(a.status,'abandoned');
  assert.throws(() => finish(a,'ajudar-grupo'),/Inicie/);
  a = changeAdventure(a,{type:'start'}); assert.equal(a.startedAt,started); assert.equal(a.abandonedAt,null);
  for (const id of ['restabelecer-contato','ajudar-grupo','registrar-solucao']) a = finish(a,id);
  assert.equal(a.status,'completed'); assert.ok(a.completedAt);
  a = changeAdventure(a,{type:'objective',id:'registrar-solucao',status:'pending'});
  assert.equal(a.status,'in_progress'); assert.equal(a.completedAt,null);
  assert.equal(adventureMission(a).objectives[0].completedAlternativeId,'negociar');
  assert.equal(a.snapshot.mission.objectives[0].status,'pending');
});
test('legacy conversion preserves completed objectives and alternative; invalid snapshots/progress are rejected',() => {
  const old = structuredClone(mission); old.objectives[0].status='completed';old.objectives[0].completedAlternativeId='negociar';
  const a = createAdventure({name:'Anterior',mission:old,world,rules,character,preserveProgress:true,legacyId:'old-1'});
  assert.equal(a.status,'in_progress');assert.equal(a.progress[0].status,'completed');assert.equal(a.progress[0].completedAlternativeId,'negociar');
  assert.equal(a.snapshot.mission.objectives[0].status,'pending');
  for (const mutate of [x => x.progress.pop(), x => x.progress[1].id=x.progress[0].id, x => x.snapshot.mission.environmentId='', x => x.snapshot.character.attributes.forca=99, x => x.status='completed',x => x.createdAt='bad']) {
    const bad=structuredClone(a);mutate(bad);assert.throws(() => validateAdventure(bad));
  }
});
test('Worker serves adventure modules and validates complete adventure documents',async () => {
  for (const path of ['/adventure.mjs','/adventure-ui.mjs']) assert.equal((await worker.fetch(new Request('https://rpg.test'+path))).status,200);
  const post = adventure => worker.fetch(new Request('https://rpg.test/api/adventure',{method:'POST',body:JSON.stringify({adventure})}));
  const a = make(), response = await post(a); assert.equal(response.status,200);assert.deepEqual(await response.json(),a);
  const bad = structuredClone(a);bad.progress[0].status='completed';assert.equal((await post(bad)).status,400);
});
