// Body+ · ponte entre a página do Body+ e a extensão.
// A página avisa com window.postMessage; só esta origem (manifest) chega aqui.
// A marca é a assinatura do código de envio desta extensão: se a página tiver
// outro uploader.js (extensão não recarregada), ela percebe e não envia.
document.documentElement.dataset.bodyplusExtensao = THUploader.hash(THUploader.thEnviar.toString());

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== location.origin || !e.data || e.data.tipo !== 'bodyplus:enviar') return;
  let r;
  try {
    r = await chrome.runtime.sendMessage({ tipo: 'enviar', dados: e.data.dados, opcoes: e.data.opcoes });
  } catch (err) {
    r = { ok: false, erro: 'a extensão foi atualizada — recarregue esta página' };
  }
  window.postMessage({ tipo: 'bodyplus:resposta', ...r }, location.origin);
});
