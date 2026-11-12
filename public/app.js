/* PDF para Fluxograma — interface
 * Fluxo de 1 clique: PDF → texto (pdf.js) → motor (IA ou Regras) → validação/auto-correção → render Mermaid
 */
import { parseFlowchart, analyze, summarize } from './graph.mjs';
import { beautifyFlowchart } from './route.mjs';
import { VisualEditor, importFromMermaid } from './visual-editor.mjs';
import { renderSVG, visualToMermaid, cloneModel, routeEdge } from './visual-model.mjs';
import { autoLayout, codeType } from './swimlane.mjs';
import { laneInfo, applyLaneEdits } from './functional.mjs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const STORE_KEY = 'fluxograma.history.v2';
const PREF_KEY = 'fluxograma.prefs.v2';
const MAX_BYTES = 80 * 1024 * 1024;
const CDN = {
  pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs',
  worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs',
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js',
};
const MODE_NAMES = { anthropic: 'Claude', openai: 'OpenAI', ollama: 'Ollama', regras: 'Regras', offline: 'Regras' };

const state = {
  current: null,        // item aberto
  view: null,           // { full, summary, analysis, merged }
  tab: 'visual',
  zoom: 1,
  renderSeq: 0,
  lastSource: null,     // { text, title, ... } para "Gerar novamente"
  status: null,
  config: null,
  busy: false,
};
const prefs = Object.assign({ level: 'completo', type: 'auto' }, safeJSON(localStorage.getItem(PREF_KEY), {}));
// v4: o tipo Automático (layout escolhido pela estrutura do documento) passa a ser o padrão uma vez
if (prefs.typeV !== 4) { prefs.type = 'auto'; prefs.typeV = 4; try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }

// ================================================================ utilidades
function safeJSON(s, fb) { try { return JSON.parse(s) ?? fb; } catch { return fb; } }
function savePrefs() { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }
function toast(msg, ms = 3600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: 'Resposta inválida do servidor local.' }));
  if (!res.ok) throw new Error(data.error || 'Erro no servidor local.');
  return data;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = (s) => (s || 'fluxograma').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'fluxograma';

// ================================================================ estilos visuais do fluxograma
/* Inspirados nos fluxogramas-modelo do usuário:
 *  classico → cinza sóbrio (modelos 1 e 3)    azul → corporativo (modelo 2)    moderno → colorido */
const VISUAL_STYLES = {
  classico: {
    vars: { primaryColor: '#D9D9D9', primaryBorderColor: '#7F7F7F', primaryTextColor: '#1A1A1A', lineColor: '#262626',
      secondaryColor: '#BFBFBF', tertiaryColor: '#F2F2F2', clusterBkg: '#F7F7F7', clusterBorder: '#BFBFBF', edgeLabelBackground: '#FFFFFF' },
    classDefs: {
      inicioFim: 'fill:#D9D9D9,stroke:#7F7F7F,stroke-width:1.5px,color:#1A1A1A',
      decisao: 'fill:#BFBFBF,stroke:#7F7F7F,stroke-width:1.5px,color:#1A1A1A',
      erro: 'fill:#D9D9D9,stroke:#7F7F7F,stroke-width:1.5px,color:#1A1A1A',
      lista: 'fill:#E7E7E7,stroke:#7F7F7F,stroke-width:1.5px,color:#1A1A1A',
      nota: 'fill:#FFFDE7,stroke:#9E9E9E,stroke-width:1px,stroke-dasharray:4 3,color:#555555',
      duvida: 'fill:#FFF8E6,stroke:#C98A00,stroke-width:1.5px,stroke-dasharray:5 3,color:#6B4E00',
      revisar: 'stroke:#D97706,stroke-width:2px,stroke-dasharray:6 3',
    },
    labelCss: 'outline:1px solid #8C8C8C;outline-offset:2px;background:#fff;font-weight:700;',
  },
  azul: {
    vars: { primaryColor: '#DDEBF7', primaryBorderColor: '#2E75B6', primaryTextColor: '#1F3864', lineColor: '#1F3864',
      secondaryColor: '#BDD7EE', tertiaryColor: '#F3F8FC', clusterBkg: '#F5F9FD', clusterBorder: '#9DC3E6', edgeLabelBackground: '#FFFFFF' },
    classDefs: {
      inicioFim: 'fill:#9DC3E6,stroke:#2E75B6,stroke-width:1.5px,color:#1F3864',
      decisao: 'fill:#BDD7EE,stroke:#2E75B6,stroke-width:1.5px,color:#1F3864',
      erro: 'fill:#DDEBF7,stroke:#2E75B6,stroke-width:1.5px,color:#1F3864',
      lista: 'fill:#EAF2FA,stroke:#2E75B6,stroke-width:1.5px,color:#1F3864',
      nota: 'fill:#FFFDE7,stroke:#9E9E9E,stroke-width:1px,stroke-dasharray:4 3,color:#555555',
      duvida: 'fill:#FFF8E6,stroke:#C98A00,stroke-width:1.5px,stroke-dasharray:5 3,color:#6B4E00',
      revisar: 'stroke:#D97706,stroke-width:2px,stroke-dasharray:6 3',
    },
    labelCss: 'background:#fff;font-weight:600;color:#1F3864;',
  },
  moderno: {
    vars: { primaryColor: '#EAF4F7', primaryBorderColor: '#1D7187', primaryTextColor: '#14213B', lineColor: '#5E6E82',
      secondaryColor: '#FFF6E0', tertiaryColor: '#F4F8FA', clusterBkg: '#F4F9FA', clusterBorder: '#B9D8DF', edgeLabelBackground: '#FFFFFF' },
    classDefs: {
      inicioFim: 'fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20',
      decisao: 'fill:#FFF8E1,stroke:#F9A825,stroke-width:2px,color:#5D4037',
      erro: 'fill:#FFEBEE,stroke:#C62828,stroke-width:1.5px,color:#B71C1C',
      lista: 'fill:#F4F9FB,stroke:#1D7187,stroke-width:1.2px,color:#14213B',
      nota: 'fill:#FFFDE7,stroke:#9E9E9E,stroke-width:1px,stroke-dasharray:4 3,color:#555555',
      duvida: 'fill:#FFF8E6,stroke:#C98A00,stroke-width:1.5px,stroke-dasharray:5 3,color:#6B4E00',
      revisar: 'stroke:#D97706,stroke-width:2px,stroke-dasharray:6 3',
    },
    labelCss: 'background:#fff;',
  },
};
// ================================================================ tipos de fluxograma
const TYPES = {
  processo: { name: 'Processo', full: 'Fluxograma de Processo (linear)' },
  raias: { name: 'Funcional', full: 'Fluxograma Funcional (raias)' },
  decisao: { name: 'Decisão', full: 'Fluxograma de Tomada de Decisão' },
};
/** nome exibido: no Automático, o Decisão sem perguntas acrescentadas é o fluxograma ramificado por etapas */
const typeFull = (it) => (it?.auto && itemType(it) === 'decisao' ? 'Fluxograma ramificado por etapas' : TYPES[itemType(it)].full);
const itemType = (it) => (TYPES[it?.type] ? it.type : codeType(it?.code) || 'decisao');

// "auto": o gerador escolhe o layout pela estrutura do documento (vertical, raias ou ramificado por etapas)
const PICK_TYPES = ['auto', ...Object.keys(TYPES)];
function initTypePicker() {
  const sel = $('#typeSelect');
  if (!PICK_TYPES.includes(prefs.type)) prefs.type = 'auto';
  sel.value = prefs.type;
  sel.onchange = () => { prefs.type = PICK_TYPES.includes(sel.value) ? sel.value : 'auto'; savePrefs(); };
}

/** Cores do estilo atual para o desenho das raias */
function lanePalette() {
  const st = currentStyle(), v = st.vars;
  const cd = (k, prop) => new RegExp(prop + ':(#[0-9a-f]+)', 'i').exec(st.classDefs[k] || '')?.[1];
  return {
    fill: v.primaryColor, stroke: v.primaryBorderColor, color: v.primaryTextColor, line: v.lineColor,
    decisionFill: cd('decisao', 'fill'), decisionStroke: cd('decisao', 'stroke'),
    terminalFill: cd('inicioFim', 'fill'), terminalStroke: cd('inicioFim', 'stroke'),
    errorFill: cd('erro', 'fill'), errorStroke: cd('erro', 'stroke'),
    laneFill: '#ffffff', laneStroke: v.clusterBorder,
  };
}

/**
 * Desenho automático no padrão do tipo escolhido (Processo, Funcional/raias ou Decisão), calculado na hora a partir
 * do código do nível atual. Só o desenho editado à mão fica salvo no histórico.
 * Se algo der errado no layout, devolve null e o fluxograma é desenhado pelo Mermaid (rede de segurança).
 */
