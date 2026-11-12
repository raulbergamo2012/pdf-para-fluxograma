/* Editor visual (estilo draw.io) — núcleo sem interface
 *
 *  - SHAPES: catálogo de formas da barra lateral (desenho, portas de conexão e área de texto)
 *  - routeEdge: rota das setas (ortogonal ou reta) entre portas dos blocos
 *  - renderSVG: desenha o diagrama como SVG autônomo (só <text>, sem foreignObject),
 *    usado na tela, no editor e nas exportações PNG/SVG/HTML
 *  - visualToMermaid: gera o código Mermaid equivalente (estrutura) para o histórico e a análise
 *
 * Modelo:
 *   { nodes: [{ id, shape, x, y, w, h, text, fill, stroke, color, fontSize, bold, align, strokeWidth, dashed }],
 *     edges: [{ id, from, fromPort, to, toPort, p1, p2, label, kind: 'orth'|'straight', dashed, dotted,
 *               arrowStart, arrowEnd, stroke, width }] }
 */

export const FONT = '"Segoe UI", system-ui, Arial, sans-serif';
const r2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ formas
const poly = (pts) => `<polygon points="${pts.map(([a, b]) => `${r2(a)},${r2(b)}`).join(' ')}"/>`;
const path = (d) => `<path d="${d}"/>`;

