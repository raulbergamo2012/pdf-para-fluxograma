'use strict';
/**
 * Fluxograma Funcional: QUEM executa cada atividade.
 *
 * As raias representam responsáveis reais (pessoas, cargos, setores, sistemas), nunca etapas ou capítulos do PDF.
 * Este módulo identifica o executor de cada frase do documento, sem inventar participantes:
 *
 *  1. explícito ........ "O gestor analisa…", "Responsável: Financeiro", "Suporte: verifica…"  (extractActor)
 *  2. voz passiva ...... "…é aprovado pelo gestor", "…é enviado pelo sistema"                  → o agente da passiva
 *  3. sistema .......... "O aplicativo envia um código", "A instalação inicia automaticamente" → raia do sistema
 *  4. leitor ........... "Acesse…", "Toque…", "Você deve…" (instrução no imperativo) → raia genérica "Responsável não
 *                        especificado" (o texto não diz quem é o leitor) — só quando o
 *                        documento não cita nenhum responsável humano (aí o imperativo segue quem está agindo)
 *  5. sem sujeito ...... "O pedido é analisado." → herda o responsável atual; se o documento inteiro não indica
 *                        ninguém, a raia é "Responsável não especificado" (e a Análise avisa o usuário)
 */
const { extractActor, toInfinitive, leadVerb, ROLE } = require('./shorten');

const UNKNOWN = 'Responsável não especificado';
// instruções no imperativo dizem O QUE fazer, mas não QUEM é (usuário? equipe? cliente?) — não inventamos: raia genérica,
// que o usuário pode renomear/distribuir na aba Análise
const READER = UNKNOWN;
const SYSTEM_NOUN = /^(sistema|aplicativo|app|site|plataforma|portal|computador|pc|notebook|console|impressora|servidor|roteador|modem|programa|software|instalador|celular|smartphone|tv|televisão|televisao|dispositivo|aparelho|máquina|maquina|equipamento|erp|crm|robô|robo|bot|jogo|loja|windows|navegador)$/i;
const AUTO_PROC = /^(instalação|instalacao|download|atualização|atualizacao|sincronização|sincronizacao|reinicialização|reinicializacao|cópia|copia|processamento|carregamento|transferência|transferencia|formatação|formatacao|verificação|verificacao|tela|janela|mensagem|notificação|notificacao|e-?mail|código|codigo|link|página|pagina|confirmação|confirmacao)$/i;
const ARTICLE = /^(o|a|os|as|um|uma|seu|sua|este|esta|esse|essa)$/i;
const VERBISH = /^(é|são|está|estão|será|serão|foi|foram|vai|vão|irá|irão|pode|podem|deve|devem|começa|começará|inicia|iniciará|aparece|aparecerá|abre|abrirá|envia|enviará|mostra|mostrará|exibe|exibirá|baixa|baixará|reinicia|reiniciará|conclui|concluirá|termina|terminará|solicita|solicitará|pede|pedirá|detecta|detectará|faz|fará|gera|gerará|valida|validará|calcula|calculará|registra|registrará|atualiza|atualizará|recebe|receberá|cria|criará|carrega|carregará|processa|processará|confirma|confirmará|bloqueia|libera|notifica|notificará|dispara|retorna|exibe|fica|ficará|surge|surgirá|chega|chegará|desliga|liga|liga-se|conecta|conectará|instala|instalará|copia|copiará|formata|formatará)$/i;

const clean = (raw) => String(raw || '')
  .replace(/^[\s\d.\-–•*)]+(?=\S)/, '')
  .replace(/^(passo|etapa|fase)\s*\d+\s*[:.–-]\s*/i, '')
  .replace(/^(depois|em seguida|então|entao|após isso|apos isso|por fim|primeiro|finalmente|logo após|logo apos|quando terminar),?\s+/i, '')
  .trim();

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
// nome de raia: 1ª letra maiúscula, o resto como no texto, siglas em maiúsculas ("Equipe de vendas", "Suporte de TI")
const nameCase = (name) => String(name).split(/\s+/).map((x, k) => (k === 0 ? cap(x) : x.toLowerCase())).join(' ')
  .replace(/\b(ti|rh|qa|sac|cpd|ceo|cfo|erp|crm)\b/gi, (x) => x.toUpperCase());

