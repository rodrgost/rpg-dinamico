// Worlds contain places and resident NPC templates. Inventory and mission progress belong to adventures.
export class WorldError extends Error {}
const fail = message => { throw new WorldError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, label, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(label + ': informe um texto' + (required ? ' não vazio' : '') + ' de até ' + max + ' caracteres.');
  return value;
};
function allowed(value, keys, label) {
  const extra = Object.keys(value).find(key => !keys.includes(key));
  if (extra) fail(label + ': campo não suportado "' + extra + '".');
}
function detailValue(value, depth = 0) {
  if (depth > 10) fail('Detalhes: use no máximo 10 níveis de informações.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    if (value.length > 100) fail('Detalhes: uma lista pode ter até 100 valores.');
    for (const entry of value) detailValue(entry, depth + 1);
    return;
  }
  if (object(value)) {
    if (Object.keys(value).length > 100) fail('Detalhes: use até 100 campos por objeto.');
    for (const [key, entry] of Object.entries(value)) { if (key.length > 100) fail('Detalhes: nome de campo muito longo.'); detailValue(entry, depth + 1); }
    return;
  }
  fail('Detalhes deve conter somente valores JSON.');
}
export function validateWorld(input) {
  if (!object(input)) fail('O cenário deve ser um objeto JSON.');
  allowed(input, ['schemaVersion', 'name', 'description', 'places', 'npcs', 'encounters', 'routes', 'time', 'turnRules', 'navigation'], 'Cenário');
  if (input.schemaVersion !== 1) fail('schemaVersion deve ser 1.');
  text(input.name, 'Nome do mundo', 100, true);
  text(input.description ?? '', 'Descrição do mundo', 10000);
  if (!Array.isArray(input.places) || input.places.length > 500) fail('places deve ser uma lista com até 500 lugares.');
  const ids = new Set();
  for (const place of input.places) {
    if (!object(place)) fail('Cada lugar deve ser um objeto JSON.');
    allowed(place, ['id', 'parentId', 'name', 'type', 'description', 'details', 'x', 'y', 'encounterTable', 'entryPlaceId'], 'Lugar');
    if (typeof place.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(place.id)) fail('ID de lugar: use até 64 letras sem acento, números, hífen ou sublinhado.');
    if (ids.has(place.id)) fail('ID de lugar duplicado: ' + place.id + '.');
    ids.add(place.id);
    text(place.name, 'Nome do lugar', 100, true);
    text(place.type, 'Tipo do lugar', 60, true);
    text(place.description ?? '', 'Descrição do lugar', 10000);
    if (place.parentId !== null && typeof place.parentId !== 'string') fail('parentId deve ser o ID de outro lugar ou null para a raiz.');
    const x = place.x ?? null, y = place.y ?? null;
    if ((x === null) !== (y === null)) fail('Posição: preencha X e Y juntos, ou deixe ambos vazios.');
    if (x !== null && (![x,y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100))) fail('X e Y devem ser números entre 0 e 100.');
    if (!object(place.details ?? {})) fail('details deve ser um objeto JSON de informações descritivas.');
    detailValue(place.details ?? {});
  }
  const byId = new Map(input.places.map(place => [place.id, place]));
  for (const place of input.places) {
    let current = place;
    const visited = new Set();
    while (current) {
      if (visited.has(current.id)) fail('Ciclo na hierarquia: ' + place.name + ' não pode pertencer a si mesmo ou a um descendente.');
      visited.add(current.id);
      if (visited.size > 64) fail('Use no máximo 64 níveis de lugares.');
      if (current.parentId === null) break;
      if (!byId.has(current.parentId)) fail('Lugar pai inexistente: ' + current.parentId + '.');
      current = byId.get(current.parentId);
    }
  }
  if (!Array.isArray(input.npcs ?? []) || (input.npcs || []).length > 100) fail('O cenário pode ter até 100 NPCs.');
  const npcs=(input.npcs || []).map(n => validateNPC(n,{requirePlace:true}));
  if (new Set(npcs.map(n => n.id)).size !== npcs.length) fail('NPC duplicado no cenário.');
  for (const n of npcs) {
    if (!ids.has(n.placeId)) fail('O lugar do NPC “' + n.name + '” não existe neste cenário.');
    for(const r of formulaReferences(n.presence))if(r.scope==='npcs' && r.field==='hp' && !npcs.some(n=>n.id===r.id && n.combatant))fail('NPC sem ficha não possui hp: '+r.id);
    for (const c of conditionLeaves(n.presence)) {
      if (c.type !== 'npc_defeated') fail('Presença do cenário só consulta NPCs do cenário. Condições de objetivos e fatos devem ficar nos NPCs da missão.');
      if (!npcs.some(n => n.id === c.npcId)) fail('NPC inexistente na condição de presença.');
      if (c.npcId === n.id) fail('A presença do NPC não pode depender de sua própria derrota.');
    }
  }
  const encounters=validateRegionalEncounters(input.encounters ?? [],npcs);
  for(const place of input.places)if(place.encounterTable!==undefined)validateEncounterTable(place.encounterTable,encounters);
  const routes=validateRoutes(input.routes ?? [],input.places,input.navigation);
  if(input.navigation!==undefined && input.navigation!=='gateways')fail('Modo de navegação inválido.');
  for(const p of input.places){if(p.entryPlaceId!==undefined){const entry=input.places.find(v=>v.id===p.entryPlaceId);if(!entry || entry.parentId!==p.id || input.places.some(v=>v.parentId===entry.id))fail('Entrada deve ser um ponto folha diretamente dentro da região.');}if(input.navigation==='gateways' && input.places.some(v=>v.parentId===p.id) && !p.entryPlaceId)fail('Região exige entryPlaceId.');}
  const time=validateWorldTime(input.time),turnRules=validateTurnRules(input.turnRules ?? [],input.places);
  const encoded = JSON.stringify(input);
  if (new TextEncoder().encode(encoded).length > 240000) fail('O cenário deve ter até 240 KB.');
  return { ...(input.navigation?{navigation:input.navigation}:{}), ...(input.time!==undefined?{time}:{}),...(input.turnRules!==undefined?{turnRules}:{}), ...(input.routes!==undefined?{routes}:{}), ...(input.encounters!==undefined?{encounters}:{}), ...(input.npcs !== undefined ? {npcs} : {}), schemaVersion: 1, name: input.name.trim(), description: input.description ?? '', places: input.places.map(place => ({ ...(place.entryPlaceId!==undefined?{entryPlaceId:place.entryPlaceId}:{}), ...(place.encounterTable!==undefined?{encounterTable:validateEncounterTable(place.encounterTable,encounters)}:{}), id: place.id, parentId: place.parentId, name: place.name.trim(), type: place.type.trim(), x: place.x ?? null, y: place.y ?? null, description: place.description ?? '', details: JSON.parse(JSON.stringify(place.details ?? {})) })) };
}
export function ancestors(world, id) {
  const byId = new Map(world.places.map(place => [place.id, place]));
  const chain = [], seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) { chain.unshift(current); seen.add(current.id); current = byId.get(current.parentId); }
  return chain;
}
export function descendants(world, id) {
  const ids = new Set([id]);
  for (let count = 0; count < world.places.length; count++) {
    let changed = false;
    for (const place of world.places) if (ids.has(place.parentId) && !ids.has(place.id)) { ids.add(place.id); changed = true; }
    if (!changed) break;
  }
  ids.delete(id);
  return ids;
}
export function savePlace(world, place, editingId = null) {
  if (editingId !== null && !world.places.some(p => p.id === editingId)) fail('Lugar não encontrado.');
  if (editingId !== null && place.id !== editingId) fail('O ID de um lugar existente deve ser preservado.');
  if (editingId === null && world.places.some(p => p.id === place.id)) fail('ID de lugar já existe: ' + place.id + '.');
  const places = editingId === null ? [...world.places, place] : world.places.map(p => p.id === editingId ? place : p);
  return validateWorld({ ...world, places });
}
export function removePlace(world, id) {
  if (!world.places.some(place => place.id === id)) fail('Lugar não encontrado.');
  if ((world.npcs || []).some(n => n.placeId === id)) fail('Mova ou remova os NPCs deste lugar antes de excluí-lo.');
  if (world.places.some(place => place.parentId === id)) fail('Mova ou exclua os lugares internos antes de excluir este lugar.');
  return validateWorld({ ...world, places: world.places.filter(place => place.id !== id) });
}

