# QA integrado de pitch — 6 de outubro de 2026

## Critério de aprovação

Não considerar “testes verdes” suficiente para homologar uma apresentação. Separar:

1. Integridade: entrada preservada em ordem, sem duplicação/descarte pela fila.
2. Continuidade: captura ativa, ausência de reinicializações e de exceções não tratadas.
3. Espelhamento: cada comando de reprodução confirmado pelo player externo, inclusive frases repetidas.
4. Fluidez: medir tempo da entrada até início, atraso acumulado e escoamento após terminar a fala.
5. Reprodução completa: confirmação de último frame, não somente aceitação do comando.

Meta exploratória proposta: P95 de conclusão das palavras abaixo de dez segundos. Não é um SLA já contratado. Ainda depende de revisão de produto e QA de Libras.

## Método reproduzível

`tests/pitch-browser-stress.cjs` executa a interface React, o JavaScript do widget e dois renderizadores Unity WebGL reais, em Chromium com SwiftShader. Entrada em relógio real, seis palavras a cada dois segundos (180 palavras/minuto). Quatro arquivos reais de pose: AMIGO, APRENDER, COMPRAR e COMPREENDER; as poses de todas as palavras selecionadas são concatenadas com frames completos. Tradução determinística seleciona duas glosas por frase; não constitui avaliação linguística.

Serviços HTTP e reconhecimento final de fala são substitutos controlados. Não chama GPT, banco ou APIs de produção, nem usa microfone físico. A janela externa usa um documento de mesma origem controlado pelo teste: mantém o relay e Unity reais, mas **não homologa a abertura do PiP nativo**.

Os registros ficam em `outputs/pitch-soak-<timestamp>/ledger.json`, na raiz da workspace. `tests/analyze-pitch-evidence.cjs` gera `analysis.json` com percentis de atraso, integridade e correlação individual dos ACKs.

## Falhas do próprio ensaio, mantidas na evidência

- Três tentativas de abertura com o documento inicial about:blank encerraram a janela durante o carregamento do relay. A requisição foi abortada antes de concluir. Não foi determinada a causa em produção. O documento controlado permitiu prosseguir; não é uma correção publicada do produto.
- A versão inicial de injeção de falhas dependia da primeira ocorrência de um texto. Frases repetidas podiam impedir a injeção de 502/429. Corrigido para injetar por número de requisição. Não atribuir ao ensaio anterior cobertura de falhas que não constam em `injections`.
- Houve heartbeats abortados no ensaio inicial. Isso está registrado no terminal; não atribuir esses abortos à produção nem tratar a sessão como teste de backend real.
- Medidas de heap do Chromium ficaram arredondadas. Não certificam ausência de vazamento de memória.
- Os primeiros ensaios apontaram para `tmp/avatar-main-pose-fix/frontend`, checkout sem a capacidade `prefetch`. O checkout `Avatar3DFrontend/frontend` contém o protocolo de prefetch (commit 93aebf2). O caminho padrão foi corrigido; resultados do checkout anterior são mantidos e identificados como controle, não homologação da versão atual.

## Lacuna de confirmação de fim de pose

`LiveRoom.tsx` recebe `neotalk:playing` e calcula a conclusão com `playbackDurationMs(frame_count, fps)`. O widget emite `neotalk:playing` depois de solicitar a reprodução, não depois de observar seu último frame. Não foi encontrada confirmação de término equivalente no contrato utilizado.

Consequência: “lote done” demonstra avanço da máquina de estados, não prova, isoladamente, que todos os frames foram exibidos. Afirmar reprodução integral exige telemetria do runtime ou uma validação visual temporal específica. O teste também compara pixels entre duas capturas, mas isso apenas comprova mudança visual, não a correção de cada sinal.

## Regressões

- Plataforma: 65 testes passaram novamente.
- Widget: 10 testes passaram novamente.
- Nenhum push/deploy realizado nesta rodada.

## Escopo não homologado

Uma hora de fala, microfone real, recuperação de ASR do navegador, GPT real, dataset completo, iPad/Safari/Brave, perda real de conectividade e PiP nativo. Resultados de software rendering não são benchmark de GPU de um cliente.

## Resultados

### Controle sem prefetch: reprovado por atraso

Evidência `outputs/pitch-soak-1791334988458`:

