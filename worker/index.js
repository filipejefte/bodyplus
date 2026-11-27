/**
 * Body+ · assistente (Cloudflare Worker)
 * ======================================
 * Guarda a chave do Gemini e repassa os pedidos do assistente da página. A
 * chave nunca vai para o navegador: ela fica como "secret" no Cloudflare
 * (npx wrangler secret put GEMINI_API_KEY).
 *
 * Recebe  POST {messages: [{role: system|user|assistant, content}], schema}
 * Devolve {texto} (o JSON que o modelo escreveu) ou {erro}.
 *
 * Proteções: só aceita os endereços de ORIGENS, limita pedidos por pessoa
 * (binding LIMITE, se existir), corta pedidos grandes e não guarda nada.
 *
 * Nuvem (/plano/<id>): guarda o plano de cada pessoa no KV (binding PLANOS).
 * Chega CIFRADO pela página, com uma chave tirada do código da pessoa: aqui só
 * passa um bloco ilegível, e o id é um hash do código (o código não chega).
 *   GET    → {dados, versao, em}           (404 se não existe)
 *   PUT    {base, dados} → {versao, em}     (409 se outro aparelho salvou antes)
 *   DELETE → {ok}
 */
import { paraGemini } from './gemini.js';

const MAX_CORPO = 150000;   // caracteres do pedido (o contexto de treinos cabe com folga)
const MAX_PLANO = 1500000;  // caracteres do plano cifrado (um plano grande comprimido fica em ~50 kB)
const MAX_MENSAGENS = 30;
// sobrecarregado, o Gemini às vezes trava em vez de dar erro: os primeiros modelos têm prazo curto
// (respondem em 1–6 s quando estão bem), o último fica com o que sobrar, e o pedido todo não passa de ESPERA_MS
const ESPERA_MS = 30000;
const ESPERA_CURTA_MS = 12000;

export default {
  async fetch(req, env) {
    const origem = req.headers.get('Origin') || '';
    const permitidas = String(env.ORIGENS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = permitidas.includes(origem) ? { 'Access-Control-Allow-Origin': origem, Vary: 'Origin' } : null;
    const responder = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(cors || {}) } });

    if (req.method === 'OPTIONS') {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } });
    }
    if (!cors) return responder(403, { erro: 'endereço não permitido' });
    const rota = new URL(req.url).pathname.match(/^\/plano\/([^/]*)$/);
    if (rota) return plano(req, env, rota[1], responder);
    if (req.method !== 'POST') return responder(405, { erro: 'use POST' });
    if (!env.GEMINI_API_KEY) return responder(500, { erro: 'a chave do Gemini não foi configurada no Worker' });

    if (env.LIMITE) {
      const { success } = await env.LIMITE.limit({ key: req.headers.get('CF-Connecting-IP') || 'sem-ip' });
      if (!success) return responder(429, { erro: 'muitas perguntas seguidas — espere um minuto' });
    }

    const bruto = await req.text();
    if (bruto.length > MAX_CORPO) return responder(413, { erro: 'pedido grande demais' });
    let pedido;
    try { pedido = JSON.parse(bruto); } catch (e) { return responder(400, { erro: 'pedido inválido' }); }
    const mensagens = Array.isArray(pedido.messages) ? pedido.messages.slice(-MAX_MENSAGENS) : [];
    if (!mensagens.some((m) => m && m.role === 'user')) return responder(400, { erro: 'pedido sem pergunta' });

    // tenta os modelos na ordem; passa para o próximo se um estourou o limite do dia (429), não existe (404)
    // ou está sobrecarregado (500/503: "high demand", comum no plano gratuito)
    const modelos = String(env.MODELOS || 'gemini-flash-latest').split(',').map((s) => s.trim()).filter(Boolean);
    let ultimo = null;
    const falhas = [];   // "modelo status" de quem não respondeu: vai junto na resposta, para entender demoras
    const prazo = Date.now() + ESPERA_MS;
    for (const [i, modelo] of modelos.entries()) {
      const corpo = paraGemini(mensagens, pedido.schema);
      const resta = prazo - Date.now();
      if (resta < 2000) { ultimo = 504; break; }
      const espera = i < modelos.length - 1 ? Math.min(ESPERA_CURTA_MS, resta) : resta;
      let r = await chamar(env, modelo, corpo, espera);
      if (r.status === 400 && corpo.generationConfig.responseJsonSchema) {
        // esquema recusado: pede só "responda em JSON" (a página confere cada mudança mesmo assim)
        delete corpo.generationConfig.responseJsonSchema;
        r = await chamar(env, modelo, corpo, espera);
      }
      if ([404, 429, 500, 503, 504].includes(r.status)) { ultimo = r.status; falhas.push(`${modelo} ${r.status}`); continue; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return responder(502, { erro: `o Gemini respondeu ${r.status}` + (j.error && j.error.message ? `: ${String(j.error.message).slice(0, 160)}` : '') });
      const c = (j.candidates || [])[0] || {};
      const texto = ((c.content && c.content.parts) || []).map((p) => p.text || '').join('');
      if (!texto) return responder(502, { erro: 'o Gemini não devolveu resposta' + (c.finishReason ? ` (${c.finishReason})` : '') });
      return responder(200, { texto, modelo, falhas });
    }
    if (ultimo === 429) return responder(429, { erro: 'o limite gratuito do Gemini acabou por hoje — tente amanhã' });
    if ([500, 503, 504].includes(ultimo)) return responder(503, { erro: 'o Gemini está sobrecarregado agora — tente de novo em instantes' });
    return responder(502, { erro: 'nenhum modelo do Gemini disponível (confira MODELOS no wrangler.toml)' });
  },
};

