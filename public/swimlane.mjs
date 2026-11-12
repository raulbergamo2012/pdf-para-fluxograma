/* Layout automático dos 3 tipos de fluxograma (gabaritos escolhidos pelo usuário)
 *
 *  - 'raias'    Funcional / swimlane: raias em COLUNAS (vertical) ou FAIXAS (horizontal), uma por responsável,
 *               com o nome no cabeçalho; passar a bola para outra raia pode acontecer na mesma linha.
 *  - 'processo' Processo linear: UM fluxo contínuo (sem colunas nem caixas de seção), losangos só nas condições reais;
 *               exceções em notas tracejadas AO LADO do passo.
 *  - 'decisao'  Tomada de decisão: árvore de perguntas; cada losango abre "Não" à esquerda e "Sim" à direita,
 *               os ramos seguem lado a lado e convergem para o Fim.
 * Resultado: um desenho do editor visual (mesmo modelo usado pelo editor estilo draw.io e pelos downloads).
 */
import { parseFlowchart } from './graph.mjs';
import { measure, wrapText } from './visual-model.mjs';

const decode = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n')
  .replace(/#(\w+);/g, (m, e) => ({ gt: '>', lt: '<', 35: '#', quot: '"', amp: '&' }[e] ?? m));

/** O código traz a marca do tipo? ("%% tipo: raias") */
export const codeType = (code) => /^\s*%%\s*tipo:\s*(processo|raias|decisao)/im.exec(String(code || ''))?.[1] || '';
export const isLaneCode = (code) => codeType(code) === 'raias';

/** Compatibilidade: layout de raias */
export const swimlaneLayout = (code, opts = {}) => autoLayout(code, { ...opts, type: 'raias' });

/**
 * @param {string} code Mermaid
 * @param {{ type?: 'processo'|'raias'|'decisao', title?: string, direction?: string, palette?: object }} opts
 */
export function autoLayout(code, opts = {}) {
  // Processo (linear): UM fluxo contínuo de cima para baixo, sem colunas nem caixas de seção — losangos abrem
  // Não à esquerda / Sim à direita, como no Decisão. Por isso usa o mesmo desenho, ignorando os subgraphs.
  const asked = opts.type || codeType(code) || 'decisao';
  const type = asked === 'processo' ? 'decisao' : asked;
  const g = parseFlowchart(code);
  if (asked === 'processo') { g.subgraphs = []; }
  const P = { fill: '#ffffff', stroke: '#5f6b76', color: '#1a1a1a', line: '#333333', decisionFill: '#fff8e1', decisionStroke: '#c99a2e',
    terminalFill: '#e8f5e9', terminalStroke: '#2e7d32', errorFill: '#ffebee', errorStroke: '#c62828', noteFill: '#fffde7', noteStroke: '#9e9e9e',
    laneFill: '#ffffff', laneStroke: '#9aa8b6', sectionFill: '#f7f8f9', ...(opts.palette || {}) };
  const LR = String(opts.direction || g.direction || 'TD').toUpperCase().startsWith('L');
  const ids = [...g.nodes.keys()];
  const order = (id) => g.nodes.get(id).order ?? 0;
  const isNote = (id) => !!g.classes.get(id)?.has('nota');
  const flowEdges = g.edges.filter((e) => e.type !== '-.-' && g.nodes.has(e.from) && g.nodes.has(e.to) && !isNote(e.to));
  const noteEdges = g.edges.filter((e) => g.nodes.has(e.from) && g.nodes.has(e.to) && (e.type === '-.-' || isNote(e.to)));
  const noteOf = new Map();                                   // nota → passo
  noteEdges.forEach((e) => { const [s, n] = isNote(e.to) ? [e.from, e.to] : [e.to, e.from]; noteOf.set(n, s); });
  ids.filter(isNote).forEach((n) => { if (!noteOf.has(n)) noteOf.set(n, null); });

  // ------------------------------------------------------------ raias
  const useLanes = type === 'raias';
  const leafSgs = g.subgraphs.filter((s) => s.nodes.length);
  // seções = subgrafos sem subgrafos dentro (o bloco principal, que envolve tudo, vira o título geral)
  const sections = leafSgs.filter((s) => !g.subgraphs.some((c) => c.parent === s.id));
  // Processo longo (guias de montagem): cada etapa vira uma COLUNA lado a lado, em vez de uma cascata enorme
  const nSteps = ids.filter((id) => !isNote(id)).length;
  const columns = type === 'processo' && !LR && sections.length >= 2 && nSteps > 14;
  // fluxograma ramificado POR ETAPAS: cada etapa do documento vira um bloco com título (agrupamento visual)
  const staged = asked === 'decisao' && !LR && sections.length >= 2;
  const lanes = useLanes && leafSgs.length ? leafSgs : columns ? sections : [{ id: '_', label: '', nodes: ids }];
  const laneOf = new Map();
  lanes.forEach((l, i) => l.nodes.forEach((id) => laneOf.set(id, i)));
  // raias de FASE/ETAPA (não de responsáveis): cada coluna começa no topo, para todas participarem do diagrama
  // inteiro (em vez de a 1ª coluna ocupar a metade de cima e as outras ficarem vazias). A passagem para a fase
  // seguinte sobe pelo corredor da coluna ao lado, sempre em 90°.
  const phases = useLanes && !LR && type === 'raias' && lanes.length >= 2 && (/^\s*%%\s*raias:\s*etapas/m.test(code)
    || lanes.every((l) => /^(passo|etapa|fase|parte|step|stage)\s*\d/i.test(decode(l.label || ''))));
  // ETAPAS do processo (agrupamento SECUNDÁRIO do Funcional): "%% etapa: Título :: P1 P2 …". Viram faixas horizontais
  // que atravessam TODAS as raias — as raias continuam sendo os responsáveis; a etapa só diz em que fase a atividade está
  const stageDefs = [...code.matchAll(/^\s*%%\s*etapa:\s*(.+?)\s*::\s*(.*)$/gm)].map((m) => ({ title: m[1].trim(), ids: m[2].trim().split(/\s+/).filter(Boolean) }));
  const stageRows = useLanes && !LR && type === 'raias' && !phases && stageDefs.length >= 2;
  const stageIdx = new Map();
  if (stageRows) stageDefs.forEach((st, k) => st.ids.forEach((id) => { if (g.nodes.has(id) && !stageIdx.has(id)) stageIdx.set(id, k); }));
  for (let pass = 0; pass < 3; pass++) for (const id of ids) {
    if (laneOf.has(id)) continue;
    const nb = [...flowEdges, ...noteEdges].find((e) => (e.to === id && laneOf.has(e.from)) || (e.from === id && laneOf.has(e.to)));
    if (nb) laneOf.set(id, laneOf.get(nb.to === id ? nb.from : nb.to));
  }
  for (const id of ids) if (!laneOf.has(id)) laneOf.set(id, 0);

  // ------------------------------------------------------------ ordem (retornos viram setas de volta)
  const outs = new Map(ids.map((id) => [id, []]));
  flowEdges.forEach((e) => outs.get(e.from).push(e));
  const steps = ids.filter((id) => !isNote(id));
  const roots = steps.filter((id) => !flowEdges.some((e) => e.to === id)).sort((a, b) => (/^inicio/i.test(b) - /^inicio/i.test(a)) || order(a) - order(b));
  const state = new Map(); const back = new Set(); const topo = [];
  const dfs = (id) => {
    state.set(id, 1);
    for (const e of [...outs.get(id)].sort((a, b) => order(a.to) - order(b.to))) {
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) dfs(e.to);
    }
    state.set(id, 2); topo.push(id);
  };
  roots.forEach((r) => !state.get(r) && dfs(r));
  [...steps].sort((a, b) => order(a) - order(b)).forEach((id) => !state.get(id) && dfs(id));
  topo.reverse();

  // ------------------------------------------------------------ linhas (rank) e células
  const fwd = flowEdges.filter((e) => !back.has(e));
  const preds = new Map(ids.map((id) => [id, []]));
  fwd.forEach((e) => preds.get(e.to).push(e.from));
  const anc = new Map(); const rank = new Map(); const cells = new Map();
  const key = (l, r) => `${l}:${r}`;
  const cell = (l, r) => cells.get(key(l, r)) || cells.set(key(l, r), []).get(key(l, r));
  const runRanks = (minRank) => {
    anc.clear(); rank.clear(); cells.clear();
    for (const id of topo) {
      const a = new Set();
      preds.get(id).forEach((p) => { a.add(p); anc.get(p)?.forEach((x) => a.add(x)); });
      anc.set(id, a);
      const lane = laneOf.get(id);
      let r = 0;
      // mesma raia: avança uma linha; outra raia (só no Funcional): pode ficar na mesma linha
      // colunas do Processo: cada etapa começa no topo da sua coluna
      // fases: a etapa seguinte começa no topo da coluna — exceto quando vem de um losango (métodos alternativos):
      // aí o ramo começa NA ALTURA do losango, e a seta segue reta para o lado, sem subir
      // Funcional (raias de responsáveis): passar para a raia VIZINHA pode ser na mesma linha (seta reta para o lado);
      // para uma raia mais distante, a atividade desce uma linha — a seta não precisa passar por trás das outras raias
      // …e um LOSANGO que recebe a atividade de outra raia fica uma linha abaixo: a seta entra por cima e as duas
      // pontas laterais ficam livres para as saídas Sim/Não
      // …e quando a origem é o ramo de um losango que fica do lado OPOSTO ao da raia de destino ("Sim" à direita
      // passando para a raia da esquerda), com o outro ramo na mesma raia: o outro ramo está no meio do caminho,
      // então a atividade desce uma linha e a seta passa por baixo dele, sem cruzar linhas
      const branchAway = (p) => {
        const de = fwd.find((e) => e.to === p && g.nodes.get(e.from)?.kind === 'decision' && laneOf.get(e.from) === laneOf.get(p));
        if (!de || !fwd.some((e) => e.from === de.from && e.to !== p && laneOf.get(e.to) === laneOf.get(p))) return false;
        const side = /^n[aã]o\b/i.test(de.label || '') ? -1 : /^sim\b/i.test(de.label || '') ? 1 : 0;
        return side !== 0 && side === -Math.sign(lane - laneOf.get(p));
      };
      const farLane = (p) => (useLanes && !LR && type === 'raias' && !phases && (Math.abs(laneOf.get(p) - lane) > 1 || g.nodes.get(id)?.kind === 'decision' || branchAway(p)) ? 1 : 0);
      preds.get(id).forEach((p) => { r = Math.max(r, laneOf.get(p) === lane ? rank.get(p) + 1 : columns || (phases && g.nodes.get(p)?.kind !== 'decision') ? 0 : rank.get(p) + farLane(p)); });
      if (type === 'processo' && !columns) r = Math.max(r, ...[...rank.values()].map((x) => x + 1), 0);   // coluna única e reta
      if (columns) r = Math.max(r, ...steps.filter((o) => rank.has(o) && laneOf.get(o) === lane).map((o) => rank.get(o) + 1), 0);
      // losango com duas saídas para a MESMA raia: a segunda desce uma linha (cada saída por uma ponta, sem se cruzarem)
      for (const p of preds.get(id)) if (g.nodes.get(p)?.kind === 'decision' && laneOf.get(p) !== lane && useLanes && !LR && type === 'raias' && !phases
        && fwd.some((e) => e.from === p && e.to !== id && laneOf.get(e.to) === lane && rank.get(e.to) === rank.get(p))) r = Math.max(r, rank.get(p) + 1);
      r = Math.max(r, minRank(id));
      while (cell(lane, r).some((o) => a.has(o) || anc.get(o)?.has(id))) r++;
      rank.set(id, r);
      cell(lane, r).push(id);
    }
  };
  let stageMin = new Map();
  runRanks((id) => stageMin.get(stageIdx.get(id)) ?? 0);
  if (stageRows) for (let it = 0; it < 6; it++) {
    // cada etapa começa numa linha abaixo de todas as atividades das etapas anteriores (em qualquer raia)
    const maxR = stageDefs.map((_, k) => Math.max(-1, ...[...stageIdx].filter(([id, kk]) => kk === k && rank.has(id)).map(([id]) => rank.get(id))));
    const next = new Map(); let acc0 = -1;
    stageDefs.forEach((_, k) => { if (k) next.set(k, acc0 + 1); acc0 = Math.max(acc0, maxR[k]); });
    if ([...next].every(([k, v]) => stageMin.get(k) === v)) break;
    stageMin = next;
    runRanks((id) => stageMin.get(stageIdx.get(id)) ?? 0);
  }
  for (const id of steps) if (!rank.has(id)) { rank.set(id, 0); cell(laneOf.get(id), 0).push(id); }
  // Funcional: o Fim fica SEMPRE na última linha — os caminhos descem até ele, em vez de uma seta longa atravessar
  // as raias no meio do diagrama
  if (useLanes && !LR) {
    // (só quando chegam caminhos de OUTRAS raias; se o Fim vem só da própria raia, fica logo abaixo do último passo)
    const ends = steps.filter((id) => /^fim/i.test(id) && !flowEdges.some((e) => e.from === id)
      && flowEdges.some((e) => e.to === id && laneOf.get(e.from) !== laneOf.get(id)));
    const last = Math.max(0, ...steps.filter((id) => !ends.includes(id)).map((id) => rank.get(id)));
    if (ends.length) {
      for (const id of ends) rank.set(id, last + 1);
      cells.clear();
      for (const id of steps) cell(laneOf.get(id), rank.get(id)).push(id);
    }
  }
  // ETAPAS (fluxograma ramificado com subgrafos de etapa): cada etapa ocupa suas próprias linhas, para o bloco
  // com o título da etapa nunca se sobrepor ao da etapa seguinte (ex.: o "Sim" fica na etapa 4 e o "Não" já é etapa 5)
  if (staged) {
    const secOfId = (id) => sections.find((sg) => sg.nodes.includes(id))?.id || '';
    const ordered = sections.map((sg) => ({ sg, mem: steps.filter((id) => secOfId(id) === sg.id) })).filter((x) => x.mem.length)
      .sort((a, b) => Math.min(...a.mem.map(order)) - Math.min(...b.mem.map(order)));
    const done = new Set(steps.filter((id) => !secOfId(id) && /^inicio/i.test(id)));
    for (const { mem } of ordered) {
      const prevMax = Math.max(-1, ...[...done].map((id) => rank.get(id)));
      const r0 = Math.min(...mem.map((id) => rank.get(id)));
      if (r0 <= prevMax) {
        const delta = prevMax + 1 - r0;
        for (const id of steps) if (!done.has(id) && rank.get(id) >= r0) rank.set(id, rank.get(id) + delta);
      }
      mem.forEach((id) => done.add(id));
    }
    cells.clear();
    for (const id of steps) cell(laneOf.get(id), rank.get(id)).push(id);
  }

  // ------------------------------------------------------------ tamanhos
  const kindOf = (id) => {
    const n = g.nodes.get(id);
    if (isNote(id)) return 'note';
    if (n.kind === 'decision') return 'diamond';
    if (n.kind === 'terminal' || /^(inicio|fim)/i.test(id)) return 'terminator';
    return 'rect';
  };
  const size = new Map();
  for (const id of ids) {
    const k = kindOf(id), text = decode(g.nodes.get(id).label);
    const lines = wrapText(text, k === 'diamond' ? 104 : k === 'note' ? 150 : 136, 13.5);
    const tw = Math.max(...lines.map((l) => measure(l, 13.5)), 40);
    if (k === 'diamond') size.set(id, { w: Math.max(150, Math.min(190, tw * 1.55 + 30)), h: Math.max(84, lines.length * 18 + 52) });
    else if (k === 'terminator') size.set(id, { w: Math.max(110, tw + 44), h: 42 });
    else if (k === 'note') size.set(id, { w: Math.max(130, Math.min(180, tw + 28)), h: Math.max(42, lines.length * 17 + 20) });
    else size.set(id, { w: Math.max(130, Math.min(170, tw + 30)) + (g.nodes.get(id)?.open === '[/' ? 36 : 0), h: Math.max(48, lines.length * 18 + 22) });
  }
  const even = (v) => 2 * Math.round(v / 2);
  for (const [id, sz] of size) size.set(id, { w: even(sz.w), h: even(sz.h) });
  const along = (id) => (LR ? size.get(id).w : size.get(id).h);     // tamanho no sentido do fluxo
  const across = (id) => (LR ? size.get(id).h : size.get(id).w);    // tamanho no sentido transversal

  // ------------------------------------------------------------ grade → coordenadas
  const nLanes = lanes.length;
  const maxRank = Math.max(0, ...steps.map((id) => rank.get(id)));
  const PAD = 22, GAP_MAIN = type === 'processo' ? 34 : 46, GAP_CROSS = 34;
  // notas ficam ao lado: reservam espaço transversal (no Processo/Decisão dos dois lados, para a coluna ficar no centro)
  const noteSpace = (l) => Math.max(0, ...[...noteOf].filter(([, s]) => s && laneOf.get(s) === l).map(([n]) => across(n) + 40));
  const rowMain = (r) => Math.max(40, ...[...cells.entries()].filter(([k]) => Number(k.split(':')[1]) === r).flatMap(([, v]) => v.map(along)),
    ...[...noteOf].filter(([, s]) => s && rank.get(s) === r).map(([n]) => along(n)));
  const cellCross = Math.max(...steps.map(across)) + GAP_CROSS;
  // Funcional (raias de responsáveis, vertical): dentro de cada raia, cada caminho mantém a sua COLUNA — o ramo de um
  // losango abre para o lado (Não à esquerda, Sim à direita; 3+ métodos com duas colunas entre eles), a convergência
  // volta para a média das origens e uma colisão empurra o vizinho. Assim um ramo nunca passa para baixo de outro.
  const colOf = new Map();
  const laneCols = useLanes && !LR && type === 'raias' && !phases;
  // para que lado (raia) o caminho que começa em "id" passa a responsabilidade: −1 esquerda, +1 direita, 0 fica
  const pullOf = (id, l) => {
    const seen = new Set([id]); const q = [id]; let sum = 0, n = 0;
    while (q.length && seen.size < 40) {
      const x = q.shift();
      for (const e of fwd.filter((f) => f.from === x)) {
        if (laneOf.get(e.to) !== l) { sum += Math.sign(laneOf.get(e.to) - l); n++; continue; }
        if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
      }
    }
    return n ? sum / n : 0;
  };
  if (laneCols) {
    const brk = (id, p) => { const e = flowEdges.find((x) => x.from === p && x.to === id); return !e ? 1 : /^n[aã]o\b/i.test(e.label) ? 0 : /^sim\b/i.test(e.label) ? 2 : 1; };
    for (let r = 0; r <= maxRank; r++) for (let l = 0; l < nLanes; l++) {
      const row = (cells.get(key(l, r)) || []).slice();
      for (const id of row) {
        const ps = preds.get(id).filter((p) => colOf.has(p) && laneOf.get(p) === l);
        let c = 0;
        if (ps.length === 1) {
          const p = ps[0];
          const kids = fwd.filter((e) => e.from === p && laneOf.get(e.to) === l).map((e) => e.to);
          if (kindOf(p) === 'diamond' && kids.length >= 2) {
            // 3+ métodos: o ramo que passa a atividade para uma raia à direita fica à direita (e vice-versa),
            // para a passagem de responsabilidade não atravessar os outros ramos
            const sorted = kids.slice().sort((a, b) => (kids.length > 2 ? pullOf(a, l) - pullOf(b, l) : 0) || brk(a, p) - brk(b, p) || order(a) - order(b));
            c = colOf.get(p) + (sorted.indexOf(id) - (sorted.length - 1) / 2) * (kids.length > 2 ? 2 : 1);
          } else c = colOf.get(p);
        } else if (!ps.length && preds.get(id).length) {
          // volta de outra raia: retoma a coluna do caminho que saiu desta raia (não cai no centro)
          const back = preds.get(id).flatMap((p) => preds.get(p)).filter((q) => colOf.has(q) && laneOf.get(q) === l);
          if (back.length) c = Math.round((back.reduce((x, q) => x + colOf.get(q), 0) / back.length) * 2) / 2;
        } else if (ps.length > 1) {
          let sum = 0, w = 0;
          for (const p of ps) { const wt = kindOf(p) === 'diamond' ? 2 : 1; sum += colOf.get(p) * wt; w += wt; }
          c = Math.round((sum / w) * 2) / 2;
        }
        colOf.set(id, c);
      }
      row.sort((a, b) => colOf.get(a) - colOf.get(b) || order(a) - order(b));
      // colisão: empurra para o lado onde há menos gente (a partir do centro)
      for (let i = 1; i < row.length; i++) if (colOf.get(row[i]) - colOf.get(row[i - 1]) < 1) colOf.set(row[i], colOf.get(row[i - 1]) + 1);
    }
  }
  const colMinL = (l) => Math.min(0, ...steps.filter((id) => laneOf.get(id) === l && colOf.has(id)).map((id) => colOf.get(id)));
  const colMaxL = (l) => Math.max(0, ...steps.filter((id) => laneOf.get(id) === l && colOf.has(id)).map((id) => colOf.get(id)));
  const slotsIn = (l) => (laneCols ? Math.round(colMaxL(l) - colMinL(l)) + 1 : Math.max(1, ...Array.from({ length: maxRank + 1 }, (_, r) => (cells.get(key(l, r)) || []).length)));
  // seções do Processo empilhadas: espaço para o título de cada seção
  // Início entra na primeira etapa e Fim na última (ficam dentro do bloco, sem a seta cruzar o título)
  const ownSection = (id) => sections.find((s) => s.nodes.includes(id))?.id || '';
  const sectionOf = (id) => {
    if (type !== 'processo' && !staged) return '';
    const own = ownSection(id);
    if (own || isNote(id)) return own;
    if (/^inicio/i.test(id)) return ownSection(fwd.find((e) => e.from === id)?.to || '');
    if (/^fim/i.test(id)) { const p = fwd.filter((e) => e.to === id).map((e) => e.from).sort((a, b) => order(b) - order(a))[0]; return p ? ownSection(p) : ''; }
    return '';
  };
  // cabeçalho das etapas com altura para o título inteiro
  const secTitleW = (columns ? cellCross + 2 * PAD - GAP_CROSS : cellCross + 2 * PAD) - 20;
  const SEC_HEAD = type === 'processo' || staged ? Math.max(34, ...sections.map((sg) => wrapText(decode(sg.label), secTitleW, 14, true).length * 18 + 14)) : 0;
  const firstRankOfSection = new Set(steps.filter((id) => sectionOf(id) && !steps.some((o) => sectionOf(o) === sectionOf(id) && rank.get(o) < rank.get(id))).map((id) => rank.get(id)));
  const lastRankOfSection = new Set(steps.filter((id) => sectionOf(id) && !steps.some((o) => sectionOf(o) === sectionOf(id) && rank.get(o) > rank.get(id))).map((id) => rank.get(id)));
  // largura igual para todas as raias (colunas simétricas) e cabeçalho com altura para o título inteiro
  const oneSide = useLanes || columns;                                 // notas só à direita (raias e colunas de etapas)
  const rawLane = (l) => slotsIn(l) * cellCross + 2 * PAD - GAP_CROSS + noteSpace(l) * (oneSide ? 1 : 2);
  const laneW = useLanes ? Math.max(LR ? 120 : 210, ...lanes.map((_, l) => rawLane(l))) + (phases ? 56 : 0) : 0;   // fases: corredor lateral mais largo para as passagens
  const titleW = (t) => Math.min(320, measure(decode(t), 14, true) + 40);
  const titleLines = (t) => wrapText(decode(t), (LR ? 420 : laneCols ? 210 : laneW) - 20, 14, true).length;
  const HEAD = useLanes ? Math.max(40, ...lanes.map((ln) => titleLines(ln.label) * 18 + 16)) : 0;
  const mainPos = []; let acc = (LR ? 0 : HEAD) + PAD + 8;
  const stageRange = stageRows ? stageDefs.map((_, k) => {
    const rs = [...stageIdx].filter(([, kk]) => kk === k).map(([id]) => rank.get(id)).filter((x) => x != null);
    return rs.length ? [Math.min(...rs), Math.max(...rs)] : null;
  }) : [];
  const stageStartRows = new Set(stageRange.filter(Boolean).slice(1).map((r) => r[0]));
  for (let r = 0; r <= maxRank; r++) {
    if (stageStartRows.has(r)) acc += 18;   // respiro na divisa entre etapas
    if (firstRankOfSection.has(r)) acc += SEC_HEAD + 14;
    mainPos[r] = acc; acc += rowMain(r) + GAP_MAIN;
    if (lastRankOfSection.has(r)) acc += 14;
  }
  const mainLen = acc - GAP_MAIN + PAD + 6;
  const laneStart = []; const laneSize = []; let x0 = 0;
  const colGap = columns ? 40 : 0;                                    // corredor entre as colunas de etapas
  for (let l = 0; l < nLanes; l++) {
    laneStart[l] = x0;
    // Funcional vertical: cada raia com a largura das SUAS colunas (sem raia larga e vazia)
    laneSize[l] = laneCols ? Math.max(230, rawLane(l), titleW(lanes[l].label)) : useLanes ? laneW + (LR ? HEAD : 0) : Math.max(columns ? 240 : 200, rawLane(l));
    x0 += laneSize[l] + colGap;
  }

  const nodes = [];
  const titled = useLanes && opts.title;
  const outer = type === 'processo' ? g.subgraphs.find((s) => !s.parent && g.subgraphs.some((c) => c.parent === s.id)) : null;
  const titleH = titled || outer ? 30 : 0;
  const STW = stageRows ? 132 : 0;   // coluna das etapas, à esquerda das raias
  const OX = 40 + STW, OY = 40 + titleH;
  if (useLanes) lanes.forEach((ln, l) => {
    const box = LR ? { x: OX, y: OY + laneStart[l], w: mainLen, h: laneSize[l] } : { x: OX + laneStart[l], y: OY, w: laneSize[l], h: mainLen };
    for (const k of Object.keys(box)) box[k] = Math.round(box[k]);
    // raias alternam um fundo levemente diferente e têm uma faixa de cor no cabeçalho: dá para seguir cada
    // responsável/etapa de cima a baixo sem confundir as colunas
    nodes.push({ id: 'RAIA_' + (ln.id || l), shape: 'container', band: true, head: HEAD, ...box, text: decode(ln.label), fill: l % 2 ? (P.laneAltFill || '#f6f8fa') : P.laneFill, stroke: P.laneStroke, color: '#1d2b36', fontSize: 14, accent: P.laneAccent || P.stroke });
  });
  if (stageRows) {
    // faixas das etapas: a coluna da esquerda traz o nome da etapa; uma linha divide as etapas atravessando as raias
    const totalW = laneStart[nLanes - 1] + laneSize[nLanes - 1];
    const ranges = stageRange.map((r, k) => (r ? { k, r } : null)).filter(Boolean);
    const bodyTop = OY + HEAD, bodyBot = OY + mainLen;
    nodes.push({ id: 'ETAPA_HEAD', shape: 'container', x: 40, y: OY, w: STW, h: HEAD, text: 'Etapa', fill: '#eef1f4', stroke: P.laneStroke, color: '#1d2b36', fontSize: 13, bold: true, locked: true });
    ranges.forEach(({ k, r }, i) => {
      const top = i === 0 ? bodyTop : Math.round((mainPos[ranges[i - 1].r[1]] + rowMain(ranges[i - 1].r[1]) + mainPos[r[0]]) / 2);
      const bot = i === ranges.length - 1 ? bodyBot : Math.round((mainPos[r[1]] + rowMain(r[1]) + mainPos[ranges[i + 1].r[0]]) / 2);
      nodes.push({ id: 'ETAPA_' + (k + 1), shape: 'container', stageRow: true, sideHead: STW, x: 40, y: Math.round(i === 0 ? top : OY + top), w: Math.round(OX + totalW) - 40, h: Math.round((i === ranges.length - 1 ? bot : OY + bot) - (i === 0 ? top : OY + top)),
        text: stageDefs[k].title, fill: 'none', headFill: k % 2 ? '#e9edf1' : '#f1f4f7', stroke: P.laneStroke, color: '#1d2b36', fontSize: 13, bold: true, locked: true });
    });
  }
  // Funcional com 2+ responsáveis: cada raia tem uma cor suave nas suas atividades (como no modelo de referência) —
  // dá para ver de longe de quem é cada caixa; decisões, início/fim, dúvidas e erros mantêm as cores próprias
  const TINTS = [['#E6F6EE', '#2E9E6B', '#14532D'], ['#E8F0FC', '#3B6FC4', '#1E3A8A'], ['#FFF4DC', '#D4932A', '#7C4A03'], ['#F2EAFB', '#8A5CC2', '#4C1D95'],
    ['#FDEBEC', '#C9544D', '#7F1D1D'], ['#E6F4F7', '#2F8FA6', '#164E63'], ['#F0F5E4', '#6E9A2E', '#3F6212'], ['#FBEEE4', '#C27A3A', '#7C2D12']];
  const laneTint = useLanes && type === 'raias' && !phases && nLanes >= 2 && P.laneColors !== false
    ? (id) => { const t = TINTS[laneOf.get(id) % TINTS.length]; return { fill: t[0], stroke: t[1], color: t[2] }; } : null;
  const style = (id) => {
    const k = kindOf(id), c = g.classes.get(id) || new Set();
    if (k === 'note') return { shape: 'rounded', fill: P.noteFill, stroke: P.noteStroke, dashed: true, color: '#555555' };
    if (k === 'diamond') return { shape: 'diamond', fill: P.decisionFill, stroke: P.decisionStroke };
    if (g.nodes.get(id)?.open === '[/' || g.nodes.get(id)?.open === '[\\') return { shape: 'parallelogram', fill: P.fill, stroke: P.stroke, ...(laneTint ? laneTint(id) : {}) };   // entrada/saída de dados
    if (k === 'terminator') return { shape: 'terminator', fill: P.terminalFill, stroke: P.terminalStroke };
    if (c.has('duvida')) return { shape: 'rect', fill: '#FFF8E6', stroke: '#C98A00', dashed: true, color: '#6B4E00' };   // ponto com dúvida no documento
    if (laneTint) return { shape: 'rect', ...laneTint(id) };   // Funcional: a cor é a do responsável (também nos desvios)
    if (c.has('erro')) return { shape: 'rect', fill: P.errorFill, stroke: P.errorStroke };
    return { shape: 'rect', fill: P.fill, stroke: P.stroke };
  };
  // irmãos de uma decisão: "Não" à esquerda e "Sim" à direita (como no gabarito)
  const branchRank = (id) => {
    const e = flowEdges.find((x) => x.to === id && g.nodes.get(x.from)?.kind === 'decision');
    if (!e) return 1;
    return /^n[aã]o\b/i.test(e.label) ? 0 : /^sim\b/i.test(e.label) ? 2 : 1;
  };
  const pos = new Map();
  const crossCenter = new Map();
  const place = (id, cCross, cMain) => {
    const { w, h } = size.get(id);
    const cx = LR ? OX + cMain : OX + cCross, cy = LR ? OY + cCross : OY + cMain;
    const n = { id, x: Math.round(cx) - w / 2, y: Math.round(cy) - h / 2, w: Math.round(w), h: Math.round(h), text: decode(g.nodes.get(id).label), color: P.color, fontSize: 13.5, ...style(id) };
    nodes.push(n); pos.set(id, n); crossCenter.set(id, cCross);
  };
  for (let r = 0; r <= maxRank; r++) for (let l = 0; l < nLanes; l++) {
    const list = cells.get(key(l, r));
    if (!list?.length) continue;
    // ordem na linha segue a posição dos antecessores (evita cruzamentos)
    const bary = (id) => { const ps = preds.get(id).filter((p) => crossCenter.has(p)); return ps.length ? ps.reduce((s, p) => s + crossCenter.get(p), 0) / ps.length : 0; };
    // raias: quem segue para uma raia à direita fica à direita (e vice-versa) — a seta sai sem contornar o irmão
    const pull = (id) => {
      if (!useLanes) return 0;
      const nx = fwd.filter((e) => e.from === id).map((e) => laneOf.get(e.to) - laneOf.get(id));
      const d = nx.length ? nx.reduce((x, y) => x + y, 0) / nx.length : 0;
      return d > 0 ? 1 : d < 0 ? -1 : 0;
    };
    list.sort((a, b) => {
      const siblings = preds.get(a).length === 1 && preds.get(b).length === 1 && preds.get(a)[0] === preds.get(b)[0];
      return (pull(a) - pull(b)) || (siblings ? branchRank(a) - branchRank(b) : 0) || (bary(a) - bary(b)) || (branchRank(a) - branchRank(b)) || order(a) - order(b);
    });
    const span = list.length * cellCross - GAP_CROSS;
    const head = LR && useLanes ? HEAD : 0;
    const inner = laneSize[l] - head - (oneSide ? noteSpace(l) : 2 * noteSpace(l));
    const startCross = laneStart[l] + head + (oneSide ? 0 : noteSpace(l)) + inner / 2 - span / 2;
    const cMain = mainPos[r] + rowMain(r) / 2;
    if (laneCols) {
      // colunas estáveis, centralizadas na raia
      const cols = slotsIn(l), base = laneStart[l] + (inner - (cols * cellCross - GAP_CROSS)) / 2;
      list.forEach((id) => place(id, base + (colOf.get(id) - colMinL(l)) * cellCross + (cellCross - GAP_CROSS) / 2, cMain));
      continue;
    }
    list.forEach((id, i) => place(id, startCross + i * cellCross + (cellCross - GAP_CROSS) / 2, cMain));
  }
  // notas: ao lado do passo, na mesma linha
  for (const [n, s] of noteOf) {
    if (!s || !pos.get(s)) continue;
    const cMain = mainPos[rank.get(s)] + rowMain(rank.get(s)) / 2;
    place(n, crossCenter.get(s) + across(s) / 2 + 40 + across(n) / 2, cMain);
  }
  // seções (Processo) / etapas (ramificado): blocos com título empilhados atrás da coluna
  if (type === 'processo' || staged) {
    const all = [...pos.values()];
    const lo = Math.min(...all.map((n) => (LR ? n.y : n.x))) - PAD, hi = Math.max(...all.map((n) => (LR ? n.y + n.h : n.x + n.w))) + PAD;
    const secs = [];
    for (const sg of sections) {
      const mem = steps.filter((id) => sectionOf(id) === sg.id);
      if (!mem.length) continue;
      const r0 = Math.min(...mem.map((id) => rank.get(id))), r1 = Math.max(...mem.map((id) => rank.get(id)));
      const a0 = mainPos[r0] - SEC_HEAD - 10, a1 = mainPos[r1] + rowMain(r1) + 12;
      const col = columns ? lanes.indexOf(sg) : -1;
      const box = col >= 0 ? { x: OX + laneStart[col] + 8, y: OY + a0, w: laneSize[col] - 16, h: a1 - a0 }
        : LR ? { x: OX + a0, y: lo, w: a1 - a0, h: hi - lo } : { x: lo, y: OY + a0, w: hi - lo, h: a1 - a0 };
      for (const k of Object.keys(box)) box[k] = Math.round(box[k]);
      secs.push({ id: 'SEC_' + sg.id, shape: 'container', band: true, head: SEC_HEAD, ...box, text: decode(sg.label), fill: P.sectionFill, stroke: P.laneStroke, color: '#1d2b36', fontSize: 14 });
    }
    nodes.unshift(...secs);
  }
  // título geral (raias: nome do processo; processo: bloco principal com Início e Fim dentro)
  if (titled || outer) {
    const x1 = Math.min(...nodes.map((n) => n.x)) - (useLanes ? 0 : PAD), y1 = Math.min(OY, ...nodes.map((n) => n.y)) - titleH - (useLanes ? 0 : 8);
    const x2 = Math.max(...nodes.map((n) => n.x + n.w)) + (useLanes ? 0 : PAD), y2 = Math.max(...nodes.map((n) => n.y + n.h)) + (useLanes ? 0 : PAD);
    nodes.unshift({ id: 'TITULO', shape: 'container', x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1),
      text: titled ? opts.title : decode(outer.label), fill: useLanes ? '#f4f7f9' : '#fbfbfc', stroke: P.laneStroke, color: '#1d2b36', fontSize: 15, bold: true });
  }

  const hitsAny = (segs, A, B) => [...pos.values()].some((n) => n !== A && n !== B && segs.some(([x1, y1, x2, y2]) =>
    Math.max(x1, x2) > n.x - 6 && Math.min(x1, x2) < n.x + n.w + 6 && Math.max(y1, y2) > n.y - 6 && Math.min(y1, y2) < n.y + n.h + 6));
  // há bloco entre A e B na mesma linha?
  const rowBlocked = (A, B) => {
    const y = A.y + A.h / 2, x1 = Math.min(A.x + A.w, B.x + B.w), x2 = Math.max(A.x, B.x);
    return hitsAny([[Math.min(A.x + A.w / 2, B.x + B.w / 2), y, Math.max(A.x + A.w / 2, B.x + B.w / 2), y]], A, B) && x2 > x1;
  };
  // o caminho "desce → corredor → desce" não atravessa nenhum bloco?
  const corridorFree = (A, B) => {
    const gy = A.y + A.h + GAP_MAIN / 2, ax = A.x + A.w / 2, bx = B.x + B.w / 2;
    const segs = [[ax, A.y + A.h, ax, gy], [Math.min(ax, bx), gy, Math.max(ax, bx), gy], [bx, gy, bx, B.y]];
    return gy < B.y - 6 && ![...pos.values()].some((n) => n !== A && n !== B && segs.some(([x1, y1, x2, y2]) =>
      Math.max(x1, x2) > n.x - 6 && Math.min(x1, x2) < n.x + n.w + 6 && Math.max(y1, y2) > n.y - 6 && Math.min(y1, y2) < n.y + n.h + 6));
  };

  // corredor livre dentro de uma raia (vertical), ao lado dos blocos entre as linhas y1..y2
  const laneRoute = (A, B, laneNodeId, mode) => {
    const l = laneOf.get(laneNodeId);
    if (l == null || laneStart[l] == null) return null;
    const lx1 = OX + laneStart[l] + 8, lx2 = OX + laneStart[l] + laneSize[l] - 8;
    const ay = Math.round(A.y + A.h / 2), by = Math.round(B.y + B.h / 2);
    const y1 = Math.min(A.y, B.y) - 4, y2 = Math.max(A.y + A.h, B.y + B.h) + 4;
    const inLane = [...pos.entries()].filter(([id, n]) => laneOf.get(id) === l && n.y + n.h > y1 && n.y < y2).map(([, n]) => n);
    if (mode === 'back') {
      // sobe pela esquerda da raia: sai pela esquerda do bloco de origem e entra pela esquerda do destino
      const minX = Math.min(...inLane.map((n) => n.x));
      const x = Math.round(Math.max(lx1 + 4, minX - 12));   // mais perto dos blocos que o corredor das passagens entre raias
      // a lateral esquerda da origem (ou do destino) já recebe uma seta vinda da esquerda? então o retorno sobe
      // pela DIREITA da raia — não sai do mesmo ponto em que outra seta chega
      const bId = idOfBox(B);
      const arrivesLeft = (id, N) => flowEdges.some((x) => x.to === id && x.from !== sourceId && x.from !== bId && pos.get(x.from)
        && pos.get(x.from).x + pos.get(x.from).w <= N.x + 1 && Math.abs(pos.get(x.from).y + pos.get(x.from).h / 2 - (N.y + N.h / 2)) < 6);
      if (arrivesLeft(sourceId, A) || arrivesLeft(bId, B)) {
        const maxX = Math.max(...inLane.map((n) => n.x + n.w));
        const xr = Math.round(Math.min(lx2 - 4, maxX + 12));
        const segsR = [[A.x + A.w, ay, xr, ay], [xr, ay, xr, by], [xr, by, B.x + B.w, by]];
        if (xr > maxX + 6 && !hitsAny(segsR, A, B)) return { fromPort: sides.b, toPort: sides.b, points: [[xr, ay], [xr, by]] };
      }
      if (x >= minX - 6) return null;
      const segs = [[A.x, ay, x, ay], [x, ay, x, by], [x, by, B.x, by]];
      if (hitsAny(segs, A, B)) return null;
      return { fromPort: sides.a, toPort: sides.a, points: [[x, ay], [x, by]] };
    }
    // cross: vem de outra raia (esquerda ou direita) até o corredor da raia de destino, desce e entra de lado
    const fromLeft = A.x + A.w / 2 < B.x + B.w / 2;
    const others = inLane.filter((n) => n !== B);
    const edgeX = fromLeft ? Math.min(B.x, ...others.map((n) => n.x)) : Math.max(B.x + B.w, ...others.map((n) => n.x + n.w));
    // cada passagem que já usa o corredor desta raia desloca a próxima 10px (linhas paralelas, nunca sobrepostas)
    // setas que chegam ao MESMO bloco usam a mesma linha do corredor (juntam-se num tronco só, em vez de linhas
    // paralelas quase coladas)
    const ckey = `${l}:${fromLeft}`, used = corridorUse.get(ckey) || 0, tkey = `${ckey}:${laneNodeId}`;
    const shared = corridorTarget.get(tkey);
    const x = shared ?? Math.round(fromLeft ? Math.max(lx1 + 4, edgeX - 44) + used * 10 : Math.min(lx2 - 4, edgeX + 44) - used * 10);
    if (fromLeft ? x >= edgeX - 6 : x <= edgeX + 6) return null;
    const take = (r) => { if (r && shared == null) { corridorUse.set(ckey, used + 1); corridorTarget.set(tkey, x); } return r; };
    const ax = fromLeft ? A.x + A.w : A.x, bx = fromLeft ? B.x : B.x + B.w;
    // losango, ou 1º bloco de uma etapa (fases): entra por cima — a lateral fica livre para os retornos da raia
    const laneHead = phases && !steps.some((o) => o !== laneNodeId && laneOf.get(o) === l && rank.get(o) < rank.get(laneNodeId));
    if (B.shape === 'diamond' || kindOf(laneNodeId) === 'diamond' || laneHead) {
      // losango: as pontas laterais são das saídas Sim/Não — a entrada vem por cima
      const ty = Math.round(B.y - Math.min(22, GAP_MAIN / 2)), cx = Math.round(B.x + B.w / 2);
      const segsD = [[ax, ay, x, ay], [x, ay, x, ty], [x, ty, cx, ty]];
      if (hitsAny(segsD, A, B)) return null;
      return take({ fromPort: fromLeft ? sides.b : sides.a, toPort: sides.bwd, points: [[x, ay], [x, ty], [cx, ty]] });
    }
    const segs = [[ax, ay, x, ay], [x, ay, x, by], [x, by, bx, by]];
    if (!hitsAny(segs, A, B)) return take({ fromPort: fromLeft ? sides.b : sides.a, toPort: fromLeft ? sides.a : sides.b, points: [[x, ay], [x, by]] });
    // caminho direto bloqueado: sai para o corredor da própria raia, passa por uma faixa horizontal livre entre as
    // linhas de blocos e só então desce/sobe no corredor da raia de destino (sempre em 90°)
    const ls = laneOf.get(sourceId);
    if (ls == null) return null;
    const sx1 = OX + laneStart[ls] + 8, sx2 = OX + laneStart[ls] + laneSize[ls] - 8;
    const srcNodes = [...pos.entries()].filter(([id]) => laneOf.get(id) === ls).map(([, n]) => n);
    const x1 = Math.round(fromLeft ? Math.min(sx2 - 4, Math.max(A.x + A.w, ...srcNodes.map((n) => n.x + n.w)) + 18) : Math.max(sx1 + 4, Math.min(A.x, ...srcNodes.map((n) => n.x)) - 18));
    const all = [...pos.values()];
    const levels = [...new Set([Math.min(...all.map((n) => n.y)) - 16, ...all.flatMap((n) => [n.y - 14, n.y + n.h + 14])].map(Math.round))];
    let best = null;
    for (const gy of levels) {
      const path = [[ax, ay, x1, ay], [x1, ay, x1, gy], [x1, gy, x, gy], [x, gy, x, by], [x, by, bx, by]];
      if (hitsAny(path, A, B)) continue;
      const len = Math.abs(gy - ay) + Math.abs(gy - by);
      if (!best || len < best.len) best = { gy, len };
    }
    if (!best) return null;
    return take({ fromPort: fromLeft ? sides.b : sides.a, toPort: fromLeft ? sides.a : sides.b, points: [[x1, ay], [x1, best.gy], [x, best.gy], [x, by]] });
  };
  const corridorUse = new Map();
  const corridorTarget = new Map();
  const routeCache = new Map();
  const laneRouteOnce = (e, A, B, laneNodeId, mode) => {
    const k = `${e.from}>${e.to}:${mode}`;
    if (!routeCache.has(k)) { sourceId = e.from; routeCache.set(k, laneRoute(A, B, laneNodeId, mode)); }
    return routeCache.get(k);
  };
  let sourceId = null;

  // RETORNO para outra raia, mais acima ("Corrigir" → "Analisar", "Não" → "Fazer triagem"): três caminhos possíveis,
  // na ordem de preferência; vale o primeiro que não passa por cima de nenhum bloco e não usa uma ponta já ocupada
  const idOfBox = (n) => [...pos.entries()].find(([, v]) => v === n)?.[0];
  const backCross = (A, B) => {
    const aId = idOfBox(A), bId = idOfBox(B);
    const fromLeft = A.x + A.w / 2 < B.x + B.w / 2;
    const ax = Math.round(A.x + A.w / 2), ay = Math.round(A.y + A.h / 2), by = Math.round(B.y + B.h / 2), bcx = Math.round(B.x + B.w / 2);
    const bSide = fromLeft ? B.x : B.x + B.w, aSide = fromLeft ? A.x + A.w : A.x;
    const topTaken = fwd.some((x) => x.to === aId && laneOf.get(x.from) === laneOf.get(aId) && pos.get(x.from) && pos.get(x.from).y < A.y) || kindOf(aId) === 'diamond';
    // lateral do destino ocupada só se uma seta SAI por ela (chegar junto com outra seta é uma convergência normal)
    const bSideTaken = flowEdges.some((x) => x.from === bId && pos.get(x.to)
      && (fromLeft ? pos.get(x.to).x + 1 < B.x : pos.get(x.to).x > B.x + B.w - 1) && Math.abs(pos.get(x.to).y + pos.get(x.to).h / 2 - by) < 6);
    const bBottomTaken = fwd.some((x) => x.from === bId && pos.get(x.to) && pos.get(x.to).y > B.y + B.h && Math.abs(pos.get(x.to).x + pos.get(x.to).w / 2 - bcx) < 6);
    const aSideTaken = flowEdges.some((x) => (x.from === aId || x.to === aId) && x.to !== bId && pos.get(x.from === aId ? x.to : x.from)
      && Math.abs(pos.get(x.from === aId ? x.to : x.from).y + pos.get(x.from === aId ? x.to : x.from).h / 2 - ay) < 6
      && (fromLeft ? pos.get(x.from === aId ? x.to : x.from).x > A.x + A.w - 1 : pos.get(x.from === aId ? x.to : x.from).x + 1 < A.x));
    // corredor vertical: entre a origem e o destino, fora das divisas de raia
    const sideNodes = [...pos.values()].filter((n) => n !== B && n.y < by + 4 && n.y + n.h > by - 4 && (fromLeft ? n.x + n.w <= B.x : n.x >= B.x + B.w));
    const near = fromLeft ? Math.max(A.x + A.w, ...sideNodes.map((n) => n.x + n.w)) : Math.min(A.x, ...sideNodes.map((n) => n.x));
    let cx = Math.round(fromLeft ? Math.max(near + 24, (near + B.x) / 2) : Math.min(near - 24, (near + B.x + B.w) / 2));
    for (let l = 1; l < nLanes; l++) { const bd = OX + laneStart[l]; if (Math.abs(cx - bd) < 14) cx += fromLeft ? 22 : -22; }
    const cands = [];
    // 1. sai por cima, corredor, entra pela lateral do destino
    if (!topTaken && !bSideTaken && (fromLeft ? cx < B.x - 8 : cx > B.x + B.w + 8)) {
      const levels = [...new Set([A.y - 16, ...[...pos.values()].map((n) => n.y + n.h + 14)].map(Math.round))].filter((y) => y <= A.y - 10 && y > by + 10);
      for (const gy of levels) {
        const path = [[ax, A.y, ax, gy], [ax, gy, cx, gy], [cx, gy, cx, by], [cx, by, bSide, by]];
        if (!hitsAny(path, A, B)) cands.push({ len: Math.abs(A.y - gy) + Math.abs(gy - by), r: { fromPort: sides.bwd, toPort: fromLeft ? sides.a : sides.b, points: [[ax, gy], [cx, gy], [cx, by]] } });
      }
    }
    // 2. sai pela lateral virada para o destino, sobe pelo corredor e entra pela lateral do destino
    if (!aSideTaken && !bSideTaken && (fromLeft ? cx > A.x + A.w + 8 && cx < B.x - 8 : cx < A.x - 8 && cx > B.x + B.w + 8)) {
      const path = [[aSide, ay, cx, ay], [cx, ay, cx, by], [cx, by, bSide, by]];
      if (!hitsAny(path, A, B)) cands.push({ len: Math.abs(ay - by) + 40, r: { fromPort: fromLeft ? sides.b : sides.a, toPort: fromLeft ? sides.a : sides.b, points: [[cx, ay], [cx, by]] } });
    }
    // 3. sai pela lateral, sobe pelo corredor até logo abaixo do destino e entra por BAIXO
    if (!aSideTaken && !bBottomTaken) {
      const gy = Math.round(B.y + B.h + 16);
      const x0 = Math.round(fromLeft ? A.x + A.w + 18 : A.x - 18);
      const path = [[aSide, ay, x0, ay], [x0, ay, x0, gy], [x0, gy, bcx, gy], [bcx, gy, bcx, B.y + B.h]];
      if (gy < ay - 10 && !hitsAny(path, A, B)) cands.push({ len: Math.abs(ay - gy) + Math.abs(x0 - bcx) + 80, r: { fromPort: fromLeft ? sides.b : sides.a, toPort: sides.fwd, points: [[x0, ay], [x0, gy], [bcx, gy]] } });
    }
    // 4. losango com as laterais ocupadas: sai por BAIXO, desce um pouco, vai ao corredor, sobe e entra por baixo do destino
    const aBottomTaken = fwd.some((x) => x.from === aId && pos.get(x.to) && pos.get(x.to).y > A.y + A.h && Math.abs(pos.get(x.to).x + pos.get(x.to).w / 2 - ax) < 6);
    if (!cands.length && !aBottomTaken && !bBottomTaken) {
      const y1 = Math.round(A.y + A.h + 14), gy = Math.round(B.y + B.h + 16);
      const x0 = Math.round(fromLeft ? Math.max(A.x + A.w + 18, cx) : Math.min(A.x - 18, cx));
      const path = [[ax, A.y + A.h, ax, y1], [ax, y1, x0, y1], [x0, y1, x0, gy], [x0, gy, bcx, gy], [bcx, gy, bcx, B.y + B.h]];
      if (gy < y1 - 10 && !hitsAny(path, A, B)) cands.push({ len: 9999, r: { fromPort: sides.fwd, toPort: sides.fwd, points: [[ax, y1], [x0, y1], [x0, gy], [bcx, gy]] } });
    }
    return cands.sort((a, b) => a.len - b.len)[0]?.r || null;
  };

  // ------------------------------------------------------------ setas (ângulo reto, saindo pelo lado certo)
  const edges = [];
  const sides = LR ? { fwd: 'right', bwd: 'left', a: 'top', b: 'bottom' } : { fwd: 'bottom', bwd: 'top', a: 'left', b: 'right' };
  // losango: só UMA saída pela ponta de baixo (a que vai para o bloco logo abaixo); as outras saem pelas laterais
  const bottomExit = new Map();
  for (const id of steps) {
    if (kindOf(id) !== 'diamond') continue;
    const A = pos.get(id), list = flowEdges.filter((e) => e.from === id && !back.has(e) && pos.get(e.to));
    const c = (n) => (LR ? n.y + n.h / 2 : n.x + n.w / 2), m = (n) => (LR ? n.x : n.y);
    const below = list.filter((e) => Math.abs(c(pos.get(e.to)) - c(A)) <= 4).sort((a, b) => m(pos.get(a.to)) - m(pos.get(b.to)));
    if (below.length) bottomExit.set(id, below[0]);
  }
  const usedSide = new Map();
  flowEdges.forEach((e, i) => {
    const A = pos.get(e.from), B = pos.get(e.to);
    if (!A || !B) return;
    const ac = [A.x + A.w / 2, A.y + A.h / 2], bc = [B.x + B.w / 2, B.y + B.h / 2];
    const dMain = LR ? bc[0] - ac[0] : bc[1] - ac[1];
    const dCross = LR ? bc[1] - ac[1] : bc[0] - ac[0];
    const crossSide = dCross > 0 ? sides.b : sides.a;
    let fromPort, toPort, points;
    const handDown = laneCols && laneOf.get(e.from) !== laneOf.get(e.to) && !back.has(e) && dMain > 4
      && (kindOf(e.from) !== 'diamond' || (!bottomExit.has(e.from) && !flowEdges.some((x) => x !== e && x.from === e.from && !back.has(x) && pos.get(x.to) && Math.abs(pos.get(x.to).y + pos.get(x.to).h / 2 - (A.y + A.h / 2)) > 4 && pos.get(x.to).y < B.y)))
      && (() => {
        const ax = Math.round(A.x + A.w / 2), bx = Math.round(B.x + B.w / 2);
        // atravessa logo acima do destino; se houver bloco no caminho, atravessa logo abaixo da origem
        for (const gy of [Math.round(B.y - Math.min(18, GAP_MAIN / 2)), Math.round(A.y + A.h + Math.min(18, GAP_MAIN / 2))]) {
          if (gy <= A.y + A.h + 6 || gy >= B.y - 6) continue;
          const segs = [[ax, A.y + A.h, ax, gy], [Math.min(ax, bx), gy, Math.max(ax, bx), gy], [bx, gy, bx, B.y]];
          if (!hitsAny(segs, A, B)) return [[ax, gy], [bx, gy]];
        }
        return null;
      })();
    // saída lateral de um LOSANGO para outra raia, mais abaixo: sai pela ponta virada para o destino, segue reto até
    // a coluna do destino e desce entrando por cima (junta-se às outras setas que chegam ali — sem cruzá-las)
    const diamondL = !handDown && laneCols && kindOf(e.from) === 'diamond' && laneOf.get(e.from) !== laneOf.get(e.to) && !back.has(e)
      && dMain > 4 && bottomExit.get(e.from) !== e && B.shape !== 'diamond' && (() => {
        const side = dCross > 0 ? sides.b : sides.a;
        if ((usedSide.get(e.from) || new Set()).has(side)) return null;
        const pref = /^n[aã]o\b/i.test(e.label || '') ? sides.a : /^sim\b/i.test(e.label || '') ? sides.b : side;
        if (pref !== side && flowEdges.some((x) => x !== e && x.from === e.from && (/^n[aã]o\b/i.test(x.label || '') ? sides.a : sides.b) === side)) return null;
        const ay = Math.round(A.y + A.h / 2), tx = Math.round(dCross > 0 ? A.x + A.w : A.x), bx = Math.round(B.x + B.w / 2);
        if (dCross > 0 ? bx < tx + 24 : bx > tx - 24) return null;
        const segs = [[tx, ay, bx, ay], [bx, ay, bx, B.y]];
        return hitsAny(segs, A, B) ? null : { side, points: [[bx, ay]] };
      })();
    if (diamondL) {
      fromPort = diamondL.side; toPort = sides.bwd; points = diamondL.points;
    } else if (handDown) {
      // passagem de responsabilidade para uma linha mais abaixo: desce, atravessa as raias logo acima do destino e
      // entra por cima — não volta pela mesma linha da seta que chegou (sem trechos sobrepostos)
      fromPort = sides.fwd; toPort = sides.bwd; points = handDown;
    } else if (columns && laneOf.get(e.from) !== laneOf.get(e.to)) {
      // próxima etapa na coluna ao lado: sai pela direita, sobe pelo corredor entre as colunas e entra pela esquerda
      fromPort = dCross > 0 ? sides.b : sides.a; toPort = dCross > 0 ? sides.a : sides.b;
    } else if (useLanes && !LR && laneOf.get(e.from) === laneOf.get(e.to) && (back.has(e) || dMain < -4) && laneRouteOnce(e, A, B, e.from, 'back')) {
      // raias: retorno dentro da mesma raia sobe pelo canto livre da raia (lado esquerdo) e entra pela lateral
      ({ fromPort, toPort, points } = laneRouteOnce(e, A, B, e.from, 'back'));
    } else if (useLanes && !LR && laneOf.get(e.from) !== laneOf.get(e.to) && (dMain > 4 || (dMain < -4 && !back.has(e))) && (kindOf(e.from) !== 'diamond' || (bottomExit.get(e.from) !== e && !(usedSide.get(e.from) || new Set()).has(B.x > A.x ? sides.b : sides.a))) && laneRouteOnce(e, A, B, e.to, 'cross')) {
      // raias: passagem para outra raia mais abaixo — sai pela lateral, cruza a borda da raia em 90°, desce pelo
      // corredor livre da raia de destino e entra pela LATERAL do bloco (sem atravessar textos)
      ({ fromPort, toPort, points } = laneRouteOnce(e, A, B, e.to, 'cross'));
    } else if (useLanes && !LR && laneOf.get(e.from) !== laneOf.get(e.to) && (back.has(e) || dMain < -4) && backCross(A, B)) {
      // retorno para OUTRA raia, mais acima ("Corrigir solicitação" → "Analisar solicitação"): sai por cima, sobe pelo
      // corredor ao lado do destino e entra pela lateral virada para a origem — sem passar por cima da linha que
      // desce do destino nem da seta que chega na origem
      ({ fromPort, toPort, points } = backCross(A, B));
    } else if (back.has(e) || dMain < -4) {
      // retorno: na mesma coluna faz um "U" pela lateral; em outra coluna sai de lado e entra por baixo
      if (Math.abs(dCross) < 4) { fromPort = sides.a; toPort = sides.a; } else { fromPort = crossSide; toPort = sides.fwd; }
    } else if (Math.abs(dMain) <= 4) {
      fromPort = crossSide; toPort = dCross > 0 ? sides.a : sides.b;
      // mesma linha, mas com bloco no meio: contorna por baixo, pelo corredor entre as linhas
      if (useLanes && !LR && rowBlocked(A, B)) {
        // passa por baixo do bloco do meio, sobe no corredor antes do destino e entra pelo lado (junta com a seta que já chega ali)
        const right = B.x > A.x;
        const y = A.y + A.h / 2;
        const mids = [...pos.values()].filter((n) => n !== A && n !== B && n.y < y && n.y + n.h > y
          && (right ? n.x > A.x && n.x + n.w < B.x : n.x + n.w < A.x && n.x > B.x + B.w));
        // por CIMA dos blocos do meio (se nenhum recebe seta por cima): não cruza as linhas que descem nas raias
        const midIds = [...pos.entries()].filter(([, n]) => mids.includes(n)).map(([id]) => id);
        const topFree = midIds.length && !fwd.some((x) => midIds.includes(x.to) && laneOf.get(x.from) === laneOf.get(x.to));
        if (topFree) {
          const first = right ? mids.reduce((a, b) => (a.x < b.x ? a : b)) : mids.reduce((a, b) => (a.x + a.w > b.x + b.w ? a : b));
          const last = right ? mids.reduce((a, b) => (a.x + a.w > b.x + b.w ? a : b)) : mids.reduce((a, b) => (a.x < b.x ? a : b));
          // a bifurcação fica logo depois do rótulo da saída (o ramo reto mantém o rótulo na ponta do losango)
          const lw = e.label ? measure(decode(e.label), 13, true) + 40 : 30;
          const cx = Math.round(right ? Math.min(first.x - 22, A.x + A.w + lw) : Math.max(first.x + first.w + 22, A.x - lw));
          const gy = Math.round(Math.min(A.y, ...mids.map((n) => n.y)) - 16);
          const mx = Math.round(right ? (last.x + last.w + B.x) / 2 : (last.x + B.x + B.w) / 2);
          const ax = right ? A.x + A.w : A.x, bx = right ? B.x : B.x + B.w, by = B.y + B.h / 2;
          const over = [[ax, y, cx, y], [cx, y, cx, gy], [cx, gy, mx, gy], [mx, gy, mx, by], [mx, by, bx, by]];
          if (!hitsAny(over, A, B) && (right ? cx > ax + 8 : cx < ax - 8)) { fromPort = right ? sides.b : sides.a; toPort = right ? sides.a : sides.b; points = [[cx, y], [cx, gy], [mx, gy], [mx, by]]; }
        }
        if (mids.length && !points) {
          const edgeX = right ? Math.max(...mids.map((n) => n.x + n.w)) : Math.min(...mids.map((n) => n.x));
          const mx = Math.round((edgeX + (right ? B.x : B.x + B.w)) / 2);
          const gy = Math.max(A.y + A.h, ...mids.map((n) => n.y + n.h)) + Math.round(GAP_MAIN / 2);
          const ax = A.x + A.w / 2, by = B.y + B.h / 2;
          const under = [[ax, A.y + A.h, ax, gy], [Math.min(ax, mx), gy, Math.max(ax, mx), gy], [mx, gy, mx, by]];
          if (!hitsAny(under, A, B)) { fromPort = sides.fwd; toPort = right ? sides.a : sides.b; points = [[ax, gy], [mx, gy], [mx, by]]; }
        }
      }
    }
    else if (Math.abs(dCross) <= 4 && (kindOf(e.from) !== 'diamond' || bottomExit.get(e.from) === e)) { fromPort = sides.fwd; toPort = sides.bwd; }
    else if (Math.abs(dCross) <= 4) {
      // segunda saída do losango para baixo: usa uma ponta lateral livre ("Não" à esquerda, "Sim" à direita)
      const pref = /^n[aã]o\b/i.test(e.label) ? sides.a : sides.b;
      const taken = usedSide.get(e.from) || new Set();
      fromPort = taken.has(pref) ? (pref === sides.a ? sides.b : sides.a) : pref;
      toPort = sides.bwd;                                                                        // contorna e entra por cima, junto da linha principal
    }
    else if (useLanes && A.shape !== 'diamond' && !LR && corridorFree(A, B)) {
      // passagem para outra raia mais abaixo: desce, cruza pelo corredor entre as linhas e entra por cima (90°, sem atravessar blocos)
      const gy = A.y + A.h + Math.round(GAP_MAIN / 2);
      fromPort = sides.fwd; toPort = sides.bwd; points = [[A.x + A.w / 2, gy], [B.x + B.w / 2, gy]];
    }
    else if (A.shape === 'diamond' || useLanes) { fromPort = crossSide; toPort = sides.bwd; }     // ramo: sai pela ponta lateral
    else { fromPort = sides.fwd; toPort = sides.bwd; }                                           // converge: desce e entra por cima
    (usedSide.get(e.from) || usedSide.set(e.from, new Set()).get(e.from)).add(fromPort);
    edges.push({ id: 'e' + (i + 1), from: e.from, to: e.to, fromPort, toPort, ...(points ? { points } : {}), label: decode(e.label), kind: 'orth', dashed: e.type.startsWith('-.'), arrowEnd: true, stroke: P.line });
  });
  // losango com várias saídas pela MESMA ponta (ex.: "Qual instalação usar?" → Disco / Digital / Remota): os rótulos
  // ficariam empilhados na ponta; vão para o trecho final de cada seta, junto do destino
  const byPort = new Map();
  for (const e of edges) if (kindOf(e.from) === 'diamond' && e.label) (byPort.get(e.from + ':' + e.fromPort) || byPort.set(e.from + ':' + e.fromPort, []).get(e.from + ':' + e.fromPort)).push(e);
  for (const list of byPort.values()) if (list.length > 1) {
    const straight = list.filter((e) => !e.points);
    list.forEach((e) => { if (e.points || straight.length > 1) e.labelAt = 'end'; });
  }
  let k = 0;
  for (const [n, s] of noteOf) {
    if (!s || !pos.get(s) || !pos.get(n)) continue;
    edges.push({ id: 'n' + (++k), from: s, to: n, fromPort: sides.b, toPort: sides.a, label: '', kind: 'straight', dashed: true, arrowEnd: false, stroke: '#9e9e9e' });
  }
  return { nodes, edges };
}
