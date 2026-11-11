/* Saídas laterais nos losangos de decisão
 *
 * O Mermaid (dagre) não permite escolher por qual ponta do losango uma seta sai.
 * Depois de renderizar, este módulo redesenha as setas que saem de cada decisão:
 *   - saídas pelas pontas ESQUERDA e DIREITA do losango (padrão de fluxograma),
 *   - rotas ortogonais (horizontal → vertical), sem diagonais cruzando o desenho,
 *   - rótulos (Sim / Não) reposicionados junto à ponta de saída.
 * Funciona nas orientações vertical (TD/TB) e horizontal (LR).
 */

const NS = 'http://www.w3.org/2000/svg';

function toLocal(el, x, y) {
  const m = el.getScreenCTM();
  if (!m) return { x, y };
  const p = new DOMPoint(x, y).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
function toScreen(el, x, y) {
  const m = el.getScreenCTM();
  const p = new DOMPoint(x, y).matrixTransform(m);
  return { x: p.x, y: p.y };
}
/** Grava a rota de uma seta: pontos medidos no sistema do SVG inteiro, convertidos para o da seta
 *  (blocos dentro de blocos têm sistemas de coordenadas próprios) */
function setPath(svg, path, xy) {
  const pts = xy.map((p) => { const s = toScreen(svg, p.x, p.y); return toLocal(path, s.x, s.y); });
  path.setAttribute('d', 'M' + pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L'));
}

/** Caixa de um elemento nas coordenadas locais de `ref` */
function boxIn(ref, el) {
  const r = el.getBoundingClientRect();
  const pts = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => toLocal(ref, x, y));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2; b.w = b.x1 - b.x0; b.h = b.y1 - b.y0;
  return b;
}

/**
 * @param {SVGSVGElement} svg       SVG já inserido no documento
 * @param {string[]} nodeIds        IDs de todos os nós
 * @param {Set<string>} decisionIds IDs dos nós de decisão
 * @param {string} direction        TD | TB | LR
 * @returns {number} quantidade de setas redesenhadas
 */
export function routeDecisionEdges(svg, nodeIds, decisionIds, direction = 'TD') {
  if (!svg || !decisionIds.size) return 0;
  const vertical = direction === 'TD' || direction === 'TB';
  if (!vertical && direction !== 'LR') return 0;

  // nós do SVG por ID do Mermaid
  const nodeEl = new Map();
  for (const g of svg.querySelectorAll('g.node')) {
    const m = /-flowchart-(.+)-\d+$/.exec(g.id);
    if (m) nodeEl.set(m[1], g);
  }
  const ids = [...nodeIds].sort((a, b) => b.length - a.length);
  const parseEdge = (dataId) => {
    const s = dataId.replace(/^L_/, '');
    for (const from of ids) {
      if (!s.startsWith(from + '_')) continue;
      const to = s.slice(from.length + 1).replace(/_\d+$/, '');
      if (nodeIds.has(to)) return { from, to };
    }
    return null;
  };

  // agrupa as setas que saem de cada decisão
  const byDecision = new Map();
  for (const path of svg.querySelectorAll('path[data-id^="L_"]')) {
    const e = parseEdge(path.dataset.id);
    if (!e || !decisionIds.has(e.from) || !nodeEl.has(e.to) || e.from === e.to) continue;
    if (!byDecision.has(e.from)) byDecision.set(e.from, []);
    byDecision.get(e.from).push({ ...e, path });
  }

  // coordenadas no "eixo do fluxo": u = sentido do fluxo, v = eixo transversal
  const U = vertical ? (p) => p.y : (p) => p.x;
  const V = vertical ? (p) => p.x : (p) => p.y;
  const XY = vertical ? (u, v) => ({ x: v, y: u }) : (u, v) => ({ x: u, y: v });
  const flowBox = (b) => vertical
    ? { u0: b.y0, u1: b.y1, v0: b.x0, v1: b.x1, cu: b.cy, cv: b.cx, span: b.w }
    : { u0: b.x0, u1: b.x1, v0: b.y0, v1: b.y1, cu: b.cx, cv: b.cy, span: b.h };

  // caixas de todos os nós (para desviar de obstáculos)
  if (!svg.querySelector('path[data-id^="L_"]')) return 0;
  const allBoxes = [...nodeEl].map(([id, el]) => ({ id, ...flowBox(boxIn(svg, el)) }));
  const NEG = /^(n[aã]o|erro|falha|reprovad|rejeitad|inv[aá]lid|negad|incorret|pendente)/i;

  let count = 0;
  for (const [dId, edges] of byDecision) {
    const ref = svg;   // tudo medido no sistema do SVG inteiro
    const shape = nodeEl.get(dId).querySelector('polygon') || nodeEl.get(dId);
    const d = flowBox(boxIn(ref, shape));
    const tips = {
      neg: { u: d.cu, v: d.v0 },     // esquerda (TD) / topo (LR)
      pos: { u: d.cu, v: d.v1 },     // direita (TD) / base (LR)
      fwd: { u: d.u1, v: d.cv },     // base (TD) / direita (LR)
    };
    const items = edges.map((e) => {
      const label = svg.querySelector(`.edgeLabel .label[data-id="${e.path.dataset.id}"]`)?.closest('.edgeLabel');
      const text = label?.textContent.trim() || '';
      const lb = label?.getBoundingClientRect();
      const lw = lb ? toLocal(ref, lb.right, lb.bottom).x - toLocal(ref, lb.left, lb.top).x : 0;
      return { ...e, t: flowBox(boxIn(ref, nodeEl.get(e.to))), label: text ? label : null, text, lsize: vertical ? Math.abs(lw) : 18 };
    }).sort((a, b) => a.t.cv - b.t.cv);

    const others = (it) => allBoxes.filter((b) => b.id !== dId && b.id !== it.to);
    const crossesV = (obs, v, u0, u1) => obs.filter((b) => v > b.v0 - 8 && v < b.v1 + 8 && b.u1 > Math.min(u0, u1) && b.u0 < Math.max(u0, u1));
    const crossesU = (obs, u, v0, v1) => obs.filter((b) => u > b.u0 - 6 && u < b.u1 + 6 && b.v1 > Math.min(v0, v1) && b.v0 < Math.max(v0, v1));
    const centered = (it) => Math.abs(it.t.cv - d.cv) < d.span * 0.25;
    const fwdClear = (it) => it.t.u0 > d.u1 && !crossesV(others(it), d.cv, d.u1, it.t.u0).length && Math.abs(it.t.cv - d.cv) < d.span * 0.25;

    // ponta de saída: laterais por padrão; destino logo abaixo e livre pode sair pela base (padrão clássico)
    if (items.length === 1) {
      const it = items[0];
      it.side = fwdClear(it) ? 'fwd' : (it.t.cv < d.cv ? 'neg' : 'pos');
    } else if (items.length === 2) {
      let [a, b] = items;
      if (Math.abs(a.t.cv - b.t.cv) < 12) {
        const aNeg = NEG.test(a.text), bNeg = NEG.test(b.text);
        if (bNeg && !aNeg) [a, b] = [b, a];
        else if (!aNeg && !bNeg && a.t.u0 < b.t.u0) [a, b] = [b, a];
      }
      if (centered(b) && !centered(a) && fwdClear(b)) { a.side = 'neg'; b.side = 'fwd'; }
      else if (centered(a) && !centered(b) && fwdClear(a)) { a.side = 'fwd'; b.side = 'pos'; }
      else { a.side = 'neg'; b.side = 'pos'; }
    } else {
      items.forEach((it, i) => (it.side = i === 0 ? 'neg' : i === items.length - 1 ? 'pos' : 'fwd'));
    }

    const gap = 3;
    for (const it of items) {
      const t = it.t;
      const obs = others(it);
      const side = it.side;
      let pts;
      if (side === 'fwd') {
        const tip = tips.fwd;
        const mid = (tip.u + t.u0) / 2;
        const blocked = crossesV(obs, tip.v, tip.u, Math.abs(t.cv - tip.v) < 2 ? t.u0 : mid).length
          || (Math.abs(t.cv - tip.v) >= 2 && (crossesU(obs, mid, tip.v, t.cv).length || crossesV(obs, t.cv, mid, t.u0).length));
        if (!blocked) {
          pts = Math.abs(t.cv - tip.v) < 2 ? [tip, { u: t.u0 - gap, v: tip.v }]
            : [tip, { u: mid, v: tip.v }, { u: mid, v: t.cv }, { u: t.u0 - gap, v: t.cv }];
        } else {
          // caminho reto bloqueado (ex.: 3ª saída do losango): desvia por uma coluna livre
          const dir = t.cv >= d.cv ? 1 : -1;
          const step = tip.u + 18;
          const enter = t.u0 - 22;
          let col = dir > 0 ? Math.max(d.v1, t.v1) + 30 : Math.min(d.v0, t.v0) - 30;
          for (let n = 0; n < 12; n++) {
            const hit = crossesV(obs, col, step, enter);
            if (!hit.length) break;
            col = dir > 0 ? Math.max(...hit.map((b) => b.v1)) + 24 : Math.min(...hit.map((b) => b.v0)) - 24;
          }
          pts = [tip, { u: step, v: tip.v }, { u: step, v: col }, { u: enter, v: col }, { u: enter, v: t.cv }, { u: t.u0 - gap, v: t.cv }];
        }
      } else {
        const tip = tips[side];
        const dir = side === 'neg' ? -1 : 1;
        const ahead = t.u0 > tip.u + 4;
        const minRun = it.lsize + 22;                       // espaço para o rótulo na saída
        // empurra uma coluna vertical para fora só enquanto ela cortar algum bloco
        const pushOut = (v, u0, u1) => {
          for (let n = 0; n < 12; n++) {
            const hit = crossesV(obs, v, u0, u1);
            if (!hit.length) break;
            v = dir > 0 ? Math.max(...hit.map((b) => b.v1)) + 22 : Math.min(...hit.map((b) => b.v0)) - 22;
          }
          return v;
        };
        if (tip.u > t.u0 + 2 && tip.u < t.u1 - 2 && dir * (t.cv - tip.v) > 0) {
          // bloco ao lado do losango, na mesma altura: linha reta até a lateral dele
          pts = [tip, { u: tip.u, v: dir > 0 ? t.v0 - gap : t.v1 + gap }];
        } else if (ahead && dir * (t.cv - tip.v) >= minRun && !crossesU(obs, tip.u, tip.v, t.cv).length && !crossesV(obs, t.cv, tip.u, t.u0).length) {
          // L: sai pela ponta, segue reto até a coluna do destino e desce
          pts = [tip, { u: tip.u, v: t.cv }, { u: t.u0 - gap, v: t.cv }];
        } else if (ahead) {
          // Z local: sai pela ponta, desce ao lado do losango e entra por cima do destino
          const mid = Math.max(d.u1 + 16, t.u0 - 22);
          const col = pushOut(tip.v + dir * minRun, tip.u, mid);
          // coluna já cai dentro do destino: desce reto, sem "degrau"
          const snap = col > t.v0 + 14 && col < t.v1 - 14 && Math.abs(col - t.cv) < t.span / 2 - 14;
          pts = snap ? [tip, { u: tip.u, v: col }, { u: t.u0 - gap, v: col }]
            : Math.abs(col - t.cv) < 16 ? [tip, { u: tip.u, v: t.cv }, { u: t.u0 - gap, v: t.cv }]
            : [tip, { u: tip.u, v: col }, { u: mid, v: col }, { u: mid, v: t.cv }, { u: t.u0 - gap, v: t.cv }];
        } else {
          // retorno (destino acima): contorna pelo lado e entra pela lateral do destino
          const uA = Math.min(tip.u, t.cu), uB = Math.max(tip.u, t.cu);
          let col = dir > 0 ? Math.max(tip.v + minRun, t.v1 + 24) : Math.min(tip.v - minRun, t.v0 - 24);
          col = pushOut(col, uA, uB);
          pts = [tip, { u: tip.u, v: col }, { u: t.cu, v: col }, { u: t.cu, v: dir > 0 ? t.v1 + gap : t.v0 - gap }];
        }
      }
      it.side = side;

      const xy = pts.map((p) => XY(p.u, p.v));
      setPath(svg, it.path, xy);
      it.path.removeAttribute('data-points');
      count++;

      // rótulo (Sim / Não) no primeiro trecho, junto à ponta do losango
      if (!it.label) continue;
      const tip = pts[0];
      let lp;
      if (side === 'fwd') lp = { u: tip.u + 16, v: tip.v };
      else {
        const dir = side === 'neg' ? -1 : 1;
        lp = { u: tip.u, v: tip.v + dir * (it.lsize / 2 + 10) };
      }
      const p = XY(lp.u, lp.v);
      const scr = toScreen(ref, p.x, p.y);
      const loc = toLocal(it.label.parentNode, scr.x, scr.y);
      it.label.setAttribute('transform', `translate(${loc.x.toFixed(2)}, ${loc.y.toFixed(2)})`);
    }
  }
  return count;
}

/** Ajusta o viewBox ao desenho final (amplia rotas que saíram da área e corta espaços vazios) */
function fitViewBox(svg) {
  const vb = svg.viewBox.baseVal;
  if (!vb || !vb.width) return;
  const m = svg.getScreenCTM();
  if (!m) return;
  const inv = m.inverse();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of svg.querySelectorAll('path[data-id^="L_"], .edgeLabel, g.node, g.cluster rect, .cluster-label')) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    for (const [sx, sy] of [[r.left, r.top], [r.right, r.bottom]]) {
      const p = new DOMPoint(sx, sy).matrixTransform(inv);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  if (!isFinite(x0)) return;
  const pad = 24;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  if (svg.hasAttribute('width')) svg.setAttribute('width', x1 - x0);
  if (svg.hasAttribute('height')) svg.setAttribute('height', y1 - y0);
}

// ===================================================================== padrão dos modelos
/* Os fluxogramas-modelo seguem uma "coluna central": cada losango abre ramos curtos para os lados,
 * na MESMA ALTURA do losango, que depois descem e entram pela lateral do próximo passo da coluna.
 * O dagre (layout do Mermaid) coloca esses ramos um nível abaixo; aqui eles são reposicionados. */

function flowOf(vertical) {
  return {
    fb: (b) => vertical
      ? { u0: b.y0, u1: b.y1, v0: b.x0, v1: b.x1, cu: b.cy, cv: b.cx, span: b.w, len: b.h }
      : { u0: b.x0, u1: b.x1, v0: b.y0, v1: b.y1, cu: b.cx, cv: b.cy, span: b.h, len: b.w },
    XY: vertical ? (u, v) => ({ x: v, y: u }) : (u, v) => ({ x: u, y: v }),
  };
}

function collect(svg, nodeIds) {
  const nodeEl = new Map();
  for (const g of svg.querySelectorAll('g.node')) {
    const m = /-flowchart-(.+)-\d+$/.exec(g.id);
    if (m) nodeEl.set(m[1], g);
  }
  const ids = [...nodeIds].sort((a, b) => b.length - a.length);
  const edges = [];
  for (const path of svg.querySelectorAll('path[data-id^="L_"]')) {
    const s = path.dataset.id.replace(/^L_/, '');
    for (const from of ids) {
      if (!s.startsWith(from + '_')) continue;
      const to = s.slice(from.length + 1).replace(/_\d+$/, '');
      if (nodeIds.has(to) && nodeEl.has(from) && nodeEl.has(to)) {
        const label = svg.querySelector(`.edgeLabel .label[data-id="${path.dataset.id}"]`)?.closest('.edgeLabel');
        edges.push({ from, to, path, label: label && label.textContent.trim() ? label : null, text: label?.textContent.trim() || '' });
        break;
      }
    }
  }
  const out = new Map(), inn = new Map();
  for (const id of nodeEl.keys()) { out.set(id, []); inn.set(id, []); }
  for (const e of edges) { out.get(e.from).push(e); inn.get(e.to).push(e); }
  return { nodeEl, edges, out, inn, ref: edges.length ? svg : null };
}

function moveNode(g, dx, dy) {
  const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(g.getAttribute('transform') || '');
  const x = m ? parseFloat(m[1]) : 0, y = m ? parseFloat(m[2]) : 0;
  g.setAttribute('transform', `translate(${(x + dx).toFixed(2)}, ${(y + dy).toFixed(2)})`);
}

/** Ramos de decisão vão para os lados do losango, na mesma altura */
function liftBranches(svg, G, decisionIds, vertical) {
  const { nodeEl, out, inn, ref } = G;
  const { fb } = flowOf(vertical);
  const NEG = /^(n[aã]o|erro|falha|reprovad|rejeitad|inv[aá]lid|negad)/i;
  const box = (id) => fb(boxIn(ref, nodeEl.get(id)));
  const placed = new Map();   // id → nova caixa (para checar sobreposição entre levantados)
  const moved = [];
  const clusters = [...svg.querySelectorAll('g.cluster rect')].map((r) => fb(boxIn(ref, r)));
  const inside = (c, u, v) => u > c.u0 && u < c.u1 && v > c.v0 && v < c.v1;

  for (const d of decisionIds) {
    if (!nodeEl.has(d)) continue;
    const outs = out.get(d) || [];
    if (outs.length !== 2) continue;
    const D = fb(boxIn(ref, nodeEl.get(d).querySelector('polygon') || nodeEl.get(d)));
    // candidato: só recebe desta decisão, tem uma única saída, não é decisão e fica abaixo
    const ok = (e) => !decisionIds.has(e.to) && inn.get(e.to).length === 1 && out.get(e.to).length === 1
      && out.get(e.to)[0].to !== d && box(e.to).u0 > D.cu;
    // só leva para o lado quando os dois ramos voltam ao MESMO passo (ou terminam): mantém a coluna central
    const succ = (id) => (out.get(id) || []).length === 1 ? out.get(id)[0].to : null;
    const isEnd = (id) => (out.get(id) || []).length === 0;
    const rejoins = (e) => {
      const other = outs.find((x) => x !== e);
      const M = succ(e.to);
      return M && (M === other.to || M === succ(other.to) || (isEnd(M) && (isEnd(other.to) || isEnd(succ(other.to) || ''))));
    };
    let cands = outs.filter((e) => ok(e) && rejoins(e));
    if (!cands.length) continue;

    // lado de cada ramo: pela posição atual; empate → "Não" à esquerda
    const sideOf = (e) => {
      const t = box(e.to), other = outs.find((x) => x !== e);
      if (Math.abs(t.cv - D.cv) < 8) {
        if (other && cands.includes(other)) return NEG.test(e.text) ? 'neg' : 'pos';
        return box(other.to).cv > D.cv ? 'neg' : 'pos';
      }
      return t.cv < D.cv ? 'neg' : 'pos';
    };
    const sides = cands.map(sideOf);
    if (cands.length === 2 && sides[0] === sides[1]) {
      const negFirst = NEG.test(cands[0].text) || (!NEG.test(cands[1].text) && box(cands[0].to).cv <= box(cands[1].to).cv);
      sides[0] = negFirst ? 'neg' : 'pos'; sides[1] = negFirst ? 'pos' : 'neg';
    }

    cands.forEach((e, i) => {
      const side = sides[i];
      const T = box(e.to);
      const M = box(out.get(e.to)[0].to);
      const gapV = Math.max(70, (e.label ? (vertical ? e.label.getBoundingClientRect().width : 18) : 0) + 40);
      const ncv = side === 'neg' ? D.v0 - gapV - T.span / 2 : D.v1 + gapV + T.span / 2;
      const ncu = D.cu;
      const nb = { u0: ncu - T.len / 2, u1: ncu + T.len / 2, v0: ncv - T.span / 2, v1: ncv + T.span / 2 };
      if (M.u0 < nb.u1 + 20) return;                       // o passo seguinte precisa estar abaixo
      const pad = 18;
      const hits = [...nodeEl.keys()].filter((id) => id !== d && id !== e.to).some((id) => {
        const b = placed.get(id) || box(id);
        return b.u1 + pad > nb.u0 && b.u0 - pad < nb.u1 && b.v1 + pad > nb.v0 && b.v0 - pad < nb.v1;
      });
      if (hits) return;
      // não invade outras seções: a seção do losango pode crescer, desde que não encoste nas vizinhas
      const own = clusters.filter((c) => inside(c, D.cu, D.cv));
      const others = clusters.filter((c) => !own.includes(c));
      const touch = (a, b, p) => a.u1 + p > b.u0 && a.u0 - p < b.u1 && a.v1 + p > b.v0 && a.v0 - p < b.v1;
      if (others.some((c) => touch(nb, c, 20))) return;
      for (const c of own) {
        const grown = { u0: Math.min(c.u0, nb.u0 - 14), u1: Math.max(c.u1, nb.u1 + 14), v0: Math.min(c.v0, nb.v0 - 14), v1: Math.max(c.v1, nb.v1 + 14) };
        if (others.some((o) => !inside(grown, o.cu ?? (o.u0 + o.u1) / 2, (o.v0 + o.v1) / 2) && touch(grown, o, 8))) return;
      }
      const du = ncu - T.cu, dv = ncv - T.cv;
      const before = nodeEl.get(e.to).getBoundingClientRect();
      moveNode(nodeEl.get(e.to), vertical ? dv : du, vertical ? du : dv);
      placed.set(e.to, nb);
      moved.push({ id: e.to, before });
    });
  }
  if (moved.length) expandClusters(svg, moved, G);
  return moved.map((m) => m.id);
}

/** Subgrafos (seções) crescem para continuar contendo os blocos movidos */
function expandClusters(svg, moved, G) {
  for (const c of svg.querySelectorAll('g.cluster')) {
    const rect = c.querySelector('rect');
    if (!rect) continue;
    const r = rect.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom, grow = false;
    for (const m of moved) {
      const cx = (m.before.left + m.before.right) / 2, cy = (m.before.top + m.before.bottom) / 2;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
      const n = G.nodeEl.get(m.id).getBoundingClientRect();
      const s = n.width / Math.max(1, rect.getBBox().width) * 0 + 14 * (r.width / Math.max(1, rect.getBBox().width));
      x0 = Math.min(x0, n.left - s); y0 = Math.min(y0, n.top - s); x1 = Math.max(x1, n.right + s); y1 = Math.max(y1, n.bottom + s);
      grow = true;
    }
    if (!grow) continue;
    const a = toLocal(rect, x0, y0), b = toLocal(rect, x1, y1);
    const ox = parseFloat(rect.getAttribute('x')) || 0, ow = parseFloat(rect.getAttribute('width')) || 0;
    rect.setAttribute('x', a.x); rect.setAttribute('y', a.y);
    rect.setAttribute('width', b.x - a.x); rect.setAttribute('height', b.y - a.y);
    // mantém o título da seção centralizado
    const lab = c.querySelector('.cluster-label');
    const tm = lab && /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(lab.getAttribute('transform') || '');
    if (tm) lab.setAttribute('transform', `translate(${(parseFloat(tm[1]) + ((a.x + (b.x - a.x) / 2) - (ox + ow / 2))).toFixed(2)}, ${tm[2]})`);
  }
}

/** Demais setas em linhas retas (90°): descem, viram e entram pela lateral; retornos sobem por fora */
function orthogonalize(svg, G, decisionIds, vertical, force = false) {
  const { nodeEl, edges, ref } = G;
  const { fb, XY } = flowOf(vertical);
  const boxes = new Map([...nodeEl.keys()].map((id) => [id, fb(boxIn(ref, nodeEl.get(id)))]));
  const all = [...boxes.entries()].map(([id, b]) => ({ id, ...b }));
  const crossV = (skip, v, u0, u1) => all.some((b) => !skip.includes(b.id) && v > b.v0 - 6 && v < b.v1 + 6 && b.u1 > Math.min(u0, u1) + 1 && b.u0 < Math.max(u0, u1) - 1);
  const crossU = (skip, u, v0, v1) => all.some((b) => !skip.includes(b.id) && u > b.u0 - 6 && u < b.u1 + 6 && b.v1 > Math.min(v0, v1) + 1 && b.v0 < Math.max(v0, v1) - 1);
  const gap = 3;
  let n = 0;
  // quantas setas chegam em cada nó por cada lado (para não sobrepor entradas)
  for (const e of edges) {
    if (decisionIds.has(e.from)) continue;
    const S = boxes.get(e.from), T = boxes.get(e.to);
    const skip = [e.from, e.to];
    let pts = null;
    if (T.u0 >= S.u1 + 4) {
      // destino abaixo
      if ((S.cv < T.v0 - 8 || S.cv > T.v1 + 8) && !decisionIds.has(e.to)) {
        // bloco lateral: desce e entra pela lateral do destino (padrão "Ver TV → Almoçar")
        const side = S.cv < T.cv ? T.v0 - gap : T.v1 + gap;
        if (!crossV(skip, S.cv, S.u1, T.cu) && !crossU(skip, T.cu, S.cv, side)) {
          pts = [{ u: S.u1, v: S.cv }, { u: T.cu, v: S.cv }, { u: T.cu, v: side }];
        }
      }
      if (!pts && decisionIds.has(e.to) && Math.abs(S.cv - T.cv) > 3) {
        // losango: entra sempre por cima (as laterais são as saídas Sim/Não)
        const mid = Math.max(S.u1 + 14, T.u0 - 20);
        if (!crossV(skip, S.cv, S.u1, mid) && !crossU(skip, mid, S.cv, T.cv)) pts = [{ u: S.u1, v: S.cv }, { u: mid, v: S.cv }, { u: mid, v: T.cv }, { u: T.u0 - gap, v: T.cv }];
      }
      if (!pts) {
        // colunas se sobrepõem: uma linha reta só, sem "degrau"
        const lo = Math.max(S.v0 + 12, T.v0 + 12), hi = Math.min(S.v1 - 12, T.v1 - 12);
        let v = Math.abs(S.cv - T.cv) < 3 ? T.cv : (lo <= hi ? Math.min(hi, Math.max(lo, T.cv)) : null);
        if (v !== null && Math.abs(v - T.cv) > 1 && Math.abs(v - S.cv) > 1 && lo <= hi) v = (lo + hi) / 2;
        if (v !== null && !crossV(skip, v, S.u1, T.u0)) pts = [{ u: S.u1, v }, { u: T.u0 - gap, v }];
        else {
          const mid = (S.u1 + T.u0) / 2;
          if (!crossV(skip, S.cv, S.u1, mid) && !crossU(skip, mid, S.cv, T.cv) && !crossV(skip, T.cv, mid, T.u0)) {
            pts = [{ u: S.u1, v: S.cv }, { u: mid, v: S.cv }, { u: mid, v: T.cv }, { u: T.u0 - gap, v: T.cv }];
          }
        }
      }
      if (!pts && force) {
        const mid = (S.u1 + T.u0) / 2;
        pts = [{ u: S.u1, v: S.cv }, { u: mid, v: S.cv }, { u: mid, v: T.cv }, { u: T.u0 - gap, v: T.cv }];
      }
    } else if (T.u1 <= S.u0 - 4 || (T.u0 < S.u0 && Math.abs(T.cu - S.cu) > 4)) {
      // retorno (destino acima): sai pela lateral, sobe por fora e entra pela lateral do destino
      const prefer = S.cv >= T.cv ? 1 : -1;
      const colFor = (dir, uFrom) => {
        let col = dir > 0 ? Math.max(S.v1, T.v1) + 34 : Math.min(S.v0, T.v0) - 34;
        for (let k = 0; k < 12; k++) {
          const hit = all.filter((b) => !skip.includes(b.id) && col > b.v0 - 8 && col < b.v1 + 8 && b.u1 > T.cu && b.u0 < uFrom);
          if (!hit.length) break;
          col = dir > 0 ? Math.max(...hit.map((b) => b.v1)) + 26 : Math.min(...hit.map((b) => b.v0)) - 26;
        }
        return col;
      };
      for (const dir of [prefer, -prefer]) {
        const col = colFor(dir, S.cu);
        if (crossU(skip, S.cu, dir > 0 ? S.v1 : S.v0, col) || crossU(skip, T.cu, col, dir > 0 ? T.v1 : T.v0)) continue;
        pts = [{ u: S.cu, v: dir > 0 ? S.v1 : S.v0 }, { u: S.cu, v: col }, { u: T.cu, v: col }, { u: T.cu, v: dir > 0 ? T.v1 + gap : T.v0 - gap }];
        break;
      }
      if (!pts) {
        // as duas laterais estão ocupadas: sai por baixo e contorna
        const below = S.u1 + 22;
        const col = colFor(prefer, below);
        pts = [{ u: S.u1, v: S.cv }, { u: below, v: S.cv }, { u: below, v: col }, { u: T.cu, v: col }, { u: T.cu, v: prefer > 0 ? T.v1 + gap : T.v0 - gap }];
      }
    }
    if (!pts && force) {
      // mesma altura: ligação lateral direta
      const dir = T.cv > S.cv ? 1 : -1;
      pts = [{ u: S.cu, v: dir > 0 ? S.v1 : S.v0 }, { u: S.cu, v: (S.cv + T.cv) / 2 }, { u: T.cu, v: (S.cv + T.cv) / 2 }, { u: T.cu, v: dir > 0 ? T.v0 - gap : T.v1 + gap }];
    }
    if (!pts) continue;
    const xy = pts.map((p) => XY(p.u, p.v));
    setPath(svg, e.path, xy);
    e.path.removeAttribute('data-points');
    n++;
    if (e.label) {
      // rótulo no meio do trecho mais longo
      let best = 0, at = xy[0];
      for (let i = 1; i < xy.length; i++) {
        const len = Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
        if (len > best) { best = len; at = { x: (xy[i].x + xy[i - 1].x) / 2, y: (xy[i].y + xy[i - 1].y) / 2 }; }
      }
      const scr = toScreen(ref, at.x, at.y);
      const loc = toLocal(e.label.parentNode, scr.x, scr.y);
      e.label.setAttribute('transform', `translate(${loc.x.toFixed(2)}, ${loc.y.toFixed(2)})`);
    }
  }
  return n;
}

/** Remove faixas vazias (deixadas pelos blocos levados para o lado) puxando o restante para cima */
function compact(svg, G, vertical) {
  const { nodeEl, ref } = G;
  const { fb } = flowOf(vertical);
  const boxes = [...nodeEl.entries()].map(([id, el]) => ({ id, el, ...fb(boxIn(ref, el)) })).sort((a, b) => a.u0 - b.u0);
  if (boxes.length < 3) return false;
  // faixas ocupadas (blocos + títulos e bordas das seções), ao longo do fluxo
  const occupied = [...boxes];
  for (const c of svg.querySelectorAll('g.cluster')) {
    const r = c.querySelector('rect');
    const lab = c.querySelector('.cluster-label');
    if (r) { const cb = fb(boxIn(ref, r)); occupied.push({ u0: cb.u0 - 6, u1: cb.u0 + 6 }, { u0: cb.u1 - 6, u1: cb.u1 + 6 }); }
    if (lab && lab.getBoundingClientRect().height) { const lb = fb(boxIn(ref, lab)); occupied.push({ u0: lb.u0 - 8, u1: lb.u1 + 8 }); }
  }
  occupied.sort((a, b) => a.u0 - b.u0);
  const bands = [];
  for (const b of occupied) {
    const last = bands.at(-1);
    if (last && b.u0 <= last.u1 + 1) last.u1 = Math.max(last.u1, b.u1);
    else bands.push({ u0: b.u0, u1: b.u1 });
  }
  const IDEAL = 62;
  const gaps = [];
  for (let i = 1; i < bands.length; i++) {
    const size = bands[i].u0 - bands[i - 1].u1;
    if (size > IDEAL + 24) gaps.push({ at: bands[i].u0, cut: size - IDEAL });
  }
  if (!gaps.length) return false;
  const shiftAt = (u) => gaps.reduce((s, g) => s + (g.at <= u + 0.5 ? g.cut : 0), 0);
  const d = (du) => (vertical ? [0, -du] : [-du, 0]);
  for (const b of boxes) { const s = shiftAt(b.u0); if (s) moveNode(b.el, ...d(s)); }
  // seções (subgrafos): movem e encolhem junto
  for (const c of svg.querySelectorAll('g.cluster')) {
    const rect = c.querySelector('rect');
    if (!rect) continue;
    const cb = fb(boxIn(ref, rect));
    const s0 = shiftAt(cb.u0 + 1), s1 = shiftAt(cb.u1 - 1);
    if (!s0 && !s1) continue;
    const ax = vertical ? 'y' : 'x', len = vertical ? 'height' : 'width';
    rect.setAttribute(ax, (parseFloat(rect.getAttribute(ax)) || 0) - s0);
    rect.setAttribute(len, Math.max(20, (parseFloat(rect.getAttribute(len)) || 0) - (s1 - s0)));
    const lab = c.querySelector('.cluster-label');
    const tm = lab && /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(lab.getAttribute('transform') || '');
    if (tm) lab.setAttribute('transform', vertical ? `translate(${tm[1]}, ${(parseFloat(tm[2]) - s0).toFixed(2)})` : `translate(${(parseFloat(tm[1]) - s0).toFixed(2)}, ${tm[2]})`);
  }
  // rótulos de setas que não serão redesenhadas acompanham a posição de origem
  return true;
}

/** Setas e rótulos numa camada acima de tudo: o fundo das seções internas não pode escondê-los */
function raiseEdges(svg) {
  const root = svg.querySelector(':scope > g') || svg;
  if (!svg.querySelector('g.cluster')) return;              // sem seções, nada encobre as setas
  const overlay = document.createElementNS(NS, 'g');
  overlay.setAttribute('class', 'edge-overlay');
  root.appendChild(overlay);
  const inv = overlay.getScreenCTM()?.inverse();
  if (!inv) return;
  const lift = (el) => {
    const m = el.getScreenCTM();
    if (!m) return;
    const rel = inv.multiply(m);
    const wrap = document.createElementNS(NS, 'g');
    wrap.setAttribute('transform', `matrix(${[rel.a, rel.b, rel.c, rel.d, rel.e, rel.f].map((n) => +n.toFixed(4)).join(',')})`);
    // a seta mantém seu próprio transform (se houver) dentro do invólucro
    const own = el.getAttribute('transform');
    if (own) { el.removeAttribute('transform'); }
    wrap.appendChild(el);
    overlay.appendChild(wrap);
  };
  for (const path of [...svg.querySelectorAll('path[data-id^="L_"]')]) lift(path);
  for (const lab of [...svg.querySelectorAll('g.edgeLabel')]) lift(lab);
}

/**
 * Embeleza o fluxograma no padrão dos modelos:
 *  1. ramos dos losangos ao lado, na mesma altura;  2. saídas laterais dos losangos;
 *  3. demais setas retas (90°);  4. amplia a área do desenho.
 */
export function beautifyFlowchart(svg, nodeIds, decisionIds, direction = 'TD') {
  if (!svg) return;
  const vertical = direction === 'TD' || direction === 'TB';
  if (!vertical && direction !== 'LR') return;
  let G = collect(svg, nodeIds);
  if (!G.ref) return;
  const lifted = liftBranches(svg, G, decisionIds, vertical);
  // compacta os espaços que ficaram vazios; nesse caso todas as setas são redesenhadas
  const compacted = lifted.length ? compact(svg, G, vertical) : false;
  routeDecisionEdges(svg, nodeIds, decisionIds, direction);
  G = collect(svg, nodeIds);
  orthogonalize(svg, G, decisionIds, vertical, compacted);
  raiseEdges(svg);
  fitViewBox(svg);
}

export { NS };
