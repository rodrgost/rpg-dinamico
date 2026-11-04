import { evaluate, createMiddleEarthCharacters, addMiddleEarthCharacters } from '/engine.mjs';
import { createWorldUI } from '/world-ui.mjs';
import { createMissionUI } from '/mission-ui.mjs';
import { createAdventureUI } from '/adventure-ui.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const STORAGE = '3det-adaptavel-session-v1';
const state = { rules: null, roster: [], pairing: [], choices: {}, history: [], tab: 'arena', mode: 'random', seed: 42, busy: false, draft: null, editing: null, rulesText: '', error: '' };
let toastTimer;
function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').className = ''; }, error ? 7000 : 3500);
}
let missionUI;
const worldUI = createWorldUI({ render, toast, beforeWorldChange: (id, next) => missionUI?.assertEnvironmentChange(id, next), beforeWorldDelete:id=>missionUI?.assertEnvironmentDeletion(id) });
missionUI = createMissionUI({ render, toast, getEnvironments: worldUI.getEnvironments, getActiveEnvironmentId: worldUI.getActiveEnvironmentId });
const adventureUI = createAdventureUI({render,toast,getEnvironments:worldUI.getEnvironments,getMissions:missionUI.getMissions,getLegacyProgress:missionUI.getLegacyProgress,getEnvironmentSnapshot:worldUI.getEnvironmentSnapshot,getRules:() => state.rules,getCharacters:() => state.roster});
async function api(path, data) {
  const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let result;
  try { result = await response.json(); } catch { throw new Error('O servidor não respondeu em JSON. Reabra o site com sua conta.'); }
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result;
}
function persist() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({ rules: state.rules, roster: state.roster, pairing: state.pairing, choices: state.choices, history: state.history, mode: state.mode, seed: state.seed }));
    $('#save-state').textContent = 'Sessão salva neste navegador';
  } catch { $('#save-state').textContent = 'Armazenamento indisponível'; toast('Não foi possível salvar neste navegador. A sessão continua aberta.', true); }
}
function blankDraft() {
  return { name: '', attributes: Object.fromEntries(state.rules.attributes.map(a => [a.id, a.defaultValue])), abilities: [], fields: Object.fromEntries(state.rules.creation.fields.map(f => [f.id, f.type === 'select' && f.required ? f.options[0] : ''])) };
}
function resetBattle() {
  state.history = []; state.roster = state.roster.map(c => ({ ...c, hp: c.maxHp }));
}
function normalisePairing() {
  const valid = state.pairing.filter(id => state.roster.some(c => c.id === id));
  for (const c of state.roster) if (valid.length < 2 && !valid.includes(c.id)) valid.push(c.id);
  state.pairing = valid.slice(0, 2);
  for (const c of state.roster) if (!state.choices[c.id] || !state.rules.actions.some(a => a.id === state.choices[c.id].actionId)) state.choices[c.id] = { actionId: state.rules.actions.find(a => a.kind === 'attack').id, attribute: state.rules.attributes[0].id, difficulty: 6 };
}
const selected = () => state.pairing.map(id => state.roster.find(c => c.id === id)).filter(Boolean);
const attrsHTML = c => '<div class="mini-attrs">' + state.rules.attributes.map(a => '<span title="' + esc(a.name) + '">' + esc(a.short || a.name) + '<b>' + esc(c.attributes[a.id]) + '</b></span>').join('') + '</div>';
const rollHTML = roll => (roll.dice || []).map(d => '<span class="roll-token">' + esc(d.notation) + ' [' + esc(d.rolls.join(', ')) + ']</span>').join(' ');
const formulaHTML = (label, roll) => '<div class="formula-line"><span>' + esc(label) + '</span><code>' + esc(roll.formula) + '</code>' + rollHTML(roll) + '<strong>= ' + esc(roll.total) + '</strong></div>';
const header = (eyebrow, title, description) => '<div class="page-head"><div><p class="eyebrow">' + eyebrow + '</p><h1>' + title + '</h1><p>' + description + '</p></div><div class="rule-chip">' + esc(state.rules.name) + '<small>v' + esc(state.rules.version) + '</small></div></div>';

