'use strict';
const { mergeAlternative, isTip, relatedness, TIP_SRC, TIP_SECTION } = require('./coherence');
const { prepareItems, normalizeConditions, retryTarget, overlap } = require('./interpret');

/**
 * Modo REGRAS (sem IA): lê o texto do documento e monta um fluxograma Mermaid limpo.
 *
 *  1. Junta linhas quebradas pelo PDF e separa o documento em SEÇÕES (títulos).
 *  2. Ignora o que não é passo: metadados, visão geral, notas, tabelas, descrições.
 *  3. Seções alternativas ("Instalação por disco" / "Instalação digital") viram
 *     um losango de escolha que abre um ramo por seção, lado a lado.
 *  4. Decisões só são criadas a partir de condições reais do texto:
 *       "Se X, Y"  → {X?} Sim → Y, Não → segue
 *       "Verifique se X" (+ "Caso contrário, Z") → {X?} Não → Z, Sim → segue
 *     Os dois ramos voltam ao fluxo principal mais abaixo (sem setas subindo).
 *  5. Passos lineares consecutivos são agrupados em blocos de até 4 itens.
 *  6. Cada seção vira um subgrafo com o título do documento.
 */

const { shortenAction, shortenQuestion, splitCompound, leadVerb, correctiveAction, wordCount, extractActor, polishLabel, toInfinitive } = require('./shorten');

const ELSE_RE = /^\s*(sen[aã]o|caso contr[aá]rio|do contr[aá]rio|se n[aã]o for o caso|em caso negativo|caso n[aã]o)\b[,:\s]*/i;
const COND_START = /^\s*(se|caso|quando|em caso de)\s+/i;
const OPTIONAL_COND = /^\s*(se|caso)\s+(necess[aá]rio|preciso|poss[ií]vel|desejar|desejado|quiser|queira|deseje|aplic[aá]vel|houver necessidade|for o caso)\b[,\s]*/i;
const VALIDATION = /\b(verifi\w*|confir\w*|confira|confere|conferir|valid\w*|chec\w*|cheq\w*|certifique-se|certificar-se|assegure-se|garanta|garantir)\s+(?:de\s+)?(?:se|que)\s+(.+)$/i;
const NOISE_RE = /^(p[aá]gina\s*\d+|page\s*\d+|\d+\s*(de|of)\s*\d+|criado por|created by|last updated|[uú]ltima atualiza|owned by|editado por|vers[aã]o\s*\d|sum[aá]rio|table of contents|[ií]ndice|copyright|confidencial|https?:\/\/|confluence\b|exportado em)/i;
const NOTE_RE = /^(observa[cç][aã]o|obs|nota|dica|importante|aten[cç][aã]o|aviso|exemplo|conclus[aã]o|resultado|refer[eê]ncia|fonte|legenda|tempo estimado)s?\s*[:\-–]/i;
// seções INFORMATIVAS (não são etapas do processo): comparativos, vantagens, glossário… — nunca viram coluna nem passo
const INFO_SECTION = /^(compar\w*|diferen[cç]as?|vantagens|desvantagens|pr[oó]s e contras|benef[ií]cios|quando usar|qual (escolher|usar)|curiosidades|saiba mais)/i;
const DESCRIPTIVE_SECTION = /^(vis[aã]o geral|objetivo|introdu|escopo|sobre|resumo|refer[eê]ncias|recursos|links|anexos?|gloss[aá]rio|hist[oó]rico|contatos?|faq|perguntas|d[uú]vidas|considera[cç][oõ]es|requisitos m[ií]nimos|tabela|legenda|observa[cç]|compar\w*|diferen[cç]as?|vantagens|desvantagens|pr[oó]s e contras|benef[ií]cios|quando usar|qual (escolher|usar)|curiosidades|saiba mais|dicas extras|conclus[aã]o|considera[cç][aã]o final)/i;
const DESCRIPTIVE_LINE = /^(este|esta|estes|estas|neste|nesta|o objetivo|a finalidade|o presente|aqui voc[eê]|abaixo|a seguir|segue|seguem)\b/i;
// caminho que conclui o atendimento com sucesso → vai direto ao Fim
/** condição de FALHA ("não funcionar", "der erro", "o problema continuar") */
const FAIL_RE = /\b(n[aã]o\s+(funcion\w*|carreg\w*|conect\w*|abr\w*|lig\w*|aparec\w*|responde\w*|inicia\w*)|falh\w*|erro\w*|problema\w*|defeito)\b/i;
const NEG_ADJ = [['incorret', 'corret'], ['inválid', 'válid'], ['invalid', 'valid'], ['indisponível', 'disponível'], ['indisponiv', 'disponiv'],
  ['desligad', 'ligad'], ['desconectad', 'conectad'], ['desativad', 'ativad'], ['desabilitad', 'habilitad'], ['incomplet', 'complet'], ['inexistente', 'existente']];
/** a condição é NEGATIVA? ("o computador não tenha porta", "a senha estiver incorreta") — persistência/erro não contam */
function negativeCondition(q) {
  const t = String(q);
  if (/\b(persist|continu|ainda)\w*/i.test(t)) return false;
  return /(^|\s)n[aã]o\s+\S/i.test(t) || NEG_ADJ.some(([n]) => new RegExp('\\b' + n, 'i').test(t));
}
/** "o computador não tenha porta" → "o computador tenha porta"; "a senha estiver incorreta" → "a senha estiver correta" */
function positiveCondition(q) {
  let t = String(q).replace(/(^|\s)n[aã]o\s+/i, '$1');
  for (const [n, p] of NEG_ADJ) t = t.replace(new RegExp('\\b' + n, 'gi'), p);
  return t.trim();
}
/** frase de RESULTADO (estado), não de ação: "a conexão está funcionando", "o pagamento foi aprovado" */
function isOutcome(text) {
  const t = String(text).trim();
  // começa por sujeito (artigo/substantivo), não por verbo de ação; o verbo é de estado
  const first = t.split(/\s+/)[0].toLowerCase();
  const actionLead = leadVerb(t) && !/^(o|a|os|as|um|uma|este|esta|esse|essa|seu|sua)$/.test(first) && !/^(est|ser|ficar)/.test(leadVerb(t));
  return !actionLead && /\b(est[aá]|est[aã]o|foi|foram|funciona\w*|conclu[ií]d\w*|finalizad\w*|pront[oa]s?|ok|resolvid\w*)\b/i.test(t) && t.split(/\s+/).length <= 10;
}
/** "a conexão está funcionando" → "Conexão funcionando" */
function outcomeLabel(text) {
  const t = String(text).replace(/[.;!]+$/, '').replace(/^(a|o|as|os)\s+/i, '').replace(/\s+(est[aá]|est[aã]o)\s+/i, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
/** "o cabo está bem conectado ou se a senha do Wi-Fi está correta" → "Verificar cabo conectado e senha do Wi-Fi correta" */
function checkLabel(q) {
  const parts = String(q).replace(/[.;]+$/, '').split(/\s+(?:ou|e)\s+se\s+/i).map((p) => shortenQuestion('se ' + p).replace(/\?$/, '')
    .replace(/\b(está|estão|é|são|foi|foram|estiver|estiverem)\s+/i, '').replace(/\bbem\s+/i, '').trim()).filter(Boolean);
  if (!parts.length) return '';
  const body = parts.map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toLowerCase() + p.slice(1))).join(' e ');
  return polishLabel('Verificar ' + body, 'action');
}

/** Atividade de ENTRADA ou SAÍDA de dados (símbolo paralelogramo) */
const IO_RE = /^(informar|digitar|preencher|inserir (?:os |as |o |a )?(?:dados|senha|c[oó]digo|chave|nome|e-?mail|valor|informa)|registrar|anotar|imprimir|emitir|exibir|gerar (?:o |a )?(?:relat[oó]rio|nota|boleto|comprovante|recibo)|exportar (?:o |a )?(?:relat[oó]rio|dados|arquivo)|importar (?:os |as )?dados|cadastrar|lan[cç]ar)\b/i;
const DONE_RE = /\b(respond\w* (ao|à|a|o) (cliente|solicitante|usu[aá]rio|requisitante)|encerr\w* (o |a )?(chamado|atendimento|ticket|solicita[cç][aã]o)|finaliz\w* (o |a )?(chamado|atendimento|ticket))\b/i;
const END_RE = /\b(notifica\w*|reprova\w*|cancela\w*|encerra\w*|arquiva\w*|rejeita\w*|interromp\w*|abort\w*)\b/i;
const NUMBERED = /^\s*(\d{1,2}[.)]|[•●▪◦\-–*])\s+/;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const tidy = (t) => String(t).replace(NUMBERED, '').replace(/\s+/g, ' ').trim();
const esc = (t) => String(t).replace(/"/g, "'").replace(/[<>]/g, ' ').replace(/#/g, '').replace(/\s+/g, ' ').trim();

function similarToTitle(line, titleKey) {
  const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const a = norm(line), b = new Set(norm(titleKey));
  if (!a.length || a.length > 12 || /[.?]$/.test(line.trim())) return false;
  return a.filter((w) => b.has(w)).length / a.length >= 0.6;
}

const words = (t) => t.split(/\s+/).filter(Boolean);
const isTitleCase = (t) => {
  const w = words(t).filter((x) => x.length > 2);
  if (w.length < 2) return false;
  const capped = w.filter((x) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9]/.test(x)).length;
  return capped === w.length || (w.length >= 3 && capped / w.length >= 0.6);
};