/**
 * Nuvem: o plano cifrado de uma pessoa, guardado no KV sob o id (hash do código dela).
 * A versão sobe a cada gravação; quem grava diz em qual versão se baseou, e se outro
 * aparelho gravou antes a resposta é 409 (a página pergunta qual manter: nada se perde calado).
 * ponytail: o KV é eventualmente consistente (até ~60 s entre regiões); para uma pessoa
 * trocando de aparelho basta. Muita gente editando o mesmo plano ao mesmo tempo pediria Durable Objects.
 */
async function plano(req, env, id, responder) {
  if (!/^[0-9a-f]{64}$/.test(id)) return responder(400, { erro: 'código inválido' });
  if (!env.PLANOS) return responder(500, { erro: 'a nuvem não foi configurada no Worker (KV PLANOS)' });
  if (env.LIMITE_PLANO) {
    const { success } = await env.LIMITE_PLANO.limit({ key: req.headers.get('CF-Connecting-IP') || 'sem-ip' });
    if (!success) return responder(429, { erro: 'muitas gravações seguidas — espere um minuto' });
  }
  if (req.method === 'GET') {
    const { value, metadata } = await env.PLANOS.getWithMetadata(id);
    if (value === null) return responder(404, { erro: 'nenhum plano salvo com esse código' });
    return responder(200, { dados: value, versao: (metadata && metadata.versao) || 1, em: metadata && metadata.em });
  }
  if (req.method === 'DELETE') {
    await env.PLANOS.delete(id);
    return responder(200, { ok: true });
  }
  if (req.method !== 'PUT') return responder(405, { erro: 'use GET, PUT ou DELETE' });
  const bruto = await req.text();
  if (bruto.length > MAX_PLANO) return responder(413, { erro: 'plano grande demais para a nuvem' });
  let corpo;
  try { corpo = JSON.parse(bruto); } catch (e) { return responder(400, { erro: 'pedido inválido' }); }
  if (!Number.isInteger(corpo.base) || corpo.base < 0 || typeof corpo.dados !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(corpo.dados)) {
    return responder(400, { erro: 'pedido inválido' });
  }
  const { metadata } = await env.PLANOS.getWithMetadata(id);
  const versao = (metadata && metadata.versao) || 0;
  if (corpo.base !== versao) return responder(409, { erro: 'o plano mudou em outro aparelho', versao });
  const nova = { versao: versao + 1, em: new Date().toISOString() };
  await env.PLANOS.put(id, corpo.dados, { metadata: nova });
  return responder(200, nova);
}

/** Chama um modelo; se ele não responder a tempo (ou a rede falhar), devolve um 504 para tentar o próximo. */
async function chamar(env, modelo, corpo, espera = ESPERA_MS) {
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(espera),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.name } }), { status: 504 });
  }
}
