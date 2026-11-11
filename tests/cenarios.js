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

  for (const [ok, name, label] of results) console.log(`${ok} ${name.padEnd(20)} ${label}`);
  console.log(results.every((r) => r[0] === '✔') ? `\n✔ ${results.length} cenários aprovados` : '\n✘ há cenários com falha');
})();