/** Título de seção: curto, sem pontuação final, sem verbo de ação no início */
function isHeading(line) {
  const t = line.trim();
  if (NUMBERED.test(t) && /[.!?]$/.test(t)) return false;
  const w = words(tidy(t));
  if (!w.length || w.length > 8 || /[.!?;,:]$/.test(t) || COND_START.test(tidy(t))) return false;
  if (!/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9]/.test(tidy(t))) return false;
  return !leadVerb(tidy(t));
}

// "Passo 1", "Etapa 2", "Fase 3"…: marca o início de uma etapa do passo a passo (mesmo no meio de uma frase)
const MAJOR_RE = /^(passo|etapa|fase|parte|step|stage|m[oó]dulo|cap[ií]tulo)\s*\d+\b/i;
/** "PASSO 2: PREENCHER O FORMULÁRIO" → "Passo 2: Preencher o formulário" (mantém siglas como 2FA, SMS) */
function niceTitle(t) {
  const letters = t.replace(/[^A-Za-zÀ-ú]/g, '');
  if (!letters || letters.replace(/[^A-ZÀ-Ý]/g, '').length / letters.length < 0.7) return t;
  let first = true;
  return t.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w) || !/[A-Za-zÀ-ú]/.test(w)) return w;
    const keep = /\d/.test(w) && /[A-Z]/.test(w) || (w.length <= 3 && /^(SMS|PDF|URL|TI|RH|CPF|CNPJ|API|APP|PC|USB|SSD|TV|PIN|ID)$/i.test(w.replace(/[^\wÀ-ú]/g, '')));
    const out = keep ? w : first ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase();
    first = false;
    return out.replace(/:\s*$/, ':');
  }).join('').replace(/: ([a-zà-ú])/, (m, c) => ': ' + c.toUpperCase());
}

/** 1. linhas → seções com itens */
function parseDocument(text, title, opts = {}) {
  const keepTips = !!opts.keepTips;   // Processo: dicas/avisos são guardados para virar observação dentro dos blocos
  const raw = String(text).replace(/\r/g, '').replace(/­/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const titleKey = String(title || '').toLowerCase().trim();

  // junta linhas quebradas pela largura da página
  const lines = [];
  for (const l of raw) {
    if (!l) { lines.push(''); continue; }
    const prev = lines.length ? lines[lines.length - 1] : '';
    const continuation = prev && !NUMBERED.test(l) && !/[.!?:;]$/.test(prev) && !isHeading(prev)
      && (/^[a-zà-ú(]/.test(l) || prev.length >= 55 || /[,\-–]$/.test(prev));
    if (continuation) lines[lines.length - 1] = (prev.replace(/-$/, '') + (prev.endsWith('-') ? '' : ' ') + l).trim();
    else lines.push(l);
  }

  // marca tabelas: duas ou mais linhas seguidas em "Título Capitalizado" sem verbo
  const tableIdx = new Set();
  for (let i = 0; i < lines.length; i++) {
    let j = i;
    // "Passo 1: …" nunca é célula de tabela (era isso que sumia com o Passo 1 logo abaixo do título)
    while (j < lines.length && lines[j] && !MAJOR_RE.test(lines[j]) && isTitleCase(lines[j]) && !/[.!?]$/.test(lines[j]) && words(lines[j]).length <= 8) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) tableIdx.add(k);
    if (j > i) i = j - 1;
  }

  // cada seção sabe a qual etapa principal pertence (subseções e dicas entram na etapa da qual fazem parte)
  const sections = [{ title: '', major: '', lines: [] }];
  let major = '';
  const open = (title) => {
    const t = niceTitle(title);
    if (MAJOR_RE.test(t)) major = t;
    sections.push({ title: t, major: MAJOR_RE.test(t) ? t : major, lines: [] });
  };
  lines.forEach((l, i) => {
    if (!l || tableIdx.has(i) || l.length < 3) return;
    if (NOISE_RE.test(l) || /^[\d\s./-]+$/.test(l)) return;
    if (titleKey && similarToTitle(l, titleKey)) return;
    const mj = MAJOR_RE.test(tidy(l)) ? /^((?:passo|etapa|fase|parte|step|stage|m[oó]dulo|cap[ií]tulo)\s*\d+)\s*[:.\-–)]?\s*(.*)$/i.exec(tidy(l)) : null;
    if (mj && !isHeading(l)) {
      // "Passo 1: Acesse o site oficial." → etapa "Passo 1" + o passo "Acesse o site oficial."
      const rest = mj[2].trim();
      const short = rest && words(rest).length <= 7 && !/[.!?]$/.test(rest) && !leadVerb(rest);
      open(cap(mj[1].toLowerCase()) + (short ? ': ' + rest : ''));
      if (rest && !short) sections.at(-1).lines.push('1. ' + rest);
      return;
    }
    if (isHeading(l)) { open(tidy(l)); return; }
    sections.at(-1).lines.push(l);
  });

  // filtra o que não é passo
  return sections.map((sec) => {
    const numbered = sec.lines.filter((l) => NUMBERED.test(l)).length;
    // seções descritivas (visão geral, recursos...) só contam se tiverem uma lista de passos
    const tipSec = keepTips && TIP_SECTION.test(sec.title || '');
    // comparativos/vantagens são sempre informativos, mesmo em lista: ficam fora do fluxo
    if (!tipSec && DESCRIPTIVE_SECTION.test(sec.title) && (numbered < 2 || INFO_SECTION.test(sec.title))) {
      // seção descritiva: no Processo, só as dicas/avisos dela são aproveitados (como observação de um bloco)
      const tips = keepTips ? sec.lines.map(tidy).filter((t) => t.length >= 6 && TIP_SRC.test(t)).map((t) => t.replace(TIP_SRC, '').trim()).filter((b) => b.length >= 4).map((b) => b.charAt(0).toUpperCase() + b.slice(1)) : [];
      return { ...sec, items: tips, tipItems: new Set(tips) };
    }
    const hasNumbered = numbered > 0;
    const items = [];
    const tipItems = new Set();
    for (const l of sec.lines) {
      const t = tidy(l);
      // dica/aviso ("Atenção: …", "Dica: …" ou item sem número de uma seção "Dicas de segurança")
      if (keepTips && t.length >= 6 && (TIP_SRC.test(t) || (tipSec && !/^\s*\d+[.)]/.test(l)))) {
        const body = t.replace(TIP_SRC, '').trim();
        if (body.length >= 4) { const b = body.charAt(0).toUpperCase() + body.slice(1); items.push(b); tipItems.add(b); }
        continue;
      }
      if (t.length < 6 || NOTE_RE.test(t) || DESCRIPTIVE_LINE.test(t)) continue;
      // células de tabela e rótulos soltos: sem número e sem pontuação final
      if (!NUMBERED.test(l) && !/[.!?:]$/.test(t) && (words(t).length <= 3 || !hasNumbered || isTitleCase(t))) continue;
      const cond = COND_START.test(t) || ELSE_RE.test(t) || VALIDATION.test(t) || /\?$/.test(t);
      if (hasNumbered && !NUMBERED.test(l) && !cond) continue;          // seção com lista: só os itens numerados
      if (!hasNumbered && !cond && !leadVerb(t)) continue;               // sem lista: só frases com ação
      // frases longas com várias sentenças
      t.split(/(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).forEach((p) => p.trim().length >= 6 && items.push(p.trim()));
    }
    return { ...sec, items, tipItems };
  }).filter((s) => s.items.length);
}

/** 2. classifica cada item */
const OPTIONAL_CHOICE = /^(opcionalmente|se (preferir|desejar|quiser|achar necess[aá]rio|for necess[aá]rio|necess[aá]rio|precisar)|caso (prefira|deseje|queira|necess[aá]rio|precise|ache necess[aá]rio))\s*,?\s+/i;
// validações explícitas ("Teste a conexão", "Confirme o e-mail") → no tipo Decisão viram pergunta com volta para corrigir
const VALIDATE_RE = /^(teste|testar|confirme|confirmar|valide|validar|cheque|checar|inspecione|inspecionar)\b/i;
const VALID_Q = { teste: 'funcionando?', testar: 'funcionando?', confirme: 'confirmado?', confirmar: 'confirmado?', valide: 'válido?', validar: 'válido?',
  cheque: 'ok?', checar: 'ok?', inspecione: 'ok?', inspecionar: 'ok?' };

