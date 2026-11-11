'use strict';
const { collapseInlineAlternatives } = require('./coherence');

/**
 * Encurta frases de documentação para rótulos de fluxograma
 * no padrão "Verbo no infinitivo + objeto", com no máximo 5 palavras.
 *
 *   "O colaborador anexa os comprovantes fiscais em PDF."  → "Anexar comprovantes fiscais em PDF"
 *   "Encaixe as pernas no tampo da mesa."                 → "Encaixar pernas no tampo"
 *   "O colaborador é notificado da reprovação."           → "Notificar colaborador da reprovação"
 */

const MAX_WORDS = 7;   // texto suficiente para entender a atividade sem abrir o PDF (sem virar parágrafo)

const ARTICLES = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas']);
const OBJECT_START = new Set([...ARTICLES, 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'à', 'às', 'em', 'se', 'todos', 'todas', 'todo', 'toda', 'cada', 'com', 'para', 'seu', 'sua', 'seus', 'suas', 'este', 'esta', 'esse', 'essa', 'que', 'por', 'pelo', 'pela', 'pelos', 'pelas']);
const TRAILING_STOP = new Set(['antes', 'depois', 'logo', 'ainda', 'nem', 'mas', 'porém', 'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'mais', 'muito', 'qualquer', 'também', 'quando', 'onde', 'pois', 'porque', 'de', 'do', 'da', 'dos', 'das', 'e', 'ou', 'em', 'no', 'na', 'nos', 'nas', 'para', 'pra', 'com', 'a', 'o', 'as', 'os', 'ao', 'à', 'que', 'se', 'por', 'pelo', 'pela', 'um', 'uma', 'sem', 'até', 'entre', 'sobre', 'como']);
const MODALS = new Set(['deve', 'devem', 'deverá', 'deverão', 'precisa', 'precisam', 'pode', 'podem', 'poderá', 'vai', 'vão', 'irá', 'irão', 'consegue', 'tenta', 'costuma']);
const PASSIVE_AUX = new Set(['é', 'são', 'será', 'serão', 'foi', 'foram', 'está', 'estão', 'fica', 'ficam']);

// formas que não seguem as regras gerais → infinitivo
const IRREGULAR = { comece: 'começar', comecem: 'começar', recomece: 'recomeçar', redefina: 'redefinir', transfira: 'transferir', substitua: 'substituir', atribua: 'atribuir', contribua: 'contribuir', prossiga: 'prosseguir', consiga: 'conseguir', descubra: 'descobrir', persiga: 'perseguir', construa: 'construir', possua: 'possuir', refira: 'referir', sugira: 'sugerir', repita: 'repetir', compita: 'competir', divida: 'dividir', decida: 'decidir', imprima: 'imprimir', assuma: 'assumir', resuma: 'resumir', consuma: 'consumir', permita: 'permitir', admita: 'admitir', omita: 'omitir', emita: 'emitir', transmita: 'transmitir', submeta: 'submeter', ferva: 'ferver', mexa: 'mexer', bata: 'bater', sirva: 'servir', leia: 'ler', ponha: 'pôr', traga: 'trazer', diga: 'dizer', siga: 'seguir', acenda: 'acender', cubra: 'cobrir', escreva: 'escrever', descreva: 'descrever', receba: 'receber', defina: 'definir', imprima: 'imprimir', reinicie: 'reiniciar', aplique: 'aplicar', obtenha: 'obter', mantenha: 'manter', contenha: 'conter', retenha: 'reter', detenha: 'deter', proponha: 'propor', componha: 'compor', exponha: 'expor', disponha: 'dispor', suba: 'subir', desça: 'descer', cresça: 'crescer', esqueça: 'esquecer', evite: 'evitar', garanta: 'garantir', proteja: 'proteger', prefira: 'preferir', lembre: 'lembrar', sugira: 'sugerir', certifique: 'certificar', anote: 'anotar', guarde: 'guardar', memorize: 'memorizar',
  // presente (3ª pessoa) de verbos -er/-ir
  confere: 'conferir', exibe: 'exibir', emite: 'emitir', insere: 'inserir', define: 'definir', permite: 'permitir',
  decide: 'decidir', divide: 'dividir', segue: 'seguir', serve: 'servir', repete: 'repetir', pede: 'pedir', mede: 'medir',
  sobe: 'subir', une: 'unir', abre: 'abrir', cobre: 'cobrir', descobre: 'descobrir', transmite: 'transmitir', admite: 'admitir',
  imprime: 'imprimir', assume: 'assumir', consome: 'consumir', resume: 'resumir', preenche: 'preencher', recebe: 'receber',
  escolhe: 'escolher', mexe: 'mexer', desce: 'descer', bate: 'bater', corre: 'correr', depende: 'depender', entende: 'entender',
  estende: 'estender', move: 'mover', remove: 'remover', promove: 'promover', prende: 'prender', responde: 'responder',
  resolve: 'resolver', vende: 'vender', devolve: 'devolver', envolve: 'envolver', desenvolve: 'desenvolver', acontece: 'acontecer',
  escreve: 'escrever', descreve: 'descrever', inscreve: 'inscrever', atende: 'atender', aprende: 'aprender', compreende: 'compreender',
  faz: 'fazer', traz: 'trazer', diz: 'dizer', põe: 'pôr', tem: 'ter', vê: 'ver', lê: 'ler', vai: 'ir', vem: 'vir', sai: 'sair',
  mantém: 'manter', obtém: 'obter', contém: 'conter', detém: 'deter', requer: 'requerer', reduz: 'reduzir', produz: 'produzir',
  conduz: 'conduzir', introduz: 'introduzir', constrói: 'construir', dá: 'dar', está: 'estar',
  fazem: 'fazer', trazem: 'trazer', dizem: 'dizer', põem: 'pôr', têm: 'ter', veem: 'ver', leem: 'ler', vão: 'ir', vêm: 'vir',
  saem: 'sair', destrói: 'destruir', destroem: 'destruir', constroem: 'construir', consegue: 'conseguir', conseguem: 'conseguir',
  prossegue: 'prosseguir', persegue: 'perseguir', sente: 'sentir', dorme: 'dormir', sugere: 'sugerir', prefere: 'preferir',
  transfere: 'transferir', refere: 'referir', mantêm: 'manter', obtêm: 'obter', contêm: 'conter', cabe: 'caber', sabe: 'saber',
  pode: 'poder', podem: 'poder', quer: 'querer', querem: 'querer', ouve: 'ouvir', perde: 'perder', vale: 'valer',
  inclui: 'incluir', conclui: 'concluir', exclui: 'excluir', distribui: 'distribuir', substitui: 'substituir', possui: 'possuir',
  // imperativo de verbos -er/-ir (guias passo a passo)
  abra: 'abrir', insira: 'inserir', faça: 'fazer', escolha: 'escolher', preencha: 'preencher', confira: 'conferir', siga: 'seguir',
  leia: 'ler', veja: 'ver', ponha: 'pôr', mantenha: 'manter', obtenha: 'obter', desça: 'descer', mova: 'mover', remova: 'remover',
  prenda: 'prender', resolva: 'resolver', devolva: 'devolver', suba: 'subir', una: 'unir', inclua: 'incluir', conclua: 'concluir',
  distribua: 'distribuir', construa: 'construir', emita: 'emitir', exiba: 'exibir', permita: 'permitir', defina: 'definir',
  divida: 'dividir', decida: 'decidir', sirva: 'servir', repita: 'repetir', peça: 'pedir', meça: 'medir', ouça: 'ouvir',
  traga: 'trazer', diga: 'dizer', receba: 'receber', escreva: 'escrever', descreva: 'descrever', responda: 'responder',
  imprima: 'imprimir', cubra: 'cobrir', aperte: 'apertar', bata: 'bater', atenda: 'atender', estenda: 'estender',
  vá: 'ir', vai: 'ir', dê: 'dar', esteja: 'estar', seja: 'ser', tenha: 'ter', saia: 'sair', venha: 'vir', faça: 'fazer',
  busque: 'buscar', toque: 'tocar', acompanhe: 'acompanhar', conclua: 'concluir', exclua: 'excluir', instale: 'instalar',
  // imperativos comuns em manuais e guias
  selecione: 'selecionar', clique: 'clicar', pressione: 'pressionar', digite: 'digitar', informe: 'informar', aguarde: 'aguardar',
  conecte: 'conectar', ligue: 'ligar', desligue: 'desligar', reinicie: 'reiniciar', baixe: 'baixar', inicie: 'iniciar',
  confirme: 'confirmar', salve: 'salvar', acesse: 'acessar', envie: 'enviar', anexe: 'anexar', verifique: 'verificar',
  encaixe: 'encaixar', fixe: 'fixar', posicione: 'posicionar', retire: 'retirar', separe: 'separar', coloque: 'colocar',
  marque: 'marcar', navegue: 'navegar', arraste: 'arrastar', copie: 'copiar', cole: 'colar', registre: 'registrar',
  cadastre: 'cadastrar', solicite: 'solicitar', aprove: 'aprovar', analise: 'analisar', revise: 'revisar', atualize: 'atualizar',
  ative: 'ativar', desative: 'desativar', habilite: 'habilitar', configure: 'configurar', crie: 'criar', adicione: 'adicionar',
  altere: 'alterar', edite: 'editar', feche: 'fechar', entre: 'entrar', valide: 'validar', cheque: 'checar', teste: 'testar',
  descarte: 'descartar', vire: 'virar', instale: 'instalar', monte: 'montar', limpe: 'limpar', guarde: 'guardar', utilize: 'utilizar', use: 'usar',
  // particípios irregulares
  feito: 'fazer', posto: 'pôr', visto: 'ver', aberto: 'abrir', escrito: 'escrever', coberto: 'cobrir', dito: 'dizer',
};
const IR_PARTICIPLE_BASES = new Set(['exib', 'emit', 'insir', 'inser', 'defin', 'permit', 'decid', 'divid', 'segu', 'serv', 'repet', 'ped', 'med', 'sub', 'un', 'abr', 'transmit', 'admit', 'imprim', 'assum', 'consum', 'resum', 'conclu', 'inclu', 'distribu', 'constru', 'possu', 'atribu', 'substitu', 'contribu', 'conferi', 'confer', 'reduz', 'produz', 'conduz', 'introduz', 'ouv', 'part', 'cumpr', 'exig', 'dirig', 'corrig', 'divulg', 'restitu']);

const strip = (w) => w.toLowerCase().replace(/[.,;:!?…"'()]+$/g, '').replace(/^["'(]+/, '');

/** Converte uma forma verbal comum para o infinitivo. Retorna null se não parecer verbo. */
function toInfinitive(word, { strict = false } = {}) {
  const w = strip(word);
  if (!w || w.length < 2) return null;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/(ar|er|ir|or)$/.test(w) && w.length > 3) return w;               // já está no infinitivo
  if (/(ará|erá|irá|arão|erão|irão)$/.test(w)) return w.replace(/(á|ão)$/, '').replace(/r$/, 'r');   // iniciará → iniciar
  if (/ui$/.test(w)) return w + 'r';                                    // inclui → incluir
  if (/[aei]ndo$/.test(w)) return w.replace(/ndo$/, 'r');               // enviando → enviar
  if (/ece$/.test(w)) return w + 'r';                                   // aparece → aparecer
  if (/eça$/.test(w)) return w.replace(/eça$/, 'ecer');                 // aqueça → aquecer, ofereça → oferecer
  if (/que$/.test(w)) return w.replace(/que$/, 'car');                  // verifique → verificar
  if (/gue$/.test(w)) return w.replace(/gue$/, 'gar');                  // entregue → entregar
  if (/[^e]ce$/.test(w)) return w.replace(/ce$/, 'çar');                // comece → começar
  if (/ige$/.test(w)) return w.replace(/e$/, 'ir');                     // corrige → corrigir, exige → exigir
  if (/uz$/.test(w) && w.length > 4) return w + 'ir';                   // reproduz → reproduzir, conduz → conduzir
  if (strict) return null;
  if (/[^aeoã]a$/.test(w)) return w + 'r';                              // acessa → acessar, envia → enviar
  if (/[^aeiou]e$/.test(w)) return w.replace(/e$/, 'ar');               // encaixe → encaixar
  return null;
}

function participleToInfinitive(word) {
  const w = strip(word);
  if (IRREGULAR[w]) return IRREGULAR[w];
  let m;
  if ((m = /^(.+)ad[oa]s?$/.exec(w))) return m[1] + 'ar';
  if ((m = /^(.+)íd[oa]s?$/.exec(w))) return m[1] + 'ir';               // concluído → concluir
  if ((m = /^(.+)id[oa]s?$/.exec(w))) return m[1] + (IR_PARTICIPLE_BASES.has(m[1]) ? 'ir' : 'er');
  return null;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function cleanText(text) {
  return String(text)
    .replace(/^[\s\d.\-–•*)]+(?=\S)/, '')       // numeração "1." "2)" "-"
    // "Separe as ferramentas: chave Allen, chave Phillips…" → a ação vem ANTES dos dois-pontos (a lista é detalhe)
    .replace(/^((?:Separe|Separar|Pegue|Pegar|Tenha|Ter|Prepare|Preparar|Re[uú]na|Reunir|Verifique|Verificar|Confira|Conferir|Instale|Instalar|Baixe|Baixar)\b[^:]{0,40}):\s+.*$/i, '$1')
    // campo de formulário como rótulo ("Nome de Usuário: escolha um apelido") → "Informar nome de usuário"
    .replace(/^((?:nome(?: de usu[aá]rio| completo)?|senha|e-?mail|data de nascimento|telefone|celular|cpf|apelido|usu[aá]rio|login|endere[cç]o|cep))\s*:\s+.*$/i, (all, f) => 'Informe ' + f.toLowerCase())
    .replace(/^[A-ZÀ-Ú][\wÀ-ú/ -]{1,28}:\s+(?=[a-zà-ú])/, '') // rótulo do item: "Processador: alinhe…" → "alinhe…"
    // rótulo + ação com maiúscula: "Gênero: Selecione o estilo do avatar" → "Selecione o estilo do avatar"
    .replace(/^[A-ZÀ-Ú][\wÀ-ú/ -]{1,28}:\s+(?=([A-ZÀ-Ú][\wÀ-ú]+)\s)/, (m, w) => (toInfinitive(w, { strict: true }) ? '' : m))
    .replace(/\s*\(?\b(respons[aá]vel|executor|quem faz)\s*:\s*[^)\.;\n]{2,40}\)?/gi, '') // "(Responsável: Gerente)"
    // pronome colado ao verbo: "fixá-lo" → "fixar", "Fixe-a com…" → "Fixe com…" (o objeto já está no contexto)
    .replace(/([A-Za-zÀ-ú]+)([áêí])-(l[oa]s?)\b/g, (m, b, v) => b + { á: 'ar', ê: 'er', í: 'ir' }[v])
    .replace(/([A-Za-zÀ-ú]{3,})-(as|os|a|o|n[ao]s?|se|me|te|lhes?)(?=[\s,.;:!?)]|$)/g, '$1')
    .replace(/\s+(dele|dela|deles|delas)\b/gi, '')  // "cabos de energia dela" → "cabos de energia"
    .replace(/\([^)]*\)/g, ' ')                // conteúdo entre parênteses
    .replace(/\bde cabeça para baixo\b/gi, 'invertido')
    .replace(/\bcom a ajuda de\b/gi, 'com')
    .replace(/\bentre em contato com\b/gi, 'contate')
    .replace(/\bentrar em contato com\b/gi, 'contatar')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/["“”«»<>#;|{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:!…]+$/, '');
}

const PREP = /^(de|do|da|dos|das|com|para|pra|em|no|na|nos|nas|via|pelo|pela|pelos|pelas|ao|à|aos|às|por|sobre|até|entre)$/i;
const GENERIC_NOUN = /^(m[eé]todo|forma|meio|modo|ajuda|uso|tipo|op[cç][aã]o|maneira|aux[ií]lio)$/i;

/** Encurta para `max` palavras tirando primeiro o que menos informa */
function limitWords(words, max) {
  let out = words.slice();
  if (out.length > max) {
    // modo e quantidade que não mudam a ação ("pressione repetidamente", "pendrive de no mínimo 8 GB")
    out = out.filter((w, i) => i === 0 || !/^(repetidamente|rapidamente|cuidadosamente|delicadamente|lentamente|devagar|calmamente|novamente|imediatamente|simplesmente|corretamente|totalmente|completamente)$/i.test(w));
    const q = out.findIndex((w, i) => i > 0 && /^(no|pelo)$/i.test(w) && /^(m[ií]nimo|menos|m[aá]ximo)$/i.test(out[i + 1] || ''));
    if (q > 0 && out.length > max) out.splice(q - (/^(de|com)$/i.test(out[q - 1]) ? 1 : 0), (/^(de|com)$/i.test(out[q - 1]) ? 1 : 0) + 2 + (/^\d/.test(out[q + 2] || '') ? 2 : 0));
  }
  if (out.length > max) {
    // adjetivos-particípio e possessivos no meio da frase ("etiqueta voltada", "seu método")
    out = out.filter((w, i) => i === 0 || !/^(seu|sua|seus|suas|meu|minha|nosso|nossa|mais|bem|ainda|apenas|somente|mesmo)$/i.test(w));
    if (out.length > max) out = out.filter((w, i) => i === 0 || !(i >= 2 && /(ad|id)[oa]s?$/i.test(w) && !PREP.test(out[i - 1])
      && !/^(dados|lados|cuidados|resultados|estados|chamados|recados|mercados|pedidos|partidos|sentidos|ruídos|ruidos|conteúdos|vestidos|apelidos|idos)$/i.test(w)));
  }
  const cut = out.length > max;
  out = out.slice(0, max);
  while (out.length > 1 && TRAILING_STOP.has(out.at(-1).toLowerCase())) out.pop();
  // cortou num substantivo que tinha complemento ("…pinos e cabo" | de 8 pinos; "…com marcação" | do soquete):
  // completa o complemento (até 3 palavras) — senão o texto fica ambíguo ou parece cortado
  if (cut && out.length >= 3) {
    const last = out.at(-1).toLowerCase();
    let j = -1;
    for (let k = out.length - 1; k < words.length; k++) if (String(words[k]).toLowerCase() === last) { j = k; break; }
    const rest = j >= 0 ? words.slice(j + 1) : [];
    // substantivo de interface sem o complemento não diz qual é ("tocar no ícone" | de lupa)
    const vague = /^(ícone|icone|botão|botao|bot[oõ]es|opção|opcao|op[cç][oõ]es|menu|aba|tecla|link|campo|seção|secao|guia|tela|cabo|porta|slot)$/i.test(last);
    const joined = vague || /^(e|com|ou)$/i.test(out.at(-2)) || out.slice(0, -1).some((w) => w.toLowerCase() === last);
    if (joined && rest.length && /^(de|do|da|dos|das)$/i.test(rest[0])) {
      const add = [];
      for (const w of rest.slice(0, 3)) { add.push(w); if (!/^(de|do|da|dos|das|\d+[\w,.]*)$/i.test(w)) break; }
      if (!/^(de|do|da|dos|das|\d+[\w,.]*)$/i.test(add.at(-1))) out = [...out, ...add];
    }
  }
  // cortou dentro de uma oração com "que" ("Escolher nome de usuário que não esteja" | em uso) → tira a oração inteira
  if (cut) { const q = out.findIndex((w, i) => i >= 2 && /^que$/i.test(w)); if (q > 0) out = out.slice(0, q); }
  // "Concluir compra com método" (complemento cortado) → "Concluir compra"
  if (out.length < words.length && out.length >= 3 && GENERIC_NOUN.test(out.at(-1)) && PREP.test(out.at(-2))) out = out.slice(0, -2);
  // cortou no meio de um complemento ("…senha com outras" | pessoas) → tira o pedaço pendurado
  else if (out.length < words.length && out.length >= 4 && PREP.test(out.at(-2))
    && /^(outr[oa]s?|tod[oa]s?|cada|algu[mn]s?|alguma?s?|qualquer|demais|mesm[oa]s?|nov[oa]s?|primeir[oa]s?|segund[oa]s?|pequen[oa]s?|grandes?|diferentes?|v[aá]ri[oa]s)$/i.test(out.at(-1))) out = out.slice(0, -2);
  return out;
}

/** Advérbios de sequência e opcionais no começo: "Em seguida, clique…" → "clique…" */
const LEAD_FILLER = /^(opcionalmente|em seguida|depois(?: disso)?|ent[aã]o|agora|por fim|finalmente|ap[oó]s isso|primeiro|primeiramente|antes|logo|feito isso|na sequ[eê]ncia|caso queira|se quiser|se desejar)\s*,?\s+/i;

/** Escolhe a oração que tem a ação: "No canto superior direito, clique em Criar" → "clique em Criar" */
function actionClause(text) {
  let t = String(text).replace(LEAD_FILLER, '');
  const parts = t.split(/\s*,\s+/);
  if (parts.length > 1 && !hasVerbStart(parts[0])) {
    const i = parts.findIndex((p, k) => k > 0 && hasVerbStart(p));
    if (i > 0) t = parts.slice(i).join(', ');
  }
  return t;
}
function hasVerbStart(p) {
  const w = p.replace(/^(voc[eê]s?\s+(pode|podem|deve|devem|precisa)|basta)\s+/i, '').split(/\s+/).filter(Boolean);
  if (!w.length) return false;
  if (ARTICLES.has(w[0].toLowerCase())) return w.slice(2, 7).some((x) => isVerbToken(x));
  return !!toInfinitive(w[0], { strict: true }) || (w.length >= 2 && OBJECT_START.has(w[1].toLowerCase()) && !!toInfinitive(w[0]));
}

/** Remove a primeira oração quando a frase tem várias ("X, Y" / "X e depois Y") */
function firstClause(text) {
  // "acessa o portal e preenche o formulário" → primeira ação
  const compound = splitCompound(text);
  if (compound.length > 1) text = compound[0];
  // corta explicações: "usando ...", "aplicando ...", "conforme ...", "para que ..."
  const t2 = text.split(/(?<!\b(?:estiver|estiverem|est[aá]|est[aã]o|esteja|estejam|ficar|ficarem|continuar|continuarem|estar))\s+(?=(?:[\wÀ-ú]+ndo|conforme|segundo|através|de acordo|para que|a fim de)\b)/i)[0];
  if (t2.split(/\s+/).length >= 2) text = t2;
  const parts = text.split(/\s*(?:[,;:]\s+|\s+-\s+|\s+e (?:depois|então|em seguida)\s+)/);
  // enumeração de objetos ("Conecte o monitor, o teclado e o cabo") fica inteira: os itens são parte da mesma ação
  const enumeration = parts.length > 1 && /,/.test(text) && !/[;:]/.test(text) && / e /.test(parts.at(-1))
    && parts.slice(1).every((p) => { const f = strip(p.split(/\s+/)[0] || ''); return ARTICLES.has(f.toLowerCase()) || !(toInfinitive(f, { strict: true }) || isVerbToken(f)); });
  if (enumeration) {
    // compacta: verbo + o núcleo de cada item ("Conecte o monitor, o teclado e o cabo de energia" → "Conecte monitor, teclado e cabo")
    const items = text.split(/\s*,\s*|\s+e\s+/).map((x) => x.trim()).filter(Boolean);
    const [verb, ...firstRest] = items[0].split(/\s+/);
    const head = (x) => {
      const w = x.split(/\s+/).filter((t) => !ARTICLES.has(t.toLowerCase()) && !/^(seu|sua|seus|suas|um|uma|uns|umas)$/i.test(t));
      if (w[1] && /^\p{Lu}/u.test(w[1])) return w.slice(0, 2).join(' ');
      // complemento curto que identifica o item ("cabo de energia", "botão de ligar")
      if (w[1] && /^(de|do|da)$/i.test(w[1]) && w[2] && w.length <= 3) return w.slice(0, 3).join(' ');
      return w[0] || '';
    };
    let heads = [head(firstRest.join(' ')), ...items.slice(1).map(head)].filter(Boolean).slice(0, 3);
    if (heads.join(' ').split(/\s+/).length + 1 > MAX_WORDS) heads = heads.map((h) => h.split(/\s+/)[0]);
    if (heads.length >= 2) return `${verb} ${heads.slice(0, -1).join(', ')} e ${heads.at(-1)}`;
    return text;
  }
  return parts[0].split(/\s+/).length >= 2 ? parts[0] : text;
}

/** Rótulo de ação: "Verbo no infinitivo + objeto" (≤ 5 palavras) */
const COMMON_PRESENT = new Set(['acessa', 'seleciona', 'envia', 'recebe', 'analisa', 'aprova', 'registra', 'cadastra', 'preenche', 'clica',
  'confirma', 'notifica', 'calcula', 'atualiza', 'emite', 'valida', 'verifica', 'confere', 'agenda', 'anexa', 'exibe', 'encaminha', 'segue',
  'retorna', 'finaliza', 'inicia', 'começa', 'termina', 'abre', 'cria', 'executa', 'gera', 'solicita', 'consulta', 'mostra', 'aparece',
  'baixa', 'instala', 'carrega', 'processa', 'conclui', 'aguarda', 'informa', 'devolve', 'armazena', 'salva', 'publica', 'avalia', 'monta']);
const PERSON = /^(usu[aá]rio|cliente|colaborador|funcion[aá]rio|gestor|gerente|analista|operador|montador|t[eé]cnico|respons[aá]vel|solicitante|atendente|equipe|time|setor|financeiro|rh|jur[ií]dico|comprador|vendedor|aprovador|administrador|admin|voc[eê]|pessoa|aluno|professor|motorista|supervisor|diretor|coordenador)/i;

function isVerbToken(w) {
  const k = strip(w);
  return MODALS.has(k) || PASSIVE_AUX.has(k) || COMMON_PRESENT.has(k) || /(ará|erá|irá|arão|erão|irão)$/.test(k)
    || !!IRREGULAR[k] || !!toInfinitive(k, { strict: true }) && !/(ção|ões|mento|dade)$/.test(k);
}
const present3 = (inf) => IRREGULAR_PRESENT[inf] || inf.replace(/ar$/, 'a').replace(/[ei]r$/, 'e');
const IRREGULAR_PRESENT = { sair: 'sai', cair: 'cai', trair: 'trai', atrair: 'atrai', distrair: 'distrai', ler: 'lê', dar: 'dá', dizer: 'diz', trazer: 'traz', poder: 'pode', querer: 'quer', saber: 'sabe', ir: 'vai', ser: 'é', estar: 'está', ter: 'tem', fazer: 'faz', vir: 'vem', ficar: 'fica', pôr: 'põe', ver: 'vê' };

/** Rótulo de ação: "Verbo no infinitivo + objeto" (≤ 5 palavras) */
function shortenAction(text, max = MAX_WORDS) {
  text = collapseInlineAlternatives(text);   // "Play Store (Android) ou App Store (iOS)" → "a loja de aplicativos"
  // negativa: "Nunca compartilhe sua senha" → "Não compartilhar senha"
  const neg = /^\s*(nunca|jamais|n[aã]o)\s+(\S+)\s+(.*)$/i.exec(cleanText(text));
  const negVerb = neg && !/^(é|e|est[aá]|est[aã]o|h[aá]|era|foi|s[aã]o|ser|ter|tem|t[eê]m|seja|for)$/i.test(neg[2]) && toInfinitive(neg[2]);
  if (negVerb) {
    const rest = shortenAction(negVerb + ' ' + neg[3], max - 1);
    return rest ? 'Não ' + rest.charAt(0).toLowerCase() + rest.slice(1) : '';
  }
  let t = firstClause(actionClause(cleanText(text)))
    // "Você pode / É possível / Basta ..." → a ação que vem depois
    .replace(/^(eles|elas|ele|ela|n[oó]s)\s+(?=\p{L}+(a|e|am|em|z)\b)/iu, '')   // "Eles fazem…" → "fazem…"
    .replace(/^(voc[eê]s?\s+(pode|podem|deve|devem|precisa|precisam|vai|ir[aá]|consegue|conseguem|tem que|tem de)|[eé]\s+(poss[ií]vel|necess[aá]rio|preciso|importante|recomendado)|basta|recomenda-se|deve-se|sugere-se)\s+/i, '');
  let tokens = t.split(' ').filter(Boolean);
  if (!tokens.length) return '';
  let lead = '';

  // "O sistema / A equipe de TI / O download da versão mais recente ..." → separa sujeito e verbo
  if (ARTICLES.has(tokens[0].toLowerCase()) && tokens.length >= 3) {
    let i = 2;
    const limit = Math.min(tokens.length - 1, 7);
    let found = -1;
    for (let j = 2; j <= limit; j++) if (isVerbToken(tokens[j])) { found = j; break; }
    if (found > 0) i = found;
    else while (i + 1 < tokens.length && /^(de|do|da|dos|das)$/i.test(tokens[i])) i += 2;
    const subject = tokens.slice(1, i).join(' ');
    let rest = tokens.slice(i);
    if (rest[0] && /^(também|então|agora|ainda|já|sempre)$/i.test(rest[0])) rest = rest.slice(1);
    const v = rest[0] ? strip(rest[0]) : '';
    if (MODALS.has(v) && rest[1] && /(ar|er|ir|or|ôr)$/i.test(strip(rest[1]))) {   // "deve preencher"
      lead = toInfinitive(rest[1]) || rest[1];
      tokens = rest.slice(2);
    } else if (PASSIVE_AUX.has(v) && rest[1] && participleToInfinitive(rest[1])) {   // "é notificado"
      lead = participleToInfinitive(rest[1]);
      tokens = [subject.toLowerCase(), ...rest.slice(2)];
    } else if (rest.length && (toInfinitive(rest[0], { strict: true }) || toInfinitive(rest[0]))) {
      const inf = toInfinitive(rest[0], { strict: true }) || toInfinitive(rest[0]);
      const obj = rest.slice(1).filter((w) => !ARTICLES.has(w.toLowerCase()));
      // sujeito é uma coisa e a frase é um acontecimento: "A instalação iniciará automaticamente"
      const adverbial = obj.length <= 3 && (!obj.length || /^(em|no|na|automaticamente|sozinh|logo|imediatamente|normalmente|depois|ap[oó]s)/i.test(obj[0]) || /mente$/i.test(obj[0]));
      if (!PERSON.test(subject) && adverbial) {
        const noun = subject.split(' ')[0];
        return cap(limitWords([noun, present3(inf), ...obj], max).join(' ').replace(/[,.]$/, ''));
      }
      lead = inf;
      tokens = rest.slice(1);
    }
  } else if (tokens.length >= 2 && OBJECT_START.has(tokens[1].toLowerCase())) {
    // "Encaixe as pernas..." / "Verifique se..."
    const inf = toInfinitive(tokens[0]);
    if (inf) { lead = inf; tokens = tokens.slice(1); }
  } else if (tokens.length >= 3 && ROLE.test(strip(tokens[0])) && toInfinitive(tokens[1]) && (isVerbToken(tokens[1]) || COMMON_PRESENT.has(strip(tokens[1])))) {
    // sujeito sem artigo: "Tester reproduz o problema" / "Financeiro emite a nota"
    lead = toInfinitive(tokens[1]); tokens = tokens.slice(2);
  } else {
    const inf = toInfinitive(tokens[0], { strict: true }) || (COMMON_PRESENT.has(strip(tokens[0])) ? toInfinitive(tokens[0]) : null);
    if (inf) { lead = inf; tokens = tokens.slice(1); }                  // "Solicita mais detalhes" → "Solicitar…"
  }

  // remove artigos e palavras de preenchimento do objeto
  // "Comece a jogar" → "Começar a jogar" (o "a" antes do infinitivo não é artigo)
  const keepA = (w, i) => /^a$/i.test(w) && i === 0 && /^(começar|voltar|continuar|passar|aprender|ajudar|tornar)$/i.test(lead) && /(ar|er|ir)$/i.test(tokens[1] || '');
  let words = tokens.filter((w, i) => (keepA(w, i) || !ARTICLES.has(w.toLowerCase()) || (/^(a|ao)$/i.test(w) && i > 1 && /^(outr[oa]s?|um|uma|cada|qualquer)$/i.test(tokens[i + 1] || ''))) && !/^(também|então|devidamente|corretamente|necessário|necessária|sempre|todas|todos|toda|todo|cuidadosamente|desejado|desejada|desejados|desejadas)$/i.test(w));
  if (lead) words = [lead, ...words];
  // segunda ação ligada por "ou"/"e" também no infinitivo: "Navegar pelas recomendações ou toque…" → "…ou tocar…"
  words = words.map((w, i) => (i > 1 && /^(ou|e)$/i.test(words[i - 1]) && /^(toque|clique|selecione|abra|acesse|digite|pressione|escolha|use|aguarde|pesquise|busque|procure|navegue|arraste|deslize|role|aperte|entre|volte|feche|confirme)$/i.test(w) ? toInfinitive(w) || w : w));
  words = limitWords(words, max);
  return cap(words.join(' ').replace(/\s+([,.])/g, '$1').replace(/[,.]$/, ''));
}

/** Verbo inicial da frase, se houver (para separar passos de títulos/descrições) */
function leadVerb(text) {
  let t = cleanText(text).replace(/^(voc[eê]s?\s+(pode|podem|deve|devem|precisa)|basta)\s+/i, '');
  const tk = t.split(' ').filter(Boolean);
  if (!tk.length) return '';
  if (ARTICLES.has(tk[0].toLowerCase())) {
    for (let j = 2; j < Math.min(tk.length, 8); j++) if (isVerbToken(tk[j])) return toInfinitive(tk[j]) || tk[j];
    return '';
  }
  if (tk.length >= 2 && OBJECT_START.has(tk[1].toLowerCase())) return toInfinitive(tk[0]) || '';
  return toInfinitive(tk[0], { strict: true }) || (COMMON_PRESENT.has(strip(tk[0])) ? tk[0] : '');
}

/** Ação corretiva específica para o "Não" de uma validação: "Console está conectado à internet?" → "Conectar console à internet" */
function correctiveAction(question) {
  const t = String(question).replace(/\?+$/, '').trim();
  const w = t.split(/\s+/);
  const COP = /^(está|estão|esteja|é|são|foi|foram|ficou|fica|estiver|estiverem)$/i;
  const fit = (verb, subject, rest) => {
    const full = [verb, subject.toLowerCase(), rest].filter(Boolean).join(' ');
    if (full.split(/\s+/).length <= MAX_WORDS) return cap(full);
    const noSubj = [verb, rest].filter(Boolean).join(' ');
    return noSubj.split(/\s+/).length <= MAX_WORDS ? cap(noSubj) : shortenAction(full);
  };
  let m;
  if ((m = /^(há|existe|existem|tem|têm)\s+(.+)$/i.exec(t))) return shortenAction('Providenciar ' + m[2]);
  for (let i = 1; i < Math.min(w.length, 5); i++) {
    if (COP.test(w[i]) || !/(ad|id|íd)[oa]s?$/i.test(w[i])) continue;
    const inf = participleToInfinitive(w[i]);
    if (!inf) continue;
    const subj = w.slice(0, COP.test(w[i - 1]) ? i - 1 : i).filter((x) => !ARTICLES.has(x.toLowerCase())).join(' ');
    return fit(inf, subj, w.slice(i + 1).join(' '));
  }
  const pi = w.findIndex((x, i) => i >= 1 && /^(em|no|na|nos|nas)$/i.test(x));
  if (pi > 0 && w.findIndex((x) => COP.test(x)) < 0) return fit('Colocar', w.slice(0, pi).join(' '), w.slice(pi).join(' '));
  const ci = w.findIndex((x) => COP.test(x));
  if (ci > 0) {
    const subj = w.slice(0, ci).join(' ');
    const rest = w.slice(ci + 1).join(' ');
    return fit(/^(em|no|na|nos|nas)$/i.test(w[ci + 1] || '') ? 'Colocar' : 'Ajustar', subj, rest);   // "Colocar mesa na posição" 
  }
  return shortenAction('Ajustar ' + t.charAt(0).toLowerCase() + t.slice(1));
}

const SUBJ = { esteja: 'está', estejam: 'estão', seja: 'é', sejam: 'são', tenha: 'tem', tenham: 'têm', haja: 'há', houver: 'há', estiver: 'está', estiverem: 'estão', for: 'é', forem: 'são', tiver: 'tem', tiverem: 'têm', puder: 'pode', fizer: 'faz', quiser: 'quer', vier: 'vem', der: 'dá', souber: 'sabe', trouxer: 'traz', disser: 'diz', puser: 'põe', vir: 'vê' };
/** "a mesa balançar" → "a mesa balança"; "faltar peça" → "falta peça" (futuro do subjuntivo → presente) */
function subjunctiveToPresent(t) {
  const w = t.split(' ');
  for (let i = 0; i < Math.min(6, w.length); i++) {
    const k = w[i].toLowerCase();
    if (SUBJ[k]) { w[i] = SUBJ[k]; break; }
    if (i > 0 && /^(não|nao)$/i.test(w[i - 1]) === false && ARTICLES.has(k)) continue;
    if (/[aei]r$/.test(k) && k.length > 3) { w[i] = present3(k); break; }
    if (/[aei]rem$/.test(k)) { w[i] = k.replace(/arem$/, 'am').replace(/[ei]rem$/, 'em'); break; }
  }
  return w.join(' ');
}

/** Rótulo de decisão: pergunta curta terminada em "?" (≤ 5 palavras) */
function shortenQuestion(text, max = MAX_WORDS) {
  let t = cleanText(text).replace(/\?+$/, '');
  const conditional = /^(se|caso|quando)\s+/i.test(t);
  t = t.replace(/^(se|caso|quando)\s+/i, '');
  // "você já tiver comprado o jogo" → "Jogo já comprado"
  t = t.replace(/^voc[eê]s?\s+/i, '');
  let pm = /^(j[aá]\s+)?(tiver|tenha|tiverem|tenham|houver)\s+(j[aá]\s+)?([\wÀ-ú]+(?:ad|id)[oa]s?)\s+(.+)$/i.exec(t);
  if (pm) {
    const obj = pm[5].split(' ').filter((x) => !ARTICLES.has(x.toLowerCase()));
    t = [obj[0], (pm[1] || pm[3]) ? 'já' : '', pm[4], ...obj.slice(1)].filter(Boolean).join(' ');
  } else if (conditional) t = subjunctiveToPresent(t);
  else t = t.split(' ').map((x, i) => (i < 4 && SUBJ[x.toLowerCase()]) || x).join(' ');
  let words = t.split(' ').filter((w) => w && !ARTICLES.has(w.toLowerCase()));
  const COPULA = /^(é|são|está|estão|foi|foram|será|serão|possui|possuem|tem|têm|existe|existem|houve|há)$/i;
  // corta explicações: "... com acesso à internet ativado", "... para que ..."
  const cut = words.findIndex((w, i) => i >= 3 && /^(com|para|pois|porque|mas|e|sendo|onde|conforme)$/i.test(w));
  if (words.length > max && cut > 0) words = words.slice(0, cut);
  if (words.length > max && /^(está|é|estão|são)$/i.test(words[1] || '')) words.splice(1, 1);
  if (words.length > max && /^(todos|todas|todo|toda)$/i.test(words[0])) words = words.slice(1);
  // "Valor informado está ..." → remove particípio-adjetivo logo após o sujeito
  if (words.length > max && words.slice(2).some((w) => COPULA.test(w)) && /(ad|id)[oa]s?$/i.test(words[1] || '')) words.splice(1, 1);
  // remove complementos finais "de reembolso", "da empresa"…
  while (words.length > max && words.length >= 4 && /^(de|da|do|dos|das|em|no|na|nos|nas|para|com)$/i.test(words.at(-2))) words = words.slice(0, -2);
  words = limitWords(words, max);
  // eventos já ocorridos ficam no passado: "Ocorre algum erro?" → "Ocorreu algum erro?"
  const q = cap(words.join(' ').replace(/[,.:;]$/, '')).replace(/^Ocorre\b/, 'Ocorreu').replace(/^Acontece\b/, 'Aconteceu').replace(/^Dá (erro|problema|falha)/, 'Deu $1');
  return q + '?';
}

/** Divide ações compostas: "Acessa o portal e preenche o formulário" → ["Acessa o portal", "preenche o formulário"] */
function splitCompound(text) {
  const tokens = String(text).trim().split(/\s+/);
  const parts = [];
  let cur = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const next = tokens[i + 1], after = tokens[i + 2];
    const isVerb = next && !/s$/i.test(strip(next)) && toInfinitive(next) && after && OBJECT_START.has(strip(after));
    // "Abra o navegador, acesse o site e clique…": vírgula seguida de verbo no imperativo também separa as ações
    const curIsAction = cur.length && (toInfinitive(strip(cur[0]), { strict: true }) || leadVerb(cur.join(' ')));
    const commaVerb = /,$/.test(w) && next && curIsAction && toInfinitive(next, { strict: true }) && !ARTICLES.has(strip(next).toLowerCase());
    if (commaVerb) { cur.push(w.replace(/,$/, '')); parts.push(cur.join(' ')); cur = []; continue; }
    if (/^e$/i.test(w) && cur.length >= 2 && isVerb) {
      parts.push(cur.join(' ').replace(/,$/, ''));
      cur = [];
      continue;
    }
    cur.push(w);
  }
  if (cur.length) parts.push(cur.join(' '));
  return parts.every((p) => p.split(/\s+/).length >= 2) ? parts : [String(text)];
}

