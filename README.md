# 3D&T Adaptável — simulador privado

MVP de RPG com regras externas JSON, criação de fichas, habilidades declarativas, testes de atributo e combate de dois personagens por rodada. Os cálculos são executados por um Worker no servidor; a sessão é persistida no navegador, sem banco de dados ou integração com LLM nesta versão.

## Executar as verificações

```sh
node --test tests/engine.test.mjs tests/world.test.mjs tests/world-ui.test.mjs
node scripts/assemble.mjs
bash scripts/build.sh
node scripts/validate-artifact.mjs
node --test tests/worker.test.mjs
```

`src/rules.json` é o conjunto inicial. Ele é servido externamente em `/rules/3det-adaptavel.json`, pode ser baixado, editado e substituído na interface. `schemaVersion: 1` define o contrato suportado neste MVP.

- Atributos: lista com id, nome, mínimo, máximo, valor padrão e custo.
- Criação: orçamento, obrigatoriedade de usar todos os pontos e campos text, textarea ou select.
- Recursos: fórmulas determinísticas para hp e mana.
- Habilidades: custo e bônus numéricos de attack, defense e test.
- Ações: fórmulas e tipos attack ou test.
- Combate: iniciativa, defesa, dano, comparação de acerto e desempate por ordem da lista.

Fórmulas usam um interpretador restrito, sem eval: números, variáveis, +, -, *, /, parênteses, dados e max/min/floor/ceil. Nomes de variáveis desconhecidos e divisões por zero são rejeitados. Dados permitidos: 1–10 dados de 2–100 faces. Não há crítico automático, falha automática, estados persistentes ou consumo de mana.

O exemplo preserva o orçamento de 8 pontos, cinco atributos entre 0 e 5, PV = Resistência × 5, mana zero, iniciativa H+d6, ataques H+F/PdF+d6 e defesa H+A+d6. Habilidades incluídas são exemplos da adaptação. Resistência zero implica PV zero e impede entrar em combate até editar a ficha.

Uma rodada valida todas as escolhas, rola a iniciativa, executa uma ação por personagem vivo e bloqueia a ação de quem ficou incapacitado antes de agir. Empates de iniciativa favorecem o primeiro combatente. Empates de ataque/defesa são defendidos. Dano nunca é negativo e PV nunca ficam abaixo de zero.

Modo reproduzível: usa a semente inicial + número de rodadas concluídas. Reiniciar recupera PV e limpa o registro; simular com a mesma semente, fichas e ações reproduz o resultado. Mudar combatentes, fichas ou modo de dados reinicia o combate. Aplicar um JSON limpa todas as fichas e resultados.

Hospedagem privada é controlada pelo Sites e restrita ao proprietário. O código não contém um mecanismo de compartilhamento nem altera o público do site.

## Cenários

A aba Cenários possui uma árvore navegável e pesquisável, caminho até o lugar selecionado, descrição, detalhes, criação, edição, mudança de lugar pai e exclusão de folhas com desfazer. Tipos são livres: planeta, país, cidade, estabelecimento ou sala, sem ordem obrigatória.

`src/world.json` é servido em `/worlds/example.json`. O formato independente usa `schemaVersion: 1`, `name`, `description` e `places`. Cada lugar tem `id` único, `parentId` (ou `null` para raiz), `name`, `type`, `description` e um objeto `details` descritivo. Não há objetos, inventários, produtos, recompensas ou progresso de missões neste módulo. NPCs residentes são modelos vinculados a lugares, conforme a seção abaixo.

O editor permite carregar arquivo, editar, validar, confirmar substituição e baixar o JSON. A API `/api/world` também valida a hierarquia. Até 500 lugares, 64 níveis e 240 KB; rejeita IDs duplicados, pais inexistentes e ciclos. Cenários usam uma chave própria no armazenamento local e não alteram regras, fichas ou combate. Os dados permanecem neste navegador; exporte o JSON para transportá-los.

### Vários cenários

A página inicial da aba lista cenários independentes com nome, descrição e quantidade de lugares. Novo cenário cria um cenário vazio; Editar cenário altera nome e descrição; Abrir lugares permite trabalhar na árvore daquele cenário. Importar novo cenário adiciona um cenário por JSON sem substituir os demais; editar/aplicar o JSON dentro de um cenário substitui somente aquele cenário.

A coleção é persistida em `3det-adaptavel-worlds-v2`. Na primeira abertura, o cenário do armazenamento antigo `3det-adaptavel-world-v1` é migrado automaticamente e a cópia antiga permanece intacta. IDs de lugares podem se repetir em cenários diferentes. Os dados continuam locais ao navegador.

## Missões

A entidade Missão possui `schemaVersion: 1`, `id`, `environmentId`, `name`, `description` e uma lista de 1 a 50 `objectives`. O cenário é obrigatório e usa o ID estável da coleção de cenários, não o nome. A edição do nome de um cenário não rompe vínculos.

Cada objetivo contém `id`, `type`, `title`, `description`, `target`, `placeId` opcional, `completionCriteria` e `status`. Tipos: `combat`, `skill_test`, `find_item`, `investigate`, `help_someone` e `other`. Alvos, habilidades e itens são referências textuais, independentes do sistema de combate e do tipo de cenário. Não há criação automática de itens ou inventários; NPCs narrativos ou com ficha são definidos explicitamente no cenário e na missão.

No cadastro de Missões, todos os objetivos são modelos com situação `pending` e alternativa `null`. As situações `pending`, `in_progress` e `completed` são acompanhadas manualmente dentro de Aventuras. O progresso da missão deriva dos objetivos; todos precisam estar concluídos para concluir a missão. A ordem da lista serve para apresentação. Dependências explícitas em `dependsOn` exigem todos os pré-requisitos concluídos; sem dependências, o objetivo permanece livre. Um objetivo pode estar associado a um lugar do mesmo cenário, ou ficar sem lugar específico.

A aba permite listar e filtrar missões por cenário, buscar, criar, editar, reordenar objetivos, excluir com desfazer e importar/exportar JSON. A importação pela listagem sempre adiciona uma nova missão com novo ID; o editor JSON de uma missão existente atualiza somente ela. Ao transportar o JSON para outro navegador ou cenário, escolha explicitamente o cenário de destino, pois cenários importados recebem um novo ID. Os lugares do documento precisam existir no destino escolhido.

