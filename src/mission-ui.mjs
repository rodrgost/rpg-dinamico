import { createNPCManager } from '/npc-ui.mjs';
import { OBJECTIVE_TYPES, OBJECTIVE_STATUSES, validateMissionDocument, validateMission, missionProgress, assertMissionLocations, pendingDependencies, createMissionTemplate, missionLLMPrompt, supportsPortoAuroraMission, createPortoAuroraMission, supportsEriadorMission, createEriadorMissions } from '/mission.mjs';
const STORAGE = '3det-adaptavel-missions-v1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const pretty = value => JSON.stringify(value, null, 2);
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const statusName = id => ({ pending: 'Pendente', in_progress: 'Em andamento', completed: 'Concluída' }[id]);

export function createMissionUI({ render, toast, getEnvironments, getActiveEnvironmentId }) {
  let legacyProgress = [];
  const model = m => ({ ...structuredClone(m), objectives: m.objectives.map(o => ({ ...structuredClone(o), status: 'pending', completedAlternativeId: null })) });
  const hasProgress = m => m.objectives.some(o => o.status !== 'pending' || o.completedAlternativeId);
  const archive = m => ({ id: 'anterior-' + crypto.randomUUID(), mission: structuredClone(m), environment: structuredClone(environment(m.environmentId) || null) });
  let missions = [], view = 'list', draft = null, selectedId = null, error = '', busy = false;
  let formulaTexts={};
  let search = '', filter = '', jsonText = '', jsonEnvironmentId = '', pendingImport = null, undo = null;
  let storageError = '', preservedRaw = null, formReturn = 'list', guideEnvironmentId = '', exampleEnvironmentId='';
  const environments = () => getEnvironments();
  const environment = id => environments().find(e => e.id === id);
  const selected = () => missions.find(m => m.id === selectedId);
  const npcManager=createNPCManager({scope:'mission',title:'NPCs desta missão',allowReferences:true,getLocked:()=>busy,maxEntries:20,getEntries:()=>draft?.npcs || [],getPlaces:()=>environment(draft?.environmentId)?.places || [],getReferences:()=>environment(draft?.environmentId)?.npcs || [],onChange(entries){if(!draft)throw new Error('Abra a edição da missão.');draft.npcs=entries;},saveMessage:'NPC atualizado no rascunho. Salve a missão para persistir.',render,toast});

  const progressHTML = mission => { const p = missionProgress(mission); return '<div class="mission-progress"><div><span>' + p.completed + ' de ' + p.total + ' objetivos concluídos</span><b>' + p.percent + '%</b></div><progress max="' + p.total + '" value="' + p.completed + '" aria-label="Progresso de ' + esc(mission.name) + '">' + p.percent + '%</progress></div>'; };
  function persist(next, legacy = legacyProgress) {
    if (storageError) throw new Error('A coleção salva precisa ser recuperada antes de gravar novas missões. Baixe a cópia de recuperação.');
    try { localStorage.setItem(STORAGE, JSON.stringify({ schemaVersion: 1, missions: next, legacyProgress: legacy })); }
    catch { throw new Error('Não foi possível salvar as missões neste navegador. Libere espaço ou permita o armazenamento e tente novamente.'); }
    missions = next; legacyProgress = legacy; 
  }
  function init() {
    try {
      const raw = localStorage.getItem(STORAGE); preservedRaw = raw;
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.missions) || saved.missions.length > 200) throw new Error('Formato da coleção inválido.');
      const next = saved.missions.map(validateMissionDocument);
      if (new Set(next.map(m => m.id)).size !== next.length) throw new Error('Há IDs de missão duplicados.');
      if (saved.legacyProgress !== undefined && !Array.isArray(saved.legacyProgress)) throw new Error('Arquivo de progresso anterior inválido.');
      legacyProgress = (saved.legacyProgress || []).map(entry => { validateMissionDocument(entry.mission); return entry; });
      const progressed = next.filter(hasProgress);
      if (progressed.length) persist(next.map(model), [...legacyProgress, ...progressed.map(archive)]);
      else missions = next.map(model);
    } catch (e) { storageError = 'Não foi possível restaurar as missões. A cópia existente foi preservada. ' + e.message; }
  }
  function referenceError(mission) {
    try { validateMission(mission, environments()); return ''; } catch (e) { return e.message; }
  }
  function newObjective() { return { ...(draft?.execution==='formula'?{completion:{mode:'automatic',evaluateAt:'turn_end',condition:false}}:{}), id: 'objetivo-' + crypto.randomUUID(), type: 'combat', title: '', description: '', target: '', placeId: null, completionCriteria: '', status: 'pending', dependsOn: [], alternatives: [], completedAlternativeId: null }; }
  function newMission() {
    if (!environments().length) throw new Error('Crie um cenário antes de cadastrar uma missão.');
    if (missions.length >= 200) throw new Error('Limite de 200 missões. Exporte e remova uma missão antes de adicionar outra.');
    const objective=newObjective();objective.type='other';objective.completion={mode:'automatic',evaluateAt:'turn_end',condition:false};
    return { schemaVersion: 1, execution:'formula',completion:true,actions:[],items:[],id: 'missao-' + crypto.randomUUID(), environmentId: filter || getActiveEnvironmentId() || environments()[0].id, name: '', description: '', objectives: [objective] };
  }
  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : pretty(value)], { type: filename.endsWith('.txt') ? 'text/plain;charset=utf-8' : 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const environmentOptions = (value, emptyLabel) => '<option value="">' + emptyLabel + '</option>' + environments().map(e => '<option value="' + esc(e.id) + '"' + (e.id === value ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('');
  const errorHTML = () => error ? '<div class="inline-error" role="alert">' + esc(error) + '</div>' : '';
  function guideEnvironment() {
    const env = environment(guideEnvironmentId);
    if (!env) throw new Error('Selecione um cenário para gerar o modelo e as instruções.');
    return env;
  }
  async function copyText(value, selector) {
    try { await navigator.clipboard.writeText(value); toast('Copiado. Cole no outro LLM.'); }
    catch { setTimeout(() => { const field = document.querySelector(selector); field?.focus(); field?.select(); }, 0); toast('A cópia automática não está disponível. O texto foi selecionado; use Ctrl+C ou Baixar.'); }
  }
  function guideHTML() {
    const env = environment(guideEnvironmentId);
    return '<div class="page-head"><div><p class="eyebrow">Crie em qualquer LLM. Jogue aqui.</p><h1>Modelo de missão</h1><p>Um JSON completo e instruções prontas, com os IDs reais do seu cenário.</p></div></div><div class="world-toolbar"><button class="btn" data-mission-action="list">← Todas as missões</button><button class="btn primary" data-mission-action="import">Importar JSON gerado ↑</button></div><section class="panel mission-model-intro"><label for="mission-model-environment">1. Escolha o cenário da missão</label><select id="mission-model-environment">' + environmentOptions(guideEnvironmentId, 'Selecione um cenário') + '</select><p>2. Copie as instruções abaixo para outro LLM e acrescente sua ideia. Elas incluem o contexto do cenário, o contrato completo e um exemplo válido.</p><p>3. Salve a resposta como <code>missao.json</code> e use <strong>Importar JSON</strong>. Confira a validação e confirme a inclusão. Progresso importado será preservado em Aventuras como registro anterior.</p><p class="field-hint">O conteúdo só sai deste navegador quando você copia ou baixa e o compartilha.</p></section>' + errorHTML() + (env ? '<div class="rules-layout"><section class="panel"><div class="panel-head"><h2>Modelo completo em JSON</h2><button class="btn" data-mission-action="download-model">Baixar modelo .json</button></div><p class="model-note">' + (supportsEriadorMission(env) ? 'Eriador: O Caminho das Sombras. 24 objetivos automáticos, 26 ações, cinco NPCs do cenário e alternativas pacíficas. Há também dois exemplos adicionais em Missões de Eriador.' : supportsPortoAuroraMission(env) ? 'Porto Aurora: a Noite das Marés. 24 objetivos automáticos por fórmulas; três adversários com fichas de combate, uma testemunha condicional, referências de moradores e 27 ações executáveis, caminhos alternativos e dependências pontuais.' : 'Seis tipos de objetivo, solução direta, três alternativas, dependência simples e múltipla.') + ' Todos os objetivos começam pendentes. O progresso será registrado em Aventuras.</p><label class="sr-only" for="mission-model">Modelo completo de missão</label><textarea id="mission-model" class="code-editor" readonly spellcheck="false">' + esc(pretty(createMissionTemplate(env))) + '</textarea><div class="editor-actions"><button class="btn" data-mission-action="copy-model">Copiar JSON</button></div></section><section class="panel"><div class="panel-head"><h2>Instruções para o LLM</h2></div><div class="schema-info"><p>Inclui os limites de campos, tipos aceitos, situações, regras de dependência e alternativas, além dos lugares e descrições do cenário.</p><div class="btn-group"><button class="btn primary" data-mission-action="copy-prompt">Copiar instruções completas</button><button class="btn" data-mission-action="download-prompt">Baixar instruções .txt</button></div><label for="mission-llm-prompt" class="section-label">Confira antes de compartilhar</label><textarea id="mission-llm-prompt" class="details-editor" readonly rows="16">' + esc(missionLLMPrompt(env)) + '</textarea><p class="field-hint">Edite o pedido criativo ao final do texto no outro LLM. Não altere os identificadores do cenário e dos lugares.</p><hr><h3>Campos adicionais</h3><p><code>dependsOn</code>: lista de IDs de objetivos anteriores por necessidade, não pela posição na lista. Vazio significa ordem livre.</p><p><code>alternatives</code>: caminhos diferentes para o mesmo objetivo. Apenas um precisa ser realizado.</p><p><code>completedAlternativeId</code>: caminho escolhido, ou null. É obrigatório escolher um antes de concluir um objetivo com alternativas.</p><p>Todos os objetivos são obrigatórios. Acompanhamento manual e avaliação automática por turno ocorrem em Aventuras.</p></div></section></div>' : '<p class="warning">Crie um cenário na aba Cenários para gerar um modelo com referências válidas.</p>');
  }
  function relationsHTML(o, mission, interactive) {
    const dependencies = o.dependsOn || [], alternatives = o.alternatives || [];
    const ruleHTML = '<p class="field-hint">Conclusão: ' + (o.completion?.mode === 'automatic' ? 'automática no fim do turno' : 'manual') + '.</p>' + (o.completion?.mode === 'automatic' ? '<details><summary>Regra de execução JSON</summary><pre class="condition-json">' + esc(pretty(o.completion)) + '</pre></details>' : '');
    if (!dependencies.length && !alternatives.length) return ruleHTML;
    const blocked = pendingDependencies(mission, o), env = environment(mission.environmentId);
    return ruleHTML + '<div class="objective-relations">' + (dependencies.length ? '<p><strong>Depende de:</strong> ' + dependencies.map(id => esc(mission.objectives.find(item => item.id === id)?.title || id)).join(' · ') + '</p>' : '<p><strong>Ordem livre:</strong> sem pré-requisitos.</p>') + (blocked.length ? '<p class="warning">Aguardando: ' + blocked.map(item => esc(item.title)).join(', ') + '. Conclua esses objetivos para iniciar este.</p>' : '') + (alternatives.length ? '<h3>Alternativas — basta realizar uma</h3><div class="mission-alternatives">' + alternatives.map(a => '<article><span class="pill">' + esc(OBJECTIVE_TYPES.find(t => t.id === a.type)?.name || a.type) + '</span><h4>' + esc(a.title) + '</h4><p>' + esc(a.description) + '</p>' + (a.target ? '<p><strong>Alvo:</strong> ' + esc(a.target) + '</p>' : '') + (a.placeId ? '<p><strong>Lugar:</strong> ' + esc(env?.places.find(p => p.id === a.placeId)?.path || env?.places.find(p => p.id === a.placeId)?.name || a.placeId) + '</p>' : '') + '<p><strong>Concluir quando:</strong> ' + esc(a.completionCriteria || 'Conforme avaliação do mestre.') + '</p></article>').join('') + '</div>' + (interactive ? '<label for="alternative-' + esc(o.id) + '">Alternativa realizada</label><select id="alternative-' + esc(o.id) + '" data-objective-alternative="' + esc(o.id) + '"' + (busy || blocked.length ? ' disabled' : '') + '><option value="">Selecione quando realizar um caminho</option>' + alternatives.map(a => '<option value="' + esc(a.id) + '"' + (a.id === o.completedAlternativeId ? ' selected' : '') + '>' + esc(a.title) + '</option>').join('') + '</select>' : '<p class="field-hint">Alternativa registrada: ' + esc(alternatives.find(a => a.id === o.completedAlternativeId)?.title || 'Nenhuma') + '.</p>') : '') + (!interactive ? '<p class="field-hint">Edite dependências e alternativas em JSON da missão. Os dados abaixo são preservados ao salvar esta ficha.</p>' : '') + '</div>';
  }
  function formulaEditorHTML(){
    return '<details class="formula-editor"><summary>Regras calculáveis em JSON</summary><p>Use execution: formula para impedir conclusão manual. Configure ações, itens e a fórmula da missão; configure completion.condition de cada objetivo no JSON completo.</p>'+['actions','items','completion'].map(field=>'<label for="mission-formula-'+field+'">'+esc(({actions:'Ações executáveis',items:'Itens',completion:'Fórmula de conclusão da missão'})[field])+'</label><textarea id="mission-formula-'+field+'" class="details-editor" data-formula-field="'+field+'" rows="5" spellcheck="false">'+esc(formulaTexts[field] ?? pretty(draft[field] ?? (field==='completion'?true:[])))+'</textarea>').join('')+'<label><input type="checkbox" data-formula-mode'+(draft.execution==='formula'?' checked':'')+'> Conclusão por fórmulas (sem marcação manual)</label><p class="field-hint">Operadores: and, or, not, eq, ne, gt, gte, lt, lte. Referências: npcs.ID.derrotado, inventario.ID.quantidade, objetivos.ID.concluido, acoes.ID.sucessos, personagem.hp, local.id e turno.numero. O Modelo para outro LLM contém o contrato completo, também utilizável sem LLM.</p></details>';
  }
  function eriadorExamplesHTML(){
    const env=environment(exampleEnvironmentId);
    if(!supportsEriadorMission(env))return '<section class="panel form-body"><h1>Missões de Eriador</h1><p>Importe Eriador e Além com seus lugares e NPCs para carregar estes exemplos.</p><button class="btn" data-mission-action="list">Voltar às missões</button></section>';
    return '<div class="page-head"><div><p class="eyebrow">Aventuras na Terra Média</p><h1>Missões de Eriador</h1><p>Escolha um modelo para o cenário '+esc(env.name)+'. Todos usam ações executáveis e conclusões calculadas, sem LLM.</p></div></div><button class="btn" data-mission-action="list">← Todas as missões</button>'+errorHTML()+'<div class="environment-grid">'+createEriadorMissions(env).map(m=>'<article class="panel environment-card"><p class="eyebrow">'+m.objectives.length+' objetivos · '+m.actions.length+' ações</p><h2>'+esc(m.name)+'</h2><p>'+esc(m.description)+'</p><p><strong>Oferta:</strong> '+esc(env.places.find(p=>p.id===m.offer.placeId)?.name)+' · '+esc(m.offer.title)+'</p><button class="btn primary" data-mission-action="eriador-model" data-example-id="'+esc(m.id)+'">Conferir e importar modelo</button></article>').join('')+'</div>';
  }
  function cardsHTML() {
    const visible = missions.filter(m => (!filter || m.environmentId === filter) && normalize(m.name + ' ' + m.description + ' ' + (environment(m.environmentId)?.name || '')).includes(normalize(search)));
    if (!visible.length) return '<section class="panel mission-empty"><span class="mission-empty-symbol" aria-hidden="true">◎</span><h2>' + (missions.length ? 'Nenhuma missão nesta busca.' : 'Todo objetivo precisa de um cenário.') + '</h2><p>' + (missions.length ? 'Altere a busca ou o filtro de cenário.' : 'Escolha um cenário e descreva o que precisa acontecer. Uma missão pode reunir diferentes tipos de objetivo.') + '</p>' + (!missions.length ? '<button class="btn primary" data-mission-action="new"' + (!environments().length ? ' disabled' : '') + '>Criar primeira missão</button>' : '') + '</section>';
    return '<div class="environment-grid">' + visible.map(m => {
      const p = missionProgress(m), invalid = referenceError(m);
      return '<article class="panel environment-card mission-card"><p class="eyebrow">' + m.objectives.length + ' objetivo(s)</p><h2>' + esc(m.name) + '</h2><p class="mission-environment-label">Cenário: <strong>' + esc(environment(m.environmentId)?.name || 'Cenário indisponível') + '</strong></p><p class="environment-description">' + esc(m.description || 'Sem descrição.') + '</p><div class="mission-card-summary"><span class="pill mission-status ' + p.status + '">' + (invalid ? 'REVISAR VÍNCULO' : 'MODELO') + '</span><span>' + p.total + ' objetivos obrigatórios</span></div><div class="btn-group"><button class="btn primary" data-mission-open="' + esc(m.id) + '">Abrir objetivos</button><button class="btn" data-mission-edit="' + esc(m.id) + '">Editar missão</button><button class="btn ghost danger" data-mission-delete="' + esc(m.id) + '" aria-label="Excluir missão ' + esc(m.name) + '">Excluir</button></div></article>';
    }).join('') + '</div>';
  }
  function listHTML() {
    return '<div class="page-head"><div><p class="eyebrow">Seus objetivos.</p><h1>Missões</h1><p>Cada missão pertence a um cenário e reúne seus próprios objetivos. Crie e edite suas missões nesta lista.</p></div><div class="rule-chip">' + missions.length + ' missão(ões)<small>Salvas neste navegador</small></div></div><div class="world-toolbar"><div class="btn-group"><button class="btn primary" data-mission-action="new"' + (!environments().length || storageError ? ' disabled' : '') + '>Nova missão</button><button class="btn" data-mission-action="import"' + (!environments().length || storageError ? ' disabled' : '') + '>Importar JSON ↑</button><button class="btn" data-mission-action="porto-example"' + (storageError || !environments().length ? ' disabled' : '') + '>Carregar missão de exemplo</button>' + (environments().some(supportsEriadorMission)?'<button class="btn" data-mission-action="eriador-examples">Missões de Eriador</button>':'') + '<button class="btn" data-mission-action="paste">Colar JSON</button><button class="btn" data-mission-action="guide">Modelo para outro LLM</button></div>' + (undo ? '<button class="btn" data-mission-action="undo">Desfazer exclusão</button>' : '') + '</div>' + (view === 'form' ? '<div class="mission-collection-form">' + formHTML(true) + '</div>' : '') + (!environments().length ? '<p class="warning">Toda missão precisa de um cenário. <button class="subtle-link" data-tab="world">Criar cenário</button></p>' : '') + (storageError ? '<div class="inline-error" role="alert">' + esc(storageError) + '<br><button class="btn" data-mission-action="recovery">Baixar cópia de recuperação</button></div>' : '') + (view === 'form' ? '' : errorHTML()) + '<section class="mission-filters" aria-label="Filtros de missões"><div><label for="mission-search">Buscar missão</label><input id="mission-search" type="search" placeholder="Nome, descrição ou cenário" value="' + esc(search) + '"></div><div><label for="mission-filter">Cenário</label><select id="mission-filter">' + environmentOptions(filter, 'Todos os cenários') + '</select></div></section><div id="mission-cards">' + cardsHTML() + '</div><p class="field-hint">Missões, cenários e combate têm cadastros separados. Os dados são salvos neste navegador.</p>';
  }
  function objectiveFormHTML(o, index) {
    const type = OBJECTIVE_TYPES.find(t => t.id === o.type), env = environment(draft.environmentId);
    return '<fieldset class="objective-editor"><legend>Objetivo ' + String(index + 1).padStart(2, '0') + '</legend><div class="objective-toolbar"><span class="field-hint">' + esc(type.name) + '</span><div class="btn-group"><button type="button" class="btn" data-objective-move="' + esc(o.id) + '" data-direction="-1" aria-label="Mover objetivo ' + (index + 1) + ' para cima"' + (index === 0 ? ' disabled' : '') + '>↑</button><button type="button" class="btn" data-objective-move="' + esc(o.id) + '" data-direction="1" aria-label="Mover objetivo ' + (index + 1) + ' para baixo"' + (index === draft.objectives.length - 1 ? ' disabled' : '') + '>↓</button><button type="button" class="btn ghost danger" data-objective-remove="' + esc(o.id) + '"' + (draft.objectives.length === 1 ? ' disabled' : '') + '>Remover</button></div></div><div class="form-grid"><div><label for="o-type-' + index + '">Tipo *</label><select id="o-type-' + index + '" data-objective-id="' + esc(o.id) + '" data-objective-field="type">' + OBJECTIVE_TYPES.map(t => '<option value="' + t.id + '"' + (o.type === t.id ? ' selected' : '') + '>' + t.name + '</option>').join('') + '</select></div><div><p class="field-hint">O progresso é registrado em Aventuras.</p></div><div class="full"><label for="o-title-' + index + '">Título do objetivo *</label><input id="o-title-' + index + '" data-objective-id="' + esc(o.id) + '" data-objective-field="title" required maxlength="150" value="' + esc(o.title) + '" placeholder="O que precisa ser feito?"></div><div class="full"><label for="o-description-' + index + '">Descrição</label><textarea id="o-description-' + index + '" data-objective-id="' + esc(o.id) + '" data-objective-field="description" rows="2" maxlength="4000">' + esc(o.description) + '</textarea></div><div><label for="o-target-' + index + '">' + esc(type.label) + '</label><input id="o-target-' + index + '" data-objective-id="' + esc(o.id) + '" data-objective-field="target" value="' + esc(o.target) + '" maxlength="300"><p class="field-hint">' + esc(type.hint) + '</p></div><div><label for="o-place-' + index + '">Lugar no cenário</label><select id="o-place-' + index + '" data-objective-id="' + esc(o.id) + '" data-objective-field="placeId"><option value="">Sem lugar específico</option>' + (o.placeId && !env?.places.some(p => p.id === o.placeId) ? '<option selected value="' + esc(o.placeId) + '">Lugar indisponível — selecione outro</option>' : '') + (env?.places || []).map(p => '<option value="' + esc(p.id) + '"' + (p.id === o.placeId ? ' selected' : '') + '>' + esc(p.path || p.name) + '</option>').join('') + '</select></div><div class="full"><label for="o-criteria-' + index + '">Critério de conclusão</label><textarea id="o-criteria-' + index + '" data-objective-id="' + esc(o.id) + '" data-objective-field="completionCriteria" maxlength="2000" rows="2" placeholder="Como saberemos que este objetivo foi cumprido?">' + esc(o.completionCriteria) + '</textarea></div></div>' + '<label for="objective-formula-' + esc(o.id) + '">Fórmula booleana de conclusão (JSON)</label><textarea id="objective-formula-' + esc(o.id) + '" class="details-editor" data-objective-formula="'+esc(o.id)+'" rows="5" spellcheck="false">'+esc(formulaTexts['objective:'+o.id] ?? pretty(o.completion?.condition ?? false))+'</textarea><p class="field-hint">false mantém o objetivo pendente. Declare uma condição sobre ações, itens, NPCs ou outros dados para torná-lo executável.</p>' + relationsHTML(o, draft, false) + '</fieldset>';
  }
  function formHTML(embedded = false) {
    const env = environment(draft.environmentId);
    const offer=draft.offer;
    const offerForm='<div class="full"><h3>Como encontrar esta missão</h3><label for="mission-offer-type">Forma de oferta</label><select id="mission-offer-type" data-offer-field="type"><option value="notice"'+(offer?.type!=='npc'?' selected':'')+'>Anúncio no lugar</option><option value="npc"'+(offer?.type==='npc'?' selected':'')+'>Pedido de um NPC do cenário</option></select><label for="mission-offer-place">Lugar da oferta *</label><select id="mission-offer-place" data-offer-field="placeId"><option value="">Selecione</option>'+(env?.places || []).map(p=>'<option value="'+esc(p.id)+'"'+(offer?.placeId===p.id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select>'+(offer?.type==='npc'?'<label for="mission-offer-npc">Pessoa que faz o pedido *</label><select id="mission-offer-npc" data-offer-field="npcId"><option value="">Selecione</option>'+(env?.npcs || []).filter(n=>n.placeId===offer.placeId).map(n=>'<option value="'+esc(n.id)+'"'+(offer.npcId===n.id?' selected':'')+'>'+esc(n.name)+'</option>').join('')+'</select>':'')+'<label for="mission-offer-title">Título do aviso ou pedido</label><input id="mission-offer-title" data-offer-field="title" maxlength="150" value="'+esc(offer?.title || '')+'"><label for="mission-offer-description">Texto apresentado antes de aceitar</label><textarea id="mission-offer-description" data-offer-field="description" maxlength="4000">'+esc(offer?.description || '')+'</textarea><p class="field-hint">A missão só começa após o aceite. O jogador escolhe onde iniciar a aventura.</p></div>';
    const content = '<div class="page-head"><div><p class="eyebrow">Um propósito para o seu mundo.</p><h1>' + (selectedId ? 'Editar missão' : 'Nova missão') + '</h1><p>Descreva a missão e adicione os objetivos que fazem sentido para o cenário.</p></div></div><div class="mission-editor-layout"><section class="panel"><div class="panel-head"><h2>' + (selectedId ? 'Editar missão' : 'Nova missão') + '</h2><span class="pill">CENÁRIO OBRIGATÓRIO</span></div><form id="mission-form" class="form-body"><div class="form-grid"><div class="full"><label for="mission-name">Nome *</label><input id="mission-name" data-mission-field="name" value="' + esc(draft.name) + '" required maxlength="120" placeholder="Ex.: Um pedido de ajuda"></div><div class="full"><label for="mission-environment">Pertence ao cenário *</label><select id="mission-environment" required>' + environmentOptions(draft.environmentId, 'Selecione um cenário') + '</select>' + (!env ? '<p class="field-hint">Selecione um cenário existente para continuar.</p>' : '') + '<p class="field-hint">Ao mudar de cenário, os lugares dos objetivos serão limpos para você selecionar novamente.</p></div>' + offerForm + '<div class="full"><label for="mission-description">Descrição</label><textarea id="mission-description" data-mission-field="description" rows="3" maxlength="10000" placeholder="Contexto e propósito da missão.">' + esc(draft.description) + '</textarea></div></div>' + formulaEditorHTML() + '<div class="mission-objectives-heading"><h2>Objetivos <span class="pill">' + draft.objectives.length + '</span></h2><span>Ordem de apresentação livre</span></div><div id="objective-editors">' + draft.objectives.map(objectiveFormHTML).join('') + '</div><button type="button" class="btn" data-mission-action="add-objective"' + (draft.objectives.length >= 50 ? ' disabled' : '') + '>+ Adicionar objetivo</button>' + errorHTML() + '<div class="form-actions"><button class="btn primary" type="submit"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Validando…' : 'Salvar missão') + '</button><button class="btn" type="button" data-mission-action="cancel">Cancelar</button></div></form>' + npcManager.html() + '</section><aside class="panel mission-guide"><div class="schema-info"><h3>Um formato para qualquer cenário</h3><p>Combater, testar uma habilidade, encontrar um item, investigar ou ajudar alguém. Use “Outro” para uma situação diferente.</p><p>Um objetivo pode indicar um lugar específico do cenário ou acontecer em qualquer lugar dele.</p><hr><h3>Quando está concluída?</h3><p>Ofereça esta missão em um lugar do cenário. O jogador pode aceitá-la durante uma aventura. O progresso e a conclusão ficam registrados na aventura.</p><p>O critério de conclusão é uma orientação para quem conduz o jogo. Dependências e alternativas são configuradas no JSON da missão. A ordem é livre quando dependsOn está vazio. Objetivos automáticos consultam NPCs, fatos e outros objetivos no fim do turno da aventura. Configure completion, actions, items e npcs no JSON. Novos modelos usam somente fórmulas e ações executáveis. Objetivos sem completion continuam manuais.</p><hr><p class="field-hint">Alvos são descritivos. Declare items e ações collect/deliver para movimentar o inventário; NPCs com ficha podem participar do combate.</p></div></aside></div>';
    return embedded ? content.slice(content.indexOf('<div class="mission-editor-layout">')) : content;
  }
  function detailHTML() {
    const m = selected(); if (!m) { view = 'list'; return listHTML(); }
    const env = environment(m.environmentId), invalid = referenceError(m), p = missionProgress(m);
    return '<div class="page-head"><div><p class="eyebrow">' + esc(env?.name || 'Cenário indisponível') + '</p><h1>' + esc(m.name) + '</h1><p class="mission-description">' + esc(m.description || 'Sem descrição.') + '</p></div><div class="rule-chip">' + 'Modelo de missão' + '<small>Progresso em Aventuras</small></div></div><div class="world-toolbar"><div class="btn-group"><button class="btn" data-mission-action="list">← Todas as missões</button><button class="btn primary" data-mission-edit="' + esc(m.id) + '">Editar missão</button><button class="btn" data-mission-action="json">JSON da missão</button><button class="btn" data-mission-action="download">Baixar JSON</button></div><button class="btn ghost danger" data-mission-action="delete">Excluir missão</button></div>' + (invalid ? '<div class="inline-error" role="alert">' + esc(invalid) + ' Edite a missão para corrigir o vínculo.</div>' : '') + errorHTML() + '<section class="panel mission-overview">' + '<button class="btn primary" data-tab="adventures">Criar aventura ↗</button>' + '<p>Todos os objetivos contam para a conclusão. A ordem é livre, exceto pelas dependências explícitas. Para objetivos com alternativas, basta um caminho.</p></section><div class="objective-list">' + m.objectives.map((o, i) => '<article class="panel objective-card"><div class="objective-number">' + String(i + 1).padStart(2, '0') + '</div><div class="objective-body"><p class="eyebrow">' + esc(OBJECTIVE_TYPES.find(t => t.id === o.type).name) + '</p><h2>' + esc(o.title) + '</h2>' + (o.description ? '<p class="mission-description">' + esc(o.description) + '</p>' : '') + '<dl class="objective-facts"><div><dt>Lugar</dt><dd>' + esc(o.placeId ? env?.places.find(place => place.id === o.placeId)?.path || env?.places.find(place => place.id === o.placeId)?.name || 'Lugar indisponível' : 'Qualquer lugar do cenário') + '</dd></div>' + (o.target ? '<div><dt>' + esc(OBJECTIVE_TYPES.find(t => t.id === o.type).label) + '</dt><dd>' + esc(o.target) + '</dd></div>' : '') + '<div><dt>Critério de conclusão</dt><dd>' + esc(o.completionCriteria || 'Não informado. Edite para descrever como avaliar o objetivo.') + '</dd></div></dl>' + relationsHTML(o, m, false) + '</div></article>').join('') + '</div>';
  }
  function jsonHTML() {
    return '<div class="page-head"><div><p class="eyebrow">Missão como dados.</p><h1>' + (selectedId ? 'JSON da missão' : 'Importar missão') + '</h1><p>Use o formato abaixo para editar ou transportar uma missão entre cenários.</p></div></div><div class="world-toolbar"><button class="btn" data-mission-action="cancel">← Voltar</button></div><div class="rules-layout"><section class="panel"><div class="panel-head"><h2>Documento da missão</h2><button class="btn" data-mission-action="file">Carregar JSON ↑</button></div><label class="sr-only" for="mission-json">Editor JSON da missão</label><textarea id="mission-json" class="code-editor" spellcheck="false" placeholder="Cole aqui o JSON da missão gerado pelo outro LLM.">' + esc(jsonText) + '</textarea><div class="mission-json-options"><label for="mission-json-environment">Cenário de destino</label><select id="mission-json-environment">' + environmentOptions(jsonEnvironmentId, 'Usar environmentId do JSON') + '</select><p class="field-hint">Escolher um destino substitui apenas environmentId. Lugares precisam existir nesse cenário. Para novos cenários importados, escolha explicitamente o destino.</p>' + errorHTML() + (pendingImport ? '<div class="world-replace-warning"><p>Missão “' + esc(pendingImport.name) + '” · ' + esc(environment(pendingImport.environmentId)?.name) + ' · ' + pendingImport.objectives.length + ' objetivo(s).</p><button class="btn primary" data-mission-action="apply-import">' + (selectedId ? 'Salvar alterações nesta missão' : 'Adicionar como nova missão') + '</button></div>' : '') + '<div class="btn-group"><button class="btn primary" data-mission-action="validate-json"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Validando…' : 'Validar JSON') + '</button><button class="btn" data-mission-action="download-editor">Baixar JSON do editor</button><button class="btn ghost" data-mission-action="template">Carregar modelo completo</button></div></div></section><aside class="panel"><div class="schema-info"><h3>Referências entre entidades</h3><p><code>environmentId</code> é o ID do cenário, não seu nome. A missão só é salva se ele existir.</p><p><code>objectives</code> reúne de 1 a 50 objetivos. Cada um tem ID próprio, tipo, título, descrição, alvo, lugar opcional, critério de conclusão e situação.</p><h3>Tipos de objetivo</h3><ul>' + OBJECTIVE_TYPES.map(t => '<li><code>' + t.id + '</code> ' + t.name + '</li>').join('') + '</ul><p>Use <code>dependsOn: []</code> para ordem livre. <code>alternatives</code> descreve caminhos possíveis; basta concluir um e registrar seu ID em <code>completedAlternativeId</code>.</p><h3>Oferta da missão</h3><p><code>offer</code> define type (notice ou npc), placeId, npcId, title e description. Pedidos usam um NPC do cenário naquele lugar. O personagem escolhe o local inicial ao criar a aventura. <code>startPlaceId</code> é mantido para compatibilidade de modelos anteriores.</p><h3>Regras de execução por turno</h3><p><code>completion</code>: modo <code>manual</code> ou <code>automatic</code> com <code>evaluateAt: turn_end</code> e <code>condition</code>. Condições: <code>npc_defeated</code>, <code>fact_equals</code>, <code>objective_completed</code>, <code>all</code> e <code>any</code>.</p><p><code>npcs</code> define os NPCs da missão, sua descrição, condição de presença e fichas opcionais; use <code>environmentNpcId</code> para reutilizar um NPC do cenário sem duplicar; <code>facts</code> define acontecimentos narrativos verificáveis. Alternativas automáticas também precisam de <code>condition</code>. O modelo para outro LLM contém o contrato completo.</p><p>Modelos devem usar <code>pending</code> e <code>completedAlternativeId: null</code>. Progresso importado será preservado em Aventuras, para vincular a uma ficha.</p><hr><p class="warning">Importar pela listagem sempre cria uma nova missão, mesmo que o ID já exista. Editar o JSON de uma missão atualiza somente ela. Cenários e fichas são preservados.</p></div></aside></div>';
  }
  function html() { return view==='eriador-examples'?eriadorExamplesHTML():view === 'guide' ? guideHTML() : view === 'detail' ? detailHTML() : view === 'json' ? jsonHTML() : listHTML(); }
  async function serverValidate(candidate) {
    const next = validateMission(candidate, environments());
    const env = environment(next.environmentId);
    const response = await fetch('/api/mission', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission: next, environments: [{ id: env.id, npcs:env.npcs || [], places: env.places.map(p => ({ id: p.id })) }] }) });
    let result; try { result = await response.json(); } catch { throw new Error('O servidor não respondeu em JSON. Reabra o site com sua conta.'); }
    if (!response.ok) throw new Error(result.error || 'Não foi possível validar a missão.');
    return validateMission(result, environments());
  }
  function save(candidate) {
    const original = validateMission(candidate, environments());
    const next = model(original);
    const legacy = hasProgress(original) ? [...legacyProgress, archive(original)] : legacyProgress;
    const existing = missions.some(m => m.id === next.id);
    if (!existing && missions.length >= 200) throw new Error('Limite de 200 missões.');
    persist(existing ? missions.map(m => m.id === next.id ? next : m) : [...missions, next], legacy);
    selectedId = next.id; draft = null; error = ''; pendingImport = null; view = 'detail'; undo = null;
  }
  function template() {
    const e = environment(jsonEnvironmentId) || environment(getActiveEnvironmentId()) || environments()[0];
    if (!e) throw new Error('Crie um cenário antes de importar uma missão.');
    return createMissionTemplate(e, selectedId || 'missao-modelo-completo');
  }
  document.addEventListener('input', event => {
    const t = event.target;
    if (t.dataset.missionField && draft) draft[t.dataset.missionField] = t.value;
    if (t.dataset.objectiveField && draft && !['type', 'status', 'placeId'].includes(t.dataset.objectiveField)) {
      const o = draft.objectives.find(o => o.id === t.dataset.objectiveId); if (o) o[t.dataset.objectiveField] = t.value;
    }
    if (t.id === 'mission-search') { search = t.value; const cards = document.querySelector('#mission-cards'); if (cards) cards.innerHTML = cardsHTML(); }
    if (t.id === 'mission-json') {
      jsonText = t.value; pendingImport = null;
      document.querySelector('.mission-json-options .world-replace-warning')?.remove();
    }
  });
  document.addEventListener('change', async event => {
    const t = event.target;
    if (busy) return;
    try {
      if (t.id === 'mission-model-environment') { guideEnvironmentId = t.value; render(); return; }
      if (t.id === 'mission-filter') { filter = t.value; render(); return; }
      if (t.id === 'mission-environment' && draft) {
        if (draft.environmentId !== t.value) { if ((draft.npcs || []).some(n=>n.environmentNpcId)) throw new Error('Remova as referências de NPCs antes de mudar o cenário da missão.'); draft.environmentId = t.value; if (draft.startPlaceId !== undefined) draft.startPlaceId = null; delete draft.offer; draft.objectives.forEach(o => { o.placeId = null; (o.alternatives || []).forEach(a => { a.placeId = null; }); }); (draft.npcs || []).filter(n=>!n.environmentNpcId).forEach(n => { n.placeId = null; }); error = ''; render(); toast('Cenário alterado. Selecione os lugares dos objetivos, se necessário.'); }
        return;
      }
      if (t.id === 'mission-json-environment') { jsonEnvironmentId = t.value; pendingImport = null; render(); return; }
      if (t.dataset.objectiveField && draft) {
        const o = draft.objectives.find(o => o.id === t.dataset.objectiveId);
        if (o) { o[t.dataset.objectiveField] = t.dataset.objectiveField === 'placeId' ? t.value || null : t.value; if (t.dataset.objectiveField === 'type') render(); }
        return;
      }

    } catch (e) { error = e.message; toast(error, true); render(); }
    finally { if (t.dataset.objectiveStatus || t.dataset.objectiveAlternative) { busy = false; render(); } }
  });
  document.addEventListener('input',e=>{if(!draft)return;if(e.target.dataset.formulaField)formulaTexts[e.target.dataset.formulaField]=e.target.value;if(e.target.dataset.objectiveFormula)formulaTexts['objective:'+e.target.dataset.objectiveFormula]=e.target.value;});
  document.addEventListener('change',e=>{if(draft && Object.hasOwn(e.target.dataset,'formulaMode')){if(e.target.checked)draft.execution='formula';else {delete draft.execution;delete draft.completion;if(!(draft.actions || []).length){delete draft.actions;delete draft.items;}for(const o of draft.objectives)if(o.completion?.condition===false)delete o.completion;}}});
  document.addEventListener('input',e=>{const field=e.target.dataset.offerField;if(!draft || !field)return;draft.offer ||= {type:'notice',placeId:'',npcId:null,title:'',description:''};draft.offer[field]=e.target.value;});
  document.addEventListener('change',e=>{const field=e.target.dataset.offerField;if(!draft || !field || busy)return;draft.offer ||= {type:'notice',placeId:'',npcId:null,title:'',description:''};draft.offer[field]=e.target.value;if(field==='type' || field==='placeId'){draft.offer.npcId=null;render();}});
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'mission-form') return;
    event.preventDefault(); if (busy || !draft) return;
    busy = true; error = ''; render();
    try { for(const field of ['actions','items','completion'])if(formulaTexts[field]!==undefined && (draft.execution==='formula' || draft[field]!==undefined))draft[field]=JSON.parse(formulaTexts[field]); const fields=document.querySelectorAll?.('[data-formula-field]');if(fields)for(const field of fields){if(draft.execution==='formula' || draft[field.dataset.formulaField]!==undefined)draft[field.dataset.formulaField]=JSON.parse(field.value);}
      if(draft.execution==='formula'){for(const o of draft.objectives)if(formulaTexts['objective:'+o.id]!==undefined)o.completion={mode:'automatic',evaluateAt:'turn_end',condition:JSON.parse(formulaTexts['objective:'+o.id])};const formulas=document.querySelectorAll?.('[data-objective-formula]');if(formulas)for(const field of formulas){const o=draft.objectives.find(o=>o.id===field.dataset.objectiveFormula);o.completion={mode:'automatic',evaluateAt:'turn_end',condition:JSON.parse(field.value)};}}
      save(await serverValidate(draft)); toast('Missão salva no cenário.'); }
    catch (e) { error = e.message; toast(error, true); }
    finally { busy = false; render(); }
  });
  document.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || b.disabled || busy) return;
    const action = b.dataset.missionAction;
    if (!action && !b.dataset.missionOpen && !b.dataset.missionEdit && !b.dataset.objectiveRemove && !b.dataset.objectiveMove && !b.dataset.missionDelete) return;
    try {
      error = '';
      if (b.dataset.missionOpen) { selectedId = b.dataset.missionOpen; draft = null; view = 'detail'; }
      if (b.dataset.missionEdit) { formulaTexts={};npcManager.reset(); formReturn = view === 'detail' ? 'detail' : 'list'; selectedId = b.dataset.missionEdit; draft = structuredClone(selected()); view = 'form'; }
      if (b.dataset.objectiveRemove && draft && draft.objectives.length > 1) { if (draft.objectives.some(o => (o.dependsOn || []).includes(b.dataset.objectiveRemove))) throw new Error('Remova primeiro as dependências deste objetivo no JSON da missão.'); draft.objectives = draft.objectives.filter(o => o.id !== b.dataset.objectiveRemove); }
      if (b.dataset.objectiveMove && draft) { const from = draft.objectives.findIndex(o => o.id === b.dataset.objectiveMove), to = from + Number(b.dataset.direction); if (from >= 0 && to >= 0 && to < draft.objectives.length) [draft.objectives[from], draft.objectives[to]] = [draft.objectives[to], draft.objectives[from]]; }
      if (action === 'new') { formulaTexts={};npcManager.reset(); formReturn = 'list'; draft = newMission(); selectedId = null; view = 'form'; }
      if (action === 'list') { view = 'list'; draft = null; selectedId = null; }
      if (action === 'cancel') { view = view === 'form' ? formReturn : selectedId ? 'detail' : 'list'; draft = null; pendingImport = null; }
      if (action === 'add-objective' && draft && draft.objectives.length < 50) draft.objectives.push(newObjective());
      if ((action === 'delete' && selected()) || b.dataset.missionDelete) { const previous = structuredClone(b.dataset.missionDelete ? missions.find(m=>m.id===b.dataset.missionDelete) : selected()); if(!previous)throw new Error('Missão não encontrada.'); persist(missions.filter(m => m.id !== previous.id)); undo = previous; selectedId = null; view = 'list'; toast('Missão excluída do cadastro. O progresso nas aventuras foi preservado. Você pode desfazer.'); }
      if (action === 'undo' && undo) { const next = validateMission(undo, environments()); if (missions.some(m => m.id === next.id)) throw new Error('Já existe uma missão com esse ID.'); persist([...missions, next]); undo = null; toast('Missão recuperada.'); }
      if (action === 'json') { jsonText = pretty(selected()); jsonEnvironmentId = ''; pendingImport = null; view = 'json'; }
      if (action === 'import' || action === 'paste') { selectedId = null; jsonEnvironmentId = ''; pendingImport = null; jsonText = ''; view = 'json'; if (action === 'import') document.querySelector('#mission-file').click(); }
      if (action === 'file') document.querySelector('#mission-file').click();
      if (action === 'guide') { guideEnvironmentId = environment(filter)?.id || getActiveEnvironmentId() || environments()[0]?.id || ''; selectedId = null; view = 'guide'; }
      if (action === 'download-model') download(createMissionTemplate(guideEnvironment()), 'missao-modelo-completo.json');
      if (action === 'download-prompt') download(missionLLMPrompt(guideEnvironment()), 'instrucoes-missao-llm.txt');
      if (action === 'copy-model') await copyText(pretty(createMissionTemplate(guideEnvironment())), '#mission-model');
      if (action === 'copy-prompt') await copyText(missionLLMPrompt(guideEnvironment()), '#mission-llm-prompt');
      if(action==='eriador-examples'){
        const active=environment(filter) || environment(getActiveEnvironmentId());const env=supportsEriadorMission(active)?active:environments().find(supportsEriadorMission);
        if(!env)throw new Error('Importe o cenário Eriador e Além completo para carregar estes exemplos.');
        exampleEnvironmentId=env.id;selectedId=null;draft=null;view='eriador-examples';
      }
      if(action==='eriador-model'){
        const env=environment(exampleEnvironmentId);const candidate=createEriadorMissions(env).find(m=>m.id===b.dataset.exampleId);
        if(!candidate)throw new Error('Modelo de missão não encontrado.');
        selectedId=null;draft=null;jsonEnvironmentId=env.id;jsonText=pretty(candidate);pendingImport=null;view='json';busy=true;render();pendingImport=await serverValidate(candidate);toast('Modelo válido. Confira e adicione como nova missão.');
      }
      if (action === 'porto-example') {
        const active = environment(filter) || environment(getActiveEnvironmentId());
        const env = active || environments()[0];
        if (!env) throw new Error('Cadastre um cenário antes de carregar a missão de exemplo.');
        const candidate = createMissionTemplate(env);
        selectedId = null; draft = null; jsonEnvironmentId = env.id; jsonText = pretty(candidate); pendingImport = null; view = 'json';
        busy = true; render(); pendingImport = await serverValidate(candidate);
        toast('Exemplo com '+candidate.objectives.length+' objetivos carregado. Confira e adicione como nova missão.');
      }
      if (action === 'template') { jsonText = pretty(template()); pendingImport = null; toast('Modelo carregado no editor.'); }
      if (action === 'download') download(selected(), 'missao.json');
      if (action === 'download-editor') { JSON.parse(jsonText); download(jsonText, 'missao.json'); }
      if (action === 'recovery' && preservedRaw) download(preservedRaw, 'missoes-recuperacao.json');
      if (action === 'validate-json') {
        let candidate = JSON.parse(jsonText);
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('A missão deve ser um objeto JSON.');
        if (jsonEnvironmentId) candidate = { ...candidate, environmentId: jsonEnvironmentId };
        if (selectedId && candidate.id !== selectedId) throw new Error('Preserve o ID da missão que está sendo editada. Para adicionar outra, use Importar JSON na listagem.');
        busy = true; render(); pendingImport = await serverValidate(candidate); toast('JSON válido. Confira o destino antes de salvar.');
      }
      if (action === 'apply-import' && pendingImport) { const candidate = selectedId ? pendingImport : { ...pendingImport, id: 'missao-' + crypto.randomUUID() }; save(candidate); toast('Missão aplicada ao cenário.'); }
    } catch (e) { error = e instanceof SyntaxError ? 'JSON inválido: ' + e.message : e.message; toast(error, true); }
    finally { busy = false; render(); if (action === 'new' || b.dataset.missionEdit) document.querySelector('#mission-name')?.focus(); }
  });
  document.querySelector('#mission-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy) return;
    if (file.size > 120000) { toast('Use uma missão JSON de até 120 KB.', true); return; }
    try { jsonText = await file.text(); pendingImport = null; view = 'json'; error = ''; render(); toast('JSON carregado. Selecione o destino e valide para usar.'); }
    catch { toast('Não foi possível ler o arquivo.', true); }
  });
  return {
    init, html,
    getMissions: () => structuredClone(missions),
    getLegacyProgress: () => structuredClone(legacyProgress),
    showList() { view = 'list'; selectedId = null; draft = null; pendingImport = null; error = ''; },
    assertEnvironmentDeletion(id){
      if(storageError)throw new Error('Recupere a coleção de missões antes de excluir um cenário.');
      const linked=missions.filter(m=>m.environmentId===id);
      if(linked.length)throw new Error('Este cenário possui '+linked.length+' missão(ões) cadastrada(s): '+linked.slice(0,3).map(m=>m.name).join(', ')+'. Exclua ou transfira essas missões antes de excluir o cenário.');
    },
    assertEnvironmentChange(id, next) {
      if (storageError) throw new Error('Recupere a coleção de missões antes de alterar os lugares; os vínculos existentes não puderam ser verificados.');
      assertMissionLocations(missions, id, next);
    }
  };
}
