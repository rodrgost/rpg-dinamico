import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {withEriadorEncounters} from '../src/world.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn,currentRegionalEncounter} from '../src/adventure.mjs';
import {createAdventureUI} from '../src/adventure-ui.mjs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
const source=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url))),rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url))),WK='3det-adaptavel-worlds-v2',AK='3det-adaptavel-adventures-v1';
function harness(initial=[]){const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch},stored=new Map(initial),handlers=new Map();let quota=false;
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(){return {focus(){},addEventListener(){},scrollIntoView(){}};}};globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem(k,v){if(quota)throw Error('quota');stored.set(k,v);}};globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};return {stored,dispatch,quota:value=>quota=value,click:dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})}),restore:()=>Object.assign(globalThis,old)};}
test('regional configuration previews examples and validates/saves atomically, preserving existing scenario and adventure snapshots',async()=>{
 const old=structuredClone(source);delete old.encounters;for(const p of old.places)delete p.encounterTable;
 const raw=JSON.stringify({schemaVersion:1,worlds:[{id:'eriador',world:old,selectedId:'condado'}],activeWorldId:'eriador'}),h=harness([[WK,raw],[AK,'untouched adventures']]);try{
  const module=readFileSync(new URL('../src/world-ui.mjs',import.meta.url),'utf8').replace(/from '\/([^']+)'/g,(_,name)=>'from '+JSON.stringify(new URL('../src/'+name,import.meta.url).href));const {createWorldUI}=await import('data:text/javascript;base64,'+Buffer.from(module).toString('base64'));let html='',ui;ui=createWorldUI({render:()=>{html=ui.html();},toast(){}});await ui.init();await h.click({environmentOpen:'eriador'});await h.click({worldAction:'encounters'});assert.match(html,/Encontros de região/);assert.match(html,/Nenhum modelo cadastrado/);
  await h.click({worldAction:'encounter-examples'});assert.match(html,/id="encounter-config-form"/);assert.match(html,/salteadores/);assert.equal(h.stored.get(WK),raw);
  const example=withEriadorEncounters(old),config={encounters:example.encounters,placeTables:Object.fromEntries(example.places.filter(p=>p.encounterTable).map(p=>[p.id,p.encounterTable]))};await h.dispatch('input',{id:'encounter-config',dataset:{},value:JSON.stringify(config)});
  h.quota(true);await h.dispatch('submit',{id:'encounter-config-form'});assert.equal(h.stored.get(WK),raw);assert.equal(ui.getEnvironmentSnapshot('eriador').encounters,undefined);assert.match(html,/Não foi possível salvar os encontros/);h.quota(false);
  await h.dispatch('submit',{id:'encounter-config-form'});assert.equal(ui.getEnvironmentSnapshot('eriador').encounters.length,4);assert.equal(h.stored.get(AK),'untouched adventures');assert.match(html,/Lobos nas trilhas/);assert.match(html,/Bloquear/);
  const saved=h.stored.get(WK);await h.click({worldAction:'edit-encounters'});config.placeTables.eriador.chance=101;await h.dispatch('input',{id:'encounter-config',dataset:{},value:JSON.stringify(config)});await h.dispatch('submit',{id:'encounter-config-form'});assert.equal(h.stored.get(WK),saved);assert.match(html,/Chance de encontro/);
 }finally{h.restore();}
});
function occurrence(r=rules){const w=structuredClone(source);w.places.find(p=>p.id==='condado').encounterTable={mode:'replace',chance:100,cooldownTurns:3,entries:[{encounterId:'lobos',weight:1}]};let a=createAdventure({name:'Lobos no Condado',world:w,rules:r,character:createMiddleEarthCharacters(r)[0],environmentId:'eriador',locationId:'bolsao'});a=changeAdventure(a,{type:'start'});return finishAdventureTurn(a,{expectedTurn:0,move:{placeId:'condado'},seed:1});}
test('adventure shows a saved encounter before combat; choice handles network/storage failure then persists resolution without rerolling',async()=>{
 const a=occurrence();Object.assign(a.snapshot.world.encounters.find(t=>t.id==='lobos'),{hostile:false,options:JSON.parse(readFileSync(new URL('./fixtures/legacy-regional-options.json',import.meta.url))).lobos});const h=harness([[AK,JSON.stringify({schemaVersion:1,adventures:[a]})]]);try{
  let ui,html='';const config={render:()=>{html=ui.html();},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getRules:()=>rules,getCharacters:()=>[],getEnvironmentSnapshot:()=>a.snapshot.world};ui=createAdventureUI(config);ui.init();await h.click({adventureOpen:a.id});assert.match(html,/id="regional-encounter"/);assert.match(html,/Lobos nas trilhas/);assert.doesNotMatch(html,/id="adventure-combat"/);assert.match(html,/data-adventure-move="eriador" disabled/);
  const before=h.stored.get(AK),npc=currentRegionalEncounter(a).occurrence.participants[0].id;await h.click({adventureFight:npc});assert.match(html,/id="adventure-combat"/);assert.equal(h.stored.get(AK),before);await h.click({adventureAction:'close-combat'});
  const fetchOk=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Sem conexão');};await h.click({adventureEncounterChoice:'contornar',encounterId:'enc-1'});assert.equal(h.stored.get(AK),before);assert.match(html,/Sem conexão/);globalThis.fetch=fetchOk;
  h.quota(true);await h.click({adventureEncounterChoice:'contornar',encounterId:'enc-1'});assert.equal(h.stored.get(AK),before);assert.match(html,/Não foi possível salvar a aventura/);h.quota(false);
  await h.click({adventureEncounterChoice:'contornar',encounterId:'enc-1'});const saved=JSON.parse(h.stored.get(AK)).adventures[0];assert.equal(saved.turn.number,2);assert.equal(saved.encounters.occurrences[0].resolution,'contornar');assert.doesNotMatch(html,/id="regional-encounter"/);assert.doesNotMatch(html,/Encontro encerrado|regional-result/);
  const reload=createAdventureUI({...config,render(){}});reload.init();await h.click({adventureOpen:a.id});assert.doesNotMatch(reload.html(),/Encontro encerrado|regional-result/);assert.equal(JSON.parse(h.stored.get(AK)).adventures[0].encounters.occurrences.length,1);
 }finally{h.restore();}
});
test('regional enemy combat runs through the existing inline battle and displays its persisted victory',async()=>{
 const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';const a=occurrence(r),h=harness([[AK,JSON.stringify({schemaVersion:1,adventures:[a]})]]);try{
  let ui,html='';ui=createAdventureUI({render:()=>{html=ui.html();},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getRules:()=>r,getCharacters:()=>[],getEnvironmentSnapshot:()=>a.snapshot.world});ui.init();await h.click({adventureOpen:a.id});await h.click({adventureFight:currentRegionalEncounter(a).occurrence.participants[0].id});await h.click({adventureAction:'combat-turn'});const saved=JSON.parse(h.stored.get(AK)).adventures[0];assert.equal(saved.encounters.occurrences[0].resolution,'victory');assert.equal(saved.turn.number,2);assert.match(html,/Todos os adversários do encontro foram derrotados/);assert.match(html,/dano 100/);
 }finally{h.restore();}
});
test('hostile NPC hides conversation, exposes escape, preserves state on request/storage failure and closes only after successful escape',async()=>{
 const r=structuredClone(rules);r.actions.find(v=>v.kind==='test').formula='0';r.actions.filter(v=>v.kind==='attack').forEach(v=>v.formula='100');r.combat.defense='0';r.combat.damage='3';
 const w=structuredClone(source);let a=changeAdventure(createAdventure({name:'Uruk-hai hostil',world:w,rules:r,character:createMiddleEarthCharacters(r)[0],environmentId:'eriador',locationId:'rohan'}),{type:'start'});
 const h=harness([[AK,JSON.stringify({schemaVersion:1,adventures:[a]})]]);try{
  let ui,html='';ui=createAdventureUI({render:()=>{html=ui.html();},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getRules:()=>r,getCharacters:()=>[],getEnvironmentSnapshot:()=>w});ui.init();await h.click({adventureOpen:a.id});assert.doesNotMatch(html,/data-adventure-talk="uruk-hai-batedor"/);assert.match(html,/Hostil/);await h.click({adventureFight:'uruk-hai-batedor'});assert.match(html,/data-adventure-flee="uruk-hai-batedor"/);assert.match(html,/Habilidade ≥ 6/);
  const before=h.stored.get(AK),fetchOk=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Sem rede');};await h.click({adventureFlee:'uruk-hai-batedor'});assert.equal(h.stored.get(AK),before);assert.match(html,/Sem rede/);globalThis.fetch=fetchOk;
  h.quota(true);await h.click({adventureFlee:'uruk-hai-batedor'});assert.equal(h.stored.get(AK),before);h.quota(false);
  await h.click({adventureFlee:'uruk-hai-batedor'});let saved=JSON.parse(h.stored.get(AK)).adventures[0];assert.equal(saved.turn.character.hp,7);assert.equal(saved.turn.number,1);assert.match(html,/id="adventure-combat"/);assert.match(html,/ataque de resposta/);
  // Reload and make the next legal test certain to succeed; the adventure still carries prior HP loss.
  saved.snapshot.rules.actions.find(v=>v.kind==='test').formula='100';h.stored.set(AK,JSON.stringify({schemaVersion:1,adventures:[saved]}));const reload=createAdventureUI({render(){},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getRules:()=>r,getCharacters:()=>[],getEnvironmentSnapshot:()=>w});reload.init();await h.click({adventureOpen:a.id});await h.click({adventureFight:'uruk-hai-batedor'});await h.click({adventureFlee:'uruk-hai-batedor'});saved=JSON.parse(h.stored.get(AK)).adventures[0];assert.equal(saved.turn.number,2);assert.equal(saved.turn.character.hp,7);assert.doesNotMatch(reload.html(),/id="adventure-combat"/);assert.match(reload.html(),/Você escapou/);
 }finally{h.restore();}
});
test('hostile regional encounter offers combat and tested escape, without generic narrative branches',async()=>{
 const a=occurrence(),h=harness([[AK,JSON.stringify({schemaVersion:1,adventures:[a]})]]);try{
  let ui,html='';ui=createAdventureUI({render:()=>{html=ui.html();},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getRules:()=>rules,getCharacters:()=>[],getEnvironmentSnapshot:()=>a.snapshot.world});ui.init();await h.click({adventureOpen:a.id});assert.match(html,/Encontro hostil/);assert.match(html,/data-adventure-flee/);assert.doesNotMatch(html,/data-adventure-encounter-choice/);assert.match(html,/data-adventure-fight/);
 }finally{h.restore();}
});