`/api/mission` valida o documento e seus vínculos usando o catálogo de cenários enviado pelo cliente. Como o armazenamento continua local ao navegador, esse catálogo é o contexto de validação; não há banco central de missões. `src/mission.mjs` concentra a validação compartilhada. A chave `3det-adaptavel-missions-v1` é independente dos cenários e da sessão de combate. Limites: até 200 missões na coleção e até 120 KB por missão.

A exclusão de um lugar ou a substituição do JSON de um cenário é bloqueada se remover um lugar referenciado por um objetivo. Primeiro edite ou remova o vínculo na missão. Mudar o cenário de uma missão na ficha limpa as escolhas de lugar explicitamente; títulos e descrições dos objetivos permanecem. Missões salvas com um vínculo indisponível são mantidas para correção. Uma coleção ilegível não é sobrescrita e pode ser baixada para recuperação.

Validação completa: `node scripts/assemble.mjs && node --test tests/*.test.mjs`. Os testes de interface acionam os handlers reais e a API do Worker com um adaptador de eventos; não substituem uma conferência visual em navegador.


### Importação direta e geração em outro LLM

A listagem oferece **Importar JSON** (abre diretamente o seletor de arquivo), **Colar JSON** (abre o editor vazio) e **Modelo para outro LLM**. A página do modelo permite escolher um cenário, baixar/copiar o JSON completo e baixar/copiar as instruções para geração externa. O prompt inclui os IDs reais, a hierarquia, as descrições e os detalhes dos lugares do cenário selecionado, além do contrato e de um exemplo válido. O texto só é compartilhado com outro serviço por ação do usuário.

Para cenários genéricos, o exemplo gerado por `createMissionTemplate` contempla os seis tipos de objetivo, campos opcionais, dependências simples e múltiplas e três caminhos alternativos para um objetivo. Para o cenário expandido de Porto Aurora, essa função usa o modelo narrativo de 24 objetivos descrito abaixo. Todos começam pendentes. O modelo e o prompt são gerados no navegador para evitar IDs fictícios de cenário. O fluxo testado baixa o modelo, carrega exatamente esse conteúdo pelo seletor de arquivos, valida no Worker e adiciona a missão sem alterar as anteriores.

Campos adicionais dos objetivos (retrocompatíveis com schemaVersion 1):

- `dependsOn`: IDs de outros objetivos da mesma missão; padrão `[]`. Todos precisam estar concluídos antes de iniciar o objetivo. Ciclos, referências inexistentes, auto-referências e IDs repetidos são rejeitados. Não é possível reabrir um pré-requisito sem antes retornar seus dependentes ativos/concluídos para pendente.
- `alternatives`: até 10 caminhos; padrão `[]`. Cada caminho contém `id`, `type`, `title`, `description`, `target`, `placeId` e `completionCriteria`. Basta uma alternativa para cumprir o objetivo; não são novos objetivos obrigatórios. Sem alternativas, o critério do objetivo define a solução direta.
- `completedAlternativeId`: `null` ou um ID existente na lista de alternativas desse objetivo. Deve estar preenchido antes de concluir um objetivo que possui alternativas. Na tela de acompanhamento, selecione o caminho realizado e depois conclua o objetivo.

A interface apresenta as dependências, bloqueios, alternativas e a seleção do caminho realizado. A definição de dependências e alternativas é feita no JSON; a edição normal de títulos, descrição e outros campos preserva essas estruturas. Remover um objetivo usado como pré-requisito exige retirar primeiro o vínculo no JSON. Referências de lugares também são verificadas nas alternativas e protegidas contra exclusão/substituição do cenário. Todos os objetivos continuam obrigatórios. O progresso de missões antigas é preservado em registros anteriores e convertido em aventura mediante escolha de personagem.


## Aventuras

A aba Aventuras lista partidas independentes, permite criar (nome, missão e um personagem), editar o nome, abrir, iniciar, abandonar, retomar, excluir com desfazer e baixar o documento JSON como cópia. O arquivo baixado é uma cópia de segurança para consulta; a importação de aventuras ainda não está disponível. Fichas e missões precisam ser cadastradas antes da criação.

Cada aventura guarda `schemaVersion: 1`, `id`, `name`, `status`, `snapshot` (cenário, missão, regras e personagem), `progress` (ID, situação e alternativa realizada de cada objetivo), `createdAt`, `updatedAt`, `startedAt`, `completedAt`, `abandonedAt` e `legacyId`. A ficha começa com PV completos. A cópia das regras também é independente; editar ou remover cadastros não altera partidas já criadas. O cenário da cópia contém seus lugares e descrições, consultáveis junto à ficha na aventura.

Situações: `not_started`, `in_progress`, `completed` e `abandoned`. Iniciar libera o acompanhamento. Todos os objetivos concluídos encerram automaticamente a aventura; reabrir um objetivo reabre a partida. Dependências precisam ser concluídas antes de iniciar seus dependentes; um pré-requisito só pode ser reaberto depois de seus dependentes voltarem a pendente. A escolha de uma alternativa é obrigatória para concluir objetivos que possuem caminhos alternativos. Abandonar preserva o progresso e permite retomar. Itens e XP ficam para uma etapa futura; o combate de NPCs e a avaliação automática por turno estão descritos abaixo.

A coleção fica em `3det-adaptavel-adventures-v1`, com até 200 partidas. `src/adventure.mjs` concentra criação, transições e validação; `/api/adventure` valida documentos completos (requisição até 1 MB, documento até 900 KB). O acompanhamento na interface usa o mesmo módulo de domínio. Não há sincronização entre dispositivos.

Na primeira leitura de missões antigas com progresso, uma gravação atômica transforma os cadastros em modelos pendentes e preserva os documentos completos em `legacyProgress` da mesma coleção. Guarda também o cenário existente naquele momento. Se a gravação falhar, o documento antigo permanece intacto e alterações são bloqueadas para recuperação. O registro preservado aparece em Aventuras para escolher explicitamente um personagem; nenhum personagem é atribuído automaticamente. Sua conversão registra as datas atuais, pois não havia datas anteriores. A referência `legacyId` impede conversão repetida enquanto a aventura existir. A cópia anterior continua disponível após a conversão. Ao importar uma missão com progresso, aplica-se a mesma preservação.

Verificações: `node scripts/assemble.mjs`, `node --test tests/*.test.mjs`, `bash scripts/build.sh`, `node scripts/validate-artifact.mjs`. A suíte cobre independência das cópias, ciclo completo, bloqueios, alternativas, persistência, falha de armazenamento, migração idempotente e conversão sem perda. A integração de UI usa os handlers reais com DOM adaptado e não substitui inspeção visual de navegador.


