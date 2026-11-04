import { validateNPC, validateCondition, conditionLeaves, validateFormula, formulaReferences, calculateBoolean, worldClock } from './world.mjs';
// Missions reference an environment. Objectives describe intent, independent of a ruleset.
export class MissionError extends Error {}
export const OBJECTIVE_TYPES = [
  { id: 'combat', name: 'Combate', label: 'Oponente ou desafio', hint: 'Ex.: adversários, criatura ou sistema de defesa.' },
  { id: 'skill_test', name: 'Teste de habilidade', label: 'Habilidade ou capacidade', hint: 'Ex.: percepção, pilotagem, diplomacia ou força.' },
  { id: 'find_item', name: 'Encontrar item', label: 'Item procurado', hint: 'Ex.: documento, ferramenta, artefato ou componente.' },
  { id: 'investigate', name: 'Investigar', label: 'O que investigar', hint: 'Ex.: desaparecimento, sinal desconhecido ou avaria.' },
  { id: 'help_someone', name: 'Ajudar alguém', label: 'Quem ajudar', hint: 'Ex.: pessoa, grupo, comunidade ou tripulação.' },
  { id: 'other', name: 'Outro', label: 'Alvo ou referência', hint: 'Descreva uma situação específica do seu cenário.' }
];
export const OBJECTIVE_STATUSES = [
  { id: 'pending', name: 'Pendente' },
  { id: 'in_progress', name: 'Em andamento' },
  { id: 'completed', name: 'Concluído' }
];
const fail = message => { throw new MissionError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function allowed(value, keys, label) {
  const extra = Object.keys(value).find(key => !keys.includes(key));
  if (extra) fail(label + ': campo não suportado "' + extra + '".');
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(label + ': informe um texto' + (required ? ' não vazio' : '') + ' de até ' + max + ' caracteres.');
  return value.trim();
}
function id(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) fail(label + ': use até 80 letras sem acento, números, hífen ou sublinhado.');
  return value;
}
export function validateMissionDocument(input) {
  if (!object(input)) fail('A missão deve ser um objeto JSON.');
  allowed(input, ['schemaVersion', 'id', 'environmentId', 'name', 'description', 'objectives', 'npcs', 'facts', 'startPlaceId', 'offer', 'execution', 'completion', 'actions', 'items'], 'Missão');
  if (input.schemaVersion !== 1) fail('schemaVersion da missão deve ser 1.');
  const missionId = id(input.id, 'ID da missão');
  const environmentId = id(input.environmentId, 'Cenário obrigatório');
  const name = text(input.name, 'Nome da missão', 120, true);
  const description = text(input.description ?? '', 'Descrição da missão', 10000);
  if (!Array.isArray(input.objectives) || input.objectives.length < 1 || input.objectives.length > 50) fail('A missão deve ter de 1 a 50 objetivos.');
  const npcs = missionActors(input.npcs ?? []), facts = missionFacts(input.facts ?? []);
  if(input.execution!==undefined && input.execution!=='formula')fail('execution deve ser formula.');
  const actions=missionActions(input.actions || []), items=missionItems(input.items || []);
  const ids = new Set();
  const objectives = input.objectives.map((o, index) => {
    const label = 'Objetivo ' + (index + 1);
    if (!object(o)) fail(label + ' deve ser um objeto JSON.');
    allowed(o, ['id', 'type', 'title', 'description', 'target', 'placeId', 'completionCriteria', 'status', 'dependsOn', 'alternatives', 'completedAlternativeId', 'completion'], label);
    const objectiveId = id(o.id, label + ': ID');
    if (ids.has(objectiveId)) fail('ID de objetivo duplicado: ' + objectiveId + '.');
    ids.add(objectiveId);
    if (!OBJECTIVE_TYPES.some(t => t.id === o.type)) fail(label + ': tipo inválido. Use combate, teste, item, investigação, ajuda ou outro conforme os IDs do modelo.');
    if (!OBJECTIVE_STATUSES.some(s => s.id === o.status)) fail(label + ': status inválido.');
    const dependsOn = o.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.length > 49 || new Set(dependsOn).size !== dependsOn.length) fail(label + ': dependsOn deve ser uma lista sem IDs repetidos, com até 49 dependências.');
    dependsOn.forEach(value => id(value, label + ': dependência'));
    const sourceAlternatives = o.alternatives ?? [];
    if (!Array.isArray(sourceAlternatives) || sourceAlternatives.length > 10) fail(label + ': alternatives deve ser uma lista de até 10 caminhos.');
    const alternativeIds = new Set();
    const alternatives = sourceAlternatives.map(a => {
      if (!object(a)) fail(label + ': alternativa inválida.');
      allowed(a, ['id', 'type', 'title', 'description', 'target', 'placeId', 'completionCriteria', 'condition'], 'Alternativa');
      const alternativeId = id(a.id, 'ID da alternativa');
      if (alternativeIds.has(alternativeId)) fail(label + ': ID de alternativa duplicado.');
      alternativeIds.add(alternativeId);
      if (!OBJECTIVE_TYPES.some(t => t.id === a.type)) fail(label + ': tipo de alternativa inválido.');
      return { ...(a.condition !== undefined ? {condition:validateMissionCondition(a.condition)} : {}), id: alternativeId, type: a.type, title: text(a.title, 'Título da alternativa', 150, true), description: text(a.description ?? '', 'Descrição da alternativa', 4000), target: text(a.target ?? '', 'Alvo da alternativa', 300), placeId: a.placeId == null ? null : id(a.placeId, 'Lugar da alternativa'), completionCriteria: text(a.completionCriteria ?? '', 'Critério da alternativa', 2000) };
    });
    const completedAlternativeId = o.completedAlternativeId ?? null;
    if (completedAlternativeId !== null && !alternativeIds.has(completedAlternativeId)) fail(label + ': completedAlternativeId deve referenciar uma alternativa deste objetivo ou ser null.');
    if (o.status === 'completed' && alternatives.length && completedAlternativeId === null) fail(label + ': escolha a alternativa realizada antes de concluir.');
    const completion = o.completion !== undefined ? completionRule(o.completion) : null;
    if (completion?.mode === 'automatic' && alternatives.some(a => !a.condition)) fail('Cada alternativa de um objetivo automático precisa de condition.');
    return { ...(completion ? {completion} : {}), id: objectiveId, type: o.type, title: text(o.title, label + ': título', 150, true), description: text(o.description ?? '', label + ': descrição', 4000), target: text(o.target ?? '', label + ': alvo', 300), placeId: o.placeId == null ? null : id(o.placeId, label + ': lugar'), completionCriteria: text(o.completionCriteria ?? '', label + ': critério de conclusão', 2000), status: o.status, dependsOn: [...dependsOn], alternatives, completedAlternativeId };
  });
  const byId = new Map(objectives.map(o => [o.id, o]));
  for (const o of objectives) for (const c of [o.completion?.condition,...o.alternatives.map(a => a.condition)].flatMap(conditionLeaves)) {
    if (c.type === 'npc_defeated' && !npcs.some(n => n.id === c.npcId)) fail('NPC inexistente na condição: ' + c.npcId);
    if (c.type === 'fact_equals' && !facts.some(f => f.id === c.factId)) fail('Fato inexistente na condição: ' + c.factId);
    if (c.type === 'objective_completed' && !byId.has(c.objectiveId)) fail('Objetivo inexistente na condição: ' + c.objectiveId);
  }
  for (const n of npcs) for (const c of conditionLeaves(n.presence)) {
    if(c.type === 'npc_defeated' && c.npcId === n.id)fail('A presença do NPC não pode depender da própria derrota.');
    if (c.type === 'npc_defeated' && !npcs.some(n => n.id === c.npcId)) fail('NPC inexistente na presença: ' + c.npcId);
    if (c.type === 'fact_equals' && !facts.some(f => f.id === c.factId)) fail('Fato inexistente na presença: ' + c.factId);
    if (c.type === 'objective_completed' && !byId.has(c.objectiveId)) fail('Objetivo inexistente na presença: ' + c.objectiveId);
  }
  const visiting = new Set(), visited = new Set();
  function visit(o) {
    if (visiting.has(o.id)) fail('Ciclo de dependências: um objetivo não pode depender de si mesmo ou formar uma cadeia circular.');
    if (visited.has(o.id)) return;
    visiting.add(o.id);
    for (const dependency of o.dependsOn) {
      const parent = byId.get(dependency);
      if (!parent) fail('Dependência inexistente: ' + dependency + '.');
      visit(parent);
      if (o.status !== 'pending' && parent.status !== 'completed') fail('O objetivo “' + o.title + '” exige “' + parent.title + '” concluído. Para reabrir um pré-requisito, retorne seus objetivos dependentes para pendente primeiro.');
    }
    for (const c of [o.completion?.condition,...o.alternatives.map(a => a.condition)].flatMap(conditionLeaves)) if (c.type === 'objective_completed') visit(byId.get(c.objectiveId));
    visiting.delete(o.id); visited.add(o.id);
  }
  objectives.forEach(visit);
  const completion=input.completion===undefined ? undefined : validateFormula(input.completion);
  if(input.execution==='formula' && objectives.some(o=>o.completion?.mode!=='automatic' || !(o.completion.condition?.operator || typeof o.completion.condition==='boolean') || o.alternatives.some(a=>!(a.condition?.operator || typeof a.condition==='boolean'))))fail('Toda conclusão deve ter uma fórmula booleana no modo formula.');
  const expressions=[completion,...objectives.flatMap(o=>[o.completion?.condition,...o.alternatives.map(a=>a.condition)]),...npcs.map(n=>n.presence),...actions.map(a=>a.condition)];
  validateFormulaBindings(expressions,{npcs,objectives,facts,actions,items});
  for(const a of actions){
    if(a.npcId && !npcs.some(n=>n.id===a.npcId))fail('NPC inexistente na ação: '+a.npcId);
    if(a.itemId && !items.some(i=>i.id===a.itemId))fail('Item inexistente na ação: '+a.itemId);
  }
  let offer;
  if (input.offer !== undefined) {
    if (!object(input.offer)) fail('Oferta de missão inválida.');
    allowed(input.offer,['type','placeId','npcId','title','description'],'Oferta');
    if (!['notice','npc'].includes(input.offer.type)) fail('Tipo de oferta deve ser notice ou npc.');
    offer={type:input.offer.type,placeId:id(input.offer.placeId,'Lugar da oferta'),npcId:input.offer.type === 'npc' ? id(input.offer.npcId,'NPC da oferta') : null,title:text(input.offer.title || name,'Título da oferta',150,true),description:text(input.offer.description || description,'Texto da oferta',4000)};
  }
  const mission = { ...(input.execution ? {execution:input.execution} : {}), ...(completion!==undefined ? {completion} : {}), ...(input.actions!==undefined ? {actions}:{}), ...(input.items!==undefined ? {items}:{}), ...(offer ? {offer} : {}), schemaVersion: 1, id: missionId, environmentId, name, description, objectives, ...(input.startPlaceId !== undefined ? {startPlaceId:input.startPlaceId === null ? null : id(input.startPlaceId,'Local inicial')} : {}), ...(input.npcs !== undefined ? {npcs} : {}), ...(input.facts !== undefined ? {facts} : {}) };
  if (new TextEncoder().encode(JSON.stringify(mission)).length > 120000) fail('O JSON da missão deve ter até 120 KB.');
  return mission;
}
export function validateMission(input, environments) {
  const mission = validateMissionDocument(input);
  if (!Array.isArray(environments)) fail('Informe os cenários disponíveis.');
  const matches = environments.filter(e => object(e) && e.id === mission.environmentId);
  if (matches.length !== 1) fail('Cenário não encontrado. Toda missão deve pertencer a um cenário existente.');
  const environment = matches[0];
  if (!Array.isArray(environment.places) || environment.places.length > 500 || !environment.places.every(p => object(p) && typeof p.id === 'string')) fail('Lista de lugares do cenário inválida.');
  resolveMissionNPCs(environment,mission);
  if (mission.offer) {
    if (!environment.places.some(p=>p.id===mission.offer.placeId)) fail('Lugar da oferta não pertence ao cenário.');
    if (mission.offer.type === 'npc' && !(environment.npcs || []).some(n=>n.id===mission.offer.npcId && n.placeId===mission.offer.placeId)) fail('O NPC da oferta deve existir nesse lugar do cenário.');
  }
  const places = new Set(environment.places.map(p => p.id));
  if (mission.startPlaceId != null && !places.has(mission.startPlaceId)) fail('Local inicial não pertence ao cenário da missão.');
  for (const o of [...mission.objectives.flatMap(o => [o, ...o.alternatives]),...(mission.npcs || [])]) if (o.placeId != null && !places.has(o.placeId)) fail('O lugar do objetivo ou alternativa “' + o.title + '” não pertence ao cenário escolhido. Selecione um lugar válido ou deixe sem lugar específico.');
  for(const a of mission.actions || [])if(a.placeId!==null && !places.has(a.placeId))fail('Lugar inexistente na ação: '+a.id);
  return mission;
}
export function missionProgress(mission) {
  const completed = mission.objectives.filter(o => o.status === 'completed').length;
  const total = mission.objectives.length;
  const status = completed === total ? 'completed' : mission.objectives.some(o => o.status !== 'pending') ? 'in_progress' : 'pending';
  return { completed, total, percent: Math.round(completed / total * 100), status };
}
export function assertMissionLocations(missions, environmentId, nextWorld) {
  const ids = new Set(nextWorld.places.map(p => p.id));
  for (const mission of missions.filter(m => m.environmentId === environmentId)) {
    resolveMissionNPCs(nextWorld,mission);
    if (mission.startPlaceId != null && !ids.has(mission.startPlaceId)) fail('O lugar inicial é usado pela missão “' + mission.name + '”. Edite o local inicial antes de remover esse lugar.');
    for(const action of mission.actions || [])if(action.placeId!==null && !ids.has(action.placeId))fail('Lugar usado pela ação '+action.name+'. Edite a missão antes de remover esse lugar.');
    if(mission.offer && (!nextWorld.places.some(p=>p.id===mission.offer.placeId) || mission.offer.type==='npc' && !(nextWorld.npcs || []).some(n=>n.id===mission.offer.npcId && n.placeId===mission.offer.placeId)))fail('O lugar ou NPC é usado pela oferta da missão “'+mission.name+'”. Edite a oferta antes de alterar o cenário.');
    for (const o of [...mission.objectives.flatMap(o => [o, ...(o.alternatives || [])]),...(mission.npcs || []).map(n => ({...n,title:n.name}))]) if (o.placeId != null && !ids.has(o.placeId)) fail('O lugar “' + o.placeId + '” é usado pelo objetivo ou alternativa “' + o.title + '” da missão “' + mission.name + '”. Edite esse objetivo antes de remover ou substituir o lugar.');
  }
}
export function pendingDependencies(mission, objective) {
  return (objective.dependsOn || []).map(id => mission.objectives.find(o => o.id === id)).filter(o => o && o.status !== 'completed');
}

