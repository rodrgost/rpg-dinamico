import { validateRules, createCharacter, createNPCCharacter, simulateNPCEncounter, simulateEscape, evaluate, seededRng } from './engine.mjs';
import { validateWorld, formulaReferences, regionalEncounterTable, routeBetween, worldClock, ancestors } from './world.mjs';
import { validateMission, validateMissionDocument, evaluateMissionCondition, resolveMissionNPCs, validateFormulaBindings, missionIsComplete } from './mission.mjs';
export class AdventureError extends Error {}
const fail = message => { throw new AdventureError(message); };
export function missionModel(input) {
  const m = validateMissionDocument(input);
  return { ...m, objectives: m.objectives.map(o => ({ ...o, status: 'pending', completedAlternativeId: null })) };
}
export function adventureMission(a) {
  if(a.schemaVersion===2) { const q=a.quests.find(q=>q.snapshot.mission.id===a.selectedMissionId); return q ? adventureMission(q) : {name:"Sem missão aceita",description:"Explore o cenário e converse com as pessoas para encontrar oportunidades.",objectives:[],facts:[]}; }
  return { ...structuredClone(a.snapshot.mission), objectives: a.snapshot.mission.objectives.map(o => ({ ...structuredClone(o), status:a.progress.find(p => p.id === o.id).status, completedAlternativeId:a.progress.find(p => p.id === o.id).completedAlternativeId })) };
}
function validateLegacyAdventure(input) {
  if (!input || input.schemaVersion !== 1 || JSON.stringify(input).length > 900000) fail('Aventura inválida ou maior que 900 KB.');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id)) fail('ID da aventura inválido.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) fail('Informe um nome de até 120 caracteres.');
  if (!['not_started','in_progress','completed','abandoned'].includes(input.status)) fail('Situação da aventura inválida.');
  const s = input.snapshot;
  if (!s) fail('As cópias da aventura são obrigatórias.');
  const world = validateWorld(s.world), rules = structuredClone(validateRules(s.rules));
  const mission = validateMission(s.mission, [{ id: s.mission.environmentId, places: world.places, npcs:world.npcs || [] }]);
  if (mission.objectives.some(o => o.status !== 'pending' || o.completedAlternativeId !== null)) fail('O modelo da aventura deve começar pendente.');
  const character = adventureHero(rules,s.character,true);
  const expressions=[mission.completion,...mission.objectives.flatMap(o=>[o.completion?.condition,...o.alternatives.map(a=>a.condition)]),...(mission.actions || []).map(a=>a.condition),...(mission.npcs || []).map(n=>n.presence)];
  validateFormulaBindings(expressions,mission,rules);
  for(const action of mission.actions || [])if(action.kind==='test' && (!rules.attributes.some(a=>a.id===action.attribute) || !rules.actions.some(a=>a.kind==='test' && (!action.ruleActionId || a.id===action.ruleActionId))))fail('Atributo ou regra do teste inválido: '+action.id);
  for(const expression of expressions)validateNPCFormulaHP(expression,mission,world);
  if (!Array.isArray(input.progress) || input.progress.length !== mission.objectives.length) fail('Progresso incompatível com os objetivos.');
  const ids = new Set();
  const progress = input.progress.map(p => {
    if (!p || ids.has(p.id) || !mission.objectives.some(o => o.id === p.id)) fail('Objetivo de progresso inválido ou duplicado.');
    ids.add(p.id);
    const completedTurn=p.completedTurn ?? null, completionReason=p.completionReason ?? null;
    if (completedTurn !== null && (!Number.isInteger(completedTurn) || completedTurn < 1)) fail('Turno de conclusão inválido.');
    if (completionReason !== null && (typeof completionReason !== 'string' || completionReason.length > 20000)) fail('Motivo de conclusão inválido.');
    if (p.status !== 'completed' && (completedTurn !== null || completionReason !== null)) fail('Proveniência exige objetivo concluído.');
    return { id: p.id, status: p.status, completedAlternativeId: p.completedAlternativeId ?? null, completedTurn, completionReason };
  });
  const a = { schemaVersion: 1, id: input.id, name: input.name.trim(), status: input.status, snapshot: { world, rules, mission, character }, progress, createdAt: input.createdAt, updatedAt: input.updatedAt, startedAt: input.startedAt ?? null, completedAt: input.completedAt ?? null, abandonedAt: input.abandonedAt ?? null, legacyId: input.legacyId ?? null };
  if(input.pausedTimeTurns!==undefined){if(!Number.isInteger(input.pausedTimeTurns) || input.pausedTimeTurns<0 || input.pausedTimeTurns>input.turn?.number)fail('Contagem de turnos sem avanço de tempo inválida.');a.pausedTimeTurns=input.pausedTimeTurns;}
  a.locationId = input.locationId === undefined ? mission.startPlaceId ?? mission.objectives.find(o => o.placeId)?.placeId ?? world.places[0]?.id ?? null : input.locationId;
  if (a.locationId !== null && !world.places.some(p => p.id === a.locationId)) fail('Localização do personagem não pertence ao cenário.');
  const sourceJournal=input.journal ?? [{id:'arrival-' + a.id,at:a.createdAt,kind:'arrival',text:'Localização inicial: ' + (world.places.find(p => p.id === a.locationId)?.name || world.name) + '.',placeId:a.locationId,turn:0}];
  if (!Array.isArray(sourceJournal) || sourceJournal.length > 200) fail('O diário deve ter até 200 registros.');
  const journalIds=new Set();
  a.journal=sourceJournal.map(e => {
    if (!e || typeof e.id !== 'string' || e.id.length > 100 || journalIds.has(e.id) || !Number.isFinite(Date.parse(e.at)) || !['arrival','movement','action','combat','lifecycle'].includes(e.kind) || typeof e.text !== 'string' || e.text.length > 2000 || !Number.isInteger(e.turn) || e.turn < 0 || (e.placeId !== null && !world.places.some(p => p.id === e.placeId))) fail('Registro do diário inválido.');
    journalIds.add(e.id);return {id:e.id,at:e.at,kind:e.kind,text:e.text,placeId:e.placeId,turn:e.turn};
  });
  a.turn = validateTurnState(input.turn, a);
  if (a.journal.some(e => e.turn > a.turn.number)) fail('Registro do diário não pode estar em turno futuro.');
  if (progress.some(p => p.completedTurn > a.turn.number)) fail('Conclusão não pode estar em turno futuro.');
  const runtime = validateMission(adventureMission(a), [{ id: mission.environmentId, places: world.places, npcs:world.npcs || [] }]);
  const done = missionIsComplete(a);
  if ((a.status === 'completed') !== done) fail('A situação deve corresponder à conclusão de todos os objetivos.');
  if (a.status === 'not_started' && runtime.objectives.some(o => o.status !== 'pending' || o.completedAlternativeId)) fail('Inicie a aventura antes de registrar progresso.');
  for (const key of ['createdAt','updatedAt','startedAt','completedAt','abandonedAt']) {
    if (a[key] !== null && (typeof a[key] !== 'string' || !Number.isFinite(Date.parse(a[key])))) fail('Data inválida: ' + key);
  }
  if (!a.createdAt || !a.updatedAt || Date.parse(a.updatedAt) < Date.parse(a.createdAt)) fail('Datas de criação e atualização inválidas.');
  if (['in_progress','completed'].includes(a.status) && !a.startedAt) fail('A data de início é obrigatória.');
  if ((a.status === 'completed') !== Boolean(a.completedAt) || (a.status === 'abandoned') !== Boolean(a.abandonedAt)) fail('Datas incompatíveis com a situação.');
  if (a.legacyId !== null && (typeof a.legacyId !== 'string' || a.legacyId.length > 100)) fail('Referência anterior inválida.');
  return a;
}
function createLegacyAdventure({ name, mission, world, rules, character, legacyId = null, preserveProgress = false }, now = new Date().toISOString()) {
  const original = validateMissionDocument(mission), model = missionModel(original);
  const progressed = preserveProgress && original.objectives.some(o => o.status !== 'pending' || o.completedAlternativeId);
  const complete = progressed && original.objectives.every(o => o.status === 'completed');
  return validateAdventure({ schemaVersion:1, id:'aventura-' + crypto.randomUUID(), name, snapshot:{ mission:model, world, rules, character:adventureHero(validateRules(rules),character) }, progress:(preserveProgress ? original : model).objectives.map(o => ({ id:o.id,status:o.status,completedAlternativeId:o.completedAlternativeId })), status:complete ? 'completed' : progressed ? 'in_progress' : 'not_started', createdAt:now,updatedAt:now,startedAt:progressed ? now : null,completedAt:complete ? now : null,abandonedAt:null,legacyId });
}
function journalEntry(a,kind,text,now) {
  a.journal=[...a.journal,{id:crypto.randomUUID(),at:now,kind,text:text.slice(0,2000),placeId:a.locationId,turn:a.turn.number}].slice(-200);
}
export function reachableAdventurePlaces(a) {
  const world=a.snapshot.world, current=world.places.find(p => p.id === a.locationId);
  if(a.travel)return [];
  if(world.navigation==='gateways')return world.places.filter(p=>routeBetween(world,a.locationId,p.id));
  const restricted=current && (world.routes || []).some(r=>world.places.find(p=>p.id===r.fromPlaceId)?.parentId===current.parentId);
  return world.places.filter(p => p.id !== a.locationId && (p.parentId === a.locationId || current && (p.id === current.parentId || p.parentId === current.parentId && (!restricted || routeBetween(world,current.id,p.id)))));
}
function changeLegacyAdventure(input, command, now = new Date().toISOString()) {
  const a = validateAdventure(input);
  if (command.type === 'rename') a.name = command.name;
  else if (command.type === 'start') {
    if (!['not_started','abandoned'].includes(a.status)) fail('Esta aventura já foi iniciada.');
    journalEntry(a,'lifecycle',a.status === 'abandoned' ? 'Aventura retomada.' : 'A aventura começou em ' + (a.snapshot.world.places.find(p => p.id === a.locationId)?.name || a.snapshot.world.name) + '.',now);
    a.status = 'in_progress'; a.startedAt ||= now; a.abandonedAt = null;
  } else if (command.type === 'abandon') {
    if (!['not_started','in_progress'].includes(a.status)) fail('Não é possível abandonar esta aventura.');
    a.status = 'abandoned'; a.abandonedAt = now;
  } else if (command.type === 'move') {
    if (!['in_progress','completed'].includes(a.status)) fail('Inicie ou retome a aventura para se deslocar.');
    if (a.turn.character.hp <= 0) fail('O personagem está incapacitado e não pode se deslocar.');
    if (command.placeId === a.locationId) fail('O personagem já está nesse lugar.');
    const current=a.snapshot.world.places.find(p => p.id === a.locationId);
    if (!(command.placeId === null && current?.parentId === null) && !reachableAdventurePlaces(a).some(p => p.id === command.placeId)) fail('O destino não está acessível deste nível. Use os lugares internos, os arredores ou o superior.');
    const previous=current?.name || a.snapshot.world.name;
    a.locationId=command.placeId;
    const next=a.snapshot.world.places.find(p => p.id === a.locationId);
    journalEntry(a,'movement','Saiu de ' + previous + ' e chegou a ' + (next?.name || a.snapshot.world.name) + '.' + (next?.description ? ' ' + next.description : ''),now);
  } else if (command.type === 'objective') {
    if (!['in_progress','completed'].includes(a.status)) fail('Inicie ou retome a aventura para alterar os objetivos.');
    const p = a.progress.find(p => p.id === command.id);
    if (!p) fail('Objetivo não encontrado.');
    if(a.snapshot.mission.execution==='formula')fail('Objetivos com fórmula são calculados pelo sistema.');
    if (a.snapshot.mission.objectives.find(o => o.id === command.id).completion?.mode === 'automatic') fail('Objetivo automático só é avaliado no fim do turno.');
    if (command.status !== undefined) { p.status = command.status; p.completedTurn = null; p.completionReason = null; }
    if (command.alternative !== undefined) p.completedAlternativeId = command.alternative || null;
    a.status = a.progress.every(p => p.status === 'completed') ? 'completed' : 'in_progress';
    a.completedAt = a.status === 'completed' ? a.completedAt || now : null;
    journalEntry(a,'action','Objetivo “' + a.snapshot.mission.objectives.find(o => o.id === p.id).title + '”: ' + ({pending:'pendente',in_progress:'em andamento',completed:'concluído'}[p.status]) + '.',now);
  } else if (command.type === 'fact') {
    if (a.status !== 'in_progress') fail('Inicie ou retome a aventura para registrar fatos.');
    if(a.snapshot.mission.execution==='formula')fail('Fatos desta missão são resultados de ações do sistema.');
    const f=a.turn.facts.find(f => f.id === command.id);
    if (!f || typeof command.value !== 'boolean') fail('Fato inválido.');
    f.value=command.value;
    journalEntry(a,'action',a.snapshot.mission.facts.find(fact => fact.id === f.id).name + ': ' + (f.value ? 'registrado na história.' : 'registro desmarcado.'),now);
  } else if (command.type === 'npc') {
    if (a.status !== 'in_progress') fail('Inicie ou retome a aventura para registrar NPCs.');
    if(a.snapshot.mission.execution==='formula')fail('Derrotas desta missão devem resultar do combate.');
    const n=a.turn.npcs.find(n => n.id === command.id);
    if (!visibleAdventureNPCs(a).some(npc => npc.id === command.id)) fail('NPC não está presente na localização atual.');
    if (!n || n.character || typeof command.defeated !== 'boolean') fail('A derrota de um NPC com ficha deve vir do combate.');
    n.defeated=command.defeated;
    journalEntry(a,'action',adventureNPCs(a).find(npc => npc.id === n.id).name + ': ' + (n.defeated ? 'derrota registrada.' : 'derrota desmarcada.'),now);
  } else fail('Operação de aventura inválida.');
  a.updatedAt = now;
  return validateAdventure(a);
}

