'use strict';
/**
 * Orquestra as camadas do gerador (o texto do PDF já chega extraído pela camada 1, no navegador):
 *   2. interpretação  — lib/heuristic.js + lib/interpret.js (modo Regras) ou a IA (lib/ai.js + lib/prompt.js)
 *   3. representação  — lib/model.js (nós tipados, ligações, grupos)
 *   4. validação      — lib/validate.js (corrige o que for seguro e lista avisos)
 *   5. renderização   — navegador (public/swimlane.mjs + public/visual-model.mjs), a partir do código validado
 * Também escolhe o TIPO de fluxograma quando o usuário deixa no Automático.
 */
const { heuristicMermaid } = require('./heuristic');
const { fromMermaid, toMermaid } = require('./model');
const { validateModel } = require('./validate');
const { UNKNOWN } = require('./functional');

/**
 * Tipo automático, pela estrutura do documento:
 *  - responsáveis/departamentos (2+ raias de pessoas/áreas)  → Funcional (raias)
 *  - 3+ decisões reais, ou processo extenso com etapas         → Ramificado por etapas (decisão sem perguntas artificiais)
 *  - o resto                                                  → Processo (linear, vertical)
 */
function chooseType(text, title) {
  const lanes = heuristicMermaid(text, title, 'TD', 'raias');
  // Funcional quando o documento cita 2+ responsáveis REAIS (a raia genérica "não especificado" não conta)
  const titles = [...lanes.matchAll(/^\s*subgraph\s+\w+\["([^"]*)"\]/gm)].map((m) => m[1]);
  const real = titles.filter((t) => t !== UNKNOWN);
  if (real.length >= 2) return { type: 'raias', natural: true, reason: `${real.length} responsáveis identificados (${real.join(', ')})` };
  // preparos/atividades em paralelo (o Início abre 2+ frentes) → Funcional, com as frentes lado a lado
  if ((lanes.match(/^\s*INICIO\s*-->/gm) || []).length >= 2) return { type: 'raias', natural: true, reason: 'atividades em paralelo identificadas' };
  const flat = heuristicMermaid(text, title, 'TD', 'processo');
  const decisions = (flat.match(/\{"/g) || []).length;
  const steps = (flat.match(/^\s*[PE]\d+[[(/]/gm) || []).length;
  const staged = heuristicMermaid(text, title, 'TD', 'decisao', { natural: true });
  const stages = (staged.match(/^\s*subgraph\b/gm) || []).length;
  if (decisions >= 3) return { type: 'decisao', natural: true, reason: `${decisions} decisões no documento` };
  if (steps > 18 && stages >= 2) return { type: 'decisao', natural: true, reason: `processo extenso: ${steps} passos em ${stages} etapas` };
  return { type: 'processo', natural: false, reason: decisions ? `${decisions} decisão(ões), ${steps} passos` : `${steps} passos em sequência` };
}

/** Camadas 3 e 4: código → modelo → validação/correção → código final. Nunca lança: em último caso devolve o original. */
/**
 * Representação intermediária do Fluxograma Funcional (independente do desenho):
 *   lanes[]      raias = responsáveis (definidas separadamente dos nós)
 *   stages[]     etapas do processo (agrupamento secundário)
 *   activities[] { id, label, type, lane, stage, deps, conditions, in, out, source }
 *   handoffs[]   ligações que TRANSFEREM a responsabilidade (de uma raia para outra)
 */
function functionalModel(model, code, sources = {}) {
  const groups = model.groups.filter((g) => [...model.nodes.values()].some((n) => n.group === g.id));
  const lanes = groups.map((g) => ({ id: g.id, title: g.title, generic: g.title === UNKNOWN }));
  const laneOf = (id) => groups.find((g) => g.id === model.nodes.get(id)?.group)?.title || '';
  const stages = [...String(code).matchAll(/^\s*%%\s*etapa:\s*(.+?)\s*::\s*(.*)$/gm)].map((m) => ({ title: m[1].trim(), ids: m[2].trim().split(/\s+/).filter(Boolean) }));
  const stageOf = (id) => stages.find((st) => st.ids.includes(id))?.title || '';
  const flow = model.edges.filter((e) => !e.note && model.nodes.get(e.to)?.type !== 'note');
  const activities = [...model.nodes.values()].filter((n) => n.type !== 'note').map((n) => ({
    id: n.id, label: String(n.label).replace(/<br\s*\/?>/gi, ' '), type: n.type, lane: laneOf(n.id), stage: stageOf(n.id),
    deps: flow.filter((e) => e.to === n.id).map((e) => e.from),
    conditions: flow.filter((e) => e.to === n.id && model.nodes.get(e.from)?.type === 'decision' && e.label)
      .map((e) => ({ decision: e.from, question: model.nodes.get(e.from).label, answer: e.label })),
    in: flow.filter((e) => e.to === n.id).map((e) => e.from),
    out: flow.filter((e) => e.from === n.id).map((e) => e.to),
    source: sources[n.id] || '',
  }));
  const handoffs = flow.filter((e) => laneOf(e.from) && laneOf(e.to) && laneOf(e.from) !== laneOf(e.to))
    .map((e) => ({ from: e.from, to: e.to, fromLane: laneOf(e.from), toLane: laneOf(e.to), label: e.label || '' }));
  return { lanes, stages, activities, handoffs };
}

function finalize(code, ctx = {}) {
  try {
    const model = fromMermaid(code);
    const { issues } = validateModel(model, ctx);
    const out = toMermaid(model);
    if (ctx.type === 'raias') {
      const functional = functionalModel(model, out, ctx.sources);
      // responsáveis: avisa quando o documento não permite uma divisão funcional confiável (nada é inventado)
      const human = functional.lanes.filter((l) => !l.generic && !/^(sistema|aplicativo|console|computador|site|plataforma|impressora|servidor)$/i.test(l.title));
      if (functional.lanes.some((l) => l.generic)) {
        issues.unshift({ level: 'aviso', message: `O documento não diz quem executa ${human.length ? 'parte das' : 'as'} atividades: elas ficaram na raia "${UNKNOWN}". Defina os responsáveis na aba Análise (renomear a raia ou mover atividades).` });
      } else if (functional.lanes.length === 1) {
        issues.unshift({ level: 'interpretação', message: `Só um responsável foi identificado no documento ("${functional.lanes[0].title}"): o Funcional tem uma raia. Você pode acrescentar responsáveis na aba Análise.` });
      }
      return { code: out, issues, model, functional };
    }
    return { code: out, issues, model };
  } catch (err) {
    return { code, issues: [{ level: 'aviso', message: `Não foi possível validar a estrutura automaticamente (${err.message}).` }], model: null };
  }
}

/** Resumo do modelo (para a aba Análise): contagem por tipo de símbolo */
function summary(model) {
  if (!model) return null;
  const count = {};
  for (const n of model.nodes.values()) count[n.type] = (count[n.type] || 0) + 1;
  return { nodes: model.nodes.size, edges: model.edges.length, groups: model.groups.length, types: count };
}

module.exports = { chooseType, finalize, summary, functionalModel };
