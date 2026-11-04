import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWorld,validateNPC,saveNPC,removeNPC,removePlace } from '../src/world.mjs';
import { validateMission,validateMissionDocument,resolveMissionNPCs,assertMissionLocations } from '../src/mission.mjs';
import { createAdventure,changeAdventure,finishAdventureTurn,visibleAdventureNPCs,adventureNPCs,validateAdventure } from '../src/adventure.mjs';
import worker from './legacy-worker.mjs';
const rules=JSON.parse(await readFile(new URL('../src/rules.json',import.meta.url)));
const place=(id,parentId)=>({id,parentId,name:id,type:'Espaço',description:'',details:{},x:20,y:30});
const combatant={attributes:{forca:2,habilidade:1,resistencia:1,armadura:1,poderFogo:3},abilities:[],fields:{perfil:'Outro'}};
const npc=(id,placeId,more={})=>({id,name:id,description:'Descrição de '+id,placeId,combatant:null,presence:null,...more});
const world=validateWorld({schemaVersion:1,name:'Cidade',places:[place('city',null),place('inn','city'),place('market','city'),place('room','inn')],npcs:[npc('resident','inn',{combatant}),npc('merchant','market')]});
const goal=(id,completion)=>({id,type:'other',title:id,description:'',target:'',placeId:null,completionCriteria:'Condição',status:'pending',dependsOn:[],alternatives:[],completedAlternativeId:null,...(completion?{completion}: {})});
const auto=condition=>({mode:'automatic',evaluateAt:'turn_end',condition});
function mission(){return {schemaVersion:1,id:'m',environmentId:'env',name:'Missão',description:'',startPlaceId:'inn',npcs:[{environmentNpcId:'resident'},npc('witness','inn',{combatant,presence:{type:'objective_completed',objectiveId:'gate'}})],objectives:[goal('gate'),goal('win',auto({type:'npc_defeated',npcId:'resident'})),goal('continue')]};}
const hero={id:'hero',name:'Heroína',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
const make=(w=world,m=mission(),r=rules)=>changeAdventure(createAdventure({name:'Jogo',mission:m,world:w,rules:r,character:hero}),{type:'start'});
test('environment NPC CRUD validates place, stable IDs, combat data, presence references and preserves old worlds',()=>{
 let w=saveNPC(world,npc('new','inn'));assert.equal(w.npcs.length,3);assert.equal(world.npcs.length,2);
 w=saveNPC(w,{...w.npcs.find(n=>n.id==='new'),placeId:'market'},'new');assert.equal(w.npcs.find(n=>n.id==='new').placeId,'market');w=removeNPC(w,'new');assert.equal(w.npcs.length,2);
 assert.throws(()=>saveNPC(world,npc('resident','inn')),/duplicado/);assert.throws(()=>saveNPC(world,npc('changed','inn'),'resident'),/Preserve/);
 assert.throws(()=>saveNPC(world,npc('bad',null)),/lugar/);assert.throws(()=>saveNPC(world,npc('bad','missing')),/não existe/);
 assert.throws(()=>validateNPC(npc('x','inn',{combatant:{...combatant,attributes:{forca:99}}})),/Atributos/);
 assert.throws(()=>saveNPC(world,npc('bad','inn',{presence:{type:'objective_completed',objectiveId:'gate'}})),/missão/);
 assert.throws(()=>saveNPC(world,npc('bad','inn',{presence:{type:'npc_defeated',npcId:'missing'}})),/inexistente/);
 assert.throws(()=>removePlace(world,'market'),/NPCs/);
 const old=validateWorld({schemaVersion:1,name:'Antigo',places:[]});assert.equal(old.npcs,undefined);
 assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(world))),world);
});
test('missions reference environmental NPCs without duplicates or overrides and reject missing/colliding references',()=>{
 const m=validateMission(mission(),[{id:'env',...world}]);const catalog=resolveMissionNPCs(world,m);
 assert.equal(catalog.length,3);assert.equal(catalog.filter(n=>n.id==='resident').length,1);assert.equal(catalog.find(n=>n.id==='resident').origin,'environment');assert.equal(catalog.find(n=>n.id==='witness').origin,'mission');
 let bad=mission();bad.npcs[0]={environmentNpcId:'unknown'};bad.objectives[1].completion.condition.npcId='unknown';assert.throws(()=>validateMission(bad,[{id:'env',...world}]),/não encontrado/);
 bad=mission();bad.npcs[0]=npc('resident','inn');assert.throws(()=>validateMission(bad,[{id:'env',...world}]),/environmentNpcId/);
 bad=mission();bad.npcs[0]={environmentNpcId:'resident',name:'Override'};assert.throws(()=>validateMissionDocument(bad),/não suportado/);
 bad=mission();bad.npcs[1].presence={type:'objective_completed',objectiveId:'unknown'};assert.throws(()=>validateMissionDocument(bad),/Objetivo inexistente/);
 bad=mission();bad.npcs[1].presence={type:'npc_defeated',npcId:'witness'};assert.throws(()=>validateMissionDocument(bad),/própria/);
 const removed={...world,npcs:world.npcs.filter(n=>n.id!=='resident')};assert.throws(()=>assertMissionLocations([m],'env',removed),/não encontrado/);
});
test('adventure combines both origins, respects exact local visibility and presence gates in UI and combat engine',()=>{
 let a=make();assert.equal(a.turn.npcs.length,3);assert.deepEqual(visibleAdventureNPCs(a).map(n=>n.id),['resident']);
 assert.throws(()=>finishAdventureTurn(a,{expectedTurn:0,combat:{npcId:'witness'}}),/localização atual/);
 a=changeAdventure(a,{type:'objective',id:'gate',status:'completed'});assert.deepEqual(visibleAdventureNPCs(a).map(n=>n.id),['resident','witness']);
 a=changeAdventure(a,{type:'move',placeId:'room'});assert.equal(visibleAdventureNPCs(a).length,0);
 a=changeAdventure(a,{type:'move',placeId:'inn'});a=changeAdventure(a,{type:'move',placeId:'market'});assert.deepEqual(visibleAdventureNPCs(a).map(n=>n.id),['merchant']);
 assert.throws(()=>finishAdventureTurn(a,{expectedTurn:a.turn.number,combat:{npcId:'resident'}}),/localização atual/);
 assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(a))),a);
});
test('environmental NPC defeat updates a mission reference, keeps one runtime state and never changes source or other adventures',()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
 const source=structuredClone(world),before=JSON.stringify(source),a=make(source,mission(),r),other=make(source,mission(),r);
 const result=finishAdventureTurn(a,{expectedTurn:0,seed:1,combat:{npcId:'resident'}});
 assert.equal(result.turn.npcs.find(n=>n.id==='resident').defeated,true);assert.equal(result.progress.find(p=>p.id==='win').status,'completed');assert.equal(result.turn.npcs.filter(n=>n.id==='resident').length,1);
 assert.equal(a.turn.npcs.find(n=>n.id==='resident').defeated,false);assert.equal(other.turn.npcs.find(n=>n.id==='resident').defeated,false);assert.equal(JSON.stringify(source),before);
 source.npcs[0].name='Nome alterado';assert.equal(adventureNPCs(result).find(n=>n.id==='resident').name,'resident');
 const moved=structuredClone(other);moved.turn.npcs.find(n=>n.id==='resident').placeId='market';assert.ok(!visibleAdventureNPCs(validateAdventure(moved)).some(n=>n.id==='resident'));
});
test('environment-only presence uses its own NPC state and hidden NPCs cannot be fought through the API',async()=>{
 const w=validateWorld({...world,npcs:[...world.npcs,npc('late','inn',{combatant,presence:{type:'npc_defeated',npcId:'resident'}})]});
 let a=make(w);assert.ok(!visibleAdventureNPCs(a).some(n=>n.id==='late'));
 const response=await worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure:a,command:{expectedTurn:0,combat:{npcId:'late'}}})}));assert.equal(response.status,400);
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';a=make(w,mission(),r);a=finishAdventureTurn(a,{expectedTurn:0,seed:2,combat:{npcId:'resident'}});assert.ok(visibleAdventureNPCs(a).some(n=>n.id==='late'));
 const api=await worker.fetch(new Request('https://rpg.test/api/mission',{method:'POST',body:JSON.stringify({mission:mission(),environments:[{id:'env',...w}]})}));assert.equal(api.status,200);
});
