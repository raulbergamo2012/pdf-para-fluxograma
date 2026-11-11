'use strict';
/**
 * Coesão do texto do fluxograma (usado no Processo linear, no modo Regras e no código da IA):
 *  - alternativas de plataforma em sequência ("Abrir Google Play Store" → "Abrir App Store") viram UM passo
 *    ("Abrir loja de aplicativos" / "Baixar no Android ou iOS"), em vez de dois passos obrigatórios;
 *  - passos repetidos em sequência ("Clicar em Salvar" → "Clicar em Salvar") viram um só.
 */
const PLATFORM = /\b(google\s+play(\s+store)?|play\s*store|app\s*store|apple\s+store|microsoft\s+store|loja\s+de\s+apps?|android|ios|iphone|ipad|windows|mac\s*os|macos|mac|linux|xbox|playstation|ps[345]|nintendo|switch|celular|smartphone|tablet|computador|pc|notebook|navegador|chrome|firefox|safari|edge)\b/i;
const STORE = /\b(google\s+play|play\s*store|app\s*store|apple\s+store|microsoft\s+store)\b/i;

// verbos que, com o mesmo objeto, dizem a mesma coisa ("Acessar loja" → "Abrir loja")
const SYN = [
  ['acessar', 'abrir', 'entrar', 'ir', 'navegar', 'visitar', 'iniciar'],
  ['clicar', 'tocar', 'pressionar', 'apertar', 'selecionar'],
  ['informar', 'digitar', 'inserir', 'preencher', 'escrever', 'colocar', 'definir'],
  ['baixar', 'transferir'],
  ['confirmar', 'validar', 'verificar', 'conferir', 'checar'],
  ['criar', 'cadastrar', 'registrar'],
  ['procurar', 'buscar', 'pesquisar', 'localizar', 'encontrar'],
  ['aguardar', 'esperar'],
];
const synGroup = (v) => SYN.findIndex((g) => g.includes(v));
const FILLER = /\b(o|a|os|as|um|uma|no|na|nos|nas|em|ao|aos|à|às|do|da|dos|das|de|seu|sua|seus|suas|novo|nova)\b/g;
const objKey = (s) => norm(s).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

/**
 * Dica/aviso secundário ("Não usar nome real", "Anotar senha em local seguro", "Dica: …"): não vira bloco
 * próprio; entra como observação dentro do bloco de ação anterior.
 */
