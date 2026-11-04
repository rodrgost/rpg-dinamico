import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdventureUI } from '../src/adventure-ui.mjs';
import worker from './legacy-worker.mjs';
import { createMissionTemplate } from './legacy-models.mjs';
const KEY='3det-adaptavel-adventures-v1', MK='3det-adaptavel-missions-v1';
const rules=JSON.parse(await readFile(new URL('../src/rules.json',import.meta.url)));
const env={id:'env-1',name:'Mundo',description:'Descrição',places:[{id:'praca',parentId:null,name:'Praça',type:'Praça',x:50,y:50,description:'',details:{}}]};
const world={schemaVersion:1,name:env.name,description:env.description,places:[{id:'praca',parentId:null,name:'Praça',type:'Praça',x:50,y:50,description:'',details:{}}]};
const model=createMissionTemplate(env);
const chars=[{id:'hero',name:'Heroína',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{origem:'Vale',perfil:'Guardião',historia:''}}];
function harness(initial=[]) {
  const handlers=new Map(),stored=new Map(initial),original={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};let failWrite=false;
  globalThis.document={addEventListener(type,fn){handlers.set(type,[...(handlers.get(type)||[]),fn]);},querySelector(){return {addEventListener(){},focus(){}};}};
  globalThis.fetch=(path,init)=>worker.fetch(new Request('https://rpg.test'+path,init));
  globalThis.localStorage={getItem:key=>stored.get(key)||null,setItem(key,value){if(failWrite)throw new Error('quota');stored.set(key,value);}};
  const dispatch=async(type,target)=>{for(const fn of handlers.get(type)||[])await fn({target,preventDefault(){}});};
  return {stored,failWrites(value){failWrite=value;},dispatch,click:dataset=>dispatch('click',{closest:()=>({dataset,disabled:false})}),field:(field,value)=>dispatch('change',{dataset:{adventureField:field},value}),restore(){Object.assign(globalThis,original);}};
}
async function missionUI(h) {
  const source=(await readFile(new URL('../src/mission-ui.mjs',import.meta.url),'utf8')).replace("from '/mission.mjs'",'from '+JSON.stringify(new URL('../src/mission.mjs',import.meta.url).href));
  const {createMissionUI}=await import('data:text/javascript;base64,'+Buffer.from(source.replace("from '/npc-ui.mjs'",'from '+JSON.stringify(new URL('../src/npc-ui.mjs',import.meta.url).href))).toString('base64'));
  const ui=createMissionUI({render(){},toast(){},getEnvironments:()=>[env],getActiveEnvironmentId:()=>env.id});ui.init();return ui;
}
test('UI creates, starts, tracks, renames, reloads and deletes/undoes independent adventures',async()=>{
  const h=harness();try {
    let markup='',ui;const render=()=>{markup=ui.html();};
    ui=createAdventureUI({render,toast(){},getEnvironments:()=>[env],getMissions:()=>[model],getLegacyProgress:()=>[],getEnvironmentSnapshot:()=>world,getRules:()=>rules,getCharacters:()=>chars});ui.init();render();
    await h.click({adventureAction:'new'});await h.field('name','<script>Partida</script>');await h.field('missionId',model.id);await h.field('characterId','hero');await h.dispatch('submit',{id:'adventure-form'});
    const saved=()=>JSON.parse(h.stored.get(KEY)).adventures;
    assert.equal(saved().length,1);assert.equal(saved()[0].status,'not_started');assert.match(markup,/&lt;script&gt;Partida/);
    await h.click({adventureAction:'start'});await h.click({adventureAccept:model.id});
    await h.dispatch('change',{dataset:{adventureObjective:'investigar-origem'},value:'completed'});assert.equal(saved()[0].quests[0].progress.find(p=>p.id==='investigar-origem').status,'pending');
    await h.dispatch('change',{dataset:{adventureAlternative:'proteger-acesso'},value:'negociar'});await h.dispatch('change',{dataset:{adventureObjective:'proteger-acesso'},value:'completed'});
    assert.equal(saved()[0].quests[0].progress[0].status,'completed');assert.equal(model.objectives[0].status,'pending');
    const firstId=saved()[0].id;
    await h.click({adventureAction:'new'});await h.field('name','Segunda');await h.field('missionId',model.id);await h.field('characterId','hero');await h.dispatch('submit',{id:'adventure-form'});
    assert.equal(saved().length,2);assert.equal(saved()[1].quests.length,0);
    await h.click({adventureEdit:firstId});await h.field('name','Renomeada');await h.dispatch('submit',{id:'adventure-form'});assert.equal(saved()[0].name,'Renomeada');
    const before=h.stored.get(KEY);h.failWrites(true);await h.click({adventureAction:'abandon'});assert.equal(h.stored.get(KEY),before);assert.match(markup,/Não foi possível salvar/);h.failWrites(false);
    await h.click({adventureAction:'list'});assert.match(markup,/data-adventure-delete=/);await h.click({adventureDelete:firstId});assert.equal(saved().length,1);await h.click({adventureAction:'undo'});assert.equal(saved().length,2);
    const restored=createAdventureUI({render(){},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getEnvironmentSnapshot:()=>null,getRules:()=>null,getCharacters:()=>[]});restored.init();assert.match(restored.html(),/Renomeada/);await h.click({adventureOpen:firstId});assert.match(restored.html(),/Negociar|negociar|Alternativas/);
  }finally{h.restore();}
});
test('migration preserves old progress atomically, is idempotent and requires explicit character choice',async()=>{
  const old=structuredClone(model);old.objectives[0].status='completed';old.objectives[0].completedAlternativeId='negociar';
  const raw=JSON.stringify({schemaVersion:1,missions:[old]});const h=harness([[MK,raw]]);
  try{
    const m=await missionUI(h);assert.equal(m.getMissions()[0].objectives[0].status,'pending');assert.equal(m.getLegacyProgress()[0].mission.objectives[0].status,'completed');
    const reload=await missionUI(h);assert.equal(reload.getLegacyProgress().length,1);
    let ui,markup='';ui=createAdventureUI({render(){markup=ui.html();},toast(){},getEnvironments:()=>[env],getMissions:m.getMissions,getLegacyProgress:m.getLegacyProgress,getEnvironmentSnapshot:()=>world,getRules:()=>rules,getCharacters:()=>chars});ui.init();markup=ui.html();assert.match(markup,/Progresso anterior preservado/);
    await h.click({adventureLegacy:m.getLegacyProgress()[0].id});await h.dispatch('submit',{id:'adventure-form'});assert.equal(h.stored.has(KEY),false);assert.match(markup,/Selecione um personagem/);
    await h.field('characterId','hero');await h.dispatch('submit',{id:'adventure-form'});const a=JSON.parse(h.stored.get(KEY)).adventures[0];assert.equal(a.quests[0].progress[0].completedAlternativeId,'negociar');assert.equal(a.status,'in_progress');
    await h.click({adventureAction:'list'});assert.doesNotMatch(markup,/Progresso anterior preservado/);assert.equal(m.getLegacyProgress().length,1);
  }finally{h.restore();}
  const quota=harness([[MK,raw]]);try{quota.failWrites(true);const m=await missionUI(quota);assert.equal(quota.stored.get(MK),raw);assert.match(m.html(),/cópia existente foi preservada/);}finally{quota.restore();}
});
test('unreadable adventures never overwrite saved bytes; missing prerequisites cannot create a game',async()=>{
  const h=harness([[KEY,'{bad']]);try{
    let ui,markup='';ui=createAdventureUI({render(){markup=ui.html();},toast(){},getMissions:()=>[],getLegacyProgress:()=>[],getEnvironmentSnapshot:()=>null,getRules:()=>rules,getCharacters:()=>[]});ui.init();markup=ui.html();assert.match(markup,/dados existentes foram preservados/);await h.click({adventureAction:'new'});assert.equal(h.stored.get(KEY),'{bad');
  }finally{h.restore();}
});

