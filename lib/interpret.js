'use strict';
/**
 * CAMADA 2 — Interpretação inteligente (usada pelo modo Regras, lib/heuristic.js)
 *
 * Recebe os itens de uma seção já extraídos do PDF (camada 1, parseDocument) e entende a sequência operacional:
 *  - separa frases que estavam juntas num item ("Informe a chave. Se não tiver a chave, …");
 *  - tira do fluxo as linhas de objetivo/escopo ("Objetivo: …"), guardadas como objetivo do processo;
 *  - DEPENDÊNCIAS: "X quando/assim que/após Y" e "Após Y, X" → X vai para depois do passo Y;
 *    "Antes de Y, X" → X vai para antes de Y (só com evidência no texto — nunca inventa ordem);
 *  - finalização fora de ordem: "Clique em Concluir…" antes de passos de configuração da mesma seção → vai para o fim;
 *  - instruções vagas ("Talvez seja necessário…", "dependendo da versão") → marcadas como DÚVIDA (aviso, não inventa);
 * e, depois do classify() do heurístico, NORMALIZA as condições:
 *  - "Verifique se há papel" + "Se não houver papel, coloque" → UMA decisão (Não = colocar papel);
 *  - "Se o gestor aprovar, A" + "Se o gestor reprovar, B" → UMA decisão Sim/Não;
 *  - "Informe a chave" + "Se não tiver a chave, clique em…" → "Tem a chave?" Sim → informar / Não → clicar;
 *  - "Se sim, …" / "Se não, …" depois de uma pergunta → ramos da pergunta;
 *  - várias condições seguidas sobre o mesmo assunto ("Se o cliente for A… / for B… / for C…") → decisão com várias saídas;
 *  - "Se o erro persistir após 3 tentativas, …" → saída do laço de repetição.
 * Cada ajuste feito vira um aviso legível na aba Análise.
 */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('para com sem pelo pela pelos pelas como mais menos cada todo toda todos todas outro outra antes depois quando onde voce seu sua seus suas este esta esse essa isso aqui ali sobre entre apos ate desde uma umas uns dos das nos nas pela este estao esta seja sera tiver houver estiver forem fora caso sempre ainda apenas agora'.split(' '));
/** palavras de conteúdo com radical simples ("gravação" ~ "gravar": "grava") */
const stems = (s) => norm(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, Math.max(4, Math.min(w.length - 2, 6))));
const overlap = (a, b) => { const B = new Set(stems(b)); return stems(a).filter((w) => B.has(w)).length; };

const GOAL_RE = /^\s*(objetivo|finalidade|prop[oó]sito|escopo|aplica-se|aplica[cç][aã]o|p[uú]blico[- ]alvo|resumo|descri[cç][aã]o)\s*[:\-–]\s*/i;
const HEDGE_RE = /\b(talvez|possivelmente|eventualmente|dependendo d[aoe]s?|pode ser necess[aá]rio|em alguns casos|se aplic[aá]vel|conforme o caso)\b/i;
const FINISH_RE = /^(clique|clicar|pressione|pressionar|toque|tocar)\s+em\s+(concluir|finalizar|fechar|encerrar|sair|terminar)\b|^(conclua|concluir|finalize|finalizar|encerre|encerrar|feche|fechar)\b/i;
const SETUP_RE = /^(selecione|selecionar|escolha|escolher|marque|marcar|defina|definir|configure|configurar|informe|informar|digite|digitar|preencha|preencher|aceite|aceitar|insira|inserir|conecte|conectar|execute|executar|baixe|baixar|aguarde|aguardar)\b/i;

/** Uma frase por item: "Informe a chave do produto. Se não tiver a chave, clique em …" → 2 itens */
function splitSentences(items) {
  const out = [];
  for (const it of items) {
    const parts = String(it).split(/(?<=[.!?])\s+(?=(?:Se|Caso|Senão|Quando|Após|Depois|Antes|Em seguida|Por fim|Finalmente|Verifique|Confirme|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+[ea]\b))/);
    for (const p of parts) if (p.trim().length >= 3) out.push(p.trim());
  }
  return out;
}

