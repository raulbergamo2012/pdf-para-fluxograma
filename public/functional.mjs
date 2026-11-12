/**
 * Fluxograma Funcional — leitura e edição das RAIAS (responsáveis) direto no código Mermaid.
 * Usado pela aba Análise para o usuário definir os responsáveis quando o documento não os identifica
 * (renomear uma raia, mover atividades para outra raia ou criar uma raia nova). Funções puras (testáveis no Node).
 */
const SG = /^(\s*)subgraph\s+([A-Za-z_][\w-]*)\s*\["([^"]*)"\]\s*$/;
const NODE = /^\s*([A-Za-z_][\w-]*)\s*(\[\/|\[\\|\(\[|\[\(|\(\(|\[|\(|\{)\s*"?([^"\]\)\}]*)/;

/** Raias do código: [{ id, title, nodes: [{ id, label }] }] + transferências (setas entre raias) + etapas. */
export function laneInfo(code) {
  const lanes = [];
  let cur = null;
  for (const line of String(code).split('\n')) {
    const m = SG.exec(line);
    if (m) { cur = { id: m[2], title: m[3], nodes: [] }; lanes.push(cur); continue; }
    if (/^\s*end\s*$/.test(line)) { cur = null; continue; }
    if (cur && !/^\s*(direction|%%)/.test(line)) {
      const n = NODE.exec(line);
      if (n) cur.nodes.push({ id: n[1], label: n[3].replace(/<br\s*\/?>.*$/i, '').trim() });
    }
  }
  const laneOf = new Map(lanes.flatMap((l) => l.nodes.map((n) => [n.id, l.id])));
  const handoffs = [...String(code).matchAll(/^\s*([A-Za-z_][\w-]*)\s*(?:-->|-\.->|==>)(?:\|[^|]*\|)?\s*([A-Za-z_][\w-]*)/gm)]
    .filter((m) => laneOf.get(m[1]) && laneOf.get(m[2]) && laneOf.get(m[1]) !== laneOf.get(m[2])).map((m) => ({ from: m[1], to: m[2] }));
  const stages = [...String(code).matchAll(/^\s*%%\s*etapa:\s*(.+?)\s*::/gm)].map((m) => m[1]);
  return { lanes, handoffs, stages };
}

/**
 * Aplica as definições do usuário.
 * @param {string} code
 * @param {{ rename?: Record<string,string>, move?: Record<string,string> }} edits
 *   rename: id da raia → novo nome; move: id da atividade → id da raia de destino ou "novo:Nome da raia"
 */
export function applyLaneEdits(code, { rename = {}, move = {} } = {}) {
  const lines = String(code).split('\n');
  const lanes = []; const head = []; const tail = [];
  let cur = null, seenLane = false;
  for (const line of lines) {
    const m = SG.exec(line);
    if (m) { cur = { id: m[2], title: m[3], indent: m[1], lines: [] }; lanes.push(cur); seenLane = true; continue; }
    if (cur && /^\s*end\s*$/.test(line)) { cur = null; continue; }
    if (cur) cur.lines.push(line);
    else (seenLane ? tail : head).push(line);
  }
  if (!lanes.length) return code;
  // novas raias pedidas
  const byTitle = new Map(lanes.map((l) => [l.title.toLowerCase(), l]));
  let next = lanes.length + 1;
  for (const [nodeId, dest] of Object.entries(move)) {
    if (!/^novo:/i.test(dest)) continue;
    const title = dest.slice(5).trim().replace(/"/g, "'").slice(0, 60);
    if (!title) { delete move[nodeId]; continue; }
    let lane = byTitle.get(title.toLowerCase());
    if (!lane) {
      while (lanes.some((l) => l.id === 'R' + next)) next++;
      lane = { id: 'R' + next++, title, indent: lanes[0].indent, lines: [`${lanes[0].indent}    direction TB`] };
      lanes.push(lane); byTitle.set(title.toLowerCase(), lane);
    }
    move[nodeId] = lane.id;
  }
  // move as linhas de definição das atividades
  for (const [nodeId, destId] of Object.entries(move)) {
    const dest = lanes.find((l) => l.id === destId);
    if (!dest) continue;
    for (const l of lanes) {
      const k = l.lines.findIndex((x) => NODE.exec(x)?.[1] === nodeId && !/^\s*direction\b/.test(x));
      if (k >= 0 && l !== dest) { dest.lines.push(l.lines[k]); l.lines.splice(k, 1); }
    }
  }
  for (const [id, title] of Object.entries(rename)) {
    const l = lanes.find((x) => x.id === id);
    if (l && String(title).trim()) l.title = String(title).trim().replace(/"/g, "'").slice(0, 60);
  }
  const out = [...head];
  for (const l of lanes) {
    if (!l.lines.some((x) => NODE.exec(x) && !/^\s*direction\b/.test(x))) continue;   // raia vazia sai
    out.push(`${l.indent}subgraph ${l.id}["${l.title}"]`, ...l.lines, `${l.indent}end`);
  }
  out.push(...tail);
  return out.join('\n');
}
