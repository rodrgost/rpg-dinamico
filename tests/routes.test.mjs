import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorld,createScenarioTemplate,routeMapHTML,routeBetween,scenarioLLMPrompt,savePlace,removePlace} from '../src/world.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,validateAdventure,currentRegionalEncounter,visibleAdventureNPCs,availableMissionOffers,availableAdventureActivities} from '../src/adventure.mjs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
import worker from '../worker/index.js';
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
function fixture({encounters=false,distance=3}={}){
 const world=createScenarioTemplate();world.routes=[{id:'road',name:'Estrada entre refúgios',description:'Uma trilha.',fromPlaceId:'condado',toPlaceId:'valfenda',distance}];for(const p of world.places)p.encounterTable={mode:'none',entries:[]};
 if(encounters)world.places.find(p=>p.id==='eriador').encounterTable={mode:'replace',chance:100,cooldownTurns:1,entries:[{encounterId:'mercador-viajante',weight:1}]};
 return changeAdventure(createAdventure({name:'Viagem',world,rules,character:createMiddleEarthCharacters(rules)[0],environmentId:'eriador',locationId:'condado'}),{type:'start'});
}
const advance=a=>finishAdventureTurn(a,{expectedTurn:a.turn.number,travel:a.travel?{}:{routeId:'road'},seed:1});
async function api(a,command){const response=await worker.fetch(new Request('https://test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure:a,command})}));return {response,json:await response.json()};}
test('scenario route contract is bidirectional, bounded, same-level only and round-trips through import/default/prompt',()=>{
 const w=fixture().snapshot.world,r=w.routes[0];assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(w))),w);assert.equal(routeBetween(w,'valfenda','condado').id,'road');assert.match(scenarioLLMPrompt(),/routes/);assert.equal(createScenarioTemplate().routes.length,3);
 for(const change of [r=>r.toPlaceId=r.fromPlaceId,r=>r.toPlaceId='bolsao',r=>r.toPlaceId='missing',r=>r.distance=0,r=>r.distance=101,r=>r.distance=1.5,r=>r.direction='one-way']){const bad=structuredClone(w);change(bad.routes[0]);assert.throws(()=>validateWorld(bad));}
 const bad=structuredClone(w);bad.routes.push({...r,id:'other',fromPlaceId:r.toPlaceId,toPlaceId:r.fromPlaceId});assert.throws(()=>validateWorld(bad),/Já existe/);
 assert.throws(()=>savePlace(w,{...w.places.find(p=>p.id==='valfenda'),parentId:'condado'},'valfenda'),/superior/);
 const html=routeMapHTML(w,'eriador',{routeId:'road',fromPlaceId:'condado',toPlaceId:'valfenda',progress:1});assert.match(html,/route-traveler/);assert.equal((html.match(/class="route-dot"/g)||[]).length,2);assert.equal(routeMapHTML(w,'rohan'),'');
});
test('travel advances exactly one unit per turn, saves mid-route and only arrives on the final step',async()=>{
 let a=fixture();const original=JSON.stringify(a),first=await api(a,{expectedTurn:0,move:{placeId:'valfenda'},seed:1});assert.equal(first.response.status,200,JSON.stringify(first.json));a=first.json;assert.equal(a.locationId,null);assert.equal(a.travel.progress,1);assert.equal(a.turn.number,1);assert.equal(JSON.stringify(fixture().snapshot.world),JSON.stringify(a.snapshot.world));assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(a))),a);assert.equal(visibleAdventureNPCs(a).length,0);assert.equal(availableMissionOffers(a,[]).length,0);assert.equal(availableAdventureActivities(a).length,0);
 a=advance(a);assert.equal(a.travel.progress,2);assert.equal(a.turn.number,2);a=advance(a);assert.equal(a.travel,undefined);assert.equal(a.locationId,'valfenda');assert.equal(a.turn.number,3);assert.match(a.turn.history.at(-1).events[0],/Chegada.*Valfenda/);
 a=advance(a);assert.equal(a.travel.fromPlaceId,'valfenda');assert.equal(a.travel.toPlaceId,'condado');assert.equal(a.turn.number,4);assert.equal(a.locationId,null);
 assert.equal(JSON.parse(original).locationId,'condado');
});
test('each movement step may encounter the shared region; resolving it pauses progress, preserves location and resumes the same route',()=>{
 let a=advance(fixture({encounters:true}));assert.equal(currentRegionalEncounter(a).template.id,'mercador-viajante');assert.equal(currentRegionalEncounter(a).occurrence.placeId,null);assert.equal(a.travel.progress,1);assert.deepEqual(validateAdventure(a),a);
 assert.throws(()=>advance(a),/Resolva o encontro/);
 const resolve=a=>finishAdventureTurn(a,{expectedTurn:a.turn.number,encounter:{occurrenceId:currentRegionalEncounter(a).occurrence.id,optionId:'conversar'}});
 a=resolve(a);assert.equal(a.travel.progress,1);assert.equal(a.turn.number,2);a=advance(a);assert.equal(a.travel.progress,2);assert.equal(a.encounters.occurrences.length,2);a=resolve(a);a=advance(a);assert.equal(a.locationId,'valfenda');assert.equal(a.travel,undefined);assert.equal(currentRegionalEncounter(a).template.id,'mercador-viajante');assert.equal(a.encounters.occurrences.length,3);
});
test('invalid, combined, stale and incapacitated travel commands do not mutate state; travel cannot be bypassed',async()=>{
 const initial=fixture(),a=advance(initial),before=JSON.stringify(a);
 for(const command of [{expectedTurn:1},{expectedTurn:1,move:{placeId:'valfenda'}},{expectedTurn:1,travel:{routeId:'unknown'}},{expectedTurn:0,travel:{}},{expectedTurn:1,travel:{},move:{placeId:'bolsao'}}])assert.equal((await api(a,command)).response.status,400);
 assert.equal(JSON.stringify(a),before);const down=structuredClone(a);down.turn.character.hp=0;assert.throws(()=>advance(down),/incapacitado/);
 for(const t of [{...a.travel,progress:3},{...a.travel,fromPlaceId:'bolsao'},{...a.travel,toPlaceId:'condado'}])assert.throws(()=>validateAdventure({...a,travel:t}),/viagem/);
 assert.throws(()=>finishAdventureTurn(initial,{expectedTurn:0,travel:{routeId:'caminho-rohan-mordor'}}));
});
test('destination objectives only complete on arrival, while turn conditions still evaluate during travel',()=>{
 let a=fixture();const m={schemaVersion:1,id:'journey',environmentId:'eriador',name:'Ir a Valfenda',execution:'formula',offer:{type:'notice',placeId:'condado',title:'Viajar',description:'Conhecer o refúgio'},objectives:[{id:'turn',type:'other',title:'Percorrer um turno',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'gte',left:{ref:'turno.numero'},right:1}}},{id:'arrive',type:'other',title:'Chegar a Valfenda',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'eq',left:{ref:'local.id'},right:'valfenda'}}}]};
 a=changeAdventure(a,{type:'accept',mission:m});a=advance(a);assert.equal(a.quests[0].progress[0].status,'completed');assert.equal(a.quests[0].progress[1].status,'pending');a=advance(a);assert.equal(a.quests[0].progress[1].status,'pending');a=advance(a);assert.equal(a.quests[0].status,'completed');assert.equal(a.quests[0].progress[1].completedTurn,3);
});
test('distance one arrives in one turn and older scenarios retain their original direct movement',()=>{
 let a=advance(fixture({distance:1}));assert.equal(a.locationId,'valfenda');assert.equal(a.travel,undefined);const old=fixture();delete old.snapshot.world.routes;const result=finishAdventureTurn(old,{expectedTurn:0,move:{placeId:'valfenda'}});assert.equal(result.locationId,'valfenda');assert.equal(result.turn.number,1);
});