A página **Combate** reúne a simulação de rodadas e a seção **Regras do combate**, com carregamento, edição, validação, aplicação e download do JSON. O atalho no início da página leva ao editor. O JSON também define atributos, criação de fichas, habilidades e recursos; a antiga aba isolada Regras JSON foi incorporada a Combate. Carregar um arquivo abre o editor nesta mesma página; aplicar outro conjunto mantém o comportamento de limpar fichas e registro da arena.

## Mapa pixelado dos cenários

Cada lugar agora possui `x` e `y` fixos, relativos ao lugar pai (`parentId`). No nível principal, são relativos ao próprio cenário. São números de 0 a 100, com origem no canto superior esquerdo; X cresce para a direita e Y para baixo. Decimais são aceitos. Ambos devem ser informados juntos ou ambos podem ser `null`. Documentos antigos sem os campos são normalizados para `null`.

Em Cenários → Abrir lugares, alterne entre **Árvore de lugares** e **Mapa pixelado**. O mapa apresenta somente os filhos diretos do nível atual. Cada lugar posicionado é um quadrado de 8 pixels com área de interação maior para mouse, toque e teclado. Entrar pelo quadrado ou pela lista abre os lugares internos. **Subir um nível** e o caminho completo permitem retornar a qualquer superior. A localização mostra todos os ancestrais, expressando que um lugar também está contido nos níveis acima. O mapa é uma representação esquemática; coordenadas iguais são permitidas, e a lista garante acesso aos lugares sobrepostos.

Lugares sem posição têm lista própria e continuam navegáveis. A ficha de lugar permite editar X e Y e mostra a posição atual. Ao trocar o pai pelo formulário, as coordenadas são limpas para serem redefinidas no novo espaço. A edição por JSON pode definir o novo pai e suas coordenadas explicitamente. Importação, exportação, validação da API e cópias de cenário das novas aventuras preservam as coordenadas.

A navegação muda o espaço consultado no cadastro de Cenários. Não aplica deslocamentos a personagens nem calcula distâncias ou territórios nesta versão. Tamanho, contorno e outras propriedades espaciais ficam para definição posterior. O exemplo de cenário já inclui posições em todos os níveis.


O cenário de exemplo possui 16 lugares com coordenadas, incluindo 12 lugares diretamente em Porto Aurora: mercado, praça, cais, taverna, estalagem, ferraria, templo, biblioteca, sede da guarda, farol, portão norte e jardim. A sala dos fundos permanece dentro do mercado. Para aplicar o modelo em um cenário já salvo, abra seu JSON, use **Carregar exemplo no editor**, **Validar e aplicar** e confirme a substituição.


## Missão padrão de Porto Aurora

**Carregar missão de exemplo**, na listagem de Missões, prepara **Porto Aurora: a Noite das Marés**. O botão abre o JSON com validação no Worker e o ID real do cenário. **Adicionar como nova missão** salva uma cópia editável com novo ID, preservando as missões já cadastradas. O modelo também é usado em **Modelo para outro LLM**, em seus downloads e no botão **Carregar modelo completo** quando o cenário contém a hierarquia expandida de Porto Aurora.

O enredo envolve a tempestade, a sabotagem do farol, os mantimentos desviados e o acolhimento dos moradores. São 24 objetivos obrigatórios dos seis tipos, distribuídos por todos os 12 lugares diretamente na cidade e pela sala dos fundos do mercado. Dezoito objetivos podem começar livremente; seis possuem dependências reais (investigação antes de descoberta, componentes e acesso antes de reparo, evidências antes de interceptação). Os três confrontos oferecem três caminhos cada, incluindo soluções pacíficas. Cada objetivo e alternativa possui descrição, alvo, lugar e critério de conclusão próprios. Todos começam pendentes, sem alternativa selecionada.

`createPortoAuroraMission(environment, missionId)` gera e valida o modelo. `supportsPortoAuroraMission` verifica os IDs e relações de contenção necessários. Se o cenário ainda usa o exemplo antigo ou está incompleto, a interface explica como carregar o cenário atualizado; não inventa referências de lugares. Cenários genéricos continuam usando o modelo de seis objetivos. O exemplo inclui três fichas de NPCs para o combate; suprimentos e evidências são fatos narrativos, sem inventário automático. O progresso pertence à aventura criada a partir da missão.

As verificações cobrem referências aos lugares, os seis tipos, os 24 objetivos, a conclusão em ordem livre por alternativas pacíficas, a prévia no editor, persistência sem sobrescrever missões, exportação e uso do modelo contextual no fluxo de LLM.


## Execução de missões ao fim do turno

A missão define as condições; a aventura conserva o estado usado para verificá-las. Objetivos sem `completion`, ou com `{"mode":"manual"}`, continuam manuais. Um objetivo automático usa:

```json
{
  "completion": {
    "mode": "automatic",
    "evaluateAt": "turn_end",
    "condition": {"type": "npc_defeated", "npcId": "capitao-contrabandistas"}
  }
}
```

Esse ID precisa existir em `mission.npcs`. Cada NPC contém `id`, `name`, `placeId` e `combatant` (null ou uma ficha com `attributes`, `abilities`, `fields`). As fichas são validadas pelas regras copiadas na aventura; IDs de NPCs e do personagem precisam ser distintos. `mission.facts` declara fatos com `id`, `name`, `description` e `initialValue` booleano (false por padrão). Nenhuma condição cria inventário ou concede XP.

Condições suportadas:

- `npc_defeated` com `npcId`: consulta a derrota do NPC da própria partida. Para NPC com ficha, derrota corresponde a PV zero; para NPC sem ficha, a interface permite registrar a derrota narrativa.
- `fact_equals` com `factId` e `value` booleano: consulta um acontecimento narrativo registrado pelo jogador/mestre. Ex.: documento recuperado ou rendição aceita. A declaração do fato é manual; sua aplicação aos objetivos ocorre automaticamente no encerramento do turno.
- `objective_completed` com `objectiveId`: consulta a conclusão de outro objetivo.
- `all` ou `any` com `conditions`: todos ou ao menos um dos filhos. Até 20 filhos por grupo, 6 níveis e 100 nós por árvore. Referências inexistentes, campos arbitrários e ciclos entre condições e dependências são rejeitados. Não há eval nem execução de scripts.

