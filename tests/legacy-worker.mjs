// Porto Aurora remains a regression fixture for its existing place/NPC/mission flows.
import worker from '../worker/index.js';
import {readFileSync} from 'node:fs';
const porto=readFileSync(new URL('./fixtures/porto-aurora.json',import.meta.url),'utf8');
export default {fetch(request,...args){if(new URL(request.url).pathname==='/worlds/example.json' && request.method==='GET')return new Response(porto,{headers:{'Content-Type':'application/json'}});return worker.fetch(request,...args);}};
