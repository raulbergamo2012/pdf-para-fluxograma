'use strict';
/**
 * Validação SEMÂNTICA do Fluxograma Funcional, feita sobre a estrutura intermediária (antes de desenhar).
 *
 * enrich(fm, model): acrescenta a cada atividade
 *   - actor_kind ......... humano | sistema | não identificado
 *   - path ............... condições necessárias para chegar até ela ([{ decision, answer }], de todos os caminhos)
 *   - condition .......... (decisões) expressão normalizada { subject, predicate, negated, state } e decision_kind
 *   - outcomes ........... (decisões) cada resposta → destino e o tipo do resultado
 *                          (sucesso, falha, continuidade, repetição, encerramento)
 * checks(fm, model, issues, ctx): as 14 verificações; as que falham viram avisos na aba Análise.
 */
const { condition, opposite, isCorrective, isDone, norm, redundant } = require('./semantics');

const isEndNode = (n) => n && n.type === 'end';
const failEnd = (n) => isEndNode(n) && /sem conclus|n[aã]o conclu|cancel|interromp/i.test(n.label || '');

function enrich(fm, model) {
  const N = model.nodes;
  const flow = model.edges.filter((e) => N.get(e.to)?.type !== 'note' && N.get(e.from)?.type !== 'note');
  const start = [...N.values()].find((n) => n.type === 'start');
  // ordem de visita (DFS) para separar avanços de retornos
  const order = new Map(); const onStack = new Set(); const back = new Set();
  const dfs = (id) => {
    order.set(id, order.size); onStack.add(id);
    for (const e of flow.filter((x) => x.from === id)) {
      if (onStack.has(e.to)) back.add(e);
      else if (!order.has(e.to)) dfs(e.to);
    }
    onStack.delete(id);
  };
  if (start) dfs(start.id);
  const fwd = flow.filter((e) => !back.has(e));
  // condições que valem em TODOS os caminhos até o nó (interseção pelas entradas)
  const path = new Map();
  const topo = [...order.keys()].sort((a, b) => order.get(a) - order.get(b));
  const key = (c) => c.decision + '=' + c.answer;
  for (let pass = 0; pass < 3; pass++) {
    for (const id of topo) {
      if (start && id === start.id) { path.set(id, []); continue; }
      const ins = fwd.filter((e) => e.to === id && path.has(e.from));
      if (!ins.length) continue;
      const sets = ins.map((e) => {
        const base = path.get(e.from) || [];
        return N.get(e.from)?.type === 'decision' && e.label ? [...base.filter((c) => c.decision !== e.from), { decision: e.from, answer: e.label }] : base;
      });
      path.set(id, sets[0].filter((c) => sets.every((s) => s.some((x) => key(x) === key(c)))));
    }
  }
  const laneSys = new Map(fm.lanes.map((l) => [l.id, l]));
  for (const a of fm.activities) {
    const l = laneSys.get(a.lane_id);
    a.actor_kind = !l ? '' : l.generic ? 'não identificado' : l.system ? 'sistema' : 'humano';
    a.path = (path.get(a.id) || []).map((c) => ({ decision: c.decision, question: N.get(c.decision)?.label || '', answer: c.answer }));
    if (a.type !== 'decision') continue;
    const cond = condition(a.label);
    a.condition = { expr: `${cond.negated ? 'NÃO ' : ''}${cond.subject} ${cond.predicate}`.trim(), subject: cond.subject, predicate: cond.predicate, negated: cond.negated, state: cond.state };
    a.decision_kind = a.actor_kind === 'sistema' ? 'automatizada' : a.actor_kind === 'humano' ? 'humana' : 'não identificada';
    a.outcomes = flow.filter((e) => e.from === a.id).map((e) => {
      const to = N.get(e.to);
      const st = /^sim$/i.test(e.label) ? cond.state : /^n[aã]o$/i.test(e.label) ? opposite(cond.state) : 'neutro';
      const kind = back.has(e) ? 'repetição' : isEndNode(to) ? 'encerramento' : st === 'sucesso' ? 'sucesso' : st === 'falha' ? 'falha' : 'continuidade';
      return { answer: e.label || '', state: st, kind, to: e.to, to_label: to?.label || '' };
    });
  }
  return { back, fwd, flow };
}