function validateTurnState(input, a) {
  const activity=validateActivityState(input,a.snapshot.mission);
  const definitions=adventureNPCs(a), facts=a.snapshot.mission.facts || [], rules=a.snapshot.rules;
  const initialNPCs=definitions.map(n => {
    let character=null;
    try {character=n.combatant ? createNPCCharacter(rules,{...n.combatant,id:n.id,name:n.name}) : null;}catch(e){fail('NPC “'+n.name+'”: '+e.message);}
    if (character?.id === a.snapshot.character.id) fail('O ID do NPC deve ser diferente do personagem.');
    return {id:n.id,placeId:n.placeId,character,defeated:character ? character.hp === 0 : false};
  });
  if (input === undefined) return {...activity,number:0,character:structuredClone(a.snapshot.character),npcs:initialNPCs,facts:facts.map(f => ({id:f.id,value:f.initialValue})),history:[]};
  if (!input || !Number.isInteger(input.number) || input.number < 0 || input.number > 1000000) fail('Número do turno inválido.');
  const currentCharacter=(source,template,isNPC=false) => {
    let next;try {next=isNPC?createNPCCharacter(rules,source,true):adventureHero(rules,source,true);}catch(e){fail((isNPC?'NPC “'+template.name+'”: ':'')+e.message);}
    const expected={...template,hp:next.hp};
    if (JSON.stringify(next) !== JSON.stringify(expected)) fail('A ficha em jogo deve preservar os atributos e os dados da cópia inicial.');
    return next;
  };
  if (!Array.isArray(input.npcs) || input.npcs.length !== initialNPCs.length || new Set(input.npcs.map(n => n.id)).size !== input.npcs.length) fail('Estado de NPCs incompatível com a missão.');
  const npcs=initialNPCs.map(n => {
    const state=input.npcs.find(s => s.id === n.id);
    if (!state || typeof state.defeated !== 'boolean') fail('Estado de NPC inválido.');
    const character=n.character ? currentCharacter(state.character,n.character,true) : null;
    if (!n.character && state.character != null) fail('NPC narrativo não possui ficha de combate.');
    if (character && state.defeated !== (character.hp === 0)) fail('Derrota deve corresponder aos PV do NPC.');
    const placeId=state.placeId === undefined ? n.placeId : state.placeId;
    if (placeId !== null && !a.snapshot.world.places.some(p => p.id === placeId)) fail('Localização do NPC inválida.');
    return {id:n.id,placeId,character,defeated:state.defeated};
  });
  if (!Array.isArray(input.facts) || input.facts.length !== facts.length || new Set(input.facts.map(f => f.id)).size !== input.facts.length) fail('Estado de fatos incompatível com a missão.');
  const values=facts.map(f => { const state=input.facts.find(s => s.id === f.id); if (!state || typeof state.value !== 'boolean') fail('Valor do fato inválido.'); return {id:f.id,value:state.value}; });
  if (!Array.isArray(input.history) || input.history.length > 20) fail('Histórico deve conter até 20 turnos.');
  let previous=0;
  const history=input.history.map(h => {
    if (!h || !Number.isInteger(h.number) || h.number <= previous || h.number > input.number || !Number.isFinite(Date.parse(h.at))) fail('Histórico de turnos inválido.');
    previous=h.number;
    if (!Array.isArray(h.events) || h.events.length > 100 || !h.events.every(e => typeof e === 'string' && e.length <= 2000)) fail('Registro de ações inválido.');
    if (!Array.isArray(h.checks) || h.checks.length > 50) fail('Registro de verificações inválido.');
    const checks=h.checks.map(c => {
      if (!a.progress.some(p => p.id === c.objectiveId) || typeof c.met !== 'boolean' || typeof c.reason !== 'string' || c.reason.length > 20000) fail('Verificação de objetivo inválida.');
      return {objectiveId:c.objectiveId,met:c.met,reason:c.reason};
    });
    return {number:h.number,at:h.at,events:[...h.events],checks};
  });
  return {...activity,number:input.number,character:currentCharacter(input.character,a.snapshot.character),npcs,facts:values,history};
}
function finishLegacyAdventureTurn(input, command = {}, now = new Date().toISOString()) {
  let a=validateAdventure(input);
  if(command.seed!==undefined && (!Number.isInteger(command.seed) || command.seed<0 || command.seed>4294967295))fail('Semente deve ser um inteiro de 0 a 4294967295.');
  if (a.status !== 'in_progress' && !(command.move && a.status==='completed')) fail('Inicie ou retome uma aventura em andamento para encerrar o turno.');
  if (command.expectedTurn !== a.turn.number) fail('O turno já mudou. Reabra a aventura antes de tentar novamente.');
  const events=[];
  if([command.combat,command.activity,command.move,command.flee].filter(Boolean).length>1)fail('Escolha somente uma ação por turno.');
  let movement=null;
  if(command.move){a=changeLegacyAdventure(a,{type:'move',placeId:command.move.placeId},now);movement=a.journal.pop();events.push(movement.text);}
  if(command.flee)events.push(...applyAdventureEscape(a,command.flee,command.seed));
  if(command.activity)events.push(executeMissionActivity(a,command.activity.actionId,command.seed));
  if (command.combat) {
    const c=command.combat, npc=a.turn.npcs.find(n => n.id === c.npcId);
    const definition=adventureNPCs(a).find(n => n.id === c.npcId);
    if (!visibleAdventureNPCs(a).some(n => n.id === c.npcId)) fail('Esse NPC não está na localização atual do personagem.');
    if (!npc?.character || npc.defeated) fail('Selecione um NPC vivo com ficha de combate.');
    const attackId=a.snapshot.rules.actions.find(action => action.kind === 'attack').id;
    const choice=(actionId) => {
      const action=a.snapshot.rules.actions.find(action => action.id === (actionId || attackId));
      if (!action || action.kind !== 'attack') fail('Selecione uma ação de ataque para cada combatente.');
      return {actionId:action.id};
    };
    const round=simulateNPCEncounter(a.snapshot.rules,{combatants:[a.turn.character,npc.character],choices:[choice(c.heroActionId),choice(c.npcActionId)],mode:command.seed === undefined ? 'random' : 'seeded',seed:command.seed});
    a.turn.character=round.characters[0];npc.character=round.characters[1];npc.defeated=npc.character.hp === 0;
    for (const i of round.initiative) events.push('Iniciativa de ' + i.name + ': ' + i.roll.total + ' (' + i.roll.dice.map(d => d.rolls.join(', ')).join('; ') + ').');
    for (const e of round.events) events.push(e.kind === 'skipped' ? e.actor + ': ' + e.message : e.actor + ' → ' + e.target + ': ' + e.action + '; ataque ' + e.roll.total + ', defesa ' + e.defense.total + ', dano ' + e.damage + '; PV ' + e.hpBefore + ' → ' + e.hpAfter + (e.defeated ? ' · ' + e.target + ' derrotado.' : '.'));
  } else if(!command.move) events.push('Turno narrativo encerrado; avaliação dos fatos registrados na aventura.');
  a.turn.number++;if(command.combat || command.flee || command.pauseTime)a.pausedTimeTurns=(a.pausedTimeTurns || 0)+1;a.updatedAt=now;
  const checks=[];
  // Fixed point: newly completed prerequisites can release dependents in this same turn.
  for (let pass=0;pass<a.progress.length;pass++) {
    let changed=false;
    for (const o of a.snapshot.mission.objectives) {
      const p=a.progress.find(p => p.id === o.id);
      if (o.completion?.mode !== 'automatic' || p.status === 'completed' || o.dependsOn.some(id => a.progress.find(p => p.id === id).status !== 'completed')) continue;
      const result=evaluateMissionCondition(o.completion.condition,a);
      const alternative=o.alternatives.length ? o.alternatives.find(alt => evaluateMissionCondition(alt.condition,a).met) : null;
      if (result.met && (!o.alternatives.length || alternative)) {
        p.status='completed';p.completedAlternativeId=alternative?.id || null;p.completedTurn=a.turn.number;p.completionReason=result.reason;
        checks.push({objectiveId:o.id,met:true,reason:(alternative ? 'Caminho: ' + alternative.title + '. ' : '') + result.reason});changed=true;
      }
    }
    if (!changed) break;
  }
  for (const o of a.snapshot.mission.objectives) {
    const p=a.progress.find(p => p.id === o.id);
    if (o.completion?.mode !== 'automatic' || p.status === 'completed') continue;
    const pending=o.dependsOn.filter(id => a.progress.find(p => p.id === id).status !== 'completed');
    const result=evaluateMissionCondition(o.completion.condition,a);
    checks.push({objectiveId:o.id,met:false,reason:pending.length ? 'Pré-requisitos pendentes: ' + pending.map(id => a.snapshot.mission.objectives.find(o => o.id === id).title).join(', ') : !result.met ? result.reason : 'Nenhum caminho alternativo atendido.'});
  }
  if (a.status!=='completed' && missionIsComplete(a)) { a.status='completed';a.completedAt=now;if(a.snapshot.mission.completion!==undefined)a.turn.completedMissionTurn=a.turn.number;events.push('Todos os objetivos obrigatórios foram concluídos. Aventura concluída.'); }
  if(!command.move)journalEntry(a,command.combat ? 'combat' : 'action',command.combat ? 'Turno ' + a.turn.number + ': confronto com ' + adventureNPCs(a).find(n => n.id === command.combat.npcId).name + '.' : 'Turno ' + a.turn.number + ' encerrado.',now);
  for (const check of checks.filter(c => c.met)) journalEntry(a,'action','Objetivo concluído: ' + a.snapshot.mission.objectives.find(o => o.id === check.objectiveId).title + '.',now);
  if(movement)a.journal=[...a.journal,{...movement,turn:a.turn.number}].slice(-200);
  a.turn.history=[...a.turn.history,{number:a.turn.number,at:now,events,checks}].slice(-20);
  while (a.turn.history.length > 1 && JSON.stringify(a).length > 880000) a.turn.history.shift();
  return validateAdventure(a);
}

