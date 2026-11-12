#!/usr/bin/env node
'use strict';

/**
 * Gerador Inteligente de Fluxogramas a partir de PDFs
 * Servidor local — sem dependências externas (apenas Node.js 18+).
 *
 *   node server.js        → abre http://localhost:3210 no navegador
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { detectStatus, probeOllama, generateWithAI, repairWithAI } = require('./lib/ai');
const { sanitizeMermaid } = require('./lib/sanitize');
const { heuristicMermaid, TYPES } = require('./lib/heuristic');
const { mergeAlternativeSteps } = require('./lib/coherence');
const { fixLanes } = require('./lib/lanes');
const { chooseType, finalize, summary } = require('./lib/pipeline');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const VENDOR = path.join(PUBLIC, 'vendor');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PORT = Number(process.env.PORT) || 3210;
// versão do app: aparece em ⚙️ Configurações e nesta janela; serve para não abrir uma versão antiga por engano
const VERSION = require('./package.json').version;
const BUILD = require('./package.json').build || '';
const APP_DIR = __dirname;
const HOST = '127.0.0.1'; // só aceita conexões desta máquina

// ---------------------------------------------------------------- config
const DEFAULT_CONFIG = {
  provider: 'auto',            // auto | ollama | anthropic | openai | regras
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-5-5',
  openaiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  direction: 'TD',
  visualStyle: 'classico',     // classico (cinza) | azul (corporativo) | moderno (colorido)
  maxChars: 0,
  urlAuthToken: '',            // token opcional p/ importar URLs do Confluence
};

function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { /* primeiro uso */ }
  // variáveis de ambiente têm prioridade
  if (process.env.ANTHROPIC_API_KEY) cfg.anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) cfg.openaiKey = process.env.OPENAI_API_KEY;
  return cfg;
}