/** "O aplicativo envia…" → "aplicativo"; "A instalação iniciará automaticamente" → "instalação" (processo automático). */
function systemSubject(t) {
  const tok = t.split(/\s+/);
  const i = ARTICLE.test(tok[0] || '') ? 1 : 0;
  const noun = (tok[i] || '').replace(/[^\wÀ-ú-]/g, '');
  if (!SYSTEM_NOUN.test(noun) && !AUTO_PROC.test(noun)) return '';
  // o substantivo precisa ser o SUJEITO: um verbo conjugado logo depois (até 4 palavras)
  for (let j = i + 1; j <= Math.min(tok.length - 1, i + 6); j++) {
    const w = tok[j].replace(/[^\wÀ-ú-]/g, '');
    if (VERBISH.test(w) || /(rá|rão|ará|erá|irá)$/i.test(w)) return noun.toLowerCase();
  }
  return '';
}

function isImperative(t) {
  if (/^(você|voce|vc)(?=\s|$)/i.test(t)) return true;
  const w = (t.split(/\s+/)[0] || '').replace(/[^\wÀ-ú-]/g, '');
  if (!w || /(ar|er|ir|ôr|or)$/i.test(w)) return false;   // infinitivo não é ordem ao leitor
  if (toInfinitive(w, { strict: true })) return true;
  // "tente ligar novamente", "encerre o chamado": imperativo em -e/-a seguido de infinitivo ou artigo
  return /[ea]$/i.test(w) && !/^(sobre|desde|conforme|sempre|onde|como|quase|toda|cada|uma|essa|esta|nome|data|base|fase|parte|tela|senha|conta|pasta|empresa|etapa|forma|regra|nota)$/i.test(w)
    && /^\S+\s+(o|a|os|as|um|uma|\S+(?:ar|er|ir))(\s|$)/i.test(t.trim()) && !!toInfinitive(w.toLowerCase());
}

/** Agente da voz passiva: "…é aprovado pelo gestor" → "Gestor". */
function passiveAgent(t) {
  const m = /\b(?:é|são|será|serão|foi|foram|seja|sejam|deve ser|devem ser|precisa ser|precisam ser)\s+[\wÀ-ú]+(?:ad|id|it|ost|eit)[oa]s?\s+pel[oa]s?\s+([\wÀ-ú-]+(?:\s+(?:de|do|da)?\s*[\wÀ-ú-]+)?)/i.exec(t);
  if (!m) return null;
  const first = m[1].split(/\s+/)[0];
  if (ROLE.test(first)) return { kind: 'role', name: cap(m[1].split(/\s+/).slice(0, /^(de|do|da)$/i.test(m[1].split(/\s+/)[1] || '') ? 3 : 1).join(' ')) };
  if (SYSTEM_NOUN.test(first)) return { kind: 'system', noun: first.toLowerCase() };
  return null;
}

const PREP = /^(de|do|da|dos|das|e)$/i;
// cargo no singular ou no plural ("os moradores", "as enfermeiras", "os analistas")
const isRole = (w) => {
  // singular/plural e feminino ("os moradores", "as enfermeiras", "a administradora")
  const forms = [w, w.replace(/es$/i, ''), w.replace(/s$/i, '')];
  return forms.some((f) => ROLE.test(f) || ROLE.test(f.replace(/a$/i, 'o')) || ROLE.test(f.replace(/a$/i, '')));
};
const NOT_VERB = /^(que|não|nao|também|tambem|já|ja|então|entao|sempre|nunca|logo|depois|ainda|só|so|apenas|imediatamente|novamente)$/i;
/**
 * Sujeito humano da frase: "O cliente apresenta…", "A equipe de vendas envia…", "o gestor aprovar" (depois de "se").
 * Mais tolerante que extractActor: aceita qualquer verbo conjugado (não só os da lista), pulando "de X" no nome.
 */