function autoModel(item = state.current) {
  if (!item) return null;
  try {
    const code = state.forceFull ? state.view.full : levelCode();
    const m = autoLayout(code, { type: itemType(item), title: item.title, direction: state.config?.direction || 'TD', palette: lanePalette() });
    return m.nodes.length ? m : null;
  } catch (e) { console.warn('layout automático falhou; usando o Mermaid', e); return null; }
}
/** O que aparece na tela: o desenho editado à mão ou o layout automático do tipo */
const displayModel = () => (manualVisual() ? state.current.visual : autoModel());

const currentStyle = () => VISUAL_STYLES[state.config?.visualStyle] || VISUAL_STYLES.classico;

/** Aplica as cores do estilo escolhido ao código (sem alterar o que está salvo) */
function styledCode(code) {
  const st = currentStyle();
  const lines = String(code).split('\n').filter((l) => !/^\s*classDef\s+(inicioFim|decisao|erro|lista|nota|revisar)\b/.test(l));
  const used = Object.keys(st.classDefs).filter((c) => new RegExp(`\\bclass\\s+\\S+\\s+${c}\\b|:::${c}\\b`).test(code));
  return lines.join('\n').trimEnd() + '\n\n' + used.map((c) => `    classDef ${c} ${st.classDefs[c]}`).join('\n') + '\n';
}

/** Rótulos Sim/Não em caixinhas e títulos de seção, embutidos no SVG (valem também nos downloads) */
function decorateSvg(el) {
  if (!el || el.querySelector('style[data-estilo]')) return;
  const st = currentStyle();
  const id = '#' + CSS.escape(el.id);
  const css = `${id} .edgeLabel span.edgeLabel { ${st.labelCss} }
${id} .edgeLabel p { margin: 0; background: transparent; }
${id} foreignObject { overflow: visible; }
${id} .cluster-label span, ${id} .cluster-label p { font-weight: 700; }
${id} .node.lista .nodeLabel, ${id} .node.lista .nodeLabel p { text-align: left; }`;
  const tag = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  tag.setAttribute('data-estilo', '1');
  tag.textContent = css;
  el.appendChild(tag);
}

function applyMermaidTheme() {
  if (!window.mermaid) return;
  window.mermaid.initialize(mermaidConfig());
}
function mermaidConfig() {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: '"Segoe UI", system-ui, Arial, sans-serif',
    flowchart: { curve: 'basis', nodeSpacing: 70, rankSpacing: 68, padding: 22, diagramPadding: 24, useMaxWidth: false, htmlLabels: true, wrappingWidth: 220, subGraphTitleMargin: { top: 10, bottom: 14 } },
    themeVariables: { ...currentStyle().vars, fontSize: '15px' },
  };
}

// ================================================================ bibliotecas
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ||= (async () => {
    try {
      const lib = await import('./vendor/pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
      return lib;
    } catch {
      const lib = await import(CDN.pdf);
      lib.GlobalWorkerOptions.workerSrc = CDN.worker;
      return lib;
    }
  })();
  return pdfjsPromise;
}

let mermaidPromise;
function loadMermaid() {
  mermaidPromise ||= new Promise((resolve, reject) => {
    const init = () => {
      window.mermaid.initialize(mermaidConfig());
      resolve(window.mermaid);
    };
    if (window.mermaid) return init();
    const s = document.createElement('script');
    s.src = CDN.mermaid; s.onload = init;
    s.onerror = () => reject(new Error('Não foi possível carregar o Mermaid.'));
    document.head.appendChild(s);
  });
  return mermaidPromise;
}

// ================================================================ extração de PDF
async function extractPdfText(buffer, onProgress) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(`Página ${p} de ${doc.numPages}`, p / doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = [];
    let line = '';
    let lastY = null;
    let lastEnd = null;   // x onde terminou o último pedaço de texto
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const str = it.str.normalize('NFKC');           // ligaduras "ﬁ" → "fi"
      const x = it.transform[4], y = Math.round(it.transform[5]);
      const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
      if (lastY !== null && Math.abs(y - lastY) > 3 && line.trim()) { lines.push(line.trim()); line = ''; lastEnd = null; }
      // só insere espaço se houver distância real entre os pedaços (evita "Certi fi que-se")
      const gapSpace = lastEnd !== null && x - lastEnd > size * 0.18;
      if (line && str && !line.endsWith(' ') && !str.startsWith(' ') && (lastEnd === null || gapSpace)) line += ' ';
      line += str;
      if (str) lastEnd = x + (it.width || 0);
      lastY = y;
      if (it.hasEOL && line.trim()) { lines.push(line.trim()); line = ''; lastY = null; lastEnd = null; }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines);
  }
  // remove cabeçalhos/rodapés repetidos (comum no Confluence)
  if (pages.length > 2) {
    const freq = new Map();
    pages.forEach((ls) => new Set(ls.map((l) => l.replace(/\d+/g, '#'))).forEach((k) => freq.set(k, (freq.get(k) || 0) + 1)));
    const limit = Math.max(2, Math.ceil(pages.length * 0.5));
    pages.forEach((ls, i) => (pages[i] = ls.filter((l) => (freq.get(l.replace(/\d+/g, '#')) || 0) < limit || l.length > 80)));
  }
  const meta = await doc.getMetadata().catch(() => null);
  const text = pages.map((ls) => ls.join('\n')).join('\n\n')
    .replace(/([a-zà-ú]) (fi|fl|ffi|ffl|ff) ([a-zà-ú])/gi, '$1$2$3');    // ligaduras soltas em PDFs exportados
  return { text, pages: doc.numPages, title: cleanMetaTitle(meta?.info?.Title) };
}
/** PDF sem título nos metadados: usa a 1ª linha do documento quando ela tem cara de título ("Como Criar uma Conta no Roblox…") */
function firstLineTitle(text) {
  const lines = String(text || '').split(/\n/).map((l) => l.trim());
  const i = lines.findIndex((l) => l.length >= 6);
  if (i < 0) return '';
  let line = lines[i];
  // título quebrado em duas linhas no PDF ("… Guia Passo a" + "Passo")
  const next = lines[i + 1] || '';
  if (next && /\s(a|o|as|os|de|da|do|das|dos|e|em|no|na|para|com|por|-|–)$/i.test(line) && next.split(/\s+/).length <= 6 && !/^(passo|etapa|fase)\s*\d/i.test(next)) line += ' ' + next;
  const w = line.split(/\s+/);
  if (w.length > 14 || /^[\d•\-–*]/.test(line) || /^(passo|etapa|fase|parte)\s*\d/i.test(line) || /[.:;]$/.test(line)) return '';
  return line.length > 90 ? line.slice(0, 90).replace(/\s+\S*$/, '') + '…' : line;
}

function cleanMetaTitle(t) {
  t = String(t || '').replace(/^Microsoft Word\s*-\s*/i, '').replace(/\.(docx?|pdf)$/i, '').trim();
  return /^(untitled|sem t[ií]tulo|document\d*)$/i.test(t) ? '' : t;
}

// ================================================================ progresso no cartão
const STEP_TEXT = {
  read: 'Lendo o documento…',
  ai: 'Analisando o conteúdo…',
  check: 'Validando o fluxograma…',
  done: 'Montando o fluxograma…',
};
function setBusy(on) {
  state.busy = on;
  $('#dropzone').classList.toggle('busy', on);
  $('.dz-idle').hidden = on;
  $('.dz-busy').hidden = !on;
  $('#btnImport').disabled = on;
  $('#urlInput').disabled = on;
  if (!on) $$('#flowSteps li[data-step]').forEach((li) => (li.className = ''));
}
function setStep(step, detail = '', frac = null) {
  const map = { read: 1, ai: 2, check: 2, done: 3 };
  const n = map[step];
  $$('#flowSteps li[data-step]').forEach((li) => {
    const i = Number(li.dataset.step);
    li.className = i < n ? 'done' : i === n ? 'active' : '';
  });
  $('#busyTitle').textContent = STEP_TEXT[step];
  $('#busyDetail').textContent = detail;
  const base = { read: 5, ai: 40, check: 82, done: 95 }[step];
  const span = { read: 30, ai: 0, check: 10, done: 5 }[step];
  $('#busyBar').style.width = (frac == null ? base : base + span * frac) + '%';
  if (step === 'ai') animateAiBar();
}
function animateAiBar() {
  clearInterval(animateAiBar._t);
  let w = 40;
  animateAiBar._t = setInterval(() => {
    if (!state.busy || !$('#busyTitle').textContent.startsWith('Analisando')) return clearInterval(animateAiBar._t);
    w += (78 - w) * 0.04;
    $('#busyBar').style.width = w + '%';
  }, 300);
}

// ================================================================ pipeline de 1 clique
async function runFromFile(file) {
  if (!file || state.busy) return;
  if (file.size > MAX_BYTES) return toast('Arquivo maior que 80 MB.');
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  const isText = /\.(txt|md)$/i.test(file.name) || /^text\//.test(file.type);
  if (!isPdf && !isText) return toast('Envie um arquivo PDF.');
  const fileTitle = file.name.replace(/\.(pdf|txt|md)$/i, '');
  await pipeline(async (progress) => {
    if (!isPdf) return { text: await file.text(), title: fileTitle, pages: 1, sourceType: 'text', sourceName: file.name };
    const r = await extractPdfText(await file.arrayBuffer(), progress);
    return { text: r.text, title: r.title || firstLineTitle(r.text) || fileTitle, pages: r.pages, sourceType: 'pdf', sourceName: file.name };
  });
}