function saveConfig(patch) {
  const current = loadConfig();
  const next = { ...current };
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (!(k in patch)) continue;
    // campos secretos vazios/mascarados não sobrescrevem o valor salvo
    if (/Key$|Token$/.test(k) && (patch[k] === undefined || /^•+/.test(patch[k]))) continue;
    next[k] = patch[k];
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

function mask(v) { return v ? '••••••••' + String(v).slice(-4) : ''; }

function publicConfig(cfg) {
  return {
    ...cfg,
    anthropicKey: mask(cfg.anthropicKey),
    openaiKey: mask(cfg.openaiKey),
    urlAuthToken: mask(cfg.urlAuthToken),
  };
}

// ---------------------------------------------------------------- bibliotecas locais
const VENDOR_FILES = [
  {
    name: 'mermaid.min.js',
    urls: [
      'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js',
      'https://unpkg.com/mermaid@11.16.1/dist/mermaid.min.js',
    ],
  },
  {
    name: 'pdf.min.mjs',
    urls: [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs',
      'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs',
    ],
  },
  {
    name: 'pdf.worker.min.mjs',
    urls: [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs',
      'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs',
    ],
  },
];

async function ensureVendor() {
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const f of VENDOR_FILES) {
    const dest = path.join(VENDOR, f.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    let ok = false;
    for (const url of f.urls) {
      try {
        process.stdout.write(`  ↓ Baixando ${f.name} (só na primeira vez)... `);
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        console.log('ok');
        ok = true;
        break;
      } catch (e) {
        console.log('falhou (' + e.message + ')');
      }
    }
    if (!ok) console.log(`  ! ${f.name} não baixado — o navegador usará a versão online (CDN).`);
  }
}

// ---------------------------------------------------------------- utilidades HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Conteúdo muito grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Proibido' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Não encontrado' });
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const main = (html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2]
    || (html.match(/id=["']main-content["'][^>]*>([\s\S]*)/i) || [])[1]
    || html;
  const text = main
    .replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return { title: title.replace(/\s+/g, ' ').trim(), text };
}

// ---------------------------------------------------------------- API
async function apiGenerate(body) {
  const started = Date.now();
  const cfg = loadConfig();
  const text = String(body.text || '').trim();
  const title = String(body.title || 'Fluxograma').slice(0, 160);
  const direction = body.direction || cfg.direction || 'TD';
  // processo · raias · decisao · auto (o gerador escolhe o layout pela estrutura do documento)
  const auto = body.type === 'auto' || !body.type;
  const pick = auto ? chooseType(text, title) : { type: TYPES.includes(body.type) ? body.type : 'decisao', natural: false, reason: '' };
  const type = pick.type;
  if (text.length < 20) throw new Error('Não foi possível extrair texto suficiente do documento. Se o PDF for escaneado (imagem), exporte-o novamente com texto selecionável.');

  const status = body.provider === 'regras' ? { provider: 'regras', model: '' } : await detectStatus(cfg);
  // camadas 3 e 4: todo código (Regras ou IA) passa pelo modelo estruturado e pela validação antes de ir à tela
  const done = (r) => {
    const fin = finalize(r.code, { text, type, interpreted: !!(r.notes && r.notes.length), sources: r.sources, content: r.content });
    const issues = [...(r.notes || []).map((m) => ({ level: 'interpretação', message: m })), ...fin.issues];
    return { ...r, code: fin.code, type, auto, autoReason: pick.reason, issues, structure: summary(fin.model), functional: fin.functional || null, notes: undefined, sources: undefined, content: undefined, durationMs: Date.now() - started };
  };
  const viaRegras = (warning) => {
    const report = {};
    const code = heuristicMermaid(text, title, direction, type, { natural: pick.natural, report });
    return done({ code: auto ? code.replace(/^(%% tipo: \w+)/, `$1\n%% modo: automático`) : code, provider: 'regras', model: '', warning, notes: report.warnings, goal: report.goal, sources: report.sources, content: report.content });
  };

  if (status.provider === 'regras') {
    return viaRegras('');
  }
  const runCfg = { ...cfg, ollamaModel: status.provider === 'ollama' ? status.model : cfg.ollamaModel };
  try {
    const aiType = pick.natural && type === 'decisao' ? 'ramificado' : type;
    const { raw, truncated } = await generateWithAI(status.provider, runCfg, text, title, direction, aiType);
    let code = sanitizeMermaid(raw, direction);
    // etapas que a IA marcou (agrupamento secundário do Funcional) — o saneamento remove comentários antes do "flowchart"
    const aiStages = [...String(raw).matchAll(/^\s*%%\s*etapa:.*::.*$/gm)].map((m) => m[0].trim());
    if (type === 'raias' && aiStages.length >= 2) code = aiStages.join('\n') + '\n' + code;
    if (!/-->|---|-\.->|==>/.test(code)) throw new Error('a IA não retornou um fluxograma válido');
    let laneNote = '';
    if (type === 'raias') {
      // distribuição real por raias: compara com as raias do documento (modo Regras) e corrige amontoados/ordem
      const ref = heuristicMermaid(text, title, direction, 'raias').replace(/^\s*%%.*\n/gm, '');
      const fx = fixLanes(code, ref, direction);
      if (fx.fixed) { code = fx.code; laneNote = /reordenadas/.test(fx.reason) ? '' : `Raias corrigidas automaticamente (${fx.reason}).`; }
      // etapas do documento (agrupamento secundário): reaproveita as faixas do modo Regras quando os blocos têm os
      // mesmos textos — as raias continuam sendo os responsáveis
      const refFull = heuristicMermaid(text, title, direction, 'raias');
      const stageLines = [...refFull.matchAll(/^%%\s*etapa:\s*(.+?)\s*::\s*(.*)$/gm)];
      if (stageLines.length >= 2 && !/^\s*%%\s*etapa:/m.test(code)) {
        const labelOf = (src, id) => (src.match(new RegExp('\\b' + id + '\\s*[\\[({]+"?([^"\\]\\)}]+)')) || [])[1] || '';
        const norm = (x) => String(x).toLowerCase().replace(/<br\/?>.*$/, '').replace(/[^a-zà-ú0-9 ]/g, '').trim();
        const aiIds = [...code.matchAll(/^\s*([A-Za-z_][\w]*)\s*[\[({]+"?([^"\])}]+)/gm)].map((m) => [m[1], norm(m[2])]);
        const out = stageLines.map((m) => {
          const labels = new Set(m[2].trim().split(/\s+/).map((id) => norm(labelOf(refFull, id))).filter(Boolean));
          const ids = aiIds.filter(([, l]) => labels.has(l)).map(([id]) => id);
          return ids.length ? `%% etapa: ${m[1]} :: ${ids.join(' ')}` : '';
        }).filter(Boolean);
        if (out.length >= 2) code = out.join('\n') + '\n' + code;
      }
      if (!/^\s*subgraph\b/m.test(code)) throw new Error('a IA não separou as raias');
    }
    if (type === 'processo') code = mergeAlternativeSteps(flattenSubgraphs(code));   // Processo linear: fluxo contínuo; alternativas em sequência viram um passo
    code = `%% tipo: ${type}\n` + code.replace(/^\s*%%\s*tipo:.*\n/im, '');
    return done({ code, provider: status.provider, model: status.model, warning: [truncated ? 'Documento muito longo: apenas o início foi enviado à IA.' : '', laneNote].filter(Boolean).join(' ') });
  } catch (err) {
    console.error('  ! Falha na IA:', err.message);
    return viaRegras(`A IA falhou (${err.message}). Foi usado o modo Regras.`);
  }
}

async function apiRepair(body) {
  const cfg = loadConfig();
  const direction = body.direction || cfg.direction || 'TD';
  const status = await detectStatus(cfg);
  if (status.provider === 'regras') throw new Error('Sem IA configurada para corrigir.');
  const runCfg = { ...cfg, ollamaModel: status.provider === 'ollama' ? status.model : cfg.ollamaModel };
  const type = TYPES.includes(body.type) ? body.type : 'decisao';
  const raw = await repairWithAI(status.provider, runCfg, String(body.code || ''), String(body.error || ''), direction, type);
  let fixed = sanitizeMermaid(raw, direction).replace(/^\s*%%\s*tipo:.*\n/im, '');
  if (type === 'processo') fixed = mergeAlternativeSteps(flattenSubgraphs(fixed));
  return { code: `%% tipo: ${type}\n` + fixed };
}

async function apiFetchUrl(body) {
  const cfg = loadConfig();
  let url;
  try { url = new URL(String(body.url || '').trim()); } catch { throw new Error('URL inválida.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Use um link http(s).');
  const headers = { 'user-agent': 'Mozilla/5.0 FluxogramaPDF/2.0', accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8' };
  if (cfg.urlAuthToken) headers.authorization = `Bearer ${cfg.urlAuthToken}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Acesso negado ao link (requer login). Baixe o PDF e use o upload, ou informe um token em Configurações.');
    throw new Error(`Não foi possível baixar o link (HTTP ${res.status}).`);
  }
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  const name = decodeURIComponent(url.pathname.split('/').pop() || url.hostname).replace(/\.pdf$/i, '');
  if (type.includes('pdf') || buf.slice(0, 5).toString() === '%PDF-') {
    return { kind: 'pdf', base64: buf.toString('base64'), title: name };
  }
  const { title, text } = htmlToText(buf.toString('utf8'));
  if (/log ?in|entrar|sign ?in/i.test(title) && text.length < 3000) throw new Error('O link abriu uma tela de login. Exporte a página em PDF e use o upload.');
  return { kind: 'text', text, title: title || name };
}

const ROUTES = {
  'GET /api/config': async () => publicConfig(loadConfig()),
  'GET /api/status': async () => detectStatus(loadConfig()),
  'GET /api/version': async () => ({ app: 'fluxograma-pdf', version: VERSION, build: BUILD, dir: APP_DIR }),
  // uma versão nova pede para esta (antiga) sair da porta; o servidor só aceita conexões deste computador (127.0.0.1)
  'POST /api/shutdown': async () => { setTimeout(() => { console.log('\n  Uma versão mais nova do app foi aberta. Encerrando esta.'); process.exit(0); }, 150); return { ok: true }; },
  'POST /api/config': async (body) => publicConfig(saveConfig(body)),
  // estado do Ollama (para o indicador discreto nas configurações); aceita uma URL para testar antes de salvar
  'POST /api/ollama': async (body) => probeOllama({ ...loadConfig(), ...(body?.url ? { ollamaUrl: String(body.url) } : {}) }),
  'POST /api/generate': apiGenerate,
  'POST /api/repair': apiRepair,
  'POST /api/fetch-url': apiFetchUrl,
  'GET /api/vendor': async () => Object.fromEntries(VENDOR_FILES.map((f) => [f.name, fs.existsSync(path.join(VENDOR, f.name))])),
};

const server = http.createServer(async (req, res) => {
  const route = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
  const handler = ROUTES[route];
  if (!handler) {
    if (req.method === 'GET') return serveStatic(req, res);
    return send(res, 404, { error: 'Rota não encontrada' });
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await handler(body));
  } catch (err) {
    send(res, 400, { error: err.message || String(err) });
  }
});

function openBrowser(url) {
  if (process.env.NO_BROWSER) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

(async () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`Node.js 18 ou superior é necessário (você tem ${process.versions.node}). Baixe em https://nodejs.org`);
    process.exit(1);
  }
  console.log(`\n  PDF para Fluxograma — servidor local · versão ${VERSION}${BUILD ? ' (' + BUILD + ')' : ''}\n  Pasta: ${APP_DIR}\n`);
  await ensureVendor();
  const port = await choosePort(PORT);
  if (port === null) return;            // esta mesma versão já está aberta: só abriu o navegador
  server.on('error', (e) => { console.error(e); process.exit(1); });
  server.listen(port, HOST, () => {
    const url = `http://localhost:${port}`;
    const cfg = loadConfig();
    console.log(`\n  ✔ Pronto em ${url}`);
    detectStatus(cfg).then((st) => console.log(`  ✔ ${st.label}`)).catch(() => {});
    console.log('  Para encerrar, feche esta janela ou pressione Ctrl+C.\n');
    openBrowser(url);
  });
})();

/** A porta está livre? */
function portFree(port) {
  return new Promise((resolve) => {
    const t = http.createServer();
    t.once('error', () => resolve(false));
    t.once('listening', () => t.close(() => resolve(true)));
    t.listen(port, HOST);
  });
}

/**
 * Escolhe a porta sem nunca cair numa versão antiga do app:
 *  - porta livre → usa;
 *  - ocupada pela MESMA versão desta pasta → só abre o navegador nela;
 *  - ocupada por outra versão → pede para ela encerrar e assume a porta;
 *  - se a antiga não encerrar (versões antigas não sabem) → usa a próxima porta livre (3211, 3212…).
 */
async function choosePort(port) {
  if (await portFree(port)) return port;
  const base = `http://127.0.0.1:${port}`;
  let other = null;
  try { other = await (await fetch(base + '/api/version', { signal: AbortSignal.timeout(1500) })).json(); } catch { /* versão antiga ou outro programa */ }
  if (other?.app !== 'fluxograma-pdf') other = null;
  if (other?.app === 'fluxograma-pdf' && other.version === VERSION && other.build === BUILD && other.dir === APP_DIR) {
    console.log(`  Esta versão já está aberta em http://localhost:${port} — abrindo o navegador.`);
    openBrowser(`http://localhost:${port}`);
    setTimeout(() => process.exit(0), 1500);
    return null;
  }
  console.log(`  A porta ${port} está com ${other ? 'outra versão do app (' + other.version + ')' : 'uma versão antiga do app (ou outro programa)'}. Liberando…`);
  try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1500) }); } catch { /* sem suporte */ }
  for (let i = 0; i < 10; i++) { if (await portFree(port)) return port; await new Promise((r) => setTimeout(r, 250)); }
  for (let p = port + 1; p < port + 20; p++) {
    if (await portFree(p)) {
      console.log(`  ⚠ Não foi possível fechar a versão antiga. Abrindo esta versão em http://localhost:${p}`);
      console.log('    Dica: feche a janela preta da versão antiga para voltar a usar a porta padrão.');
      return p;
    }
  }
  console.error('  Nenhuma porta livre encontrada. Feche outras janelas do app e tente de novo.');
  process.exit(1);
}

/** Processo (linear): remove subgraphs/seções do código da IA, mantendo nós e setas num fluxo único */
function flattenSubgraphs(code) {
  return String(code).split('\n').filter((l) => !/^\s*(subgraph\b|end\s*$|direction\s+\w+\s*$)/.test(l)).join('\n');
}
