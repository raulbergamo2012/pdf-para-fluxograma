'use strict';
/**
 * CAMADA 3 — Representação estruturada do processo
 *
 * Estrutura intermediária independente do texto Mermaid:
 *   {
 *     header:   ['%% tipo: decisao', …],            comentários de controle
 *     direction:'TD' | 'LR',
 *     nodes:    Map(id → { id, type, label, shape, group, order }),
 *                 type: start | end | process | decision | io | doubt | note
 *     edges:    [{ from, to, label, style }],       style: '-->' | '-.->' | '-.-' …
 *     groups:   [{ id, title, parent, direction }], etapas/raias (subgraphs)
 *     extra:    ['classDef …', 'class …', …]
 *   }
 * fromMermaid() lê o código (da IA ou do modo Regras); toMermaid() gera o código final a partir do modelo
 * VALIDADO (camada 4, lib/validate.js) — a renderização (camada 5, navegador) só desenha esse código.
 */
const ARROW = /\s*(<-->|-\.->|-\.-|==>|===|-->|---|--o|--x)(?:\|([^|]*)\|)?\s*/;

const SHAPES = [
  ['(((', ')))'], ['([', '])'], ['[[', ']]'], ['[(', ')]'], ['((', '))'], ['{{', '}}'],
  ['[/', '/]'], ['[\\', '\\]'], ['[/', '\\]'], ['[\\', '/]'], ['[', ']'], ['{', '}'], ['(', ')'], ['>', ']'],
];

function typeOf(id, open, label, classes) {
  if (open === '{') return 'decision';
  if (open === '([' || open === '((' || open === '(((') return /^\s*in[ií]cio\b/i.test(label) || /^INICIO/i.test(id) ? 'start' : 'end';
  if (open === '[/' || open === '[\\') return 'io';
  if (classes.has('duvida')) return 'doubt';
  if (classes.has('nota') || (open === '(' && /^N\d/.test(id))) return 'note';
  if (/^INICIO$/i.test(id)) return 'start';
  if (/^FIM/i.test(id)) return 'end';
  return 'process';
}

/** lê um token de nó "ID", "ID[\"texto\"]", "ID{\"x?\"}"… → { id, open, close, label } */
function readNode(tok) {
  const m = /^([A-Za-z_][\w-]*)(.*)$/.exec(tok.trim());
  if (!m) return null;
  const [, id, rest] = m;
  if (!rest) return { id };
  for (const [open, close] of SHAPES) {
    if (!rest.startsWith(open) || !rest.endsWith(close)) continue;
    let label = rest.slice(open.length, rest.length - close.length).trim();
    if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
    return { id, open, close, label };
  }
  return { id, raw: rest };
}

function fromMermaid(code) {
  const model = { header: [], direction: 'TD', nodes: new Map(), edges: [], groups: [], extra: [] };
  const stack = [];
  const classesOf = new Map();
  let order = 0;
  const touch = (tok) => {
    const n = readNode(tok);
    if (!n) return null;
    if (!model.nodes.has(n.id)) model.nodes.set(n.id, { id: n.id, open: '', close: '', label: n.id, group: stack[stack.length - 1] || null, order: order++, bare: true });
    const cur = model.nodes.get(n.id);
    if (n.open && cur.bare) Object.assign(cur, { open: n.open, close: n.close, label: n.label, bare: false });
    return n.id;
  };
  for (const raw of String(code).split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^%%/.test(t)) { if (!stack.length) model.header.push(t); continue; }
    let m;
    if ((m = /^(flowchart|graph)\s+(\w+)/i.exec(t))) { model.direction = m[2].toUpperCase() === 'LR' ? 'LR' : 'TD'; continue; }
    if ((m = /^direction\s+(\w+)/i.exec(t))) { const g = model.groups.find((x) => x.id === stack[stack.length - 1]); if (g) g.direction = m[1]; continue; }
    if ((m = /^subgraph\s+([A-Za-z_][\w-]*)?\s*(?:\["([^"]*)"\]|"([^"]*)"|(.*))?$/.exec(t))) {
      const id = m[1] || 'SG' + (model.groups.length + 1);
      model.groups.push({ id, title: (m[2] ?? m[3] ?? m[4] ?? '').trim() || id, parent: stack[stack.length - 1] || null, direction: '' });
      stack.push(id);
      continue;
    }
    if (t === 'end') { stack.pop(); continue; }
    if ((m = /^class\s+([\w,-]+)\s+(\w+)/.exec(t))) { m[1].split(',').forEach((id) => (classesOf.get(id) || classesOf.set(id, new Set()).get(id)).add(m[2])); model.extra.push(t); continue; }
    if (/^(classDef|style|linkStyle|click)\b/.test(t)) { model.extra.push(t); continue; }
    if (!ARROW.test(t)) { if (!touch(t.replace(/;$/, ''))) model.extra.push(t); continue; }
    const parts = t.replace(/;$/, '').split(new RegExp(ARROW.source, 'g'));
    const ids = [];
    for (let i = 0; i < parts.length; i += 3) ids.push(touch(parts[i]));
    if (ids.some((x) => !x)) throw new Error('linha não reconhecida: ' + t);
    for (let i = 1, k = 0; i < parts.length; i += 3, k++) model.edges.push({ from: ids[k], to: ids[k + 1], style: parts[i], label: (parts[i + 1] || '').trim() });
  }
  for (const n of model.nodes.values()) {
    n.classes = classesOf.get(n.id) || new Set();
    n.type = typeOf(n.id, n.open, n.label, n.classes);
  }
  return model;
}