const wordCount = (s) => Math.max(0, ...String(s).split(/<br\s*\/?>/i).map((line) => line.replace(/\(\+\d+ etapas?\)/, '').replace(/^[\s•\d.]+/, '').trim().split(/\s+/).filter(Boolean).length));

/**
 * Responsável (raia) de um passo, para o fluxograma Funcional:
 *   "Cliente: envia o pedido" · "O suporte técnico analisa…" · "A equipe de vendas responde…"
 *   "Aprovar o pedido (Responsável: Gerente)" · "Financeiro emite a nota"
 * Devolve '' quando o passo não diz quem faz.
 */
const ROLE = /^(cliente|usu[aá]rio|solicitante|requisitante|gestor|gerente|supervisor|coordenador|coordena[cç][aã]o|diretor|diretoria|analista|suporte|t[eé]cnico|equipe|time|setor|departamento|[aá]rea|rh|recursos|financeiro|compras|comprador|vendas|vendedor|comercial|ti|desenvolvimento|desenvolvedor|programador|qa|teste|testes|tester|jur[ií]dico|atendente|atendimento|operador|opera[cç][oõ]es|log[ií]stica|almoxarifado|estoque|fornecedor|sistema|aprovador|colaborador|funcion[aá]rio|candidato|recrutador|recrutamento|recep[cç][aã]o|recepcionista|motorista|auditoria|contabilidade|marketing|help|service|infraestrutura|seguran[cç]a|professor|aluno|secretaria|portaria|caixa|gar[cç]om|cozinha|entregador|paciente|m[eé]dico|enfermeiro|enfermagem|farm[aá]cia|montador|administrador|central|expedi[cç][aã]o|produ[cç][aã]o|qualidade|engenharia|manuten[cç][aã]o|faturamento|cobran[cç]a|tesouraria|ouvidoria|diretor-geral)$/i;
const ACTOR_SKIP = /^(passo|etapa|fase|parte|nota|dica|aten[cç][aã]o|importante|observa[cç][aã]o|obs|exemplo|aviso|cuidado|resultado|objetivo)$/i;
function tidyActor(a) {
  const w = String(a).replace(/[()"“”.,;:]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4);
  while (w.length > 1 && /^(de|do|da|dos|das|e)$/i.test(w[w.length - 1])) w.pop();
  const t = w.join(' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
function extractActor(text) {
  const t = String(text).replace(/^[\s\d.\-–•*)]+(?=\S)/, '').trim();
  let m;
  if ((m = /\(?\b(?:respons[aá]vel|executor|quem faz)\s*:\s*([^)\.;,\n]{2,40})\)?/i.exec(t))) return tidyActor(m[1]);
  if ((m = /^([A-ZÀ-Úa-zà-ú][\wÀ-ú /-]{1,40}?)\s*:\s+\S/.exec(t))) {
    const first = m[1].trim().split(/\s+/)[0];
    if (!ACTOR_SKIP.test(first) && ROLE.test(first) && m[1].trim().split(/\s+/).length <= 5) return tidyActor(m[1]);
  }
  const tokens = t.split(/\s+/);
  const start = ARTICLES.has((tokens[0] || '').toLowerCase()) ? 1 : 0;
  if (!ROLE.test(strip(tokens[start] || ''))) return '';
  for (let j = start + 1; j <= Math.min(tokens.length - 1, start + 6); j++) {
    if (isVerbToken(tokens[j]) && !/^(de|do|da|dos|das|e|técnico|tecnico)$/i.test(tokens[j])) return tidyActor(tokens.slice(start, j).join(' '));
  }
  return '';
}

/**
 * Revisão final do texto de um bloco (camada de validação, vale para o modo Regras e para a IA):
 * conserta infinitivos quebrados ("Far" → "Fazer", "Fixe-ar" → "Fixar"), verbo conjugado no início ("Conectam" → "Conectar"),
 * palavras repetidas, pontuação solta, preposição pendurada no fim e a maiúscula inicial.
 */
const BROKEN_INF = { nomar: 'nomear', far: 'fazer', fazar: 'fazer', dizar: 'dizer', trazar: 'trazer', ponhar: 'pôr', pôar: 'pôr', poar: 'pôr', vejar: 'ver', leiar: 'ler',
  sigar: 'seguir', tenhar: 'ter', mantenhar: 'manter', obtenhar: 'obter', venhar: 'vir', saiar: 'sair', ouçar: 'ouvir', peçar: 'pedir',
  meçar: 'medir', perçar: 'perder', destróiar: 'destruir', consigar: 'conseguir', prossigar: 'prosseguir', sintar: 'sentir', durmar: 'dormir',
  sirvar: 'servir', subar: 'subir', cubrar: 'cobrir', descubrar: 'descobrir', fujar: 'fugir', ir: 'ir' };
const FIELD_NOUN = /^(nome|senha|data|e-?mail|telefone|celular|cpf|cnpj|rg|endereço|endereco|cep|número|numero|código|codigo|apelido|usuário|usuario|login|idade|gênero|genero|país|pais|cidade|foto|avatar)$/i;
const VALID_SHORT = /^(ir|ser|ter|ver|ler|dar|pôr|rir|vir|crer|pôr)$/i;
function polishLabel(label, kind = 'action') {
  let t = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t.replace(/^[\s,;:.\-–—•*>]+/, '').replace(/[\s,;:\-–—]+$/, '');
  t = t.replace(/(?<![\p{L}-])(\p{L}+)(\s+\1(?![\p{L}-]))+/giu, '$1');                                  // "de de" → "de"
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  if (kind === 'action') {
    t = t.replace(/^nomar\b/i, 'Nome');                                                 // "Nomar de Usuário" (IA) → campo "Nome de usuário"
    const m = /^(Não\s+)?([\p{L}-]+)(.*)$/iu.exec(t);
    const lead0 = m ? m[2].toLowerCase() : '';
    // começa com substantivo de campo ("Nome de usuário", "Senha forte") → "Informar nome de usuário" (nunca "Nomar")
    if (m && !m[1] && FIELD_NOUN.test(lead0) && !leadVerb(m[3].trim()) && !/^\s*(diz|faz|tem|vai|é|está|recebe|deve|pode)\b/i.test(m[3])) t = 'Informar ' + t.charAt(0).toLowerCase() + t.slice(1);
    // só converte a 1ª palavra quando ela é mesmo um verbo (ou um infinitivo quebrado conhecido)
    else if (m && (BROKEN_INF[lead0] || lead0.includes('-') || /(ar|er|ir|or|ôr)$/.test(lead0) || leadVerb(m[2] + m[3]) || toInfinitive(lead0, { strict: true }) || (/(am|em)$/.test(lead0) && lead0.length > 4 && leadVerb(m[2].slice(0, -1) + m[3])) || (m[1] && toInfinitive(lead0)))) {
      let [, neg = '', lead, rest] = m;
      let low = lead.toLowerCase();
      if (/-(ar|er|ir)$/.test(low)) low = low.split('-')[0];                        // "Fixe-ar" → "fixe"
      else if (low.includes('-')) low = low.split('-')[0];                          // "Encaixe-o" → "encaixe"
      let inf = BROKEN_INF[low] || (/(ar|er|ir|or|ôr)$/.test(low) && (low.length > 3 || VALID_SHORT.test(low)) ? low : null);
      if (!inf) inf = toInfinitive(low, { strict: true }) || toInfinitive(low);
      if (!inf && /[aeo]m$/.test(low) && low.length > 4) inf = low.replace(/am$/, 'ar').replace(/em$/, 'er');   // plural: "conectam" → "conectar"
      if (inf && inf !== lead.toLowerCase()) t = neg + inf + rest;
    }
    // 2º verbo no mesmo tempo do 1º: "Abrir app e faça login" → "Abrir app e fazer login"
    if (/^(Não\s+)?\S+(ar|er|ir|or|ôr)\b/i.test(t)) t = t.replace(/(\s(?:e|ou|depois)\s)([\p{L}]+)/giu, (all, pre, w) => {
      const inf = toInfinitive(w.toLowerCase(), { strict: true });
      return inf && inf !== w.toLowerCase() ? pre + inf : all;
    });
    // termina em "e selecionar" (2º verbo sem objeto, cortado pelo limite de palavras) → fica só a 1ª ação
    t = t.replace(/\s+(?:e|ou)\s+[\p{L}]+(?:ar|er|ir)$/iu, '');
    // termina em preposição/artigo ("Conectar cabo de") → corta
    const w = t.split(' ');
    while (w.length > 2 && TRAILING_STOP.has(w.at(-1).toLowerCase())) w.pop();
    t = w.join(' ');
  } else if (kind === 'question') {
    t = t.replace(/\?+$/, '') + '?';
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

module.exports = { polishLabel, leadVerb, correctiveAction, splitCompound, shortenAction, shortenQuestion, toInfinitive, wordCount, extractActor, MAX_WORDS };