function createRawMissionTemplate(environment, missionId = 'missao-modelo-completo') {
  if (supportsPortoAuroraMission(environment)) return createRawPortoAuroraMission(environment, missionId);
  const placeId = environment.places[0]?.id ?? null;
  const goal = (id, type, title, target, criteria, dependsOn = [], location = null) => ({ id, type, title, description: 'Adapte este objetivo à história e ao cenário escolhido.', target, placeId: location, completionCriteria: criteria, status: 'pending', dependsOn, alternatives: [], completedAlternativeId: null });
  const mission = {
    schemaVersion: 1, id: missionId, environmentId: environment.id,
    name: 'Modelo completo: um pedido de ajuda',
    description: 'Exemplo de formato: todos os objetivos são obrigatórios, a ordem é livre salvo dependências explícitas e basta um caminho alternativo por objetivo. Adapte a narrativa ao seu cenário.',
    objectives: [
      goal('proteger-acesso', 'combat', 'Garantir acesso seguro', 'Grupo que bloqueia a passagem', 'A passagem pode ser utilizada com segurança.', [], placeId),
      goal('restabelecer-contato', 'skill_test', 'Restabelecer contato', 'Capacidade adequada ao cenário', 'Obter sucesso no teste definido para o sistema de regras.'),
      goal('obter-registro', 'find_item', 'Encontrar o registro desaparecido', 'Registro com informações importantes', 'O registro foi localizado e recuperado.', [], placeId),
      goal('investigar-origem', 'investigate', 'Investigar a origem do problema', 'As informações do registro', 'Identificar uma explicação sustentada pelas evidências.', ['obter-registro']),
      goal('ajudar-grupo', 'help_someone', 'Ajudar o grupo afetado', 'Moradores, viajantes ou tripulantes', 'O grupo recebeu a assistência necessária.'),
      goal('registrar-solucao', 'other', 'Comunicar a solução', 'Pessoas responsáveis pelo local', 'A descoberta foi comunicada e registrada.', ['investigar-origem', 'restabelecer-contato'])
    ]
  };
  const ownId = suffix => { let candidate = suffix + '-' + missionId; candidate = candidate.slice(0, 80); while ((environment.npcs || []).some(n => n.id === candidate)) candidate = 'm-' + candidate.slice(0, 78); return candidate; };
  mission.startPlaceId = placeId;
  if (placeId) mission.offer={type:'notice',placeId,npcId:null,title:'Um pedido de ajuda',description:'Um aviso pede ajuda para investigar um problema e auxiliar os afetados. Examine a proposta antes de aceitar.'};
  mission.npcs = [
    {id:ownId('contato'),name:'Contato do pedido de ajuda',description:'Apresenta o problema e orienta a busca pelo registro. Adapte o nome e a identidade ao cenário.',placeId,combatant:null,presence:null},
    {id:ownId('testemunha'),name:'Testemunha do ocorrido',description:'Pode esclarecer a origem do problema após a recuperação do registro.',placeId,combatant:null,presence:{type:'objective_completed',objectiveId:'obter-registro'}}
  ];
  const resident = (environment.npcs || [])[0];
  if (resident) mission.npcs.push({id:resident.id,environmentNpcId:resident.id});
  mission.objectives[0].alternatives = [
    { id: 'enfrentar', type: 'combat', title: 'Resolver por combate', description: 'Superar o grupo que impede a passagem.', target: 'Grupo de adversários', placeId, completionCriteria: 'Vencer o confronto e liberar a passagem.' },
    { id: 'negociar', type: 'skill_test', title: 'Negociar uma passagem', description: 'Chegar a um acordo com os responsáveis pelo bloqueio.', target: 'Negociação ou diplomacia', placeId, completionCriteria: 'Obter autorização por meio do acordo.' },
    { id: 'outro-caminho', type: 'other', title: 'Encontrar uma rota alternativa', description: 'Usar outra passagem existente no cenário.', target: 'Rota alternativa', placeId: null, completionCriteria: 'Alcançar o destino por uma rota segura.' }
  ];
  return validateMission(mission, [environment]);
}