function classify(item) {
  const t = tidy(item).replace(/[.;!]+$/, '');
  if (ELSE_RE.test(t)) return { type: 'else', text: t.replace(ELSE_RE, '').replace(/^(seja|for|esteja|estiver|houver|tenha|tiver|ocorra|aconte[cç]a)\b[,\s]*/i, '') };
  if (OPTIONAL_COND.test(t)) return { type: 'action', text: t.replace(OPTIONAL_COND, ''), optional: true };
  // "Se preferir / Se desejar / Opcionalmente / Caso queira, X" → passo opcional (no tipo Decisão vira "Deseja X?")
  if (OPTIONAL_CHOICE.test(t)) return { type: 'action', text: t.replace(OPTIONAL_CHOICE, ''), optional: true };
  let m;
  if (COND_START.test(t)) {
    const body = t.replace(COND_START, '');
    // "Se X, Y" / "Se X então Y"
    if ((m = /^(.+?)(?:,\s*|\s+ent[aã]o\s+)(.+)$/i.exec(body)) && words(m[2]).length >= 2) {
      // "Caso esteja, ..." → continuação positiva da validação anterior
      if (/^(esteja|estiver|seja|for|tenha|tiver|sim|positivo|haja|houver|estejam|estiverem)$/i.test(m[1].trim())) return { type: 'then', text: m[2] };
      return { type: 'if', question: m[1], action: m[2] };
    }
    return { type: 'if', question: body, action: '' };
  }
  // "Y, se X" / "Y caso X"
  if ((m = /^(.+?),?\s+(?:se|caso)\s+(.{6,})$/i.exec(t)) && leadVerb(m[1]) && !/\b(certifique|verifi|confir|confira|valid)/i.test(m[1])) {
    return { type: 'if', question: m[2], action: m[1] };
  }
  if ((m = VALIDATION.exec(t))) {
    const before = t.slice(0, m.index).replace(/[,\s]+e?\s*$/i, '').trim();
    return { type: 'check', question: m[2], before: before && leadVerb(before) && words(before).length >= 2 ? before : '' };
  }
  if (/\?$/.test(t)) return { type: 'check', question: t, before: '' };
  return { type: 'action', text: t };
}

/**
 * 3. seções alternativas (métodos/opções)
 * Só vira escolha (losango) quando as seções são ALTERNATIVAS de verdade ("Método 1 / Método 2",
 * "Instalação por disco / Instalação digital"). Etapas, fases e partes de um passo a passo são
 * cronológicas e ficam sempre em sequência — nunca "Qual etapa usar?".
 */
const SEQUENTIAL = /^(etapa|passo|parte|fase|se[cç][aã]o|cap[ií]tulo|t[oó]pico|step|stage|part|m[oó]dulo|aula|li[cç][aã]o|item|tarefa|\d+\s*[ºª°.)\-:]?|[ivx]+[.)\-:]|primeir|segund|terceir|quart|quint|sext|[uú]ltim|final|conclus|introdu|prepar|antes|depois|ap[oó]s|in[ií]cio|requisit|pr[eé]-)/i;
function findAlternatives(sections, text = '') {
  const firstWord = (t) => (words(t)[0] || '').toLowerCase();
  const ALT = /^(op[cç][aã]o|m[eé]todo|alternativa|forma|cen[aá]rio|via|pelo|pela|por|caminho|modo)\b/i;
  // o documento indica escolha? ("ou", "alternativamente", "escolha", "uma das opções"...)
  const CHOICE = /\b(alternativ\w*|escolh\w*|op[cç][aã]o|op[cç][oõ]es|m[eé]todos?|ou ent[aã]o|uma das|de duas formas|de tr[eê]s formas|outra forma|outra maneira|caso prefira|se preferir)\b/i;
  const docOffersChoice = CHOICE.test(text);
  const compatible = (a, b) => {
    if (!a.title || !b.title) return false;
    if (SEQUENTIAL.test(a.title) || SEQUENTIAL.test(b.title)) return false;           // etapas em sequência
    if (ALT.test(a.title) && ALT.test(b.title)) return true;                           // "Método…" / "Opção…"
    return docOffersChoice && firstWord(a.title).length >= 4 && firstWord(a.title) === firstWord(b.title);
  };
  const groups = [];
  for (let i = 0; i < sections.length; i++) {
    let j = i + 1;
    while (j < sections.length && compatible(sections[i], sections[j])) j++;
    if (j - i >= 2) { groups.push([i, j]); i = j - 1; }
  }
  return groups;
}

function altLabel(title, common) {
  const paren = (/\(([^)]+)\)/.exec(title) || [])[1];
  let diff = words(title.replace(/\([^)]*\)/g, '')).slice(common).join(' ')
    .replace(/^(por|pelo|pela|via|com|de|do|da|no|na|em)\s+/i, '').trim();
  if (!diff || words(diff).length > 2) diff = paren && words(paren).length <= 3 ? paren : diff;
  return cap(words(diff || title).slice(0, 3).join(' '));
}

// ------------------------------------------------------------------ montagem
/**
 * Gera o Mermaid a partir do texto, em um dos 3 tipos de fluxograma:
 *  - 'processo' → linear: UM fluxo contínuo de cima para baixo, sem seções/colunas; losangos só nas condições reais do texto
 *  - 'raias'    → funcional (swimlane): cada passo na raia do responsável (cliente, suporte, financeiro…)
 *  - 'decisao'  → tomada de decisão: perguntas Sim/Não com ramificações claras
 */
