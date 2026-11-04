import { createAdventure, validateAdventure, changeAdventure, adventureMission, reachableAdventurePlaces, adventureNPCs, visibleAdventureNPCs, upgradeAdventure, availableMissionOffers, availableAdventureActivities, currentRegionalEncounter } from './adventure.mjs';
import { OBJECTIVE_STATUSES, missionProgress, pendingDependencies } from './mission.mjs';
import { routeBetween, routeMapHTML, ancestors, worldClock } from './world.mjs';
import { escapeRule } from './engine.mjs';
const STORAGE = '3det-adaptavel-adventures-v1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const names = { not_started:'Não iniciada', in_progress:'Em andamento', completed:'Concluída', abandoned:'Abandonada' };
const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const MAP_IMAGE_PREFIX = '3det-adaptavel-map-image-v1:';
export async function prepareMapImage(file) {
  if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Escolha uma imagem PNG, JPG ou WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('A imagem deve ter até 10 MB.');
  let bitmap;
  try { bitmap=await createImageBitmap(file); } catch { throw new Error('Não foi possível abrir essa imagem. Escolha outro arquivo.'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64000000) throw new Error('A imagem deve ter até 64 milhões de pixels.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL('image/webp',0.85);
    if(dataUrl.length>1000000)throw new Error('A imagem ficou muito grande para salvar. Use uma imagem mais simples ou menor.');
    return {dataUrl,width:canvas.width,height:canvas.height,name:String(file.name || 'Mapa').slice(0,150)};
  } finally { bitmap.close?.(); }
}
function validMapImage(image) {
  return image && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl) && image.dataUrl.length<=1000000 && Number.isInteger(image.width) && Number.isInteger(image.height) && image.width>0 && image.height>0 && image.width<=1600 && image.height<=1600 && typeof image.name==='string';
}
export function createAdventureUI({ render, toast, getMissions, getLegacyProgress, getEnvironmentSnapshot, getRules, getCharacters, getEnvironments = () => [] }) {
  let mapImageBusy=false, pendingMapKey=null;
  const disclosures=new Map();
  let reader=null, readerTrigger=null;
  const disclosureKey=key=>selectedId+':'+key;
  const disclosure=(key,label,body,open=false,css='')=>'<details class="adventure-disclosure '+css+'" data-adventure-disclosure="'+esc(key)+'"'+((disclosures.get(disclosureKey(key)) ?? open)?' open':'')+'><summary>'+label+'</summary>'+body+'</details>';
  const readButton=(type,label,id='')=>'<button class="subtle-link adventure-read" data-adventure-read="'+esc(type)+'" data-read-id="'+esc(id)+'" aria-label="'+esc(label)+'">'+esc(type==='npc'?'Sobre':label)+'</button>';
  const prose=text=>'<p class="reading-prose">'+esc(text)+'</p>';
  const excerpt=(text,max=160)=>{text=String(text || '');return text.length>max?text.slice(0,max).trimEnd()+'…':text;};
  let busy = false, turnChoice = {}, combatNpcId = null, mapView = 'inside', mapContextOverride = undefined, missionOpen = false, interaction = null;
  let adventures = [], view = 'list', selectedId = null, draft = null, error = '', storageError = '', preservedRaw = null, undo = null;
  const selected = () => adventures.find(a => a.id === selectedId);
  function init() {
    try {
      preservedRaw = localStorage.getItem(STORAGE); if (!preservedRaw) return;
      const data = JSON.parse(preservedRaw);
      if (data.schemaVersion !== 1 || !Array.isArray(data.adventures) || data.adventures.length > 200) throw new Error('Coleção inválida.');
      adventures = data.adventures.map(upgradeAdventure);
      if (new Set(adventures.map(a => a.id)).size !== adventures.length) throw new Error('IDs duplicados.');
    } catch (e) { storageError = 'Não foi possível restaurar as aventuras. Os dados existentes foram preservados. ' + e.message; adventures = []; }
  }
  function persist(next) {
    if (storageError) throw new Error('Baixe a recuperação antes de alterar esta coleção.');
    if (next.length > 200) throw new Error('Limite de 200 aventuras.');
    try { localStorage.setItem(STORAGE, JSON.stringify({ schemaVersion:1, adventures:next })); }
    catch { throw new Error('Não foi possível salvar a aventura. Libere espaço no navegador e tente novamente.'); }
    adventures = next;
  }
  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value,null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const errorHTML = () => error ? '<div class="inline-error" role="alert">' + esc(error) + '</div>' : '';
  const options = (entries,value) => '<option value="">Selecione</option>' + entries.map(e => '<option value="' + esc(e.id) + '"' + (value === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('');
  function initialPlaces(environmentId){const places=getEnvironments().find(e=>e.id===environmentId)?.places || [];const parents=new Set(places.map(p=>p.parentId));return places.filter(p=>!parents.has(p.id));}
  function formHTML() {
    if (!draft) return '';
    const legacy = draft.legacyId && getLegacyProgress().find(e => e.id === draft.legacyId);
    return '<section class="panel"><div class="panel-head"><h2>' + (draft.editId ? 'Editar aventura' : legacy ? 'Continuar progresso anterior' : 'Nova aventura') + '</h2></div><form id="adventure-form" class="form-body"><div class="form-grid"><div class="full"><label for="adventure-name">Nome da aventura *</label><input id="adventure-name" data-adventure-field="name" maxlength="120" required value="' + esc(draft.name) + '"></div>' + (!draft.editId ? (legacy ? '<p>' + esc(legacy.mission.name) + ' · progresso preservado</p>' : '<div><label for="adventure-environment">Cenário *</label><select id="adventure-environment" data-adventure-field="environmentId" required>' + options(getEnvironments(),draft.environmentId) + '</select></div><div><label for="adventure-location">Local inicial *</label><select id="adventure-location" data-adventure-field="locationId" required>' + options(initialPlaces(draft.environmentId),draft.locationId) + '</select></div>') + '<div><label for="adventure-character">Personagem *</label><select id="adventure-character" data-adventure-field="characterId" required>' + options(getCharacters(),draft.characterId) + '</select></div>' : '') + '</div><p class="field-hint">' + (draft.editId ? 'Os vínculos desta partida são preservados.' : 'Escolha o cenário e um local inicial sem lugares internos. Você começa sem missão e pode aceitar pedidos durante a exploração. A aventura preserva cópias do cenário, das regras e da ficha.') + '</p>' + errorHTML() + '<div class="form-actions"><button class="btn primary" type="submit">' + (draft.editId ? 'Salvar nome' : 'Criar aventura') + '</button><button class="btn" type="button" data-adventure-action="cancel">Cancelar</button></div></form></section>';
  }
  function listHTML() {
    const legacy = getLegacyProgress().filter(e => !adventures.some(a => a.legacyId === e.id));
    return '<div class="page-head"><div><p class="eyebrow">Seu personagem. Seu mundo. Sua história.</p><h1>Aventuras</h1><p>Cada partida tem seu próprio progresso e pode ser retomada aqui.</p></div><div class="rule-chip">' + adventures.length + ' aventura(s)<small>Salvas neste navegador</small></div></div><div class="world-toolbar"><div class="btn-group"><button class="btn primary" data-adventure-action="new"' + (storageError ? ' disabled' : '') + '>Nova aventura</button>' + (undo ? '<button class="btn" data-adventure-action="undo">Desfazer exclusão</button>' : '') + '</div></div>' + (storageError ? '<div class="inline-error" role="alert">' + esc(storageError) + '<br><button class="btn" data-adventure-action="recovery">Baixar recuperação</button></div>' : '') + (draft ? formHTML() : errorHTML()) + (legacy.length ? '<section class="panel"><div class="panel-head"><h2>Progresso anterior preservado</h2></div><div class="form-body"><p>Escolha um personagem para transformar cada registro em uma aventura. As datas antigas não existiam; as datas serão registradas a partir dessa conversão.</p>' + legacy.map(e => '<div class="world-toolbar"><span>' + esc(e.mission.name) + ' · ' + missionProgress(e.mission).completed + ' objetivo(s) concluído(s)</span><div class="btn-group"><button class="btn" data-adventure-legacy="' + esc(e.id) + '"' + (storageError ? ' disabled' : '') + '>Escolher personagem</button><button class="btn" data-adventure-backup="' + esc(e.id) + '">Baixar registro</button></div></div>').join('') + '</div></section>' : '') + (!getEnvironments().length ? '<p class="warning">Cadastre um cenário para criar uma aventura.</p>' : '') + (!getCharacters().length ? '<p class="warning">Crie uma <button class="subtle-link" data-tab="characters">ficha de personagem</button> antes de iniciar.</p>' : '') + '<div class="environment-grid">' + adventures.map(a => {
      const p = a.schemaVersion===2 ? {total:a.quests.reduce((n,q)=>n+q.progress.length,0),completed:a.quests.reduce((n,q)=>n+q.progress.filter(p=>p.status==='completed').length,0)} : missionProgress(adventureMission(a));
      return '<article class="panel environment-card"><p class="eyebrow">' + esc(names[a.status]) + '</p><h2>' + esc(a.name) + '</h2><p><strong>' + esc(a.snapshot.character.name) + '</strong> · ' + esc(placeName(a,a.locationId)) + '</p><p>Cenário: ' + esc(a.snapshot.world.name) + '</p><p>' + p.completed + ' de ' + p.total + ' objetivos concluídos</p><progress max="' + p.total + '" value="' + p.completed + '" aria-label="Progresso de ' + esc(a.name) + '"></progress><div class="btn-group"><button class="btn primary" data-adventure-open="' + esc(a.id) + '">Abrir aventura</button><button class="btn" data-adventure-edit="' + esc(a.id) + '">Editar</button><button class="btn ghost danger" data-adventure-delete="' + esc(a.id) + '" aria-label="Excluir aventura ' + esc(a.name) + '">Excluir</button></div></article>';
    }).join('') + '</div>' + (!adventures.length ? '<section class="panel mission-empty"><h2>Sua próxima história começa aqui.</h2><p>Escolha seu personagem e explore o mundo da aventura.</p></section>' : '');
  }
  function objectiveDetails(a,o) {
    const m=adventureMission(a),quest=a.schemaVersion===2?a.quests.find(q=>q.snapshot.mission.id===m.id):a;
    const blocked=pendingDependencies(m,o),progress=quest.progress.find(p=>p.id===o.id);
    const target=adventureNPCs(a).find(n=>n.id===o.target || n.sourceId===o.target)?.name || m.items?.find(i=>i.id===o.target)?.name || o.target;
    return prose(o.description)+(o.target?'<p><strong>Alvo:</strong> '+esc(target)+'</p>':'')+'<p><strong>Lugar:</strong> '+esc(o.placeId?placeName(a,o.placeId):'Qualquer lugar do cenário')+'</p><h4>Como concluir</h4>'+prose(o.completionCriteria || 'Conforme avaliação do mestre.')+(blocked.length?'<p class="warning">Aguardando: '+blocked.map(o=>esc(o.title)).join(', ')+'</p>':'')+(o.alternatives.length?'<h3>Alternativas — realize uma</h3>'+o.alternatives.map(alt=>'<section class="reading-section"><h4>'+esc(alt.title)+'</h4>'+prose(alt.description)+(alt.target?prose(alt.target):'')+'<p>Lugar: '+esc(alt.placeId?placeName(a,alt.placeId):'Qualquer lugar do cenário')+'</p>'+prose(alt.completionCriteria)+'</section>').join(''):'')+(progress.completedTurn?'<p class="turn-success">Concluído no turno '+progress.completedTurn+'</p>':'')+(o.completion?.mode==='automatic'?'<details><summary>Regra e resultado da verificação</summary><pre class="condition-json">'+esc(JSON.stringify(o.completion.condition,null,2))+'</pre>'+prose(progress.completionReason || 'Aguardando avaliação ao fim do turno.')+'</details>':'');
  }
  function objectivesHTML(a) {
    const m=adventureMission(a),active=['in_progress','completed'].includes(a.status);
    return '<div class="objective-list compact-objectives">'+m.objectives.map((o,i)=>{
      const blocked=pendingDependencies(m,o),automatic=o.completion?.mode==='automatic';
      const status=OBJECTIVE_STATUSES.find(s=>s.id===o.status)?.name || o.status;
      const controls=automatic?'':(o.alternatives.length?'<label for="adv-alt-'+i+'">Alternativa realizada</label><select id="adv-alt-'+i+'" data-adventure-alternative="'+esc(o.id)+'"'+(!active || busy || blocked.length?' disabled':'')+'>'+options(o.alternatives.map(alt=>({id:alt.id,name:alt.title})),o.completedAlternativeId)+'</select>':'')+'<label for="adv-status-'+i+'">Situação do objetivo</label><select id="adv-status-'+i+'" data-adventure-objective="'+esc(o.id)+'"'+(!active || busy || blocked.length?' disabled':'')+'>'+OBJECTIVE_STATUSES.map(s=>'<option value="'+s.id+'"'+(o.status===s.id?' selected':'')+'>'+s.name+'</option>').join('')+'</select>';
      return disclosure('objective:'+m.id+':'+o.id,'<span class="objective-summary-title">'+esc(o.title)+'</span> <span class="pill">'+esc(o.status!=='completed' && blocked.length?'Aguardando':status)+'</span>','<div class="objective-detail">'+objectiveDetails(a,o)+controls+'</div>',false,'objective-compact');
    }).join('')+'</div>';
  }
  const placeName = (a,id) => a.snapshot.world.places.find(p => p.id === id)?.name || a.snapshot.world.name;
  function locationPath(a) {
    const chain=[], seen=new Set();let place=a.snapshot.world.places.find(p => p.id === a.locationId);
    while (place && !seen.has(place.id)) {chain.unshift(place);seen.add(place.id);place=a.snapshot.world.places.find(p => p.id === place.parentId);}
    return chain;
  }
  function characterDetails(a) {
    const c=a.turn.character,rules=a.snapshot.rules;
    return '<p>'+c.hp+' / '+c.maxHp+' PV'+(c.maxMana>0?' · '+c.mana+' / '+c.maxMana+' mana':'')+' · '+c.spent+' pontos</p><h3>Atributos</h3><dl class="sheet-attributes">'+rules.attributes.map(attr=>'<div><dt>'+esc(attr.name)+'</dt><dd>'+esc(c.attributes[attr.id])+'</dd></div>').join('')+'</dl>'+(c.abilities.length?'<h3>Habilidades</h3>'+c.abilities.map(id=>{const ab=rules.abilities.find(v=>v.id===id);return '<h4>'+esc(ab?.name || id)+'</h4>'+prose(ab?.description || '');}).join(''):'')+'<h3>Identidade e história</h3><dl class="sheet-fields">'+rules.creation.fields.filter(f=>c.fields[f.id]).map(f=>'<div><dt>'+esc(f.label)+'</dt><dd>'+esc(c.fields[f.id])+'</dd></div>').join('')+'</dl><p class="field-hint">'+esc(rules.name)+' · v'+esc(rules.version)+'</p>';
  }
  function characterHTML(a) {
    const c=a.turn.character,rules=a.snapshot.rules,inventory=(a.inventory || a.turn.inventory || []).filter(i=>i.quantity>0);
    const itemName=id=>(a.quests || [{snapshot:a.snapshot}]).flatMap(q=>q.snapshot.mission?.items || []).find(i=>i.id===id)?.name || id;
    const attrs='<dl class="sheet-attributes">'+rules.attributes.map(attr=>'<div><dt>'+esc(attr.name)+'</dt><dd>'+esc(c.attributes[attr.id])+'</dd></div>').join('')+'</dl>';
    return '<aside class="panel adventure-sheet" aria-label="Ficha do personagem"><div class="sheet-identity"><span class="sheet-portrait" aria-hidden="true">'+esc(c.name.charAt(0).toUpperCase())+'</span><div><h2>'+esc(c.name)+'</h2><p>'+esc([c.fields.perfil,c.fields.origem].filter(Boolean).join(' · ') || 'Aventureiro')+'</p></div></div><div class="sheet-body"><div class="hp-row"><span>Pontos de vida</span><b>'+c.hp+' / '+c.maxHp+'</b></div><div class="hp-track" role="meter" aria-label="PV atuais do personagem" aria-valuenow="'+c.hp+'" aria-valuemin="0" aria-valuemax="'+Math.max(1,c.maxHp)+'"><span style="width:'+(c.maxHp?c.hp/c.maxHp*100:0)+'%"></span></div>'+(c.maxMana>0?'<p class="sheet-mana">Mana <b>'+c.mana+' / '+c.maxMana+'</b></p>':'')+(c.hp<=0?'<p class="warning">Personagem incapacitado.</p>':'')+disclosure('attributes','Atributos',attrs,true)+(c.abilities.length?disclosure('abilities','Habilidades · '+c.abilities.length,'<ul class="sheet-inventory">'+c.abilities.map(id=>'<li>'+esc(rules.abilities.find(v=>v.id===id)?.name || id)+'</li>').join('')+'</ul>'):'')+(inventory.length?disclosure('inventory','Inventário · '+inventory.length,'<ul class="sheet-inventory">'+inventory.map(i=>'<li>'+esc(itemName(i.id))+' <b>× '+i.quantity+'</b></li>').join('')+'</ul>',true):'')+readButton('character','Ler ficha completa')+'</div></aside>';
  }
  function mapContext(a) {
    if(a.travel)return mapContextOverride!==undefined?mapContextOverride:a.snapshot.world.navigation==='gateways'?ancestors(a.snapshot.world,a.travel.fromPlaceId).filter(p=>ancestors(a.snapshot.world,a.travel.toPlaceId).some(q=>q.id===p.id)).at(-1)?.id ?? null:a.snapshot.world.places.find(p=>p.id===a.travel.fromPlaceId).parentId;
    const current=a.snapshot.world.places.find(p=>p.id===a.locationId);
    const inside=a.snapshot.world.places.some(p=>p.parentId===a.locationId) && mapView!=='nearby';
    return mapContextOverride!==undefined?mapContextOverride:inside?a.locationId:current?.parentId ?? null;
  }
  function viewMapContext(a,id) {
    if(a.snapshot.world.navigation==='gateways'){if(id!==null && !a.snapshot.world.places.some(p=>p.id===id))throw new Error('Mapa inválido.');mapContextOverride=a.snapshot.world.places.some(p=>p.parentId===id)?id:a.snapshot.world.places.find(p=>p.id===id)?.parentId ?? null;disclosures.set(disclosureKey('map'),true);return;}
    if(id!==null && !(a.travel?ancestors(a.snapshot.world,a.snapshot.world.places.find(p=>p.id===a.travel.fromPlaceId).parentId):locationPath(a)).some(p=>p.id===id))throw new Error('Escolha um nível que contenha a localização do personagem.');
    mapContextOverride=id;disclosures.set(disclosureKey('map'),true);
  }
  function mapImageKey(a) {
    return MAP_IMAGE_PREFIX+JSON.stringify([a.environmentId || a.snapshot.mission.environmentId,mapContext(a)]);
  }
  function readMapImage(key) {
    try {const image=JSON.parse(localStorage.getItem(key));return validMapImage(image)?image:null;} catch {return null;}
  }
  function locationHTML(a) {
    const w=a.snapshot.world,current=w.places.find(p => p.id === a.locationId);
    const contextId=mapContext(a);
    const context=w.places.find(p => p.id === contextId);
    const visible=w.places.filter(p => p.parentId === contextId), reachable=new Set(reachableAdventurePlaces(a).map(p => p.id));
    const path=a.travel?ancestors(w,w.places.find(p=>p.id===a.travel.fromPlaceId).parentId):locationPath(a), markerPlace=visible.find(p=>path.some(ancestor=>ancestor.id===p.id));
    const presence=()=> 'Você está aqui';
    const movable=!busy && ['in_progress','completed'].includes(a.status) && a.turn.character.hp > 0 && !currentRegionalEncounter(a) && !a.travel;
    const moveButton=p => '<button class="btn' + (p.id === markerPlace?.id ? ' location-current' : '') + '" data-adventure-move="' + esc(p.id) + '"' + (!movable || !reachable.has(p.id) ? ' disabled' : '') + '>' + esc(p.name) + '<small>' + (p.id === markerPlace?.id ? presence(p)+(p.x===null?' · sem coordenadas':'') : p.x === null ? 'Sem posição definida' : 'Ir para este lugar') + '</small></button>';
    const localNPCs=visibleAdventureNPCs(a).filter(n=>n.origin!=='encounter'), image=readMapImage(mapImageKey(a));
    const imageTools=disclosure('map-settings','Imagem de fundo','<div class="map-image-tools"><div class="btn-group"><button class="btn" data-adventure-action="upload-map-image"'+(mapImageBusy?' disabled':'')+'>'+(mapImageBusy?'Preparando imagem…':image?'Trocar imagem de fundo':'Carregar imagem de fundo')+'</button>'+(image?'<button class="btn ghost" data-adventure-action="remove-map-image"'+(mapImageBusy?' disabled':'')+'>Remover imagem</button>':'')+'</div><input id="adventure-map-image-file" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Selecionar imagem de fundo do mapa"><p class="field-hint">'+(image?esc(image.name)+' · ':'')+'PNG, JPG ou WebP, até 10 MB. Imagem salva neste navegador para este mapa do cenário.</p></div>');
    const clock=worldClock(w,a.turn.number,a.pausedTimeTurns || 0),clockText='Dia '+clock.dia+' · '+String(clock.hora).padStart(2,'0')+':'+String(clock.minuto).padStart(2,'0');
    const restButton='<button class="btn" data-adventure-rest="true"'+(!movable || a.travel || a.status!=='in_progress'?' disabled':'')+'>Descansar · 1 turno</button>';
    const gateway=w.navigation==='gateways' && current?w.places.find(p=>p.id===current.parentId)?.entryPlaceId:null;
    const gatewayRoute=gateway && routeBetween(w,a.locationId,gateway);
    const mapBrowser=w.navigation==='gateways'?'<div class="map-browser"><strong>Posição: '+esc(a.travel?'Em viagem':[current?.name,w.places.find(p=>p.id===current?.parentId)?.name].filter(Boolean).join(' · '))+'</strong><label>Mapa visualizado <select data-adventure-map-level=""><option value="">'+esc(w.name)+'</option>'+w.places.filter(p=>w.places.some(c=>c.parentId===p.id)).map(p=>'<option value="'+esc(p.id)+'"'+(contextId===p.id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><small>Consultar o mapa não desloca o personagem.</small></div>':'';
    const exitButton=w.navigation==='gateways'?(gatewayRoute?'<button class="btn" data-adventure-travel="'+esc(gatewayRoute.id)+'"'+(!movable?' disabled':'')+'>Ir à saída de '+esc(placeName(a,current.parentId))+' · '+gatewayRoute.distance+' unidade(s)</button>':''):(current ? '<button class="btn" data-adventure-move="' + esc(current.parentId || '') + '"' + (!movable ? ' disabled' : '') + '>Sair de ' + esc(current.name) + ' · 1 turno</button>' : '');
    return '<section class="panel adventure-location" aria-label="Mapa da localização atual"><div class="panel-head"><div><h2>' + esc(a.travel?'Em viagem':placeName(a,a.locationId)) + '</h2><p>' + esc(current?.type || 'Cenário') + '</p></div></div>'+mapBrowser+routesHTML(a)+'<div class="location-intro'+(a.travel?' in-transit':'')+'"><div class="location-description"><p>' + esc(excerpt(a.travel?'Percorrendo '+w.routes.find(r=>r.id===a.travel.routeId).name+'. O destaque no caminho indica seu progresso.':current?.description || w.description || 'Escolha um lugar para explorar.')) + '</p>' + readButton('place','Ler sobre o lugar') + '</div>' + '<div class="map-travel-controls"><span class="adventure-clock" aria-label="Horário do cenário">'+clockText+'</span>'+restButton+exitButton+'</div>' + disclosure('map','Mapa de '+esc(context?.name || w.name),'<div class="pixel-map adventure-pixel-map' + (image?' has-map-image':'') + '"' + (image?' style="aspect-ratio:'+image.width+'/'+image.height+'"':'') + ' role="group" aria-label="Mapa de ' + esc(context?.name || w.name) + '">' + (image?'<img class="map-background-image" src="'+esc(image.dataUrl)+'" alt="" draggable="false">':'') + routeMapHTML(w,contextId,a.travel)+'<span class="map-origin">0, 0</span><span class="map-corner">100, 100</span>' + visible.filter(p => p.x !== null && p.y !== null).map(p => {
      const marked=p.id===markerPlace?.id, canMove=w.navigation==='gateways'?true:movable && reachable.has(p.id);
      const route=routeBetween(w,a.locationId,p.id);
      const label=(marked?'Localização atual: ':w.navigation==='gateways'?'Visualizar: ':canMove?route?'Viajar para ':'Ir para ':'')+p.name+(route?' · '+route.distance+' unidades':'');
      return '<button class="map-cell'+(marked?' player-cell':'')+(p.x<20?' map-label-left':p.x>80?' map-label-right':'')+(p.y<20?' map-label-below':'')+'" style="left:'+p.x+'%;top:'+p.y+'%" '+(w.navigation==='gateways'?'data-adventure-map-context':'data-adventure-move')+'="'+esc(p.id)+'" aria-label="'+esc(label)+'"'+(marked?' aria-current="location"':'')+(!canMove?' disabled':'')+' title="'+esc(label)+'"><span class="map-cell-label">'+esc(p.name)+'</span></button>';
    }).join('') + (!visible.some(p => p.x !== null && p.y !== null) ? '<p class="map-empty">' + (visible.length ? 'Lugares deste nível ainda sem coordenadas.' : 'Nenhum lugar interno neste nível.') + '</p>' : '') + '</div>',true,'map-disclosure') + '<div class="map-secondary">' + disclosure('destinations','Destinos em lista · '+visible.length,'<div class="map-place-list">'+visible.map(moveButton).join('')+'</div>') + imageTools + '</div></div><div class="form-body location-actions">' + (localNPCs.length ? '<h3>Pessoas neste lugar</h3><div class="local-npcs">' + localNPCs.map(n => {const state=a.turn.npcs.find(s => s.id === n.id);return '<article><div><strong>' + esc(n.name) + '</strong>' + readButton('npc','Sobre '+n.name,n.id) + '<small>' + (state.defeated ? 'Derrotado' : state.character ? (n.hostile?'Hostil · ':'') + state.character.hp + ' / ' + state.character.maxHp + ' PV' : 'Disponível para conversar') + '</small></div>' + (!state.defeated && !n.hostile && interaction?.npcId!==n.id ? '<button class="btn" data-adventure-talk="' + esc(n.id) + '"' + (a.status !== 'in_progress' || busy ? ' disabled' : '') + '>Conversar' + (availableMissionOffers(a,getMissions()).some(o=>o.offer.npcId===n.id) ? ' · Tem um pedido' : '') + '</button>' : '') + (state.character && !state.defeated ? '<button class="btn" data-adventure-fight="' + esc(n.id) + '"' + (a.status !== 'in_progress' || busy || a.turn.character.hp <= 0 || currentRegionalEncounter(a) ? ' disabled' : '') + '>Abrir combate</button>' : '') + npcConversationHTML(a,n,state) + '</article>';}).join('') + '</div>' : '') + activitiesHTML(a) + opportunitiesHTML(a) + '</div></section>';
  }
  function routesHTML(a){
    const w=a.snapshot.world,t=a.travel,r=t && w.routes.find(r=>r.id===t.routeId),enabled=!busy && a.status==='in_progress' && a.turn.character.hp>0 && !currentRegionalEncounter(a);
    if(t)return '<section class="travel-status" aria-live="polite"><div class="travel-heading"><div><p class="eyebrow">A pé · 1 unidade por turno</p><h3>'+esc(r.name)+'</h3><p>'+esc(placeName(a,t.fromPlaceId))+' → '+esc(placeName(a,t.toPlaceId))+' · '+t.progress+' / '+r.distance+' unidades percorridas</p></div><button class="btn primary" data-adventure-travel="'+esc(r.id)+'"'+(!enabled?' disabled':'')+'>Avançar · 1 turno</button></div><progress max="'+r.distance+'" value="'+t.progress+'" aria-label="Progresso da viagem"></progress>'+disclosure('route:'+r.id,'Sobre o caminho',prose(r.description)+'<p>Cada bolinha é uma etapa intermediária; chegar ao destino completa a última unidade.</p>')+(currentRegionalEncounter(a)?'<p>Viagem pausada. Resolva o encontro para continuar.</p>':'')+'</section>';
    const routes=(w.routes || []).filter(r=>[r.fromPlaceId,r.toPlaceId].includes(a.locationId));
    return routes.length?'<section class="local-routes"><h3>Rotas a partir daqui</h3>'+routes.map(r=>'<article><div><strong>'+esc(r.name)+'</strong><p>Até '+esc(placeName(a,r.fromPlaceId===a.locationId?r.toPlaceId:r.fromPlaceId))+' · '+r.distance+' unidades</p>'+disclosure('route:'+r.id,'Sobre o caminho',prose(r.description))+'</div><button class="btn" data-adventure-travel="'+esc(r.id)+'"'+(!enabled?' disabled':'')+'>Iniciar viagem · 1 turno</button></article>').join('')+'<p class="field-hint">A pé: uma unidade por turno. Cada avanço pode gerar um encontro da região. A distância não depende do transporte.</p></section>':'';
  }
  function activitiesHTML(a){
    const actions=availableAdventureActivities(a);if(!actions.length)return '';
    const row=action=>'<article><div><strong>'+esc(action.name)+'</strong>'+(action.kind==='test'?'<small>Teste de '+esc(a.snapshot.rules.attributes.find(v=>v.id===action.attribute)?.name || action.attribute)+' ≥ '+action.difficulty+'</small>':'')+(action.blocked?'<p class="field-hint">'+esc(action.blocked)+'</p>':'')+'</div><button class="btn primary" data-adventure-activity="'+esc(action.id)+'" data-activity-mission="'+esc(action.missionId)+'"'+(busy || action.blocked || currentRegionalEncounter(a)?' disabled':'')+'>Executar ação</button></article>';
    const missionIds=[...new Set(actions.map(a=>a.missionId))];
    const available=missionIds.map(id=>{const group=actions.filter(a=>a.missionId===id && !a.blocked);return group.length?(missionIds.length>1?'<h4>'+esc(group[0].missionName)+'</h4>':'')+group.map(row).join(''):'';}).join('');
    const blocked=actions.filter(a=>a.blocked);
    return '<section class="local-activities"><h3>Ações neste lugar</h3><p class="field-hint">Cada ação avança um turno.</p>'+available+(blocked.length?disclosure('blocked-actions','Ações indisponíveis · '+blocked.length,blocked.map(row).join('')):'')+'</section>';
  }
  function missionProposalHTML(a,proposal){
    return '<div class="inline-mission-proposal"><p class="eyebrow">Proposta de missão</p><h4>'+esc(proposal.mission.name)+'</h4>'+prose(proposal.offer.description)+'<div class="btn-group"><button class="btn primary" data-adventure-accept="'+esc(proposal.mission.id)+'"'+(a.status!=='in_progress' || busy?' disabled':'')+'>Aceitar missão</button><button class="btn" data-adventure-action="close-interaction">Deixar para depois</button></div></div>';
  }
  function offerButton(a,o){return '<button class="btn" data-adventure-offer="'+esc(o.mission.id)+'"'+(a.status!=='in_progress' || busy?' disabled':'')+'>'+esc(o.offer.title)+'</button>';}
  function npcConversationHTML(a,n,state){
    if(interaction?.npcId!==n.id || n.hostile || state.defeated)return '';
    const offers=availableMissionOffers(a,getMissions()).filter(o=>o.offer.npcId===n.id),proposal=offers.find(o=>o.mission.id===interaction.missionId);
    return '<div class="npc-inline-conversation" role="region" aria-label="Conversa com '+esc(n.name)+'" aria-live="polite"><p class="eyebrow">Conversando com '+esc(n.name)+'</p>'+prose(n.description || 'Esta pessoa não tem outras informações no momento.')+(proposal?missionProposalHTML(a,proposal):'<div class="btn-group">'+offers.map(o=>offerButton(a,o)).join('')+'</div>')+'<button class="btn" data-adventure-action="close-interaction">Encerrar conversa</button></div>';
  }
  function opportunitiesHTML(a) {
    const notices=availableMissionOffers(a,getMissions()).filter(o=>o.offer.type==='notice');
    const proposal=!interaction?.npcId && notices.find(o=>o.mission.id===interaction?.missionId);
    return notices.length?'<section class="local-opportunities"><h3>Avisos e oportunidades</h3>'+notices.map(o=>offerButton(a,o)).join('')+(proposal?missionProposalHTML(a,proposal):'')+'</section>':'';
  }
  function regionalEncounterHTML(a) {
    const active=currentRegionalEncounter(a);
    if(!active)return '';
    const {occurrence:e,template:t}=active,enabled=a.status==='in_progress' && !busy && a.turn.character.hp>0;
    return '<section class="panel regional-encounter" id="regional-encounter" aria-label="Encontro de região"><div class="panel-head"><div><p class="eyebrow">'+(e.status==='combat'?'Confronto em andamento':t.hostile?'Encontro hostil':'Encontro no caminho')+'</p><h2>'+esc(t.name)+'</h2></div><span class="pill">Surgiu no turno '+e.turn+'</span></div><div class="form-body">'+prose(t.description)+'<ul class="regional-participants">'+t.participants.map((p,i)=>'<li><strong>'+esc(p.name)+'</strong>'+(e.participants[i].character?' · '+e.participants[i].character.hp+' / '+e.participants[i].character.maxHp+' PV':'')+(e.participants[i].defeated?' · derrotado':'')+'</li>').join('')+'</ul>'+(e.lastResult?'<p class="regional-feedback" role="status">'+esc(e.lastResult)+'</p>':'')+'<div class="regional-choices">'+t.options.filter(o=>(!t.hostile || o.kind==='combat') && o.id!=='escapar' && (e.status!=='combat' || o.duringCombat || o.kind==='combat')).map(o=>{
      if(o.kind==='combat')return e.participants.filter(p=>p.character && !p.defeated).map(p=>'<button class="btn primary" data-adventure-fight="'+esc(p.id)+'"'+(!enabled?' disabled':'')+'>'+esc(o.label)+(e.participants.filter(p=>p.character).length>1?' · '+esc(p.character.name):'')+'</button>').join('');
      return '<button class="btn" data-adventure-encounter-choice="'+esc(o.id)+'" data-encounter-id="'+esc(e.id)+'"'+(!enabled || e.attempts>=100?' disabled':'')+'>'+esc(o.label)+(o.kind==='test'?' · '+esc(a.snapshot.rules.attributes.find(v=>v.id===o.attribute)?.name || o.attribute)+' ≥ '+o.difficulty:'')+' · 1 turno</button>';
    }).join('')+(t.hostile || e.status==='combat' ? e.participants.filter(p=>p.character && !p.defeated).slice(0,1).map(p=>fleeButton(a,p.id,!enabled)).join(''):'')+'</div></div></section>';
  }

  function fleeButton(a,npcId,disabled=false){const rule=escapeRule(a.snapshot.rules);return '<button class="btn" data-adventure-flee="'+esc(npcId)+'"'+(disabled?' disabled':'')+'>Tentar fugir · '+esc(a.snapshot.rules.attributes.find(v=>v.id===rule.attribute)?.name || rule.attribute)+' ≥ '+rule.difficulty+' · 1 turno</button>';}
  function combatHTML(a) {
    if (!combatNpcId) return '';
    const def=adventureNPCs(a).find(n => n.id === combatNpcId), npc=a.turn.npcs.find(n => n.id === combatNpcId);
    if (!def || !npc?.character || !visibleAdventureNPCs(a).some(n => n.id === combatNpcId)) return '';
    const attacks=a.snapshot.rules.actions.filter(action => action.kind === 'attack'), live=a.status === 'in_progress' && !npc.defeated && a.turn.character.hp > 0;
    for (const key of ['heroActionId','npcActionId']) if (!attacks.some(action => action.id === turnChoice[key])) turnChoice[key]=attacks[0]?.id;
    const fighter=(c,isNPC) => '<div class="adventure-fighter"><p class="eyebrow">' + (isNPC ? 'Adversário' : 'Seu personagem') + '</p><h3>' + esc(c.name) + '</h3><p>' + c.hp + ' / ' + c.maxHp + ' PV</p><div class="hp-track"><span style="width:' + (c.maxHp ? c.hp/c.maxHp*100 : 0) + '%"></span></div><label for="' + (isNPC ? 'turn-npc-action' : 'turn-hero-action') + '">Ação nesta rodada</label><select id="' + (isNPC ? 'turn-npc-action' : 'turn-hero-action') + '" data-turn-choice="' + (isNPC ? 'npcActionId' : 'heroActionId') + '"' + (!live || busy ? ' disabled' : '') + '>' + attacks.map(action => '<option value="' + esc(action.id) + '"' + (action.id === turnChoice[isNPC ? 'npcActionId' : 'heroActionId'] ? ' selected' : '') + '>' + esc(action.name) + '</option>').join('') + '</select></div>';
    return '<section class="panel adventure-combat" id="adventure-combat" aria-label="Combate na aventura"><div class="panel-head"><div><p class="eyebrow">Encontro em ' + esc(placeName(a,a.locationId)) + '</p><h2>Combate com ' + esc(def.name) + '</h2></div><button class="btn" data-adventure-action="close-combat"' + (busy ? ' disabled' : '') + '>'+ (currentRegionalEncounter(a) ? 'Voltar ao encontro' : 'Voltar ao mapa') +'</button></div><div class="form-body"><div class="adventure-fighters">' + fighter(a.turn.character,false) + fighter(npc.character,true) + '</div>' + (!live ? '<p class="battle-summary">' + (npc.defeated ? esc(def.name) + ' foi derrotado.' : a.turn.character.hp <= 0 ? 'Seu personagem ficou incapacitado.' : 'Esta aventura está encerrada.') + '</p>' : '') + '<div class="form-actions"><button class="btn primary" data-adventure-action="combat-turn"' + (!live || busy ? ' disabled' : '') + '>' + (busy ? 'Processando…' : 'Simular rodada e encerrar turno') + '</button>'+fleeButton(a,npc.id,!live || busy)+'<p class="field-hint">Se a fuga falhar, o adversário fará um ataque de resposta. Sua defesa ainda se aplica.</p></div></div></section>';
  }
  function storyEntries(a) {
    const turns=new Map(a.turn.history.map(h=>[h.number+':'+h.at,h]));
    const entries=a.journal.filter(e=>!(turns.has(e.turn+':'+e.at) && (/^Turno \d+[: ]/.test(e.text) || ['movement','action'].includes(e.kind) && turns.get(e.turn+':'+e.at).events.includes(e.text)))).map((e,index)=>({at:e.at,order:index,title:({arrival:'Chegada',movement:'Deslocamento',action:'Acontecimento',combat:'Combate',lifecycle:'Aventura'})[e.kind],text:e.text}));
    for(const h of a.turn.history){
      const checks=h.events.filter(e=>/: (pendente|concluído)\. /.test(e));
      const events=h.events.filter(e=>!checks.includes(e));
      entries.push({at:h.at,order:1000+h.number,title:'Turno '+h.number,text:events.join(' ') || 'Turno encerrado.',events,checks:[...checks,...h.checks.map(c=>(a.snapshot.mission?.objectives.find(o=>o.id===c.objectiveId)?.title || c.objectiveId)+': '+(c.met?'Concluído. ':'Pendente. ')+c.reason)]});
    }
    return entries.sort((x,y)=>Date.parse(y.at)-Date.parse(x.at) || y.order-x.order);
  }
  function storyEntryHTML(e,full=false) {
    return '<article class="story-entry"><span class="story-marker" aria-hidden="true"></span><div><p class="eyebrow">'+esc(e.title)+' · '+esc(date(e.at))+'</p>'+prose(full?e.text:excerpt(e.text,220))+(e.checks?.length?'<details class="story-checks"><summary>Verificação de objetivos · '+e.checks.length+'</summary><ul>'+e.checks.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></details>':'')+'</div></article>';
  }
  function storyHTML(a) {
    const entries=storyEntries(a);
    return '<section class="panel adventure-story" aria-label="Histórico da aventura">'+disclosure('story','<span>Histórico da aventura</span> <small>Últimos acontecimentos</small>','<div class="story-content" aria-live="polite">'+entries.slice(0,3).map(e=>storyEntryHTML(e)).join('')+'</div>',true)+ '<div class="story-footer">'+readButton('history','Ler histórico completo · '+entries.length)+'</div></section>';
  }
  function missionHTML(a) {
    const quest=a.schemaVersion===2 ? a.quests.find(q=>q.snapshot.mission.id===a.selectedMissionId) : a;
    if(!quest)return '<p class="adventure-no-mission">Sem missão aceita · Explore os lugares e converse com as pessoas.</p>';
    const tabs=a.schemaVersion===2 && a.quests.length>1 ? '<div class="btn-group mission-selector">'+a.quests.map(q=>'<button class="btn'+(q.snapshot.mission.id===a.selectedMissionId?' primary':'')+'" data-adventure-quest="'+esc(q.snapshot.mission.id)+'">'+esc(q.snapshot.mission.name)+(q.status==='completed'?' · Concluída':'')+'</button>').join('')+'</div>' : '';
    const m=adventureMission(a), p=missionProgress(m), enabled=a.status === 'in_progress' && !busy;
    return '<details class="panel adventure-mission" id="adventure-mission"' + (missionOpen ? ' open' : '') + '><summary><span>Missões aceitas · </span><strong>' + esc(m.name) + '</strong><small>' + p.completed + ' / ' + p.total + ' objetivos concluídos</small></summary><div class="form-body">' + tabs + readButton('mission','Ler missão completa') + (m.objectives.some(o=>o.completion?.mode==='automatic')?'<p class="field-hint">Conclusão automática no fim do turno. Abra um objetivo para consultar os detalhes.</p>':'') + (m.execution!=='formula' && (m.facts || []).length ? '<h3>Acontecimentos narrativos da missão</h3><p class="field-hint">Registre o que aconteceu na história. Os fatos serão avaliados no fim do turno.</p>' + m.facts.map(f => '<label class="fact-check"><input type="checkbox" data-turn-fact="' + esc(f.id) + '"' + (quest.turn.facts.find(v => v.id === f.id).value ? ' checked' : '') + (!enabled ? ' disabled' : '') + '><span><b>' + esc(f.name) + '</b><small>' + esc(f.description) + '</small></span></label>').join('') : '') + visibleAdventureNPCs(a).filter(n => m.execution!=='formula' && !n.combatant && (!n.missionId || n.missionId===a.selectedMissionId)).map(n => '<label class="fact-check"><input type="checkbox" data-turn-npc="' + esc(n.sourceId || n.id) + '"' + (a.turn.npcs.find(v => v.id === n.id).defeated ? ' checked' : '') + (!enabled ? ' disabled' : '') + '>Registrar derrota narrativa de ' + esc(n.name) + '</label>').join('') + '</div>' + objectivesHTML(a) + '</details>';
  }
  function readerHTML(a) {
    if(!reader)return '';
    let title='',body='';const m=adventureMission(a);
    if(reader.type==='character'){title=a.turn.character.name+' — ficha completa';body=characterDetails(a);}
    if(reader.type==='place'){const p=a.snapshot.world.places.find(p=>p.id===a.locationId);title=p?.name || a.snapshot.world.name;body=prose(p?.description || a.snapshot.world.description)+(p?'<dl class="sheet-fields">'+Object.entries(p.details || {}).map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(typeof value==='string'?value:JSON.stringify(value))+'</dd></div>').join('')+'</dl>':'');}
    if(reader.type==='npc'){const n=visibleAdventureNPCs(a).find(n=>n.id===reader.id);title=n?.name || 'Pessoa';body=prose(n?.description || 'Sem descrição.')+'<p class="field-hint">'+(n?.origin==='environment'?'Morador do cenário.':'Personagem desta missão.')+'</p>';}
    if(reader.type==='mission'){title=m.name;body=prose(m.description)+(m.completion!==undefined?'<details><summary>Regra de conclusão da missão</summary><pre class="condition-json">'+esc(JSON.stringify(m.completion,null,2))+'</pre><p>Todos os objetivos obrigatórios também precisam estar concluídos.</p></details>':'');}
    if(reader.type==='history'){title='Histórico completo';body=storyEntries(a).map(e=>storyEntryHTML(e,true)).join('') || prose('Nenhum acontecimento registrado.');}
    if(reader.type==='help'){title='Explorar e jogar';body='<h3>Rotas e viagens</h3><p>Rotas ligam lugares do mesmo nível. Sua distância é medida em unidades; a pé, cada avanço percorre uma unidade e consome um turno. As bolinhas mostram as etapas e o destaque indica seu progresso. Pode haver um encontro da região em cada avanço; resolva-o para continuar. Entradas e saídas entre níveis continuam independentes.</p><h3>Deslocamento</h3><p>Use os quadrados do mapa ou a lista de destinos para se deslocar. Sair de representa a saída do lugar atual para o lugar que o contém, consumindo um turno. Cada deslocamento real avança um turno e verifica os objetivos na chegada. O quadrado destacado indica o lugar onde você está, incluindo os níveis que o contêm.</p><h3>Ações e combate</h3><p>Executar uma ação ou simular uma rodada de combate avança um turno e verifica automaticamente os objetivos. Não é necessário encerrar outro turno depois.</p><h3>Encerrar turno narrativo</h3><p>Avança um turno sem ataque nem ação de missão. Use também após registrar fatos em missões antigas.</p><h3>Encontros regionais</h3><p>Ao se deslocar, pode aparecer um encontro conforme o cenário. Escolha uma opção antes de continuar; conversar, contornar ou testar consome um turno. Enfrentar abre o combate na própria aventura. A ocorrência fica salva e não é sorteada novamente ao atualizar a página.</p><h3>Missões</h3><p>Converse com as pessoas ou examine avisos para encontrar propostas. A missão só começa quando você escolhe aceitar.</p>';}
    return '<dialog id="adventure-reader" class="adventure-reader" aria-labelledby="adventure-reader-title"><div class="reader-header"><h2 id="adventure-reader-title" tabindex="-1">'+esc(title)+'</h2><button class="btn" data-adventure-action="close-reader" aria-label="Fechar leitura">Fechar</button></div><div class="reader-body">'+body+'</div></dialog>';
  }
  function closeReader() {
    reader=null;document.querySelector('#adventure-reader')?.close?.();render();
    if(readerTrigger)document.querySelector(readerTrigger)?.focus?.();readerTrigger=null;
  }
  function detailHTML() {
    const a=selected();if(!a){view='list';return listHTML();}
    return '<div class="page-head adventure-page-head"><div><h1>' + esc(a.name) + '</h1></div><div class="rule-chip">' + esc(names[a.status]) + '<small>Turno ' + a.turn.number + '</small></div></div><div class="world-toolbar"><div class="btn-group"><button class="btn" data-adventure-action="list">← Todas as aventuras</button>' + (['not_started','abandoned'].includes(a.status) ? '<button class="btn primary" data-adventure-action="start">' + (a.status === 'abandoned' ? 'Retomar aventura' : 'Iniciar aventura') + '</button>' : '') + '</div><details class="adventure-options"><summary>Opções da aventura</summary><div class="btn-group"><button class="btn" data-adventure-action="download">Baixar aventura JSON</button>' + (['not_started','in_progress'].includes(a.status) ? '<button class="btn" data-adventure-action="abandon">Abandonar</button>' : '') + '<button class="btn ghost danger" data-adventure-action="delete">Excluir aventura</button></div></details></div>' + errorHTML() + '<div class="adventure-play-layout">' + characterHTML(a) + '<div class="adventure-main">' + (combatHTML(a) || regionalEncounterHTML(a)) + locationHTML(a) + storyHTML(a) + missionHTML(a) + '</div></div>' + readerHTML(a);
  }
  function apply(command) {
    const next = changeAdventure(selected(),command);
    persist(adventures.map(a => a.id === next.id ? next : a)); error = ''; toast('Aventura salva.');
  }
  function newDraft(legacyId = null) {
    if (storageError) throw new Error('A coleção de aventuras precisa ser recuperada.');
    if (!getCharacters().length) throw new Error('Crie um personagem antes de criar a aventura.');
    if (!legacyId && !getEnvironments().length) throw new Error('Cadastre um cenário antes de criar a aventura.');
    const legacy = getLegacyProgress().find(e => e.id === legacyId);
    draft = { name:legacy?.mission.name || '', missionId:'', environmentId:getEnvironments()[0]?.id || '', locationId:initialPlaces(getEnvironments()[0]?.id).find(p=>p.id==='portao-norte')?.id || initialPlaces(getEnvironments()[0]?.id)[0]?.id || '', characterId:'', legacyId }; view = 'list';
  }
  document.addEventListener('input',e => { if (draft && e.target.dataset.adventureField) draft[e.target.dataset.adventureField] = e.target.value; });
  document.addEventListener('change',e => {
    if (busy) return;
    const t = e.target;
    try {
      if (Object.hasOwn(t.dataset,'adventureMapLevel')) {viewMapContext(selected(),t.value || null);render();document.querySelector('#adventure-map-level')?.focus?.();return;}
      if (t.dataset.turnChoice) turnChoice[t.dataset.turnChoice] = t.value;
      if (t.dataset.turnFact) apply({type:'fact',id:t.dataset.turnFact,value:t.checked});
      if (t.dataset.turnNpc) apply({type:'npc',id:t.dataset.turnNpc,defeated:t.checked});
      if (draft && t.dataset.adventureField) {draft[t.dataset.adventureField] = t.value;if(t.dataset.adventureField==='environmentId'){draft.locationId=initialPlaces(t.value)[0]?.id || '';render();}}
      if (t.dataset.adventureObjective) apply({type:'objective',id:t.dataset.adventureObjective,status:t.value});
      if (t.dataset.adventureAlternative) apply({type:'objective',id:t.dataset.adventureAlternative,alternative:t.value});
    } catch (e) { error = e.message; toast(error,true); }
    if (t.dataset.adventureObjective || t.dataset.adventureAlternative || t.dataset.turnFact || t.dataset.turnNpc || Object.hasOwn(t.dataset,'adventureMapLevel')) render();
  });
  document.addEventListener('submit',e => {
    if (e.target.id !== 'adventure-form') return; e.preventDefault();
    try {
      if (!draft) return;
      if (draft.editId) { selectedId = draft.editId; apply({type:'rename',name:draft.name}); }
      else {
        const legacy = getLegacyProgress().find(e => e.id === draft.legacyId);
        if (legacy && adventures.some(a => a.legacyId === legacy.id)) throw new Error('Esse progresso já foi convertido em aventura.');
        const mission = legacy?.mission || getMissions().find(m => m.id === draft.missionId);
        if (legacy && !mission) throw new Error('Missão anterior indisponível.');
        let world = getEnvironmentSnapshot(mission?.environmentId || draft.environmentId);
        if (legacy?.environment) {
          const env = legacy.environment;
          world = { ...(env.npcs ? {npcs:env.npcs} : {}), schemaVersion:1,name:env.name,description:env.description || '',places:env.places.map(({path,...place}) => place) };
        }
        if (!world) throw new Error('O cenário desta missão está indisponível. Restaure o cenário para continuar; o progresso segue preservado.');
        if(!legacy && (!world.places.some(p=>p.id===draft.locationId) || world.places.some(p=>p.parentId===draft.locationId)))throw new Error('Escolha um local inicial sem lugares internos.');
        const character = getCharacters().find(c => c.id === draft.characterId);
        if (!character) throw new Error('Selecione um personagem.');
        const next = createAdventure({name:draft.name,mission:legacy ? mission : undefined,environmentId:draft.environmentId,locationId:draft.locationId || null,world,rules:getRules(),character,legacyId:legacy?.id || null,preserveProgress:Boolean(legacy)});
        persist([...adventures,upgradeAdventure(next)]); selectedId = next.id; toast('Aventura criada.');
      }
      draft = null; view = 'detail'; error = '';
    } catch (e) { error = e.message; toast(error,true); }
    render();
  });
  document.addEventListener('click',async e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if(b.dataset.adventureAction==='close-reader'){closeReader();return;}
    if(busy)return;
    if(b.dataset.adventureRead){reader={type:b.dataset.adventureRead,id:b.dataset.readId || ''};readerTrigger='[data-adventure-read="'+reader.type+'"][data-read-id="'+reader.id+'"]';render();document.querySelector('#adventure-reader')?.showModal?.();document.querySelector('#adventure-reader-title')?.focus?.();return;}
    const d = b.dataset, action = d.adventureAction;
    if (!action && !Object.hasOwn(d,'adventureMapContext') && !Object.hasOwn(d,'adventureMove') && !d.adventureFight && !d.adventureMapView && !d.adventureOpen && !d.adventureEdit && !d.adventureLegacy && !d.adventureBackup && !d.adventureTalk && !d.adventureOffer && !d.adventureAccept && !d.adventureQuest && !d.adventureDelete && !d.adventureActivity && !d.adventureEncounterChoice && !d.adventureFlee && !d.adventureTravel && !d.adventureRest) return;
    try {
      error = '';
      if(Object.hasOwn(d,'adventureMapContext'))viewMapContext(selected(),d.adventureMapContext || null);
      if(d.adventureQuest)apply({type:'select-mission',missionId:d.adventureQuest});
      if(d.adventureTalk){apply({type:'talk',id:d.adventureTalk});interaction={npcId:d.adventureTalk};}
      if(d.adventureOffer){const offer=availableMissionOffers(selected(),getMissions()).find(o=>o.mission.id===d.adventureOffer);interaction={missionId:d.adventureOffer,...(offer?.offer.type==='npc'?{npcId:offer.offer.npcId}:{})};}
      if(d.adventureAccept){const mission=getMissions().find(m=>m.id===d.adventureAccept);if(!mission)throw new Error('Missão indisponível.');apply({type:'accept',mission});interaction=null;missionOpen=true;}
      if(action==='close-interaction')interaction=null;
      if(action==='map-outside'){const a=selected(),context=a.snapshot.world.places.find(p=>p.id===mapContext(a));viewMapContext(a,context?.parentId ?? null);}
      if(action==='map-focus'){mapContextOverride=undefined;mapView='inside';disclosures.set(disclosureKey('map'),true);}
      if(action==='upload-map-image'){pendingMapKey=mapImageKey(selected());document.querySelector('#adventure-map-image-file')?.click();return;}
      if(action==='remove-map-image'){localStorage.removeItem(mapImageKey(selected()));toast('Imagem removida deste mapa.');}
      if (d.adventureMapView) {mapView=d.adventureMapView;mapContextOverride=undefined;}
      if (d.adventureFight) {
        const a=selected(), def=adventureNPCs(a).find(n => n.id === d.adventureFight), npc=a.turn.npcs.find(n => n.id === d.adventureFight);
        if (a.status !== 'in_progress' || !npc?.character || npc.defeated || a.turn.character.hp <= 0 || !visibleAdventureNPCs(a).some(n => n.id === d.adventureFight)) throw new Error('Esse confronto não está disponível na localização atual.');
        combatNpcId=npc.id;turnChoice.npcId=npc.id;
      }
      if (action === 'close-combat') combatNpcId=null;
      if (d.adventureOpen) { reader=null;interaction=null; selectedId = d.adventureOpen; turnChoice = {}; combatNpcId=null;mapView='inside';mapContextOverride=undefined;missionOpen=false;draft = null; view = 'detail'; }
      if (d.adventureEdit) { const a = adventures.find(a => a.id === d.adventureEdit); if (!a) throw new Error('Aventura não encontrada.'); draft = {name:a.name,editId:a.id}; view = 'list'; }
      if (d.adventureLegacy) newDraft(d.adventureLegacy);
      if (d.adventureBackup) download(getLegacyProgress().find(e => e.id === d.adventureBackup),'progresso-anterior.json');
      if (action === 'new') newDraft();
      if (action === 'list') { view = 'list'; draft = null; }
      if (action === 'cancel') { draft = null; view = 'list'; }
      if (action === 'start' || action === 'abandon') apply({type:action});
      if (action === 'end-turn' || action === 'combat-turn' || d.adventureFlee || d.adventureTravel || d.adventureRest || d.adventureActivity || Object.hasOwn(d,'adventureMove') || d.adventureEncounterChoice) {
        const a=structuredClone(selected());
        const command={expectedTurn:a.turn.number};
        const chosenRoute=(a.snapshot.world.routes || []).find(r=>r.id===(d.adventureTravel || a.travel?.routeId)) || (Object.hasOwn(d,'adventureMove')?routeBetween(a.snapshot.world,a.locationId,d.adventureMove):null);
        if(d.adventureRest)command.rest=true;
        if(d.adventureTravel)command.travel={routeId:d.adventureTravel};
        if(d.adventureFlee)command.flee={npcId:d.adventureFlee,npcActionId:turnChoice.npcActionId};
        if(d.adventureEncounterChoice)command.encounter={occurrenceId:d.encounterId,optionId:d.adventureEncounterChoice};
        if(Object.hasOwn(d,'adventureMove'))command.move={placeId:d.adventureMove || null};
        if(d.adventureActivity)command.activity={missionId:d.activityMission,actionId:d.adventureActivity};
        if (action === 'combat-turn' && !combatNpcId) throw new Error('Abra um encontro na localização atual antes de simular o combate.');
        if (action === 'combat-turn') command.combat={npcId:a.turn.npcs.some(n => n.id === turnChoice.npcId && n.character && !n.defeated) ? turnChoice.npcId : a.turn.npcs.find(n => n.character && !n.defeated)?.id,heroActionId:turnChoice.heroActionId,npcActionId:turnChoice.npcActionId};
        busy=true;render();
        try {
          const response=await fetch('/api/adventure/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adventure:a,command})});
          let result;try {result=await response.json();} catch {throw new Error('O servidor não respondeu em JSON. Reabra o site com sua conta.');}
          if (!response.ok) throw new Error(result.error || 'Não foi possível encerrar o turno.');
          const next=validateAdventure(result);if(next.id !== a.id)throw new Error('Resposta de outra aventura.');
          persist(adventures.map(item => item.id === a.id ? next : item));
          if(command.encounter && !currentRegionalEncounter(next))combatNpcId=null;
          if(command.flee){if(next.turn.history.at(-1).events[0]?.includes('Você escapou'))combatNpcId=null;else {combatNpcId=command.flee.npcId;turnChoice.npcId=combatNpcId;}}
          if(command.move || command.travel){combatNpcId=null;mapView='inside';mapContextOverride=undefined;interaction=null;if(chosenRoute && !next.travel)disclosures.set(disclosureKey('map'),true);}
          toast('Turno ' + next.turn.number + ' encerrado. Objetivos verificados.');
        } finally {busy=false;}
      }
      if (action === 'download') download(selected(),'aventura.json');
      if (action === 'recovery') download(preservedRaw,'aventuras-recuperacao.json');
      if (action === 'delete' || d.adventureDelete) { const old = d.adventureDelete ? adventures.find(a=>a.id===d.adventureDelete) : selected(); if(!old)throw new Error('Aventura não encontrada.'); persist(adventures.filter(a => a.id !== old.id)); undo = old; selectedId = null; view = 'list'; toast('Aventura excluída. Você pode desfazer.'); }
      if (action === 'undo' && undo) { persist([...adventures,undo]); undo = null; }
    } catch (e) { error = e.message; toast(error,true); }
    render();
    if((Object.hasOwn(d,'adventureMove') || d.adventureTravel) && selected() && currentRegionalEncounter(selected()))document.querySelector('#regional-encounter')?.scrollIntoView?.({block:'start'});
    if(Object.hasOwn(d,'adventureMapContext'))document.querySelector('[data-adventure-map-context="'+d.adventureMapContext+'"]')?.focus?.();
    if(d.adventureTravel && selected() && !currentRegionalEncounter(selected()))document.querySelector('.adventure-location')?.scrollIntoView?.({block:'start'});
    if (d.adventureFight || action==='combat-turn' || d.adventureFlee) document.querySelector('#adventure-combat')?.scrollIntoView?.({block:'start'});
  });
  document.addEventListener('change',async e=>{
    if(e.target.id!=='adventure-map-image-file')return;
    const file=e.target.files?.[0], key=pendingMapKey;e.target.value='';pendingMapKey=null;
    if(!file || !key || mapImageBusy)return;
    mapImageBusy=true;error='';render();
    try {
      const image=await prepareMapImage(file);
      try { localStorage.setItem(key,JSON.stringify(image)); } catch {throw new Error('Não foi possível salvar a imagem. Libere espaço neste navegador e tente novamente.');}
      toast('Imagem de fundo salva para este mapa.');
    } catch(e){error=e.message;toast(error,true);}
    finally {mapImageBusy=false;render();}
  });
  document.addEventListener('cancel',event=>{if(event.target.id==='adventure-reader'){event.preventDefault();closeReader();}},true);
  document.addEventListener('toggle',event => { if(event.target.dataset?.adventureDisclosure && event.target.isConnected!==false)disclosures.set(disclosureKey(event.target.dataset.adventureDisclosure),event.target.open); if (event.target.id === 'adventure-mission' && event.target.isConnected !== false) missionOpen=event.target.open; },true);
  return { init, isViewing:() => view === 'detail' && Boolean(selected()), html:() => view === 'detail' ? detailHTML() : listHTML(), showList() { view = 'list'; draft = null; error = ''; } };
}
