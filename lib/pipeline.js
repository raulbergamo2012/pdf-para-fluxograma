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
const { fromMermaid, toMermaid, nextId } = require('./model');
const { validateModel } = require('./validate');
const { UNKNOWN, functionalContext, actorOf, classifySentence } = require('./functional');

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
 * Representação intermediária do Fluxograma Funcional (independente do desenho), validada antes de ir à tela:
 *   lanes[]      { id, title, generic, system }            raias = responsáveis (entidades separadas das atividades)
 *   stages[]     { id, title, ids }                         etapas = agrupamento secundário
 *   activities[] { id, label, notes[], type, category, responsible, lane, lane_id, stage, stage_id,
 *                  conditions[], deps[], in[], out[], source }
 *   handoffs[]   ligações que TRANSFEREM a responsabilidade (de uma raia para outra)
 *   content[]    cada informação do documento com a sua categoria (obrigatória, opcional, recomendação…)
 *   checks[]     as 14 verificações do Funcional { id, label, ok, detail }
 */
const SYSTEM_LANE = /^(sistema|aplicativo|app|console|computador|site|plataforma|impressora|servidor|loja|jogo|navegador|roteador|programa)$/i;
function functionalModel(model, code, sources = {}, extra = {}) {
  const groups = model.groups.filter((g) => [...model.nodes.values()].some((n) => n.group === g.id));
  const lanes = groups.map((g) => ({ id: g.id, title: g.title, generic: g.title === UNKNOWN, system: SYSTEM_LANE.test(g.title) }));
  const laneG = (id) => groups.find((g) => g.id === model.nodes.get(id)?.group);
  const stages = [...String(code).matchAll(/^\s*%%\s*etapa:\s*(.+?)\s*::\s*(.*)$/gm)].map((m, i) => ({ id: 'E' + (i + 1), title: m[1].trim(), ids: m[2].trim().split(/\s+/).filter(Boolean) }));
  const stageOf = (id) => stages.find((st) => st.ids.includes(id));
  const flow = model.edges.filter((e) => !e.note && model.nodes.get(e.to)?.type !== 'note');
  const catOf = (src) => (src ? classifySentence(src, extra.fctx || {}) : '');
  const activities = [...model.nodes.values()].filter((n) => n.type !== 'note').map((n) => {
    const [main, ...rest] = String(n.label).split(/<br\s*\/?>/i);
    const g = laneG(n.id), st = stageOf(n.id);
    const category = n.type === 'decision' ? 'decisão' : n.type === 'start' || n.type === 'end' ? n.type === 'start' ? 'início' : 'encerramento'
      : n.type === 'io' ? 'entrada/saída' : flow.some((e) => e.to === n.id && model.nodes.get(e.from)?.type === 'decision' && /^deseja|^precisa/i.test(model.nodes.get(e.from).label)) ? 'opcional'
      : flow.some((e) => e.to === n.id && model.nodes.get(e.from)?.type === 'decision') ? 'condicional' : 'obrigatória';
    return {
      id: n.id, label: main.trim(), notes: rest.map((x) => x.replace(/^\(|\)$/g, '').trim()).filter(Boolean), type: n.type, category,
      responsible: g?.title || '', lane: g?.title || '', lane_id: g?.id || '', stage: st?.title || '', stage_id: st?.id || '',
      deps: flow.filter((e) => e.to === n.id).map((e) => e.from),
      conditions: flow.filter((e) => e.to === n.id && model.nodes.get(e.from)?.type === 'decision' && e.label)
        .map((e) => ({ decision: e.from, question: model.nodes.get(e.from).label, answer: e.label })),
      in: flow.filter((e) => e.to === n.id).map((e) => e.from),
      out: flow.filter((e) => e.from === n.id).map((e) => ({ to: e.to, label: e.label || '' })),
      source: sources[n.id] || '', source_category: catOf(sources[n.id]),
    };
  });
  const handoffs = flow.filter((e) => laneG(e.from) && laneG(e.to) && laneG(e.from).id !== laneG(e.to).id)
    .map((e) => ({ from: e.from, to: e.to, fromLane: laneG(e.from).title, toLane: laneG(e.to).title, label: e.label || '' }));
  return { lanes, stages, activities, handoffs, content: extra.content || [] };
}

