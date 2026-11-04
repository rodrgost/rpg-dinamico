import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateMissionDocument, validateMission, createPortoAuroraMission, assertMissionLocations } from './legacy-models.mjs';
import { createAdventure, changeAdventure, finishAdventureTurn, validateAdventure } from '../src/adventure.mjs';
import worker from './legacy-worker.mjs';
const rules=JSON.parse(await readFile(new URL('../src/rules.json',import.meta.url)));
const world={schemaVersion:1,name:'Mundo',places:[]};
const hero={id:'hero',name:'Heroína',attributes:{forca:2,habilidade:5,resistencia:1,armadura:0,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
const npc={id:'captain',name:'Capitão',placeId:null,combatant:{attributes:{forca:2,habilidade:1,resistencia:1,armadura:1,poderFogo:3},abilities:[],fields:{perfil:'Outro'}}};
const fact={id:'document',name:'Documento recuperado',description:'Registro narrativo',initialValue:false};
const auto=condition=>({mode:'automatic',evaluateAt:'turn_end',condition});
const defeated={type:'npc_defeated',npcId:'captain'}, document={type:'fact_equals',factId:'document',value:true};
const goal=(id,condition,dependsOn=[])=>({id,type:'other',title:id,description:'',target:'',placeId:null,completionCriteria:'Condição estruturada',status:'pending',dependsOn,alternatives:[],completedAlternativeId:null,...(condition?{completion:auto(condition)}:{})});
function mission(objectives=[goal('defeat',defeated),goal('manual')]) {return {schemaVersion:1,id:'m',environmentId:'env',name:'Missão',description:'',npcs:[npc],facts:[fact],objectives};}
function make(m=mission(),r=rules){return changeAdventure(createAdventure({name:'Partida',mission:m,world,rules:r,character:hero}),{type:'start'});}
const end=a=>finishAdventureTurn(a,{expectedTurn:a.turn.number});
test('condition contract rejects unknown types, code, bad references, cycles and excessive depth, preserving old manual missions',()=>{
 const m=mission();assert.deepEqual(validateMissionDocument(m).objectives[0].completion,auto(defeated));
 for(const condition of [{type:'eval',code:'globalThis.hack=true'},{...defeated,npcId:'absent'},{...document,factId:'missing'},{type:'objective_completed',objectiveId:'missing'},{type:'all',conditions:[]},{...document,value:'true'},{...defeated,code:'anything'}]){
  const bad=mission([goal('x',condition)]);assert.throws(()=>validateMissionDocument(bad));
 }
 let deep=defeated;for(let i=0;i<8;i++)deep={type:'all',conditions:[deep]};assert.throws(()=>validateMissionDocument(mission([goal('x',deep)])),/níveis/);
 assert.throws(()=>validateMissionDocument(mission([goal('a',{type:'objective_completed',objectiveId:'b'}),goal('b',{type:'objective_completed',objectiveId:'a'})])),/Ciclo/);
 const bad=mission();bad.npcs.push(npc);assert.throws(()=>validateMissionDocument(bad),/duplicado/);
 const wrongPlace=mission();wrongPlace.npcs[0]={...npc,placeId:'unknown'};assert.throws(()=>validateMission(wrongPlace,[{id:'env',places:[]}]),/lugar/);
 const old={...m};delete old.npcs;delete old.facts;old.objectives=[goal('old')];assert.equal(validateMissionDocument(old).objectives[0].completion,undefined);
});
test('real combat applies damage and NPC defeat before objective checks; no manual override or shared source mutation',()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
 const m=mission(), a=make(m,r), before=structuredClone(a);
 assert.throws(()=>changeAdventure(a,{type:'objective',id:'defeat',status:'completed'}),/fim do turno/);
 const next=finishAdventureTurn(a,{expectedTurn:0,seed:42,combat:{npcId:'captain',heroActionId:'attack_melee',npcActionId:'attack_melee'}});
 assert.equal(next.turn.npcs[0].character.hp,0);assert.equal(next.turn.npcs[0].defeated,true);
 assert.equal(next.progress[0].status,'completed');assert.equal(next.progress[0].completedTurn,1);assert.match(next.progress[0].completionReason,/Capitão: derrotado/);
 assert.equal(next.turn.character.hp,5);assert.equal(next.snapshot.character.hp,5);assert.deepEqual(a,before);
 assert.equal(m.objectives[0].status,'pending');assert.equal(next.turn.history[0].checks[0].met,true);
 assert.throws(()=>finishAdventureTurn(next,{expectedTurn:0}),/turno já mudou/);
 assert.throws(()=>finishAdventureTurn(next,{expectedTurn:1,combat:{npcId:'captain'}}),/NPC vivo/);
 assert.throws(()=>changeAdventure(next,{type:'npc',id:'captain',defeated:false}),/deve vir do combate/);
});
test('facts evaluate only at end of turn, all/any work, dependencies cascade independent of array order and completion stays latched',()=>{
 const m=mission([goal('last',{type:'all',conditions:[{type:'objective_completed',objectiveId:'first'},document]},['first']),goal('first',{type:'any',conditions:[defeated,document]}),goal('manual')]);
 let a=make(m);a=changeAdventure(a,{type:'fact',id:'document',value:true});assert.equal(a.progress[1].status,'pending');
 a=end(a);assert.equal(a.progress[0].status,'completed');assert.equal(a.progress[1].status,'completed');assert.equal(a.status,'in_progress');
 a=changeAdventure(a,{type:'fact',id:'document',value:false});a=end(a);assert.equal(a.progress[0].status,'completed');assert.equal(a.progress[0].completedTurn,1);assert.equal(a.turn.history[1].checks.length,0);
 a=changeAdventure(a,{type:'objective',id:'manual',status:'completed'});assert.equal(a.status,'completed');
 assert.throws(()=>end(a),/em andamento/);
});
test('missing prerequisites block satisfied conditions; alternatives choose first satisfied branch and mark only once',()=>{
 const root=goal('automatic',document,['gate']);root.alternatives=[{id:'route',type:'other',title:'Usar documento',description:'',target:'',placeId:null,completionCriteria:'Documento',condition:document}];
 let a=make(mission([root,goal('gate'),goal('manual')]));a=changeAdventure(a,{type:'fact',id:'document',value:true});a=end(a);
 assert.equal(a.progress[0].status,'pending');assert.match(a.turn.history[0].checks[0].reason,/Pré-requisitos/);
 a=changeAdventure(a,{type:'objective',id:'gate',status:'completed'});a=end(a);assert.equal(a.progress[0].completedAlternativeId,'route');assert.match(a.turn.history[1].checks[0].reason,/Caminho: Usar documento/);
 a=end(a);assert.equal(a.turn.history[2].checks.length,0);
 assert.throws(()=>validateMissionDocument(mission([{...root,alternatives:[{...root.alternatives[0],condition:undefined}]},goal('gate')])),/alternativa/);
});
test('old adventure migrates runtime lazily, logs survive reload and invalid state/facts/seed never mutate game',()=>{
 let a=make();const old=structuredClone(a);delete old.turn;old.progress.forEach(p=>{delete p.completedTurn;delete p.completionReason;});
 a=validateAdventure(old);assert.equal(a.turn.number,0);assert.equal(a.turn.npcs.length,1);
 a=end(a);assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(a))),a);
 const before=structuredClone(a);assert.throws(()=>changeAdventure(a,{type:'fact',id:'unknown',value:true}));assert.throws(()=>finishAdventureTurn(a,{expectedTurn:1,seed:-1,combat:{npcId:'captain'}}));assert.deepEqual(a,before);
 const bad=structuredClone(a);bad.turn.npcs[0].defeated=true;assert.throws(()=>validateAdventure(bad),/PV/);
 for(let i=0;i<22;i++)a=end(a);assert.equal(a.turn.history.length,20);assert.equal(a.turn.number,23);
 a=changeAdventure(a,{type:'abandon'});assert.throws(()=>end(a),/em andamento/);
});
test('Porto Aurora model supplies combat NPCs and rules; peaceful narrative flow can finish all 24 objectives',async()=>{
 const w=JSON.parse(await readFile(new URL('./fixtures/porto-aurora.json',import.meta.url)));const env={...w,id:'env'};
 const m=createPortoAuroraMission(env);assert.equal(m.npcs.filter(n=>n.combatant).length,3);assert.equal(m.facts.length,13);assert.equal(m.objectives.filter(o=>o.completion?.mode==='automatic').length,10);
 let a=changeAdventure(createAdventure({name:'Porto',mission:m,world:w,rules,character:hero}),{type:'start'});
 for(const f of m.facts)a=changeAdventure(a,{type:'fact',id:f.id,value:true});
 for(let pass=0;pass<3 && a.status==='in_progress';pass++){
  a=end(a);
  for(const o of m.objectives){if(o.completion?.mode==='automatic'||a.progress.find(p=>p.id===o.id).status==='completed'||o.dependsOn.some(id=>a.progress.find(p=>p.id===id).status!=='completed'))continue;a=changeAdventure(a,{type:'objective',id:o.id,status:'completed'});}
 }
 assert.equal(a.status,'completed');assert.equal(a.progress.filter(p=>p.completedTurn).length,10);assert.ok(a.turn.npcs.every(n=>!n.defeated));
 const nextWorld=structuredClone(w);nextWorld.places=nextWorld.places.filter(p=>p.id!=='farol');assert.throws(()=>assertMissionLocations([m],'env',nextWorld));
});
test('Worker turn endpoint executes combat and condition validation and reports errors',async()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';const a=make(mission([goal('win',defeated)]),r);
 const post=(adventure,command)=>worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure,command})}));
 const response=await post(a,{expectedTurn:0,seed:42,combat:{npcId:'captain'}});assert.equal(response.status,200);const next=await response.json();assert.equal(next.status,'completed');assert.equal(next.progress[0].completedTurn,1);
 assert.equal((await post(a,{expectedTurn:99})).status,400);
});
