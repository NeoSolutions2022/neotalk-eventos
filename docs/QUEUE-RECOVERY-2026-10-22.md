# QUEUE-06a — retomada automática após pressão

**Histórico, supersedido localmente por QUEUE-06b.** A candidata atual não pausa o microfone por pressão de fila; veja `CAPTURE-CONTINUOUS-2026-10-22.md`. Os resultados e limites abaixo descrevem a etapa anterior, não o comportamento atual.

## Entrega local

Corrige a captura que ficava pausada indefinidamente até um clique após acúmulo. Não modifica widget, WebGL, mãos, FPS, sinais, ordem da fila ou limites de texto admitido.

- Ao aliviar a fila para até oito lotes pendentes, esvaziar o buffer de texto e terminar as transcrições já aceitas, a captura pode retomar automaticamente.
- A reprodução atual e os lotes aceitos continuam sem reset, descarte para alcançar a fala ou reenvio provocado pela retomada.
- Há histerese: pausa no limite alto, retomada no limite baixo. Não alterna mute/unmute a cada lote perto do teto.
- Durante a pausa automática, **Manter microfone mutado** cancela a retomada. Um mute manual anterior também é respeitado. Ativação posterior depende de ação explícita.
- Sala encerrada não pode reabrir por callback atrasado. A política offline de não capturar ao sair do app é preservada.
- O último bloco do gravador aberto no momento da pressão é finalizado e enfileirado. Uma reserva de **um** chunk preserva essa cauda se o backlog normal já estiver cheio. Limite: seis aguardando normalmente, no máximo sete com a cauda, mais duas requisições em andamento. Acima disso, rejeição continua explícita na telemetria.
- O relatório admin acrescenta `automaticResumes`; nenhum áudio ou texto é anexado à telemetria.

## Testes

105 testes frontend e build Vite passaram. Novos cenários executam as closures reais: limiares, fila de 72 lotes drenada em ordem, mute manual antes/depois da pressão, callback após encerramento, offline/sem rede, preservação da animação ativa, cauda do gravador e reserva limitada. Testes virtuais já existentes de pitch a 140/180/220 palavras por minuto e 100 textos distintos permanecem aprovados; seus tempos de reprodução são simulados.

`tests/pressure-browser.cjs`: React compilado real no Edge, reconhecimento/API/widget simulados. Resultado em `outputs/pressure-browser-20261022/result.json` na raiz do workspace:

1. 72 lotes concluídos, uma pausa e uma retomada automática, zero resets.
2. 72 lotes concluídos, retomada cancelada pelo usuário, microfone permaneceu mutado, zero resets.
3. Oito chunks de áudio compatível / 48 palavras aceitas, uma retomada automática, zero chunks rejeitados; gravador reiniciado.

Os eventos do widget nesse teste são doubles, não comprovam animação Unity nem microfone físico.

Regressão adicional com dois Unity reais .28: `outputs/pitch-soak-1792686245238/ledger.json`, PASS, 18 palavras/três lotes, ambos chegaram ao último frame, sem reset ou descarte. API e fala simuladas, renderização por software. Esse ensaio não provocou pressão de 72 lotes e não certifica microfone físico, background ou sessão de uma hora. A diferença de tempo para a execução anterior não é apresentada como ganho de desempenho: são poucas amostras e não houve mudança do solver em execução.

## O que NÃO foi encerrado

QUEUE-06 completo ainda inclui desacoplar captura da pressão como primeira válvula, atraso em segundos, fila persistente/idempotência e soak real prolongado. Essa entrega elimina o estado sem retomada automática, **não** garante captura sem interrupções ou perda sob qualquer carga. Fala durante a pausa ainda não é capturada. Os limites finitos e os contadores de rejeição permanecem.

## Investigação PERF-02 realizada em paralelo

O prefetch atual antecipa API/arquivo, não o solver interno do Unity. Foi preparada uma poda exata: não avaliar a penalidade quadrática não negativa quando o custo parcial já é maior ou igual ao melhor custo conhecido. Não muda candidatos, função de custo ou desempate.

Sete sequências reais / 1.123 frames / 12 repetições aquecidas e alternadas produziram trajetórias bit a bit iguais. Medianas C# melhoraram entre **0,97% e 16,07%**, variando por sequência; o ganho de 0,97% é pequeno demais para uma conclusão robusta. Outros 100 casos adversariais preservaram trajetórias e rejeições de NaN/formato/cancelamento. Evidências: `outputs/pole-bound-warm.json`, `outputs/pole-bound-fuzz.json` e scripts em `tmp/pole-bound`.

**Não homologado no WebGL.** Duas compilações foram interrompidas por proteção de memória, inclusive a tentativa com `BINARYEN_CORES=1`, `EMCC_CORES=1` e dois workers Unity. A primeira chegou a cerca de 500 MB de RAM livre e 1,2 GB de memória virtual livre. O log e a auditoria da tentativa limitada estão em `outputs/pole-bound-webgl-serial.log` e `outputs/pole-bound-webgl-serial-audit.json`.

A candidata está sob `#if ELIA_BOUND_PRUNING`, desativada nos builds normais. Apenas `EliaPlaybackValidationBuild.Run -eliaBoundPruning` a inclui. Fontes no projeto Unity separado: `Assets/Scripts/ELIAPairedPoleOptimizer.cs` e `Assets/Editor/EliaPlaybackValidationBuild.cs`. Nenhum WebGL incompleto foi copiado ao Avatar3DFrontend ou publicado.

As tentativas Unity regravaram também `ProjectSettings/ProjectSettings.asset` e `GraphicsSettings.asset`. Não há snapshot anterior desses dois arquivos para atestar diferença semântica; a configuração atual está sem compressão/fallback, como requer o exportador existente. Não houve restauração por suposição. Antes da próxima compilação, capturar ambos os arquivos e seus hashes para permitir restauração mesmo em interrupção forçada. As cenas e poses não foram editadas por esta tarefa.

Há alterações pré-existentes no retargeter/profundidade do projeto Unity em relação aos hashes do build .28. Por isso, o A/B preparado exige dois builds do **mesmo estado atual**, com/sem o define, e não compara a candidata diretamente ao .28 atribuindo toda diferença à poda. Antes de publicar, inventariar/aprovar esse estado de fonte e concluir o A/B em máquina com memória disponível. O teste C# não substitui esse aceite.

## Publicação

Somente alterações locais. Sem push ou deploy. QUEUE-06a depende do pacote de instrumentação local anterior. 31 testes backend também passaram. Efí e os trabalhos cancelados não foram alterados. O `tsc --noEmit` integral continua bloqueado pelos tipos Cloudflare ausentes já documentados; build não equivale a aprovação dessa checagem.