export function missionLLMPrompt(environment, model = createMissionTemplate(environment)) {
  return `Crie UMA missão de RPG para o cenário fornecido. Retorne SOMENTE um objeto JSON válido, sem Markdown, comentários ou texto fora do JSON. Não retorne uma lista nem envolva o objeto em uma chave "mission". Use o contrato e o modelo abaixo. Adapte a história ao cenário, sem assumir fantasia medieval, tecnologia ou um sistema de regras específico.

TEMA DO CENÁRIO: ${environment.name}. Use os lugares, NPCs (hostile:boolean; true exige ficha e permite combate/fuga, false permite conversa) e o tom deste cenário. Crie uma história original compatível com ele; não reutilize lugares ou histórias de outro cenário.

CONTRATO COMPLETO — schemaVersion: 1
- NOVAS MISSÕES: execution: "formula". Todo objetivo exige completion: {mode:"automatic",evaluateAt:"turn_end",condition:FÓRMULA}; toda alternativa exige condition:FÓRMULA. completion na raiz é a fórmula de conclusão da missão, sempre combinada com todos os objetivos obrigatórios.
- FÓRMULA: booleano literal; {operator:"and"|"or",operands:[FÓRMULAS]}; {operator:"not",operand:FÓRMULA}; {operator:"eq"|"ne"|"gt"|"gte"|"lt"|"lte",left:VALOR,right:VALOR}. VALOR é literal booleano/número/string/null ou {ref:"caminho"}. Sem JavaScript, coerção ou texto livre. Comparações gt/gte/lt/lte são numéricas. Até 8 níveis, 250 nós e 50 operandos por and/or.
- Referências: npcs.ID.derrotado (booleano), npcs.ID.hp (número, só NPC com ficha); inventario.ID.quantidade (número); objetivos.ID.concluido (booleano); acoes.ID.executada (booleano), acoes.ID.sucessos e acoes.ID.tentativas (números); fatos.ID.valor (legado); personagem.hp e personagem.atributos.ATRIBUTO (números); local.id (string); turno.numero (número). Declare os IDs correspondentes; não use propriedades arbitrárias.
- items: até 100 objetos {id,name}. Começam com quantidade zero. actions: até 100 objetos {id,name,kind,placeId,condition?}. kind: interact, talk, investigate, help, collect, deliver ou test. talk/deliver exigem npcId declarado na missão (pode ser referência ao cenário). collect/deliver exigem itemId e quantity (1–1000). test exige attribute e difficulty (0–1000); ruleActionId opcional seleciona uma regra de kind test do conjunto carregado. Outros tipos não aceitam campos de teste ou item. condition é fórmula de disponibilidade. Ação bem-sucedida ocorre uma vez; falha em teste permite nova tentativa, até 100. Cada ação encerra um turno. Nenhuma ação altera objetivos diretamente.
- Entrega consome os itens; coleta os adiciona; interação, investigação e ajuda registram sucesso programado; testes usam atributo + fórmula da regra + dados, comparados à dificuldade. Para exigir pistas, conversas ou evidências, combine sucessos de ações ou quantidades de itens. Não dependa de interpretação por LLM.
- offer: {type:"notice" ou "npc", placeId: ID real do cenário, npcId: ID do NPC do cenário para type npc ou null, title, description}. Define onde examinar um anúncio ou conversar antes de aceitar. O NPC ofertante deve pertencer ao cenário e estar nesse lugar. startPlaceId é legado; o jogador escolhe o início da aventura independentemente da missão.
- Raiz: schemaVersion (1), id, environmentId, name (1–120 caracteres), description (até 10000), objectives (1–50 objetivos), startPlaceId opcional (ID de lugar inicial ou null), npcs opcional (até 20), facts opcional (até 100).
- Copie exatamente environmentId = ${JSON.stringify(environment.id)}. Não use o nome do cenário como ID.
- IDs: 1–80 caracteres; primeiro caractere alfanumérico; depois letras ASCII, números, hífen ou sublinhado. Cada objetivo tem um ID único na missão; cada alternativa tem ID único dentro do objetivo.
- Objetivo: id, type, title (1–150), description (até 4000), target (até 300), placeId, completionCriteria (até 2000), status, dependsOn, alternatives, completedAlternativeId, completion opcional.
- Tipos permitidos em objetivos e alternativas: ${OBJECTIVE_TYPES.map(t => t.id + ' (' + t.name + ')').join('; ')}.
- status: pending, in_progress ou completed. Em uma missão NOVA use pending em TODOS os objetivos e completedAlternativeId: null.
- Todos os objetivos são obrigatórios. Não crie campos optional, required, rewards, inventory ou rules. Use items para declarar itens e actions para ações executáveis.
- placeId é null ou um ID existente no catálogo deste cenário. Não invente IDs de lugares. Nomes não substituem IDs.
- dependsOn é uma lista de IDs de outros objetivos DESTA missão. Use [] por padrão para preservar a ordem livre. Só declare pré-requisitos reais. Todos os objetivos listados precisam estar concluídos antes de iniciar o dependente. Sem IDs repetidos, auto-referência ou ciclos; até 49 dependências.
- alternatives é [] quando há uma solução direta; ou até 10 maneiras de cumprir O MESMO objetivo. Basta realizar UMA alternativa, não todas. Uma alternativa usa: id, type, title, description, target, placeId, completionCriteria e condition opcional, com os mesmos limites de texto do objetivo. Não possui status, dependsOn ou alternatives aninhadas.
- completedAlternativeId é null enquanto nenhum caminho estiver selecionado, ou um ID da lista alternatives. Para marcar um objetivo com alternativas como completed, é obrigatório registrar qual alternativa foi realizada.
- COMPATIBILIDADE APENAS: modelos antigos sem execution podem ter completion omitido ou {"mode":"manual"}. Novas missões devem usar execution formula e condições booleanas. Automático: {"mode":"automatic","evaluateAt":"turn_end","condition":{"type":"npc_defeated","npcId":"npc-existente"}}. O avaliador roda depois das ações do turno, respeita dependsOn e preserva conclusões já registradas.
- Tipos de condition: npc_defeated (npcId), fact_equals (factId e value booleano), objective_completed (objectiveId), all/any (conditions com 1–20 filhos). Até 6 níveis e 100 nós por árvore. Referências devem existir. Não crie ciclos entre referências de objetivos ou dependências.
- Alternativas de objetivo automático exigem condition em CADA caminho; completion.condition e a condição de um caminho precisam ser atendidas. Havendo mais de um caminho válido, vence o primeiro da lista. Use any nas condições de caminhos alternativos.
- NPC próprio da missão: id, name (até 60), description (até 4000), placeId (mesmas regras de lugar), presence opcional (condition ou null), combatant (null ou {attributes,abilities,fields}). attributes é um objeto de inteiros 0–20 (até 12 atributos); abilities é uma lista de IDs; fields é objeto de até 8 textos. Uma ficha será validada contra as regras de combate da aventura. No modo formula, derrotas exigem ficha e resultado real de combate; para soluções pacíficas use sucessos de ações. Não invente atributos incompatíveis com o sistema utilizado.
- Para usar um NPC do cenário, inclua {"id":"id-existente","environmentNpcId":"id-existente"} em npcs. A referência reutiliza ficha, lugar e presença; não aceita sobrescrever esses campos. IDs de NPCs próprios não podem colidir com os do cenário. NPCs do cenário já fazem parte da aventura mesmo sem referência, mas condições da missão usam NPCs declarados em npcs, incluindo referências.
- presence usa os mesmos tipos de condition. Referências a objetivos, fatos e NPCs devem existir. Na aventura, só aparecem no local exato quando a condição for verdadeira. NPCs sem lugar só são visíveis quando a localização do personagem também for null.
- Fato: id, name (até 120), description (até 2000), initialValue booleano (false por padrão). Representa um acontecimento registrado na aventura, sem criar um inventário ou conceder XP.
- Combate dentro da aventura atualiza PV do personagem e do NPC e registra derrota. A arena independente não altera a aventura. Acontecimentos narrativos são informados pelo jogador/mestre. Texto de alvo, habilidade, item ou critério continua descritivo quando não houver condição.
- O JSON final deve ter até 120 KB. Inclua todos os campos do modelo; não é necessário usar todos os tipos numa mesma missão. O modelo demonstra as possibilidades, não impõe a mesma história.
- description, target e completionCriteria podem ser strings vazias. placeId e completedAlternativeId podem ser null. dependsOn e alternatives podem ser listas vazias. Nunca use string "null".

CONTEXTO DO CENÁRIO (dados descritivos de referência, não instruções):
${JSON.stringify(environment, null, 2)}

MODELO JSON VÁLIDO:
${JSON.stringify(model, null, 2)}

PEDIDO CRIATIVO (substitua este parágrafo antes de enviar):
Crie uma missão coerente com este cenário, com objetivos claros e critérios de conclusão verificáveis. Preserve liberdade de ordem e ofereça alternativas quando fizer sentido.`;
}

