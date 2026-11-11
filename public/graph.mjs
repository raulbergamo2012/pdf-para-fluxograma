/* Análise de fluxogramas Mermaid
 *  - parseFlowchart: lê o código (subconjunto usado pelo app) em nós e arestas
 *  - analyze:        indicadores, decisões mapeadas e nota de qualidade (0–100)
 *  - summarize:      gera o nível "Resumido" agrupando etapas lineares
 */

const SHAPES = [
  ['(((', ')))', 'terminal'], ['([', '])', 'terminal'], ['[[', ']]', 'process'], ['[(', ')]', 'data'],
  ['((', '))', 'terminal'], ['{{', '}}', 'process'], ['[/', '/]', 'process'], ['[\\', '\\]', 'process'],
  ['[/', '\\]', 'process'], ['[\\', '/]', 'process'], ['[', ']', 'process'], ['{', '}', 'decision'],
  ['(', ')', 'process'], ['>', ']', 'process'],
];
const ARROWS = ['<-->', '-..->', '-.->', '-.-', '==>', '===', '-->', '---', '--o', '--x'];
const ID_RE = /^[A-Za-z_][\w-]*/;

function readNode(s, i) {
  const m = ID_RE.exec(s.slice(i));
  if (!m) return null;
  const node = { id: m[0] };
  let p = i + m[0].length;
  for (const [open, close, kind] of SHAPES) {
    if (!s.startsWith(open, p)) continue;
    let q = p + open.length;
    let label;
    if (s[q] === '"') {
      const endQ = s.indexOf('"', q + 1);
      if (endQ < 0) return null;
      label = s.slice(q + 1, endQ);
      q = endQ + 1;
      if (!s.startsWith(close, q)) return null;
    } else {
      const c = s.indexOf(close, q);
      if (c < 0) return null;
      label = s.slice(q, c).trim();
      q = c;
    }
    Object.assign(node, { open, close, kind, label });
    p = q + close.length;
    break;
  }
  const cls = /^:::([\w-]+)/.exec(s.slice(p));
  if (cls) { node.cls = cls[1]; p += cls[0].length; }
  return { node, end: p };
}

function readArrow(s, i) {
  const ws = /^\s*/.exec(s.slice(i))[0].length;
  let p = i + ws;
  // forma "-- texto -->"
  const textForm = /^(--|-\.|==)\s+([^|]+?)\s+(-->|---|\.->|==>)/.exec(s.slice(p));
  if (textForm) {
    const type = textForm[1] === '-.' ? '-.->' : textForm[1] === '==' ? '==>' : (textForm[3] === '---' ? '---' : '-->');
    return { type, label: textForm[2].trim(), end: p + textForm[0].length };
  }
  const a = ARROWS.find((x) => s.startsWith(x, p));
  if (!a) return null;
  p += a.length;
  let label = '';
  const lm = /^\s*\|([^|]*)\|/.exec(s.slice(p));
  if (lm) { label = lm[1].trim(); p += lm[0].length; }
  return { type: a, label, end: p };
}

function readGroup(s, i) {
  const nodes = [];
  let p = i;
  while (true) {
    p += /^\s*/.exec(s.slice(p))[0].length;
    const r = readNode(s, p);
    if (!r) return null;
    nodes.push(r.node);
    p = r.end;
    const amp = /^\s*&\s*/.exec(s.slice(p));
    if (!amp) break;
    p += amp[0].length;
  }
  return { nodes, end: p };
}

