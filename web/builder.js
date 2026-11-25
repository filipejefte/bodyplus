/**
 * Body+ · montagem dos treinos (linhas da planilha → JSON do Garmin)
 * ==================================================================
 * Cada treino tem a própria data. Um plano por semanas (PDF do Time Híbrido,
 * planilha antiga) ganha as datas uma vez, na importação (`datarPlano`).
 *
 *   CARDIO      → uma linha por treino, em qualquer modalidade (`esporte`):
 *                 intervalado, contínuo, distância ou prova; aquecimento e
 *                 desaquecimento sem alvo, esforço por zona de FC (0 = sem alvo).
 *                 Formato validado no Garmin em 12/08/2026 (corrida).
 *   MUSCULAÇÃO  → várias linhas (exercícios) por treino, agrupadas por `sessao`:
 *                 bi-set com descanso no botão Lap, "6 / 12" na mesma série,
 *                 pirâmide com a sequência na descrição, aquecimento fixo.
 *
 * Nomes (o dedupe no Garmin é feito pelo nome):
 *   do plano    "S01 · Intervalado 1:1"     "S01 A · Peito/Ombro/Tríceps"
 *   seus        "25/11 · Contínuo 30 min"   "25/11 · Pernas"
 *   `prefixo` vai na frente; `nome` preenchido substitui tudo.
 *
 * Roda no navegador (window.THBuilder) e no Node (require) para os testes.
 */
