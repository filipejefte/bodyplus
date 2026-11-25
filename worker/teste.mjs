// Conferência do Worker do assistente, com um Gemini de mentira: node worker/teste.mjs (sem saída = tudo certo)
import assert from 'node:assert';
import worker, { paraGemini, REGRA_FIXA } from './index.js';

const ENV = { ORIGENS: 'https://filipejefte.github.io,http://localhost:8000', GEMINI_API_KEY: 'chave-teste', MODELOS: 'modelo-a,modelo-b' };
const pedido = (corpo, origem = 'http://localhost:8000', metodo = 'POST') =>
  new Request('https://bodyplus-ia.exemplo.workers.dev/', { method: metodo, headers: { Origin: origem, 'Content-Type': 'application/json' }, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined });
const MSGS = [{ role: 'system', content: 'regras' }, { role: 'user', content: 'oi' }, { role: 'assistant', content: '{}' }, { role: 'user', content: 'nota' }, { role: 'user', content: 'pergunta' }];

// Gemini de mentira: cada teste diz o que ele responde; guarda as chamadas
let respostas = [], chamadas = [];
globalThis.fetch = async (url, init) => {
  chamadas.push({ url: String(url), init, corpo: JSON.parse(init.body) });
  const prox = respostas.shift();
  if (prox === 'demorou') throw new DOMException('o Gemini não respondeu a tempo', 'TimeoutError');
  const [status, obj] = prox;
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
};
const ok = (texto) => [200, { candidates: [{ content: { parts: [{ text: texto }] } }] }];
const rodar = async (req, env = ENV) => { const r = await worker.fetch(req, env); return { status: r.status, h: r.headers, j: r.status === 204 ? null : await r.json() }; };

// formato do Gemini: regra de assunto fixa + system → systemInstruction, assistant → model, seguidas do mesmo lado juntas
const g = paraGemini(MSGS, { type: 'object' });
assert.strictEqual(g.systemInstruction.parts[0].text, REGRA_FIXA + '\n\nregras');
assert.ok(paraGemini([{ role: 'user', content: 'oi' }]).systemInstruction.parts[0].text.startsWith('Assunto: você só ajuda com treinos'), 'a regra vale mesmo sem instrução da página');
assert.deepStrictEqual(g.contents.map((c) => c.role), ['user', 'model', 'user']);
assert.strictEqual(g.contents[2].parts[0].text, 'nota\n\npergunta');
assert.deepStrictEqual(g.generationConfig.responseJsonSchema, { type: 'object' });

// CORS: só os endereços permitidos
let r = await rodar(pedido(null, 'http://localhost:8000', 'OPTIONS'));
assert.strictEqual(r.status, 204);
assert.strictEqual(r.h.get('access-control-allow-origin'), 'http://localhost:8000');
r = await rodar(pedido({ messages: MSGS }, 'https://outro-site.com'));
assert.strictEqual(r.status, 403);
assert.strictEqual(chamadas.length, 0);

// caminho normal: chave no header, modelo na URL, texto de volta
respostas = [ok('{"resposta":"feito","acoes":[]}')];
r = await rodar(pedido({ messages: MSGS, schema: { type: 'object' } }));
assert.strictEqual(r.status, 200);
assert.strictEqual(r.j.texto, '{"resposta":"feito","acoes":[]}');
assert.match(chamadas[0].url, /models\/modelo-a:generateContent$/);
assert.strictEqual(chamadas[0].init.headers['x-goog-api-key'], 'chave-teste');

// esquema recusado (400) → tenta de novo só com JSON
chamadas = []; respostas = [[400, { error: { message: 'schema' } }], ok('{}')];
r = await rodar(pedido({ messages: MSGS, schema: { type: 'object' } }));
assert.strictEqual(r.status, 200);
assert.ok(chamadas[0].corpo.generationConfig.responseJsonSchema && !chamadas[1].corpo.generationConfig.responseJsonSchema);

// limite do dia (429) no primeiro modelo → usa o segundo; nos dois → 429 para a página
chamadas = []; respostas = [[429, {}], ok('{}')];
r = await rodar(pedido({ messages: MSGS }));
assert.strictEqual(r.status, 200);
assert.strictEqual(r.j.modelo, 'modelo-b');
assert.deepStrictEqual(r.j.falhas, ['modelo-a 429']);
respostas = [[429, {}], [429, {}]];
r = await rodar(pedido({ messages: MSGS }));
assert.strictEqual(r.status, 429);
// sobrecarregado (503, "high demand") → próximo modelo; nos dois → 503
respostas = [[503, { error: { message: 'high demand' } }], ok('{}')];
r = await rodar(pedido({ messages: MSGS }));
assert.strictEqual(r.status, 200);
respostas = [[503, {}], [503, {}]];
r = await rodar(pedido({ messages: MSGS }));
assert.strictEqual(r.status, 503);
// não respondeu a tempo → próximo modelo
chamadas = []; respostas = ['demorou', ok('{}')];
r = await rodar(pedido({ messages: MSGS }));
assert.strictEqual(r.status, 200);
assert.strictEqual(r.j.modelo, 'modelo-b');
assert.ok(chamadas[0].init.signal, 'cada chamada tem prazo');

// chave errada: o erro do Gemini chega à página (sem a chave)
respostas = [[400, { error: { message: 'API key not valid' } }], [400, { error: { message: 'API key not valid' } }]];
r = await rodar(pedido({ messages: MSGS, schema: {} }));
assert.strictEqual(r.status, 502);
assert.match(r.j.erro, /API key not valid/);
assert.ok(!JSON.stringify(r.j).includes('chave-teste'));

// limite por pessoa, pedido grande e sem pergunta
r = await rodar(pedido({ messages: MSGS }), { ...ENV, LIMITE: { limit: async () => ({ success: false }) } });
assert.strictEqual(r.status, 429);
r = await rodar(pedido({ messages: [{ role: 'user', content: 'x'.repeat(200000) }] }));
assert.strictEqual(r.status, 413);
r = await rodar(pedido({ messages: [{ role: 'system', content: 'só regras' }] }));
assert.strictEqual(r.status, 400);
r = await rodar(pedido({ messages: MSGS }), { ...ENV, GEMINI_API_KEY: '' });
assert.strictEqual(r.status, 500);