Um objetivo automático com alternativas exige `condition` em cada alternativa. No encerramento, sua condição principal e a condição de ao menos uma alternativa precisam ser verdadeiras. O primeiro caminho atendido na ordem da lista é registrado. Os pré-requisitos de `dependsOn` continuam obrigatórios. O avaliador repete a passagem até estabilizar: um objetivo concluído pode liberar outro no mesmo turno, independentemente da ordem na lista. Depois de concluído, o objetivo automático fica preservado mesmo que um fato mude; não pode ser reaberto ou concluído pelos controles manuais.

A interface de Aventuras apresenta **Turnos da aventura**, NPCs com PV, fatos narrativos, **Encerrar turno narrativo e verificar objetivos** e **Simular rodada e encerrar turno**. A rodada usa o motor de combate no servidor contra um NPC selecionado, atualiza os PV do personagem e do NPC e somente então avalia as condições. A arena independente continua separada. Nesta versão, os turnos de combate da aventura permitem escolher ataques; os testes narrativos podem ser conduzidos e seus resultados registrados como fatos.

`finishAdventureTurn` concentra a transição e é servido em `/api/adventure/turn`, com `{adventure, command: {expectedTurn, combat?}}`. `combat` recebe `npcId`, `heroActionId` e `npcActionId`; o modo reproduzível pode receber `seed` no comando. `expectedTurn` precisa coincidir com o contador da partida. A interface bloqueia envios durante a requisição e só altera a coleção depois de gravar o resultado com sucesso.

A aventura possui `turn` com `number`, `character` atual, `npcs`, `facts` e `history`. Fichas iniciais permanecem na cópia imutável; as fichas em jogo conservam atributos e dados de criação, permitindo alterar PV pelo combate. Cada objetivo concluído automaticamente conserva `completedTurn` e `completionReason`. O histórico mostra ações, dano, verificações atendidas, pendências e encerramento da aventura. Guarda até os 20 turnos mais recentes, podendo reduzir essa quantidade para manter o documento dentro do limite de tamanho. A conclusão de todos os objetivos obrigatórios encerra a aventura.

Aventuras antigas recebem o estado de turno inicial sem perder o progresso; suas cópias de missão não ganham regras novas automaticamente. Para experimentar a automação de Porto Aurora, carregue uma nova cópia da missão de exemplo e crie uma nova aventura. O exemplo possui 24 objetivos, dez automáticos, três NPCs de 8 pontos e treze fatos narrativos. Para outro sistema ou orçamento, adapte as fichas de NPCs no JSON antes de iniciar.

A suíte cobre dano e derrota antes da avaliação, conclusão no mesmo turno, all/any, alternativas, dependências fora de ordem, preservação da conclusão, rejeição de scripts e referências inválidas, migração, histórico, API e fluxo real da interface, inclusive falha de rede e de armazenamento. A conferência visual de navegador não está disponível neste cenário.

## Modo noturno

O botão no topo alterna entre modo claro e noturno em todas as páginas, incluindo mapa, formulários, editores e registros de turnos. A preferência fica em `3det-adaptavel-theme-v1`, separada dos dados do jogo. Sem escolha salva, segue `prefers-color-scheme` do sistema. `theme.js` aplica o tema antes da folha de estilo e mantém rótulo acessível, tema do navegador e abas abertas sincronizados. Se o armazenamento estiver bloqueado, a alternância continua funcionando durante a visita.


## Aventura com foco no personagem e na localização

Ao abrir uma aventura, a ficha atual do personagem fica em destaque junto ao mapa do local e ao histórico. A ficha mostra PV em jogo, mana, atributos, habilidades, campos de identidade e localização. A descrição da missão, seus fatos e objetivos ficam na seção recolhida **Missão vinculada**. Nesta etapa, o cadastro ainda exige uma missão; tornar esse vínculo opcional fica para a próxima mudança de modelo.

`mission.startPlaceId` é um lugar inicial opcional do próprio cenário. O novo exemplo de Porto Aurora começa em `portao-norte`. Aventuras sem localização recebem o local inicial da sua cópia de missão, o primeiro objetivo com lugar ou o primeiro lugar do cenário; sem lugares, usam `null`, representando a visão geral do cenário. As partidas antigas preservam seus PV e objetivos. A localização é guardada em `adventure.locationId` e não altera o cadastro do cenário ou da ficha original.

O mapa mostra os lugares internos quando existem; em espaços sem lugares internos, mostra os arredores dentro do superior. As opções **Lugares internos** e **Arredores** alteram a visão, enquanto clicar em um quadrado ou destino efetivamente desloca o personagem. **Subir** leva ao lugar superior. Deslocamentos são possíveis para filhos, irmãos e pai, sem saltos arbitrários entre ramos; o personagem pertence também a todos os ancestrais mostrados no caminho. Lugares sem X e Y continuam acessíveis na lista. A movimentação exige a aventura iniciada/retomada e um personagem com PV. Partidas concluídas permitem explorar o mapa; o ciclo de vida desacoplado de missões ainda será tratado posteriormente.

O diário (`journal`) guarda até 200 registros com ID, data, tipo, texto, lugar e turno, incluindo chegada inicial, deslocamentos, fatos e mudanças manuais de objetivos. O histórico combina esses registros com os resultados dos turnos e inclui verificações de objetivos em detalhes recolhidos. Cada deslocamento real encerra um turno automaticamente e avalia os objetivos na chegada. Consultar os níveis do mapa não avança o turno.

A seção de encontros apresenta somente NPCs do lugar atual, além dos NPCs sem lugar específico. **Abrir combate** exibe os dois combatentes e suas ações na própria página. A ficha e os PV são atualizados pela rodada; **Voltar ao mapa** recolhe o painel sem restaurar os PV. Não existem regras adicionais de fuga nesta versão. O servidor também impede combater um NPC localizado em outro lugar, independentemente dos controles da interface.

Para aplicar o início no Portão Norte, carregue uma nova cópia da missão de exemplo e crie uma nova aventura. O novo layout e a navegação também funcionam nas aventuras existentes. Os testes cobrem criação, migração de localização, movimento por hierarquia, bloqueio de saltos e confrontos distantes, diário, persistência, falha de salvamento e combate na página com PV atualizados. A inspeção visual em navegador continua indisponível neste cenário.


## NPCs do cenário e da missão

Em **Cenários → Abrir lugares → NPCs do cenário**, cadastre, edite, mova para outro lugar ou remova moradores. A ficha de um lugar também apresenta seus NPCs e o acesso ao gerenciamento. Em **Missões → Editar missão → NPCs desta missão**, crie personagens exclusivos ou escolha **Usar NPC do cenário pelo ID**. Alterações nos NPCs da missão ficam no rascunho até usar **Salvar missão**. Os dois formulários são independentes, sem forms aninhados. Há exclusão com desfazer e edição de fichas/presença em JSON, além de um exemplo de ficha de 8 pontos para o 3D&T.