const npcId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
export function validateCondition(input, depth = 0, budget = {count:0}) {
  if (typeof input==='boolean' || input?.operator)return validateFormula(input);
  if (!object(input) || depth > 6 || ++budget.count > 100) fail('Condição inválida: até 6 níveis e 100 nós.');
  if (['all','any'].includes(input.type)) {
    allowed(input,['type','conditions'],'Condição');
    if (!Array.isArray(input.conditions) || input.conditions.length < 1 || input.conditions.length > 20) fail('all/any exige de 1 a 20 condições.');
    return {type:input.type,conditions:input.conditions.map(c => validateCondition(c,depth+1,budget))};
  }
  if (!['npc_defeated','fact_equals','objective_completed'].includes(input.type)) fail('Tipo de condição não suportado.');
  const key={npc_defeated:'npcId',fact_equals:'factId',objective_completed:'objectiveId'}[input.type];
  allowed(input,['type',key,...(input.type === 'fact_equals' ? ['value'] : [])],'Condição');
  if (!npcId(input[key])) fail('Referência da condição inválida.');
  const result={type:input.type,[key]:input[key]};
  if (input.type === 'fact_equals') {if(typeof input.value !== 'boolean')fail('fact_equals exige value booleano.');result.value=input.value;}
  return result;
}
export function conditionLeaves(c) {if(c?.operator)return formulaReferences(c).map(r=>r.scope==='npcs'?{type:'npc_defeated',npcId:r.id}:r.scope==='objetivos'?{type:'objective_completed',objectiveId:r.id}:r.scope==='fatos'?{type:'fact_equals',factId:r.id}:({type:'formula_ref',ref:r.ref}));return c ? ['all','any'].includes(c.type) ? c.conditions.flatMap(conditionLeaves) : [c] : [];}
export function validateNPC(input, {allowReference = false, requirePlace = false} = {}) {
  if (!object(input)) fail('NPC deve ser um objeto.');
  if (input.environmentNpcId !== undefined) {
    if (!allowReference) fail('NPCs do cenário não podem ser referências.');
    allowed(input,['id','environmentNpcId'],'Referência de NPC');
    if (!npcId(input.environmentNpcId) || input.id !== undefined && input.id !== input.environmentNpcId) fail('A referência deve preservar o ID do NPC do cenário.');
    return {id:input.environmentNpcId,environmentNpcId:input.environmentNpcId};
  }
  allowed(input,['id','name','description','placeId','combatant','presence','hostile'],'NPC');
  if (!npcId(input.id)) fail('ID de NPC inválido: use até 80 letras, números, hífen ou sublinhado.');
  text(input.name,'Nome do NPC',60,true);text(input.description ?? '','Descrição do NPC',4000);
  const placeId=input.placeId ?? null;
  if (placeId !== null && !npcId(placeId) || requirePlace && placeId === null) fail('Selecione um lugar para o NPC.');
  let combatant=null;
  if (input.combatant != null) {
    const c=input.combatant;if(!object(c))fail('Ficha do NPC inválida.');allowed(c,['attributes','abilities','fields'],'Ficha do NPC');
    if (!object(c.attributes) || !Object.keys(c.attributes).length || Object.keys(c.attributes).length > 12 || !Object.values(c.attributes).every(v => Number.isInteger(v) && v >= 0 && v <= 20)) fail('Atributos do NPC inválidos.');
    if (!Array.isArray(c.abilities) || c.abilities.length > 20 || new Set(c.abilities).size !== c.abilities.length || !c.abilities.every(npcId)) fail('Habilidades do NPC inválidas.');
    if (!object(c.fields ?? {}) || Object.keys(c.fields ?? {}).length > 8 || !Object.values(c.fields ?? {}).every(v => typeof v === 'string' && v.length <= 500)) fail('Campos do NPC inválidos.');
    combatant=structuredClone({attributes:c.attributes,abilities:c.abilities,fields:c.fields ?? {}});
  }
  const hostile=input.hostile ?? ['uruk-hai-batedor','espectro-anel'].includes(input.id);
  if(typeof hostile!=='boolean' || hostile && !combatant)fail('NPC hostil exige hostile booleano e ficha de combate.');
  return {id:input.id,name:input.name.trim(),description:input.description ?? '',placeId,combatant,...(input.hostile!==undefined || hostile?{hostile}:{}),presence:input.presence == null ? null : validateCondition(input.presence)};
}
export function saveNPC(world,npc,editingId=null) {
  const entry=validateNPC(npc,{requirePlace:true});
  if (editingId && editingId !== entry.id) fail('Preserve o ID do NPC que está sendo editado.');
  if (editingId && !(world.npcs || []).some(n => n.id === editingId)) fail('NPC não encontrado.');
  if (!editingId && (world.npcs || []).some(n => n.id === entry.id)) fail('NPC duplicado.');
  return validateWorld({...world,npcs:editingId ? world.npcs.map(n => n.id === editingId ? entry : n) : [...(world.npcs || []),entry]});
}
export function removeNPC(world,id) {
  if (!(world.npcs || []).some(n => n.id === id)) fail('NPC não encontrado.');
  return validateWorld({...world,npcs:world.npcs.filter(n => n.id !== id)});
}

