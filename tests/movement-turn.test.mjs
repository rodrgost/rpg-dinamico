import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAdventure,changeAdventure,finishAdventureTurn,validateAdventure} from '../src/adventure.mjs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
import worker from '../worker/index.js';
const world=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url))),rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url))),hero=createMiddleEarthCharacters(rules)[0];
for(const p of world.places)if(p.encounterTable)p.encounterTable.chance=0;
const ref=ref=>({ref}),eq=(left,right)=>({operator:'eq',left,right});
const mission=id=>({schemaVersion:1,id,environmentId:'eriador',name:id,execution:'formula',startPlaceId:'bolsao',offer:{type:'notice',placeId:'bolsao',title:'Uma caminhada',description:'Chegue ao Condado'},objectives:[{id:'arrive',type:'other',title:'Chegar ao Condado',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'and',operands:[eq(ref('local.id'),'condado'),eq(ref('turno.numero'),1)]}}}]});
function make(legacy=false){let a=createAdventure({name:'Caminhar',world,rules,character:hero,environmentId:'eriador',locationId:'bolsao',...(legacy?{mission:mission('legacy')}: {})});return changeAdventure(a,{type:'start'});}
async function api(adventure,command){return worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adventure,command})}));}
test('movement is one atomic turn and checks every accepted mission after arriving at the destination',async()=>{
 let a=make();for(const id of ['first','second'])a=changeAdventure(a,{type:'accept',mission:mission(id)});
 a.journal=Array.from({length:200},(_,i)=>({id:'past-'+i,at:a.createdAt,kind:'action',text:'Registro anterior '+i,placeId:'bolsao',turn:0}));
 const before=JSON.stringify(a),hp=a.turn.character.hp;
 const response=await api(a,{expectedTurn:0,move:{placeId:'condado'}});assert.equal(response.status,200);
 const next=await response.json();assert.equal(next.locationId,'condado');assert.equal(next.turn.number,1);assert.equal(next.turn.character.hp,hp);assert.equal(next.status,'in_progress');assert.equal(next.turn.history.length,1);
 assert.ok(next.quests.every(q=>q.status==='completed' && q.progress[0].completedTurn===1 && q.turn.number===1));
 assert.equal(next.journal.length,200);assert.equal(next.journal.filter(e=>e.kind==='movement').length,1);assert.equal(next.journal.find(e=>e.kind==='movement').turn,1);assert.match(next.turn.history[0].events[0],/Saiu de Bolsão e chegou a O Condado/);
 assert.equal(JSON.stringify(a),before);assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(next))),next);
 const back=changeAdventure(next,{type:'move',placeId:'bolsao'});assert.equal(back.turn.number,2);assert.equal(back.locationId,'bolsao');assert.ok(back.quests.every(q=>q.progress[0].completedTurn===1));
});
test('invalid, stale, combined and incapacitated movements fail without changing the game',async()=>{
 const a=make(),before=JSON.stringify(a);
 for(const command of [{expectedTurn:0,move:{placeId:'mordor'}},{expectedTurn:0,move:{placeId:'bolsao'}},{expectedTurn:9,move:{placeId:'condado'}},{expectedTurn:0,move:{placeId:'condado'},combat:{npcId:'frodo'}},{expectedTurn:0,move:{placeId:'condado'},activity:{missionId:'x',actionId:'y'}}]){
  const response=await api(a,command);assert.equal(response.status,400);assert.equal(JSON.stringify(a),before);
 }
 const down=structuredClone(a);down.turn.character.hp=0;const response=await api(down,{expectedTurn:0,move:{placeId:'condado'}});assert.equal(response.status,400);assert.equal(down.locationId,'bolsao');assert.equal(down.turn.number,0);
 const next=finishAdventureTurn(a,{expectedTurn:0,move:{placeId:'condado'}});assert.throws(()=>finishAdventureTurn(next,{expectedTurn:0,move:{placeId:'bolsao'}}),/turno já mudou/);
});
test('legacy movement also evaluates arrival formulas and allows later travel without changing its completion date',()=>{
 const a=make(true),next=changeAdventure(a,{type:'move',placeId:'condado'});assert.equal(next.turn.number,1);assert.equal(next.progress[0].completedTurn,1);assert.equal(next.status,'completed');
 const date=next.completedAt,back=changeAdventure(next,{type:'move',placeId:'bolsao'});assert.equal(back.turn.number,2);assert.equal(back.completedAt,date);assert.equal(back.progress[0].completedTurn,1);
});
