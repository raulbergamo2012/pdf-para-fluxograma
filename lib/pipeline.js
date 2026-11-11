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
  // RAIAS só quando o conteúdo justifica: responsáveis/departamentos diferentes. Seções, métodos e preparos
  // paralelos NÃO viram colunas — o padrão é o fluxo VERTICAL (de cima para baixo)
  if (sgs >= 2 && !/%%\s*raias:\s*etapas/.test(lanes)) return { type: 'raias', natural: true, reason: `${sgs} responsáveis/áreas identificados` };
  const flat = heuristicMermaid(text, title, 'TD', 'processo');
  const decisions = (flat.match(/\{"/g) || []).length;
  const steps = (flat.match(/^\s*[PE]\d+[[(/]/gm) || []).length;
  const staged = heuristicMermaid(text, title, 'TD', 'decisao', { natural: true });
  const stages = (staged.match(/^\s*subgraph\b/gm) || []).length;
  // métodos alternativos: uma escolha no topo e os caminhos lado a lado se reunindo → vertical ramificado
  if (/%%\s*alternativas/.test(flat)) return { type: 'processo', natural: false, reason: 'métodos alternativos: uma decisão escolhe o método e os caminhos se reúnem' };
  if (decisions >= 3) return { type: 'decisao', natural: true, reason: `${decisions} decisões no documento` };
  if (steps > 18 && stages >= 2) return { type: 'decisao', natural: true, reason: `processo extenso: ${steps} passos em ${stages} etapas` };
  return { type: 'processo', natural: false, reason: decisions ? `${decisions} decisão(ões), ${steps} passos` : `${steps} passos em sequência` };
}

/** Camadas 3 e 4: código → modelo → validação/correção → código final. Nunca lança: em último caso devolve o original. */
function finalize(code, ctx = {}) {
  try {
    const model = fromMermaid(code);
    // origem de cada bloco no PDF (camada 2 → camada 3): usada na validação e na estrutura das decisões
    for (const [id, src] of Object.entries(ctx.sources || {})) if (model.nodes.has(id)) model.nodes.get(id).source = src;
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
  return { nodes: model.nodes.size, edges: model.edges.length, groups: model.groups.length, types: count, decisions: model.decisions || [] };
}

/**
 * Divide o texto em processos INDEPENDENTES quando o documento é uma coleção de procedimentos sem ligação entre si
 * ("Como instalar o programa" / "Como desinstalar o programa"). Só divide quando: há 2+ títulos de procedimento
 * depois do título do documento, nenhum título comum (etapa final, montagem…) vem depois deles e cada parte tem
 * pelo menos 3 instruções. Preparos de um mesmo processo ("Preparo da massa"/"da cobertura") não são divididos.
 */
const PROC_HEAD = /^(como\s+\S+|procedimento\b|processo\s+de\b|rotina\s+de\b|tutorial\b|instru[cç][oõ]es para\b)/i;
function splitProcesses(text) {
  const lines = String(text).split('\n');
  const isHead = (l) => { const t = l.trim(); return t.length >= 6 && t.length <= 90 && !/[.;:]$/.test(t) && !/^\d/.test(t) && t.split(/\s+/).length <= 12; };
  const firstIdx = lines.findIndex((l) => l.trim());
  const heads = [];
  lines.forEach((l, i) => { if (i > firstIdx && isHead(l) && PROC_HEAD.test(l.trim())) heads.push(i); });
  if (heads.length < 2) return [];
  // títulos "comuns" depois do último procedimento (ex.: "Finalização") indicam um processo único
  const otherHeads = lines.slice(heads[heads.length - 1] + 1).filter((l) => isHead(l) && !PROC_HEAD.test(l.trim()) && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(l.trim()) && !/^(dica|nota|aten|importante|observa)/i.test(l.trim()));
  if (otherHeads.length) return [];
  const parts = heads.map((h, k) => ({ title: lines[h].trim(), text: lines.slice(h, heads[k + 1] ?? lines.length).join('\n') }));
  const steps = (t) => t.split('\n').filter((l) => /^\s*(\d{1,2}[.)]|[•\-–*])\s+\S/.test(l)).length;
  if (parts.some((p) => steps(p.text) < 3)) return [];
  // a introdução antes do primeiro procedimento (objetivo, pré-requisitos) acompanha cada parte
  const intro = lines.slice(firstIdx + 1, heads[0]).join('\n').trim();
  return parts.map((p) => ({ title: p.title, text: (intro ? intro + '\n' : '') + p.text }));
}

module.exports = { chooseType, finalize, summary, splitProcesses };
