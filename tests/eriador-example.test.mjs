import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {createScenarioTemplate,validateWorld} from '../src/world.mjs';
import {createCharacter} from '../src/engine.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,visibleAdventureNPCs} from '../src/adventure.mjs';
import {createMissionTemplate,validateMission} from '../src/mission.mjs';
const example=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url)));
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
const hero={id:'hero',name:'Viajante',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
test('Eriador is the actual hosted example and downloadable template, with all supplied places and residents',async()=>{
 const response=await worker.fetch(new Request('https://rpg.test/worlds/example.json'));assert.equal(response.status,200);assert.deepEqual(await response.json(),example);
 const normalized=validateWorld(example);assert.deepEqual(createScenarioTemplate(),normalized);assert.equal(normalized.name,'Eriador e Além');assert.equal(normalized.places.length,10);assert.equal(normalized.npcs.length,5);
 assert.equal(normalized.places.find(p=>p.id==='valfenda').parentId,'eriador');assert.equal(normalized.places.find(p=>p.id==='montanha-perdicao').parentId,'mordor');
 for(const n of normalized.npcs.filter(n=>n.combatant)){const c=createCharacter(rules,{...n.combatant,id:n.id,name:n.name});assert.equal(c.spent,8);assert.ok(c.fields.historia);}
 assert.match(normalized.npcs.find(n=>n.id==='frodo').combatant.fields.historia,/Ferroada e Cota de Mithril/);
 const m=createMissionTemplate({...normalized,id:'eriador'});assert.equal(validateMission(m,[{...normalized,id:'eriador'}]).execution,'formula');
});
test('Nazgul appears while Frodo is alive and disappears after Frodo is defeated by the combat engine',()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
 const journeyWorld=structuredClone(example);for(const p of journeyWorld.places)if(p.encounterTable)p.encounterTable.chance=0;
 let a=createAdventure({name:'Terra Média',environmentId:'eriador',world:journeyWorld,rules:r,character:hero,locationId:'bolsao'});a=changeAdventure(a,{type:'start'});
 assert.ok(visibleAdventureNPCs({...a,locationId:'mordor'}).some(n=>n.id==='espectro-anel'));
 assert.ok(visibleAdventureNPCs(a).some(n=>n.id==='frodo'));
 a=finishAdventureTurn(a,{expectedTurn:0,combat:{npcId:'frodo'},seed:123});assert.equal(a.turn.npcs.find(n=>n.id==='frodo').defeated,true);
 for(const placeId of ['condado','eriador','terra-media','mordor'])a=changeAdventure(a,{type:'move',placeId});
 assert.equal(visibleAdventureNPCs(a).some(n=>n.id==='espectro-anel'),false);assert.equal(a.status,'in_progress');
});
