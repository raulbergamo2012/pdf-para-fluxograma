/* Testes de cenários: 8 documentos com estruturas diferentes passam por TODAS as camadas
 * (interpretação → modelo → validação → layout) e o resultado é conferido na lógica e no desenho.
 *   node tests/cenarios.js          (também roda em: npm test)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { heuristicMermaid } = require('../lib/heuristic');
const { chooseType, finalize } = require('../lib/pipeline');
const { fromMermaid } = require('../lib/model');

const dir = path.join(__dirname, 'cenarios');
const read = (f) => fs.readFileSync(path.join(dir, f + '.txt'), 'utf8');

/** gera como o servidor faz no modo Regras com tipo Automático (ou o tipo pedido) */
function generate(name, type = 'auto') {
  const text = read(name);
  const pick = type === 'auto' ? chooseType(text, name) : { type, natural: false };
  const report = {};
  const code = heuristicMermaid(text, name, 'TD', pick.type, { natural: pick.natural, report });
  const fin = finalize(code, { text, type: pick.type, interpreted: !!report.warnings.length });
  const m = fromMermaid(fin.code);
  const byLabel = (re) => [...m.nodes.values()].find((n) => re.test(n.label));
  const has = (a, b, label) => m.edges.some((e) => e.from === a?.id && e.to === b?.id && (label === undefined || e.label === label));
  return { text, pick, code: fin.code, issues: fin.issues, notes: report.warnings, goal: report.goal, m, byLabel, has };
}

const results = [];
async function scenario(name, label, fn) {
  try { await fn(); results.push(['✔', name, label]); }
  catch (e) { results.push(['✘', name, label + ' — ' + e.message.split('\n')[0]]); process.exitCode = 1; }
}

