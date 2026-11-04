import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from './legacy-worker.mjs';
const KEY='3det-adaptavel-worlds-v2',MISSIONS='3det-adaptavel-missions-v1',ADVENTURES='3det-adaptavel-adventures-v1';
async function moduleUI(name){const source=(await readFile(new URL('../src/'+name,import.meta.url),'utf8')).replace(/from '\/([^']+)'/g,(_,file)=>'from '+JSON.stringify(new URL('../src/'+file,import.meta.url).href));return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
function harness(){
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};const handlers=new Map(),stored=new Map(),nodes=new Map();let fail=false,fetches=0;
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{addEventListener(){},focus(){},click(){}});return nodes.get(selector);}};
 globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem(k,v){if(fail)throw Error('quota');stored.set(k,v);}};
 globalThis.fetch=(path,init)=>{fetches++;return worker.fetch(new Request('https://rpg.test'+path,init));};
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
 return {stored,fail:v=>{fail=v;},fetches:()=>fetches,dispatch,click:dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})}),input:(dataset,value)=>dispatch('input',{dataset,value}),restore(){Object.assign(globalThis,old);}};
}
test('scenario deletion is atomic, can undo, allows an empty collection across reload, then new creation/import',async()=>{
 const h=harness();try{
  const {createWorldUI}=await moduleUI('world-ui.mjs');let ui,html='';ui=createWorldUI({render(){html=ui.html();},toast(){}});await ui.init();html=ui.html();
  assert.match(html,/<h1>Cenários/);assert.match(html,/Excluir cenário/);const original=ui.getEnvironments()[0],initialId=original.id;
  const before=h.stored.get(KEY);h.fail(true);await h.click({environmentDelete:initialId});assert.equal(h.stored.get(KEY),before);assert.equal(ui.getEnvironments().length,1);assert.match(html,/Não foi possível salvar/);h.fail(false);
  await h.click({environmentDelete:initialId});assert.equal(ui.getEnvironments().length,0);assert.equal(JSON.parse(h.stored.get(KEY)).activeWorldId,null);assert.match(html,/Nenhum cenário cadastrado/);assert.match(html,/Desfazer exclusão de cenário/);
  const restored=createWorldUI({render(){},toast(){}}),requests=h.fetches();await restored.init();assert.equal(h.fetches(),requests);assert.equal(restored.getEnvironments().length,0);assert.match(restored.html(),/Novo cenário/);
  await h.click({worldAction:'undo-scenario'});assert.equal(ui.getActiveEnvironmentId(),initialId);assert.deepEqual(ui.getEnvironments()[0],original);
  await h.click({worldAction:'new-environment'});await h.input({environmentField:'name'},'Segundo');await h.dispatch('submit',{id:'environment-form'});const secondId=ui.getActiveEnvironmentId();
  await h.click({environmentDelete:initialId});assert.equal(ui.getActiveEnvironmentId(),secondId);await h.click({worldAction:'undo-scenario'});assert.equal(ui.getActiveEnvironmentId(),secondId);
  await h.click({environmentDelete:secondId});assert.equal(ui.getActiveEnvironmentId(),initialId);await h.click({worldAction:'undo-scenario'});assert.equal(ui.getActiveEnvironmentId(),secondId);await h.click({environmentDelete:secondId});
  await h.click({environmentDelete:initialId});await h.click({worldAction:'new-environment'});await h.input({environmentField:'name'},'Cenário vazio');await h.dispatch('submit',{id:'environment-form'});assert.equal(ui.getEnvironments().length,1);assert.equal(ui.getEnvironments()[0].name,'Cenário vazio');
  await h.click({environmentDelete:ui.getActiveEnvironmentId()});await h.click({worldAction:'new-json'});await h.input({},JSON.stringify({schemaVersion:1,name:'Importado',places:[]}));
  await h.dispatch('input',{id:'world-json',dataset:{},value:JSON.stringify({schemaVersion:1,name:'Importado',places:[]})});await h.click({worldAction:'apply'});assert.match(html,/Adicionar cenário/);await h.click({worldAction:'replace'});assert.equal(ui.getEnvironments()[0].name,'Importado');
 }finally{h.restore();}
});
test('registered missions protect their scenario; deleting their model then scenario preserves adventure storage',async()=>{
 const h=harness();try{
  const {createWorldUI}=await moduleUI('world-ui.mjs'),{createMissionUI}=await moduleUI('mission-ui.mjs');let missionUI,ui,html='';ui=createWorldUI({render(){html=ui.html();},toast(){},beforeWorldDelete:id=>missionUI.assertEnvironmentDeletion(id)});await ui.init();
  const id=ui.getActiveEnvironmentId();h.stored.set(MISSIONS,JSON.stringify({schemaVersion:1,missions:[{schemaVersion:1,id:'mission',environmentId:id,name:'Pedido vinculado',description:'',objectives:[{id:'goal',type:'other',title:'Ajudar',status:'pending'}]}],legacyProgress:[]}));
  missionUI=createMissionUI({render(){},toast(){},getEnvironments:ui.getEnvironments,getActiveEnvironmentId:ui.getActiveEnvironmentId});missionUI.init();
  h.stored.set(ADVENTURES,'aventuras-preservadas');const before=h.stored.get(KEY);
  await h.click({environmentDelete:id});assert.equal(h.stored.get(KEY),before);assert.equal(ui.getEnvironments().length,1);assert.match(html,/Exclua ou transfira/);
  await h.click({missionDelete:'mission'});assert.equal(missionUI.getMissions().length,0);await h.click({environmentDelete:id});assert.equal(ui.getEnvironments().length,0);assert.equal(h.stored.get(ADVENTURES),'aventuras-preservadas');
 }finally{h.restore();}
});