function legacyAdventureNPCs(a) { return resolveMissionNPCs(a.snapshot.world,a.snapshot.mission); }
function visibleLegacyAdventureNPCs(a) {
  return adventureNPCs(a).filter(n => {
    const state=a.turn.npcs.find(s => s.id === n.id);
    return state?.placeId === a.locationId && (n.presence==null || evaluateMissionCondition(n.presence,a).met);
  });
}

// Exploration owns the world and character. Accepted missions retain isolated legacy
// runtimes, so old objective IDs and saves remain valid across simultaneous missions.
const explorationModel = environmentId => ({schemaVersion:1,id:'exploration',environmentId,name:'Exploração',description:'',objectives:[{id:'explore',type:'other',title:'Explorar o cenário',status:'pending'}]});
const coreOf = a => ({...a,schemaVersion:1,snapshot:{...a.snapshot,mission:explorationModel(a.environmentId)},progress:[{id:'explore',status:'pending',completedAlternativeId:null}],turn:{...a.turn,npcs:a.turn.npcs.filter(n=>(a.snapshot.world.npcs || []).some(w=>w.id===n.id)),facts:[],history:a.turn.history.map(h=>({...h,checks:[]}))}});
const runtimeId = (index,id) => 'q' + index + '_' + id;
function syncQuest(a,q) {
  const next=structuredClone(q);
  next.pausedTimeTurns=a.pausedTimeTurns;next.locationId=a.locationId;next.turn.number=a.turn.number;next.turn.character=structuredClone(a.turn.character);next.turn.history=[];next.journal=[];
  if(next.turn.inventory)next.turn.inventory=next.turn.inventory.map(i=>({...i,quantity:a.inventory?.find(s=>s.id===i.id)?.quantity ?? i.quantity}));
  next.updatedAt=Date.parse(a.updatedAt)<Date.parse(next.createdAt)?next.createdAt:a.updatedAt;
  for(const n of next.turn.npcs) {const resident=a.turn.npcs.find(s=>(a.snapshot.world.npcs || []).some(w=>w.id===s.id) && s.id===n.id);if(resident)Object.assign(n,structuredClone(resident));}
  return next;
}
export function validateAdventure(input) {
  if(input?.schemaVersion !== 2) return validateLegacyAdventure(input);
  if(!input.snapshot || !input.turn || !Array.isArray(input.turn.npcs) || !Array.isArray(input.turn.history))fail('Estado de exploração inválido.');
  if(JSON.stringify(input).length>900000)fail('Aventura maior que 900 KB.');
  if(typeof input.environmentId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.environmentId))fail('Cenário da aventura inválido.');
  if(!Array.isArray(input.quests) || input.quests.length>10)fail('A aventura aceita até dez missões.');
  const core=validateLegacyAdventure(coreOf(input));
  const quests=input.quests.map(q=>validateLegacyAdventure(q));
  if(new Set(quests.map(q=>q.snapshot.mission.id)).size!==quests.length)fail('Missão já aceita nesta aventura.');
  for(const q of quests) {
    if(q.snapshot.mission.environmentId!==input.environmentId || JSON.stringify(q.snapshot.world)!==JSON.stringify(core.snapshot.world) || JSON.stringify(q.snapshot.rules)!==JSON.stringify(core.snapshot.rules) || JSON.stringify(q.snapshot.character)!==JSON.stringify(core.snapshot.character))fail('A missão aceita deve usar o cenário, as regras e o personagem desta aventura.');
  }
  const selectedMissionId=input.selectedMissionId ?? quests[0]?.snapshot.mission.id ?? null;
  if(selectedMissionId!==null && !quests.some(q=>q.snapshot.mission.id===selectedMissionId))fail('Missão selecionada inválida.');
  const a={...core,schemaVersion:2,environmentId:input.environmentId,quests,selectedMissionId};
  delete a.snapshot.mission;delete a.progress;
  const itemIds=[...new Set(quests.flatMap(q=>(q.snapshot.mission.items || []).map(i=>i.id)))];
  const inventory=input.inventory ?? (itemIds.length?null:[]);
  if(!Array.isArray(inventory) || inventory.length!==itemIds.length || new Set(inventory.map(i=>i.id)).size!==inventory.length || inventory.some(i=>!itemIds.includes(i.id) || !Number.isInteger(i.quantity) || i.quantity<0 || i.quantity>1000000))fail('Inventário da aventura inválido.');
  a.inventory=inventory.map(i=>({id:i.id,quantity:i.quantity}));
  a.turn.npcs=[...core.turn.npcs,...quests.flatMap((q,i)=>q.turn.npcs.filter(n=>!(a.snapshot.world.npcs || []).some(w=>w.id===n.id)).map(n=>({...structuredClone(n),id:runtimeId(i,n.id)})))];
  if(input.travel!==undefined && input.travel!==null)a.travel=validateTravel(input.travel,a);
  if(a.snapshot.world.navigation==='gateways' && !a.travel && (a.locationId===null || a.snapshot.world.places.some(p=>p.parentId===a.locationId)))fail('Posição física inválida: selecione um ponto folha.');
  const regional=validateRegionalState(input.encounters,a);if(regional)a.encounters=regional;attachRegionalNPCs(a);
  for(const r of a.snapshot.world.turnRules || [])for(const f of r.effects)evaluate(f.formula,turnEffectContext(a),()=>0.5);
  return a;
}
export function createAdventure(input,now=new Date().toISOString()) {
  if(input.mission) return createLegacyAdventure(input,now);
  const a=createLegacyAdventure({...input,mission:explorationModel(input.environmentId)},now);
  if(input.locationId!==undefined)a.locationId=input.locationId;
  if(a.snapshot.world.navigation==='gateways' && a.snapshot.world.places.some(p=>p.parentId===a.locationId))fail('Escolha um ponto físico como local inicial.');
  delete a.journal;
  return validateAdventure({...a,schemaVersion:2,environmentId:input.environmentId,quests:[],selectedMissionId:null});
}
export function upgradeAdventure(input) {
  const old=validateAdventure(input);if(old.schemaVersion===2)return old;
  const a=createAdventure({name:old.name,environmentId:old.snapshot.mission.environmentId,world:old.snapshot.world,rules:old.snapshot.rules,character:old.snapshot.character,locationId:old.locationId},old.createdAt);
  const status=old.status==='completed' ? 'in_progress' : old.status;
  return validateAdventure({...a,pausedTimeTurns:old.pausedTimeTurns,id:old.id,status,startedAt:old.startedAt,abandonedAt:old.abandonedAt,updatedAt:old.updatedAt,legacyId:old.legacyId,journal:old.journal,turn:{...old.turn,facts:[],history:old.turn.history.map(h=>({...h,checks:[]}))},quests:[old],selectedMissionId:old.snapshot.mission.id});
}
export function missionOffer(mission) {
  if(mission.offer)return mission.offer;
  const placeId=mission.startPlaceId ?? mission.objectives.find(o=>o.placeId)?.placeId ?? null;
  return placeId ? {type:'notice',placeId,npcId:null,title:mission.name,description:mission.description} : null;
}
export function availableMissionOffers(a,missions) {
  if(a.schemaVersion!==2 || a.travel)return [];
  return missions.filter(m=>m.environmentId===a.environmentId && !a.quests.some(q=>q.snapshot.mission.id===m.id)).map(m=>({mission:m,offer:missionOffer(m)})).filter(({offer})=>offer && offer.placeId===a.locationId && (offer.type==='notice' || visibleAdventureNPCs(a).some(n=>n.id===offer.npcId && !n.hostile && !a.turn.npcs.find(s=>s.id===n.id)?.defeated)));
}
export function changeAdventure(input,command,now=new Date().toISOString()) {
  if(command.type==='move')return finishAdventureTurn(input,{expectedTurn:command.expectedTurn ?? input?.turn?.number,move:{placeId:command.placeId}},now);
  if(input?.schemaVersion!==2)return changeLegacyAdventure(input,command,now);
  let a=validateAdventure(input);
  if(command.type==='accept') {
    if(a.status!=='in_progress')fail('Inicie a aventura antes de aceitar uma missão.');
    if(a.turn.character.hp<=0)fail('O personagem está incapacitado.');
    const model=missionModel(command.mission);
    validateMission(model,[{...a.snapshot.world,id:a.environmentId}]);
    if(!availableMissionOffers(a,[model]).length)fail('Esta missão não está disponível neste lugar ou já foi aceita.');
    let q=createLegacyAdventure({name:model.name,mission:model,world:a.snapshot.world,rules:a.snapshot.rules,character:a.snapshot.character},now);
    q=changeLegacyAdventure(q,{type:'start'},now);q=syncQuest(a,q);
    a.quests.push(q);a.selectedMissionId=model.id;
    for(const item of model.items || [])if(!a.inventory.some(i=>i.id===item.id))a.inventory.push({id:item.id,quantity:0});
    journalEntry(a,'action','Missão aceita: '+model.name+'.',now);
  } else if(command.type==='select-mission') {
    a.selectedMissionId=command.missionId;
  } else if(command.type==='talk') {
    const n=visibleAdventureNPCs(a).find(n=>n.id===command.id);
    if(!n || n.hostile || a.status!=='in_progress' || a.turn.npcs.find(s=>s.id===n.id)?.defeated)fail('Essa pessoa não está disponível para conversar.');
    journalEntry(a,'action','Conversou com '+n.name+'. '+(n.description || ''),now);
  } else if(['objective','fact','npc'].includes(command.type)) {
    const index=a.quests.findIndex(q=>q.snapshot.mission.id===(command.missionId || a.selectedMissionId));
    if(index<0)fail('Selecione uma missão aceita.');
    let q=syncQuest(a,a.quests[index]);
    q=changeLegacyAdventure(q,command,now);a.quests[index]=q;
    if(command.type==='npc' && (a.snapshot.world.npcs || []).some(n=>n.id===command.id))Object.assign(a.turn.npcs.find(n=>n.id===command.id),q.turn.npcs.find(n=>n.id===command.id));
    journalEntry(a,'action',q.journal.at(-1)?.text || 'Progresso da missão atualizado.',now);
  } else {
    const inventory=a.inventory;
    const changed=changeLegacyAdventure(coreOf(a),command,now);
    a={...a,...changed,schemaVersion:2,quests:a.quests,environmentId:a.environmentId,selectedMissionId:a.selectedMissionId,inventory};
  }
  a.updatedAt=now;
  return validateAdventure(a);
}
export function adventureNPCs(a) {
  if(a.schemaVersion!==2)return legacyAdventureNPCs(a);
  return [...(a.snapshot.world.npcs || []).map(n=>({...n,origin:'environment'})),...(currentRegionalEncounter(a)?.template.participants || []).map((p,i)=>({...p,id:currentRegionalEncounter(a).occurrence.participants[i].id,placeId:a.locationId,origin:'encounter'})),...a.quests.flatMap((q,i)=>(q.snapshot.mission.npcs || []).filter(n=>!n.environmentNpcId).map(n=>({...n,id:runtimeId(i,n.id),origin:'mission',missionId:q.snapshot.mission.id,sourceId:n.id})))];
}
export function visibleAdventureNPCs(a) {
  if(a.schemaVersion!==2)return visibleLegacyAdventureNPCs(a);
  return adventureNPCs(a).filter(n=>{
    const state=a.turn.npcs.find(s=>s.id===n.id);
    if(a.travel && n.origin!=='encounter')return false;
    if(state?.placeId!==a.locationId)return false;
    if(n.origin==='encounter')return true;
    const context=n.origin==='mission' ? syncQuest(a,a.quests.find(q=>q.snapshot.mission.id===n.missionId)) : {...coreOf(a),snapshot:{...a.snapshot,mission:explorationModel(a.environmentId)}};
    return n.presence==null || evaluateMissionCondition(n.presence,context).met;
  });
}
export function finishAdventureTurn(input,command={},now=new Date().toISOString()) {
  if(input?.schemaVersion!==2)return finishLegacyAdventureTurn(input,command,now);
  const a=validateAdventure(input);
  if(a.status!=='in_progress' || command.expectedTurn!==a.turn.number)fail('A aventura não está em andamento ou o turno já mudou.');
  if(command.move && !command.travel && !a.travel){const route=routeBetween(a.snapshot.world,a.locationId,command.move.placeId);if(route){command={...command,move:undefined,travel:{routeId:route.id}};}}
  if([command.combat,command.activity,command.move,command.encounter,command.flee,command.travel,command.rest].filter(Boolean).length>1)fail('Escolha somente uma ação por turno.');
  if(command.seed!==undefined && (!Number.isInteger(command.seed) || command.seed<0 || command.seed>4294967295))fail('Semente inválida.');
  if(a.travel && !command.travel && !command.encounter && !command.combat && !command.flee)fail('Avance pela rota ou resolva o encontro durante a viagem.');
  if(command.rest && (a.travel || a.turn.character.hp<=0))fail('Não é possível descansar em viagem ou incapacitado.');
  const active=currentRegionalEncounter(a);
  if(active && !command.encounter && !((command.combat || command.flee) && active.occurrence.participants.some(p=>p.id===(command.combat || command.flee).npcId)))fail('Resolva o encontro atual antes de seguir a aventura.');
  command={...command,pauseTime:Boolean(command.combat || command.flee || active?.occurrence.status==='combat')};
  const activityIndex=command.activity ? a.quests.findIndex(q=>q.snapshot.mission.id===command.activity.missionId) : -1;
  if(command.activity && activityIndex<0)fail('Missão da ação não foi aceita.');
  if(command.activity && a.quests[activityIndex].status!=='in_progress')fail('Missão já encerrada.');
  const target=(command.combat || command.flee) && visibleAdventureNPCs(a).find(n=>n.id===(command.combat || command.flee).npcId);
  if((command.combat || command.flee) && !target)fail('Esse NPC não está na localização atual.');
  let movement=null,travelRegion;
  if(command.travel){travelRegion=advanceTravel(a,command.travel);}
  if(command.move){const moved=changeLegacyAdventure(coreOf(a),{type:'move',placeId:command.move.placeId},now);a.locationId=moved.locationId;a.journal=moved.journal;movement=a.journal.pop();}
  let core=coreOf(a),events=command.travel?[a.travel?'Viagem: '+a.travel.progress+' unidade(s) percorrida(s).':'Chegada: '+a.snapshot.world.places.find(p=>p.id===a.locationId).name+'.']:movement?[movement.text]:[],checks=[];
  if(command.flee)events.push(...applyAdventureEscape(a,command.flee,command.seed));
  if(command.encounter)events.push(applyRegionalChoice(a,command.encounter,command.seed));
  if(command.combat && target.origin==='encounter')events.push(...applyRegionalCombat(a,command.combat,command.seed));
  if(command.combat && target.origin==='environment') {
    core=finishLegacyAdventureTurn(core,command,now);events.push(...core.turn.history.at(-1).events);
    a.turn.character=core.turn.character;
    for(const n of core.turn.npcs)Object.assign(a.turn.npcs.find(s=>s.id===n.id),n);
  }
  if(command.rest)events.push('Descansou durante um turno.');
  applyTurnEffects(a,command,events);
  const order=a.quests.map((q,i)=>i).sort((i,j)=>Number(j===activityIndex || a.quests[j].snapshot.mission.id===target?.missionId)-Number(i===activityIndex || a.quests[i].snapshot.mission.id===target?.missionId));
  for(const i of order) {
    let q=syncQuest(a,a.quests[i]);
    if(q.status!=='in_progress') {a.quests[i]=q;continue;}
    const combat=command.combat && target?.missionId===q.snapshot.mission.id ? {...command.combat,npcId:target.sourceId} : undefined;
    q=finishLegacyAdventureTurn(q,{expectedTurn:a.turn.number,pauseTime:command.pauseTime,...(combat ? {combat,seed:command.seed} : {}),...(i===activityIndex?{activity:{actionId:command.activity.actionId},seed:command.seed}:{})},now);
    if(combat){a.turn.character=q.turn.character;events.push(...q.turn.history.at(-1).events);}
    if(i===activityIndex){events.push(...q.turn.history.at(-1).events);for(const item of q.turn.inventory || [])a.inventory.find(i=>i.id===item.id).quantity=item.quantity;}
    checks.push(...q.turn.history.at(-1).checks.map(c=>({...c,missionId:q.snapshot.mission.id,title:q.snapshot.mission.objectives.find(o=>o.id===c.objectiveId).title})));
    a.quests[i]=q;
  }
  if(!command.combat && !command.move)events.push('Turno de exploração encerrado.');
  a.turn.number++;if(command.combat || command.flee || command.pauseTime)a.pausedTimeTurns=(a.pausedTimeTurns || 0)+1;a.updatedAt=now;
  a.turn.history=[...a.turn.history,{number:a.turn.number,at:now,events,checks:[]}].slice(-20);
  if(!command.move)journalEntry(a,command.combat?'combat':'action','Turno '+a.turn.number+': '+(target?'confronto com '+target.name+'.':'exploração do cenário.'),now);
  for(const c of checks.filter(c=>c.met))journalEntry(a,'action','Objetivo concluído: '+c.title+'.',now);
  for(const q of a.quests)if(q.status==='completed' && q.completedAt===now)journalEntry(a,'action','Missão concluída: '+q.snapshot.mission.name+'. A exploração continua.',now);
  if(movement)a.journal=[...a.journal,{...movement,turn:a.turn.number}].slice(-200);
  if(command.move || command.travel)triggerRegionalEncounter(a,command.seed,now,events,command.travel?travelRegion:a.locationId);
  // Keep a readable per-mission verification log without mixing objective IDs.
  for(const c of checks)events.push(c.title+': '+(c.met?'concluído. ':'pendente. ')+c.reason);
  a.turn.history.at(-1).events=events.slice(0,100).map(e=>e.slice(0,2000));
  return validateAdventure(a);
}