test('turn UI persists narrative facts, waits for turn end, recovers failed requests and completes objective after real combat',async()=>{
 const h=harness();try{
  const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
  const m=structuredClone(model);m.objectives=m.objectives.slice(0,2).map(o=>({...o,alternatives:[],dependsOn:[],completedAlternativeId:null}));
  m.npcs=[{id:'enemy',name:'Inimigo',placeId:'praca',combatant:{attributes:{forca:2,habilidade:1,resistencia:1,armadura:1,poderFogo:3},abilities:[],fields:{perfil:'Outro'}}}];
  m.facts=[{id:'letter',name:'Carta recuperada',description:'Só depois de encontrar a carta.',initialValue:false}];
  m.objectives[0].completion={mode:'automatic',evaluateAt:'turn_end',condition:{type:'npc_defeated',npcId:'enemy'}};
  m.objectives[1].completion={mode:'automatic',evaluateAt:'turn_end',condition:{type:'fact_equals',factId:'letter',value:true}};
  let ui,markup='';const config={render(){markup=ui.html();},toast(){},getEnvironments:()=>[env],getMissions:()=>[m],getLegacyProgress:()=>[],getEnvironmentSnapshot:()=>world,getRules:()=>r,getCharacters:()=>chars};
  ui=createAdventureUI(config);ui.init();
  await h.click({adventureAction:'new'});await h.field('name','Turnos');await h.field('missionId',m.id);await h.field('characterId','hero');await h.dispatch('submit',{id:'adventure-form'});await h.click({adventureAction:'start'});await h.click({adventureAccept:m.id});
  const saved=()=>JSON.parse(h.stored.get(KEY)).adventures[0];
  assert.match(markup,/Histórico da aventura/);assert.match(markup,/Conclusão automática no fim do turno/);
  await h.click({adventureAction:'end-turn'});assert.equal(saved().turn.number,1);assert.match(markup,/ainda não derrotado/);
  const previous=h.stored.get(KEY), fetchWorking=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Sem conexão');};await h.click({adventureAction:'end-turn'});assert.equal(h.stored.get(KEY),previous);assert.match(markup,/Sem conexão/);globalThis.fetch=fetchWorking;
  await h.dispatch('change',{dataset:{turnFact:'letter'},checked:true});assert.equal(saved().quests[0].turn.facts[0].value,true);assert.equal(saved().quests[0].progress[1].status,'pending');
  const withFact=h.stored.get(KEY);h.failWrites(true);await h.click({adventureAction:'end-turn'});assert.equal(h.stored.get(KEY),withFact);assert.match(markup,/Não foi possível salvar/);h.failWrites(false);
  await h.click({adventureAction:'end-turn'});assert.equal(saved().turn.number,2);assert.equal(saved().quests[0].progress[1].status,'completed');
  await h.click({adventureFight:'q0_enemy'});await h.click({adventureAction:'combat-turn'});assert.equal(saved().turn.number,3);assert.equal(saved().turn.npcs.find(n=>n.id==='q0_enemy').defeated,true);assert.equal(saved().quests[0].progress[0].completedTurn,3);assert.equal(saved().status,'in_progress');assert.equal(saved().quests[0].status,'completed');assert.match(markup,/Concluído no turno 3/);assert.match(markup,/dano 100/);
  const restored=createAdventureUI({...config,render(){}});restored.init();assert.match(restored.html(),/Turnos/);await h.click({adventureOpen:saved().id});assert.match(restored.html(),/Concluído no turno 3/);
 }finally{h.restore();}
});

