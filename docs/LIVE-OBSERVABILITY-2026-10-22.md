# Diagnóstico da sala ao vivo — primeira etapa do roadmap

## Escopo

Instrumentação local, aditiva e restrita ao painel de administrador. Não altera fila, animação, limites, microfone, pagamentos nem os trabalhos anteriores de idioma e offline. Não é uma otimização de velocidade por si só.

Na sala ao vivo, iniciar uma sessão, reproduzir o cenário e usar **Diagnóstico dos players → Baixar relatório de latência** antes de iniciar outra sala. O JSON não contém áudio, transcrição, glosas, URLs ou identificadores de dispositivo. Os dados são temporários na memória da aba; não são enviados a um sistema de monitoramento. O arquivo baixado permanece no dispositivo do administrador.

## O que os números significam

Revisão posterior em `PERF-03-OBS-01-2026-10-22.md`: o relatório também separa
requisições por hit/miss de contexto, conta as palavras do catálogo fornecido
e classifica transições conforme a próxima tradução já estava pronta. Isso
não comprova preparação nativa da pose nem mede worker/download isoladamente.

| Medida | Fronteiras |
|---|---|
| admission_to_agent_ms | lote admitido → início da requisição de tradução |
| translation_request_ms | requisição → resposta, incluindo rede e retentativas |
| translation_failed_request_ms | duração de requisições que terminaram em erro, separada das bem-sucedidas |
| context_ms | consulta/cache do prompt e catálogo, incluindo espera pelo lock |
| provider_ms | bloco de chamada ao provedor, leitura/parse e eventual retentativa; não é somente inferência GPT |
| validation_ms | normalização e filtro do retorno contra o catálogo |
| service_ms | serviço de tradução completo; contém as etapas internas |
| endpoint_ms | função do endpoint, incluindo persistência; não inclui proxy, autenticação por dependência ou rede |
| ready_to_dispatch_ms | glosas prontas → despacho ao widget |
| dispatch_to_first_frame_ms | despacho → primeiro evento nativo started/progress recebido no player principal |
| native_playback_ms | primeiro evento observado → confirmação nativa do último frame |
| handoff_ms | último frame → primeiro evento da próxima execução, separado por player |
| asr_request_ms | requisição de transcrição compatível, incluindo rede e retentativas |

As etapas contidas em outras NÃO devem ser somadas novamente. Os relógios do servidor e do navegador não são comparados como timestamps: só durações dentro do mesmo relógio. `trace_id` liga uma requisição ao lote, sem entrar no prompt. O campo antigo `agent_latency_ms` continua compatível.

## Ausência de evidência e limites

- Sem evento nativo não há tempo de animação inventado a partir de um timeout ou de `playing`.
- O primeiro evento recebido pode ser `progress`: mede observação do navegador, não instante exato de apresentação na GPU.
- `null` significa sem amostras; zero é uma duração observada. O relatório informa quantidade, média, p50, p95, máximo e amostras ausentes.
- Até 512 lotes, 512 requisições de áudio e 1.024 transições. Expulsões ficam explícitas. Até quatro execuções por saída/lote.
- A duração fila→frame não mede fim acústico da fala→frame. Web Speech não expõe tempo interno do reconhecimento.
- Transição inclui silêncio/fila vazia e retomadas: interpretar com a carga aplicada. Repetições ociosas não entram nas amostras de tradução.
- Sem spans internos da API de poses, worker e download, essa parcela ainda não pode ser atribuída individualmente.
- Erros sem resposta completa deixam spans ausentes; o tempo de uma tentativa bem-sucedida do servidor não representa tentativas anteriores.
- A versão do widget fica `unreported`: não inferir versão publicada a partir do checkout local.
- Modo apresentação é identificado separadamente; não serve como evidência de tradução real.

## Sobrecarga observada no código atual

Há limites de 72 lotes pendentes, 120 palavras no buffer e seis chunks de áudio aguardando transcrição. O código pausa a captura quando há pressão e exige reativação manual. Isso permanece uma pendência funcional do roadmap, não está resolvido pela instrumentação.

