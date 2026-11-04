import { createNPCManager } from '/npc-ui.mjs';
import { validateWorld, ancestors, descendants, savePlace, removePlace, createScenarioTemplate, scenarioLLMPrompt, regionalEncounterTable, withEriadorEncounters, routeMapHTML, createGatewayScenarioTemplate } from '/world.mjs';
const LEGACY_STORAGE = '3det-adaptavel-world-v1';
const STORAGE = '3det-adaptavel-worlds-v2';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const pretty = value => JSON.stringify(value, null, 2);
const format = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const normalizeSearch = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function createWorldUI({ render, toast, beforeWorldChange = () => {}, beforeWorldDelete = () => {} }) {
  let encounterDraft=null,routeDraft=null;
  let mapParentId = null, placeView = 'browse';
  let world = null, selectedId = null, draft = null, editingId = null;
  let deletedScenario=null;
  let worlds = [], activeWorldId = null, worldDraft = null, editingWorldId = null, importMode = 'replace';
  let view = 'list', jsonText = '', error = '', search = '', applying = false, pendingWorld = null;
  const selected = () => world?.places.find(p => p.id === selectedId);
  const npcManager=createNPCManager({scope:'world',title:'NPCs do cenário',getEntries:()=>world?.npcs || [],getPlaces:()=>world?.places || [],getDefaultPlaceId:()=>selectedId,onChange(entries){
    const next=validateWorld({...world,npcs:entries});beforeWorldChange(activeWorldId,next);
    const nextWorlds=worlds.map(e=>e.id===activeWorldId?{...e,world:next,selectedId}:e);
    try{localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:1,worlds:nextWorlds,activeWorldId}));}catch{throw new Error('Não foi possível salvar os NPCs neste navegador.');}
    worlds=nextWorlds;world=next;jsonText=pretty(world);undoWorld=null;
  },render,toast});

  function persist() {
    const entry = worlds.find(entry => entry.id === activeWorldId);
    if (entry && world) { entry.world = world; entry.selectedId = selectedId; }
    try { localStorage.setItem(STORAGE, JSON.stringify({ schemaVersion: 1, worlds, activeWorldId })); }
    catch { toast('Não foi possível salvar os cenários no navegador. Baixe o JSON para preservar seu trabalho.', true); }
  }
  function saveCollection(next,activeId){
    try {localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:1,worlds:next,activeWorldId:activeId}));}
    catch {throw new Error('Não foi possível salvar a exclusão. Libere espaço neste navegador e tente novamente.');}
    worlds=next;
    if(activeId)activate(activeId);
    else {world=null;activeWorldId=null;selectedId=null;draft=null;editingId=null;pendingWorld=null;undoWorld=null;mapParentId=null;jsonText='';npcManager.reset();}
    worldDraft=null;editingWorldId=null;error='';view='list';
  }
  function activate(id) {
    const entry = worlds.find(entry => entry.id === id);
    if (!entry) throw new Error('Cenário não encontrado.');
    npcManager.reset(); activeWorldId = id; world = entry.world; selectedId = entry.selectedId; mapParentId = null;
    if (!selected()) selectedId = world.places[0]?.id ?? null;
    jsonText = pretty(world); draft = null; worldDraft = null; editingId = null;
    pendingWorld = null; undoWorld = null; error = ''; search = ''; importMode = 'replace';
  }
  function addWorld(next) {
    const entry = { id: crypto.randomUUID(), world: validateWorld(next), selectedId: next.places[0]?.id ?? null };
    worlds.push(entry); activate(entry.id); persist();
  }
  function commit(next) {
    beforeWorldChange(activeWorldId, next);
    if (mapParentId && !next.places.some(p => p.id === mapParentId)) mapParentId = null;
    world = next; jsonText = pretty(world); pendingWorld = null; draft = null; editingId = null; error = '';
    if (!selected()) selectedId = world.places[0]?.id ?? null;
    persist();
  }
  async function init() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved) {
        if (saved.schemaVersion !== 1 || !Array.isArray(saved.worlds)) throw new Error('Lista inválida.');
        const ids = new Set();
        worlds = saved.worlds.map(entry => {
          if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw new Error('Identificador inválido.');
          ids.add(entry.id); return { id: entry.id, world: validateWorld(entry.world), selectedId: entry.selectedId };
        });
        if(!worlds.length){world=null;activeWorldId=null;view='list';return;}
        activate(worlds.some(entry => entry.id === saved.activeWorldId) ? saved.activeWorldId : worlds[0].id);
        return;
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE));
      if (legacy?.world) {
        addWorld(validateWorld(legacy.world));
        selectedId = legacy.selectedId; if (!selected()) selectedId = world.places[0]?.id ?? null;
        persist(); return;
      }
    } catch { toast('Não foi possível restaurar a lista de cenários. O exemplo será aberto; os dados anteriores não foram apagados.', true); worlds = []; }
    try {
      const response = await fetch('/worlds/example.json');
      if (!response.ok) throw new Error('Não foi possível carregar o cenário de exemplo.');
      const next = validateWorld(await response.json());
      // Do not overwrite unreadable saved data automatically.
      let hasSaved = false; try { hasSaved = Boolean(localStorage.getItem(STORAGE)); } catch {}
      if (hasSaved) {
        worlds = [{ id: crypto.randomUUID(), world: next, selectedId: null }]; activate(worlds[0].id);
      } else addWorld(next);
    } catch (e) { error = e.message; }
  }
  function collectionHTML() {
    const form = worldDraft ? '<section class="panel environment-form"><div class="panel-head"><h2>' + (editingWorldId ? 'Editar cenário' : 'Novo cenário') + '</h2></div><form id="environment-form" class="form-body"><label for="environment-name">Nome do cenário *</label><input id="environment-name" data-environment-field="name" required maxlength="100" value="' + esc(worldDraft.name) + '" placeholder="Ex.: Reino de Eldoria ou Estação Aurora"><label for="environment-description">Descrição</label><textarea id="environment-description" data-environment-field="description" maxlength="10000" rows="3">' + esc(worldDraft.description) + '</textarea>' + errorHTML() + '<div class="form-actions"><button class="btn primary" type="submit">Salvar cenário</button><button class="btn" type="button" data-world-action="cancel-environment">Cancelar</button></div></form></section>' : '';
    return '<div class="page-head"><div><p class="eyebrow">Seus cenários.</p><h1>Cenários</h1><p>Cada cenário tem sua própria árvore de lugares. Crie e desenvolva vários cenários independentes.</p></div><div class="rule-chip">' + worlds.length + ' cenário(s)<small>Salvos neste navegador</small></div></div><div class="world-toolbar"><div class="btn-group"><button class="btn primary" data-world-action="new-environment">Novo cenário</button><button class="btn" data-world-action="new-json">Importar novo cenário</button><button class="btn" data-world-action="model">Modelo de importação / LLM</button></div></div>' + form + (worldDraft?'':errorHTML()) + (deletedScenario?'<button class="btn" data-world-action="undo-scenario">Desfazer exclusão de cenário</button>':'') + (!worlds.length?'<section class="panel form-body"><h2>Nenhum cenário cadastrado</h2><p>Crie um cenário ou importe um JSON para começar.</p></section>':'') + '<div class="environment-grid">' + worlds.map(entry => '<article class="panel environment-card"><p class="eyebrow">' + entry.world.places.length + ' lugar(es)</p><h2>' + esc(entry.world.name) + '</h2><p class="environment-description">' + esc(entry.world.description || 'Sem descrição.') + '</p><div class="btn-group"><button class="btn primary" data-environment-open="' + esc(entry.id) + '">Abrir lugares</button><button class="btn" data-environment-edit="' + esc(entry.id) + '">Editar cenário</button><button class="btn ghost danger" data-environment-delete="' + esc(entry.id) + '" aria-label="Excluir cenário ' + esc(entry.world.name) + '">Excluir cenário</button></div></article>').join('') + '</div><p class="field-hint">Os cenários ficam salvos neste navegador. Dentro de cada cenário, use Baixar JSON para guardar uma cópia ou transferi-lo.</p>';
  }
  function treeHTML() {
    const matches = new Set();
    if (search.trim()) for (const p of world.places) if (normalizeSearch(p.name + ' ' + p.type + ' ' + p.description).includes(normalizeSearch(search.trim()))) for (const node of ancestors(world, p.id)) matches.add(node.id);
    const branch = parentId => {
      const children = world.places.filter(p => p.parentId === parentId && (!search.trim() || matches.has(p.id)));
      if (!children.length) return '';
      return '<ul class="place-tree-list">' + children.map(p => '<li><button type="button" class="place-node' + (p.id === selectedId ? ' selected' : '') + '" data-world-select="' + esc(p.id) + '"' + (p.id === selectedId ? ' aria-current="location"' : '') + '><span class="place-marker" aria-hidden="true">◇</span><span><b>' + esc(p.name) + '</b><small>' + esc(p.type) + '</small></span></button>' + branch(p.id) + '</li>').join('') + '</ul>';
    };
    return branch(null) || '<p class="world-empty">' + (world.places.length ? 'Nenhum lugar corresponde à busca.' : 'O mundo ainda está vazio. Crie o primeiro lugar.') + '</p>';
  }
  function mapHTML() {
    const parent = world.places.find(p => p.id === mapParentId);
    const children = world.places.filter(p => p.parentId === mapParentId);
    const placed = children.filter(p => p.x !== null && p.y !== null);
    const unplaced = children.filter(p => p.x === null || p.y === null);
    const enter = p => '<button class="btn" data-world-map="' + esc(p.id) + '">' + esc(p.name) + ' <small>' + (p.x === null ? 'sem posição' : 'X ' + p.x + ' · Y ' + p.y) + '</small> ↗</button>';
    return '<section class="panel pixel-map-panel"><div class="panel-head"><div><h2>Mapa de ' + esc(parent?.name || world.name) + '</h2><p>' + children.length + ' lugar(es) neste nível. Clique em um quadrado para entrar.</p></div>' + (parent ? '<button class="btn" data-world-map="' + esc(parent.parentId || '') + '">↑ Subir um nível</button>' : '<span class="pill">NÍVEL PRINCIPAL</span>') + '</div><div class="place-breadcrumb" aria-label="Localização no mapa"><button data-world-map="">' + esc(world.name) + '</button>' + (parent ? ancestors(world,parent.id).map(p => '<span aria-hidden="true">/</span><button data-world-map="' + esc(p.id) + '"' + (p.id === mapParentId ? ' aria-current="location"' : '') + '>' + esc(p.name) + '</button>').join('') : '') + '</div><p class="map-location">' + (parent ? 'Você está em: ' + ancestors(world,parent.id).map(p => esc(p.name)).join(' › ') + '. Este lugar também pertence a todos os níveis acima.' : 'Visão geral dos lugares principais do cenário.') + '</p><div class="pixel-map" role="group" aria-label="Lugares internos de ' + esc(parent?.name || world.name) + '"><span class="map-origin">0, 0</span><span class="map-corner">100, 100</span>' + routeMapHTML(world,mapParentId) + placed.map(p => '<button class="map-cell" style="left:' + p.x + '%;top:' + p.y + '%" data-world-map="' + esc(p.id) + '" aria-label="Entrar em ' + esc(p.name) + ', X ' + p.x + ', Y ' + p.y + '" title="' + esc(p.name) + ' · X ' + p.x + ', Y ' + p.y + '"><span class="map-cell-label">' + esc(p.name) + '</span></button>').join('') + (!placed.length ? '<p class="map-empty">' + (children.length ? 'Os lugares deste nível ainda não têm coordenadas.' : 'Nenhum lugar interno cadastrado.') + '</p>' : '') + '</div><div class="form-body map-legend"><p class="field-hint">X cresce para a direita e Y para baixo, de 0 a 100 dentro do superior. O quadrado marca a posição, sem representar o tamanho do lugar.</p>' + (placed.length ? '<h3>Lugares no mapa</h3><div class="map-place-list">' + placed.map(enter).join('') + '</div>' : '') + (unplaced.length ? '<h3>Sem posição definida</h3><div class="map-place-list">' + unplaced.map(enter).join('') + '</div>' : '') + '<div class="form-actions"><button class="btn primary" data-world-action="map-new">' + (parent ? 'Criar lugar neste espaço' : 'Criar lugar principal') + '</button>' + (parent ? '<button class="btn" data-world-action="edit">Editar lugar atual</button>' : '') + '</div></div></section>';
  }
  function placeDetailsHTML() {
    const p = selected();
    if (!p && view === 'map') return '<div class="place-body"><h2>' + esc(world.name) + '</h2><p>' + esc(world.description) + '</p><p class="field-hint">Entre em um lugar pelo mapa ou pela lista para navegar e consultar seus detalhes.</p></div>';
    if (!p) return '<div class="world-empty"><h2>Comece por um lugar.</h2><p>Crie um planeta, país, cidade ou qualquer outro espaço do seu cenário.</p><button class="btn primary" data-world-action="new-root">Criar primeiro lugar</button></div>';
    const children = world.places.filter(c => c.parentId === p.id);
    return '<div class="place-breadcrumb" aria-label="Caminho do lugar">' + ancestors(world, p.id).map((a, i) => (i ? '<span aria-hidden="true">/</span>' : '') + '<button data-world-select="' + esc(a.id) + '"' + (a.id === p.id ? ' aria-current="location"' : '') + '>' + esc(a.name) + '</button>').join('') + '</div><div class="panel-head"><div><p class="eyebrow">' + esc(p.type) + '</p><h2>' + esc(p.name) + '</h2><p>ID: ' + esc(p.id) + '</p></div><button class="btn" data-world-action="edit">Editar lugar</button></div><div class="place-body"><p class="place-description">' + esc(p.description || 'Nenhuma descrição informada.') + '</p><p class="field-hint">Posição no superior: ' + (p.x === null ? 'não definida' : 'X ' + p.x + ' · Y ' + p.y) + '</p><div class="place-npcs"><h3>NPCs neste lugar</h3>' + (world.npcs || []).filter(n=>n.placeId===p.id).map(n=>'<p><strong>' + esc(n.name) + '</strong> · ' + esc(n.description) + '</p>').join('') + '<button class="btn" data-world-action="npcs">Gerenciar NPCs do cenário</button></div><h3>Detalhes do lugar</h3>' + (Object.keys(p.details).length ? '<dl class="place-facts">' + Object.entries(p.details).map(([key, value]) => '<div><dt>' + esc(key) + '</dt><dd>' + esc(format(value)) + '</dd></div>').join('') + '</dl>' : '<p class="field-hint">Sem detalhes adicionais.</p>') + '<div class="place-children"><h3>Lugares internos <span class="pill">' + children.length + '</span></h3>' + (children.length ? children.map(c => '<button class="place-child" data-world-select="' + esc(c.id) + '"><span><b>' + esc(c.name) + '</b><small>' + esc(c.type) + '</small></span><span aria-hidden="true">↗</span></button>').join('') : '<p class="field-hint">Nenhum lugar dentro deste espaço.</p>') + '</div><div class="form-actions"><button class="btn primary" data-world-action="new-child">Criar lugar interno</button><button class="btn ghost danger" data-world-action="delete"' + (children.length ? ' disabled' : '') + '>Excluir lugar</button></div><p class="field-hint">' + (children.length ? 'Para excluir este lugar, mova ou exclua primeiro os lugares internos.' : 'A exclusão remove somente este lugar. Você pode recuperá-lo até sair desta aba usando Desfazer.') + '</p></div>';
  }
  function formHTML() {
    const excluded = editingId ? new Set([editingId, ...descendants(world, editingId)]) : new Set();
    return '<div class="panel-head"><h2>' + (editingId ? 'Editar lugar' : 'Novo lugar') + '</h2><span class="pill">SOMENTE ESPAÇOS</span></div><form id="place-form" class="form-body"><div class="form-grid"><div class="full"><label for="place-name">Nome *</label><input id="place-name" data-world-field="name" value="' + esc(draft.name) + '" required maxlength="100" placeholder="Ex.: Porto Aurora"></div><div><label for="place-id">Identificador *</label><input id="place-id" data-world-field="id" value="' + esc(draft.id) + '"' + (editingId ? ' readonly' : '') + ' required maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"><p class="field-hint">Identificador único e estável deste lugar.</p></div><div><label for="place-type">Tipo de lugar *</label><input id="place-type" data-world-field="type" list="place-types" value="' + esc(draft.type) + '" required maxlength="60" placeholder="Cidade, sala, planeta…"><datalist id="place-types"><option value="Planeta"><option value="País"><option value="Cidade"><option value="Estabelecimento"><option value="Sala"><option value="Nave"><option value="Compartimento"></datalist></div><div class="full"><label for="place-parent">Pertence a</label><select id="place-parent" data-world-field="parentId"><option value=""' + (draft.parentId === null ? ' selected' : '') + '>Nenhum lugar — nível principal</option>' + world.places.filter(p => !excluded.has(p.id)).map(p => '<option value="' + esc(p.id) + '"' + (p.id === draft.parentId ? ' selected' : '') + '>' + esc(ancestors(world, p.id).map(a => a.name).join(' / ')) + '</option>').join('') + '</select></div><div><label for="place-x">Posição X no superior</label><input id="place-x" data-world-field="x" type="number" min="0" max="100" step="any" value="' + esc(draft.x) + '" placeholder="0 a 100"></div><div><label for="place-y">Posição Y no superior</label><input id="place-y" data-world-field="y" type="number" min="0" max="100" step="any" value="' + esc(draft.y) + '" placeholder="0 a 100"></div><div class="full"><p class="field-hint">Coordenadas relativas ao lugar que o contém; no nível principal, relativas ao cenário. Origem no canto superior esquerdo. Preencha ambas ou deixe ambas vazias. Ao mudar o superior, a posição é limpa para ser redefinida.</p></div><div class="full"><label for="place-description">Descrição</label><textarea id="place-description" data-world-field="description" rows="4" maxlength="10000">' + esc(draft.description) + '</textarea></div><div class="full"><label for="place-details">Detalhes descritivos (objeto JSON)</label><textarea id="place-details" data-world-field="detailsText" class="details-editor" spellcheck="false" rows="5">' + esc(draft.detailsText) + '</textarea><p class="field-hint">Ex.: clima, arquitetura, população ou dimensões. Objetos e recompensas ficam fora do cenário.</p></div></div>' + errorHTML() + '<div class="form-actions"><button class="btn primary" type="submit">Salvar lugar</button><button class="btn" type="button" data-world-action="cancel">Cancelar</button></div></form>';
  }
  function errorHTML() { return error ? '<div class="inline-error" role="alert">' + esc(error) + '</div>' : ''; }
  function downloadModel(value,filename){
    const url=URL.createObjectURL(new Blob([value],{type:filename.endsWith('.json')?'application/json':'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function modelHTML(){
    return '<div class="page-head"><div><p class="eyebrow">Um formato para seus cenários</p><h1>Modelo de importação de cenário</h1><p>Copie o JSON para editar ou use as instruções em outro LLM. Depois importe o resultado como um novo cenário.</p></div></div><div class="world-toolbar"><button class="btn" data-world-action="list">← Todos os cenários</button><button class="btn primary" data-world-action="model-editor">Abrir modelo no editor de importação</button></div>'+errorHTML()+'<div class="rules-layout"><section class="panel"><div class="panel-head"><h2>Modelo JSON completo</h2><button class="btn" data-world-action="download-model">Baixar modelo .json</button></div><div class="form-body"><p>Eriador e Além: Terra Média, Condado, Valfenda, Rohan e Mordor, com coordenadas, detalhes e cinco NPCs. As fichas foram adaptadas para oito pontos de 3D&T; a presença do Nazgûl depende da situação de Frodo. Inclui quatro modelos de encontros, com herança regional e bloqueio em refúgios seguros.</p><textarea id="scenario-model" class="code-editor" readonly spellcheck="false" aria-label="Modelo JSON de cenário">'+esc(pretty(createGatewayScenarioTemplate()))+'</textarea><button class="btn" data-world-action="copy-model">Copiar JSON</button></div></section><section class="panel"><div class="panel-head"><h2>Instruções para outro LLM</h2><button class="btn" data-world-action="download-prompt">Baixar instruções .txt</button></div><div class="form-body"><p>Copie o contrato completo e acrescente sua ideia ao final. O LLM só ajuda a criar o conteúdo; o jogo funciona sem ele.</p><textarea id="scenario-prompt" class="code-editor" readonly spellcheck="false" aria-label="Instruções para gerar cenário">'+esc(scenarioLLMPrompt(createGatewayScenarioTemplate()))+'</textarea><button class="btn" data-world-action="copy-prompt">Copiar instruções completas</button><p class="field-hint">Importação: carregue ou cole o JSON, use Validar e aplicar e confirme Adicionar cenário. O modelo não é salvo automaticamente.</p></div></section></div>';
  }
  function jsonHTML() {
    return '<div class="rules-layout"><section class="panel"><div class="panel-head"><h2>' + (importMode === 'new' ? 'Importar novo cenário' : 'JSON do cenário') + '</h2><button class="btn" data-world-action="import">Carregar JSON ↑</button></div><label class="sr-only" for="world-json">Editor JSON do cenário</label><textarea id="world-json" class="code-editor" spellcheck="false">' + esc(jsonText) + '</textarea><div class="world-json-errors">' + errorHTML() + '</div>' + (pendingWorld ? '<div class="world-replace-warning" role="status"><p>' + (importMode === 'new' ? 'Será adicionado um novo cenário: “' + esc(pendingWorld.name) + '”, com ' + pendingWorld.places.length + ' lugar(es). Os outros cenários serão preservados.' : 'O JSON substituirá somente o cenário “' + esc(world.name) + '” por “' + esc(pendingWorld.name) + '”, com ' + pendingWorld.places.length + ' lugar(es).') + '</p><div class="btn-group"><button class="btn primary" data-world-action="replace">' + (importMode === 'new' ? 'Adicionar cenário' : 'Confirmar substituição') + '</button><button class="btn" data-world-action="cancel-replace">Cancelar</button></div></div>' : '') + '<div class="editor-actions"><button class="btn primary" data-world-action="apply"' + (applying ? ' disabled' : '') + '>' + (applying ? 'Validando…' : 'Validar e aplicar') + '</button><div class="btn-group"><button class="btn" data-world-action="download">Baixar JSON</button><button class="btn ghost" data-world-action="example">Carregar exemplo no editor</button><button class="btn" data-world-action="model">Modelo completo / LLM</button></div></div></section><aside class="panel"><div class="schema-info"><h3>Lugares e NPCs em JSON</h3><p>Independente das regras de combate. Países, planetas, cidades e salas usam o mesmo formato. npcs contém os habitantes, com id, name, description, placeId, combatant e presence opcionais.</p><ul><li><code>schemaVersion: 1</code> contrato deste módulo.</li><li><code>name</code> e <code>description</code> identificam o mundo.</li><li><code>places</code> contém os lugares.</li><li><code>routes</code> contém ligações entre lugares do mesmo nível, com distância em unidades, sem duração fixa.</li><li><code>npcs</code> contém até 100 NPCs, cada um vinculado a um lugar existente. Descrição, ficha de combate e presença são opcionais.</li><li><code>id</code> identifica cada lugar de forma única.</li><li><code>parentId</code> aponta para o lugar que o contém; <code>null</code> indica o nível principal.</li><li><code>x</code> e <code>y</code>: posição relativa ao superior, de 0 a 100; ambos números ou ambos <code>null</code>. Origem no canto superior esquerdo.</li><li><code>type</code> é livre, sem sequência obrigatória.</li><li><code>details</code> guarda características descritivas em um objeto JSON.</li></ul><hr><h3>Lugares e habitantes</h3><p>Esta aba descreve espaços e os NPCs vinculados a eles. Baús, objetos, inventários e recompensas não fazem parte deste JSON. Use os detalhes para descrever características físicas e culturais do lugar.</p><p>Até 500 lugares, 64 níveis e 240 KB. IDs duplicados, pais inexistentes e ciclos são rejeitados.</p><p class="warning">A importação como novo cenário preserva os existentes. Ao editar o JSON de um cenário, apenas ele será substituído. As fichas, regras e rodadas de combate são preservadas. Baixar JSON exporta o texto atual do editor.</p></div></aside></div>';
  }
  let undoWorld = null;
  function encounterConfig(source=world) {
    return {encounters:source.encounters || [],placeTables:Object.fromEntries(source.places.filter(p=>p.encounterTable).map(p=>[p.id,p.encounterTable]))};
  }
  function encountersHTML() {
    return '<section class="panel"><div class="panel-head"><div><h2>Encontros de região</h2><p>Modelos reutilizáveis, sorteados ao chegar a um lugar.</p></div><button class="btn" data-world-action="edit-encounters">Editar configuração</button></div><div class="form-body"><p class="field-hint">Alterações serão usadas em novas aventuras. Aventuras existentes preservam a cópia do cenário em que começaram.</p>'+errorHTML()+'<div class="btn-group"><button class="btn" data-world-action="encounter-examples">Preparar exemplos de Eriador</button></div>'+(encounterDraft!==null?'<form id="encounter-config-form"><label for="encounter-config">Modelos e distribuição por lugar (JSON)</label><textarea id="encounter-config" rows="24" spellcheck="false" class="code-editor">'+esc(encounterDraft)+'</textarea><p class="field-hint">encounters contém os modelos; placeTables associa IDs de lugares às tabelas. inherit herda, extend complementa, replace substitui e none bloqueia. chance é percentual; weight é frequência relativa; cooldownTurns é o intervalo mínimo entre ocorrências. Você pode ajustar a chance para 100 durante um teste.</p><div class="form-actions"><button class="btn primary" type="submit">Validar e salvar encontros</button><button class="btn" type="button" data-world-action="cancel-encounters">Cancelar edição</button></div></form>':'')+'<div class="regional-template-list">'+(world.encounters || []).map(e=>'<article><h3>'+esc(e.name)+'</h3><span class="pill">'+(e.hostile?'Hostil · combate ou fuga':'Não hostil · interações')+'</span><p>'+esc(e.description)+'</p><small>'+e.participants.length+' participante(s) · '+e.options.length+' opções</small><details><summary>Opções e participantes</summary><p>'+e.participants.map(p=>esc(p.name)+(p.combatant?' · com ficha':' · narrativo')).join('<br>')+'</p><ul>'+e.options.map(o=>'<li>'+esc(o.label)+' · '+esc(({resolve:'narrativa',test:'teste de '+o.attribute,combat:'combate'})[o.kind])+'</li>').join('')+'</ul></details></article>').join('')+'</div>'+(!(world.encounters || []).length?'<p>Nenhum modelo cadastrado. Prepare os exemplos de Eriador ou edite a configuração para criar seus modelos.</p>':'')+'<h3>Distribuição nos lugares</h3><div class="regional-table-scroll"><table class="regional-table"><thead><tr><th>Lugar</th><th>Configuração</th><th>Chance</th><th>Intervalo</th><th>Encontros permitidos</th></tr></thead><tbody>'+world.places.map(p=>{const t=regionalEncounterTable(world,p.id);return '<tr><td>'+esc(p.name)+'</td><td>'+esc(({inherit:'Herdar',extend:'Complementar',replace:'Substituir',none:'Bloquear'})[p.encounterTable?.mode || 'inherit'])+'</td><td>'+t.chance+'%</td><td>'+t.cooldownTurns+' turnos</td><td>'+t.entries.map(e=>esc(world.encounters.find(t=>t.id===e.encounterId).name)+' ('+e.weight+')').join(', ')+'</td></tr>';}).join('')+'</tbody></table></div></div></section>';
  }

  function routesHTML(){return '<section class="panel"><div class="panel-head"><h2>Rotas do cenário</h2><button class="btn" data-world-action="edit-routes">Editar rotas</button></div><div class="form-body">'+errorHTML()+'<p>Rotas bidirecionais ligam lugares com o mesmo superior. A distância é independente do transporte: a pé, uma unidade por turno. Encontros usam o superior comum. Alterações valem para novas aventuras.</p><button class="btn" data-world-action="route-examples">Preparar rotas de Eriador</button>'+(routeDraft!==null?'<form id="route-config-form"><label for="route-config">Rotas (lista JSON)</label><textarea id="route-config" class="code-editor" rows="18" spellcheck="false">'+esc(routeDraft)+'</textarea><p class="field-hint">Campos: id, name, description, fromPlaceId, toPlaceId, distance (1–100). Sem sentido nem condição de acesso.</p><button class="btn primary" type="submit">Validar e salvar rotas</button><button class="btn" type="button" data-world-action="cancel-routes">Cancelar</button></form>':'')+'<div class="local-routes">'+(world.routes || []).map(r=>'<article><div><h3>'+esc(r.name)+'</h3><p>'+esc(world.places.find(p=>p.id===r.fromPlaceId).name)+' ↔ '+esc(world.places.find(p=>p.id===r.toPlaceId).name)+' · '+r.distance+' unidades</p><p>'+esc(r.description)+'</p></div></article>').join('')+'</div></div></section>';}
  function html() {
    if(view==='model')return modelHTML();
    if(view==='list')return collectionHTML();
    if(!world && view==='json' && importMode==='new')return '<div class="page-head"><h1>Importar cenário</h1></div><button class="btn" data-world-action="list">← Todos os cenários</button>'+jsonHTML();
    if (!world) return '<section class="panel form-body"><h1>Cenários</h1>' + errorHTML() + '<button class="btn" data-world-action="retry">Tentar novamente</button></section>';
    return '<div class="page-head"><div><p class="eyebrow">Do planeta à sala.</p><h1>Um mundo, muitos lugares.</h1><p>Organize os espaços do cenário em uma hierarquia livre. Descrições e detalhes, com JSON independente.</p></div><div class="rule-chip">' + esc(importMode === 'new' ? 'Novo cenário' : world.name) + '<small>' + (importMode === 'new' ? 'Importação independente' : world.places.length + ' lugar(es)') + '</small></div></div><div class="world-toolbar"><div class="btn-group"><button class="btn" data-world-action="list">← Todos os cenários</button><button class="btn' + (view === 'browse' ? ' primary' : '') + '" data-world-action="browse" aria-pressed="' + (view === 'browse') + '">Árvore de lugares</button><button class="btn' + (view === 'map' ? ' primary' : '') + '" data-world-action="map" aria-pressed="' + (view === 'map') + '">Mapa pixelado</button><button class="btn' + (view === 'npcs' ? ' primary' : '') + '" data-world-action="npcs" aria-pressed="' + (view === 'npcs') + '">NPCs do cenário</button><button class="btn" data-world-action="routes">Rotas</button><button class="btn" data-world-action="gateways">Preparar portões e caminhos</button><button class="btn" data-world-action="turn-rules-example">Relógio e gatilhos</button><button class="btn" data-world-action="encounters">Encontros de região</button><button class="btn' + (view === 'json' ? ' primary' : '') + '" data-world-action="json" aria-pressed="' + (view === 'json') + '">JSON do cenário</button></div>' + (undoWorld ? '<button class="btn" data-world-action="undo">Desfazer exclusão</button>' : '') + '</div>' + (view === 'routes' ? routesHTML() : view === 'encounters' ? encountersHTML() : view === 'json' ? jsonHTML() : view === 'npcs' ? npcManager.html() : view === 'map' ? mapHTML() + '<section class="panel place-panel map-details">' + (draft ? formHTML() : placeDetailsHTML()) + '</section>' : '<div class="world-layout"><section class="panel world-nav"><div class="panel-head"><h2>Lugares do mundo</h2><span class="pill">' + world.places.length + '</span></div><div class="world-search"><label for="place-search">Buscar lugar</label><input id="place-search" type="search" placeholder="Nome, tipo ou descrição" value="' + esc(search) + '"></div><nav class="place-tree" aria-label="Hierarquia de lugares">' + treeHTML() + '</nav><div class="editor-actions"><button class="btn primary" data-world-action="new-root">Novo lugar principal</button></div><p class="roster-note">' + esc(world.description) + '</p></section><section class="panel place-panel">' + (draft ? formHTML() : placeDetailsHTML()) + '</section></div>');
  }
  function newPlace(parentId) {
    editingId = null; error = ''; draft = { id: 'lugar-' + crypto.randomUUID().slice(0, 8), name: '', type: '', parentId, x: null, y: null, description: '', detailsText: '{}' };
    view = placeView; render(); document.querySelector('#place-name')?.focus();
  }
  document.addEventListener('input', event => {
    const target = event.target;
    if (target.dataset.environmentField && worldDraft) worldDraft[target.dataset.environmentField] = target.value;
    if (target.dataset.worldField && draft) {
      const field = target.dataset.worldField;
      if (field === 'parentId' && draft.parentId !== (target.value || null)) { draft.x = null; draft.y = null; }
      draft[field] = field === 'parentId' ? target.value || null : ['x','y'].includes(field) ? target.value === '' ? null : Number(target.value) : target.value;
    }
    if(target.id==='route-config')routeDraft=target.value;
    if(target.id==='encounter-config')encounterDraft=target.value;
    if (target.id === 'world-json') { jsonText = target.value; pendingWorld = null; }
    if (target.id === 'place-search') { search = target.value; const tree = document.querySelector('.place-tree'); if (tree) tree.innerHTML = treeHTML(); }
  });
  document.addEventListener('change', event => {
    const t = event.target;
    if (t.dataset.worldField === 'parentId' && draft) {
      if (draft.parentId !== (t.value || null)) { draft.x = null; draft.y = null; }
      draft.parentId = t.value || null;
      const x = document.querySelector('#place-x'), y = document.querySelector('#place-y');
      if (x) x.value = draft.x ?? ''; if (y) y.value = draft.y ?? '';
    }
    if (['x','y'].includes(t.dataset.worldField) && draft) draft[t.dataset.worldField] = t.value === '' ? null : Number(t.value);
  });
  document.addEventListener('submit', event => {
    if(event.target.id==='route-config-form'){
      event.preventDefault();try{const next=validateWorld({...world,routes:JSON.parse(routeDraft)});beforeWorldChange(activeWorldId,next);const nextWorlds=worlds.map(e=>e.id===activeWorldId?{...e,world:next}:e);try{localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:1,worlds:nextWorlds,activeWorldId}));}catch{throw new Error('Não foi possível salvar as rotas. Libere espaço e tente novamente.');}worlds=nextWorlds;world=next;jsonText=pretty(next);routeDraft=null;error='';toast('Rotas salvas. Crie uma nova aventura para utilizá-las.');}catch(e){error=e.message;toast(error,true);}render();return;
    }
    if(event.target.id==='encounter-config-form') {
      event.preventDefault();
      try{
        const config=JSON.parse(encounterDraft);
        if(!config || !Array.isArray(config.encounters) || !config.placeTables || typeof config.placeTables!=='object' || Array.isArray(config.placeTables) || Object.keys(config).some(k=>!['encounters','placeTables'].includes(k)))throw new Error('Use {encounters:[],placeTables:{}}.');
        if(Object.keys(config.placeTables).some(id=>!world.places.some(p=>p.id===id)))throw new Error('A distribuição contém um lugar inexistente.');
        const next=validateWorld({...world,encounters:config.encounters,places:world.places.map(({encounterTable,...p})=>({...p,...(Object.hasOwn(config.placeTables,p.id)?{encounterTable:config.placeTables[p.id]}:{})}))});
        beforeWorldChange(activeWorldId,next);const nextWorlds=worlds.map(e=>e.id===activeWorldId?{...e,world:next,selectedId}:e);
        try{localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:1,worlds:nextWorlds,activeWorldId}));}catch{throw new Error('Não foi possível salvar os encontros. Libere espaço no navegador e tente novamente.');}
        worlds=nextWorlds;world=next;jsonText=pretty(next);encounterDraft=null;error='';toast('Modelos e distribuição de encontros salvos.');
      }catch(e){error=e.message;toast(error,true);}render();return;
    }
    if (event.target.id === 'environment-form') {
      event.preventDefault();
      try {
        const previous = editingWorldId ? worlds.find(entry => entry.id === editingWorldId) : null;
        const next = validateWorld({ ...(previous?.world ?? { schemaVersion: 1, places: [] }), ...worldDraft });
        if (previous) { previous.world = next; activate(previous.id); persist(); } else addWorld(next);
        view = 'browse'; placeView = 'browse'; render(); toast(previous ? 'Cenário atualizado.' : 'Cenário criado. Adicione seu primeiro lugar.');
      } catch (e) { error = e.message; render(); }
      return;
    }
    if (event.target.id !== 'place-form') return;
    event.preventDefault();
    try {
      const { detailsText, ...place } = draft;
      const next = savePlace(world, { ...place, details: JSON.parse(detailsText) }, editingId);
      selectedId = place.id; if (view === 'map') mapParentId = place.id; undoWorld = null; commit(next); toast('Lugar salvo no cenário.'); render();
    } catch (e) { error = e instanceof SyntaxError ? 'Detalhes: informe um objeto JSON válido. ' + e.message : e.message; render(); }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || applying) return;
    if (button.dataset.tab && button.dataset.tab !== 'world') { undoWorld = null; return; }
    if (button.dataset.environmentOpen) { activate(button.dataset.environmentOpen); view = 'browse'; placeView = 'browse'; persist(); render(); return; }
    if (button.dataset.environmentEdit) {
      const entry = worlds.find(entry => entry.id === button.dataset.environmentEdit);
      if (!entry) return;
      editingWorldId = entry.id; worldDraft = { name: entry.world.name, description: entry.world.description }; error = ''; view = 'list'; render(); document.querySelector('#environment-name')?.focus(); return;
    }
    if (Object.hasOwn(button.dataset, 'worldMap')) {
      const id = button.dataset.worldMap || null;
      if (id && !world.places.some(p => p.id === id)) return;
      mapParentId = id; selectedId = id; draft = null; editingId = null; view = 'map'; placeView = 'map'; error = ''; persist(); render(); return;
    }
    if (button.dataset.worldSelect) { if (view === 'map') mapParentId = button.dataset.worldSelect; selectedId = button.dataset.worldSelect; draft = null; editingId = null; error = ''; persist(); render(); return; }
    const action = button.dataset.environmentDelete ? 'delete-scenario' : button.dataset.worldAction;
    if (!action) return;
    try {
      if(action==='routes'){routeDraft=null;view='routes';error='';}
      if(action==='edit-routes'){routeDraft=pretty(world.routes || []);view='routes';}
      if(action==='route-examples'){const examples=createScenarioTemplate().routes.filter(r=>world.places.some(p=>p.id===r.fromPlaceId) && world.places.some(p=>p.id===r.toPlaceId));routeDraft=pretty([...(world.routes || []),...examples.filter(r=>!(world.routes || []).some(v=>v.id===r.id))]);view='routes';}
      if(action==='cancel-routes')routeDraft=null;
      if(action==='turn-rules-example'){const model=createScenarioTemplate();const turnRules=[...(world.turnRules || []),...model.turnRules.filter(r=>world.places.some(p=>p.id===r.placeId) && !(world.turnRules || []).some(v=>v.id===r.id && v.placeId===r.placeId))];jsonText=pretty({...world,time:world.time || model.time,turnRules});pendingWorld=null;importMode='replace';view='json';error='';toast('Relógio e gatilhos preparados no JSON. Revise e valide para salvar.');}
      if(action==='gateways'){jsonText=pretty(createGatewayScenarioTemplate(world));pendingWorld=null;importMode='replace';view='json';error='';toast('Portões e caminhos preparados. Revise o JSON, valide e confirme. Aventuras antigas permanecem preservadas.');}
      if(action==='model'){view='model';error='';render();return;}
      if(action==='model-editor'){importMode='new';jsonText=pretty(createGatewayScenarioTemplate());pendingWorld=null;error='';view='json';render();return;}
      if(action==='download-model'){downloadModel(pretty(createGatewayScenarioTemplate()),'cenario-modelo-completo.json');return;}
      if(action==='download-prompt'){downloadModel(scenarioLLMPrompt(createGatewayScenarioTemplate()),'instrucoes-cenario-llm.txt');return;}
      if(action==='copy-model' || action==='copy-prompt'){
        try{await navigator.clipboard.writeText(action==='copy-model'?pretty(createGatewayScenarioTemplate()):scenarioLLMPrompt(createGatewayScenarioTemplate()));toast('Conteúdo copiado.');}
        catch{const field=document.querySelector(action==='copy-model'?'#scenario-model':'#scenario-prompt');field?.focus();field?.select?.();toast('Selecione o texto e use Ctrl+C para copiar.',true);}return;
      }
      if (action === 'retry') { await init(); render(); return; }
      if(action==='delete-scenario'){
        const index=worlds.findIndex(e=>e.id===button.dataset.environmentDelete);if(index<0)throw new Error('Cenário não encontrado.');
        const entry=structuredClone(worlds[index]);beforeWorldDelete(entry.id);
        const oldActive=activeWorldId,next=worlds.filter(e=>e.id!==entry.id),active=oldActive===entry.id?next[0]?.id || null:oldActive;
        saveCollection(next,active);deletedScenario={entry,index,activeId:oldActive};toast('Cenário excluído. Aventuras existentes foram preservadas. Você pode desfazer.');render();return;
      }
      if(action==='undo-scenario' && deletedScenario){
        const {entry,index,activeId}=deletedScenario;if(worlds.some(e=>e.id===entry.id))throw new Error('Já existe um cenário com esse ID.');
        const next=[...worlds];next.splice(Math.min(index,next.length),0,entry);saveCollection(next,next.some(e=>e.id===activeId)?activeId:entry.id);deletedScenario=null;toast('Cenário recuperado.');render();return;
      }
      if (action === 'list') { view = 'list'; worldDraft = null; error = ''; render(); return; }
      if (action === 'new-environment') { editingWorldId = null; worldDraft = { name: '', description: '' }; error = ''; view = 'list'; render(); document.querySelector('#environment-name')?.focus(); return; }
      if (action === 'cancel-environment') { worldDraft = null; error = ''; render(); return; }
      if (action === 'new-json') { importMode = 'new'; jsonText = pretty({ schemaVersion: 1, name: 'Novo cenário', description: '', places: [], npcs: [] }); pendingWorld = null; error = ''; view = 'json'; render(); document.querySelector('#world-file').click(); return; }
      if (action === 'map') { view = 'map'; placeView = 'map'; draft = null; mapParentId = selectedId; error = ''; render(); return; }
      if (action === 'map-new') return newPlace(mapParentId);
      if (action === 'browse' || action === 'json') { view = action; if (action === 'browse') placeView = 'browse'; if (action === 'browse' || importMode === 'new') { importMode = 'replace'; jsonText = pretty(world); pendingWorld = null; } error = ''; render(); return; }
      if (!world && !(importMode==='new' && ['replace','download','example','apply','cancel-replace'].includes(action))) return;
      if(action==='encounters'){view='encounters';encounterDraft=null;error='';render();return;}
      if(action==='edit-encounters'){encounterDraft=pretty(encounterConfig());error='';render();return;}
      if(action==='encounter-examples'){encounterDraft=pretty(encounterConfig(withEriadorEncounters(world)));view='encounters';error='';render();return;}
      if(action==='cancel-encounters'){encounterDraft=null;error='';render();return;}
      if (action === 'npcs') {npcManager.reset();view='npcs';render();return;}
      if (action === 'new-root') return newPlace(null);
      if (action === 'new-child') return newPlace(selectedId);
      if (action === 'edit') { const p = selected(); if (!p) return; editingId = p.id; draft = { ...p, detailsText: pretty(p.details) }; delete draft.details; error = ''; render(); return; }
      if (action === 'cancel') { draft = null; error = ''; render(); return; }
      if (action === 'delete') { const previous = world; const p = selected(); if (!p) return; const next = removePlace(world, p.id); selectedId = p.parentId; if (view === 'map') mapParentId = p.parentId; commit(next); undoWorld = previous; toast('Lugar excluído. Você pode desfazer a exclusão.'); render(); return; }
      if (action === 'undo') { if (undoWorld) { const next = undoWorld; undoWorld = null; commit(next); render(); toast('Exclusão desfeita.'); } return; }
      if (action === 'import') { document.querySelector('#world-file').click(); return; }
      if (action === 'cancel-replace') { pendingWorld = null; render(); return; }
      if (action === 'replace') { if (pendingWorld) { undoWorld = null; if (importMode === 'new') addWorld(pendingWorld); else commit(pendingWorld); view = 'browse'; placeView = 'browse'; search = ''; render(); toast('Cenário aplicado.'); } return; }
      if (action === 'download') {
        JSON.parse(jsonText);
        const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = 'cenario.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (action === 'example') {
        const response = await fetch('/worlds/example.json'); if (!response.ok) throw new Error('Não foi possível carregar o exemplo.');
        jsonText = pretty(validateWorld(await response.json())); pendingWorld = null; error = ''; render(); toast('Exemplo no editor. Valide para ' + (importMode === 'new' ? 'adicionar um cenário.' : 'substituir este cenário.')); return;
      }
      if (action === 'apply') {
        const candidate = validateWorld(JSON.parse(jsonText));
        applying = true; error = ''; render();
        const response = await fetch('/api/world', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world: candidate }) });
        let result; try { result = await response.json(); } catch { throw new Error('O servidor não respondeu em JSON. Reabra o site com sua conta.'); }
        if (!response.ok) throw new Error(result.error || 'Não foi possível validar o cenário.');
        pendingWorld = validateWorld(result); toast('JSON válido. Confirme para ' + (importMode === 'new' ? 'adicionar o cenário.' : 'substituir este cenário.'));
      }
    } catch (e) { error = e instanceof SyntaxError ? 'JSON inválido: ' + e.message : e.message; toast(error, true); }
    finally { applying = false; render(); }
  });
  document.querySelector('#world-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 240000) { toast('Use um cenário JSON de até 240 KB.', true); return; }
    try { jsonText = await file.text(); pendingWorld = null; view = 'json'; error = ''; render(); toast('Arquivo carregado no editor de cenários. Valide e aplique para usar.'); }
    catch { toast('Não foi possível ler o arquivo.', true); }
  });
  return {
    init, html,
    getEnvironmentSnapshot: id => structuredClone(worlds.find(e => e.id === id)?.world || null),
    getActiveEnvironmentId: () => activeWorldId,
    getEnvironments: () => worlds.map(entry => ({ id: entry.id, name: entry.world.name, description: entry.world.description, npcs:structuredClone(entry.world.npcs || []), places: entry.world.places.map(p => ({ id: p.id, parentId: p.parentId, name: p.name, type: p.type, x: p.x, y: p.y, description: p.description, details: p.details, path: ancestors(entry.world, p.id).map(a => a.name).join(' / ') })) }))
  };
}