O cenário aceita `npcs` (até 100). A missão aceita até 20 registros próprios ou referências. NPC próprio possui `id`, `name`, `description` (até 4000), `placeId`, `combatant` opcional e `presence` opcional. O formulário exige um lugar existente. Ficha vazia significa NPC narrativo. `presence` é uma árvore declarativa com os mesmos tipos das condições de objetivos, ou null para presença permanente. No cenário, condições consultam a derrota de NPCs do próprio cenário (diretamente ou com all/any); condições de fatos e objetivos pertencem aos NPCs próprios da missão. IDs, referências, tipos, profundidade e limites são validados. A presença não pode depender da derrota do próprio NPC.

Referência de missão ao cenário:

```json
{"id":"guarda-portao","environmentNpcId":"guarda-portao"}
```

A referência herda descrição, lugar, ficha e presença do cenário; não admite sobrescrever esses campos. `id` pode ser omitido na entrada e é normalizado para `environmentNpcId`. Um NPC do cenário aparece na aventura mesmo sem ser referenciado pela missão. A referência torna seu ID utilizável pelas condições da missão. Um NPC próprio não pode reutilizar o ID de um morador do cenário; nesse caso é preciso usar a referência explícita. Remover um NPC referenciado por uma missão é bloqueado até retirar a referência. Remover um lugar com NPCs também é bloqueado até mover ou excluir seus habitantes.

Na aventura, `adventureNPCs` resolve os dois catálogos e deduplica referências; `visibleAdventureNPCs` considera o lugar EXATO e a condição de presença. Entrar numa sala não exibe habitantes do prédio ou da cidade. NPCs antigos sem lugar ficam visíveis somente se a localização do personagem também for null. A seção **Pessoas neste lugar** mostra nome, descrição, origem e estado; um NPC com ficha permite abrir combate na página. O servidor revalida lugar e presença, impedindo confrontos com personagens ocultos ou distantes. As condições de presença são atualizadas ao registrar objetivos/fatos e ao encerrar os turnos.

Cada NPC possui um único registro em `turn.npcs`, com ID, localização atual (`placeId`), ficha/PV e derrota. As definições e a origem vêm das cópias de cenário e missão. Alterações durante a partida não modificam esses cadastros nem outras aventuras. Uma condição `npc_defeated` de uma missão pode consultar um morador referenciado e utilizar o mesmo estado já existente, sem criar outro personagem.

Novos cadastros entram em NOVAS aventuras. Aventuras já criadas preservam suas cópias anteriores; não são atualizadas silenciosamente. Para testar os novos exemplos, carregue o cenário atualizado, depois uma nova missão de exemplo e crie uma aventura. O cenário inclui Ivo no Portão Norte, Mara na taverna e Lia na biblioteca. A missão mantém três adversários com ficha, acrescenta Nilo na taverna após concluir `ouvir-pedido` e referencia o guarda quando ele existe no catálogo do cenário.

O formato JSON e o prompt para outro LLM incluem os novos campos e referências. O endpoint `/api/mission` aceita até 1 MB de requisição para acomodar o catálogo de NPCs enviado pelo cliente; o documento da missão continua limitado a 120 KB e o cenário a 240 KB. Os dados continuam locais ao navegador, com controle de acesso privado pelo Sites.

As verificações cobrem CRUD, mudança de lugar, falhas de armazenamento, validação de referências/presença, prevenção de duplicação, ocultação fora do lugar exato, confronto condicionado, estado independente entre partidas e os formulários reais de cenário e missão com a API do Worker. A validação visual em navegador permanece indisponível neste cenário.

## Exploração e ofertas de missão

Novas aventuras usam `schemaVersion: 2`: cenário e local inicial são escolhidos independentemente das missões. Até dez missões podem ser aceitas, com progresso, fatos e NPCs próprios isolados; NPCs do cenário e os PV do herói são compartilhados. Concluir uma missão mantém a exploração em andamento. Registros antigos são convertidos em memória e persistidos na próxima alteração, preservando o progresso e as cópias originais.

O modelo da missão aceita `offer: { type: "notice" | "npc", placeId, npcId, title, description }`. Uma oferta por NPC exige um morador do cenário naquele lugar. Anúncios aparecem em **Avisos e oportunidades**; pedidos aparecem ao **Conversar** em **Pessoas neste lugar**. Visualizar ou deixar para depois não aceita a missão. Sem `offer`, modelos anteriores usam `startPlaceId` ou o lugar do primeiro objetivo como anúncio de compatibilidade. Modelos sem lugar precisam configurar a oferta para serem encontrados.

As listas de missões e aventuras oferecem **Excluir** e **Desfazer exclusão**. Excluir um modelo de missão preserva as missões já aceitas nas aventuras. Dados continuam locais ao navegador; o desfazer fica disponível na sessão atual.

## Fundo dos mapas na aventura

No mapa da aventura, use **Carregar imagem de fundo**, **Trocar imagem de fundo** ou **Remover imagem**. Aceita PNG, JPG e WebP de até 10 MB; o navegador reduz para até 1600 pixels no maior lado e salva uma cópia WebP. A proporção da imagem é preservada e os lugares continuam posicionados por X/Y sobre ela.

Cada imagem pertence ao par cenário/lugar superior exibido no mapa, compartilhado entre aventuras desse cenário neste navegador. A visão de arredores usa o fundo do superior. As imagens são armazenadas separadamente do estado da aventura, não entram no JSON da partida e não são enviadas ao servidor. Falhas de espaço preservam a imagem anterior.

## Motor de fórmulas booleanas (sem LLM)

Novos modelos usam `execution: "formula"`. Cada objetivo declara `completion: { mode: "automatic", evaluateAt: "turn_end", condition: EXPRESSAO }`; alternativas declaram `condition`. A raiz pode declarar `completion: EXPRESSAO`, combinada com todos os objetivos obrigatórios concluídos. O motor executa uma ação/rodada, aplica seus resultados, calcula os objetivos até estabilizar e avalia a missão. Conclusões ficam registradas com turno e motivo; não são desfeitas quando o personagem muda de lugar ou entrega um item posteriormente.

```json
{
  "operator": "and",
  "operands": [
    { "operator": "eq", "left": { "ref": "npcs.bandido.derrotado" }, "right": true },
    { "operator": "gte", "left": { "ref": "inventario.documento.quantidade" }, "right": 1 }
  ]
}
```

