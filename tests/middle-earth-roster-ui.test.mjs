import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMiddleEarthCharacters} from '../src/engine.mjs';
import worker from '../worker/index.js';
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
test('character page adds Middle-earth examples without overwriting current heroes and keeps memory unchanged when saving fails',async()=>{
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};const handlers=new Map(),nodes=new Map(),stored=new Map();let quota=false;
 globalThis.setTimeout=()=>0;globalThis.clearTimeout=()=>{};
 const roster=createMiddleEarthCharacters(rules).slice(0,2);roster[0].name='Meu Cael';stored.set('3det-adaptavel-session-v1',JSON.stringify({rules,roster,pairing:roster.map(c=>c.id),choices:{},history:[],mode:'random',seed:1}));
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{addEventListener(){},querySelectorAll(){return [];},focus(){},innerHTML:'',textContent:'',className:''});return nodes.get(selector);};
 globalThis.document={body:{classList:{toggle(){}}},querySelector:node,addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);}};globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem(k,v){if(quota)throw Error('quota');stored.set(k,v);}};globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 const loadUI=file=>{const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/from '\/([^']+)'/g,(_,name)=>'from '+JSON.stringify(new URL('../src/'+name,import.meta.url).href));return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');};
 const click=async dataset=>{for(const fn of handlers.get('click')||[])await fn({target:{closest:()=>({dataset,disabled:false})},preventDefault(){}});};
 try{
  let source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/from '\/([^']+)'/g,(_,name)=>'from '+JSON.stringify(name==='world-ui.mjs' || name==='mission-ui.mjs'?loadUI(name):new URL('../src/'+name,import.meta.url).href));source=source.replace(/initialize\(\);\s*$/,'export const ready=initialize();export {state};');
  const app=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));await app.ready;await click({tab:'characters'});assert.match(node('#main').innerHTML,/Adicionar exemplos da Terra Média/);
  const before=stored.get('3det-adaptavel-session-v1');quota=true;await click({do:'middle-earth'});assert.equal(stored.get('3det-adaptavel-session-v1'),before);assert.equal(app.state.roster.length,2);quota=false;
  await click({do:'middle-earth'});assert.equal(app.state.roster.length,3);assert.equal(app.state.roster[0].name,'Meu Cael');assert.equal(app.state.roster[2].fields.origem,'O Condado');await click({do:'middle-earth'});assert.equal(app.state.roster.length,3);
 }finally{Object.assign(globalThis,old);}
});