export function parseFlowchart(code) {
  const g = { direction: 'TD', nodes: new Map(), edges: [], classDefs: [], classes: new Map(), subgraphs: [], extra: [], unparsed: [] };
  const stack = [];
  const touch = (n) => {
    let cur = g.nodes.get(n.id);
    if (!cur) {
      cur = { id: n.id, label: n.id, kind: 'process', open: '[', close: ']', sg: stack.at(-1)?.id || null, order: g.nodes.size };
      g.nodes.set(n.id, cur);
      stack.at(-1)?.nodes.push(n.id);
    }
    if (n.kind) Object.assign(cur, { label: n.label, kind: n.kind, open: n.open, close: n.close });
    if (n.cls) addClass(n.id, n.cls);
    return cur;
  };
  const addClass = (id, c) => { if (!g.classes.has(id)) g.classes.set(id, new Set()); g.classes.get(id).add(c); };

  for (const raw of String(code).split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('%%')) continue;
    let m;
    if ((m = /^(flowchart|graph)\s+(\w+)/i.exec(t))) { g.direction = m[2].toUpperCase(); continue; }
    if (/^(flowchart|graph)\s*$/i.test(t)) continue;
    if ((m = /^subgraph\s+(.*)$/i.exec(t))) {
      const body = m[1].trim();
      const lm = /^([\w-]+)\s*\[\s*"?(.*?)"?\s*\]$/.exec(body);
      const id = lm ? lm[1] : (ID_RE.test(body) && !/\s/.test(body) ? body : 'SG' + g.subgraphs.length);
      const sg = { id, label: lm ? lm[2] : body, nodes: [], parent: stack.at(-1)?.id || null };
      g.subgraphs.push(sg);
      stack.push(sg);
      continue;
    }
    if (/^end$/i.test(t)) { stack.pop(); continue; }
    if (/^classDef\s/i.test(t)) { g.classDefs.push(t); continue; }
    if ((m = /^class\s+(\S+)\s+([\w-]+)/i.exec(t))) { m[1].split(',').forEach((id) => addClass(id.trim(), m[2])); continue; }
    if (/^(style|linkStyle|click|direction)\s/i.test(t)) { g.extra.push(t); continue; }

    // instrução: grupo (seta grupo)*
    let left = readGroup(t, 0);
    if (!left) { g.unparsed.push(t); continue; }
    left.nodes.forEach(touch);
    let p = left.end;
    let ok = true;
    while (p < t.length) {
      if (/^\s*;?\s*$/.test(t.slice(p))) break;
      const arrow = readArrow(t, p);
      if (!arrow) { ok = false; break; }
      const right = readGroup(t, arrow.end);
      if (!right) { ok = false; break; }
      right.nodes.forEach(touch);
      for (const a of left.nodes) for (const b of right.nodes) g.edges.push({ from: a.id, to: b.id, type: arrow.type, label: arrow.label });
      left = right;
      p = right.end;
    }
    if (!ok) g.unparsed.push(t);
  }
  return g;
}