function validateActivityState(input,mission) {
  const result={};
  if(input?.completedMissionTurn!==undefined){if(!Number.isInteger(input.completedMissionTurn) || input.completedMissionTurn<1 || input.completedMissionTurn>input.number || mission.completion===undefined)fail('Turno de conclusão da missão inválido.');result.completedMissionTurn=input.completedMissionTurn;}
  if(mission.items!==undefined){
    const source=input===undefined?mission.items.map(i=>({id:i.id,quantity:0})):input.inventory;
    if(!Array.isArray(source) || source.length!==mission.items.length || new Set(source.map(i=>i.id)).size!==source.length || source.some(i=>!mission.items.some(d=>d.id===i.id) || !Number.isInteger(i.quantity) || i.quantity<0 || i.quantity>1000000))fail('Inventário inválido.');
    result.inventory=source.map(i=>({id:i.id,quantity:i.quantity}));
  }
  if(mission.actions!==undefined){
    const source=input===undefined?mission.actions.map(a=>({id:a.id,attempts:0,successes:0})):input.activities;
    if(!Array.isArray(source) || source.length!==mission.actions.length || new Set(source.map(i=>i.id)).size!==source.length || source.some(i=>!mission.actions.some(d=>d.id===i.id) || !Number.isInteger(i.attempts) || !Number.isInteger(i.successes) || i.attempts<0 || i.attempts>100 || i.successes<0 || i.successes>1 || i.successes>i.attempts))fail('Resultados de ações inválidos.');
    result.activities=source.map(i=>({id:i.id,attempts:i.attempts,successes:i.successes}));
  }
  return result;
}
function activityBlock(a,action) {
  if(a.status!=='in_progress')return 'Missão não está em andamento.';
  if(a.turn.character.hp<=0)return 'Personagem incapacitado.';
  const state=a.turn.activities?.find(s=>s.id===action.id);
  if(!state)return 'Ação não declarada.';
  if(state.successes>0)return 'Ação já realizada.';
  if(state.attempts>=100)return 'Limite de tentativas atingido.';
  if(action.placeId!==null && action.placeId!==a.locationId)return 'Disponível em outro lugar.';
  if(action.npcId && !visibleLegacyAdventureNPCs(a).some(n=>n.id===action.npcId && !a.turn.npcs.find(s=>s.id===n.id).defeated))return 'A pessoa não está presente.';
  if(action.condition!==undefined && !evaluateMissionCondition(action.condition,a).met)return 'Pré-condição não atendida.';
  if(action.kind==='talk' && action.npcId && visibleLegacyAdventureNPCs(a).some(n=>n.id===action.npcId && n.hostile))return 'Este NPC é hostil: use combate ou fuga.';
  if(a.locationId===null && a.snapshot.world.routes?.length)return 'Ação disponível após chegar a um lugar.';
  if(action.kind==='deliver' && a.turn.inventory.find(i=>i.id===action.itemId).quantity<action.quantity)return 'Item necessário não está no inventário.';
  if(action.kind==='collect' && a.turn.inventory.find(i=>i.id===action.itemId).quantity+action.quantity>1000000)return 'Limite de itens atingido.';
  return null;
}
function executeMissionActivity(a,id,seed) {
  const action=a.snapshot.mission.actions?.find(a=>a.id===id);
  if(!action)fail('Ação não existe nesta missão.');
  const blocked=activityBlock(a,action);if(blocked)fail(blocked);
  const state=a.turn.activities.find(s=>s.id===id);let success=true,detail='';
  if(action.kind==='test'){
    const rule=a.snapshot.rules.actions.find(r=>r.kind==='test' && (!action.ruleActionId || r.id===action.ruleActionId));
    const c=a.turn.character;
    const roll=evaluate(rule.formula,{actor:c.attributes,target:c.attributes,input:{attribute:action.attribute,difficulty:action.difficulty},testBonus:c.bonuses.test,attackBonus:c.bonuses.attack,defenseBonus:c.bonuses.defense},seed===undefined?Math.random:seededRng(seed));
    success=roll.total>=action.difficulty;detail=' Total '+roll.total+' contra dificuldade '+action.difficulty+'. Dados: '+roll.dice.map(d=>d.rolls.join(', ')).join('; ')+'.';
  }
  state.attempts++;if(success)state.successes++;
  if(success && ['collect','deliver'].includes(action.kind))a.turn.inventory.find(i=>i.id===action.itemId).quantity+=(action.kind==='collect'?1:-1)*action.quantity;
  return action.name+': '+(success?'sucesso.':'falha.')+detail;
}
export function availableAdventureActivities(input) {
  const a=input;
  if(a.travel)return [];

  const contexts=a.schemaVersion===2?a.quests.map(q=>syncQuest(a,q)):[a];
  return contexts.flatMap(q=>(q.snapshot.mission.actions || []).filter(action=>action.placeId===null || action.placeId===q.locationId).map(action=>({missionId:q.snapshot.mission.id,missionName:q.snapshot.mission.name,...action,blocked:a.status!=='in_progress'?'Inicie ou retome a aventura.':activityBlock(q,action)})));
}
function validateNPCFormulaHP(expression,mission,world){
  // Reference syntax and typing already validated by the mission module.
  const scan=n=>{
    if(!n || typeof n!=='object')return;
    if(n.ref?.startsWith('npcs.') && n.ref.endsWith('.hp')){
      const id=n.ref.split('.')[1],npc=[...(mission.npcs || []),...(world.npcs || [])].find(n=>n.id===id && n.combatant);
      if(!npc)fail('NPC sem ficha não possui hp: '+id);
    }
    for(const v of Object.values(n))if(Array.isArray(v))v.forEach(scan);else if(v && typeof v==='object')scan(v);
  };scan(expression);
}

