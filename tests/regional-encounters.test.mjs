import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorld,regionalEncounterTable,createScenarioTemplate,scenarioLLMPrompt,withEriadorEncounters} from '../src/world.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,validateAdventure,currentRegionalEncounter,visibleAdventureNPCs} from '../src/adventure.mjs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
import worker from '../worker/index.js';
const source=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url))),rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
function worldOf(id='lobos',cooldownTurns=3){const w=structuredClone(source);for(const e of w.encounters){e.hostile=false;if(['lobos','salteadores'].includes(e.id))e.options=JSON.parse(readFileSync(new URL('./fixtures/legacy-regional-options.json',import.meta.url)))[e.id];}for(const p of w.places)delete p.encounterTable;w.places.find(p=>p.id==='eriador').encounterTable={mode:'replace',chance:100,cooldownTurns,entries:[{encounterId:id,weight:1}]};w.places.find(p=>p.id==='bolsao').encounterTable={mode:'none',entries:[]};return w;}
function start(w=worldOf(),r=rules){return changeAdventure(createAdventure({name:'Encontros',world:w,rules:r,character:createMiddleEarthCharacters(r)[0],environmentId:'eriador',locationId:'bolsao'}),{type:'start'});}
const move=(a,placeId='condado',seed=42)=>finishAdventureTurn(a,{expectedTurn:a.turn.number,move:{placeId},seed});
const choice=(a,optionId,seed=1)=>finishAdventureTurn(a,{expectedTurn:a.turn.number,encounter:{occurrenceId:currentRegionalEncounter(a).occurrence.id,optionId},seed});
async function api(adventure,command){return worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure,command})}));}
test('region tables inherit, extend, replace and block; example and external JSON contract round-trip',()=>{
 const w=worldOf();assert.equal(regionalEncounterTable(w,'condado').chance,100);assert.equal(regionalEncounterTable(w,'bolsao').chance,0);assert.deepEqual(regionalEncounterTable(w,'bolsao').entries,[]);
 w.places.find(p=>p.id==='condado').encounterTable={mode:'extend',chance:60,entries:[{encounterId:'mercador-viajante',weight:4},{encounterId:'lobos',weight:2}]};let t=regionalEncounterTable(validateWorld(w),'condado');assert.equal(t.cooldownTurns,3);assert.equal(t.entries.length,2);assert.equal(t.entries.find(e=>e.encounterId==='lobos').weight,2);
 w.places.find(p=>p.id==='bolsao').encounterTable={mode:'replace',chance:20,entries:[{encounterId:'viajante-ferido',weight:1}]};t=regionalEncounterTable(validateWorld(w),'bolsao');assert.deepEqual(t.entries,[{encounterId:'viajante-ferido',weight:1}]);assert.equal(t.chance,20);
 assert.deepEqual(createScenarioTemplate(),validateWorld(source));assert.equal(source.encounters.length,4);assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(source))),source);assert.match(scenarioLLMPrompt(),/encounterTable/);assert.match(scenarioLLMPrompt(),/duringCombat/);
 const old=structuredClone(source);delete old.encounters;for(const p of old.places)delete p.encounterTable;const upgraded=withEriadorEncounters(old);assert.equal(upgraded.encounters.length,4);assert.equal(old.encounters,undefined);assert.deepEqual(withEriadorEncounters(upgraded),upgraded);
});
test('invalid models, rules, options, weights, region references and formula bindings are rejected',()=>{
 for(const mutate of [w=>w.encounters.push(w.encounters[0]),w=>w.encounters[0].options[0].kind='javascript',w=>w.encounters[0].options[0].id='victory',w=>w.encounters[0].participants.push(w.encounters[0].participants[0]),w=>w.places[0].encounterTable={mode:'replace',chance:101,entries:[]},w=>w.places[0].encounterTable={mode:'replace',entries:[{encounterId:'missing',weight:1}]},w=>w.places[0].encounterTable={mode:'replace',entries:[{encounterId:'lobos',weight:0}]},w=>w.encounters[0].condition={operator:'eq',left:{ref:'objetivos.other.concluido'},right:true},w=>w.encounters[0].condition={operator:'eq',left:{ref:'npcs.missing.derrotado'},right:false}]){const w=worldOf();mutate(w);assert.throws(()=>validateWorld(w));}
 const w=worldOf();w.encounters[0].options[0].attribute='unknown';assert.throws(()=>start(w),/Teste incompatível/);
 const over=worldOf();over.encounters[0].participants[0].combatant.attributes.forca=5;assert.throws(()=>start(over),/Encontro.*participante/);
});
test('arrival creates an independent persisted occurrence; pending encounters block unrelated turns and do not reroll on reload',async()=>{
 const a=start(),before=JSON.stringify(a),response=await api(a,{expectedTurn:0,move:{placeId:'condado'},seed:42});assert.equal(response.status,200,await response.clone().text());const next=await response.json(),e=currentRegionalEncounter(next);
 assert.equal(next.turn.number,1);assert.equal(e.template.id,'lobos');assert.equal(e.occurrence.status,'pending');assert.equal(next.turn.npcs.filter(n=>n.id.startsWith('enc-')).length,1);assert.ok(visibleAdventureNPCs(next).some(n=>n.origin==='encounter'));assert.equal(JSON.stringify(a),before);
 assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(next))),next);assert.equal(currentRegionalEncounter(validateAdventure(next)).occurrence.id,e.occurrence.id);
 for(const command of [{expectedTurn:1,move:{placeId:'bolsao'}},{expectedTurn:1},{expectedTurn:1,combat:{npcId:'frodo'}},{expectedTurn:1,encounter:{occurrenceId:'enc-999',optionId:'contornar'}},{expectedTurn:1,encounter:{occurrenceId:e.occurrence.id,optionId:'missing'}},{expectedTurn:0,encounter:{occurrenceId:e.occurrence.id,optionId:'contornar'}}])assert.equal((await api(next,command)).status,400);
 const bad=structuredClone(next);bad.encounters.occurrences[0].participants[0].character.hp=999;assert.throws(()=>validateAdventure(bad));const future=structuredClone(next);future.encounters.lastTriggeredTurn=99;assert.throws(()=>validateAdventure(future));
});
test('peaceful choices, failed tests, retries and cooldown use real turns and persist their outcome',()=>{
 const w=worldOf();const wolf=w.encounters.find(t=>t.id==='lobos');wolf.options.find(o=>o.id==='afastar').difficulty=100;
 let a=move(start(w));a=choice(a,'afastar');assert.equal(a.turn.number,2);assert.equal(currentRegionalEncounter(a).occurrence.attempts,1);assert.match(currentRegionalEncounter(a).occurrence.lastResult,/falha.*Total/);assert.equal(currentRegionalEncounter(validateAdventure(a)).occurrence.attempts,1);
 a=choice(a,'contornar');assert.equal(a.turn.number,3);assert.equal(currentRegionalEncounter(a),null);assert.equal(a.encounters.occurrences[0].resolution,'contornar');assert.equal(a.encounters.occurrences[0].resolvedTurn,3);
 const fast=worldOf('lobos',10);let b=choice(move(start(fast)),'contornar');b=move(b,'bolsao');b=move(b,'condado');assert.equal(currentRegionalEncounter(b),null);assert.equal(b.encounters.occurrences.length,1);
 a=move(a,'bolsao');assert.equal(currentRegionalEncounter(a),null);a=move(a);assert.equal(currentRegionalEncounter(a).occurrence.id,'enc-2');assert.notEqual(a.encounters.occurrences[0].participants[0].id,a.encounters.occurrences[1].participants[0].id);
 const merchant=move(start(worldOf('mercador-viajante')));const done=choice(merchant,'conversar');assert.equal(done.encounters.occurrences[0].status,'resolved');assert.match(done.encounters.occurrences[0].lastResult,/notícias/);
});
test('chance zero, safe interiors and false formula conditions prevent encounters; seeded draws reproduce selection',()=>{
 const none=worldOf();none.places.find(p=>p.id==='eriador').encounterTable.chance=0;assert.equal(currentRegionalEncounter(move(start(none))),null);
 let safe=move(start());safe=choice(safe,'contornar');safe=move(safe,'bolsao');assert.equal(currentRegionalEncounter(safe),null);
 const conditional=worldOf();conditional.encounters.find(t=>t.id==='lobos').condition={operator:'gt',left:{ref:'turno.numero'},right:100};assert.equal(currentRegionalEncounter(move(start(conditional))),null);
 const timed=worldOf();timed.encounters.find(t=>t.id==='lobos').condition={operator:'and',operands:[{operator:'gt',left:{ref:'turno.numero'},right:0},{operator:'eq',left:{ref:'local.id'},right:'condado'}]};assert.ok(currentRegionalEncounter(move(start(timed))));
 const weighted=worldOf();weighted.places.find(p=>p.id==='eriador').encounterTable.entries=[{encounterId:'lobos',weight:1},{encounterId:'mercador-viajante',weight:3}];assert.equal(currentRegionalEncounter(move(start(weighted),'condado',88)).template.id,currentRegionalEncounter(move(start(weighted),'condado',88)).template.id);
 const old=JSON.parse(readFileSync(new URL('./fixtures/porto-aurora.json',import.meta.url)));const a=createAdventure({name:'Anterior',world:old,rules,character:createMiddleEarthCharacters(rules)[0],environmentId:'old'});assert.equal(a.encounters,undefined);
});
test('real combat handles multiple participants, victory and escape without changing templates or other adventures',async()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';const w=worldOf();w.encounters.find(t=>t.id==='lobos').participants.push({...structuredClone(w.encounters.find(t=>t.id==='lobos').participants[0]),id:'lobo-dois',name:'Segundo lobo'});
 const worldBefore=JSON.stringify(w);let a=move(start(w,r));const other=structuredClone(a),ids=currentRegionalEncounter(a).occurrence.participants.map(p=>p.id);
 let response=await api(a,{expectedTurn:a.turn.number,combat:{npcId:ids[0]},seed:1});assert.equal(response.status,200,await response.clone().text());a=await response.json();assert.equal(currentRegionalEncounter(a).occurrence.status,'combat');assert.equal(currentRegionalEncounter(a).occurrence.participants[0].defeated,true);assert.equal(currentRegionalEncounter(other).occurrence.participants[0].defeated,false);
 assert.throws(()=>choice(a,'contornar'),/Opção indisponível/);
 response=await api(a,{expectedTurn:a.turn.number,combat:{npcId:ids[1]},seed:1});assert.equal(response.status,200,await response.clone().text());a=await response.json();assert.equal(currentRegionalEncounter(a),null);assert.equal(a.encounters.occurrences[0].resolution,'victory');assert.equal(a.turn.number,3);assert.equal(JSON.stringify(w),worldBefore);
 const escapeWorld=worldOf();escapeWorld.encounters.find(t=>t.id==='lobos').options.find(o=>o.id==='escapar').difficulty=0;const slow=structuredClone(rules);slow.combat.escape.difficulty=0;slow.actions[0].formula='0';slow.combat.damage='0';let b=move(start(escapeWorld,slow));b=finishAdventureTurn(b,{expectedTurn:b.turn.number,combat:{npcId:currentRegionalEncounter(b).occurrence.participants[0].id},seed:3});assert.equal(currentRegionalEncounter(b).occurrence.status,'combat');b=choice(b,'escapar');assert.equal(b.encounters.occurrences[0].resolution,'escaped');assert.equal(b.encounters.occurrences[0].participants[0].defeated,false);
});

test('encounter choices keep accepted missions synchronized and evaluate their formulas at the same turn end',()=>{
 let a=start();const m={schemaVersion:1,id:'count-turns',environmentId:'eriador',name:'Chegar e lidar com o caminho',execution:'formula',offer:{type:'notice',placeId:'bolsao',title:'Um pedido',description:'Explore o caminho'},objectives:[{id:'done',type:'other',title:'Explorar por dois turnos',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'gte',left:{ref:'turno.numero'},right:2}}}]};
 a=changeAdventure(a,{type:'accept',mission:m});a=move(a);assert.equal(a.quests[0].status,'in_progress');a=choice(a,'contornar');assert.equal(a.turn.number,2);assert.equal(a.quests[0].status,'completed');assert.equal(a.quests[0].progress[0].completedTurn,2);assert.equal(a.encounters.occurrences[0].status,'resolved');assert.equal(a.status,'in_progress');
});
