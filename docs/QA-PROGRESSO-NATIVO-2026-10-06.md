# ELIA: confirmação nativa de reprodução — candidata, não publicada

## WebGL real — 07/10, build concluído e gargalo observado

- Build v3 exit 0: Unity 6000.2.2f1, ELIARuntime existente, dois workers,
  saída `outputs/native-playback-webgl-v3/elia`. Manifest completo e binário
  nativo gerados. Reservas mínimas observadas: 5.717.098.496 bytes de disco e
  1.295.136 KiB de memória virtual; nenhum guard acionado.
- Cenas, visualizador e ponte permaneceram SHA-idênticos durante o build.
  Nenhum perfil experimental de mãos promovido, nenhum `.pose` alterado.
- WebGL real em Chromium/SwiftShader, dois widgets: original46, renumbered46,
  composto76, longo228, replay228. Cada caso emitiu exatamente uma conclusão
  por saída no último frame; zero exceções de página. Repetido após ajuste
  visual do widget, também passou. Pose de um frame passou nas duas saídas.
- Evidências: `outputs/pose-isolation-1791345188967/report.json`,
  `outputs/pose-isolation-1791345303699/report.json` e
  `outputs/pose-isolation-1791345495391/report.json`.
- Inspeção efetiva: original400/end do primeiro ensaio; original400 e two-end
  da repetição. T-pose inicial vista no primeiro; widget agora mantém cover
  até started/progress/finished nativo válido. Não é correção anatômica nem
  inspeção de todos frames. Pele/mãos ainda têm custos visuais conhecidos.
- Pressão integrada60s/180wpm FAIL: excedeu quatro minutos de drenagem.
  Seis lotes concluídos, outro ativo e um aguardando ao encerrar; não aprovação
  de performance. Pose927: principal prepara78.781ms/executa30.695ms;
  flutuante prepara78.709ms/executa30.688ms. Replay927 prepara141/180ms e
  executa30.756/30.758ms. Eventos discriminam preparação de execução.
- Evidência: `outputs/pitch-soak-1791345385053/ledger.json`. APIs e transcrição
  são doubles; 503 injetado e aborts heartbeat do harness não são diagnóstico
  de backend real. Nenhuma nova exceção JS registrada no relatório.
- Repetição com throttling de fundo/oclusão desativado também FAIL4min:
  `outputs/pitch-soak-1791345761011/ledger.json`, cinco de oito lotes concluídos;
  pose927 preparou113.914ms no principal/124.480ms no externo. Zero exceções
  JS. A hipótese de throttling como causa suficiente não se sustenta nesses
  ensaios; GPU software/carga local ainda limitam extrapolação para produção.
  Native PiP real não foi homologado. Servidor local próprio encerrado ao final.
- Conclusão: contrato real validado na amostra isolada; pacote de fluidez ainda
  não aprovado. Flag default desligada, sem push/deploy. Próximo gargalo é
  preparação de poses novas/longas; não mascarar acelerando conclusão estimada.

## Retomada do build — 07/10

- Tentativa v2: saída isolada, dois job workers, reserva inicial de memória
  virtual 6.670.464 KiB. Passou por scripts/assets e chegou ao build Player.
- Guard interrompeu: disco caiu de 7.410.671.616 para 1.444.392.960 bytes;
  memória virtual livre também caiu a 616.912 KiB na última amostra. A causa
  desse salto de consumo não foi determinada. Não é erro funcional do avatar.
- Só `elia.data` estava produzido; sem loader/framework/wasm/manifest final.
  Portanto zero nova execução visual do contrato. Não publicar esses arquivos.
- Hashes de cenas, visualizador e ponte mantidos. Nenhum aplicativo pessoal
  encerrado; nenhuma limpeza de cache/pastas pessoais realizada.
- Evidências: `outputs/native-playback-build-v2-audit.json` e log correspondente.
- Harnesses agora aceitam `ELIA_NATIVE_BUILD` apontando ao build isolado.
  Isolamento exige capacidade nativa e último frame único em cada caso;
  pitch exige conclusão real de cada execução principal/espelhada. Esses novos
  caminhos ainda não executados, pois dependem do binário completo.
- Bloqueio: somente C: disponível, cerca de 1,15 GB livre após interrupção.
  Precisamos liberar disco/memória ou compilar em outra máquina. Default
  nativo permanece desligado e não houve deploy/push.

## Continuação: fila e tentativa de build (06/10, Fortaleza)

- Fila candidata espera `finished` no último frame da geração atual. Quando
  ambas as saídas suportam o contrato, espera principal e mini-player.
- Fechar a saída externa libera uma principal já concluída. Eventos antigos,
  frames inválidos e ACKs duplicados não concluem outra execução.
