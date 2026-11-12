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
const { extractActor, toInfinitive, ROLE } = require('./shorten');

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
  if (/^(você|voce|vc)\b/i.test(t)) return true;
  const w = (t.split(/\s+/)[0] || '').replace(/[^\wÀ-ú-]/g, '');
  if (!w || /(ar|er|ir|ôr|or)$/i.test(w)) return false;   // infinitivo não é ordem ao leitor
  return !!toInfinitive(w, { strict: true });
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
const NOT_VERB = /^(que|não|nao|também|tambem|já|ja|então|entao|sempre|nunca|logo|depois|ainda|só|so|apenas|imediatamente|novamente)$/i;
/**
 * Sujeito humano da frase: "O cliente apresenta…", "A equipe de vendas envia…", "o gestor aprovar" (depois de "se").
 * Mais tolerante que extractActor: aceita qualquer verbo conjugado (não só os da lista), pulando "de X" no nome.
 */
function roleSubject(t, afterIf = false) {
  const tok = t.split(/\s+/).map((w) => w.replace(/[^\wÀ-ú-]/g, ''));
  const i = ARTICLE.test(tok[0] || '') ? 1 : 0;
  if (!ROLE.test(tok[i] || '')) return '';
  let j = i + 1;
  while (j < tok.length && j <= i + 5) {
    const w = tok[j];
    if (PREP.test(w)) { j += 2; continue; }                       // "equipe DE VENDAS", "suporte DO TI"
    if (NOT_VERB.test(w)) { j++; continue; }
    const conj = /^[a-zà-ú]+(a|e|am|em|ou|eu|iu|ará|erá|irá|arão|erão|irão)$/.test(w) || VERBISH.test(w);
    const subj = afterIf && /^[a-zà-ú]+(ar|er|ir|em|ar)$/.test(w);   // "se o gestor aprovar/recusar"
    if (conj || subj) {
      const name = tok.slice(i, j).filter((x) => !NOT_VERB.test(x)).join(' ');
      return name.split(/\s+/).map((x, k) => (k === 0 || !PREP.test(x) ? cap(x) : x.toLowerCase())).join(' ').replace(/\b(Ti|Rh|Qa)\b/g, (m) => m.toUpperCase());
    }
    if (/^[a-zà-ú]+$/.test(w) && j === i + 1 && /(ico|ica|al|ar|eiro|eira|ivo|iva|or)$/.test(w)) { j++; continue; }   // "suporte técnico", "analista fiscal"
    break;
  }
  return '';
}

/**
 * Lê o documento inteiro uma vez: quais responsáveis humanos aparecem e como o sistema é chamado.
 * @param {string[]} sentences frases/itens do documento, na ordem
 */
function functionalContext(sentences) {
  const roles = new Set();
  const sys = new Map();
  for (const raw of sentences) {
    const t = clean(raw);
    const a = extractActor(t) || roleSubject(t) || roleSubject(t.replace(/^(se|caso|quando)\s+/i, ''), true);
    if (a && !/^sistema\b/i.test(a)) roles.add(a);
    const p = passiveAgent(t);
    if (p?.kind === 'role') roles.add(p.name);
    const s = (p?.kind === 'system' && p.noun) || systemSubject(t);
    if (s && SYSTEM_NOUN.test(s)) sys.set(s, (sys.get(s) || 0) + 1);
  }
  // nome da raia do sistema: o equipamento/aplicativo mais citado como sujeito ("Console", "Aplicativo"), senão "Sistema"
  const top = [...sys.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { roles, hasRoles: roles.size > 0, systemName: top ? (/^(app)$/i.test(top) ? 'Aplicativo' : cap(top)) : 'Sistema' };
}

/**
 * Responsável de UMA frase. Retorna o nome da raia ou '' (herda o responsável atual).
 * @param {string} raw
 * @param {{hasRoles:boolean, systemName:string}} ctx
 */
function actorOf(raw, ctx) {
  const t = clean(raw);
  if (!t) return '';
  // decisão/condição: quem decide é o sujeito da condição ("Se o GESTOR aprovar…"); se a condição fala de uma coisa
  // ("Se o produto estiver no prazo, o ATENDENTE registra…"), é quem age na consequência
  const cond = /^(se|caso|quando|assim que|após|apos)\s+/i.test(t);
  if (cond) {
    const body = t.replace(/^(se|caso|quando|assim que|após|apos)\s+/i, '');
    const c1 = roleSubject(body, true);
    if (c1) return c1;
    const then = body.split(/,\s*/).slice(1).join(', ');
    const c2 = then && (extractActor(then) || roleSubject(then));
    if (c2) return c2;
    return '';
  }
  const explicit = extractActor(t) || roleSubject(t);
  if (explicit) return /^sistema\b/i.test(explicit) && ctx.systemName !== 'Sistema' ? ctx.systemName : explicit;
  const p = passiveAgent(t);
  if (p) return p.kind === 'role' ? p.name : ctx.systemName;
  if (systemSubject(t) || (/\bautomaticamente\b/i.test(t) && !isImperative(t))) return ctx.systemName;
  if (isImperative(t)) return ctx.hasRoles ? '' : READER;
  return '';
}

module.exports = { functionalContext, actorOf, roleSubject, UNKNOWN, READER };
