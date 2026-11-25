// Body+ · na aba do Garmin, desde o carregamento: guarda o token da sessão
// quando o próprio app faz as chamadas dele. Assim o envio não precisa pedir
// o clique na seta do mês. Só lê o header; nunca muda nada do app.
THUploader.thEnviar(null, { soGancho: true });