async function runFromUrl(url) {
  if (state.busy) return;
  await pipeline(async (progress) => {
    progress('Baixando o conteúdo do link…');
    const data = await api('/api/fetch-url', { url });
    if (data.kind === 'pdf') {
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const r = await extractPdfText(bytes.buffer, progress);
      return { text: r.text, title: r.title || data.title, pages: r.pages, sourceType: 'url', sourceName: url };
    }
    return { text: data.text, title: data.title, pages: 1, sourceType: 'web', sourceName: url };
  });
}

async function pipeline(getSource) {
  closeSidebar();
  setBusy(true);
  try {
    setStep('read');
    const mermaidReady = loadMermaid();
    const src = await getSource((d, f) => setStep('read', d, f));
    src.title = (src.title || 'Fluxograma').trim();
    src.words = src.text.split(/\s+/).filter(Boolean).length;
    if (src.words < 5) throw new Error('Não encontrei texto neste documento. Se o PDF for escaneado (imagem), exporte novamente com texto selecionável.');
    state.lastSource = src;

    const item = await generateAndValidate(src, mermaidReady);
    saveItem(item);
    await openItem(item);
  } catch (err) {
    console.error(err);
    toast('⚠️ ' + err.message, 7000);
  } finally {
    setBusy(false);
    $('#fileInput').value = '';
  }
}

async function generateAndValidate(src, mermaidReady, forceProvider, type = prefs.type) {
  const st = state.status;
  const engine = st ? (st.provider === 'regras' ? 'modo Regras' : `${MODE_NAMES[st.provider]} · ${st.model}`) : '';
  setStep('ai', `${src.words.toLocaleString('pt-BR')} palavras · ${engine}`);
  const res = await api('/api/generate', { text: src.text, title: src.title, provider: forceProvider, type });
  let { code, provider, model } = res;
  let warning = res.warning || '';

  setStep('check');
  const mermaid = await mermaidReady;
  let ok = await isValid(mermaid, code);
  for (let attempt = 1; !ok.valid && attempt <= 2 && provider !== 'regras'; attempt++) {
    setStep('check', `Corrigindo a sintaxe automaticamente (tentativa ${attempt})`);
    try {
      code = (await api('/api/repair', { code, error: ok.error, type })).code;
      ok = await isValid(mermaid, code);
    } catch (e) { console.warn(e); break; }
  }
  if (!ok.valid) {
    setStep('check', 'Usando o modo Regras como segurança');
    const fb = await api('/api/generate', { text: src.text, title: src.title, provider: 'regras', type });
    code = fb.code; provider = 'regras'; model = ''; res.issues = fb.issues; res.structure = fb.structure;
    warning = 'A IA gerou um código inválido; foi usado o modo Regras. Você pode tentar "Gerar novamente" na aba Análise.';
  }
  setStep('done');
  return {
    id: uid(), title: src.title, code, warning, provider, model, type: res.type || type,
    auto: !!res.auto, autoReason: res.autoReason || '', issues: res.issues || [], structure: res.structure || null, goal: res.goal || '',
    functional: res.functional ? { checks: res.functional.checks || [], content: (res.functional.content || []).map((c) => c.category),
      // como cada decisão foi entendida: quem decide, o que o "Sim" significa e para onde vai cada resposta
      decisions: (res.functional.activities || []).filter((a) => a.type === 'decision').map((a) => ({ label: a.label, lane: a.lane, kind: a.decision_kind || '',
        state: a.condition?.state || 'neutro', outcomes: (a.outcomes || []).map((o) => ({ answer: o.answer, kind: o.kind, to: String(o.to_label || '').replace(/<br\/>.*/, '') })) })) } : null,
    sourceType: src.sourceType, sourceName: src.sourceName, pages: src.pages, words: src.words,
    durationMs: res.durationMs, createdAt: Date.now(), pinned: false,
  };
}

async function isValid(mermaid, code) {
  try { await mermaid.parse(code); return { valid: true }; }
  catch (e) { return { valid: false, error: String(e?.message || e).slice(0, 1500) }; }
}

// ================================================================ telas
function showHome() {
  if (!leaveEdit()) return;
  state.current = null;
  state.view = null;
  $('#resultView').hidden = true;
  $('#homeView').hidden = false;
  document.body.classList.add('on-home');
  $('#diagram').innerHTML = '';
  $('#urlInput').value = '';
  window.scrollTo({ top: 0 });
  renderHistory();
}

function computeView(code) {
  const g = parseFlowchart(code);
  const analysis = analyze(g);
  const sum = summarize(g);
  return { full: code, summary: sum.code || code, merged: sum.merged, analysis };
}

async function openItem(item) {
  if (!leaveEdit()) return;
  state.current = item;
  state.view = computeView(item.code);
  if (item.visualAuto) { delete item.visual; delete item.visualAuto; updateItem(item.id, { visual: null, visualAuto: false }); } // versão anterior salvava o automático
  $('#homeView').hidden = true;
  $('#resultView').hidden = false;
  document.body.classList.remove('on-home');
  window.scrollTo({ top: 0 });
  renderHeader();
  setTab('visual', true);
  await renderDiagram(true);
  renderHistory();
}

function renderHeader() {
  const item = state.current, a = state.view.analysis;
  $('#resultTitle').textContent = item.title;
  $('#resultSummary').innerHTML = `<span class="type-tag">${esc(typeFull(item))}</span>${item.auto ? ` <span class="type-tag auto" title="${esc(item.autoReason || '')}">escolhido automaticamente</span>` : ''} construído a partir de ${a.instructions} instrução(ões) do documento.`;
  // validação: erro grave aparece em destaque (o diagrama não é apresentado como validado); avisos ficam na Análise
  const issues = allIssues(item);
  const bad = issues.filter((i) => i.level === 'erro');
  const doubts = issues.filter((i) => i.level === 'aviso' || i.level === 'interpretação');
  const vb = $('#validationNote');
  if (vb) {
    vb.hidden = !bad.length && !doubts.length;
    vb.className = 'validation-note ' + (bad.length ? 'bad' : 'info');
    vb.innerHTML = bad.length
      ? `<b>Validação encontrou ${bad.length} problema(s) que não puderam ser corrigidos com segurança.</b> Revise antes de usar: ${esc(bad[0].message)} <button class="link" data-goto-analysis>Ver detalhes</button>`
      : `${doubts.length} ponto(s) de atenção na interpretação do documento (dúvidas, retornos deduzidos ou ajustes de ordem). <button class="link" data-goto-analysis>Ver na Análise</button>`;
    vb.querySelectorAll('[data-goto-analysis]').forEach((b) => (b.onclick = () => setTab('analysis')));
  }
  const q = $('#qualityBadge');
  q.className = 'quality ' + a.tone;
  $('#qualityGrade').textContent = a.grade;
  $('#qualityScore').textContent = a.score;
  const web = item.sourceType === 'web';
  $('#statPages').textContent = item.pages ?? '—';
  $('#statPagesLabel').textContent = web ? 'Página web lida' : (item.pages === 1 ? 'Página lida' : 'Páginas lidas');
  $('#statElements').textContent = a.elements;
  $('#statDecisions').textContent = a.decisions;
  $('#statMode').textContent = (MODE_NAMES[item.provider] || 'Regras').toUpperCase();
  $('#statMode').title = item.model || '';
  // aviso somente quando algo deu errado (sem faixa fixa na tela)
  if (item.warning && /^Gerado pelo modo Regras/.test(item.warning)) item.warning = ''; // aviso antigo, não exibir
  $$('#levelSeg button').forEach((b) => b.classList.toggle('active', b.dataset.level === prefs.level));
}

function levelCode() {
  if (state.forceFull) return state.view.full;
  return prefs.level === 'resumido' ? state.view.summary : state.view.full;
}
/** O item tem um desenho feito à mão no editor visual? */
const manualVisual = () => !!state.current?.visual?.nodes?.length && !state.current.visualAuto;

