import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './legacy-worker.mjs';
import { createAdventureUI } from '../src/adventure-ui.mjs';
const WORLD='3det-adaptavel-worlds-v2', MISSION='3det-adaptavel-missions-v1', ADVENTURE='3det-adaptavel-adventures-v1';
async function uiModule(file){let source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');source=source.replace(/from '\/([^']+)'/g,(_,name)=>'from '+JSON.stringify(new URL('../src/'+name,import.meta.url).href));return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
function harness(){
 const handlers=new Map(),stored=new Map(),nodes=new Map(),notices=[],original={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};let failWrite=false;
 globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(sel){if(!nodes.has(sel))nodes.set(sel,{addEventListener(type,fn){handlers.set(sel+':'+type,[fn]);},focus(){},click(){},innerHTML:''});return nodes.get(sel);}};
 globalThis.localStorage={getItem:key=>stored.get(key)||null,setItem(key,value){if(failWrite)throw new Error('quota');stored.set(key,value);}};
 globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
 const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
 return {stored,notices,toast:(...a)=>notices.push(a),dispatch,click:dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})}),input:(dataset,value)=>dispatch('input',{dataset,value}),change:(dataset,value)=>dispatch('change',{dataset,value}),fail(v){failWrite=v;},restore(){Object.assign(globalThis,original);}};
}
test('NPC forms create/edit/move environment residents, save mission references and conditional NPCs, and show both in adventure',async()=>{
 const h=harness();try{
  const {createWorldUI}=await uiModule('world-ui.mjs'),{createMissionUI}=await uiModule('mission-ui.mjs');
  let worldUI,missionUI,adventureUI,worldHTML='',missionHTML='',adventureHTML='';
  const render=()=>{if(worldUI)worldHTML=worldUI.html();if(missionUI)missionHTML=missionUI.html();if(adventureUI)adventureHTML=adventureUI.html();};
  worldUI=createWorldUI({render,toast:h.toast,beforeWorldChange:(id,next)=>missionUI?.assertEnvironmentChange(id,next)});
  missionUI=createMissionUI({render,toast:h.toast,getEnvironments:worldUI.getEnvironments,getActiveEnvironmentId:worldUI.getActiveEnvironmentId});
  await worldUI.init();missionUI.init();render();const envId=worldUI.getActiveEnvironmentId();
  const world=()=>worldUI.getEnvironmentSnapshot(envId),missions=()=>JSON.parse(h.stored.get(MISSION)).missions;
  await h.click({environmentOpen:envId});await h.click({worldAction:'npcs'});assert.match(worldHTML,/NPCs do cenário/);
  const field=(scope,name,value)=>h.input({npcScope:scope,npcField:name},value);
  await h.click({npcScope:'world',npcAction:'new'});await field('world','id','merchant');await field('world','name','<script>Morador</script>');await field('world','description','Um comerciante da cidade.');await h.change({npcScope:'world',npcField:'placeId'},'mercado');await h.dispatch('submit',{id:'npc-form-world'});
  assert.equal(world().npcs.find(n=>n.id==='merchant').placeId,'mercado');assert.match(worldHTML,/&lt;script&gt;Morador/);assert.doesNotMatch(worldHTML,/<script>Morador/);
  await h.click({npcScope:'world',npcAction:'edit',npcId:'merchant'});await field('world','name','Comerciante');await h.change({npcScope:'world',npcField:'placeId'},'taverna');await h.click({npcScope:'world',npcAction:'combat-example'});await h.dispatch('submit',{id:'npc-form-world'});
  assert.equal(world().npcs.find(n=>n.id==='merchant').placeId,'taverna');assert.ok(world().npcs.find(n=>n.id==='merchant').combatant);
  const storedBefore=h.stored.get(WORLD);await h.click({npcScope:'world',npcAction:'edit',npcId:'merchant'});await field('world','name','Não salvo');h.fail(true);await h.dispatch('submit',{id:'npc-form-world'});assert.equal(h.stored.get(WORLD),storedBefore);assert.equal(world().npcs.find(n=>n.id==='merchant').name,'Comerciante');assert.match(worldHTML,/Não foi possível salvar os NPCs/);h.fail(false);await h.click({npcScope:'world',npcAction:'cancel'});
  await h.click({missionAction:'new'});await h.dispatch('change',{dataset:{formulaMode:''},checked:false});await h.input({missionField:'name'},'Pessoas da taverna');
  const gate=missionHTML.match(/data-objective-id="([^"]+)"/)[1];await h.input({objectiveId:gate,objectiveField:'title'},'Conhecer o pedido');await h.change({objectiveId:gate,objectiveField:'placeId'},'taverna');
  await h.click({missionAction:'add-objective'});const ids=[...new Set([...missionHTML.matchAll(/data-objective-id="([^"]+)"/g)].map(m=>m[1]))];await h.input({objectiveId:ids[1],objectiveField:'title'},'Continuar a história');
  await h.click({npcScope:'mission',npcAction:'new'});await h.change({npcScope:'mission',npcField:'mode'},'reference');await h.change({npcScope:'mission',npcField:'environmentNpcId'},'merchant');assert.ok(missionHTML.indexOf('</form>')<missionHTML.indexOf('id="npc-form-mission"'));await h.dispatch('submit',{id:'npc-form-mission'});
  assert.equal(h.stored.has(MISSION),false);await h.dispatch('submit',{id:'mission-form'});assert.equal(missions()[0].npcs[0].environmentNpcId,'merchant');
  await h.click({missionEdit:missions()[0].id});await h.click({npcScope:'mission',npcAction:'new'});await field('mission','id','witness');await field('mission','name','Testemunha da história');await field('mission','description','Só chega depois do pedido.');await h.change({npcScope:'mission',npcField:'placeId'},'taverna');await field('mission','presenceText',JSON.stringify({type:'objective_completed',objectiveId:gate}));await h.dispatch('submit',{id:'npc-form-mission'});await h.dispatch('submit',{id:'mission-form'});
  assert.equal(missions()[0].npcs.length,2);assert.equal(missions()[0].npcs.find(n=>n.id==='witness').presence.objectiveId,gate);
  const beforeDelete=h.stored.get(WORLD);await h.click({worldAction:'npcs'});await h.click({npcScope:'world',npcAction:'delete',npcId:'merchant'});assert.equal(h.stored.get(WORLD),beforeDelete);assert.match(worldHTML,/NPC do cenário não encontrado/);
  const rules=JSON.parse(await readFile(new URL('../src/rules.json',import.meta.url)));
  const character={id:'hero',name:'Heroína',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{perfil:'Aventureiro'}};
  adventureUI=createAdventureUI({render,toast:h.toast,getEnvironments:worldUI.getEnvironments,getMissions:missionUI.getMissions,getLegacyProgress:missionUI.getLegacyProgress,getEnvironmentSnapshot:worldUI.getEnvironmentSnapshot,getRules:()=>rules,getCharacters:()=>[character]});adventureUI.init();
  await h.click({adventureAction:'new'});await h.change({adventureField:'name'},'Encontros');await h.change({adventureField:'locationId'},'taverna');await h.change({adventureField:'characterId'},character.id);await h.dispatch('submit',{id:'adventure-form'});await h.click({adventureAction:'start'});await h.click({adventureAccept:missions()[0].id});
  const a=()=>JSON.parse(h.stored.get(ADVENTURE)).adventures[0];assert.equal(a().locationId,'taverna');assert.equal(a().turn.npcs.filter(n=>n.id==='merchant').length,1);
  assert.equal((adventureHTML.match(/data-adventure-fight="merchant"/g)||[]).length,1);assert.match(adventureHTML,/Mara, taverneira/);assert.doesNotMatch(adventureHTML,/Testemunha da história/);
  await h.change({adventureObjective:gate},'completed');assert.match(adventureHTML,/Testemunha da história/);await h.click({adventureRead:'npc',readId:'q0_witness'});assert.match(adventureHTML,/Personagem desta missão/);await h.click({adventureAction:'close-reader'});await h.click({adventureRead:'npc',readId:'merchant'});assert.match(adventureHTML,/Morador do cenário/);await h.click({adventureAction:'close-reader'});
  await h.click({adventureMove:'sala-fundos'});assert.match(adventureHTML,/destino não está acessível/);await h.click({adventureMove:'porto-aurora'});assert.doesNotMatch(adventureHTML,/data-adventure-fight="merchant"/);
  const restored=createWorldUI({render(){},toast:h.toast});await restored.init();assert.equal(restored.getEnvironmentSnapshot(envId).npcs.find(n=>n.id==='merchant').name,'Comerciante');
 }finally{h.restore();}
});