/** "X quando Y" / "Após Y, X" / "Antes de Y, X" → { text: X, after|before: Y } */
function dependencyOf(t) {
  let m;
  const s = String(t).replace(/[.;]+$/, '');
  if (/^\s*(se|caso|sen[aã]o)\b/i.test(s) || /\b(ap[oó]s|depois de)\s+\w+\s+tentativas\b/i.test(s)) return null;   // condição, não ordem
  if ((m = /^(?:ap[oó]s|depois d[aeo]s?|depois que|assim que|uma vez que)\s+(.+?),\s*(.+)$/i.exec(s))) return { text: m[2], after: m[1] };
  if ((m = /^quando\s+(.+?),\s*(.+)$/i.exec(s)) && !/\b(erro|falh|problema|n[aã]o)\b/i.test(m[1])) return { text: m[2], after: m[1] };
  if ((m = /^antes de\s+(.+?),\s*(.+)$/i.exec(s))) return { text: m[2], before: m[1] };
  if ((m = /^(.+?),?\s+(?:quando|assim que|depois que|ap[oó]s)\s+(.{6,})$/i.exec(s)) && !/\b(erro|falh|problema)\b/i.test(m[2])) return { text: m[1], after: m[2] };
  if ((m = /^(.+?),?\s+antes de\s+(.{6,})$/i.exec(s))) return { text: m[1], before: m[2] };
  return null;
}

/**
 * Prepara os itens de uma seção (antes do classify): frases separadas, objetivo fora do fluxo, ordem pelas
 * dependências explícitas e finalização no fim. Devolve { items, goal, notes[] } — notes são avisos.
 */
function prepareItems(rawItems, opts = {}) {
  const notes = [];
  let goal = '';
  let items = splitSentences(rawItems).filter((t) => {
    if (GOAL_RE.test(t)) { goal ||= t.replace(GOAL_RE, '').replace(/[.;]+$/, ''); return false; }
    return true;
  });
  // dependências explícitas ("quando a gravação terminar", "após reiniciar", "antes de ligar")
  const deps = items.map((t) => dependencyOf(t));
  for (let i = 0; i < items.length; i++) {
    const d = deps[i];
    if (!d) continue;
    const ref = d.after || d.before;
    let j = -1, best = 0;
    items.forEach((o, k) => { if (k !== i) { const s = overlap(ref, deps[k]?.text || o); if (s > best) { best = s; j = k; } } });
    const clean = d.text.charAt(0).toUpperCase() + d.text.slice(1);
    if (j < 0 || best < 1) { items[i] = d.before ? items[i] : clean; continue; }
    if (d.after && j > i) {
      const [x] = items.splice(i, 1); const [dx] = deps.splice(i, 1);
      items.splice(j, 0, clean); deps.splice(j, 0, null);
      notes.push(`Sequência reorganizada: "${short(clean)}" foi para depois de "${short(items[j - 1])}" (o texto diz "${short(ref)}").`);
      void x; void dx;
      i--; continue;
    }
    if (d.before && j < i) {
      items.splice(i, 1); deps.splice(i, 1);
      items.splice(j, 0, clean); deps.splice(j, 0, null);
      notes.push(`Sequência reorganizada: "${short(clean)}" foi para antes de "${short(items[j + 1])}" (o texto diz "antes de ${short(ref)}").`);
      continue;
    }
    items[i] = clean;
    deps[i] = null;
  }
  // pré-condição de recurso: "Caso o computador não tenha porta Ethernet, use um adaptador" vem ANTES do primeiro
  // passo que usa esse recurso ("Conecte o cabo na porta de rede do computador")
  for (let i = 1; i < items.length; i++) {
    const m = /^(?:se|caso)\s+.*?\bn[aã]o\s+(?:tiver|tenha|tiverem|tenham|possuir|possua|houver|haja|existir|exista|dispuser|disponha)\s+(?:de\s+)?(.+?)(?:,|$)/i.exec(items[i]);
    if (!m) continue;
    const j = items.slice(0, i).findIndex((t) => overlap(m[1], t) >= Math.min(2, stems(m[1]).length) && !/^(se|caso)\b/i.test(t));
    if (j < 0 || j >= i - 1) continue;   // logo depois do passo que usa o recurso = é o ramo dele, não pré-condição
    const [x] = items.splice(i, 1);
    items.splice(j, 0, x);
    notes.push(`Sequência reorganizada: a pré-condição "${short(x)}" foi para antes de "${short(items[j + 1])}", que depende dela.`);
  }
  // finalização no meio da configuração: "Clique em Concluir" antes de "Selecione…/Escolha…" da mesma seção
  for (let i = 0; i < items.length - 1; i++) {
    if (!FINISH_RE.test(items[i].trim())) continue;
    const later = items.slice(i + 1).findIndex((t) => SETUP_RE.test(t.trim()) && !FINISH_RE.test(t.trim()));
    if (later < 0) continue;
    const lastSetup = items.length - 1 - [...items].reverse().findIndex((t) => SETUP_RE.test(t.trim()) && !FINISH_RE.test(t.trim()));
    const [x] = items.splice(i, 1);
    items.splice(lastSetup, 0, x);
    notes.push(`Sequência reorganizada: "${short(x)}" estava antes de passos de configuração e foi para o fim da etapa.`);
    break;
  }
  // instruções vagas: ficam no fluxo, mas com a dúvida registrada
  const doubts = new Map();   // texto limpo → critério vago
  items = items.map((t) => {
    if (!HEDGE_RE.test(t)) return t;
    const crit = (/(dependendo d[aoe]s?\s+[^,.;]+|em alguns casos|se aplic[aá]vel|conforme o caso)/i.exec(t) || [])[1] || '';
    let c = t.replace(/^\s*(talvez|possivelmente|eventualmente)\s+(seja necess[aá]rio|seja preciso|voc[eê] precise|precise)?\s*/i, '')
      .replace(/^\s*(pode ser necess[aá]rio|em alguns casos,?)\s*/i, '')
      .replace(/,?\s*(dependendo d[aoe]s?\s+[^,.;]+|em alguns casos|se aplic[aá]vel|conforme o caso)/i, '').trim();
    c = c.charAt(0).toUpperCase() + c.slice(1);
    doubts.set(c, crit);
    notes.push(`Instrução sem critério claro no documento: "${short(t)}". Ela foi mantida e marcada com dúvida — confirme no documento original.`);
    return c;
  });
  void opts;
  return { items, goal, notes, doubts };
}
const short = (t) => { const w = String(t).replace(/[.;]+$/, '').split(/\s+/); return w.length > 9 ? w.slice(0, 9).join(' ') + '…' : w.join(' '); };

