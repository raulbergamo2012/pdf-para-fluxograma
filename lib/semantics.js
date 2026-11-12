'use strict';
/**
 * Semântica das condições e dos resultados (camada de interpretação, independente da IA).
 *
 * Cada condição vira uma expressão normalizada { subject, predicate, negated, state }:
 *   "a internet não funciona"     → { subject: 'internet', predicate: 'funcion', negated: true,  state: 'falha' }
 *   "o pagamento for aprovado"    → { subject: 'pagamento', predicate: 'aprov',  negated: false, state: 'sucesso' }
 *   "o problema persistir"        → { subject: 'problema', predicate: 'persist', negated: false, state: 'falha' }
 *   "o cliente for pessoa física" → { …, state: 'neutro' } (alternativa, não é sucesso nem falha)
 *
 * O estado diz o que a resposta "Sim" significa. Numa pergunta negativa ("Internet não funciona?") o "Sim" é
 * FALHA (existe um problema) e o "Não" é SUCESSO — a ligação dos caminhos usa esse significado, não as palavras.
 */

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();

// predicados de estado POSITIVO (o objetivo foi alcançado / está tudo certo)
const SUCCESS = /\b(aprov|aceit|autoriz|liber|confirm|conclu|resolv|solucion|funcion|respond|lig(a|ar|ou|ue|ado|ada)\b|conect|disponiv|valid|corret|sucesso|ok\b|normal|encontr|deu certo|regulariz|em dia|complet|suficient|aces[ao]|estavel|carregad|carregou|instalad|instalou|sincronizad|sincronizou|abr(e|iu|ir)\b|inici(a|ou|ar)\b|volt\w* a (funcion|respond|lig|conect|carreg|abr|inici|normal)|volt(ar|ou|e|a)\b|reconhecid|reconheceu|chegou|recebid|pag[oa]\b|quitad|atendid|atendeu)/;
// predicados de estado NEGATIVO (há um problema / o resultado não foi alcançado)
const FAILURE = /\b(recus|reprov|neg(ad|ou|a)\b|rejeit|indefer|invalid|incorret|err(o|ad|ou)|falh|trav|congel|persist|problema|defeit|indisponiv|bloque|expir|insuficient|pendent|quebr|irregular|incomplet|venc|sem sinal|offline|fora do ar|demor|lent|desconect|desligad|apagad|vazi[oa]|cheio|cheia|ausent|divergent|inconsistent|atras|danific|corromp|perdid|nao conseg|impossiv|cancel|interromp|abort|suspens|estorn|devolvid)/;
// sujeito que É um problema: "o problema foi resolvido" (sucesso) × "o problema persiste" (falha)
const PROBLEM_NOUN = /\b(problema|falha|erro|defeito|travamento|instabilidade|lentidao|incidente|pane|interrupcao|ocorrencia)s?\b/;
const RESOLVED = /\b(resolv|solucion|corrigid|sumi|desaparec|normaliz|cess|acab|termin|eliminad)/;
const PERSISTS = /\b(persist|continu|permanec|ainda|volt\w* a ocorrer|repet|ocorr\w* novamente|reaparec|reincid)/;
// negação: "não", "nunca", "sem", "deixou de", "nenhum"
const NEG = /\b(nao|nunca|sem|nenhum|nenhuma|jamais)\b|\bdeix(ou|ar|a) de\b/g;
const ARTICLE = /^(o|a|os|as|um|uma|seu|sua|seus|suas)\s+/;
const COPULA = /\b(for|forem|foi|foram|esta|estiver|estiverem|estao|estava|esteja|estejam|seja|sejam|e|sao|fica|ficar|ficou|tiver|tem|houver|ha)\b/g;

