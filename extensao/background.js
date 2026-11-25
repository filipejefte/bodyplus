// Body+ · recebe os treinos da página do Body+, abre o calendário do Garmin numa
// aba nova e roda nela o mesmo envio do script de colar (uploader.js → thEnviar).
importScripts('uploader.js');

const CALENDARIO = 'https://connect.garmin.com/app/calendar';
const chave = (abaId) => 'envio:' + abaId;

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (!msg || msg.tipo !== 'enviar' || !remetente.tab) return;
  (async () => {
    // aba em branco primeiro: o envio fica guardado antes de o Garmin começar a carregar
    const aba = await chrome.tabs.create({ url: 'about:blank', index: remetente.tab.index + 1 });
    // storage.session: sobrevive se o service worker dormir enquanto você entra na conta
    await chrome.storage.session.set({ [chave(aba.id)]: { dados: msg.dados, opcoes: msg.opcoes } });
    await chrome.tabs.update(aba.id, { url: CALENDARIO });
  })().then(() => responder({ ok: true }), (e) => responder({ ok: false, erro: e.message }));
  return true;
});

// Quando a aba chega ao Garmin (de cara, ou depois do login), roda o envio uma vez.
chrome.tabs.onUpdated.addListener(async (abaId, mudou, aba) => {
  if (mudou.status !== 'complete' || !(aba.url || '').startsWith('https://connect.garmin.com/')) return;
  const k = chave(abaId);
  const { [k]: envio } = await chrome.storage.session.get(k);
  if (!envio) return;
  await chrome.storage.session.remove(k);
  chrome.scripting.executeScript({
    target: { tabId: abaId }, world: 'MAIN', func: THUploader.thEnviar, args: [envio.dados, envio.opcoes],
  }).catch((e) => console.error('Body+:', e));
});

chrome.tabs.onRemoved.addListener((abaId) => chrome.storage.session.remove(chave(abaId)));
