# Body+

Meus treinos — corrida, bike, musculação, yoga, natação, o que for — cada um
na sua data, e enviados para o calendário do Garmin Connect por um script
colado na aba do navegador já logada. Sem login pelo script, sem bloqueio 429.

É uma página estática (`index.html` + `web/`). Tudo roda no navegador: as
edições ficam guardadas nele até você baixar a planilha.

## Abrir

```powershell
py -m http.server 8000
```

e abra http://localhost:8000. (Aberta direto do disco, a página funciona, mas
não lê `data/treinos.xlsx` nem o catálogo de exercícios do Garmin.)

Na primeira abertura pelo `localhost` ela carrega `data/treinos.xlsx`. Se você
já usava a versão Time Híbrido neste navegador, as edições guardadas são
migradas sozinhas (as datas ficam as mesmas).

Também dá para usar pelo GitHub Pages: https://filipejefte.github.io/bodyplus/.
Lá quem abre pela primeira vez não vê os seus treinos: começa com um exemplo
(3 corridas — leve, tiros e longa — e um ABC de musculação, a partir do dia em
que abriu), e o menu não oferece recarregar `data/treinos.xlsx`. Cada endereço guarda as edições à parte, no
navegador: para levar os treinos do `localhost` para o Pages, use **Baixar
planilha** num e **Importar → Substituir tudo** no outro.

## Usar

- **Semanas** ou **Calendário**, no alto: a lista por semana ou o mês
  inteiro. No calendário cada treino aparece com o perfil dele; clique num dia
  para ver os cartões dele embaixo (no celular, toque no dia), e no **+** de um
  dia para criar um treino nele. A escolha fica guardada.
- **+ Novo treino** (no topo ou o **+ treino** de cada semana): escolha a
  modalidade e a data, e edite na gaveta que abre.
  - **Cardio** (corrida, bike, caminhada, trilha, natação, cardio, HIIT, yoga,
    pilates, mobilidade, outro): intervalado, contínuo, distância ou prova
    (corrida), com aquecimento/desaquecimento e alvo por zona de FC
    (ou *sem alvo*).
  - **Musculação**: exercícios, blocos (mesmo bloco = bi-set), séries, reps,
    descanso; cada exercício precisa de um par no catálogo do Garmin
    (clique no chip ⚠ *escolher*).
- **Duplicar** copia o treino para a semana seguinte; **Excluir** tira da página
  (no Garmin ele continua — para tirar de lá, use **Apagar do Garmin**).
- **Importar**: PDF do plano do Time Híbrido ou uma planilha `.xlsx`.
  - Plano por semanas: escolha a segunda-feira da semana 1 e o dia de cada
    treino de musculação — cada treino ganha a sua data.
  - **Adicionar aos meus treinos** soma ao que já está aqui;
    **Substituir tudo** troca (é como abrir de volta uma planilha baixada).
  - Prefixo nos nomes (ex.: `3K`) separa dois planos com os mesmos nomes.
  - Outro tipo de PDF ainda não é lido — só o do Time Híbrido.
- Menu **⋯**: **Baixar planilha** (salva tudo em `.xlsx`; substitua
  `data/treinos.xlsx` por ela para guardar no projeto e editar em massa no
  Excel), recarregar `data/treinos.xlsx`, descartar edições e começar do zero.
- Menu **⋯ → Salvar na nuvem**: o mesmo plano no PC e no celular, salvo
  sozinho (veja **Nuvem**, abaixo).
- **Apoiar**, no topo da página: o Pix de apoio, de qualquer valor.
- **Assistente**: o botão redondo no canto inferior direito.
- No painel de envio, calendário, "se já existe" e "só simular" ficam em
  **Opções**; limpar o calendário ou "Meus treinos" inteiros fica em **Limpar o
  Garmin inteiro**.

### Assistente (IA)

