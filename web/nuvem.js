/**
 * Body+ · nuvem
 * =============
 * Guarda o plano no Worker do projeto (worker/, KV PLANOS) para abrir igual no
 * celular ou em outro computador. Salva sozinho a cada mudança.
 *
 * Privacidade: a pessoa recebe um código de 24 letras/números (120 bits). Dele
 * saem, aqui no navegador, o id (hash) e a chave AES-GCM. O plano vai comprimido e
 * CIFRADO: o Worker e o Cloudflare só veem um bloco ilegível sob um hash. Sem o
 * código ninguém lê o plano — nem quem mantém o Body+ — e também não há como recuperá-lo.
 *
 * Conflito: cada gravação diz em qual versão se baseou; se outro aparelho gravou antes,
 * a página pergunta qual manter (nada se perde calado).
 */
(function (raiz) {
  'use strict';

  // ---------------------------------------------------------------------
  // Código, chave e cifra (também roda no Node: web/teste.js)
  // ---------------------------------------------------------------------
  const LETRAS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford: sem I, L, O e U (não se confundem ao digitar)
  const enc = new TextEncoder();

  function base32(bytes) {
    let val = 0, bits = 0, out = '';
    for (const b of bytes) {
      val = ((val << 8) | b) & 0xffff; bits += 8;
      while (bits >= 5) { out += LETRAS[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    return bits ? out + LETRAS[(val << (5 - bits)) & 31] : out;
  }
  const novoCodigo = () => base32(crypto.getRandomValues(new Uint8Array(15)));   // 120 bits = 24 caracteres
  /** O que a pessoa digitou → só as 24 letras (O vira 0; I e L viram 1; traços e espaços saem). */
  const normalizar = (c) => String(c || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
  const valido = (c) => { const n = normalizar(c); return n.length === 24 && [...n].every((ch) => LETRAS.includes(ch)); };
  const formatar = (c) => normalizar(c).match(/.{1,4}/g).join('-');

  /** Código → {id: hash hex para o Worker, chave: AES-GCM}. Separados por prefixo: um não revela o outro. */
  async function derivar(codigo) {
    const n = normalizar(codigo);
    const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
    const id = [...(await h('bodyplus:id:' + n))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const chave = await crypto.subtle.importKey('raw', await h('bodyplus:chave:' + n), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { id, chave };
  }

  const comprimir = async (txt) => new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const descomprimir = async (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  function paraB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const deB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  /** texto → base64(iv de 12 bytes + gzip cifrado). */
  async function cifrar(chave, texto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, await comprimir(texto)));
    const tudo = new Uint8Array(12 + ct.length);
    tudo.set(iv); tudo.set(ct, 12);
    return paraB64(tudo);
  }
  async function decifrar(chave, b64) {
    const tudo = deB64(b64);
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: tudo.subarray(0, 12) }, chave, tudo.subarray(12));
    return descomprimir(new Uint8Array(claro));
  }

  const API = { novoCodigo, normalizar, valido, formatar, derivar, cifrar, decifrar };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  raiz.BodyNuvem = API;

  // ---------------------------------------------------------------------
  // Sincronização (só no navegador)
  // ---------------------------------------------------------------------
  const A = raiz.BodyApp;
  const $ = (s) => document.querySelector(s);
  const CHAVE_LS = 'bodyplus:nuvem';           // {codigo, versao, pendente, em} — só neste aparelho
  const ESPERA_MS = 3000;                      // junta várias edições seguidas numa gravação
  let conf = ler();
  let cred = null;                             // {id, chave}, derivados do código uma vez
  let timer = null, ocupado = false, aplicando = false, conflito = false, conferindo = false;
  let situacao = conf ? (conf.pendente ? 'pendente' : 'salvo') : 'desligada', detalhe = '';

  function ler() { try { return JSON.parse(localStorage.getItem(CHAVE_LS) || 'null'); } catch (e) { return null; } }
  function guardar() {
    try { if (conf) localStorage.setItem(CHAVE_LS, JSON.stringify(conf)); else localStorage.removeItem(CHAVE_LS); } catch (e) { /* ok */ }
    render();
  }
  const credenciais = async () => cred || (cred = await derivar(conf.codigo));
  const linkDe = (codigo) => `${location.origin}${location.pathname}#nuvem=${formatar(codigo)}`;
  const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  async function pedir(metodo, corpo, keepalive) {
    const { id } = await credenciais();
    let r;
    try {
      r = await fetch(`${A.WORKER}/plano/${id}`, {
        method: metodo, keepalive: !!keepalive,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch (e) { throw new Error('sem conexão com a nuvem'); }
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }

  /** O plano da nuvem: {estado, versao, em}, ou null se não há nada com esse código. */
  async function baixar() {
    const r = await pedir('GET');
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(r.j.erro || 'a nuvem respondeu ' + r.status);
    const { chave } = await credenciais();
    let estado;
    try { estado = JSON.parse(await decifrar(chave, r.j.dados)); } catch (e) { throw new Error('não consegui abrir o plano da nuvem com esse código'); }
    return { estado, versao: r.j.versao, em: r.j.em };
  }

  function aplicarRemoto(r) {
    aplicando = true;                          // a troca salva no navegador: não é edição para mandar de volta
    try { A.substituir(r.estado); } finally { aplicando = false; }
    Object.assign(conf, { versao: r.versao, em: r.em, pendente: false });
    situacao = 'salvo';
    guardar();
  }

  function agendar(ms) { clearTimeout(timer); timer = setTimeout(() => enviar(), ms); }

  async function enviar(keepalive) {
    if (!conf || !conf.pendente || ocupado || conflito) return;
    ocupado = true; situacao = 'salvando'; render();
    conf.pendente = false;                     // se mudar durante o envio, volta a true e sai outra gravação
    let deuCerto = false;
    try {
      const { chave } = await credenciais();
      const dados = await cifrar(chave, JSON.stringify(A.estado()));
      const r = await pedir('PUT', { base: conf.versao, dados }, keepalive && dados.length < 60000);
      if (r.status === 409) { conf.pendente = true; guardar(); ocupado = false; return resolverConflito(r.j.versao); }
      if (r.status !== 200) throw new Error(r.j.erro || 'a nuvem respondeu ' + r.status);
      Object.assign(conf, { versao: r.j.versao, em: r.j.em });
      situacao = 'salvo'; deuCerto = true;
    } catch (e) {
      conf.pendente = true; situacao = 'erro'; detalhe = e.message;
      agendar(30000);                          // tenta de novo sozinho
    } finally {
      ocupado = false;
      guardar();
      if (deuCerto && conf && conf.pendente) agendar(1000);
    }
  }

  /** Abriu a página ou voltou para a aba: a nuvem tem versão mais nova? */
  async function conferir() {
    if (!conf || ocupado || conflito || conferindo) return;   // uma conferência por vez (voltar para a aba dispara várias)
    conferindo = true;
    try {
      const r = await baixar();
      if (!r) {                                // apagado em outro aparelho
        conf = null; cred = null; situacao = 'desligada'; guardar();
        A.toast('O plano foi apagado da nuvem em outro aparelho. Este aparelho continua com os treinos dele.', 6000);
        return;
      }
      if (r.versao > conf.versao) {
        if (conf.pendente) return resolverConflito(r.versao, r);
        aplicarRemoto(r);
        A.toast('Plano atualizado com o que foi salvo em outro aparelho.', 4000);
      } else if (conf.pendente) agendar(500);
      else { situacao = 'salvo'; render(); }
    } catch (e) { situacao = 'erro'; detalhe = e.message; render(); }
    finally { conferindo = false; }
  }

  /** Os dois lados mudaram: a pessoa escolhe qual fica. */
  async function resolverConflito(versaoNuvem, remoto) {
    conflito = true; situacao = 'conflito'; render();
    const dlg = $('#nuvem-conflito');
    dlg.returnValue = '';
    dlg.showModal();
    // o clique no botão decide na hora; o "close" (Esc, clique fora) só vale se ninguém clicou
    const escolha = await new Promise((ok) => {
      const fim = (v) => { dlg.removeEventListener('click', clique); dlg.removeEventListener('close', fechou); ok(v); };
      const clique = (e) => { const b = e.target.closest('button[value]'); if (b) fim(b.value); };
      const fechou = () => fim(dlg.returnValue);
      dlg.addEventListener('click', clique);
      dlg.addEventListener('close', fechou);
    });
    conflito = false;
    if (escolha === 'aqui') {                  // grava por cima, baseado na versão da nuvem
      conf.versao = versaoNuvem; conf.pendente = true; guardar(); return enviar();
    }
    if (escolha === 'nuvem') {
      try { aplicarRemoto(remoto || (await baixar())); A.toast('Pronto: este aparelho agora tem a versão da nuvem.'); }
      catch (e) { situacao = 'erro'; detalhe = e.message; render(); }
      return;
    }
    situacao = 'pendente'; render();           // fechou sem escolher: pergunta de novo na próxima mudança
  }

  async function ativar() {
    conf = { codigo: novoCodigo(), versao: 0, pendente: true }; cred = null;
    await enviar();
    if (situacao === 'erro') {                 // não chegou na nuvem: volta a desligada
      const msg = detalhe; clearTimeout(timer); conf = null; cred = null; situacao = 'desligada'; guardar();
      A.toast('Não consegui ativar a nuvem: ' + msg + '.', 6000);
      return;
    }
    A.toast('Nuvem ativada: daqui em diante tudo é salvo sozinho.', 4000);
  }

  async function entrar(codigo) {
    if (!valido(codigo)) { A.toast('Código inválido: são 24 letras e números.', 4000); return false; }
    const antes = conf;
    conf = { codigo: normalizar(codigo), versao: 0, pendente: false }; cred = null;
    try {
      const r = await baixar();
      if (!r) throw new Error('nenhum plano salvo com esse código');
      if (A.temTreinos() && !confirm('Abrir o plano da nuvem troca os treinos deste aparelho pelos de lá. Continuar?')) throw new Error('');
      aplicarRemoto(r);
      A.toast('Pronto: este aparelho usa o plano da nuvem e salva nela sozinho.', 4000);
      return true;
    } catch (e) {
      conf = antes; cred = null; guardar();
      if (e.message) A.toast(e.message.replace(/^./, (c) => c.toUpperCase()) + '.', 5000);
      return false;
    }
  }

  function desligar() {
    clearTimeout(timer); conf = null; cred = null; situacao = 'desligada'; guardar();
    A.toast('Nuvem desligada neste aparelho. O plano continua na nuvem para os outros aparelhos.', 5000);
  }

  async function apagar() {
    if (!confirm('Apagar o plano da nuvem? Os outros aparelhos param de sincronizar; este continua com os treinos dele.')) return;
    try {
      const r = await pedir('DELETE');
      if (r.status !== 200) throw new Error(r.j.erro || 'a nuvem respondeu ' + r.status);
      clearTimeout(timer); conf = null; cred = null; situacao = 'desligada'; guardar();
      A.toast('Plano apagado da nuvem.');
    } catch (e) { A.toast('Não consegui apagar: ' + e.message + '.', 5000); }
  }

  // ---------------------------------------------------------------------
  // Tela: status no topo e janela "Salvar na nuvem"
  // ---------------------------------------------------------------------
  const TEXTO = {
    salvo: 'Salvo na nuvem', salvando: 'Salvando na nuvem…', pendente: 'Salvando na nuvem…',
    erro: 'Nuvem: sem conexão, salvo só aqui', conflito: 'Nuvem: escolha qual versão manter',
  };
  function render() {
    const st = $('#nuvem-status');
    st.hidden = !conf;
    if (conf) {
      st.querySelector('span').textContent = TEXTO[situacao] || 'Nuvem';
      st.className = 'nuvem-status' + (situacao === 'erro' || situacao === 'conflito' ? ' nuvem-aviso' : '');
      st.title = situacao === 'erro' ? detalhe + ' — tento de novo sozinho' : conf.em ? 'Última gravação: ' + hora(conf.em) : '';
    }
    $('#nuvem-desligada').hidden = !!conf;
    $('#nuvem-ligada').hidden = !conf;
    if (conf) {
      $('#nuvem-estado').textContent = situacao === 'erro' ? `Sem conexão com a nuvem (${detalhe}). As mudanças ficam neste aparelho e sobem sozinhas quando a conexão voltar.`
        : conf.em ? `Tudo salvo. Última gravação: ${hora(conf.em)}.` : 'Salvando…';
      $('#nuvem-link').textContent = linkDe(conf.codigo);
      $('#nuvem-cod').textContent = formatar(conf.codigo);
    }
  }

  document.addEventListener('bodyplus:salvo', () => {
    if (!conf || aplicando) return;
    conf.pendente = true;
    if (situacao !== 'erro') situacao = 'pendente';
    guardar();
    agendar(ESPERA_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (!conf) return;
    if (document.visibilityState === 'hidden' && conf.pendente) { clearTimeout(timer); enviar(true); }
    if (document.visibilityState === 'visible') conferir();
  });

  const abrir = () => { $('.menu').open = false; render(); $('#nuvem').showModal(); };
  $('#btn-nuvem').addEventListener('click', abrir);
  $('#nuvem-status').addEventListener('click', abrir);
  $('#nuvem-ativar').addEventListener('click', async (e) => { e.target.disabled = true; await ativar(); e.target.disabled = false; });
  $('#nuvem-entrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await entrar($('#nuvem-codigo').value)) { $('#nuvem-codigo').value = ''; }
  });
  $('#nuvem-copiar-link').addEventListener('click', () => A.copiarTexto(linkDe(conf.codigo), 'Link copiado. Abra no outro aparelho (mande só para você mesmo).'));
  $('#nuvem-copiar-cod').addEventListener('click', () => A.copiarTexto(formatar(conf.codigo), 'Código copiado.'));
  $('#nuvem-desligar').addEventListener('click', desligar);
  $('#nuvem-apagar').addEventListener('click', apagar);

  // link "…#nuvem=CODIGO" vindo de outro aparelho: abre o plano e tira o código da barra de endereço
  const doLink = location.hash.match(/nuvem=([0-9A-Za-z-]+)/);
  if (doLink) {
    history.replaceState(null, '', location.pathname + location.search);
    entrar(doLink[1]);
  } else conferir();
  render();
})(typeof window !== 'undefined' ? window : globalThis);