export const SHAPES = {
  rect: { name: 'Retângulo', w: 120, h: 60, draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`, mermaid: ['[', ']'] },
  rounded: { name: 'Retângulo arredondado', w: 120, h: 60, draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(12, h / 4)}"/>`, mermaid: ['(', ')'] },
  text: { name: 'Texto', w: 100, h: 30, noShape: true, draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" stroke="none"/>` },
  heading: { name: 'Título e parágrafo', w: 190, h: 100, noShape: true, align: 'left', valign: 'top',
    draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" stroke="none"/>` },
  ellipse: { name: 'Elipse', w: 120, h: 70, draw: (x, y, w, h) => `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`, mermaid: ['((', '))'],
    box: (x, y, w, h) => ({ x: x + w * 0.15, y, w: w * 0.7, h }) },
  square: { name: 'Quadrado', w: 80, h: 80, draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`, mermaid: ['[', ']'] },
  circle: { name: 'Círculo', w: 80, h: 80, draw: (x, y, w, h) => `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`, mermaid: ['((', '))'],
    box: (x, y, w, h) => ({ x: x + w * 0.15, y, w: w * 0.7, h }) },
  process: { name: 'Processo predefinido', w: 120, h: 60, mermaid: ['[[', ']]'],
    draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>${path(`M${x + w * 0.1} ${y}V${y + h}M${x + w * 0.9} ${y}V${y + h}`)}`,
    box: (x, y, w, h) => ({ x: x + w * 0.1, y, w: w * 0.8, h }) },
  diamond: { name: 'Decisão (losango)', w: 120, h: 90, mermaid: ['{', '}'],
    draw: (x, y, w, h) => poly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]),
    box: (x, y, w, h) => ({ x: x + w * 0.18, y: y + h * 0.18, w: w * 0.64, h: h * 0.64 }) },
  parallelogram: { name: 'Dados (entrada/saída)', w: 120, h: 60, mermaid: ['[/', '/]'],
    draw: (x, y, w, h) => { const o = Math.min(w * 0.2, 20); return poly([[x + o, y], [x + w, y], [x + w - o, y + h], [x, y + h]]); },
    ports: (x, y, w, h) => { const o = Math.min(w * 0.2, 20); return { top: [x + w / 2, y], right: [x + w - o / 2, y + h / 2], bottom: [x + w / 2, y + h], left: [x + o / 2, y + h / 2] }; },
    // texto dentro da parte reta (não encosta nas pontas inclinadas)
    box: (x, y, w, h) => { const o = Math.min(w * 0.2, 20); return { x: x + o * 0.75, y, w: w - o * 1.5, h }; } },
  hexagon: { name: 'Preparação (hexágono)', w: 120, h: 64, mermaid: ['{{', '}}'],
    draw: (x, y, w, h) => { const o = Math.min(w * 0.22, 20); return poly([[x + o, y], [x + w - o, y], [x + w, y + h / 2], [x + w - o, y + h], [x + o, y + h], [x, y + h / 2]]); } },
  triangle: { name: 'Triângulo', w: 70, h: 80,
    draw: (x, y, w, h) => poly([[x, y], [x + w, y + h / 2], [x, y + h]]),
    box: (x, y, w, h) => ({ x, y: y + h * 0.25, w: w * 0.65, h: h * 0.5 }),
    ports: (x, y, w, h) => ({ top: [x + w * 0.4, y + h * 0.2], right: [x + w, y + h / 2], bottom: [x + w * 0.4, y + h * 0.8], left: [x, y + h / 2] }) },
  cylinder: { name: 'Banco de dados', w: 70, h: 90, mermaid: ['[(', ')]'],
    draw: (x, y, w, h) => { const ry = Math.min(12, h * 0.15); return `${path(`M${x} ${y + ry}V${y + h - ry}A${w / 2} ${ry} 0 0 0 ${x + w} ${y + h - ry}V${y + ry}`)}<ellipse cx="${x + w / 2}" cy="${y + ry}" rx="${w / 2}" ry="${ry}"/>`; },
    box: (x, y, w, h) => ({ x, y: y + 24, w, h: h - 30 }) },
  cloud: { name: 'Nuvem', w: 120, h: 80,
    draw: (x, y, w, h) => path(`M${x + w * 0.25} ${y + h * 0.85}C${x} ${y + h * 0.85} ${x} ${y + h * 0.45} ${x + w * 0.2} ${y + h * 0.42}C${x + w * 0.15} ${y + h * 0.08} ${x + w * 0.5} ${y} ${x + w * 0.56} ${y + h * 0.24}C${x + w * 0.7} ${y + h * 0.04} ${x + w * 0.97} ${y + h * 0.18} ${x + w * 0.86} ${y + h * 0.45}C${x + w} ${y + h * 0.55} ${x + w} ${y + h * 0.86} ${x + w * 0.75} ${y + h * 0.85}Z`),
    box: (x, y, w, h) => ({ x: x + w * 0.15, y: y + h * 0.25, w: w * 0.7, h: h * 0.55 }) },
  document: { name: 'Documento', w: 120, h: 80,
    draw: (x, y, w, h) => { const v = h * 0.12; return path(`M${x} ${y}H${x + w}V${y + h - v}C${x + w * 0.75} ${y + h - 2.6 * v} ${x + w * 0.5} ${y + h - 2.6 * v} ${x + w * 0.5} ${y + h - v}S${x + w * 0.25} ${y + h + 0.6 * v} ${x} ${y + h - v}Z`); },
    box: (x, y, w, h) => ({ x, y, w, h: h * 0.82 }) },
  internal: { name: 'Armazenamento interno', w: 90, h: 80,
    draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>${path(`M${x} ${y + h * 0.2}H${x + w}M${x + w * 0.2} ${y}V${y + h}`)}`,
    box: (x, y, w, h) => ({ x: x + w * 0.2, y: y + h * 0.2, w: w * 0.8, h: h * 0.8 }) },
  cube: { name: 'Cubo', w: 120, h: 80,
    draw: (x, y, w, h) => { const d = Math.min(14, w * 0.15); return `<rect x="${x}" y="${y + d}" width="${w - d}" height="${h - d}"/>${poly([[x, y + d], [x + d, y], [x + w, y], [x + w - d, y + d]])}${poly([[x + w - d, y + d], [x + w, y], [x + w, y + h - d], [x + w - d, y + h]])}`; },
    box: (x, y, w, h) => ({ x, y: y + 14, w: w - 14, h: h - 14 }) },
  step: { name: 'Etapa (seta)', w: 110, h: 60,
    draw: (x, y, w, h) => { const o = Math.min(w * 0.2, 18); return poly([[x, y], [x + w - o, y], [x + w, y + h / 2], [x + w - o, y + h], [x, y + h], [x + o, y + h / 2]]); } },
  trapezoid: { name: 'Operação manual', w: 120, h: 60,
    draw: (x, y, w, h) => { const o = w * 0.18; return poly([[x + o, y], [x + w - o, y], [x + w, y + h], [x, y + h]]); } },
  tape: { name: 'Fita', w: 120, h: 80,
    draw: (x, y, w, h) => { const v = h * 0.1; return path(`M${x} ${y + v}Q${x + w / 4} ${y - v} ${x + w / 2} ${y + v}T${x + w} ${y + v}V${y + h - v}Q${x + w * 0.75} ${y + h + v} ${x + w / 2} ${y + h - v}T${x} ${y + h - v}Z`); } },
  note: { name: 'Nota', w: 80, h: 100,
    draw: (x, y, w, h) => { const f = Math.min(16, w * 0.25); return `${poly([[x, y], [x + w - f, y], [x + w, y + f], [x + w, y + h], [x, y + h]])}${path(`M${x + w - f} ${y}V${y + f}H${x + w}`)}`; } },
  card: { name: 'Cartão', w: 80, h: 100,
    draw: (x, y, w, h) => { const c = Math.min(18, w * 0.25); return poly([[x + c, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + c]]); } },
  callout: { name: 'Balão de fala', w: 120, h: 80,
    draw: (x, y, w, h) => { const b = h * 0.72; return path(`M${x} ${y}H${x + w}V${y + b}H${x + w * 0.45}L${x + w * 0.22} ${y + h}L${x + w * 0.28} ${y + b}H${x}Z`); },
    box: (x, y, w, h) => ({ x, y, w, h: h * 0.72 }) },
  actor: { name: 'Pessoa (ator)', w: 40, h: 70, valign: 'below',
    draw: (x, y, w, h) => { const r = Math.min(w, h) * 0.18; const cx = x + w / 2; return `<circle cx="${cx}" cy="${y + r}" r="${r}"/>${path(`M${cx} ${y + 2 * r}V${y + h * 0.66}M${x} ${y + h * 0.4}H${x + w}M${cx} ${y + h * 0.66}L${x + w * 0.1} ${y + h}M${cx} ${y + h * 0.66}L${x + w * 0.9} ${y + h}`)}`; } },
  delay: { name: 'Atraso', w: 100, h: 70,
    draw: (x, y, w, h) => { const r = Math.min(h / 2, w / 2); return path(`M${x} ${y}H${x + w - r}A${r} ${h / 2} 0 0 1 ${x + w - r} ${y + h}H${x}Z`); } },
  stored: { name: 'Dados armazenados', w: 110, h: 70,
    draw: (x, y, w, h) => { const c = w * 0.14; return path(`M${x + c} ${y}H${x + w}A${c} ${h / 2} 0 0 0 ${x + w} ${y + h}H${x + c}A${c} ${h / 2} 0 0 1 ${x + c} ${y}Z`); },
    box: (x, y, w, h) => ({ x: x + w * 0.14, y, w: w * 0.72, h }) },
  terminator: { name: 'Início / Fim', w: 120, h: 50, mermaid: ['([', '])'],
    draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>` },
  // contêiner/seção; com n.band vira uma RAIA (swimlane) com faixa de cabeçalho sombreada
  container: { name: 'Contêiner com título', w: 320, h: 220, valign: 'top', bold: true,
    draw: (x, y, w, h, n) => n?.sideHead
      // faixa de ETAPA do Funcional: atravessa as raias; nome da etapa na coluna da esquerda
      ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><rect x="${x}" y="${y}" width="${n.sideHead}" height="${h}" fill="${n.headFill || '#eef1f4'}"/>`
      : n?.band
      ? `<rect x="${x}" y="${y}" width="${w}" height="${h}"/><rect x="${x}" y="${y}" width="${w}" height="${n.head || 40}" fill="#0b2e3c" fill-opacity=".07" stroke="none"/>${path(`M${x} ${y + (n.head || 40)}H${x + w}`)}`
        + (n.accent ? `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, w - 2)}" height="4" fill="${n.accent}" fill-opacity=".85" stroke="none"/>` : '')
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>${path(`M${x} ${y + 30}H${x + w}`)}`,
    box: (x, y, w, h, n) => (n?.sideHead ? { x: x + 8, y: y + 6, w: n.sideHead - 16, h: Math.min(h - 12, 160), valign: 'top' }
      : n?.band ? { x: x + 8, y: y + 2, w: w - 16, h: (n.head || 40) - 2 } : { x, y: y + 2, w, h: 28 }) },
  lane: { name: 'Raia (swimlane)', w: 220, h: 360, valign: 'top', bold: true, asContainer: true,
    draw: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/><rect x="${x}" y="${y}" width="${w}" height="40" fill="#0b2e3c" fill-opacity=".07" stroke="none"/>${path(`M${x} ${y + 40}H${x + w}`)}`,
    box: (x, y, w) => ({ x: x + 6, y: y + 2, w: w - 12, h: 38 }) },
};

