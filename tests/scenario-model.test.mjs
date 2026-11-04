import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGatewayScenarioTemplate,createScenarioTemplate,scenarioLLMPrompt,validateWorld} from '../src/world.mjs';
import {createAdventure} from '../src/adventure.mjs';
import worker from '../worker/index.js';
test('complete scenario model round-trips with hierarchy, coordinates, NPC variants and playable 3D&T sheets',async()=>{
 const model=createScenarioTemplate();assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(model))),model);
 assert.equal(model.name,'Eriador e Além');assert.equal(model.places.length,10);assert.equal(model.npcs.length,5);assert.ok(model.places.every(p=>p.x!==null && p.y!==null));assert.ok(model.places.some(p=>p.parentId!==null && p.x!==null));assert.ok(model.npcs.some(n=>n.combatant));assert.ok(model.npcs.some(n=>n.presence?.operator));
 const rules=JSON.parse(await readFile(new URL('../src/rules.json',import.meta.url)));const character={id:'hero',name:'Herói',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
 const a=createAdventure({name:'Modelo',environmentId:'model',world:model,rules,character,locationId:'bolsao'});assert.equal(a.turn.npcs.length,model.npcs.length);
 const prompt=scenarioLLMPrompt();assert.match(prompt,/240 KB/);assert.match(prompt,/Não inclua id, environmentId ou scenarioId na raiz/);assert.match(prompt,/npcs.ID.derrotado/);assert.ok(prompt.includes(JSON.stringify(model,null,2)));
});
test('scenario guide downloads valid model and full prompt then imports as new without altering existing scenarios, including empty collections',async()=>{
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};const handlers=new Map(),stored=new Map(),downloads=[];let ui,html='';
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(){return {addEventListener(){},focus(){},click(){},select(){}};},createElement(){return {click(){downloads.push({url:this.href,name:this.download});}};}};
 globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 const click=async dataset=>{for(const fn of handlers.get('click')||[])await fn({target:{closest:()=>({dataset,disabled:false})},preventDefault(){}});};
 try{
  const source=(await readFile(new URL('../src/world-ui.mjs',import.meta.url),'utf8')).replace(/from '\/([^']+)'/g,(_,f)=>'from '+JSON.stringify(new URL('../src/'+f,import.meta.url).href));
  const {createWorldUI}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  ui=createWorldUI({render(){html=ui.html();},toast(){}});await ui.init();const initial=ui.getEnvironments()[0];const before=stored.get('3det-adaptavel-worlds-v2');
  await click({worldAction:'model'});assert.match(html,/Modelo de importação de cenário/);assert.match(html,/Baixar modelo .json/);assert.equal(stored.get('3det-adaptavel-worlds-v2'),before);
  await click({worldAction:'download-model'});await click({worldAction:'download-prompt'});
  assert.equal(downloads[0].name,'cenario-modelo-completo.json');assert.deepEqual(validateWorld(JSON.parse(await (await old.fetch(downloads[0].url)).text())),createGatewayScenarioTemplate());assert.match(await (await old.fetch(downloads[1].url)).text(),/CONTRATO/);
  await click({worldAction:'model-editor'});assert.match(html,/Importar novo cenário/);await click({worldAction:'apply'});assert.match(html,/Adicionar cenário/);await click({worldAction:'replace'});assert.equal(ui.getEnvironments().length,2);assert.deepEqual(ui.getEnvironments().find(e=>e.id===initial.id),initial);
  for(const env of ui.getEnvironments())await click({environmentDelete:env.id});assert.equal(ui.getEnvironments().length,0);
  await click({worldAction:'model'});assert.match(html,/Modelo JSON completo/);await click({worldAction:'model-editor'});await click({worldAction:'apply'});await click({worldAction:'replace'});assert.equal(ui.getEnvironments().length,1);assert.equal(ui.getEnvironments()[0].name,createScenarioTemplate().name);
 }finally{Object.assign(globalThis,old);}
});