O interpretador aceita booleanos literais, `and`/`or` com `operands`, `not` com `operand`, e `eq`, `ne`, `gt`, `gte`, `lt`, `lte` com `left`/`right`. Valores são literais ou `{ref: "caminho"}`. Tipos são estritos: comparações de ordem exigem números; igualdade não faz coerção. Limites: oito níveis, 250 nós, 50 operandos por composição. Não há `eval`, execução de JavaScript nem acesso arbitrário a objetos.

| Referência | Tipo |
| --- | --- |
| `npcs.ID.derrotado`, `objetivos.ID.concluido` | booleano |
| `npcs.ID.hp` | número; NPC deve ter ficha |
| `inventario.ID.quantidade` | número |
| `acoes.ID.executada` | booleano; sucesso registrado |
| `acoes.ID.sucessos`, `acoes.ID.tentativas` | número |
| `fatos.ID.valor` | booleano; compatibilidade com fatos legados |
| `personagem.hp`, `personagem.atributos.ATRIBUTO` | número |
| `local.id` | string; vazio fora de um lugar |
| `turno.numero` | número |

IDs consultados precisam ser declarados; atributos e regras de testes são validados contra as regras da aventura. Objetivos com referências circulares são rejeitados. Presença de NPC pode usar as mesmas fórmulas; no cenário, somente referências a NPCs do próprio cenário são permitidas. `actions[].condition` usa uma fórmula de disponibilidade.

`items` declara até 100 objetos `{id,name}`. `actions` declara até 100 objetos `{id,name,kind,placeId,condition?}`. Tipos executáveis:

- `interact`, `investigate`, `help`: registram a interação definida, com sucesso programado. Para exigir evidências anteriores, declare uma pré-condição.
- `talk`: exige `npcId` e a pessoa presente, viva e visível.
- `collect`: exige `itemId` e `quantity` (1–1000), adicionando a quantidade ao inventário.
- `deliver`: exige `itemId`, `quantity` e `npcId`; verifica a presença do destinatário e consome os itens.
- `test`: exige `attribute` e `difficulty` (0–1000), com `ruleActionId` opcional. Usa a fórmula da ação `kind: test` das regras selecionadas, os atributos/bônus da ficha e a rolagem; sucesso é total ≥ dificuldade.

Toda ação precisa ocorrer no lugar configurado (`null` permite qualquer lugar), respeitar sua condição e o personagem precisa estar capaz de agir. Cada sucesso acontece uma vez; testes que falham podem ser tentados novamente, até 100 tentativas. Uma ação encerra um turno e não pode ser combinada com combate na mesma requisição. Inventário é compartilhado entre missões da mesma aventura; resultados de ações e objetivos são isolados por missão. Dados e escolhas de jogo não dependem de LLM.

Na UI: **Missões → Editar → Regras calculáveis em JSON**, mais o campo de fórmula de cada objetivo. O modelo completo e as instruções para criação externa incluem o contrato. Novas missões vazias começam com condição `false`, exigindo configuração para avançar. Na aventura: **Ações neste lugar** e **Executar ação**. O exemplo atualizado de Porto Aurora tem 24 objetivos automáticos, 27 ações e cinco itens. Cadastros e aventuras antigos mantêm suas regras e marcações legadas; carregue o novo exemplo e crie uma aventura para experimentar o fluxo calculado.

## Exclusão de cenários

A lista **Cenários** oferece **Excluir cenário** e **Desfazer exclusão de cenário**. A exclusão remove o cenário inteiro com seus lugares e NPCs; o desfazer restaura o registro e o ID original durante a sessão. Missões ainda cadastradas precisam ser excluídas ou transferidas antes, evitando referências quebradas. Aventuras já criadas guardam suas cópias e são preservadas.

A coleção pode ficar vazia, inclusive após reabrir o site, sem recriar automaticamente o exemplo. É possível criar ou importar outro cenário nessa situação. Exclusão e recuperação só alteram o estado em memória depois de salvar com sucesso no navegador. A mudança de vocabulário preserva `environmentId`, rotas e chaves de armazenamento existentes para compatibilidade com JSONs e partidas anteriores.

## Modelo de importação de cenário

Em **Cenários → Modelo de importação / LLM**, copie ou baixe o JSON completo e as instruções para gerar um cenário em outro LLM. O modelo demonstra hierarquia livre, coordenadas relativas ou não definidas, detalhes descritivos, NPC narrativo, NPC com ficha de oito pontos e presença condicional por fórmula. O contrato informa os campos, limites e referências aceitos. O mesmo atalho aparece no editor JSON.

**Abrir modelo no editor de importação** prepara um cenário novo, sem salvar ou substituir registros. Use **Validar e aplicar → Adicionar cenário** para confirmar. Funciona mesmo quando a coleção de cenários está vazia. O jogo continua independente de LLM.

## Cenário de exemplo: Eriador e Além

O exemplo inicial, `/worlds/example.json` e o modelo baixável de cenário agora usam **Eriador e Além**, fornecido pelo usuário: dez lugares da Terra Média e cinco NPCs (Frodo, Elrond, batedor Uruk-hai, Gollum e Nazgûl). A hierarquia, coordenadas e condição do Nazgûl foram preservadas. A presença dele consulta `npcs.frodo.derrotado == false`.

Para atender às regras padrão de oito pontos, Frodo foi adaptado para F1/H2/R3/A2/PdF0 e Gollum para F1/H4/R3/A0/PdF0. As demais distribuições foram preservadas. Equipamento, lealdade, obsessão e aura ficam em `fields.historia`, mantendo essas informações visíveis na ficha. Elrond permanece narrativo.

Cenários já salvos não são substituídos automaticamente. Use **Cenários → Modelo de importação / LLM → Abrir modelo no editor de importação → Validar e aplicar → Adicionar cenário**, ou carregue o exemplo no editor de um cenário para substituir apenas aquele cadastro, respeitando seus vínculos. Aventuras anteriores preservam suas cópias. A missão de exemplo passa a usar o cenário selecionado; Porto Aurora continua compatível para quem já o cadastrou.

## Missões temáticas de Eriador

Quando o cenário selecionado contém os dez lugares e cinco moradores de **Eriador e Além**, **Carregar missão de exemplo** e **Modelo para outro LLM** usam **Eriador: O Caminho das Sombras**. A lista também oferece **Missões de Eriador**, com três modelos que podem ser conferidos e importados separadamente:

- **O Caminho das Sombras**: 24 objetivos, 26 ações, cinco referências de NPCs do cenário. Oferta por Frodo no Bolsão; jornada até Valfenda, Rohan e Mordor, com retorno das provas a Elrond. Os encontros com o batedor Uruk-hai e o Nazgûl permitem combate ou testes pacíficos.
- **Cartas do Conselho**: cinco objetivos e cinco ações. Oferta por Elrond na Casa de Elrond; entrega de carta a Frodo e retorno da resposta. Entregas consomem os documentos do inventário.
- **As Provisões de Edoras**: seis objetivos e seis ações. Oferta por anúncio em Edoras; coleta de ervas em Rohan, preparo por teste e entrega ao intendente Éothain, NPC próprio da missão que surge após o aceite.

Todos os objetivos e conclusões são fórmulas booleanas, com dependências e ações programadas. Não há marcações manuais nem necessidade de LLM. Fichas e testes do exemplo usam o conjunto padrão de 3D&T Adaptável. A importação cria novos registros; missões e aventuras anteriores preservam seus modelos e progresso.


## Personagens da Terra Média e orçamento de NPCs

Em **Personagens → Adicionar exemplos da Terra Média**, acrescente Cael de Rohan, Lira de Valfenda e Tobin do Condado. Cada ficha usa oito pontos, contando habilidades. A operação preserva personagens existentes, não duplica os exemplos e não reinicia aventuras. Novas sessões de demonstração usam os três exemplos.

O jogador continua sujeito à distribuição completa exigida pelas regras. NPCs de cenários e missões podem gastar menos que o orçamento, mas nunca excedê-lo; atributos, habilidades e demais limites continuam validados. Isso permite usar as fichas originais de Frodo (cinco pontos) e Gollum (seis). Na aventura, erros de orçamento identificam o nome e se a ficha é do jogador ou de um NPC. O combate avulso continua exigindo fichas completas para seus dois personagens.

## Revisão da interface de aventura

A página da partida mantém ficha, PV, mapa e ações locais como informações principais. Turno e situação ficam no cabeçalho. Foram removidas as repetições de localização na ficha, versão das regras, orçamento de criação, mana zero e blocos de habilidades vazias. Nomes de missões nas ações só são agrupados quando há mais de uma missão oferecendo ações no lugar.

Mapa, atributos, habilidades, inventário, destinos em lista, imagem de fundo, histórico e detalhes dos objetivos usam seções recolhíveis. A abertura dessas seções é mantida por aventura durante a sessão, inclusive após ações e navegação. Destinos e configuração da imagem começam fechados; a lista continua permitindo acessar lugares sem coordenadas. Missões ficam em um bloco secundário; seus objetivos automáticos mostram situação, sem controles de edição desabilitados. Missões manuais antigas conservam seus controles.

**Ler ficha completa**, **Ler sobre o lugar**, **Sobre**, **Ler missão completa** e **Ler histórico completo** abrem uma janela de leitura. Ela usa diálogo modal nativo, título acessível, foco inicial, fechamento por Escape e retorno ao controle de origem. A leitura não avança turnos nem grava alterações na partida. Os textos são escapados como texto, inclusive descrições e fórmulas importadas.

O histórico principal mostra os três acontecimentos mais recentes; o restante permanece acessível na leitura completa. Registros genéricos de turno duplicados pelo resultado do mesmo turno são agrupados apenas na apresentação. Verificações de objetivos e fórmulas ficam recolhidas; registros salvos não são apagados nem modificados. As fórmulas continuam consultáveis nos detalhes dos objetivos e da missão.

Validação visual em fixture local com os módulos reais: modo claro, modo noturno, viewport de 390 pixels, leitor modal/teclado, seções recolhidas e abertura do combate integrado. O preview estático HTTP não executa o backend e não disponibiliza `crypto.randomUUID`; os fluxos de partida, gravação, missões e turnos são cobertos pelos testes de integração com o Worker real.

## Presença do personagem nos níveis do mapa

Na aventura, **Nível do mapa** e **Ver por fora** permitem visualizar os níveis que contêm o personagem sem deslocá-lo. **Focar personagem** restaura a visão local. O botão **Ir para** e os destinos acessíveis continuam sendo deslocamentos reais.

O próprio quadrado do lugar é destacado, sem marcador adicional ou nome do personagem. Cael no Bolsão destaca Bolsão ao olhar o Condado, o Condado ao olhar Eriador, Eriador ao olhar a Terra Média e Terra Média ao olhar o cenário inteiro. A lista de destinos também destaca o lugar correspondente.

Todos os nomes dos locais ficam visíveis sem passar o mouse, com fundo opaco e texto contrastante nos modos claro e noturno, inclusive sobre imagens de fundo. Destinos indisponíveis conservam a legibilidade do nome. Se não houver coordenadas, o lugar continua na lista; nenhuma posição ou marcador adicional é inventado. As imagens acompanham o nível visualizado. Alterar a visão não grava a aventura, não gera diário, não avança turno e não altera NPCs ou ações locais.


## Deslocamento como turno e proporção do mapa

O comando de turno aceita `move: {placeId}` junto com `expectedTurn`. Deslocamento, combate e ação de missão são mutuamente exclusivos por turno. O motor valida o destino, desloca o personagem, avança exatamente um turno e verifica todas as missões aceitas no local de chegada, incluindo fórmulas de `local.id` e `turno.numero`. Aventuras antigas também seguem essa regra. Chamadas diretas a `changeAdventure` com `type: "move"` usam o mesmo motor.

A interface envia o deslocamento ao servidor e só atualiza a partida depois da resposta validada e da gravação local. Falhas de rede, validação ou armazenamento preservam a localização e o turno anteriores. Alterar Nível do mapa, Ver por fora ou Focar personagem continua sendo apenas visualização. O histórico apresenta uma única ocorrência do deslocamento, preservando o diário e as verificações de objetivos.

A grade sem imagem usa proporção 1:1, com escala igual nos eixos X e Y e largura limitada a 560 pixels na aventura. Imagens de fundo conservam a proporção original, sem o limite de altura que poderia comprimi-las.


## Mapa automático na aventura

A aventura não exibe o seletor Nível do mapa nem os botões Ver por fora e Focar personagem. O mapa acompanha automaticamente o local atual: mostra lugares internos quando existem e, caso contrário, os lugares do mesmo nível dentro do superior. Os deslocamentos continuam disponíveis pelo mapa, pela lista de destinos e pelo botão Ir para, consumindo um turno. O destaque do lugar atual, os nomes sempre visíveis e as imagens de fundo continuam disponíveis.


