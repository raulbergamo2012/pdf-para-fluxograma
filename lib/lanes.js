'use strict';
/**
 * Fluxograma Funcional (swimlane) vindo da IA: garante a distribuição real por raias.
 *  - Raias em ordem cronológica (a raia do Início é a 1ª; as outras na ordem em que o fluxo chega nelas).
 *  - Se a IA amontoou os passos (uma raia com quase tudo, raias de menos ou o Início fora da 1ª raia), cada bloco
 *    é realocado na raia certa: a etapa/responsável do documento a que o texto dele corresponde (comparando com o
 *    fluxograma montado pelas regras); sem correspondência, fica na raia do bloco anterior.
 * O texto e as ligações da IA são mantidos; só a raia de cada bloco muda.
 */
const ARROW = /\s*(-->|-\.->|==>|---|-\.-|--o|--x)(?:\|([^|]*)\|)?\s*/;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<br\s*\/?>/g, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('para com sem pelo pela como mais cada todo toda todos todas outro outra antes depois quando onde voce seu sua seus suas este esta esse essa isso usar fazer novo nova inicio fim'.split(' '));
const words = (s) => norm(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/s$/, ''));

function parse(code) {
  const nodes = new Map();      // id → { shape: '["…"]' | '{"…"}' | …, label, sg }
  const edges = [];             // { from, to, type, label }
  const sgs = [];               // { id, title }
  const extra = [];             // classDef / class / style / linkStyle
  const stack = [];
  const touch = (tok) => {
    const m = /^([A-Za-z_][\w-]*)(.*)$/.exec(tok.trim());
    if (!m) return null;
    const [, id, shape] = m;
    if (!nodes.has(id)) nodes.set(id, { shape: '', label: id, sg: stack[stack.length - 1] || null });
    const n = nodes.get(id);
    if (shape && !n.shape) { n.shape = shape; const q = /"([^"]*)"/.exec(shape); n.label = q ? q[1] : shape.replace(/^[[({>]+|[\])}]+$/g, ''); }
    return id;
  };
  for (const raw of String(code).split('\n')) {
    const t = raw.trim();
    if (!t || /^(%%|flowchart|graph|direction)\b/.test(t)) continue;
    let m;
    if ((m = /^subgraph\s+([A-Za-z_][\w-]*)?\s*(?:\["([^"]*)"\]|"([^"]*)"|(.*))?$/.exec(t))) {
      const id = m[1] || 'SG' + (sgs.length + 1);
      sgs.push({ id, title: (m[2] ?? m[3] ?? m[4] ?? id).trim() || id });
      stack.push(id);
      continue;
    }
    if (t === 'end') { stack.pop(); continue; }
    if (/^(classDef|class|style|linkStyle|click)\b/.test(t)) { extra.push(t); continue; }
    if (!ARROW.test(t)) { touch(t); continue; }
    const parts = t.split(new RegExp(ARROW.source, 'g'));
    const ids = [];
    for (let i = 0; i < parts.length; i += 3) ids.push(touch(parts[i]));
    if (ids.some((x) => !x)) return null;
    for (let i = 1, k = 0; i < parts.length; i += 3, k++) edges.push({ from: ids[k], to: ids[k + 1], type: parts[i], label: parts[i + 1] || '' });
  }
  return { nodes, edges, sgs, extra };
}

/** passos (sem Início/Fim/notas) por raia */
function laneStats(g) {
  const steps = [...g.nodes.entries()].filter(([id]) => !/^(INICIO|FIM)$/i.test(id));
  const per = new Map(g.sgs.map((s) => [s.id, 0]));
  for (const [, n] of steps) if (n.sg && per.has(n.sg)) per.set(n.sg, per.get(n.sg) + 1);
  return { steps: steps.length, per };
}

/** ordem cronológica: distância (em passos) a partir do Início */
function ranks(g) {
  const start = [...g.nodes.keys()].find((id) => /^INICIO$/i.test(id)) || [...g.nodes.keys()][0];
  const r = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const id = q.shift();
    for (const e of g.edges) if (e.from === id && !r.has(e.to)) { r.set(e.to, r.get(id) + 1); q.push(e.to); }
  }
  return r;
}

function serialize(g, laneOrder, laneOf, direction) {
  const out = [`flowchart ${direction}`];
  for (const sg of laneOrder) {
    const ids = [...g.nodes.keys()].filter((id) => laneOf.get(id) === sg.id);
    if (!ids.length) continue;
    out.push(`    subgraph ${sg.id}["${sg.title.replace(/"/g, "'")}"]`, '        direction TB');
    for (const id of ids) out.push(`        ${id}${g.nodes.get(id).shape || ''}`);
    out.push('    end');
  }
  out.push('');
  for (const e of g.edges) out.push(`    ${e.from} ${e.type}${e.label ? `|${e.label}|` : ''} ${e.to}`);
  if (g.extra.length) out.push('', ...g.extra.map((l) => '    ' + l));
  return out.join('\n');
}

