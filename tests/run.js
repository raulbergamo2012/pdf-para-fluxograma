// Testes rápidos: node tests/run.js
const assert = require('assert');
const { sanitizeMermaid } = require('../lib/sanitize');
const { heuristicMermaid } = require('../lib/heuristic');

const cases = {
  fences: '```mermaid\ngraph TD\nA[Início] --> B{Aprovado?}\nB -->|Sim| C[Pagar (R$ 500)]\nB -->|Não| end[Fim]\n```',
  quotes: 'Aqui está:\nflowchart TD\n  A["Usuário diz "olá""] --> B{"Valor > 100?"}\n  B -- Sim --> C(Fim)',
  subgraph: 'flowchart LR\nsubgraph Financeiro\n  F1[Conferir notas] --> F2{OK?}\nF2 -->|"Sim"| F3[Pagar]\n',
  stadium: 'flowchart TD\nINICIO([Início]) --> P1[Enviar e-mail; aguardar #retorno] --> FIM([Fim])\nclass INICIO,FIM inicioFim\nclassDef inicioFim fill:#E8F5E9',
};
const out = {};
for (const [k, v] of Object.entries(cases)) out[k] = sanitizeMermaid(v);
assert(out.fences.startsWith('flowchart TD'));
assert(!/\bend\[/.test(out.fences), 'id "end" deve ser renomeado');
assert(out.fences.includes('C["Pagar (R$ 500)"]'));
assert(out.quotes.includes(`A["Usuário diz 'olá'"]`));
assert(out.subgraph.trim().endsWith('end'), 'subgraph deve ser fechado');
assert(out.stadium.includes('#35;retorno'));
assert(out.quotes.includes('Valor #gt; 100?'));

const sample = `Processo de Reembolso
Criado por Fulano
1. Objetivo
1. O colaborador preenche o formulário.
2. O sistema valida se os campos obrigatórios foram preenchidos.
Caso contrário, exibe mensagem de erro.
3. Se aprovado pelo gestor, a solicitação segue para o Financeiro.
Senão, o colaborador é notificado da reprovação.
4. O Financeiro agenda o pagamento.`;
out.heuristic = heuristicMermaid(sample, 'Processo de Reembolso');
assert(out.heuristic.includes('{"Campos obrigatórios foram preenchidos?"}'));
assert(out.heuristic.includes('{"Aprovado pelo gestor?"}'));
assert(!out.heuristic.includes('Criado por'));
// regra: no máximo 5 palavras por bloco
const { wordCount } = require('../lib/shorten');
for (const m of out.heuristic.matchAll(/\["([^"]+)"\]|\{"([^"]+)"\}/g)) assert(wordCount(m[1] || m[2]) <= 5, 'texto longo: ' + (m[1] || m[2]));
const longAI = sanitizeMermaid('flowchart TD\nA["O colaborador acessa o portal corporativo e preenche o formulário de reembolso"] --> B{"O valor informado está dentro da política de reembolso da empresa?"}');
assert(longAI.includes('A["Acessar portal corporativo"]'), longAI);
assert(longAI.includes('B{"Valor informado está dentro da?"}') || /B\{"[^"]{3,}\?"\}/.test(longAI), longAI);

// análise do grafo (módulo do navegador)
import('../public/graph.mjs').then(({ parseFlowchart, analyze, summarize }) => {
  const g = parseFlowchart(out.heuristic);
  const a = analyze(g);
  assert.strictEqual(a.decisions, 2);
  assert(a.score >= 90, 'nota de qualidade esperada alta');
  assert(summarize(parseFlowchart('flowchart TD\nA(["Início"]) --> B["x"] --> C["y"] --> D["z"] --> E(["Fim"])')).merged === 2);
}).catch((e) => { console.error(e); process.exit(1); });

// guia passo a passo: etapas em ordem cronológica e uma ação por bloco
{
  const guia = `Como montar um PC
Etapa 1: Preparação fora do gabinete
1. Abra a trava do soquete da placa-mãe.
2. Processador: alinhe a marcação dourada do processador com o soquete.
3. Baixe a trava do soquete.
4. Instale o cooler sobre o processador.
5. Encaixe os pentes de memória RAM.
Etapa 2: Instalação no gabinete
1. Remova a tampa lateral do gabinete.
2. Posicione a placa-mãe sobre os espaçadores e aparafuse.
3. Instale a fonte de alimentação.
4. Encaixe a placa de vídeo no slot PCIe.
Etapa 3: Primeiro teste
1. Ligue o computador.
2. Se a tela da BIOS aparecer, instale o sistema operacional.
3. Caso contrário, verifique os cabos de energia e ligue novamente.`;
  const pc = heuristicMermaid(guia, 'Como montar um PC');
  assert(!/<br\/>/.test(pc), 'nenhum bloco com lista de tarefas:\n' + pc);
  assert(!/Qual [^"]*usar\?/.test(pc), 'etapas sequenciais não viram escolha:\n' + pc);
  const ord = (t) => pc.indexOf(t);
  assert(ord('Abrir trava do soquete') > 0 && ord('Abrir trava do soquete') < ord('Remover tampa lateral'), 'Etapa 1 vem antes da Etapa 2');
  const idOf = (t) => new RegExp(`(\\w+)\\["${t}`).exec(pc)?.[1];
  const last1 = idOf('Encaixar pentes'), first2 = idOf('Remover tampa');
  // direto, ou passando pelo ponto de verificação da etapa (tipo Decisão): "Preparação… ok?" -->|Sim| primeiro da Etapa 2
  assert(last1 && first2 && (new RegExp(`${last1} --> ${first2}\\b`).test(pc) || new RegExp(`${last1} --> (D\\d+)[\\s\\S]*\\1 -->\\|Sim\\| ${first2}\\b`).test(pc)), 'último passo da Etapa 1 liga ao primeiro da Etapa 2:\n' + pc);
  global.__guia = guia;
  const pcProc = heuristicMermaid(guia, 'Como montar um PC', 'TD', 'processo');
  assert(new RegExp(`${idOf('Encaixar pentes')} --> ${idOf('Remover tampa')}\\b`).test(pc) || /Encaixar pentes/.test(pcProc), pcProc);
  assert(pc.includes('Alinhar marcação'), 'rótulo "Processador:" removido do passo');
  const err = idOf('Verificar cabos'), lig = idOf('Ligar computador');
  assert(new RegExp(`${err} --> ${lig}\\b`).test(pc), '"ligue novamente" volta ao passo Ligar computador');
  // alternativas reais continuam virando escolha
  const alt = heuristicMermaid(`Instalar jogo
Método 1: Instalação por disco
1. Insira o disco no console.
Método 2: Instalação digital
1. Abra a PlayStation Store e baixe o jogo.`, 'Instalar jogo');
  assert(/\{"[^"]*\?"\}/.test(alt), 'métodos alternativos continuam com losango de escolha');
}
// os 3 tipos de fluxograma
{
  const chamado = `Atendimento de chamados
1. O cliente abre um chamado relatando o problema.
2. A equipe de vendas analisa o chamado.
3. Se for uma questão comercial, a equipe de vendas resolve e responde ao cliente.
4. Caso contrário, encaminha o chamado para o suporte técnico.
5. O suporte técnico verifica se o problema é novo.
6. Caso não seja, aplica a solução conhecida e responde ao cliente.
7. O desenvolvimento corrige o problema.
8. O cliente confirma a solução.`;
  const raias = heuristicMermaid(chamado, 'Atendimento', 'TD', 'raias');
  assert(raias.startsWith('%% tipo: raias'), raias);
  for (const r of ['Cliente', 'Equipe de vendas', 'Suporte técnico', 'Desenvolvimento']) assert(raias.includes(`["${r}"]`), 'raia ' + r + '\n' + raias);
  assert(!/PRINCIPAL/.test(raias), 'raias sem bloco externo');
  assert(/subgraph R1\["Cliente"\][\s\S]*?INICIO[\s\S]*?end/.test(raias), 'Início na raia de quem começa');
  assert(/Corrigir problema/.test(raias) && /Aplicar solução conhecida/.test(raias), 'verbos no infinitivo: ' + raias);
  assert(/P\d+ --> FIM|E\d+ --> FIM/.test(raias) && (raias.match(/--> FIM/g) || []).length >= 2, '"responde ao cliente" encerra o atendimento');
  const proc = heuristicMermaid(chamado, 'Atendimento', 'TD', 'processo');
  assert(proc.startsWith('%% tipo: processo') && !/subgraph/.test(proc), 'processo: fluxo contínuo, sem blocos de seção:\n' + proc);
  assert(/\{"[^"]*\?"\}/.test(proc) && /\|Sim\|/.test(proc) && /\|Não\|/.test(proc), 'processo: condições reais viram losango Sim/Não:\n' + proc);
  assert(!/-\.- N\d+/.test(proc), 'processo sem notas laterais');
  const dec = heuristicMermaid(chamado, 'Atendimento', 'TD', 'decisao');
  assert(dec.startsWith('%% tipo: decisao') && (dec.match(/\{"/g) || []).length >= 2 && /\|Sim\|/.test(dec) && /\|Não\|/.test(dec), dec);
  const sh = require('../lib/shorten');
  assert.strictEqual(sh.extractActor('A equipe de vendas analisa a solicitação.'), 'Equipe de vendas');
  assert.strictEqual(sh.extractActor('Aprovar o pedido (Responsável: Gerente de compras).'), 'Gerente de compras');
  assert.strictEqual(sh.extractActor('Processador: alinhe a marcação.'), '');
  assert.strictEqual(sh.extractActor('A instalação iniciará automaticamente.'), '');
  global.__tiposCodes = { raias, proc, dec };
}

// IA desobediente: bloco com lista é quebrado em passos encadeados
{
  const fixed = sanitizeMermaid('flowchart TD\nINICIO(["Início"]) --> P1["- Encaixar processador<br/>- Alinhar marcação<br/>- Baixar trava"] --> P2["Instalar cooler"]\nP2 --> FIM(["Fim"])');
  assert(!/<br\/>/.test(fixed), fixed);
  assert(fixed.includes('P1 --> P1_2["Alinhar marcação"]') && fixed.includes('P1_2 --> P1_3["Baixar trava"]') && fixed.includes('P1_3 --> P2'), fixed);
}

// layout automático dos 3 tipos (desenho final)
import('../public/swimlane.mjs').then(({ autoLayout }) => {
  const { raias, proc, dec } = global.__tiposCodes;
  const R = autoLayout(raias, { type: 'raias', title: 'Atendimento' });
  const lanes = R.nodes.filter((n) => n.band);
  assert(lanes.length === 4 && lanes.every((l, i) => !i || l.x > lanes[i - 1].x), 'raias em colunas, da esquerda para a direita');
  const inLane = (id, name) => { const n = R.nodes.find((x) => x.id === id), l = lanes.find((x) => x.text === name); return n.x >= l.x && n.x + n.w <= l.x + l.w; };
  assert(inLane('INICIO', 'Cliente') && inLane('P2', 'Equipe de vendas'), 'cada passo na raia do responsável');
  const RL = autoLayout(raias, { type: 'raias', direction: 'LR' });
  assert(RL.nodes.filter((n) => n.band).every((l, i, a) => !i || l.y > a[i - 1].y), 'horizontal: raias em faixas');
  const Pm = autoLayout(proc, { type: 'processo' });
  assert(!Pm.nodes.some((n) => n.shape === 'container' || n.band), 'processo: sem colunas, raias ou caixas de seção');
  const ini = Pm.nodes.find((n) => n.id === 'INICIO'), fim = Pm.nodes.find((n) => n.id === 'FIM');
  assert(ini.y < Math.min(...Pm.nodes.filter((n) => n !== ini).map((n) => n.y)) + 1 && fim.y >= Math.max(...Pm.nodes.map((n) => n.y)), 'processo: Início no topo e Fim embaixo');
  // guia longo com etapas: continua UM fluxo só (antes virava colunas)
  const pcL = autoLayout(require('../lib/heuristic').heuristicMermaid(global.__guia || '', 'PC', 'TD', 'processo'), { type: 'processo' });
  assert(!pcL.nodes.some((n) => n.shape === 'container'), 'guia longo sem colunas');
  const D = autoLayout(dec, { type: 'decisao' });
  const d1 = D.nodes.find((n) => n.shape === 'diamond');
  const out = D.edges.filter((e) => e.from === d1.id);
  const sideOf = (lab) => out.find((e) => e.label === lab)?.fromPort;
  assert(sideOf('Não') === 'left' && sideOf('Sim') === 'right', 'decisão: Não à esquerda, Sim à direita ' + JSON.stringify(out));
  assert(new Set(D.edges.filter((e) => D.nodes.find((n) => n.id === e.from)?.shape === 'diamond' && e.fromPort === 'bottom').map((e) => e.from)).size
    === D.edges.filter((e) => D.nodes.find((n) => n.id === e.from)?.shape === 'diamond' && e.fromPort === 'bottom').length, 'no máximo uma saída por baixo em cada losango');
}).catch((e) => { console.error(e); process.exit(1); });

// editor visual: rotas, desenho e conversão do desenho para Mermaid
import('../public/visual-model.mjs').then(({ routeEdge, renderSVG, visualToMermaid, nearestPort }) => {
  const model = {
    nodes: [
      { id: 'S', shape: 'container', x: 0, y: 0, w: 600, h: 500, text: 'Seção' },
      { id: 'A', shape: 'terminator', x: 200, y: 40, w: 120, h: 40, text: 'Início' },
      { id: 'B', shape: 'diamond', x: 200, y: 140, w: 120, h: 90, text: 'Tudo certo?' },
      { id: 'C', shape: 'rect', x: 400, y: 280, w: 120, h: 50, text: 'Corrigir "isso" > já' },
      { id: 'T', shape: 'text', x: 20, y: 420, w: 80, h: 30, text: 'nota solta' },
    ],
    edges: [
      { id: 'e1', from: 'A', to: 'B', kind: 'orth', arrowEnd: true },
      { id: 'e2', from: 'B', fromPort: 'right', to: 'C', toPort: 'top', label: 'Não', kind: 'orth', arrowEnd: true },
      { id: 'e3', p1: [10, 10], p2: [90, 60], kind: 'straight', arrowEnd: true },
    ],
  };
  const r = routeEdge(model, model.edges[1]);
  assert.deepStrictEqual(r[0], [320, 185], 'sai pela ponta direita do losango');
  assert.deepStrictEqual(r[r.length - 1], [460, 280], 'entra pelo topo do bloco');
  assert(r.every((p, i) => !i || p[0] === r[i - 1][0] || p[1] === r[i - 1][1]), 'linhas em 90°');
  assert.strictEqual(nearestPort(model.nodes[2], 330, 186), 'right');
  const viaR = routeEdge(model, { ...model.edges[1], via: [500, 120] });
  assert(viaR.some(([x, y]) => x === 500 && y === 120) && viaR.every((p, i) => !i || p[0] === viaR[i - 1][0] || p[1] === viaR[i - 1][1]), 'seta passa pelo ponto de dobra, em 90°');
  const orth90 = (r) => r.every((q, i) => !i || q[0] === r[i - 1][0] || q[1] === r[i - 1][1]);
  const multi = routeEdge(model, { ...model.edges[1], points: [[500, 120], [560, 260]] });
  assert(orth90(multi) && multi.some(([x, y]) => x === 560 && y === 260), 'várias dobras, sempre em 90°');
  const freeL = routeEdge(model, { id: 'x', p1: [0, 0], p2: [100, 100], kind: 'straight', points: [[0, 100]] });
  assert.deepStrictEqual(freeL, [[0, 0], [0, 100], [100, 100]], 'linha reta vira "L" com uma dobra');
  const looseEnd = routeEdge(model, { id: 'y', from: 'C', fromPort: 'bottom', p2: [700, 600], kind: 'orth' });
  assert.deepStrictEqual(looseEnd.at(-1), [700, 600], 'ponta solta fica onde foi solta');
  const svg = renderSVG(model);
  assert(svg.startsWith('<svg') && (svg.match(/class="vn"/g) || []).length === 5 && (svg.match(/class="ve"/g) || []).length === 3);
  const mm = visualToMermaid(model);
  assert(/subgraph S\["Seção"\]/.test(mm) && /B\{"Tudo certo\?"\}/.test(mm), mm);
  assert(mm.includes('B -->|Não| C') && mm.includes("C[\"Corrigir 'isso' #gt; já\"]"), mm);
  assert(!/\bT\[/.test(mm), 'texto solto não vira bloco do Mermaid');
}).catch((e) => { console.error(e); process.exit(1); });

if (process.argv.includes('--print')) console.log(JSON.stringify(out, null, 2));
else console.log('✔ Todos os testes passaram');
module.exports = out;

// coesão do Processo linear: alternativas viram um passo, sem rótulos truncados/inventados
{
  const { polishLabel } = require('../lib/shorten');
  const { mergeAlternativeSteps } = require('../lib/coherence');
  const guiaApp = `Como instalar o app
1. Abra a Google Play Store (Android).
2. Abra a App Store (iOS).
3. Procure o aplicativo e toque em Instalar.
4. Nome de Usuário: escolha um apelido.
5. Não use seu nome real nem dados pessoais.
6. Se o código não chegar, toque em Reenviar.`;
  const p = heuristicMermaid(guiaApp, 'Instalar app', 'TD', 'processo');
  assert(!/Google Play Store"\][\s\S]*App Store"\]/.test(p) && /loja de aplicativos/.test(p), 'lojas alternativas viram um passo:\n' + p);
  assert(!/Nomar|\bnem"\]/.test(p), 'sem rótulo inventado ou truncado:\n' + p);
  assert.strictEqual(polishLabel('Nomar de Usuário', 'action'), 'Informar nome de Usuário');
  assert.strictEqual(polishLabel('Não usar nome real nem', 'action'), 'Não usar nome real');
  assert.strictEqual(polishLabel('Fixe-ar o cooler', 'action'), 'Fixar o cooler');
  const ai = mergeAlternativeSteps('flowchart TD\n    INICIO(["Início"]) --> P1["Abrir Google Play Store"] --> P2["Abrir App Store"]\n    P2 --> FIM(["Fim"])');
  assert(/P1\["Abrir loja de aplicativos"\]/.test(ai) && /P1 --> FIM/.test(ai) && !/P2/.test(ai), 'IA: passos alternativos encadeados viram um:\n' + ai);
}

// Processo: sinônimos em sequência viram um passo; dicas entram no bloco de ação como observação
{
  const { mergeAlternativeSteps } = require('../lib/coherence');
  const { sanitizeMermaid } = require('../lib/sanitize');
  const txt = `Como criar uma conta no app
1. Acesse a loja de aplicativos do celular.
2. Abra a loja de aplicativos.
3. Nome de Usuário: escolha um apelido.
4. Não use seu nome real nem dados pessoais.
5. Crie uma senha forte.
6. Anote a senha em um local seguro.
7. Abra o app e faça login.`;
  const p = heuristicMermaid(txt, 'Criar conta', 'TD', 'processo');
  assert(!/Abrir loja de aplicativos/.test(p) && /Acessar loja de aplicativos/.test(p), 'sinônimo em sequência vira um passo:\n' + p);
  assert(/\[\/?"Informar nome de usuário<br\/>\(Não usar nome real[^)]*\)"\/?\]/.test(p), 'dica no bloco do nome:\n' + p);
  assert(/\["Criar senha forte<br\/>\(Anotar senha em local seguro\)"\]/.test(p), 'dica no bloco da senha:\n' + p);
  const ai = sanitizeMermaid(mergeAlternativeSteps('flowchart TD\n    INICIO(["Início"]) --> P1["Acessar loja de aplicativos"] --> P2["Abrir loja de aplicativos"] --> P3["Criar senha forte"] --> P4["Anotar senha em local seguro"] --> FIM(["Fim"])'));
  assert(/P1\["Acessar loja de aplicativos"\]/.test(ai) && !/P2/.test(ai) && /P3\["Criar senha forte<br\/>\(Anotar senha em local seguro\)"\]/.test(ai) && !/P4/.test(ai), 'IA: sinônimo e dica fundidos:\n' + ai);
}

// regra universal do Processo (qualquer PDF): navegação em sequência vira um passo; dicas/avisos/seções de dicas
// viram observação no bloco relacionado; nada de dica como bloco isolado
{
  const { mergeAlternativeSteps, mergeAlternative } = require('../lib/coherence');
  const banco = `Como emitir a segunda via do boleto
1. Acesse o site do banco pelo navegador.
2. Entre na plataforma.
3. Faça login com CPF e senha.
Atenção: nunca informe sua senha por telefone.
4. Escolha o boleto desejado.
5. Baixe o PDF do boleto.
Dicas de segurança
- Mantenha o navegador atualizado.
- Evite usar redes Wi-Fi públicas.
6. Pague o boleto no aplicativo.`;
  const p = heuristicMermaid(banco, 'Boleto', 'TD', 'processo');
  assert(!/Entrar na plataforma/.test(p), 'acessar + entrar na plataforma = um passo:\n' + p);
  assert(/Fazer login com CPF[^<]*<br\/>\(Não informar sua senha por telefone\)/.test(p), 'aviso "Atenção:" vira observação do login:\n' + p);
  assert(/<br\/>\(Manter navegador atualizado\)/.test(p) && /<br\/>\(Evitar usar redes Wi-Fi públicas\)/.test(p), 'seção de dicas vira observação:\n' + p);
  assert(!/^\s*P\d+\["(Manter|Evitar|Não informar)/m.test(p), 'nenhuma dica como bloco isolado:\n' + p);
  assert.strictEqual(mergeAlternative('Acessar site do banco', 'Entrar na plataforma'), 'Acessar site do banco');
  assert.strictEqual(mergeAlternative('Abrir navegador', 'Acessar site do banco'), null, 'passos de navegação diferentes continuam separados');
  // IA: dica solta no meio do fluxo vai para o bloco do mesmo assunto (senha), não para o vizinho
  const ai = mergeAlternativeSteps('flowchart TD\n    INICIO(["Início"]) --> P1["Criar senha forte"] --> P2["Confirmar e-mail"] --> P3["Anotar senha em local seguro"] --> P4["Fazer login"] --> FIM(["Fim"])');
  assert(/P1\["Criar senha forte<br\/>\(Anotar senha em local seguro\)"\]/.test(ai) && !/P3/.test(ai) && /P2 --> P4/.test(ai), 'IA: dica vai ao bloco relacionado:\n' + ai);
}

// Funcional: preparos paralelos nascem nas suas raias; laço de repetição; IA amontoada é redistribuída por raias
{
  const { fixLanes, parseLanes } = require('../lib/lanes');
  const bolo = `Receita de Bolo
Preparo da massa
1. Bata os ovos com o açúcar.
2. Adicione a farinha e o leite.
3. Despeje a massa em uma forma untada.
Preparo da cobertura
1. Coloque o leite condensado e o chocolate em uma panela.
2. Desligue quando a mistura desgrudar do fundo.
Forno
1. Leve a forma ao forno por 40 minutos.
2. Faça o teste do palito.
3. Se o palito sair limpo, retire do forno. Caso contrário, asse por mais 5 minutos.
Finalização
1. Desenforme o bolo.
2. Espalhe a cobertura por cima.`;
  const c = heuristicMermaid(bolo, 'Bolo', 'TD', 'raias');
  const g = parseLanes(c.replace(/^\s*%%.*\n/gm, ''));
  const id = (re) => [...g.nodes.entries()].find(([, n]) => re.test(n.label))[0];
  const has = (a, b) => g.edges.some((e) => e.from === a && e.to === b);
  assert(has('INICIO', id(/^Colocar leite/)), 'cobertura nasce logo depois do Início, na sua raia:\n' + c);
  assert(!has(id(/^Despejar massa/), id(/^Colocar leite/)), 'massa e cobertura não formam fila:\n' + c);
  assert(has(id(/^Despejar massa/), id(/^Levar forma/)), 'massa segue para o forno:\n' + c);
  assert(has(id(/^Desligar/), id(/^Espalhar cobertura/)), 'cobertura se junta no passo que a usa:\n' + c);
  assert(has(id(/^Assar por mais/), id(/^Fazer teste/)), 'assar mais volta ao teste do palito:\n' + c);
  assert(/Palito sai limpo\?/.test(c), 'pergunta conjugada certo ("sai"):\n' + c);
  const ai = 'flowchart TD\n    subgraph A["Preparo da massa"]\n        INICIO(["Início"]) --> P1["Bater ovos com açúcar"] --> P2["Despejar massa na forma"] --> P3["Colocar leite condensado na panela"] --> P4["Levar forma ao forno"] --> P5["Desenformar bolo"] --> FIM(["Fim"])\n    end';
  const fx = fixLanes(ai, c.replace(/^\s*%%.*\n/gm, ''));
  const gf = parseLanes(fx.code);
  const lanesUsed = new Set([...gf.nodes.values()].map((n) => n.sg));
  assert(fx.fixed && lanesUsed.size >= 3 && gf.nodes.get('INICIO').sg === gf.sgs[0].id, 'IA amontoada é redistribuída, Início na 1ª raia:\n' + fx.code);
}

// Funcional SEM responsáveis: vertical (de cima para baixo), etapas em faixas horizontais — nenhuma coluna por título
(async () => {
  const { autoLayout } = await import('../public/swimlane.mjs');
  const doc = `Como montar um PC
Etapa 1: Preparação
1. Abra a trava do soquete.
2. Encaixe o processador.
3. Aplique a pasta térmica.
4. Instale o cooler.
5. Encaixe os pentes de RAM.
6. Instale o SSD.
Etapa 2: Gabinete
1. Remova a tampa lateral.
2. Posicione a placa-mãe.
3. Instale a fonte.
Etapa 3: Teste
1. Ligue o computador.
2. Feche a tampa lateral.`;
  const c = heuristicMermaid(doc, 'PC', 'TD', 'raias');
  assert(/%% raias: etapas/.test(c), 'marca etapas (não responsáveis):\n' + c);
  const m = autoLayout(c, { type: 'raias', title: 'PC' });
  const bands = m.nodes.filter((n) => /^SEC_/.test(n.id)).sort((a, b) => a.y - b.y);
  assert(bands.length === 3, 'uma faixa por etapa: ' + bands.length);
  assert(bands.every((b, i) => !i || (b.y === bands[i - 1].y + bands[i - 1].h && b.x === bands[0].x && b.w === bands[0].w)), 'faixas empilhadas, encostadas e da mesma largura');
  assert(!m.nodes.some((n) => /^RAIA_/.test(n.id)), 'nenhuma raia em coluna');
  const boxes = m.nodes.filter((n) => n.shape !== 'container');
  const xs = new Set(boxes.map((n) => Math.round(n.x + n.w / 2)));
  assert(xs.size === 1, 'sem decisões: uma coluna central só (' + [...xs] + ')');
  const ys = boxes.map((n) => n.y);
  assert(m.nodes.find((n) => n.id === 'INICIO').y === Math.min(...ys) && m.nodes.find((n) => n.id === 'FIM').y === Math.max(...ys), 'Início em cima e Fim embaixo');
  for (const e of m.edges) {
    const A = m.nodes.find((n) => n.id === e.from), B = m.nodes.find((n) => n.id === e.to);
    assert(B.y > A.y, 'todas as setas descem: ' + A.text + ' → ' + B.text);
  }
  const solo = heuristicMermaid(`Como publicar\n1. Acesse o site.\n2. Clique em Criar.\n3. Escolha o vídeo.\n4. Preencha o título.\n5. Escolha a visibilidade.\n6. Agende a data.\n7. Clique em Salvar.\n8. Compartilhe o link.`, 'Publicar', 'TD', 'raias');
  assert(!/subgraph/.test(solo) && !/Fase \d/.test(solo), 'sem etapas nem responsáveis: nada de raias/fases inventadas:\n' + solo);
})().catch((err) => { console.error(err); process.exit(1); });