function fighterHTML(c, index) {
  const choice = state.choices[c.id], action = state.rules.actions.find(a => a.id === choice.actionId);
  const options = state.roster.map(other => '<option value="' + esc(other.id) + '"' + (other.id === c.id ? ' selected' : '') + (other.id === state.pairing[1-index] ? ' disabled' : '') + '>' + esc(other.name) + '</option>').join('');
  return '<section class="fighter ' + (index ? 'violet' : '') + '" aria-label="Combatente ' + (index + 1) + '"><div class="fighter-top"><div class="avatar" aria-hidden="true">' + esc(c.name.charAt(0).toUpperCase()) + '</div><div><label for="fighter-' + index + '">COMBATENTE 0' + (index + 1) + '</label><select id="fighter-' + index + '" data-pair="' + index + '">' + options + '</select><small>' + esc(c.fields.perfil || 'Personagem') + (c.abilities.length ? ' · ' + c.abilities.length + ' habilidade(s)' : ' · ' + c.spent + ' pontos') + '</small></div></div><div class="hp-row"><span>Pontos de vida</span><b>' + c.hp + ' <span class="muted">/ ' + c.maxHp + ' PV</span></b></div><div class="hp-track" role="meter" aria-label="PV de ' + esc(c.name) + '" aria-valuemin="0" aria-valuemax="' + c.maxHp + '" aria-valuenow="' + c.hp + '"><span style="width:' + (c.maxHp ? c.hp / c.maxHp * 100 : 0) + '%"></span></div>' + attrsHTML(c) + '<label class="action-label" for="action-' + index + '">Ação nesta rodada</label><select class="action-select" id="action-' + index + '" data-choice="' + esc(c.id) + '">' + state.rules.actions.map(a => '<option value="' + esc(a.id) + '"' + (a.id === choice.actionId ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select><p class="action-hint">' + esc(action.description || action.formula) + '</p>' + (action.kind === 'test' ? '<div class="test-controls"><div><label for="test-attr-' + index + '">Atributo</label><select id="test-attr-' + index + '" data-test-attr="' + esc(c.id) + '">' + state.rules.attributes.map(a => '<option value="' + esc(a.id) + '"' + (a.id === choice.attribute ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select></div><div><label for="difficulty-' + index + '">Dificuldade</label><input id="difficulty-' + index + '" type="number" min="0" max="100" step="1" data-difficulty="' + esc(c.id) + '" value="' + esc(choice.difficulty) + '"></div></div>' : '') + '</section>';
}
function logHTML() {
  if (!state.history.length) return '<div class="empty-log"><div class="dice-cube" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h3>A história ainda não começou.</h3><p>Escolha as ações e simule uma rodada. Cada cálculo aparecerá aqui.</p></div>';
  return '<div class="log-content">' + [...state.history].reverse().map((r, index) => '<article class="round-log"><div class="round-title"><span>RODADA ' + r.number + '</span><small>' + (r.mode === 'seeded' ? 'Reproduzível · semente ' + r.seed : 'Dados aleatórios') + '</small></div><div class="initiative"><strong>Iniciativa</strong> · ' + r.initiative.map(i => esc(i.name) + ': ' + rollHTML(i.roll) + ' = <b>' + i.roll.total + '</b>').join(' → ') + '<br>' + esc(state.rules.combat.initiative) + ' · Empate: ordem dos combatentes.</div>' + r.events.map(e => {
    if (e.kind === 'skipped') return '<div class="log-event skipped"><h3>' + esc(e.actor) + ' não realizou ' + esc(e.action) + '.</h3><p class="log-result">' + esc(e.message) + '</p></div>';
    if (e.kind === 'test') return '<div class="log-event ' + (e.success ? '' : 'miss') + '"><h3>' + esc(e.actor) + ' · Teste de ' + esc(e.attribute) + '<span class="result-tag">' + (e.success ? 'Sucesso' : 'Falha') + '</span></h3>' + formulaHTML('Teste', e.roll) + '<p class="log-result">Total ' + e.roll.total + ' ≥ dificuldade ' + e.difficulty + ': ' + (e.success ? 'sim' : 'não') + '. Nenhum dano aplicado.</p></div>';
    return '<div class="log-event ' + (e.hit ? '' : 'miss') + '"><h3>' + esc(e.actor) + ' → ' + esc(e.target) + ' · ' + esc(e.action) + '<span class="result-tag">' + (e.hit ? e.damage + ' de dano' : 'Defendido') + '</span></h3>' + formulaHTML('Ataque', e.roll) + formulaHTML('Defesa', e.defense) + '<div class="formula-line"><span>Dano</span><code>' + esc(e.damageFormula) + '</code><strong>= ' + e.damage + '</strong></div><p class="log-result">' + esc(e.target) + ': ' + e.hpBefore + ' → ' + e.hpAfter + ' PV' + (e.defeated ? ' · Incapacitado.' : '.') + '</p></div>';
  }).join('') + '</article>').join('') + '</div>';
}
function arenaHTML() {
  const pair = selected(), ready = pair.length === 2 && pair.every(c => c.hp > 0), finished = pair.length === 2 && pair.some(c => c.hp <= 0);
  const last = state.history.at(-1);
  return header('Uma ação. Muitas possibilidades.', 'Combate', 'Configure as regras, escolha os personagens e simule rodadas com cada resultado explicado.') + '<div class="world-toolbar"><a class="btn" href="#combat-rules">Configurar regras JSON ↓</a></div>' + '<div class="stats-strip"><div class="stat"><strong>' + String(state.history.length + 1).padStart(2, '0') + '</strong><span><b>Próxima rodada</b>' + (finished ? 'Combate encerrado' : 'Aguardando ações') + '</span></div><div class="stat"><strong>' + state.rules.creation.totalPoints + '</strong><span><b>Pontos por ficha</b>Atributos + habilidades</span></div><div class="stat"><strong>' + state.roster.length + '</strong><span><b>Personagens</b>Prontos para escolher</span></div><div class="stat"><strong>' + (state.mode === 'seeded' ? '↻' : '⚄') + '</strong><span><b>' + (state.mode === 'seeded' ? 'Reproduzível' : 'Aleatório') + '</b>Sem críticos automáticos</span></div></div><section class="panel"><div class="panel-head"><div><h2>Prepare o encontro</h2><p>Uma ação por personagem, em ordem de iniciativa.</p></div><span class="pill">' + (finished ? 'ENCERRADO' : 'RODADA ' + String(state.history.length + 1).padStart(2, '0')) + '</span></div><div class="arena-panel">' + (pair.length === 2 ? '<div class="combat-grid">' + fighterHTML(pair[0], 0) + '<div class="versus" aria-hidden="true">vs.</div>' + fighterHTML(pair[1], 1) + '</div>' : '<div class="setup-empty"><p>Crie dois personagens para iniciar o combate.</p><div class="btn-group" style="justify-content:center"><button class="btn primary" data-tab="characters">Montar personagens</button><button class="btn" data-do="example">Carregar duelo de exemplo</button></div></div>') + '<div class="round-bar"><div class="rng-settings"><label for="rng-mode">Rolagem</label><select id="rng-mode" aria-label="Modo de rolagem"><option value="random"' + (state.mode === 'random' ? ' selected' : '') + '>Dados aleatórios</option><option value="seeded"' + (state.mode === 'seeded' ? ' selected' : '') + '>Usar semente</option></select>' + (state.mode === 'seeded' ? '<label for="seed">Semente</label><input id="seed" aria-label="Semente inicial" type="number" step="1" min="0" max="4294967295" value="' + state.seed + '" title="A semente cresce em 1 a cada rodada. Reinicie para reproduzir.">' : '') + '</div><div class="btn-group"><button class="btn primary" data-do="round"' + (!ready || state.busy ? ' disabled' : '') + '>' + (state.busy ? '<span class="spinner"></span> Calculando…' : 'Simular rodada <span aria-hidden="true">↗</span>') + '</button><button class="btn" data-do="reset"' + (!pair.length || state.busy ? ' disabled' : '') + '>Reiniciar</button></div></div>' + (finished ? '<div class="battle-summary">' + (last?.winner ? esc(last.winner) + ' venceu o encontro.' : 'Há um personagem sem PV.') + ' Reinicie para recuperar os PV e começar de novo.</div>' : '') + '</div></section><section class="panel log-panel" aria-label="Resultados do combate"><div class="panel-head"><div><h2>Registro do combate</h2><p>Dados, fórmulas e consequências. Tudo à vista.</p></div><span class="pill">' + state.history.length + ' RODADA(S)</span></div><div id="combat-log" aria-live="polite" aria-relevant="additions">' + logHTML() + '</div></section>' + rulesHTML();
}
function draftStats() {
  const d = state.draft;
  const spent = state.rules.attributes.reduce((total, a) => total + d.attributes[a.id] * a.cost, 0) + state.rules.abilities.filter(a => d.abilities.includes(a.id)).reduce((total, a) => total + a.cost, 0);
  let hp = '—', mana = '—';
  try { hp = evaluate(state.rules.resources.hp.max, { actor: d.attributes }).total; mana = evaluate(state.rules.resources.mana.max, { actor: d.attributes }).total; } catch {}
  return { spent, hp, mana };
}
function attrEditorHTML() {
  const d = state.draft, stats = draftStats(), total = state.rules.creation.totalPoints;
  return '<div class="budget-box ' + (stats.spent > total ? 'over' : '') + '"><span>Orçamento da ficha<br><small>' + (state.rules.creation.requireAllPoints ? 'Distribua todos os pontos.' : 'Pode deixar pontos sem usar.') + '</small></span><strong>' + stats.spent + ' / ' + total + '</strong></div>' + state.rules.attributes.map(a => '<div class="attr-row"><div class="attr-label"><span class="attr-symbol">' + esc(a.short || a.id.slice(0, 2)) + '</span><div><b>' + esc(a.name) + '</b><small>' + esc(a.description || a.min + '–' + a.max + ' · custo ' + a.cost) + '</small></div></div><div class="stepper"><button type="button" data-step="' + esc(a.id) + '" data-delta="-1" aria-label="Diminuir ' + esc(a.name) + '"' + (d.attributes[a.id] <= a.min ? ' disabled' : '') + '>−</button><b aria-label="Valor de ' + esc(a.name) + '">' + d.attributes[a.id] + '</b><button type="button" data-step="' + esc(a.id) + '" data-delta="1" aria-label="Aumentar ' + esc(a.name) + '"' + (d.attributes[a.id] >= a.max ? ' disabled' : '') + '>+</button></div></div>').join('') + '<div class="resource-preview"><span>PV iniciais: <b>' + esc(stats.hp) + '</b></span><span>Mana: <b>' + esc(stats.mana) + '</b></span></div>' + (stats.hp === 0 ? '<p class="field-hint">Com zero PV, a ficha é válida, mas inicia incapacitada.</p>' : '');
}
function fieldsHTML() {
  return state.rules.creation.fields.map(f => '<div class="' + (f.type === 'textarea' ? 'full' : '') + '"><label for="field-' + esc(f.id) + '">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' + (f.type === 'select' ? '<select id="field-' + esc(f.id) + '" data-field="' + esc(f.id) + '"' + (f.required ? ' required' : '') + '>' + (!f.required ? '<option value="">Não informado</option>' : '') + f.options.map(o => '<option value="' + esc(o) + '"' + (state.draft.fields[f.id] === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>' : f.type === 'textarea' ? '<textarea id="field-' + esc(f.id) + '" data-field="' + esc(f.id) + '" rows="2" maxlength="500" placeholder="' + esc(f.placeholder) + '"' + (f.required ? ' required' : '') + '>' + esc(state.draft.fields[f.id]) + '</textarea>' : '<input id="field-' + esc(f.id) + '" data-field="' + esc(f.id) + '" value="' + esc(state.draft.fields[f.id]) + '" maxlength="500" placeholder="' + esc(f.placeholder) + '"' + (f.required ? ' required' : '') + '>') + '</div>').join('');
}
function charactersHTML() {
  if (!state.draft) state.draft = blankDraft();
  return header('Personagens com personalidade.', 'Dê forma ao seu herói.', 'Distribua pontos, escolha habilidades e leve a ficha para a aventura.') + '<div class="world-toolbar"><button class="btn" data-do="middle-earth">Adicionar exemplos da Terra Média</button><p class="field-hint">Cael de Rohan, Lira de Valfenda e Tobin do Condado. Oito pontos por ficha, incluindo habilidades, nas regras padrão de 3D&T. As fichas existentes são preservadas.</p></div><div class="character-layout"><section class="panel"><div class="panel-head"><h2>' + (state.editing ? 'Editar personagem' : 'Nova ficha') + '</h2><span class="pill">CRIAÇÃO POR JSON</span></div><form id="character-form" class="form-body"><div class="form-grid"><div class="full"><label for="character-name">Nome do personagem *</label><input id="character-name" value="' + esc(state.draft.name) + '" placeholder="Como seu herói se chama?" required maxlength="60"></div>' + fieldsHTML() + '</div><p class="section-label">01 / Atributos</p><div id="attr-editor">' + attrEditorHTML() + '</div><p class="section-label">02 / Habilidades de exemplo</p>' + (state.rules.abilities.length ? state.rules.abilities.map(a => '<label class="ability-option"><input type="checkbox" data-ability="' + esc(a.id) + '"' + (state.draft.abilities.includes(a.id) ? ' checked' : '') + '><span><b>' + esc(a.name) + '</b><small>' + esc(a.description || '') + '</small></span><em>' + a.cost + ' ponto(s)</em></label>').join('') : '<p class="field-hint">Este conjunto de regras não define habilidades.</p>') + '<div id="character-error"' + (state.error ? ' class="inline-error" role="alert"' : '') + '>' + esc(state.error) + '</div><p class="field-hint">Salvar ou editar uma ficha reinicia o combate e recupera os PV.</p><div class="form-actions"><button type="submit" class="btn primary"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Validando…' : state.editing ? 'Salvar alterações' : 'Salvar personagem') + '</button><button type="button" class="btn" data-do="new">Limpar ficha</button></div></form></section><section class="panel" style="align-self:start"><div class="panel-head"><h2>Suas fichas</h2><span class="pill">' + state.roster.length + '</span></div><div class="roster-stack">' + (state.roster.length ? state.roster.map(c => '<article class="roster-card"><h3>' + esc(c.name) + '</h3><p>' + c.spent + ' pontos · ' + c.maxHp + ' PV · ' + c.maxMana + ' mana</p>' + attrsHTML(c) + (c.abilities.length ? '<p>' + c.abilities.map(id => esc(state.rules.abilities.find(a => a.id === id)?.name)).join(' · ') + '</p>' : '') + '<div class="btn-group"><button class="btn" data-edit="' + esc(c.id) + '">Editar ficha</button><button class="btn ghost danger" data-delete="' + esc(c.id) + '">Excluir</button></div></article>').join('') : '<p class="empty-roster">Sua primeira ficha começa ao lado.</p>') + '</div><p class="roster-note">As fichas e os resultados ficam salvos neste navegador. Você precisa de dois personagens para simular uma rodada.</p><div class="editor-actions"><button class="btn" data-tab="arena">Ir para a arena ↗</button><button class="subtle-link" data-do="example">Carregar exemplo</button></div></section></div>';
}
function rulesHTML() {
  return '<section id="combat-rules" class="combat-rules" aria-labelledby="combat-rules-title"><div class="page-head"><div><p class="eyebrow">Configure o sistema do combate.</p><h2 id="combat-rules-title">Regras do combate</h2><p>Carregue ou edite o JSON. Ele define o combate, os atributos, a criação de fichas, as habilidades e os recursos usados pelos personagens.</p></div></div>' + '<div class="rules-layout"><section class="panel"><div class="panel-head"><h2>Conjunto de regras</h2><button class="btn" data-do="import">Carregar JSON ↑</button></div><label class="sr-only" for="rules-editor">Editor de regras JSON</label><textarea class="code-editor" id="rules-editor" spellcheck="false">' + esc(state.rulesText) + '</textarea><div id="rules-error"' + (state.error ? ' class="inline-error" role="alert" style="margin:15px"' : '') + '>' + esc(state.error) + '</div><div class="editor-actions"><button class="btn primary" data-do="apply"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Validando…' : 'Validar e aplicar') + '</button><div class="btn-group"><button class="btn" data-do="download">Baixar JSON</button><button class="btn ghost" data-do="builtin">Usar exemplo</button></div></div></section><aside class="panel"><div class="schema-info"><h3>O que você pode adaptar</h3><p>' + esc(state.rules.description || 'Conjunto externo de regras.') + '</p><ul><li><code>attributes</code> nomes, limites e custos.</li><li><code>creation</code> orçamento, campos abertos e seleções.</li><li><code>resources</code> fórmulas de PV e mana.</li><li><code>abilities</code> custos e bônus de ataque, defesa e teste.</li><li><code>actions</code> ataques e testes de atributos.</li><li><code>combat</code> iniciativa, defesa, dano e <code>escape:{attribute,difficulty}</code> para fuga. A fuga usa a ação de teste; falha permite um ataque de resposta.</li></ul><hr><h3>Fórmulas sem código</h3><p>Use números, <code>+</code> <code>−</code> <code>*</code> <code>/</code>, parênteses, dados como <code>1d6</code> e funções <code>max</code>, <code>min</code>, <code>floor</code> e <code>ceil</code>.</p><p>Variáveis: <code>actor.forca</code>, <code>target.armadura</code>, <code>actor[input.attribute]</code>, <code>attackBonus</code>, <code>defenseBonus</code>, <code>testBonus</code>. No dano: <code>attack_total</code> e <code>defense_total</code>.</p><p>O MVP aceita ataques e testes, sem efeitos de status ou consumo de mana. Críticos e falhas automáticos devem permanecer <code>false</code>.</p><hr><p class="warning">Aplicar outro JSON limpa as fichas e o registro de combate. Baixar JSON exporta o texto atual do editor.</p></div></aside></div></section>';
}
function render() {
  if (!state.rules) return;
  const viewingAdventure=state.tab==='adventures' && adventureUI.isViewing();
  document.body.classList.toggle('adventure-focus',viewingAdventure);
  $('#adventure-back').hidden=!viewingAdventure;
  $('#breadcrumb').hidden=viewingAdventure;
  const titles = { arena: 'Combate', characters: 'Personagens', world: 'Cenários', missions: 'Missões', adventures: 'Aventuras' };
  $('#breadcrumb').innerHTML = 'Laboratório / <strong>' + titles[state.tab] + '</strong>';
  $('.sidebar').querySelectorAll('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === state.tab); button.setAttribute('aria-current', button.dataset.tab === state.tab ? 'page' : 'false'); });
  $('#roster-count').textContent = state.roster.length;
  $('#main').innerHTML = state.tab === 'arena' ? arenaHTML() : state.tab === 'characters' ? charactersHTML() : state.tab === 'world' ? worldUI.html() : state.tab === 'missions' ? missionUI.html() : state.tab === 'adventures' ? adventureUI.html() : arenaHTML();
}
async function applyRules(rules, useDemo = false) {
  const validated = await api('rules', { rules });
  let roster = [];
  if (useDemo) {
    const examples = createMiddleEarthCharacters(validated);
    roster = await Promise.all(examples.map(character => api('character', { rules: validated, character })));
  }
  state.rules = validated; state.rulesText = JSON.stringify(validated, null, 2); state.roster = roster; state.pairing = roster.map(c => c.id); state.choices = {}; state.history = []; state.draft = null; state.editing = null; state.error = '';
  normalisePairing();
  if (useDemo) state.choices['demo-lira'].actionId = 'attack_ranged';
  persist();
}
async function builtIn(useDemo) {
  const response = await fetch('/rules/3det-adaptavel.json');
  if (!response.ok) throw new Error('Não foi possível carregar as regras de exemplo.');
  await applyRules(await response.json(), useDemo);
}
async function doRound() {
  state.busy = true; render();
  try {
    const pair = selected();
    const round = await api('round', { rules: state.rules, combatants: pair, choices: pair.map(c => state.choices[c.id]), mode: state.mode, seed: state.mode === 'seeded' ? (state.seed + state.history.length) % 4294967296 : undefined });
    const number = state.history.length + 1;
    state.history.push({ ...round, number });
    state.roster = state.roster.map(c => round.characters.find(updated => updated.id === c.id) || c);
    persist(); toast(round.finished ? 'Encontro encerrado. Resultado registrado.' : 'Rodada ' + number + ' concluída.');
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; render(); }
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target || target.disabled || state.busy) return;
  if (target.dataset.tab) { state.tab = target.dataset.tab; if (state.tab === 'missions') missionUI.showList(); if (state.tab === 'adventures') adventureUI.showList(); state.error = ''; render(); return; }
  if (target.dataset.step) {
    const a = state.rules.attributes.find(a => a.id === target.dataset.step);
    state.draft.attributes[a.id] = Math.max(a.min, Math.min(a.max, state.draft.attributes[a.id] + Number(target.dataset.delta)));
    $('#attr-editor').innerHTML = attrEditorHTML();
    $('#attr-editor').querySelector('[data-step="' + a.id + '"][data-delta="' + target.dataset.delta + '"]')?.focus();
    return;
  }
  if (target.dataset.edit) {
    const c = state.roster.find(c => c.id === target.dataset.edit);
    state.draft = structuredClone(c); state.editing = c.id; state.error = ''; render(); $('#character-name').focus(); return;
  }
  if (target.dataset.delete) {
    state.roster = state.roster.filter(c => c.id !== target.dataset.delete); resetBattle(); normalisePairing();
    if (state.editing === target.dataset.delete) { state.draft = null; state.editing = null; }
    persist(); render(); toast('Ficha excluída.'); return;
  }
  const action = target.dataset.do;
  if (!action) return;
  if (action === 'round') return doRound();
  if (action === 'new') { state.draft = blankDraft(); state.editing = null; state.error = ''; render(); return; }
  if (action === 'reset') { resetBattle(); persist(); render(); toast('PV recuperados. Pronto para uma nova rodada.'); return; }
  if (action === 'import') { $('#rules-file').click(); return; }
  if (action === 'download') {
    try { JSON.parse(state.rulesText); } catch { toast('Corrija a sintaxe do JSON antes de baixar.', true); return; }
    const url = URL.createObjectURL(new Blob([state.rulesText], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '3det-adaptavel-regras.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  state.busy = true; state.error = ''; render();
  try {
    if(action==='middle-earth'){
      const next=addMiddleEarthCharacters(state.rules,state.roster),added=next.length-state.roster.length;
      if(!added){toast('Os exemplos já estão na sua lista. Use Editar para conferir as fichas.');return;}
      try{localStorage.setItem(STORAGE,JSON.stringify({rules:state.rules,roster:next,pairing:state.pairing,choices:state.choices,history:state.history,mode:state.mode,seed:state.seed}));}catch{throw new Error('Não foi possível salvar os exemplos. Libere espaço neste navegador e tente novamente.');}
      state.roster=next;normalisePairing();$('#save-state').textContent='Sessão salva neste navegador';toast(added+' personagem(ns) da Terra Média adicionado(s).');
    }
    if (action === 'apply') { await applyRules(JSON.parse(state.rulesText)); toast('Regras aplicadas. Monte as novas fichas.'); }
    if (action === 'example' || action === 'builtin') { await builtIn(action === 'example'); if (action === 'example') state.tab = 'arena'; toast(action === 'example' ? 'Duelo de exemplo pronto.' : 'Regras de exemplo aplicadas.'); }
  } catch (error) { state.error = error instanceof SyntaxError ? 'JSON inválido: ' + error.message : error.message; toast(state.error, true); }
  finally { state.busy = false; render(); }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'rules-editor') state.rulesText = target.value;
  if (target.id === 'character-name') state.draft.name = target.value;
  if (target.dataset.field) state.draft.fields[target.dataset.field] = target.value;
  if (target.dataset.difficulty) { state.choices[target.dataset.difficulty].difficulty = Number(target.value); persist(); }
  if (target.id === 'seed') { state.seed = Number(target.value); }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.pair !== undefined) { state.pairing[Number(target.dataset.pair)] = target.value; resetBattle(); normalisePairing(); persist(); render(); }
  if (target.dataset.choice) { state.choices[target.dataset.choice].actionId = target.value; persist(); render(); }
  if (target.dataset.testAttr) { state.choices[target.dataset.testAttr].attribute = target.value; persist(); }
  if (target.id === 'rng-mode') { state.mode = target.value; resetBattle(); persist(); render(); }
  if (target.id === 'seed') { resetBattle(); persist(); render(); }
  if (target.dataset.ability) {
    state.draft.abilities = target.checked ? [...state.draft.abilities, target.dataset.ability] : state.draft.abilities.filter(id => id !== target.dataset.ability);
    $('#attr-editor').innerHTML = attrEditorHTML();
  }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'character-form') return;
  event.preventDefault(); if (state.busy) return;
  state.busy = true; state.error = ''; render();
  try {
    const character = await api('character', { rules: state.rules, character: { ...state.draft, id: state.editing || crypto.randomUUID() } });
    if (state.editing) state.roster = state.roster.map(c => c.id === state.editing ? character : c); else state.roster.push(character);
    resetBattle(); normalisePairing(); state.draft = null; state.editing = null; persist(); toast('Personagem salvo e validado.');
  } catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); if (state.error) $('#character-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
});
$('#rules-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  if (file.size > 256000) { toast('Use um JSON de até 256 KB.', true); return; }
  state.rulesText = await file.text(); state.error = ''; state.tab = 'arena'; render(); $('#combat-rules')?.scrollIntoView({ block: 'start' }); $('#rules-editor')?.focus({ preventScroll: true }); toast('Arquivo carregado no editor. Valide e aplique para usar.');
});
async function initialize() {
  await worldUI.init();
  missionUI.init();
  adventureUI.init();
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE)); } catch {}
  if (saved?.rules) {
    try {
      state.rules = await api('rules', { rules: saved.rules });
      if (!Array.isArray(saved.roster) || saved.roster.length > 50) throw new Error('Sessão inválida.');
      state.roster = await Promise.all(saved.roster.map(character => api('character', { rules: state.rules, character, current: true })));
      if (new Set(state.roster.map(c => c.id)).size !== state.roster.length) throw new Error('Identificadores duplicados.');
      state.pairing = Array.isArray(saved.pairing) ? saved.pairing.slice(0, 2) : [];
      state.choices = saved.choices && typeof saved.choices === 'object' ? saved.choices : {};
      state.history = Array.isArray(saved.history) ? saved.history.slice(-100) : [];
      state.mode = ['random', 'seeded'].includes(saved.mode) ? saved.mode : 'random';
      state.seed = Number.isInteger(saved.seed) && saved.seed >= 0 && saved.seed <= 4294967295 ? saved.seed : 42;
      state.rulesText = JSON.stringify(state.rules, null, 2); normalisePairing(); render(); return;
    } catch { toast('A sessão anterior estava incompatível. O exemplo será carregado.', true); }
  }
  try { await builtIn(true); render(); }
  catch (error) { $('#main').innerHTML = '<div class="inline-error" role="alert">' + esc(error.message) + '</div><button class="btn" data-retry>Recarregar</button>'; $('[data-retry]').onclick = () => location.reload(); }
}
initialize();