function roleSubject(t, afterIf = false, agents = null) {
  const tok = t.split(/\s+/).map((w) => w.replace(/\(a\)|\(as\)|\(os\)/gi, '').replace(/[^\wÀ-ú-]/g, ''));
  const i = ARTICLE.test(tok[0] || '') ? 1 : 0;
  if (!isRole(tok[i] || '') && !(agents && agents.has((tok[i] || '').toLowerCase()))) return '';
  let j = i + 1;
  while (j < tok.length && j <= i + 5) {
    const w = tok[j];
    if (PREP.test(w)) { j += 2; continue; }                       // "equipe DE VENDAS", "suporte DO TI"
    if (NOT_VERB.test(w)) { j++; continue; }
    const conj = /^[a-zà-ú]+(a|e|am|em|ou|eu|iu|ará|erá|irá|arão|erão|irão|az|iz|uz|õe|õem|ê|êm|á|ão|êem)$/.test(w) || VERBISH.test(w);
    const subj = afterIf && /^[a-zà-ú]+(ar|er|ir|em|ar)$/.test(w);   // "se o gestor aprovar/recusar"
    if (conj || subj) {
      const name = tok.slice(i, j).filter((x) => !NOT_VERB.test(x)).join(' ');
      return nameCase(name);
    }
    if (/^[a-zà-ú]+$/.test(w) && j === i + 1 && /(ico|ica|al|ar|eiro|eira|ivo|iva|or)$/.test(w)) { j++; continue; }   // "suporte técnico", "analista fiscal"
    break;
  }
  return '';
}

// AGENTES que não estão na lista de cargos: substantivo de pessoa/área ("o síndico", "a nutricionista", "o comitê")
// que aparece como SUJEITO de um verbo de ação em 2+ frases. Objetos e equipamentos ficam de fora.
const AGENT_SUFFIX = /(dor|dora|tor|tora|sor|sora|ista|nte|eiro|eira|ário|ária|ico|ica|ogo|oga|eta|ês|esa|ão|ã|ino|ina|ê|é)$/i;
const NOT_AGENT = /^(processo|procedimento|documento|formulário|formulario|pedido|produto|material|item|arquivo|resultado|valor|prazo|sistema|cliente|equipamento|ação|acao|solicitação|solicitacao|aprovação|aprovacao|informação|informacao|conta|senha|tela|botão|botao|página|pagina|mensagem|cartão|cartao|pagamento|contrato|relatório|relatorio|projeto|evento|serviço|servico|objetivo|etapa|passo|fase|parte|dica|nota|regra|norma|lei|questão|questao|opção|opcao|versão|versao|função|funcao|razão|razao|condição|condicao)$/i;
const STATE_VERB = /^(é|são|está|estão|foi|foram|será|serão|fica|ficam|ficará|parece|deve|devem|pode|podem|precisa|precisam|tem|têm|há)$/i;
function agentCandidate(t) {
  const tok = t.split(/\s+/).map((w) => w.replace(/\(a\)|\(as\)|\(os\)/gi, '').replace(/[^\wÀ-ú-]/g, ''));
  if (!ARTICLE.test(tok[0] || '')) return '';
  const noun = (tok[1] || '').toLowerCase();
  if (!noun || NOT_AGENT.test(noun) || SYSTEM_NOUN.test(noun) || AUTO_PROC.test(noun) || /(ção|são|ões|mento|agem|dade)$/i.test(noun)) return '';
  if (!AGENT_SUFFIX.test(noun) && !/^[A-ZÀ-Ú]/.test(tok[1] || '')) return '';
  let j = 2;
  while (j < tok.length && j <= 5 && (PREP.test(tok[j]) || (j > 2 && PREP.test(tok[j - 1])))) j++;
  const v = tok[j] || '';
  if (!v || STATE_VERB.test(v) || !/^[a-zà-ú]+(a|e|am|em|ou|eu|iu|ará|erá|irá|arão|erão|irão)$/.test(v)) return '';
  return noun;
}