export const PALETTE = [
  ['rect', 'rounded', 'text', 'heading', 'ellipse'],
  ['square', 'circle', 'process', 'diamond', 'parallelogram'],
  ['hexagon', 'triangle', 'cylinder', 'cloud', 'document'],
  ['internal', 'cube', 'step', 'trapezoid', 'tape'],
  ['note', 'card', 'callout', 'actor', 'terminator'],
  ['delay', 'stored', 'container', 'lane'],
];

export const LINES = {
  arrow: { name: 'Seta', edge: { kind: 'straight', arrowEnd: true } },
  line: { name: 'Linha', edge: { kind: 'straight', arrowEnd: false } },
  dashed: { name: 'Seta tracejada', edge: { kind: 'straight', arrowEnd: true, dashed: true } },
  dotted: { name: 'Linha pontilhada', edge: { kind: 'straight', arrowEnd: false, dotted: true } },
  both: { name: 'Seta dupla', edge: { kind: 'straight', arrowEnd: true, arrowStart: true } },
  thick: { name: 'Seta grossa', edge: { kind: 'straight', arrowEnd: true, width: 4 } },
  elbow: { name: 'Conector em ângulo', edge: { kind: 'orth', arrowEnd: true } },
  curve: { name: 'Seta curva', edge: { kind: 'curve', arrowEnd: true } },
};

