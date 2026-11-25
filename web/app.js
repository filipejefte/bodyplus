/**
 * Body+ · interface
 * =================
 * Seus treinos por semana, cada um na sua data e em qualquer modalidade:
 * crie, edite, duplique, importe um plano (PDF do Time Híbrido ou planilha)
 * e envie ao Garmin Connect (pela extensão ou por um script colado na aba). Tudo roda no
 * navegador; as edições ficam guardadas aqui até você baixar a planilha.
 */
(function () {
  'use strict';
  const B = window.THBuilder;
  const U = window.THUploader;
  // extensão do Body+ (pasta extensao/) instalada: envia com um clique em vez de gerar o script.
  // A marca é a assinatura do uploader.js da extensão; diferente da daqui = extensão não recarregada.
  const MARCA_EXT = document.documentElement.dataset.bodyplusExtensao;
  const COM_EXTENSAO = !!MARCA_EXT;
  const EXT_EM_DIA = MARCA_EXT === U.hash(U.thEnviar.toString());
  const EXT_VELHA = 'A extensão do Body+ está desatualizada: na página de extensões do navegador, clique em recarregar nela, e depois recarregue esta página (Ctrl+F5).';

  const PLANILHA_PROJETO = 'data/treinos.xlsx';
  const CATALOGO = 'data/garmin_exercises.json';
  const CHAVE_LS = 'bodyplus:v1';
  const CHAVE_LS_ANTIGA = 'th-garmin-ui:v1';   // versão Time Híbrido → migrada na primeira abertura
  /** Âncora do plano do Time Híbrido em uso antes das datas fixas (estado/planilha sem a coluna data). */
  const LEGADO = { inicio: '2026-08-31', diasMusc: { ...B.DIAS_MUSC_PADRAO }, plano: 'Time Híbrido' };

  // ---------------------------------------------------------------------
  // Doação via Pix — o valor é livre (o QR não tem valor fixo).
  // ---------------------------------------------------------------------
  // QR estático sem valor (campo 54 ausente) — conferido: chave, recebedor e CRC.
  const PIX = {
    chave: '+5514996272582',        // vai para a área de transferência (celular com +55)
    exibir: '(14) 99627-2582',
    qr: 'assets/pix-qr.png',        // gerado a partir do código abaixo
    copiaECola: '00020126360014BR.GOV.BCB.PIX0114+55149962725825204000053039865802BR5923FILIPE JEFTE DE CAMARGO6007MARILIA62070503***6304468D',
    recebedor: 'Filipe Jefte de Camargo',
  };

  const COLUNAS = {
    cardio: ['data', 'esporte', 'nome', 'tipo', 'aquecimento_min', 'reps', 'esforco_min', 'esforco_zona', 'recuperacao_min', 'recuperacao_zona', 'desaquecimento_min', 'distancia_km', 'notas', 'prefixo', 'plano', 'semana', 'etapa', 'dia'],
    musculacao: ['sessao', 'data', 'nome', 'grupo', 'bloco', 'tecnica', 'exercicio', 'series', 'reps', 'descanso_seg', 'notas', 'prefixo', 'plano', 'semana', 'treino'],
    depara: ['exercicio_pt', 'garmin_category', 'garmin_exercise', 'garmin_label', 'confianca', 'obs'],
  };
  /** Campos que valem para o treino de musculação inteiro (repetidos em cada linha). */
  const CAMPOS_SESSAO = ['sessao', 'data', 'nome', 'grupo', 'prefixo', 'plano', 'semana', 'treino'];
  const TECNICAS = ['AQUECIMENTO', 'BI-SET', 'SUPER-SET', 'DROP-SET', 'PIRÂMIDE', 'META DE REPETIÇÃO', '6 PESADAS 12 LEVES'];
  const GRUPOS = [...Object.keys(B.GRUPO_CURTO), 'Pernas', 'Superiores', 'Full body', 'Core'];
  /** Valores iniciais de um treino novo (aquecimento/desaquecimento em branco = 0). */
  const NOVO = {
    corrida:   { tipo: 'contínuo', esforco_min: 30, esforco_zona: 2, aquecimento_min: 5, desaquecimento_min: 5 },
    bike:      { tipo: 'contínuo', esforco_min: 60, esforco_zona: 2, aquecimento_min: 10, desaquecimento_min: 5 },
    caminhada: { tipo: 'contínuo', esforco_min: 45, esforco_zona: 0 },
    trilha:    { tipo: 'contínuo', esforco_min: 90, esforco_zona: 0 },
    natacao:   { tipo: 'distância', distancia_km: 1.5, esforco_zona: 0 },
    hiit:      { tipo: 'intervalado', reps: 8, esforco_min: 0.5, esforco_zona: 4, recuperacao_min: 0.5, recuperacao_zona: 0, aquecimento_min: 5, desaquecimento_min: 5 },
  };
  const NOVO_PADRAO = { tipo: 'contínuo', esforco_min: 30, esforco_zona: 0 };
  /** Família de cor do cartão. */
  const FAMILIA = { corrida: 'resist', bike: 'resist', caminhada: 'resist', trilha: 'resist', natacao: 'resist', musculacao: 'forca', yoga: 'leve', pilates: 'leve', mobilidade: 'leve' };

  const LEIA_ME = [
    ['Body+ — planilha de treinos'],
    [null],
    ['Gerada pela página do Body+. Abra de volta em "Importar" → "Substituir tudo" para continuar de onde parou.'],
    [null],
    ['Aba CARDIO — uma linha por treino:'],
    ["  'data' AAAA-MM-DD · 'esporte': corrida, bike, caminhada, trilha, natacao, cardio, hiit, yoga, pilates, mobilidade, outro."],
    ["  'tipo': intervalado (reps/esforço/recuperação) · contínuo (esforço) · distância · prova (distância, Z4)."],
    ["  zonas de FC 1–5 (0 = sem alvo) · 'notas' vai na descrição e aparece no relógio."],
    ["  'nome' em branco = automático (25/11 · Contínuo 30 min)."],
    [null],
    ['Aba MUSCULAÇÃO — uma linha por exercício; linhas com a mesma sessao formam um treino:'],
    ["  mesmo 'bloco' = bi-set/super-set · reps: 15 · 6 / 12 (dois pesos) · (15-12-10-8-6) pirâmide."],
    ["  linha sem 'series' = aquecimento automático."],
    [null],
    ['Aba DE-PARA — exercício → catálogo do Garmin (garmin_category / garmin_exercise).'],
    [null],
    ["Colunas semana/etapa/dia/treino/plano vêm de planos importados (ex.: Time Híbrido)."],
    ['Zonas de FC (defina no Garmin por % da FCmáx): Z1 50–59% · Z2 60–69% · Z3 70–79% · Z4 80–89% · Z5 90–95%'],
  ];

  // ---------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------
  let S = null;            // {fonte, base, atual, colunas, enviados}
  let D = { treinos: [], porChave: new Map(), base: new Map() };
  const UI = {
    filtro: 'tudo', esconderPassadas: true, sel: new Set(), aberto: null, catalogo: null,
    envio: { agendar: 'mover', existente: 'pular', simular: false }, script: null, importacao: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const hoje = (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const vazio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  const pad2 = (n) => String(n).padStart(2, '0');
  const novoId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const juntar = (a, b) => [...a, ...b.filter((c) => !a.includes(c))];
  const limparPrefixo = (v) => String(v || '').trim().toUpperCase().replace(/[^\p{L}\p{N}\-_.]/gu, '');

  function fmtData(iso, comDia = true) {
    if (!iso) return 'sem data';
    return `${comDia ? B.NOME_DIA[B.diaDaSemana(iso)] + ' ' : ''}${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('on'), ms);
  }

  function proximaSegunda() {
    const wd = B.diaDaSemana(hoje);
    return B.addDias(hoje, wd === 0 ? 0 : 7 - wd);
  }

  // ---------------------------------------------------------------------
  // Arquivos → linhas
  // ---------------------------------------------------------------------
  function lerPlanilha(buf) {
    if (typeof XLSX === 'undefined') throw new Error('a biblioteca de planilhas não carregou (sem internet?)');
    const wb = XLSX.read(buf, { type: 'array' });
    const aba = (...alvos) => wb.SheetNames.find((n) => alvos.includes(semAcento(n)));
    const linhas = (n) => {
      if (!n) return { rows: [], cols: [] };
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true });
      if (!aoa.length) return { rows: [], cols: [] };
      const cols = aoa[0].map((h) => (h === null ? '' : String(h).trim().toLowerCase()));
      const rows = aoa.slice(1)
        .filter((r) => r.some((c) => !vazio(c)))
        .map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] === undefined ? null : r[i]]).filter(([c]) => c)));
      return { rows, cols: cols.filter(Boolean) };
    };
    const car = linhas(aba('cardio', 'corrida'));
    const mus = linhas(aba('musculacao'));
    const dp = linhas(aba('de-para'));
    if (!car.rows.length && !mus.rows.length) throw new Error('não achei as abas "Cardio" (ou "Corrida") e "Musculação" nessa planilha');
    return {
      dados: { cardio: car.rows, musculacao: mus.rows, depara: dp.rows },
      colunas: { cardio: car.cols, musculacao: mus.cols, depara: dp.cols },
    };
  }

  /** PDF do Time Híbrido → as mesmas linhas da planilha (sem datas: entram na importação). */
  async function lerPdf(buf, aoProgresso) {
    if (!window.THPdf) throw new Error('o leitor de PDF não carregou');
    const paginas = await THPdf.extrairPaginas(buf, aoProgresso);
    const r = THPdf.lerPlano(paginas);
    if (!r.corrida.length && !r.musculacao.length) {
      throw new Error('não reconheci os treinos nesse PDF. Por enquanto só o PDF do plano do Time Híbrido é lido. (' + (r.avisos[0] || '') + ')');
    }
    return {
      dados: { cardio: r.corrida, musculacao: r.musculacao, depara: clone(window.TH_DEPARA_PADRAO || []) },
      colunas: { cardio: [], musculacao: [], depara: [] },
      avisos: r.avisos, titulo: r.plano, semanas: r.semanas, paginas: paginas.length,
    };
  }

  /** De-para: `a` vale mais; de `b` entram só os exercícios que `a` não tem. */
  function juntarDepara(a, b) {
    const chave = (d) => String(d.exercicio_pt || '').trim().toUpperCase();
    const tem = new Set(a.map(chave));
    return [...clone(a), ...clone(b).filter((d) => chave(d) && !tem.has(chave(d)))];
  }

  function novoEstado(fonte, dados, colunas) {
    const cols = colunas || {};
    return {
      fonte, base: dados, atual: clone(dados), enviados: {},
      colunas: { cardio: juntar(COLUNAS.cardio, cols.cardio || []), musculacao: juntar(COLUNAS.musculacao, cols.musculacao || []), depara: juntar(COLUNAS.depara, cols.depara || []) },
    };
  }
  const estadoVazio = () => novoEstado('', { cardio: [], musculacao: [], depara: clone(window.TH_DEPARA_PADRAO || []) });

  /** Estado da versão Time Híbrido (semana + dia + âncora global) → datas fixas. */
  function migrarAntigo(v) {
    const c = v.config || {};
    const opc = { inicio: c.inicio || LEGADO.inicio, diasMusc: { ...LEGADO.diasMusc, ...(c.diasMusc || {}) }, plano: LEGADO.plano, prefixo: c.prefixo || '' };
    const conv = (x) => B.prepararLinhas({ cardio: x.corrida || [], musculacao: x.musculacao || [], depara: x.depara || [] }, opc);
    const cols = v.colunas || {};
    return { ...novoEstado(v.fonte || '', conv(v.base), { cardio: cols.corrida, musculacao: cols.musculacao, depara: cols.depara }), atual: conv(v.atual) };
  }

  function salvar() {
    try { localStorage.setItem(CHAVE_LS, JSON.stringify(S)); }
    catch (e) { toast('Não consegui guardar as edições neste navegador — baixe a planilha para não perder.'); }
  }

  function carregarSalvo() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE_LS) || 'null');
      if (s && s.base && s.atual) return s;
      const v = JSON.parse(localStorage.getItem(CHAVE_LS_ANTIGA) || 'null');
      if (v && v.base && v.atual) return migrarAntigo(v);
    } catch (e) { console.error(e); }
    return null;
  }

  async function carregarDoProjeto() {
    const r = await fetch(PLANILHA_PROJETO, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { dados, colunas } = lerPlanilha(await r.arrayBuffer());
    B.prepararLinhas(dados, LEGADO);
    dados.depara = juntarDepara(dados.depara, window.TH_DEPARA_PADRAO || []);
    return novoEstado(PLANILHA_PROJETO, dados, colunas);
  }

  function baixarPlanilha() {
    if (typeof XLSX === 'undefined') { toast('A biblioteca de planilhas não carregou (sem internet?).'); return; }
    const wb = XLSX.utils.book_new();
    const sem = (rows, cols) => rows.map((r) => Object.fromEntries(cols.map((c) => [c, vazio(r[c]) ? null : r[c]])));
    const aba = (rows, cols, nome, larguras) => {
      const ws = XLSX.utils.json_to_sheet(sem(rows, cols), { header: cols });
      ws['!cols'] = cols.map((c) => ({ wch: larguras[c] || Math.max(10, c.length + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, nome);
    };
    aba(S.atual.cardio, S.colunas.cardio, 'Cardio', { data: 12, nome: 28, notas: 30 });
    aba(S.atual.musculacao, S.colunas.musculacao, 'Musculação', { sessao: 14, data: 12, nome: 24, grupo: 24, tecnica: 20, exercicio: 44, notas: 30 });
    aba(S.atual.depara, S.colunas.depara, 'De-para', { exercicio_pt: 40, garmin_category: 22, garmin_exercise: 36, garmin_label: 36, obs: 30 });
    const ws = XLSX.utils.aoa_to_sheet(LEIA_ME); ws['!cols'] = [{ wch: 110 }]; XLSX.utils.book_append_sheet(wb, ws, 'Leia-me');
    XLSX.writeFile(wb, 'treinos.xlsx');
    toast('Planilha baixada. Substitua data/treinos.xlsx por ela para guardar tudo no projeto.', 5000);
  }

  // ---------------------------------------------------------------------
  // Treinos derivados
  // ---------------------------------------------------------------------
  const mapaDepara = (rows) => {
    const m = {};
    rows.forEach((d) => {
      const pt = String(d.exercicio_pt || '').trim().toUpperCase();
      if (!pt) return;
      m[pt] = { cat: d.garmin_category, ex: d.garmin_exercise };
      const solta = '~' + B.chaveSolta(pt);
      if (!m[solta]) m[solta] = m[pt];
    });
    return m;
  };
  const montar = (dados) => B.montarPlano({ cardio: dados.cardio, musculacao: dados.musculacao, depara: mapaDepara(dados.depara) });

  function recalcularBase() {
    D.base = new Map(montar(S.base).map((t) => [t.chave, { json: JSON.stringify(t.payload), nome: t.nome, data: t.data }]));
  }

  function recalcular() {
    D.treinos = montar(S.atual);
    D.porChave = new Map(D.treinos.map((t) => [t.chave, t]));
    const enviados = S.enviados || (S.enviados = {});
    for (const t of D.treinos) {
      const b = D.base.get(t.chave);
      const env = enviados[t.chave];        // {nomes, data} do último script gerado com ele
      t.novo = !b;
      // nomes com que o treino já existiu (na planilha ou num script gerado): o envio substitui esses no Garmin
      t.antigos = [...new Set([b && b.nome, ...((env && env.nomes) || [])])].filter((n) => n && n !== t.nome);
      t.editado = !b || b.json !== JSON.stringify(t.payload) || t.antigos.length > 0;
      t.dataAntiga = env ? env.data : b && b.data;
      t.dataMudou = !!t.dataAntiga && t.dataAntiga !== t.data;
    }
    for (const k of [...UI.sel]) if (!D.porChave.has(k)) UI.sel.delete(k);
  }

  const visivel = (t) => UI.filtro === 'tudo' || t.tipo === UI.filtro;

  function selecionar(preset) {
    const regra = {
      futuro: (t) => t.data && t.data >= hoje,
      todos: () => true,
      editados: (t) => t.editado,
      nenhum: () => false,
    }[preset];
    UI.sel = new Set(D.treinos.filter((t) => visivel(t) && regra(t)).map((t) => t.chave));
  }

  const PACE = Object.fromEntries(Object.values(B.ESPORTES).map((e) => [e.key, e.pace || 360]));
  const ALTURA_ZONA = [0, 30, 45, 62, 80, 100];

  /** Forma do treino: uma barra por passo, largura = tempo, altura e cor = zona de FC. */
  function perfil(payload, classe = '') {
    if (!payload) return '';
    const pace = PACE[payload.sportType.sportTypeKey] || 360;
    const barras = [];
    const passo = (s) => {
      const k = s.endCondition && s.endCondition.conditionTypeKey;
      const seg = k === 'time' ? s.endConditionValue : k === 'distance' ? (s.endConditionValue / 1000) * pace : k === 'reps' ? s.endConditionValue * 3 : 20;
      const tipo = s.stepType.stepTypeKey;
      const [z, h] = tipo === 'rest' ? ['z0', 12]
        : s.zoneNumber ? ['z' + s.zoneNumber, ALTURA_ZONA[s.zoneNumber]]
        : tipo === 'interval' ? ['zx', 60] : ['z0', 25];
      const ult = barras[barras.length - 1];
      if (ult && ult.z === z && ult.h === h) ult.s += seg;   // vizinhos iguais viram uma barra só
      else barras.push({ s: Math.max(1, seg), z, h });
    };
    for (const s of payload.workoutSegments[0].workoutSteps) {
      if (s.type === 'RepeatGroupDTO') for (let i = 0; i < s.numberOfIterations; i++) s.workoutSteps.forEach(passo);
      else passo(s);
    }
    return `<span class="perfil ${classe}" aria-hidden="true">${barras.map((b) => `<i class="${b.z}" style="flex-grow:${Math.round(b.s)};height:${b.h}%"></i>`).join('')}</span>`;
  }

  const modalidade = (t) => (t.tipo === 'cardio' ? B.ESPORTES[t.esporte].nome : 'Musculação' + (t.semana !== null && t.treino ? ' · ' + t.treino : ''));

  // ---------------------------------------------------------------------
  // Render: cabeçalho, filtros, semanas
  // ---------------------------------------------------------------------
  function renderFonte() {
    const n = D.treinos.length;
    const nN = D.treinos.filter((t) => t.novo).length;
    const nE = D.treinos.filter((t) => t.editado && !t.novo).length;
    $('#fonte').innerHTML = n
      ? `<b>${n}</b> treino${n > 1 ? 's' : ''}` + (nN ? ` · <span class="tag-novo">${nN} novo${nN > 1 ? 's' : ''}</span>` : '') + (nE ? ` · <span class="tag-editado">${nE} editado${nE > 1 ? 's' : ''}</span>` : '')
      : '';
  }

  function renderFiltros() {
    $$('#filtro button').forEach((b) => b.classList.toggle('ativo', b.dataset.f === UI.filtro));
    $('#cfg-passadas').checked = UI.esconderPassadas;
  }

  function cartao(t) {
    const passado = t.data && t.data < hoje;
    const sel = UI.sel.has(t.chave);
    const badges = [];
    if (t.data === hoje) badges.push('<span class="badge badge-hoje">hoje</span>');
    if (t.novo) badges.push('<span class="badge badge-novo">novo</span>');
    else if (t.editado) badges.push('<span class="badge badge-editado">editado</span>');
    if (t.avisos.length) badges.push(`<span class="badge badge-aviso" title="${esc(t.avisos.join('\n'))}">⚠ ${t.avisos.length}</span>`);
    const meta = t.tipo === 'cardio' ? (t.duracaoMin ? `~${t.duracaoMin} min` : '') : esc(t.resumo);
    return `
      <article class="cartao fam-${FAMILIA[t.esporte] || 'outro'} ${passado ? 'passado' : ''} ${sel ? 'sel' : ''} ${t.bloqueado ? 'bloqueado' : ''}" data-chave="${esc(t.chave)}">
        <label class="cartao-check" title="Selecionar para enviar">
          <input type="checkbox" data-sel="${esc(t.chave)}" ${sel ? 'checked' : ''} ${t.bloqueado ? 'disabled' : ''} aria-label="Selecionar ${esc(t.nome)}">
        </label>
        <button class="cartao-corpo" data-abrir="${esc(t.chave)}">
          <span class="cartao-data">${fmtData(t.data)} <span class="cartao-tipo">${esc(modalidade(t))}</span></span>
          <span class="cartao-nome">${esc(t.nome)}</span>
          ${t.tipo === 'cardio' && t.resumo ? `<span class="cartao-resumo">${esc(t.resumo)}</span>` : ''}
          <span class="cartao-meta">${meta}${badges.join('')}</span>
          ${perfil(t.payload)}
        </button>
      </article>`;
  }

  function renderSemanas() {
    const alvo = $('#semanas');
    if (!D.treinos.length) {
      alvo.innerHTML = `
        <div class="vazio">
          <p class="vazio-titulo">Seu treino começa aqui</p>
          <p>Crie um treino de qualquer modalidade numa data, ou importe um plano (PDF do Time Híbrido ou planilha).</p>
          <div class="vazio-acoes">
            <button class="btn btn-primario" data-novo-em="${hoje}">+ Novo treino</button>
            <button class="btn btn-claro" data-importar>Importar PDF ou planilha</button>
          </div>
        </div>`;
      return;
    }
    const segHoje = B.segundaDe(hoje);
    const grupos = new Map([[segHoje, []]]);   // a semana atual aparece mesmo vazia, para criar treino nela
    for (const t of D.treinos) {
      if (!visivel(t)) continue;
      const k = t.data ? B.segundaDe(t.data) : 'sem-data';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(t);
    }
    let html = '';
    for (const k of [...grupos.keys()].sort()) {
      const ts = grupos.get(k);
      const semData = k === 'sem-data';
      const fim = semData ? null : B.addDias(k, 6);
      const passou = !semData && fim < hoje;
      if (UI.esconderPassadas && passou) continue;
      const atual = k === segHoje;
      const semanas = [...new Set(ts.map((t) => t.semana).filter((s) => s !== null))];
      const etapa = (ts.find((t) => t.etapa) || {}).etapa || '';
      const selecionaveis = ts.filter((t) => !t.bloqueado);
      const nSel = selecionaveis.filter((t) => UI.sel.has(t.chave)).length;
      html += `
        <section class="semana ${passou ? 'semana-passada' : ''} ${atual ? 'semana-atual' : ''}">
          <header class="semana-topo">
            <h2>${semData ? 'Sem data' : `${fmtData(k, false)} <span aria-hidden="true">–</span><span class="sr"> a </span> ${fmtData(fim, false)}`}</h2>
            ${atual ? '<span class="tag tag-agora">esta semana</span>' : ''}
            ${semanas.length ? `<span class="tag">${semanas.map((s) => 'S' + pad2(s)).join(' · ')}</span>` : ''}
            ${etapa ? `<span class="tag">${esc(etapa)}</span>` : ''}
            <span class="semana-acoes">
              ${semData ? '' : `<button class="btn-mini" data-novo-em="${atual ? hoje : k}">+ treino</button>`}
              ${selecionaveis.length ? `<label class="semana-sel"><input type="checkbox" data-sel-semana="${k}" ${nSel && nSel === selecionaveis.length ? 'checked' : ''} ${nSel && nSel < selecionaveis.length ? 'data-meio="1"' : ''}> selecionar</label>` : ''}
            </span>
          </header>
          ${ts.length ? `<div class="cartoes">${ts.map(cartao).join('')}</div>` : '<p class="semana-vazia">Nada marcado nesta semana.</p>'}
        </section>`;
    }
    alvo.innerHTML = html || `<div class="vazio"><p class="vazio-titulo">Nada por aqui.</p><p>Desmarque "Esconder semanas que já passaram" para ver o histórico.</p></div>`;
    $$('input[data-meio]', alvo).forEach((i) => (i.indeterminate = true));
  }

  // ---------------------------------------------------------------------
  // Painel de envio
  // ---------------------------------------------------------------------
  function selecionados() { return D.treinos.filter((t) => UI.sel.has(t.chave) && !t.bloqueado); }

  function renderEnvio() {
    $('#envio').hidden = !D.treinos.length;
    const sel = selecionados();
    const nM = sel.filter((t) => t.tipo === 'musculacao').length;
    const nE = sel.filter((t) => t.editado).length;
    $('#contagem').innerHTML = sel.length
      ? `<b>${sel.length}</b> treino${sel.length > 1 ? 's' : ''} selecionado${sel.length > 1 ? 's' : ''} <span>${sel.length - nM} cardio · ${nM} musculação${nE ? ` · ${nE} novo${nE > 1 ? 's' : ''}/editado${nE > 1 ? 's' : ''}` : ''}</span>`
      : 'Nenhum treino selecionado. Marque os cartões ou use um atalho:';
    const avisos = [];
    if (UI.envio.agendar === 'manter' && sel.some((t) => t.dataMudou)) {
      avisos.push('Você mudou datas aqui. Com "Manter as datas", o que já está no Garmin fica onde está — para mover, escolha "Colocar na data daqui".');
    }
    const passados = sel.filter((t) => t.data && t.data < hoje);
    if (passados.length) avisos.push(`${passados.length} selecionado${passados.length > 1 ? 's são' : ' é'} de data que já passou.`);
    const comAviso = sel.filter((t) => t.avisos.length);
    if (comAviso.length) avisos.push(`${comAviso.length} com aviso (exercício sem par no De-para fica de fora do treino).`);
    const bloq = D.treinos.filter((t) => t.bloqueado).length;
    if (bloq) avisos.push(`${bloq} treino${bloq > 1 ? 's' : ''} com problema não ${bloq > 1 ? 'podem' : 'pode'} ser enviado${bloq > 1 ? 's' : ''} — veja o ⚠ no cartão.`);
    $('#avisos-envio').textContent = avisos.join(' ');
    $('#btn-gerar').disabled = !sel.length;
    $('#btn-apagar').disabled = !sel.length;
    $('#btn-apagar').textContent = (UI.envio.simular ? 'Simular: apagar' : 'Apagar') + (COM_EXTENSAO ? ' do Garmin' : ' do Garmin (script)');
    $('#limpar-nota').textContent = UI.envio.simular
      ? 'só simulação: mostra o que tiraria, sem mexer'
      : 'tudo, não só os selecionados · pede confirmação' + (COM_EXTENSAO ? '' : ' · gera um script');
    $('#dica-extensao').hidden = COM_EXTENSAO && EXT_EM_DIA;
    if (COM_EXTENSAO && !EXT_EM_DIA) { $('#dica-extensao').textContent = EXT_VELHA; $('#dica-extensao').classList.add('aviso-txt'); }
    $('#btn-gerar').textContent = COM_EXTENSAO
      ? (UI.envio.simular ? 'Simular no Garmin' : 'Enviar ao Garmin')
      : (UI.envio.simular ? 'Gerar script de simulação' : 'Gerar script');
    $(`input[name="agendar"][value="${UI.envio.agendar}"]`).checked = true;
    $(`input[name="existente"][value="${UI.envio.existente}"]`).checked = true;
    $('#simular').checked = UI.envio.simular;
    renderScript();
  }

  function invalidarScript() { UI.script = null; renderScript(); }

  function renderScript() {
    const box = $('#script');
    if (!UI.script) { box.hidden = true; return; }
    box.hidden = false;
    const kb = Math.max(1, Math.round(UI.script.bytes / 1024));
    const o = UI.script.opcoes, n = UI.script.n;
    const qual = { 'limpar-calendario': 'LIMPAR O CALENDÁRIO', 'limpar-biblioteca': 'LIMPAR MEUS TREINOS' }[o.acao] ||
      `${o.acao === 'apagar' ? 'APAGAR · ' : ''}${n} treino${n > 1 ? 's' : ''}`;
    $('#script-info').textContent = `${qual} · ${kb} KB${o.simular ? ' · simulação' : ''}`;
  }

  /**
   * acao: 'enviar' | 'apagar' (tira do Garmin os selecionados) | 'limpar-calendario' (tira todas
   * as datas) | 'limpar-biblioteca' (apaga todos de Meus treinos). Os de limpar não usam a seleção.
   * Apagar e limpar confirmam no painel do Garmin.
   */
  async function gerar(acao) {
    if (COM_EXTENSAO && !EXT_EM_DIA) { toast(EXT_VELHA, 9000); return; }
    const tudo = acao.startsWith('limpar-');
    const sel = tudo ? [] : selecionados();
    if (!sel.length && !tudo) return;
    const itens = sel.map((t) => ({
      k: t.chave, nome: t.nome, antigos: t.antigos, data: t.data, editado: !!t.editado, payload: t.payload,
    }));
    try {
      const r = await U.gerarScript(itens, { ...UI.envio, acao });
      if (COM_EXTENSAO) window.postMessage({ tipo: 'bodyplus:enviar', dados: r.b64, opcoes: r.opcoes }, location.origin);
      else UI.script = { ...r, n: itens.length };
      if (acao === 'enviar' && !UI.envio.simular) {
        // lembra o nome enviado: se o treino mudar de nome depois, o próximo envio troca o antigo no Garmin
        sel.forEach((t) => {
          const env = S.enviados[t.chave] || { nomes: [] };
          S.enviados[t.chave] = { nomes: [...new Set([...env.nomes, t.nome])], data: t.data };
        });
        salvar();
      }
      if (COM_EXTENSAO) return;
      renderScript();
      $('#script').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      console.error(e);
      toast('Não consegui gerar o script: ' + e.message, 5000);
    }
  }

  // resposta da extensão (extensao/ponte.js)
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.tipo !== 'bodyplus:resposta') return;
    toast(e.data.ok ? 'Abri o Garmin numa aba nova — acompanhe (e confirme, se pedir) no painel de lá.' : 'A extensão não respondeu: ' + e.data.erro + '.', 5000);
  });

  async function copiarTexto(texto, msg) {
    try { await navigator.clipboard.writeText(texto); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = texto; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    toast(msg);
  }

  function baixarScript() {
    if (!UI.script) return;
    const blob = new Blob([UI.script.codigo], { type: 'text/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bodyplus_envio_${hoje}${UI.script.opcoes.simular ? '_simulacao' : ''}.js`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------------
  // Novo treino / importar
  // ---------------------------------------------------------------------
  function abrirNovo(data) {
    $('#novo-data').value = data || hoje;
    $('#novo').showModal();
  }

  function criarTreino(esporte, data) {
    let chave;
    if (esporte === 'musculacao') {
      const sessao = novoId();
      S.atual.musculacao.push({ _id: novoId(), sessao, data, grupo: '', bloco: 1, tecnica: '', exercicio: '', series: 3, reps: '12', descanso_seg: 60 });
      chave = 'm|' + sessao;
    } else {
      const r = { _id: novoId(), data, esporte, aquecimento_min: 0, desaquecimento_min: 0, ...(NOVO[esporte] || NOVO_PADRAO) };
      S.atual.cardio.push(r);
      chave = 'c|' + r._id;
    }
    UI.sel.add(chave);
    aplicouEdicao(false);
    abrir(chave);
  }

  async function importarArquivo(f) {
    const pdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    UI.importacao = { nome: f.name, tipo: pdf ? 'pdf' : 'xlsx' };
    $('#imp-titulo').textContent = f.name;
    $('#imp-lendo').hidden = false;
    $('#imp-lendo').textContent = 'Lendo…';
    $('#imp-form').hidden = true;
    $$('#importar [data-imp]').forEach((b) => (b.disabled = true));
    $('#importar').showModal();
    try {
      const buf = await f.arrayBuffer();
      const lido = pdf
        ? await lerPdf(buf, (n, t) => { $('#imp-lendo').textContent = `Lendo o PDF… página ${n} de ${t}`; })
        : lerPlanilha(buf);
      Object.assign(UI.importacao, lido);
      const semData = (r) => vazio(r.data) && !vazio(r.semana);
      UI.importacao.precisaInicio = lido.dados.cardio.some(semData) || lido.dados.musculacao.some(semData);
      $('#imp-lendo').hidden = true;
      $('#imp-form').hidden = false;
      $('#imp-datas').hidden = !UI.importacao.precisaInicio;
      $('#imp-dias-box').hidden = !lido.dados.musculacao.some(semData);
      $('#imp-inicio').value = proximaSegunda();
      $('#imp-prefixo').value = '';
      $('#imp-dias').innerHTML = B.TREINOS.map((t) => `
        <label class="dia-musc"><b>${t}</b>
          <select data-treino="${t}" aria-label="Dia do treino ${t}">
            ${B.NOME_DIA.map((n, i) => `<option value="${i}" ${B.DIAS_MUSC_PADRAO[t] === i ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>`).join('');
      $$('#importar [data-imp]').forEach((b) => (b.disabled = false));
      renderImportacao();
    } catch (err) {
      console.error(err);
      $('#importar').close();
      toast(`Não consegui ler ${pdf ? 'o PDF' : 'a planilha'}: ${err.message}`, 7000);
    }
  }

  /** Linhas importadas com as opções do diálogo (datas, prefixo). */
  function dadosImportados(lote) {
    const I = UI.importacao;
    const diasMusc = {};
    $$('#imp-dias select').forEach((s) => (diasMusc[s.dataset.treino] = Number(s.value)));
    return B.prepararLinhas(clone(I.dados), {
      inicio: I.precisaInicio ? $('#imp-inicio').value || null : null,
      diasMusc, plano: LEGADO.plano, prefixo: limparPrefixo($('#imp-prefixo').value), lote,
    });
  }

  function renderImportacao() {
    const I = UI.importacao;
    const inicio = $('#imp-inicio').value;
    $('#imp-inicio-aviso').textContent = inicio && B.diaDaSemana(inicio) !== 0 ? `Atenção: ${fmtData(inicio)} não é segunda-feira.` : '';
    const dados = dadosImportados('previa');
    const ts = B.montarPlano({ cardio: dados.cardio, musculacao: dados.musculacao, depara: mapaDepara(juntarDepara(dados.depara, S.atual.depara)) });
    const nM = ts.filter((t) => t.tipo === 'musculacao').length;
    const datas = ts.map((t) => t.data).filter(Boolean).sort();
    const nomes = new Set(D.treinos.map((t) => t.nome));
    const colidem = ts.filter((t) => nomes.has(t.nome)).length;
    const semPar = new Set();
    ts.forEach((t) => t.avisos.forEach((a) => { const m = a.match(/^"(.+)" sem par no De-para/); if (m) semPar.add(m[1]); }));
    const itens = [...(I.avisos || [])];
    if (colidem) itens.push(`${colidem} treino${colidem > 1 ? 's têm' : ' tem'} o mesmo nome de um que já está aqui. Para adicionar sem misturar, escreva um prefixo (ex.: 3K) — ou use "Substituir tudo".`);
    if (semPar.size) itens.push(`${semPar.size} exercício${semPar.size > 1 ? 's' : ''} sem par no catálogo do Garmin (${[...semPar].slice(0, 4).join(', ')}${semPar.size > 4 ? '…' : ''}): depois, abra o treino com ⚠ e clique em "escolher".`);
    $('#imp-resumo').innerHTML = `
      <p><b>${ts.length - nM}</b> cardio · <b>${nM}</b> musculação${I.semanas ? ` · ${I.semanas} semanas` : ''}${I.titulo ? ` · ${esc(I.titulo)}` : ''}
      ${datas.length ? `<br>De <b>${fmtData(datas[0])}</b> a <b>${fmtData(datas[datas.length - 1])}</b>.` : ''}</p>
      ${itens.length ? `<ul class="avisos">${itens.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <p class="nota">A leitura é automática — confira os treinos depois de importar.</p>`;
  }

  function confirmarImportacao(modo) {
    const I = UI.importacao;
    const dados = dadosImportados(Date.now().toString(36));
    const novos = { cardio: dados.cardio, musculacao: dados.musculacao };
    // o De-para que você escolheu na página vale mais que o padrão do PDF; o de uma planilha vale mais que o da página
    const depara = I.tipo === 'pdf' ? juntarDepara(S.atual.depara, dados.depara) : juntarDepara(dados.depara, S.atual.depara);
    if (modo === 'substituir') {
      if (D.treinos.length && !confirm('Substituir tudo tira da página os treinos que estão aqui agora (no Garmin nada muda). Continuar?')) return;
      $('#importar').close();
      iniciar(novoEstado(I.nome, { ...novos, depara }, I.colunas));
    } else {
      $('#importar').close();
      for (const k of ['cardio', 'musculacao']) { S.base[k].push(...novos[k]); S.atual[k].push(...clone(novos[k])); }
      S.base.depara = juntarDepara(S.base.depara, dados.depara);
      S.atual.depara = depara;
      for (const k of Object.keys(COLUNAS)) S.colunas[k] = juntar(S.colunas[k], (I.colunas && I.colunas[k]) || []);
      recalcularBase();
      recalcular();
      const chaves = new Set(B.montarPlano({ ...novos, depara: {} }).map((t) => t.chave));
      D.treinos.forEach((t) => { if (chaves.has(t.chave) && t.data && t.data >= hoje) UI.sel.add(t.chave); });
      preencherListas();
      aplicouEdicao(false);
    }
    toast(`${I.nome} importado. Confira os treinos antes de enviar.`, 4000);
    UI.importacao = null;
  }

  // ---------------------------------------------------------------------
  // Editor (gaveta)
  // ---------------------------------------------------------------------
  function abrir(chave) {
    if (!D.porChave.get(chave)) return;
    UI.aberto = chave;
    $('#gaveta').hidden = false;
    document.body.classList.add('sem-rolagem');
    renderGaveta(true);
    const foco = $('#gaveta-corpo input, #gaveta-corpo select');
    if (foco) foco.focus({ preventScroll: true });
  }

  function fechar() {
    UI.aberto = null;
    $('#gaveta').hidden = true;
    document.body.classList.remove('sem-rolagem');
  }

  function linhaCardio(t) { return S.atual.cardio.find((r) => 'c|' + r._id === t.chave); }
  function linhasMusc(t) { return S.atual.musculacao.filter((r) => 'm|' + B.sessaoDe(r) === t.chave); }

  function renderGaveta(inteira) {
    const t = D.porChave.get(UI.aberto);
    if (!t) { fechar(); return; }
    $('#gaveta-sub').textContent = [modalidade(t), fmtData(t.data), t.semana !== null ? `semana ${t.semana}` : '', t.etapa].filter(Boolean).join(' · ');
    $('#gaveta-titulo').textContent = t.nome;
    $('#gaveta .gaveta-painel').className = `gaveta-painel fam-${FAMILIA[t.esporte] || 'outro'}`;
    if (inteira) {
      $('#gaveta-corpo').innerHTML = (t.tipo === 'cardio' ? formCardio(t) : formMusc(t)) + `
        <div id="previa"></div>
        <div class="gaveta-rodape">
          <button class="btn btn-claro" data-duplicar>Duplicar</button>
          <button class="btn btn-claro btn-perigo" data-excluir>Excluir</button>
          ${t.novo ? '' : '<button class="btn btn-claro" data-restaurar>Restaurar original</button>'}
          <button class="btn btn-primario" data-fechar>Pronto</button>
        </div>`;
    }
    const nome = $('#gaveta-corpo [data-nome]');
    if (nome) nome.placeholder = nome.value ? '' : `automático: ${t.nome}`;
    renderPrevia(t);
  }

  function opcoes(lista, atual) {
    const vals = lista.includes(atual) || vazio(atual) ? lista : [atual, ...lista];
    return vals.map((v) => `<option value="${esc(v)}" ${String(v) === String(atual) ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }

  const campoData = (attr, v) => `<label class="campo"><span>Data</span><input type="date" ${attr} value="${esc(v || '')}" required></label>`;
  const campoNome = (attr, v) => `<label class="campo campo-largo"><span>Nome no Garmin <small>(em branco = automático)</small></span><input ${attr} data-nome value="${esc(v || '')}" maxlength="60" autocomplete="off"></label>`;

  function formCardio(t) {
    const r = linhaCardio(t);
    const tipo = B.tipoCardio(r) || 'continuo';
    const esp = B.esporteDe(r) || 'outro';
    const tipos = [['intervalado', 'Intervalado'], ['contínuo', 'Contínuo'], ['distância', 'Distância']];
    if (esp === 'corrida' || tipo === 'prova') tipos.push(['prova', 'Prova']);
    const zonas = (nome, v) => `<select data-campo="${nome}">${[0, 1, 2, 3, 4, 5].map((z) => `<option value="${z}" ${Number(v) === z ? 'selected' : ''}>${z ? 'Z' + z : 'sem alvo'}</option>`).join('')}</select>`;
    const n = (campo, rot, passo = 1, sufixo = 'min') => `
      <label class="campo"><span>${rot}</span>
        <span class="com-sufixo"><input type="number" min="0" step="${passo}" data-campo="${campo}" value="${esc(r[campo])}"><i>${sufixo}</i></span>
      </label>`;
    return `
      <div class="form-grade">
        ${campoData('data-campo="data"', t.data)}
        <label class="campo"><span>Modalidade</span>
          <select data-campo="esporte">${Object.entries(B.ESPORTES).map(([k, e]) => `<option value="${k}" ${k === esp ? 'selected' : ''}>${e.nome}</option>`).join('')}</select>
        </label>
        ${campoNome('data-campo="nome"', r.nome)}
        <div class="campo campo-largo"><span>Tipo</span>
          <div class="segmentado" data-campo-tipo>
            ${tipos.map(([k, rot]) => `<button type="button" data-tipo="${k}" class="${semAcento(k) === tipo ? 'ativo' : ''}">${rot}</button>`).join('')}
          </div>
        </div>
        ${n('aquecimento_min', 'Aquecimento')}
        ${tipo === 'intervalado' ? `
          <label class="campo"><span>Repetições</span><input type="number" min="1" step="1" data-campo="reps" value="${esc(r.reps)}"></label>
          ${n('esforco_min', 'Esforço', 0.5)}
          <label class="campo"><span>Zona do esforço</span>${zonas('esforco_zona', r.esforco_zona ?? 3)}</label>
          ${n('recuperacao_min', 'Recuperação', 0.5)}
          <label class="campo"><span>Zona da recuperação</span>${zonas('recuperacao_zona', r.recuperacao_zona ?? 1)}</label>` : ''}
        ${tipo === 'continuo' ? `
          ${n('esforco_min', 'Duração', 1)}
          <label class="campo"><span>Zona</span>${zonas('esforco_zona', r.esforco_zona ?? 3)}</label>` : ''}
        ${tipo === 'distancia' || tipo === 'prova' ? `
          ${n('distancia_km', 'Distância', 0.1, 'km')}
          <label class="campo"><span>Zona</span>${zonas('esforco_zona', r.esforco_zona ?? (tipo === 'prova' ? 4 : 3))}</label>` : ''}
        ${n('desaquecimento_min', 'Desaquecimento')}
        <label class="campo campo-largo"><span>Notas <small>(vão na descrição, aparecem no relógio)</small></span>
          <textarea data-campo="notas" rows="2">${esc(r.notas)}</textarea></label>
      </div>`;
  }

  function formMusc(t) {
    const rows = linhasMusc(t);
    const r0 = rows[0] || {};
    const aq = rows.find((r) => vazio(r.series) || !Number(r.series));
    const dp = mapaDepara(S.atual.depara);
    const linhas = rows.filter((r) => r !== aq);
    let ultimoBloco = null, faixa = false;
    const tr = linhas.map((r) => {
      if (String(r.bloco) !== ultimoBloco) { faixa = !faixa; ultimoBloco = String(r.bloco); }
      const up = String(r.exercicio || '').trim().toUpperCase();
      const m = dp[up] || dp['~' + B.chaveSolta(up)];
      const garmin = m && m.cat && m.ex
        ? `<button class="chip" data-mapa="${esc(r._id)}" title="Trocar o exercício do Garmin (vale para todos os treinos com esse nome)">${esc(m.ex.replace(/_/g, ' ').toLowerCase())}</button>`
        : `<button class="chip chip-aviso" data-mapa="${esc(r._id)}">⚠ escolher</button>`;
      return `
        <tr class="${faixa ? 'faixa' : ''}" data-id="${esc(r._id)}">
          <td><input type="number" min="1" step="1" data-mc="bloco" value="${esc(r.bloco)}" class="estreito" aria-label="Bloco"></td>
          <td><input data-mc="tecnica" value="${esc(r.tecnica)}" list="dl-tecnicas" class="medio" aria-label="Técnica"></td>
          <td><input data-mc="exercicio" value="${esc(r.exercicio)}" list="dl-exercicios" class="largo" aria-label="Exercício" placeholder="ex.: AGACHAMENTO LIVRE"></td>
          <td class="td-garmin">${garmin}</td>
          <td><input type="number" min="1" step="1" data-mc="series" value="${esc(r.series)}" class="estreito" aria-label="Séries"></td>
          <td><input data-mc="reps" value="${esc(r.reps)}" class="medio" aria-label="Repetições"></td>
          <td><input type="number" min="0" step="5" data-mc="descanso_seg" value="${esc(r.descanso_seg)}" class="estreito" aria-label="Descanso em segundos"></td>
          <td class="td-acoes">
            <button data-mover="-1" data-id="${esc(r._id)}" title="Subir" aria-label="Subir">↑</button>
            <button data-mover="1" data-id="${esc(r._id)}" title="Descer" aria-label="Descer">↓</button>
            <button data-remover="${esc(r._id)}" title="Remover" aria-label="Remover">✕</button>
          </td>
        </tr>
        <tr class="tr-mapa" data-mapa-de="${esc(r._id)}" hidden><td colspan="8"></td></tr>`;
    }).join('');
    return `
      <div class="form-grade">
        ${campoData('data-sessao="data"', t.data)}
        <label class="campo"><span>Grupo</span><input data-sessao="grupo" value="${esc(r0.grupo)}" list="dl-grupos" autocomplete="off" placeholder="ex.: Pernas"></label>
        ${campoNome('data-sessao="nome"', r0.nome)}
        <label class="campo campo-check campo-largo">
          <input type="checkbox" data-aquec ${aq ? 'checked' : ''}>
          <span>Aquecimento automático <small>(${B.ROTULO_AQUEC[B.tipoAquecimento(r0.grupo)]})</small></span>
        </label>
      </div>
      <p class="dica">Mesmo número de <b>bloco</b> = bi-set/super-set (troca de aparelho no botão Lap). Reps: <code>15</code> · <code>6 / 12</code> (dois pesos na mesma série) · <code>(15-12-10-8-6)</code> (pirâmide).</p>
      <div class="tabela-rolagem">
        <table class="tabela-musc">
          <thead><tr><th>Bloco</th><th>Técnica</th><th>Exercício</th><th>Garmin</th><th>Séries</th><th>Reps</th><th>Desc. (s)</th><th><span class="sr">Ações</span></th></tr></thead>
          <tbody>${tr}</tbody>
        </table>
      </div>
      <button class="btn btn-claro btn-add" data-adicionar>+ Exercício</button>`;
  }

  function renderPrevia(t) {
    const alvo = $('#previa');
    if (!alvo) return;
    const linhas = B.estrutura(t.payload);
    const passo = (l) => `<li class="p-${esc(l.tipo)}"><span>${esc(l.texto)}</span>${l.nota ? `<small>${esc(l.nota)}</small>` : ''}</li>`;
    const corpo = linhas.map((l) => (l.tipo === 'repeat'
      ? `<li class="p-repeat"><b>${l.series}×</b><ol>${l.filhos.map(passo).join('')}</ol></li>`
      : passo(l))).join('');
    const avisos = t.avisos.length ? `<ul class="avisos">${t.avisos.map((a) => `<li>⚠ ${esc(a)}</li>`).join('')}</ul>` : '';
    const novaData = t.dataMudou ? `<p class="renome">A data mudou de <b>${fmtData(t.dataAntiga)}</b> para <b>${fmtData(t.data)}</b>. Para mover no Garmin, envie com "Colocar na data daqui".</p>` : '';
    const renome = t.antigos.length ? `<p class="renome">O nome mudou de <b>${esc(t.antigos.join(', '))}</b> para <b>${esc(t.nome)}</b>. No envio, o treino antigo é substituído por este.</p>` : '';
    alvo.innerHTML = `
      <h3>Como fica no relógio ${t.novo ? '<span class="badge badge-novo">novo</span>' : t.editado ? '<span class="badge badge-editado">editado</span>' : ''}</h3>
      ${avisos}${renome}${novaData}
      ${t.payload ? `${perfil(t.payload, 'perfil-grande')}<p class="descricao">${esc(t.payload.description).replace(/\n/g, '<br>')}</p><ol class="estrutura">${corpo}</ol>` : '<p class="nota">Corrija os avisos para montar o treino.</p>'}`;
  }

  // edição -> estado
  function aplicouEdicao(redesenharGaveta) {
    recalcular();
    salvar();
    invalidarScript();
    renderFonte();
    renderSemanas();
    renderEnvio();
    if (UI.aberto) renderGaveta(redesenharGaveta);
  }

  function numOuNulo(v) { return v === '' || v === null ? null : Number(v); }

  function editarCardio(campo, valor) {
    const r = linhaCardio(D.porChave.get(UI.aberto));
    const numericos = ['aquecimento_min', 'reps', 'esforco_min', 'esforco_zona', 'recuperacao_min', 'recuperacao_zona', 'desaquecimento_min', 'distancia_km'];
    r[campo] = numericos.includes(campo) ? numOuNulo(valor) : (valor === '' ? null : valor);
    if (campo === 'esporte' && valor !== 'corrida' && B.tipoCardio(r) === 'prova') r.tipo = 'distância';
    aplicouEdicao(campo === 'esporte');
  }

  function trocarTipoCardio(tipo) {
    const r = linhaCardio(D.porChave.get(UI.aberto));
    const antes = B.tipoCardio(r);
    r.tipo = tipo;
    if (B.tipoCardio(r) === antes) return;
    // tipo novo começa com valores dele (60 min de contínuo não viram tiros de 60 min)
    if (tipo === 'intervalado') {
      Object.assign(r, { reps: 6, esforco_min: 4, recuperacao_min: 1, esforco_zona: r.esforco_zona || 3, recuperacao_zona: 1, distancia_km: null });
    } else if (tipo === 'contínuo') {
      Object.assign(r, { esforco_min: 30, esforco_zona: r.esforco_zona ?? 2, reps: null, recuperacao_min: null, recuperacao_zona: null, distancia_km: null });
    } else {
      Object.assign(r, { distancia_km: r.distancia_km || 5, esforco_zona: tipo === 'prova' ? 4 : r.esforco_zona ?? 2, reps: null, esforco_min: null, recuperacao_min: null, recuperacao_zona: null });
    }
    aplicouEdicao(true);
  }

  /** Campo do treino de musculação inteiro (data, nome, grupo) → em todas as linhas dele. */
  function editarSessao(campo, valor) {
    linhasMusc(D.porChave.get(UI.aberto)).forEach((r) => (r[campo] = valor === '' ? null : valor));
    aplicouEdicao(campo === 'grupo');
  }

  function editarMusc(id, campo, valor) {
    const r = S.atual.musculacao.find((x) => x._id === id);
    if (!r) return;
    r[campo] = ['bloco', 'series', 'descanso_seg'].includes(campo) ? numOuNulo(valor) : valor;
    // troca de exercício redesenha a tabela (o chip do Garmin muda); o resto só a prévia
    aplicouEdicao(campo === 'exercicio');
  }

  const camposSessao = (r) => Object.fromEntries(CAMPOS_SESSAO.map((c) => [c, r[c] === undefined ? null : r[c]]));

  function adicionarExercicio() {
    const rows = linhasMusc(D.porChave.get(UI.aberto));
    const ult = rows[rows.length - 1];
    const blocoMax = Math.max(0, ...rows.map((r) => Number(r.bloco) || 0));
    const nova = { ...camposSessao(rows[0]), _id: novoId(), bloco: blocoMax + 1, tecnica: '', exercicio: '', series: 3, reps: '12', descanso_seg: 60, notas: null };
    S.atual.musculacao.splice(S.atual.musculacao.indexOf(ult) + 1, 0, nova);
    aplicouEdicao(true);
    const inp = $(`tr[data-id="${nova._id}"] input[data-mc="exercicio"]`);
    if (inp) inp.focus();
  }

  function moverExercicio(id, dir) {
    const rows = linhasMusc(D.porChave.get(UI.aberto));
    const i = rows.findIndex((r) => r._id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const a = S.atual.musculacao.indexOf(rows[i]), b = S.atual.musculacao.indexOf(rows[j]);
    [S.atual.musculacao[a], S.atual.musculacao[b]] = [S.atual.musculacao[b], S.atual.musculacao[a]];
    aplicouEdicao(true);
  }

  function removerExercicio(id) {
    const rows = linhasMusc(D.porChave.get(UI.aberto));
    if (rows.filter((r) => Number(r.series)).length <= 1 && rows.find((r) => r._id === id && Number(r.series))) { toast('O treino precisa de pelo menos um exercício — para tirar o treino, use Excluir.'); return; }
    S.atual.musculacao = S.atual.musculacao.filter((r) => r._id !== id);
    aplicouEdicao(true);
  }

  function alternarAquecimento(ligar) {
    const rows = linhasMusc(D.porChave.get(UI.aberto));
    const aq = rows.find((r) => vazio(r.series) || !Number(r.series));
    if (ligar && !aq) {
      const grupo = rows[0] ? rows[0].grupo : '';
      const nova = {
        ...camposSessao(rows[0]), _id: novoId(), bloco: 1, tecnica: 'AQUECIMENTO',
        exercicio: B.tipoAquecimento(grupo) === 'inferiores' ? 'FLEXIBILIDADE E MOBILIDADE PRÉ TREINO DE INFERIORES' : 'AQUECIMENTO/MOBILIDADE PRÉ TREINO DE SUPERIORES',
        series: null, reps: null, descanso_seg: null, notas: null,
      };
      S.atual.musculacao.splice(S.atual.musculacao.indexOf(rows[0]), 0, nova);
    } else if (!ligar && aq) {
      S.atual.musculacao = S.atual.musculacao.filter((r) => r !== aq);
    }
    aplicouEdicao(true);
  }

  /** Cópia como treino seu (sem semana/plano), uma semana depois. */
  function duplicar() {
    const t = D.porChave.get(UI.aberto);
    const data = t.data ? B.addDias(t.data, 7) : hoje;
    const solto = (r) => ({ ...clone(r), _id: novoId(), data, nome: null, prefixo: null, plano: null, semana: null, etapa: null, dia: null, treino: null });
    let chave;
    if (t.tipo === 'cardio') {
      const r = solto(linhaCardio(t));
      S.atual.cardio.push(r);
      chave = 'c|' + r._id;
    } else {
      const sessao = novoId();
      S.atual.musculacao.push(...linhasMusc(t).map((r) => ({ ...solto(r), sessao })));
      chave = 'm|' + sessao;
    }
    UI.sel.add(chave);
    aplicouEdicao(false);
    abrir(chave);
    toast(`Cópia criada em ${fmtData(data)} — mude a data se quiser.`, 4000);
  }

  function excluir() {
    const t = D.porChave.get(UI.aberto);
    if (!confirm(`Tirar "${t.nome}" da página?\nNo Garmin ele continua (apague lá, se quiser).`)) return;
    if (t.tipo === 'cardio') S.atual.cardio = S.atual.cardio.filter((r) => 'c|' + r._id !== t.chave);
    else S.atual.musculacao = S.atual.musculacao.filter((r) => 'm|' + B.sessaoDe(r) !== t.chave);
    fechar();
    aplicouEdicao(false);
    toast(t.novo ? 'Treino excluído.' : 'Treino excluído. "Descartar todas as edições" traz de volta.');
  }

  function restaurar() {
    const t = D.porChave.get(UI.aberto);
    if (t.tipo === 'cardio') {
      const atual = linhaCardio(t);
      const orig = S.base.cardio.find((r) => r._id === atual._id);
      if (orig) S.atual.cardio[S.atual.cardio.indexOf(atual)] = clone(orig);
    } else {
      const rows = linhasMusc(t);
      const orig = S.base.musculacao.filter((r) => 'm|' + B.sessaoDe(r) === t.chave);
      const pos = rows.length ? S.atual.musculacao.indexOf(rows[0]) : S.atual.musculacao.length;
      S.atual.musculacao = S.atual.musculacao.filter((r) => !rows.includes(r));
      S.atual.musculacao.splice(Math.min(pos, S.atual.musculacao.length), 0, ...clone(orig));
    }
    aplicouEdicao(true);
    toast('Treino restaurado como estava.');
  }

  // --- De-para (catálogo do Garmin) ---
  async function garantirCatalogo() {
    if (UI.catalogo) return UI.catalogo;
    try {
      const r = await fetch(CATALOGO);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      UI.catalogo = await r.json();
      $('#dl-catalogo').innerHTML = UI.catalogo.map((e) => `<option value="${esc(e.category)} / ${esc(e.key)}">`).join('');
    } catch (e) {
      UI.catalogo = [];
    }
    return UI.catalogo;
  }

  async function abrirMapa(id) {
    const r = S.atual.musculacao.find((x) => x._id === id);
    const tr = $(`tr[data-mapa-de="${id}"]`);
    if (!r || !tr) return;
    if (!tr.hidden) { tr.hidden = true; return; }
    const nome = String(r.exercicio || '').trim();
    if (!nome) { toast('Escreva o nome do exercício primeiro.'); return; }
    const cat = await garantirCatalogo();
    const mapa = mapaDepara(S.atual.depara);
    const atual = mapa[nome.toUpperCase()] || mapa['~' + B.chaveSolta(nome)];
    tr.hidden = false;
    tr.firstElementChild.innerHTML = cat.length
      ? `<div class="mapa">
          <label>Exercício do Garmin para <b>${esc(nome)}</b>
            <input list="dl-catalogo" data-mapa-input="${esc(id)}" placeholder="digite em inglês: squat, curl, press…" value="${atual && atual.cat ? esc(atual.cat + ' / ' + atual.ex) : ''}">
          </label>
          <small>Vale para todos os treinos com esse exercício. Fica salvo na aba De-para.</small>
        </div>`
      : `<div class="mapa"><small>O catálogo de exercícios (${CATALOGO}) só abre com a página num servidor (<code>py -m http.server</code> ou GitHub Pages). Por enquanto, ajuste na aba De-para da planilha.</small></div>`;
    const inp = tr.querySelector('input');
    if (inp) inp.focus();
  }

  function definirMapa(id, valor) {
    const r = S.atual.musculacao.find((x) => x._id === id);
    const m = String(valor).split('/').map((s) => s.trim());
    if (!r || m.length !== 2) return;
    const [cat, ex] = m;
    if (UI.catalogo && UI.catalogo.length && !UI.catalogo.some((e) => e.category === cat && e.key === ex)) { toast('Esse exercício não está no catálogo do Garmin.'); return; }
    const pt = String(r.exercicio).trim().toUpperCase();
    let d = S.atual.depara.find((x) => String(x.exercicio_pt || '').trim().toUpperCase() === pt);
    if (!d) { d = { exercicio_pt: pt, obs: 'definido na página' }; S.atual.depara.push(d); }
    d.garmin_category = cat;
    d.garmin_exercise = ex;
    d.garmin_label = ex.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    d.confianca = 'manual';
    preencherListas();
    aplicouEdicao(true);
    toast(`${pt} → ${d.garmin_label}`);
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------
  function ligarEventos() {
    // novo treino
    $('#novo-modalidades').innerHTML = [...Object.entries(B.ESPORTES), ['musculacao', { nome: 'Musculação' }]]
      .map(([k, e]) => `<label class="modalidade fam-${FAMILIA[k] || 'outro'}"><input type="radio" name="modalidade" value="${k}" ${k === 'corrida' ? 'checked' : ''}><span>${e.nome}</span></label>`).join('');
    // cria no 'close' (depois do diálogo devolver o foco), para a gaveta abrir com o foco nela
    $('#novo').addEventListener('close', () => {
      if ($('#novo').returnValue !== 'criar') return;
      $('#novo').returnValue = '';
      criarTreino($('input[name="modalidade"]:checked').value, $('#novo-data').value || hoje);
    });
    document.addEventListener('click', (e) => {
      const n = e.target.closest('[data-novo-em]');
      if (n) { abrirNovo(n.dataset.novoEm); return; }
      if (e.target.closest('[data-importar]')) $('#arquivo').click();
    });

    // importar
    $('#arquivo').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importarArquivo(f);
    });
    $('#importar').addEventListener('input', (e) => { if (e.target.closest('#imp-form') && UI.importacao && UI.importacao.dados) renderImportacao(); });
    $('#imp-adicionar').addEventListener('click', () => confirmarImportacao('adicionar'));
    $('#imp-substituir').addEventListener('click', () => confirmarImportacao('substituir'));
    $('#imp-cancelar').addEventListener('click', () => $('#importar').close());

    // doação
    $('#pix-chave').textContent = PIX.exibir;
    const qr = $('#pix-qr');
    qr.addEventListener('error', () => { $('#pix-qr-box').hidden = true; });
    qr.src = PIX.qr;
    if (PIX.copiaECola) { $('#pix-cc').textContent = PIX.copiaECola; $('#pix-cc-box').hidden = false; }
    if (PIX.recebedor) { $('#pix-recebedor').textContent = `Recebedor: ${PIX.recebedor}`; $('#pix-recebedor').hidden = false; }
    $('#btn-apoiar').addEventListener('click', () => { $('.menu').open = false; $('#doacao').showModal(); });
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); })); // clique fora fecha
    $('#btn-copiar-chave').addEventListener('click', () => copiarTexto(PIX.chave, 'Chave Pix copiada. Obrigado pelo apoio!'));
    $('#btn-copiar-cc').addEventListener('click', () => copiarTexto(PIX.copiaECola, 'Código Pix copiado — cole no app do banco.'));

    // menu
    $('#btn-baixar').addEventListener('click', () => { $('.menu').open = false; baixarPlanilha(); });
    $('#btn-recarregar').addEventListener('click', async () => {
      $('.menu').open = false;
      if (D.treinos.length && !confirm('Recarregar data/treinos.xlsx tira da página o que está aqui agora (inclusive edições). Continuar?')) return;
      try { iniciar(await carregarDoProjeto()); toast('Planilha do projeto recarregada.'); }
      catch (err) { toast('Não consegui abrir ' + PLANILHA_PROJETO + ' (' + err.message + ').', 5000); }
    });
    $('#btn-descartar').addEventListener('click', () => {
      $('.menu').open = false;
      if (!confirm('Descartar todas as edições (e os treinos novos) e voltar ao que foi importado?')) return;
      S.atual = clone(S.base);
      aplicouEdicao(true);
      toast('Edições descartadas.');
    });
    $('#btn-zerar').addEventListener('click', () => {
      $('.menu').open = false;
      if (!confirm('Começar do zero tira TODOS os treinos da página (no Garmin nada muda). Baixe a planilha antes se quiser guardar. Continuar?')) return;
      iniciar(estadoVazio());
      toast('Página vazia. Crie um treino ou importe um plano.');
    });

    // filtros
    $('#filtro').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      UI.filtro = b.dataset.f;
      renderFiltros(); renderSemanas();
    });
    $('#cfg-passadas').addEventListener('change', (e) => { UI.esconderPassadas = e.target.checked; renderSemanas(); });

    // cartões
    $('#semanas').addEventListener('change', (e) => {
      const c = e.target.closest('input[data-sel]');
      if (c) {
        c.checked ? UI.sel.add(c.dataset.sel) : UI.sel.delete(c.dataset.sel);
        invalidarScript(); renderSemanas(); renderEnvio();
        return;
      }
      const s = e.target.closest('input[data-sel-semana]');
      if (s) {
        D.treinos.filter((t) => t.data && B.segundaDe(t.data) === s.dataset.selSemana && !t.bloqueado && visivel(t))
          .forEach((t) => (s.checked ? UI.sel.add(t.chave) : UI.sel.delete(t.chave)));
        invalidarScript(); renderSemanas(); renderEnvio();
      }
    });
    $('#semanas').addEventListener('click', (e) => {
      const b = e.target.closest('[data-abrir]');
      if (b) abrir(b.dataset.abrir);
    });

    // envio
    $('.presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b) return;
      selecionar(b.dataset.p);
      invalidarScript(); renderSemanas(); renderEnvio();
    });
    $('#envio').addEventListener('change', (e) => {
      if (e.target.name === 'agendar') UI.envio.agendar = e.target.value;
      else if (e.target.name === 'existente') UI.envio.existente = e.target.value;
      else if (e.target.id === 'simular') UI.envio.simular = e.target.checked;
      else return;
      invalidarScript(); renderEnvio();
    });
    $('#btn-gerar').addEventListener('click', () => gerar('enviar'));
    $('#btn-apagar').addEventListener('click', () => gerar('apagar'));
    $('#btn-limpar').addEventListener('click', () => gerar('limpar-calendario'));
    $('#btn-limpar-biblioteca').addEventListener('click', () => gerar('limpar-biblioteca'));
    $('#btn-copiar').addEventListener('click', () => UI.script && copiarTexto(UI.script.codigo, 'Script copiado. Agora cole no Console da aba do Garmin.'));
    $('#btn-baixar-js').addEventListener('click', baixarScript);

    // gaveta
    const g = $('#gaveta');
    g.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar]')) { fechar(); return; }
      const tipo = e.target.closest('[data-tipo]');
      if (tipo) { trocarTipoCardio(tipo.dataset.tipo); return; }
      if (e.target.closest('[data-restaurar]')) { restaurar(); return; }
      if (e.target.closest('[data-duplicar]')) { duplicar(); return; }
      if (e.target.closest('[data-excluir]')) { excluir(); return; }
      if (e.target.closest('[data-adicionar]')) { adicionarExercicio(); return; }
      const mv = e.target.closest('[data-mover]');
      if (mv) { moverExercicio(mv.dataset.id, Number(mv.dataset.mover)); return; }
      const rm = e.target.closest('[data-remover]');
      if (rm) { removerExercicio(rm.dataset.remover); return; }
      const mp = e.target.closest('[data-mapa]');
      if (mp) abrirMapa(mp.dataset.mapa);
    });
    g.addEventListener('input', (e) => {
      const c = e.target.closest('[data-campo]');
      if (c && c.tagName !== 'SELECT' && c.type !== 'date') { editarCardio(c.dataset.campo, c.value); return; }
      const m = e.target.closest('[data-mc]');
      if (m && m.dataset.mc !== 'exercicio') editarMusc(m.closest('tr').dataset.id, m.dataset.mc, m.value);
    });
    g.addEventListener('change', (e) => {
      const c = e.target.closest('select[data-campo], input[type="date"][data-campo]');
      if (c) { editarCardio(c.dataset.campo, c.value); return; }
      const ss = e.target.closest('[data-sessao]');
      if (ss) { editarSessao(ss.dataset.sessao, ss.value.trim()); return; }
      const m = e.target.closest('input[data-mc="exercicio"]');
      if (m) { editarMusc(m.closest('tr').dataset.id, 'exercicio', m.value.trim().toUpperCase()); return; }
      const aq = e.target.closest('input[data-aquec]');
      if (aq) { alternarAquecimento(aq.checked); return; }
      const mi = e.target.closest('input[data-mapa-input]');
      if (mi) definirMapa(mi.dataset.mapaInput, mi.value);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.aberto && !$('dialog[open]')) fechar(); });
  }

  // ---------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------
  function preencherListas() {
    $('#dl-exercicios').innerHTML = [...new Set(S.atual.depara.map((d) => String(d.exercicio_pt || '').trim()).filter(Boolean))]
      .sort().map((n) => `<option value="${esc(n)}">`).join('');
    const tec = new Set([...TECNICAS, ...S.atual.musculacao.map((r) => String(r.tecnica || '').trim()).filter(Boolean)]);
    $('#dl-tecnicas').innerHTML = [...tec].map((n) => `<option value="${esc(n)}">`).join('');
    const grupos = new Set([...GRUPOS, ...S.atual.musculacao.map((r) => String(r.grupo || '').trim()).filter(Boolean)]);
    $('#dl-grupos').innerHTML = [...grupos].map((n) => `<option value="${esc(n)}">`).join('');
  }

  function iniciar(estado) {
    if (UI.aberto) fechar();
    S = estado;
    salvar();
    recalcularBase();
    recalcular();
    selecionar('futuro');
    preencherListas();
    invalidarScript();
    renderFonte();
    renderFiltros();
    renderSemanas();
    renderEnvio();
    const atual = $('.semana-atual');
    if (atual && D.treinos.some((t) => t.data && t.data < B.segundaDe(hoje)) && !UI.esconderPassadas) {
      setTimeout(() => atual.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
  }

  async function boot() {
    ligarEventos();
    const salvo = carregarSalvo();
    if (salvo) { iniciar(salvo); return; }
    try { iniciar(await carregarDoProjeto()); }
    catch (e) { iniciar(estadoVazio()); }
  }

  boot();
})();