// Typed, bounded boolean AST. No eval, coercion or arbitrary property traversal.
export function formulaReference(ref) {
  if(typeof ref!=='string' || ref.length>200 || ref.split('.').some(p=>['__proto__','prototype','constructor'].includes(p)))fail('Referência de fórmula inválida.');
  const parts=ref.split('.'), [scope,id,field]=parts;
  if(scope==='cenario' && id!=='tempo')fail('Referência de tempo inválida.');
  const catalog={npcs:{derrotado:'boolean',hp:'number'},inventario:{quantidade:'number'},objetivos:{concluido:'boolean'},acoes:{executada:'boolean',sucessos:'number',tentativas:'number'},fatos:{valor:'boolean'},personagem:{hp:'number'},local:{id:'string'},turno:{numero:'number',acao:'string'},cenario:{hora:'number',minuto:'number',dia:'number'},missoes:{status:'string'}};
  if(scope==='personagem' && id==='atributos' && parts.length===3 && npcId(field))return {scope,id:field,field:'atributo',type:'number',ref};
  if(['personagem','local','turno'].includes(scope) && parts.length===2 && catalog[scope][id])return {scope,id:null,field:id,type:catalog[scope][id],ref};
  if(parts.length!==3 || !npcId(id) || !Object.hasOwn(catalog,scope) || !Object.hasOwn(catalog[scope],field))fail('Referência desconhecida: '+ref);
  return {scope,id,field,type:catalog[scope][field],ref};
}
export function validateFormula(input) {
  let count=0;
  function node(n,depth=0) {
    if(depth>8 || ++count>250)fail('Fórmula excede 8 níveis ou 250 nós.');
    if(n===null || ['boolean','string','number'].includes(typeof n)) {
      if(typeof n==='number' && !Number.isFinite(n) || typeof n==='string' && n.length>200)fail('Literal inválido na fórmula.');
      return {value:n,type:n===null?'null':typeof n};
    }
    if(!object(n))fail('Expressão de fórmula inválida.');
    if(Object.hasOwn(n,'ref')){allowed(n,['ref'],'Referência');return {value:{ref:n.ref},type:formulaReference(n.ref).type};}
    const op=n.operator;
    if(['and','or'].includes(op)) {
      allowed(n,['operator','operands'],'Fórmula');
      if(!Array.isArray(n.operands) || n.operands.length<1 || n.operands.length>50)fail('and/or exige de 1 a 50 operandos.');
      const values=n.operands.map(v=>node(v,depth+1));if(values.some(v=>v.type!=='boolean'))fail('and/or exige booleanos.');
      return {value:{operator:op,operands:values.map(v=>v.value)},type:'boolean'};
    }
    if(op==='not'){allowed(n,['operator','operand'],'Fórmula');const v=node(n.operand,depth+1);if(v.type!=='boolean')fail('not exige booleano.');return {value:{operator:op,operand:v.value},type:'boolean'};}
    if(!['eq','ne','gt','gte','lt','lte'].includes(op))fail('Operador desconhecido: '+op);
    allowed(n,['operator','left','right'],'Fórmula');const l=node(n.left,depth+1),r=node(n.right,depth+1);
    if(l.type!==r.type || !['eq','ne'].includes(op) && l.type!=='number')fail('Tipos incompatíveis na fórmula '+op+'.');
    return {value:{operator:op,left:l.value,right:r.value},type:'boolean'};
  }
  const result=node(input);if(result.type!=='boolean')fail('A fórmula deve retornar booleano.');return result.value;
}
export function formulaReferences(input) {
  if(!input || typeof input!=='object')return [];
  if(Object.hasOwn(input,'ref'))return [formulaReference(input.ref)];
  return ['left','right','operand', 'operands','conditions'].flatMap(k=>Array.isArray(input[k])?input[k].flatMap(formulaReferences):formulaReferences(input[k]));
}
export function calculateBoolean(input,resolve) {
  const expression=validateFormula(input);
  function calc(n) {
    if(n===null || typeof n!=='object')return n;
    if(Object.hasOwn(n,'ref')){const info=formulaReference(n.ref),value=resolve(info);if(typeof value!==info.type || info.type==='number' && !Number.isFinite(value))fail('Valor inválido para '+n.ref);return value;}
    if(n.operator==='and')return n.operands.map(calc).every(v=>v===true);
    if(n.operator==='or')return n.operands.map(calc).some(v=>v===true);
    if(n.operator==='not')return !calc(n.operand);
    const l=calc(n.left),r=calc(n.right);return {eq:()=>l===r,ne:()=>l!==r,gt:()=>l>r,gte:()=>l>=r,lt:()=>l<r,lte:()=>l<=r}[n.operator]();
  }
  return calc(expression);
}