// ------------------------------------------------------------------ normalização das condições (após classify)
const ANTONYMS = [['aprov', 'reprov'], ['aceit', 'recus'], ['aceit', 'rejeit'], ['corret', 'incorret'], ['valid', 'invalid'], ['sucesso', 'falha'],
  ['disponiv', 'indisponiv'], ['encontr', 'nao encontr'], ['conseg', 'nao conseg'], ['positiv', 'negativ'], ['sim', 'nao'], ['complet', 'incomplet'], ['autoriz', 'nao autoriz']];
const qnorm = (q) => norm(q).replace(/\b(o|a|os|as|um|uma|se|caso|for|forem|estiver|estiverem|esteja|estejam|seja|sejam)\b/g, ' ').replace(/\s+/g, ' ').trim();
/** q2 é a negação de q1? ("há papel" × "não houver papel"; "gestor aprovar" × "gestor reprovar") */
function negates(q1, q2) {
  const a = qnorm(q1), b = qnorm(q2);
  if (!a || !b) return false;
  const strip = (s) => s.replace(/\bnao\b/g, ' ').replace(/\b(ha|houver|haja|tem|tiver|tenha|existe|existir|exista)\b/g, 'ha').replace(/\s+/g, ' ').trim();
  const negA = /\bnao\b/.test(a), negB = /\bnao\b/.test(b);
  if (negA !== negB && overlap(strip(a), strip(b)) >= Math.max(1, Math.min(stems(strip(a)).length, stems(strip(b)).length) - 1)) return true;
  for (const [p, n] of ANTONYMS) {
    if ((a.includes(p) && b.includes(n) && !a.includes(n)) || (a.includes(n) && b.includes(p) && !b.includes(n))) {
      const ra = a.replace(new RegExp(`\\w*(${p}|${n})\\w*`, 'g'), ''), rb = b.replace(new RegExp(`\\w*(${p}|${n})\\w*`, 'g'), '');
      if (overlap(ra, rb) >= 1 || (!stems(ra).length && !stems(rb).length)) return true;
    }
  }
  return false;
}
const PERSIST_RE = /\b((?:problema|erro|falha|defeito)\s+(?:continuar|continue|permanecer|permane[cç]a|voltar|ocorrer novamente)|persist\w*|continu\w* (o erro|a falha|com erro|falhando)|ainda (n[aã]o|falh)|ap[oó]s \w+ tentativas|depois de \w+ tentativas|n[aã]o resolver|n[aã]o funcionar novamente)\b/i;