(async () => {
  const { autoLayout } = await import('../public/swimlane.mjs');
  const { routeEdge } = await import('../public/visual-model.mjs');
  /** checagem visual: caixas sobrepostas e setas atravessando caixas no layout automático */
  const visual = (r) => {
    const model = autoLayout(r.code, { type: r.pick.type, title: 'T' });
    const boxes = model.nodes.filter((n) => n.shape !== 'container' && !n.band);
    let overlap = 0, through = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) overlap++;
    }
    for (const e of model.edges) {
      const pts = routeEdge(model, e);
      if (boxes.some((n) => n.id !== e.from && n.id !== e.to && pts.some((p, k) => k > 0 && (() => {
        const q = pts[k - 1], x1 = Math.min(p[0], q[0]), x2 = Math.max(p[0], q[0]), y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
        return x2 > n.x + 3 && x1 < n.x + n.w - 3 && y2 > n.y + 3 && y1 < n.y + n.h - 3;
      })()))) through++;
    }
    return { overlap, through, nodes: boxes.length };
  };
  const common = (r) => {
    assert(!r.issues.some((i) => i.level === 'erro'), 'validação com erro: ' + JSON.stringify(r.issues.filter((i) => i.level === 'erro')));
    const v = visual(r);
    assert.strictEqual(v.overlap, 0, 'caixas sobrepostas');
    assert.strictEqual(v.through, 0, 'setas atravessando caixas');
    return v;
  };

  await scenario('linear_cafe', 'tutorial linear sem decisões', () => {
    const r = generate('linear_cafe'); common(r);
    assert.strictEqual(r.pick.type, 'processo');
    assert.strictEqual([...r.m.nodes.values()].filter((n) => n.type === 'decision').length, 0, 'sem decisões artificiais');
    assert(r.byLabel(/^Ferver 500 ml de água/), 'verbo no infinitivo');
    assert(r.has(r.byLabel(/^Despejar água/), r.byLabel(/^Aguardar café/)), 'ordem preservada');
  });

  await scenario('tecnico_impressora', 'procedimento técnico com Sim/Não', () => {
    const r = generate('tecnico_impressora'); common(r);
    assert([...r.m.nodes.values()].filter((n) => n.type === 'decision').length >= 3, '3 decisões');
    const papel = r.byLabel(/papel na bandeja\?/);
    assert(papel && r.has(papel, r.byLabel(/^Colocar papel/), 'Não'), '"Confirme se há papel" + "Se não houver" = uma decisão');
    const impressa = r.byLabel(/Página foi impressa\?/);
    assert(r.has(r.byLabel(/^Reinstalar driver/), r.byLabel(/^Enviar página de teste/)), 'Não → reinstalar → volta ao envio (sem duplicar)');
    assert(r.has(impressa, r.byLabel(/^Encerrar atendimento/), 'Sim'), 'Sim → encerrar');
  });

  await scenario('empresa_reembolso', 'processo empresarial com aprovação/rejeição', () => {
    const r = generate('empresa_reembolso'); common(r);
    assert.strictEqual(r.pick.type, 'raias', 'responsáveis → raias');
    const d = r.byLabel(/Gestor aprova\?/);
    assert(d && r.has(d, r.byLabel(/^Encaminhar para financeiro/), 'Sim') && r.has(d, r.byLabel(/^Notificar colaborador/), 'Não'), 'aprovar/reprovar = uma decisão');
    assert(r.has(r.byLabel(/^Corrigir solicitação/), r.byLabel(/^Analisar solicitação/)), 'correção volta para a análise');
    assert(r.has(r.byLabel(/^Devolver solicitação/), r.byLabel(/^Fim sem conclusão/)), 'devolução encerra (o próximo passo depende do pagamento)');
  });

  await scenario('falhas_backup', 'falhas e tentativas de correção', () => {
    const r = generate('falhas_backup'); common(r);
    const exec = r.byLabel(/^Executar backup/);
    const persist = r.byLabel(/persiste/i);
    assert(persist && r.has(persist, exec, 'Não'), 'laço de nova tentativa volta a "Executar backup"');
    assert(r.has(persist, r.byLabel(/^Abrir chamado/), 'Sim'), 'após 3 tentativas → chamado');
    assert.strictEqual([...r.m.nodes.values()].filter((n) => /^Executar backup/.test(n.label)).length, 1, 'sem "executar de novo" duplicado');
  });

  await scenario('paralelo_evento', 'atividades paralelas', () => {
    const r = generate('paralelo_evento'); common(r);
    const start = [...r.m.nodes.values()].find((n) => n.type === 'start');
    assert(r.m.edges.filter((e) => e.from === start.id).length >= 2, 'Início abre duas frentes');
    assert(r.m.edges.filter((e) => e.to === r.byLabel(/^Receber convidados/).id).length >= 2, 'frentes se juntam antes da realização');
  });

  await scenario('extenso_erp', 'documento extenso com várias etapas', () => {
    const r = generate('extenso_erp'); common(r);
    assert.strictEqual(r.pick.type, 'decisao'); assert(r.pick.natural, 'sem perguntas artificiais');
    assert(r.m.groups.length >= 6, 'etapas agrupadas com título');
    assert(!r.byLabel(/conclu[ií]d[ao]\?$/), 'sem "Etapa concluída?" inventado');
    const d = r.byLabel(/testes .*aprovados\?/i);
    assert(d && r.has(d, r.byLabel(/^Executar testes integrados/), 'Não'), 'testes reprovados → executa de novo');
  });

  await scenario('ambiguo', 'informações ambíguas ou incompletas', () => {
    const r = generate('ambiguo'); common(r);
    assert([...r.m.nodes.values()].some((n) => n.type === 'doubt'), 'caminho não descrito fica marcado como dúvida');
    assert(r.notes.some((n) => /sem critério claro/.test(n)), 'instrução vaga avisada');
    assert(r.byLabel(/^Reiniciar servidor/), 'instrução vaga mantida, sem "talvez"');
  });

  await scenario('formatar_windows', 'formatação do Windows (exemplo do usuário)', () => {
    const r = generate('formatar_windows'); common(r);
    assert.strictEqual(r.goal, 'reinstalar o Windows do zero usando um pendrive de instalação', 'objetivo identificado e fora do fluxo');
    const ids = [...r.m.nodes.values()].sort((a, b) => a.order - b.order).map((n) => n.label);
    assert(ids.findIndex((l) => /^Clicar em Concluir/.test(l)) > ids.findIndex((l) => /^Aguardar download/.test(l)), 'Concluir depois da gravação');
    assert(ids.findIndex((l) => /^Selecionar unidade do pendrive/.test(l)) < ids.findIndex((l) => /^Clicar em Concluir/.test(l)), 'unidade antes de concluir');
    const pend = r.byLabel(/Pendrive foi reconhecido\?/);
    assert(pend && r.has(r.byLabel(/^Verificar conexão do pendrive/), r.byLabel(/^Ligar computador e abrir menu de boot/)), 'pendrive não reconhecido → verificar → religar');
    assert(/F12, F8 ou Esc/.test(r.byLabel(/^Ligar computador/).label), 'teclas preservadas como observação');
    assert(r.byLabel(/Tem chave do produto\?/), 'chave do produto vira decisão');
    assert([...r.m.nodes.values()].some((n) => n.type === 'io'), 'entrada de dados em paralelogramo');
    const err = r.byLabel(/Ocorreu algum erro/);
    assert(err && r.has(r.byLabel(/^Anotar código do erro/), r.byLabel(/^Clicar em Instalar agora/)), 'erro na instalação → anotar → reinicia a instalação');
    assert(r.m.groups.length >= 5, '5 etapas agrupadas');
  });

  // os tipos escolhidos à mão continuam funcionando com os mesmos documentos
  for (const t of ['processo', 'raias', 'decisao']) {
    await scenario('formatar_windows', `tipo ${t} escolhido à mão`, () => {
      const r = generate('formatar_windows', t); common(r);
      if (t === 'processo') assert.strictEqual(r.m.groups.length, 0, 'Processo continua sem colunas/caixas');
    });
  }

  // ---- Funcional (raias): lógica e desenho claros
  const laneLayout = (r) => autoLayout(r.code, { type: 'raias', title: 'T' });
  await scenario('instalar_ps5', 'Funcional: métodos alternativos por etapa', () => {
    const r = generate('instalar_ps5', 'raias'); common(r);
    const vert = r.byLabel(/^Inserir disco com etiqueta/);
    assert(vert && !r.has(vert, r.byLabel(/^Inserir disco do jogo/)), '"voltada para a esquerda" não vira retorno');
    assert(r.has(vert, r.byLabel(/^Instalação inicia/)), 'etiqueta → instalação');
    const net = r.byLabel(/conectado à internet\?/);
    assert(net && !r.has(net, r.byLabel(/^Instalação inicia/), 'Não'), 'Não da internet não inventa retorno');
    assert(r.byLabel(/^Verificar se console está em Modo de Repouso/), '"Certifique-se" sem consequência vira passo');
    const m = laneLayout(r), P = (re) => m.nodes.find((n) => re.test(n.text || ''));
    const d = P(/Qual instalação/), heads = [/^Ligar console/, /^Acessar PlayStation/, /^Abrir aplicativo/].map(P);
    assert(heads.every((n) => Math.abs(n.y + n.h / 2 - heads[0].y - heads[0].h / 2) < 2 && n.y > d.y), 'os 3 métodos começam na mesma linha, abaixo do losango');
    assert(new Set(heads.map((n) => Math.round(n.x))).size === 3, 'métodos lado a lado, sem empilhar');
    const lanes = m.nodes.filter((n) => /^RAIA_/.test(n.id)).map((n) => n.text);
    assert.deepStrictEqual(lanes, ['Responsável não especificado', 'Sistema'], 'raias = quem executa (leitor não identificado + sistema): ' + lanes);
    const inst = P(/^Instalação inicia/), lSys = m.nodes.find((n) => n.id.startsWith('RAIA_') && n.text === 'Sistema');
    assert(inst.x >= lSys.x && inst.x + inst.w <= lSys.x + lSys.w, '"a instalação iniciará automaticamente" fica na raia do Sistema');
    const rows = m.nodes.filter((n) => /^ETAPA_\d/.test(n.id));
    assert(rows.length === 2 && rows.some((b) => /disco · digital/.test(b.text)), 'etapas como faixas (métodos alternativos na mesma faixa): ' + rows.map((b) => b.text));
    const fim = m.nodes.find((n) => n.id === 'FIM');
    assert(m.nodes.filter((n) => n.shape !== 'container').every((n) => n === fim || n.y < fim.y), 'Fim na última linha');
    const grp = (id) => m.edges.filter((e) => e.from === id && e.label);
    for (const dd of m.nodes.filter((n) => n.shape === 'diamond')) {
      const ports = grp(dd.id).map((e) => e.fromPort);
      assert(new Set(ports).size === ports.length, 'cada saída do losango por uma ponta própria: ' + dd.text + ' ' + ports);
    }
    assert(m.edges.filter((e) => e.from === 'D3').every((e) => e.label), 'todas as saídas do losango com rótulo');
  });
  await scenario('empresa_reembolso', 'Funcional: cada ação na raia de quem faz', () => {
    const r = generate('empresa_reembolso', 'raias'); common(r);
    const grp = (re) => r.m.groups.find((g) => g.id === r.byLabel(re)?.group)?.title;
    assert.strictEqual(grp(/^Corrigir solicitação/), 'Colaborador', 'colaborador corrige');
    assert.strictEqual(grp(/^Notificar colaborador/), 'Gestor', 'gestor notifica');
    const m = laneLayout(r);
    const e = m.edges.find((x) => x.from === r.byLabel(/^Corrigir/).id && x.to === r.byLabel(/^Analisar/).id);
    assert(e && e.fromPort === 'top' && e.toPort === 'left', 'retorno sai por cima e entra pela lateral (não pela linha do losango)');
  });
  await scenario('atendimento', 'Funcional: mesma atividade em raias diferentes sem aviso', () => {
    const text = fs.readFileSync(path.join(dir, 'atendimento.txt'), 'utf8');
    const code = heuristicMermaid(text, 'a', 'TD', 'raias', { report: {} });
    const fin = finalize(code, { text, type: 'raias' });
    assert(!fin.issues.some((i) => /aparece 2 vezes/.test(i.message)), 'sem aviso de duplicado entre raias');
  });
  await scenario('roblox_celular', 'Funcional: etapas, dicas e textos (teste do usuário)', () => {
    const r = generate('roblox_celular', 'raias'); common(r);
    assert(/^%% etapa: Etapa 3: Segurança da conta :: /m.test(r.code), '"Etapa 3" não some quando a linha anterior não termina com ponto:\n' + r.code);
    assert(!r.byLabel(/^Etapa 3/), 'título da etapa não vira texto de bloco');
    assert(/Não usar seu nome real/.test(r.byLabel(/^Informar nome de usuário/).label), 'dica "não usar nome real" dentro do bloco do nome');
    assert(/Anotar senha/.test(r.byLabel(/^Informar senha/).label), 'dica "anotar senha" dentro do bloco da senha');
    assert(/idade real/.test(r.byLabel(/^Informar data de nascimento/).label), 'aviso da idade dentro do bloco da data');
    assert(![...r.m.nodes.values()].some((n) => /^(Importante|Não usar|Anotar)/.test(n.label)), 'nenhuma dica como atividade');
    assert(r.byLabel(/^Selecionar estilo inicial do avatar$/), '"Gênero: Selecione…" vira "Selecionar…"');
    assert(r.byLabel(/^Começar a jogar$/), '"Comece a jogar" → "Começar a jogar"');
    assert(r.byLabel(/tocar no ícone de lupa$/), 'ícone com o complemento e 2º verbo no infinitivo');
    assert(r.byLabel(/^Verificar se desenvolvedor é Roblox/), '"Verificar se…" com o "se"');
    assert.strictEqual([...r.m.nodes.values()].filter((n) => /loja de aplicativos/.test(n.label)).length, 1, 'acessar/abrir loja = um passo');
  });
  await scenario('loja_redundante', 'Acessar loja + Abrir loja em sequência viram um passo', () => {
    const code = '%% tipo: raias\nflowchart TD\n  subgraph R1["A"]\n    INICIO(["Início"])\n    P1["Acessar loja de aplicativos"]\n    P2["Abrir loja de aplicativos"]\n    P3["Pesquisar por Roblox"]\n    FIM(["Fim"])\n  end\n  INICIO --> P1\n  P1 --> P2\n  P2 --> P3\n  P3 --> FIM';
    const fin = finalize(code, { text: '', type: 'raias' });
    assert(!/Abrir loja/.test(fin.code) && /P1 --> P3/.test(fin.code.replace(/\s+/g, ' ')), fin.code);
  });
  // ---- as 10 estruturas de processo do Funcional
  const F = (f) => {
    const text = fs.readFileSync(path.join(dir, f + '.txt'), 'utf8');
    const rep = {};
    const code = heuristicMermaid(text, f, 'TD', 'raias', { report: rep });
    const fin = finalize(code, { text, type: 'raias', sources: rep.sources });
    const fm = fin.functional;
    const laneOf = (re) => fm.activities.find((a) => re.test(a.label))?.lane;
    return { fin, fm, laneOf, lanes: fm.lanes.map((l) => l.title) };
  };
  await scenario('func_um_responsavel', 'F1 um responsável: uma raia com o nome dele', () => {
    const { fm, lanes, fin } = F('func_um_responsavel');
    assert.deepStrictEqual(lanes, ['Técnico']); assert(!fm.handoffs.length, 'sem transferências');
    assert(fin.issues.some((i) => /Só um responsável/.test(i.message)), 'a Análise informa que há um responsável só');
  });
  await scenario('func_dois_responsaveis', 'F2 dois responsáveis: cada atividade na raia de quem faz', () => {
    const { lanes, laneOf, fm } = F('func_dois_responsaveis');
    assert.deepStrictEqual(lanes, ['Cliente', 'Atendente']);
    assert.strictEqual(laneOf(/^Apresentar produto/), 'Cliente'); assert.strictEqual(laneOf(/^Conferir nota/), 'Atendente');
    assert.strictEqual(laneOf(/^Escolher novo produto/), 'Cliente'); assert.strictEqual(laneOf(/^Entregar novo produto/), 'Atendente');
    assert.strictEqual(laneOf(/dentro do prazo\?/), 'Atendente', 'decisão na raia de quem decide');
    assert(fm.handoffs.length >= 3, 'transferências registradas: ' + fm.handoffs.length);
  });
  await scenario('atendimento', 'F3 vários departamentos', () => {
    const { lanes } = F('atendimento');
    assert(lanes.length >= 4 && ['Cliente', 'Equipe de vendas', 'Suporte técnico', 'Desenvolvimento'].every((x) => lanes.includes(x)), lanes.join(', '));
  });
  await scenario('empresa_reembolso', 'F4/F5/F6 transferências, aprovação/rejeição e retorno entre raias', () => {
    const { fm, laneOf } = F('empresa_reembolso');
    assert.strictEqual(laneOf(/^Gestor aprova\?/), 'Gestor');
    const corr = fm.activities.find((a) => /^Corrigir/.test(a.label)), anal = fm.activities.find((a) => /^Analisar/.test(a.label));
    assert(corr.lane === 'Colaborador' && corr.out.includes(anal.id), 'rejeição volta ao colaborador, que corrige e reenvia ao gestor');
    assert(fm.handoffs.some((h) => h.fromLane === 'Colaborador' && h.toLane === 'Gestor' && h.from === corr.id), 'retorno registrado como transferência');
    const pay = fm.activities.find((a) => /^Realizar pagamento/.test(a.label));
    assert(pay.conditions.some((c) => /corretos\?/.test(c.question) && c.answer === 'Sim'), 'condição de execução registrada');
    assert(/realiza o pagamento/.test(pay.source), 'referência ao trecho original');
  });
  await scenario('paralelo_evento', 'F7 atividades paralelas lado a lado na mesma faixa', () => {
    const { fm } = F('paralelo_evento');
    assert(fm.activities.find((a) => a.id === 'INICIO').out.length >= 2, 'Início abre duas frentes');
    assert(fm.stages.some((st) => /·/.test(st.title)), 'frentes paralelas na mesma etapa: ' + fm.stages.map((x) => x.title));
  });
  await scenario('func_sem_responsavel', 'F8 responsáveis não identificados: raia genérica e aviso, nada inventado', () => {
    const { lanes, fin } = F('func_sem_responsavel');
    assert.deepStrictEqual(lanes, ['Responsável não especificado']);
    assert(fin.issues.some((i) => i.level === 'aviso' && /não diz quem executa/.test(i.message)), 'aviso na Análise');
  });
  await scenario('func_etapas_funcoes', 'F9 etapas e funções distintas (etapas não viram raias)', () => {
    const { lanes, fm, laneOf } = F('func_etapas_funcoes');
    assert.deepStrictEqual(lanes, ['Solicitante', 'Analista', 'Gestor', 'Comprador']);
    assert.deepStrictEqual(fm.stages.map((x) => x.title), ['Solicitação', 'Análise', 'Aprovação']);
    assert.strictEqual(laneOf(/^Ajustar pedido/), 'Solicitante', '"…ao solicitante, que ajusta o pedido" vai para a raia do solicitante');
    assert.strictEqual(laneOf(/^Emitir ordem/), 'Comprador');
    assert.strictEqual(fm.activities.find((a) => /^Conferir orçamento/.test(a.label)).stage, 'Análise');
  });
  await scenario('func_extenso', 'F10 processo extenso com várias raias', () => {
    const { lanes, laneOf, fm } = F('func_extenso');
    assert(lanes.length >= 7, lanes.join(', '));
    assert.strictEqual(laneOf(/^Entrevistar/), 'Gestor'); assert.strictEqual(laneOf(/^Assinar contrato/), 'Candidato');
    assert.strictEqual(laneOf(/aprova candidato\?/), 'Gestor', '"Se o gestor aprovar" → decisão do gestor');
    assert.strictEqual(laneOf(/credenciais/), 'Sistema'); assert.strictEqual(laneOf(/^Criar e-mail/), 'TI');
    assert.strictEqual(fm.stages.length, 3);
  });

  // regra geral do Funcional, em TODOS os documentos de teste: raias = responsáveis (nunca títulos de etapa),
  // etapas = faixas horizontais, cada atividade dentro da sua raia e da sua faixa, setas descendo
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt')).map((x) => x.slice(0, -4))) {
    await scenario(f, 'Funcional: raias por responsável, etapas em faixas, fluxo de cima para baixo', () => {
      const r = generate(f, 'raias'); common(r);
      const text = fs.readFileSync(path.join(dir, f + '.txt'), 'utf8');
      const { ROLE } = require('../lib/shorten');
      const heads = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^\d+[.)]/.test(l) && l.length < 70).map((l) => l.replace(/[:.]$/, '').toLowerCase());
      for (const g of r.m.groups) {
        assert(!heads.includes(g.title.toLowerCase()) || ROLE.test(g.title.split(/\s+/)[0]), 'raia não pode ser título do documento: ' + g.title);
        assert(g.title === 'Responsável não especificado' || /^(Sistema|Aplicativo|Console|Computador|Site|Impressora|Servidor|Plataforma|Loja|Jogo|Navegador|Roteador|Programa)$/.test(g.title)
          || g.title.split(/\s+/).some((w) => ROLE.test(w.replace(/[^\wÀ-ú-]/g, ''))), 'raia deve ser um responsável: ' + g.title);
      }
      const m = laneLayout(r);
      const N = (id) => m.nodes.find((n) => n.id === id);
      const lanes = m.nodes.filter((n) => /^RAIA_/.test(n.id));
      const rows = m.nodes.filter((n) => /^ETAPA_\d/.test(n.id));
      for (const n of m.nodes.filter((x) => x.shape !== 'container')) {
        const grp = r.m.nodes.get(n.id)?.group, lane = lanes.find((l) => l.id === 'RAIA_' + grp);
        if (lane) assert(n.x >= lane.x && n.x + n.w <= lane.x + lane.w, 'caixa fora da raia: ' + n.text);
        if (rows.length) {
          const st = (r.code.match(new RegExp('^%% etapa: (.+?) :: .*\\b' + n.id + '\\b', 'm')) || [])[1];
          const row = rows.find((x) => x.text === st);
          if (row) assert(n.y >= row.y - 1 && n.y + n.h <= row.y + row.h + 1, 'caixa fora da faixa da etapa: ' + n.text + ' / ' + st);
        }
      }
      // seta que sobe só como retorno pela lateral (corredor); saindo por baixo e entrando por cima = desenho errado
      const up = m.edges.filter((e) => e.kind === 'orth' && N(e.to).y < N(e.from).y && e.fromPort === 'bottom' && !(e.points && e.points.length >= 3));
      assert(!up.length, 'setas que sobem fora de retorno: ' + up.map((e) => N(e.from).text + '→' + N(e.to).text));
    });
  }

  await scenario('textos', 'complemento do substantivo não fica cortado', () => {
    const { shortenAction } = require('../lib/shorten');
    assert.strictEqual(shortenAction('Alinhe a marcação dourada do processador com a marcação do soquete'), 'Alinhar marcação do processador com marcação do soquete');
    assert.strictEqual(shortenAction('Conecte o monitor, o teclado e o cabo de energia.'), 'Conectar monitor, teclado e cabo de energia');
    assert.strictEqual(shortenAction('Escolha um nome de usuário que não esteja em uso'), 'Escolher nome de usuário');
  });

  for (const [ok, name, label] of results) console.log(`${ok} ${name.padEnd(20)} ${label}`);
  console.log(results.every((r) => r[0] === '✔') ? `\n✔ ${results.length} cenários aprovados` : '\n✘ há cenários com falha');
})();