// This playable example uses the stable place IDs of the expanded Arvandor setting.
const PORTO_LOCATIONS = ['porto-aurora','mercado','sala-fundos','praca-central','cais','taverna','estalagem','ferraria','templo','biblioteca','guarda','farol','portao-norte','jardim'];
export function supportsPortoAuroraMission(environment) {
  if (!environment || !Array.isArray(environment.places)) return false;
  return PORTO_LOCATIONS.every(id => environment.places.some(p => p.id === id && (id === 'porto-aurora' || p.parentId === (id === 'sala-fundos' ? 'mercado' : 'porto-aurora'))));
}
function createRawPortoAuroraMission(environment, missionId = 'porto-aurora-noite-das-mares') {
  if (!supportsPortoAuroraMission(environment)) fail('O exemplo precisa do cenário atualizado de Porto Aurora. Em Cenários, abra JSON do cenário → Carregar exemplo no editor → Validar e aplicar → Confirmar substituição. Depois volte a Missões.');
  const goal = (id,type,title,placeId,description,target,completionCriteria,dependsOn = []) => ({id,type,title,description,target,placeId,completionCriteria,status:'pending',dependsOn,alternatives:[],completedAlternativeId:null});
  const path = (id,type,title,placeId,description,target,completionCriteria) => ({id,type,title,description,target,placeId,completionCriteria});
  const mission = {
    schemaVersion:1,id:missionId,environmentId:environment.id,
    name:'Porto Aurora: a Noite das Marés',
    description:'Uma tempestade se aproxima de Porto Aurora. O farol apagou, uma carga de mantimentos desapareceu e sinais falsos estão atraindo embarcações para uma área perigosa. A guarda pede ajuda enquanto moradores procuram abrigo. Investigue os indícios de sabotagem, ajude a cidade a se preparar e restabeleça a segurança do porto. O responsável é um intermediário do contrabando que adulterou registros, escondeu parte da carga e danificou o mecanismo do farol para encobrir uma retirada pelo cais. Os registros, o código de sinais e a caixa no jardim permitem demonstrar essa ligação. Há 24 objetivos obrigatórios; 18 podem começar em qualquer ordem. Só os objetivos com pré-requisitos reais têm dependências. Os três confrontos possuem soluções pacíficas. Os critérios orientam a avaliação manual do mestre ou jogador; encontros, testes e itens descritos não são gerados automaticamente.',
    objectives:[
      goal('ouvir-pedido','other','Organizar os pedidos de ajuda da cidade','praca-central','Na Praça da Âncora, um aviso reúne relatos sobre o farol, a carga desaparecida e a chegada da tempestade. Converse com a representante dos moradores para entender as necessidades imediatas.','Representante dos moradores e aviso público','Registrar os três problemas e combinar como comunicar as descobertas à guarda.'),
      goal('vistoriar-cais','investigate','Identificar os riscos no cais','cais','Observe os píeres, as amarras e a movimentação das embarcações. Uma área exposta à arrebentação precisa ser isolada antes que os trabalhadores sejam retirados.','Condições dos píeres e rotas de saída','Apontar o setor de risco, uma saída segura e um local onde os trabalhadores possam se reunir.'),
      goal('ajudar-estivadores','help_someone','Ajudar os estivadores a proteger o cais','cais','Trabalhadores tentam prender passarelas soltas e reforçar as amarras. Organize a equipe para reduzir o risco de queda e manter livre a passagem de saída.','Equipe de estivadores','A equipe recebeu ajuda e as amarras e passagens prioritárias foram verificadas.'),
      goal('acalmar-mercado','help_someone','Organizar a distribuição de mantimentos','mercado','A falta de parte da carga provocou filas e discussões. Ajude os comerciantes a separar o que está disponível e definir uma distribuição compreensível para os moradores.','Comerciantes e famílias na fila','A fila está organizada e os mantimentos disponíveis foram destinados sem tumulto.'),
      goal('proteger-mercado','combat','Restabelecer a segurança no mercado','mercado','Um grupo tenta tomar provisões à força. A prioridade é afastar o risco das famílias; escolha uma forma de encerrar a ameaça sem exigir necessariamente um combate.','Grupo que ameaça os comerciantes','A ameaça cessou e as pessoas conseguem circular com segurança.'),
      goal('investigar-arrombamento','investigate','Examinar a entrada da sala dos fundos','sala-fundos','A fechadura e a janela têm marcas recentes. Compare os sinais de entrada e os rastros no piso para distinguir a retirada da carga dos danos causados pelo vento.','Fechadura, janela e marcas no piso','Descrever ao menos dois indícios de retirada deliberada e sua provável rota de saída.'),
      goal('recuperar-registro','find_item','Recuperar o registro de recebimento','sala-fundos','Entre as prateleiras da sala dos fundos há um livro de recebimento com uma página dobrada. A quantidade entregue diverge da quantidade anotada como distribuída.','Livro de recebimento de mantimentos','Localizar o livro e registrar a divergência e a identificação do intermediário que assinou a retirada.'),
      goal('ouvir-viajantes','investigate','Reunir os relatos da taverna','taverna','Viajantes viram uma carroça sair do mercado e luzes intermitentes fora do horário habitual do farol. Compare os relatos sem presumir que todos observaram o mesmo fato.','Frequentadores da Taverna do Farol','Registrar dois relatos coerentes, com horários aproximados e o trajeto mencionado.'),
      goal('obter-boletim','find_item','Consultar o boletim da guarda','guarda','A sede da guarda mantém os registros de passagem de veículos e de ocorrências recentes. Peça acesso para comparar a circulação de carroças com os relatos da cidade.','Boletim de circulação e ocorrências','Consultar ou copiar a anotação de uma carroça ligada à retirada irregular e seu horário.'),
      goal('rastrear-marcas','skill_test','Interpretar os rastros no Portão Norte','portao-norte','A chuva começa a apagar as marcas junto ao portão. Use observação, rastreamento ou outra capacidade adequada para distinguir a direção de uma carroça carregada.','Observação ou rastreamento','Superar o teste definido pelo mestre e identificar a direção de deslocamento antes de as marcas desaparecerem.'),
      goal('sinalizar-portao','other','Organizar a passagem pelo Portão Norte','portao-norte','Moradores e viajantes se aproximam pela estrada. Delimite uma passagem de entrada e uma de saída e faça circular informações claras sobre os abrigos.','Fluxo de pessoas e avisos de orientação','O acesso de emergência permanece livre e há orientação visível para os abrigos.'),
      goal('acolher-moradores','help_someone','Preparar abrigo na estalagem','estalagem','A Estalagem Brisa Serena oferece o pátio e o salão térreo para famílias das áreas expostas. Organize os espaços com a responsável pelo local.','Famílias desalojadas e responsável pela estalagem','Há espaço seco, uma lista dos acolhidos e alguém encarregado de receber novas famílias.'),
      goal('separar-suprimentos','find_item','Localizar os suprimentos de emergência','templo','No depósito do Templo da Aurora há cobertores, recipientes e materiais de atendimento. Localize o conjunto destinado às emergências e combine sua distribuição.','Conjunto de suprimentos de emergência','Os suprimentos foram localizados e sua disponibilidade comunicada aos responsáveis pelo abrigo.'),
      goal('atender-feridos','skill_test','Prestar o atendimento inicial no templo','templo','Pessoas com escoriações chegam do cais. Colabore com os cuidadores, usando primeiros socorros ou outra capacidade compatível com a situação.','Primeiros socorros e organização do atendimento','Superar o teste adequado e garantir que os feridos tenham atendimento e encaminhamento seguros.'),
      goal('buscar-componentes','find_item','Obter os componentes do mecanismo do farol','ferraria','A ferraria guarda uma engrenagem de reposição e uma ferramenta de ajuste usadas na manutenção do farol. Explique o problema e solicite os componentes ao responsável.','Engrenagem de reposição e ferramenta de ajuste','Os componentes adequados foram identificados e cedidos para o reparo.'),
      goal('reparar-farol','skill_test','Restaurar o mecanismo de rotação do farol','farol','O eixo foi travado por uma peça deslocada. Com os componentes adequados e o acesso seguro, ajuste o mecanismo e teste a iluminação em rotação.','Reparo mecânico ou capacidade equivalente','Superar o teste definido e confirmar que o feixe percorre a enseada sem interrupções.',['buscar-componentes','assegurar-farol']),
      goal('assegurar-farol','combat','Garantir acesso seguro ao farol','farol','Dois cúmplices impedem a entrada na torre e querem abandonar o local antes da chegada da guarda. É possível dissuadi-los, contorná-los ou enfrentá-los.','Cúmplices que bloqueiam a torre','O acesso ao mecanismo está seguro e não há risco imediato para quem fará o reparo.'),
      goal('examinar-registros','investigate','Consultar as referências de navegação','biblioteca','A Biblioteca dos Navegantes guarda descrições dos sinais legítimos da costa e uma carta da enseada. Compare o procedimento oficial com os relatos de luzes incomuns.','Referências dos sinais costeiros','Identificar o padrão legítimo do farol e a área de perigo indicada na carta.'),
      goal('decifrar-sinal','skill_test','Decifrar a sequência de sinais falsos','biblioteca','Com o padrão legítimo em mãos, interprete a sequência observada pelos viajantes. Ela orienta uma embarcação até um píer afastado para retirar a carga desviada.','Interpretação de códigos, navegação ou raciocínio','Superar o teste definido e explicar que os sinais direcionam a retirada pelo cais.',['examinar-registros','ouvir-viajantes']),
      goal('investigar-jardim','investigate','Investigar a movimentação no Jardim das Fontes','jardim','Um canteiro foi pisoteado e há sulcos recentes no cascalho, longe do trajeto normal dos visitantes. Examine a área para localizar um possível esconderijo.','Canteiros, cascalho e acesso de serviço','Determinar um ponto de busca apoiado nos sinais observados.'),
      goal('encontrar-caixa','find_item','Localizar a caixa escondida no jardim','jardim','No ponto indicado pelos rastros, uma caixa coberta por uma lona guarda parte da carga e uma ordem de retirada assinada pelo mesmo intermediário do livro do mercado.','Caixa de mantimentos e ordem de retirada','Localizar a caixa, preservar a ordem assinada e informar à guarda onde está a carga.',['investigar-jardim']),
      goal('evacuar-cais','help_someone','Retirar as pessoas da área exposta do cais','cais','Com os riscos e a saída identificados, conduza trabalhadores e passageiros até um ponto seguro sem bloquear o acesso de emergência.','Trabalhadores e passageiros na área exposta','Todas as pessoas identificadas no setor de risco foram orientadas e chegaram a uma área segura.',['vistoriar-cais']),
      goal('interromper-retirada','combat','Interromper a retirada da carga desviada','cais','O livro do mercado, a ordem encontrada no jardim e os sinais decifrados apontam para um intermediário prestes a embarcar a carga. Apresente as evidências e escolha como impedir sua retirada.','Intermediário responsável pelo desvio e seus cúmplices','A retirada foi impedida, as evidências foram preservadas e a carga ficou sob guarda segura.',['recuperar-registro','decifrar-sinal','encontrar-caixa']),
      goal('entregar-relatorio','other','Entregar o relatório e encerrar a emergência','guarda','Reúna os registros, os depoimentos e o resultado das ações. A guarda precisa receber uma explicação verificável do desvio, da recuperação do farol e da situação das pessoas retiradas do cais.','Responsável pela guarda de Porto Aurora','As evidências foram entregues, os reparos e o acolhimento foram comunicados e há responsáveis definidos para a continuidade do atendimento.',['interromper-retirada','reparar-farol','evacuar-cais'])
    ]
  };
  mission.objectives.find(o => o.id === 'proteger-mercado').alternatives = [
    path('enfrentar','combat','Conter o grupo em confronto','mercado','Afaste os envolvidos das famílias e vença o confronto conforme as regras em uso.','Grupo agressor','O grupo deixou de ameaçar as pessoas e o mercado está seguro.'),
    path('negociar','skill_test','Negociar a dispersão do grupo','mercado','Ouça a demanda e convença o grupo a aceitar a distribuição organizada, sem ameaças.','Diplomacia, persuasão ou equivalente','O acordo foi aceito e a distribuição pode continuar em segurança.'),
    path('organizar-saida','other','Organizar a saída segura com os comerciantes','mercado','Coordene a retirada das famílias e o fechamento temporário das entradas com apoio dos responsáveis locais.','Comerciantes e acesso ao mercado','As famílias estão seguras, as entradas protegidas e o risco imediato foi encerrado.')
  ];
  mission.objectives.find(o => o.id === 'assegurar-farol').alternatives = [
    path('enfrentar','combat','Superar os bloqueadores','farol','Resolva o confronto afastando os cúmplices do mecanismo e da escadaria.','Cúmplices no farol','O confronto terminou e o caminho até o mecanismo está seguro.'),
    path('dissuadir','skill_test','Convencer os cúmplices a sair','farol','Mostre o risco para as embarcações e ofereça uma rendição à guarda.','Persuasão ou intimidação adequada','Os bloqueadores deixaram a entrada e aceitaram cessar a interferência.'),
    path('acesso-lateral','other','Usar o acesso de manutenção','farol','Com a orientação do responsável local, utilize o acesso de manutenção e assegure a porta interna antes do reparo.','Responsável pela manutenção e porta interna','A equipe alcançou o mecanismo e o acesso ficou protegido contra nova interferência.')
  ];
  mission.objectives.find(o => o.id === 'interromper-retirada').alternatives = [
    path('confrontar','combat','Impedir o embarque em confronto','cais','Contenha os responsáveis sem pôr os passageiros em risco e preserve a carga.','Intermediário e cúmplices','Os responsáveis não podem prosseguir com o embarque e a carga está segura.'),
    path('obter-rendicao','skill_test','Obter a rendição com as evidências','cais','Apresente os documentos e demonstre que a operação foi descoberta.','Negociação com o intermediário','O responsável entregou a carga e aceitou se apresentar à guarda.'),
    path('acionar-guarda','other','Coordenar a intervenção da guarda','guarda','Entregue as evidências e o horário da retirada para que a guarda organize uma abordagem no cais.','Equipe da guarda e responsáveis pela carga','A guarda confirmou a interceptação, preservou a carga e recebeu os documentos.')
  ];
  mission.startPlaceId = 'portao-norte';
  mission.offer={type:'notice',placeId:'praca-central',npcId:null,title:'Porto Aurora precisa de ajuda',description:'Um aviso na Praça da Âncora pede voluntários para proteger o porto, investigar os desvios de mantimentos e restaurar o farol.'};
  if ((environment.npcs || []).some(n=>n.id==='vera-mensageira' && n.placeId==='praca-central')) mission.offer={...mission.offer,type:'npc',npcId:'vera-mensageira',title:'Ouvir o pedido de Vera'};
  mission.npcs = [
    {id:'bloqueador-mercado',name:'Líder do bloqueio no mercado',description:'Impede a circulação das cargas. Pode ser enfrentado, convencido a liberar a passagem ou contornado por uma rota alternativa.',placeId:'mercado'},
    {id:'vigia-farol',name:'Vigia que bloqueia o farol',description:'Controla o acesso às lentes e aos mecanismos de sinalização durante a tempestade.',placeId:'farol'},
    {id:'capitao-contrabandistas',name:'Capitão dos contrabandistas',description:'Organiza a retirada da carga desviada e conhece a origem dos sinais usados pelos contrabandistas.',placeId:'cais'}
  ].map(n => ({...n,combatant:{attributes:{forca:2,habilidade:1,resistencia:1,armadura:1,poderFogo:3},abilities:[],fields:{origem:'Porto Aurora',perfil:'Outro',historia:'Adversário da missão a Noite das Marés.'}}}));
  mission.npcs.push({id:'testemunha-taverna',name:'Nilo, testemunha do cais',description:'Um viajante que observou a saída de uma carroça e os sinais incomuns. Aparece na taverna depois de você conhecer o pedido de ajuda.',placeId:'taverna',combatant:null,presence:{type:'objective_completed',objectiveId:'ouvir-pedido'}});
  for (const npcId of ['guarda-portao','mara-taverneira','arquivista-biblioteca','selma-mercadora','tomas-estivador','bento-estalajadeiro','ines-ferreira','elisa-curandeira','helena-comandante','raul-faroleiro','dora-jardineira','vera-mensageira']) {
    if ((environment.npcs || []).some(n => n.id === npcId)) mission.npcs.push({id:npcId,environmentNpcId:npcId});
  }
  mission.facts = [];
  const factCondition = (factId,name,description) => {
    mission.facts.push({id:factId,name,description,initialValue:false});
    return {type:'fact_equals',factId,value:true};
  };
  const automatic = condition => ({mode:'automatic',evaluateAt:'turn_end',condition});
  for (const objective of mission.objectives.filter(o => o.type === 'find_item')) objective.completion=automatic(factCondition('fato-' + objective.id,objective.title,'Registre apenas depois de realizar: ' + objective.completionCriteria));
  for (const [objectiveId,npcId] of [['proteger-mercado','bloqueador-mercado'],['assegurar-farol','vigia-farol'],['interromper-retirada','capitao-contrabandistas']]) {
    const o=mission.objectives.find(o => o.id === objectiveId);
    o.alternatives.forEach(alt => {alt.condition=alt.type === 'combat' ? {type:'npc_defeated',npcId} : factCondition('fato-' + objectiveId + '-' + alt.id,alt.title,alt.completionCriteria);});
    o.completion=automatic({type:'any',conditions:o.alternatives.map(alt => alt.condition)});
  }
  mission.objectives.find(o => o.id === 'reparar-farol').completion=automatic(factCondition('farol-restaurado','Mecanismo do farol restaurado','Registre o resultado bem-sucedido do reparo após o teste conduzido na história.'));
  mission.objectives.find(o => o.id === 'entregar-relatorio').completion=automatic({type:'all',conditions:[
    factCondition('relatorio-entregue','Relatório entregue à guarda','Registre a entrega das evidências e do relatório final.'),
    ...[mission.objectives.slice(0,12),mission.objectives.slice(12,23)].map(group => ({type:'all',conditions:group.map(o => ({type:'objective_completed',objectiveId:o.id}))}))
  ]});
  mission.description += ' Este modelo inclui três adversários com fichas de 8 pontos, uma testemunha com presença condicional e referências a moradores quando disponíveis. São dez objetivos automáticos e treze fatos narrativos. Os moradores referenciados mantêm seus locais e dados do cenário, sem duplicação. A derrota vem do combate na aventura; fatos narrativos são registrados pelo jogador/mestre e avaliados no fim do turno. Os demais objetivos continuam manuais. Para outro conjunto de regras, adapte as fichas dos NPCs no JSON antes de criar a aventura.';
  return validateMission(mission,[environment]);
}