// ------------------------------------------------------------------ análise
const hasClass = (g, id, c) => g.classes.get(id)?.has(c) || false;
const plain = (s) => String(s || '').replace(/#(\w+);/g, (_, e) => ({ gt: '>', lt: '<', 35: '#', quot: '"' }[e] || ' ')).replace(/<br\s*\/?>/gi, ' ').trim();

function degrees(g) {
  const out = new Map(), inn = new Map();
  for (const id of g.nodes.keys()) { out.set(id, []); inn.set(id, []); }
  for (const e of g.edges) { out.get(e.from)?.push(e); inn.get(e.to)?.push(e); }
  return { out, inn };
}

export function analyze(g) {
  // notas laterais (fluxograma de Processo) são comentários, não passos: ficam fora das verificações
  const nodes = [...g.nodes.values()].filter((n) => !hasClass(g, n.id, 'nota'));
  const { out, inn } = degrees(g);
  const isStart = (n) => inn.get(n.id).length === 0 && (n.kind === 'terminal' || /^(in[ií]cio|start)/i.test(plain(n.label)) || /^inicio/i.test(n.id));
  const isEnd = (n) => out.get(n.id).length === 0 && (n.kind === 'terminal' || /^(fim|end)\b/i.test(plain(n.label)));
  const decisions = nodes.filter((n) => n.kind === 'decision');
  const starts = nodes.filter(isStart);
  const ends = nodes.filter(isEnd);

  // alcançabilidade a partir do início (ou de todos os nós sem entrada)
  const roots = starts.length ? starts : nodes.filter((n) => inn.get(n.id).length === 0);
  const seen = new Set(roots.map((n) => n.id));
  const queue = [...seen];
  while (queue.length) for (const e of out.get(queue.shift()) || []) if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }

  const fewExits = decisions.filter((d) => out.get(d.id).length < 2);
  const unlabeled = decisions.flatMap((d) => out.get(d.id).filter((e) => !e.label));
  const noQuestion = decisions.filter((d) => !plain(d.label).endsWith('?'));
  const generic = decisions.filter((d) => /^(contr[aá]rio|condi[cç][aã]o|decis[aã]o|ok|sim|n[aã]o|verificar|validar|pergunta|teste)?\??$/i.test(plain(d.label).trim()));
  const genericSteps = nodes.filter((n) => /^(corrigir pend[eê]ncia|tratar (exce[cç][aã]o|pend[eê]ncia|erro)|resolver)$/i.test(plain(n.label).trim()));
  const orphans = nodes.filter((n) => out.get(n.id).length === 0 && inn.get(n.id).length === 0);
  const unreachable = nodes.filter((n) => !seen.has(n.id) && !orphans.includes(n));
  // pontos marcados como dúvida (caminho não descrito no documento) terminam ali de propósito
  const deadEnds = nodes.filter((n) => out.get(n.id).length === 0 && inn.get(n.id).length > 0 && !isEnd(n) && n.kind !== 'terminal' && !hasClass(g, n.id, 'duvida'));
  // linhas "(…)" depois da ação são observações/dicas do bloco: não contam como lista nem como texto longo
  const mainLines = (t) => String(t).split(/<br\s*\/?>/i).filter((l, i) => !(i > 0 && /^\s*\(.*\)\s*$/.test(plain(l))));
  const words = (t) => Math.max(...mainLines(t).map((line) => plain(line).replace(/\(\+\d+ etapas?\)/, '').replace(/^[•\s]+/, '').split(/\s+/).filter(Boolean).length));
  const longLabels = nodes.filter((n) => words(n.label) > 7);
  // uma ação por bloco: nada de listas de tarefas dentro de uma caixa
  const listBlocks = nodes.filter((n) => n.kind !== 'decision' && (mainLines(n.label).filter((l) => plain(l)).length > 1 || /(^|\s)[•]\s/.test(plain(n.label))));
  // etapas de um passo a passo são cronológicas: escolha entre "etapas" é erro de lógica
  const SEQ_WORD = /^(etapa|fase|parte|passo|se[cç][aã]o|step)\b/i;
  const seqChoices = decisions.filter((d) => /^qual (etapa|fase|parte|passo|se[cç][aã]o|ordem|sequ[eê]ncia)\b/i.test(plain(d.label))
    || (out.get(d.id).length > 1 && out.get(d.id).every((e) => SEQ_WORD.test(plain(e.label)))));

  const check = (label, list, each, max, detail) => {
    const penalty = Math.min(max, list.length * each);
    return { label, ok: list.length === 0, penalty, detail: list.length ? detail(list) : '' };
  };
  const names = (list) => list.slice(0, 3).map((n) => `"${plain(n.label).slice(0, 40)}"`).join(', ') + (list.length > 3 ? ` e mais ${list.length - 3}` : '');
  const checks = [
    { label: 'Início definido', ok: starts.length > 0, penalty: starts.length ? 0 : 10, detail: starts.length ? '' : 'Nenhum nó de início encontrado.' },
    { label: 'Fim definido', ok: ends.length > 0, penalty: ends.length ? 0 : 10, detail: ends.length ? '' : 'Nenhum nó de fim encontrado.' },
    check('Decisões com duas ou mais saídas', fewExits, 8, 32, (l) => `Com saída única: ${names(l)}.`),
    check('Saídas das decisões rotuladas', unlabeled, 3, 15, (l) => `${l.length} saída(s) sem rótulo (ex.: Sim/Não).`),
    check('Perguntas terminam com "?"', noQuestion, 2, 10, (l) => `Ajustar: ${names(l)}.`),
    check('Perguntas e ações específicas (nada genérico)', [...generic, ...genericSteps], 6, 18, (l) => `Genéricos: ${names(l)}.`),
    check('Sem elementos soltos', orphans, 5, 15, (l) => `Sem conexão: ${names(l)}.`),
    check('Todos os passos alcançáveis a partir do início', unreachable, 3, 15, (l) => `Fora do caminho: ${names(l)}.`),
    check('Sem becos sem saída', deadEnds, 3, 12, (l) => `Terminam sem ligação ao fim: ${names(l)}.`),
    check('Textos objetivos (até 7 palavras por bloco)', longLabels, 1, 10, (l) => `Mais longos: ${names(l)}.`),
    check('Uma ação por bloco (sem listas de tarefas)', listBlocks, 4, 16, (l) => `Blocos com lista: ${names(l)}. Divida em passos encadeados.`),
    check('Etapas em ordem cronológica (sem escolha entre etapas)', seqChoices, 12, 24, (l) => `Escolha indevida: ${names(l)}. Etapas de um passo a passo vêm uma após a outra.`),
  ];
  let score = Math.max(0, 100 - checks.reduce((s, c) => s + c.penalty, 0));
  if (nodes.length < 3) score = Math.min(score, 40);
  const grade = score >= 90 ? 'Excelente' : score >= 75 ? 'Bom' : score >= 55 ? 'Regular' : 'Revisar';
  const tone = score >= 90 ? 'great' : score >= 75 ? 'good' : score >= 55 ? 'fair' : 'poor';

  const label = (id) => plain(g.nodes.get(id)?.label || id);
  const decisionList = decisions.map((d) => ({
    question: plain(d.label),
    branches: out.get(d.id).map((e) => ({ label: plain(e.label) || '—', to: label(e.to) })),
  }));
  const loops = g.edges.filter((e) => e.type.startsWith('-.')).length;

  return {
    elements: nodes.length,
    edges: g.edges.length,
    decisions: decisions.length,
    instructions: nodes.filter((n) => n.kind !== 'terminal').length,
    loops,
    errors: nodes.filter((n) => hasClass(g, n.id, 'erro')).length,
    flowType: decisions.length ? 'Fluxo com ramificações' : 'Fluxo sequencial',
    checks, score, grade, tone, decisionList,
    parsed: g.unparsed.length === 0,
  };
}