const SCENARIO_TEMPLATE = {"schemaVersion":1,"name":"Eriador e Além","description":"Um cenário baseado na Terra Média, focando em regiões icônicas como o Condado, Valfenda, Rohan e Mordor.","places":[{"id":"terra-media","parentId":null,"name":"Terra Média","type":"Continente","description":"O vasto continente onde ocorrem as grandes aventuras e guerras pelo Anel.","details":{"clima":"Temperado a frio no norte, árido no sul e leste","habitado_por":["Elfos","Anões","Homens","Hobbits","Orcs"]},"x":50,"y":50},{"id":"eriador","parentId":"terra-media","name":"Eriador","type":"Região","description":"As terras ermas a oeste das Montanhas Sombrias.","details":{},"x":30,"y":40},{"id":"condado","parentId":"eriador","name":"O Condado","type":"Comarca","description":"Terra pacífica e verdejante, lar dos Hobbits.","details":{"produto_principal":"Erva-de-fumo"},"x":20,"y":50},{"id":"bolsao","parentId":"condado","name":"Bolsão","type":"Residência","description":"A toca de Hobbit sob a Colina, lar de Bilbo e Frodo.","details":{"portas":"Redondas","despensa":"Sempre cheia"},"x":50,"y":50},{"id":"valfenda","parentId":"eriador","name":"Valfenda","type":"Refúgio Élfico","description":"O Último Lar Amigo, governado por Elrond.","details":{"magia":"Abundante e protetora"},"x":80,"y":30},{"id":"casa-elrond","parentId":"valfenda","name":"Casa de Elrond","type":"Palácio","description":"Local de descanso, cura e sabedoria.","details":{},"x":50,"y":50},{"id":"rohan","parentId":"terra-media","name":"Rohan","type":"Reino","description":"A terra dos Senhores dos Cavalos.","details":{"cultura":"Equestre e guerreira"},"x":50,"y":70},{"id":"edoras","parentId":"rohan","name":"Edoras","type":"Capital","description":"A capital de Rohan, construída em uma colina.","details":{},"x":40,"y":60},{"id":"mordor","parentId":"terra-media","name":"Mordor","type":"Reino Sombrio","description":"A terra negra governada por Sauron.","details":{"ar":"Venenoso","perigo":"Extremo"},"x":80,"y":80},{"id":"montanha-perdicao","parentId":"mordor","name":"Montanha da Perdição","type":"Vulcão","description":"O vulcão onde o Um Anel foi forjado.","details":{"calor":"Insuportável"},"x":30,"y":50}],"npcs":[{"id":"frodo","name":"Frodo Bolseiro","description":"O Portador do Anel, um Hobbit relutante com um grande fardo.","placeId":"bolsao","combatant":{"attributes":{"forca":1,"habilidade":2,"resistencia":3,"armadura":2,"poderFogo":0},"abilities":[],"fields":{"origem":"O Condado","perfil":"Aventureiro","historia":"Equipamento: Ferroada e Cota de Mithril."}},"presence":null},{"id":"elrond","name":"Mestre Elrond","description":"O Senhor de Valfenda, sábio e poderoso entre os Elfos.","placeId":"casa-elrond","combatant":null,"presence":null},{"id":"uruk-hai-batedor","name":"Batedor Uruk-hai","description":"Um orc forte e rápido, enviado de Isengard.","placeId":"rohan","combatant":{"attributes":{"forca":3,"habilidade":2,"resistencia":2,"armadura":1,"poderFogo":0},"abilities":[],"fields":{"origem":"Isengard","perfil":"Guardião","historia":"Lealdade: Saruman."}},"presence":null},{"id":"gollum","name":"Gollum","description":"Uma criatura corrompida pelo Anel, segue Frodo sorrateiramente.","placeId":"montanha-perdicao","combatant":{"attributes":{"forca":1,"habilidade":4,"resistencia":3,"armadura":0,"poderFogo":0},"abilities":[],"fields":{"origem":"Desconhecida (antigo Hobbit)","perfil":"Explorador","historia":"Obsessão: O Precioso."}},"presence":null},{"id":"espectro-anel","name":"Nazgûl","description":"Servo terrível de Sauron, caçando o Portador do Anel.","placeId":"mordor","combatant":{"attributes":{"forca":2,"habilidade":2,"resistencia":2,"armadura":2,"poderFogo":0},"abilities":[],"fields":{"origem":"Mordor","perfil":"Outro","historia":"Aura: Terror."}},"presence":{"operator":"eq","left":{"ref":"npcs.frodo.derrotado"},"right":false}}]};
export function createScenarioTemplate(){ return withEriadorEncounters({...structuredClone(SCENARIO_TEMPLATE),time:{startDay:1,startMinute:480,minutesPerTurn:60},turnRules:[{id:'descanso',placeId:'condado',trigger:'turn_end',condition:{operator:'eq',left:{ref:'turno.acao'},right:'rest'},effects:[{target:'personagem.hp',formula:'min(personagem.hpMax, personagem.hp + 1)'}]},{id:'descanso',placeId:'valfenda',trigger:'turn_end',condition:{operator:'eq',left:{ref:'turno.acao'},right:'rest'},effects:[{target:'personagem.hp',formula:'min(personagem.hpMax, personagem.hp + 2)'}]},{id:'ar-venenoso',placeId:'mordor',trigger:'turn_end',condition:true,effects:[{target:'personagem.hp',formula:'max(0, personagem.hp - 1)'}]}],routes:[{id:"estrada-condado-valfenda",name:"Estrada para Valfenda",description:"Pelas terras de Eriador, entre o Condado e o refúgio élfico.",fromPlaceId:"condado",toPlaceId:"valfenda",distance:6},{id:"caminho-eriador-rohan",name:"Caminho dos Cavaleiros",description:"Uma longa travessia pelas terras da Terra Média.",fromPlaceId:"eriador",toPlaceId:"rohan",distance:8},{id:"caminho-rohan-mordor",name:"Caminho das Sombras",description:"Estradas perigosas em direção às terras sombrias.",fromPlaceId:"rohan",toPlaceId:"mordor",distance:7}],npcs:SCENARIO_TEMPLATE.npcs.map(n=>({...structuredClone(n),hostile:['uruk-hai-batedor','espectro-anel'].includes(n.id)}))}); }
export function scenarioLLMPrompt(model=createScenarioTemplate()){
  return `Crie UM cenário de RPG importável. Retorne somente um objeto JSON válido, sem Markdown ou comentários. Adapte nomes, lugares e habitantes à ideia que acrescentarei ao final. Não dependa de LLM durante o jogo.
CONTRATO:
- Raiz: encounters opcional (até 50 modelos), schemaVersion:1, name (1–100 caracteres), description (até 10000), places (0–500), npcs (0–100). Não inclua id, environmentId ou scenarioId na raiz: o sistema cria o ID ao importar.
- Lugar: id, parentId, name, type, description, details, x, y; encounterTable opcional. IDs únicos, 1–64 caracteres ASCII alfanuméricos/hífen/sublinhado, começando com alfanumérico. parentId é null no nível principal ou ID de um lugar existente. Sem auto-referência ou ciclos; máximo 64 níveis. Hierarquia e tipos livres, sem obrigação de planeta/país/cidade.
- name de lugar: 1–100; type: 1–60; description: até 10000. details é objeto JSON com valores descritivos, inclusive textos, números, booleanos, null, listas e objetos; até 10 níveis internos, 100 campos/itens por objeto/lista e chaves de até 100 caracteres.
- x e y são ambos números de 0 a 100 ou ambos null. A posição é relativa ao superior; origem no canto superior esquerdo, X para direita, Y para baixo. Lugares dentro de outros lugares compartilham a localização dos seus ancestrais. O quadrado representa posição, não tamanho. Imagens de fundo são carregadas separadamente na aventura; não inclua imagens/base64/URLs no JSON.
- NPC: id, name, description, placeId, combatant, presence, hostile (booleano). hostile:true exige ficha e disponibiliza combate/fuga, sem conversa; false mantém interações. Informe explicitamente. Para compatibilidade, IDs uruk-hai-batedor e espectro-anel antigos assumem true, demais false. ID único de 1–80 caracteres, mesmas regras de caracteres. name:1–60; description:até 4000. placeId deve ser um lugar existente e não pode ser null. Não use environmentNpcId nos NPCs do cenário: referências são usadas apenas nas missões.
- combatant:null para NPC narrativo; ou {attributes,abilities,fields}. Até 12 atributos inteiros 0–20, até 20 habilidades distintas e até 8 campos de texto de até 500 caracteres. Os IDs, custos, habilidades e campos devem ser compatíveis com as regras da aventura. O exemplo usa 3D&T Adaptável: limite de oito pontos para NPCs (podem usar menos), atributos forca/habilidade/resistencia/armadura/poderFogo e perfil obrigatório (Aventureiro, Guardião, Explorador ou Outro). Personagens do jogador devem distribuir os oito pontos; NPCs podem usar menos, mas não podem exceder o orçamento nem violar os limites de atributos. Ficha incompatível será rejeitada com o nome do NPC ao criar a aventura. Se não conhecer as regras, use combatant:null.
- presence:null significa presença permanente nesse lugar. Para presença condicional use fórmula booleana: {operator:"eq",left:{ref:"npcs.ID.derrotado"},right:true}. Também há ne, gt, gte, lt, lte; and/or com operands:[...]; not com operand. Referências do cenário só podem consultar outros NPCs deste cenário: npcs.ID.derrotado (booleano), npcs.ID.hp (número, exige ficha). Não consulte a própria derrota nem objetivos, fatos, itens ou ações de uma missão. Operadores usam tipos estritos; ordem exige números. Até 8 níveis, 250 nós e 50 operandos por composição.
- time: {startDay:1,startMinute:480,minutesPerTurn:60}. startMinute 0–1439, minutesPerTurn 1–1440. Relógio avança em turnos de exploração; combate e fuga não avançam o tempo.
- turnRules: até 100 regras {id,placeId,trigger:"turn_end",condition:true|fórmula booleana,effects:[{target:"personagem.hp",formula:"min(personagem.hpMax, personagem.hp + 1)"}]}. Herdadas pelos descendentes; mesmo id num descendente substitui ancestral. placeId:null vale globalmente. Condições: turno.acao (rest/move/travel/combat/flee/activity/encounter/wait), personagem.hp, personagem.atributos.ID, local.id, turno.numero, cenario.tempo.hora/minuto/dia e missoes.ID.status (not_accepted se ainda não aceita). Efeitos calculam números sem dados; somente PV nesta versão, limitados a 0..hpMax. Fórmulas usam personagem.hp/hpMax/atributos.ID, turno.numero, cenario.tempo.hora/minuto/dia; + - * / min max floor ceil. Regras executam do ancestral ao descendente na ordem declarada, após ação e relógio, antes das verificações de missão. Recuperação por descanso exige condição turno.acao eq rest; dano ambiental pode usar condition:true. Sem scripts.
- navigation:"gateways" ativa navegação física: regiões possuem entryPlaceId apontando a um filho folha (portão/acesso). Rotas conectam apenas folhas, inclusive em regiões diferentes. Hierarquia só organiza mapas; viajar exige rota. Não crie deslocamentos automáticos para o pai.
- routes: lista opcional de até 200 rotas {id,name,description,fromPlaceId,toPlaceId,distance}. IDs únicos; name 1–100; description até 4000; distance inteiro 1–100 em unidades de percurso, NÃO duração fixa. Extremos existentes e distintos, sem ligações duplicadas em qualquer direção. No modo gateways, extremos devem ser folhas e podem estar em níveis/regiões diferentes; sem navigation, mantém o contrato antigo de mesmo parentId. Sempre bidirecionais, sem condição de acesso. A pé avança uma unidade por turno; cada avanço pode gerar encontro herdado do superior comum. No modo gateways, use as entradas físicas para conectar regiões.
- encounters: lista de modelos {id,name,description,hostile:false,participants,options,condition:null|fórmula booleana}. hostile:true exige opção de combate e só permite combate ou fuga pelo sistema (teste definido em rules.combat.escape; falha provoca um ataque inimigo). Não use opções narrativas para resolver encontros hostis. IDs antigos lobos e salteadores assumem true quando hostile ausente; demais false. Até 4 participantes {id,name,description,combatant:null|ficha}; até 10 opções {id,label,kind:"resolve"|"test"|"combat",text,duringCombat:false}. Testes acrescentam attribute, difficulty (0–100) e failureText. duringCombat:true libera a opção durante combate. Combate exige participante com ficha. Os exemplos usam os atributos das regras padrão. Condições de encontros consultam apenas npcs residentes, personagem.hp/atributos, local.id e turno.numero, sem referências a missões.
- encounterTable de lugar: {mode:"inherit"|"extend"|"replace"|"none",chance:0–100,cooldownTurns:1–1000000,entries:[{encounterId,weight:1–1000}]}. Campos chance e cooldownTurns são opcionais e herdados; padrão inicial é chance 0 e intervalo 3. inherit herda; extend acrescenta ou substitui pesos; replace substitui entradas; none bloqueia encontros. inherit e none não têm entradas próprias. IDs devem existir no catálogo. O sorteio ocorre somente após deslocamento; opções custam um turno, exceto abrir o painel de combate, que só avança ao simular a rodada.
- Não inclua missões, progresso, inventário, recompensas ou regras de combate na raiz. As missões serão cadastradas separadamente e vinculadas ao cenário pelo ID criado na importação.
- Limite total: 240 KB. Campos extras, referências inexistentes, coordenadas inválidas e ciclos são rejeitados. Se usar personagens condicionais, mantenha pelo menos um caminho de encontro acessível inicialmente.
MODELO VÁLIDO COMPLETO:
${JSON.stringify(model,null,2)}
MINHA IDEIA PARA O CENÁRIO:
[Descreva o tema, a escala, os lugares e os habitantes desejados.]`;
}


