'use strict';

const { shortenAction, shortenQuestion, wordCount, polishLabel, MAX_WORDS } = require('./shorten');

/**
 * Limpa e corrige automaticamente o código Mermaid devolvido pela IA,
 * resolvendo os erros de sintaxe mais comuns antes de renderizar.
 */

const RESERVED = new Set(['end', 'graph', 'subgraph', 'flowchart', 'style', 'class', 'classdef', 'click', 'linkstyle', 'direction', 'default']);

// Aberturas/fechamentos de formas de nó (ordem importa: mais longas primeiro)
const SHAPES = [
  ['(((', ')))'], ['([', '])'], ['[[', ']]'], ['[(', ')]'], ['((', '))'],
  ['{{', '}}'], ['[/', '/]'], ['[\\', '\\]'], ['[/', '\\]'], ['[\\', '/]'],
  ['[', ']'], ['{', '}'], ['(', ')'], ['>', ']'],
];

function extractCode(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/\r\n?/g, '\n');
  const fence = s.match(/```(?:mermaid|mmd)?\s*\n([\s\S]*?)```/i);
  if (fence) s = fence[1];
  // Começa a partir da declaração flowchart/graph
  const idx = s.search(/^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/im);
  if (idx > 0) s = s.slice(idx);
  return s.trim();
}

function cleanLabel(text) {
  return String(text)
    .replace(/^\s*"(.*)"\s*$/s, '$1')
    .replace(/<br\s*\/?>/gi, '\u0001')
    .replace(/"/g, "'")
    .replace(/#(?!\w+;)/g, '#35;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s*\u0001\s*/g, '<br/>')
    .trim();
}

/** Garante o limite de palavras por bloco (regra do projeto: máx. 5) */
function fitLabel(raw, open) {
  const text = String(raw).replace(/^\s*"(.*)"\s*$/s, '$1').trim();
  let lines = text.split(/<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);
  // lista na mesma linha: "- Processador - Alinhar - Baixar" / "• a • b"
  if (lines.length === 1 && /^\s*[•*-]\s+\S.*\s[•*-]\s+\S/.test(lines[0])) lines = lines[0].split(/(?:^|\s)[•*-]\s+/).map((l) => l.trim()).filter(Boolean);
  const fitLine = (line) => {
    const bullet = /^[•\-*]\s*/.test(line) ? '• ' : '';
    const body = line.replace(/^[•\-*]\s*/, '');
    if (wordCount(body) <= MAX_WORDS) return bullet + body;
    if (open === '{' || open === '{{') return shortenQuestion(body);
    if (open === '([' || open === '((' || open === '(((') return body.split(/\s+/).slice(0, MAX_WORDS).join(' ');
    return bullet + shortenAction(body);
  };
  // losangos e terminais: uma linha só. Blocos de ação com vários itens: os itens ficam separados por <br/>
  // (sem marcador) e depois splitListNodes() transforma cada item em um bloco próprio, em sequência.
  // revisão final do texto da IA: infinitivos quebrados ("Far" → "Fazer", "Fixe-ar" → "Fixar"), repetições e cortes
  const kind = open === '{' || open === '{{' ? 'question' : open === '([' || open === '((' || open === '(((' ? 'terminal' : 'action';
  const polish = (l) => (kind === 'terminal' ? l : polishLabel(l, kind));
  // observação/dica do bloco: linha "(…)" depois da ação — fica no mesmo bloco, só revisada
  const TIP = /^\(.*\)$/;
  if (kind === 'action' && lines.length > 1 && lines.slice(1).some((l) => TIP.test(l))) {
    const main = lines.filter((l, i) => !(i > 0 && TIP.test(l)));
    const tips = lines.filter((l, i) => i > 0 && TIP.test(l)).map((l) => `(${polishLabel(l.slice(1, -1), 'action')})`);
    return [...main.map((l) => polish(fitLine(l).replace(/^•\s*/, ''))), ...tips].join('<br/>');
  }
  if (lines.length > 1 && (open === '[' || open === '(')) return lines.map((l) => polish(fitLine(l).replace(/^•\s*/, ''))).join('<br/>');
  return polish(fitLine(lines.join(' ')).replace(/^•\s*/, ''));
}

function safeId(id, renames) {
  if (RESERVED.has(id.toLowerCase())) {
    if (!renames.has(id)) renames.set(id, id + '_n');
    return renames.get(id);
  }
  return renames.get(id) || id;
}

/** Encontra o fechamento correto da forma, aceitando conteúdo com colchetes/parênteses */
function findClose(line, start, close) {
  let pos = start;
  let best = -1;
  while (true) {
    const i = line.indexOf(close, pos);
    if (i === -1) break;
    const rest = line.slice(i + close.length);
    if (/^\s*($|-|=|&|:::|~|\.|<|o|x)/.test(rest)) { best = i; break; }
    pos = i + 1;
  }
  return best;
}

function fixNodeLine(line, renames) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    // Rótulos de aresta |texto|
    if (line[i] === '|') {
      const j = line.indexOf('|', i + 1);
      if (j > i) {
        const edge = cleanLabel(line.slice(i + 1, j)).replace(/[()[\]{}]/g, '').split(' ').slice(0, 3).join(' ');
        out += '|' + edge + '|';
        i = j + 1;
        continue;
      }
    }
    const m = /^[A-Za-z_][\w-]*/.exec(line.slice(i));
    const prev = i === 0 ? ' ' : line[i - 1];
    if (m && /[\s&>|-]/.test(prev) || (m && i === 0)) {
      const id = m[0];
      const after = i + id.length;
      let matched = false;
      for (const [open, close] of SHAPES) {
        if (line.startsWith(open, after)) {
          const cStart = after + open.length;
          const cEnd = findClose(line, cStart, close);
          if (cEnd >= cStart) {
            const label = cleanLabel(fitLabel(line.slice(cStart, cEnd), open)) || id;
            out += safeId(id, renames) + open + '"' + label + '"' + close;
            i = cEnd + close.length;
            matched = true;
          }
          break;
        }
      }
      if (matched) continue;
      // ID solto (referência a nó já definido)
      const isKeyword = /^(end|subgraph|classDef|class|style|linkStyle|click|direction)$/i.test(id);
      if (!isKeyword || line.slice(after).match(/^\s*(-|=|&)/)) {
        out += safeId(id, renames);
        i = after;
        continue;
      }
    }
    out += line[i];
    i++;
  }
  return out;
}