Essa descrição se refere à base analisada. A candidata local posterior **QUEUE-06a** acrescenta retomada automática e uma reserva limitada para a cauda do gravador; veja `QUEUE-RECOVERY-2026-10-22.md`. A instrumentação, isoladamente, não havia corrigido o comportamento.

Atualização posterior: **QUEUE-06b** substitui a pausa/retomada por staging de captura separado. A candidata atual não muta por pressão de fila; orçamento e rejeições continuam explícitos. Veja `CAPTURE-CONTINUOUS-2026-10-22.md`.

`blockedAdmissionAttempts` conta tentativas de admissão bloqueadas, não palavras perdidas: um texto bloqueado pode continuar no buffer. `rejectedSourceWords` conta palavras que realmente excederam o buffer; `rejectedAudioChunks` conta chunks recusados antes de transcrever (quantidade de palavras desconhecida). `capturePauses`, `maxPendingBatches`, `oldestPendingMs` e `runtimeResets` ajudam a identificar o ponto de deterioração. Uma fala que não foi capturada durante a pausa não tem contagem conhecida.

## Uso para a próxima comparação

1. Fixar versão da plataforma/widget/WebGL, navegador, hardware e rede; registrar esses dados junto ao JSON.
2. Repetir a mesma fala em português a 140, 180 e 220 palavras/minuto, incluindo silêncio e retomada; separar cache frio/quente e player principal/externo.
3. Registrar ao menos 30 amostras válidas por cenário; não afirmar p95 representativo com poucas amostras.
4. Comparar taxa de chegada, tempo de execução, crescimento da fila, perda e pausas — não só a resposta do GPT.
5. Só então aplicar uma otimização isolada e repetir a carga. Sem melhoria observada, não declarar ganho.

## Verificação local

Testes de cálculo cobrem dados ausentes, limites, percentis, isolamento dos players, eventos duplicados/inválidos e privacidade. Testes das closures reais verificam correlação e ausência de coleta para usuário comum. Backend cobre preservação do contrato e trace fora do prompt. O ensaio WebGL usa Unity real, mas API e transcrição simuladas; não mede GPT ou microfone físico.

O `tsc --noEmit` integral encontra tipos Cloudflare ausentes (`cloudflare:workers`, `Fetcher`, `D1Database`) fora destas alterações; o build Vite é uma verificação distinta. Não tratar build como substituto da checagem de tipos.

### Evidência coletada em 22/10

`outputs/pitch-soak-1792679131187/ledger.json` e `latency.json` (na raiz do workspace): ensaio PASS, 18 palavras, três lotes, dois runtimes Unity reais com SwiftShader; ASR e API simulados. Todos os lotes chegaram ao último frame em ambas as saídas, sem reset ou perda de texto. Download do relatório validado. Houve uma falha 503 de heartbeat injetada pelo harness; ela não é incidente de produção.

Médias do relatório: requisição de tradução **418 ms** (double, NÃO GPT); pronto→despacho **11.28 s**; despacho→primeiro frame **11.20 s**; reprodução **5.15 s**; transição principal **13.81 s**, externa **12.22 s** (só duas transições). A fila demorou **44.83 s** para escoar após a janela de entrada. São amostras pequenas, com renderização por software, sem valor de média de produção. Evidenciam que uma API rápida, isoladamente, não garante fluidez.

Essa execução usou o build anterior às adições de `rejectedAudioChunks`, `translation_failed_request_ms` e `missing.lastFrame`; essas adições foram verificadas pelos testes de código, não por um novo ensaio WebGL. O teste anterior de 20 segundos confirmou integridade e frames, mas abortou na exportação por seletor incorreto do harness; não contabilizado como PASS integral.

Ainda não foi realizada a coleta de 100 lotes reais exigida por OBS-01. Não declarar o item inteiro concluído ou melhoria de velocidade implementada.