/** As 14 verificações do Fluxograma Funcional (avisa; só corrige o que é seguro — a correção estrutural já foi feita) */
function functionalChecks(fm, issues, text, fctx) {
  const A = fm.activities, byId = new Map(A.map((a) => [a.id, a]));
  const steps = A.filter((a) => !['start', 'end', 'note'].includes(a.type));
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const T = norm(text);
  const has = (re) => issues.some((i) => re.test(i.message));
  const list = [];
  const chk = (id, label, ok, detail = '') => list.push({ id, label, ok: !!ok, detail: ok ? '' : detail });
  const generic = fm.lanes.filter((l) => l.generic);
  chk(1, 'Responsáveis identificados', !generic.length, `atividades sem responsável no documento ficaram em "${UNKNOWN}"`);
  const unjust = fm.lanes.filter((l) => !l.generic && !l.system && !T.includes(norm(l.title).split(' ')[0].replace(/(es|s)$/, '')));
  const empty = fm.lanes.filter((l) => !A.some((a) => a.lane_id === l.id && !['start', 'end'].includes(a.type)));
  chk(2, 'Raias com justificativa no documento', !unjust.length && !empty.length, [...unjust.map((l) => `"${l.title}" não aparece no texto`), ...empty.map((l) => `"${l.title}" sem atividades`)].join('; '));
  const wrong = fctx ? steps.filter((a) => {
    if (!a.source || a.type === 'decision') return false;
    const who = actorOf(a.source, fctx);
    return who && who !== UNKNOWN && who !== a.lane && fm.lanes.some((l) => l.title === who) && !/,\s*que\s/i.test(a.source) && !/(?:^|\s)(?:é|são|foi|será)\s+[\wÀ-ú]+(?:ad|id)[oa]s?\b/i.test(a.source);
  }) : [];
  chk(3, 'Cada atividade na raia de quem a executa', !wrong.length, wrong.slice(0, 3).map((a) => `"${a.label}" está em ${a.lane}`).join('; '));
  const loose = A.filter((a) => (a.type !== 'start' && !a.in.length) || (a.type !== 'end' && !a.out.length));
  chk(4, 'Nenhuma atividade desconectada', !loose.length, loose.slice(0, 3).map((a) => `"${a.label}"`).join(', '));
  const badDec = A.filter((a) => a.type === 'decision' && (a.out.length < 2 || a.out.some((o) => !o.label)));
  chk(5, 'Decisões com caminhos coerentes', !badDec.length && !has(/decis[aã]o.*(uma sa[ií]da|sem r[oó]tulo)/i), badDec.slice(0, 3).map((a) => `"${a.label}"`).join(', '));
  chk(6, 'Sequência válida (sem laço sem saída, sem caminho sem fim)', !has(/la[cç]o sem sa[ií]da|caminho sem fim|n[aã]o chega ao fim/i), 'veja os avisos de sequência');
  const seen = new Map(), dups = [];
  for (const a of steps) { const k = a.lane_id + '|' + norm(a.label); if (seen.has(k)) dups.push(a); else seen.set(k, a); }
  chk(7, 'Sem ações duplicadas na mesma raia', !dups.length, dups.slice(0, 3).map((a) => `"${a.label}"`).join(', '));
  const recoAsTask = steps.filter((a) => a.type !== 'decision' && ['recomendação', 'observação', 'explicativa'].includes(a.source_category));
  chk(8, 'Recomendações e observações não viraram tarefa', !recoAsTask.length, recoAsTask.slice(0, 3).map((a) => `"${a.label}"`).join(', '));
  const optAsMand = steps.filter((a) => a.source_category === 'opcional' && a.category !== 'opcional' && a.category !== 'condicional' && a.type !== 'decision');
  chk(9, 'Atividades opcionais representadas como escolha', !optAsMand.length, optAsMand.slice(0, 3).map((a) => `"${a.label}"`).join(', '));
  const badHand = fm.handoffs.filter((h) => byId.get(h.from)?.type === 'end' || byId.get(h.to)?.type === 'start');
  const decLane = fctx ? A.filter((a) => a.type === 'decision' && a.source && /^(se|caso)\s/i.test(a.source.trim()) && (() => { const w = actorOf(a.source, fctx); return w && fm.lanes.some((l) => l.title === w) && w !== a.lane; })()) : [];
  chk(10, 'Conexões entre raias corretas (decisão na raia de quem decide)', !badHand.length && !decLane.length, [...badHand.map((h) => `${h.from}→${h.to}`), ...decLane.map((a) => `"${a.label}" em ${a.lane}`)].join('; '));
  const starts = A.filter((a) => a.type === 'start'), ends = A.filter((a) => a.type === 'end');
  chk(11, 'Início único e encerramentos coerentes', starts.length === 1 && ends.length >= 1 && ends.every((e) => e.in.length), `${starts.length} início(s), ${ends.length} fim(ns)`);
  chk(12, 'Posicionamento visual (sobreposições, setas sobre caixas)', true, '');   // conferido no navegador, ao desenhar
  chk(13, 'Sem omissões de informações do documento', !has(/omiss/i), 'veja os avisos de omissão');
  chk(14, 'Textos completos e com sentido', !has(/texto incerto|cortad|sem sentido|incomplet/i), 'veja os avisos de texto');
  return list;
}