const DIRS = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

export function portsOf(n) {
  const s = SHAPES[n.shape] || SHAPES.rect;
  if (s.ports) return s.ports(n.x, n.y, n.w, n.h);
  return { top: [n.x + n.w / 2, n.y], right: [n.x + n.w, n.y + n.h / 2], bottom: [n.x + n.w / 2, n.y + n.h], left: [n.x, n.y + n.h / 2] };
}

/** Porta mais próxima de um ponto (para conectar onde o usuário soltou a seta) */
export function nearestPort(n, px, py) {
  let best = 'top', bd = Infinity;
  for (const [k, [x, y]] of Object.entries(portsOf(n))) {
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Porta automática: lado do bloco virado para o outro ponto */
function autoPort(n, tx, ty) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const dx = (tx - cx) / Math.max(1, n.w), dy = (ty - cy) / Math.max(1, n.h);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
}

// ------------------------------------------------------------------ rotas
export function edgeEnds(model, e) {
  const byId = (id) => model.nodes.find((n) => n.id === id);
  const A = e.from ? byId(e.from) : null, B = e.to ? byId(e.to) : null;
  const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];
  const pa = A ? null : e.p1 || [0, 0];
  const pb = B ? null : e.p2 || [0, 0];
  const aRef = A ? center(A) : pa, bRef = B ? center(B) : pb;
  const fp = A ? (e.fromPort && portsOf(A)[e.fromPort] ? e.fromPort : autoPort(A, ...bRef)) : null;
  const tp = B ? (e.toPort && portsOf(B)[e.toPort] ? e.toPort : autoPort(B, ...aRef)) : null;
  return {
    p1: A ? portsOf(A)[fp] : pa, d1: fp ? DIRS[fp] : null,
    p2: B ? portsOf(B)[tp] : pb, d2: tp ? DIRS[tp] : null,
    fromNode: A, toNode: B,
  };
}

/** Pontos de dobra definidos pelo usuário (formato antigo `via` continua valendo) */
export function waypoints(e) { return e.points?.length ? e.points : e.via ? [e.via] : []; }

/** Rota em ângulo reto que passa pelos pontos do usuário */
function manualOrth(p1, d1, p2, d2, wps) {
  const out = [p1];
  let cur = p1;
  let goH = d1 ? d1[0] !== 0 : Math.abs((wps[0] || p2)[0] - p1[0]) >= Math.abs((wps[0] || p2)[1] - p1[1]);
  const targets = [...wps, p2];
  targets.forEach((t, i) => {
    const last = i === targets.length - 1;
    if (Math.abs(t[0] - cur[0]) < 0.5 || Math.abs(t[1] - cur[1]) < 0.5) {
      goH = Math.abs(t[1] - cur[1]) < 0.5 ? false : true;
    } else {
      if (last && d2) goH = d2[0] === 0; // chega no bloco pelo lado certo
      out.push(goH ? [t[0], cur[1]] : [cur[0], t[1]]);
    }
    out.push(t);
    cur = t;
  });
  return out;
}