function adventureHero(rules,input,current=false){
  try{return createCharacter(rules,input,current);}catch(e){fail('Personagem “'+(input?.name || 'selecionado')+'”: '+e.message);}
}


export function currentRegionalEncounter(a) {
  const occurrence=a.encounters?.occurrences.find(e=>e.status!=='resolved');
  if(!occurrence)return null;
  return {occurrence,template:a.snapshot.world.encounters.find(e=>e.id===occurrence.templateId)};
}
function regionalParticipant(rules,template,occurrenceId,index,source=null) {
  const id=occurrenceId+'-p'+index,initial=template.combatant?createNPCCharacter(rules,{...template.combatant,id,name:template.name}):null;
  let character=initial;
  if(source){
    if(source.id!==id || source.sourceId!==template.id)fail('Participante de encontro incompatível.');
    character=initial?createNPCCharacter(rules,source.character,true):null;
    if(initial && JSON.stringify(character)!==JSON.stringify({...initial,hp:character.hp}) || !initial && source.character!==null)fail('A ficha do encontro deve preservar os dados do modelo.');
    if(typeof source.defeated!=='boolean' || source.defeated!==Boolean(character && character.hp===0))fail('Derrota do encontro incompatível com os PV.');
  }
  return {id,sourceId:template.id,character,defeated:Boolean(character && character.hp===0)};
}
function validateRegionalState(input,a) {
  const templates=a.snapshot.world.encounters || [],rules=a.snapshot.rules;
  if(!templates.length){if(input?.occurrences?.length)fail('O cenário não possui modelos de encontros.');return null;}
  for(const e of templates){
    const initial=e.participants.map((p,i)=>{try{return regionalParticipant(rules,p,'template',i);}catch(error){fail('Encontro “'+e.name+'”, participante “'+p.name+'”: '+error.message);}});
    if(e.options.some(o=>o.kind==='combat') && !initial.some(p=>p.character && !p.defeated))fail('Encontro “'+e.name+'” precisa de um oponente com PV para combater.');
    for(const o of e.options)if(o.kind==='test' && (!rules.attributes.some(r=>r.id===o.attribute) || !rules.actions.some(r=>r.kind==='test')))fail('Teste incompatível no encontro “'+e.name+'”.');
    for(const r of formulaReferences(e.condition))if(r.scope==='personagem' && r.field==='atributo' && !rules.attributes.some(v=>v.id===r.id))fail('Atributo inexistente na condição do encontro.');
  }
  const state=input ?? {nextId:1,lastTriggeredTurn:null,occurrences:[]};
  if(!Number.isInteger(state.nextId) || state.nextId<1 || state.nextId>1000001 || state.lastTriggeredTurn!==null && (!Number.isInteger(state.lastTriggeredTurn) || state.lastTriggeredTurn<1 || state.lastTriggeredTurn>a.turn.number) || !Array.isArray(state.occurrences) || state.occurrences.length>20)fail('Estado de encontros inválido.');
  let previous=0,active=0;
  const occurrences=state.occurrences.map(e=>{
    const sequence=Number(e.id?.replace(/^enc-/,'')),template=templates.find(t=>t.id===e.templateId);
    if(!/^enc-[1-9][0-9]*$/.test(e.id) || !Number.isInteger(sequence) || sequence<=previous || sequence>=state.nextId || !template || e.placeId!==null && !a.snapshot.world.places.some(p=>p.id===e.placeId) || !Number.isInteger(e.turn) || e.turn<1 || e.turn>a.turn.number || !['pending','combat','resolved'].includes(e.status))fail('Ocorrência de encontro inválida.');
    previous=sequence;
    if(e.status!=='resolved'){active++;if(e.placeId!==a.locationId || e.resolvedTurn!==null || e.resolution!==null)fail('Encontro ativo deve estar no local atual.');}
    else if(!Number.isInteger(e.resolvedTurn) || e.resolvedTurn<e.turn || e.resolvedTurn>a.turn.number || !['victory','defeat','escaped',...template.options.filter(o=>o.kind!=='combat').map(o=>o.id)].includes(e.resolution))fail('Conclusão do encontro inválida.');
    if(!Number.isInteger(e.attempts) || e.attempts<0 || e.attempts>100 || typeof e.lastResult!=='string' || e.lastResult.length>4000 || !Array.isArray(e.participants) || e.participants.length!==template.participants.length)fail('Participantes ou tentativas do encontro inválidos.');
    const participants=template.participants.map((p,i)=>regionalParticipant(rules,p,e.id,i,e.participants[i]));
    if(e.status==='combat' && !participants.some(p=>p.character && !p.defeated))fail('Combate sem oponente vivo.');
    if(e.resolution==='victory' && participants.some(p=>p.character && !p.defeated))fail('Vitória exige derrotar todos os adversários.');
    return {id:e.id,templateId:e.templateId,placeId:e.placeId,turn:e.turn,status:e.status,resolution:e.resolution,resolvedTurn:e.resolvedTurn,attempts:e.attempts,lastResult:e.lastResult,participants};
  });
  if(active>1 || occurrences.some(e=>e.turn>state.lastTriggeredTurn) || active && occurrences.at(-1).status==='resolved')fail('Ordem de encontros inválida.');
  const ids=occurrences.flatMap(e=>e.participants.map(p=>p.id));
  if(ids.some(id=>id===a.snapshot.character.id || (a.snapshot.world.npcs || []).some(n=>n.id===id)))fail('ID de participante conflita com outro personagem.');
  return {nextId:state.nextId,lastTriggeredTurn:state.lastTriggeredTurn,occurrences};
}
function attachRegionalNPCs(a) {
  const current=currentRegionalEncounter(a);if(!current)return;
  for(const p of current.occurrence.participants)a.turn.npcs.push({id:p.id,placeId:current.occurrence.placeId,character:p.character,defeated:p.defeated});
}
function triggerRegionalEncounter(a,seed,now,events,regionId=a.locationId) {
  if(!a.encounters || currentRegionalEncounter(a) || a.turn.character.hp<=0)return;
  const table=regionalEncounterTable(a.snapshot.world,regionId);
  if(!table.chance || !table.entries.length || a.encounters.lastTriggeredTurn!==null && a.turn.number-a.encounters.lastTriggeredTurn<table.cooldownTurns)return;
  const candidates=table.entries.map(entry=>({...entry,template:a.snapshot.world.encounters.find(t=>t.id===entry.encounterId)})).filter(e=>e.template.condition===null || evaluateMissionCondition(e.template.condition,{...coreOf(a),locationId:regionId}).met);
  if(!candidates.length)return;
  const rng=seed===undefined?Math.random:seededRng((seed ^ 0x9e3779b9)>>>0);
  if(rng()*100>=table.chance)return;
  let weight=rng()*candidates.reduce((n,e)=>n+e.weight,0),choice=candidates.at(-1);
  for(const candidate of candidates){weight-=candidate.weight;if(weight<0){choice=candidate;break;}}
  const id='enc-'+a.encounters.nextId++;
  const occurrence={id,templateId:choice.template.id,placeId:a.locationId,turn:a.turn.number,status:'pending',resolution:null,resolvedTurn:null,attempts:0,lastResult:'',participants:choice.template.participants.map((p,i)=>regionalParticipant(a.snapshot.rules,p,id,i))};
  a.encounters.occurrences=[...a.encounters.occurrences,occurrence].slice(-20);a.encounters.lastTriggeredTurn=a.turn.number;
  attachRegionalNPCs(a);const message='Encontro: '+choice.template.name+'. '+choice.template.description;events.push(message.slice(0,2000));journalEntry(a,'action',message,now);
}
function applyRegionalChoice(a,command,seed) {
  const current=currentRegionalEncounter(a);
  if(!current || command.occurrenceId!==current.occurrence.id)fail('Este encontro não está mais disponível.');
  const {occurrence,template}=current,option=template.options.find(o=>o.id===command.optionId);
  if(option?.id==='escapar' && option.kind==='test'){const p=occurrence.participants.find(p=>p.character && !p.defeated);return applyAdventureEscape(a,{npcId:p?.id},seed).join(' ');}
  if(template.hostile)fail('Encontro hostil: enfrente ou tente fugir.');
  if(!option || option.kind==='combat' || occurrence.status==='combat' && !option.duringCombat)fail('Opção indisponível neste encontro.');
  if(a.turn.character.hp<=0)fail('O personagem está incapacitado.');
  if(occurrence.attempts>=100)fail('Limite de tentativas deste encontro atingido.');
  occurrence.attempts++;let success=true,detail='';
  if(option.kind==='test'){
    const rule=a.snapshot.rules.actions.find(r=>r.kind==='test'),c=a.turn.character;
    const roll=evaluate(rule.formula,{actor:c.attributes,target:c.attributes,input:{attribute:option.attribute,difficulty:option.difficulty},testBonus:c.bonuses.test,attackBonus:c.bonuses.attack,defenseBonus:c.bonuses.defense},seed===undefined?Math.random:seededRng(seed));
    success=roll.total>=option.difficulty;detail=' Total '+roll.total+' contra dificuldade '+option.difficulty+'.';
  }
  occurrence.lastResult=option.label+': '+(success?'sucesso. ':'falha. ')+(success?option.text:option.failureText)+detail;
  if(success){occurrence.status='resolved';occurrence.resolution=option.id;occurrence.resolvedTurn=a.turn.number+1;}
  return occurrence.lastResult;
}
function applyRegionalCombat(a,command,seed) {
  const current=currentRegionalEncounter(a),p=current?.occurrence.participants.find(p=>p.id===command.npcId);
  if(!current || !p?.character || p.defeated || !current.template.options.some(o=>o.kind==='combat'))fail('Confronto regional indisponível.');
  const attacks=a.snapshot.rules.actions.filter(r=>r.kind==='attack'),choice=id=>{const rule=attacks.find(r=>r.id===(id || attacks[0]?.id));if(!rule)fail('Ataque inválido.');return {actionId:rule.id};};
  const round=simulateNPCEncounter(a.snapshot.rules,{combatants:[a.turn.character,p.character],choices:[choice(command.heroActionId),choice(command.npcActionId)],mode:seed===undefined?'random':'seeded',seed});
  a.turn.character=round.characters[0];p.character=round.characters[1];p.defeated=p.character.hp===0;Object.assign(a.turn.npcs.find(n=>n.id===p.id),{character:p.character,defeated:p.defeated});
  const e=current.occurrence;e.status='combat';
  if(a.turn.character.hp===0 || e.participants.every(n=>!n.character || n.defeated)){e.status='resolved';e.resolution=a.turn.character.hp===0?'defeat':'victory';e.resolvedTurn=a.turn.number+1;}
  const events=round.events.map(e=>e.kind==='skipped'?e.actor+': '+e.message:e.actor+' → '+e.target+': '+e.action+'; ataque '+e.roll.total+', defesa '+e.defense.total+', dano '+e.damage+'; PV '+e.hpBefore+' → '+e.hpAfter+(e.defeated?' · derrotado.':'.'));
  if(e.status==='resolved')events.push(e.resolution==='victory'?'Todos os adversários do encontro foram derrotados.':'O personagem foi incapacitado no encontro.');
  e.lastResult=events.join(' ').slice(0,4000);return events;
}