/** "Cabe ao gestor aprovar", "Compete ao RH…", "Fica a cargo do financeiro…", "O analista é responsável por…" */
const DUTY_RE = /\b(?:cabe|compete|incumbe)\s+(?:ao|à|aos|às)\s+([\wÀ-ú-]+(?:\s+(?:de|do|da)\s+[\wÀ-ú-]+)?)|\bfica\s+a\s+cargo\s+d[oa]s?\s+([\wÀ-ú-]+(?:\s+(?:de|do|da)\s+[\wÀ-ú-]+)?)|(?:^|\s)(?:é|será)\s+(?:de\s+)?responsabilidade\s+d[oa]s?\s+([\wÀ-ú-]+(?:\s+(?:de|do|da)\s+[\wÀ-ú-]+)?)|^(?:o|a)\s+([\wÀ-ú-]+(?:\s+(?:de|do|da)\s+[\wÀ-ú-]+)?)\s+(?:é|será)\s+respons[aá]vel\s+por/i;
function dutyActor(t, agents) {
  const m = DUTY_RE.exec(t);
  if (!m) return '';
  let name = (m[1] || m[2] || m[3] || m[4] || '').trim();
  // "cabe ao conselho fiscal aprovar…": o adjetivo faz parte do nome; o infinitivo seguinte não
  const after = t.slice(m.index + m[0].length).trim().split(/\s+/)[0] || '';
  if (!/\s/.test(name) && after && !/(ar|er|ir|or)$/i.test(after) && /^[a-zà-ú]+$/.test(after) && !/^(por|para|pela|pelo|que|a|o|e)$/i.test(after)) name += ' ' + after;
  name = name.split(/\s+/).filter((w, k, a) => !(k === a.length - 1 && /(ar|er|ir)$/i.test(w) && k > 0)).join(' ');
  const first = name.split(/\s+/)[0];
  if (!isRole(first) && !(agents && agents.has(first.toLowerCase()))) return '';
  return nameCase(name);
}

/**
 * Título de seção que é um RESPONSÁVEL ("Responsabilidades do gestor", "Atividades do cliente", "Equipe de TI"):
 * as atividades da seção sem sujeito ficam com ele. Títulos de etapa/assunto ("Instalação", "Etapa 2") não contam.
 */
function sectionActor(title, agents) {
  const t = String(title || '').replace(/[:.]+$/, '').trim();
  if (!t || /^(passo|etapa|fase|parte)\b/i.test(t)) return '';
  let m = /^(?:responsabilidades?|atribui[cç][oõ]es|atividades|tarefas|papel|fun[cç][aã]o|a[cç][oõ]es)\s+(?:do|da|dos|das)\s+(.{2,40})$/i.exec(t);
  const name = m ? m[1] : (t.split(/\s+/).length <= 3 ? t : '');
  if (!name) return '';
  const first = name.split(/\s+/)[0].replace(/[^\wÀ-ú-]/g, '');
  if (!ROLE.test(first) && !(agents && agents.has(first.toLowerCase()))) return '';
  if (!m && !/^(equipe|time|setor|departamento|área|area)\b/i.test(name) && name.split(/\s+/).length > 1 && !/^(de|do|da)$/i.test(name.split(/\s+/)[1])) return '';
  return nameCase(name);
}

/**
 * Lê o documento inteiro uma vez: quais responsáveis humanos aparecem e como o sistema é chamado.
 * @param {string[]} sentences frases/itens do documento, na ordem
 */