/**
 * @param code      código Mermaid da IA (tipo raias)
 * @param reference código das regras para o mesmo documento (lib/heuristic, tipo raias) — dá as raias reais
 * @returns { code, fixed: boolean, reason }
 */
function fixLanes(code, reference, direction = 'TD') {
  const g = parse(code);
  if (!g || !g.nodes.size) return { code, fixed: false };
  const ref = reference ? parse(reference) : null;
  const refLanes = ref ? ref.sgs.filter((s) => [...ref.nodes.values()].some((n) => n.sg === s.id)) : [];
  const { steps, per } = laneStats(g);
  const maxShare = steps ? Math.max(0, ...per.values()) / steps : 0;
  const start = [...g.nodes.keys()].find((id) => /^INICIO$/i.test(id));
  const r = ranks(g);
  const firstReached = (sgId) => Math.min(...[...g.nodes.entries()].filter(([, n]) => n.sg === sgId).map(([id]) => r.get(id) ?? 1e6));
  const used = g.sgs.filter((s) => per.get(s.id) > 0 || [...g.nodes.values()].some((n) => n.sg === s.id));

  let reason = '';
  // raias da IA que não correspondem a NENHUM responsável do documento (ex.: títulos de etapas, "Preparo da massa"):
  // as raias do Funcional são os responsáveis — cada bloco vai para a raia do responsável real
  const titleWords = (t) => new Set(words(t));
  const matchesRef = (t) => refLanes.some((l) => norm(l.title) === norm(t) || [...titleWords(t)].some((w) => titleWords(l.title).has(w)));
  if (refLanes.length >= 1 && used.length && !used.some((s) => matchesRef(s.title))) reason = 'as raias da IA eram etapas, não responsáveis';
  else if (refLanes.length >= 2) {
    if (used.length < 2) reason = 'a IA não separou as raias';
    else if (used.length < refLanes.length && maxShare > 0.55) reason = 'a IA juntou várias etapas numa raia só';
    else if (refLanes.length >= 3 && maxShare > 0.6) reason = 'quase todos os passos ficaram na mesma raia';
    else {
      // distribuição bem mais concentrada que a do documento (ex.: 1ª raia com a maioria dos passos iniciais)
      const refPer = refLanes.map((l) => [...ref.nodes.entries()].filter(([id, n]) => n.sg === l.id && !/^(INICIO|FIM)$/i.test(id)).length);
      const refTotal = refPer.reduce((a, b) => a + b, 0) || 1;
      const refMax = Math.max(...refPer) / refTotal;
      if (maxShare > refMax + 0.2 && maxShare > 0.45) reason = 'passos acumulados numa raia, diferente das etapas do documento';
    }
  }

  if (!reason) {
    // raias da IA estão boas: só garante a ordem cronológica (Início na 1ª raia)
    const order = [...used].sort((a, b) => firstReached(a.id) - firstReached(b.id));
    const laneOf = new Map([...g.nodes.entries()].map(([id, n]) => [id, n.sg]));
    const orphan = [...g.nodes.keys()].filter((id) => !laneOf.get(id));
    if (!order.length) return { code, fixed: false };
    for (const id of orphan) laneOf.set(id, order[0].id);
    const same = order.every((s, i) => s === used[i]) && !orphan.length;
    if (same && (!start || g.nodes.get(start).sg === order[0].id)) return { code, fixed: false };
    if (start) laneOf.set(start, order[0].id);
    return { code: serialize(g, order, laneOf, direction), fixed: true, reason: 'raias reordenadas: o fluxo começa na 1ª raia' };
  }

  // realoca cada bloco na raia real (pela correspondência de texto com o fluxograma das regras)
  const refNodes = [...ref.nodes.entries()].filter(([id, n]) => n.sg && !/^(INICIO|FIM)$/i.test(id)).map(([, n]) => ({ w: new Set(words(n.label)), sg: n.sg }));
  const laneOf = new Map();
  const order = [...g.nodes.keys()].sort((a, b) => (r.get(a) ?? 1e6) - (r.get(b) ?? 1e6));
  for (const id of order) {
    const n = g.nodes.get(id);
    if (/^INICIO$/i.test(id)) { laneOf.set(id, refLanes[0].id); continue; }
    const w = words(n.label);
    let best = null, score = 0;
    for (const rn of refNodes) { const s = w.filter((x) => rn.w.has(x)).length; if (s > score) { score = s; best = rn.sg; } }
    if (best && score >= 1 && !/^FIM$/i.test(id)) { laneOf.set(id, best); continue; }
    const pred = g.edges.find((e) => e.to === id && laneOf.has(e.from));
    laneOf.set(id, pred ? laneOf.get(pred.from) : refLanes[0].id);
  }
  return { code: serialize(g, refLanes, laneOf, direction), fixed: true, reason };
}

module.exports = { fixLanes, parseLanes: parse };