/**
 * Normaliza a lista do classify(): devolve nova lista com tipos que o emissor entende:
 *  action · tip · if{question, action, elseText?, positive?} · check{question, before, elseText?} ·
 *  multi{subject, branches[{label, action}]} · persist{question, action}
 */
function normalizeConditions(list, raw, notes) {
  const out = [];
  for (let k = 0; k < list.length; k++) {
    const it = { ...list[k], raw: raw[k] };
    const last = out[out.length - 1];
    // a condição "aberta" mais recente (pulando o "Se sim, …" que fica logo depois da pergunta)
    const prev = last?.type === 'then' && ['if', 'check'].includes(out[out.length - 2]?.type) ? out[out.length - 2] : last;
    // "Caso contrário / Senão, B" → ramo Não da condição aberta
    if (it.type === 'else' && prev && (prev.type === 'if' || prev.type === 'check') && !prev.elseText) { prev.elseText = it.text; continue; }
    if (it.type === 'then' && prev && prev.type === 'check' && last === prev && !prev.thenText) { prev.thenText = it.text; continue; }
    // "Se não, B" logo depois de uma pergunta/condição → ramo Não
    if (it.type === 'if' && /^n[aã]o$/i.test((it.question || '').trim()) && prev && (prev.type === 'if' || prev.type === 'check') && !prev.elseText) {
      prev.elseText = it.action; continue;
    }
    // condição que é a negação da anterior → ramo Não da mesma decisão
    if (it.type === 'if' && prev && (prev.type === 'if' || prev.type === 'check') && !prev.elseText && it.action && negates(prev.question, it.question)) {
      prev.elseText = it.action;
      notes.push(`Condições "${short(prev.question)}" e "${short(it.question)}" unidas em uma única decisão Sim/Não.`);
      continue;
    }
    // "Informe a chave" + "Se não tiver a chave, clique em …" → "Tem a chave?" Sim → informar / Não → clicar
    if (it.type === 'if' && it.action && /^n[aã]o\s/i.test(it.question.trim()) && prev && prev.type === 'action' && !prev.optional && overlap(prev.text, it.question) >= 1) {
      // a pergunta herda o objeto completo da ação ("tiver a chave" + "Informe a chave do produto" → "tiver a chave do produto")
      let pq = it.question.trim().replace(/^n[aã]o\s+/i, '');
      const lastNoun = norm(pq).split(' ').pop();
      const idx = lastNoun ? norm(prev.text).indexOf(lastNoun) : -1;
      if (idx >= 0) { const tail = prev.text.slice(idx + lastNoun.length).replace(/[.;]+$/, '').trim(); if (tail && tail.split(/\s+/).length <= 3 && /^(d[oae]s?|de)\b/i.test(tail)) pq += ' ' + tail; }
      out[out.length - 1] = { type: 'if', question: pq, action: prev.text, elseText: it.action, raw: prev.raw };
      continue;
    }
    // "Se o erro persistir após 3 tentativas, …" → saída do laço anterior
    // (a condição anterior pode ter a correção no elseText OU ser negativa com a correção na própria ação:
    //  "Se a internet não funcionar, reinicie… / Se o problema continuar, …")
    if (it.type === 'if' && PERSIST_RE.test(it.question) && prev && (prev.type === 'check' || prev.type === 'if') && (prev.elseText || (prev.type === 'if' && prev.action && /\bn[aã]o\b|incorret|falh|erro/i.test(prev.question)))) {
      prev.persist = { question: it.question, action: it.action };
      continue;
    }
    // várias condições seguidas sobre o mesmo assunto → uma decisão com várias saídas
    if (it.type === 'if' && it.action && prev && prev.type === 'if' && prev.action && !prev.elseText && !negates(prev.question, it.question)) {
      const pw = qnorm(prev.subjectQ || prev.question).split(' '), cw = qnorm(it.question).split(' ');
      let c = 0; while (c < pw.length && c < cw.length && pw[c] === cw[c]) c++;
      if (c >= 2 && c < cw.length) {
        const subject = (prev.subjectQ || prev.question).split(/\s+/).slice(0, c + (/^(o|a|os|as)$/i.test(prev.question.split(/\s+/)[0]) ? 1 : 0)).join(' ');
        const multi = prev.type === 'multi' ? prev : { type: 'multi', subject, branches: [{ question: prev.question, action: prev.action }], raw: prev.raw };
        multi.branches.push({ question: it.question, action: it.action });
        out[out.length - 1] = multi;
        continue;
      }
    }
    if (it.type === 'if' && prev && prev.type === 'multi' && it.action && qnorm(it.question).startsWith(qnorm(prev.subject))) {
      prev.branches.push({ question: it.question, action: it.action }); continue;
    }
    out.push(it);
  }
  for (const m of out.filter((x) => x.type === 'multi')) notes.push(`Decisão com ${m.branches.length} saídas criada para "${short(m.subject)}".`);
  return out;
}

