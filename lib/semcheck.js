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
  const has = (re) => issues.some((i) => re.test(i.message));
  const list = [];
  const q = (x) => `"${String(x).replace(/<br\/>.*/, '').slice(0, 60)}"`;
  const chk = (id, label, bad, fmt = (x) => x) => list.push({ id, label, ok: !bad.length, detail: bad.length ? bad.slice(0, 3).map(fmt).join('; ') + (bad.length > 3 ? ` (+${bad.length - 3})` : '') : '' });

  // 1. as decisões fazem sentido: pergunta, 2+ saídas rotuladas, sem rótulos repetidos
  chk(1, 'Decisões fazem sentido (pergunta, respostas e saídas)', decisions.filter((d) => {
    const labels = d.outcomes.map((o) => norm(o.answer));
    return d.outcomes.length < 2 || labels.some((l) => !l) || new Set(labels).size < labels.length || !/\?$/.test(d.label);
  }), (d) => q(d.label));
  // 2. respostas opostas não levam ao mesmo destino; a resposta de sucesso não leva a uma correção
  const bad2 = [];
  for (const d of decisions) {
    const tos = d.outcomes.filter((o) => !N.get(o.to)?.label?.match(/^Caminho não descrito/)).map((o) => o.to);
    if (new Set(tos).size < tos.length && !/^(deseja|precisa)\b/i.test(d.label)) bad2.push(`${q(d.label)}: respostas diferentes levam ao mesmo ponto`);
    for (const o of d.outcomes) {
      const to = N.get(o.to);
      if (o.state === 'sucesso' && to && to.type !== 'decision' && !isEndNode(to) && isCorrective(to.label) && o.kind !== 'repetição') bad2.push(`${q(d.label)} ${o.answer} (sucesso) leva a ${q(to.label)}`);
    }
  }
  chk(2, 'Respostas correspondem aos destinos', bad2);
  // 3. sucesso não termina em "Fim sem conclusão"; falha não encerra como sucesso sem nenhuma ação
  const bad3 = [];
  for (const d of decisions) for (const o of d.outcomes) {
    const c = chain(model, flow, o.to);
    const last = c[c.length - 1];
    if (o.state === 'sucesso' && failEnd(last)) bad3.push(`${q(d.label)} ${o.answer} (sucesso) termina em ${q(last.label)}`);
    if (o.state === 'falha' && c[0] && c[0].type !== 'decision' && !isEndNode(c[0]) && isDone(c[0].label)) bad3.push(`${q(d.label)} ${o.answer} (falha) leva a ${q(c[0].label)}`);
  }
  chk(3, 'Caminhos de sucesso e de falha corretos', bad3);
  // 4. atividade condicional no documento ("Se X, faça Y") tem a sua condição no diagrama
  chk(4, 'Ações respeitam o seu contexto (condição preservada)', steps.filter((a) => a.type !== 'decision' && /^\s*(se|caso)\s/i.test(a.source || '') && !a.path.length && !/^\s*(se|caso)\s+(necess|desej|quiser|prefer)/i.test(a.source)), (a) => `${q(a.label)} sem a condição do documento`);
  // 5. responsável adequado: instrução ao leitor não fica com o sistema; decisão humana não fica com o sistema
  const HUMAN_ONLY = /^(decidir|aprovar|reprovar|assinar|analisar|avaliar|conferir|revisar|entrevistar|negociar|autorizar)\b/i;
  const bad5 = steps.filter((a) => a.actor_kind === 'sistema' && (
    (a.type !== 'decision' && (/^(aguarde|acesse|clique|toque|selecione|digite|informe|abra|anexe|envie|preencha|confira|verifique)\b/i.test(String(a.source || '').replace(/^(se|caso)\s[^,]+,\s*/i, '')) || HUMAN_ONLY.test(a.label)))
    // decisão "aprova?" com o sistema só é problema se ninguém do sistema verificou antes (decisão humana)
    || (a.type === 'decision' && /\b(aprov|reprov|decid|autoriz|assin)/i.test(a.label) && !/\bautomatic|\bsistema\b/i.test(a.source || '')
      && !a.in.some((p) => byId.get(p)?.actor_kind === 'sistema'))));
  chk(5, 'Atividades com os responsáveis adequados (humano × sistema)', bad5, (a) => `${q(a.label)} está com ${a.lane}`);
  // 6. descrições sem sentido
  const bad6 = issues.filter((i) => /^Texto a revisar/.test(i.message)).map((i) => i.message.replace(/^Texto a revisar:\s*/, '').replace(/ — .*$/, ''));
  chk(6, 'Descrições claras e completas', bad6);
  // 7. ações duplicadas no mesmo caminho (consecutivas e equivalentes)
  const bad7 = flow.filter((e) => !back.has(e) && N.get(e.from)?.type === 'process' && N.get(e.to)?.type === 'process' && N.get(e.from).group === N.get(e.to).group && redundant(N.get(e.from).label, N.get(e.to).label))
    .map((e) => `${q(N.get(e.from).label)} + ${q(N.get(e.to).label)}`);
  if (has(/aparece \d+ vezes no mesmo caminho/)) bad7.push('atividade repetida no mesmo caminho');
  chk(7, 'Sem ações duplicadas', bad7);
  // 8. continuidade: tudo ligado, alcançável a partir do início e com caminho até um fim
  // (o ponto "Caminho não descrito" é um fim marcado de propósito: entra na verificação 12)
  const loose = A.filter((a) => (a.type !== 'start' && !a.in.length) || (a.type !== 'end' && a.type !== 'doubt' && !/^Caminho não descrito/i.test(a.label) && !a.out.length));
  const bad8 = loose.map((a) => `${q(a.label)} desconectada`);
  if (has(/n[aã]o chega a um fim|caminho que n[aã]o chega/i)) bad8.push('há caminho que não chega a um fim');
  chk(8, 'Procedimento com continuidade lógica', bad8);
  // 9. ciclos: todo retorno precisa de uma decisão com saída (senão é um laço acidental)
  const bad9 = [];
  for (const e of back) {
    // nós do ciclo: alcançáveis a partir do destino do retorno E que chegam até a origem dele
    const fwdR = new Set([e.to]); let st = [e.to];
    while (st.length) { const x = st.pop(); for (const f of flow) if (f.from === x && !back.has(f) && !fwdR.has(f.to)) { fwdR.add(f.to); st.push(f.to); } }
    const bwdR = new Set([e.from]); st = [e.from];
    while (st.length) { const x = st.pop(); for (const f of flow) if (f.to === x && !back.has(f) && !bwdR.has(f.from)) { bwdR.add(f.from); st.push(f.from); } }
    const inCycle = new Set([...fwdR].filter((x) => bwdR.has(x)));
    const exits = [...inCycle].some((id) => N.get(id)?.type === 'decision' && flow.some((f) => f.from === id && !inCycle.has(f.to)));
    if (!exits || !inCycle.has(e.from)) {
      if (!exits) bad9.push(`retorno ${q(N.get(e.from)?.label)} → ${q(N.get(e.to)?.label)} sem condição de saída`);
    }
  }
  if (has(/la[cç]o sem sa[ií]da/i)) bad9.push('laço sem saída');
  chk(9, 'Sem ciclos acidentais', bad9);
  // 10. encerramentos: um início, fins com entrada; "Fim sem conclusão" só depois de falha
  const starts = A.filter((a) => a.type === 'start'), ends = A.filter((a) => a.type === 'end');
  const bad10 = [];
  if (starts.length !== 1) bad10.push(`${starts.length} inícios`);
  if (!ends.length) bad10.push('sem fim');
  for (const e of ends) if (!e.in.length) bad10.push(`${q(e.label)} sem entrada`);
  chk(10, 'Encerramentos coerentes', bad10);
  // 11. recomendações / observações / explicações não viraram etapas
  chk(11, 'Recomendações não viraram etapas', steps.filter((a) => a.type !== 'decision' && ['recomendação', 'observação', 'explicativa'].includes(a.source_category)), (a) => q(a.label));
  // 12. condições obrigatórias com tratamento (nenhum caminho "não descrito")
  const bad12 = A.filter((a) => /^Caminho não descrito/i.test(a.label)).map((a) => {
    const d = flow.find((e) => e.to === a.id);
    return d ? `${q(N.get(d.from)?.label)} ${d.label || ''}`.trim() : q(a.label);
  });
  chk(12, 'Condições com tratamento descrito', bad12);
  // 13. atividade específica de uma alternativa não aparece em caminhos de outras alternativas
  const bad13 = [];
  for (const d of decisions.filter((x) => x.outcomes.length >= 2 && x.outcomes.every((o) => !/^(sim|n[aã]o)$/i.test(o.answer)))) {
    const keys = d.outcomes.map((o) => ({ ans: o.answer, key: norm(o.answer).replace(/^(o|a|pelo|pela|por|via)\s+/, '') })).filter((k) => k.key.length >= 3);
    for (const a of steps) {
      if (a.type === 'decision' || a.id === d.id) continue;
      const t = ` ${norm(a.label)} `;
      const hits = keys.filter((k) => t.includes(` ${k.key} `));
      if (hits.length !== 1) continue;
      const own = a.path.find((c) => c.decision === d.id);
      const guarded = a.path.some((c) => byId.get(c.decision)?.label && norm(byId.get(c.decision).label).includes(hits[0].key));
      // depois da convergência das alternativas (sem a condição da alternativa no caminho) = aplicado a todos
      const after = !own && !guarded && flow.some((e) => e.from === d.id) && a.in.length && reachable(flow, d.id, a.id);
      if (after) bad13.push(`${q(a.label)} só vale para "${hits[0].ans}"`);
      else if (own && norm(own.answer) !== norm(hits[0].ans)) bad13.push(`${q(a.label)} está no caminho "${own.answer}"`);
    }
  }
  chk(13, 'Atividades específicas só nos caminhos compatíveis', bad13);
  // 14. fidelidade: nada omitido, opcionais preservados, raias com base no documento
  const bad14 = [];
  if (has(/omiss/i)) bad14.push('há instruções do documento sem bloco (veja os avisos de omissão)');
  const optAsMand = steps.filter((a) => a.source_category === 'opcional' && !['opcional', 'condicional'].includes(a.category) && a.type !== 'decision');
  for (const a of optAsMand.slice(0, 2)) bad14.push(`${q(a.label)} é opcional no documento`);
  const T = norm(ctx.text || '');
  for (const l of fm.lanes.filter((x) => !x.generic && !x.system)) if (T && !T.includes(norm(l.title).split(' ')[0].replace(/(es|s)$/, ''))) bad14.push(`raia "${l.title}" não aparece no texto`);
  chk(14, 'Fidelidade ao documento', bad14);
  return list;
}

function reachable(flow, a, b) {
  const seen = new Set([a]); const st = [a];
  while (st.length) { const x = st.pop(); for (const e of flow) if (e.from === x && !seen.has(e.to)) { if (e.to === b) return true; seen.add(e.to); st.push(e.to); } }
  return false;
}

module.exports = { enrich, checks };