/**
 * Funcional: quando caminhos de várias raias terminam no MESMO "Fim", cada raia ganha o seu próprio símbolo de Fim
 * (convenção de swimlane). Sem isso, as setas descem pelo diagrama inteiro até uma raia distante, cruzando as
 * passagens de responsabilidade no caminho. O Fim original fica na raia de onde chega o fluxo principal.
 */
function splitEnds(model) {
  const main = model.nodes.get('FIM');
  if (!main || main.type !== 'end') return 0;
  const ins = model.edges.filter((e) => e.to === 'FIM' && model.nodes.get(e.from));
  const laneOf = (id) => model.nodes.get(id).group;
  if (new Set(ins.map((e) => laneOf(e.from))).size < 2) return 0;
  if (!ins.some((e) => laneOf(e.from) === main.group)) {
    main.group = laneOf(ins.reduce((a, b) => (model.nodes.get(a.from).order > model.nodes.get(b.from).order ? a : b)).from);
  }
  const made = new Map();
  for (const e of ins) {
    const lane = laneOf(e.from);
    if (lane === main.group) continue;
    if (!made.has(lane)) {
      const id = nextId(model, 'FIM');
      const src = model.nodes.get(e.from);
      model.nodes.set(id, { id, type: 'end', open: '([', close: '])', label: main.label || 'Fim', group: lane, order: src.order + 0.5, bare: false, classes: new Set(['inicioFim']) });
      made.set(lane, id);
      // a etapa (faixa horizontal) do novo Fim é a da atividade que termina nele
      model.header = model.header.map((h) => (/^%%\s*etapa:/i.test(h) && new RegExp(`::.*(?:^|\\s)${e.from}(?:\\s|$)`).test(h) ? `${h} ${id}` : h));
    }
    e.to = made.get(lane);
  }
  return made.size;
}

function finalize(code, ctx = {}) {
  try {
    const model = fromMermaid(code);
    const { issues } = validateModel(model, ctx);
    if (ctx.type === 'raias' && splitEnds(model)) issues.push({ level: 'interpretação', message: 'Caminhos de raias diferentes terminam no próprio Fim de cada raia (sem setas longas atravessando o diagrama).' });
    const out = toMermaid(model);
    if (ctx.type === 'raias') {
      const sentences = String(ctx.text || '').split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 3);
      const fctx = functionalContext(sentences);
      fctx.actorOf = (t) => actorOf(t, fctx);
      const functional = functionalModel(model, out, ctx.sources, { content: ctx.content, fctx });
      // responsáveis: avisa quando o documento não permite uma divisão funcional confiável (nada é inventado)
      const human = functional.lanes.filter((l) => !l.generic && !/^(sistema|aplicativo|console|computador|site|plataforma|impressora|servidor)$/i.test(l.title));
      if (functional.lanes.some((l) => l.generic)) {
        issues.unshift({ level: 'aviso', message: `O documento não diz quem executa ${human.length ? 'parte das' : 'as'} atividades: elas ficaram na raia "${UNKNOWN}". Defina os responsáveis na aba Análise (renomear a raia ou mover atividades).` });
      } else if (functional.lanes.length === 1) {
        issues.unshift({ level: 'interpretação', message: `Só um responsável foi identificado no documento ("${functional.lanes[0].title}"): o Funcional tem uma raia. Você pode acrescentar responsáveis na aba Análise.` });
      }
      functional.checks = functionalChecks(functional, issues, ctx.text, ctx.text ? fctx : null);
      for (const c of functional.checks) if (!c.ok && [2, 3, 8, 9, 10].includes(c.id)) issues.push({ level: 'aviso', message: `Funcional — ${c.label}: ${c.detail}.` });
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

module.exports = { chooseType, finalize, summary, functionalModel, functionalChecks };
