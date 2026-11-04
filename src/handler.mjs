const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...responseHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const assets = { '/': [PAGE, 'text/html; charset=utf-8'], '/app.js': [APP, 'text/javascript; charset=utf-8'], '/style.css': [STYLE, 'text/css; charset=utf-8'], '/engine.mjs': [ENGINE, 'text/javascript; charset=utf-8'], '/world.mjs': [WORLD_ENGINE, 'text/javascript; charset=utf-8'], '/world-ui.mjs': [WORLD_UI, 'text/javascript; charset=utf-8'], '/worlds/example.json': [JSON.stringify(EXAMPLE_WORLD, null, 2), 'application/json; charset=utf-8'], '/rules/3det-adaptavel.json': [JSON.stringify(DEFAULT_RULES, null, 2), 'application/json; charset=utf-8'] };
        assets['/mission.mjs'] = [MISSION_ENGINE, 'text/javascript; charset=utf-8'];
        assets['/mission-ui.mjs'] = [MISSION_UI, 'text/javascript; charset=utf-8'];
        assets['/adventure.mjs'] = [ADVENTURE_ENGINE, 'text/javascript; charset=utf-8'];
        assets['/adventure-ui.mjs'] = [ADVENTURE_UI, 'text/javascript; charset=utf-8'];
        assets['/theme.js'] = [THEME, 'text/javascript; charset=utf-8'];
        assets['/npc-ui.mjs'] = [NPC_UI,'text/javascript; charset=utf-8'];
        const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
        if (!asset) return jsonResponse({ error: 'Rota não encontrada.' }, 404);
        return new Response(request.method === 'HEAD' ? null : asset[0], { headers: { ...responseHeaders, 'Content-Type': asset[1], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" } });
      }
      if (request.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);
      const body = await request.text();
      const bodyLimit=['/api/adventure','/api/adventure/turn','/api/mission'].includes(url.pathname) ? 1000000 : 256000;
      if (body.length > bodyLimit) return jsonResponse({ error: 'O JSON deve ter até ' + bodyLimit / 1000 + ' KB.' }, 413);
      let data;
      try { data = JSON.parse(body); } catch { return jsonResponse({ error: 'Corpo JSON inválido.' }, 400); }
      if (url.pathname === '/api/world') return jsonResponse(validateWorld(data?.world));
      if (url.pathname === '/api/mission') return jsonResponse(validateMission(data?.mission, data?.environments));
      if (url.pathname === '/api/adventure/turn') return jsonResponse(finishAdventureTurn(data?.adventure, data?.command));
      if (url.pathname === '/api/adventure') return jsonResponse(validateAdventure(data?.adventure));
      const rules = validateRules(data?.rules);
      if (url.pathname === '/api/rules') return jsonResponse(rules);
      if (url.pathname === '/api/character') return jsonResponse(createCharacter(rules, data.character, data.current === true));
      if (url.pathname === '/api/round') return jsonResponse(simulateRound(rules, data));
      return jsonResponse({ error: 'Rota não encontrada.' }, 404);
    } catch (error) {
      return jsonResponse({ error: error instanceof RuleError || error instanceof WorldError || error instanceof MissionError || error instanceof AdventureError ? error.message : 'Não foi possível processar esta entrada. Verifique os dados enviados.' }, 400);
    }
  }
};