const TYPES = ['processo', 'raias', 'decisao'];
function heuristicMermaid(text, title, direction = 'TD', type = 'decisao', opts = {}) {
  if (!TYPES.includes(type)) type = 'decisao';
  // natural: layout ramificado por etapas SEM perguntas acrescentadas ("Deseja…?", "Passo N concluído?") — usado no Automático
  const decide = type === 'decisao' && !opts.natural;
  const linear = type === 'processo';
  const tipsInside = linear || !!opts.natural;   // dicas/avisos viram observação dentro do bloco (Processo e Automático)
  let sections = parseDocument(text, title, { keepTips: tipsInside });
  if (!sections.length) {
    // nada reconhecido como passo: usa todas as frases com verbo de ação
    const items = String(text).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 8 && (leadVerb(x) || COND_START.test(x)));
    sections = [{ title: '', items: items.slice(0, 40) }];
  }

  const nodes = new Map();   // id → { label, shape, cls, sg }
  const edges = [];          // { from, to, label, dotted }
  const sgs = [];            // { id, title, ids[] }
  let seq = 0;
  let secIdx = 0;
  const secTitles = [];
  const warnings = [];   // avisos da interpretação (aparecem na aba Análise)
  let goal = '';
  let curRaw = '';
  if (opts.report) { Object.defineProperty(opts.report, 'sources', { get: () => Object.fromEntries([...nodes.entries()].filter(([, n]) => n.src).map(([id, n]) => [id, n.src])), configurable: true, enumerable: true }); }
  if (opts.report) { opts.report.warnings = warnings; Object.defineProperty(opts.report, 'goal', { get: () => goal, configurable: true, enumerable: true }); }
  let currentSg = null;
  let lane = '';   // responsável atual (fluxograma Funcional)
  const add = (prefix, label, shape = 'proc', cls = '', ln = lane) => {
    const id = prefix + (++seq);
    // revisão final do texto (infinitivos, palavras repetidas, cortes)
    label = shape === 'dec' ? polishLabel(label, 'question') : shape === 'term' ? label : polishLabel(label, shape === 'note' ? 'note' : 'action');
    nodes.set(id, { label, shape, cls, sg: currentSg, lane: ln, sec: secIdx, src: curRaw });
    currentSg?.ids.push(id);
    return id;
  };
  const edge = (from, to, label = '', dotted = false) => edges.push({ from, to, label, dotted });
  // nota lateral (fluxograma de Processo): a exceção fica registrada sem abrir um caminho novo
  const note = (txt, prefix = '') => {
    const at = pending[0]?.from;
    if (!at || !txt) return;
    const n = add('N', esc(prefix + txt), 'note', 'nota', nodes.get(at)?.lane);
    edges.push({ from: at, to: n, label: '', note: true });
  };

  nodes.set('INICIO', { label: 'Início', shape: 'term', cls: 'inicioFim' });
  let pending = [{ from: 'INICIO', label: '' }];
  let lastStep = null;   // último passo de ação (destino de "corrigir e tentar de novo")
  const connect = (id) => {
    pending.forEach((p) => edge(p.from, id, p.label));
    pending = [{ from: id, label: '' }];
    if (/^P/.test(id)) lastStep = id;
  };
  const RETRY = /\b(corre[cç][aã]o|corrig\w*|tent\w* novamente|\w+ novamente|de novo|outra vez|refa[cz]\w*|retorn\w*|volt\w*|repet\w*|reenvi\w*|ajust\w* e|por mais|mais \d+ minutos?|mais um pouco|mais alguns minutos)\b/i;
  let endNo = null;
  const toEndNo = (id) => { endNo ||= (nodes.set('FIMN', { label: 'Fim sem conclusão', shape: 'term', cls: 'inicioFim' }), 'FIMN'); edge(id, endNo); };

  // passos lineares consecutivos → UM bloco por ação, ligados em sequência (nada de listas de tarefas)
  let run = [];
  const deferredTips = [];   // dicas que não couberam (2 por bloco) esperam o próximo bloco de ação
  const flush = () => {
    // Processo: subtarefas seguidas com o mesmo verbo viram um passo só ("Conectar monitor" + "Conectar teclado" → "Conectar monitor e teclado")
    if (linear) run = mergeSameVerb(run);
    // alternativas em sequência ("Abrir Google Play Store" → "Abrir App Store") e repetições viram UM passo
    run = run.reduce((acc, r) => {
      const prev = acc[acc.length - 1];
      // dica/aviso ("Não usar nome real", "Anotar senha em local seguro") → observação dentro do bloco de ação anterior
      // Regra universal do Processo: dica/aviso NUNCA é bloco. Vai para o bloco de ação mais relacionado
      // (palavras em comum: "Anotar senha…" → "Criar senha forte"); senão para o bloco anterior.
      if (tipsInside && (r.tip || isTip(r.label))) {
        const cands = [...acc.filter((x) => !x.tipOnly), ...[...nodes.entries()].filter(([id]) => /^P/.test(id)).map(([id, n]) => ({ node: n, label: n.label }))];
        const best = cands.map((c) => [c, relatedness(r.label, c.label)]).filter(([, k]) => k > 0).sort((x, y) => y[1] - x[1])[0]?.[0];
        const atPending = pending.length === 1 && /^P/.test(pending[0].from) ? { node: nodes.get(pending[0].from) } : null;
        const full = (t) => ((t.node ? t.node.tips : t.tips) || []).length >= 2;
        const target = [best, prev, atPending].find((t) => t && !full(t));
        if (target) {
          if (target.node) { (target.node.tips ||= []).push(polishLabel(r.label, 'action')); }
          else (target.tips ||= []).push(r.label);
          return acc;
        }
        // blocos anteriores já com 2 observações: a dica vai para o próximo bloco de ação
        deferredTips.push(polishLabel(r.label, 'action'));
        return acc;
      }
      const m = prev && prev.lane === r.lane && mergeAlternative(prev.label, r.label);
      if (m) prev.label = m; else acc.push({ ...r });
      return acc;
    }, []);
    run.forEach((r) => {
      const id = add('P', r.label, 'proc', '', r.lane);
      if (r.tips) (nodes.get(id).tips ||= []).push(...r.tips.map((t) => polishLabel(t, 'action')));
      const n = nodes.get(id);
      while (deferredTips.length && (n.tips || []).length < 2) (n.tips ||= []).push(deferredTips.shift());
      connect(id);
    });
    run = [];
  };
  const PURPOSE = /^(.+?)\s+e\s+(.+?)\s+para\s+((?:abrir|acessar|entrar|exibir|iniciar|chegar|ver|ativar|liberar|carregar)\b.+)$/i;
  const pushAction = (txt) => {
    const tip = tipsInside && TIP_SRC.test(txt);
    // "Ligue o computador e pressione F12… para abrir o menu de boot" → "Ligar computador e abrir menu de boot"
    // (o detalhe de COMO fazer vira observação do bloco)
    const pm = PURPOSE.exec(String(txt).replace(/[.;]+$/, ''));
    if (pm && leadVerb(pm[1]) && leadVerb(pm[2])) {
      const a1 = shortenAction(pm[1]), a2 = shortenAction(pm[3]);
      const l = a1 && a2 ? esc(`${a1} e ${a2.charAt(0).toLowerCase() + a2.slice(1)}`) : '';
      const how = shortenTip(pm[2]);
      if (l) { run.push({ label: l, lane, tip, tips: how ? [how] : undefined }); return; }
    }
    splitCompound(txt).forEach((p) => { const l = esc(shortenAction(p)); if (l && wordCount(l) >= 1) run.push({ label: l, lane, tip }); });
  };

  // ação composta de um ramo ("resolve e responde ao cliente") → blocos encadeados
  const chain = (txt, prefix = 'P', cls = '') => {
    const parts = splitCompound(txt).map((p) => esc(shortenAction(p))).filter(Boolean);
    if (!parts.length) parts.push(esc(shortenAction(txt)));
    const idsC = parts.map((l) => add(prefix, l, 'proc', cls));
    for (let i = 1; i < idsC.length; i++) edge(idsC[i - 1], idsC[i]);
    return [idsC[0], idsC[idsC.length - 1]];
  };
  /**
   * Ramo de uma decisão: ações encadeadas; se a última for uma repetição ("execute o backup novamente",
   * "reinicie o computador") o ramo VOLTA ao passo existente em vez de duplicá-lo. "Responder ao cliente/encerrar"
   * vai ao Fim; notificar/cancelar/reprovar encerra em "Fim sem conclusão". persist: saída do laço
   * ("Se o erro persistir após 3 tentativas, abra um chamado"). Devolve { start, end, closed }.
   */
  const branch = (txt, prefix, cls, validated, persist) => {
    let text = String(txt).replace(/^(?:a|o)?\s*[\wÀ-ú]+ segue para (?:o |a )?/i, 'encaminhe para o ');
    // "…e tente novamente / e repita" no fim é o próprio retorno: vira a seta de volta, não texto do bloco
    const tailRetry = /,?\s+e\s+(tente|tentar|repita|repetir|fa[cç]a|fazer)\s+(novamente|de novo|outra vez|o processo|o procedimento|a opera[cç][aã]o)[.;]?\s*$/i;
    const hadTailRetry = tailRetry.test(text);
    if (hadTailRetry) text = text.replace(tailRetry, '');
    const raws = splitCompound(text);
    const cand = (all) => [...nodes.entries()].filter(([id, n]) => /^[PE]/.test(id) && n.shape === 'proc' && (all || n.sec === secIdx)).map(([id, n], i) => ({ id, label: n.label, order: i }));
    let loop = retryTarget(raws[raws.length - 1], cand(false)) || retryTarget(raws[raws.length - 1], cand(true));
    if (loop) raws.pop();
    else if ((hadTailRetry || RETRY.test(text)) && validated && nodes.has(validated)) loop = validated;
    const labels = raws.map((p) => esc(shortenAction(p))).filter(Boolean);
    if (!labels.length && loop) {
      if (persist) return persistExit(null, loop, persist);
      return { start: loop, end: loop, closed: true };
    }
    if (!labels.length) labels.push(esc(shortenAction(text)));
    const ids = labels.map((l) => add(prefix, l, 'proc', cls));
    for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i]);
    const start = ids[0], end = ids[ids.length - 1];
    if (loop) {
      if (persist) { const r = persistExit(end, loop, persist); return { start, end: r.end, closed: r.closed }; }
      edge(end, loop);
      return { start, end, closed: true };
    }
    if (DONE_RE.test(text)) { if (cls === 'erro') nodes.get(start).cls = ''; edge(end, 'FIM'); return { start, end, closed: true }; }
    if (END_RE.test(text) && !/\b(seguir|encaminh)/i.test(text)) { nodes.get(end).cls = 'erro'; toEndNo(end); return { start, end, closed: true }; }
    return { start, end, closed: false };
  };
  // laço com limite: "erro persiste após 3 tentativas?" Não → tenta de novo; Sim → escalonamento e segue
  const persistExit = (from, loop, persist) => {
    const d2 = add('D', question(persist.question, true), 'dec', 'decisao');
    if (from) edge(from, d2);
    edge(d2, loop, 'Não');
    const r = persist.action ? branch(persist.action, 'E', 'erro', null) : null;
    if (r) { edge(d2, r.start, 'Sim'); return { start: from || d2, end: r.end, closed: r.closed }; }
    return { start: from || d2, end: d2, closed: false, label: 'Sim' };
  };
  /** caminho que o documento não descreve: encerra discretamente com "Não documentado" (sem inventar solução) */
  const undocumented = (d, q) => {
    const u = add('U', 'Não documentado', 'term', 'duvida');
    edge(d, u, 'Não');
    warnings.push(`O documento não descreve o caminho "Não" de "${q}": o caminho foi encerrado como "Não documentado" — complemente o procedimento.`);
  };
  const short = (t) => { const w = String(t).split(/\s+/); return w.length > 8 ? w.slice(0, 8).join(' ') + '…' : w.join(' '); };
  const question = (q, conditional) => esc(shortenQuestion((conditional ? 'se ' : '') + q));
  const genericQ = (q) => !q || /^(contr[aá]rio|condi[cç][aã]o|ok|sim|n[aã]o|decis[aã]o|verificar)\??$/i.test(q.replace(/\?$/, ''));

  const emitSection = (sec) => {
    secIdx++;
    secTitles[secIdx] = sec.title || '';
    // camada 2: frases separadas, objetivo fora do fluxo, dependências e finalização em ordem, dúvidas marcadas
    const prep = prepareItems(sec.items);
    warnings.push(...prep.notes);
    goal ||= prep.goal;
    const items = normalizeConditions(prep.items.map(classify), prep.items, warnings);
    const seqStart = seq;
    for (let k = 0; k < items.length; k++) {
      curRaw = items[k].raw || '';   // origem no PDF de cada bloco criado nesta iteração
      if (tipsInside && sec.tipItems?.has(items[k].raw)) {
        const l = esc(shortenTip(items[k].raw));
        if (l) run.push({ label: l, lane, tip: true });
        continue;
      }
      const who = extractActor(items[k].raw || '');
      if (who) lane = who;                         // o responsável vale para este passo e os seguintes
      const it = items[k];
      const next = items[k + 1];
      if (decide && it.type === 'action' && it.optional) {
        // escolha do usuário: "Deseja personalizar avatar?" → Sim faz; Não segue em frente
        flush();
        const act = polishLabel(esc(shortenAction(it.text)), 'action');
        const verbPhrase = act.charAt(0).toLowerCase() + act.slice(1);
        const q = `Deseja ${verbPhrase.split(' ').slice(0, 4).join(' ')}?`;
        const d = add('D', q, 'dec', 'decisao');
        connect(d);
        const y = add('P', act);
        edge(d, y, 'Sim');
        pending = [{ from: y, label: '' }, { from: d, label: 'Não' }];
        continue;
      }
      if (decide && it.type === 'action' && VALIDATE_RE.test(it.text.trim())) {
        // validação: "Testar conexão" → "Conexão funcionando?" · Não → corrigir e testar de novo
        pushAction(it.text); flush();
        const step = pending[0]?.from;
        const label = step ? nodes.get(step).label : '';
        const verb = (VALIDATE_RE.exec(it.text.trim())[1] || '').toLowerCase();
        const obj = label.split(' ').slice(1).join(' ');
        if (step && obj) {
          const d = add('D', `${obj.charAt(0).toUpperCase() + obj.slice(1)} ${VALID_Q[verb] || 'ok?'}`.split(' ').slice(0, 5).join(' ').replace(/([^?])$/, '$1?'), 'dec', 'decisao');
          connect(d);
          const z = add('E', `Corrigir ${obj}`.split(' ').slice(0, 5).join(' '), 'proc', 'erro');
          edge(d, z, 'Não');
          edge(z, step);
          pending = [{ from: d, label: 'Sim' }];
        }
        continue;
      }
      if (it.type === 'action') {
        pushAction(it.text);
        if (prep.doubts.has(it.raw)) {
          // instrução vaga ("talvez", "dependendo da versão"): fica no fluxo, marcada com dúvida — nada é inventado
          flush();
          const id = pending[0]?.from;
          const crit = prep.doubts.get(it.raw);
          if (id && nodes.has(id) && /^P/.test(id)) { const n = nodes.get(id); n.cls = 'duvida'; (n.tips ||= []).push(crit ? `Critério não definido: ${crit}` : 'Critério não definido no documento'); }
        }
        continue;
      }
      if (it.type === 'else' || it.type === 'then') { pushAction(it.text); continue; } // sem decisão antes: vira passo

      flush();
      if (it.type === 'multi') {
        // várias condições sobre o mesmo assunto → um losango com uma saída por caso
        const subj = it.subject.replace(/\s+(for|forem|estiver|estiverem|tiver|tiverem|seja|sejam|esteja|estejam|houver)$/i, '').replace(/^(o|a|os|as)\s+/i, '');
        const d = add('D', `${subj.charAt(0).toUpperCase() + subj.slice(1)}: qual caso?`, 'dec', 'decisao');
        connect(d);
        const after = [];
        for (const br of it.branches) {
          const rest = br.question.split(/\s+/).slice(it.subject.split(/\s+/).length).join(' ') || br.question;
          const lbl = rest.split(/\s+/).slice(0, 4).join(' ').replace(/[,.;]+$/, '');
          const r = branch(br.action, 'P', '', null);
          edge(d, r.start, lbl);
          if (!r.closed) after.push({ from: r.end, label: '' });
        }
        pending = after;
        continue;
      }
      if (it.type === 'check' && it.before) { pushAction(it.before); flush(); }
      // ---- é uma DECISÃO de verdade? "Verifique se X" sem nenhuma consequência no documento é um passo de
      // verificação (não abre caminhos): vira atividade, sem losango artificial
      const hasYes = it.type === 'if' ? !!it.action : !!(it.thenText || next?.type === 'then');
      const hasNo = !!(it.elseText || items[k + 1]?.type === 'else' || it.persist);
      if (it.type === 'check' && !hasYes && !hasNo && !/\?\s*$/.test(it.raw || '')) {
        const lbl = checkLabel(it.question);
        if (lbl) { run.push({ label: esc(lbl), lane }); flush(); }
        continue;
      }
      // ---- já estamos no caminho de falha: "Se a internet não funcionar, …" logo depois do "Não" de
      // "Página carrega?" não precisa perguntar de novo — a condição já foi respondida
      const failCond = it.type === 'if' && it.action && FAIL_RE.test(it.question);
      if (failCond && pending.length === 1 && pending[0].label === 'Não' && nodes.get(pending[0].from)?.shape === 'dec') {
        warnings.push(`"${short(it.question)}" já é o caminho "Não" de "${nodes.get(pending[0].from).label}": a pergunta não foi repetida.`);
        pushAction(it.action);
        continue;
      }
      // ---- polaridade: a pergunta fica sempre AFIRMATIVA ("Se a internet não funcionar, X" → "Internet funciona?"
      // Não → X), para Sim/Não nunca ficarem invertidos
      const neg = it.type === 'if' && negativeCondition(it.question);
      const qText = neg ? positiveCondition(it.question) : it.question;
      const q = question(qText, it.type === 'if');
      if (genericQ(q)) { pushAction(it.action || it.question); continue; }
      // passo que esta decisão verifica (destino dos retornos "corrigir e tentar de novo")
      const validated = pending.length === 1 && /^[PE]/.test(pending[0].from) ? pending[0].from : lastStep;
      const d = add('D', q, 'dec', 'decisao');
      connect(d);
      const after = [];
      let yesText = it.type === 'if' ? it.action : (it.thenText || '');
      if (!yesText && it.type === 'check' && next?.type === 'then') { yesText = next.text; k++; }
      let noText = it.elseText || '';
      if (!noText && items[k + 1]?.type === 'else') noText = items[++k].text;
      if (neg) [yesText, noText] = [noText, yesText];
      // ---- Sim
      if (yesText && isOutcome(yesText)) {
        // "a conexão está funcionando" é um RESULTADO, não uma ação: encerra o caminho com esse resultado
        const r = add('R', esc(outcomeLabel(yesText)), 'term', 'inicioFim');
        edge(d, r, 'Sim');
      } else if (yesText) {
        const y = branch(yesText, 'P', '', validated);
        edge(d, y.start, 'Sim');
        if (!y.closed) after.push({ from: y.end, label: '' });
      } else after.push({ from: d, label: 'Sim' });
      // ---- Não
      if (noText && isOutcome(noText)) {
        const r = add('R', esc(outcomeLabel(noText)), 'term', 'inicioFim');
        edge(d, r, 'Não');
      } else if (noText) {
        const z = branch(noText, 'E', 'erro', validated, it.persist);
        edge(d, z.start, 'Não');
        if (!z.closed) {
          // dependência: o próximo passo usa o resultado do ramo Sim e não o do Não → o Não encerra aqui
          const nxt = items[k + 1];
          const nl = nxt && nxt.type === 'action' ? shortenAction(nxt.text) : '';
          if (yesText && nl && overlap(nl, shortenAction(yesText)) > overlap(nl, shortenAction(noText))) {
            toEndNo(z.end);
            warnings.push(`"${nl}" depende do ramo Sim de "${q}"; o ramo Não termina em "Fim sem conclusão".`);
          } else after.push({ from: z.end, label: '' });
        }
      } else if (yesText && isOutcome(yesText)) {
        // "Se a página carregar, a conexão funciona": o Não segue para o que o documento descreve depois
        // (normalmente "Solução de problemas"); se não houver nada depois, fica marcado como não documentado
        after.push({ from: d, label: 'Não', open: true });
      } else if (it.type === 'check' || (it.type === 'if' && !it.action && /\?$/.test(it.raw || ''))) {
        // validação sem o que fazer se falhar: volta ao passo verificado (retorno deduzido e avisado)
        if (validated && validated !== d && nodes.has(validated)) {
          edge(d, validated, 'Não');
          warnings.push(`O documento não diz o que fazer se "${q.replace(/\?$/, '')}" falhar: o caminho "Não" volta para "${nodes.get(validated).label}" (refazer o passo).`);
        } else undocumented(d, q);
      } else if (it.type === 'if' && !it.action && !neg) {
        undocumented(d, q);
      } else after.push({ from: d, label: neg ? 'Sim' : 'Não' });
      pending = after;
    }
    flush();
    // tipo Decisão com poucas condições no texto: ponto de verificação ao fim de cada etapa (Não → refaz a etapa)
    if (decide && opts.checkpoints && sec.title) {
      const own = [...nodes.keys()].filter((id) => Number(id.replace(/\D+/g, '')) > seqStart && nodes.get(id).shape !== 'note');
      if (own.length >= 2) {
        // "Passo 2 concluído?" / "Etapa 1 concluída?"; seções sem número: "Telefone ok?"
        const num = /^(passo|etapa|fase|parte|step)\s*(\d+)/i.exec(sec.title);
        let q;
        if (num) q = `${num[1].charAt(0).toUpperCase() + num[1].slice(1).toLowerCase()} ${num[2]} ${/^(etapa|fase|parte)$/i.test(num[1]) ? 'concluída' : 'concluído'}?`;
        else {
          const w = sec.title.replace(/[:.]+$/, '').split(/\s+/).filter((x) => !/^(o|a|os|as)$/i.test(x)).slice(0, 3);
          while (w.length > 1 && /^(de|do|da|dos|das|e|com|para|em|no|na)$/i.test(w.at(-1))) w.pop();
          q = `${w.join(' ')} ok?`;
        }
        const d = add('D', q, 'dec', 'decisao');
        connect(d);
        edge(d, own[0], 'Não');
        pending = [{ from: d, label: 'Sim' }];
      }
    }
  };

  const alts = findAlternatives(sections, text);
  // Processo (linear): fluxo contínuo, sem blocos de seção. Demais tipos: cada seção com título vira um bloco
  const useSubgraphs = !linear && sections.some((s) => s.title);
  for (let i = 0; i < sections.length; i++) {
    const group = alts.find(([a]) => a === i);
    if (group) {
      // losango de escolha + um ramo (subgrafo) por alternativa
      const alt = sections.slice(group[0], group[1]);
      const tw = alt.map((s) => words(s.title.replace(/\([^)]*\)/g, '')).map((w) => w.toLowerCase()));
      let common = 0;
      while (tw.every((w) => w[common] && w[common] === tw[0][common])) common++;
      const labels = alt.map((s) => altLabel(s.title, common));
      const subject = words(alt[0].title).slice(0, common).join(' ').toLowerCase();
      const q = alt.length === 2
        ? `${labels[0]} ou ${labels[1].charAt(0).toLowerCase() + labels[1].slice(1)}?`
        : `Qual ${subject || 'opção'} usar?`;
      currentSg = null;
      const d = add('D', esc(wordCount(q) <= 5 ? q : `Qual ${subject || 'opção'} usar?`), 'dec', 'decisao');
      connect(d);
      const ends = [];
      alt.forEach((sec, j) => {
        currentSg = linear ? null : { id: 'S' + (sgs.length + 1), title: sec.title, lane: laneTitle(sec), ids: [] };
        if (currentSg) sgs.push(currentSg);
        pending = [{ from: d, label: labels[j] }];
        emitSection(sec);
        ends.push(...pending);
      });
      pending = ends;
      i = group[1] - 1;
      continue;
    }
    const sec = sections[i];
    currentSg = useSubgraphs && sec.title ? { id: 'S' + (sgs.length + 1), title: sec.title, lane: laneTitle(sec), ids: [] } : null;
    if (currentSg) sgs.push(currentSg);
    emitSection(sec);
  }
  currentSg = null;
  // Decisão de verdade: se o texto quase não tem condições, refaz com pontos de verificação por etapa
  if (decide && !opts.checkpoints && [...nodes.values()].filter((n) => n.shape === 'dec').length < 2 && sections.filter((x) => x.title).length >= 2) {
    return heuristicMermaid(text, title, direction, type, { ...opts, checkpoints: true });
  }
  // caminhos "Não" deixados em aberto ("Página carrega?" sem seção de problemas depois): não vão para o Fim de
  // sucesso — encerram como não documentados
  for (const p of pending.filter((x) => x.open)) undocumented(p.from, nodes.get(p.from).label);
  pending = pending.filter((x) => !x.open);
  nodes.set('FIM', { label: 'Fim', shape: 'term', cls: 'inicioFim' });
  connect('FIM');

  // ------------------------------------------------------------ serialização
  const def = (id) => {
    const n = nodes.get(id);
    if (n.shape === 'dec') return `${id}{"${n.label}"}`;
    if (n.shape === 'term') return `${id}(["${n.label}"])`;
    if (n.shape === 'note') return `${id}("${n.label}")`;
    // entrada/saída de dados (informar, digitar, preencher, registrar, imprimir…) → paralelogramo
    if (IO_RE.test(n.label) && !/^E/.test(id)) {
      const tipsIo = [...new Set(n.tips || [])].filter(Boolean).slice(0, 2);
      return `${id}[/"${n.label}${tipsIo.map((t) => `<br/>(${t})`).join('')}"/]`;
    }
    // observações/dicas do bloco (Processo): até 2 linhas "(…)" em itálico, sem repetir
    const tips = [...new Set(n.tips || [])].filter(Boolean).slice(0, 2);
    return `${id}["${n.label}${tips.map((t) => `<br/>(${t})`).join('')}"]`;
  };
  const edgeLine = (e) => `    ${e.from} ${e.note ? '-.-' : e.dotted ? '-.->' : '-->'}${e.label ? `|${esc(e.label)}|` : ''} ${e.to}`;
  const classLines = () => {
    const out = [
      '    classDef inicioFim fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20',
      '    classDef decisao fill:#FFF8E1,stroke:#F9A825,stroke-width:2px,color:#5D4037',
      '    classDef erro fill:#FFEBEE,stroke:#C62828,stroke-width:1.5px,color:#B71C1C',
    ];
    if ([...nodes.values()].some((n) => n.cls === 'duvida')) out.push('    classDef duvida fill:#FFF8E6,stroke:#C98A00,stroke-width:1.5px,stroke-dasharray:5 3,color:#6B4E00');
    if ([...nodes.values()].some((n) => n.cls === 'nota')) out.push('    classDef nota fill:#FFFDE7,stroke:#9E9E9E,stroke-width:1px,stroke-dasharray:4 3,color:#555555');
    const byCls = {};
    for (const [id, n] of nodes) if (n.cls) (byCls[n.cls] ||= []).push(id);
    for (const [c, ids] of Object.entries(byCls)) out.push(`    class ${ids.join(',')} ${c}`);
    return out;
  };

  // métodos ALTERNATIVOS ("Conexão por Wi-Fi" / "Conexão por cabo Ethernet"): uma decisão escolhe o método,
  // cada caminho é desenvolvido separado e todos se reúnem na etapa comum seguinte
  const alt = alternativeSections(nodes, edges, secTitles, sgs);
  if (alt.length) warnings.push(...alt);
  const altHeader = alt.length ? ['%% alternativas'] : [];
  // preparos PARALELOS (todas as formas de layout): cada frente começa junto e se junta no passo que usa o resultado
  const secGroups = secTitles.map((t, k) => ({ title: t, ids: [...nodes.keys()].filter((id) => nodes.get(id).sec === k) })).filter((g) => g.title && g.ids.length);
  parallelSections(nodes, edges, secGroups);
  if (type === 'raias') {
    return serializeLanes({ nodes, edges, sgs, title, direction, def, edgeLine, classLines }).replace(/^(%% tipo: raias\n)/, `$1${altHeader.map((h) => h + '\n').join('')}`);
  }
  const L = [`flowchart ${direction}`];
  const top = [...nodes.keys()].filter((id) => !nodes.get(id).sg && id !== 'INICIO' && id !== 'FIM' && id !== 'FIMN');
  const ends = ['FIMN', 'FIM'].filter((id) => nodes.has(id));
  const filled = sgs.filter((s) => s.ids.length);
  // direção explícita em cada bloco (sem isso o Mermaid alterna a direção dos blocos internos)
  const sgDir = direction === 'LR' || direction === 'RL' ? 'LR' : 'TB';
  const sgBlock = (sg, ind) => {
    L.push(`${ind}subgraph ${sg.id}["${esc(sg.title).slice(0, 60)}"]`);
    L.push(`${ind}    direction ${sgDir}`);
    sg.ids.forEach((id) => L.push(ind + '    ' + def(id)));
    L.push(`${ind}end`);
  };
  if (filled.length === 1) {
    // uma seção: Início é o primeiro e Fim o último elemento DENTRO dela
    const sg = filled[0];
    L.push(`    subgraph ${sg.id}["${esc(sg.title).slice(0, 60)}"]`);
    L.push(`        direction ${sgDir}`);
    ['INICIO', ...top, ...sg.ids, ...ends].forEach((id) => L.push('        ' + def(id)));
    L.push('    end');
  } else if (filled.length > 1) {
    // várias seções: um bloco principal (título do documento) contém Início, as seções e o Fim
    L.push(`    subgraph PRINCIPAL["${esc(title || 'Processo').slice(0, 70)}"]`);
    L.push(`        direction ${sgDir}`);
    ['INICIO', ...top].forEach((id) => L.push('        ' + def(id)));
    filled.forEach((sg) => sgBlock(sg, '        '));
    ends.forEach((id) => L.push('        ' + def(id)));
    L.push('    end');
  } else {
    ['INICIO', ...top, ...ends].forEach((id) => L.push('    ' + def(id)));
  }
  L.push('');
  for (const e of edges) L.push(edgeLine(e));
  L.push('', ...classLines());
  return (linear ? '%% tipo: processo\n' : '%% tipo: decisao\n') + altHeader.map((h) => h + '\n').join('') + L.join('\n') + '\n';
}