(function (raiz) {
  'use strict';

  // ---------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------
  const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  const num = (v, padrao) => (vazio(v) || isNaN(Number(v)) ? padrao : Number(v));
  const txt = (v) => (vazio(v) ? '' : String(v).trim());
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  /** Formato "g" do Python: 1.0 → "1", 2.5 → "2.5". */
  const g = (n) => String(+Number(n).toFixed(4));
  const pad2 = (n) => String(n).padStart(2, '0');
  const mm = (s) => (s % 60 === 0 ? s / 60 + ' min' : s + 's');
  const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '??/??');

  // ---------------------------------------------------------------------
  // Datas
  // ---------------------------------------------------------------------
  /** Dia da semana (0 = segunda … 6 = domingo) de cada rótulo da planilha. */
  const DIA_SEMANA = {
    '2ª': 0, 'Seg': 0, '3ª': 1, 'Ter': 1, '4ª': 2, 'Qua': 2,
    '5ª': 3, 'Qui': 3, '6ª': 4, 'Sex': 4, 'Sáb': 5, 'Sab': 5, 'Dom': 6,
  };
  const NOME_DIA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const TREINOS = ['A', 'B', 'C', 'D', 'E'];
  /** Padrão do Time Híbrido: A=Sáb, B=Dom, C=Seg, D=Ter, E=Qua (troca B↔C de 12/08). */
  const DIAS_MUSC_PADRAO = { A: 5, B: 6, C: 0, D: 1, E: 2 };

  function addDias(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  /** 0 = segunda … 6 = domingo. */
  function diaDaSemana(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  }
  const segundaDe = (iso) => addDias(iso, -diaDaSemana(iso));

  /** Data de célula (texto ISO, dd/mm/aaaa, número serial do Excel ou Date) → "AAAA-MM-DD". */
  function dataIso(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number' && isFinite(v)) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    return null;
  }

  /** Quando a sequência de dias recua (Sáb → Seg) entende que virou a semana — Sáb,Dom,Seg,Ter,Qua → 5,6,7,8,9. */
  function offsetsMusc(mapa) {
    const out = {};
    let semana = 0, ant = -1;
    for (const t of TREINOS) {
      if (mapa[t] === undefined || mapa[t] === null || mapa[t] === '') continue;
      const wd = Number(mapa[t]);
      if (wd <= ant) semana += 1;
      out[t] = semana * 7 + wd;
      ant = wd;
    }
    return out;
  }

  /**
   * Plano por semanas → datas fixas (só nas linhas sem `data`).
   * @param dados {cardio:[linhas], musculacao:[linhas]}  (altera as linhas)
   * @param inicio 'AAAA-MM-DD', segunda-feira da semana 1
   * @param diasMusc {A..E: 0-6} dia de cada treino de musculação
   */
  function datarPlano(dados, inicio, diasMusc) {
    const off = offsetsMusc(diasMusc || DIAS_MUSC_PADRAO);
    for (const r of dados.cardio || []) {
      if (!vazio(r.data) || vazio(r.semana)) continue;
      const wd = DIA_SEMANA[txt(r.dia)];
      if (wd !== undefined) r.data = addDias(inicio, (Number(r.semana) - 1) * 7 + wd);
    }
    for (const r of dados.musculacao || []) {
      if (!vazio(r.data) || vazio(r.semana)) continue;
      const o = off[txt(r.treino).toUpperCase()];
      if (o !== undefined) r.data = addDias(inicio, (Number(r.semana) - 1) * 7 + o);
    }
  }

  /**
   * Linhas lidas de um arquivo → prontas para a página: datas fixas e em ISO,
   * nome do plano e prefixo nas linhas do plano, `sessao` em cada treino de musculação.
   * @param opc {inicio, diasMusc, plano?, prefixo?, lote?}  lote: id da importação,
   *            para duas importações do mesmo plano não se misturarem (troca os ids).
   */
  function prepararLinhas(dados, opc) {
    dados.cardio = dados.cardio || [];
    dados.musculacao = dados.musculacao || [];
    if (opc.inicio) datarPlano(dados, opc.inicio, opc.diasMusc);
    const lote = opc.lote ? opc.lote + '|' : '';
    for (const r of [...dados.cardio, ...dados.musculacao]) {
      r.data = dataIso(r.data);
      if (opc.plano && !vazio(r.semana) && vazio(r.plano)) r.plano = opc.plano;
      if (opc.prefixo && vazio(r.prefixo)) r.prefixo = opc.prefixo;
    }
    dados.cardio.forEach((r, i) => { if (lote || vazio(r._id)) r._id = `${lote}c${i}`; });
    dados.musculacao.forEach((r, i) => {
      if (lote || vazio(r._id)) r._id = `${lote}m${i}`;
      if (!vazio(r.sessao) || (!vazio(r.semana) && !vazio(r.treino))) r.sessao = lote + sessaoDe(r);
    });
    return dados;
  }

  /** Nome do treino: `nome` da planilha, ou [prefixo] + (S01 [A] | 25/11) + " · " + rótulo. */
  function nomeTreino(r, rotulo, data, letra) {
    if (txt(r.nome)) return txt(r.nome);
    const inicio = !vazio(r.semana) ? `S${pad2(num(r.semana, 0))}${letra ? ' ' + letra : ''}` : ddmm(data);
    const pre = txt(r.prefixo);
    return `${pre ? pre + ' ' : ''}${inicio} · ${rotulo}`;
  }

  // =====================================================================
  // CARDIO (corrida, bike, natação, yoga… — tudo que é tempo/distância)
  // =====================================================================
  /** pace: s/km, só para estimar a duração de treino por distância. */
  const ESPORTES = {
    corrida:    { id: 1,  key: 'running',         nome: 'Corrida',    pace: 360 },
    bike:       { id: 2,  key: 'cycling',         nome: 'Bike',       pace: 120 },
    caminhada:  { id: 17, key: 'walking',         nome: 'Caminhada',  pace: 600 },
    trilha:     { id: 18, key: 'hiking',          nome: 'Trilha',     pace: 900 },
    natacao:    { id: 4,  key: 'swimming',        nome: 'Natação',    pace: 1200 },
    cardio:     { id: 6,  key: 'cardio_training', nome: 'Cardio' },
    hiit:       { id: 9,  key: 'hiit',            nome: 'HIIT' },
    yoga:       { id: 7,  key: 'yoga',            nome: 'Yoga' },
    pilates:    { id: 8,  key: 'pilates',         nome: 'Pilates' },
    mobilidade: { id: 11, key: 'mobility',        nome: 'Mobilidade' },
    outro:      { id: 3,  key: 'other',           nome: 'Outro' },
  };
  const NOME_POR_KEY = { strength_training: 'Musculação' };
  for (const e of Object.values(ESPORTES)) NOME_POR_KEY[e.key] = e.nome;
  /** "Natação", "natacao", vazio (= corrida) → chave de ESPORTES; '' se desconhecido. */
  const esporteDe = (r) => { const k = semAcento(r.esporte) || 'corrida'; return ESPORTES[k] ? k : ''; };

  const ST = { warmup: [1, 'warmup'], cooldown: [2, 'cooldown'], interval: [3, 'interval'], recovery: [4, 'recovery'], repeat: [6, 'repeat'] };
  const sT = (n) => ({ stepTypeId: ST[n][0], stepTypeKey: ST[n][1] });
  const fT = (s) => ({ endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' }, endConditionValue: s });
  const fD = (m) => ({ endCondition: { conditionTypeId: 3, conditionTypeKey: 'distance' }, endConditionValue: m });
  const SEM_ALVO = { targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' } };
  const zona = (z) => (z > 0 ? { targetType: { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone' }, zoneNumber: z } : SEM_ALVO);
  const passo = (o, t, f, a) => ({ type: 'ExecutableStepDTO', stepId: null, stepOrder: o, stepType: sT(t), ...f, ...a });
  const zTxt = (z) => (z > 0 ? ` Z${z}` : '');

  function tipoCardio(r) {
    const t = semAcento(r.tipo);
    if (t.startsWith('interval')) return 'intervalado';
    if (t.startsWith('cont')) return 'continuo';
    if (t.startsWith('dist')) return 'distancia';
    if (t.startsWith('prova')) return 'prova';
    return '';
  }

  function rotuloCardio(r) {
    const t = tipoCardio(r);
    const e = ESPORTES[esporteDe(r)] || ESPORTES.outro;
    const corrida = e === ESPORTES.corrida;
    if (t === 'distancia') return `${e.nome} ${g(num(r.distancia_km, 0))} km`;
    if (t === 'continuo') return corrida ? `Contínuo ${g(num(r.esforco_min, 0))} min` : `${e.nome} ${g(num(r.esforco_min, 0))} min`;
    let base;
    if (t === 'intervalado') {
      // minutos inteiros: "Intervalado 4:2" (como sempre foi); com segundos: "Intervalado 30s:90s"
      const a = num(r.esforco_min, 0), b = num(r.recuperacao_min, 0);
      const rot = (m) => { const s = Math.round(m * 60); return s % 60 === 0 ? `${s / 60}min` : `${s}s`; };
      base = Number.isInteger(+a.toFixed(4)) && Number.isInteger(+b.toFixed(4)) ? `Intervalado ${g(a)}:${g(b)}` : `Intervalado ${rot(a)}:${rot(b)}`;
    } else if (t === 'prova') base = `Prova ${g(num(r.distancia_km, 5))} km`;
    else return `? ${txt(r.tipo)}`;
    return corrida ? base : `${e.nome} ${base[0].toLowerCase()}${base.slice(1)}`;
  }

  /** Problemas que impedem montar o treino. */
  function validarCardio(r) {
    const av = [];
    const t = tipoCardio(r);
    if (!esporteDe(r)) av.push(`modalidade "${txt(r.esporte)}" desconhecida`);
    if (!t) av.push(`tipo "${txt(r.tipo)}" desconhecido (use intervalado / contínuo / distância / prova)`);
    if (t === 'intervalado') {
      if (!(num(r.reps, 0) > 0)) av.push('intervalado sem repetições');
      if (!(num(r.esforco_min, 0) > 0)) av.push('intervalado sem tempo de esforço');
      if (!(num(r.recuperacao_min, 0) > 0)) av.push('intervalado sem tempo de recuperação');
    }
    if (t === 'continuo' && !(num(r.esforco_min, 0) > 0)) av.push('contínuo sem duração');
    if ((t === 'prova' || t === 'distancia') && !(num(r.distancia_km, 0) > 0)) av.push(`${t === 'prova' ? 'prova' : 'treino'} sem distância`);
    return av;
  }

  function montarCardio(r, data) {
    const t = tipoCardio(r);
    const e = ESPORTES[esporteDe(r)];
    const sport = { sportTypeId: e.id, sportTypeKey: e.key };
    const aq = Math.round(num(r.aquecimento_min, 5) * 60);
    const des = Math.round(num(r.desaquecimento_min, 5) * 60);
    const ez = num(r.esforco_zona, t === 'prova' ? 4 : 3);
    const rz = num(r.recuperacao_zona, 1);
    let o = 0; const p = []; let corpo = ''; let dur = aq + des;

    if (aq > 0) p.push(passo(++o, 'warmup', fT(aq), SEM_ALVO));
    if (t === 'intervalado') {
      const reps = num(r.reps, 1), w = Math.round(num(r.esforco_min, 0) * 60), rc = Math.round(num(r.recuperacao_min, 0) * 60);
      const grp = { type: 'RepeatGroupDTO', stepId: null, stepOrder: ++o, stepType: sT('repeat'), numberOfIterations: reps, smartRepeat: false, workoutSteps: [] };
      grp.workoutSteps.push(passo(++o, 'interval', fT(w), zona(ez)));
      grp.workoutSteps.push(passo(++o, 'recovery', fT(rc), zona(rz)));
      p.push(grp);
      corpo = `${reps}x (${mm(w)}${zTxt(ez)} / ${mm(rc)}${zTxt(rz)})`;
      dur += reps * (w + rc);
    } else if (t === 'continuo') {
      const w = Math.round(num(r.esforco_min, 0) * 60);
      p.push(passo(++o, 'interval', fT(w), zona(ez)));
      corpo = `${mm(w)} contínuo${zTxt(ez)}`;
      dur += w;
    } else {
      const m = num(r.distancia_km, 5) * 1000;
      p.push(passo(++o, 'interval', fD(m), zona(ez)));
      corpo = `${g(m / 1000)} km${zTxt(ez)}`;
      dur = e.pace ? dur + (m / 1000) * e.pace : 0;
    }
    if (des > 0) p.push(passo(++o, 'cooldown', fT(des), SEM_ALVO));

    const partes = [aq > 0 ? `Aquec. ${mm(aq)}` : '', corpo, des > 0 ? `Desaq. ${mm(des)}` : ''].filter(Boolean);
    const plano = !vazio(r.semana) ? `${txt(r.plano) ? txt(r.plano) + ' · ' : ''}Semana ${pad2(num(r.semana, 0))}${txt(r.etapa) ? ' · Etapa ' + txt(r.etapa) : ''}\n` : '';
    let descricao = plano + partes.join(' + ');
    if (txt(r.notas)) descricao += `\nNota: ${txt(r.notas)}`;

    return {
      payload: {
        workoutName: nomeTreino(r, rotuloCardio(r), data),
        description: descricao,
        sportType: sport,
        workoutSegments: [{ segmentOrder: 1, sportType: sport, workoutSteps: p }],
      },
      resumo: corpo,
      duracaoMin: Math.round(dur / 60),
    };
  }

  // =====================================================================
  // MUSCULAÇÃO
  // =====================================================================
  const SPORT_STR = { sportTypeId: 5, sportTypeKey: 'strength_training', displayOrder: 5 };
  const GRUPO_CURTO = {
    'PEITO, OMBRO E TRÍCEPS': 'Peito/Ombro/Tríceps',
    'MEMBROS INFERIORES': 'Inferiores',
    'COSTAS E BÍCEPS': 'Costas/Bíceps',
    'OMBROS E ABDOMINAL': 'Ombro/Abdômen',
    'BÍCEPS E TRÍCEPS': 'Bíceps/Tríceps',
  };
  const tituloPy = (s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const grupoCurto = (grupo) => GRUPO_CURTO[txt(grupo).toUpperCase()] || tituloPy(txt(grupo));

  const repsLista = (reps) => {
    const n = String(vazio(reps) ? '' : reps).match(/\d+/g);
    return n ? n.map(Number) : [10];
  };
  /** Pirâmide vem com hífen "(15-12-10-8-6)"; "6 / 12" são dois passos na mesma série. */
  const ePiramide = (reps) => String(vazio(reps) ? '' : reps).includes('-');

  const COND_REPS = { conditionTypeId: 10, conditionTypeKey: 'reps', displayOrder: 10, displayable: true };
  const COND_TEMPO = { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true };
  const COND_LAP = { conditionTypeId: 1, conditionTypeKey: 'lap.button', displayOrder: 1, displayable: true };
  const COND_ITER = { conditionTypeId: 7, conditionTypeKey: 'iterations', displayOrder: 7, displayable: false };
  const T_WARMUP = { stepTypeId: 1, stepTypeKey: 'warmup', displayOrder: 1 };
  const T_INTERVAL = { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 };
  const T_REST = { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 };
  const T_REPEAT = { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 };

  const passoExercicio = (ordem, cat, ex, reps, nota, aquec) => ({
    type: 'ExecutableStepDTO', stepOrder: ordem, stepType: aquec ? T_WARMUP : T_INTERVAL,
    endCondition: COND_REPS, endConditionValue: reps, category: cat, exerciseName: ex, description: nota,
  });
  const passoDescanso = (ordem, seg) => ({
    type: 'ExecutableStepDTO', stepOrder: ordem, stepType: T_REST, endCondition: COND_TEMPO, endConditionValue: seg,
  });
  /** Descanso aberto, encerrado no botão Lap (troca de aparelho no bi-set). */
  const passoDescansoLap = (ordem, nota) => ({
    type: 'ExecutableStepDTO', stepOrder: ordem, stepType: T_REST, endCondition: COND_LAP, endConditionValue: null,
    description: nota || 'Troca de aparelho - aperte Lap para seguir',
  });
  const grupoRepeticao = (ordem, n, filhos) => ({
    type: 'RepeatGroupDTO', stepOrder: ordem, stepType: T_REPEAT, numberOfIterations: n, smartRepeat: false,
    endCondition: COND_ITER, endConditionValue: n, workoutSteps: filhos,
  });

  /** Blocos fixos de aquecimento, copiados dos treinos montados à mão. */
  const AQUECIMENTO = {
    superiores: [
      ['t', 240, 'WARM_UP', 'STRETCH_SHOULDER', 1],
      ['r', 15, 'SHOULDER_STABILITY', 'CABLE_EXTERNAL_ROTATION', 2],
      ['r', 15, 'SHOULDER_STABILITY', 'CABLE_INTERNAL_ROTATION', 2],
    ],
    inferiores: [
      ['t', 20, 'SQUAT', 'STAGGERED_SQUAT', 1],
      ['t', 60, 'WARM_UP', 'STRETCH_LUNGING_HIP_FLEXOR', 1],
      ['t', 40, 'HIP_STABILITY', 'LYING_ABDUCTION_STRETCH', 1],
      ['t', 30, 'WARM_UP', 'STRETCH_HIP_FLEXOR_AND_QUAD', 1],
      ['r', 20, 'SQUAT', 'SQUAT', 1],
    ],
  };
  const ROTULO_AQUEC = {
    superiores: 'Aquecimento/mobilidade · superiores',
    inferiores: 'Flexibilidade e mobilidade · inferiores',
  };
  const tipoAquecimento = (grupo) => (/INFERIOR|PERNA|GLUTEO|GLÚTEO/.test(txt(grupo).toUpperCase()) ? 'inferiores' : 'superiores');

  function montarAquecimento(ordem, tipo) {
    const nota = ROTULO_AQUEC[tipo];
    const passos = [];
    for (const [modo, valor, cat, ex, series] of AQUECIMENTO[tipo]) {
      const p = (o) => ({
        type: 'ExecutableStepDTO', stepOrder: o, stepType: T_WARMUP,
        endCondition: modo === 't' ? COND_TEMPO : COND_REPS, endConditionValue: valor,
        category: cat, exerciseName: ex, description: nota,
      });
      if (series > 1) { const go = ordem++; passos.push(grupoRepeticao(go, series, [p(ordem++)])); }
      else passos.push(p(ordem++));
    }
    return [passos, ordem];
  }

  /** Todo bloco vira grupo de séries (nada de passo solto). */
  function montarBloco(ordem, tecnica, exs) {
    const tec = txt(tecnica);
    const aq = tec.toUpperCase().startsWith('AQUEC');
    const multi = exs.length > 1;
    const e0 = exs[0];
    const r0 = e0.repsLista;
    const piramide = !multi && r0.length > 1 && ePiramide(e0.repsBruto);
    const duplo = !multi && r0.length > 1 && !piramide;
    const marca = (s) => (s ? ' · ' + s : '');

    if (piramide) {
      const seq = r0.join('-');
      const nota = `${e0.nomePt}${marca(tec)} ${seq} (baixe a rep a cada série)${marca(e0.notas)}`;
      const filhos = [passoExercicio(ordem + 1, e0.cat, e0.ex, r0[0], nota, aq), passoDescanso(ordem + 2, e0.descanso)];
      return [[grupoRepeticao(ordem, r0.length, filhos)], ordem + 3];
    }
    if (duplo) {
      const series = e0.series || 1;
      const filhos = []; let o = ordem + 1;
      r0.forEach((r, i) => {
        filhos.push(passoExercicio(o++, e0.cat, e0.ex, r, `${e0.nomePt} · ${tec ? tec + ' ' : ''}(${i + 1}/${r0.length})${marca(e0.notas)}`, aq));
        if (i < r0.length - 1) filhos.push(passoDescansoLap(o++, 'Troque a carga - aperte Lap para seguir'));
      });
      filhos.push(passoDescanso(o++, e0.descanso));
      return [[grupoRepeticao(ordem, series, filhos)], o];
    }
    const series = e0.series || 1;
    const go = ordem++;
    const filhos = [];
    exs.forEach((e, j) => {
      const m = multi ? `${tec ? tec + ' ' : ''}(${j + 1}/${exs.length})` : tec;
      filhos.push(passoExercicio(ordem++, e.cat, e.ex, e.repsLista[0], `${e.nomePt}${marca(m)}${marca(e.notas)}`, aq));
      if (multi && j < exs.length - 1) filhos.push(passoDescansoLap(ordem++));
    });
    filhos.push(passoDescanso(ordem++, e0.descanso));
    return [[grupoRepeticao(go, series, filhos)], ordem];
  }

  /** Chave tolerante para o De-para: sem acento, sem espaço sobrando ("TRICEPS C/CORDA" = "TRÍCEPS C/ CORDA"). */
  const chaveSolta = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s*\/\s*/g, '/ ').replace(/\s+/g, ' ').trim();

  /** Chave do treino de musculação de uma linha: `sessao`, ou semana+letra (planilha antiga). */
  const sessaoDe = (row) => (txt(row.sessao) || `${txt(row.semana)}|${txt(row.treino).toUpperCase()}`);

  /** Agrupa as linhas da aba Musculação em treinos. */
  function agruparMusculacao(linhas, depara) {
    const dias = new Map();
    for (const row of linhas) {
      if (vazio(row.sessao) && (vazio(row.semana) || vazio(row.treino))) continue;
      const chave = 'm|' + sessaoDe(row);
      if (!dias.has(chave)) {
        dias.set(chave, {
          linha: row, semana: vazio(row.semana) ? null : Number(row.semana), treino: txt(row.treino).toUpperCase(),
          grupo: txt(row.grupo), data: null, blocos: new Map(), aquecimento: null, avisos: [],
        });
      }
      const d = dias.get(chave);
      if (!d.data) d.data = dataIso(row.data);
      const nomePt = txt(row.exercicio);
      if (!num(row.series, 0)) {                       // linha de aquecimento (sem séries)
        if (d.aquecimento === null) d.aquecimento = nomePt || 'AQUECIMENTO';
        continue;
      }
      if (!nomePt) { d.avisos.push('exercício sem nome — fica de fora'); continue; }
      const m = depara[nomePt.toUpperCase()] || depara['~' + chaveSolta(nomePt)];
      if (!m || !m.cat || !m.ex) { d.avisos.push(`"${nomePt}" sem par no De-para — fica de fora`); continue; }
      const bloco = vazio(row.bloco) ? '·' : String(row.bloco);
      if (!d.blocos.has(bloco)) d.blocos.set(bloco, { tecnica: row.tecnica, exs: [] });
      d.blocos.get(bloco).exs.push({
        cat: m.cat, ex: m.ex, repsLista: repsLista(row.reps), repsBruto: row.reps,
        series: parseInt(row.series, 10), descanso: parseInt(num(row.descanso_seg, 0) || 60, 10), nomePt,
        notas: txt(row.notas),
      });
    }
    return dias;
  }

  function montarMusculacao(d) {
    let passos = [], ordem = 1;
    if (d.aquecimento) { const [b, o] = montarAquecimento(ordem, tipoAquecimento(d.grupo)); passos = passos.concat(b); ordem = o; }
    for (const [, b] of d.blocos) { const [bl, o] = montarBloco(ordem, b.tecnica, b.exs); passos = passos.concat(bl); ordem = o; }
    const r = d.linha;
    const nome = nomeTreino(r, grupoCurto(d.grupo) || 'Musculação', d.data, d.semana !== null ? d.treino : '');
    const descricao = d.semana !== null
      ? `${txt(r.plano) ? txt(r.plano) + ' · ' : ''}Musculação · Semana ${pad2(d.semana)} · Treino ${d.treino} · ${d.grupo}`
      : `Musculação${d.grupo ? ' · ' + d.grupo : ''}`;
    return {
      payload: {
        workoutName: nome,
        description: descricao,
        sportType: SPORT_STR,
        workoutSegments: [{ segmentOrder: 1, sportType: SPORT_STR, workoutSteps: passos }],
      },
      resumo: `${d.blocos.size} blocos · ${[...d.blocos.values()].reduce((s, b) => s + b.exs.length, 0)} exercícios`,
    };
  }

  // =====================================================================
  // Todos os treinos
  // =====================================================================
  /**
   * @param plano {cardio:[linhas], musculacao:[linhas], depara:{PT:{cat,ex}}}
   * @returns lista de treinos {chave,tipo,esporte,semana,etapa,treino,grupo,data,nome,resumo,duracaoMin,payload,avisos,bloqueado}
   */
  function montarPlano(plano) {
    const out = [];

    (plano.cardio || []).forEach((r) => {
      const data = dataIso(r.data);
      const problemas = validarCardio(r);
      const m = problemas.length ? { payload: null, resumo: '', duracaoMin: 0 } : montarCardio(r, data);
      const avisos = problemas.slice();
      if (!data) avisos.push('sem data');
      out.push({
        chave: `c|${r._id}`, tipo: 'cardio', esporte: esporteDe(r) || 'outro',
        semana: vazio(r.semana) ? null : Number(r.semana), etapa: txt(r.etapa),
        data, nome: m.payload ? m.payload.workoutName : nomeTreino(r, rotuloCardio(r), data),
        resumo: m.resumo, duracaoMin: m.duracaoMin, payload: m.payload, avisos,
      });
    });

    const etapaDaSemana = {};
    out.forEach((t) => { if (t.semana !== null && t.etapa) etapaDaSemana[t.semana] = t.etapa; });

    for (const [chave, d] of agruparMusculacao(plano.musculacao || [], plano.depara || {})) {
      const m = montarMusculacao(d);
      const avisos = d.avisos.slice();
      if (!d.data) avisos.push('sem data');
      if (!d.blocos.size) avisos.push('nenhum exercício válido');
      out.push({
        chave, tipo: 'musculacao', esporte: 'musculacao', semana: d.semana, treino: d.treino, grupo: d.grupo,
        etapa: d.semana !== null ? etapaDaSemana[d.semana] || '' : '', data: d.data, nome: m.payload.workoutName,
        resumo: m.resumo, duracaoMin: 0, payload: d.blocos.size ? m.payload : null, avisos,
      });
    }

    // nomes repetidos quebram o dedupe (o Garmin é consultado pelo nome)
    const cont = {};
    out.forEach((t) => (cont[t.nome] = (cont[t.nome] || 0) + 1));
    out.forEach((t) => {
      t.repetido = cont[t.nome] > 1;
      if (t.repetido) t.avisos.push(`nome repetido ("${t.nome}") — o Garmin identifica o treino pelo nome; mude um deles`);
      t.bloqueado = !t.payload || t.repetido;
    });

    out.sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999') || (a.tipo === 'cardio' ? -1 : 1));
    return out;
  }

  /** Linhas "legíveis" da estrutura de um treino, como o relógio mostra. */
  function estrutura(payload) {
    if (!payload) return [];
    const linhas = [];
    const esporte = NOME_POR_KEY[payload.sportType && payload.sportType.sportTypeKey] || 'Esforço';
    const nomeEx = (s) => (s.exerciseName ? s.exerciseName.replace(/_/g, ' ').toLowerCase() : '');
    const fim = (s) => {
      const k = s.endCondition && s.endCondition.conditionTypeKey;
      if (k === 'time') return mm(s.endConditionValue);
      if (k === 'distance') return `${g(s.endConditionValue / 1000)} km`;
      if (k === 'reps') return `${s.endConditionValue} reps`;
      if (k === 'lap.button') return 'até Lap';
      return '';
    };
    const alvo = (s) => (s.zoneNumber ? ` · Z${s.zoneNumber}` : '');
    const rot = { warmup: 'Aquecimento', cooldown: 'Desaquecimento', interval: '', recovery: 'Recuperação', rest: 'Descanso' };
    const linha = (s) => {
      const k = s.stepType.stepTypeKey;
      const ex = nomeEx(s);
      const base = ex ? `${ex} · ${fim(s)}` : `${rot[k] || esporte} ${fim(s)}${alvo(s)}`;
      return { tipo: k, texto: base.trim(), nota: s.description && ex ? s.description : '' };
    };
    for (const s of payload.workoutSegments[0].workoutSteps) {
      if (s.type === 'RepeatGroupDTO') linhas.push({ tipo: 'repeat', series: s.numberOfIterations, filhos: s.workoutSteps.map(linha) });
      else linhas.push(linha(s));
    }
    return linhas;
  }

  const API = {
    DIA_SEMANA, NOME_DIA, TREINOS, DIAS_MUSC_PADRAO, ESPORTES, GRUPO_CURTO, AQUECIMENTO, ROTULO_AQUEC,
    addDias, diaDaSemana, segundaDe, dataIso, offsetsMusc, datarPlano, prepararLinhas, montarPlano, estrutura,
    tipoCardio, esporteDe, grupoCurto, tipoAquecimento, repsLista, ePiramide, chaveSolta, sessaoDe,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.THBuilder = API;
})(typeof window !== 'undefined' ? window : globalThis);
