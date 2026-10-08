# Apresentação ilustrativa — experimental

Este modo NÃO traduz português para Libras. A transcrição é real, mas a animação
é uma sequência ilustrativa independente do significado das legendas. O aviso
“Demonstração · sinais ilustrativos” permanece na sala, na tela cheia e na saída
externa. Não ocultar esse aviso ou apresentar a demonstração como tradução fiel.

## Operação

1. Entre como administrador e abra a sala ao vivo.
2. Selecione **Preparar apresentação** antes de iniciar a captura.
   A variedade padrão é 64 sequências. Em dispositivos lentos, selecione 40 ou
   24 antes da preparação. Se atingir um limite, desative e escolha a lista menor.
3. Aguarde buscar o catálogo e preparar a animação nativa. Esta fase pode ser
   demorada em máquinas lentas. A preparação ocorre antes da demonstração.
4. Inicie a sala ou abra o mini-player. A permissão normal de microfone é mantida.
5. A fala continua a sequência do frame atual. Depois de seis segundos sem um
   novo resultado de transcrição, a animação pausa. Falar novamente continua,
   sem pesquisa, recarga de pose ou reinício do avatar.
6. Mutar pausa a demonstração. Fechar o mini-player encerra a sala e a captura.
   O botão de encerrar fica oculto nessa saída. A janela separada comum mantém
   o comportamento de fechar somente a saída.
7. Para voltar à tradução real, encerre a sala e desative a apresentação.

## Lista e armazenamento

- Até 64 sequências únicas e curtas, compostas exclusivamente por sinais do
  catálogo atual. São sequências ilustrativas, não frases linguísticas validadas.
- Embaralhadas antes de montar a animação longa; percorre a lista inteira antes
  do retorno ao início. Não utiliza um loop de duas frases.
- Catálogo paginado pelo endpoint existente de admin; autorização aplicada no
  servidor. Nenhuma credencial de serviço é incluída no cliente.
- Preparação de arquivos com duas solicitações simultâneas, sem GPT.
- O widget baixa e une os arquivos em memória, preservando todos os registros
  de mãos/corpo e renumerando apenas os identificadores dos frames.
- Até 64 MB e 12.000 frames por sequência longa. Ultrapassar limites resulta em
  erro na preparação, sem truncar gestos silenciosamente.
- Uma única carga nativa por saída. Continuação/pausa não executam `LoadPoseUrl`
  nem `PlayFromStart`. O cache vive na memória de cada widget, não no Redis ou
  no banco de dados. O trabalho offline continua fora desta alteração.
- Aguardamos o primeiro frame nativo real antes de declarar a saída pronta.
  A confirmação de download/ACK sozinha não aprova a preparação.
- Timeout de preparação de dez minutos, sem reiniciar automaticamente o Unity.
  Não há promessa de desempenho idêntico em aparelhos móveis.

## Histórico e publicação

Somente legendas reais são mantidas no histórico local da apresentação. Não
criamos lotes traduzidos, resultados de GPT ou avaliações de QA com os gestos
ilustrativos. A sala mantém os controles normais de sessão/heartbeat/encerramento.

Requer publicar a plataforma e o widget com capacidade `presentation-playlist`.
O widget .29 utiliza o mesmo WebGL .28 já validado; não há alteração Unity neste
modo. Uma saída com widget antigo não será tratada como compatível.

## Validação

Testes de lista/embaralhamento, autorização, cancelamento, silêncio, retomada,
envio aos dois players, encerramento e não contaminação do histórico em:

- `tests/presentation-deck.test.mjs`
- `tests/live-room-lifecycle.test.mjs`
- Avatar3DFrontend: `tests/widget-presentation.test.cjs`

Teste de integração com WebGL real: `tests/presentation-browser.cjs`. Utiliza
admin, transcrição e API controlados; não certifica rede de produção nem a
inicialização nativa do Document Picture-in-Picture. Não confundir execução de
testes unitários com aprovação visual de todas as 64 sequências do dataset.

### Evidência local de 08/10/2026

- Build da plataforma concluído e 87 testes Node aprovados; widget: 15 testes
  Node e 16 testes Python aprovados.
- Integração `presentation-1791475362023`: dois renderizadores Unity .28 reais,
  widget .29, 12 sequências compostas de quatro poses reais, 1.998 frames.
- Confirmados: avanço nativo, pausa ao mutar, retomada além do frame pausado,
  pausa automática no silêncio, sem nova carga durante a fala, sem reinício
  dos renderizadores, sem chamadas GPT/lotes fictícios e encerramento único
  ao fechar a saída flutuante. Nenhuma exceção JavaScript não tratada.
- O catálogo de 800 entradas e a lista de 64 foram testados unitariamente;
  não foram renderizadas todas as 64 sequências no teste de integração.
- A preparação nativa custou cerca de 83 s e 125 s por saída na primeira
  execução local com 12 sequências. Não é instantânea e não é um SLA.
- O teste usa API, usuário, transcrição e janela externa controlados. Não
  valida microfone físico, serviço de produção, PiP nativo ou todos os móveis.
- Intervalos da telemetria de progresso não são medidas de frame time ou
  latência entre sinais. A animação inteira não foi aprovada linguisticamente.

A ativação em produção exige implantar ambos os repositórios; push na main
não confirma sozinho que o deploy foi concluído.
