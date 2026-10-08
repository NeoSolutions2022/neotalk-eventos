# Changelog

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