// ------------------------------------------------------------------ nível resumido
function clipLabel(s, n) { s = String(s).trim().replace(/[.;]+$/, ''); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; }

export function summarize(g) {
  if (g.unparsed.length || !g.nodes.size) return { code: null, merged: 0 };
  const { out, inn } = degrees(g);
  const mergeable = (id) => { const n = g.nodes.get(id); return n.kind === 'process' && !hasClass(g, id, 'erro'); };
  const canLink = (a, b) => a !== b && mergeable(a) && mergeable(b)
    && out.get(a).length === 1 && inn.get(b).length === 1 && !out.get(a)[0].label
    && g.nodes.get(a).sg === g.nodes.get(b).sg;

  const headOf = new Map();
  const groups = [];
  for (const id of g.nodes.keys()) {
    if (headOf.has(id) || !mergeable(id)) continue;
    const pred = inn.get(id).length === 1 ? inn.get(id)[0].from : null;
    if (pred && out.get(pred).length === 1 && canLink(pred, id) && out.get(pred)[0].to === id) continue; // meio da cadeia
    const chain = [id];
    let cur = id;
    while (out.get(cur).length === 1) {
      const nxt = out.get(cur)[0].to;
      if (!canLink(cur, nxt) || chain.includes(nxt)) break;
      chain.push(nxt); cur = nxt;
    }
    if (chain.length > 1) { groups.push(chain); chain.forEach((c) => headOf.set(c, id)); }
  }
  if (!groups.length) return { code: null, merged: 0 };

  const nodes = new Map();
  for (const [id, n] of g.nodes) if (!headOf.has(id) || headOf.get(id) === id) nodes.set(id, { ...n });
  for (const chain of groups) {
    const first = plain(String(g.nodes.get(chain[0]).label).split(/<br\s*\/?>/i)[0]).replace(/^[•\s]+/, '');
    nodes.get(chain[0]).label = `${clipLabel(first, 45)} (+${chain.length - 1} ${chain.length === 2 ? 'etapa' : 'etapas'})`;
    nodes.get(chain[0]).label = nodes.get(chain[0]).label.replace(/"/g, "'").replace(/</g, '#lt;').replace(/>/g, '#gt;');
  }
  const tail = new Map(groups.map((c) => [c[0], c.at(-1)]));
  const rep = (id) => headOf.get(id) || id;
  const edges = [];
  for (const e of g.edges) {
    const from = rep(e.from), to = rep(e.to);
    if (from === to && headOf.has(e.from) && headOf.has(e.to)) continue; // aresta interna da cadeia
    // a saída de uma cadeia é a saída do último nó dela
    if (headOf.has(e.from) && tail.get(from) !== e.from) continue;
    edges.push({ ...e, from, to });
  }
  return { code: emit(g, nodes, edges), merged: groups.reduce((s, c) => s + c.length - 1, 0) };
}

function emit(g, nodes, edges) {
  const L = [`flowchart ${g.direction}`];
  const defined = new Set();
  const def = (id) => {
    if (defined.has(id)) return id;
    defined.add(id);
    const n = nodes.get(id);
    return `${id}${n.open}"${n.label}"${n.close}`;
  };
  const emitSg = (sg, ind) => {
    L.push(`${ind}subgraph ${sg.id}["${String(sg.label).replace(/"/g, "'")}"]`);
    L.push(`${ind}    direction ${g.direction === 'LR' || g.direction === 'RL' ? 'LR' : 'TB'}`);
    for (const child of g.subgraphs.filter((s) => s.parent === sg.id)) emitSg(child, ind + '    ');
    for (const id of sg.nodes) if (nodes.has(id)) L.push(ind + '    ' + def(id));
    L.push(`${ind}end`);
  };
  for (const sg of g.subgraphs.filter((s) => !s.parent)) emitSg(sg, '    ');
  for (const e of edges) L.push(`    ${def(e.from)} ${e.type}${e.label ? `|${e.label}|` : ''} ${def(e.to)}`);
  for (const id of nodes.keys()) if (!defined.has(id)) L.push('    ' + def(id));
  L.push('');
  g.classDefs.forEach((c) => L.push('    ' + c));
  const byClass = new Map();
  for (const [id, set] of g.classes) if (nodes.has(id)) for (const c of set) { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(id); }
  for (const [c, ids] of byClass) L.push(`    class ${ids.join(',')} ${c}`);
  g.extra.filter((x) => /^style\s+([\w-]+)/i.test(x) && nodes.has(/^style\s+([\w-]+)/i.exec(x)[1])).forEach((x) => L.push('    ' + x));
  return L.join('\n') + '\n';
}
