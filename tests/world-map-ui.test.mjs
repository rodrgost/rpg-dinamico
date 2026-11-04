import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './legacy-worker.mjs';
const KEY='3det-adaptavel-worlds-v2';
test('pixel map navigates direct children and ancestors, edits paired coordinates, moves parent and restores JSON',async()=>{
 const handlers=new Map(),nodes=new Map(),stored=new Map();
 const original={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(sel){if(!nodes.has(sel))nodes.set(sel,{addEventListener(){},focus(){},value:'',click(){}});return nodes.get(sel);}};
 globalThis.localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
 globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
 const click=dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})});
 const input=(field,value)=>dispatch('input',{id:'',dataset:{worldField:field},value});
 const snapshot=()=>JSON.parse(stored.get(KEY)).worlds[0].world;
 try{
  const source=(await readFile(new URL('../src/world-ui.mjs',import.meta.url),'utf8')).replace("from '/world.mjs'",'from '+JSON.stringify(new URL('../src/world.mjs',import.meta.url).href));
  const {createWorldUI}=await import('data:text/javascript;base64,'+Buffer.from(source.replace("from '/npc-ui.mjs'",'from '+JSON.stringify(new URL('../src/npc-ui.mjs',import.meta.url).href))).toString('base64'));
  let ui,markup='';ui=createWorldUI({render(){markup=ui.html();},toast(){}});await ui.init();
  await click({environmentOpen:ui.getActiveEnvironmentId()});await click({worldAction:'map'});
  assert.match(markup,/Mapa de Arvandor/);assert.match(markup,/class="map-cell" style="left:35%;top:65%"/);
  assert.doesNotMatch(markup,/class="map-cell"[^>]*data-world-map="porto-aurora"/);
  await click({worldMap:'eldoria'});assert.match(markup,/Mapa de Eldoria/);assert.match(markup,/Arvandor › Eldoria/);
  await click({worldMap:'porto-aurora'});assert.match(markup,/Mapa de Porto Aurora/);
  await click({worldMap:'eldoria'});assert.match(markup,/Mapa de Eldoria/);
  await click({worldMap:''});assert.match(markup,/Mapa de Mundo de Arvandor/);assert.match(markup,/NÍVEL PRINCIPAL/);
  await click({worldAction:'map-new'});await input('id','novo');await input('name','Novo lugar');await input('type','País');await input('x','0');await input('y','100');await dispatch('submit',{id:'place-form'});
  assert.equal(snapshot().places.find(p=>p.id==='novo').x,0);assert.match(markup,/Mapa de Novo lugar/);
  await click({worldMap:''});assert.match(markup,/class="map-cell" style="left:0%;top:100%"/);
  await click({worldMap:'novo'});await click({worldAction:'edit'});await input('x','101');await dispatch('submit',{id:'place-form'});
  assert.match(markup,/entre 0 e 100/);assert.equal(snapshot().places.find(p=>p.id==='novo').x,0);
  await input('x','25.5');await input('y','40');await dispatch('submit',{id:'place-form'});assert.equal(snapshot().places.find(p=>p.id==='novo').x,25.5);
  await click({worldAction:'edit'});await dispatch('change',{dataset:{worldField:'parentId'},value:'eldoria'});
  await dispatch('submit',{id:'place-form'});const moved=snapshot().places.find(p=>p.id==='novo');assert.equal(moved.parentId,'eldoria');assert.equal(moved.x,null);assert.equal(moved.y,null);
  await click({worldMap:'eldoria'});assert.match(markup,/Sem posição definida/);assert.match(markup,/data-world-map="novo"/);
  await click({worldMap:'novo'});await click({worldAction:'edit'});await input('x','10');await dispatch('submit',{id:'place-form'});assert.match(markup,/preencha X e Y juntos/);
  await input('y','20');await dispatch('submit',{id:'place-form'});await click({worldAction:'json'});
  assert.equal(ui.getEnvironmentSnapshot(ui.getActiveEnvironmentId()).places.find(p=>p.id==='novo').y,20);
  const restored=createWorldUI({render(){},toast(){}});await restored.init();assert.equal(restored.getEnvironmentSnapshot(restored.getActiveEnvironmentId()).places.find(p=>p.id==='novo').x,10);
 }finally{Object.assign(globalThis,original);}
});
test('world API preserves coordinates and rejects incomplete positions',async()=>{
 const world={schemaVersion:1,name:'Mapa',places:[{id:'a',parentId:null,name:'Lugar',type:'Espaço',x:0,y:100}]};
 const post=world=>worker.fetch(new Request('https://rpg.test/api/world',{method:'POST',body:JSON.stringify({world})}));
 const response=await post(world);assert.equal(response.status,200);assert.equal((await response.json()).places[0].y,100);
 world.places[0].y=null;assert.equal((await post(world)).status,400);
});