export function validateRegionalEncounters(input,npcs=[]) {
  if(!Array.isArray(input) || input.length>50)fail('Use até 50 modelos de encontros.');
  const list=input.map(e=>{
    if(!object(e))fail('Modelo de encontro inválido.');allowed(e,['id','name','description','participants','options','condition','hostile'],'Encontro');
    if(!npcId(e.id))fail('ID de encontro inválido.');text(e.name,'Nome do encontro',100,true);text(e.description ?? '','Descrição do encontro',4000);
    if(!Array.isArray(e.participants) || e.participants.length>4)fail('Encontro: use até quatro participantes.');
    const participants=e.participants.map(p=>{if(!object(p))fail('Participante inválido.');allowed(p,['id','name','description','combatant'],'Participante');const n=validateNPC({...p,placeId:null,presence:null});return {id:n.id,name:n.name,description:n.description,combatant:n.combatant};});
    if(new Set(participants.map(p=>p.id)).size!==participants.length)fail('Participante repetido no encontro.');
    if(!Array.isArray(e.options) || !e.options.length || e.options.length>10)fail('Encontro exige de uma a dez opções.');
    const options=e.options.map(o=>{
      if(!object(o))fail('Opção de encontro inválida.');allowed(o,['id','label','kind','text','attribute','difficulty','failureText','duringCombat'],'Opção de encontro');
      if(!npcId(o.id) || ['victory','defeat','escaped'].includes(o.id) || !['resolve','test','combat'].includes(o.kind))fail('ID ou tipo da opção inválido.');text(o.label,'Nome da opção',100,true);text(o.text ?? '','Resultado da opção',2000);text(o.failureText ?? '','Resultado da falha',2000);
      if(o.duringCombat!==undefined && typeof o.duringCombat!=='boolean')fail('duringCombat deve ser booleano.');
      if(o.kind==='test' && (!npcId(o.attribute) || !Number.isInteger(o.difficulty) || o.difficulty<0 || o.difficulty>100))fail('Teste de encontro exige atributo e dificuldade de 0 a 100.');
      if(o.kind!=='test' && (o.attribute!==undefined || o.difficulty!==undefined))fail('Atributo e dificuldade pertencem a opções de teste.');
      if(o.kind==='combat' && !participants.some(p=>p.combatant))fail('Combate exige pelo menos um participante com ficha.');
      return {id:o.id,label:o.label.trim(),kind:o.kind,text:o.text ?? '',...(o.kind==='test'?{attribute:o.attribute,difficulty:o.difficulty,failureText:o.failureText ?? 'O teste falhou.'}:{}),duringCombat:o.duringCombat ?? false};
    });
    if(new Set(options.map(o=>o.id)).size!==options.length)fail('Opção repetida no encontro.');
    const condition=e.condition==null?null:validateFormula(e.condition);
    for(const r of formulaReferences(condition)) {
      if(!['npcs','personagem','local','turno'].includes(r.scope))fail('Condição de encontro só consulta NPCs residentes, personagem, local e turno.');
      if(r.scope==='npcs' && !npcs.some(n=>n.id===r.id && (r.field!=='hp' || n.combatant)))fail('NPC inválido na condição de encontro: '+r.id);
    }
    const hostile=e.hostile ?? ['salteadores','lobos'].includes(e.id);
    if(typeof hostile!=='boolean' || hostile && !options.some(o=>o.kind==='combat'))fail('Encontro hostil exige hostile booleano e opção de combate.');
    return {id:e.id,name:e.name.trim(),description:e.description ?? '',participants,options,condition,hostile};
  });
  if(new Set(list.map(e=>e.id)).size!==list.length)fail('ID de encontro repetido.');return list;
}
export function validateEncounterTable(input,encounters) {
  if(!object(input))fail('Tabela de encontros inválida.');allowed(input,['mode','chance','cooldownTurns','entries'],'Tabela de encontros');
  if(!['inherit','extend','replace','none'].includes(input.mode))fail('Modo de encontros deve ser inherit, extend, replace ou none.');
  if(input.chance!==undefined && (!Number.isInteger(input.chance) || input.chance<0 || input.chance>100))fail('Chance de encontro deve ser de 0 a 100.');
  if(input.cooldownTurns!==undefined && (!Number.isInteger(input.cooldownTurns) || input.cooldownTurns<1 || input.cooldownTurns>1000000))fail('Intervalo entre encontros deve ser de 1 a 1000000 turnos.');
  const entries=input.entries ?? [];if(!Array.isArray(entries) || entries.length>50)fail('Tabela: use até 50 entradas.');
  if(['inherit','none'].includes(input.mode) && entries.length)fail('Herança e bloqueio não admitem entradas próprias.');
  for(const e of entries){if(!object(e))fail('Entrada de encontro inválida.');allowed(e,['encounterId','weight'],'Entrada de encontro');if(!encounters.some(t=>t.id===e.encounterId) || !Number.isInteger(e.weight) || e.weight<1 || e.weight>1000)fail('Encontro inexistente ou peso inválido na tabela.');}
  if(new Set(entries.map(e=>e.encounterId)).size!==entries.length)fail('Encontro repetido na tabela.');
  return {mode:input.mode,...(input.chance!==undefined?{chance:input.chance}:{}),...(input.cooldownTurns!==undefined?{cooldownTurns:input.cooldownTurns}:{}),entries:entries.map(e=>({...e}))};
}
export function regionalEncounterTable(world,placeId) {
  let table={chance:0,cooldownTurns:3,entries:[]};
  for(const place of ancestors(world,placeId)) {
    const p=place.encounterTable;if(!p)continue;
    if(p.mode==='none'){table={chance:0,cooldownTurns:p.cooldownTurns ?? table.cooldownTurns,entries:[]};continue;}
    let entries=p.mode==='replace'?[]:table.entries;
    if(['extend','replace'].includes(p.mode)){const byId=new Map(entries.map(e=>[e.encounterId,e]));for(const e of p.entries)byId.set(e.encounterId,e);entries=[...byId.values()];}
    table={chance:p.chance ?? table.chance,cooldownTurns:p.cooldownTurns ?? table.cooldownTurns,entries};
  }
  return table;
}
export function regionalEncounterExamples() {
  const sheet=(f,h,r,a)=>({attributes:{forca:f,habilidade:h,resistencia:r,armadura:a,poderFogo:0},abilities:[],fields:{perfil:'Outro'}});
  return [
    {id:'salteadores',hostile:true,name:'Salteadores da estrada',description:'Um salteador surge entre as pedras e exige que você pare.',participants:[{id:'salteador',name:'Salteador',description:'Um assaltante das estradas de Eriador.',combatant:sheet(2,2,1,1)}],options:[{id:'enfrentar',label:'Enfrentar',kind:'combat',text:''}],condition:null},
    {id:'lobos',hostile:true,name:'Lobos nas trilhas',description:'Um lobo observa seus passos e bloqueia a passagem.',participants:[{id:'lobo',name:'Lobo selvagem',description:'Um animal faminto e atento.',combatant:sheet(2,2,1,0)}],options:[{id:'enfrentar',label:'Enfrentar',kind:'combat',text:''}],condition:null},
    {id:'mercador-viajante',hostile:false,name:'Mercador viajante',description:'Um mercador descansa junto à estrada e oferece notícias das vilas próximas.',participants:[{id:'mercador',name:'Mercador viajante',description:'Um viajante amistoso.',combatant:null}],options:[{id:'conversar',label:'Ouvir notícias',kind:'resolve',text:'Você troca histórias com o mercador e ouve notícias das estradas. Ele se despede e retoma a viagem.'},{id:'seguir',label:'Seguir viagem',kind:'resolve',text:'Você cumprimenta o mercador e segue viagem.'}],condition:null},
    {id:'viajante-ferido',hostile:false,name:'Viajante ferido',description:'Um viajante está sentado à beira do caminho, com um tornozelo machucado.',participants:[{id:'viajante',name:'Viajante ferido',description:'Precisa de uma breve ajuda para seguir.',combatant:null}],options:[{id:'ajudar',label:'Ajudar o viajante',kind:'resolve',text:'Você improvisa um apoio para o viajante. Ele agradece e segue para um lugar seguro.'},{id:'seguir',label:'Seguir viagem',kind:'resolve',text:'Você segue viagem, deixando o viajante à espera de ajuda.'}],condition:null}
  ];
}
export function withEriadorEncounters(input) {
  const w=structuredClone(input);if(!['terra-media','eriador','condado','bolsao'].every(id=>w.places.some(p=>p.id===id)))fail('Os exemplos regionais exigem o cenário Eriador e Além.');
  const examples=regionalEncounterExamples();w.encounters=[...(w.encounters || []),...examples.filter(e=>!(w.encounters || []).some(t=>t.id===e.id))];
  const base={mode:'replace',chance:30,cooldownTurns:3,entries:[{encounterId:'salteadores',weight:3},{encounterId:'lobos',weight:4},{encounterId:'mercador-viajante',weight:2},{encounterId:'viajante-ferido',weight:1}]};
  const policies={'terra-media':base,eriador:{mode:'extend',chance:35,entries:[]},condado:{mode:'replace',chance:20,cooldownTurns:3,entries:[{encounterId:'lobos',weight:1},{encounterId:'mercador-viajante',weight:3},{encounterId:'viajante-ferido',weight:2}]},rohan:{mode:'extend',chance:35,entries:[{encounterId:'salteadores',weight:5}]},mordor:{mode:'replace',chance:40,cooldownTurns:3,entries:[{encounterId:'lobos',weight:5},{encounterId:'salteadores',weight:1}]}};
  for(const id of ['bolsao','valfenda','casa-elrond','edoras','montanha-perdicao'])policies[id]={mode:'none',entries:[]};
  w.places=w.places.map(p=>({...p,...(!p.encounterTable && policies[p.id]?{encounterTable:policies[p.id]}:{})}));return validateWorld(w);
}

