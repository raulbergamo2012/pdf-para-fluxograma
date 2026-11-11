'use strict';
/**
 * CAMADA 4 — Validação lógica e estrutural (antes de exibir o fluxograma)
 *
 * validateModel(model, { text, type }) verifica o modelo estruturado (lib/model.js), CORRIGE o que for seguro e
 * devolve { model, issues[] }. Cada issue: { level: 'corrigido' | 'aviso' | 'erro', message }.
 *  - início e fim existem (cria se faltar);
 *  - ligações para nós inexistentes, auto-ligações e ligações repetidas (remove);
 *  - atividades desconectadas (sem entrada → ligadas ao passo anterior; sem saída → seguem para o próximo passo ou Fim);
 *  - decisões: perguntas com "?", pelo menos 2 saídas e saídas identificadas (Sim/Não);
 *  - laços sem condição de saída (aviso) e caminhos que não chegam a um fim;
 *  - passos duplicados em sequência (junta);
 *  - passos do documento que não aparecem no diagrama (possível omissão — aviso);
 *  - dúvidas marcadas pela interpretação (aviso).
 * Se sobrar erro grave, o app mostra o aviso em destaque em vez de apresentar o fluxograma como validado.
 */
const { nextId } = require('./model');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<br\s*\/?>.*/i, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('para com sem pelo pela pelos pelas como mais menos cada todo toda todos todas outro outra antes depois quando onde voce seu sua seus suas este esta esse essa isso aqui sobre entre apos caso seja sera tiver houver estiver forem clique clicar abra abrir'.split(' '));
const stems = (s) => norm(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, Math.max(4, Math.min(w.length - 2, 6))));
const short = (s) => { const t = String(s).replace(/<br\s*\/?>.*/i, ''); return t.length > 60 ? t.slice(0, 57) + '…' : t; };