function sanitizeMermaid(raw, direction) {
  let code = extractCode(raw);
  if (!code) return '';
  const lines = code.split('\n');
  const renames = new Map();
  const out = [];
  let header = false;

  for (let rawLine of lines) {
    let line = rawLine.replace(/\t/g, '    ').replace(/\s+$/, '');
    const t = line.trim();
    if (!t) { out.push(''); continue; }
    if (t.startsWith('```')) continue;

    if (/^(flowchart|graph)\s+/i.test(t)) {
      if (header) continue;
      header = true;
      const dir = direction || (t.split(/\s+/)[1] || 'TD').toUpperCase();
      out.push('flowchart ' + (/^(TD|TB|BT|LR|RL)$/.test(dir) ? dir : 'TD'));
      continue;
    }
    if (!header) { out.push('flowchart ' + (direction || 'TD')); header = true; }

    // Linhas que não devem ser reescritas
    if (/^direction\s/i.test(t)) continue;   // a direção dos blocos é definida automaticamente
    if (/^(%%|classDef\s|style\s|linkStyle\s|click\s)/i.test(t)) { out.push(line); continue; }
    if (/^end\s*$/i.test(t)) { out.push(line.replace(/end/i, 'end')); continue; }
    if (/^class\s/i.test(t)) {
      const parts = t.split(/\s+/);
      if (parts.length >= 3) {
        const ids = parts[1].split(',').map((id) => safeId(id, renames)).join(',');
        out.push('    class ' + ids + ' ' + parts.slice(2).join(' '));
      }
      continue;
    }
    if (/^subgraph\s/i.test(t)) {
      const sm = t.match(/^subgraph\s+([A-Za-z_][\w-]*)?\s*(\[(.*)\])?\s*(.*)$/i);
      if (sm) {
        const id = sm[1] && !sm[2] && sm[4] ? null : sm[1];
        const label = cleanLabel(sm[3] || (id ? '' : [sm[1], sm[4]].filter(Boolean).join(' ')) || sm[1] || 'Fase');
        const sid = id ? safeId(id, renames) : 'SG' + out.length;
        out.push('    subgraph ' + sid + '["' + label + '"]');
        const dir = (out.find((l) => /^flowchart /.test(l)) || 'flowchart TD').split(' ')[1];
        out.push('        direction ' + (dir === 'LR' || dir === 'RL' ? 'LR' : 'TB'));
      } else out.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)[0] || '    ';
    out.push(indent + fixNodeLine(t, renames));
  }

  // Equilibra subgraph/end
  let open = 0;
  for (const l of out) {
    if (/^\s*subgraph\s/i.test(l)) open++;
    else if (/^\s*end\s*$/i.test(l)) open = Math.max(0, open - 1);
  }
  while (open-- > 0) out.push('    end');

  return splitListNodes(out.join('\n')).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Regra "uma ação por bloco": um nó de ação com vários itens (lista de tarefas) vira uma
 * sequência de blocos pequenos ligados em linha: P7["a<br/>b<br/>c"] → P7["a"] --> P7_2["b"] --> P7_3["c"].
 * As setas que saíam de P7 passam a sair do último bloco da sequência.
 */
function splitListNodes(code) {
  const lines = code.split('\n');
  const DEF = /(^|[\s&>|])([A-Za-z_][\w-]*)(\[|\()"([^"]*?<br\/>[^"]*?)"(\]|\))/;
  const lists = new Map();   // id → itens
  for (const l of lines) {
    if (/^\s*(%%|classDef|class|style|linkStyle|click|subgraph)\b/.test(l)) continue;
    const re = new RegExp(DEF.source, 'g');
    let m;
    while ((m = re.exec(l))) {
      const pairOk = (m[3] === '[' && m[5] === ']') || (m[3] === '(' && m[5] === ')');
      const before = l.slice(0, m.index + m[1].length + m[2].length);
      if (!pairOk || /\($/.test(before) || /\[$/.test(before)) continue;
      // observações "(…)" ficam grudadas no item anterior (não viram bloco próprio)
      const items = m[4].split('<br/>').map((x) => x.trim()).filter(Boolean)
        .reduce((acc, x) => { if (acc.length && /^\(.*\)$/.test(x)) acc[acc.length - 1] += '<br/>' + x; else acc.push(x); return acc; }, []);
      if (items.length > 1 && !lists.has(m[2])) lists.set(m[2], { items, open: m[3], close: m[5] });
    }
  }
  if (!lists.size) return code;
  const lastId = (id) => (lists.get(id).items.length > 1 ? `${id}_${lists.get(id).items.length}` : id);
  const out = [];
  for (let l of lines) {
    if (/^\s*(%%|classDef|style|linkStyle|click|subgraph|end\s*$|direction)\b/.test(l)) { out.push(l); continue; }
    if (/^\s*class\s/.test(l)) { out.push(l.replace(/\s+lista\s*$/, ' lista')); continue; }
    const indent = (l.match(/^\s*/) || [''])[0] || '    ';
    const extra = [];
    for (const [id, info] of lists) {
      const esc = id.replace(/[-]/g, '\\-');
      // definição: fica só o 1º item; a sequência é criada logo abaixo
      const defRe = new RegExp(`(^|[\\s&>|])${esc}\\${info.open}"[^"]*?<br\\/>[^"]*?"\\${info.close}`);
      if (defRe.test(l)) {
        l = l.replace(defRe, (all, pre) => `${pre}${id}${info.open}"${info.items[0]}"${info.close}`);
        // definição seguida de seta: quebra a linha para a seta sair do último item
        const after = new RegExp(`(${esc}\\${info.open}"[^"]*"\\${info.close})(\\s*(?:--|-\\.|==).*)$`);
        const am = after.exec(l);
        if (am) { l = l.slice(0, am.index) + am[1]; extra.push(`${indent}${lastId(id)}${am[2]}`); }
        const chain = info.items.slice(1).map((it, k) => `${indent}${k ? `${id}_${k + 1}` : id} --> ${id}_${k + 2}${info.open}"${it}"${info.close}`);
        extra.unshift(...chain);
        continue;
      }
      // referência como origem de seta: passa a sair do último item
      l = l.replace(new RegExp(`(^|[\\s&>|])${esc}(?=\\s*(?:--|-\\.|==))`, 'g'), (all, pre) => pre + lastId(id));
    }
    out.push(l, ...extra);
  }
  return out.join('\n');
}

module.exports = { sanitizeMermaid, extractCode, cleanLabel, splitListNodes };