## Consulta do mapa pelo caminho de localização

Os nomes no caminho acima do mapa são clicáveis. Eles consultam o mapa do lugar selecionado sem modificar a localização real, o turno, os encontros ou as missões. Com o personagem no Condado, clicar em Eriador destaca o Condado; clicar em Terra Média destaca Eriador. O nível visualizado é realçado no caminho, enquanto a localização real conserva `aria-current="location"`. Não há seletor de nível, Ver por fora nem Focar personagem. O comando físico é identificado como **Sair para … · 1 turno** e continua consumindo um turno.


O botão **Sair para** representa uma porta de saída entre níveis: do Bolsão para o Condado, do Condado para Eriador e assim por diante. O destino é sempre o superior imediato do lugar real do personagem, independentemente do mapa visualizado. A saída consome um turno e verifica os objetivos na chegada.

## Encontros de região

**Cenários → Abrir lugares → Encontros de região** lista os modelos e a distribuição efetiva por lugar. **Editar configuração** abre `{encounters, placeTables}` em JSON, com validação e salvamento atômico. `placeTables` usa IDs de lugares como chaves; remover uma chave restaura a herança. **Preparar exemplos de Eriador** preenche um rascunho com modelos e políticas para revisão, sem gravar automaticamente. Preserva modelos e políticas já existentes com os mesmos IDs. A edição não modifica aventuras iniciadas.

O cenário padrão e o modelo baixável incluem salteadores, lobos, mercador viajante e viajante ferido. Terra Média usa 30% de chance, Eriador e Rohan 35%, Condado 20% e Mordor 40%, com intervalo mínimo de três turnos entre ocorrências. Bolsão, Valfenda, Casa de Elrond, Edoras e Montanha da Perdição bloqueiam os encontros herdados. Para usar o recurso em um cenário já salvo, prepare e salve os exemplos, depois crie uma nova aventura nesse cenário. Durante um teste, uma tabela pode usar chance 100 e uma única entrada; a configuração normal permanece probabilística.

### Contrato JSON

A raiz aceita `encounters` opcional, com até 50 modelos. Modelo: `{id,name,description,participants,options,condition}`. IDs únicos de até 80 caracteres; nome até 100 e descrição até 4000. Até quatro participantes `{id,name,description,combatant}`; a ficha segue o mesmo contrato dos NPCs e pode gastar menos pontos que o jogador. Modelos com combate precisam de ao menos um oponente com PV válidos nas regras da aventura.

Cada encontro exige de uma a dez opções `{id,label,kind,text,duringCombat}`. `kind` é `resolve`, `test` ou `combat`; `label` até 100, `text` até 2000. Testes acrescentam `attribute`, `difficulty` inteiro de 0 a 100 e `failureText`. Usam a ação de teste do conjunto de regras, seus dados e bônus. `duringCombat:true` mantém a opção disponível durante combate, permitindo fuga. IDs `victory` e `defeat` são reservados. `resolve` e testes bem-sucedidos encerram a ocorrência, registrando seu resultado; não concedem inventário, XP ou efeitos adicionais nesta versão. A abertura do combate não consome turno; a rodada efetiva consome.

`condition` é null ou uma fórmula booleana existente. Pode consultar residentes do cenário (`npcs.ID.derrotado/hp`), `personagem.hp`, `personagem.atributos.ID`, `local.id` e `turno.numero`. Referências a objetivos, itens, fatos e ações de missões não são aceitas nos modelos regionais. O prompt de geração externa e o modelo completo incluem esse contrato.

Cada lugar pode ter `encounterTable`:

```json
{
  "mode": "extend",
  "chance": 30,
  "cooldownTurns": 3,
  "entries": [
    { "encounterId": "salteadores", "weight": 3 },
    { "encounterId": "lobos", "weight": 5 }
  ]
}
```

`inherit` herda; `extend` complementa a lista e substitui pesos repetidos; `replace` troca a lista; `none` bloqueia. Sem configuração, herda do superior. `chance` e `cooldownTurns` são opcionais e herdados; antes de qualquer configuração, os padrões são chance zero e intervalo três. `inherit` e `none` não admitem entradas próprias. Chance é percentual (0–100); peso é frequência relativa (1–1000), usada depois que a chance de ocorrência passa. Intervalo é inteiro de 1 a 1000000. Referências e duplicidades são validadas.

### Execução e salvamento

Após um deslocamento válido, o motor avança o turno, avalia as missões e verifica a tabela herdada do destino. Considera condições e intervalo global desde o último encontro; depois sorteia a ocorrência e o modelo por peso. Não há sorteio ao consultar o mapa, aceitar missão, atualizar a página ou iniciar a aventura. Pode receber `seed` nos testes para reprodução; não depende de LLM nem de serviço externo.

A aventura guarda `encounters: {nextId,lastTriggeredTurn,occurrences}`. Mantém até 20 ocorrências, com IDs próprios, modelo, lugar, turno inicial, situação (`pending`, `combat`, `resolved`), resolução, turno de conclusão, tentativas, último resultado e participantes com PV independentes. O cenário e outras aventuras nunca recebem o dano ou o resultado. NPCs de encontros ativos usam IDs separados dos residentes e dos NPCs de missão. A recarga valida e restaura a mesma ocorrência, sem sortear novamente.

Enquanto houver encontro ativo, a aventura exige uma escolha ou uma rodada contra seus participantes antes de outro deslocamento, ação de missão ou turno narrativo. Cada tentativa/solução consome um turno e também verifica as missões aceitas. Falha de teste preserva o encontro e permite repetir, até 100 tentativas; opções de combate continuam disponíveis. O confronto usa o motor de combate existente e pode ter vários adversários; encerra em vitória quando todos forem derrotados, em derrota se o personagem ficar incapacitado ou por uma opção de fuga bem-sucedida. Os resultados ficam visíveis na aventura e no histórico. Sem catálogo de encontros, aventuras e cenários anteriores conservam o comportamento anterior.

Os testes cobrem herança, pesos, chance, condições, intervalos, JSON inválido, regras incompatíveis, migração sem catálogo, reprodução por semente, recarga sem novo sorteio, múltiplos adversários, fuga, missões simultâneas e falhas de conexão/armazenamento. A conferência visual usa uma fixture local com os módulos reais; o preview estático não executa o backend. Os fluxos completos de escolhas e rodadas usam testes de integração com o Worker real.