- Watchdog de 20 segundos sem progresso recupera a pose; não inventa sucesso.
- Ativação isolada: `NEXT_PUBLIC_NATIVE_PLAYBACK_COMPLETION=true`. Default
  permanece desativado até validação do WebGL real; builds legados mantêm
  conclusão estimada. Não habilitar em produção ainda.
- 24 testes de lifecycle e 11 testes de widget passaram. São testes de
  orquestração com doubles, não renderização/microfone real.
- Build isolado de `ELIARuntime.unity` interrompido pelo guard: memória
  virtual livre caiu a 684.460 KiB (reserva mínima 1.048.576 KiB).
  Não produziu um WebGL validado. Sem encerramento de aplicações pessoais.
- Hashes antes/depois idênticos: cenas SampleScene/ELIARuntime, visualizador
  e ponte JS. `.pose`, perfil de mãos e cenas não foram alterados.
- Evidências no workspace: `outputs/native-playback-build-audit.json` e
  `outputs/native-playback-build.log`; runner `tmp/build-native-playback.ps1`.
- Gate pendente: liberar recursos de memória ou usar máquina de build, compilar,
  validar preparação/replay/último frame nas duas saídas e executar pitch real.
  Nenhum push, deploy ou promoção realizado.

## Problema delimitado

O Unity confirma a leitura de `.pose` em `ApplyFrames`, antes de encerrar
a preparação PPC. Durante essa preparação, `preparationHolds` retém o
relógio da fonte. O widget emite `neotalk:playing` após `PlayFromStart`,
e a plataforma calcula a conclusão pela duração nominal. Portanto, esse
ACK não comprova avanço nem exibição do último frame. É uma lacuna no
contrato, não prova isolada da causa de toda T-pose ou atraso.

## Alteração isolada

- Unity fonte: `C:/Users/felip/PoseAvatarTest`.
- `PoseSkeletonVisualizer`: relatório somente WebGL, após `WaitForEndOfFrame`,
  com estado preparing/started/progress/finished, revisão, frame, total, fps
  e identificador da execução. Preparação não gera conclusão. Fonte nova
  desarma a execução anterior; pause desarma; replay recebe geração nova.
- `Avatar3DBridge.jslib`: entrega os dados nativos ao JavaScript.
- Widget: anuncia suporte somente depois do evento ready do runtime,
  envia SetPlaybackId após ACK e antes de PlayFromStart. Binários antigos
  não recebem esse método. Valida índices e geração, rejeita fins precoces,
  duplicados e eventos atrasados; reinício do runtime limpa a capacidade.
- Plataforma: coleta `neotalk:playback-frame` nos diagnósticos limitados
  a 120 eventos, identificando principal e mini-player. Não inclui áudio
  nem texto das falas. A fila ainda usa conclusão estimada, rotulada
  `neotalk:completion-estimated`, até homologação do novo binário.

Nenhum `.pose`, cena, perfil de mãos, parâmetro de retarget ou default foi
editado nesta alteração. Relatórios descrevem o frame da fonte após o
ciclo de desenho; não certificam por si só correção semântica/anatômica
ou que todos os ossos reproduziram corretamente esse frame.

## Validação realizada

- Compilação condicional C# WebGL/IL2CPP: exit 0. Saída isolada:
  `outputs/native-playback-compile/Assembly-CSharp.player.dll` no workspace.
  Não é build IL2CPP/WebGL nem execução do novo código no navegador.
- 11 testes widget: contrato nativo (4), reuso (2), prefetch (2),
  compartilhamento/ACK (3). Todos passaram.
- 21 testes lifecycle da sala passaram. Incluem pressão virtual,
  não palestra real nem execução do Unity novo.
- Recurso observado no preflight: 3.490.209.792 bytes de disco livre;
  memória virtual livre 5.638.512 KiB. Nenhum processo pessoal encerrado.

Reprodução:

```powershell
# Executar a partir do projeto Unity; Output aponta ao workspace, não ao cache.
& .\Tools\compile_elia_player.ps1 -Output '..\Documents\Codex\2026-08-14\prior-conversation-with-codex-conversation-role\outputs\native-playback-compile'
# No checkout Avatar3DFrontend
node --test tests/widget-native-playback.test.cjs tests/widget-pose-reuse.test.cjs tests/widget_prefetch.test.mjs tests/widget_shared_pose.test.mjs
# No checkout neotalk-eventos
node --test tests/live-room-lifecycle.test.mjs
```

## Gates pendentes

1. Build WebGL preservando cenas/defaults e rollback, com guards de recursos.
2. Testar na renderização real a preparação longa, pause/resume, cache,
   replay, fonte de um frame, loops, troca e cancelamento.
3. Confirmar identificadores e último frame entre principal e mini-player.
4. Só então passar a fila a conclusão nativa; manter fallback explicitamente
   estimado para builds antigos e watchdog separado para falta de progresso.
5. Repetir pitch integrado com APIs controladas, depois produção prolongada.

Decisão: instrumentação candidata, sem promoção, publicação ou push.