/**
 * Passo existente que uma ação de repetição retoma ("execute o backup novamente" → "Executar backup";
 * "reinicie o computador" → "Ligar computador…"; "envie a página de teste novamente" → "Enviar página de teste").
 * candidates: [{ id, label }] em ordem de criação. Devolve o id ou null.
 */
const RETRY_WORDS = /\b(novamente|de novo|outra vez|mais uma vez)\b/i;
const VERB_EQUIV = { reiniciar: 'ligar', religar: 'ligar', reenviar: 'enviar', refazer: 'fazer', reexecutar: 'executar', reinstalar: 'instalar', repetir: '', retomar: '', recome: 'comecar' };
function retryTarget(text, candidates) {
  const t = norm(text);
  const isRetry = RETRY_WORDS.test(text) || /^(reinici|reenvi|refa|reexecut|repit|repet|retom|religu)/.test(t);
  if (!isRetry) return null;
  let [verb, ...rest] = t.replace(RETRY_WORDS, ' ').replace(/\s+/g, ' ').trim().split(' ');
  for (const [k, v] of Object.entries(VERB_EQUIV)) if (verb.startsWith(k.slice(0, 6))) { verb = v || (rest.shift() || ''); break; }
  const obj = rest.join(' ');
  // "novamente/de novo", ou "reinicie a instalação/o processo" (reiniciar uma ATIVIDADE): repete o mesmo passo
  const explicit = RETRY_WORDS.test(text) || (/^(reinici|recome)/.test(t) && /(cao|coes|mento|processo|procedimento|download|backup|operacao|tarefa)\b/.test(obj));
  let best = null, score = 0;
  for (const c of candidates) {
    const cl = norm(c.label);
    const sameVerb = !!verb && cl.split(' ')[0].startsWith(verb.slice(0, 4));
    // sem "novamente", o verbo tem de bater ("reinicie o roteador" NÃO repete "Conectar cabo no roteador")
    if (!explicit && !sameVerb) continue;
    const s = overlap(obj, cl) * 2 + (sameVerb ? 1 : 0);
    if (s > score || (s === score && s > 0 && best && c.section === best.section && c.order < best.order)) { score = s; best = c; }
  }
  return score >= 2 ? best.id : null;
}

module.exports = { prepareItems, normalizeConditions, retryTarget, negates, dependencyOf, splitSentences, overlap, HEDGE_RE, PERSIST_RE, RETRY_WORDS, GOAL_RE };
