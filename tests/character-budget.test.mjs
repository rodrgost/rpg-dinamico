import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCharacter,createNPCCharacter,createMiddleEarthCharacters,addMiddleEarthCharacters,simulateRound} from '../src/engine.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,validateAdventure} from '../src/adventure.mjs';
import worker from '../worker/index.js';
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url))),world=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url)));
function originalWorld(){const w=structuredClone(world);w.npcs.find(n=>n.id==='frodo').combatant.attributes={forca:0,habilidade:1,resistencia:3,armadura:1,poderFogo:0};w.npcs.find(n=>n.id==='gollum').combatant.attributes={forca:1,habilidade:3,resistencia:2,armadura:0,poderFogo:0};return w;}
test('Cael and the Middle-earth player examples each use eight points; adding is non-destructive and idempotent',()=>{
 const examples=createMiddleEarthCharacters(rules);assert.deepEqual(examples.map(c=>c.fields.origem),['Rohan','Valfenda','O Condado']);assert.ok(examples.every(c=>c.spent===8));assert.equal(examples[0].name,'Cael');assert.equal(examples[2].abilities.length,2);
 const custom={...examples[0],name:'Meu Cael'},roster=[custom];const next=addMiddleEarthCharacters(rules,roster);assert.equal(next.length,3);assert.equal(next[0],custom);assert.equal(next[0].name,'Meu Cael');assert.equal(roster.length,1);assert.deepEqual(addMiddleEarthCharacters(rules,next),next);
});
test('NPCs may use fewer points while player creation and standalone arena stay strict',()=>{
 const sheet={...originalWorld().npcs.find(n=>n.id==='frodo').combatant,id:'frodo',name:'Frodo'};assert.equal(createNPCCharacter(rules,sheet).spent,5);assert.throws(()=>createCharacter(rules,sheet),/5 usados/);
 const player=createMiddleEarthCharacters(rules)[0],npc=createNPCCharacter(rules,sheet);assert.throws(()=>simulateRound(rules,{combatants:[player,npc],choices:[{actionId:'attack_melee'},{actionId:'attack_melee'}],mode:'seeded',seed:1}),/5 usados/);
 const excess={...sheet,attributes:{forca:5,habilidade:5,resistencia:3,armadura:1,poderFogo:0}};assert.throws(()=>createNPCCharacter(rules,excess),/Orçamento excedido/);
});
test('Cael can enter an adventure with the original five-point Frodo and six-point Gollum and fight without point errors',async()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
 let a=createAdventure({name:'Cael na Terra Média',environmentId:'eriador',world:originalWorld(),rules:r,character:createMiddleEarthCharacters(r)[0],locationId:'bolsao'});a=changeAdventure(a,{type:'start'});
 assert.equal(a.turn.npcs.find(n=>n.id==='frodo').character.spent,5);assert.equal(a.turn.npcs.find(n=>n.id==='gollum').character.spent,6);
 const response=await worker.fetch(new Request('https://rpg.test/api/adventure/turn',{method:'POST',body:JSON.stringify({adventure:a,command:{expectedTurn:0,combat:{npcId:'frodo'},seed:1}})}));assert.equal(response.status,200,response.status===200?'':await response.clone().text());a=await response.json();assert.equal(a.turn.npcs.find(n=>n.id==='frodo').defeated,true);assert.deepEqual(validateAdventure(a),a);
});
test('budget errors identify whether the problem is the selected player or a named NPC',()=>{
 const hero=createMiddleEarthCharacters(rules)[0],bad=structuredClone(hero);bad.attributes={forca:0,habilidade:1,resistencia:3,armadura:1,poderFogo:0};assert.throws(()=>createAdventure({name:'Teste',environmentId:'eriador',world,rules,character:bad}),/Personagem “Cael”.*5 usados/);
 const w=structuredClone(world);w.npcs.find(n=>n.id==='frodo').combatant.attributes.forca=5;assert.throws(()=>createAdventure({name:'Teste',environmentId:'eriador',world:w,rules,character:hero}),/NPC “Frodo Bolseiro”.*Orçamento excedido/);
});
