# Changelog

## 2026-10-26 — Fronteira do gravador e 502 indevidos (candidata)

- Reproduzida e corrigida corrida em que `onstop` antigo apagava o timer do
  gravador novo após mute/desmute rápido; cauda aceita preservada.
- Reconhecido o cabeçalho WebM sem mídia emitido nesse limite: resposta explícita
  `empty_container`, sem consulta/retry no provedor ou alerta falso.
- Rejeição permanente de arquivo não é mais rotulada como 502 transitório;
  erros reais continuam visíveis e retentativas transitórias foram preservadas.
- Build/156 testes Node e 52 Python passaram. Captura com ASR real passou em
  14 verificações, sem 502 nesse cenário. Não é garantia geral nem soak físico.
- Diagnóstico e evidências em docs/AUDIO-BOUNDARY-2026-10-26.md.

## 2026-10-26 — AUDIO-04 e continuidade fora da tela (candidata)

- Seletor de microfone e perfis Voz/Mesa de som, com stream realmente enviado
  ao ASR no modo gerenciado. Padrão WebSpeech preservado; hardware explícito
  não troca silenciosamente. Preferências de filtros não prometem isolamento.
- Corrigido gate do PiP: principal fora do viewport não bloqueia o último
  frame externo real; dois renderizadores visíveis ainda exigem os dois fins.
- Build e 152 testes passaram. Ensaio real de três frases em cada cenário
  confirmou continuidade fora da tela e conclusão dupla quando visíveis.
- Captura sintética validou o stream real; ainda há 502 transitório no ASR,
  sem aprovação acústica ou da matriz completa de navegadores.
- Documentos AUDIO-04-MANAGED-CAPTURE e PIP-OFFSCREEN detalham evidências e
  pendências. Trello sem acesso nesta rodada; nenhuma conclusão falsa de card.
- Sem merge/deploy ou alteração de WebGL nesta subentrega.

## 2026-10-26 — Transporte do proxy medido com HTTPS real

- Avatar3DFrontend recebe pool próprio; não confundir com o pool anterior
  deste backend. Benchmark real: 36 status equivalentes, média da rodada
  1.502,17→824,90 ms. Não é ganho de 45% na reprodução da Elia.
- Integração: dez lotes/70 palavras completos nos dois players Unity reais,
  nenhum span obrigatório ausente, reset, pausa ou rejeição; ASR controlado.
- Sumarizador permite mínimo explícito, com regressão para não aprovar dez
  usando gate de cinco.
- Relatório em docs/performance/2026-10-26/proxy-pool/README.md.

## 2026-10-26 — Evidências de prefetch e continuidade

- Correção de corrida consulta/download preparada no Avatar3DFrontend PR #40,
  sem mudança de WebGL. 28 testes Node + quatro de polling no avatar passaram.
- Integração local com cinco lotes e dois Unity reais passou; pacote final
  `.30` confirmou outros três lotes diferentes nas duas saídas sem reset/pausa.
- Agregados sanitizados e método versionados; novo teste evita exportar campos
  livres/segredos do relatório privado. 138 testes Node da plataforma passaram.
- Não há ganho de velocidade, evento de uma hora ou produção aprovados.
- Relatório: docs/performance/2026-10-26/README.md.

## 2026-10-23 — Homologação local isolada

- Compose separado com plataforma e widget candidatos, banco/cache próprios e
  portas publicadas apenas em loopback; sem alteração do deploy de produção.
- Credenciais obrigatórias no backend e arquivo privado ignorado pelo Git.
- Checagem reproduzível de uma frase com GPT e pose reais, relatório sanitizado
  e guia que separa integração, reprodução visual e aprovação de performance.
- Dois testes de isolamento/configuração adicionados; 118 testes Node passaram.
- Preparação local não conclui o gate de 100 lotes nem aprova produção.

## 2026-10-08 — Textos da apresentação

- Controles simplificados: título **Apresentação**, seletor acessível de
  24/40/64 sequências e botão de preparação, sem explicações repetidas.
- Indicação compacta **Modo demonstração** nos players, sem o texto
  “sinais ilustrativos”. Funcionamento e tradução padrão inalterados.
- Build e 88 testes Node aprovados. Ajuste somente na plataforma.

## 2026-10-08 — Apresentação ilustrativa experimental

- Modo separado e opcional, exclusivo do admin, ativado pelo botão
  **Preparar apresentação**. A tradução real continua como padrão.
- Alternância bloqueada durante a captura: encerre a sala antes de mudar o modo.
- Lista de até 64 sequências distintas do catálogo atual, com opções de 40/24.
  Ordem embaralhada na preparação; percorre a lista antes de repetir.
- Preparação antecipada por saída e pausa/continuação do frame atual durante
  fala, silêncio e mute, sem recarregar poses durante a apresentação.
- Legendas reais; gestos ilustrativos independentes do significado. Aviso
  **Demonstração · sinais ilustrativos** visível em todas as saídas.
- Sem GPT, traduções fictícias ou avaliações de QA geradas por esse modo.
- Botão de encerramento oculto no mini-player; fechar a saída flutuante encerra
  a sala e a captura. Fechar a janela separada comum fecha somente essa saída.
- Histórico local da apresentação mostra os trechos reais transcritos.

### Compatibilidade e verificação

- Requer também atualizar Avatar3DFrontend para widget **.29** com capacidade
  `presentation-playlist`. Usa o mesmo WebGL **.28**; não altera Unity/retargeting.
- Build aprovado e 87 testes Node aprovados. Integração local aprovada com
  dois renderizadores Unity reais, 12 sequências e 1.998 frames.
- Não certifica microfone físico, PiP nativo, produção, todos os móveis ou
  renderização de todas as 64 sequências. Preparação inicial pode demorar.
- Detalhes: [operação, limites e evidência](docs/PRESENTATION-MODE-2026-10-08.md).