function applyAdventureEscape(a,command,seed) {
  const npc=a.turn.npcs.find(n=>n.id===command.npcId),def=visibleAdventureNPCs(a).find(n=>n.id===command.npcId);
  if(!def || !npc?.character || npc.defeated)fail('Selecione um adversário vivo no local para fugir.');
  const result=simulateEscape(a.snapshot.rules,a.turn.character,npc.character,{seed,npcActionId:command.npcActionId});
  a.turn.character=result.hero;
  const current=a.schemaVersion===2?currentRegionalEncounter(a):null;
  if(current){
    const e=current.occurrence;e.lastResult=result.events.join(' ');
    if(result.success || result.hero.hp===0){e.status='resolved';e.resolution=result.success?'escaped':'defeat';e.resolvedTurn=a.turn.number+1;}
    else e.status='combat';
  }
  return result.events;
}

function validateTravel(t,a) {
  const r=(a.snapshot.world.routes || []).find(r=>r.id===t.routeId);
  if(!r || ![r.fromPlaceId,r.toPlaceId].includes(t.fromPlaceId) || ![r.fromPlaceId,r.toPlaceId].includes(t.toPlaceId) || t.fromPlaceId===t.toPlaceId || !Number.isInteger(t.progress) || t.progress<1 || t.progress>=r.distance || a.locationId!==null)fail('Estado de viagem inválido.');
  return {routeId:r.id,fromPlaceId:t.fromPlaceId,toPlaceId:t.toPlaceId,progress:t.progress};
}
function advanceTravel(a,command) {
  if(a.turn.character.hp<=0)fail('O personagem está incapacitado.');
  let t=a.travel;
  if(t){if(command.routeId!==undefined && command.routeId!==t.routeId)fail('Continue pela rota atual.');}
  else {
    const r=(a.snapshot.world.routes || []).find(r=>r.id===command.routeId);
    if(!r || ![r.fromPlaceId,r.toPlaceId].includes(a.locationId))fail('Essa rota não parte do local atual.');
    t={routeId:r.id,fromPlaceId:a.locationId,toPlaceId:r.fromPlaceId===a.locationId?r.toPlaceId:r.fromPlaceId,progress:0};
  }
  const route=a.snapshot.world.routes.find(r=>r.id===t.routeId),region=ancestors(a.snapshot.world,t.fromPlaceId).filter(p=>ancestors(a.snapshot.world,t.toPlaceId).some(q=>q.id===p.id)).at(-1)?.id ?? null;
  // Walking speed is one distance unit per turn. Future transport changes speed, never route distance.
  t.progress+=1;
  if(t.progress>=route.distance){a.locationId=t.toPlaceId;delete a.travel;}
  else {a.locationId=null;a.travel=t;}
  return region;
}

