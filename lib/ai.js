'use strict';

/**
 * Provedores de IA suportados:
 *  - anthropic : Claude (API da Anthropic)
 *  - openai    : OpenAI ou qualquer API compatível (Azure, Groq, LM Studio...)
 *  - ollama    : modelo rodando 100% local (máxima privacidade)
 *  - offline   : sem IA, gerador heurístico interno
 */

const { buildSystemPrompt, buildUserPrompt, buildRepairPrompt } = require('./prompt');

const TIMEOUT_MS = 5 * 60 * 1000;

async function postJSON(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || data?.raw || res.statusText;
      throw new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Tempo limite excedido ao chamar a IA.');
    if (err.cause?.code === 'ECONNREFUSED') throw new Error(`Não foi possível conectar em ${url}. O serviço está rodando?`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(cfg, system, user) {
  if (!cfg.anthropicKey) throw new Error('Chave da API Anthropic não configurada.');
  const data = await postJSON('https://api.anthropic.com/v1/messages', {
    'x-api-key': cfg.anthropicKey,
    'anthropic-version': '2023-06-01',
  }, {
    model: cfg.anthropicModel || 'claude-sonnet-5-5',
    max_tokens: 8000,
    temperature: 0.2,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

async function callOpenAI(cfg, system, user) {
  const base = (cfg.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const headers = cfg.openaiKey ? { authorization: `Bearer ${cfg.openaiKey}` } : {};
  const data = await postJSON(`${base}/chat/completions`, headers, {
    model: cfg.openaiModel || 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama(cfg, system, user) {
  const base = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const data = await postJSON(`${base}/api/chat`, {}, {
    model: cfg.ollamaModel || 'llama3.1',
    stream: false,
    options: { temperature: 0.2, num_ctx: 16384 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return data.message?.content || '';
}

/* ------------------------------------------------------------------ status
 * Ordem do modo automático:
 *   1. chave do Claude configurada  → Claude
 *   2. chave da OpenAI configurada  → OpenAI
 *   3. Ollama rodando com modelo    → Ollama (100% local)
 *   4. nada disso                   → Regras (gerador local sem IA)
 */
let ollamaCache = { at: 0, url: '', data: null };

async function probeOllama(cfg) {
  const url = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  if (ollamaCache.data && ollamaCache.url === url && Date.now() - ollamaCache.at < 8000) return ollamaCache.data;
  let data;
  try {
    const res = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(1500) });
    const j = await res.json();
    data = { running: true, models: (j.models || []).map((m) => m.name) };
  } catch {
    data = { running: false, models: [] };
  }
  ollamaCache = { at: Date.now(), url, data };
  return data;
}

function pickOllamaModel(cfg, models) {
  if (!models.length) return null;
  const want = String(cfg.ollamaModel || '').trim();
  return models.find((m) => m === want)
    || models.find((m) => want && m.split(':')[0] === want.split(':')[0])
    || models[0];
}

async function detectStatus(cfg) {
  const p = cfg.provider === 'offline' ? 'regras' : (cfg.provider || 'auto');
  const regras = (label, tone = 'warn') => ({ provider: 'regras', model: '', tone, label, local: true });

  if (p === 'regras') return regras('Modo regras · 100% local', 'neutral');

  if (p === 'anthropic' || (p === 'auto' && cfg.anthropicKey)) {
    if (!cfg.anthropicKey) return regras('Claude sem chave · regras disponíveis');
    const model = cfg.anthropicModel || 'claude-sonnet-5-5';
    return { provider: 'anthropic', model, tone: 'ok', label: `Claude · ${model}`, local: false };
  }
  if (p === 'openai' || (p === 'auto' && cfg.openaiKey)) {
    if (!cfg.openaiKey && /api\.openai\.com/.test(cfg.openaiBaseUrl || 'api.openai.com')) return regras('OpenAI sem chave · regras disponíveis');
    const model = cfg.openaiModel || 'gpt-4o-mini';
    const local = /localhost|127\.0\.0\.1/.test(cfg.openaiBaseUrl || '');
    return { provider: 'openai', model, tone: 'ok', label: `${local ? 'IA local' : 'OpenAI'} · ${model}`, local };
  }
  // auto sem chaves, ou ollama explícito
  const o = await probeOllama(cfg);
  if (o.running) {
    const model = pickOllamaModel(cfg, o.models);
    if (model) return { provider: 'ollama', model, tone: 'ok', label: `Ollama · ${model}`, local: true, ollama: o };
    return { ...regras('Ollama sem modelo · regras disponíveis'), ollama: o };
  }
  return { ...regras(p === 'ollama' ? 'Ollama não encontrado · regras disponíveis' : 'Sem IA configurada · regras disponíveis'), ollama: o };
}

function maxCharsFor(provider, cfg) {
  if (cfg.maxChars) return Number(cfg.maxChars);
  return provider === 'ollama' ? 30000 : 150000;
}

async function callProvider(provider, cfg, system, user) {
  switch (provider) {
    case 'anthropic': return callAnthropic(cfg, system, user);
    case 'openai': return callOpenAI(cfg, system, user);
    case 'ollama': return callOllama(cfg, system, user);
    default: throw new Error(`Provedor desconhecido: ${provider}`);
  }
}

async function generateWithAI(provider, cfg, text, title, direction, type = 'decisao') {
  const limit = maxCharsFor(provider, cfg);
  let body = text;
  let truncated = false;
  if (body.length > limit) { body = body.slice(0, limit); truncated = true; }
  const out = await callProvider(provider, cfg, buildSystemPrompt(direction, type), buildUserPrompt(body, title, type));
  return { raw: out, truncated };
}

async function repairWithAI(provider, cfg, code, error, direction, type = 'decisao') {
  return callProvider(provider, cfg, buildSystemPrompt(direction, type), buildRepairPrompt(code, error));
}

module.exports = { detectStatus, probeOllama, generateWithAI, repairWithAI };