export function routeEdge(model, e) {
  const { p1, d1, p2, d2 } = edgeEnds(model, e);
  const wps = waypoints(e);
  if (wps.length) return simplify(e.kind === 'orth' ? manualOrth(p1, d1, p2, d2, wps) : [p1, ...wps, p2], e.kind === 'orth');
  if (e.kind === 'straight' || e.kind === 'curve' || (!d1 && !d2)) return [p1, p2];
  const S = 18;
  const dd1 = d1 || (Math.abs(p2[0] - p1[0]) > Math.abs(p2[1] - p1[1]) ? [Math.sign(p2[0] - p1[0]) || 1, 0] : [0, Math.sign(p2[1] - p1[1]) || 1]);
  const dd2 = d2 || [-dd1[0], -dd1[1]];
  const a = [p1[0] + dd1[0] * S, p1[1] + dd1[1] * S];
  const b = [p2[0] + dd2[0] * S, p2[1] + dd2[1] * S];
  const h1 = dd1[0] !== 0, h2 = dd2[0] !== 0;
  let mid;
  if (h1 && !h2) mid = [[b[0], a[1]]];
  else if (!h1 && h2) mid = [[a[0], b[1]]];
  else if (h1 && h2) {
    const x = dd1[0] === dd2[0] ? (dd1[0] > 0 ? Math.max(a[0], b[0]) : Math.min(a[0], b[0])) : (a[0] + b[0]) / 2;
    mid = [[x, a[1]], [x, b[1]]];
  } else {
    const y = dd1[1] === dd2[1] ? (dd1[1] > 0 ? Math.max(a[1], b[1]) : Math.min(a[1], b[1])) : (a[1] + b[1]) / 2;
    mid = [[a[0], y], [b[0], y]];
  }
  let best = [a, ...mid, b];
  // desvia de blocos que estejam no caminho (escolhe a rota com menos cruzamentos, depois a mais curta)
  const obst = model.nodes.filter((n) => n.shape !== 'container' && !SHAPES[n.shape]?.noShape);
  if (d1 && d2 && obst.length && crossings(best, obst)) {
    const score = (r) => crossings(r, obst) * 100000 + pathLen(r) + r.length * 25;
    let bs = score(best);
    const tryR = (r) => { const sc = score(r); if (sc < bs) { bs = sc; best = r; } };
    const xs = new Set([a[0], b[0]]), ys = new Set([a[1], b[1]]);
    for (const n of obst) { xs.add(n.x - 24); xs.add(n.x + n.w + 24); ys.add(n.y - 24); ys.add(n.y + n.h + 24); }
    for (const x of xs) tryR([a, [x, a[1]], [x, b[1]], b]);
    for (const y of ys) tryR([a, [a[0], y], [b[0], y], b]);
    if (bs >= 100000) {
      for (const x of xs) for (const y of ys) {
        tryR([a, [a[0], y], [x, y], [x, b[1]], b]);
        tryR([a, [x, a[1]], [x, y], [b[0], y], b]);
      }
    }
  }
  return simplify([p1, ...best, p2], true);
}

/** Tira pontos repetidos e (nas rotas em ângulo) os alinhados */
function simplify(list, dropCollinear) {
  const pts = list.map(([x, y]) => [r2(x), r2(y)]);
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = out[out.length - 1];
    if (Math.abs(pts[i][0] - px) < 0.5 && Math.abs(pts[i][1] - py) < 0.5) continue;
    out.push(pts[i]);
  }
  if (dropCollinear) for (let i = out.length - 2; i >= 1; i--) {
    const [ax, ay] = out[i - 1], [bx, by] = out[i], [cx, cy] = out[i + 1];
    if ((Math.abs(ax - bx) < 0.5 && Math.abs(bx - cx) < 0.5) || (Math.abs(ay - by) < 0.5 && Math.abs(by - cy) < 0.5)) out.splice(i, 1);
  }
  if (out.length === 1) out.push([...out[0]]);
  return out;
}