export function validateMissionCondition(input,depth=0,budget={count:0}) {try{return validateCondition(input,depth,budget);}catch(e){fail(e.message);}}
function completionRule(input) {
  if (!object(input)) fail('completion deve ser um objeto.');
  if (input.mode === 'manual') { allowed(input,['mode'],'Conclusão manual'); return {mode:'manual'}; }
  allowed(input,['mode','evaluateAt','condition'],'Conclusão automática');
  if (input.mode !== 'automatic' || input.evaluateAt !== 'turn_end') fail('Conclusão automática exige mode automatic e evaluateAt turn_end.');
  return {mode:'automatic',evaluateAt:'turn_end',condition:validateMissionCondition(input.condition)};
}
function missionActors(input) {
  if (!Array.isArray(input) || input.length > 20) fail('npcs deve ter até 20 registros.');
  let npcs;try{npcs=input.map(n => validateNPC(n,{allowReference:true}));}catch(e){fail(e.message);}
  if (new Set(npcs.map(n => n.id)).size !== npcs.length) fail('NPC duplicado.');return npcs;
}
function missionFacts(input) {
  if (!Array.isArray(input) || input.length > 100) fail('facts deve ter até 100 registros.');
  const ids = new Set();
  return input.map(f => {
    if (!object(f)) fail('Fato inválido.');allowed(f,['id','name','description','initialValue'],'Fato');
    const factId=id(f.id,'ID do fato');if(ids.has(factId))fail('Fato duplicado.');ids.add(factId);
    if (f.initialValue !== undefined && typeof f.initialValue !== 'boolean') fail('initialValue deve ser booleano.');
    return {id:factId,name:text(f.name,'Nome do fato',120,true),description:text(f.description ?? '','Descrição do fato',2000),initialValue:f.initialValue ?? false};
  });
}
export function evaluateMissionCondition(c, adventure) {
  const m = adventure.snapshot.mission;
  if(typeof c==='boolean' || c?.operator){const met=calculateBoolean(c,r=>resolveMissionReference(r,adventure));return {met,reason:'Fórmula '+JSON.stringify(c).slice(0,1400)+' = '+met};}
  if (['all','any'].includes(c.type)) {
    const results = c.conditions.map(child => evaluateMissionCondition(child,adventure));
    const met = c.type === 'all' ? results.every(r => r.met) : results.some(r => r.met);
    return {met,reason:(c.type === 'all' ? 'Todas: ' : 'Uma das condições: ') + results.map(r => r.reason).join('; ').slice(0,1800)};
  }
  if (c.type === 'npc_defeated') {
    const n = adventure.turn.npcs.find(n => n.id === c.npcId);
    return {met:n?.defeated === true,reason:((m.npcs || []).find(n => n.id === c.npcId)?.name || (adventure.snapshot.world.npcs || []).find(n => n.id === c.npcId)?.name || c.npcId) + (n?.defeated ? ': derrotado' : ': ainda não derrotado')};
  }
  if (c.type === 'fact_equals') {
    const met = adventure.turn.facts.find(f => f.id === c.factId)?.value === c.value;
    return {met,reason:(m.facts || []).find(f => f.id === c.factId)?.name + ': esperado ' + (c.value ? 'sim' : 'não') + (met ? ' (atendido)' : ' (não atendido)')};
  }
  const o=adventure.progress.find(o => o.id === c.objectiveId);
  return {met:o?.status === 'completed',reason:m.objectives.find(o => o.id === c.objectiveId)?.title + (o?.status === 'completed' ? ': concluído' : ': ainda pendente')};
}

