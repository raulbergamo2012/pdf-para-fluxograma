/* Editor visual interativo (estilo draw.io)
 *
 *  - Barra de formas à esquerda: arraste para o desenho ou clique para adicionar
 *  - Clique seleciona · arrastar move · alças redimensionam · Shift+clique / laço seleciona vários
 *  - Bolinhas azuis nos lados do bloco: puxe até outro bloco para criar uma seta
 *  - Clique duplo edita o texto (blocos, setas, ou cria um texto na área vazia)
 *  - Delete exclui · Ctrl+Z / Ctrl+Y desfaz/refaz · Ctrl+D duplica · Ctrl+C / Ctrl+V · setas do teclado movem
 */
import { SHAPES, PALETTE, LINES, renderSVG, routeEdge, bounds, nearestPort, portsOf, labelPoint, cloneModel, measure, wrapText, waypoints } from './visual-model.mjs';
import { parseFlowchart } from './graph.mjs';

const BLUE = '#2b7de9';
const GRID = 10;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===================================================================== importação do fluxograma gerado
function toHex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || '');
  if (!m) return c && c !== 'none' ? c : null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}
const decode = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n')
  .replace(/#(\w+);/g, (m, e) => ({ gt: '>', lt: '<', 35: '#', quot: '"', amp: '&' }[e] ?? m));

/** Converte o fluxograma desenhado pelo Mermaid (já com o layout final) em um modelo editável */
export function importFromMermaid(svg, code) {
  const g = parseFlowchart(code);
  const inv = svg.getScreenCTM().inverse();
  const P = (sx, sy) => new DOMPoint(sx, sy).matrixTransform(inv);
  const box = (el) => { const r = el.getBoundingClientRect(); const a = P(r.left, r.top), b = P(r.right, r.bottom); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }; };
  const nodeEl = new Map();
  for (const ge of svg.querySelectorAll('g.node')) { const m = /-flowchart-(.+)-\d+$/.exec(ge.id); if (m) nodeEl.set(m[1], ge); }
  const nodes = [];

  for (const sg of g.subgraphs) {
    const c = [...svg.querySelectorAll('g.cluster')].find((k) => k.id === sg.id || k.id.endsWith('-' + sg.id) || k.id.endsWith('_' + sg.id));
    const rect = c?.querySelector('rect');
    if (!rect) continue;
    const cs = getComputedStyle(rect);
    nodes.push({ id: sg.id, shape: 'container', ...box(rect), text: decode(sg.label), fill: toHex(cs.fill) || '#f7f7f7', stroke: toHex(cs.stroke) || '#bfbfbf', color: '#1a1a1a', fontSize: 14 });
  }
  for (const n of g.nodes.values()) {
    const el = nodeEl.get(n.id);
    if (!el) continue;
    const shapeEl = el.querySelector('polygon, rect, path, circle, ellipse');
    const b = box(shapeEl || el);
    const shape = n.kind === 'decision' ? 'diamond' : n.kind === 'terminal' ? (n.open === '((' || n.open === '(((' ? 'circle' : 'terminator')
      : n.open === '[(' ? 'cylinder' : n.open === '[/' || n.open === '[\\' ? 'parallelogram' : n.open === '{{' ? 'hexagon'
      : n.open === '(' ? 'rounded' : n.open === '[[' ? 'process' : 'rect';
    const cs = shapeEl ? getComputedStyle(shapeEl) : null;
    const lab = el.querySelector('.nodeLabel, span, p, text');
    const text = decode(n.label);
    nodes.push({
      id: n.id, shape, ...b, text,
      fill: toHex(cs?.fill) || '#ffffff', stroke: toHex(cs?.stroke) || '#333333',
      color: toHex(lab ? getComputedStyle(lab).color : '') || '#1a1a1a',
      fontSize: 14, align: /^•/m.test(text) ? 'left' : undefined,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const used = new Map();
  const edges = [];
  g.edges.forEach((e, i) => {
    const A = byId.get(e.from), B = byId.get(e.to);
    if (!A || !B) return;
    const key = `L_${e.from}_${e.to}_`;
    const k = used.get(key) || 0;
    used.set(key, k + 1);
    const pathEl = svg.querySelectorAll(`path[data-id^="${CSS.escape(key)}"]`)[k];
    let fromPort, toPort, stroke = '#333333';
    if (pathEl) {
      const m = pathEl.getScreenCTM();
      const L = pathEl.getTotalLength();
      const s = new DOMPoint(pathEl.getPointAtLength(0).x, pathEl.getPointAtLength(0).y).matrixTransform(m);
      const t = new DOMPoint(pathEl.getPointAtLength(L).x, pathEl.getPointAtLength(L).y).matrixTransform(m);
      const ps = P(s.x, s.y), pt = P(t.x, t.y);
      fromPort = nearestPort(A, ps.x, ps.y);
      toPort = nearestPort(B, pt.x, pt.y);
      stroke = toHex(getComputedStyle(pathEl).stroke) || stroke;
    }
    edges.push({ id: 'e' + (i + 1), from: e.from, to: e.to, fromPort, toPort, label: decode(e.label), kind: 'orth', dashed: e.type.startsWith('-.'), arrowEnd: true, stroke });
  });
  // coordenadas positivas, com margem
  const b = bounds({ nodes, edges }, 0);
  const dx = 60 - b.x, dy = 60 - b.y;
  nodes.forEach((n) => { n.x = Math.round(n.x + dx); n.y = Math.round(n.y + dy); n.w = Math.round(n.w); n.h = Math.round(n.h); });
  return { nodes, edges };
}

/** Índice do trecho da linha mais próximo de um ponto */
function nearestSeg(pts, q) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((q.x - x1) * (x2 - x1) + (q.y - y1) * (y2 - y1)) / L2));
    const dd = Math.hypot(q.x - (x1 + t * (x2 - x1)), q.y - (y1 + t * (y2 - y1)));
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

// ===================================================================== editor
export class VisualEditor {
  /**
   * @param {{ host: HTMLElement, palette: HTMLElement, format: HTMLElement, zoomLabel?: HTMLElement,
   *           model: object, defaults?: object, onChange?: (dirty: boolean) => void }} o
   */
  constructor(o) {
    Object.assign(this, { host: o.host, paletteEl: o.palette, formatEl: o.format, zoomLabel: o.zoomLabel, onChange: o.onChange || (() => {}) });
    this.model = cloneModel(o.model || { nodes: [], edges: [] });
    for (const e of this.model.edges) if (e.via) { e.points = [e.via]; delete e.via; }
    this.defaults = { fill: '#ffffff', stroke: '#333333', color: '#1a1a1a', line: '#333333', ...(o.defaults || {}) };
    this.sel = { nodes: new Set(), edges: new Set() };
    this.z = 1;
    this.undoStack = []; this.redoStack = [];
    this.dirty = false;
    this.hover = null;
    this.drag = null;
    this.clip = null;
    this.raf = 0;

    this.host.innerHTML = '<div class="ve-scroll"><div class="ve-stage"><div class="ve-content"></div><div class="ve-ovl"></div></div></div>';
    this.host.veditor = this; // acesso para testes automatizados
    this.scroll = this.host.querySelector('.ve-scroll');
    this.stage = this.host.querySelector('.ve-stage');
    this.contentEl = this.host.querySelector('.ve-content');
    this.ovlEl = this.host.querySelector('.ve-ovl');
    this.buildPalette();
    this.bind();
    this.render();
    requestAnimationFrame(() => this.fit());
  }

  // ------------------------------------------------------------ utilidades
  newId(prefix) {
    const used = new Set([...this.model.nodes.map((n) => n.id), ...this.model.edges.map((e) => e.id)]);
    let i = 1;
    while (used.has(prefix + i)) i++;
    return prefix + i;
  }
  node(id) { return this.model.nodes.find((n) => n.id === id); }
  edge(id) { return this.model.edges.find((e) => e.id === id); }
  pt(ev) {
    const r = this.stage.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / this.z, y: (ev.clientY - r.top) / this.z };
  }
  snap(v, on = true) { return on ? Math.round(v / GRID) * GRID : v; }
  hitNode(x, y, except) {
    const list = [...this.model.nodes].reverse();
    const ok = (n) => n.id !== except && x >= n.x - 4 && x <= n.x + n.w + 4 && y >= n.y - 4 && y <= n.y + n.h + 4;
    return list.find((n) => n.shape !== 'container' && ok(n)) || list.find((n) => n.shape === 'container' && ok(n)) || null;
  }
  // o histórico guarda o desenho e a seleção (como no draw.io, desfazer devolve a seleção)
  pack() { return JSON.stringify({ m: this.model, s: [[...this.sel.nodes], [...this.sel.edges]] }); }
  unpack(str) {
    const o = JSON.parse(str);
    this.model = o.m;
    this.sel = { nodes: new Set(o.s[0]), edges: new Set(o.s[1]) };
  }
  /**
   * Bloco onde a ponta de uma seta deve se ligar — ou null para deixar a ponta SOLTA.
   * Liga só quando o mouse está sobre um bloco de verdade ou bem perto de uma âncora;
   * o interior das seções (contêineres) é área livre. Com Alt a ponta fica sempre solta.
   */
  attachTarget(x, y, except, free = false) {
    if (free) return null;
    const list = [...this.model.nodes].reverse().filter((n) => n.id !== except);
    const m = 14 / this.z;
    const inside = list.find((n) => n.shape !== 'container' && x >= n.x - 4 && x <= n.x + n.w + 4 && y >= n.y - 4 && y <= n.y + n.h + 4);
    if (inside) return inside;
    for (const n of list) for (const [px, py] of Object.values(portsOf(n))) if (Math.hypot(px - x, py - y) <= m) return n;
    return null;
  }
  snapshot() {
    this.undoStack.push(this.pack());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.onChange(true);
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.pack());
    this.unpack(this.undoStack.pop());
    this.cleanSel(); this.render(); this.onChange(true);
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.pack());
    this.unpack(this.redoStack.pop());
    this.cleanSel(); this.render(); this.onChange(true);
  }
  cleanSel() {
    for (const id of [...this.sel.nodes]) if (!this.node(id)) this.sel.nodes.delete(id);
    for (const id of [...this.sel.edges]) if (!this.edge(id)) this.sel.edges.delete(id);
  }
  getModel() { return cloneModel(this.model); }

  // ------------------------------------------------------------ desenho
  extent() {
    const b = bounds(this.model, 0);
    const W = Math.max(b.x + b.w + 500, (this.scroll.clientWidth || 800) / this.z);
    const H = Math.max(b.y + b.h + 400, (this.scroll.clientHeight || 600) / this.z);
    return { W, H };
  }
  render() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.rafSel);
    this.raf = 0; this.rafSel = 0;
    const { W, H } = this.extent();
    const z = this.z;
    this.stage.style.width = W * z + 'px';
    this.stage.style.height = H * z + 'px';
    this.stage.style.backgroundSize = `${GRID * z}px ${GRID * z}px, ${GRID * z}px ${GRID * z}px, ${GRID * 5 * z}px ${GRID * 5 * z}px, ${GRID * 5 * z}px ${GRID * 5 * z}px`;
    this.dims = { W, H };
    // camada do desenho: só é refeita quando o desenho muda (assim o clique duplo sempre acerta o mesmo bloco)
    this.contentEl.innerHTML = renderSVG(this.model, {
      viewBox: { x: 0, y: 0, w: W, h: H }, width: W * z, height: H * z, interactive: true, labelBorder: this.defaults.labelBorder,
    });
    this.renderSel();
  }
  /** Só a camada de seleção (alças, âncoras, guias): rápida e não mexe nos blocos */
  renderSel() {
    cancelAnimationFrame(this.rafSel);
    this.rafSel = 0;
    const { W, H } = this.dims || this.extent();
    const z = this.z;
    this.ovlEl.innerHTML = `<svg class="ve-ov" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:${W * z}px;height:${H * z}px"><g stroke="none">${this.overlay()}</g></svg>`;
    if (this.zoomLabel) this.zoomLabel.textContent = Math.round(z * 100) + '%';
    this.renderFormat();
  }
  later() { if (!this.raf) this.raf = requestAnimationFrame(() => this.render()); }
  laterSel() { if (!this.raf && !this.rafSel) this.rafSel = requestAnimationFrame(() => this.renderSel()); }

  overlay() {
    const s = 1 / this.z;
    const parts = [];
    const handleSize = 10 * s;
    // seleção de blocos
    for (const id of this.sel.nodes) {
      const n = this.node(id);
      if (!n) continue;
      parts.push(`<rect x="${n.x - 3 * s}" y="${n.y - 3 * s}" width="${n.w + 6 * s}" height="${n.h + 6 * s}" fill="none" stroke="${BLUE}" stroke-width="${1.5 * s}" stroke-dasharray="${4 * s} ${3 * s}" pointer-events="none"/>`);
    }
    if (this.sel.nodes.size === 1 && !this.drag) {
      const n = this.node([...this.sel.nodes][0]);
      if (n) {
        // faixas invisíveis nas 4 bordas: dá para esticar o bloco pegando a borda, não só as alças
        const t = 8 * s;
        parts.push(`<rect data-handle="n" class="ve-h ve-h-n" x="${n.x}" y="${n.y - t / 2}" width="${n.w}" height="${t}" fill="transparent"/>`,
          `<rect data-handle="s" class="ve-h ve-h-s" x="${n.x}" y="${n.y + n.h - t / 2}" width="${n.w}" height="${t}" fill="transparent"/>`,
          `<rect data-handle="w" class="ve-h ve-h-w" x="${n.x - t / 2}" y="${n.y}" width="${t}" height="${n.h}" fill="transparent"/>`,
          `<rect data-handle="e" class="ve-h ve-h-e" x="${n.x + n.w - t / 2}" y="${n.y}" width="${t}" height="${n.h}" fill="transparent"/>`);
        const hs = { nw: [n.x, n.y], n: [n.x + n.w / 2, n.y], ne: [n.x + n.w, n.y], e: [n.x + n.w, n.y + n.h / 2], se: [n.x + n.w, n.y + n.h], s: [n.x + n.w / 2, n.y + n.h], sw: [n.x, n.y + n.h], w: [n.x, n.y + n.h / 2] };
        for (const [k, [x, y]] of Object.entries(hs)) {
          parts.push(`<rect data-handle="${k}" class="ve-h ve-h-${k}" x="${x - handleSize / 2}" y="${y - handleSize / 2}" width="${handleSize}" height="${handleSize}" fill="#fff" stroke="${BLUE}" stroke-width="${1.5 * s}"/>`);
        }
      }
    }
    // bolinhas de conexão (bloco sob o mouse ou selecionado)
    const portFor = new Set();
    if (this.hover && (!this.drag || this.drag.mode === 'connect' || this.drag.mode === 'endpoint')) portFor.add(this.hover);
    if (this.sel.nodes.size === 1 && !this.drag) portFor.add([...this.sel.nodes][0]);
    for (const id of portFor) {
      const n = this.node(id);
      if (!n || SHAPES[n.shape]?.noShape && !this.drag) continue;
      for (const [k, [x, y]] of Object.entries(portsOf(n))) {
        const off = { top: [0, -14], right: [14, 0], bottom: [0, 14], left: [-14, 0] }[k];
        const ox = this.drag ? 0 : off[0] * s, oy = this.drag ? 0 : off[1] * s;
        parts.push(`<g data-port="${k}" data-node="${esc(n.id)}" class="ve-port">
          <circle cx="${x + ox}" cy="${y + oy}" r="${9 * s}" fill="transparent"/>
          <circle cx="${x + ox}" cy="${y + oy}" r="${4.5 * s}" fill="${BLUE}" fill-opacity="${this.drag ? 0.45 : 0.85}" stroke="#fff" stroke-width="${1.2 * s}"/></g>`);
      }
    }
    // setas: selecionadas e a que está sob o mouse ganham indicadores (pontas, dobras e trechos)
    const showEdge = (id, faint) => {
      const e = this.edge(id);
      if (!e) return;
      const pts = routeEdge(this.model, e);
      const path = `M${pts.map((q) => q.join(' ')).join('L')}`;
      parts.push(`<path d="${path}" fill="none" stroke="${BLUE}" stroke-width="${(faint ? 7 : 5) * s}" stroke-opacity="${faint ? 0.14 : 0.25}" stroke-linejoin="round"/>`);
      if (this.drag && this.drag.eid !== id) return;
      const ed = `data-edge="${esc(id)}"`;
      if (e.kind === 'orth') {
        // um puxador em cada trecho: arraste para deslocar o trecho (vira "L", "Z", "U"...)
        for (let i = 0; i < pts.length - 1; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
          const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
          if (len * this.z < 26) continue;
          const hz = Math.abs(y2 - y1) < 0.5;
          const w = (hz ? 14 : 7) * s, h = (hz ? 7 : 14) * s;
          parts.push(`<rect ${ed} data-seg="${i}" class="ve-seg ${hz ? 've-seg-h' : 've-seg-v'}" x="${(x1 + x2) / 2 - w / 2}" y="${(y1 + y2) / 2 - h / 2}" width="${w}" height="${h}" rx="${2 * s}" fill="#fff" stroke="${BLUE}" stroke-width="${1.5 * s}" opacity="${faint ? 0.75 : 1}"><title>Arraste para mudar o formato da linha · clique duplo: rota automática</title></rect>`);
        }
      } else {
        const wps = waypoints(e);
        const ctrl = [pts[0], ...wps, pts[pts.length - 1]];
        for (let i = 0; i < ctrl.length - 1; i++) {
          const mx = (ctrl[i][0] + ctrl[i + 1][0]) / 2, my = (ctrl[i][1] + ctrl[i + 1][1]) / 2;
          parts.push(`<circle ${ed} data-vp="${i}" class="ve-vp" cx="${mx}" cy="${my}" r="${4.5 * s}" fill="#fff" fill-opacity=".9" stroke="${BLUE}" stroke-width="${1.3 * s}" opacity="${faint ? 0.7 : 1}"><title>Arraste para criar uma dobra</title></circle>`);
        }
        wps.forEach(([x, y], i) => parts.push(`<rect ${ed} data-wp="${i}" class="ve-wp" x="${x - 5 * s}" y="${y - 5 * s}" width="${10 * s}" height="${10 * s}" fill="${BLUE}" stroke="#fff" stroke-width="${1.2 * s}"><title>Arraste para mover a dobra · clique duplo remove</title></rect>`));
      }
      [[pts[0], !!e.from], [pts[pts.length - 1], !!e.to]].forEach(([[x, y], attached], i) => parts.push(
        `<circle ${ed} data-ehandle="${i + 1}" class="ve-eh" cx="${x}" cy="${y}" r="${6 * s}" fill="${attached ? BLUE : '#fff'}" stroke="${attached ? '#fff' : BLUE}" stroke-width="${2 * s}"><title>${attached ? 'Ponta ligada ao bloco — arraste para soltar ou religar' : 'Ponta solta — arraste para qualquer lugar ou até um bloco'}</title></circle>`));
    };
    const single = this.sel.edges.size === 1 && !this.sel.nodes.size;
    for (const id of this.sel.edges) {
      if (single || this.drag?.eid === id) showEdge(id, false);
      else { const e = this.edge(id); if (e) { const pts = routeEdge(this.model, e); parts.push(`<path d="M${pts.map((q) => q.join(' ')).join('L')}" fill="none" stroke="${BLUE}" stroke-width="${5 * s}" stroke-opacity=".25"/>`); } }
    }
    if (this.hoverEdge && !this.sel.edges.has(this.hoverEdge) && !this.drag) showEdge(this.hoverEdge, true);
    const d = this.drag;
    if (d?.mode === 'connect') {
      const [x1, y1] = d.origin;
      parts.push(`<path d="M${x1} ${y1}L${d.cur.x} ${d.cur.y}" stroke="${BLUE}" stroke-width="${2 * s}" stroke-dasharray="${5 * s} ${4 * s}"/>`);
    }
    if ((d?.mode === 'connect' || d?.mode === 'endpoint') && d.cur) {
      const tgt = d.target ? this.node(d.target) : null;
      if (tgt) {
        parts.push(`<rect x="${tgt.x - 4 * s}" y="${tgt.y - 4 * s}" width="${tgt.w + 8 * s}" height="${tgt.h + 8 * s}" fill="${BLUE}" fill-opacity=".08" stroke="${BLUE}" stroke-width="${2 * s}" rx="${4 * s}"/>`);
        const [px, py] = portsOf(tgt)[nearestPort(tgt, d.cur.x, d.cur.y)];
        parts.push(`<circle cx="${px}" cy="${py}" r="${6 * s}" fill="#22a06b" stroke="#fff" stroke-width="${1.5 * s}"/>`);
      } else {
        parts.push(`<circle cx="${d.cur.x}" cy="${d.cur.y}" r="${5 * s}" fill="#fff" stroke="${BLUE}" stroke-width="${1.5 * s}"/>`);
      }
    }
    if (d?.guides) for (const g of d.guides) {
      parts.push(g.v != null
        ? `<line x1="${g.v}" x2="${g.v}" y1="${g.a}" y2="${g.b}" stroke="#ff2d78" stroke-width="${s}" stroke-dasharray="${3 * s} ${2 * s}" pointer-events="none"/>`
        : `<line y1="${g.h}" y2="${g.h}" x1="${g.a}" x2="${g.b}" stroke="#ff2d78" stroke-width="${s}" stroke-dasharray="${3 * s} ${2 * s}" pointer-events="none"/>`);
    }
    if (d?.mode === 'marquee') {
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      parts.push(`<rect x="${x}" y="${y}" width="${Math.abs(d.cur.x - d.start.x)}" height="${Math.abs(d.cur.y - d.start.y)}" fill="${BLUE}" fill-opacity=".08" stroke="${BLUE}" stroke-width="${s}" stroke-dasharray="${4 * s} ${3 * s}" pointer-events="none"/>`);
    }
    return parts.join('');
  }

  // ------------------------------------------------------------ barra de formas
  buildPalette() {
    const prev = (shape) => {
      const s = SHAPES[shape];
      if (shape === 'text') return '<svg viewBox="0 0 44 34"><text x="22" y="21" text-anchor="middle" font-size="11" fill="#333" stroke="none">Texto</text></svg>';
      if (shape === 'heading') return '<svg viewBox="0 0 44 34"><text x="4" y="11" font-size="8.5" font-weight="700" fill="#333" stroke="none">Título</text><path d="M4 17h34M4 22h30M4 27h32" stroke="#999" stroke-width="1.3"/></svg>';
      const k = Math.min(36 / s.w, 26 / s.h);
      const w = s.w * k, h = s.h * k;
      return `<svg viewBox="0 0 44 34"><g fill="#fff" stroke="#3a3a3a" stroke-width="1.3" stroke-linejoin="round">${s.draw((44 - w) / 2, (34 - h) / 2, w, h)}</g></svg>`;
    };
    const linePrev = (k) => {
      const e = LINES[k].edge;
      const dash = e.dashed ? ' stroke-dasharray="5 3"' : e.dotted ? ' stroke-dasharray="1.5 3" stroke-linecap="round"' : '';
      const w = e.width ? 3.2 : 1.6;
      const d = e.kind === 'curve' ? 'M6 28Q8 6 36 8' : e.kind === 'orth' ? 'M6 28H22V8H36' : 'M6 28L36 8';
      const head = (x, y, a) => `<path d="M0 0L-7 -3.5L-7 3.5Z" fill="#3a3a3a" transform="translate(${x} ${y}) rotate(${a})"/>`;
      return `<svg viewBox="0 0 44 34"><path d="${d}" fill="none" stroke="#3a3a3a" stroke-width="${w}"${dash}/>`
        + (e.arrowEnd ? head(37, e.kind === 'orth' ? 8 : 7.5, e.kind === 'orth' ? 0 : e.kind === 'curve' ? -5 : -34) : '')
        + (e.arrowStart ? head(5, 28.5, 146) : '') + '</svg>';
    };
    this.paletteEl.innerHTML = `
      <div class="ve-pal-title">Formas</div>
      <div class="ve-pal-grid">${PALETTE.flat().map((k) => `<button class="ve-pal-item" data-shape="${k}" title="${esc(SHAPES[k].name)}" aria-label="${esc(SHAPES[k].name)}">${prev(k)}</button>`).join('')}</div>
      <div class="ve-pal-title">Linhas e setas</div>
      <div class="ve-pal-grid">${Object.keys(LINES).map((k) => `<button class="ve-pal-item" data-line="${k}" title="${esc(LINES[k].name)}" aria-label="${esc(LINES[k].name)}">${linePrev(k)}</button>`).join('')}</div>
      <p class="ve-pal-hint">Arraste para o desenho ou clique para adicionar.</p>`;
  }

  // ------------------------------------------------------------ adicionar
  viewCenter() {
    return { x: (this.scroll.scrollLeft + this.scroll.clientWidth / 2) / this.z, y: (this.scroll.scrollTop + this.scroll.clientHeight / 2) / this.z };
  }
  addShape(shape, cx, cy, editNow = false) {
    // "Raia" da paleta = contêiner com faixa de cabeçalho (mesmo comportamento das seções)
    const asLane = shape === 'lane';
    if (asLane) shape = 'container';
    const s = asLane ? SHAPES.lane : SHAPES[shape];
    if (!s) return;
    if (cx === undefined) {
      const c = this.viewCenter();
      this.addCount = (this.addCount || 0) + 1;
      cx = c.x + (this.addCount % 5) * 20; cy = c.y + (this.addCount % 5) * 20;
    }
    this.snapshot();
    const D = this.defaults;
    const n = {
      id: this.newId('n'), shape, w: s.w, h: s.h,
      x: this.snap(cx - s.w / 2), y: this.snap(cy - s.h / 2),
      text: { text: 'Texto', heading: 'Título\nEscreva aqui o parágrafo.', diamond: 'Pergunta?', terminator: 'Fim', container: 'Nova seção', actor: 'Pessoa' }[shape] ?? '',
      fill: shape === 'diamond' ? (D.decisionFill || D.fill) : shape === 'terminator' ? (D.terminalFill || D.fill) : shape === 'container' ? (D.containerFill || '#f7f7f7') : D.fill,
      stroke: shape === 'diamond' ? (D.decisionStroke || D.stroke) : shape === 'terminator' ? (D.terminalStroke || D.stroke) : shape === 'container' ? (D.containerStroke || '#bfbfbf') : D.stroke,
      color: D.color, fontSize: 14,
    };
    if (asLane) { n.band = true; n.text = 'Responsável'; }
    if (shape === 'container') this.model.nodes.unshift(n); else this.model.nodes.push(n);
    this.sel = { nodes: new Set([n.id]), edges: new Set() };
    this.render();
    if (editNow) this.editText(n.id);
    return n.id;
  }
  addLine(kind, cx, cy) {
    if (cx === undefined) { const c = this.viewCenter(); cx = c.x; cy = c.y; }
    this.snapshot();
    const e = { id: this.newId('e'), p1: [this.snap(cx - 60), this.snap(cy + 30)], p2: [this.snap(cx + 60), this.snap(cy - 30)], label: '', stroke: this.defaults.line, ...LINES[kind].edge };
    this.model.edges.push(e);
    this.sel = { nodes: new Set(), edges: new Set([e.id]) };
    this.render();
  }

  /** Clique numa bolinha azul (sem arrastar): cria um bloco igual naquele lado, já ligado — como no draw.io */
  quickAdd(fromId, port) {
    const A = this.node(fromId);
    if (!A) return this.render();
    this.snapshot();
    const shape = A.shape === 'diamond' || A.shape === 'terminator' ? 'rect' : A.shape;
    const S = SHAPES[shape];
    const w = shape === A.shape ? A.w : S.w, h = shape === A.shape ? A.h : S.h;
    const gap = 60;
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
    const pos = { top: [cx - w / 2, A.y - gap - h], bottom: [cx - w / 2, A.y + A.h + gap], left: [A.x - gap - w, cy - h / 2], right: [A.x + A.w + gap, cy - h / 2] }[port];
    const src = shape === A.shape ? A : { fill: this.defaults.fill, stroke: this.defaults.stroke, color: this.defaults.color };
    const n = { id: this.newId('n'), shape, x: this.snap(pos[0]), y: this.snap(pos[1]), w, h, text: '', fill: src.fill, stroke: src.stroke, color: src.color, fontSize: A.fontSize || 14 };
    this.model.nodes.push(n);
    let label = '';
    if (A.shape === 'diamond') {
      const names = this.model.edges.filter((x) => x.from === A.id).map((x) => (x.label || '').toLowerCase());
      label = !names.includes('sim') ? 'Sim' : !names.includes('não') ? 'Não' : '';
    }
    const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[port];
    this.model.edges.push({ id: this.newId('e'), from: A.id, fromPort: port, to: n.id, toPort: opp, label, kind: 'orth', arrowEnd: true, stroke: this.defaults.line });
    this.sel = { nodes: new Set([n.id]), edges: new Set() };
    this.render();
  }

  // ------------------------------------------------------------ ações
  deleteSelection() {
    if (!this.sel.nodes.size && !this.sel.edges.size) return;
    this.snapshot();
    const ns = this.sel.nodes;
    this.model.nodes = this.model.nodes.filter((n) => !ns.has(n.id));
    this.model.edges = this.model.edges.filter((e) => !this.sel.edges.has(e.id) && !ns.has(e.from) && !ns.has(e.to));
    this.sel = { nodes: new Set(), edges: new Set() };
    this.render();
  }
  copy() {
    const ns = this.model.nodes.filter((n) => this.sel.nodes.has(n.id));
    const es = this.model.edges.filter((e) => this.sel.edges.has(e.id) || (this.sel.nodes.has(e.from) && this.sel.nodes.has(e.to)));
    if (ns.length || es.length) this.clip = JSON.stringify({ ns, es });
    return !!this.clip;
  }
  paste(offset = 20) {
    if (!this.clip) return;
    this.snapshot();
    const { ns, es } = JSON.parse(this.clip);
    const map = new Map();
    const sel = { nodes: new Set(), edges: new Set() };
    for (const n of ns) { const id = this.newId('n'); map.set(n.id, id); this.model.nodes.push({ ...n, id, x: n.x + offset, y: n.y + offset }); sel.nodes.add(id); }
    for (const e of es) {
      const id = this.newId('e');
      const c = { ...e, id, from: map.get(e.from) || null, to: map.get(e.to) || null };
      if (!c.from) c.p1 = e.p1 ? [e.p1[0] + offset, e.p1[1] + offset] : undefined;
      if (!c.to) c.p2 = e.p2 ? [e.p2[0] + offset, e.p2[1] + offset] : undefined;
      if ((e.from && !c.from) || (e.to && !c.to)) continue;
      this.model.edges.push(c); sel.edges.add(id);
    }
    this.clip = JSON.stringify({ ns: ns.map((n) => ({ ...n, x: n.x + offset, y: n.y + offset })), es });
    this.sel = sel;
    this.render();
  }
  duplicate() { if (this.copy()) this.paste(); }
  selectAll() { this.sel = { nodes: new Set(this.model.nodes.map((n) => n.id)), edges: new Set(this.model.edges.map((e) => e.id)) }; this.renderSel(); }
  order(front) {
    if (!this.sel.nodes.size) return;
    this.snapshot();
    const picked = this.model.nodes.filter((n) => this.sel.nodes.has(n.id));
    const rest = this.model.nodes.filter((n) => !this.sel.nodes.has(n.id));
    this.model.nodes = front ? [...rest, ...picked] : [...picked, ...rest];
    this.render();
  }
  nudge(dx, dy) {
    if (!this.sel.nodes.size) return;
    if (!this.nudging) { this.snapshot(); this.nudging = true; clearTimeout(this.nudgeT); }
    this.nudgeT = setTimeout(() => (this.nudging = false), 600);
    this.model.nodes.forEach((n) => { if (this.sel.nodes.has(n.id)) { n.x += dx; n.y += dy; } });
    this.render();
  }
  setNodes(patch) {
    if (!this.sel.nodes.size) return;
    this.snapshot();
    this.model.nodes.forEach((n) => { if (this.sel.nodes.has(n.id)) Object.assign(n, typeof patch === 'function' ? patch(n) : patch); });
    this.render();
  }
  setEdges(patch) {
    if (!this.sel.edges.size) return;
    this.snapshot();
    this.model.edges.forEach((e) => { if (this.sel.edges.has(e.id)) Object.assign(e, patch); });
    this.render();
  }

  // ------------------------------------------------------------ texto no lugar (clique duplo)
  editText(id, isEdge = false) {
    this.commitText();
    const z = this.z;
    let x, y, w, h, value, size, align = 'center';
    if (isEdge) {
      const e = this.edge(id);
      if (!e) return;
      const [lx, ly] = labelPoint(this.model, e, routeEdge(this.model, e));
      w = 140; h = 30; x = lx - w / 2; y = ly - h / 2; value = e.label || ''; size = 13;
    } else {
      const n = this.node(id);
      if (!n) return;
      const sh = SHAPES[n.shape];
      const b = sh.box ? sh.box(n.x, n.y, n.w, n.h, n) : { x: n.x, y: n.y, w: n.w, h: n.h };
      if (sh.valign === 'below') { x = n.x - 40; y = n.y + n.h + 2; w = n.w + 80; h = 40; } else ({ x, y, w, h } = b);
      w = Math.max(w, 90); h = Math.max(h, 30);
      value = n.text || ''; size = n.fontSize || 14; align = n.align || sh.align || 'center';
    }
    const ta = document.createElement('textarea');
    ta.className = 've-inline';
    ta.value = value;
    Object.assign(ta.style, { left: x * z + 'px', top: y * z + 'px', width: w * z + 'px', height: h * z + 'px', fontSize: size * z + 'px', textAlign: align });
    ta.dataset.target = id;
    ta.dataset.edge = isEdge ? '1' : '';
    this.stage.appendChild(ta);
    ta.focus(); ta.select();
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ta.dataset.cancel = '1'; ta.blur(); }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); }
    });
    ta.addEventListener('blur', () => this.commitText());
  }
  commitText() {
    const ta = this.stage.querySelector('textarea.ve-inline');
    if (!ta || ta.dataset.done) return;
    ta.dataset.done = '1';
    const id = ta.dataset.target, isEdge = !!ta.dataset.edge, val = ta.value.replace(/\s+$/, '');
    ta.remove();
    if (ta.dataset.cancel) { this.render(); return; }
    const obj = isEdge ? this.edge(id) : this.node(id);
    if (!obj) return;
    const old = isEdge ? obj.label || '' : obj.text || '';
    if (old === val) { this.render(); return; }
    this.snapshot();
    if (isEdge) obj.label = val;
    else {
      obj.text = val;
      if (obj.shape === 'text') {
        if (!val.trim()) { this.model.nodes = this.model.nodes.filter((n) => n !== obj); this.sel.nodes.delete(obj.id); }
        else {
          const lines = wrapText(val, 600, obj.fontSize || 14);
          obj.w = Math.max(40, Math.ceil(Math.max(...lines.map((l) => measure(l, obj.fontSize || 14))) + 20));
          obj.h = Math.max(30, Math.ceil(lines.length * (obj.fontSize || 14) * 1.3 + 14));
        }
      } else if (SHAPES[obj.shape]?.valign !== 'below' && obj.shape !== 'container' && obj.shape !== 'heading') {
        // aumenta o bloco se o texto não couber
        const sh = SHAPES[obj.shape];
        const b = sh.box ? sh.box(obj.x, obj.y, obj.w, obj.h, obj) : { w: obj.w, h: obj.h };
        const lines = wrapText(val, Math.max(20, b.w - 16), obj.fontSize || 14);
        const need = lines.length * (obj.fontSize || 14) * 1.3 + 16;
        if (need > b.h) obj.h = Math.ceil(obj.h + (need - b.h) / (b.h / obj.h));
      }
    }
    this.render();
  }

  // ------------------------------------------------------------ zoom
  setZoom(z, anchor) {
    z = Math.min(3, Math.max(0.2, z));
    const a = anchor || { x: this.scroll.clientWidth / 2, y: this.scroll.clientHeight / 2 };
    const mx = (this.scroll.scrollLeft + a.x) / this.z, my = (this.scroll.scrollTop + a.y) / this.z;
    this.z = z;
    this.render();
    this.scroll.scrollLeft = mx * z - a.x;
    this.scroll.scrollTop = my * z - a.y;
  }
  zoomIn() { this.setZoom(this.z * 1.2); }
  zoomOut() { this.setZoom(this.z / 1.2); }
  fit() {
    const b = bounds(this.model, 40);
    const z = Math.min((this.scroll.clientWidth - 20) / b.w, (this.scroll.clientHeight - 20) / b.h, 1.2);
    this.z = Math.max(0.2, z < 0.55 ? Math.min(0.75, (this.scroll.clientWidth - 20) / b.w) : z);
    this.render();
    this.scroll.scrollLeft = b.x * this.z - Math.max(0, (this.scroll.clientWidth - b.w * this.z) / 2);
    this.scroll.scrollTop = b.y * this.z - Math.max(0, (this.scroll.clientHeight - b.h * this.z) / 2);
  }

  // ------------------------------------------------------------ eventos
  bind() {
    const st = this.stage;
    this.handlers = [];
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); this.handlers.push([el, ev, fn, opt]); };

    on(st, 'pointerdown', (e) => this.onDown(e));
    on(st, 'pointermove', (e) => this.onMove(e));
    on(st, 'pointerup', (e) => this.onUp(e));
    on(st, 'pointercancel', () => { this.drag = null; this.render(); });
    // clique duplo detectado aqui mesmo (o desenho é refeito a cada clique, o que confunde o 'dblclick' do navegador)
    on(st, 'dblclick', (e) => {
      e.preventDefault();
      if (this.stage.querySelector('textarea.ve-inline') || e.target.closest('textarea')) return;
      this.onDblClick(e);
    });
    on(st, 'contextmenu', (e) => this.openMenu(e));
    on(window, 'pointerdown', (e) => { if (this.menu && !e.target.closest('.ve-menu')) this.closeMenu(); }, true);
    on(this.scroll, 'wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = this.scroll.getBoundingClientRect();
      this.setZoom(this.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'keyup', (e) => { if (e.code === 'Space') { this.space = false; this.scroll.classList.remove('ve-pan'); } });
    on(window, 'resize', () => this.render());

    // barra de formas: arrastar para o desenho ou clicar
    on(this.paletteEl, 'pointerdown', (e) => {
      const b = e.target.closest('.ve-pal-item');
      if (!b) return;
      e.preventDefault();
      this.pal = { shape: b.dataset.shape, line: b.dataset.line, sx: e.clientX, sy: e.clientY, ghost: null, html: b.innerHTML };
    });
    on(window, 'pointermove', (e) => {
      const p = this.pal;
      if (!p) return;
      if (!p.ghost && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 5) {
        p.ghost = document.createElement('div');
        p.ghost.className = 've-ghost';
        p.ghost.innerHTML = p.html;
        document.body.appendChild(p.ghost);
      }
      if (p.ghost) { p.ghost.style.left = e.clientX + 'px'; p.ghost.style.top = e.clientY + 'px'; }
    });
    on(window, 'pointerup', (e) => {
      const p = this.pal;
      if (!p) return;
      this.pal = null;
      p.ghost?.remove();
      const r = this.scroll.getBoundingClientRect();
      const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
      if (p.ghost && !inside) return;
      const at = p.ghost ? this.pt(e) : null;
      if (p.shape) this.addShape(p.shape, at?.x, at?.y);
      else if (p.line) this.addLine(p.line, at?.x, at?.y);
    });

    // barra de formatação
    on(this.formatEl, 'click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b) this.cmd(b.dataset.cmd, b.dataset.val);
    });
  }
  // ------------------------------------------------------------ menu do botão direito
  openMenu(e) {
    e.preventDefault();
    this.commitText();
    this.drag = null;
    const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    const ng = under.closest?.('g.vn'), eg = under.closest?.('g.ve');
    if (ng && !this.sel.nodes.has(ng.dataset.id)) this.sel = { nodes: new Set([ng.dataset.id]), edges: new Set() };
    else if (eg && !this.sel.edges.has(eg.dataset.eid)) this.sel = { nodes: new Set(), edges: new Set([eg.dataset.eid]) };
    else if (!ng && !eg) this.sel = { nodes: new Set(), edges: new Set() };
    this.renderSel();
    const at = this.pt(e);
    const has = this.sel.nodes.size || this.sel.edges.size;
    const one = this.sel.nodes.size === 1 ? [...this.sel.nodes][0] : null;
    const oneE = !this.sel.nodes.size && this.sel.edges.size === 1 ? [...this.sel.edges][0] : null;
    const items = [
      one && ['edit', 'Editar texto', 'Clique duplo'],
      oneE && ['elabel', 'Editar rótulo', 'Clique duplo'],
      oneE && waypoints(this.edge(oneE) || {}).length && ['straighten', 'Rota automática da seta', ''],
      has && ['-'],
      has && ['cut', 'Recortar', 'Ctrl+X'],
      has && ['copy', 'Copiar', 'Ctrl+C'],
      ['paste', 'Colar', 'Ctrl+V', !this.clip],
      has && ['dup', 'Duplicar', 'Ctrl+D'],
      has && ['del', 'Excluir', 'Delete'],
      this.sel.nodes.size && ['-'],
      this.sel.nodes.size && ['front', 'Trazer para frente', ''],
      this.sel.nodes.size && ['back', 'Enviar para trás', ''],
      ['-'],
      ['undo', 'Desfazer', 'Ctrl+Z', !this.undoStack.length],
      ['redo', 'Refazer', 'Ctrl+Y', !this.redoStack.length],
      ['all', 'Selecionar tudo', 'Ctrl+A'],
      !has && ['text', 'Adicionar texto aqui', ''],
      !has && ['rect', 'Adicionar retângulo aqui', ''],
      !has && ['diamond', 'Adicionar decisão aqui', ''],
    ].filter(Boolean).filter((it, i, arr) => !(it[0] === '-' && (i === 0 || arr[i - 1][0] === '-')));
    const m = document.createElement('div');
    m.className = 've-menu';
    m.innerHTML = items.map((it) => it[0] === '-' ? '<hr>' : `<button data-m="${it[0]}"${it[3] ? ' disabled' : ''}><span>${esc(it[1])}</span><kbd>${esc(it[2])}</kbd></button>`).join('');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
    m.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-m]');
      if (!b || b.disabled) return;
      this.closeMenu();
      const k = b.dataset.m;
      if (k === 'edit') this.editText(one);
      else if (k === 'elabel') this.editText(oneE, true);
      else if (k === 'straighten') { this.snapshot(); const x = this.edge(oneE); delete x.via; delete x.points; this.render(); }
      else if (k === 'cut') { if (this.copy()) this.deleteSelection(); }
      else if (k === 'copy') this.copy();
      else if (k === 'paste') this.paste();
      else if (k === 'dup') this.duplicate();
      else if (k === 'del') this.deleteSelection();
      else if (k === 'front' || k === 'back') this.order(k === 'front');
      else if (k === 'undo') this.undo();
      else if (k === 'redo') this.redo();
      else if (k === 'all') this.selectAll();
      else this.addShape(k, at.x, at.y);
    });
    this.menu = m;
  }
  closeMenu() { this.menu?.remove(); this.menu = null; this.lastDown = null; }

  destroy() {
    this.closeMenu();
    for (const [el, ev, fn, opt] of this.handlers) el.removeEventListener(ev, fn, opt);
    cancelAnimationFrame(this.raf);
    this.host.innerHTML = ''; this.paletteEl.innerHTML = ''; this.formatEl.innerHTML = '';
  }

  onDblClick(e) {
    const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    const wpEl = under.closest?.('[data-wp]'), segEl = under.closest?.('[data-seg]');
    if (wpEl || segEl) {
      const ed = this.edge((wpEl || segEl).dataset.edge);
      if (ed && waypoints(ed).length) {
        this.snapshot();
        if (wpEl) { ed.points = waypoints(ed).filter((_, i) => i !== Number(wpEl.dataset.wp)); } else ed.points = [];
        delete ed.via;
        if (!ed.points.length) delete ed.points;
        this.render();
      }
      return true;
    }
    if (under.closest?.('[data-handle], [data-port], [data-ehandle], [data-vp]')) return false;
    const ng = under.closest?.('g.vn'), eg = under.closest?.('g.ve');
    if (ng) this.editText(ng.dataset.id);
    else if (eg) this.editText(eg.dataset.eid, true);
    else { const p = this.pt(e); this.addShape('text', p.x, p.y, true); }
    return true;
  }
  onDown(e) {
    if (e.target.closest('textarea')) return;
    this.commitText();
    const p = this.pt(e);
    const now = performance.now(), last = this.lastDown;
    this.lastDown = e.button === 0 ? { t: now, x: e.clientX, y: e.clientY } : null;
    if (e.button === 0 && last && now - last.t < 550 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10) {
      this.lastDown = null;
      this.drag = null;
      if (this.onDblClick(e)) { e.preventDefault(); return; }
    }
    if (e.button === 1 || this.space) {
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, sl: this.scroll.scrollLeft, st: this.scroll.scrollTop };
      this.stage.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const t = e.target;
    const handle = t.closest('[data-handle]'), port = t.closest('[data-port]'), eh = t.closest('[data-ehandle]');
    const segEl = t.closest('[data-seg]'), wpEl = t.closest('[data-wp]'), vpEl = t.closest('[data-vp]');
    const ng = t.closest('g.vn'), eg = t.closest('g.ve');
    this.stage.setPointerCapture(e.pointerId);

    // indicadores de seta (funcionam direto no hover, sem precisar selecionar antes)
    const hEdge = (eh || segEl || wpEl || vpEl)?.dataset.edge;
    if (hEdge) {
      if (!this.sel.edges.has(hEdge) || this.sel.nodes.size || this.sel.edges.size > 1) this.sel = { nodes: new Set(), edges: new Set([hEdge]) };
      const base = { eid: hEdge, start: p, moved: false };
      if (eh) this.drag = { ...base, mode: 'endpoint', which: eh.dataset.ehandle === '1' ? 1 : 2 };
      else if (segEl) this.drag = { ...base, mode: 'seg', idx: Number(segEl.dataset.seg), pts: routeEdge(this.model, this.edge(hEdge)) };
      else if (wpEl) this.drag = { ...base, mode: 'wp', idx: Number(wpEl.dataset.wp) };
      else this.drag = { ...base, mode: 'vp', idx: Number(vpEl.dataset.vp) };
      this.renderSel();
      return;
    }
    if (handle) {
      const n = this.node([...this.sel.nodes][0]);
      this.drag = { mode: 'resize', id: n.id, handle: handle.dataset.handle, orig: { x: n.x, y: n.y, w: n.w, h: n.h }, start: p, snapped: false };
      return;
    }
    if (port) {
      const n = this.node(port.dataset.node);
      const origin = portsOf(n)[port.dataset.port];
      this.drag = { mode: 'connect', from: n.id, port: port.dataset.port, origin, cur: p, sx: e.clientX, sy: e.clientY, dragged: false };
      this.renderSel();
      return;
    }
    if (ng) {
      const id = ng.dataset.id;
      if (e.shiftKey) { this.sel.nodes.has(id) ? this.sel.nodes.delete(id) : this.sel.nodes.add(id); }
      else if (!this.sel.nodes.has(id)) this.sel = { nodes: new Set([id]), edges: new Set() };
      this.startMove(p);
      this.renderSel();
      return;
    }
    if (eg) {
      const id = eg.dataset.eid;
      if (e.shiftKey) { this.sel.edges.has(id) ? this.sel.edges.delete(id) : this.sel.edges.add(id); }
      else if (!this.sel.edges.has(id)) this.sel = { nodes: new Set(), edges: new Set([id]) };
      // arrastar o corpo da linha: move a linha inteira (pontas soltas) ou muda o formato (pontas ligadas)
      if (!this.sel.nodes.size && this.sel.edges.size === 1) this.drag = { mode: 'ebody', eid: id, start: p, moved: false };
      else this.startMove(p);
      this.renderSel();
      return;
    }
    if (!e.shiftKey) this.sel = { nodes: new Set(), edges: new Set() };
    this.drag = { mode: 'marquee', start: p, cur: p, additive: e.shiftKey };
    this.renderSel();
  }
  startMove(p) {
    // contêiner leva junto os blocos que estão dentro dele
    const ids = new Set(this.sel.nodes);
    for (const id of this.sel.nodes) {
      const c = this.node(id);
      if (c?.shape !== 'container') continue;
      this.model.nodes.forEach((n) => { if (n !== c && n.x >= c.x && n.y >= c.y && n.x + n.w <= c.x + c.w && n.y + n.h <= c.y + c.h) ids.add(n.id); });
    }
    const orig = new Map([...ids].map((id) => { const n = this.node(id); return [id, { x: n.x, y: n.y }]; }));
    // setas selecionadas e setas entre blocos que se movem juntos levam as dobras e as pontas soltas junto
    const free = new Map(this.model.edges
      .filter((e) => this.sel.edges.has(e.id) || (e.from && e.to && ids.has(e.from) && ids.has(e.to)))
      .map((e) => [e.id, { p1: e.p1 && [...e.p1], p2: e.p2 && [...e.p2], pts: waypoints(e).map((q) => [...q]) }]));
    this.drag = { mode: 'move', start: p, orig, free, moved: false };
  }
  onMove(e) {
    const p = this.pt(e);
    const d = this.drag;
    if (!d) {
      // âncoras de conexão: aparecem sobre o bloco e continuam visíveis enquanto o mouse vai até elas
      const ng = e.target.closest('g.vn, [data-port]');
      let id = ng ? (ng.dataset.id || ng.dataset.node) : null;
      const keep = (nid) => { const n = this.node(nid), m = 30 / this.z; return n && p.x >= n.x - m && p.x <= n.x + n.w + m && p.y >= n.y - m && p.y <= n.y + n.h + m; };
      if (e.target.closest('[data-handle]') || (this.hover && this.node(id)?.shape === 'container' && keep(this.hover))) id = this.hover;
      if (!id && this.hover && keep(this.hover)) id = this.hover;
      // seta sob o mouse: mostra os indicadores dela (pontas, trechos, dobras)
      const eg = e.target.closest('g.ve, [data-edge]');
      const eid = eg ? (eg.dataset.eid || eg.dataset.edge) : null;
      if (eid) id = null;
      if (id !== this.hover || eid !== this.hoverEdge) { this.hover = id; this.hoverEdge = eid; this.laterSel(); }
      return;
    }
    if (d.mode === 'pan') {
      this.scroll.scrollLeft = d.sl - (e.clientX - d.sx);
      this.scroll.scrollTop = d.st - (e.clientY - d.sy);
      return;
    }
    if (d.mode === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * this.z < 4) return;
      if (!d.moved) { this.snapshot(); d.moved = true; }
      const first = d.orig.values().next().value;
      if (first && !e.altKey) { dx = this.snap(first.x + dx) - first.x; dy = this.snap(first.y + dy) - first.y; }
      // guias de alinhamento (linhas rosa do draw.io): encaixa centros e bordas nos outros blocos
      d.guides = [];
      if (d.orig.size && !e.altKey) {
        const ids = [...d.orig.keys()];
        const box = ids.map((id) => { const o = d.orig.get(id), n = this.node(id); return { x: o.x + dx, y: o.y + dy, w: n.w, h: n.h }; })
          .reduce((A, B) => { const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y); return { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y }; });
        const tol = 7 / this.z;
        const others = this.model.nodes.filter((n) => !d.orig.has(n.id) && n.shape !== 'container');
        let bx = null, by = null;
        const xsMe = [box.x, box.x + box.w / 2, box.x + box.w], ysMe = [box.y, box.y + box.h / 2, box.y + box.h];
        for (const o of others) {
          const xs = [o.x, o.x + o.w / 2, o.x + o.w], ys = [o.y, o.y + o.h / 2, o.y + o.h];
          xsMe.forEach((mx, i) => { const ox = xs[i === 1 ? 1 : i]; const diff = ox - mx; if (Math.abs(diff) <= tol && (!bx || Math.abs(diff) < Math.abs(bx.diff))) bx = { diff, at: ox, o }; });
          ysMe.forEach((my, i) => { const oy = ys[i === 1 ? 1 : i]; const diff = oy - my; if (Math.abs(diff) <= tol && (!by || Math.abs(diff) < Math.abs(by.diff))) by = { diff, at: oy, o }; });
        }
        if (bx) { dx += bx.diff; d.guides.push({ v: bx.at, a: Math.min(bx.o.y, box.y) - 10, b: Math.max(bx.o.y + bx.o.h, box.y + box.h) + 10 }); }
        if (by) { dy += by.diff; d.guides.push({ h: by.at, a: Math.min(by.o.x, box.x) - 10, b: Math.max(by.o.x + by.o.w, box.x + box.w) + 10 }); }
      }
      for (const [id, o] of d.orig) { const n = this.node(id); n.x = o.x + dx; n.y = o.y + dy; }
      for (const [id, o] of d.free) {
        const ed = this.edge(id);
        if (o.p1 && !ed.from) ed.p1 = [o.p1[0] + dx, o.p1[1] + dy];
        if (o.p2 && !ed.to) ed.p2 = [o.p2[0] + dx, o.p2[1] + dy];
        if (o.pts.length) { ed.points = o.pts.map(([x, y]) => [x + dx, y + dy]); delete ed.via; }
      }
      this.later();
      return;
    }
    if (['ebody', 'translate', 'seg', 'wp', 'vp', 'endpoint'].includes(d.mode)) return this.moveEdgeDrag(d, p, e);
    if (d.mode === 'resize') {
      if (!d.snapped) { this.snapshot(); d.snapped = true; }
      const n = this.node(d.id), o = d.orig, h = d.handle;
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      let { x, y, w, h: hh } = o;
      if (h.includes('e')) w = o.w + dx;
      if (h.includes('s')) hh = o.h + dy;
      if (h.includes('w')) { x = o.x + dx; w = o.w - dx; }
      if (h.includes('n')) { y = o.y + dy; hh = o.h - dy; }
      if (!e.altKey) {
        if (h.includes('w')) { const nx = this.snap(x); w += x - nx; x = nx; } else w = this.snap(x + w) - x;
        if (h.includes('n')) { const ny = this.snap(y); hh += y - ny; y = ny; } else hh = this.snap(y + hh) - y;
      }
      if (w < 20) { if (h.includes('w')) x -= 20 - w; w = 20; }
      if (hh < 20) { if (h.includes('n')) y -= 20 - hh; hh = 20; }
      Object.assign(n, { x, y, w, h: hh });
      this.later();
      return;
    }
    if (d.mode === 'connect') {
      d.cur = p;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.dragged = true;
      const t = this.attachTarget(p.x, p.y, d.from, e.altKey);
      d.target = t?.id || null;
      this.hover = d.target;
      this.laterSel();
      return;
    }
    if (d.mode === 'marquee') { d.cur = p; this.laterSel(); }
  }
  /** Arrastos de seta: pontas livres, trechos (formato em L/Z/U), dobras e a linha inteira */
  moveEdgeDrag(d, p, ev) {
    const ed = this.edge(d.eid);
    if (!ed) return;
    if (!d.moved) {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.z < 4) return;
      this.snapshot();
      d.moved = true;
      if (d.mode === 'ebody') {
        if (!ed.from || !ed.to) {
          d.mode = 'translate';
          d.orig = { p1: ed.p1 && [...ed.p1], p2: ed.p2 && [...ed.p2], pts: waypoints(ed).map((q) => [...q]) };
        } else if (ed.kind === 'orth') {
          d.mode = 'seg';
          d.pts = routeEdge(this.model, ed);
          d.idx = nearestSeg(d.pts, d.start);
        } else {
          d.mode = 'vp';
          d.idx = nearestSeg([routeEdge(this.model, ed)[0], ...waypoints(ed), routeEdge(this.model, ed).at(-1)], d.start);
        }
      }
      if (d.mode === 'vp') {
        const wps = waypoints(ed).map((q) => [...q]);
        wps.splice(d.idx, 0, [p.x, p.y]);
        ed.points = wps; delete ed.via;
        d.mode = 'wp';
      }
    }
    const snapOn = !ev.altKey;
    const sx = this.snap(p.x, snapOn), sy = this.snap(p.y, snapOn);
    if (d.mode === 'translate') {
      const dx = sx - this.snap(d.start.x, snapOn), dy = sy - this.snap(d.start.y, snapOn);
      if (!ed.from && d.orig.p1) ed.p1 = [d.orig.p1[0] + dx, d.orig.p1[1] + dy];
      if (!ed.to && d.orig.p2) ed.p2 = [d.orig.p2[0] + dx, d.orig.p2[1] + dy];
      if (d.orig.pts.length) ed.points = d.orig.pts.map(([x, y]) => [x + dx, y + dy]);
    } else if (d.mode === 'wp') {
      const wps = waypoints(ed).map((q) => [...q]);
      wps[d.idx] = [sx, sy];
      ed.points = wps; delete ed.via;
    } else if (d.mode === 'seg') {
      const pts = d.pts.map((q) => [...q]);
      let i = d.idx;
      // trecho da ponta: cria um trecho novo para a ponta continuar presa ao bloco
      if (i === 0) { pts.unshift([...pts[0]]); i = 1; }
      if (i === pts.length - 2) pts.push([...pts[pts.length - 1]]);
      const horizontal = Math.abs(pts[i][1] - pts[i + 1][1]) < 0.5;
      if (horizontal) { pts[i][1] = sy; pts[i + 1][1] = sy; } else { pts[i][0] = sx; pts[i + 1][0] = sx; }
      ed.points = pts.slice(1, -1); delete ed.via;
    } else if (d.mode === 'endpoint') {
      // a ponta segue o mouse; liga só se estiver sobre um bloco ou perto de uma âncora — senão fica SOLTA
      const other = d.which === 1 ? ed.to : ed.from;
      const t = this.attachTarget(p.x, p.y, other, ev.altKey);
      d.cur = p; d.target = t?.id || null;
      if (d.which === 1) {
        if (t) { ed.from = t.id; ed.fromPort = nearestPort(t, p.x, p.y); delete ed.p1; } else { ed.from = null; delete ed.fromPort; ed.p1 = [sx, sy]; }
      } else if (t) { ed.to = t.id; ed.toPort = nearestPort(t, p.x, p.y); delete ed.p2; } else { ed.to = null; delete ed.toPort; ed.p2 = [sx, sy]; }
    }
    this.later();
  }
  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const p = this.pt(e);
    if (d.mode === 'connect') {
      const t = this.attachTarget(p.x, p.y, d.from, e.altKey);
      const dist = Math.hypot(p.x - d.origin[0], p.y - d.origin[1]);
      // clique sem arrastar (em qualquer zoom): cria o próximo bloco já ligado
      if (!d.dragged) { this.quickAdd(d.from, d.port); return; }
      if (t || dist > 0) {
        this.snapshot();
        const from = this.node(d.from);
        let label = '';
        if (from.shape === 'diamond') {
          const names = this.model.edges.filter((x) => x.from === from.id).map((x) => (x.label || '').toLowerCase());
          label = !names.includes('sim') ? 'Sim' : !names.includes('não') ? 'Não' : '';
        }
        const ed = { id: this.newId('e'), from: d.from, fromPort: d.port, label, kind: 'orth', arrowEnd: true, stroke: this.defaults.line };
        if (t) { ed.to = t.id; ed.toPort = nearestPort(t, p.x, p.y); } else ed.p2 = [this.snap(p.x), this.snap(p.y)];
        this.model.edges.push(ed);
        this.sel = { nodes: new Set(), edges: new Set([ed.id]) };
      }
    } else if (d.mode === 'marquee') {
      const x0 = Math.min(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y), x1 = Math.max(d.start.x, d.cur.x), y1 = Math.max(d.start.y, d.cur.y);
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        this.model.nodes.forEach((n) => { if (n.x >= x0 && n.y >= y0 && n.x + n.w <= x1 && n.y + n.h <= y1) this.sel.nodes.add(n.id); });
        this.model.edges.forEach((ed) => { if (routeEdge(this.model, ed).every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) this.sel.edges.add(ed.id); });
      }
    }
    const changed = d.moved || (d.mode === 'resize' && d.snapped) || d.mode === 'connect';
    if (changed) this.render(); else this.renderSel();
  }
  onKey(e) {
    if (!this.host.isConnected || this.host.closest('[hidden]')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (typing) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space' && !this.space) { this.space = true; this.scroll.classList.add('ve-pan'); e.preventDefault(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSelection(); }
    else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    else if (mod && k === 'd') { e.preventDefault(); this.duplicate(); }
    else if (mod && k === 'c') { this.copy(); }
    else if (mod && k === 'x') { e.preventDefault(); if (this.copy()) this.deleteSelection(); }
    else if (mod && k === 'v') { e.preventDefault(); this.paste(); }
    else if (mod && k === 'a') { e.preventDefault(); this.selectAll(); }
    else if (k === 'escape' && this.menu) this.closeMenu();
    else if (k === 'escape') { this.sel = { nodes: new Set(), edges: new Set() }; this.renderSel(); }
    else if ((k === 'enter' || k === 'f2') && this.sel.nodes.size === 1) { e.preventDefault(); this.editText([...this.sel.nodes][0]); }
    else if (k.startsWith('arrow') && this.sel.nodes.size) {
      e.preventDefault();
      const s = e.shiftKey ? GRID : 1;
      this.nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0);
    }
  }

  // ------------------------------------------------------------ barra de formatação
  renderFormat() {
    const nN = this.sel.nodes.size, nE = this.sel.edges.size;
    const sw = (cmd, colors, cur) => colors.map((c) => `<button class="ve-sw${c === cur ? ' on' : ''}" data-cmd="${cmd}" data-val="${c}" title="${c === 'none' ? 'Sem cor' : c}" style="${c === 'none' ? '' : `background:${c}`}">${c === 'none' ? '⌀' : ''}</button>`).join('');
    const btn = (cmd, label, val = '', on = false, title = '') => `<button class="ve-fbtn${on ? ' on' : ''}" data-cmd="${cmd}" data-val="${val}" title="${esc(title || label)}">${label}</button>`;
    const FILLS = ['#ffffff', '#f5f5f5', '#d9d9d9', '#dae8fc', '#d5e8d4', '#fff2cc', '#f8cecc', '#e1d5e7', 'none'];
    const LINESC = ['#333333', '#7f7f7f', '#6c8ebf', '#82b366', '#d6b656', '#b85450', '#9673a6'];
    let html;
    if (!nN && !nE) {
      html = `<span class="ve-tip"><b>Dicas:</b> arraste formas da esquerda · <b>clique duplo</b> edita textos · puxe as <b class="blue">bolinhas azuis</b> para ligar (ou clique nelas para criar o próximo bloco) · passe o mouse numa <b>seta</b> para mover as pontas e mudar o formato · <b>botão direito</b> abre o menu · <b>Delete</b> exclui · <b>Ctrl+Z</b> desfaz · <b>Espaço + arrastar</b> move a tela</span>`;
    } else if (nN) {
      const n = this.node([...this.sel.nodes][0]);
      html = `
        <div class="ve-fgroup"><span>Preenchimento</span>${sw('fill', FILLS, n?.fill)}</div>
        <div class="ve-fgroup"><span>Borda</span>${sw('stroke', LINESC, n?.stroke)}${btn('ndash', '┄', '', !!n?.dashed, 'Borda tracejada')}</div>
        <div class="ve-fgroup"><span>Texto</span>${btn('font', 'A−', '-1', false, 'Diminuir texto')}${btn('font', 'A+', '1', false, 'Aumentar texto')}${btn('bold', '<b>N</b>', '', !!n?.bold, 'Negrito')}${btn('align', '⯇', 'left', n?.align === 'left', 'Alinhar à esquerda')}${btn('align', '≡', 'center', !n?.align || n?.align === 'center', 'Centralizar')}${btn('tcolor', '<span style="color:#b85450">A</span>', '#b85450', false, 'Texto vermelho')}${btn('tcolor', 'A', '#1a1a1a', false, 'Texto preto')}</div>
        <div class="ve-fgroup">${btn('front', 'Trazer à frente')}${btn('back', 'Enviar para trás')}${btn('dup', 'Duplicar')}${btn('edit', 'Editar texto')}${btn('del', 'Excluir', '', false, 'Excluir (Delete)')}</div>`;
    } else {
      const e = this.edge([...this.sel.edges][0]);
      html = `
        <div class="ve-fgroup"><span>Cor</span>${sw('estroke', LINESC, e?.stroke)}</div>
        <div class="ve-fgroup"><span>Linha</span>${btn('estyle', '──', 'solid', !e?.dashed && !e?.dotted, 'Contínua')}${btn('estyle', '╌╌', 'dashed', !!e?.dashed, 'Tracejada')}${btn('estyle', '┈┈', 'dotted', !!e?.dotted, 'Pontilhada')}${btn('ewidth', 'Fina', '1.5', (e?.width || 1.5) === 1.5)}${btn('ewidth', 'Grossa', '3', e?.width === 3)}</div>
        <div class="ve-fgroup"><span>Traçado</span>${btn('ekind', '⌐ Ângulo', 'orth', e?.kind === 'orth')}${btn('ekind', '╱ Reta', 'straight', e?.kind === 'straight')}${btn('ekind', '◠ Curva', 'curve', e?.kind === 'curve')}</div>
        <div class="ve-fgroup"><span>Setas</span>${btn('earrow', '→', 'end', e?.arrowEnd !== false && !e?.arrowStart)}${btn('earrow', '↔', 'both', !!e?.arrowStart && e?.arrowEnd !== false)}${btn('earrow', '—', 'none', e?.arrowEnd === false && !e?.arrowStart)}</div>
        <div class="ve-fgroup">${btn('elabel', 'Editar rótulo')}${btn('del', 'Excluir', '', false, 'Excluir (Delete)')}</div>`;
    }
    if (this.formatEl.dataset.html !== html) { this.formatEl.innerHTML = html; this.formatEl.dataset.html = html; }
  }
  cmd(c, v) {
    const first = this.node([...this.sel.nodes][0]);
    switch (c) {
      case 'fill': return this.setNodes({ fill: v === 'none' ? 'transparent' : v });
      case 'stroke': return this.setNodes({ stroke: v });
      case 'ndash': return this.setNodes({ dashed: !first?.dashed });
      case 'font': return this.setNodes((n) => ({ fontSize: Math.min(40, Math.max(8, (n.fontSize || 14) + Number(v) * 2)) }));
      case 'bold': return this.setNodes({ bold: !first?.bold });
      case 'align': return this.setNodes({ align: v });
      case 'tcolor': return this.setNodes({ color: v });
      case 'front': return this.order(true);
      case 'back': return this.order(false);
      case 'dup': return this.duplicate();
      case 'edit': return first && this.editText(first.id);
      case 'del': return this.deleteSelection();
      case 'estroke': return this.setEdges({ stroke: v });
      case 'estyle': return this.setEdges({ dashed: v === 'dashed', dotted: v === 'dotted' });
      case 'ewidth': return this.setEdges({ width: Number(v) });
      case 'ekind': return this.setEdges({ kind: v });
      case 'earrow': return this.setEdges({ arrowEnd: v !== 'none', arrowStart: v === 'both' });
      case 'elabel': { const id = [...this.sel.edges][0]; return id && this.editText(id, true); }
    }
  }
}