// ================================================================ editor visual (estilo draw.io)
function editorDefaults() {
  const st = currentStyle(), v = st.vars;
  const cd = (k, prop) => new RegExp(prop + ':(#[0-9a-f]+)', 'i').exec(st.classDefs[k] || '')?.[1];
  return {
    fill: v.primaryColor, stroke: v.primaryBorderColor, color: v.primaryTextColor, line: v.lineColor,
    decisionFill: cd('decisao', 'fill'), decisionStroke: cd('decisao', 'stroke'),
    terminalFill: cd('inicioFim', 'fill'), terminalStroke: cd('inicioFim', 'stroke'),
    containerFill: v.clusterBkg, containerStroke: v.clusterBorder,
    labelBorder: /outline:1px solid (#[0-9a-f]+)/i.exec(st.labelCss)?.[1] || null,
  };
}

async function startEdit() {
  if (!state.current || state.edit) return;
  let model;
  const shown = displayModel();
  if (shown) model = cloneModel(shown);
  else {
    // importa o fluxograma já desenhado (nível Completo, com o layout final das linhas)
    setTab('visual', true);
    state.forceFull = true;
    await renderDiagram(false);
    state.forceFull = false;
    const svg = $('#diagram svg');
    try { model = importFromMermaid(svg, svg.dataset.code); }
    catch (e) { console.warn(e); model = { nodes: [], edges: [] }; }
    if (prefs.level === 'resumido') renderDiagram(false);
  }
  const ov = $('#vEditor');
  ov.hidden = false;
  document.body.classList.add('ve-open');
  $('#veName').textContent = state.current.title;
  setEditStatus(false);
  state.edit = {
    editor: new VisualEditor({
      host: $('#veCanvas'), palette: $('#vePalette'), format: $('#veFormat'), zoomLabel: $('#veZoom'),
      model, defaults: editorDefaults(), onChange: (d) => setEditStatus(d),
    }),
  };
}

function setEditStatus(dirty) {
  const s = $('#veStatus');
  s.textContent = dirty ? '● Alterações não salvas' : 'Nenhuma alteração';
  s.className = 've-status' + (dirty ? ' dirty' : '');
}

async function saveEdit() {
  if (!state.edit) return;
  const ed = state.edit.editor;
  ed.commitText();
  const model = ed.getModel();
  if (!model.nodes.length) return toast('⚠️ O desenho está vazio — adicione ao menos um bloco antes de salvar.', 5000);
  const item = state.current;
  item.visual = model;
  delete item.visualAuto;
  let code = visualToMermaid(model, item.code.match(/^\s*flowchart\s+(\w+)/m)?.[1] || 'TD');
  if (itemType(item) === 'raias') code = '%% tipo: raias\n' + code;
  // o código Mermaid acompanha a estrutura (blocos, ligações e textos) do desenho
  let codeOk = false;
  try { codeOk = (await isValid(await loadMermaid(), code)).valid; } catch { /* mantém o código anterior */ }
  if (codeOk) item.code = code;
  updateItem(item.id, { visual: model, visualAuto: false, code: item.code });
  state.view = computeView(item.code);
  endEdit();
  renderHeader();
  await renderDiagram(true);
  renderHistory();
  toast('✓ Edições salvas! O “Baixar” (PNG, SVG, HTML) agora sai exatamente como você desenhou.', 5000);
  const exp = $('#btnExport');
  exp.classList.remove('pulse'); void exp.offsetWidth; exp.classList.add('pulse');
}

function endEdit() {
  state.edit?.editor?.destroy();
  state.edit = null;
  $('#vEditor').hidden = true;
  document.body.classList.remove('ve-open');
}

function cancelEdit() {
  if (!state.edit) return;
  if (state.edit.editor.dirty && !confirm('Descartar as alterações feitas no editor visual?')) return;
  endEdit();
}

/** Ao sair da tela com edição aberta: pergunta antes de descartar */
function leaveEdit() {
  if (!state.edit) return true;
  if (state.edit.editor.dirty && !confirm('Há alterações não salvas no editor visual. Descartar?')) return false;
  endEdit();
  return true;
}

/** Descarta o desenho manual e volta ao layout automático (a partir do código) */
async function dropVisual(ask = true) {
  if (!manualVisual()) return;
  if (ask && !confirm('Voltar ao layout automático? O desenho feito à mão no editor visual será descartado.')) return;
  delete state.current.visual;
  state.current.visualAuto = false;
  updateItem(state.current.id, { visual: null, visualAuto: false });
  await renderDiagram(true);
  toast('Layout automático restaurado.');
}

function setTab(tab, silent) {
  state.tab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#visualPane').hidden = tab !== 'visual';
  $('#codePane').hidden = tab !== 'code';
  $('#analysisPane').hidden = tab !== 'analysis';
  $('#zoomCtl').hidden = tab !== 'visual';
  $('#levelSeg').hidden = tab === 'analysis';
  if (tab === 'code') fillEditor();
  if (tab === 'analysis') renderAnalysis();
  if (tab === 'visual') { applyRouting(); if (!silent) requestAnimationFrame(fit); }
}

function fillEditor() {
  const ed = $('#codeEditor');
  const resumido = prefs.level === 'resumido' && !manualVisual();
  ed.value = manualVisual() ? state.view.full : levelCode();
  ed.readOnly = resumido;
  $('#codeHint').textContent = manualVisual()
    ? 'Estrutura do desenho editado à mão. Alterar o código descarta o desenho manual e volta ao layout automático.'
    : resumido
    ? 'Nível Resumido (somente leitura) — mude para Completo para editar.'
    : 'Edite o código — o fluxograma é atualizado automaticamente.';
  $('#codeStatus').textContent = '';
}

async function setLevel(level) {
  if (manualVisual()) return toast('Este fluxograma foi editado à mão: os níveis valem só para o layout automático.', 4500);
  if (prefs.level === level) return;
  prefs.level = level; savePrefs();
  $$('#levelSeg button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
  if (level === 'resumido' && !state.view.merged) toast('Este fluxograma não tem sequências lineares para resumir — os dois níveis são iguais.');
  if (state.tab === 'code') fillEditor();
  await renderDiagram(true);
}

// ================================================================ render + zoom/pan
async function renderDiagram(refit) {
  const model = state.forceFull ? null : displayModel();
  const manual = !!model;
  $('#visualNote').hidden = !manualVisual();
  $('#levelSeg').classList.toggle('disabled', manualVisual());
  if (manual) {
    ++state.renderSeq;
    $('#diagram').innerHTML = renderSVG(model, { labelBorder: editorDefaults().labelBorder });
    const el = $('#diagram svg');
    el.dataset.routed = '1';
    sizeDiagram();
    if (refit) requestAnimationFrame(fit);
    return;
  }
  const mermaid = await loadMermaid();
  const code = styledCode(levelCode());
  const seq = ++state.renderSeq;
  try {
    const { svg } = await mermaid.render('mmd' + seq, code);
    if (seq !== state.renderSeq) return;
    $('#diagram').innerHTML = svg;
    const el = $('#diagram svg');
    el.removeAttribute('width'); el.removeAttribute('height');
    el.removeAttribute('style');
    el.dataset.code = code;
    decorateSvg(el);
    sizeDiagram();
    applyRouting();
  } catch (e) {
    document.getElementById('dmmd' + seq)?.remove();
    if (seq === state.renderSeq) $('#diagram').innerHTML = `<div class="err">Erro de sintaxe no Mermaid:\n\n${esc(e?.message || e)}</div>`;
  }
  if (refit) requestAnimationFrame(fit);
}
/** Saídas laterais nos losangos (precisa do SVG visível para medir) */
function applyRouting(svgEl = $('#diagram svg'), code = svgEl?.dataset.code) {
  if (!svgEl || svgEl.dataset.routed === '1' || !code) return;
  if (!svgEl.getBoundingClientRect().width) return; // aba oculta: roteia quando ficar visível
  const g = parseFlowchart(code);
  const decisions = new Set([...g.nodes.values()].filter((n) => n.kind === 'decision').map((n) => n.id));
  try { beautifyFlowchart(svgEl, new Set(g.nodes.keys()), decisions, g.direction); }
  catch (e) { console.warn('Roteamento lateral ignorado:', e); }
  svgEl.dataset.routed = '1';
  if (svgEl.closest('#diagram')) sizeDiagram();
}

/* ---- zoom com barras de rolagem: o SVG é redimensionado e a área do desenho rola normalmente ---- */
function sizeDiagram() {
  const el = $('#diagram svg');
  const vb = el?.viewBox?.baseVal;
  if (!vb?.width) return;
  el.removeAttribute('width'); el.removeAttribute('height');
  el.style.width = (vb.width * state.zoom).toFixed(1) + 'px';
  el.style.height = (vb.height * state.zoom).toFixed(1) + 'px';
  $('#zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
}
function fit() {
  const el = $('#diagram svg');
  const canvas = $('#canvas');
  const vb = el?.viewBox?.baseVal;
  if (!vb?.width || !canvas.clientWidth) return;
  const pad = 64;
  const cw = canvas.clientWidth - pad, ch = canvas.clientHeight - pad;
  let z = Math.min(cw / vb.width, ch / vb.height, 1);
  if (z < 0.6) z = Math.min(cw / vb.width, 0.9); // diagramas muito altos: legibilidade primeiro, com rolagem
  state.zoom = Math.max(0.1, z);
  sizeDiagram();
  canvas.scrollTo({ left: 0, top: 0 });
}
function zoomBy(f, cx, cy) {
  const canvas = $('#canvas');
  cx ??= canvas.clientWidth / 2; cy ??= canvas.clientHeight / 2;
  const nz = Math.min(5, Math.max(0.1, state.zoom * f));
  const ratio = nz / state.zoom;
  // mantém o ponto sob o cursor no mesmo lugar
  const px = canvas.scrollLeft + cx, py = canvas.scrollTop + cy;
  state.zoom = nz;
  sizeDiagram();
  canvas.scrollLeft = px * ratio - cx;
  canvas.scrollTop = py * ratio - cy;
}
function setupCanvas() {
  const canvas = $('#canvas');
  // roda do mouse rola normalmente; Ctrl + roda faz zoom
  canvas.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // arrastar com o mouse continua disponível (exceto sobre as barras de rolagem)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect();
    if (e.clientX - r.left >= canvas.clientWidth || e.clientY - r.top >= canvas.clientHeight) return;
    drag = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop };
    canvas.classList.add('grabbing'); canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    canvas.scrollLeft = drag.sl - (e.clientX - drag.x);
    canvas.scrollTop = drag.st - (e.clientY - drag.y);
  });
  const end = () => { drag = null; canvas.classList.remove('grabbing'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => fit());
  $('#zoomIn').onclick = () => zoomBy(1.2);
  $('#zoomOut').onclick = () => zoomBy(1 / 1.2);
  $('#zoomFit').onclick = fit;
  window.addEventListener('resize', () => !$('#resultView').hidden && state.tab === 'visual' && fit());
}

// ================================================================ editor
let editTimer;
function onCodeEdit() {
  if (prefs.level === 'resumido' && !manualVisual()) return;
  clearTimeout(editTimer);
  $('#codeStatus').textContent = 'Verificando…';
  $('#codeStatus').className = 'status';
  editTimer = setTimeout(async () => {
    const code = $('#codeEditor').value;
    const ok = await isValid(await loadMermaid(), code);
    $('#codeStatus').textContent = ok.valid ? '✓ Sintaxe válida — salvo' : '✗ ' + ok.error.split('\n')[0].slice(0, 90);
    $('#codeStatus').className = 'status ' + (ok.valid ? 'ok' : 'bad');
    if (ok.valid && state.current) {
      state.current.code = code;
      if (manualVisual()) { delete state.current.visual; toast('O código foi alterado: o desenho manual deu lugar ao layout automático.', 5000); }
      updateItem(state.current.id, { code, visual: state.current.visual || null });
      state.view = computeView(code);
      renderHeader();
      renderDiagram(false);
    }
  }, 600);
}

// ================================================================ aba Análise
/** problemas de validação do servidor + checagem visual do desenho atual (sobreposição e setas atravessando blocos) */
function allIssues(item) {
  const list = [...(item.issues || [])];
  try { list.push(...visualIssues(displayModel())); } catch (e) { console.warn(e); }
  return list;
}
function visualIssues(model) {
  const out = [];
  if (!model?.nodes) return out;
  const boxes = model.nodes.filter((n) => n.shape !== 'container' && !n.band);
  const hit = (a, b, pad = 2) => a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
  let overl = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) overl++;
  if (overl) out.push({ level: 'erro', message: `${overl} par(es) de caixas sobrepostas no desenho.` });
  let through = 0;
  for (const e of model.edges || []) {
    let pts; try { pts = routeEdge(model, e); } catch { continue; }
    if (!pts || pts.length < 2) continue;
    for (const n of boxes) {
      if (n.id === e.from || n.id === e.to) continue;
      const inside = pts.some((p, k) => k > 0 && segHits(pts[k - 1], p, n));
      if (inside) { through++; break; }
    }
  }
  if (through) out.push({ level: 'aviso', message: `${through} seta(s) passam por cima de outra caixa no desenho automático.` });
  return out;
}
function segHits(a, b, n) {
  const m = 3, x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  return x2 > n.x + m && x1 < n.x + n.w - m && y2 > n.y + m && y1 < n.y + n.h - m;
}
function validationList(item) {
  const issues = allIssues(item);
  if (!issues.length) return '<ul class="checks"><li class="ok"><span class="ic">✓</span><span>Nenhum problema encontrado: estrutura completa, decisões com saídas identificadas e desenho sem sobreposições.</span><span class="pen"></span></li></ul>';
  const icon = { erro: '!', aviso: '?', 'interpretação': 'i', corrigido: '✓' };
  const cls = { erro: 'bad', aviso: 'warn', 'interpretação': 'info', corrigido: 'ok' };
  const name = { erro: 'Erro', aviso: 'Atenção', 'interpretação': 'Interpretação', corrigido: 'Corrigido automaticamente' };
  const order = ['erro', 'aviso', 'interpretação', 'corrigido'];
  return `<ul class="checks issues">${issues.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)).map((i) =>
    `<li class="${cls[i.level] || 'info'}"><span class="ic">${icon[i.level] || 'i'}</span><span><small>${esc(name[i.level] || i.level)}</small>${esc(i.message)}</span><span class="pen"></span></li>`).join('')}</ul>`;
}

