import worker from '../worker/index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAdventureUI} from '../src/adventure-ui.mjs';
import {createAdventure,changeAdventure,finishAdventureTurn} from '../src/adventure.mjs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
import {createEriadorMissions} from '../src/mission.mjs';
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url))),world=JSON.parse(readFileSync(new URL('../src/world.json',import.meta.url))),characters=createMiddleEarthCharacters(rules),missions=createEriadorMissions({...world,id:'eriador'}),KEY='3det-adaptavel-adventures-v1';
function fixture(withMission=true){
 let a=createAdventure({id:'reading',name:'Uma jornada',world,rules,character:characters[0],environmentId:'eriador',locationId:'bolsao'});
 a=changeAdventure(a,{type:'start'});if(withMission)a=changeAdventure(a,{type:'accept',mission:missions[0]});
 for(let i=0;i<4;i++)a=finishAdventureTurn(a,{expectedTurn:a.turn.number},new Date(Date.now()+i*1000).toISOString());
 return a;
}
function harness(a){
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch},handlers=new Map(),store=new Map([[KEY,JSON.stringify({schemaVersion:1,adventures:[a]})]]),effects=[];
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(sel){return {showModal(){effects.push('show');},close(){effects.push('close');},focus(){effects.push('focus:'+sel);}};}};
 globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 let html='',ui;ui=createAdventureUI({render:()=>{html=ui.html();},toast(){},getMissions:()=>missions,getLegacyProgress:()=>[],getEnvironments:()=>[{...world,id:'eriador'}],getEnvironmentSnapshot:()=>world,getRules:()=>rules,getCharacters:()=>characters});ui.init();
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
 return {store,effects,html:()=>html,dispatch,click:dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})}),restore:()=>Object.assign(globalThis,old)};
}
test('reading panels expose complete text without changing the game; close restores the triggering control',async()=>{
 const a=fixture(false);a.snapshot.character.fields.historia=a.turn.character.fields.historia='História extensa <script>alert(1)</script> '+ 'estradas de Rohan '.repeat(10);
 const h=harness(a);try{
  await h.click({adventureOpen:a.id});const before=h.store.get(KEY);
  assert.doesNotMatch(h.html(),/Mana|Nenhuma habilidade selecionada|sheet-location|v1.1.1-mvp/);
  assert.match(h.html(),/data-adventure-disclosure="attributes" open/);
  await h.click({adventureRead:'character',readId:''});assert.match(h.html(),/<dialog[^>]+aria-labelledby="adventure-reader-title"/);assert.match(h.html(),/estradas de Rohan/);assert.match(h.html(),/&lt;script&gt;/);assert.doesNotMatch(h.html(),/<script>alert/);assert.ok(h.effects.includes('show'));
  await h.dispatch('cancel',{id:'adventure-reader'});assert.doesNotMatch(h.html(),/<dialog/);assert.ok(h.effects.some(e=>e.includes('focus:[data-adventure-read="character"]')));
  await h.click({adventureRead:'place',readId:''});assert.match(h.html(),/Sempre cheia/);await h.click({adventureAction:'close-reader'});
  await h.click({adventureRead:'npc',readId:'frodo'});assert.match(h.html(),/Portador do Anel/);await h.click({adventureAction:'close-reader'});
  assert.equal(h.store.get(KEY),before);
 }finally{h.restore();}
});
test('disclosures survive renders and movement, while recent history stays short and full history remains accessible',async()=>{
 const a=fixture(),h=harness(a);try{
  await h.click({adventureOpen:a.id});const before=h.store.get(KEY);
  assert.doesNotMatch(h.html(),/data-adventure-disclosure="destinations" open/);
  assert.doesNotMatch(h.html(),/data-adventure-objective=/); // automatic objectives have no editable status controls
  const recent=h.html().split('class="story-content"')[1].split('class="story-footer"')[0];assert.equal((recent.match(/class="story-entry"/g)||[]).length,3);
  assert.match(recent,/<details class="story-checks"><summary>Verificação de objetivos/);
  await h.dispatch('toggle',{dataset:{adventureDisclosure:'map'},open:false,isConnected:true});
  await h.dispatch('toggle',{dataset:{adventureDisclosure:'attributes'},open:false,isConnected:true});
  await h.click({adventureRead:'history',readId:''});assert.match(h.html(),/Histórico completo/);assert.match(h.html(),/Localização inicial: Bolsão/);assert.equal(h.store.get(KEY),before);
  await h.click({adventureAction:'close-reader'});assert.doesNotMatch(h.html(),/data-adventure-disclosure="map" open/);assert.doesNotMatch(h.html(),/data-adventure-disclosure="attributes" open/);
  await h.click({adventureMove:'condado'});assert.doesNotMatch(h.html(),/data-adventure-disclosure="map" open/);assert.equal(JSON.parse(h.store.get(KEY)).adventures[0].turn.number,a.turn.number+1);
  await h.click({adventureRead:'mission',readId:''});assert.match(h.html(),/Regra de conclusão da missão/);
 }finally{h.restore();}
});