export function validateRoutes(input,places,navigation) {
  if(!Array.isArray(input) || input.length>200)fail('Use até 200 rotas.');
  const ids=new Set(),pairs=new Set();
  return input.map(r=>{
    if(!object(r))fail('Rota inválida.');allowed(r,['id','name','description','fromPlaceId','toPlaceId','distance'],'Rota');
    if(!npcId(r.id) || ids.has(r.id))fail('ID de rota inválido ou repetido.');ids.add(r.id);
    text(r.name,'Nome da rota',100,true);text(r.description ?? '','Descrição da rota',4000);
    const from=places.find(p=>p.id===r.fromPlaceId),to=places.find(p=>p.id===r.toPlaceId);
    if(!from || !to || from.id===to.id || navigation!=='gateways' && from.parentId!==to.parentId)fail('A rota deve ligar dois lugares distintos do mesmo superior.');
    if(navigation==='gateways' && places.some(p=>p.parentId===from.id || p.parentId===to.id))fail('Rotas devem conectar pontos físicos, não regiões.');
    const key=[from.id,to.id].sort().join('/');if(pairs.has(key))fail('Já existe uma rota entre esses lugares.');pairs.add(key);
    if(!Number.isInteger(r.distance) || r.distance<1 || r.distance>100)fail('Distância da rota deve ser inteira entre 1 e 100.');
    return {id:r.id,name:r.name.trim(),description:r.description ?? '',fromPlaceId:from.id,toPlaceId:to.id,distance:r.distance};
  });
}
export function routeBetween(world,fromId,toId) {return (world.routes || []).find(r=>r.fromPlaceId===fromId && r.toPlaceId===toId || r.toPlaceId===fromId && r.fromPlaceId===toId);}
export function routeMapHTML(world,parentId,travel=null) {
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const project=id=>{let p=world.places.find(p=>p.id===id);const seen=new Set();while(p && p.parentId!==parentId && !seen.has(p.id)){seen.add(p.id);p=world.places.find(v=>v.id===p.parentId);}return p;};
  const paths=(world.routes || []).map((r,i)=>{let from=project(r.fromPlaceId),to=project(r.toPlaceId);if(world.navigation==='gateways' && parentId!==null && Boolean(from)!==Boolean(to)){const endpoint=world.places.find(p=>p.id===(!from?r.fromPlaceId:r.toPlaceId));const external={id:endpoint.id,x:92,y:12+(i%3)*24,external:true,name:world.places.find(p=>p.id===endpoint.parentId)?.name || endpoint.name};if(!from)from=external;else to=external;}return {r,from,to};}).filter(({from,to})=>from && to && from.id!==to.id && from.x!==null && from.y!==null && to.x!==null && to.y!==null);
  if(!paths.length)return '';
  return '<svg class="route-map" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Rotas neste mapa" role="img">'+paths.map(({r,from,to})=>{
    const active=travel?.routeId===r.id,ratio=active?(ancestors(world,travel.fromPlaceId).some(p=>p.id===from.id)?travel.progress/r.distance:1-travel.progress/r.distance):null;
    const control=to.external?{x:to.x,y:from.y}:from.external?{x:from.x,y:to.y}:null;
    const at=t=>control?{x:(1-t)*(1-t)*from.x+2*(1-t)*t*control.x+t*t*to.x,y:(1-t)*(1-t)*from.y+2*(1-t)*t*control.y+t*t*to.y}:{x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};
    return '<g><title>'+escape(r.name)+' · '+r.distance+' unidades</title>'+[from,to].filter(p=>p.external).map(p=>'<text class="route-external-label" x="'+p.x+'" y="'+(p.y-2)+'" text-anchor="end">→ '+escape(p.name)+'</text>').join('')+'<path d="M '+from.x+' '+from.y+(control?' Q '+control.x+' '+control.y+' '+to.x+' '+to.y:' L '+to.x+' '+to.y)+'"/>'+Array.from({length:r.distance-1},(_,i)=>{const t=(i+1)/r.distance;return '<circle class="route-dot" cx="'+at(t).x+'" cy="'+at(t).y+'" r="0.55"/>';}).join('')+(active?'<circle class="route-traveler" cx="'+at(ratio).x+'" cy="'+at(ratio).y+'" r="1.1"/>':'')+'</g>';
  }).join('')+'</svg>';
}