function renderAnalysis() {
  const item = state.current, a = state.view.analysis;
  const ringColor = { great: '#1e9a73', good: '#2f7fc1', fair: '#e0a106', poor: '#c0392b' }[a.tone];
  const src = { pdf: 'PDF local', text: 'Arquivo de texto', url: 'PDF por link', web: 'Página web' }[item.sourceType] || 'Documento';
  const engine = item.provider === 'regras' ? 'Regras (sem IA, local)' : `${MODE_NAMES[item.provider]} · ${item.model || ''}`;
  const diamond = '<svg viewBox="0 0 24 24"><path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/></svg>';

  $('#analysisPane').innerHTML = `
    <div class="a-card">
      <h3>Qualidade do fluxograma</h3>
      <p>Verificações automáticas de estrutura e legibilidade.</p>
      <div class="score-row">
        <div class="ring" style="--p:${a.score};--c:${ringColor}"><strong>${a.score}</strong></div>
        <div>
          <b style="font-size:20px">${esc(a.grade)}</b>
          <p class="muted" style="margin:6px 0 0;font-size:14px;line-height:1.5">
            ${a.checks.filter((c) => c.ok).length} de ${a.checks.length} verificações aprovadas.<br>
            ${plural(a.edges, 'conexão', 'conexões')} · ${plural(a.loops, 'retorno', 'retornos')} · ${plural(a.errors, 'tratamento de erro', 'tratamentos de erro')}
          </p>
        </div>
      </div>
      <ul class="checks" style="margin-top:16px">
        ${a.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span class="ic">${c.ok ? '✓' : '!'}</span>
          <span>${esc(c.label)}${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</span>
          <span class="pen">${c.penalty ? '−' + c.penalty : ''}</span></li>`).join('')}
      </ul>
    </div>
    <div class="a-card wide">
      <h3>Validação do diagrama</h3>
      <p>${item.goal ? `<b>Objetivo identificado:</b> ${esc(item.goal)}<br>` : ''}${item.auto ? `<b>Layout escolhido automaticamente:</b> ${esc(typeFull(item))}${item.autoReason ? ` — ${esc(item.autoReason)}` : ''}.<br>` : ''}Revisão lógica e estrutural feita antes de exibir (início e fim, continuidade, decisões, laços, duplicidades, omissões e sobreposições).</p>
      ${validationList(item)}
    </div>
    <div class="a-card">
      <h3>Decisões mapeadas</h3>
      <p>${a.decisions ? `${plural(a.decisions, 'ponto de decisão identificado', 'pontos de decisão identificados')} no documento.` : 'Nenhuma decisão encontrada — o processo é sequencial.'}</p>
      <ul class="decisions">
        ${a.decisionList.map((d) => `<li><div class="q">${diamond}<span>${esc(d.question)}</span></div>
          <div class="br">${d.branches.map((b) => `<span><b>${esc(b.label)}</b> → ${esc(b.to.slice(0, 60))}</span>`).join('')}</div></li>`).join('')}
      </ul>
    </div>
    ${itemType(item) === 'raias' ? lanesCard(item) : ''}
    <div class="a-card wide">
      <h3>Sobre o documento</h3>
      <p>Informações da geração.</p>
      <dl class="kv">
        <dt>Origem</dt><dd>${esc(src)} — ${esc(item.sourceName || '')}</dd>
        <dt>Páginas</dt><dd>${item.pages ?? '—'}</dd>
        <dt>Palavras lidas</dt><dd>${item.words ? item.words.toLocaleString('pt-BR') : '—'}</dd>
        <dt>Motor</dt><dd>${esc(engine)}</dd>
        ${item.warning ? `<dt>Observação</dt><dd class="muted">${esc(item.warning)}</dd>` : ''}
        <dt>Tempo de geração</dt><dd>${item.durationMs ? (item.durationMs / 1000).toFixed(1).replace('.', ',') + ' s' : '—'}</dd>
        <dt>Nível resumido</dt><dd>${state.view.merged ? `${plural(state.view.merged, 'etapa agrupada', 'etapas agrupadas')} em sequências lineares` : 'igual ao completo'}</dd>
        <dt>Criado em</dt><dd>${new Date(item.createdAt).toLocaleString('pt-BR')}</dd>
      </dl>
      <div class="a-actions">
        <button class="btn-outline sm" id="btnRegen">↻ Gerar novamente</button>
        ${item.provider === 'regras' ? '<button class="btn-outline sm" data-open-settings>Conectar uma IA</button>' : ''}
      </div>
    </div>`;
  $('#btnRegen').onclick = regenerate;
  if (itemType(item) === 'raias') bindLanesCard(item);
}

// ---------------------------------------------------------------- Funcional: responsáveis (raias)
const GENERIC_LANE = 'Responsável não especificado';
function lanesCard(item) {
  const info = laneInfo(item.code);
  if (!info.lanes.length) return '';
  const generic = info.lanes.some((l) => l.title === GENERIC_LANE);
  const acts = info.lanes.flatMap((l) => l.nodes.filter((n) => !/^(INICIO|FIM\w*)$/.test(n.id) && !/^N\d/.test(n.id)).map((n) => ({ ...n, lane: l.id })));
  const opts = (sel) => info.lanes.map((l) => `<option value="${esc(l.id)}"${l.id === sel ? ' selected' : ''}>${esc(l.title)}</option>`).join('') + '<option value="novo">+ Nova raia…</option>';
  return `<div class="a-card wide" id="lanesCard">
      <h3>Responsáveis (raias)</h3>
      <p>${plural(info.lanes.length, 'raia', 'raias')} · ${plural(info.handoffs.length, 'transferência de responsabilidade', 'transferências de responsabilidade')}${info.stages.length ? ` · ${plural(info.stages.length, 'etapa', 'etapas')} (faixas)` : ''}.
        ${generic ? '<br><b>O documento não diz quem executa algumas atividades.</b> Nada foi inventado: elas estão em “' + GENERIC_LANE + '”. Dê um nome à raia ou mova as atividades para os responsáveis certos.'
          : info.lanes.length === 1 ? '<br>Só um responsável foi identificado. Se outras pessoas ou áreas participam, mova as atividades para uma nova raia.' : ''}</p>
      <div class="lane-names">${info.lanes.map((l) => `<label>Raia <input data-lane="${esc(l.id)}" value="${esc(l.title)}" maxlength="60"></label>`).join('')}</div>
      <details class="lane-acts"${generic || info.lanes.length === 1 ? ' open' : ''}><summary>Atividades e responsáveis (${acts.length})</summary>
        <table>${acts.map((a) => `<tr><td>${esc(a.label)}</td><td><select data-act="${esc(a.id)}">${opts(a.lane)}</select>
          <input class="new-lane" data-new="${esc(a.id)}" placeholder="Nome da nova raia" hidden maxlength="60"></td></tr>`).join('')}</table>
      </details>
      <div class="a-actions"><button class="btn-outline sm" id="btnLanes">Aplicar responsáveis</button></div>
      ${functionalChecksHtml(item)}
    </div>`;
}
// validação do Funcional (14 verificações feitas no servidor) e como cada informação do documento foi tratada
function functionalChecksHtml(item) {
  const f = item.functional;
  if (!f?.checks?.length) return '';
  const count = (f.content || []).reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
  const asNotes = (count['recomendação'] || 0) + (count['observação'] || 0) + (count['resultado'] || 0);
  const parts = [
    count['obrigatória'] ? plural(count['obrigatória'], 'atividade', 'atividades') : '',
    count['entrada/saída'] ? plural(count['entrada/saída'], 'entrada/saída de informação', 'entradas/saídas de informação') : '',
    count['opcional'] ? plural(count['opcional'], 'atividade opcional (escolha)', 'atividades opcionais (escolha)') : '',
    (count['condicional'] || 0) + (count['decisão'] || 0) ? plural((count['condicional'] || 0) + (count['decisão'] || 0), 'condição/decisão', 'condições/decisões') : '',
    asNotes ? plural(asNotes, 'recomendação/observação virou nota', 'recomendações/observações viraram notas') : '',
    count['pré-requisito'] ? plural(count['pré-requisito'], 'pré-requisito', 'pré-requisitos') : '',
    count['explicativa'] ? plural(count['explicativa'], 'frase explicativa fora do fluxo', 'frases explicativas fora do fluxo') : '',
  ].filter(Boolean);
  return `<details class="lane-acts f-checks"${f.checks.some((c) => !c.ok) ? ' open' : ''}><summary>Validação do Funcional (${f.checks.filter((c) => c.ok).length}/${f.checks.length})</summary>
      ${parts.length ? `<p class="muted" style="margin:6px 0 10px;font-size:13px">Documento classificado: ${esc(parts.join(' · '))}.</p>` : ''}
      <ul class="checks">${f.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span class="ic">${c.ok ? '✓' : '!'}</span><span>${esc(c.label)}${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</span><span class="pen"></span></li>`).join('')}</ul>
      ${(f.decisions || []).length ? `<p style="margin:12px 0 4px;font-weight:600;font-size:13px">Decisões interpretadas</p>
      <ul class="dec-sem" style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">${f.decisions.map((d) => `<li><b>${esc(d.label)}</b> <span class="muted">(${esc(d.kind === 'automatizada' ? 'decisão automática' : d.kind === 'humana' ? 'decisão humana' : 'decisão')}${d.lane ? ' · ' + esc(d.lane) : ''})</span><br>${d.outcomes.map((o) => `${esc(o.answer || '—')} = ${esc(o.kind)} → ${esc(o.to)}`).join(' · ')}</li>`).join('')}</ul>` : ''}
    </details>`;
}
function bindLanesCard(item) {
  const card = $('#lanesCard');
  if (!card) return;
  card.querySelectorAll('select[data-act]').forEach((sel) => { sel.onchange = () => { card.querySelector(`input[data-new="${sel.dataset.act}"]`).hidden = sel.value !== 'novo'; }; });
  $('#btnLanes').onclick = async () => {
    const info = laneInfo(item.code);
    const rename = {}, move = {};
    card.querySelectorAll('input[data-lane]').forEach((i) => { const l = info.lanes.find((x) => x.id === i.dataset.lane); if (l && i.value.trim() && i.value.trim() !== l.title) rename[l.id] = i.value.trim(); });
    card.querySelectorAll('select[data-act]').forEach((sel) => {
      const from = info.lanes.find((l) => l.nodes.some((n) => n.id === sel.dataset.act))?.id;
      if (sel.value === 'novo') { const nm = card.querySelector(`input[data-new="${sel.dataset.act}"]`).value.trim(); if (nm) move[sel.dataset.act] = 'novo:' + nm; }
      else if (sel.value !== from) move[sel.dataset.act] = sel.value;
    });
    if (!Object.keys(rename).length && !Object.keys(move).length) { toast('Nada mudou nas raias.'); return; }
    const code = applyLaneEdits(item.code, { rename, move });
    Object.assign(item, { code, visual: null });
    updateItem(item.id, { code, visual: null });
    await openItem(item);
    setTab('analysis');
    toast('Responsáveis atualizados.');
  };
}

async function regenerate() {
  const src = state.lastSource;
  if (!src || src.title !== state.current?.title && src.sourceName !== state.current?.sourceName) {
    toast('Para gerar novamente, envie o documento outra vez (o texto original não fica guardado no histórico).', 5500);
    return;
  }
  const item = state.current;
  showHome();
  setBusy(true);
  try {
    const fresh = await generateAndValidate(src, loadMermaid(), undefined, item.auto ? 'auto' : itemType(item));
    delete item.visual;
    Object.assign(item, { visual: null, code: fresh.code, warning: fresh.warning, provider: fresh.provider, model: fresh.model, durationMs: fresh.durationMs,
      type: fresh.type, auto: fresh.auto, autoReason: fresh.autoReason, issues: fresh.issues, structure: fresh.structure, goal: fresh.goal, functional: fresh.functional });
    updateItem(item.id, item);
    await openItem(item);
  } catch (e) {
    toast('⚠️ ' + e.message, 6000);
    await openItem(item);
  } finally { setBusy(false); }
}

// ================================================================ exportação
function svgString(el) {
  const clone = el.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('style');
  const vb = el.viewBox.baseVal;
  if (vb?.width) { clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height); }
  return new XMLSerializer().serializeToString(clone);
}

async function exportAs(kind) {
  const item = state.current;
  if (!item) return;
  const model = displayModel();
  const manual = !!model;
  const name = slug(item.title) + (manualVisual() ? '-editado' : prefs.level === 'resumido' ? '-resumido' : '');
  const code = styledCode(manual ? item.code : levelCode());
  const svgEl = $('#diagram svg');
  // desenho editado à mão: exporta exatamente o que está na tela (mesmo modelo, fundo branco)
  const manualSvg = () => renderSVG(model, { labelBorder: editorDefaults().labelBorder, background: '#ffffff' });
  try {
    if (kind === 'mmd') return download(name + '.mmd', code, 'text/plain');
    if (!svgEl) throw new Error('o fluxograma ainda não foi desenhado');
    if (kind === 'svg') return download(name + '.svg', manual ? manualSvg() : svgString(svgEl), 'image/svg+xml');
    if (kind === 'html') {
      const a = state.view.analysis;
      const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(item.title)}</title>
<style>
body{margin:0;font-family:"Segoe UI",system-ui,Arial,sans-serif;background:#f6f9fb;color:#14213b}
header{padding:28px 40px;background:#fff;border-bottom:1px solid #dde6ed}
.eb{font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1d7187;margin:0 0 8px}
h1{margin:0;font:400 34px/1.15 Georgia,serif}
.sub{margin:8px 0 0;color:#637387}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.chips span{background:#e8f4f6;color:#17687f;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:600}
.wrap{padding:32px 40px;overflow:auto}.card{background:#fff;border:1px solid #dde6ed;border-radius:18px;padding:28px;display:inline-block;min-width:calc(100% - 60px);text-align:center}
.card svg{max-width:100%;height:auto}
details{margin:0 40px 40px;font-size:14px}pre{background:#fff;border:1px solid #dde6ed;border-radius:12px;padding:16px;overflow:auto}
@media print{details{display:none}.wrap{padding:0}.card{border:0}}
</style></head><body>
<header><p class="eb">Fluxograma</p><h1>${esc(item.title)}</h1>
<p class="sub">${esc(a.flowType)} · gerado em ${new Date().toLocaleString('pt-BR')}</p>
<div class="chips"><span>${plural(a.elements, 'elemento', 'elementos')}</span><span>${plural(a.decisions, 'decisão', 'decisões')}</span><span>Qualidade ${a.score} · ${esc(a.grade)}</span><span>${manualVisual() ? 'Editado à mão' : TYPES[itemType(item)].name + ' · nível ' + prefs.level}</span></div></header>
<div class="wrap"><div class="card">${manual ? manualSvg() : svgString(svgEl)}</div></div>
<details><summary>Código Mermaid</summary><pre>${esc(code)}</pre></details>
</body></html>`;
      return download(name + '.html', html, 'text/html');
    }
    if (kind === 'png' && manual) {
      const holder = document.createElement('div');
      holder.innerHTML = manualSvg();
      const el = holder.querySelector('svg');
      const vb = el.viewBox.baseVal;
      const scale = 2;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(manualSvg());
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.ceil(vb.width * scale); c.height = Math.ceil(vb.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toBlob((b) => download(name + '.png', b), 'image/png');
    }
    if (kind === 'png') {
      // rótulos sem HTML para o canvas não ficar "contaminado"
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render('png' + Date.now(), '%%{init: {"flowchart": {"htmlLabels": false}}}%%\n' + code);
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-100000px;top:0;';
      holder.innerHTML = svg;
      document.body.appendChild(holder);
      const el = holder.querySelector('svg');
      decorateSvg(el);
      const vb0 = el.viewBox.baseVal;
      el.setAttribute('width', vb0.width); el.setAttribute('height', vb0.height);
      el.style.cssText = 'max-width:none;width:auto;height:auto';
      applyRouting(el, code);
      holder.remove();
      const vb = el.viewBox.baseVal;
      const scale = 2, pad = 40;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.ceil(vb.width * scale) + pad * 2; c.height = Math.ceil(vb.height * scale) + pad * 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, pad, pad, vb.width * scale, vb.height * scale);
      c.toBlob((b) => download(name + '.png', b), 'image/png');
    }
  } catch (e) {
    toast('⚠️ Falha ao exportar: ' + e.message, 5000);
  }
}

