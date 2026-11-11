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

/**
 * Tipo automático, pela estrutura do documento:
 *  - responsáveis/departamentos (2+ raias de pessoas/áreas)  → Funcional (raias)
 *  - 3+ decisões reais, ou processo extenso com etapas         → Ramificado por etapas (decisão sem perguntas artificiais)
 *  - o resto                                                  → Processo (linear, vertical)
 */
function chooseType(text, title) {
  const lanes = heuristicMermaid(text, title, 'TD', 'raias');
  const sgs = (lanes.match(/^\s*subgraph\b/gm) || []).length;
  if (sgs >= 2 && !/%%\s*raias:\s*etapas/.test(lanes)) return { type: 'raias', natural: true, reason: `${sgs} responsáveis/áreas identificados` };
  // preparos/atividades em paralelo (o Início abre 2+ frentes) → raias por frente de trabalho
  if (sgs >= 2 && (lanes.match(/^\s*INICIO\s*-->/gm) || []).length >= 2) return { type: 'raias', natural: true, reason: 'atividades em paralelo identificadas' };
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
function finalize(code, ctx = {}) {
  try {
    const model = fromMermaid(code);
    const { issues } = validateModel(model, ctx);
    return { code: toMermaid(model), issues, model };
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

module.exports = { chooseType, finalize, summary };
