'use strict';
/**
 * Revisão textual dos blocos ANTES de desenhar (vale para o modo Regras e para o código vindo da IA).
 *
 * Procura: palavras quebradas pela extração do PDF ("duas eta pas"), cortes ("Conectar cabo de"), frases que não
 * descrevem uma ação ("Estar normal", "Persistir falha"), reticências de texto cortado.
 * Corrige sozinho só quando há prova no próprio documento (a palavra inteira aparece em outro lugar do texto);
 * senão o bloco fica marcado "texto a revisar" (borda tracejada + aviso com o trecho original) — nunca fica
 * uma caixa sem sentido sem aviso.
 */
const { norm } = require('./semantics');
const { leadVerb, toInfinitive } = require('./shorten');

// palavras curtas comuns (não são pedaços de palavra)
const SHORT_OK = new Set(('a o e é as os um uns uma de do da dos das em no na nos nas ao aos à às se ou que por com sem até já só não sim ' +
  'seu sua seus suas meu minha eu ele ela nós eles elas lhe me te isso isto este esta esse essa aqui ali lá bem mal mais menos muito ' +
  'sob sobre pelo pela pelos pelas cada todo toda tudo após via vez dia mês ano hora data nome tipo modo uso ver ter ser ir dar pôr ' +
  'ler vir fim meio site app web url pdf cpf rg cnpj ok id ip wifi usb hd ssd tv pc mac rede tela aba menu link caixa campo item lista ' +
  'nota taxa conta área zona chave mesa sala loja casa obra peça base fase etapa passo mapa foto vídeo áudio texto tecla cabo luz cor ' +
  'gás água óleo papel tinta porta fila ação caso sala novo nova bom boa alto alta baixo baixa duas dois três quatro cinco seis sete oito ' +
  'nove dez cem mil seg min kg km cm mm ml gb mb kb tb hz ºc rh ti ceo erp crm api sms pix qr nf nfe').split(' '));
const STATE_LEAD = /^(estar|ser|ficar|persistir|haver|existir|parecer|permanecer|continuar|tornar)\b/i;

/** palavras do documento (para provar uma junção) */
function docWords(text) {
  const w = new Map();
  for (const x of norm(String(text).replace(/-\s*\n\s*/g, '')).split(' ')) if (x.length >= 3) w.set(x, (w.get(x) || 0) + 1);
  return w;
}

/**
 * Revisa um rótulo. Devolve { label, fixed: [..], issues: [..] }.
 *   fixed  → correções aplicadas (com prova no documento)
 *   issues → motivos para revisão manual
 */
function reviewLabel(label, kind, words) {
  let main = String(label || '');
  const brk = main.indexOf('<br/>');
  const tail = brk >= 0 ? main.slice(brk) : '';
  if (brk >= 0) main = main.slice(0, brk);
  const fixed = [], issues = [];
  let tk = main.split(/\s+/).filter(Boolean);
  // 1. palavra quebrada: junta só se a palavra inteira aparece no documento
  for (let i = 0; i < tk.length - 1; i++) {
    const a = tk[i], b = tk[i + 1];
    if (!/^[a-zà-ú]+-?$/.test(a) || !/^[a-zà-ú]+[.,;:?]?$/.test(b)) continue;
    const joined = norm(a.replace(/-$/, '') + b.replace(/[.,;:?]$/, ''));
    const known = (x) => SHORT_OK.has(x) || (words.get(norm(x)) || 0) >= 2;
    if (joined.length >= 5 && words.has(joined) && (!known(a) || !known(b.replace(/[.,;:?]$/, '')) || /-$/.test(a))) {
      fixed.push(`"${a} ${b}" → "${a.replace(/-$/, '')}${b}"`);
      tk.splice(i, 2, a.replace(/-$/, '') + b);
      i--;
    }
  }
  // 2. pedaços de palavra sem prova para juntar ("duas eta pas")
  const frag = (x) => /^[a-zà-ú]{2,4}$/.test(x) && !SHORT_OK.has(x) && !SHORT_OK.has(norm(x)) && (words.get(norm(x)) || 0) < 2 && !toInfinitive(x, { strict: true });
  for (let i = 0; i < tk.length - 1; i++) {
    if (frag(tk[i]) && frag(tk[i + 1].replace(/[.,;:?]$/, ''))) { issues.push(`possível palavra quebrada na extração do PDF ("${tk[i]} ${tk[i + 1]}")`); break; }
  }
  if (tk.some((x) => /^[a-zà-ú]{2,}-$/.test(x))) issues.push('palavra cortada no fim da linha');
  // 3. texto cortado
  if (/(…|\.\.\.)\s*$/.test(main)) issues.push('texto cortado');
  if (/\s(de|do|da|dos|das|e|ou|com|para|em|no|na|ao|à|o|a)\s*$/i.test(main)) issues.push('frase incompleta');
  // 4. atividade que não descreve uma ação
  if (kind === 'process' || kind === 'io') {
    const first = (tk[0] || '').toLowerCase();
    if (STATE_LEAD.test(first)) issues.push('o texto descreve um estado, não uma ação');
    else if (tk.length === 1 && /^(decidir|seguir|verificar|fazer|realizar|executar|proceder)$/i.test(first)) issues.push('ação sem objeto');
    // "Instalação inicia automaticamente" (evento do sistema: sujeito + verbo) é válido
    else if (tk.length >= 2 && !/(ar|er|ir|ôr|or)$/i.test(first) && !leadVerb(tk.join(' ')) && !/^(não|informar|clicar)$/i.test(first)
      && ![tk[1], tk[2]].some((x) => { const w = String(x || '').toLowerCase(); return toInfinitive(w, { strict: true }) || (/^[a-zà-ú]{3,}(a|e|am|em)$/.test(w) && toInfinitive(w)); })) issues.push('não começa com um verbo de ação');
  }
  return { label: tk.join(' ') + tail, fixed, issues };
}

/** revisa todos os blocos do modelo; marca os suspeitos com a classe "revisar" */
function reviewModel(model, text, issues, sources = {}) {
  const words = docWords(text || '');
  const kindOf = (n) => (n.type === 'decision' ? 'decision' : n.type === 'io' || n.open === '[/' ? 'io' : n.type === 'process' || n.open === '[' ? 'process' : n.type);
  let flagged = 0;
  for (const n of model.nodes.values()) {
    if (!n.label || ['start', 'end', 'note', 'doubt'].includes(n.type) || n.classes?.has('nota')) continue;
    const r = reviewLabel(n.label, kindOf(n), words);
    if (r.fixed.length) {
      n.label = r.label;
      issues.push({ level: 'interpretação', message: `Texto corrigido com base no documento: ${r.fixed.join('; ')}.` });
    }
    if (r.issues.length) {
      flagged++;
      (n.classes ||= new Set()).add('revisar');
      const src = sources[n.id] ? ` Trecho do documento: "${String(sources[n.id]).slice(0, 140)}".` : '';
      issues.push({ level: 'aviso', message: `Texto a revisar: "${n.label.replace(/<br\/>.*/, '')}" — ${r.issues.join('; ')}.${src}` });
    }
  }
  if (flagged && !model.extra.some((l) => /^classDef\s+revisar\b/.test(l))) model.extra.push('classDef revisar fill:#FFFFFF,stroke:#D97706,stroke-width:2px,stroke-dasharray:6 3,color:#7C2D12');
  return flagged;
}

module.exports = { reviewLabel, reviewModel, docWords };