/** caminho linear a partir de um nó (até a próxima decisão, fim ou junção) */
function chain(model, flow, id, max = 8) {
  const out = [];
  let cur = id;
  for (let i = 0; i < max && cur; i++) {
    const n = model.nodes.get(cur);
    if (!n) break;
    out.push(n);
    if (n.type === 'decision' || n.type === 'end') break;
    const nx = flow.filter((e) => e.from === cur);
    if (nx.length !== 1) break;
    cur = nx[0].to;
  }
  return out;
}

function checks(fm, model, issues, ctx = {}) {
  const { flow, back } = enrich(fm, model);
  const N = model.nodes;
  const A = fm.activities, byId = new Map(A.map((a) => [a.id, a]));
  const steps = A.filter((a) => !['start', 'end', 'note'].includes(a.type));
  const decisions = A.filter((a) => a.type === 'decision');
  const fwd = flow.filter((e) => !back.has(e));
  const has = (re) => issues.some((i) => re.test(i.message));
  const list = [];
  const q = (x) => `"${String(x).replace(/<br\/>.*/, '').slice(0, 60)}"`;
  // bad → falha (vira aviso); info → passou, mas com ausências sinalizadas
  const chk = (id, label, bad, fmt = (x) => x, info = []) => list.push({ id, label, ok: !bad.length,
    detail: (bad.length ? bad : info).slice(0, 3).map(fmt).join('; ') + ((bad.length || info.length) > 3 ? ` (+${(bad.length || info.length) - 3})` : '') });
  const outcomeOf = (c) => byId.get(c.decision)?.outcomes?.find((o) => o.answer === c.answer);
  const isChoice = (d) => d.outcomes.length >= 2 && d.outcomes.every((o) => !/^(sim|n[aã]o)$/i.test(o.answer));
  const inFailure = (d) => d.path.some((c) => outcomeOf(c)?.state === 'falha');

  // 1. métodos alternativos: atividades exclusivas de um método não se ligam às de outro método
  const bad1 = [];
  for (const d of decisions.filter(isChoice)) {
    const own = (a) => a.path.find((c) => c.decision === d.id)?.answer;
    for (const e of fwd) {
      const x = byId.get(e.from), y = byId.get(e.to);
      if (!x || !y) continue;
      const ax = own(x), ay = own(y);
      if (ax && ay && norm(ax) !== norm(ay)) bad1.push(`${q(x.label)} (${ax}) → ${q(y.label)} (${ay})`);
    }
    // um método inteiro executado depois de outro (métodos em sequência em vez de escolha)
    const firsts = d.outcomes.map((o) => o.to);
    for (const f of firsts) for (const g of firsts) if (f !== g && reachable(fwd, f, g) && !reachable(fwd, g, f)) {
      const conv = byId.get(g);
      if (conv && conv.path.some((c) => c.decision === d.id)) bad1.push(`o caminho de ${q(byId.get(f)?.label)} segue para outro método`);
    }
  }
  chk(1, 'Métodos alternativos ligados corretamente (cada um no seu caminho)', [...new Set(bad1)]);

  // 2. perguntas coerentes (não são títulos/numeração; têm respostas e saídas)
  const titles = (ctx.titles || []).map((t) => norm(t)).filter((t) => t.length >= 6);
  const titleLike = (d) => /^\s*\d+(\.\d+)*[.):]?\s/.test(d.label) || /\b(passo|etapa|se[cç][aã]o|fase|parte|m[eé]todo)\s+\d+\b/i.test(d.label)
    || titles.some((t) => norm(d.label).replace(/\s*(ok|concluid[oa]|finalizad[oa])?$/, '') === t);
  chk(2, 'Perguntas das decisões coerentes', decisions.filter((d) => {
    const labels = d.outcomes.map((o) => norm(o.answer));
    return d.outcomes.length < 2 || labels.some((l) => !l) || new Set(labels).size < labels.length || !/\?$/.test(d.label) || titleLike(d);
  }), (d) => q(d.label) + (titleLike(d) ? ' (título/numeração usado como pergunta)' : d.outcomes.length < 2 ? ' (uma saída só)' : ''));

  // 3. Sim/Não sem inversão: respostas opostas não levam ao mesmo ponto; sucesso não leva a correção; falha não leva a conclusão
  const bad3 = [];
  for (const d of decisions) {
    const tos = d.outcomes.filter((o) => !/^Caminho não descrito/.test(N.get(o.to)?.label || '')).map((o) => o.to);
    if (new Set(tos).size < tos.length && !/^(deseja|precisa)\b/i.test(d.label)) bad3.push(`${q(d.label)}: respostas diferentes levam ao mesmo ponto`);
    if (inFailure(d)) continue;
    for (const o of d.outcomes) {
      const to = N.get(o.to);
      if (!to || to.type === 'decision' || isEndNode(to) || o.kind === 'repetição') continue;
      if (o.state === 'sucesso' && isCorrective(to.label)) bad3.push(`${q(d.label)} ${o.answer} = sucesso, mas leva a ${q(to.label)}`);
      if (o.state === 'falha' && isDone(to.label)) bad3.push(`${q(d.label)} ${o.answer} = falha, mas leva a ${q(to.label)}`);
    }
  }
  chk(3, 'Saídas Sim/Não sem inversão (cada resposta no destino certo)', bad3);

  // 4. continuidade: nada solto/inalcançável; ausências do documento ficam SINALIZADAS (não inventadas)
  const loose = A.filter((a) => (a.type !== 'start' && !a.in.length) || (a.type !== 'end' && a.type !== 'doubt' && !/^Caminho não descrito/i.test(a.label) && !a.out.length));
  const bad4 = loose.map((a) => `${q(a.label)} desconectada`);
  if (has(/n[aã]o chega a um fim|caminho que n[aã]o chega/i)) bad4.push('há caminho que não chega a um fim');
  const info4 = [
    ...A.filter((a) => /^Caminho não descrito/i.test(a.label)).map((a) => { const e = flow.find((x) => x.to === a.id); return e ? `${q(N.get(e.from)?.label)} ${e.label || ''}: caminho não descrito`.trim() : q(a.label); }),
    ...issues.filter((i) => /não diz o que acontece depois|não descreve a continuidade/.test(i.message)).map((i) => i.message.replace(/:.*$/, '').slice(0, 80)),
  ];
  chk(4, 'Caminhos com continuidade (ausências do documento sinalizadas)', bad4, (x) => x, info4);

  // 5. atividade exclusiva de um método só no caminho dele; atividade condicional mantém a sua condição
  const bad5 = [];
  for (const d of decisions.filter(isChoice)) {
    const keys = d.outcomes.map((o) => ({ ans: o.answer, key: norm(o.answer).replace(/^(o|a|pelo|pela|por|via)\s+/, '') })).filter((k) => k.key.length >= 3);
    for (const a of steps) {
      if (a.type === 'decision' || a.id === d.id) continue;
      const t = ` ${norm(a.label)} `;
      const hits = keys.filter((k) => t.includes(` ${k.key} `));
      if (hits.length !== 1) continue;
      const own = a.path.find((c) => c.decision === d.id);
      const guarded = a.path.some((c) => byId.get(c.decision)?.label && norm(byId.get(c.decision).label).includes(hits[0].key));
      if (!own && !guarded && a.in.length && reachable(flow, d.id, a.id)) bad5.push(`${q(a.label)} só vale para "${hits[0].ans}"`);
      else if (own && norm(own.answer) !== norm(hits[0].ans)) bad5.push(`${q(a.label)} está no caminho "${own.answer}"`);
    }
  }
  for (const a of steps) if (a.type !== 'decision' && /^\s*(se|caso)\s/i.test(a.source || '') && !a.path.length && !/^\s*(se|caso)\s+(necess|desej|quiser|prefer)/i.test(a.source)) bad5.push(`${q(a.label)} sem a condição do documento`);
  chk(5, 'Atividades exclusivas só nos caminhos compatíveis', bad5);

  // 6. convergência justificada: um caminho de FALHA só se junta ao de sucesso depois de uma correção
  const bad6 = [];
  for (const n of A) {
    const ins = fwd.filter((e) => e.to === n.id);
    if (ins.length < 2 || n.type === 'end') continue;
    const via = ins.map((e) => {
      const src = byId.get(e.from);
      const conds = [...(src?.path || [])];
      if (src?.type === 'decision' && e.label) conds.push({ decision: src.id, answer: e.label });
      return { e, conds, src };
    });
    for (const a of via) for (const b of via) {
      if (a === b) continue;
      for (const c of a.conds) {
        const oa = outcomeOf(c); if (!oa || oa.state !== 'falha') continue;
        const cb = b.conds.find((x) => x.decision === c.decision && x.answer !== c.answer);
        const ob = cb && outcomeOf(cb);
        if (!ob || ob.state !== 'sucesso') continue;
        // houve correção no caminho de falha? (alguma atividade corretiva entre a decisão e a junção)
        const fixed = A.some((x) => x.type !== 'decision' && isCorrective(x.label) && x.path.some((p) => p.decision === c.decision && p.answer === c.answer) && reachable(fwd, x.id, n.id));
        if (!fixed && !/^(deseja|precisa)\b/i.test(byId.get(c.decision)?.label || '')) bad6.push(`falha de ${q(byId.get(c.decision)?.label)} junta-se ao sucesso em ${q(n.label)} sem correção`);
      }
    }
  }
  chk(6, 'Convergências justificadas', [...new Set(bad6)]);

  // 7. opcionais / recomendações / observações não viraram atividades obrigatórias
  const bad7 = [
    ...steps.filter((a) => a.type !== 'decision' && ['recomendação', 'observação', 'explicativa'].includes(a.source_category)).map((a) => `${q(a.label)} é ${a.source_category} no documento`),
    ...steps.filter((a) => a.source_category === 'opcional' && !['opcional', 'condicional'].includes(a.category) && a.type !== 'decision' && !a.path.length).map((a) => `${q(a.label)} é opcional no documento`),
  ];
  chk(7, 'Opcionais e recomendações não viraram obrigatórias', bad7);

  // 8. duplicadas no mesmo caminho
  const bad8 = fwd.filter((e) => N.get(e.from)?.type === 'process' && N.get(e.to)?.type === 'process' && N.get(e.from).group === N.get(e.to).group && redundant(N.get(e.from).label, N.get(e.to).label))
    .map((e) => `${q(N.get(e.from).label)} + ${q(N.get(e.to).label)}`);
  if (has(/aparece \d+ vezes no mesmo caminho/)) bad8.push('atividade repetida no mesmo caminho');
  chk(8, 'Sem atividades duplicadas', bad8);

  // 9. dependências: "Após X, faça Y" → X vem antes de Y
  const bad9 = [];
  for (const a of steps) {
    const m = /^\s*(?:ap[oó]s|depois de|depois que|assim que|quando terminar|ao terminar|ao concluir|uma vez que)\s+([^,]{3,60}),/i.exec(a.source || '');
    if (!m) continue;
    const key = norm(m[1]).split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5));
    if (!key.length) continue;
    const dep = steps.find((x) => x.id !== a.id && x.type !== 'decision' && key.some((k) => norm(x.label).split(' ').some((w) => w.slice(0, 5) === k)) && norm(x.label).split(' ')[0].slice(0, 5) === key[0]);
    if (dep && !reachable(fwd, dep.id, a.id) && !reachable(flow, dep.id, a.id)) bad9.push(`${q(a.label)} depende de ${q(dep.label)}, que não vem antes`);
  }
  chk(9, 'Dependências respeitadas (o que precisa vir antes vem antes)', bad9);

  // 10. descrições completas e fiéis (texto a revisar, instruções omitidas, raias que não estão no texto)
  const bad10 = issues.filter((i) => /^Texto a revisar/.test(i.message)).map((i) => i.message.replace(/^Texto a revisar:\s*/, '').replace(/ — .*$/, ''));
  if (has(/omiss/i)) bad10.push('há instruções do documento sem bloco (veja os avisos de omissão)');
  const T = norm(ctx.text || '');
  for (const l of fm.lanes.filter((x) => !x.generic && !x.system)) if (T && !T.includes(norm(l.title).split(' ')[0].replace(/(es|s)$/, ''))) bad10.push(`raia "${l.title}" não aparece no texto`);
  chk(10, 'Descrições completas e fiéis ao documento', bad10);

  // 11. responsáveis: instrução ao leitor não fica com o sistema; decisão humana não fica com o sistema
  const HUMAN_ONLY = /^(decidir|aprovar|reprovar|assinar|analisar|avaliar|conferir|revisar|entrevistar|negociar|autorizar)\b/i;
  const bad11 = steps.filter((a) => a.actor_kind === 'sistema' && (
    (a.type !== 'decision' && (/^(aguarde|acesse|clique|toque|selecione|digite|informe|abra|anexe|envie|preencha|confira|verifique)\b/i.test(String(a.source || '').replace(/^(se|caso)\s[^,]+,\s*/i, '')) || HUMAN_ONLY.test(a.label)))
    || (a.type === 'decision' && /\b(aprov|reprov|decid|autoriz|assin)/i.test(a.label) && !/\bautomatic|\bsistema\b/i.test(a.source || '') && !a.in.some((p) => byId.get(p)?.actor_kind === 'sistema'))))
    .map((a) => `${q(a.label)} está com ${a.lane}`);
  chk(11, 'Responsáveis atribuídos corretamente (humano × automático)', bad11);

  // 12. conexões válidas
  const bad12 = [];
  for (const e of flow) {
    const f = N.get(e.from), t = N.get(e.to);
    if (!f || !t) { bad12.push(`ligação para bloco inexistente (${e.from} → ${e.to})`); continue; }
    if (f.type === 'end') bad12.push(`${q(f.label)} tem saída`);
    if (t.type === 'start') bad12.push(`${q(t.label)} tem entrada`);
    if (e.from === e.to) bad12.push(`${q(f.label)} liga a si mesma`);
    if (f.type === 'decision' && !e.label) bad12.push(`saída sem resposta em ${q(f.label)}`);
  }
  chk(12, 'Conexões válidas', [...new Set(bad12)]);

  // 13. encerramentos: um início, fins com entrada; sucesso não termina em "Fim sem conclusão"
  const starts = A.filter((a) => a.type === 'start'), ends = A.filter((a) => a.type === 'end');
  const bad13 = [];
  if (starts.length !== 1) bad13.push(`${starts.length} inícios`);
  if (!ends.length) bad13.push('sem fim');
  for (const e of ends) if (!e.in.length) bad13.push(`${q(e.label)} sem entrada`);
  for (const d of decisions) {
    if (inFailure(d)) continue;
    for (const o of d.outcomes) {
      const c = chain(model, flow, o.to);
      const last = c[c.length - 1];
      if (o.state === 'sucesso' && failEnd(last)) bad13.push(`${q(d.label)} ${o.answer} (sucesso) termina em ${q(last.label)}`);
    }
  }
  chk(13, 'Encerramentos coerentes', bad13);

  // 14. ciclos: todo retorno precisa de uma decisão com saída
  const bad14 = [];
  for (const e of back) {
    const fwdR = new Set([e.to]); let st = [e.to];
    while (st.length) { const x = st.pop(); for (const f of flow) if (f.from === x && !back.has(f) && !fwdR.has(f.to)) { fwdR.add(f.to); st.push(f.to); } }
    const bwdR = new Set([e.from]); st = [e.from];
    while (st.length) { const x = st.pop(); for (const f of flow) if (f.to === x && !back.has(f) && !bwdR.has(f.from)) { bwdR.add(f.from); st.push(f.from); } }
    const inCycle = new Set([...fwdR].filter((x) => bwdR.has(x)));
    const exits = [...inCycle].some((id) => N.get(id)?.type === 'decision' && flow.some((f) => f.from === id && !inCycle.has(f.to)));
    if (!exits) bad14.push(`retorno ${q(N.get(e.from)?.label)} → ${q(N.get(e.to)?.label)} sem condição de saída`);
  }
  if (has(/la[cç]o sem sa[ií]da/i)) bad14.push('laço sem saída');
  chk(14, 'Sem ciclos acidentais', bad14);
  return list;
}

function reachable(flow, a, b) {
  const seen = new Set([a]); const st = [a];
  while (st.length) { const x = st.pop(); for (const e of flow) if (e.from === x && !seen.has(e.to)) { if (e.to === b) return true; seen.add(e.to); st.push(e.to); } }
  return false;
}

module.exports = { enrich, checks };