// ================================================================ histórico (localStorage)
const loadHistory = () => safeJSON(localStorage.getItem(STORE_KEY), []);
function saveHistory(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
  catch { toast('O armazenamento do navegador está cheio — exclua fluxogramas antigos.'); }
}
function saveItem(item) { const l = loadHistory(); l.unshift(item); saveHistory(l); }
function updateItem(id, patch) {
  const l = loadHistory();
  const i = l.findIndex((x) => x.id === id);
  if (i >= 0) { Object.assign(l[i], patch); saveHistory(l); }
}
function deleteItem(id) {
  saveHistory(loadHistory().filter((x) => x.id !== id));
  if (state.current?.id === id) showHome();
  renderHistory();
}

const ICONS = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 17v4.5M8.5 3h7l-1 6.2 3.5 3.3V15H6v-2.5l3.5-3.3z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
};
const SOURCE_LABEL = { pdf: 'PDF local', url: 'PDF por link', web: 'Página web', text: 'Texto' };

function renderHistory() {
  const q = $('#search').value.trim().toLowerCase();
  const all = loadHistory();
  const list = all.filter((x) => !q || x.title.toLowerCase().includes(q) || (x.code || '').toLowerCase().includes(q));
  $('#historyCount').textContent = q
    ? `${plural(list.length, 'resultado', 'resultados')} para "${$('#search').value.trim()}"`
    : plural(all.length, 'fluxograma salvo', 'fluxogramas salvos');
  const box = $('#historyList');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="h-empty">${all.length ? 'Nenhum fluxograma encontrado.' : 'Os fluxogramas gerados aparecem aqui.<br>Envie um PDF para começar.'}</div>`;
    return;
  }
  const groups = [
    ['Fixados', ICONS.pin, list.filter((x) => x.pinned)],
    ['Recentes', ICONS.clock, list.filter((x) => !x.pinned)],
  ];
  for (const [label, icon, items] of groups) {
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'h-group';
    h.innerHTML = icon + label;
    box.appendChild(h);
    for (const it of items) box.appendChild(historyRow(it));
  }
}

function historyRow(it) {
  const row = document.createElement('div');
  row.className = 'h-item' + (it.pinned ? ' pinned' : '') + (state.current?.id === it.id ? ' active' : '');
  row.innerHTML = `
    <button class="h-main" title="${esc(it.title)}">
      <span class="h-title">${esc(it.title)}<span class="h-type">${esc(TYPES[itemType(it)].name)}</span></span>
      <span class="h-meta">${esc(SOURCE_LABEL[it.sourceType] || 'PDF local')} · ${fmtDate(it.createdAt)}</span>
    </button>
    <span class="h-actions">
      <button class="pin" title="${it.pinned ? 'Desafixar' : 'Fixar'}" aria-label="${it.pinned ? 'Desafixar' : 'Fixar'}">${ICONS.pin}</button>
      <button class="ren" title="Renomear" aria-label="Renomear">${ICONS.edit}</button>
      <button class="del" title="Excluir" aria-label="Excluir">${ICONS.del}</button>
    </span>`;
  $('.h-main', row).onclick = () => { const x = loadHistory().find((y) => y.id === it.id); if (x) { closeSidebar(); openItem(x); } };
  $('.pin', row).onclick = () => {
    updateItem(it.id, { pinned: !it.pinned });
    if (state.current?.id === it.id) state.current.pinned = !it.pinned;
    toast(it.pinned ? 'Fluxograma desafixado.' : '📌 Fluxograma fixado no topo.');
    renderHistory();
  };
  $('.ren', row).onclick = () => startRename(row, it);
  $('.del', row).onclick = () => confirmDelete(row, it);
  return row;
}

function confirmDelete(row, it) {
  row.innerHTML = `<div class="h-confirm"><span>Excluir “${esc(it.title)}”?</span>
    <button class="no" type="button">Cancelar</button><button class="yes" type="button">Excluir</button></div>`;
  $('.no', row).onclick = renderHistory;
  $('.yes', row).onclick = () => { deleteItem(it.id); toast('Fluxograma excluído.'); };
  $('.yes', row).focus();
}

function startRename(row, it) {
  const input = document.createElement('input');
  input.value = it.title;
  input.setAttribute('aria-label', 'Novo nome');
  row.replaceChildren(input);
  input.focus(); input.select();
  let done = false;
  const commit = (save) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (save && v && v !== it.title) {
      updateItem(it.id, { title: v });
      if (state.current?.id === it.id) { state.current.title = v; $('#resultTitle').textContent = v; }
    }
    renderHistory();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
  input.onblur = () => commit(true);
}

function setupTitleRename() {
  const el = $('#resultTitle');
  el.onclick = () => {
    if (el.isContentEditable) return;
    el.contentEditable = 'true'; el.focus();
    document.getSelection().selectAllChildren(el);
  };
  el.onblur = () => {
    el.contentEditable = 'false';
    const v = el.textContent.trim();
    if (state.current && v && v !== state.current.title) {
      state.current.title = v; updateItem(state.current.id, { title: v }); renderHistory();
    } else if (state.current) el.textContent = state.current.title;
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = state.current?.title || ''; el.blur(); }
  };
}

// ================================================================ gaveta
function openSidebar() {
  document.body.classList.add('sidebar-open');
  $('#sidebar').setAttribute('aria-hidden', 'false');
  renderHistory();
  setTimeout(() => $('#search').focus(), 200);
}
function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  $('#sidebar').setAttribute('aria-hidden', 'true');
}

// ================================================================ status e configurações
async function refreshStatus() {
  // o status do motor roda em silêncio: só um pontinho discreto na engrenagem
  const dot = $('#engineDot');
  try {
    const st = await api('/api/status');
    state.status = st;
    dot.className = 'gear-dot ' + (st.provider === 'regras' ? 'idle' : 'ok');
    $('#btnSettings').title = 'Configurações · ' + engineName(st);
    $('#brandSub').textContent = st.local ? 'Processamento local' : 'Servidor local · IA na nuvem';
    $('#step2Label').textContent = st.local ? 'Análise local' : 'Análise com IA';
    const note = $('#privacyNote');
    note.classList.toggle('cloud', !st.local);
    $('#privacyText').textContent = st.local
      ? 'Arquivos locais permanecem no computador.'
      : `O texto extraído é enviado à API (${MODE_NAMES[st.provider]}) para análise.`;
    return st;
  } catch {
    dot.className = 'gear-dot bad';
    $('#btnSettings').title = 'Configurações · servidor local desconectado';
    return null;
  }
}

/** Nome curto do motor em uso */
function engineName(st) {
  if (!st) return 'desconectado';
  return st.provider === 'regras' ? 'Regras (sem IA)' : `${MODE_NAMES[st.provider]} · ${st.model}`;
}

/** Indicador discreto: bolinha colorida + texto curto (detalhes no title) */
function setChip(el, tone, text, title = '') {
  if (!el) return;
  el.className = 'chip ' + tone;
  el.querySelector('span').textContent = text;
  el.title = title;
}

const hasKey = (name) => {
  const v = $('#settingsForm').elements[name]?.value.trim();
  return !!v;
};

async function checkOllama(useForm = false) {
  const chip = $('#ollamaChip');
  setChip(chip, 'wait', 'Verificando…');
  let o;
  try { o = await api('/api/ollama', useForm ? { url: $('#settingsForm').elements.ollamaUrl.value.trim() } : {}); } catch { o = { running: false, models: [] }; }
  state.ollama = o;
  $('#ollamaModels').innerHTML = (o.models || []).map((m) => `<option value="${esc(m)}">`).join('');
  if (!o.running) setChip(chip, 'off', 'Não encontrado', 'O Ollama não respondeu neste endereço.');
  else if (!o.models.length) setChip(chip, 'warn', 'Sem modelos', 'Rode no terminal: ollama pull llama3.1');
  else setChip(chip, 'ok', `Conectado · ${plural(o.models.length, 'modelo', 'modelos')}`, o.models.join(', '));
  renderAutoStatus();
  return o;
}

function renderAutoStatus() {
  const o = state.ollama;
  const row = (tone, name, txt) => `<li class="${tone}"><i></i><b>${name}</b><span>${txt}</span></li>`;
  $('#autoStatus').innerHTML = [
    row(hasKey('anthropicKey') ? 'ok' : 'off', 'Claude', hasKey('anthropicKey') ? 'chave salva' : 'sem chave'),
    row(hasKey('openaiKey') ? 'ok' : 'off', 'OpenAI', hasKey('openaiKey') ? 'chave salva' : 'sem chave'),
    row(!o ? 'wait' : o.running && o.models.length ? 'ok' : 'off', 'Ollama', !o ? 'verificando…' : o.running ? (o.models.length ? plural(o.models.length, 'modelo', 'modelos') : 'sem modelos') : 'não encontrado'),
    row('ok', 'Regras', 'sempre disponível'),
  ].join('');
}

/** Mostra só os campos do provedor escolhido */
function showProvider() {
  const prov = $('#providerSelect').value;
  for (const pnl of $$('#settings .prov-panel')) pnl.hidden = pnl.dataset.prov !== prov;
  for (const chip of $$('#settings [data-key-chip]')) {
    const ok = hasKey(chip.dataset.keyChip);
    setChip(chip, ok ? 'ok' : 'off', ok ? 'Chave informada' : 'Sem chave', ok ? '' : 'Sem chave, o modo Regras é usado.');
  }
  if (prov === 'auto') renderAutoStatus();
  if ((prov === 'ollama' || prov === 'auto') && !state.ollama) checkOllama();
}

async function openSettings() {
  try { state.config = await api('/api/config'); } catch (e) { return toast('⚠️ ' + e.message); }
  const f = $('#settingsForm');
  const c = state.config;
  for (const el of f.elements) {
    if (!el.name) continue;
    el.value = (el.name === 'provider' && c.provider === 'offline') ? 'regras' : (c[el.name] ?? '');
  }
  state.ollama = null;
  for (const d of f.querySelectorAll('details')) d.open = false;
  showProvider();
  $('#settings').showModal();
  const st = await refreshStatus();
  setChip($('#engineChip'), !st ? 'bad' : st.provider === 'regras' ? 'idle' : 'ok', !st ? 'Desconectado' : 'Em uso: ' + engineName(st), st?.label || '');
}

async function saveSettings() {
  const patch = {};
  for (const el of $('#settingsForm').elements) if (el.name) patch[el.name] = el.value.trim();
  try {
    state.config = await api('/api/config', patch);
    applyMermaidTheme();
    if (state.current) await renderDiagram(true);
    const st = await refreshStatus();
    toast('✓ Configurações salvas — ' + (st?.label || ''));
  } catch (e) { toast('⚠️ ' + e.message); }
}

// ================================================================ inicialização
function init() {
  initTypePicker();
  // versão do app (⚙️ Configurações e dica no logotipo): confirma que a versão aberta é a nova
  api('/api/version').then((v) => {
    const txt = `versão ${v.version}${v.build ? ' · ' + v.build.split('-').reverse().join('/') : ''}`;
    $('#appVersion').textContent = txt;
    $('#brandHome').title = 'PDF para Fluxograma · ' + txt;
  }).catch(() => {});
  // envio de arquivo
  const dz = $('#dropzone');
  const pick = () => { if (!state.busy) $('#fileInput').click(); };
  dz.addEventListener('click', pick);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  $('#fileInput').onchange = (e) => runFromFile(e.target.files[0]);
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; if (!$('#homeView').hidden && !state.busy) dz.classList.add('drag'); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove('drag'); } });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; dz.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) runFromFile(f);
  });
  $('#urlForm').onsubmit = (e) => { e.preventDefault(); runFromUrl($('#urlInput').value.trim()); };

  // navegação
  $('#btnMenu').onclick = openSidebar;
  $('#btnCloseSidebar').onclick = closeSidebar;
  $('#scrim').onclick = closeSidebar;
  $('#btnNew').onclick = () => { closeSidebar(); showHome(); };
  $('#btnBack').onclick = showHome;
  $('#brandHome').onclick = (e) => { e.preventDefault(); if (!state.busy) showHome(); };
  $('#search').oninput = renderHistory;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSidebar(); $('#exportMenu').hidden = true; } });
  // modo de edição
  $('#btnEdit').onclick = startEdit;
  $('#veSave').onclick = saveEdit;
  $('#veCancel').onclick = cancelEdit;
  $('#veUndo').onclick = () => state.edit?.editor.undo();
  $('#veRedo').onclick = () => state.edit?.editor.redo();
  $('#veZoomIn').onclick = () => state.edit?.editor.zoomIn();
  $('#veZoomOut').onclick = () => state.edit?.editor.zoomOut();
  $('#veFit').onclick = () => state.edit?.editor.fit();
  $('#veDelete').onclick = () => state.edit?.editor.deleteSelection();
  $('#btnAutoLayout').onclick = () => dropVisual(true);
  document.addEventListener('keydown', (e) => {
    if (!state.edit) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveEdit(); }
  });
  window.addEventListener('beforeunload', (e) => { if (state.edit?.editor?.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // resultado
  $$('.tab').forEach((t) => (t.onclick = () => setTab(t.dataset.tab)));
  $$('#levelSeg button').forEach((b) => (b.onclick = () => setLevel(b.dataset.level)));
  $('#codeEditor').addEventListener('input', onCodeEdit);
  $('#codeEditor').addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.target.readOnly) { e.preventDefault(); document.execCommand('insertText', false, '    '); }
  });
  $('#btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#codeEditor').value); toast('Código copiado.'); }
    catch { $('#codeEditor').select(); document.execCommand('copy'); toast('Código copiado.'); }
  };
  $('#btnExport').onclick = (e) => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; };
  document.addEventListener('click', (e) => {
    $('#exportMenu').hidden = true;
    if (e.target.closest('[data-open-settings]')) openSettings();
  });
  $$('#exportMenu button').forEach((b) => (b.onclick = () => exportAs(b.dataset.export)));
  setupCanvas();
  setupTitleRename();

  // configurações
  $('#btnSettings').onclick = openSettings;
  $('#providerSelect').addEventListener('change', showProvider);
  $('#settingsForm').addEventListener('input', (e) => { if (/Key$/.test(e.target.name)) showProvider(); });
  $('#ollamaTest').onclick = () => checkOllama(true);
  $('#settings').addEventListener('close', () => { if ($('#settings').returnValue === 'save') saveSettings(); });

  renderHistory();
  refreshStatus();
  api('/api/config').then((c) => { state.config = c; applyMermaidTheme(); }).catch(() => {});
  window.addEventListener('focus', refreshStatus);
  loadMermaid().catch(() => {});
  loadPdfjs().catch(() => {});
}

init();