function validateModel(model, ctx = {}) {
  const issues = [];
  const fix = (message) => issues.push({ level: 'corrigido', message });
  const warn = (message) => issues.push({ level: 'aviso', message });
  const fail = (message) => issues.push({ level: 'erro', message });
  const N = model.nodes;
  const flow = (e) => e.style !== '-.-';                              // ligação de nota não é fluxo
  const outs = (id) => model.edges.filter((e) => e.from === id && flow(e));
  const ins = (id) => model.edges.filter((e) => e.to === id && flow(e));
  const ordered = () => [...N.values()].sort((a, b) => a.order - b.order);
  const isTerminalType = (n) => n.type === 'end' || n.type === 'doubt' || n.type === 'note';

  // 1. ligações quebradas, auto-ligações e repetidas
  const seen = new Set();
  model.edges = model.edges.filter((e) => {
    if (!N.has(e.from) || !N.has(e.to)) { fix(`Ligação para um elemento inexistente removida (${e.from} → ${e.to}).`); return false; }
    if (e.from === e.to) { fix(`Ligação de "${short(N.get(e.from).label)}" para ele mesmo removida.`); return false; }
    const k = `${e.from}>${e.to}>${e.label}`;
    if (seen.has(k)) { fix(`Ligação repetida removida ("${short(N.get(e.from).label)}" → "${short(N.get(e.to).label)}").`); return false; }
    seen.add(k);
    return true;
  });
  for (const n of N.values()) if (n.bare && !/^(INICIO|FIM)/i.test(n.id)) warn(`O elemento "${n.id}" não tem texto.`);

  // 2. início e fim
  let start = [...N.values()].find((n) => n.type === 'start');
  if (!start) {
    const id = N.has('INICIO') ? nextId(model, 'INICIO') : 'INICIO';
    const first = ordered().find((n) => n.type !== 'note' && !ins(n.id).length);
    start = { id, type: 'start', open: '([', close: '])', label: 'Início', group: first?.group || null, order: -1, classes: new Set(['inicioFim']) };
    N.set(id, start);
    if (first) model.edges.unshift({ from: id, to: first.id, style: '-->', label: '' });
    fix('O diagrama não tinha ponto de início: "Início" foi incluído.');
  }
  let end = [...N.values()].find((n) => n.type === 'end');
  const ensureEnd = () => {
    if (end) return end;
    const id = N.has('FIM') ? nextId(model, 'FIM') : 'FIM';
    const last = ordered().filter((n) => n.type !== 'note').pop();
    end = { id, type: 'end', open: '([', close: '])', label: 'Fim', group: last?.group || null, order: 1e6, classes: new Set(['inicioFim']) };
    N.set(id, end);
    fix('O diagrama não tinha ponto de fim: "Fim" foi incluído.');
    return end;
  };

  // 3. decisões: pergunta, nº de saídas e rótulos
  for (const n of N.values()) {
    if (n.type !== 'decision') continue;
    if (!/\?\s*$/.test(n.label)) { n.label = n.label.replace(/[.:;]+$/, '') + '?'; fix(`Pergunta da decisão ajustada: "${short(n.label)}".`); }
    const o = outs(n.id);
    if (o.length < 2) {
      if (o.length === 1 && !o[0].label) o[0].label = 'Sim';
      warn(`A decisão "${short(n.label)}" tem só ${o.length} saída${o.length === 1 ? '' : 's'}: o documento não descreve o outro caminho.`);
    }
    const unlabeled = o.filter((e) => !e.label);
    if (unlabeled.length && o.length === 2) {
      const used = o.map((e) => e.label);
      unlabeled.forEach((e) => { e.label = used.includes('Sim') ? 'Não' : used.includes('Não') ? 'Sim' : (used.push('Sim'), 'Sim'); used.push(e.label); });
      fix(`Saídas da decisão "${short(n.label)}" identificadas como Sim/Não.`);
    } else if (unlabeled.length) warn(`A decisão "${short(n.label)}" tem saídas sem identificação.`);
  }

  // 4. passos duplicados em sequência (A → B com o mesmo texto) → um só
  for (const e of [...model.edges]) {
    const a = N.get(e.from), b = N.get(e.to);
    // mesmo passo com outro verbo de navegação ("Acessar loja de aplicativos" → "Abrir loja de aplicativos") também conta
    const nav = (l) => norm(String(l).replace(/<br\s*\/?>.*$/i, '')).replace(/^(acessar|abrir|entrar( em| no| na)?|ir( ate| para)?)\s+/, 'abrir ')
      .replace(/\b(do seu|da sua|do|da|de|seu|sua)\s+(celular|computador|pc|aparelho|dispositivo|smartphone)$/, '').trim();
    if (!a || !b || a.type !== 'process' || b.type !== 'process' || (norm(a.label) !== norm(b.label) && nav(a.label) !== nav(b.label))) continue;
    if (outs(a.id).length !== 1 || ins(b.id).length !== 1) continue;
    model.edges = model.edges.filter((x) => x !== e);
    model.edges.forEach((x) => { if (x.from === b.id) x.from = a.id; });
    N.delete(b.id);
    fix(`Passo duplicado em sequência removido: "${short(a.label)}".`);
  }
  // passos com o mesmo texto em pontos diferentes (podem ser legítimos, só avisa)
  const byLabel = new Map();
  for (const n of N.values()) if (n.type === 'process' || n.type === 'io') { const k = norm(n.label); if (k) (byLabel.get(k) || byLabel.set(k, []).get(k)).push(n); }
  // no Funcional, a mesma atividade em raias diferentes é de responsáveis diferentes (ex.: vendas e suporte
  // respondem ao cliente) — legítimo, sem aviso
  for (const [, list] of byLabel) if (list.length > 1 && new Set(list.map((n) => n.group || '')).size < list.length) warn(`A atividade "${short(list[0].label)}" aparece ${list.length} vezes no diagrama.`);

  // 5. atividades sem entrada (desconectadas) → ligadas ao passo anterior sem continuação
  for (const n of ordered()) {
    if (n.type === 'start' || n.type === 'note' || ins(n.id).length) continue;
    const prev = ordered().filter((p) => p.order < n.order && p.type !== 'note' && !isTerminalType(p) && p.id !== n.id).reverse().find((p) => !outs(p.id).length) || null;
    if (prev) { model.edges.push({ from: prev.id, to: n.id, style: '-->', label: '' }); fix(`"${short(n.label)}" estava desconectado e foi ligado depois de "${short(prev.label)}".`); }
    else if (n.type !== 'end') { model.edges.push({ from: start.id, to: n.id, style: '-->', label: '' }); warn(`"${short(n.label)}" não tinha ligação de entrada; foi ligado ao Início — confira a posição.`); }
  }
  // 6. atividades sem saída → próxima atividade sem entrada ou Fim
  for (const n of ordered()) {
    if (isTerminalType(n) || outs(n.id).length) continue;
    const nxt = ordered().find((p) => p.order > n.order && p.type !== 'note' && p.type !== 'start' && !ins(p.id).length);
    if (nxt) { model.edges.push({ from: n.id, to: nxt.id, style: '-->', label: n.type === 'decision' ? 'Não' : '' }); fix(`"${short(n.label)}" não tinha continuação e foi ligado a "${short(nxt.label)}".`); }
    else { const f = ensureEnd(); model.edges.push({ from: n.id, to: f.id, style: '-->', label: '' }); fix(`"${short(n.label)}" não tinha continuação e foi ligado ao Fim.`); }
  }

  // 7. alcance: tudo é alcançável a partir do início? todo caminho chega a um fim?
  const reach = new Set([start.id]); const q = [start.id];
  while (q.length) { const id = q.shift(); for (const e of outs(id)) if (!reach.has(e.to)) { reach.add(e.to); q.push(e.to); } }
  const unreachable = [...N.values()].filter((n) => !reach.has(n.id) && n.type !== 'note');
  if (unreachable.length) fail(`${unreachable.length} elemento(s) não podem ser alcançados a partir do Início: ${unreachable.slice(0, 3).map((n) => `"${short(n.label)}"`).join(', ')}.`);
  const canEnd = new Set([...N.values()].filter(isTerminalType).map((n) => n.id));
  for (let changed = true; changed;) { changed = false; for (const e of model.edges.filter(flow)) if (canEnd.has(e.to) && !canEnd.has(e.from)) { canEnd.add(e.from); changed = true; } }
  // laços: componentes fortemente conexos sem saída
  const sccs = tarjan([...N.keys()], (id) => outs(id).map((e) => e.to));
  for (const comp of sccs) {
    if (comp.length < 2) continue;
    const set = new Set(comp);
    const exits = comp.some((id) => outs(id).some((e) => !set.has(e.to)));
    const hasDecision = comp.some((id) => N.get(id).type === 'decision');
    if (!exits) fail(`Laço sem saída: ${comp.slice(0, 3).map((id) => `"${short(N.get(id).label)}"`).join(' → ')}… nunca termina.`);
    else if (!hasDecision) warn(`Laço sem condição de saída: ${comp.slice(0, 3).map((id) => `"${short(N.get(id).label)}"`).join(' → ')}.`);
  }
  const stuck = [...N.values()].filter((n) => reach.has(n.id) && !canEnd.has(n.id));
  if (stuck.length && !issues.some((i) => /Laço sem saída/.test(i.message))) fail(`Há caminho que não chega a um fim: ${stuck.slice(0, 2).map((n) => `"${short(n.label)}"`).join(', ')}.`);

  // 8. dúvidas marcadas pela interpretação
  if (!ctx.interpreted) for (const n of N.values()) if (n.type === 'doubt' || n.classes?.has('duvida')) warn(`Ponto com dúvida: "${short(n.label)}" — o documento não deixa claro este caminho.`);

  // 9. possíveis omissões: passos numerados do documento sem correspondência no diagrama
  if (ctx.text) {
    const steps = String(ctx.text).split('\n').map((l) => l.trim()).filter((l) => /^(\d{1,2}[.)]|[•\-–*])\s+\S/.test(l)).map((l) => l.replace(/^(\d{1,2}[.)]|[•\-–*])\s+/, ''));
    const all = new Set([...N.values()].flatMap((n) => stems(n.label + ' ' + (n.label.match(/<br\/?>(.*)/)?.[1] || ''))));
    const missing = steps.filter((s) => { const w = stems(s); return w.length >= 2 && w.filter((x) => all.has(x)).length === 0; });
    if (missing.length) warn(`Possível omissão: ${missing.length} instrução(ões) do documento sem bloco correspondente — ${missing.slice(0, 3).map((s) => `"${short(s)}"`).join(', ')}.`);
  }
  return { model, issues };
}

/** componentes fortemente conexos (Tarjan) */
function tarjan(ids, succ) {
  let index = 0; const st = []; const on = new Set(); const idx = new Map(); const low = new Map(); const out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++; st.push(v); on.add(v);
    for (const w of succ(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); out.push(c); }
  };
  for (const v of ids) if (!idx.has(v)) visit(v);
  return out;
}

module.exports = { validateModel };
