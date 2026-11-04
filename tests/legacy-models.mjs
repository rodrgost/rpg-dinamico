// Explicit legacy generators keep compatibility regression tests on their original format.
export * from '../src/mission.mjs';
import {createMissionTemplate as modernTemplate,createPortoAuroraMission as modernPorto} from '../src/mission.mjs';
export const createMissionTemplate=(env,id)=>modernTemplate(env,id,{legacy:true});
export const createPortoAuroraMission=(env,id)=>modernPorto(env,id,{legacy:true});
