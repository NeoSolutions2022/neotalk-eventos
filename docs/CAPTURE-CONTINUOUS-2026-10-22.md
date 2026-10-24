# QUEUE-06b — captura independente da fila de sinalização

## Mudança

Substitui a candidata QUEUE-06a de pausa/retomada automática. **A pressão da fila não chama mais mute, abort de reconhecimento, desativação de faixa ou parada do gravador.** Os controles manuais, erros reais de permissão/dispositivo e a política offline de sair do app continuam distintos.

O limite de 72 lotes passa a ser somente a janela de trabalho de tradução/reprodução. O excesso aguarda em FIFO temporário separado, sem começar novas requisições GPT ou gerar novas poses. A tradução mantém duas requisições em paralelo e o lookahead já existente; reprodução e confirmação nativa do último frame não foram alteradas.

O buffer de montagem de palavras é escoado em blocos de até 12, inclusive quando o reconhecimento devolve uma transcrição longa. Não há mais truncamento automático nas antigas 120 palavras. O lote recebe seu ID e marco de admissão antes de aguardar no staging: sua latência inclui essa espera.

ASR mantém duas requisições em paralelo, até seis chunks na janela de envio e um FIFO adicional de áudio capturado. Novos chunks não ultrapassam os antigos. Sequências só são emitidas após admissão, sem buracos quando um recurso não é admitido. O retorno continua sendo entregue em ordem, mesmo se requisições completarem fora de ordem.

Mute manual interrompe a gravação nova, mas permite terminar áudio já captado. A cauda do gravador é finalizada antes de aguardar. Troca/recuperação de dispositivo também preserva o controlador e o trabalho ASR aceito. Encerrar a sala cancela o restante; dados não passam para uma nova sala.

## Recursos, privacidade e limites

- Staging de texto: orçamento estimado de 2 MiB, incluindo UTF-16 e margem por entrada.
- Staging de áudio: 16 MiB mais a pequena janela de envio/duas requisições já existentes. Não é promessa de limite exato de heap do processo: blobs e objetos possuem overhead do navegador.
- Tudo fica na memória da sessão. Não há IndexedDB, gravação de áudio em disco, novo envio externo, recuperação após recarregar/crash ou retenção entre usuários.
- Ao atingir orçamento, o recurso novo pode ser recusado explicitamente, sem evictar itens aceitos e sem mutar o microfone. Contadores de palavras/chunks rejeitados e aviso fora do player tornam isso observável. Não garantir armazenamento infinito ou perda zero sob indisponibilidade arbitrariamente longa.
- Captura continuar não significa que o avatar acompanha a fala: se o consumo for mais lento que a chegada, o atraso cresce. Não foi aplicado resumo, descarte de frases antigas ou aceleração artificial de sinais para disfarçar esse atraso.
- O relatório admin agora inclui `backlog`: janela de trabalho, palavras em montagem, itens/bytes estimados/idade do mais antigo dos stagings de texto/áudio, chunks na janela ASR e requisições em andamento. Não exporta o conteúdo desses buffers.

## Validação local

- 105 testes frontend e 31 backend passaram; build Vite passou. `tsc` integral continua com os três erros pré-existentes de tipos Cloudflare ausentes, não relacionados a esta alteração.
- Stress com duas mil entradas/24.000 palavras enquanto o agente está retido: janela limitada a 72, concorrência a dois; todas as palavras retidas, microfone ativo.
- Stress com duas mil frases e avatar controlado lento: todas as palavras drenadas em ordem, sem reset e sem mute por pressão.
- Uma transcrição final com mil palavras não foi truncada.
- Orçamento pequeno forçado: rejeição contada, nenhum trabalho aceito evictado, captura permaneceu ativa.
- Mute manual, fim/reinício da sala, recuperação de dispositivo e limpeza/compactação do FIFO cobertos por testes. O teste puro do FIFO verifica 20.000 itens em ordem.
- Cenários virtuais existentes de pitch a 140/180/220 palavras/minuto e 100 textos distintos continuam passando. Seus tempos de execução são simulados, não benchmark de produção.

`tests/pressure-browser.cjs` usa React compilado real no Edge, com reconhecimento/API/widget simulados. Evidência em `outputs/capture-uninterrupted-20261022/result.json` (raiz do workspace):

1. 240 lotes concluídos, dos quais 168 ficaram no staging; zero pausas de captura e zero resets.
2. Mesma carga, com mute manual durante a espera; trabalho aceito concluiu e o mute foi respeitado.
3. 20 chunks de áudio compatível / 120 palavras, com serviço retido para acumular backlog; nenhuma pausa automática ou rejeição.

Regressão de dois Unity reais .28 em `outputs/pitch-soak-1792687491518/ledger.json`: 18 palavras/três lotes, ambos os players chegaram ao último frame; sem reset/perda. ASR/API controlados e SwiftShader. Essa regressão ocorreu antes do último refinamento de limpeza/mute/dispositivo, coberto pelos testes de código e navegador; não é teste de uma hora, aparelhos móveis ou microfone físico.

## Velocidade do avatar: ainda pendente

A tentativa solicitada de recompilar a poda matemática foi repetida com um worker Binaryen/Emscripten e dois workers Unity. A proteção interrompeu o processo quando a memória virtual livre caiu a aproximadamente **1,13 GB**, com aproximadamente **1,04 GB de RAM livre**. Isso foi um limite preventivo do monitor, não prova de erro de alocação emitido pelo compilador. O build não foi aprovado nem copiado ao Avatar3DFrontend.

Configurações `ProjectSettings.asset` e `GraphicsSettings.asset` foram salvas antes e restauradas ao interromper; hashes correspondentes foram conferidos. Evidência em `outputs/pole-bound-webgl-retry-20261022-audit.json` e `outputs/pole-bound-webgl-retry-20261022-settings/`.

O Windows tem aproximadamente 16 GB de RAM, paginação automática e arquivo de paginação alocado de 12.960 MiB na consulta feita após o teste. Nenhuma configuração de memória do sistema foi alterada. Liberar mais capacidade de commit/memória ou usar outra máquina de build é necessário antes de repetir o A/B nativo com segurança. A otimização permanece desativada nos builds normais.

**Não foi demonstrado ganho de velocidade do avatar nesta entrega.** O ganho comprovado é de continuidade/admissão: a fila de sinalização não é mais usada para pausar a captura. PERF-02 e o aceite completo de QUEUE-06 continuam pendentes de baseline real, duração prolongada e demais itens do roadmap.

## Estado de entrega

Relato da primeira rodada local, antes de publicar a candidata. Efí, i18n e trabalho offline cancelado não foram alterados.

Atualização da revisão: veja `QUEUE-06B-VALIDATION-2026-10-22.md` para as duas
falhas adicionais corrigidas, 108 testes frontend, 31 backend e os cenários
ampliados de 60 minutos virtuais. O status de publicação/revisão é acompanhado
no card QUEUE-06b; não equivale a deploy ou homologação de produção.
