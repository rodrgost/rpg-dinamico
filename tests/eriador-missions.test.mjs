import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEriadorMissions,createMissionTemplate,missionLLMPrompt,supportsEriadorMission,evaluateMissionCondition} from '../src/mission.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,availableAdventureActivities,reachableAdventurePlaces,availableMissionOffers} from '../src/adventure.mjs';
const world=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url)));
world.turnRules=[];
// These flows isolate mission completion from independently tested random encounters.
for(const p of world.places)if(p.encounterTable)p.encounterTable.chance=0;
const env={...world,id:'eriador-world'};
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));const hero={id:'hero',name:'Viajante',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
function move(a,destination){if(destination===null || destination===a.locationId)return a;const queue=[[a.locationId,[]]],seen=new Set([a.locationId]);while(queue.length){const [locationId,path]=queue.shift();if(locationId===destination){for(const placeId of path){a=changeAdventure(a,{type:'move',placeId});while(a.travel)a=finishAdventureTurn(a,{expectedTurn:a.turn.number,travel:{}});}return a;}for(const p of reachableAdventurePlaces({...a,locationId})){if(!seen.has(p.id)){seen.add(p.id);queue.push([p.id,[...path,p.id]]);}}}throw Error('Lugar inacessível: '+destination);}
test('Eriador provides three independent thematic models with valid offers, formulas, actions, items and real residents',()=>{
 assert.equal(supportsEriadorMission(env),true);const models=createEriadorMissions(env);assert.deepEqual(models.map(m=>m.objectives.length),[24,5,6]);assert.deepEqual(models.map(m=>m.actions.length),[26,5,6]);
 assert.equal(createMissionTemplate(env).name,'Eriador: O Caminho das Sombras');assert.match(missionLLMPrompt(env),/TEMA DO CENÁRIO: Eriador e Além/);
 for(const m of models){assert.equal(m.environmentId,env.id);assert.equal(m.execution,'formula');assert.ok(m.objectives.every(o=>o.completion.mode==='automatic'));assert.equal(m.facts.length,0);assert.doesNotMatch(JSON.stringify(m),/Porto Aurora|bloqueador-mercado|farol-restaurado/);}
 const incomplete=structuredClone(env);incomplete.npcs=incomplete.npcs.filter(n=>n.id!=='elrond');assert.equal(supportsEriadorMission(incomplete),false);assert.throws(()=>createEriadorMissions(incomplete),/cenário Eriador/);
});
for(const index of [0,1,2])test('Eriador mission '+(index+1)+' completes entirely through actions and peaceful tests without LLM or manual marks',()=>{
 const m=createEriadorMissions(env)[index],r=structuredClone(rules);r.actions.find(a=>a.kind==='test').formula='100';
 let a=createAdventure({name:m.name,world,rules:r,character:hero,environmentId:env.id,locationId:m.offer.placeId});a=changeAdventure(a,{type:'start'});assert.equal(availableMissionOffers(a,[m]).length,1);a=changeAdventure(a,{type:'accept',mission:m});
 for(let turn=0;turn<60 && a.quests[0].status!=='completed';turn++){
  let next;
  for(const action of m.actions){if(a.quests[0].turn.activities.find(s=>s.id===action.id).successes>0 || action.condition!==undefined && !evaluateMissionCondition(action.condition,a.quests[0]).met)continue;a=move(a,action.placeId);if(availableAdventureActivities(a).some(x=>x.missionId===m.id && x.id===action.id && !x.blocked)){next=action;break;}}
  assert.ok(next,'Precisa existir uma ação para avançar');a=finishAdventureTurn(a,{expectedTurn:a.turn.number,activity:{missionId:m.id,actionId:next.id},seed:123});
 }
 assert.equal(a.quests[0].status,'completed');assert.equal(a.quests[0].progress.filter(p=>p.status==='completed').length,m.objectives.length);assert.equal(a.status,'in_progress');assert.ok(a.turn.npcs.every(n=>!n.defeated));
 for(const o of m.objectives.filter(o=>o.type==='combat'))assert.notEqual(a.quests[0].progress.find(p=>p.id===o.id).completedAlternativeId,'combater');
});
test('all three Eriador offers can be accepted in one adventure without duplicating residents',()=>{
 const models=createEriadorMissions(env);let a=createAdventure({name:'Três jornadas',world,rules,character:hero,environmentId:env.id,locationId:'bolsao'});a=changeAdventure(a,{type:'start'});
 for(const m of models){a=move(a,m.offer.placeId);a=changeAdventure(a,{type:'accept',mission:m});}
 assert.equal(a.quests.length,3);assert.equal(a.turn.npcs.filter(n=>n.id==='frodo').length,1);assert.equal(a.turn.npcs.filter(n=>n.id==='elrond').length,1);assert.ok(a.turn.npcs.some(n=>n.id.endsWith('eothain-intendente')));
});