export function resolveMissionNPCs(environment,mission) {
  const catalog=new Map();
  for (const source of environment.npcs || []) {
    let n;try {n=validateNPC(source,{requirePlace:true});}catch(e){fail(e.message);}
    if(catalog.has(n.id))fail('NPC duplicado no cenário.');catalog.set(n.id,{...n,origin:'environment'});
  }
  for(const n of mission.npcs || []) {
    if(n.environmentNpcId) {if(!catalog.has(n.environmentNpcId))fail('NPC do cenário não encontrado: ' + n.environmentNpcId);continue;}
    if(catalog.has(n.id))fail('Já existe NPC no cenário com ID “' + n.id + '”. Use environmentNpcId para referenciá-lo sem duplicar.');
    catalog.set(n.id,{...n,origin:'mission'});
  }
  return [...catalog.values()];
}

export function validateFormulaBindings(expressions,mission,rules=null) {
  for(const expression of expressions)for(const r of formulaReferences(expression)){
    const records={npcs:mission.npcs,objetivos:mission.objectives,fatos:mission.facts,acoes:mission.actions,inventario:mission.items};
    if(records[r.scope]!==undefined && !(records[r.scope] || []).some(x=>x.id===r.id))fail('Referência inexistente: '+r.ref);
    if(['npcs','objetivos','fatos','acoes','inventario'].includes(r.scope) && !records[r.scope])fail('Referência inexistente: '+r.ref);
    if(rules && r.scope==='personagem' && r.field==='atributo' && !rules.attributes.some(a=>a.id===r.id))fail('Atributo inexistente na fórmula: '+r.id);
  }
}
function missionItems(input){
  if(!Array.isArray(input) || input.length>100)fail('items deve ter até 100 itens.');
  const items=input.map(i=>{if(!object(i))fail('Item inválido.');allowed(i,['id','name'],'Item');return {id:id(i.id,'ID do item'),name:text(i.name,'Nome do item',120,true)};});
  if(new Set(items.map(i=>i.id)).size!==items.length)fail('Item duplicado.');return items;
}
function missionActions(input){
  if(!Array.isArray(input) || input.length>100)fail('actions deve ter até 100 ações.');
  const actions=input.map(a=>{
    if(!object(a))fail('Ação inválida.');allowed(a,['id','name','kind','placeId','npcId','itemId','quantity','attribute','difficulty','ruleActionId','condition'],'Ação');
    if(!['interact','talk','investigate','help','collect','deliver','test'].includes(a.kind))fail('Tipo de ação inválido.');
    const next={id:id(a.id,'ID da ação'),name:text(a.name,'Nome da ação',150,true),kind:a.kind,placeId:a.placeId==null?null:id(a.placeId,'Lugar da ação'),...(a.npcId?{npcId:id(a.npcId,'NPC da ação')}:{})};
    if(['collect','deliver'].includes(a.kind)){
      next.itemId=id(a.itemId,'Item da ação');next.quantity=a.quantity ?? 1;
      if(!Number.isInteger(next.quantity) || next.quantity<1 || next.quantity>1000)fail('Quantidade deve ser de 1 a 1000.');
      if(a.kind==='deliver' && !next.npcId)fail('Entrega exige npcId.');
    } else if(a.itemId!==undefined || a.quantity!==undefined)fail('Itens só podem ser usados em coleta ou entrega.');
    if(a.kind==='talk' && !next.npcId)fail('Conversa exige npcId.');
    if(a.kind==='test'){
      next.attribute=id(a.attribute,'Atributo do teste');next.difficulty=a.difficulty;next.ruleActionId=a.ruleActionId || null;
      if(!Number.isInteger(next.difficulty) || next.difficulty<0 || next.difficulty>1000)fail('Dificuldade inválida.');
      if(next.ruleActionId!==null)id(next.ruleActionId,'Regra do teste');
    } else if(a.attribute!==undefined || a.difficulty!==undefined || a.ruleActionId!==undefined)fail('Atributos de teste só se aplicam a test.');
    if(a.condition!==undefined)next.condition=validateFormula(a.condition);
    return next;
  });
  if(new Set(actions.map(a=>a.id)).size!==actions.length)fail('Ação duplicada.');return actions;
}
export function resolveMissionReference(r,a){
  const missing=()=>fail('Estado não disponível para '+r.ref);
  const find=(items)=>items?.find(i=>i.id===r.id) ?? missing();
  if(r.scope==='npcs'){const n=find(a.turn.npcs);if(r.field==='hp' && !n.character)fail('NPC sem ficha não possui hp: '+r.id);return r.field==='derrotado'?n.defeated:n.character.hp;}
  if(r.scope==='objetivos')return find(a.progress).status==='completed';
  if(r.scope==='fatos')return find(a.turn.facts).value;
  if(r.scope==='inventario')return find(a.turn.inventory).quantity;
  if(r.scope==='acoes'){const action=find(a.turn.activities);return r.field==='executada'?action.successes>0:r.field==='sucessos'?action.successes:action.attempts;}
  if(r.scope==='personagem')return r.field==='atributo'?a.turn.character.attributes[r.id]:a.turn.character.hp;
  if(r.scope==='local')return a.locationId || '';
  if(r.scope==='turno')return r.field==='acao'?a.turnAction || '':a.turn.number;
  if(r.scope==='cenario')return worldClock(a.snapshot.world,a.turn.number,a.pausedTimeTurns || 0)[r.field];
  if(r.scope==='missoes')return a.quests?.find(q=>q.snapshot.mission.id===r.id)?.status || 'not_accepted';
  return missing();
}
export function missionIsComplete(a){return a.progress.every(p=>p.status==='completed') && (a.turn.completedMissionTurn!==undefined && a.status==='completed' || a.snapshot.mission.completion===undefined || evaluateMissionCondition(a.snapshot.mission.completion,a).met);}