**Assistente**, o botão no canto de baixo, abre um chat: escreva o que quer ("monte 4 semanas de
corrida para 5 km", "passa o treino de pernas para segunda que vem", "troca o
supino por flexão") e ele propõe as mudanças. Nada muda até você clicar em
**Aplicar**, e dá para **Desfazer** em seguida.

- Usa o Gemini, do Google, com uma chave só para todo mundo: ninguém precisa
  configurar nada. Para responder, os treinos desta semana em diante vão para o
  Gemini.
- A chave fica num Cloudflare Worker do projeto (pasta `worker/`), nunca na
  página. O Worker só atende o GitHub Pages e o `localhost:8000`, limita 6
  perguntas por minuto por pessoa e não guarda nada.
- A cota gratuita do Gemini é dividida entre todos. Quando a do dia acaba, o
  Worker passa para o próximo modelo da lista (`MODELOS` no
  `worker/wrangler.toml`); quando todos acabam, o painel avisa e volta no dia
  seguinte. Use uma chave de projeto **sem cobrança ligada**: no pior caso a
  cota acaba, mas nunca há conta para pagar.
- As datas: o modelo diz "semana que vem, segunda" e o Body+ faz a conta.
  Confira a lista de mudanças antes de aplicar.

**Publicar o Worker** (uma vez):

1. Crie a chave em https://aistudio.google.com/apikey, num projeto sem
   cobrança.
2. Crie uma conta gratuita em https://dash.cloudflare.com/sign-up.
3. No terminal, na pasta do projeto:

   ```powershell
   cd worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GEMINI_API_KEY
   ```

   O `login` abre o navegador para autorizar. No primeiro `deploy`, ele pede
   um nome para o seu subdomínio `workers.dev` e mostra o endereço do Worker
   (`https://bodyplus-ia.<subdomínio>.workers.dev`). O `secret put` pede a
   chave: cole e aperte Enter (ela fica só no Cloudflare).
4. Coloque esse endereço em `WORKER`, no fim de `web/app.js` (assistente e
   nuvem usam o mesmo), e envie ao GitHub.

Se o `deploy` recusar o bloco `[[ratelimits]]` do `wrangler.toml`, apague esse
bloco e rode de novo: o Worker funciona sem ele (só sem o limite por pessoa).
Conferência do Worker: `node worker/teste.mjs`.

### Nuvem (PC e celular)

Sem a nuvem, o plano fica só no navegador onde você abriu o Body+: limpar os
dados do navegador apaga, e o celular tem outro plano. Com ela:

1. Menu **⋯ → Salvar na nuvem → Ativar neste aparelho**. A partir daí cada
   mudança é salva sozinha (o topo mostra **Salvo na nuvem**).
2. No outro aparelho, abra o **link** da mesma janela (mande para você mesmo
   pelo WhatsApp ou e-mail) — ou cole o **código** em "Já ativou em outro
   aparelho?". Os dois passam a usar o mesmo plano.

- **Privado de verdade**: o plano sai do aparelho comprimido e **cifrado**
  (AES-GCM) com uma chave tirada do seu código. O Worker e o Cloudflare só
  guardam um bloco ilegível, sob um hash do código. Nem quem mantém o Body+ lê.
- **Guarde o código**: sem ele não há como recuperar o plano. E quem tiver o
  link ou o código abre e muda os seus treinos — mande só para você.
- **Sem internet** o topo avisa "salvo só aqui" e as mudanças sobem sozinhas
  quando a conexão volta.
- **Dois aparelhos mudaram ao mesmo tempo**: o Body+ pergunta qual versão
  manter. Nada é sobrescrito calado.
- **Desligar neste aparelho** para de sincronizar só ali; **Apagar da nuvem**
  tira o plano do Worker (os aparelhos continuam com a cópia deles).

**Publicar a nuvem** (uma vez, depois do Worker do assistente):

```powershell
cd worker
npx wrangler kv namespace create PLANOS
```

Copie o `id` que ele mostra para `[[kv_namespaces]]` no `worker/wrangler.toml`
e rode `npx wrangler deploy`. O plano gratuito do Cloudflare (1 GB e mil
gravações por dia) sobra para algumas pessoas: a página junta as edições e
salva no máximo a cada poucos segundos.

O traço embaixo de cada cartão é o **perfil do treino**: largura = tempo,
altura e cor = zona de FC (cinza sem alvo, azul Z2, verde Z3, laranja Z4,
vermelho Z5; violeta = exercício/esforço sem zona).

### Nomes

O Garmin é consultado pelo nome, então cada treino precisa de um nome único:

| Origem | Nome automático |
|--------|-----------------|
| seu | `25/11 · Contínuo 30 min`, `25/11 · Bike intervalado 4:2`, `26/11 · Pernas` |
| plano importado | `S01 · Intervalado 1:1`, `S01 A · Peito/Ombro/Tríceps` |
| com prefixo | `3K S01 · Intervalado 1:1` |

Ou escreva um nome seu no campo *Nome no Garmin*. Mudou o nome (ou a data, num
treino seu) depois de enviar? No próximo envio o treino antigo é substituído.

## Enviar ao Garmin

Nada de senha nem login: o envio usa a sua sessão já aberta no Garmin Connect,
no mesmo navegador. Há dois jeitos.

### Com a extensão (um clique)

Instale uma vez, no Opera, Chrome ou Edge:

1. Abra a página de extensões (`opera://extensions`, `chrome://extensions` ou
   `edge://extensions`) e ligue o **Modo de desenvolvedor**.
2. Clique no botão de carregar extensão descompactada (*Load unpacked*; no
   Chrome em português, **Carregar sem compactação**) e escolha a pasta
   `extensao/` deste projeto.
3. Recarregue o Body+.

Depois disso, selecione os treinos (o padrão é "de hoje em diante") e clique
em **Enviar ao Garmin**. Uma aba nova abre no calendário do Garmin e o painel
no canto mostra o progresso e, no fim, confere se tudo ficou certo. Se pedir
login, entre na conta: o envio começa quando a aba voltar ao calendário.

A extensão só entra em `localhost:8000`, `127.0.0.1:8000`, no GitHub Pages do
projeto e no `connect.garmin.com`. Mudou algum arquivo de `extensao/`? Clique
em **recarregar** nela, na página de extensões, e depois recarregue o Body+. Se
esquecer, o Body+ avisa que a extensão está desatualizada e não envia nada (a
versão antiga faria outra coisa: por exemplo, enviaria em vez de apagar).

### Sem a extensão (script de colar)

1. Selecione os treinos e clique em **Gerar script** → **Copiar script**.
2. Abra https://connect.garmin.com/app/calendar já logado.
3. `F12` → aba **Console** → cole → `Enter`. Se o navegador bloquear a
   colagem, digite `allow pasting` e cole de novo.
4. Quando o painel no canto pedir, clique na seta ‹ › do mês (ou em **Ano**):
   é assim que o script pega o token da sua sessão.

Nos dois jeitos dá para enviar de novo: o que já foi feito é pulado. Se a
sessão cair, entre na conta de novo e repita o envio.

### Apagar do Garmin

**Apagar do Garmin** (logo abaixo do envio) tira do Garmin os treinos
selecionados: some de "Meus treinos" e do calendário. Funciona com a extensão
ou pelo script, e respeita o *Só simular*.

- Procura pelo nome do treino (e pelos nomes antigos, se você o renomeou).
  Nada além dos selecionados é tocado.
- O painel no Garmin mostra quantos vai apagar e pede **Apagar** antes de
  começar. Não dá para desfazer; para trazer de volta, envie de novo.
- Treino com o mesmo nome mas outro conteúdo no Garmin (e que você não editou
  aqui) fica de fora, como no envio: provavelmente é de outro plano.

### Limpar o Garmin inteiro

No fim do painel de envio, **Limpar o Garmin inteiro** age sobre tudo da conta,
não só os selecionados (inclusive o que não veio do Body+). Os dois pedem
confirmação no painel do Garmin e respeitam o *Só simular*.

- **Calendário**: tira todos os treinos das datas, do ano passado até o ano que
  vem. Os treinos continuam em "Meus treinos". A lista do que saiu fica no
  Console da aba do Garmin. Para recolocar os do Body+ nas datas, envie de novo
  com "Colocar na data daqui".
- **Meus treinos**: apaga todos os treinos da biblioteca (e, com eles, as
  datas). Antes de apagar qualquer um, baixa uma cópia de todos em
  `garmin-meus-treinos-AAAA-MM-DD.json`; se não conseguir ler algum, para sem
  apagar nada. Os do Body+ voltam se você enviar de novo.

Depois de apagar ou limpar, recarregue a página do Garmin (F5): o calendário
aberto não se atualiza sozinho.

Para limpar só esta página (sem mexer no Garmin), use **⋯ → Começar do zero**.

| Opção | O que faz |
|-------|-----------|
| Colocar na data daqui (padrão) | Agenda ou move os selecionados para a data mostrada na página. |
| Manter as datas que já estão no Garmin | Agenda só o que ainda não está no calendário; o que você moveu à mão no Garmin fica onde está. |
| Não mexer no calendário | Só cria/atualiza em "Meus treinos". |
| Se já existe: pular / substituir | Treino com o mesmo nome é reaproveitado ou recriado. Novos e editados aqui são substituídos quando estão diferentes do Garmin. |
| Só simular | Lista no Console o que faria, sem gravar nada. |

Treino com o mesmo nome mas outro conteúdo no Garmin (e que você não editou
aqui) não é tocado: o script pergunta se continua só com os outros.

## Zonas de FC

O relógio segue as zonas da sua conta. Para bater com os treinos, configure por
% da FCmáx (Garmin Connect → Configurações → Frequência cardíaca → Zonas):
Z1 50–59% · Z2 60–69% · Z3 70–79% · Z4 80–89% · Z5 90–95%.

## Por dentro

```
index.html            página
web/app.js            interface: semanas, editor, novo treino, importar, envio, Pix
web/assistente.js     chat do assistente: propõe mudanças, você aplica ou desfaz
web/nuvem.js          nuvem: código → id + chave, plano cifrado no Worker, conflitos
worker/index.js       Cloudflare Worker: chave do Gemini e planos cifrados (KV) — node worker/teste.mjs
worker/gemini.js      regra de assunto e conversão do chat para o Gemini
web/builder.js        linhas da planilha → JSON do Garmin (nomes, passos, datas do plano)
web/pdf-plano.js      leitura do PDF do Time Híbrido (pdf.js, no navegador)
web/depara.js         De-para padrão exercício → catálogo do Garmin
web/style.css         visual
web/teste.js          conferência do montador e do envio: node web/teste.js
extensao/uploader.js  envio que roda na aba do Garmin (extensão e script de colar)
extensao/background.js  abre a aba do Garmin e roda o envio nela
extensao/ponte.js     liga a página do Body+ à extensão
extensao/garmin.js    guarda o token da sessão desde o carregamento da aba
data/treinos.xlsx     seus treinos (abas Cardio, Musculação, De-para)
data/garmin_exercises.json  catálogo de exercícios do Garmin
```

- A página não fala com o Garmin (outro domínio). O envio roda na aba do
  Garmin e usa `/gc-api/...` com os cookies da sessão + o header
  `connect-csrf-token`, capturado de uma chamada do próprio app
  (caminho validado em 12/08/2026). Os treinos vão compactados (gzip + base64).
  A extensão roda exatamente o mesmo `thEnviar` do script de colar; ela só
  pula o copiar/colar e o clique no mês.
- IDs de modalidade do Garmin: corrida 1, bike 2, outro 3, natação 4,
  musculação 5, cardio 6, yoga 7, pilates 8, HIIT 9, mobilidade 11,
  caminhada 17, trilha 18. Corrida e musculação foram validadas no Garmin; as
  outras seguem o mesmo formato — confira com *Só simular* e depois no relógio.
- De-para revisto em 25/11/2026 contra o catálogo do Garmin: a cadeira
  extensora passou para a máquina (estava a versão com elástico), o pulldown
  para o de braços estendidos (a puxada alta é o Lat Pulldown), a remada alta
  para a versão genérica e a cadeira chinesa (agachamento isométrico na parede)
  para o Wall Squat — estava como flexora. O Body+ troca esses pares sozinho no que já
  estava guardado. Treinos já enviados com eles: envie de novo com
  **Substituir pelo daqui** para atualizar no Garmin. Os pares sem equivalente
  exato no Garmin (peck deck, cadeira abdutora, rosca Arnold, afundo no Smith)
  dizem isso na observação.
- O repositório é público, então `data/treinos.xlsx` também é (qualquer um
  pode baixar o arquivo). O Pages só não o abre sozinho.
- O envio usa a sessão de quem está logado no navegador: outras pessoas podem
  usar com a conta Garmin delas. É um caminho não oficial (a mesma comunicação
  interna do site do Garmin Connect, não uma API pública): pode quebrar se a
  Garmin mudar algo.