function functionalContext(sentences) {
  const roles = new Set();
  const sys = new Map();
  // 1º passe: agentes que não estão na lista (sujeito de verbo de ação em 2+ frases)
  const cand = new Map();
  for (const raw of sentences) { const c = agentCandidate(clean(raw)); if (c) cand.set(c, (cand.get(c) || 0) + 1); }
  const agents = new Set([...cand].filter(([, n]) => n >= 2).map(([w]) => w));
  for (const raw of sentences) {
    const t = clean(raw);
    const d = dutyActor(t, agents);
    if (d) roles.add(d);
    const a = extractActor(t) || roleSubject(t, false, agents) || roleSubject(t.replace(/^(se|caso|quando)\s+/i, ''), true, agents);
    if (a && !/^sistema\b/i.test(a)) roles.add(a);
    const p = passiveAgent(t);
    if (p?.kind === 'role') roles.add(p.name);
    const s = (p?.kind === 'system' && p.noun) || systemSubject(t);
    if (s && SYSTEM_NOUN.test(s)) sys.set(s, (sys.get(s) || 0) + 1);
  }
  // nome da raia do sistema: o equipamento/aplicativo mais citado como sujeito ("Console", "Aplicativo"), senão "Sistema"
  const top = [...sys.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { roles, agents, hasRoles: roles.size > 0, systemName: top ? (/^(app)$/i.test(top) ? 'Aplicativo' : cap(top)) : 'Sistema',
    sectionActor: (title) => sectionActor(title, agents) };
}

/**
 * Responsável de UMA frase. Retorna o nome da raia ou '' (herda o responsável atual).
 * @param {string} raw
 * @param {{hasRoles:boolean, systemName:string}} ctx
 */
function actorOf(raw, ctx) {
  const t = clean(raw);
  if (!t) return '';
  const ag = ctx.agents;
  const duty = dutyActor(t, ag);
  if (duty) return duty;
  // decisão/condição: quem decide é o sujeito da condição ("Se o GESTOR aprovar…"); se a condição fala de uma coisa
  // ("Se o produto estiver no prazo, o ATENDENTE registra…"), é quem age na consequência
  const cond = /^(se|caso|quando|assim que|após|apos)\s+/i.test(t);
  if (cond) {
    const body = t.replace(/^(se|caso|quando|assim que|após|apos)\s+/i, '');
    // "Se o cliente NÃO ESTIVER em casa…": a condição descreve um ESTADO de alguém — quem decide é quem está agindo
    const stateCond = /^(?:(?:o|a|os|as)\s+)?[\wÀ-ú-]+(?:\s+[\wÀ-ú-]+)?\s+(?:n[aã]o\s+)?(estiver|estiverem|for|forem|tiver|tiverem|houver|está|estão|é|são|tem|têm|estar|ser|ter)\b/i.test(body);
    const c1 = stateCond ? '' : roleSubject(body, true, ag);
    if (c1) return c1;
    const then = body.split(/,\s*/).slice(1).join(', ');
    const c2 = then && (extractActor(then) || roleSubject(then, false, ag));
    if (c2) return c2;
    return '';
  }
  const explicit = extractActor(t) || roleSubject(t, false, ag);
  if (explicit) return /^sistema\b/i.test(explicit) && ctx.systemName !== 'Sistema' ? ctx.systemName : explicit;
  const p = passiveAgent(t);
  if (p) return p.kind === 'role' ? p.name : ctx.systemName;
  if (systemSubject(t) || (/\bautomaticamente\b/i.test(t) && !isImperative(t))) return ctx.systemName;
  if (isImperative(t)) return ctx.hasRoles ? '' : READER;
  return '';
}

/**
 * Classificação de cada informação do documento (o Funcional só transforma em caixa o que é atividade ou decisão):
 *   obrigatória · opcional · condicional · decisão · entrada/saída · recomendação · observação · pré-requisito ·
 *   resultado · explicativa
 */
const CAT_RECOMMEND = /^(n[aã]o\s+\S+|nunca\s|jamais\s|é\s+(?:recomend|aconselh|importante|ideal|bom|prudente|indicado)|recomenda-se|recomendamos|aconselha-se|sugere-se|sugerimos|o ideal é|prefira|evite|evitar|dica|vale a pena|não esqueça|lembre-se|tenha cuidado|cuidado)/i;
const CAT_NOTE = /^(obs\.?|observa[cç][aã]o|nota|aten[cç][aã]o|aviso|alerta|importante|curiosidade)\b/i;
const CAT_PREREQ = /^(antes de (?:come[cç]ar|iniciar)|pr[eé]-requisitos?|requisitos?|voc[eê] (?:vai|ir[aá]) precisar|tenha em m[aã]os|é necess[aá]rio ter|ser[aá] necess[aá]rio ter|certifique-se de (?:ter|possuir))/i;
const CAT_RESULT = /^(pronto|feito|conclu[ií]do)\b|\b(?:ser[aá]|estar[aá]|ficar[aá]|foi|est[aá])\s+(?:conclu[ií]d|finalizad|pront|dispon[ií]vel|ativad|criad|instalad|aprovad|liberad)[oa]s?\s*[.!]?$|\bresultado esperado\b|\bo processo (?:termina|est[aá] conclu[ií]do)/i;
const CAT_EXPLAIN = /\b(costuma|costumam|geralmente|normalmente|em m[eé]dia|cerca de|pode levar|podem levar|pode demorar|demora|leva em torno|serve para|significa|permite que|consiste em)|(?:^|\s)(?:é|são)\s+(?:um|uma|uns|umas)\s/i;
const CAT_OPTIONAL = /^(opcionalmente|se (?:preferir|desejar|quiser|achar necess)|caso (?:prefira|deseje|queira)|(?:se|caso|quando) (?:necess[aá]rio|preciso|houver necessidade|for o caso|aplic[aá]vel))|^(?:(?:o|a|os|as)\s+[\wÀ-ú-]+\s+|voc[eê]\s+)?(?:tamb[eé]m\s+)?(?:pode|podem|poder[aá])\s+[\wÀ-ú]+(?:ar|er|ir)\b|^é poss[ií]vel\s/i;
const CAT_COND = /^(se|caso|quando|assim que|ap[oó]s|apos|enquanto)\s/i;
const CAT_IO = /^(informe|informar|digite|digitar|preencha|preencher|insira|inserir|registre|registrar|anote|anotar|imprima|imprimir|envie|enviar|anexe|anexar|cadastre|cadastrar|receba|receber|emita|emitir)\b/i;
function classifySentence(raw, ctx = {}) {
  const t = clean(raw).replace(/^[⚠!*•\-–]\s*/, '');
  if (!t) return 'explicativa';
  // "Na aba Segurança, ative…", "Depois do login, selecione…": a introdução de lugar/tempo não esconde a ação
  const core = t.replace(/^(?:na|no|nas|nos|em|pela|pelo|pelas|pelos|dentro d[aoe]s?|a partir d[aoe]s?|depois d[aeo]s?|antes d[aeo]s?|ap[oó]s|durante|com|nessa|nesta|nesse|neste)\s[^,]{1,60},\s*/i, '');
  if (core !== t && core.length > 4 && (leadVerb(core) || isImperative(core))) return classifySentence(core, ctx);
  if (dutyActor(t, ctx.agents)) return 'obrigatória';
  if (CAT_NOTE.test(t)) return 'observação';
  if (CAT_RECOMMEND.test(t)) return 'recomendação';
  if (CAT_PREREQ.test(t)) return 'pré-requisito';
  if (CAT_OPTIONAL.test(t)) {
    // "O download pode levar horas" é explicação, não uma escolha de alguém
    if (CAT_EXPLAIN.test(t) && !/^(voc[eê]|o\s+usu|a\s+usu)/i.test(t) && !(ctx.actorOf && ctx.actorOf(t) && ctx.actorOf(t) !== ctx.systemName)) return 'explicativa';
    return 'opcional';
  }
  if (CAT_COND.test(t)) return /\?\s*$/.test(t) || /,\s*(?:sen[aã]o|caso contr[aá]rio)/i.test(t) || /\b(sen[aã]o|caso contr[aá]rio)\b/i.test(t) ? 'decisão' : 'condicional';
  if (/\?\s*$/.test(t)) return 'decisão';
  if (CAT_RESULT.test(t)) return 'resultado';
  if (CAT_EXPLAIN.test(t) && !isImperative(t)) return 'explicativa';
  const first = (t.split(/\s+/)[0] || '');
  // sem verbo de ação reconhecível e sem sujeito: frase só explicativa (passos numerados do documento nunca caem aqui)
  if (!/^\s*\d+[.)]/.test(String(raw)) && !leadVerb(t) && !isImperative(t) && !extractActor(t) && !roleSubject(t, false, ctx.agents) && !systemSubject(t) && !/^(o|a|os|as)\s/i.test(t) && !toInfinitive(first.toLowerCase(), { strict: true })) return 'explicativa';
  if (CAT_IO.test(t) || CAT_IO.test(t.replace(/^(?:o|a|os|as)\s+[\wÀ-ú-]+(?:\s+(?:de|do|da)\s+[\wÀ-ú-]+)?\s+/i, '').replace(/^(\w+?)(a|e)\b/, '$1$2'))) return 'entrada/saída';
  return 'obrigatória';
}
/** informações que NÃO viram caixa do fluxo (no máximo uma nota junto da atividade relacionada) */
const NOT_A_STEP = new Set(['recomendação', 'observação', 'explicativa', 'resultado']);

module.exports = { functionalContext, actorOf, roleSubject, sectionActor, dutyActor, classifySentence, NOT_A_STEP, UNKNOWN, READER, isImperative };