/** Junta passos seguidos com o mesmo verbo enquanto couber em 5 palavras (mesmo responsável) */
/** Texto da observação: frase de ação vira infinitivo (até 7 palavras); frase descritiva fica inteira até a 1ª vírgula */
function shortenTip(t) {
  const s = String(t).replace(/[.;!]+\s*$/, '').trim();
  // frase curta de ação: mantém inteira (as teclas/valores são o que importa), só com o verbo no infinitivo
  const w0 = s.split(/\s+/);
  const inf = w0.length <= 12 && leadVerb(s) ? toInfinitive(w0[0].toLowerCase(), { strict: true }) || toInfinitive(w0[0].toLowerCase()) : null;
  if (inf) return polishLabel([inf, ...w0.slice(1)].join(' ').replace(/\s+(o|a|os|as)\s+(?=\S)/gi, ' '), 'action');
  if (leadVerb(s) || /^(n[aã]o|nunca|jamais)\s/i.test(s)) return shortenAction(s, 7);
  const first = s.split(/[,;:(]\s*/)[0].trim();
  const w = first.split(/\s+/);
  // nunca corta no meio: até 14 palavras fica inteira; acima disso, só se houver um ponto natural de corte (" e ", " mas ")
  if (w.length <= 14) return first;
  const cut = first.split(/\s+(?:e|mas|porém|pois|porque)\s+/)[0];
  return cut.split(/\s+/).length <= 14 ? cut : '';
}

function mergeSameVerb(run) {
  const out = [];
  for (const r of run) {
    const prev = out[out.length - 1];
    const [v, ...obj] = r.label.split(' ');
    if (prev && !r.tip && !prev.tip && prev.lane === r.lane && prev.verb === v && obj.length && obj.length <= 2) {
      const objs = [...prev.objs, obj.join(' ')];
      const label = `${v} ${objs.length === 2 ? objs.join(' e ') : objs.slice(0, -1).join(', ') + ' e ' + objs.at(-1)}`;
      if (label.split(' ').length <= 6) { Object.assign(prev, { label, objs }); continue; }
    }
    out.push({ ...r, verb: v, objs: [obj.join(' ')] });
  }
  return out.map(({ label, lane, tip }) => ({ label, lane, tip }));
}

/** "os cabos estão conectados" → "Conferir cabos conectados" (passo de verificação no fluxo linear) */
function limitCheck(q) {
  const w = String(q).split(/\s+/).filter(Boolean);
  if (w[0]) w[0] = w[0].charAt(0).toLowerCase() + w[0].slice(1);
  const body = w.length > 3 ? w.filter((x) => !/^(est[aá]|est[aã]o|foi|foram|ficou|ficaram)$/i.test(x)) : w;
  return ['Verificar se', ...body].slice(0, 4).join(' ').split(' ').slice(0, 5).join(' ');
}

/**
 * Fluxograma Funcional (swimlane): um subgrafo por raia (responsável), na ordem em que aparecem.
 * Sem responsáveis no texto, as raias são as seções do documento.
 * O desenho final das raias (colunas/linhas) é feito no navegador (public/swimlane.mjs).
 */
/** Nome da raia de uma seção: a etapa principal (Passo N) quando houver; dicas e subseções entram nela */
function laneTitle(sec) {
  if (sec.major) return sec.major;
  return sec.title;
}

/**
 * MÉTODOS ALTERNATIVOS: seções seguidas que descrevem formas diferentes de fazer a mesma coisa
 * ("Conexão por Wi-Fi" / "Conexão por cabo Ethernet", "Opção 1…" / "Opção 2…", "Pagamento com cartão" / "… com Pix").
 * O documento as lista uma depois da outra, mas o usuário faz UMA delas: vira uma decisão "Qual tipo de …?", com um
 * caminho por método, todos reunidos na primeira atividade comum depois do grupo (ex.: "Verificação da conexão").
 * Diferente de etapas sequenciais (Etapa 1/2…) e de preparos paralelos (Preparo da massa/da cobertura).
 */
const MEANS = /^(por|via|pelo|pela|pelos|pelas|com|usando|atrav[eé]s|no|na|em)$/i;
const CHOICE_HEAD = /^(op[cç][aã]o|m[eé]todo|alternativa|forma|modo|caminho)$/i;
function alternativeSections(nodes, edges, secTitles, sgs) {
  const notes = [];
  const order = [...nodes.keys()];
  const words = (t) => String(t || '').trim().split(/\s+/);
  const isAlt = (a, b) => {
    if (!a || !b || /^(passo|etapa|fase|parte|step)\s*\d/i.test(a)) return false;
    const wa = words(a), wb = words(b);
    if (wa[0].toLowerCase() !== wb[0].toLowerCase()) return false;
    if (CHOICE_HEAD.test(wa[0])) return true;
    return wa.length >= 3 && wb.length >= 3 && MEANS.test(wa[1]) && MEANS.test(wb[1]) && a.toLowerCase() !== b.toLowerCase();
  };
  const members = (k) => order.filter((id) => nodes.get(id)?.sec === k);
  for (let i = 1; i < secTitles.length; i++) {
    let j = i;
    while (isAlt(secTitles[j], secTitles[j + 1]) && members(j + 1).length) j++;
    if (j === i || !members(i).length) continue;
    const group = []; for (let k = i; k <= j; k++) group.push(k);
    const inGroup = new Set(group.flatMap(members));
    const firstOf = (k) => members(k).find((id) => edges.some((e) => e.to === id && !members(k).includes(e.from))) || members(k)[0];
    const origins = edges.filter((e) => e.to === firstOf(i) && !inGroup.has(e.from));
    // primeira atividade comum depois do grupo
    const exitT = edges.filter((e) => members(j).includes(e.from) && !inGroup.has(e.to)).map((e) => e.to);
    const next = exitT.find((id) => order.indexOf(id) > Math.max(...[...inGroup].map((x) => order.indexOf(x)))) || exitT[0];
    if (!origins.length || !next) { i = j; continue; }
    const common0 = words(secTitles[i]).length >= 2 && MEANS.test(words(secTitles[i])[1]) ? 2 : 1;
    const branchLbl = (k, idx) => { const l = words(secTitles[k]).slice(common0).join(' ').replace(/^(o|a|os|as)\s+/i, '').split(/\s+/).slice(0, 3).join(' ') || `Opção ${idx + 1}`; return l.charAt(0).toUpperCase() + l.slice(1); };
    // o documento JÁ pergunta a escolha antes ("Você pode escolher entre Wi-Fi ou Ethernet" → "Wi-Fi ou Ethernet?"):
    // reaproveita essa decisão em vez de criar outra equivalente (sem decisões duplicadas)
    const nrm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/g, ' ');
    const existing = origins.length === 1 && nodes.get(origins[0].from)?.shape === 'dec' ? origins[0].from : null;
    const labels = group.map((k, idx) => branchLbl(k, idx));
    if (existing) {
      const exQ = nrm(nodes.get(existing).label) + ' ' + edges.filter((e) => e.from === existing).map((e) => nrm(e.label)).join(' ');
      const hits = labels.filter((l) => nrm(l).split(/\s+/).some((w) => w.length > 2 && exQ.includes(w))).length;
      if (hits >= 2) {
        for (let x = edges.length - 1; x >= 0; x--) if (edges[x].from === existing) edges.splice(x, 1);
        group.forEach((k, idx) => {
          for (const e of edges) if (members(k).includes(e.from) && inGroup.has(e.to) && !members(k).includes(e.to) && e.to === firstOf(k + 1)) e.to = next;
          edges.push({ from: existing, to: firstOf(k), label: labels[idx] });
        });
        const n = nodes.get(existing);
        n.label = n.label.replace(/^([a-zà-ú])/, (c) => c.toUpperCase()).replace(/\b(ethernet|wi-fi|bluetooth|windows|android|ios)\b/gi, (w) => ({ ethernet: 'Ethernet', 'wi-fi': 'Wi-Fi', bluetooth: 'Bluetooth', windows: 'Windows', android: 'Android', ios: 'iOS' })[w.toLowerCase()]);
        notes.push(`Métodos alternativos identificados (${group.map((k) => `"${secTitles[k]}"`).join(' / ')}): a decisão "${n.label}" do documento escolhe o método (sem criar outra equivalente) e os caminhos se reúnem em "${nodes.get(next)?.label || 'Fim'}".`);
        i = j;
        continue;
      }
    }
    // decisão de escolha do método
    const head = words(secTitles[i])[0];
    const q = CHOICE_HEAD.test(head) ? `Qual ${head.toLowerCase()} será usad${/[aã]o$|ç[aã]o$|a$/i.test(head) ? 'a' : 'o'}?` : `Qual tipo de ${head.toLowerCase()}?`;
    const did = 'DA' + i;
    const ref = nodes.get(firstOf(i));
    // insere a decisão logo antes do primeiro método (ordem dos nós = ordem de leitura)
    const fid = firstOf(i), originSg = nodes.get(origins[0].from)?.sg || null;
    const entries = [...nodes.entries()];
    nodes.clear();
    for (const [id, n] of entries) {
      if (id === fid) nodes.set(did, { label: q, shape: 'dec', cls: 'decisao', sg: originSg, lane: ref.lane, sec: 0 });
      nodes.set(id, n);
    }
    if (originSg?.ids) originSg.ids.splice(Math.max(0, originSg.ids.indexOf(fid)), 0, did);
    for (const e of origins) e.to = did;
    const common = words(secTitles[i]).length >= 2 && MEANS.test(words(secTitles[i])[1]) ? 2 : 1;
    group.forEach((k, idx) => {
      const lbl = words(secTitles[k]).slice(common).join(' ').replace(/^(o|a|os|as)\s+/i, '').split(/\s+/).slice(0, 3).join(' ') || `Opção ${idx + 1}`;
      // corta a fila "fim do método anterior → começo deste" e manda o fim de cada método para a etapa comum
      for (const e of edges) {
        if (members(k).includes(e.from) && inGroup.has(e.to) && !members(k).includes(e.to) && e.to === firstOf(k + 1)) e.to = next;
      }
      edges.push({ from: did, to: firstOf(k), label: lbl.charAt(0).toUpperCase() + lbl.slice(1) });
    });
    // tira entradas duplicadas que tenham sobrado (origem → primeiro método)
    for (let x = edges.length - 1; x >= 0; x--) { const e = edges[x]; if (edges.findIndex((f) => f.from === e.from && f.to === e.to && f.label === e.label) !== x) edges.splice(x, 1); }
    notes.push(`Métodos alternativos identificados (${group.map((k) => `"${secTitles[k]}"`).join(' / ')}): uma decisão escolhe o método e os caminhos se reúnem em "${nodes.get(next)?.label || 'Fim'}".`);
    i = j;
  }
  void sgs;
  return notes;
}

