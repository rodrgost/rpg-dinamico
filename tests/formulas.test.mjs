import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFormula,calculateBoolean} from '../src/world.mjs';
import {validateMission,createMissionTemplate,evaluateMissionCondition} from '../src/mission.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,validateAdventure,availableAdventureActivities,reachableAdventurePlaces} from '../src/adventure.mjs';
import worker from './legacy-worker.mjs';
const world=JSON.parse(readFileSync(new URL('./fixtures/porto-aurora.json',import.meta.url)));
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
const character={id:'hero',name:'Exploradora',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
const ref=ref=>({ref}),eq=(left,right)=>({operator:'eq',left,right});
const success=id=>({operator:'gte',left:ref('acoes.'+id+'.sucessos'),right:1});
const env={...world,id:'env'};
function model(){return {schemaVersion:1,id:'formula-mission',environmentId:env.id,name:'Documento',execution:'formula',offer:{type:'notice',placeId:'taverna',title:'Um pedido',description:'Busque e entregue a carta'},npcs:[{id:'mara-taverneira',environmentNpcId:'mara-taverneira'}],items:[{id:'carta',name:'Carta'}],actions:[{id:'buscar',name:'Coletar carta',kind:'collect',placeId:'taverna',itemId:'carta',quantity:1},{id:'entregar',name:'Entregar carta a Mara',kind:'deliver',placeId:'taverna',npcId:'mara-taverneira',itemId:'carta',quantity:1,condition:eq(ref('objetivos.encontrar.concluido'),true)}],objectives:[{id:'encontrar',type:'find_item',title:'Encontrar carta',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'gte',left:ref('inventario.carta.quantidade'),right:1}}},{id:'entregar-objetivo',type:'help_someone',title:'Entregar carta',status:'pending',dependsOn:['encontrar'],completion:{mode:'automatic',evaluateAt:'turn_end',condition:success('entregar')}}],completion:{operator:'and',operands:[eq(ref('objetivos.entregar-objetivo.concluido'),true),eq(ref('local.id'),'taverna')]}};}
function accepted(m=model(),r=rules){let a=createAdventure({name:'Fórmulas',environmentId:env.id,locationId:'taverna',world,rules:r,character});a=changeAdventure(a,{type:'start'});return changeAdventure(a,{type:'accept',mission:m});}
const act=(a,id,seed=10)=>finishAdventureTurn(a,{expectedTurn:a.turn.number,activity:{missionId:a.selectedMissionId,actionId:id},seed});
test('typed boolean formulas calculate AND OR NOT and comparisons without coercion or arbitrary access',()=>{
 const expression={operator:'and',operands:[{operator:'gte',left:ref('inventario.carta.quantidade'),right:1},{operator:'not',operand:eq(ref('npcs.bandido.derrotado'),false)}]};
 assert.equal(calculateBoolean(expression,r=>r.scope==='inventario'?1:true),true);
 for(const operator of ['gt','gte','lt','lte','eq','ne'])assert.equal(typeof calculateBoolean({operator,left:2,right:1},()=>null),'boolean');
 assert.equal(calculateBoolean({operator:'or',operands:[false,true]},()=>null),true);
 for(const bad of [ref('personagem.hp'),{operator:'gte',left:true,right:1},eq(1,'1'),eq(ref('npcs.constructor.derrotado'),true),eq(ref('window.alert'),1),eq(ref('toString.x.name'),'x'),{operator:'eval',left:'alert(1)',right:1},{operator:'and',operands:[]}])assert.throws(()=>validateFormula(bad));
 assert.throws(()=>calculateBoolean(eq(ref('personagem.hp'),1),()=>true),/Valor inválido/);
 let nested=true;for(let i=0;i<10;i++)nested={operator:'not',operand:nested};assert.throws(()=>validateFormula(nested),/níveis/);
});
test('formulas validate IDs, types, cycles and rules attributes before a mission can run',()=>{
 for(const scope of ['inventario','acoes','objetivos','npcs','fatos']){
  const m=model();m.objectives[0].completion.condition=eq(ref(scope+'.missing.'+({inventario:'quantidade',acoes:'sucessos',objetivos:'concluido',npcs:'derrotado',fatos:'valor'}[scope])),['npcs','objetivos','fatos'].includes(scope)?true:1);
  assert.throws(()=>validateMission(m,[env]),/inexistente/);
 }
 const cyclic=model();cyclic.objectives[0].completion.condition=eq(ref('objetivos.entregar-objetivo.concluido'),true);assert.throws(()=>validateMission(cyclic,[env]),/Ciclo/);
 const attribute=model();attribute.actions.push({id:'teste',name:'Teste',kind:'test',attribute:'missing',difficulty:5,placeId:'taverna'});assert.throws(()=>accepted(attribute),/Atributo/);
 const hp=model();hp.completion=eq(ref('npcs.mara-taverneira.hp'),0);assert.throws(()=>accepted(hp),/sem ficha/);
 const manual=model();delete manual.objectives[0].completion;assert.throws(()=>validateMission(manual,[env]),/Toda conclusão/);
});
test('collect and deliver update inventory, trigger fixed-point objectives and mission completion, and preserve latches after moving',async()=>{
 let a=accepted();const original=structuredClone(a);
 assert.throws(()=>act(a,'entregar'),/Pré-condição/);assert.deepEqual(a,original);
 for(const command of [{type:'objective',id:'encontrar',status:'completed'},{type:'fact',id:'fake',value:true},{type:'npc',id:'mara-taverneira',defeated:true}])assert.throws(()=>changeAdventure(a,command),/sistema|ações|combate/);
 a=act(a,'buscar');assert.equal(a.inventory[0].quantity,1);assert.equal(a.quests[0].progress[0].status,'completed');assert.equal(a.quests[0].status,'in_progress');
 assert.throws(()=>act(a,'buscar'),/já realizada/);
 const response=await worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure:a,command:{expectedTurn:a.turn.number,activity:{missionId:a.selectedMissionId,actionId:'entregar'}}})}));
 assert.equal(response.status,200,response.status===200?'':await response.clone().text());a=await response.json();
 assert.equal(a.inventory[0].quantity,0);assert.equal(a.quests[0].status,'completed');assert.equal(a.status,'in_progress');assert.equal(a.turn.number,2);
 a=changeAdventure(a,{type:'move',placeId:'porto-aurora'});a=finishAdventureTurn(a,{expectedTurn:a.turn.number});assert.equal(a.quests[0].status,'completed');assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(a))),a);
});
test('rule-based tests are reproducible with a seed, record failure, retry and success with no manual completion',()=>{
 const m=model();m.actions=[{id:'teste',name:'Decifrar código',kind:'test',placeId:'taverna',attribute:'habilidade',difficulty:6}];m.items=[];m.objectives=[{id:'teste-objetivo',title:'Decifrar código',type:'skill_test',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:success('teste')}}];m.completion=eq(ref('objetivos.teste-objetivo.concluido'),true);
 const a=accepted(m);let low,high;
 for(let seed=0;seed<100;seed++){const result=act(a,'teste',seed);if(result.quests[0].turn.activities[0].successes===0)low=seed;else high=seed;if(low!==undefined && high!==undefined)break;}
 assert.notEqual(low,undefined);assert.notEqual(high,undefined);assert.deepEqual(act(a,'teste',high).turn.history.at(-1).events,act(a,'teste',high).turn.history.at(-1).events);
 let failed=act(a,'teste',low);assert.equal(failed.quests[0].progress[0].status,'pending');assert.match(failed.turn.history.at(-1).events.join(' '),/falha/);
 failed=act(failed,'teste',high);assert.equal(failed.quests[0].status,'completed');assert.equal(failed.quests[0].turn.activities[0].attempts,2);
});
test('Porto Aurora default is fully playable through programmed actions and peaceful alternatives',()=>{
 const m=createMissionTemplate(env);assert.equal(m.execution,'formula');assert.equal(m.objectives.length,24);assert.ok(m.objectives.every(o=>o.completion.mode==='automatic'));assert.equal(m.facts.length,0);
 const r=structuredClone(rules);r.actions.find(a=>a.kind==='test').formula='100';
 let a=createAdventure({name:'Porto completo',world,rules:r,character,environmentId:env.id,locationId:'praca-central'});a=changeAdventure(a,{type:'start'});a=changeAdventure(a,{type:'accept',mission:m});
 function moveTo(destination){
  if(destination===null || destination===a.locationId)return;
  const queue=[[a.locationId,[]]],seen=new Set([a.locationId]);
  while(queue.length){const [locationId,path]=queue.shift();if(locationId===destination){for(const placeId of path)a=changeAdventure(a,{type:'move',placeId});return;}
   for(const p of reachableAdventurePlaces({...a,locationId})){if(!seen.has(p.id)){seen.add(p.id);queue.push([p.id,[...path,p.id]]);}}
  }throw new Error('Destino inacessível');
 }
 for(let pass=0;pass<60 && a.quests[0].status!=='completed';pass++){
  let selected;
  for(const action of m.actions){if(a.quests[0].turn.activities.find(s=>s.id===action.id).successes>0 || action.condition!==undefined && !evaluateMissionCondition(action.condition,a.quests[0]).met)continue;moveTo(action.placeId);const available=availableAdventureActivities(a).find(x=>x.id===action.id && !x.blocked);if(available){selected=action;break;}}
  assert.ok(selected,'Precisa haver uma próxima ação executável');a=act(a,selected.id);
 }
 assert.equal(a.quests[0].status,'completed');assert.equal(a.quests[0].progress.filter(p=>p.status==='completed').length,24);assert.equal(a.status,'in_progress');assert.ok(a.inventory.some(i=>i.quantity>0));
});
test('mission formula can require an additional action after every required objective is complete',()=>{
 const m=model();m.actions.push({id:'confirmar',name:'Confirmar recebimento',kind:'talk',placeId:'taverna',npcId:'mara-taverneira',condition:eq(ref('objetivos.entregar-objetivo.concluido'),true)});m.completion=success('confirmar');
 let a=act(act(accepted(m),'buscar'),'entregar');assert.ok(a.quests[0].progress.every(p=>p.status==='completed'));assert.equal(a.quests[0].status,'in_progress');
 a=act(a,'confirmar');assert.equal(a.quests[0].status,'completed');assert.equal(a.turn.number,3);
});
