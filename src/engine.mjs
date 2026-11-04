// Restricted arithmetic interpreter. Imported JSON never executes JavaScript.
export class RuleError extends Error {}
const ensure = (condition, message) => { if (!condition) throw new RuleError(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOK = id => typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
const textOK = (v, max = 180) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const numberOK = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const integerOK = (v, min, max) => Number.isInteger(v) && numberOK(v, min, max);

export function evaluate(formula, context, rng = Math.random) {
  ensure(typeof formula === 'string' && formula.length > 0 && formula.length <= 240, 'Fórmula vazia ou maior que 240 caracteres.');
  const expanded = formula.replace(/(actor|target)\[input\.attribute\]/g, (_, namespace) => {
    ensure(idOK(context.input?.attribute), 'Atributo de teste inválido.');
    return namespace + '.' + context.input.attribute;
  });
  const tokens = expanded.match(/\d+d\d+|(?:\d+(?:\.\d+)?|\.\d+)|[A-Za-z_][A-Za-z0-9_.]*|[()+*/,\-]|\S/g) || [];
  ensure(tokens.length <= 120, 'Fórmula complexa demais.');
  let cursor = 0;
  const dice = [];
  const readVariable = name => {
    let value = context;
    for (const part of name.split('.')) {
      ensure(plain(value) && Object.hasOwn(value, part) && !['constructor', 'prototype', '__proto__'].includes(part), 'Variável desconhecida: ' + name);
      value = value[part];
    }
    ensure(Number.isFinite(value), 'Variável não numérica: ' + name);
    return value;
  };
  const primary = () => {
    const token = tokens[cursor++];
    ensure(token !== undefined, 'Fórmula incompleta.');
    if (token === '(') { const v = sum(); ensure(tokens[cursor++] === ')', 'Parêntese não fechado.'); return v; }
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * primary();
    if (/^\d+d\d+$/.test(token)) {
      const [count, sides] = token.split('d').map(Number);
      ensure(integerOK(count, 1, 10) && integerOK(sides, 2, 100), 'Dados permitidos: de 1d2 até 10d100.');
      const rolls = Array.from({ length: count }, () => { const random = rng(); ensure(numberOK(random, 0, 1) && random < 1, 'Gerador de dados inválido.'); return 1 + Math.floor(random * sides); });
      const total = rolls.reduce((a, b) => a + b, 0);
      dice.push({ notation: token, rolls, total }); return total;
    }
    if (/^(\d+(\.\d+)?|\.\d+)$/.test(token)) return Number(token);
    ensure(/^[A-Za-z_][A-Za-z0-9_.]*$/.test(token), 'Token inválido na fórmula: ' + token);
    if (tokens[cursor] === '(') {
      ensure(['max', 'min', 'floor', 'ceil'].includes(token), 'Função não permitida: ' + token);
      cursor++;
      const args = [sum()];
      while (tokens[cursor] === ',') { cursor++; args.push(sum()); ensure(args.length <= 8, 'Argumentos em excesso.'); }
      ensure(tokens[cursor++] === ')', 'Função sem fechamento.');
      ensure(token === 'max' || token === 'min' ? args.length >= 2 : args.length === 1, 'Quantidade inválida de argumentos.');
      return Math[token](...args);
    }
    return readVariable(token);
  };
  const product = () => { let v = primary(); while (tokens[cursor] === '*' || tokens[cursor] === '/') { const op = tokens[cursor++]; const b = primary(); ensure(op !== '/' || b !== 0, 'Divisão por zero.'); v = op === '*' ? v * b : v / b; } return v; };
  const sum = () => { let v = product(); while (tokens[cursor] === '+' || tokens[cursor] === '-') { const op = tokens[cursor++]; const b = product(); v = op === '+' ? v + b : v - b; } return v; };
  const total = sum();
  ensure(cursor === tokens.length && Number.isFinite(total) && Math.abs(total) <= 1e9, 'Resultado ou sintaxe de fórmula inválidos.');
  return { formula, total, dice };
}

export function validateRules(rules) {
  ensure(plain(rules) && rules.schemaVersion === 1, 'schemaVersion deve ser 1. Use o JSON de exemplo como modelo.');
  ensure(textOK(rules.id, 80) && textOK(rules.name, 80) && textOK(rules.version, 40), 'Informe id, name e version das regras.');
  ensure(!rules.description || textOK(rules.description, 1500), 'Descrição de regras inválida.');
  const unique = (items, label, max) => {
    ensure(Array.isArray(items) && items.length <= max, label + ': lista ausente ou muito longa.');
    const ids = new Set();
    for (const item of items) { ensure(plain(item) && idOK(item.id) && !ids.has(item.id), label + ': identificador inválido ou repetido.'); ids.add(item.id); }
  };
  unique(rules.attributes, 'Atributos', 12);
  ensure(rules.attributes.length > 0, 'Defina ao menos um atributo.');
  const actor = {};
  for (const a of rules.attributes) {
    ensure(textOK(a.name, 60) && (!a.short || textOK(a.short, 8)), 'Nome de atributo inválido.');
    ensure(integerOK(a.min, 0, 20) && integerOK(a.max, a.min, 20) && integerOK(a.defaultValue, a.min, a.max) && integerOK(a.cost, 0, 10), 'Limites, padrão ou custo inválidos no atributo ' + a.id + '.');
    actor[a.id] = Math.max(1, a.defaultValue);
  }
  ensure(plain(rules.creation) && integerOK(rules.creation.totalPoints, 0, 100) && typeof rules.creation.requireAllPoints === 'boolean', 'Criação: orçamento ou requireAllPoints inválido.');
  unique(rules.creation.fields, 'Campos da ficha', 8);
  for (const f of rules.creation.fields) {
    ensure(textOK(f.label, 60) && ['text', 'textarea', 'select'].includes(f.type) && typeof f.required === 'boolean', 'Campo da ficha inválido: ' + f.id);
    if (f.type === 'select') ensure(Array.isArray(f.options) && f.options.length > 0 && f.options.length <= 20 && f.options.every(v => textOK(v, 80)) && new Set(f.options).size === f.options.length, 'Opções inválidas: ' + f.id);
  }
  unique(rules.abilities, 'Habilidades', 20);
  for (const a of rules.abilities) {
    ensure(textOK(a.name, 60) && integerOK(a.cost, 0, 20) && (!a.description || textOK(a.description, 500)) && plain(a.bonuses), 'Habilidade inválida: ' + a.id);
    for (const [key, value] of Object.entries(a.bonuses)) ensure(['attack', 'defense', 'test'].includes(key) && numberOK(value, -20, 20), 'Bônus inválido em ' + a.id + '.');
  }
  unique(rules.actions, 'Ações', 10);
  ensure(rules.actions.some(a => a.kind === 'attack'), 'Defina ao menos uma ação de ataque.');
  const context = { actor, target: actor, input: { attribute: rules.attributes[0].id, difficulty: 6 }, attackBonus: 0, defenseBonus: 0, testBonus: 0 };
  for (const a of rules.actions) {
    ensure(textOK(a.name, 60) && ['attack', 'test'].includes(a.kind) && (!a.description || textOK(a.description, 500)), 'Ação inválida: ' + a.id);
    evaluate(a.formula, context, () => 0.5);
  }
  ensure(plain(rules.resources) && plain(rules.resources.hp) && plain(rules.resources.mana), 'Recursos hp e mana são obrigatórios.');
  for (const key of ['hp', 'mana']) {
    const formula = rules.resources[key].max;
    ensure(typeof formula === 'string' && !/\d+d\d+/.test(formula), 'Recursos devem usar fórmulas sem dados.');
    const result = evaluate(formula, { actor }, () => 0.5).total;
    ensure(numberOK(result, 0, 10000), 'Recurso fora do intervalo 0–10000.');
  }
  ensure(plain(rules.combat) && ['>', '>='].includes(rules.combat.hitWhen) && rules.combat.tieBreak === 'roster_order', 'Combate: hitWhen deve ser > ou >=; tieBreak deve ser roster_order.');
  ensure(rules.combat.critical === false && rules.combat.fumble === false, 'Este MVP não implementa crítico ou falha automática; use false.');
  for (const key of ['initiative', 'defense']) evaluate(rules.combat[key], context, () => 0.5);
  evaluate(rules.combat.damage, { ...context, attack_total: 8, defense_total: 5 }, () => 0.5);
  ensure(!/\d+d\d+/.test(rules.combat.damage), 'A fórmula de dano deve usar os totais, sem nova rolagem.');
  if(rules.combat.escape!==undefined){const e=rules.combat.escape;ensure(plain(e) && rules.attributes.some(a=>a.id===e.attribute) && integerOK(e.difficulty,0,100) && rules.actions.some(a=>a.kind==='test'),'Fuga exige atributo existente, teste e dificuldade inteira de 0 a 100.');}
  return rules;
}

function buildCharacter(rules, input, current = false, allowUnspent = false) {
  ensure(plain(input) && textOK(input.name, 60), 'Informe um nome de até 60 caracteres.');
  ensure(plain(input.attributes), 'Atributos do personagem ausentes.');
  const attributes = {};
  let spent = 0;
  for (const a of rules.attributes) {
    const value = input.attributes[a.id];
    ensure(integerOK(value, a.min, a.max), a.name + ' deve ser um inteiro entre ' + a.min + ' e ' + a.max + '.');
    attributes[a.id] = value; spent += value * a.cost;
  }
  ensure(Object.keys(input.attributes).length === rules.attributes.length, 'A ficha contém atributos incompatíveis com as regras.');
  ensure(Array.isArray(input.abilities) && input.abilities.length <= rules.abilities.length && new Set(input.abilities).size === input.abilities.length, 'Lista de habilidades inválida.');
  const bonuses = { attack: 0, defense: 0, test: 0 };
  for (const id of input.abilities) {
    const ability = rules.abilities.find(a => a.id === id);
    ensure(ability, 'Habilidade desconhecida: ' + id);
    spent += ability.cost;
    for (const [key, value] of Object.entries(ability.bonuses)) bonuses[key] += value;
  }
  ensure(spent <= rules.creation.totalPoints, 'Orçamento excedido: ' + spent + '/' + rules.creation.totalPoints + ' pontos.');
  ensure(allowUnspent || !rules.creation.requireAllPoints || spent === rules.creation.totalPoints, 'Distribua os ' + rules.creation.totalPoints + ' pontos antes de salvar (' + spent + ' usados).');
  const fields = {};
  for (const f of rules.creation.fields) {
    const value = input.fields?.[f.id] ?? '';
    ensure(typeof value === 'string' && value.length <= 500, 'Campo inválido: ' + f.label);
    ensure(!f.required || value.trim().length > 0, 'Preencha o campo ' + f.label + '.');
    ensure(f.type !== 'select' || value === '' && !f.required || f.options.includes(value), 'Opção inválida no campo ' + f.label + '.');
    fields[f.id] = value.trim();
  }
  const context = { actor: attributes };
  const maxHp = evaluate(rules.resources.hp.max, context).total;
  const maxMana = evaluate(rules.resources.mana.max, context).total;
  ensure(numberOK(maxHp, 0, 10000) && numberOK(maxMana, 0, 10000), 'Recursos inválidos para esta ficha.');
  const hp = current ? input.hp : maxHp;
  ensure(numberOK(hp, 0, maxHp), 'PV atuais fora do limite da ficha.');
  return { id: typeof input.id === 'string' && input.id.length <= 80 ? input.id : crypto.randomUUID(), name: input.name.trim(), attributes, abilities: [...input.abilities], fields, spent, maxHp, hp, maxMana, mana: maxMana, bonuses };
}

export function seededRng(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const randomRng = () => { const array = new Uint32Array(1); crypto.getRandomValues(array); return array[0] / 4294967296; };

function runRound(rules, input, overrideRng, npcOpponent = false) {
  ensure(plain(input) && Array.isArray(input.combatants) && input.combatants.length === 2, 'Selecione exatamente dois combatentes.');
  ensure(input.combatants[0].id !== input.combatants[1].id, 'Selecione personagens diferentes.');
  const characters = input.combatants.map((c,i) => npcOpponent && i===1 ? createNPCCharacter(rules,c,true) : createCharacter(rules,c,true));
  ensure(characters.every(c => c.hp > 0), 'Combate encerrado: um personagem está incapacitado. Reinicie o combate.');
  ensure(Array.isArray(input.choices) && input.choices.length === 2, 'Defina a ação de cada combatente.');
  ensure(['random', 'seeded'].includes(input.mode), 'Modo de rolagem inválido.');
  if (input.mode === 'seeded') ensure(integerOK(input.seed, 0, 4294967295), 'Semente deve ser um inteiro de 0 a 4294967295.');
  const rng = overrideRng || (input.mode === 'seeded' ? seededRng(input.seed) : randomRng);
  const actions = input.choices.map(choice => {
    ensure(plain(choice), 'Escolha de ação inválida.');
    const action = rules.actions.find(a => a.id === choice.actionId);
    ensure(action, 'Ação desconhecida.');
    if (action.kind === 'test') {
      ensure(rules.attributes.some(a => a.id === choice.attribute) && integerOK(choice.difficulty, 0, 100), 'Teste: escolha um atributo e dificuldade inteira de 0 a 100.');
    }
    return action;
  });
  const contextFor = (actor, target, choice = {}) => ({ actor: actor.attributes, target: target.attributes, input: { attribute: choice.attribute || rules.attributes[0].id, difficulty: choice.difficulty ?? 6 }, attackBonus: actor.bonuses.attack, defenseBonus: target.bonuses.defense, testBonus: actor.bonuses.test });
  const initiative = characters.map((c, i) => ({ index: i, id: c.id, name: c.name, roll: evaluate(rules.combat.initiative, contextFor(c, characters[1-i]), rng) }));
  initiative.sort((a, b) => b.roll.total - a.roll.total || a.index - b.index);
  const events = [];
  for (const turn of initiative) {
    const index = turn.index;
    const actor = characters[index], target = characters[1-index], action = actions[index], choice = input.choices[index];
    if (actor.hp <= 0) { events.push({ kind: 'skipped', actor: actor.name, action: action.name, message: 'Incapacitado antes de agir.', actorHp: actor.hp }); continue; }
    const context = contextFor(actor, target, choice);
    const roll = evaluate(action.formula, context, rng);
    if (action.kind === 'test') {
      const success = roll.total >= choice.difficulty;
      events.push({ kind: 'test', actor: actor.name, action: action.name, attribute: rules.attributes.find(a => a.id === choice.attribute).name, roll, difficulty: choice.difficulty, success, actorHp: actor.hp });
    } else {
      const defense = evaluate(rules.combat.defense, context, rng);
      const hit = rules.combat.hitWhen === '>' ? roll.total > defense.total : roll.total >= defense.total;
      const damageRoll = evaluate(rules.combat.damage, { ...context, attack_total: roll.total, defense_total: defense.total }, rng);
      const damage = hit ? Math.max(0, damageRoll.total) : 0;
      ensure(numberOK(damage, 0, 10000), 'Dano fora do intervalo suportado.');
      const hpBefore = target.hp;
      target.hp = Math.max(0, Math.min(target.maxHp, target.hp - damage));
      events.push({ kind: 'attack', actor: actor.name, target: target.name, action: action.name, roll, defense, hit, damage, damageFormula: rules.combat.damage, hpBefore, hpAfter: target.hp, defeated: target.hp === 0 });
    }
  }
  const defeated = characters.find(c => c.hp <= 0);
  return { characters, initiative, events, mode: input.mode, seed: input.mode === 'seeded' ? input.seed : null, finished: !!defeated, winner: defeated ? characters.find(c => c.hp > 0)?.name || null : null };
}

export function createCharacter(rules,input,current=false){return buildCharacter(rules,input,current,false);}
export function createNPCCharacter(rules,input,current=false){return buildCharacter(rules,input,current,true);}
export function simulateRound(rules,input,overrideRng){return runRound(rules,input,overrideRng,false);}
export function simulateNPCEncounter(rules,input,overrideRng){return runRound(rules,input,overrideRng,true);}
export function createMiddleEarthCharacters(rules){
  return [
    {id:'demo-cael',name:'Cael',attributes:{forca:3,habilidade:2,resistencia:2,armadura:1,poderFogo:0},abilities:[],fields:{origem:'Rohan',perfil:'Guardião',historia:'Um homem de Rohan que protege os viajantes entre Edoras e as estradas de Eriador.'}},
    {id:'demo-lira',name:'Lira',attributes:{forca:0,habilidade:3,resistencia:2,armadura:1,poderFogo:2},abilities:[],fields:{origem:'Valfenda',perfil:'Explorador',historia:'Uma elfa batedora de Valfenda, treinada para reconhecer trilhas e proteger a expedição com seu arco.'}},
    {id:'demo-tobin',name:'Tobin',attributes:{forca:0,habilidade:3,resistencia:2,armadura:1,poderFogo:0},abilities:['reflexos','versatil'],fields:{origem:'O Condado',perfil:'Aventureiro',historia:'Um hobbit curioso do Condado, ágil e versátil, que decidiu acompanhar os viajantes além das fronteiras de sua terra.'}}
  ].map(c=>createCharacter(rules,c));
}
export function addMiddleEarthCharacters(rules,roster){
  const examples=createMiddleEarthCharacters(rules),next=[...roster,...examples.filter(c=>!roster.some(existing=>existing.id===c.id))];
  ensure(next.length<=50,'Limite de 50 personagens. Exclua uma ficha antes de adicionar exemplos.');return next;
}

// One escape test and, only on failure, one opponent attack. No hero attack or initiative.
export function escapeRule(rules) {
  return rules.combat.escape || {attribute:rules.attributes.find(a=>a.id==='habilidade')?.id || rules.attributes[0].id,difficulty:6};
}
export function simulateEscape(rules,heroInput,npcInput,{seed,npcActionId}={}) {
  validateRules(rules);
  const hero=createCharacter(rules,heroInput,true),npc=createNPCCharacter(rules,npcInput,true);
  ensure(hero.hp>0 && npc.hp>0,'Fuga exige dois combatentes vivos.');
  ensure(seed===undefined || integerOK(seed,0,4294967295),'Semente inválida.');
  const rng=seed===undefined?randomRng:seededRng(seed),config=escapeRule(rules),test=rules.actions.find(a=>a.kind==='test');
  ensure(test,'As regras precisam de uma ação de teste para fugir.');
  const context=(actor,target)=>({actor:actor.attributes,target:target.attributes,input:{attribute:config.attribute,difficulty:config.difficulty},testBonus:actor.bonuses.test,attackBonus:actor.bonuses.attack,defenseBonus:target.bonuses.defense});
  const roll=evaluate(test.formula,context(hero,npc),rng),success=roll.total>=config.difficulty;
  const events=['Fuga: '+rules.attributes.find(a=>a.id===config.attribute).name+'; total '+roll.total+' contra dificuldade '+config.difficulty+'. '+(success?'Você escapou do confronto.':'Você não conseguiu fugir.')];
  if(!success){
    const attack=rules.actions.find(a=>a.kind==='attack' && (!npcActionId || a.id===npcActionId));ensure(attack,'Ataque de resposta inválido.');
    const ctx=context(npc,hero),hitRoll=evaluate(attack.formula,ctx,rng),defense=evaluate(rules.combat.defense,ctx,rng);
    const hit=rules.combat.hitWhen==='>'?hitRoll.total>defense.total:hitRoll.total>=defense.total;
    const calculated=evaluate(rules.combat.damage,{...ctx,attack_total:hitRoll.total,defense_total:defense.total},rng).total,damage=hit?Math.max(0,calculated):0;
    ensure(numberOK(damage,0,10000),'Dano fora do intervalo suportado.');
    const before=hero.hp;hero.hp=Math.max(0,hero.hp-damage);
    events.push(npc.name+' → '+hero.name+': ataque de resposta '+attack.name+'; ataque '+hitRoll.total+', defesa '+defense.total+', dano '+damage+'; PV '+before+' → '+hero.hp+'.');
  }
  return {hero,npc,success,events};
}