/**
 * Funcional: preparos paralelos ("Preparo da massa" / "Preparo da cobertura", "Massa" / "Recheio") não são uma fila.
 * Cada preparo nasce na sua raia logo no começo (mesma origem do 1º preparo) e se junta ao fluxo no passo que usa
 * o seu resultado ("Espalhar cobertura") ou, se nenhum citar, no 1º passo depois do grupo.
 */
const PREP_WORD = /^(preparo|prepara[cç][aã]o|montagem|confec[cç][aã]o|produ[cç][aã]o|fabrica[cç][aã]o|para)$/i;
const COMPONENT = /^(massa|recheio|cobertura|calda|molho|creme|tempero|marinada|guarni[cç][aã]o|base|farofa|glac[eê])$/i;
function parallelSections(nodes, edges, sgs) {
  const order = [...nodes.keys()];
  const head = (t) => String(t || '').trim().split(/\s+/)[0].toLowerCase();
  const key = (t) => String(t || '').trim().split(/\s+/).filter((w) => w.length > 3).pop()?.toLowerCase() || '';
  const isPar = (a, b) => a.title && b.title && ((PREP_WORD.test(head(a.title)) && head(a.title) === head(b.title))
    || (COMPONENT.test(key(a.title)) && COMPONENT.test(key(b.title)) && key(a.title) !== key(b.title)));
  for (let i = 0; i < sgs.length - 1; i++) {
    let j = i;
    while (j + 1 < sgs.length && isPar(sgs[j], sgs[j + 1]) && sgs[j + 1].ids.length) j++;
    if (j === i) continue;
    const group = sgs.slice(i, j + 1);
    const inGroup = new Set(group.flatMap((g) => g.ids));
    const firstOf = (g) => g.ids.find((id) => nodes.get(id)?.shape !== 'term') || g.ids[0];
    const origins = edges.filter((e) => e.to === firstOf(group[0]) && !inGroup.has(e.from)).map((e) => e.from);
    const exitEdges = edges.filter((e) => inGroup.has(e.from) && !inGroup.has(e.to));
    const next = exitEdges[0]?.to;
    if (!origins.length || !next) { i = j; continue; }
    const lastIdx = Math.max(...group.flatMap((g) => g.ids.map((id) => order.indexOf(id))));
    const later = order.slice(lastIdx + 1).filter((id) => /^P|^E/.test(id));
    group.forEach((g, k) => {
      const gi = new Set(g.ids);
      if (k > 0) {
        // corta a fila "fim do preparo anterior → começo deste" e liga este preparo à mesma origem do 1º
        const prevIds = new Set(group[k - 1].ids);
        for (let x = edges.length - 1; x >= 0; x--) if (prevIds.has(edges[x].from) && edges[x].to === firstOf(g)) edges.splice(x, 1);
        origins.forEach((o) => edges.push({ from: o, to: firstOf(g), label: '', dotted: false }));
      }
      // fim do preparo: vai ao passo que usa o seu resultado, senão ao 1º passo depois do grupo
      const kw = key(g.title);
      const user = later.find((id) => kw && new RegExp('\\b' + kw.slice(0, Math.max(4, kw.length - 1)), 'i').test(nodes.get(id).label));
      const target = user || next;
      const outs = edges.filter((e) => gi.has(e.from) && !gi.has(e.to) && (k === group.length - 1 ? !inGroup.has(e.to) || true : true));
      const lastNode = g.ids.filter((id) => nodes.get(id)?.shape !== 'term').filter((id) => !edges.some((e) => e.from === id && gi.has(e.to))).pop();
      for (const e of outs) edges.splice(edges.indexOf(e), 1);
      if (lastNode && !edges.some((e) => e.from === lastNode && e.to === target)) edges.push({ from: lastNode, to: target, label: '', dotted: false });
    });
    i = j;
  }
}

