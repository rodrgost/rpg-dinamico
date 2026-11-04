import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAdventure,changeAdventure,finishAdventureTurn,validateAdventure,upgradeAdventure,availableMissionOffers,visibleAdventureNPCs} from '../src/adventure.mjs';
import {createMissionTemplate,validateMission} from './legacy-models.mjs';
import worker from './legacy-worker.mjs';
const world=JSON.parse(readFileSync(new URL('./fixtures/porto-aurora.json',import.meta.url)));
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
const hero={id:'hero',name:'Exploradora',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
const env={...world,id:'world'};
const create=()=>createAdventure({name:'Explorar',world,rules,character:hero,environmentId:env.id,locationId:'portao-norte'});
const start=()=>changeAdventure(create(),{type:'start'});
const quest=(id,placeId='praca-central')=>({schemaVersion:1,id,environmentId:env.id,name:id,description:'Um pedido',offer:{type:'notice',placeId,npcId:null,title:'Examinar aviso',description:'Precisa de ajuda'},npcs:[{id:'enemy',name:'Oponente',description:'Oponente deste pedido',placeId,combatant:{attributes:{forca:2,habilidade:1,resistencia:1,armadura:1,poderFogo:3},abilities:[],fields:{perfil:'Outro'}}}],facts:[{id:'evidence',name:'Evidência',initialValue:false}],objectives:[{id:'done',type:'combat',title:'Resolver confronto',status:'pending',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{type:'npc_defeated',npcId:'enemy'}}}]});
test('adventure explores and ends turns without any mission; acceptance requires local proposal and does not mutate model',()=>{
 let a=start();assert.equal(a.quests.length,0);assert.ok(visibleAdventureNPCs(a).some(n=>n.id==='guarda-portao'));
 a=finishAdventureTurn(a,{expectedTurn:0});assert.equal(a.status,'in_progress');assert.equal(a.turn.number,1);
 const m=quest('first');assert.equal(availableMissionOffers(a,[m]).length,0);assert.throws(()=>changeAdventure(a,{type:'accept',mission:m}),/disponível/);
 a=changeAdventure(a,{type:'move',placeId:'praca-central'});assert.equal(availableMissionOffers(a,[m]).length,1);assert.equal(a.quests.length,0);
 a=changeAdventure(a,{type:'accept',mission:m});assert.equal(a.quests.length,1);assert.equal(a.quests[0].progress[0].status,'pending');assert.equal(a.quests[0].turn.number,2);
 assert.throws(()=>changeAdventure(a,{type:'accept',mission:m}),/já foi aceita/);assert.equal(m.objectives[0].status,'pending');
 assert.deepEqual(validateAdventure(JSON.parse(JSON.stringify(a))),a);
});
test('simultaneous missions isolate repeated NPC, fact and objective IDs; finishing one keeps exploration active',async()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
 let a=changeAdventure(createAdventure({name:'Many',world,rules:r,character:hero,environmentId:env.id,locationId:'praca-central'}),{type:'start'});
 a=changeAdventure(a,{type:'accept',mission:quest('first')});a=changeAdventure(a,{type:'accept',mission:quest('second')});
 assert.ok(visibleAdventureNPCs(a).some(n=>n.id==='q0_enemy'));assert.ok(visibleAdventureNPCs(a).some(n=>n.id==='q1_enemy'));
 a=changeAdventure(a,{type:'fact',id:'evidence',value:true,missionId:'first'});assert.equal(a.quests[0].turn.facts[0].value,true);assert.equal(a.quests[1].turn.facts[0].value,false);
 const response=await worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adventure:a,command:{expectedTurn:0,combat:{npcId:'q0_enemy'},seed:123}})}));
 assert.equal(response.status,200,response.status===200?'':await response.clone().text());a=validateAdventure(await response.json());assert.equal(a.quests[0].status,'completed');assert.equal(a.quests[1].status,'in_progress');assert.equal(a.status,'in_progress');
 assert.equal(a.turn.npcs.find(n=>n.id==='q0_enemy').defeated,true);assert.equal(a.turn.npcs.find(n=>n.id==='q1_enemy').defeated,false);
 a=finishAdventureTurn(a,{expectedTurn:1});assert.equal(a.turn.number,2);assert.equal(a.status,'in_progress');
 a=changeAdventure(a,{type:'move',placeId:'taverna'});assert.equal(a.locationId,'taverna');
 assert.throws(()=>finishAdventureTurn(a,{expectedTurn:a.turn.number,combat:{npcId:'q1_enemy'}}),/localização/);
});
test('NPC requests require an existing resident at the offer location and conversation remains independent of acceptance',()=>{
 let a=changeAdventure(start(),{type:'move',placeId:'praca-central'});const m=quest('npc-request');m.offer={...m.offer,type:'npc',npcId:'vera-mensageira'};
 validateMission(m,[env]);assert.equal(availableMissionOffers(a,[m]).length,1);
 a=changeAdventure(a,{type:'talk',id:'vera-mensageira'});assert.equal(a.quests.length,0);assert.match(a.journal.at(-1).text,/Conversou com Vera/);
 assert.throws(()=>validateMission({...m,offer:{...m.offer,npcId:'mara-taverneira'}},[env]),/NPC da oferta/);
 assert.throws(()=>changeAdventure(a,{type:'accept',mission:{...m,environmentId:'other'}}),/Cenário/);
});
test('legacy adventure upgrades with its completed progress, HP, location and history preserved',()=>{
 let old=createAdventure({name:'Anterior',world,rules,character:hero,mission:createMissionTemplate(env)});
 old=changeAdventure(old,{type:'start'});old=changeAdventure(old,{type:'move',placeId:'praca-central'});
 old=changeAdventure(old,{type:'objective',id:'ouvir-pedido',status:'completed'});
 const a=upgradeAdventure(old);assert.equal(a.schemaVersion,2);assert.equal(a.id,old.id);assert.equal(a.locationId,old.locationId);assert.equal(a.quests[0].progress[0].status,'completed');assert.deepEqual(a.journal,old.journal);assert.equal(a.turn.character.hp,old.turn.character.hp);
 assert.deepEqual(upgradeAdventure(a),a);
});
test('environment combat shares a single resident state with all accepted missions',()=>{
 const w=structuredClone(world),r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
 w.npcs.find(n=>n.id==='guarda-portao').combatant=quest('sheet').npcs[0].combatant;
 let a=changeAdventure(createAdventure({name:'Shared',world:w,rules:r,character:hero,environmentId:env.id,locationId:'portao-norte'}),{type:'start'});
 assert.equal('mission' in a.snapshot,false);assert.equal('progress' in a,false);
 for(const id of ['one','two']){const m=quest(id,'portao-norte');m.npcs=[{id:'guarda-portao',environmentNpcId:'guarda-portao'}];m.objectives[0].completion.condition.npcId='guarda-portao';a=changeAdventure(a,{type:'accept',mission:m});}
 assert.equal(a.turn.npcs.filter(n=>n.id==='guarda-portao').length,1);
 a=finishAdventureTurn(a,{expectedTurn:0,combat:{npcId:'guarda-portao'},seed:123});
 assert.ok(a.quests.every(q=>q.status==='completed'));assert.equal(a.status,'in_progress');assert.equal(a.turn.number,1);
 assert.equal(a.turn.npcs.find(n=>n.id==='guarda-portao').defeated,true);
});
