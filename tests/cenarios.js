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
  const fin = finalize(code, { text, type: pick.type, interpreted: !!report.warnings.length, content: report.content, sources: report.sources });
  const m = fromMermaid(fin.code);
  const byLabel = (re) => [...m.nodes.values()].find((n) => re.test(n.label));
  const has = (a, b, label) => m.edges.some((e) => e.from === a?.id && e.to === b?.id && (label === undefined || e.label === label));
  return { text, pick, code: fin.code, issues: fin.issues, notes: report.warnings, goal: report.goal, m, byLabel, has, functional: fin.functional };
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
    // cruzamentos: um trecho horizontal de uma seta cortando um trecho vertical de OUTRA (encontros em "T" de setas
    // que convergem não contam)
    const segs = model.edges.filter((e) => e.kind !== 'straight').map((e) => { const pts = routeEdge(model, e); return pts.slice(1).map((p, k) => [pts[k], p]); });
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) for (const [a1, a2] of segs[i]) for (const [b1, b2] of segs[j]) {
      const h = a1[1] === a2[1] ? [a1, a2] : b1[1] === b2[1] ? [b1, b2] : null, v = h && (h[0] === a1 ? [b1, b2] : [a1, a2]);
      if (!h || v[0][0] !== v[1][0] || h === v) continue;
      const x = v[0][0], y = h[0][1];
      if (x > Math.min(h[0][0], h[1][0]) + 2 && x < Math.max(h[0][0], h[1][0]) - 2 && y > Math.min(v[0][1], v[1][1]) + 2 && y < Math.max(v[0][1], v[1][1]) - 2) crossings++;
    }
    return { overlap, through, nodes: boxes.length, crossings };
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
    assert(m.nodes.filter((n) => n.shape !== 'container').every((n) => n === fim || /^FIM\d/.test(n.id) || n.y < fim.y), 'Fim na última linha');
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
  // ---- Semântica do Funcional: estruturas genéricas (não dependem do assunto dos documentos)
  {
    const F = (f) => generate(f, 'raias');
    const out = (r, d) => r.m.edges.filter((e) => e.from === d?.id);
    const to = (r, d, ans) => r.m.nodes.get(out(r, d).find((e) => e.label === ans)?.to);
    const isEnd = (n) => n && n.type === 'end';
    const failEnd = (n) => isEnd(n) && /sem conclus/i.test(n.label);
    const chk = (r, id) => r.functional.checks.find((c) => c.id === id);

    await scenario('sem_neg_conexao', 'decisão NEGATIVA: Sim = falha (corrige), Não = sucesso (encerra)', () => {
      const r = F('sem_neg_conexao');
      const d = r.byLabel(/Internet não funciona\?/);
      assert(d, 'pergunta negativa preservada');
      assert(/^Reiniciar roteador/.test(to(r, d, 'Sim')?.label), 'Sim (há problema) → ação corretiva: ' + to(r, d, 'Sim')?.label);
      assert(isEnd(to(r, d, 'Não')) && !failEnd(to(r, d, 'Não')), 'Não (conexão normal, atendimento encerrado) → Fim, sem caixa "Estar normal"');
      assert(!r.byLabel(/^Estar normal|Resolver problema/), 'frase de RESULTADO não vira atividade');
      assert(r.has(r.byLabel(/^Reiniciar roteador/), r.byLabel(/^Testar conexão/)), '"Após reiniciar, teste" continua a partir da correção (não volta para "Verificar luz")');
      const v = r.byLabel(/Conexão volta\?/);
      assert(v && isEnd(to(r, v, 'Sim')) && !failEnd(to(r, v, 'Sim')), 'sucesso ("o problema foi resolvido") → Fim');
      assert(/^Contatar suporte/.test(to(r, v, 'Não')?.label), '"problema persista" = o Não da MESMA decisão (sem 2º losango)');
      assert(!r.byLabel(/persist/i), 'sem losango "Problema persiste?" depois do sucesso');
      const dd = r.functional.activities.find((a) => a.id === d.id);
      assert(dd.condition.negated && dd.condition.state === 'falha', 'expressão normalizada: NÃO internet funciona → falha');
      assert(dd.outcomes.find((o) => o.answer === 'Sim').kind === 'falha' && dd.outcomes.find((o) => o.answer === 'Não').kind === 'encerramento', 'cada resposta associada ao destino e ao tipo de resultado');
      assert(r.functional.lanes.length === 1 && r.functional.lanes[0].generic, 'sem responsáveis no texto → raia genérica (nada inventado)');
      assert(r.functional.checks.every((c) => c.ok), 'as 14 verificações passam: ' + r.functional.checks.filter((c) => !c.ok).map((c) => c.label + ' ' + c.detail));
    });

    await scenario('sem_neg_equipamento', 'negativa + "siga para X" + falha que encaminha não segue para o caminho de sucesso', () => {
      const r = F('sem_neg_equipamento');
      const d = r.byLabel(/continua sem ligar\?/);
      const cfg = r.byLabel(/^Selecionar idioma/);
      assert(r.has(d, cfg, 'Não'), 'Não (ligou) → salto "siga para a configuração inicial"');
      assert(!r.byLabel(/^Seguir para configura/), 'o salto não vira atividade');
      assert(/^Trocar tomada/.test(to(r, d, 'Sim')?.label), 'Sim (não liga) → trocar tomada');
      assert(r.byLabel(/^Tentar ligar novamente/), '"tente ligar novamente" é uma nova tentativa (bloco), não um retorno a "Verificar cabo"');
      assert(!r.has(r.byLabel(/^Tentar ligar|^Trocar tomada/), r.byLabel(/^Verificar se cabo/)), 'sem laço inventado');
      const l = r.byLabel(/Equipamento liga\?/);
      assert(r.has(l, cfg, 'Sim'), 'ligou → configuração inicial');
      const asst = r.byLabel(/^Encaminhar equipamento para assistência/);
      assert(r.has(l, asst, 'Não') && !r.has(asst, cfg), 'falha → assistência e NÃO segue para a configuração');
      assert(r.m.edges.some((e) => e.from === asst.id && failEnd(r.m.nodes.get(e.to))), 'encaminhamento encerra em "Fim sem conclusão"');
    });

    await scenario('sem_sucesso_falha', 'aprovado × recusado = uma decisão; a falha não leva às atividades do sucesso', () => {
      const r = F('sem_sucesso_falha');
      const ds = [...r.m.nodes.values()].filter((n) => n.type === 'decision');
      assert.strictEqual(ds.length, 1, 'uma decisão (sem "Pagamento é recusado?" depois do sucesso): ' + ds.map((x) => x.label));
      const d = ds[0];
      assert(/^Emitir nota fiscal/.test(to(r, d, 'Sim')?.label), 'Sim → nota fiscal');
      const neg = to(r, d, 'Não');
      assert(/^Solicitar outro meio/.test(neg?.label), 'Não → solicitar outro meio');
      assert(!r.has(neg, r.byLabel(/^Separar produtos/)), 'pagamento recusado NÃO segue para separar produtos');
      assert(r.m.edges.some((e) => e.from === neg.id && failEnd(r.m.nodes.get(e.to))), 'continuidade não descrita → "Fim sem conclusão" + aviso');
      assert(r.notes.some((w) => /não diz o que acontece depois de "Solicitar outro meio/.test(w)), 'aviso de continuidade não descrita');
      assert(r.functional.lanes.length === 4, '4 raias (cliente, sistema, estoque, transportadora)');
      assert.strictEqual(r.functional.activities.find((a) => a.id === d.id).decision_kind, 'automatizada', 'decisão do sistema = automatizada');
    });

    await scenario('sem_humano_auto', 'ação humana × automatizada; decisão de quem decide; correção volta à validação', () => {
      const r = F('sem_humano_auto');
      const fm = r.functional, act = (re) => fm.activities.find((a) => re.test(a.label));
      assert.strictEqual(act(/^Acessar sistema/).lane, 'Comprador', '"acessa o sistema" é do comprador (citar tecnologia não faz do sistema o executor)');
      assert.strictEqual(act(/^Validar .*CNPJ/).lane, 'Sistema', 'validação automática no sistema');
      assert.strictEqual(act(/CNPJ é inválido\?/).decision_kind, 'automatizada', 'validação do sistema = decisão automatizada');
      assert.strictEqual(act(/^Corrigir dados/).lane, 'Comprador', '"e o comprador corrige os dados" vira bloco do comprador');
      assert(r.has(r.byLabel(/^Corrigir dados/), r.byLabel(/^Validar .*CNPJ/)), 'correção volta para a validação (laço com saída)');
      const ap = act(/Aprova cadastro\?/);
      assert(ap && ap.lane === 'Analista fiscal' && ap.decision_kind === 'humana', 'decisão humana na raia de quem decide');
      assert.strictEqual(fm.activities.filter((a) => a.type === 'decision').length, 2, '"decide se aprova" + "Se aprovado/Se reprovado" = UMA decisão (sem "Decidir")');
      assert(!r.byLabel(/^Decidir$/), 'sem bloco "Decidir"');
      assert(chk(r, 9).ok, 'laço tem condição de saída');
    });

    await scenario('sem_metodos', 'métodos alternativos: intro não vira ramo; condição de método preservada; repetição intencional', () => {
      const r = F('sem_metodos');
      const d = r.byLabel(/Portal ou e-mail\?/);
      assert(d && out(r, d).length === 2, 'escolha com 2 saídas (a frase "de duas formas" não vira ramo nem atividade)');
      assert(!r.byLabel(/duas formas|Deseja enviar/), 'anúncio das alternativas não é atividade');
      const em = r.byLabel(/Envio foi feito por e-mail\?/);
      assert(em && /^Aguardar resposta/.test(to(r, em, 'Sim')?.label), 'atividade só do e-mail mantém a condição');
      assert.strictEqual(r.functional.activities.find((a) => /^Aguardar resposta/.test(a.label)).lane, 'Solicitante', '"aguarde a resposta automática" é do solicitante, não do sistema');
      assert(!r.issues.some((i) => /aparece 2 vezes/.test(i.message)), '"Anexar arquivo" nos dois métodos é repetição intencional (sem aviso)');
      assert(chk(r, 7).ok && chk(r, 13).ok, 'verificações 7 e 13 passam');
    });

    await scenario('sem_metodos2', 'convergência condicional: atividade de um método fica só no caminho dele', () => {
      const r = F('sem_metodos2');
      const g = r.byLabel(/Instalação pelo disco\?/);
      const ret = r.byLabel(/^Retirar disco/);
      assert(g && r.has(g, ret, 'Sim'), '"Retire o disco" depois da junção ganha a condição do método');
      assert(r.has(g, r.byLabel(/^Reiniciar computador/), 'Não'), 'o download segue sem retirar disco');
      assert(r.has(r.byLabel(/^Abrir instalador/), r.byLabel(/^Aceitar termos/)) && r.has(r.byLabel(/^Abrir arquivo baixado/), r.byLabel(/^Aceitar termos/)), 'atividades comuns convergem');
      assert(chk(r, 13).ok, 'verificação 13 passa');
    });

    await scenario('sem_recuperacao', 'recuperação: verificação depois da correção, repetição com limite e saída', () => {
      const r = F('sem_recuperacao');
      const v = r.byLabel(/Serviço voltou a responder\?/);
      assert(v, '"Verifique se voltou a responder" + "Se responder" = uma decisão (texto completo)');
      assert(/^Registrar ocorrência e encerrar/.test(to(r, v, 'Sim')?.label), 'sucesso → registrar e encerrar (sem "encerre")');
      const p = r.byLabel(/persiste após 3 tentativas\?/);
      assert(p && r.has(v, p, 'Não'), 'falha → pergunta com o limite de tentativas');
      assert(r.has(p, r.byLabel(/^Reiniciar serviço/), 'Não'), 'ainda dentro do limite → repete a reinicialização');
      assert(/^Acionar equipe de plantão/.test(to(r, p, 'Sim')?.label), '"Persistindo a falha, acione…" é a saída do laço (sem bloco "Persistir falha")');
      assert(!r.byLabel(/^Persistir/), 'sem "Persistir falha"');
      assert(chk(r, 9).ok, 'laço com condição de saída');
    });

    await scenario('sem_recuperacao_sem_fim', 'correção sem verificação descrita: segue em frente e avisa (sem laço inventado)', () => {
      const r = F('sem_recuperacao_sem_fim');
      assert(r.has(r.byLabel(/^Limpar cache/), r.byLabel(/^Fazer login/)), 'segue para o próximo passo');
      assert(!r.m.edges.some((e) => e.from === r.byLabel(/^Limpar cache/).id && e.to === r.byLabel(/^Abrir aplicativo/).id), 'sem retorno inventado');
      assert(r.notes.some((w) => /Limpar cache do aplicativo", o documento não diz se o problema foi resolvido/.test(w)), 'avisa que a verificação não foi descrita');
      const s = r.byLabel(/Senha não é aceita\?/);
      assert(s && /^Redefinir senha/.test(to(r, s, 'Sim')?.label), 'pergunta negativa: Sim (não aceita) → redefinir');
    });

    await scenario('sem_truncado', 'textos: palavra hifenizada unida, quebra suspeita marcada, redundância unida', () => {
      const r = F('sem_truncado');
      assert(r.byLabel(/^Acessar painel de administração/), '"adminis- tração" → "administração"');
      const a = r.byLabel(/autenticação/);
      assert(a, 'frase "Na aba Segurança, ative…" não some (era descartada como explicação)');
      assert(a.classes.has('revisar') && r.issues.some((i) => /Texto a revisar: "Ativar autenticação.*eta pas/.test(i.message)), 'pedaços sem prova ("eta pas") ficam marcados para revisão');
      assert(!chk(r, 6).ok, 'verificação 6 aponta a descrição');
      assert(r.byLabel(/^Salvar alterações/) && !r.byLabel(/^Clicar em Salvar$/), '"Clique em Salvar" + "Salve as alterações" = um bloco');
      assert(r.byLabel(/^Preencher formulário/) && r.byLabel(/^Revisar formulário/), 'ações diferentes sobre o mesmo objeto continuam separadas');
    });

    await scenario('func_recomendacoes_opcionais', 'opcionais continuam escolhas e recomendações continuam notas (14 verificações)', () => {
      const r = F('func_recomendacoes_opcionais');
      assert(r.functional.activities.some((a) => a.type === 'decision' && /^(Deseja|Precisa)\b/.test(a.label)), 'opcional = escolha');
      assert(chk(r, 11).ok && chk(r, 14).ok, 'recomendação não vira etapa; fidelidade');
    });

    await scenario('sem_todos', 'as 14 verificações rodam em todos os documentos do Funcional', () => {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt')).map((x) => x.replace('.txt', ''))) {
        const r = F(f);
        assert.strictEqual(r.functional.checks.length, 14, f + ': 14 verificações');
        const bad = r.functional.checks.filter((c) => !c.ok && ![6, 12].includes(c.id));
        assert(!bad.length, f + ': ' + bad.map((c) => `${c.id} ${c.label}: ${c.detail}`).join(' | '));
        for (const d of r.functional.activities.filter((a) => a.type === 'decision')) assert(d.condition && d.outcomes.length >= 2, f + ': decisão sem expressão/saídas: ' + d.label);
        // desenho: losango de Sim/Não com uma ponta para cada resposta
        const m = laneLayout(r);
        for (const d of m.nodes.filter((n) => n.shape === 'diamond')) {
          const ps = m.edges.filter((e) => e.from === d.id && e.kind !== 'straight').map((e) => e.fromPort);
          if (ps.length === 2) assert(ps[0] !== ps[1], f + ': as duas respostas de "' + d.text + '" saem pela mesma ponta');
        }
      }
    });
  }

  await scenario('func_layout', 'Funcional: sem cruzamentos de setas, Fim por raia e ramo negativo que encerra', () => {
    for (const f of ['atendimento', 'func_recomendacoes_opcionais', 'func_secoes_responsaveis', 'func_um_responsavel', 'instalar_ps5',
      'sem_metodos', 'sem_metodos2', 'sem_humano_auto', 'sem_neg_conexao', 'sem_neg_equipamento', 'sem_sucesso_falha', 'sem_recuperacao']) {
      const v = visual(generate(f, 'raias'));
      assert.strictEqual(v.crossings, 0, f + ': setas que se cruzam');
      assert.strictEqual(v.through, 0, f + ': setas sobre blocos');
    }
    // atendimento: 3 raias terminam o fluxo → 3 símbolos de Fim, cada um na sua raia (nenhuma seta longa até o Cliente)
    const at = generate('atendimento', 'raias');
    const fins = [...at.m.nodes.values()].filter((n) => n.type === 'end');
    assert.strictEqual(new Set(fins.map((n) => n.group)).size, fins.length, 'um Fim por raia');
    assert(at.m.edges.filter((e) => fins.some((f) => f.id === e.to)).every((e) => at.m.nodes.get(e.from).group === at.m.nodes.get(e.to).group), 'cada caminho termina no Fim da própria raia');
    // "Caso contrário, o atendente informa que a troca não é possível": o ramo Não encerra, não segue para "Escolher novo produto"
    const tr = generate('func_dois_responsaveis', 'raias');
    const inf = tr.byLabel(/^Informar ao cliente/);
    assert(inf && tr.m.edges.some((e) => e.from === inf.id && tr.m.nodes.get(e.to).type === 'end'), 'ramo negativo termina em Fim sem conclusão');
    assert(!tr.has(inf, tr.byLabel(/^Escolher novo produto/)), 'ramo negativo não segue para a troca');
  });
  await scenario('atendimento', 'F3 vários departamentos', () => {
    const { lanes } = F('atendimento');
    assert(lanes.length >= 4 && ['Cliente', 'Equipe de vendas', 'Suporte técnico', 'Desenvolvimento'].every((x) => lanes.includes(x)), lanes.join(', '));
  });
  await scenario('empresa_reembolso', 'F4/F5/F6 transferências, aprovação/rejeição e retorno entre raias', () => {
    const { fm, laneOf } = F('empresa_reembolso');
    assert.strictEqual(laneOf(/^Gestor aprova\?/), 'Gestor');
    const corr = fm.activities.find((a) => /^Corrigir/.test(a.label)), anal = fm.activities.find((a) => /^Analisar/.test(a.label));
    assert(corr.lane === 'Colaborador' && corr.out.some((o) => o.to === anal.id), 'rejeição volta ao colaborador, que corrige e reenvia ao gestor');
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

  await scenario('func_recomendacoes_opcionais', 'F11 recomendações, opcionais, explicações e responsáveis fora da lista', () => {
    const text = fs.readFileSync(path.join(dir, 'func_recomendacoes_opcionais.txt'), 'utf8');
    const rep = {};
    const fin = finalize(heuristicMermaid(text, 'x', 'TD', 'raias', { report: rep }), { text, type: 'raias', sources: rep.sources, content: rep.content });
    const fm = fin.functional, A = fm.activities, act = (re) => A.find((a) => re.test(a.label));
    assert.deepStrictEqual(fm.lanes.map((l) => l.title), ['Síndico', 'Administradora', 'Moradores', 'Conselho fiscal'], 'responsáveis fora da lista fixa (síndico, administradora) e "cabe ao conselho fiscal"');
    assert(!A.some((a) => /recomendado|cópia digital|costuma|cerca de uma hora|pronto/i.test(a.label)), 'recomendação/observação/explicação não viram caixa');
    assert(act(/^Enviar edital/).notes.some((n) => /recomendado/i.test(n)), 'recomendação vira nota da atividade relacionada');
    assert(act(/^Arquivar ata/).notes.some((n) => /cópia digital/i.test(n)), '"Importante:" vira nota');
    const optD = act(/^Deseja enviar sugestões/), opt = act(/^Enviar sugestões/);
    assert(optD && optD.type === 'decision' && optD.lane === 'Moradores' && opt.category === 'opcional', '"podem enviar" vira escolha opcional na raia dos moradores');
    assert(optD.out.some((o) => o.label === 'Não' && o.to !== opt.id), 'o "Não" da opcional segue em frente');
    assert(act(/^Precisa contratar auditoria/)?.lane === 'Síndico', '"Se necessário" vira "Precisa…?" na raia de quem faz');
    assert.strictEqual(act(/aprovam contas\?/).lane, 'Moradores', 'decisão de quem decide');
    assert.strictEqual(act(/^Refazer parecer/).lane, 'Conselho fiscal', 'alternativa "Não" com o responsável dela');
    assert(act(/^Apresentar parecer/).stage_id === 'E2' && act(/^Apresentar parecer/).lane_id, 'stage_id e lane_id independentes');
    const st2 = new Set(A.filter((a) => a.stage_id === 'E2').map((a) => a.lane)), sind = new Set(A.filter((a) => a.lane === 'Síndico' && a.stage_id).map((a) => a.stage_id));
    assert(st2.size >= 3 && sind.size >= 3, 'uma etapa com vários responsáveis e um responsável em várias etapas');
    assert(rep.content.some((c) => c.category === 'recomendação') && rep.content.some((c) => c.category === 'explicativa') && rep.content.some((c) => c.category === 'opcional'), 'conteúdo classificado');
    const bad = fm.checks.filter((c) => !c.ok);
    assert.strictEqual(fm.checks.length, 14); assert(!bad.length, 'validação do Funcional sem pendências: ' + bad.map((c) => c.label + ' — ' + c.detail).join('; '));
  });
  await scenario('func_secoes_responsaveis', 'F12 seções com o nome do responsável (não viram etapas)', () => {
    const { lanes, laneOf, fm } = F('func_secoes_responsaveis');
    assert.deepStrictEqual(lanes, ['Cliente', 'Transportadora']);
    assert.strictEqual(laneOf(/^Retirar mercadoria/), 'Transportadora'); assert.strictEqual(laneOf(/^Conferir mercadoria/), 'Cliente');
    assert.strictEqual(laneOf(/não está em casa\?/), 'Transportadora', '"se o cliente não estiver em casa": decide quem está entregando');
    assert(!fm.stages.length, 'título de responsável não vira faixa de etapa');
  });
  await scenario('func_validacao', 'validação do Funcional aponta atividade na raia errada e recomendação como tarefa', () => {
    const { functionalModel, functionalChecks } = require('../lib/pipeline');
    const { fromMermaid } = require('../lib/model');
    const { functionalContext, actorOf } = require('../lib/functional');
    const code = '%% tipo: raias\nflowchart TD\n  subgraph R1["Cliente"]\n    INICIO(["Início"])\n    P1["Abrir chamado"]\n    P2["Resolver problema"]\n    P3["Evitar senhas fracas"]\n    FIM(["Fim"])\n  end\n  subgraph R2["Suporte"]\n    P4["Registrar"]\n  end\n  INICIO --> P1\n  P1 --> P2\n  P2 --> P3\n  P3 --> FIM';
    const text = 'O cliente abre o chamado. O suporte resolve o problema. Evite senhas fracas.';
    const fctx = functionalContext(text.split(/(?<=\.)\s+/));
    const fm = functionalModel(fromMermaid(code), code, { P1: 'O cliente abre o chamado.', P2: 'O suporte resolve o problema.', P3: 'Evite senhas fracas.' }, { fctx });
    const checks = functionalChecks(fm, [], text, fctx), c = (id) => checks.find((x) => x.id === id);
    assert(!c(3).ok && /Resolver problema/.test(c(3).detail), 'raia errada detectada: ' + JSON.stringify(c(3)));
    assert(!c(8).ok && /Evitar senhas/.test(c(8).detail), 'recomendação como tarefa detectada');
    assert(!c(4).ok && /Registrar/.test(c(4).detail), 'atividade desconectada detectada');
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
          || g.title.split(/\s+/).some((w) => { const x = w.replace(/[^\wÀ-ú-]/g, ''); return [x, x.replace(/e?s$/i, '')].some((f) => ROLE.test(f) || ROLE.test(f.replace(/a$/i, 'o')) || ROLE.test(f.replace(/a$/i, ''))); })
          || (text.match(new RegExp('\\b(?:o|a|os|as)\\s+' + g.title.split(/\s+/)[0], 'gi')) || []).length >= 2, 'raia deve ser um responsável: ' + g.title);
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