- 180 segundos de entrada, 540 palavras, 20 lotes persistidos com todas as palavras em ordem.
- Ao atingir o limite de quatro minutos de escoamento após terminar a fala: 17 lotes concluídos e três pendentes. O teste foi encerrado com FAIL, não com aprovação.
- Primeiro início de reprodução após 4.115 ms; P95 de conclusão das 444 palavras já concluídas: 252.496 ms. Medida parcial e neste ambiente, não produção.
- Nenhuma exceção não tratada registrada. Não prova reprodução correta dos sinais finais.
- Somente o 503 de heartbeat foi efetivamente injetado nesse ensaio. A inicialização do player externo aconteceu, mas os eventos externos não foram salvos no caminho de falha daquela versão do harness; cobertura individual externa inconclusiva nessa execução.

O ensaio curto `outputs/pitch-soak-1791334947806` preservou 48 palavras e concluiu seis lotes. Os seis comandos tiveram ACK externo individual e houve mudança visual entre capturas; P95 de conclusão de palavras de 36.152 ms. Mesmo esse PASS funcional reprova a meta exploratória de fluidez. Não extrapolar para uso prolongado.

### Checkout com prefetch e falhas frequentes

Evidência `outputs/pitch-soak-1791335467371`:

- 60 segundos a 180 palavras/minuto: 180 palavras, 11 lotes; todos concluídos, texto persistido em ordem, captura não mutada e nenhum `neotalk:ready` adicional (sem reinicialização detectada).
- Oito falhas efetivamente injetadas: três 502 de tradução, dois 429 de tradução, dois 502 na submissão da pose e um 503 de heartbeat. Os lotes terminaram apesar delas; heartbeats também apresentaram abortos do harness, portanto recuperação integral de heartbeat não está homologada.
- Primeiro `playing` após 1.165 ms. P95 de conclusão das palavras: 109.625 ms; pior caso: 111.687 ms. A fila terminou 105.590 ms depois dos 60 segundos de entrada. **Fluidez reprovada.**
- 11 comandos primários e 11 ACKs externos, correlacionados individualmente. Diferença entre ACKs: mediana de 18 ms; máximo de 1.865 ms (há diferenças negativas quando o externo confirma antes).
- A execução original terminou FAIL porque o teste comparava `external.correlationId` apenas com `primary.loadId`. No prefetch ambos referenciam o `primary.correlationId`. Corrigido o analisador e reanalisados os registros originais: zero comandos ausentes. O registro original continua FAIL; não foi reescrito para aparentar uma nova execução aprovada.
- Tempo de ACK de carregamento no Unity: entre 161 e 1.300 ms nos dez carregamentos registrados. Exemplos de poses compostas: 594 frames / 30 FPS = 19,8 s; 927 frames / 30 FPS = 30,9 s. A duração de saída contribui diretamente para o atraso acumulado. Isso não demonstra que a API de produção esteja lenta.

### Inspeção visual: T-pose, bloqueante

As capturas `outputs/pitch-soak-1791334947806/platform.png` e `external-player.png` mostram braços horizontais/T-pose. A comparação de dois frames tinha indicado mudança de pixels, mas isso não prova animação correta nem ausência de T-pose. A inspeção visual revela uma falha que o teste funcional não detectava.

O cenário usa concatenação local de poses e software rendering; ainda não foi determinado se o comportamento decorre do runtime, da concatenação de teste ou de outro fator. Não declarar que reproduziu a mesma causa na produção. Não esconder o problema nem corrigi-lo com mera remoção de aviso.

## Reprodução

Na pasta `neotalk-eventos`, iniciar `node node_modules/vinext/dist/cli.js dev --host 127.0.0.1 --port 3110`. Em outro terminal PowerShell, configurar `PLAYWRIGHT_BROWSERS_PATH` para a pasta `tmp/browsers` da workspace, `PITCH_DURATION_SECONDS=60` e `PITCH_FAIL_EVERY=3`, e executar `node tests/pitch-browser-stress.cjs`.

O harness atual usa `Avatar3DFrontend/frontend` por padrão; `PITCH_WIDGET_FRONTEND` permite selecionar explicitamente outro checkout. Não executar dois ensaios simultaneamente para benchmarking: a contenção da GPU/CPU compromete comparações.

Regressões do checkout com prefetch: sete testes específicos passaram (prefetch, compartilhamento e reutilização). Os dez testes anteriormente citados são do checkout de controle, não devem ser somados como se fossem todos da mesma versão.

## Parecer

Integridade e recuperação dos lotes demonstradas neste cenário controlado. **Produto não homologado para pitch prolongado:** atraso excessivo, T-pose nas capturas e ausência de confirmação do último frame impedem aprovação. Nenhuma mudança de produção/push foi feita nesta rodada; foram criados harness, analisador e relatório. Próxima correção deve ser guiada por reprodução isolada da T-pose e telemetria temporal do runtime, seguida de nova bateria, não por reduzir arbitrariamente os tempos de conclusão e arriscar cortar sinais.