test('adventure layout prioritizes live character sheet and current map, with local travel, story and inline combat',async()=>{
 const h=harness();try{
  const w=JSON.parse(await readFile(new URL('./fixtures/porto-aurora.json',import.meta.url)));
  const {createPortoAuroraMission}=await import('../src/mission.mjs');const m=createPortoAuroraMission({...w,id:'expanded-env'});
  const r=structuredClone(rules);r.combat.initiative='actor.habilidade';r.actions[0].formula='100';r.combat.damage='100';
  let ui,markup='';const config={render(){markup=ui.html();},toast(){},getEnvironments:()=>[{...w,id:m.environmentId}],getMissions:()=>[m],getLegacyProgress:()=>[],getEnvironmentSnapshot:()=>w,getRules:()=>r,getCharacters:()=>chars};
  ui=createAdventureUI(config);ui.init();await h.click({adventureAction:'new'});await h.field('name','Caminho da exploradora');await h.field('missionId',m.id);await h.field('characterId','hero');await h.dispatch('submit',{id:'adventure-form'});
  const saved=()=>JSON.parse(h.stored.get(KEY)).adventures[0];
  assert.equal(saved().locationId,'portao-norte');assert.match(markup,/aria-label="Ficha do personagem"/);assert.match(markup,/aria-label="Mapa da localização atual"/);assert.match(markup,/Sem missão aceita/);
  assert.ok(markup.indexOf('class="adventure-play-layout"')<markup.indexOf('Sem missão aceita'));assert.doesNotMatch(markup,/<h1>Porto Aurora/);
  await h.click({adventureAction:'start'});
  assert.doesNotMatch(markup,/data-adventure-fight="q0_bloqueador-mercado"/);assert.doesNotMatch(markup,/id="adventure-combat"/);
  const before=h.stored.get(KEY);await h.click({adventureFight:'capitao-contrabandistas'});assert.equal(h.stored.get(KEY),before);assert.match(markup,/confronto não está disponível/);
  await h.click({adventureMove:'praca-central'});await h.click({adventureTalk:'vera-mensageira'});await h.click({adventureOffer:m.id});assert.match(markup,/Aceitar missão/);await h.click({adventureAccept:m.id});
  await h.click({adventureMove:'mercado'});assert.equal(saved().locationId,'mercado');assert.match(markup,/Saiu de Praça da Âncora e chegou a Mercado das Marés/);assert.match(markup,/data-adventure-fight="q0_bloqueador-mercado"/);
  await h.click({adventureFight:'q0_bloqueador-mercado'});assert.match(markup,/id="adventure-combat"/);assert.match(markup,/Combate com Líder do bloqueio/);
  await h.click({adventureAction:'combat-turn'});assert.equal(saved().turn.number,3);assert.equal(saved().turn.npcs.find(n=>n.id==='q0_bloqueador-mercado').defeated,true);assert.match(markup,/foi derrotado/);assert.match(markup,/dano 100/);
  await h.click({adventureAction:'close-combat'});assert.doesNotMatch(markup,/id="adventure-combat"/);assert.match(markup,/Histórico da aventura/);
  const storedBefore=h.stored.get(KEY),liveFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Sem conexão para deslocar');};await h.click({adventureMove:'sala-fundos'});assert.equal(h.stored.get(KEY),storedBefore);assert.match(markup,/Sem conexão para deslocar/);globalThis.fetch=liveFetch;h.failWrites(true);await h.click({adventureMove:'sala-fundos'});assert.equal(h.stored.get(KEY),storedBefore);assert.match(markup,/Não foi possível salvar/);h.failWrites(false);
  await h.click({adventureMove:'sala-fundos'});assert.equal(saved().locationId,'sala-fundos');assert.doesNotMatch(markup,/Caminho da localização atual/);
  const restored=createAdventureUI({...config,render(){}});restored.init();await h.click({adventureOpen:saved().id});assert.match(restored.html(),/Sala dos fundos/);assert.match(restored.html(),/Histórico da aventura/);
 }finally{h.restore();}
});
