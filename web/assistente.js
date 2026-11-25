/**
 * Body+ · assistente (IA pelo Gemini, com a chave do projeto)
 * ===========================================================
 * Você escreve o que quer ("monta 4 semanas de corrida para 5 km"), o modelo
 * responde e propõe mudanças nos treinos. Nada muda até você clicar em
 * Aplicar, e depois dá para desfazer.
 *
 * A página fala com o Worker do projeto (pasta worker/), que guarda a chave do
 * Gemini: ela nunca chega ao navegador. O modelo devolve JSON num formato fixo:
 *   {resposta, acoes: [{acao: criar|alterar|mover|excluir, id?, semana?, dia?, ...campos}]}
 */
(function () {
  'use strict';
  const A = window.BodyApp;
  const B = window.THBuilder;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Endereço do Worker (worker/), publicado com `npx wrangler deploy`: veja "Assistente" no README. */
  const CONF = { url: 'https://bodyplus-ia.bodyplus.workers.dev' };
  const conversa = [];          // [{role: 'user'|'assistant', content}] mandado de volta como histórico
  let pedido = null;            // AbortController do pedido em andamento
  const ESPORTES = Object.keys(B.ESPORTES);
  const CAMPOS_CARDIO = ['tipo', 'reps', 'esforco_min', 'esforco_zona', 'recuperacao_min', 'recuperacao_zona', 'aquecimento_min', 'desaquecimento_min', 'distancia_km', 'notas'];
  const SUGESTOES = [
    'Monte 4 semanas de corrida para 5 km, 3 treinos por semana, a partir da próxima segunda',
    'Mova os treinos desta semana um dia para frente',
    'Crie um treino de pernas para sexta, com 5 exercícios',
    'O que eu tenho para esta semana?',
  ];

  const num = { type: 'number' }, int = { type: 'integer' }, str = { type: 'string' };
  const ESQUEMA = {
    type: 'object',
    properties: {
      resposta: str,
      acoes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            acao: { type: 'string', enum: ['criar', 'alterar', 'mover', 'excluir'] },
            id: str,
            // quando: semana (0 = esta, 1 = a que vem…) + dia, ou dia do mês. Sem data por extenso de
            // propósito: modelos pequenos erram a conta; o Body+ calcula (resolverData).
            semana: int, dia: { type: 'string', enum: ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] },
            dia_do_mes: int, mes: int,
            nome: str,
            modalidade: { type: 'string', enum: [...ESPORTES, 'musculacao'] },
            tipo: { type: 'string', enum: ['contínuo', 'intervalado', 'distância', 'prova'] },
            reps: num, esforco_min: num, esforco_zona: int, recuperacao_min: num, recuperacao_zona: int,
            aquecimento_min: num, desaquecimento_min: num, distancia_km: num, notas: str,
            grupo: str,
            exercicios: {
              type: 'array',
              items: { type: 'object', properties: { exercicio: str, series: int, reps: str, descanso_seg: int }, required: ['exercicio', 'series', 'reps'] },
            },
            // só em criar: repete toda semana até essa data (o Body+ faz as cópias; o modelo não escreve 25 treinos).
            // No fim de propósito: o modelo escreve na ordem do esquema e pensa em "repetir" depois dos exercícios.
            repetir_ate_dia: int, repetir_ate_mes: int,
          },
          required: ['acao'],
          additionalProperties: false,
        },
      },
    },
    required: ['resposta', 'acoes'],
  };

  // ---------------------------------------------------------------------
  // O que o modelo sabe: hoje, as regras e os treinos de segunda desta semana em diante
  // ---------------------------------------------------------------------
  const semVazios = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  const diaSemana = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  const cardioDe = (id) => A.linhas().cardio.find((x) => 'c|' + x._id === id);
  const exerciciosDe = (id) => A.linhas().musculacao.filter((x) => 'm|' + B.sessaoDe(x) === id && Number(x.series));

  /** Semana e dia de uma data, como o modelo usa nas ações: "sexta" sem ele ter de calcular o dia da semana. */
  function quando(iso) {
    const n = Math.round((new Date(iso + 'T12:00:00') - new Date(B.segundaDe(A.hoje) + 'T12:00:00')) / 864e5);
    return dataOk(iso) ? { semana: Math.floor(n / 7), dia: DIAS[((n % 7) + 7) % 7] } : {};
  }

  function treinosParaModelo() {
    const desde = B.segundaDe(A.hoje);
    return A.treinos()
      .filter((t) => !t.data || t.data >= desde)
      .sort((a, b) => String(a.data).localeCompare(String(b.data)))
      .slice(0, 60)
      .map((t) => {
        const base = { id: t.chave, ...quando(t.data), data: t.data, nome: t.nome };
        if (t.tipo === 'cardio') {
          const r = cardioDe(t.chave) || {};
          return semVazios({ ...base, modalidade: r.esporte, tipo: B.tipoCardio(r), ...Object.fromEntries(CAMPOS_CARDIO.slice(1).map((c) => [c, r[c]])) });
        }
        const rows = exerciciosDe(t.chave);
        return semVazios({
          ...base, modalidade: 'musculacao', grupo: rows[0] && rows[0].grupo,
          exercicios: rows.map((x) => semVazios({ exercicio: x.exercicio, series: x.series, reps: x.reps, descanso_seg: x.descanso_seg })),
        });
      });
  }

  /**
   * Calendário por semana, do jeito que a pessoa fala ("sábado", "segunda que vem"):
   * o modelo copia a data em vez de calcular (modelos pequenos erram a conta).
   */
  function calendario() {
    const seg = B.segundaDe(A.hoje);
    const rotulos = ['Esta semana', 'Semana que vem', 'Daqui a 2 semanas', 'Daqui a 3 semanas', 'Daqui a 4 semanas', 'Daqui a 5 semanas'];
    return rotulos.map((rotulo, s) => {
      const dias = Array.from({ length: 7 }, (_, i) => {
        const d = B.addDias(seg, s * 7 + i);
        const nome = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
        return `${nome} = ${d}${d === A.hoje ? ' (hoje)' : d < A.hoje ? ' (já passou)' : ''}`;
      });
      return `- ${rotulo}: ${dias.join(', ')}`;
    }).join('\n');
  }

  function sistema() {
    return [
      'Você é o assistente do Body+, um app de treinos que depois envia tudo para o Garmin. Responda em português do Brasil, curto e direto.',
      `Hoje é ${diaSemana(A.hoje)} (${A.hoje}).`,
      'Calendário (para você se situar):',
      calendario(),
      '',
      'Você pode propor mudanças nos treinos em "acoes"; a pessoa confere e aplica:',
      '- criar: quando (semana e dia), modalidade e os campos do treino. Para repetir toda semana, no mesmo dia, até uma data: repetir_ate_dia e repetir_ate_mes.',
      '- alterar: id de um treino da lista e só os campos que mudam. Exceção: "exercicios" vai sempre completo, do jeito que o treino deve ficar (o que ficar fora da lista sai do treino).',
      '- mover: id e o novo quando (semana e dia).',
      '- excluir: id.',
      'Para achar o treino de que a pessoa fala ("o treino de sexta", "a corrida de amanhã"), use semana e dia de cada treino da lista. Use só ids da lista.',
      'Se a pessoa só perguntar algo, responda e deixe "acoes" vazia. Não faça mudanças que ela não pediu.',
      'Faça tudo o que a pessoa pediu numa resposta só; nunca proponha fazer "semana a semana" ou aos poucos.',
      'Quando ela disser uma quantidade ("mais 2 exercícios", "3 treinos por semana"), entregue exatamente essa quantidade.',
      'Plano que se repete toda semana: crie cada treino UMA vez, na primeira data, com repetir_ate_dia/repetir_ate_mes = último dia do plano; o Body+ faz as cópias.',
      '  Ex.: "de 27/11 até 31/12" → cada treino com "repetir_ate_dia":31,"repetir_ate_mes":12 (campos da ação, depois de "exercicios"; nunca dentro de um exercício).',
      'Ao trocar ou incluir um exercício, não repita um que o treino já tem; se o que a pessoa pediu já está no treino, diga isso e pergunte o que ela prefere.',
      'Se não houver treino que bata com o pedido, ou houver mais de um, pergunte em vez de adivinhar.',
      'Em "resposta", diga em uma ou duas frases o que você propõe (a lista das mudanças a pessoa já vê). Nada muda até ela clicar em Aplicar:',
      'escreva "Proponho…" ou "Posso…", nunca "mudei", "removi" ou "criei".',
      '',
      'Campos:',
      '- quando: semana (0 = esta semana, 1 = semana que vem, 2 = daqui a 2 semanas…) e dia (segunda, terça, quarta, quinta, sexta, sábado, domingo).',
      '  "sábado" = semana 0, dia sábado. "segunda que vem" ou "próxima segunda" = semana 1, dia segunda. Um plano de 4 semanas a partir da semana que vem usa semana 1, 2, 3 e 4.',
      '  Se a pessoa disser um dia do mês ("dia 12", "12/12"), use dia_do_mes (e mes, se ela disser).',
      '  Exemplos: "corrida leve no sábado" → {"acao":"criar","semana":0,"dia":"sábado","modalidade":"corrida","tipo":"contínuo","esforco_min":30,"esforco_zona":2}',
      '  "tiros na quarta" → {"acao":"criar","semana":0,"dia":"quarta","modalidade":"corrida","tipo":"intervalado","reps":6,"esforco_min":1,"esforco_zona":4,"recuperacao_min":2,"recuperacao_zona":1,"aquecimento_min":10,"desaquecimento_min":5}',
      '  "passa o treino de pernas para segunda que vem" → {"acao":"mover","id":"<id do treino de pernas>","semana":1,"dia":"segunda"}',
      '  "treino de pernas toda quinta até 18/12" → {"acao":"criar","semana":0,"dia":"quinta","modalidade":"musculacao","grupo":"Pernas","exercicios":[…],"repetir_ate_dia":18,"repetir_ate_mes":12}',
      '  Uma sequência de dias que passa do domingo continua na semana seguinte: treinos de sexta a terça começando nesta sexta = sexta, sábado e domingo da semana 0, segunda e terça da semana 1.',
      `- modalidade: ${ESPORTES.join(', ')} ou musculacao.`,
      '- cardio: tipo contínuo (esforco_min), intervalado (reps, esforco_min, recuperacao_min), distância (distancia_km) ou prova (só corrida; distancia_km).',
      '  Minutos podem ter decimais (0.5 = 30 s). Zonas de FC de 1 a 5; 0 = sem alvo. aquecimento_min e desaquecimento_min são opcionais. notas aparece no relógio.',
      '- musculacao: grupo (ex.: "Pernas", "Costas/Bíceps") e exercicios [{exercicio, series, reps, descanso_seg}].',
      '  reps é texto: "12" (todas as séries) ou "15-12-10" (pirâmide, uma por série). Prefira os nomes da lista de exercícios conhecidos (já têm par no Garmin).',
      '  Ao montar um treino de musculação: 5 a 7 exercícios que cubram os grupos pedidos, 3 ou 4 séries.',
      '- musculacao: grupo curto, com barras ("Costas/Bíceps/Antebraço", não "Costas, Bíceps e Antebraço").',
      '- nome: se a pessoa der letra ou nome aos treinos ("treino A", "B"…), use "Treino A · <grupo>"; senão deixe vazio (nome automático).',
      '',
      'Ao montar um plano, varie os treinos da semana. Corrida: um leve (contínuo, Z2), um intervalado (tiros em Z4 com recuperação em Z1) e um longo (contínuo, Z2, mais tempo).',
      'Aumente o volume aos poucos (cerca de 10% por semana); para quem está começando, comece leve. Use "distância" ou "prova" só quando a pessoa pedir uma distância.',
      '',
      `Treinos de ${B.segundaDe(A.hoje)} em diante (JSON): ${JSON.stringify(treinosParaModelo())}`,
      '',
      `Exercícios conhecidos: ${A.exercicios().join('; ')}`,
    ].join('\n');
  }

  // ---------------------------------------------------------------------
  // Worker do projeto (worker/): guarda a chave e fala com o Gemini
  // ---------------------------------------------------------------------
  async function perguntar(texto) {
    pedido = new AbortController();
    const messages = [{ role: 'system', content: sistema() }, ...conversa.slice(-8), { role: 'user', content: texto }];
    let r;
    try {
      r = await fetch(CONF.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, schema: ESQUEMA }), signal: pedido.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('não consegui falar com o assistente (sem internet?)');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'o assistente respondeu HTTP ' + r.status);
    let saida;
    // sem o formato fixo o modelo às vezes embrulha o JSON em ```json … ```
    try { saida = JSON.parse(String(j.texto || '{}').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
    catch (e) { throw new Error('a resposta veio num formato que não entendi; tente de novo'); }
    return { resposta: String(saida.resposta || ''), acoes: Array.isArray(saida.acoes) ? saida.acoes : [] };
  }

  // ---------------------------------------------------------------------
  // Mudanças: descrever, conferir e aplicar
  // ---------------------------------------------------------------------
  const dataOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(new Date(d + 'T12:00:00'));
  const nomeDe = (id) => { const t = A.treinos().find((x) => x.chave === id); return t ? `${t.nome} (${A.fmtData(t.data)})` : null; };
  const nomeModalidade = (m) => (m === 'musculacao' ? 'Musculação' : (B.ESPORTES[m] || {}).nome || m);

  function resumoCardio(a) {
    const z = (v) => (v ? ` Z${v}` : '');
    const t = a.tipo || 'contínuo';
    if (t === 'intervalado') return `${a.reps || '?'}× ${a.esforco_min || '?'} min${z(a.esforco_zona)} / ${a.recuperacao_min || '?'} min${z(a.recuperacao_zona)}`;
    if (t === 'distância' || t === 'prova') return `${t} ${a.distancia_km || '?'} km`;
    return `${a.esforco_min || '?'} min${z(a.esforco_zona)}`;
  }

  const DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  /** semana + dia → data (o modelo diz "semana 1, segunda"; a conta é daqui). */
  function resolverData(a) {
    let data = null;
    if (Number.isInteger(a.semana) && a.semana >= 0 && DIAS.includes(a.dia)) {
      data = B.addDias(B.segundaDe(A.hoje), a.semana * 7 + DIAS.indexOf(a.dia));
      // ponytail: criar/mover para um dia desta semana que já passou é erro de conta do modelo ("de sexta a terça"
      // vira a segunda de 3 dias atrás): vai para a semana seguinte. Registrar treino passado fica para a tela.
      if (data < A.hoje && (a.acao === 'criar' || a.acao === 'mover')) data = B.addDias(data, 7);
    } else data = proximoDia(a.dia_do_mes, a.mes, A.hoje);
    if (!data) return a;
    const r = { ...a, data };
    // "repetir até": a mesma data toda semana até o fim (inclusive)
    const fim = a.acao === 'criar' && dataOk(data) ? proximoDia(a.repetir_ate_dia, a.repetir_ate_mes, data) : null;
    if (fim) { r.datas = []; for (let d = data; d <= fim && r.datas.length < 53; d = B.addDias(d, 7)) r.datas.push(d); }
    return r;
  }

  /** O próximo dia com esse número a partir de `base` (no mês dito, ou neste/no próximo); null sem dia. */
  function proximoDia(dia, mes, base) {
    if (!(Number.isInteger(dia) && dia >= 1 && dia <= 31)) return null;
    const [ano, mesBase] = base.split('-').map(Number);
    const iso = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    let y = ano, m = Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : mesBase;
    if (iso(y, m) < base) { if (Number.isInteger(mes)) y++; else if (++m > 12) { m = 1; y++; } }
    return iso(y, m);
  }
  const quandoTxt = (a) => (a.datas && a.datas.length > 1
    ? `${a.datas.length} semanas, de ${A.fmtData(a.datas[0])} a ${A.fmtData(a.datas[a.datas.length - 1])}`
    : A.fmtData(a.data));
  const titulo = (s) => String(s).toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const listaEx = (exs) => {
    const ok = (exs || []).filter((e) => e.exercicio);
    return ok.slice(0, 6).map((e) => `${titulo(e.exercicio)} ${e.series || 3}×${e.reps || 12}`).join(', ') + (ok.length > 6 ? `, +${ok.length - 6}` : '');
  };

  /** Texto da mudança, ou um erro (mudança que não dá para aplicar). */
  function descrever(a) {
    if (a.acao === 'criar') {
      if (!dataOk(a.data)) return { erro: 'criar sem data válida' };
      if (a.modalidade === 'musculacao') {
        const n = (a.exercicios || []).filter((e) => e.exercicio).length;
        if (!n) return { erro: 'treino de musculação sem exercícios' };
        return { texto: `Criar musculação${a.grupo ? ' · ' + a.grupo : ''} em ${quandoTxt(a)}: ${listaEx(a.exercicios)}` };
      }
      if (!B.ESPORTES[a.modalidade]) return { erro: `modalidade "${a.modalidade}" não existe` };
      const final = { ...(A.NOVO[a.modalidade] || A.NOVO_PADRAO), ...semVazios(Object.fromEntries(CAMPOS_CARDIO.map((c) => [c, a[c]]))) };
      return { texto: `Criar ${nomeModalidade(a.modalidade).toLowerCase()} em ${quandoTxt(a)}: ${resumoCardio(final)}` };
    }
    const alvo = nomeDe(a.id);
    if (!alvo) return { erro: `treino "${a.id}" não existe` };
    if (a.acao === 'excluir') return { texto: `Excluir ${alvo}` };
    if (a.acao === 'mover') {
      if (!dataOk(a.data)) return { erro: 'mover sem data válida' };
      if ((A.treinos().find((t) => t.chave === a.id) || {}).data === a.data) return { nada: true };   // já está nessa data
      return { texto: `Mover ${alvo} para ${A.fmtData(a.data)}` };
    }
    const campos = Object.keys(semVazios(a)).filter((c) => !['acao', 'id', 'semana', 'dia', 'dia_do_mes', 'mes'].includes(c));
    if (!campos.length) return { erro: `alterar ${alvo} sem nada para mudar` };
    if (a.data && !dataOk(a.data)) return { erro: 'data inválida' };
    // só o que muda de fato, com o valor de antes: "duração 45 → 60 min", "sai Supino", "descanso 60 → 90 s em 5 exercícios"
    const c0 = cardioDe(a.id), ex0 = exerciciosDe(a.id);
    const antes = c0 ? { ...c0, modalidade: c0.esporte, tipo: B.tipoCardio(c0) } : { ...ex0[0] };
    antes.nome = (A.treinos().find((t) => t.chave === a.id) || {}).nome;
    const partes = [];
    for (const c of campos) {
      if (c === 'exercicios') { partes.push(...mudancasEx(ex0, a.exercicios)); continue; }
      const novo = c === 'tipo' ? B.tipoCardio(a) : a[c];
      const velho = antes[c];
      if (String(velho ?? '') === String(novo)) continue;
      partes.push(`${ROTULOS[c] || c} ${velho !== undefined && velho !== null && velho !== '' ? valorTxt(c, velho) + ' → ' : ''}${valorTxt(c, novo)}`);
    }
    if (!partes.length) return { nada: true };
    return { texto: `Alterar ${alvo}: ${partes.join('; ')}` };
  }

  const ROTULOS = {
    esforco_min: 'duração', esforco_zona: 'zona', reps: 'repetições', recuperacao_min: 'recuperação', recuperacao_zona: 'zona da recuperação',
    aquecimento_min: 'aquecimento', desaquecimento_min: 'desaquecimento', distancia_km: 'distância', modalidade: 'modalidade',
  };
  function valorTxt(c, v) {
    if (c === 'data') return A.fmtData(v);
    if (c === 'modalidade') return nomeModalidade(v).toLowerCase();
    if (c === 'tipo') return { continuo: 'contínuo', distancia: 'distância' }[v] || v;
    if (c.endsWith('_zona')) return Number(v) ? 'Z' + v : 'sem zona';
    if (c.endsWith('_min')) return `${v} min`;
    if (c.endsWith('_km')) return `${v} km`;
    return typeof v === 'number' ? String(v) : `"${v}"`;
  }

  /** Lista de exercícios nova contra a atual: o que sai, o que entra e o que muda em cada um. */
  function mudancasEx(antes, depois) {
    const k = (e) => String(e.exercicio || '').trim().toUpperCase();
    const novos = (depois || []).filter((e) => e.exercicio);
    const sobra = [...antes], entra = [], mudou = new Map();
    for (const e of novos) {
      const i = sobra.findIndex((v) => k(v) === k(e));
      if (i < 0) { entra.push(`entra ${titulo(e.exercicio)} ${e.series || 3}×${e.reps || 12}`); continue; }
      const v = sobra.splice(i, 1)[0];
      const d = [];
      if ((Number(e.series) || 3) !== Number(v.series)) d.push(`${v.series} → ${Number(e.series) || 3} séries`);
      if (String(e.reps || '12') !== String(v.reps)) d.push(`reps ${v.reps} → ${e.reps || 12}`);
      const dv = v.descanso_seg === undefined || v.descanso_seg === null ? 60 : Number(v.descanso_seg);
      if (e.descanso_seg !== undefined && e.descanso_seg !== null && Number(e.descanso_seg) !== dv) d.push(`descanso ${dv} → ${e.descanso_seg} s`);
      if (d.length) mudou.set(d.join(', '), [...(mudou.get(d.join(', ')) || []), titulo(e.exercicio)]);
    }
    const partes = [...sobra.map((v) => 'sai ' + titulo(v.exercicio)), ...entra];
    mudou.forEach((nomes, d) => partes.push(nomes.length > 2 ? `${d} em ${nomes.length} exercícios` : `${nomes.join(' e ')}: ${d}`));
    if (!partes.length && novos.map(k).join('|') !== antes.map(k).join('|')) partes.push('nova ordem dos exercícios');
    const repetidos = [...new Set(novos.map(k).filter((n, i, l) => l.indexOf(n) !== i))];
    if (repetidos.length) partes.push(`atenção: ${repetidos.map(titulo).join(', ')} fica${repetidos.length > 1 ? 'm' : ''} repetido${repetidos.length > 1 ? 's' : ''}`);
    return partes;
  }

  function linhasMusc(atual, a) {
    const ex = (a.exercicios || []).filter((e) => e.exercicio);
    return ex.map((e, i) => ({
      _id: A.novoId(), bloco: i + 1, tecnica: '', exercicio: String(e.exercicio).trim().toUpperCase(),
      series: Number(e.series) || 3, reps: String(e.reps || '12'), descanso_seg: e.descanso_seg === undefined || e.descanso_seg === null ? 60 : Number(e.descanso_seg),
    }));
  }

  function executar(atual, a) {
    const cardioDe = (id) => atual.cardio.find((r) => 'c|' + r._id === id);
    const muscDe = (id) => atual.musculacao.filter((r) => 'm|' + B.sessaoDe(r) === id);
    const valores = (o) => semVazios(Object.fromEntries(CAMPOS_CARDIO.map((c) => [c, o[c]])));
    if (a.acao === 'criar') {
      const datas = a.datas || [a.data];
      // o Garmin acha o treino pelo nome: nome dado que se repete (cópias semanais, ou um que já existe) leva a data
      // na frente, como o nome automático ("27/11 · Treino A · Peito/Ombro/Tríceps")
      const comData = a.nome && (datas.length > 1 || A.treinos().some((t) => t.nome === a.nome));
      for (const data of datas) {
        const nome = !a.nome ? null : comData ? `${data.slice(8, 10)}/${data.slice(5, 7)} · ${a.nome}` : a.nome;
        if (a.modalidade === 'musculacao') {
          const sessao = A.novoId();
          linhasMusc(atual, a).forEach((r) => atual.musculacao.push({ ...r, sessao, data, nome, grupo: a.grupo || '' }));
        } else {
          atual.cardio.push({ _id: A.novoId(), data, esporte: a.modalidade, nome, aquecimento_min: 0, desaquecimento_min: 0, ...(A.NOVO[a.modalidade] || A.NOVO_PADRAO), ...valores(a) });
        }
      }
      return;
    }
    const c = cardioDe(a.id), m = muscDe(a.id);
    if (a.acao === 'excluir') {
      if (c) atual.cardio.splice(atual.cardio.indexOf(c), 1);
      else atual.musculacao = atual.musculacao.filter((r) => !m.includes(r));
      return;
    }
    if (a.acao === 'mover') { (c ? [c] : m).forEach((r) => (r.data = a.data)); return; }
    // alterar
    if (c) {
      Object.assign(c, valores(a));
      if (a.data) c.data = a.data;
      if (a.nome) c.nome = a.nome;
      if (a.modalidade && B.ESPORTES[a.modalidade]) c.esporte = a.modalidade;
      return;
    }
    const sessao = { ...m[0] };
    ['data', 'nome', 'grupo'].forEach((k) => { if (a[k]) sessao[k] = a[k]; });
    if ((a.exercicios || []).length) {
      const pos = atual.musculacao.indexOf(m[0]);
      atual.musculacao = atual.musculacao.filter((r) => !m.includes(r));
      const base = Object.fromEntries(['sessao', 'data', 'nome', 'grupo', 'prefixo', 'plano', 'semana', 'treino'].map((k) => [k, sessao[k] === undefined ? null : sessao[k]]));
      atual.musculacao.splice(pos, 0, ...linhasMusc(atual, a).map((r) => ({ ...base, ...r })));
    } else {
      m.forEach((r) => ['data', 'nome', 'grupo'].forEach((k) => { if (a[k]) r[k] = a[k]; }));
    }
  }

  // ---------------------------------------------------------------------
  // Tela
  // ---------------------------------------------------------------------
  const msgs = () => $('#ia-msgs');
  function rolar() { const c = $('#ia-corpo'); c.scrollTop = c.scrollHeight; }

  function adicionar(html, classe) {
    const d = document.createElement('div');
    d.className = 'ia-msg ' + classe;
    d.innerHTML = html;
    msgs().appendChild(d);
    $('#ia-sugestoes').hidden = true;
    rolar();
    return d;
  }

  function mostrarResposta(saida) {
    const itens = saida.acoes.map(resolverData).map((a) => ({ a, ...descrever(a) })).filter((i) => !i.nada);
    const boas = itens.filter((i) => i.texto);
    const ruins = itens.filter((i) => i.erro);
    const d = adicionar(`<p>${esc(saida.resposta || (boas.length ? 'Proponho:' : 'Não entendi; pode explicar de outro jeito?'))}</p>`, 'ia-ela');
    if (!itens.length) return;
    const caixa = document.createElement('div');
    caixa.className = 'ia-acoes';
    caixa.innerHTML =
      (boas.length ? `<ol>${boas.map((i) => `<li>${esc(i.texto)}</li>`).join('')}</ol>` : '') +
      (ruins.length ? `<p class="aviso-txt">${ruins.length} ficam de fora: ${esc(ruins.map((i) => i.erro).join('; '))}.</p>` : '') +
      (boas.length ? '<div class="ia-botoes"><button class="btn btn-primario" data-ia="aplicar">Aplicar</button><button class="btn btn-claro" data-ia="descartar">Descartar</button></div>' : '');
    d.appendChild(caixa);
    caixa.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ia]');
      if (!b) return;
      const rodape = caixa.querySelector('.ia-botoes');
      if (b.dataset.ia === 'descartar') { rodape.outerHTML = '<p class="ia-status">Descartado.</p>'; registrar('(a pessoa descartou as mudanças)'); return; }
      if (b.dataset.ia === 'aplicar') {
        const desfazer = A.aplicar((atual) => boas.forEach((i) => executar(atual, i.a)));
        const n = boas.reduce((s, i) => s + ((i.a.datas || []).length || 1), 0);   // "repetir até" conta cada cópia
        rodape.innerHTML = `<span class="ia-status">${n} mudança${n > 1 ? 's' : ''} aplicada${n > 1 ? 's' : ''}.</span><button class="btn btn-claro" data-ia="desfazer">Desfazer</button>`;
        rodape.dataset.desfazer = '1';
        caixa._desfazer = desfazer;
        registrar('(a pessoa aplicou as mudanças)');
        return;
      }
      if (b.dataset.ia === 'desfazer' && caixa._desfazer) {
        caixa._desfazer(); caixa._desfazer = null;
        rodape.innerHTML = '<span class="ia-status">Desfeito.</span>';
        registrar('(a pessoa desfez as mudanças)');
      }
    });
    rolar();
  }

  function registrar(nota) { conversa.push({ role: 'user', content: nota }); }

  function ocupado(sim) {
    $('#ia-enviar').hidden = sim;
    $('#ia-parar').hidden = !sim;
    $('#ia-texto').disabled = sim;
    $('#ia-pensando').hidden = !sim;
    if (sim) rolar();
  }

  async function enviar(texto) {
    texto = texto.trim();
    if (!texto || pedido) return;
    if (!CONF.url) { adicionar('<p>O assistente ainda não está ligado: falta publicar o Worker do projeto (veja "Assistente" no README).</p>', 'ia-ela ia-erro'); return; }
    adicionar(`<p>${esc(texto)}</p>`, 'ia-eu');
    $('#ia-texto').value = '';
    ocupado(true);
    try {
      const saida = await perguntar(texto);
      conversa.push({ role: 'user', content: texto }, { role: 'assistant', content: JSON.stringify(saida) });
      mostrarResposta(saida);
    } catch (e) {
      if (e.name === 'AbortError') adicionar('<p>Parei.</p>', 'ia-ela');
      else adicionar(`<p>Não consegui uma resposta: ${esc(e.message)}.</p>`, 'ia-ela ia-erro');
    } finally {
      pedido = null;
      ocupado(false);
      $('#ia-texto').focus();
    }
  }

  function abrirPainel() {
    $('#assistente').hidden = false;
    document.body.classList.add('sem-rolagem');
    $('#ia-texto').focus();
  }
  function fecharPainel() {
    $('#assistente').hidden = true;
    if ($('#gaveta').hidden) document.body.classList.remove('sem-rolagem');
  }

  $('#ia-sugestoes').innerHTML = SUGESTOES.map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('');
  $('#ia-sugestoes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) enviar(b.textContent); });
  $('#btn-ia').addEventListener('click', abrirPainel);
  $('#assistente').addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fecharPainel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#assistente').hidden && !$('dialog[open]')) fecharPainel(); });
  $('#ia-form').addEventListener('submit', (e) => { e.preventDefault(); enviar($('#ia-texto').value); });
  $('#ia-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar($('#ia-texto').value); } });
  $('#ia-parar').addEventListener('click', () => pedido && pedido.abort());

  // para conferir no Console (e testar com um Worker local, trocando CONF.url)
  window.BodyIA = { descrever, executar, resolverData, ESQUEMA, sistema, CONF };
})();
