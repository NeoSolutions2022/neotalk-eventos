# Ajuste de estabilidade — validação e limites de release

## Gate integrado final aprovado

Produção local imutável, widget + dois Unity WebGL reais/SwiftShader,
60 segundos a180wpm, HTTP transitório injetado: PASS. 180 palavras preservadas
em ordem, oito lotes concluídos, último frame real em ambas as saídas para
cada comando; nenhum runtime reinicializado, aviso de overload, pausa de
microfone ou exceção JS. Drenagem após entrada:356.316ms; latência de conclusão
p95:219.685ms. É ganho de estabilidade, NÃO aprovação de velocidade, teste
de microfone físico, PiP nativo ou homologação de uma hora. Referência:
outputs/pitch-soak-1791349750576/ledger.json. Speech/API são doubles explícitos.

Publicação planejada: plataforma e Avatar3DFrontend separados, o segundo
inclui WebGL continuity-v5 e manifesto, não só widget.js. Fonte/defaults de
refinamento de mãos de outro trabalho não promovidos. App offline incluído
como protótipo, sem anunciar APK/IPA homologados.

## Retomada de validação

- 56 testes de plataforma passaram novamente; seis testes de widget passaram.
- Build vinext concluído. `tsc --noEmit` isolado continua falhando em tipos
  Next/Cloudflare e configuração de build do checkout; não foi tratado como
  aprovação de tipos nem corrigido fora do escopo.
- Unity: oito assertions de continuidade passaram em rig sintético, exit0,
  `outputs/continuity-unit-v3.log`. Não comprova apresentação/anatomia.
- Candidata repete somente snapshots de um clipe já concluído durante preparo
  PPC da próxima fonte. Não avança fonte, emite conclusão ou altera solver.
  Cache local à instância; pausa explícita e troca de rig invalidam reprodução.
- Build anterior continuity-v1 foi recusado: a camada não estava ativa no
  teste real. V2 confirmou injeção de um componente na cena transitória;
  ainda depende da conclusão do build e dos gates de navegador abaixo.
- Build v2 interrompido pela reserva virtual abaixo de 1GiB (não compilação
  aprovada). Auditoria preservada em outputs/native-playback-build-continuity-v2-audit.json.
  Retentativa v3 com EMCC_CORES=1, Unity worker/GC helper=1, mesmos limites de
  proteção e cenas preservadas. Não encerrar programas pessoais para compilar.
- V3 compilou exit0 com hashes de cenas/ponte/fonte preservados, mas o gate
  visual recusou continuidade: só o driver original serializado recebera o
  componente; ELIA usa driver dinâmico do variant switcher. O candidato passa
  a seguir o driver habilitado da mesma fonte, excluindo rig privado inativo.
  V4 é nova tentativa isolada; não apresentar a unidade como prova desse reparo.

Objetivo: preservar transmissão e execuções aceitas mesmo com atraso.

## Mudanças verificadas

- Timeout de progresso nativo registra diagnóstico e continua observando;
  não reenfileira, reinicia, completa artificialmente ou descarta o lote.
- Timeout de processamento aceito também preserva lote e comando.
- Aviso tardio de ACK em uma geração nativa aceita não interrompe a execução.
- Próxima frase espera último frame das duas saídas nativas ativas.
- Widget oculta preparação inicial até primeiro frame nativo válido.
- Harness separa drenagem lenta de falha, com janela limitada de observação.

26 testes lifecycle passaram, incluindo uma hora VIRTUAL de ausência de
progresso, sem reenvio/descarte; não ensaio real de uma hora. Evidências de
WebGL anteriores em QA-PROGRESSO-NATIVO-2026-10-06.md, sem reteste prolongado
do patch de hoje. GPU perdida/runtime encerrado não são automaticamente
recuperados por um timer; a ausência de evento não prova travamento.

## Gates antes da main/deploy

1. Teste integrado do patch com HTTP transitório e conclusão de todos lotes,
   janela de estabilidade distinta de meta de atraso.
2. Aba em segundo plano, janela externa fechada/reaberta, pausa de microfone,
   recuperação de rede, sessão prolongada e memória limitada.
3. Preparação de nova pose ainda pode parar a animação visível: falta preparação
   isolada/alternância segura no Unity. O patch não promete animação contínua
   durante esse trabalho nem elimina custo de preparação.
4. Separar changeset de estabilidade das alterações offline/UX preexistentes
   nos checkouts. Não commitar tudo indiscriminadamente.

Conclusão nativa agora depende da capacidade real anunciada pelo widget;
NEXT_PUBLIC_NATIVE_PLAYBACK_COMPLETION=false é rollback explícito. O bundle
vinext sem variável pública não ativava o opt-in anterior; o gate integrado
recusou corretamente as conclusões estimadas sem último frame. Nenhum
push realizado; build Unity aprovado na amostra é isolado, não instalado em
produção. Não afirmar proteção absoluta ou zero falhas em todos navegadores.

## Evidências adicionais desta retomada

- WebGL continuity-v5 compilado exit0, fontes e cenas auditadas sem alteração.
  Dois widgets reais passaram cinco sequências (46/46/76/228/228 frames),
  exatamente um finished por saída no frame final, incluindo replay. A camada
  de continuidade iniciou durante preparo; duas capturas de postura vistas.
  Não inspeção anatômica integral nem teste PiP nativo/mobile.
- Build/testes: 70 testes de plataforma, seis do widget, sete contratos de
  backend com DB mock, 11 do offline. Builds web plataforma/offline passaram.
- Ensaio dev foi invalidado por HMR confirmado no log ao compilar o offline;
  voltou ao estado inicial. Não atribuir aquela reinicialização ao player.
- Ensaio produção anterior drenou todos os lotes e preservou palavras/ordem,
  mas FAIL no frame terminal porque a conclusão nativa não estava ativa.
  Nova repetição com o bundle corrigido em andamento, 60s a180wpm e falhas
  HTTP injetadas. Não afirmar homologação de palestra de uma hora.