export function validateWorldTime(t={startDay:1,startMinute:480,minutesPerTurn:60}) {
  if(!object(t))fail('Relógio inválido.');allowed(t,['startDay','startMinute','minutesPerTurn'],'Relógio');
  if(!Number.isInteger(t.startDay) || t.startDay<1 || t.startDay>1000000 || !Number.isInteger(t.startMinute) || t.startMinute<0 || t.startMinute>1439 || !Number.isInteger(t.minutesPerTurn) || t.minutesPerTurn<1 || t.minutesPerTurn>1440)fail('Configure dia inicial, minuto inicial 0–1439 e minutos por turno 1–1440.');
  return {...t};
}
export function worldClock(world,turn,pausedTimeTurns=0) {
  const t=validateWorldTime(world.time),total=t.startMinute+(turn-pausedTimeTurns)*t.minutesPerTurn;
  return {dia:t.startDay+Math.floor(total/1440),hora:Math.floor(total%1440/60),minuto:total%60};
}
export function validateTurnRules(input,places){
  if(!Array.isArray(input) || input.length>100)fail('Use até 100 gatilhos.');const keys=new Set();
  return input.map(r=>{if(!object(r))fail('Gatilho inválido.');allowed(r,['id','placeId','trigger','condition','effects'],'Gatilho');
    if(!npcId(r.id) || r.placeId!==null && !places.some(p=>p.id===r.placeId) || r.trigger!=='turn_end')fail('ID, lugar ou trigger inválido no gatilho.');
    const key=r.placeId+':'+r.id;if(keys.has(key))fail('Gatilho duplicado no mesmo lugar.');keys.add(key);
    const condition=validateFormula(r.condition ?? true);for(const ref of formulaReferences(condition))if(!['personagem','local','turno','cenario','missoes'].includes(ref.scope))fail('Referência indisponível em gatilho: '+ref.ref);
    if(!Array.isArray(r.effects) || !r.effects.length || r.effects.length>10)fail('Use de 1 a 10 efeitos por gatilho.');
    const effects=r.effects.map(f=>{if(!object(f))fail('Efeito inválido.');allowed(f,['target','formula'],'Efeito');if(f.target!=='personagem.hp' || typeof f.formula!=='string' || !f.formula.length || f.formula.length>240 || /\d+d\d+/.test(f.formula))fail('Efeito exige alvo personagem.hp e fórmula sem dados.');return {...f};});
    return {id:r.id,placeId:r.placeId,trigger:r.trigger,condition,effects};
  });
}

