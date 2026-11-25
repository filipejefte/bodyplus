// Conferência rápida do montador: node web/teste.js  (sem saída = tudo certo)
const assert = require('assert');
const B = require('./builder.js');

// plano por semanas → datas (Time Híbrido: semana 1 na segunda 31/08; A=Sáb … C=Seg da semana seguinte)
const plano = {
  cardio: [{ semana: 1, dia: '3ª', tipo: 'intervalado', reps: 14, esforco_min: 1, recuperacao_min: 1, etapa: 'Base' }],
  musculacao: [
    { semana: 1, treino: 'A', grupo: 'MEMBROS INFERIORES', bloco: 1, exercicio: 'AGACHAMENTO', series: 4, reps: '12' },
    { semana: 1, treino: 'C', grupo: 'COSTAS E BÍCEPS', bloco: 1, exercicio: 'REMADA', series: 3, reps: '10' },
  ],
};
B.prepararLinhas(plano, { inicio: '2026-08-31', diasMusc: B.DIAS_MUSC_PADRAO, plano: 'Time Híbrido', lote: 'x' });
assert.strictEqual(plano.cardio[0].data, '2026-09-01');
assert.deepStrictEqual(plano.musculacao.map((r) => r.data), ['2026-09-05', '2026-09-07']);
assert.deepStrictEqual(plano.musculacao.map((r) => r.sessao), ['x|1|A', 'x|1|C']);

const depara = { AGACHAMENTO: { cat: 'SQUAT', ex: 'BARBELL_BACK_SQUAT' }, REMADA: { cat: 'ROW', ex: 'BENT_OVER_ROW' } };
const ts = B.montarPlano({ ...plano, depara });
assert.deepStrictEqual(ts.map((t) => t.nome), ['S01 · Intervalado 1:1', 'S01 A · Inferiores', 'S01 C · Costas/Bíceps']);
assert.strictEqual(ts[0].payload.description.split('\n')[0], 'Time Híbrido · Semana 01 · Etapa Base');
assert(ts.every((t) => !t.bloqueado));

// treinos seus: nome pela data, outras modalidades, zona 0 = sem alvo, prefixo e nome próprio
const meus = B.montarPlano({
  cardio: [
    { _id: 1, data: '2026-11-25', esporte: 'bike', tipo: 'contínuo', esforco_min: 60, esforco_zona: 0, aquecimento_min: 0, desaquecimento_min: 0 },
    { _id: 2, data: 46000, esporte: 'Natação', tipo: 'distância', distancia_km: 1.5, prefixo: '3K' },
    { _id: 3, data: '27/11/2026', esporte: 'yoga', tipo: 'contínuo', esforco_min: 45, nome: 'Yoga de sábado' },
    { _id: 4, data: '2026-11-28', esporte: 'remo', tipo: 'contínuo', esforco_min: 30 },
  ],
  musculacao: [{ sessao: 's1', data: '2026-11-26', grupo: 'Pernas', bloco: 1, exercicio: 'AGACHAMENTO', series: 3, reps: '12' }],
  depara,
});
const por = Object.fromEntries(meus.map((t) => [t.nome, t]));
const bike = por['25/11 · Bike 60 min'];
assert.strictEqual(bike.payload.sportType.sportTypeKey, 'cycling');
assert.strictEqual(bike.payload.workoutSegments[0].workoutSteps.length, 1);
assert.strictEqual(bike.payload.workoutSegments[0].workoutSteps[0].targetType.workoutTargetTypeKey, 'no.target');
assert.strictEqual(por['3K 09/12 · Natação 1.5 km'].payload.sportType.sportTypeId, 4);   // 46000 = 09/12/2025 no Excel
assert.strictEqual(por['Yoga de sábado'].data, '2026-11-27');
assert(por['26/11 · Pernas'].payload);
const remo = meus.find((t) => t.data === '2026-11-28');
assert(remo.bloqueado && /modalidade "remo"/.test(remo.avisos[0]));

// envio (extensão e script de colar): thEnviar vira JS válido e os dados embutidos voltam iguais
const U = require('../extensao/uploader.js');
(async () => {
  const itens = ts.map((t) => ({ k: t.chave, nome: t.nome, antigos: [], data: t.data, editado: false, payload: t.payload }));
  const r = await U.gerarScript(itens, { agendar: 'mover', existente: 'pular' });
  new Function(r.codigo);
  const txt = await new Response(new Blob([Buffer.from(r.b64, 'base64')]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.deepStrictEqual(JSON.parse(txt), itens);
  assert.strictEqual(r.opcoes.total, itens.length);
})().catch((e) => { console.error(e); process.exit(1); });

// De-para: todo par aponta para um exercício que existe no catálogo do Garmin
const DEPARA = require('./depara.js');
const noCatalogo = new Set(require('../data/garmin_exercises.json').map((e) => e.category + '|' + e.key));
assert.deepStrictEqual(DEPARA.filter((d) => !noCatalogo.has(d.garmin_category + '|' + d.garmin_exercise)).map((d) => d.exercicio_pt), []);