const TIP_RE = /^(n[aã]o\s|nunca\s|jamais\s|evit|dica\b|nota\b|obs\b|observa[cç][aã]o|aten[cç][aã]o|aviso\b|alerta\b|importante|lembr|recomend|sugest|sugir|prefer|prefir|anot|guard|mantenh|manter\b|memoriz|tomar cuidado|ter cuidado|cuidado|usar pelo menos|use pelo menos|incluir letras|combinar letras|misturar|certificar|certifique|garantir que|garanta que|é recomend|recomenda-se|vale lembrar|caso queira|se preferir|opcional)/i;
/** Linha ORIGINAL do PDF com cara de dica/aviso ("Dica: …", "⚠ Atenção: …", "Importante: …", "Lembre-se de …") */
const TIP_SRC = /^\s*(?:[⚠!*•\-–]\s*)?(dica|dicas|nota|obs\.?|observa[cç][aã]o|aten[cç][aã]o|aviso|alerta|importante|lembrete|lembre-se|recomenda[cç][aã]o|recomenda-se|sugest[aã]o|cuidado|seguran[cç]a|curiosidade|opcional)\b\s*[:!\-–]?/i;
/** Seção inteira de dicas ("Dicas de segurança", "Observações", "Avisos importantes") */
const TIP_SECTION = /^\s*(dicas?|observa[cç][oõ]es|obs\.?|avisos?|alertas?|aten[cç][aã]o|importante|lembretes?|recomenda[cç][oõ]es|boas pr[aá]ticas|seguran[cç]a|cuidados|notas?|curiosidades)\b/i;
const STOP = new Set('para com sem pelo pela pelos pelas como mais menos muito cada todo toda todos todas outro outra local seguro segura sempre nunca antes depois quando onde voce você seu sua seus suas este esta esse essa isso aqui ali usar fazer criar abrir acessar informar nao não'.split(' '));
const keyWords = (s) => norm(String(s).replace(/<br\s*\/?>.*$/i, '')).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/s$/, ''));
/** Quantas palavras de conteúdo a dica divide com o bloco ("Anotar senha…" ↔ "Criar senha forte" = 1) */
function relatedness(tip, label) {
  const a = new Set(keyWords(tip));
  return keyWords(label).filter((w) => a.has(w)).length;
}
function isTip(label) {
  const t = String(label || '').trim();
  if (!t || /[?]$/.test(t)) return false;
  return TIP_RE.test(t);
}
/** "Informar senha" + "Anotar senha em local seguro" → "Informar senha<br/>(Anotar senha em local seguro)" */
function withTip(label, tip) {
  const tipTxt = String(tip).trim().replace(/^(dica|obs|observa[cç][aã]o|aten[cç][aã]o|importante)\s*:?\s*/i, '');
  const t = tipTxt.charAt(0).toUpperCase() + tipTxt.slice(1);
  return `${label}<br/>(${t})`;
}
const mainOf = (label) => String(label || '').split(/<br\s*\/?>/i)[0].trim();

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** "Abrir Google Play Store (Android) ou App Store (iOS)" → "Abrir loja de aplicativos" */
function collapseInlineAlternatives(text) {
  let t = String(text || '');
  // "(Android)", "(iOS)", "(no iPhone)" entre parênteses só dizem a plataforma
  t = t.replace(/\s*\((?:no\s+|para\s+)?(android|ios|iphone|ipad|windows|mac|macos|linux|pc|celular)\)/gi, '');
  // duas lojas de aplicativos ligadas por "ou"/"e"/"/" → a loja do aparelho
  t = t.replace(/(a\s+|na\s+|no\s+|da\s+|do\s+)?(?:google\s+)?(?:play\s*store|google\s+play|app\s*store|apple\s+store)\s*(?:ou|e|\/)\s*(?:na\s+|no\s+|a\s+|da\s+|do\s+)?(?:google\s+)?(?:play\s*store|google\s+play|app\s*store|apple\s+store)/gi,
    (all, pre) => `${({ 'no ': 'na ', 'do ': 'da ' })[(pre || 'a ').toLowerCase().replace(/\s+/, ' ')] || (pre || 'a ')}loja de aplicativos`);
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** Dois passos seguidos que são alternativas (plataformas) ou repetições → um rótulo só; senão null */
function mergeAlternative(a, b) {
  const A = String(a || '').trim(), B = String(b || '').trim();
  if (!A || !B) return null;
  if (norm(A) === norm(B)) return A;                                               // repetido
  const [va, ...oa] = A.split(/\s+/), [vb, ...ob] = B.split(/\s+/);
  // mesmo objeto com verbo sinônimo ("Acessar loja de aplicativos" → "Abrir loja de aplicativos") → fica o 1º
  const ga = synGroup(norm(va)), gb = synGroup(norm(vb));
  if (ga >= 0 && ga === gb && oa.length && ob.length) {
    const ka = objKey(oa.join(' ')), kb = objKey(ob.join(' '));
    if (ka && kb && (ka === kb || ka.includes(kb) || kb.includes(ka))) return ka.length >= kb.length ? A : `${va} ${ob.join(' ')}`;
    // navegação ("Acessar site do Roblox" → "Entrar na plataforma"): objeto genérico ou com palavra em comum → um passo
    if (ga === 0 && !(PLATFORM.test(oa.join(' ')) && PLATFORM.test(ob.join(' ')))) {
      const generic = (k) => /^(plataforma|site|pagina|portal|sistema|aplicativo|app|programa|ferramenta|servico|conta|tela inicial|area|painel|menu)( (dele|dela|principal|oficial|inicial))?$/.test(k);
      const shared = ka.split(' ').filter((w) => w.length > 3 && kb.split(' ').includes(w)).length;
      // "Abrir navegador" + "Acessar site": ferramenta e destino são passos diferentes
      const tool = (k) => /^(navegador|browser|programa|aplicativo|app|ferramenta|terminal|prompt|explorador|configura)/.test(k);
      if (tool(ka) !== tool(kb)) return null;
      if (generic(kb) || shared) return ka.length >= kb.length ? A : `${va} ${ob.join(' ')}`;
      if (generic(ka)) return `${va} ${ob.join(' ')}`;
    }
  }
  if (norm(va) !== norm(vb) || !oa.length || !ob.length) return null;
  const objA = oa.join(' '), objB = ob.join(' ');
  if (!PLATFORM.test(objA) || !PLATFORM.test(objB)) return null;
  if (STORE.test(objA) && STORE.test(objB)) return `${va} loja de aplicativos`;
  // prefixo comum ("Baixar app no Android" / "Baixar app no iOS" → "Baixar app no Android ou iOS")
  const wa = objA.split(' '), wb = objB.split(' ');
  let k = 0;
  while (k < wa.length - 1 && k < wb.length - 1 && norm(wa[k]) === norm(wb[k])) k++;
  const merged = `${va} ${wa.join(' ')} ou ${wb.slice(k).join(' ')}`;
  return merged.split(' ').length <= 7 ? merged : `${va} ${wa.slice(0, Math.max(k, 1)).join(' ')}`;
}

/**
 * Código Mermaid da IA (Processo, sem subgraphs): junta passos alternativos/repetidos encadeados A --> B.
 * Só mexe quando A tem uma única saída e B uma única entrada, sem rótulos — senão devolve o código igual.
 */
function mergeAlternativeSteps(code) {
  const lines = String(code).split('\n');
  const NODE = /^([A-Za-z_][\w-]*)(?:\["([^"]*)"\])?$/;
  const ARROW = /\s*(-->|-\.->|==>|---|-\.-)(?:\|([^|]*)\|)?\s*/;
  const defs = new Map(), edges = [], keep = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t || /^(%%|flowchart|graph|classDef|class|style|linkStyle|click)\b/.test(t) || !ARROW.test(t)) {
      // definição isolada de nó retangular
      const m = NODE.exec(t);
      if (m && m[2] != null && !/^(flowchart|graph|classDef|class|style|end)$/.test(m[1])) { defs.set(m[1], m[2]); keep.push({ def: m[1] }); }
      else keep.push({ raw: l });
      continue;
    }
    // linha de setas: tokens alternados nó / seta
    const parts = t.split(new RegExp(ARROW.source, 'g'));
    // split com 2 grupos: [nó, seta, rótulo, nó, seta, rótulo, nó…]
    const nodes = [], arrows = [];
    for (let i = 0; i < parts.length; i += 3) {
      nodes.push(parts[i]);
      if (i + 1 < parts.length) arrows.push({ type: parts[i + 1], label: parts[i + 2] || '' });
    }
    const ids = [];
    for (const n of nodes) {
      const rect = /^([A-Za-z_][\w-]*)\["([^"]*)"\]$/.exec(n);
      const bare = /^([A-Za-z_][\w-]*)$/.exec(n);
      const other = /^([A-Za-z_][\w-]*)([[({>].*)$/.exec(n);
      if (rect) { if (!defs.has(rect[1])) defs.set(rect[1], rect[2]); ids.push(rect[1]); }
      else if (bare) ids.push(bare[1]);
      else if (other) { if (!defs.has(other[1])) defs.set(other[1], { shape: other[2] }); ids.push(other[1]); }
      else return code;                                                             // sintaxe que não entendemos: não mexe
    }
    arrows.forEach((a, i) => edges.push({ from: ids[i], to: ids[i + 1], type: a.type, label: a.label }));
    keep.push({ edges: true });
  }
  const outs = (id) => edges.filter((e) => e.from === id), ins = (id) => edges.filter((e) => e.to === id);
  let changed = false;
  for (let guard = 0; guard < 50; guard++) {
    const fuse = (a, b) => {
      if (/<br/i.test(b)) return null;
      if (isTip(b)) return null;                                                       // dicas: tratadas abaixo (bloco mais relacionado)
      const m = mergeAlternative(mainOf(a), b);
      return m ? m + String(a).slice(mainOf(a).length) : null;
    };
    const e = edges.find((x) => x.type === '-->' && !x.label && typeof defs.get(x.from) === 'string' && typeof defs.get(x.to) === 'string'
      && outs(x.from).length === 1 && ins(x.to).length === 1 && fuse(defs.get(x.from), defs.get(x.to)));
    if (!e) break;
    defs.set(e.from, fuse(defs.get(e.from), defs.get(e.to)));
    edges.splice(edges.indexOf(e), 1);
    edges.forEach((x) => { if (x.from === e.to) x.from = e.from; });
    defs.delete(e.to);
    changed = true;
  }
  // dica isolada em qualquer ponto da sequência (1 entrada, 1 saída): sai do fluxo e vira observação
  // do bloco de ação mais relacionado (palavras em comum), senão do bloco anterior, senão do seguinte
  const isAction = (id) => typeof defs.get(id) === 'string' && !isTip(mainOf(defs.get(id))) && !/^(INICIO|FIM)/i.test(id);
  const tipLines = (id) => (String(defs.get(id)).match(/<br\s*\/?>/gi) || []).length;
  for (let guard = 0; guard < 50; guard++) {
    const t = [...defs.keys()].find((id) => typeof defs.get(id) === 'string' && !/<br/i.test(defs.get(id)) && isTip(defs.get(id))
      && ins(id).length === 1 && outs(id).length === 1 && !outs(id)[0].label);
    if (!t) break;
    const inE = ins(t)[0], outE = outs(t)[0];
    const order = [...defs.keys()];
    const before = order.slice(0, order.indexOf(t)).filter(isAction);
    let target = before.map((id) => [id, relatedness(defs.get(t), defs.get(id))]).filter(([, r]) => r > 0).sort((x, y) => y[1] - x[1] || order.indexOf(y[0]) - order.indexOf(x[0]))[0]?.[0];
    target ||= isAction(inE.from) ? inE.from : isAction(outE.to) ? outE.to : null;
    if (!target || tipLines(target) >= 2) { defs.set(t, defs.get(t) + ''); break; }
    defs.set(target, withTip(defs.get(target), defs.get(t)));
    edges.splice(edges.indexOf(outE), 1);
    inE.to = outE.to;
    defs.delete(t);
    changed = true;
  }
  if (!changed) return code;
  const nodeStr = (id) => { const d = defs.get(id); return typeof d === 'string' ? `${id}["${d}"]` : d ? id + d.shape : id; };
  const declared = new Set();
  const out = [];
  let edgesWritten = false;
  for (const k of keep) {
    if (k.raw != null) {
      // classes que citam nós removidos
      out.push(/^\s*class\s/.test(k.raw) ? k.raw.replace(/^(\s*class\s+)([\w,-]+)/, (all, pre, list) => pre + list.split(',').filter((id) => defs.has(id) || !/^[A-Za-z_]/.test(id)).join(',')) : k.raw);
    } else if (k.def) { if (defs.has(k.def)) { out.push(`    ${nodeStr(k.def)}`); declared.add(k.def); } }
    else if (!edgesWritten) {
      edgesWritten = true;
      for (const e of edges) {
        const f = declared.has(e.from) ? e.from : (declared.add(e.from), nodeStr(e.from));
        const t = declared.has(e.to) ? e.to : (declared.add(e.to), nodeStr(e.to));
        out.push(`    ${f} ${e.type}${e.label ? `|${e.label}|` : ''} ${t}`);
      }
    }
  }
  return out.filter((l) => !/^\s*class\s+\s/.test(l) && !/^\s*class\s+\w+\s*$/.test(l)).join('\n');
}

module.exports = { collapseInlineAlternatives, mergeAlternative, mergeAlternativeSteps, isTip, withTip, mainOf, relatedness, TIP_SRC, TIP_SECTION, PLATFORM };