function serializeLanes({ nodes, edges, sgs, title, direction, def, edgeLine, classLines }) {
  const ids = [...nodes.keys()];
  const actors = [...new Set(ids.map((id) => nodes.get(id).lane).filter(Boolean))];
  const titled = sgs.filter((s) => s.ids.length && s.title);
  const stageNames = [...new Set(titled.map((s) => s.lane || s.title))];
  let laneOf;
  if (actors.length >= 2) laneOf = (id) => nodes.get(id).lane || '';
  else if (stageNames.length >= 2) {
    // sem responsáveis no texto: uma raia por ETAPA (Passo 1, Passo 2…); subseções e dicas ficam na raia da sua etapa
    laneOf = (id) => { const sg = titled.find((s) => s.ids.includes(id)); return sg ? sg.lane || sg.title : ''; };
    // passos antes da primeira etapa com título: raia própria no começo (o fluxo nunca "começa no Passo 2")
    const firstTitled = ids.findIndex((id) => laneOf(id));
    const early = ids.slice(0, Math.max(0, firstTitled)).filter((id) => id !== 'INICIO' && !laneOf(id));
    if (early.length) { const base = laneOf; laneOf = (id) => base(id) || (early.includes(id) ? 'Etapa inicial' : ''); }
  } else if (actors.length === 1) laneOf = () => actors[0];
  else {
    // documento sem responsáveis e sem etapas: divide a sequência em fases equilibradas (3 a 4 colunas),
    // sem separar um losango dos seus ramos — cada fase leva o nome da sua primeira ação
    const steps = ids.filter((id) => !/^(INICIO|FIM|FIMN)$/.test(id) && nodes.get(id).shape !== 'note');
    const n = steps.length >= 6 ? Math.min(4, Math.max(2, Math.ceil(steps.length / 5))) : 1;
    const phase = new Map();
    if (n > 1) {
      const size = Math.ceil(steps.length / n);
      let k = 0, count = 0, names = [];
      steps.forEach((id, i) => {
        const preds = edges.filter((e) => e.to === id && !e.note).map((e) => e.from);
        const safe = preds.length && preds.every((p) => steps.indexOf(p) < i && nodes.get(p).shape !== 'dec')
          && !steps.slice(i + 1).some((o) => edges.some((e) => e.to === o && steps.indexOf(e.from) < i && nodes.get(e.from).shape === 'dec'));
        if (count >= size && k < n - 1 && safe) { k++; count = 0; }
        phase.set(id, k); count++;
      });
      for (let j = 0; j <= k; j++) {
        const first = steps.find((id) => phase.get(id) === j && nodes.get(id).shape !== 'dec') || steps.find((id) => phase.get(id) === j);
        const w = String(nodes.get(first)?.label || '').replace(/<br\/?>.*$/, '').replace(/\?$/, '').split(' ').slice(0, 4);
        while (w.length > 1 && /^(pelo|pela|pelos|pelas|de|do|da|dos|das|no|na|nos|nas|em|com|para|por|a|o|as|os|e|ou|é|um|uma|ao)$/i.test(w[w.length - 1])) w.pop();
        names[j] = `Fase ${j + 1}: ${w.join(' ')}`;
      }
      for (const [id, j] of phase) phase.set(id, names[j]);
    }
    laneOf = (id) => phase.get(id) || (n > 1 ? '' : 'Processo');
  }
  const stageLanes = actors.length < 2;   // raias = fases/etapas (não responsáveis): cada coluna começa no topo
  const L = new Map(ids.map((id) => [id, laneOf(id)]));
  // passos sem responsável: herdam o do vizinho (o seguinte para os iniciais, o anterior para os demais)
  const succ = (id) => edges.filter((e) => e.from === id && !e.note).map((e) => e.to);
  const pred = (id) => edges.filter((e) => e.to === id && !e.note).map((e) => e.from);
  for (let pass = 0; pass < 4; pass++) {
    for (const id of ids) {
      if (L.get(id)) continue;
      // o Fim fica na raia do último passo; os demais herdam do vizinho
      const preds = id === 'FIM' || id === 'FIMN' ? pred(id).sort((a, b) => ids.indexOf(b) - ids.indexOf(a)) : pred(id);
      const near = [...(id === 'INICIO' ? succ(id) : preds), ...(id === 'INICIO' ? [] : succ(id))].map((x) => L.get(x)).find(Boolean);
      if (near) L.set(id, near);
    }
  }
  const first = [...L.values()].find(Boolean) || 'Processo';
  for (const id of ids) if (!L.get(id)) L.set(id, first);
  for (const e of edges) if (e.note) L.set(e.to, L.get(e.from));

  const lanes = [];
  for (const id of ids) { const l = L.get(id); if (!lanes.includes(l)) lanes.push(l); }
  const order = (id) => (id === 'INICIO' ? -1 : id === 'FIM' || id === 'FIMN' ? 1e9 : ids.indexOf(id));
  const sgDir = direction === 'LR' ? 'LR' : 'TB';
  const out = ['%% tipo: raias', ...(stageLanes && lanes.length > 1 ? ['%% raias: etapas'] : []), `flowchart ${direction}`];
  lanes.forEach((ln, i) => {
    out.push(`    subgraph R${i + 1}["${esc(ln).slice(0, 50)}"]`, `        direction ${sgDir}`);
    ids.filter((id) => L.get(id) === ln).sort((a, b) => order(a) - order(b)).forEach((id) => out.push('        ' + def(id)));
    out.push('    end');
  });
  out.push('');
  for (const e of edges) out.push(edgeLine(e));
  out.push('', ...classLines());
  return out.join('\n') + '\n';
}

module.exports = { heuristicMermaid, parseDocument, TYPES };