/** "a internet não funciona" → { subject, predicate, negated, state } */
function condition(raw) {
  let t = norm(raw).replace(/^(se|caso|quando|em caso de)\s+/, '').replace(/\?$/, '');
  t = t.replace(/^(verificar|verifique|confira|conferir|confirme|confirmar|checar|cheque|validar|valide)\s+(se|que)\s+/, '');
  // gerúndio de condição: "persistindo a falha" = "a falha persistir"
  t = t.replace(/^(persistindo|continuando|permanecendo)\s+(.+)$/, '$2 persistir');
  const negs = (t.match(NEG) || []).length;
  const body = t.replace(NEG, ' ').replace(/\s+/g, ' ').trim();
  const subject = body.replace(ARTICLE, '').split(' ')[0] || '';
  let state = 'neutro';
  let fixed = false;   // "ainda não X" já é a forma final (não inverte de novo pela negação)
  if (PROBLEM_NOUN.test(body) && RESOLVED.test(body)) state = 'sucesso';
  else if (PROBLEM_NOUN.test(body) && PERSISTS.test(body)) state = 'falha';
  else if (/\bainda\b/.test(t) && negs) { state = 'falha'; fixed = true; }      // "ainda não ligar"
  else {
    const s = SUCCESS.exec(body), f = FAILURE.exec(body);
    // o predicado mais à esquerda decide ("o pagamento for aprovado sem erro": aprovado)
    if (s && (!f || s.index <= f.index)) state = 'sucesso';
    else if (f) state = 'falha';
  }
  if (!fixed && state !== 'neutro' && negs % 2 === 1) state = state === 'sucesso' ? 'falha' : 'sucesso';
  const pm = (SUCCESS.exec(body) || FAILURE.exec(body));
  return { text: String(raw || '').trim(), subject, predicate: pm ? pm[1].slice(0, 6) : '', negated: negs % 2 === 1, state };
}

/** estado do "Sim" de uma pergunta/condição */
const stateOf = (q) => condition(q).state;
const opposite = (s) => (s === 'sucesso' ? 'falha' : s === 'falha' ? 'sucesso' : 'neutro');

const STOP = new Set('para com sem pelo pela como mais menos cada todo toda outro outra antes depois quando onde voce seu sua este esta esse essa isso sobre entre apos desde uma umas uns dos das nos nas este estao seja sera tiver houver estiver forem fora caso sempre ainda apenas agora nao'.split(' '));
const stems = (s) => norm(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, Math.max(4, Math.min(w.length - 2, 6))));

/**
 * Duas condições falam do mesmo assunto? Compartilham uma palavra de conteúdo, ou uma delas é só o predicado
 * ("aprovado" depois de "o gestor decide se aprova a despesa"), ou uma fala do problema que a outra verifica
 * ("a conexão voltar" × "o problema persistir").
 */
function sameTopic(q1, q2) {
  const a = stems(String(q1).replace(COPULA, ' ')), b = stems(String(q2).replace(COPULA, ' '));
  if (!a.length || !b.length) return true;
  if (a.some((w) => b.includes(w))) return true;
  if (a.length <= 1 || b.length <= 1) return true;
  return PROBLEM_NOUN.test(norm(q1)) !== PROBLEM_NOUN.test(norm(q2));
}

/** q2 é a negação de q1 (estados opostos sobre o mesmo assunto)? */
function contradicts(q1, q2) {
  const s1 = stateOf(q1), s2 = stateOf(q2);
  return s1 !== 'neutro' && s2 !== 'neutro' && s1 !== s2 && sameTopic(q1, q2);
}
/** q2 repete q1 (mesmo estado, mesmo assunto)? "decide se aprova o cadastro" × "Se aprovado" */
function equivalent(q1, q2) {
  const s1 = stateOf(q1), s2 = stateOf(q2);
  if (s1 === 'neutro' || s1 !== s2 || !sameTopic(q1, q2)) return false;
  const p1 = condition(q1).predicate, p2 = condition(q2).predicate;
  const a = stems(q1), b = stems(q2), [sm, lg] = a.length <= b.length ? [a, b] : [b, a];
  return !p1 || !p2 || p1.slice(0, 4) === p2.slice(0, 4) || stems(q2).length <= 1 || sm.every((w) => lg.includes(w));
}