const SHAPE_OF = { start: ['([', '])'], end: ['([', '])'], decision: ['{', '}'], io: ['[/', '/]'], process: ['[', ']'], doubt: ['[', ']'], note: ['(', ')'] };
const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
function nodeDef(n) {
  const [o, c] = n.open ? [n.open, n.close] : SHAPE_OF[n.type] || ['[', ']'];
  return `${n.id}${o}${q(n.label)}${c}`;
}

function toMermaid(model) {
  const out = [...model.header, `flowchart ${model.direction}`];
  const childrenOf = (gid) => model.groups.filter((g) => g.parent === gid);
  const nodesOf = (gid) => [...model.nodes.values()].filter((n) => n.group === gid).sort((a, b) => a.order - b.order);
  const writeGroup = (g, ind) => {
    out.push(`${ind}subgraph ${g.id}[${q(g.title)}]`);
    if (g.direction) out.push(`${ind}    direction ${g.direction}`);
    for (const n of nodesOf(g.id)) out.push(`${ind}    ${nodeDef(n)}`);
    for (const c of childrenOf(g.id)) writeGroup(c, ind + '    ');
    out.push(`${ind}end`);
  };
  for (const n of nodesOf(null)) out.push(`    ${nodeDef(n)}`);
  for (const g of childrenOf(null)) writeGroup(g, '    ');
  out.push('');
  for (const e of model.edges) out.push(`    ${e.from} ${e.style || '-->'}${e.label ? `|${e.label}|` : ''} ${e.to}`);
  // classes: regrava as listas sem nós removidos
  const extra = model.extra.map((l) => {
    const m = /^class\s+([\w,-]+)\s+(\w+)/.exec(l);
    if (!m) return l;
    const ids = m[1].split(',').filter((id) => model.nodes.has(id));
    return ids.length ? `class ${ids.join(',')} ${m[2]}` : null;
  }).filter(Boolean);
  const classed = new Set(extra.filter((l) => /^class\s/.test(l)).flatMap((l) => l.split(/\s+/)[1].split(',')));
  const lacking = (cls) => [...model.nodes.values()].filter((n) => n.classes?.has(cls) && !classed.has(n.id)).map((n) => n.id);
  for (const cls of ['inicioFim', 'decisao', 'erro', 'duvida', 'nota', 'revisar']) { const ids = lacking(cls); if (ids.length) extra.push(`class ${ids.join(',')} ${cls}`); }
  if (extra.length) out.push('', ...extra.map((l) => '    ' + l));
  return out.join('\n');
}

/** cópia simples do modelo (para comparar antes/depois da validação) */
const nextId = (model, prefix) => { let i = 1; while (model.nodes.has(prefix + i)) i++; return prefix + i; };

module.exports = { fromMermaid, toMermaid, nextId, readNode };
