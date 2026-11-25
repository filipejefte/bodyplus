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

  function treinosParaModelo() {
    const desde = B.segundaDe(A.hoje);
    const L = A.linhas();
    return A.treinos()
      .filter((t) => !t.data || t.data >= desde)
      .sort((a, b) => String(a.data).localeCompare(String(b.data)))
      .slice(0, 60)
      .map((t) => {
        if (t.tipo === 'cardio') {
          const r = L.cardio.find((x) => 'c|' + x._id === t.chave) || {};
          return semVazios({ id: t.chave, data: t.data, nome: t.nome, modalidade: r.esporte, tipo: B.tipoCardio(r), ...Object.fromEntries(CAMPOS_CARDIO.slice(1).map((c) => [c, r[c]])) });
        }
        const rows = L.musculacao.filter((x) => 'm|' + B.sessaoDe(x) === t.chave && Number(x.series));
        return semVazios({
          id: t.chave, data: t.data, nome: t.nome, modalidade: 'musculacao', grupo: rows[0] && rows[0].grupo,
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
    const rotulos = ['Esta semana', 'Semana que vem', 'Daqui a 2 semanas', 'Daqui a 3 semanas'];
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
      '- criar: quando (semana e dia), modalidade e os campos do treino.',
      '- alterar: id de um treino da lista e só os campos que mudam.',
      '- mover: id e o novo quando (semana e dia).',
      '- excluir: id.',
      'Se a pessoa só perguntar algo, responda e deixe "acoes" vazia. Não faça mudanças que ela não pediu. Use só ids da lista.',
      'Em "resposta", diga em uma ou duas frases o que você propõe (a lista das mudanças a pessoa já vê).',
      '',
      'Campos:',
      '- quando: semana (0 = esta semana, 1 = semana que vem, 2 = daqui a 2 semanas…) e dia (segunda, terça, quarta, quinta, sexta, sábado, domingo).',
      '  "sábado" = semana 0, dia sábado. "segunda que vem" ou "próxima segunda" = semana 1, dia segunda. Um plano de 4 semanas a partir da semana que vem usa semana 1, 2, 3 e 4.',
      '  Se a pessoa disser um dia do mês ("dia 12", "12/12"), use dia_do_mes (e mes, se ela disser).',
      '  Exemplos: "corrida leve no sábado" → {"acao":"criar","semana":0,"dia":"sábado","modalidade":"corrida","tipo":"contínuo","esforco_min":30,"esforco_zona":2}',
      '  "tiros na quarta" → {"acao":"criar","semana":0,"dia":"quarta","modalidade":"corrida","tipo":"intervalado","reps":6,"esforco_min":1,"esforco_zona":4,"recuperacao_min":2,"recuperacao_zona":1,"aquecimento_min":10,"desaquecimento_min":5}',
      '  "passa o treino de pernas para segunda que vem" → {"acao":"mover","id":"<id do treino de pernas>","semana":1,"dia":"segunda"}',
      `- modalidade: ${ESPORTES.join(', ')} ou musculacao.`,
      '- cardio: tipo contínuo (esforco_min), intervalado (reps, esforco_min, recuperacao_min), distância (distancia_km) ou prova (só corrida; distancia_km).',
      '  Minutos podem ter decimais (0.5 = 30 s). Zonas de FC de 1 a 5; 0 = sem alvo. aquecimento_min e desaquecimento_min são opcionais. notas aparece no relógio.',
      '- musculacao: grupo (ex.: "Pernas", "Costas/Bíceps") e exercicios [{exercicio, series, reps, descanso_seg}].',
      '  reps é texto: "12" (todas as séries) ou "15-12-10" (pirâmide, uma por série). Prefira os nomes da lista de exercícios conhecidos (já têm par no Garmin).',
      '- nome: deixe vazio para o nome automático.',
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
    if (Number.isInteger(a.semana) && a.semana >= 0 && DIAS.includes(a.dia)) {
      return { ...a, data: B.addDias(B.segundaDe(A.hoje), a.semana * 7 + DIAS.indexOf(a.dia)) };
    }
    if (Number.isInteger(a.dia_do_mes) && a.dia_do_mes >= 1 && a.dia_do_mes <= 31) {
      // o próximo dia com esse número (no mês dito, ou neste/no próximo)
      const [ano, mesHoje] = A.hoje.split('-').map(Number);
      const iso = (y, m) => `${y}-${String(m).padStart(2, '0')}-${String(a.dia_do_mes).padStart(2, '0')}`;
      let y = ano, m = Number.isInteger(a.mes) && a.mes >= 1 && a.mes <= 12 ? a.mes : mesHoje;
      if (iso(y, m) < A.hoje) { if (Number.isInteger(a.mes)) y++; else if (++m > 12) { m = 1; y++; } }
      return { ...a, data: iso(y, m) };
    }
    return a;
  }
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
        return { texto: `Criar musculação${a.grupo ? ' · ' + a.grupo : ''} em ${A.fmtData(a.data)}: ${listaEx(a.exercicios)}` };
      }
      if (!B.ESPORTES[a.modalidade]) return { erro: `modalidade "${a.modalidade}" não existe` };
      const final = { ...(A.NOVO[a.modalidade] || A.NOVO_PADRAO), ...semVazios(Object.fromEntries(CAMPOS_CARDIO.map((c) => [c, a[c]]))) };
      return { texto: `Criar ${nomeModalidade(a.modalidade).toLowerCase()} em ${A.fmtData(a.data)}: ${resumoCardio(final)}` };
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
    return { texto: `Alterar ${alvo}: ${campos.map((c) => (c === 'exercicios' ? listaEx(a.exercicios) : `${c} = ${c === 'data' ? A.fmtData(a[c]) : a[c]}`)).join(', ')}` };
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
      if (a.modalidade === 'musculacao') {
        const sessao = A.novoId();
        linhasMusc(atual, a).forEach((r) => atual.musculacao.push({ ...r, sessao, data: a.data, nome: a.nome || null, grupo: a.grupo || '' }));
      } else {
        atual.cardio.push({ _id: A.novoId(), data: a.data, esporte: a.modalidade, nome: a.nome || null, aquecimento_min: 0, desaquecimento_min: 0, ...(A.NOVO[a.modalidade] || A.NOVO_PADRAO), ...valores(a) });
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
        rodape.innerHTML = `<span class="ia-status">${boas.length} mudança${boas.length > 1 ? 's' : ''} aplicada${boas.length > 1 ? 's' : ''}.</span><button class="btn btn-claro" data-ia="desfazer">Desfazer</button>`;
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