// ------------------------------------------------------------------ ações e resultados
// ação corretiva / de recuperação (tenta resolver uma falha)
const CORRECTIVE = /^(corrig|corrij|refaz|refa[cç]|reinici|reinstal|reenvi|reconect|religu|relig|redefin|reconfigur|restaur|recuper|troc|substitu|ajust|limp|atualiz|repar|consert|resolv|solicit\w* (outr|nov|corre)|pe[cç]\w* (outr|nov)|contat|entr\w* em contato|acion|abr\w* (um |o )?chamado|encaminh\w* (para|à|ao) (assist|suport|manuten)|escal|notific|devolv|tent\w* (novamente|de novo|outra)|repet|repit|verifi\w* (o |a )?(cabo|conex|configur))/;
// a ação conclui o atendimento com sucesso
const DONE = /^(encerr|finaliz|conclu|registr\w* (a |o )?(ocorr|soluc|conclus|atendim))|\b(e|,)\s*(encerr|finaliz|conclu)\w*\s*$/;
// frase de RESULTADO/ESTADO (não é ação): "a conexão está normal", "o problema foi resolvido", "o atendimento é encerrado"
const RESULT = /^(?:(?:o|a|os|as)\s+)?[\w-]+(?:\s+(?:d[oae]s?|de)\s+[\w-]+)?\s+(?:(?:ja|nao)\s+)?(?:e|esta|estao|sao|foi|foram|fica|ficou|ficam|estara|sera|volt\w*|continua|permanece)\b/;
const ENDING = /\b(encerrad|finalizad|conclui|concluid|resolvid|solucionad|terminad|fim\b|cancelad|arquivad)/;

/** classifica um ramo de decisão: { kind: 'resultado'|'acao', state, ends } */
function branchOutcome(text) {
  const t = norm(text).replace(/^(entao|logo|portanto)\s+/, '');
  const rm = RESULT.exec(t);
  // só é RESULTADO quando o que vem depois do verbo de ligação é um estado ("está normal", "foi resolvido", "fica
  // pendente"); "o pedido é enviado ao cliente" é uma ação na voz passiva
  const after = rm ? t.slice(rm[0].length).trim().split(' ').slice(0, 3).join(' ') : '';
  if (rm && (SUCCESS.test(after) || FAILURE.test(after) || ENDING.test(after) || /^(normal|ok|certo|pront)/.test(after))) {
    const st = /\b(nao|sem)\b/.test(t) && !ENDING.test(t) ? 'falha' : stateOfResult(t);
    return { kind: 'resultado', state: st, ends: ENDING.test(t) };
  }
  return { kind: 'acao', state: CORRECTIVE.test(t) ? 'falha' : DONE.test(t) ? 'sucesso' : 'neutro', ends: DONE.test(t) };
}
function stateOfResult(t) {
  if (PROBLEM_NOUN.test(t) && RESOLVED.test(t)) return 'sucesso';
  if (/\b(encerrad|finalizad|concluid|normal|funcionando|ok)\b/.test(t)) return 'sucesso';
  return stateOf(t);
}

/**
 * Duas atividades seguidas são a MESMA ação? ("Clicar em Salvar" + "Salvar alterações"; "Anexar arquivo" duas vezes)
 * Não basta ter palavras parecidas: "Preencher formulário" e "Revisar formulário" são ações diferentes.
 * Devolve o rótulo que fica (o mais descritivo) ou null.
 */
function redundant(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return null;
  if (A === B) return a;
  const click = /^(clicar|tocar|pressionar|apertar|selecionar) (em |no |na |o |a )?(?:botao |opcao )?(\S+)$/;
  const ca = click.exec(A), cb = click.exec(B);
  const verbOf = (x) => x.split(' ')[0];
  if (ca && verbOf(B).slice(0, 5) === ca[3].slice(0, 5)) return b;   // "Clicar em Salvar" + "Salvar alterações"
  if (cb && verbOf(A).slice(0, 5) === cb[3].slice(0, 5)) return a;
  const sa = stems(A), sb = stems(B);
  if (verbOf(A) === verbOf(B) && sa.length >= 2 && sa.length === sb.length && sa.every((w) => sb.includes(w))) return a.length >= b.length ? a : b;
  return null;
}

const isCorrective = (label) => CORRECTIVE.test(norm(label));
const isDone = (label) => DONE.test(norm(label));

module.exports = { redundant, condition, stateOf, opposite, sameTopic, contradicts, equivalent, branchOutcome, isCorrective, isDone, norm, PROBLEM_NOUN };