function pathLen(r) { let L = 0; for (let i = 1; i < r.length; i++) L += Math.abs(r[i][0] - r[i - 1][0]) + Math.abs(r[i][1] - r[i - 1][1]); return L; }
/** Quantos blocos os trechos (horizontais/verticais) atravessam */
function crossings(r, obst) {
  let c = 0;
  for (let i = 1; i < r.length; i++) {
    const [x1, y1] = r[i - 1], [x2, y2] = r[i];
    const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    for (const n of obst) if (hx > n.x + 1 && lx < n.x + n.w - 1 && hy > n.y + 1 && ly < n.y + n.h - 1) c++;
  }
  return c;
}

function pathD(pts, kind) {
  if (kind === 'curve' && pts.length > 2) {
    // curva suave passando por todos os pontos (Catmull-Rom → Bézier)
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }
  if (kind === 'curve' && pts.length === 2) {
    const [[x1, y1], [x2, y2]] = pts;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const nx = -(y2 - y1) * 0.25, ny = (x2 - x1) * 0.25;
    return `M${x1} ${y1}Q${r2(mx + nx)} ${r2(my + ny)} ${x2} ${y2}`;
  }
  return 'M' + pts.map(([x, y]) => `${x} ${y}`).join('L');
}

/** Ponto do rótulo: perto da saída nos losangos, no meio do trecho mais longo nos demais */
export function labelPoint(model, e, pts) {
  const A = model.nodes.find((n) => n.id === e.from);
  if (e.labelAt === 'end' && pts.length >= 2) {
    // decisão com várias saídas que dividem o mesmo trecho: rótulo no trecho final, junto do destino
    const [x1, y1] = pts[pts.length - 2], [x2, y2] = pts[pts.length - 1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const horizontal = Math.abs(y2 - y1) < 0.5;
    const back = Math.min(len / 2, horizontal ? measure(e.label || '', 13, true) / 2 + 16 : 26);
    return [x2 - ((x2 - x1) / len) * back, y2 - ((y2 - y1) / len) * back];
  }
  if (A?.shape === 'diamond' && pts.length >= 2) {
    const [x1, y1] = pts[0], [x2, y2] = pts[1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    // rótulo logo depois da ponta do losango; em saída lateral, afastado o bastante para não cobrir o losango
    const horizontal = Math.abs(y2 - y1) < 0.5;
    const half = horizontal ? measure(e.label || '', 13, true) / 2 + 9 : 14;
    const t = Math.min(Math.max(26, half), Math.max(len / 2, half)) / len;
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  }
  let best = 0, at = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len > best) { best = len; at = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]; }
  }
  return at;
}

// ------------------------------------------------------------------ texto
let ctx2d = null;
export function measure(text, size = 14, bold = false) {
  try {
    ctx2d ||= document.createElement('canvas').getContext('2d');
    ctx2d.font = `${bold ? 700 : 400} ${size}px "Segoe UI", system-ui, Arial, sans-serif`;
    return ctx2d.measureText(text).width;
  } catch { return text.length * size * 0.55; }
}

export function wrapText(text, maxW, size = 14, bold = false) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (line && measure(t, size, bold) > maxW) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

const escX = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textBox(n) {
  const s = SHAPES[n.shape] || SHAPES.rect;
  if (s.valign === 'below') return { x: n.x - 40, y: n.y + n.h + 4, w: n.w + 80, h: 40, valign: 'top' };
  const b = s.box ? s.box(n.x, n.y, n.w, n.h, n) : { x: n.x, y: n.y, w: n.w, h: n.h };
  return { valign: s.valign || 'middle', ...b };
}

