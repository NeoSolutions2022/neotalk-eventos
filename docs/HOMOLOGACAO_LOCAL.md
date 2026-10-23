# Homologação local — serviços reais

Este ambiente executa o checkout da plataforma e o checkout irmão
`../release-avatar`, sem fazer merge ou publicar em produção. PostgreSQL e
armazenamento de poses são próprios. Apenas as integrações NeoTalk e OpenAI
continuam remotas e reais: há consumo de API e tarefas de processamento reais.
Não executar uma bateria concorrente grande durante um evento de produção.

## Preparação

1. Iniciar o Docker Desktop com o mecanismo Linux.
2. Confirmar os commits dos dois checkouts com `git rev-parse HEAD` e anotar
   alterações locais com `git status --short`. O contexto de build inclui estas
   alterações: o commit sozinho não identifica um checkout modificado.
3. Confirmar que os binários LFS em `../release-avatar/webgl/elia/Build` estão
   presentes, e não são ponteiros LFS. Não é necessário recompilar o Unity para
   testar as mudanças JavaScript/backend atuais.
4. Preencher `.env.homolog.local` com `NEOTALK_API_KEY`, `OPENAI_API_KEY` e
   `HOMOLOG_ADMIN_PASSWORD` (senha local exclusiva com pelo menos 10 caracteres).
   O arquivo é ignorado pelo Git. Não usar senhas ou banco de produção.

Na raiz do checkout da plataforma:

```powershell
docker compose --env-file .env.homolog.local -f compose.homolog.yaml config --quiet
docker compose --env-file .env.homolog.local -f compose.homolog.yaml up --build -d
docker compose --env-file .env.homolog.local -f compose.homolog.yaml ps
```

Se faltarem credenciais, o Compose deve rejeitar a configuração antes de criar
serviços. Não imprimir `docker compose config` sem `--quiet`: o resultado
resolvido contém segredos. As imagens Python/Node/PostgreSQL precisam ser
baixadas na primeira execução; o build exige memória adicional aos limites de
execução dos containers. Não iniciar vários builds pesados em paralelo.

## Endereços e dados

- Plataforma: <http://localhost:3310>
- Login administrativo **local**: `qa@homolog.invalid` e a senha escolhida.
- API: <http://localhost:38100/api/v1/health>
- Widget candidato: <http://localhost:38080/widget?avatar=elia>
- Avatar health: <http://localhost:38080/api/v1/health>

Usar `localhost`, não alternar com `127.0.0.1`: origem, cookie e permissão do
microfone devem permanecer consistentes. As portas são publicadas somente em
loopback. O PostgreSQL não tem porta publicada. Não há montagem de diretórios
de dados de produção, nem `container_name` compartilhado com outros ambientes.
O projeto Compose é `neotalk-homolog-observability`; seus volumes são exclusivos.

Após entrar, sincronizar o dataset pela tela Qualidade. Essa sincronização lê
o catálogo remoto e grava somente o banco local. Conferir integrações e uma
frase antes de coletar 100 lotes; não substituir falhas por mocks silenciosos.

Uma checagem inicial reproduzível (uma frase sintética, GPT e poses reais):

```powershell
node scripts/homolog-smoke.mjs
```

O script autentica apenas no backend local, sincroniza o catálogo local,
traduz uma frase e solicita uma pose real. Grava status, contagens e tempos
em `outputs/homolog-local/smoke.json`, sem conteúdo das respostas, chaves,
cookies ou transcrição. Não testa navegador, voz ou execução dos frames.

## Primeira execução — 23/10/2026

- Plataforma base `bc42e0a`; avatar base `96aaaf4`; arquivos desta configuração
  local ainda não incluídos nesses commits no momento do build.
- Três imagens candidatas construídas e quatro serviços iniciados em Docker
  Linux (PostgreSQL usa a imagem oficial).
- Health da API e do avatar: HTTP 200; proxy da interface: HTTP 200 e banco
  conectado. Login administrativo via script: HTTP 200.
- Sincronização real: 1.521 palavras. Tradução real: quatro glosas; pose real
  pronta com 298 frames. Nenhuma substituição por mock nessa checagem.
- 118 testes Node aprovados, incluindo dois testes novos da configuração
  isolada; `git diff --check` sem erros.
- Durante a preparação havia entre 0,86 e 1,5 GiB de RAM livre. Esses números
  não aprovam uma bateria longa com navegador e Unity. Build/health e retorno
  de uma pose não comprovam animação nem fluidez do mini-player.
- Login foi enviado pela interface no Brave, mas a observação posterior da
  aba expirou. Navegação, captura, primeiro/último frame e 100 lotes continuam
  **pendentes**; nenhum ganho de performance ponta a ponta foi atestado.

## Coleta e limites da evidência

Registrar versão dos dois checkouts, manifesto/hash do WebGL servido, navegador,
hardware, cache frio/quente, modo de áudio, saída principal/mini-player e texto
de teste. Separar:

- fala/microfone reais versus transcrição injetada;
- APIs reais versus respostas simuladas;
- mini-player nativo versus janela simulada;
- renderização GPU versus renderizador por software;
- tempo total e distribuição de latência por etapa (p50/p95), erros,
  pendências, descartes, reinicializações e pausas automáticas.

Usar modo tradução, não apresentação. Exportar o JSON de diagnóstico
administrativo ao final, aguardando a drenagem e anotando o tempo dela. Obter
pelo menos 100 lotes completos com primeiro e último frame observados; contar
também todos os lotes incompletos/erros, sem retirá-los da análise. Não agrupar
execuções frias/quentes ou saídas diferentes para esconder pausas. Não publicar
áudio, chaves, cookies ou transcrições pessoais nos relatórios.

Um teste com APIs reais e áudio injetado valida parte do fluxo, mas não aprova
a captura real. Um teste local não comprova desempenho da infraestrutura de
produção, compatibilidade de todos os navegadores ou qualidade linguística.
Comparações antes/depois exigem o mesmo roteiro e condições documentadas;
não atribuir à mudança de software diferenças de rede ou de hardware.

## Encerrar sem apagar dados

```powershell
docker compose --env-file .env.homolog.local -f compose.homolog.yaml stop
```

Não usar `down -v` durante a coleta: apaga as evidências persistidas no banco
e no cache local. Não modificar os arquivos Compose de produção para este teste.
