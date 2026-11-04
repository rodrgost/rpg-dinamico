import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRules,createMiddleEarthCharacters,simulateEscape,escapeRule} from '../src/engine.mjs';
import {createScenarioTemplate,validateWorld,validateNPC,scenarioLLMPrompt} from '../src/world.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,currentRegionalEncounter,validateAdventure} from '../src/adventure.mjs';
import worker from '../worker/index.js';
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
function fixture({regional=false,success=false}={}){
 const r=structuredClone(rules);r.actions.find(a=>a.kind==='test').formula=success?'100':'0';r.actions.filter(a=>a.kind==='attack').forEach(a=>a.formula='100');r.combat.defense='0';r.combat.damage='3';
 const world=createScenarioTemplate();for(const p of world.places)p.encounterTable={mode:'none',entries:[]};
 if(regional)world.places.find(p=>p.id==='condado').encounterTable={mode:'replace',chance:100,entries:[{encounterId:'lobos',weight:1}]};
 let a=changeAdventure(createAdventure({name:'Hostilidade e fuga',world,rules:r,character:createMiddleEarthCharacters(r)[0],environmentId:'eriador',locationId:regional?'bolsao':'rohan'}),{type:'start'});
 if(regional)a=finishAdventureTurn(a,{expectedTurn:0,move:{placeId:'condado'},seed:1});
 return a;
}
const flee=(a,npcId='uruk-hai-batedor')=>finishAdventureTurn(a,{expectedTurn:a.turn.number,flee:{npcId},seed:2});
async function api(a,command){return worker.fetch(new Request('https://test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure:a,command})}));}
test('hostility is explicit, validated and editable, with backward-compatible canonical enemy defaults',()=>{
 const w=createScenarioTemplate(),uruk=w.npcs.find(n=>n.id==='uruk-hai-batedor');assert.equal(uruk.hostile,true);assert.equal(w.npcs.find(n=>n.id==='frodo').hostile,false);assert.equal(w.npcs.find(n=>n.id==='gollum').hostile,false);
 const old=structuredClone(uruk);delete old.hostile;assert.equal(validateNPC(old).hostile,true);assert.equal(validateNPC({...old,hostile:false}).hostile,false);
 assert.throws(()=>validateNPC({...uruk,hostile:'true'}),/hostil/);assert.throws(()=>validateNPC({...uruk,combatant:null}),/hostil/);
 const invalid=structuredClone(w);invalid.encounters.find(e=>e.id==='mercador-viajante').hostile=true;assert.throws(()=>validateWorld(invalid),/hostil/);
 assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(w))),w);assert.match(scenarioLLMPrompt(),/hostile/);assert.match(scenarioLLMPrompt(),/combat.escape/);
 const r=structuredClone(rules);r.combat.escape.attribute='unknown';assert.throws(()=>validateRules(r),/Fuga/);r.combat.escape.attribute='habilidade';r.combat.escape.difficulty=-1;assert.throws(()=>validateRules(r),/Fuga/);
});
test('escape evaluates the configured attribute and gives exactly one response attack, with normal defense and damage',()=>{
 const a=fixture(),hero=a.turn.character,npc=a.turn.npcs.find(n=>n.id==='uruk-hai-batedor').character,before=JSON.stringify(a);
 const failed=simulateEscape(a.snapshot.rules,hero,npc,{seed:2});assert.equal(failed.success,false);assert.equal(failed.hero.hp,hero.hp-3);assert.equal(failed.npc.hp,npc.hp);assert.equal(failed.events.length,2);assert.match(failed.events[1],/ataque de resposta/);assert.equal(JSON.stringify(a),before);
 const r=structuredClone(a.snapshot.rules);r.actions.find(v=>v.kind==='test').formula='actor[input.attribute]';r.combat.escape={attribute:'forca',difficulty:3};assert.equal(simulateEscape(r,hero,npc).success,true);r.combat.escape.attribute='habilidade';assert.equal(simulateEscape(r,hero,npc).success,false);
 r.combat.defense='200';assert.equal(simulateEscape(r,hero,npc).hero.hp,hero.hp);assert.match(simulateEscape(r,hero,npc).events[1],/dano 0/);
 delete r.combat.escape;assert.deepEqual(escapeRule(r),{attribute:'habilidade',difficulty:6});
});
test('resident escape success costs one turn without defeating the NPC; failure persists damage and reevaluates mission formulas',async()=>{
 let a=fixture();const m={schemaVersion:1,id:'escape-turn',environmentId:'eriador',name:'Sobreviver ao turno',execution:'formula',offer:{type:'notice',placeId:'rohan',title:'Avançar',description:'Chegar ao próximo turno'},objectives:[{id:'done',type:'other',title:'Completar um turno',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'gte',left:{ref:'turno.numero'},right:1}}}]};
 a=changeAdventure(a,{type:'accept',mission:m});const before=JSON.stringify(a),response=await api(a,{expectedTurn:0,flee:{npcId:'uruk-hai-batedor'},seed:2});assert.equal(response.status,200,await response.clone().text());const next=await response.json();assert.equal(next.turn.number,1);assert.equal(next.turn.character.hp,7);assert.equal(next.quests[0].turn.character.hp,7);assert.equal(next.quests[0].status,'completed');assert.equal(next.turn.npcs.find(n=>n.id==='uruk-hai-batedor').defeated,false);assert.equal(JSON.stringify(a),before);assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(next))),next);
 const successful=flee(fixture({success:true}));assert.equal(successful.turn.character.hp,10);assert.equal(successful.turn.number,1);assert.match(successful.turn.history.at(-1).events[0],/Você escapou/);
 assert.throws(()=>changeAdventure(a,{type:'talk',id:'uruk-hai-batedor'}),/conversar/);
 for(const command of [{expectedTurn:99,flee:{npcId:'uruk-hai-batedor'}},{expectedTurn:0,flee:{npcId:'frodo'}},{expectedTurn:0,flee:{npcId:'uruk-hai-batedor'},move:{placeId:'edoras'}}])assert.equal((await api(a,command)).status,400);
});
test('hostile regional encounter blocks narrative bypass, persists failed escape and resolves a successful escape without a kill',()=>{
 let a=fixture({regional:true}),e=currentRegionalEncounter(a),id=e.occurrence.participants[0].id;
 // Old imported models may contain narrative branches: hostility takes precedence.
 a.snapshot.world.encounters.find(t=>t.id==='lobos').options.push({id:'skip',label:'Ignorar',kind:'resolve',text:'Ignorou',duringCombat:false});
 assert.throws(()=>finishAdventureTurn(a,{expectedTurn:1,encounter:{occurrenceId:e.occurrence.id,optionId:'skip'}}),/hostil/);
 a=flee(a,id);assert.equal(a.turn.number,2);assert.equal(a.turn.character.hp,7);assert.equal(currentRegionalEncounter(a).occurrence.status,'combat');assert.equal(currentRegionalEncounter(validateAdventure(a)).occurrence.id,e.occurrence.id);
 a.snapshot.rules.actions.find(t=>t.kind==='test').formula='100';a=flee(a,id);assert.equal(a.turn.number,3);assert.equal(a.turn.character.hp,7);assert.equal(currentRegionalEncounter(a),null);assert.equal(a.encounters.occurrences[0].resolution,'escaped');assert.equal(a.encounters.occurrences[0].participants[0].defeated,false);assert.deepEqual(validateAdventure(a),a);
});
test('failed escape can incapacitate the hero and closes the regional encounter as defeat',()=>{
 let a=fixture({regional:true});a.snapshot.rules.combat.damage='100';a=flee(a,currentRegionalEncounter(a).occurrence.participants[0].id);assert.equal(a.turn.character.hp,0);assert.equal(currentRegionalEncounter(a),null);assert.equal(a.encounters.occurrences[0].resolution,'defeat');assert.equal(a.encounters.occurrences[0].participants[0].defeated,false);
});