function renderText(n) {
  const s = SHAPES[n.shape] || SHAPES.rect;
  if (!String(n.text || '').trim()) return '';
  const size = n.fontSize || 14;
  const b = textBox(n);
  const pad = 8;
  const align = n.align || s.align || 'center';
  const heading = n.shape === 'heading';
  const lines = [];
  String(n.text).split('\n').forEach((para, i) => {
    const big = heading && i === 0;
    // observação/dica dentro do bloco: linha "(…)" depois da ação → letra menor, itálico e cinza
    const tip = i > 0 && !heading && /^\s*\(.*\)\s*$/.test(para);
    const sz = big ? size + 4 : tip ? Math.max(10, size - 2.5) : size;
    const bold = !tip && (big || n.bold || s.bold);
    const body = tip ? para.trim().slice(1, -1) : para;
    wrapText(body, Math.max(20, b.w - pad * 2), sz, bold).forEach((t) => lines.push({ t, sz, bold, tip }));
  });
  const lh = (l) => l.sz * 1.3;
  const total = lines.reduce((a, l) => a + lh(l), 0);
  let y = b.valign === 'top' ? b.y + pad : b.y + (b.h - total) / 2;
  const x = align === 'left' ? b.x + pad : b.x + b.w / 2;
  const anchor = align === 'left' ? 'start' : 'middle';
  const color = n.color || '#1a1a1a';
  return `<text x="${r2(x)}" text-anchor="${anchor}" fill="${color}" font-family='${FONT}'>` + lines.map((l) => {
    y += lh(l);
    return `<tspan x="${r2(x)}" y="${r2(y - l.sz * 0.33)}" font-size="${l.sz}"${l.bold ? ' font-weight="700"' : ''}${l.tip ? ' font-style="italic" fill-opacity="0.68"' : ''}>${escX(l.t)}</tspan>`;
  }).join('') + '</text>';
}

// ------------------------------------------------------------------ desenho
export function bounds(model, pad = 30) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const n of model.nodes) {
    add(n.x, n.y); add(n.x + n.w, n.y + n.h);
    if (SHAPES[n.shape]?.valign === 'below') add(n.x + n.w / 2, n.y + n.h + 40);
  }
  for (const e of model.edges) routeEdge(model, e).forEach(([x, y]) => add(x, y));
  if (!isFinite(x0)) return { x: 0, y: 0, w: 400, h: 300 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/**
 * Desenha o diagrama. opts.viewBox força a área (editor); opts.extra é desenhado por cima (seleção).
 * opts.mark: { nodes:Set, edges:Set } destaca a seleção.
 */
export function renderSVG(model, opts = {}) {
  const vb = opts.viewBox || bounds(model);
  const colors = new Set(model.edges.map((e) => e.stroke || '#333333'));
  const mk = (c) => 'm' + c.replace(/[^0-9a-z]/gi, '');
  const defs = [...colors].map((c) => `
    <marker id="${mk(c)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      <path d="M0 0L10 5L0 10z" fill="${c}" stroke="none"/></marker>`).join('');
  const node = (n) => {
    const s = SHAPES[n.shape] || SHAPES.rect;
    const fill = s.noShape ? 'transparent' : (n.fill || '#ffffff');
    const stroke = s.noShape ? 'none' : (n.stroke || '#333333');
    const sel = opts.mark?.nodes?.has(n.id) ? ' data-sel="1"' : '';
    const dash = n.dashed ? ' stroke-dasharray="6 4"' : '';
    return `<g class="vn" data-id="${escX(n.id)}"${sel}><g fill="${fill}" stroke="${stroke}" stroke-width="${n.strokeWidth || 1.5}"${dash} stroke-linejoin="round">${s.draw(r2(n.x), r2(n.y), r2(n.w), r2(n.h), n)}</g>${renderText(n)}</g>`;
  };
  const edge = (e) => {
    const pts = routeEdge(model, e);
    const c = e.stroke || '#333333';
    const w = e.width || 1.5;
    const dash = e.dashed ? ` stroke-dasharray="${w * 4} ${w * 3}"` : e.dotted ? ` stroke-dasharray="${w} ${w * 2.5}" stroke-linecap="round"` : '';
    const markers = `${e.arrowEnd !== false ? ` marker-end="url(#${mk(c)})"` : ''}${e.arrowStart ? ` marker-start="url(#${mk(c)})"` : ''}`;
    const d = pathD(pts, e.kind);
    let lab = '';
    if (String(e.label || '').trim()) {
      const [lx, ly] = labelPoint(model, e, pts);
      const size = 13;
      const tw = measure(e.label, size, true) + 10;
      lab = `<rect x="${r2(lx - tw / 2)}" y="${r2(ly - 10)}" width="${r2(tw)}" height="20" rx="3" fill="#ffffff" stroke="${opts.labelBorder || 'none'}"/>`
        + `<text x="${r2(lx)}" y="${r2(ly + 4.5)}" text-anchor="middle" font-family='${FONT}' font-size="${size}" font-weight="700" fill="${e.labelColor || '#1a1a1a'}">${escX(e.label)}</text>`;
    }
    const sel = opts.mark?.edges?.has(e.id) ? ' data-sel="1"' : '';
    return `<g class="ve" data-eid="${escX(e.id)}"${sel}><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}"${dash}${markers} stroke-linejoin="round"/>`
      + (opts.interactive ? `<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="14"/>` : '') + lab + '</g>';
  };
  const containers = model.nodes.filter((n) => n.shape === 'container');
  const others = model.nodes.filter((n) => n.shape !== 'container');
  const w = opts.width ?? vb.w, h = opts.height ?? vb.h;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(vb.x)} ${r2(vb.y)} ${r2(vb.w)} ${r2(vb.h)}" width="${r2(w)}" height="${r2(h)}" data-visual="1">`
    + `<defs>${defs}</defs><g stroke="none">`
    + (opts.background ? `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${opts.background}"/>` : '')
    + containers.map(node).join('') + model.edges.map(edge).join('') + others.map(node).join('')
    + (opts.extra || '') + '</g></svg>';
}

