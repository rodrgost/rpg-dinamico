import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorld} from '../src/world.mjs';
import {createMissionTemplate,resolveMissionNPCs} from '../src/mission.mjs';
const world=validateWorld(JSON.parse(readFileSync(new URL('./fixtures/porto-aurora.json',import.meta.url))));
test('Porto Aurora defaults populate the city and reuse residents in the mission without duplicates',()=>{
  const environment={...world,id:'default-world'};
  const mission=createMissionTemplate(environment);
  for(const place of world.places.filter(p=>p.parentId==='porto-aurora')) assert.ok(world.npcs.some(n=>n.placeId===place.id),place.id);
  const catalog=resolveMissionNPCs(environment,mission);
  assert.equal(new Set(catalog.map(n=>n.id)).size,catalog.length);
  assert.equal(mission.npcs.filter(n=>n.environmentNpcId).length,world.npcs.length);
  assert.equal(catalog.filter(n=>n.combatant).length,3);
  assert.ok(catalog.every(n=>n.description));
  const witness=catalog.find(n=>n.id==='testemunha-taverna');
  assert.deepEqual(witness.presence,{operator:'eq',left:{ref:'objetivos.ouvir-pedido.concluido'},right:true});
});
test('generic mission model includes own NPCs, conditional presence and optional ambient reference',()=>{
  const env={id:'other',places:[{id:'station'}],npcs:[{id:'resident',name:'Resident',placeId:'station',combatant:null,presence:null}]};
  const mission=createMissionTemplate(env);
  assert.equal(mission.npcs.length,4);
  assert.equal(resolveMissionNPCs(env,mission).length,4);
  assert.equal(mission.npcs[1].presence.left.ref,'objetivos.obter-registro.concluido');
  assert.ok(mission.npcs.slice(0,2).every(n=>n.placeId==='station'));
  const empty=createMissionTemplate({id:'empty',places:[]});
  assert.equal(empty.npcs.length,3);
  assert.ok(empty.npcs.every(n=>n.placeId===null));
});