export function createGatewayScenarioTemplate(source=createScenarioTemplate()){
  const w=structuredClone(source);if(w.navigation==='gateways')return validateWorld(w);
  const regions=w.places.filter(p=>w.places.some(c=>c.parentId===p.id)),oldRoutes=w.routes || [],leaves=w.places.filter(p=>!regions.some(r=>r.id===p.id));
  for(const p of regions){let id='acesso-'+p.id;if(w.places.some(v=>v.id===id))fail('ID reservado já usado: '+id);p.entryPlaceId=id;w.places.push({id,parentId:p.id,name:'Acesso de '+p.name,type:'Passagem',description:'Ponto de entrada e saída de '+p.name+'.',x:15,y:80,details:{}});}
  const point=id=>w.places.find(p=>p.id===id)?.entryPlaceId || id;
  const routes=oldRoutes.map(r=>({...r,fromPlaceId:point(r.fromPlaceId),toPlaceId:point(r.toPlaceId)}));
  const add=(from,to,distance)=>{if(!from || !to || from===to || routes.some(r=>[r.fromPlaceId,r.toPlaceId].includes(from) && [r.fromPlaceId,r.toPlaceId].includes(to)))return;routes.push({id:'ligacao-'+routes.length,name:'Caminho de acesso',description:'Passagem entre pontos físicos do cenário.',fromPlaceId:from,toPlaceId:to,distance});};
  for(const leaf of leaves)add(leaf.id,point(leaf.parentId),1);
  for(const region of regions)add(region.entryPlaceId,point(region.parentId),4);
  for(const n of w.npcs || [])n.placeId=point(n.placeId);
  w.navigation='gateways';w.routes=routes;return validateWorld(w);
}