// ------------------------------------------------------------------ visual → Mermaid (estrutura)
export function visualToMermaid(model, direction = 'TD') {
  const enc = (s) => String(s ?? '').replace(/"/g, "'").replace(/#/g, '#35;').replace(/</g, '#lt;').replace(/>/g, '#gt;')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('<br/>') || ' ';
  const flow = model.nodes.filter((n) => SHAPES[n.shape]?.mermaid || ['note', 'card', 'document', 'cloud', 'callout', 'tape', 'internal', 'cube', 'step', 'trapezoid', 'triangle', 'delay', 'stored', 'square'].includes(n.shape));
  const conts = model.nodes.filter((n) => n.shape === 'container');
  const inside = (c, n) => n.x + n.w / 2 > c.x && n.x + n.w / 2 < c.x + c.w && n.y + n.h / 2 > c.y && n.y + n.h / 2 < c.y + c.h;
  const area = (c) => c.w * c.h;
  const parentOf = (n, pool) => pool.filter((c) => c !== n && inside(c, n)).sort((a, b) => area(a) - area(b))[0] || null;
  const safe = (id) => (/^(end|graph|subgraph|style|class|click)$/i.test(id) ? id + '_n' : id);
  const dir = direction === 'LR' ? 'LR' : 'TB';
  const L = [`flowchart ${direction}`];
  const def = (n) => { const [o, c] = SHAPES[n.shape]?.mermaid || ['[', ']']; return `${safe(n.id)}${o}"${enc(n.text)}"${c}`; };
  const emit = (c, ind) => {
    L.push(`${ind}subgraph ${safe(c.id)}["${enc(c.text).replace(/<br\/>/g, ' ')}"]`);
    L.push(`${ind}    direction ${dir}`);
    conts.filter((k) => parentOf(k, conts) === c).forEach((k) => emit(k, ind + '    '));
    flow.filter((n) => parentOf(n, conts) === c).forEach((n) => L.push(ind + '    ' + def(n)));
    L.push(`${ind}end`);
  };
  conts.filter((c) => !parentOf(c, conts)).forEach((c) => emit(c, '    '));
  flow.filter((n) => !parentOf(n, conts)).forEach((n) => L.push('    ' + def(n)));
  L.push('');
  const ids = new Set(flow.map((n) => n.id));
  for (const e of model.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const lab = String(e.label || '').replace(/[|"<>#]/g, ' ').trim();
    L.push(`    ${safe(e.from)} ${e.dashed || e.dotted ? '-.->' : '-->'}${lab ? `|${lab}|` : ''} ${safe(e.to)}`);
  }
  L.push('');
  const dec = flow.filter((n) => n.shape === 'diamond').map((n) => safe(n.id));
  const term = flow.filter((n) => n.shape === 'terminator').map((n) => safe(n.id));
  if (term.length) { L.push('    classDef inicioFim fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20'); L.push(`    class ${term.join(',')} inicioFim`); }
  if (dec.length) { L.push('    classDef decisao fill:#FFF8E1,stroke:#F9A825,stroke-width:2px,color:#5D4037'); L.push(`    class ${dec.join(',')} decisao`); }
  return L.join('\n') + '\n';
}

export function cloneModel(m) { return JSON.parse(JSON.stringify(m)); }
