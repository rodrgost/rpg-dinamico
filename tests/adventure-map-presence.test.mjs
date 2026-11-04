import worker from '../worker/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAdventureUI} from '../src/adventure-ui.mjs';
import {createAdventure,changeAdventure} from '../src/adventure.mjs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
const world=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url))),rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url))),hero=createMiddleEarthCharacters(rules)[0],KEY='3det-adaptavel-adventures-v1';
function harness(w=world){
 const a=changeAdventure(createAdventure({id:'map-presence',name:'O caminho de Cael',world:w,rules,character:hero,environmentId:'eriador',locationId:'bolsao'}),{type:'start'});
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch},handlers=new Map(),stored=new Map([[KEY,JSON.stringify({schemaVersion:1,adventures:[a]})]]);
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(){return {focus(){}};}};
 globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
 let html='',ui;ui=createAdventureUI({render:()=>{html=ui.html();},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getEnvironments:()=>[{...w,id:'eriador'}],getEnvironmentSnapshot:()=>w,getRules:()=>rules,getCharacters:()=>[hero]});ui.init();
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
 return {id:a.id,stored,html:()=>html,click:dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})}),level:id=>dispatch('change',{dataset:{adventureMapLevel:''},value:id}),restore:()=>Object.assign(globalThis,old)};
}
const markerIds=html=>[...html.matchAll(/<button class="map-cell[^\"]* player-cell[^\"]*"[^>]*data-adventure-move="([^\"]+)"/g)].map(m=>m[1]);
test('zooming out marks the containing place at every level without moving, advancing turns, changing encounters or saving the adventure',async()=>{
 const h=harness();try{
  await h.click({adventureOpen:h.id});const before=h.stored.get(KEY);
  assert.deepEqual(markerIds(h.html()),['bolsao']);assert.doesNotMatch(h.html(),/Cael ·|Cael está em|map-presence/);
  for(const [context,id] of [['eriador','condado'],['terra-media','eriador'],['','terra-media']]){
   await h.click({adventureMapContext:context});assert.deepEqual(markerIds(h.html()),[id]);assert.doesNotMatch(h.html(),/Cael ·|Cael está em|map-presence/);assert.match(h.html(),/data-adventure-talk="frodo"/);assert.doesNotMatch(h.html(),/data-adventure-talk="elrond"/);assert.equal(h.stored.get(KEY),before);
  }
  assert.doesNotMatch(h.html(),/data-adventure-action="map-outside"/);
  await h.click({adventureMapContext:'condado'});assert.deepEqual(markerIds(h.html()),['bolsao']);assert.equal(h.stored.get(KEY),before);
  await h.level('terra-media');assert.deepEqual(markerIds(h.html()),['eriador']);assert.match(h.html(),/<span class="map-cell-label">Eriador<\/span>/);assert.match(h.html(),/<span class="map-cell-label">Rohan<\/span>/);assert.match(h.html(),/<span class="map-cell-label">Mordor<\/span>/);
  const imageKey='3det-adaptavel-map-image-v1:'+JSON.stringify(['eriador','eriador']);h.stored.set(imageKey,JSON.stringify({dataUrl:'data:image/webp;base64,UklGRg==',width:100,height:100,name:'Eriador.webp'}));
  await h.level('eriador');assert.match(h.html(),/map-background-image/);assert.deepEqual(markerIds(h.html()),['condado']);
  await h.level('condado');assert.doesNotMatch(h.html(),/map-background-image/);assert.deepEqual(markerIds(h.html()),['bolsao']);
  await h.level('rohan');assert.match(h.html(),/Escolha um nível que contenha/);assert.deepEqual(markerIds(h.html()),['bolsao']);assert.equal(h.stored.get(KEY),before);
  await h.click({adventureMove:'condado'});const moved=JSON.parse(h.stored.get(KEY)).adventures[0];assert.equal(moved.locationId,'condado');assert.equal(moved.turn.number,1);assert.doesNotMatch(h.html(),/Cael está em|map-presence/);
  const beforeView=h.stored.get(KEY);await h.click({adventureMapContext:'eriador'});assert.deepEqual(markerIds(h.html()),['condado']);assert.equal(h.stored.get(KEY),beforeView);await h.click({adventureMapContext:'terra-media'});assert.deepEqual(markerIds(h.html()),['eriador']);assert.equal(h.stored.get(KEY),beforeView);assert.doesNotMatch(h.html(),/Cael ·|Cael está em|map-presence/);
 }finally{h.restore();}
});
test('missing coordinates never create a separate character marker; the destination remains highlighted in the list',async()=>{
 const w=structuredClone(world);Object.assign(w.places.find(p=>p.id==='condado'),{x:null,y:null});const h=harness(w);
 try{
  await h.click({adventureOpen:h.id});await h.level('eriador');assert.deepEqual(markerIds(h.html()),[]);assert.doesNotMatch(h.html(),/class="map-presence"|Cael está em/);assert.match(h.html(),/class="btn location-current" data-adventure-move="condado"/);
  await h.level('bolsao');assert.deepEqual(markerIds(h.html()),[]);assert.doesNotMatch(h.html(),/map-presence|presence-square/);
  await h.level('');assert.deepEqual(markerIds(h.html()),['terra-media']);
 }finally{h.restore();}
});
