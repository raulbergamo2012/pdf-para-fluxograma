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

  await scenario('internet_conexao', 'métodos alternativos + perguntas negativas (exemplo principal)', () => {
    const r = generate('internet_conexao'); common(r);
    const q = r.byLabel(/Qual tipo de conexão\?/);
    assert(q, 'decisão de escolha do método');
    assert(r.has(q, r.byLabel(/^Clicar no ícone de rede/), 'Wi-Fi') && r.has(q, r.byLabel(/Computador tem porta Ethernet\?/), 'Cabo Ethernet'), 'um caminho por método');
    assert(!r.m.edges.some((e) => /Senha está correta/.test(r.m.nodes.get(e.from).label) && /porta Ethernet|Conectar ponta/.test(r.m.nodes.get(e.to).label)), 'Wi-Fi não emenda no Ethernet');
    const abrir = r.byLabel(/^Abrir navegador/);
    assert(r.m.edges.filter((e) => e.to === abrir.id).length === 2, 'os dois métodos convergem na verificação');
    // perguntas sempre afirmativas, sem inverter consequências
    const senha = r.byLabel(/^Senha está correta\?/);
    assert(senha && r.has(senha, r.byLabel(/^Digitar senha/), 'Não'), 'senha incorreta → Não → digitar de novo');
    const porta = r.byLabel(/^Computador tem porta Ethernet\?/);
    assert(r.has(porta, r.byLabel(/^Usar adaptador/), 'Não'), 'sem porta → Não → adaptador');
    const ids = [...r.m.nodes.values()].sort((a, b) => a.order - b.order).map((n) => n.label);
    assert(ids.findIndex((l) => /porta Ethernet\?/.test(l)) < ids.findIndex((l) => /^Conectar ponta do cabo/.test(l)), 'pré-condição (porta) antes de conectar o cabo');
    const pag = r.byLabel(/^Página carrega\?/);
    assert(r.has(pag, r.byLabel(/^Conexão funcionando/), 'Sim'), 'Sim → resultado "Conexão funcionando" (encerramento)');
    assert(r.has(pag, r.byLabel(/^Reiniciar roteador/), 'Não'), 'Não → solução de problemas');
    assert(!r.byLabel(/^Internet (não )?funciona\?/), 'pergunta repetida "Internet não funciona?" não é criada');
    assert(!r.byLabel(/^Estar funcionando/) && !r.byLabel(/^Verificar se cabo está ou/), 'sem textos sem sentido');
    assert(r.byLabel(/^Verificar cabo conectado e senha do Wi-Fi correta/), 'verificação sem consequência vira passo (não losango)');
    const cont = r.byLabel(/^Problema continua\?/);
    assert(r.has(cont, r.byLabel(/^Contatar provedor/), 'Sim'), 'problema continua → Sim → provedor');
  });

  // validação semântica (camada 4) com diagramas defeituosos montados à mão
  await scenario('validação', 'respostas invertidas, decisão inútil, texto sem sentido, direção', () => {
    const { validateModel } = require('../lib/validate');
    const m = fromMermaid(`flowchart TD
    INICIO(["Início"]) --> P1["Abrir navegador"] --> D1{"Internet funciona?"}
    D1 -->|Sim| P2["Reiniciar roteador"] --> FIM(["Fim"])
    D1 -->|Não| R1(["Conexão funcionando"])
    P2 --> D2{"Cabo conectado?"}
    D2 -->|Sim| P3["Car faz"]
    D2 -->|Não| P3
    P3 --> FIM
    FIM --> P1`);
    const { issues } = validateModel(m, {});
    const lbl = (from, to) => m.edges.find((e) => e.from === from && e.to === to)?.label;
    assert.strictEqual(lbl('D1', 'P2'), 'Não', 'contradição corrigida: correção no Não de pergunta afirmativa');
    assert.strictEqual(lbl('D1', 'R1'), 'Sim');
    assert(!m.nodes.has('D2') && m.edges.some((e) => e.from === 'P2' && e.to === 'P3'), 'decisão com as duas saídas no mesmo passo removida');
    assert(issues.some((i) => /Texto incerto em "Car faz"/.test(i.message)) && m.nodes.get('P3').classes.has('duvida'), '"Car faz" sinalizado');
    assert(!m.edges.some((e) => e.from === 'FIM'), 'nada sai do Fim');
  });

  await scenario('layout', 'retorno muito longo usa conectores; retorno tracejado', async () => {
    const r = generate('extenso_erp', 'processo');
    const model = autoLayout(r.code, { type: 'processo', connectorSpan: 300 });
    const cn = model.nodes.filter((n) => /^CN/.test(n.id));
    assert(cn.length === 2 && cn[0].text === cn[1].text, 'par de conectores com a mesma letra');
    const plain = autoLayout(r.code, { type: 'processo' });
    assert(plain.edges.some((e) => e.role === 'retorno' && e.dashed), 'retorno desenhado tracejado');
  });

  // ---------------- v4.2: testes de regressão pedidos (1 a 10)
  await scenario('internet_metodos', 'T1 sem decisões duplicadas (Wi-Fi ou Ethernet? + Qual método?)', () => {
    const r = generate('internet_metodos'); common(r);
    const choice = [...r.m.nodes.values()].filter((n) => n.type === 'decision' && /wi-?fi|ethernet|m[eé]todo/i.test(n.label));
    assert.strictEqual(choice.length, 1, 'uma única decisão de escolha: ' + choice.map((n) => n.label).join(' | '));
    assert(r.has(choice[0], r.byLabel(/^Clicar no ícone de rede/), 'Wi-Fi') && r.has(choice[0], r.byLabel(/^Conectar ponta do cabo/), 'Ethernet'), 'saídas Wi-Fi/Ethernet nos destinos certos');
  });
  await scenario('internet_metodos', 'T2 condição negativa ("Se a internet não funcionar") sem inverter', () => {
    const r = generate('internet_metodos'); common(r);
    const d = r.byLabel(/^Internet funciona\?/);
    assert(d, 'pergunta afirmativa');
    assert(r.has(d, r.byLabel(/^Reiniciar roteador/), 'Não'), 'Não → diagnóstico');
    const yes = r.m.edges.find((e) => e.from === d.id && e.label === 'Sim');
    assert(yes && r.m.nodes.get(yes.to).type === 'end', 'Sim → encerra com sucesso');
    const cont = r.byLabel(/^Problema continua\?/);
    assert(cont && r.has(cont, r.byLabel(/^Acessar site/), 'Não') && r.has(cont, r.byLabel(/^Contatar provedor/), 'Sim'), 'laço "tente novamente" com saída para o provedor');
  });
  await scenario('internet_metodos', 'T3 métodos alternativos convergem na verificação comum', () => {
    const r = generate('internet_metodos'); common(r);
    const abrir = r.byLabel(/^Abrir navegador/);
    const into = r.m.edges.filter((e) => e.to === abrir.id).map((e) => r.m.nodes.get(e.from).label);
    assert(into.length === 2 && into.some((l) => /Avançar/.test(l)) && into.some((l) => /^Computador/.test(l)), 'Wi-Fi e Ethernet chegam em "Abrir navegador": ' + into);
    assert(!r.m.edges.some((e) => /Avançar/.test(r.m.nodes.get(e.from).label) && /cabo/.test(r.m.nodes.get(e.to).label)), 'métodos não emendam um no outro');
    assert(!r.byLabel(/^Mais prático|^Conexão mais/), 'comparativo informativo fica fora do fluxo');
    assert(r.byLabel(/^Selecionar rede doméstica/) && r.byLabel(/^Computador faz conexão automaticamente/) && r.byLabel(/^Clicar no ícone de rede$/), 'textos objetivos ("Selecionar rede", evento automático, sem "na barra" cortado)');
  });
  await scenario('validação', 'T4 conexões inválidas e T5 ciclo intencional × acidental', () => {
    const { validateModel } = require('../lib/validate');
    const m = fromMermaid('flowchart TD\n    INICIO(["Início"]) --> P1["Executar backup"] --> D1{"Backup concluído?"}\n    D1 -->|Não| P1\n    D1 -->|Sim| P2["Registrar resultado"] --> FIM(["Fim"])\n    P2 --> X9');
    const r1 = validateModel(m, {});
    assert(!m.edges.some((e) => e.to === 'X9' && !m.nodes.get('X9')?.label), 'sem destino inexistente sem texto');
    assert(!r1.issues.some((i) => /Laço/.test(i.message)), 'repetição com decisão é intencional (sem aviso)');
    const m2 = fromMermaid('flowchart TD\n    INICIO(["Início"]) --> P1["Abrir arquivo"] --> P2["Editar arquivo"] --> P1\n    P2 --> FIM(["Fim"])');
    const r2 = validateModel(m2, {});
    assert(r2.issues.some((i) => /Laço sem condição/.test(i.message)), 'ciclo sem decisão é acidental (aviso)');
  });
  await scenario('validação', 'T6 texto inválido recupera o trecho original', () => {
    const { validateModel } = require('../lib/validate');
    const m = fromMermaid('flowchart TD\n    INICIO(["Início"]) --> P1["Car faz"] --> FIM(["Fim"])');
    m.nodes.get('P1').source = 'O computador faz a conexão automaticamente ao detectar o cabo.';
    const r = validateModel(m, {});
    assert(r.issues.some((i) => /Texto incerto em "Car faz".*Trecho original/.test(i.message)), 'aviso com o trecho original');
    assert(/Original: O computador faz/.test(m.nodes.get('P1').label), 'trecho original exibido no bloco para revisão');
  });
  await scenario('layout', 'T7 vertical: Início no topo, Fim embaixo, ramificações laterais, sem raias por seção', () => {
    for (const doc of ['internet_metodos', 'internet_conexao', 'formatar_windows', 'paralelo_evento', 'extenso_erp', 'tecnico_impressora']) {
      const r = generate(doc);
      assert.notStrictEqual(r.pick.type, 'raias', `${doc}: sem responsáveis, nada de raias`);
      const model = autoLayout(r.code, { type: r.pick.type, title: 'T' });
      const steps = model.nodes.filter((n) => n.shape !== 'container' && !n.band && !/^CN/.test(n.id));
      const ini = steps.find((n) => n.id === 'INICIO'), fims = steps.filter((n) => /^FIM/.test(n.id));
      assert(steps.every((n) => n.y >= ini.y), `${doc}: Início no topo`);
      const W = Math.max(...steps.map((n) => n.x + n.w)) - Math.min(...steps.map((n) => n.x)), H = Math.max(...steps.map((n) => n.y + n.h)) - ini.y;
      assert(H > W, `${doc}: progressão vertical (altura ${Math.round(H)} > largura ${Math.round(W)})`);
      assert(fims.every((f) => f.y >= Math.max(...steps.filter((n) => n.type !== 'x').map((n) => n.y)) - 400), `${doc}: Fim na parte de baixo`);
      // ramos laterais: em nenhuma linha há mais de 3 blocos lado a lado
      const rows = new Map(); for (const n of steps) { const k = Math.round(n.y / 20); rows.set(k, (rows.get(k) || 0) + 1); }
      assert(Math.max(...rows.values()) <= 3, `${doc}: no máximo 3 blocos por linha`);
    }
  });
  await scenario('layout', 'T8 exportação: texto cabe nas caixas', () => {
    const { wrapText, renderSVG } = require('../public/visual-model.mjs') && {};
    return import('../public/visual-model.mjs').then((vm) => {
      for (const doc of ['internet_metodos', 'formatar_windows']) {
        const r = generate(doc);
        const model = autoLayout(r.code, { type: r.pick.type, title: 'T' });
        for (const n of model.nodes.filter((x) => x.shape !== 'container' && !x.band && x.text)) {
          const lines = String(n.text).split('\n').flatMap((p) => vm.wrapText(p.replace(/^\((.*)\)$/, '$1'), Math.max(20, n.w - 16), n.fontSize || 14));
          const need = lines.length * (n.fontSize || 14) * 1.3 * (n.shape === 'diamond' ? 1.6 : 1);
          assert(need <= n.h + 6, `${doc}: texto cortado em "${n.text}" (${Math.round(need)} > ${n.h})`);
        }
        const svg = vm.renderSVG(model);
        assert.strictEqual((svg.match(/<g class="vn"/g) || []).length, model.nodes.length, 'todas as caixas exportadas');
      }
    });
  });
  await scenario('fidelidade', 'T9 atividades essenciais do PDF presentes (sem omissões)', () => {
    for (const doc of ['internet_metodos', 'internet_conexao', 'formatar_windows', 'tecnico_impressora', 'empresa_reembolso', 'falhas_backup']) {
      const r = generate(doc);
      assert(!r.issues.some((i) => /Possível omissão/.test(i.message)), `${doc}: ${r.issues.filter((i) => /omiss/.test(i.message)).map((i) => i.message)}`);
    }
  });
  await scenario('processos_independentes', 'processos independentes viram fluxogramas separados', () => {
    const { splitProcesses } = require('../lib/pipeline');
    const parts = splitProcesses(read('processos_independentes'));
    assert.deepStrictEqual(parts.map((p) => p.title), ['Como cadastrar um cliente', 'Como emitir um pedido']);
    assert.strictEqual(splitProcesses(read('paralelo_evento')).length, 0, 'preparos de um mesmo processo não são divididos');
  });

  // os tipos escolhidos à mão continuam funcionando com os mesmos documentos
  for (const doc of ['formatar_windows', 'internet_conexao']) for (const t of ['processo', 'raias', 'decisao']) {
    await scenario(doc, `tipo ${t} escolhido à mão`, () => {
      const r = generate(doc, t); common(r);
      if (t === 'processo') assert.strictEqual(r.m.groups.length, 0, 'Processo continua sem colunas/caixas');
    });
  }

  for (const [ok, name, label] of results) console.log(`${ok} ${name.padEnd(20)} ${label}`);
  console.log(results.every((r) => r[0] === '✔') ? `\n✔ ${results.length} cenários aprovados` : '\n✘ há cenários com falha');
})();