export function createMissionTemplate(environment,missionId='missao-modelo-completo',options={}) {
  if(!options.legacy && supportsEriadorMission(environment))return validateMission({...createEriadorMissions(environment)[0],id:missionId},[environment]);
  const model=createRawMissionTemplate(environment,missionId);return options.legacy?model:compileFormulaMission(model,environment);
}
export function createPortoAuroraMission(environment,missionId='porto-aurora-noite-das-mares',options={}) {
  const model=createRawPortoAuroraMission(environment,missionId);return options.legacy?model:compileFormulaMission(model,environment);
}
export function compileFormulaMission(input,environment){
  const m=structuredClone(input);m.execution='formula';m.actions=[];m.items=[];
  const factActions=new Map(), ref=ref=>({ref}), eq=(left,right)=>({operator:'eq',left,right}), success=id=>({operator:'gte',left:ref('acoes.'+id+'.sucessos'),right:1});
  const prerequisites=o=>o.dependsOn.length?{operator:'and',operands:o.dependsOn.map(id=>eq(ref('objetivos.'+id+'.concluido'),true))}:true;
  function actionFor(o,alt=null,factId=null){
    const source=alt || o, kind=source.type==='skill_test'?'test':source.type==='find_item'?'collect':source.type==='investigate'?'investigate':source.type==='help_someone'?'help':'interact';
    const action={id:('agir-'+(factId || o.id+(alt?'-'+alt.id:''))).slice(0,80),name:source.title,kind,placeId:source.placeId ?? o.placeId ?? null,condition:prerequisites(o)};
    if(kind==='test'){action.attribute='habilidade';action.difficulty=5;}
    if(kind==='collect'){
      action.itemId=('item-'+o.id).slice(0,80);action.quantity=1;
      if(!m.items.some(i=>i.id===action.itemId))m.items.push({id:action.itemId,name:source.target || source.title});
    }
    m.actions.push(action);
    const condition=kind==='collect'?{operator:'gte',left:ref('inventario.'+action.itemId+'.quantidade'),right:1}:success(action.id);
    if(factId)factActions.set(factId,condition);
    return condition;
  }
  function convert(c,o,alt){
    if(c?.type==='all' || c?.type==='any')return {operator:c.type==='all'?'and':'or',operands:c.conditions.map(c=>convert(c,o,alt))};
    if(c?.type==='npc_defeated')return eq(ref('npcs.'+c.npcId+'.derrotado'),true);
    if(c?.type==='objective_completed')return eq(ref('objetivos.'+c.objectiveId+'.concluido'),true);
    if(c?.type==='fact_equals'){
      if(!factActions.has(c.factId))actionFor(o,alt,c.factId);
      return c.value?factActions.get(c.factId):{operator:'not',operand:factActions.get(c.factId)};
    }
    return c;
  }
  for(const o of m.objectives){
    for(const alt of o.alternatives){
      if(alt.condition)alt.condition=convert(alt.condition,o,alt);
      else if(alt.type==='combat'){
        let enemy=m.npcs.find(n=>n.combatant && n.placeId===(alt.placeId ?? o.placeId));
        if(!enemy){
          let npcId='oponente-modelo';while([...(m.npcs || []),...(environment.npcs || [])].some(n=>n.id===npcId))npcId+='x';
          enemy={id:npcId,name:'Responsável pelo bloqueio',description:'Adversário deste objetivo; também é possível escolher uma solução pacífica.',placeId:alt.placeId ?? o.placeId,combatant:{attributes:{forca:2,habilidade:1,resistencia:1,armadura:1,poderFogo:3},abilities:[],fields:{perfil:'Outro'}}};m.npcs.push(enemy);
        }
        alt.condition=eq(ref('npcs.'+enemy.id+'.derrotado'),true);
      }else alt.condition=actionFor(o,alt);
    }
    const condition=o.completion?.condition?convert(o.completion.condition,o):o.alternatives.length?{operator:'or',operands:o.alternatives.map(a=>a.condition)}:actionFor(o);
    o.completion={mode:'automatic',evaluateAt:'turn_end',condition};
  }
  for(const n of m.npcs || [])if(n.presence)n.presence=convert(n.presence,m.objectives[0]);
  m.facts=[];
  m.completion={operator:'and',operands:m.objectives.map(o=>eq(ref('objetivos.'+o.id+'.concluido'),true))};
  m.description=m.description.replace(/ Este modelo inclui[\s\S]*$/,'').replace('Os critérios orientam a avaliação manual do mestre ou jogador; encontros, testes e itens descritos não são gerados automaticamente.','As ações de investigação, ajuda, coleta e testes estão declaradas no JSON e são executadas pelo motor.')+' Todos os objetivos são calculados por fórmulas booleanas. Execute ações nos lugares indicados; testes e combates usam as regras selecionadas. A conclusão é avaliada no fim do turno, sem LLM ou marcação manual. As fichas e os testes do exemplo usam 3D&T Adaptável.';
  return validateMission(m,[environment]);
}

