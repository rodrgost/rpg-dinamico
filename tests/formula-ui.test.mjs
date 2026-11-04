import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from './legacy-worker.mjs';
import {createAdventureUI} from '../src/adventure-ui.mjs';
const world=JSON.parse(readFileSync(new URL('./fixtures/porto-aurora.json',import.meta.url)));
const rules=JSON.parse(readFileSync(new URL('../src/rules.json',import.meta.url)));
const character={id:'hero',name:'Exploradora',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
test('mission editor saves a typed formula and executable action; adventure UI executes it through the Worker and computes completion',async()=>{
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};const handlers=new Map(),store=new Map();let missionUI,adventureUI,missionHTML='',adventureHTML='';
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(){return {addEventListener(){},focus(){}};}};
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
 const click=dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})});
 const input=(dataset,value)=>dispatch('input',{dataset,value});
 const render=()=>{if(missionUI)missionHTML=missionUI.html();if(adventureUI)adventureHTML=adventureUI.html();};
 try{
  let source=readFileSync(new URL('../src/mission-ui.mjs',import.meta.url),'utf8').replace(/from '\/([^']+)'/g,(_,name)=>'from '+JSON.stringify(new URL('../src/'+name,import.meta.url).href));
  const {createMissionUI}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  missionUI=createMissionUI({render,toast(){},getEnvironments:()=>[{...world,id:'env'}],getActiveEnvironmentId:()=> 'env'});missionUI.init();
  await click({missionAction:'new'});assert.match(missionHTML,/data-formula-mode checked/);
  await input({missionField:'name'},'Investigar pista');const objectiveId=missionHTML.match(/data-objective-id="([^"]+)"/)[1];
  await input({objectiveId,objectiveField:'title'},'Examinar marcas');
  await input({formulaField:'actions'},JSON.stringify([{id:'investigar',name:'Examinar marcas no chão',kind:'investigate',placeId:'portao-norte'}]));
  await input({objectiveFormula:objectiveId},JSON.stringify({operator:'gte',left:{ref:'acoes.investigar.sucessos'},right:1}));
  await dispatch('change',{dataset:{offerField:'placeId'},value:'portao-norte'});
  await dispatch('submit',{id:'mission-form'});const m=missionUI.getMissions()[0];assert.ok(m);assert.equal(m.execution,'formula');assert.equal(m.actions[0].id,'investigar');
  adventureUI=createAdventureUI({render,toast(){},getEnvironments:()=>[{...world,id:'env'}],getEnvironmentSnapshot:()=>world,getMissions:missionUI.getMissions,getLegacyProgress:()=>[],getRules:()=>rules,getCharacters:()=>[character]});adventureUI.init();
  await click({adventureAction:'new'});await dispatch('change',{dataset:{adventureField:'name'},value:'Explorar'});await dispatch('change',{dataset:{adventureField:'characterId'},value:'hero'});await dispatch('submit',{id:'adventure-form'});await click({adventureAction:'start'});await click({adventureAccept:m.id});
  assert.match(adventureHTML,/Ações neste lugar/);assert.match(adventureHTML,/data-adventure-activity="investigar"/);assert.doesNotMatch(adventureHTML,/data-turn-npc=/);
  await click({adventureActivity:'investigar',activityMission:m.id});const a=JSON.parse(store.get('3det-adaptavel-adventures-v1')).adventures[0];
  assert.equal(a.turn.number,1);assert.equal(a.quests[0].status,'completed');assert.equal(a.quests[0].progress[0].completedTurn,1);assert.equal(a.status,'in_progress');assert.match(adventureHTML,/Examinar marcas no chão: sucesso/);
 }finally{Object.assign(globalThis,old);}
});