function turnEffectContext(a,number=a.turn.number,paused=a.pausedTimeTurns || 0){return {personagem:{hp:a.turn.character.hp,hpMax:a.turn.character.maxHp,atributos:a.turn.character.attributes},cenario:{tempo:worldClock(a.snapshot.world,number,paused)},turno:{numero:number}};}
function applyTurnEffects(a,command,events){
  const action=Object.keys(command).find(k=>['rest','move','travel','combat','flee','activity','encounter'].includes(k) && command[k]) || 'wait';
  const region=a.travel?ancestors(a.snapshot.world,a.travel.fromPlaceId).filter(p=>ancestors(a.snapshot.world,a.travel.toPlaceId).some(q=>q.id===p.id)).at(-1)?.id ?? null:a.locationId;
  const chain=[null,...ancestors(a.snapshot.world,region).map(p=>p.id)],effective=new Map();
  for(const placeId of chain)for(const r of a.snapshot.world.turnRules || [])if(r.placeId===placeId){effective.delete(r.id);effective.set(r.id,r);}
  for(const r of effective.values()){
    const context={...coreOf(a),quests:a.quests,pausedTimeTurns:(a.pausedTimeTurns || 0)+(command.pauseTime?1:0),turnAction:action,turn:{...a.turn,number:a.turn.number+1}};
    if(!evaluateMissionCondition(r.condition,context).met)continue;
    for(const f of r.effects){const before=a.turn.character.hp,value=evaluate(f.formula,turnEffectContext(a,a.turn.number+1,(a.pausedTimeTurns || 0)+(command.pauseTime?1:0)),()=>0.5).total;if(!Number.isFinite(value))fail('Resultado inválido no gatilho '+r.id);a.turn.character.hp=Math.min(a.turn.character.maxHp,Math.max(0,Math.floor(value)));if(before!==a.turn.character.hp)events.push('Gatilho '+r.id+': PV '+before+' → '+a.turn.character.hp+'.');}
  }
  const encounter=currentRegionalEncounter(a);if(encounter && a.turn.character.hp===0){Object.assign(encounter.occurrence,{status:'resolved',resolution:'defeat',resolvedTurn:a.turn.number+1});}
}