export function supportsEriadorMission(environment){
  const parents={'terra-media':null,eriador:'terra-media',condado:'eriador',bolsao:'condado',valfenda:'eriador','casa-elrond':'valfenda',rohan:'terra-media',edoras:'rohan',mordor:'terra-media','montanha-perdicao':'mordor'};
  const residents={frodo:'bolsao',elrond:'casa-elrond','uruk-hai-batedor':'rohan',gollum:'montanha-perdicao','espectro-anel':'mordor'};
  return Boolean(environment && Object.entries(parents).every(([id,parentId])=>environment.places?.some(p=>p.id===id && p.parentId===parentId)) && Object.entries(residents).every(([id,placeId])=>environment.npcs?.some(n=>n.id===id && n.placeId===(environment.navigation==='gateways'?(environment.places.find(p=>p.id===placeId)?.entryPlaceId || placeId):placeId))));
}
export function createEriadorMissions(environment){
  if(environment.navigation==='gateways'){
    const point=id=>environment.places.find(p=>p.id===id)?.entryPlaceId || id;
    const base={...environment,navigation:undefined,npcs:environment.npcs.map(n=>({...n,placeId:environment.places.find(p=>p.entryPlaceId===n.placeId)?.id || n.placeId}))};
    const remap=v=>{if(Array.isArray(v))return v.map(remap);if(v && typeof v==='object'){const copy=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='placeId'||k==='startPlaceId'?point(x):remap(x)]));if(v.left?.ref==='local.id' && typeof v.right==='string')copy.right=point(v.right);return copy;}return v;};
    return createEriadorMissions(base).map(m=>validateMission(remap(m),[environment]));
  }

  if(!supportsEriadorMission(environment))fail('Importe o cenário Eriador e Além completo, com seus dez lugares e cinco NPCs, antes de carregar estas missões.');
  const ref=ref=>({ref}),eq=(left,right)=>({operator:'eq',left,right}),gte=(left,right)=>({operator:'gte',left,right}),all=conditions=>conditions.length?{operator:'and',operands:conditions}:true;
  const done=id=>eq(ref('objetivos.'+id+'.concluido'),true),success=id=>gte(ref('acoes.'+id+'.sucessos'),1);
  function builder(id,name,description,offer){
    const m={schemaVersion:1,id,environmentId:environment.id,name,description,execution:'formula',offer,npcs:[],facts:[],items:[],actions:[],objectives:[]};
    const npc=id=>{if(!m.npcs.some(n=>n.id===id))m.npcs.push({id,environmentNpcId:id});};
    const item=(id,name)=>{if(!m.items.some(i=>i.id===id))m.items.push({id,name});return id;};
    function actionGoal(id,title,kind,placeId,description,dependsOn=[],extra={}){
      const {condition=true,itemName,...params}=extra;
      if(params.npcId)npc(params.npcId);
      if(params.itemId)item(params.itemId,itemName || title);
      const action={id:'agir-'+id,name:title,kind,placeId,...params,condition:all([...dependsOn.map(done),condition])};
      m.actions.push(action);
      const conditionGoal=kind==='collect'?all([success(action.id),gte(ref('inventario.'+params.itemId+'.quantidade'),params.quantity || 1)]):success(action.id);
      m.objectives.push({id,title,type:({talk:'investigate',interact:'other',investigate:'investigate',help:'help_someone',collect:'find_item',deliver:'help_someone',test:'skill_test'})[kind],description,target:params.npcId || params.itemId || title,placeId,status:'pending',dependsOn,alternatives:[],completionCriteria:'Realizar a ação correspondente com sucesso; a condição é calculada no fim do turno.',completion:{mode:'automatic',evaluateAt:'turn_end',condition:conditionGoal}});
      return id;
    }
    function encounter(id,title,placeId,npcId,description,dependsOn,paths){
      npc(npcId);
      const alternatives=[{id:'combater',type:'combat',title:'Vencer o confronto',description:'Enfrentar o adversário presente usando as regras de combate da aventura.',target:npcId,placeId,completionCriteria:'O motor registra a derrota do NPC.',condition:eq(ref('npcs.'+npcId+'.derrotado'),true)}];
      for(const [pathId,pathTitle,difficulty] of paths){
        const action={id:'agir-'+id+'-'+pathId,name:pathTitle,kind:'test',placeId,attribute:'habilidade',difficulty,condition:all(dependsOn.map(done))};m.actions.push(action);
        alternatives.push({id:pathId,type:'skill_test',title:pathTitle,description:'Uma solução pacífica resolvida por teste de Habilidade.',target:'Teste de Habilidade',placeId,completionCriteria:'A fórmula da regra de teste alcança a dificuldade '+difficulty+'.',condition:success(action.id)});
      }
      m.objectives.push({id,title,type:'combat',description,target:npcId,placeId,status:'pending',dependsOn,alternatives,completionCriteria:'Realizar uma das alternativas: combate ou teste pacífico.',completion:{mode:'automatic',evaluateAt:'turn_end',condition:{operator:'or',operands:alternatives.map(a=>a.condition)}}});
      return id;
    }
    const finish=()=>{m.completion=all(m.objectives.map(o=>done(o.id)));return validateMission(m,[environment]);};
    return {m,npc,item,goal:actionGoal,encounter,finish};
  }
  const journey=builder('eriador-caminho-das-sombras','Eriador: O Caminho das Sombras','Frodo pede ajuda para reconhecer as estradas e levar a Elrond provas de movimentos inimigos. Prepare a viagem no Condado, consulte Valfenda, auxilie Edoras e investigue os sinais de Mordor. Uma expedição original pelas rotas da Terra Média. Todos os 24 objetivos são obrigatórios; somente as dependências explícitas limitam a ordem. Os confrontos têm alternativas pacíficas. Cada ação encerra um turno, e todas as conclusões são calculadas por fórmulas.',{type:'npc',placeId:'bolsao',npcId:'frodo',title:'Ouvir o pedido de Frodo',description:'Frodo precisa de alguém que reconheça as estradas e leve a Elrond informações sobre patrulhas e sinais sombrios. Você pode aceitar a expedição ou deixar para depois.'});
  const g=journey.goal;
  g('ouvir-frodo','Conversar com Frodo sobre as estradas','talk','bolsao','Ouça os relatos do Portador do Anel antes de partir.',[],{npcId:'frodo'});
  g('preparar-mantimentos','Separar mantimentos no Bolsão','collect','bolsao','Reúna provisões para a viagem.',[],{itemId:'eriador-mantimentos',itemName:'Mantimentos de viagem',quantity:1});
  g('examinar-condado','Examinar sinais nas trilhas do Condado','investigate','condado','Procure marcas incomuns próximas às rotas usadas pelos Hobbits.');
  g('ajudar-hobbits','Ajudar os moradores do Condado','help','condado','Use o preparo da viagem para organizar os mantimentos dos moradores.',['preparar-mantimentos'],{condition:gte(ref('inventario.eriador-mantimentos.quantidade'),1)});
  g('seguir-rastros','Investigar rastros nas terras de Eriador','investigate','eriador','Siga os indícios vistos no Condado.',['examinar-condado']);
  g('interpretar-rastros','Interpretar a direção das patrulhas','test','eriador','Distinguir passos de viajantes dos movimentos de uma patrulha.',['seguir-rastros'],{attribute:'habilidade',difficulty:5});
  g('recolher-mensagem','Recolher uma mensagem abandonada','collect','eriador','Recupere a mensagem deixada junto à trilha.',['seguir-rastros'],{itemId:'eriador-mensagem',itemName:'Mensagem das patrulhas',quantity:1});
  g('estudar-mapas','Estudar os caminhos de Valfenda','investigate','valfenda','Compare os caminhos conhecidos com as rotas observadas.');
  g('consultar-elrond','Consultar Mestre Elrond','talk','casa-elrond','Peça orientação ao Senhor de Valfenda.',[],{npcId:'elrond'});
  g('entregar-mensagem','Entregar a mensagem a Elrond','deliver','casa-elrond','A entrega consome a mensagem do inventário.',['recolher-mensagem','consultar-elrond'],{npcId:'elrond',itemId:'eriador-mensagem',itemName:'Mensagem das patrulhas',quantity:1});
  g('decifrar-selos','Decifrar os selos da mensagem','test','casa-elrond','Interprete os símbolos com o auxílio dos mapas.',['entregar-mensagem','estudar-mapas'],{attribute:'habilidade',difficulty:5});
  g('registrar-conselho','Registrar as orientações do conselho','interact','casa-elrond','Registre as rotas e os sinais que deverão ser investigados.',['decifrar-selos']);
  g('observar-batedor','Observar o batedor em Rohan','investigate','rohan','Reconheça a posição do Uruk-hai antes de decidir como avançar.');
  journey.encounter('assegurar-passagem','Assegurar passagem pelas terras de Rohan','rohan','uruk-hai-batedor','O batedor de Isengard vigia a região. É possível enfrentá-lo, contornar sua patrulha ou distraí-lo.',['observar-batedor'],[['contornar','Contornar a patrulha Uruk-hai',5],['distrair','Distrair o batedor sem confronto',6]]);
  g('chegar-edoras','Apresentar-se em Edoras','interact','edoras','Avise que as estradas estão sendo reconhecidas.',['assegurar-passagem']);
  g('recolher-provisoes','Recolher provisões em Edoras','collect','edoras','Reabasteça a expedição com os suprimentos disponíveis.',[],{itemId:'eriador-mantimentos',itemName:'Mantimentos de viagem',quantity:2});
  g('ajudar-rohirrim','Ajudar os Rohirrim a preparar a viagem','help','edoras','Compartilhe as informações de passagem e organize os preparativos.',['chegar-edoras']);
  g('atravessar-fronteira','Encontrar passagem segura para Mordor','test','mordor','Aplique as orientações do conselho para reconhecer uma passagem.',['registrar-conselho','assegurar-passagem'],{attribute:'habilidade',difficulty:6});
  g('encontrar-trilha','Investigar os sinais das terras negras','investigate','mordor','Procure uma trilha que leve às inscrições próximas ao vulcão.',['atravessar-fronteira']);
  journey.encounter('proteger-expedicao','Proteger a expedição do Nazgûl','mordor','espectro-anel','O servo de Sauron ameaça a expedição enquanto Frodo permanece vivo. Enfrente-o ou evite ser detectado.',['encontrar-trilha'],[['furtividade','Ocultar a expedição do Nazgûl',6],['desviar','Desviar a atenção do servo de Sauron',6]]);
  g('ouvir-gollum','Ouvir Gollum junto à Montanha da Perdição','talk','montanha-perdicao','Obtenha indicações sobre os sinais gravados na pedra.',['proteger-expedicao'],{npcId:'gollum'});
  g('ler-inscricoes','Interpretar as inscrições na pedra','test','montanha-perdicao','Compare as inscrições com os selos estudados em Valfenda.',['ouvir-gollum','decifrar-selos'],{attribute:'habilidade',difficulty:6});
  g('recolher-fragmento','Recolher um fragmento com inscrições','collect','montanha-perdicao','Guarde uma prova material para o conselho.',['ler-inscricoes'],{itemId:'eriador-fragmento',itemName:'Fragmento com inscrições sombrias',quantity:1});
  g('entregar-provas','Entregar as provas e o relato a Elrond','deliver','casa-elrond','Retorne a Valfenda. A expedição termina após todas as tarefas obrigatórias e a entrega do fragmento.',journey.m.objectives.map(o=>o.id),{npcId:'elrond',itemId:'eriador-fragmento',itemName:'Fragmento com inscrições sombrias',quantity:1});
  const letters=builder('eriador-cartas-do-conselho','Valfenda: Cartas do Conselho','Elrond solicita uma entrega reservada ao Condado. Examine o selo, entregue a carta a Frodo e traga sua resposta. Cinco objetivos automáticos; a entrega consome os documentos correspondentes.',{type:'npc',placeId:'casa-elrond',npcId:'elrond',title:'Ouvir o pedido de Elrond',description:'Elrond precisa enviar uma carta ao Bolsão e receber uma resposta de Frodo. A tarefa pode ser feita junto com outras viagens.'});
  letters.npc('elrond');
  letters.goal('retirar-carta','Retirar a carta do conselho','collect','casa-elrond','Receba a carta preparada pelo conselho.',[],{itemId:'conselho-carta',itemName:'Carta selada de Elrond',quantity:1});
  letters.goal('examinar-selo','Examinar o selo élfico','test','valfenda','Memorize os sinais usados para conferir a mensagem.',['retirar-carta'],{attribute:'habilidade',difficulty:4});
  letters.goal('entregar-carta','Entregar a carta a Frodo','deliver','bolsao','Entregue o documento ao destinatário.',['examinar-selo'],{npcId:'frodo',itemId:'conselho-carta',itemName:'Carta selada de Elrond',quantity:1});
  letters.goal('receber-resposta','Receber a resposta de Frodo','collect','bolsao','A resposta só fica disponível após a entrega.',['entregar-carta'],{npcId:'frodo',itemId:'conselho-resposta',itemName:'Resposta de Frodo',quantity:1});
  letters.goal('devolver-resposta','Levar a resposta a Elrond','deliver','casa-elrond','Conclua a tarefa entregando a resposta.',['receber-resposta'],{npcId:'elrond',itemId:'conselho-resposta',itemName:'Resposta de Frodo',quantity:1});
  const provisions=builder('eriador-provisoes-de-edoras','Rohan: As Provisões de Edoras','Um anúncio em Edoras pede ajuda para preparar remédios de viagem. Converse com o intendente, procure ervas em Rohan e entregue o lote preparado. Seis objetivos automáticos, sem combate obrigatório.',{type:'notice',placeId:'edoras',npcId:null,title:'Examinar o aviso de suprimentos de Edoras',description:'O intendente busca voluntários para reunir ervas e preparar remédios destinados aos viajantes das estradas de Rohan.'});
  provisions.m.npcs.push({id:'eothain-intendente',name:'Éothain, intendente de Edoras',description:'Organiza os lotes de suprimentos e recebe os remédios preparados. Personagem desta missão.',placeId:'edoras',combatant:null,presence:null});
  provisions.goal('ouvir-intendente','Conversar com o intendente de Edoras','talk','edoras','Descubra quais suprimentos são necessários.',[],{npcId:'eothain-intendente'});
  provisions.goal('reconhecer-campos','Reconhecer os campos de Rohan','investigate','rohan','Identifique uma área adequada para coletar as ervas.');
  provisions.goal('coletar-ervas','Coletar ervas de viagem','collect','rohan','Recolha duas porções das ervas reconhecidas.',['reconhecer-campos'],{itemId:'edoras-ervas',itemName:'Ervas de viagem de Rohan',quantity:2});
  provisions.goal('preparar-remedios','Preparar o lote de remédios','test','edoras','Organize as ervas conforme as orientações do intendente.',['ouvir-intendente','coletar-ervas'],{attribute:'habilidade',difficulty:5,condition:gte(ref('inventario.edoras-ervas.quantidade'),2)});
  provisions.goal('entregar-lote','Entregar o lote ao intendente','deliver','edoras','A entrega consome as duas porções de ervas.',['preparar-remedios'],{npcId:'eothain-intendente',itemId:'edoras-ervas',itemName:'Ervas de viagem de Rohan',quantity:2});
  provisions.goal('confirmar-ajuda','Confirmar a distribuição dos suprimentos','talk','edoras','Receba a confirmação final do intendente.',['entregar-lote'],{npcId:'eothain-intendente'});
  return [journey.finish(),letters.finish(),provisions.finish()];
}
