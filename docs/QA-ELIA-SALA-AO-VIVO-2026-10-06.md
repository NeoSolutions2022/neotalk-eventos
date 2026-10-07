# QA da Elia — sala ao vivo

Data: 6 de outubro de 2026. Status: rodada de engenharia executada; **homologação completa ainda pendente**.

## Resultado e critérios de evidência

Foram executados 98 testes automatizados: 59 da plataforma, 29 do backend e 10 do widget. Todos passaram na rodada final. O build da plataforma passou. O lint dos arquivos TypeScript alterados terminou com zero erros e três avisos de dependências de efeitos React.

Além dessas suítes, um ensaio Chromium local passou por 12 verificações de integração/visualização. Usou React, JavaScript do widget e Unity WebGL reais; fala e respostas de backend foram controladas. A janela externa era uma janela de mesma origem, usando um substituto da API de PiP. **Não foi um teste de PiP nativo, da API de produção, de microfone físico nem de uma hora de palestra.**

Classificação da evidência:

- **Execução**: comportamento exercitado por testes que executam funções/componentes, com falhas ou eventos controlados.
- **Revisão**: defeito demonstrável no código e corrigido; não implica reprodução em produção.
- **Visual**: evidência do navegador com Unity real, incluindo mudança do canvas entre capturas. Não equivale a validação linguística do sinal.
- **Contrato SQL**: consulta/endpoint exercitado com pool PostgreSQL simulado. A semântica final de concorrência precisa também de PostgreSQL real.

Não foram apagadas salas, alteradas credenciais ou realizadas gravações de voz reais. A alteração pré-existente do README foi preservada. As correções estão locais, sem push ou implantação nesta rodada.

## Defeitos encontrados e tratados

P1 = risco de interrupção, perda ou cruzamento de trabalho; P2 = inconsistência funcional/UX. Os itens são separados mesmo quando compartilham uma correção.

| ID | Prioridade | Defeito | Correção e evidência |
| --- | --- | --- | --- |
| LIVE-01 | P1 | Encerrar não descartava toda a fila e podia despachar palavras remanescentes. | Limpeza dos buffers, lote ativo, timers, mapas e pausa do widget. Execução de encerramento com tradução pendente. |
| LIVE-02 | P1 | Uma resposta atrasada da sala A podia atualizar a sala B. | Escopo cancelável por sessão, sinal em requisições e verificação antes de atualizar estado. Teste de reinício com resposta antiga. |
| LIVE-03 | P1 | Cliques repetidos podiam iniciar criações simultâneas. | Trava síncrona, botão desabilitado e estado “Iniciando sala…”. Teste de clique duplo. |
| LIVE-04 | P1 | Permissão de microfone resolvida depois de encerrar podia deixar uma faixa aberta. | Revalidação da sessão e parada das faixas obtidas tardiamente. Execução com permissão atrasada. |
| LIVE-05 | P1 | Transcrições paralelas eram entregues por ordem de resposta, não de fala. | Buffer numerado entrega somente trechos consecutivos. Testes de ordem invertida, falha intermediária e 7.200 trechos. |
| LIVE-06 | P1 | Sobrecarga descartava trechos antigos da fila de áudio. | Preservação da fila aceita e rejeição explícita do trecho novo; aviso ao apresentador limitado a uma vez por 15 segundos. **Não elimina perda sob saturação**, mas deixa de escondê-la. |
| LIVE-07 | P1 | Eventos antigos do gravador podiam limpar o timer de uma nova captura. | Verificação de geração antes da limpeza e cancelamento da geração anterior. Revisão de código. |
| LIVE-08 | P1 | Falha ao construir/iniciar MediaRecorder podia lançar exceção a partir de timer. | Captura da exceção, encerramento seguro e orientação ao apresentador. Teste com construtor que falha. |
| LIVE-09 | P1 | Timeout da plataforma terminava nos headers, deixando leitura do corpo presa. | Timeout permanece até decodificar o corpo, inclusive respostas de erro. Testes de corpo parado e cancelamento pelo chamador. |
| LIVE-10 | P2 | JSON inválido ou erro 422 estruturado gerava mensagens impróprias. | JSON inválido vira erro 502 identificável; arrays de validação não viram `[object Object]`. Testes de 200 inválido e 401/403/422/502/503 com corpo HTML. |
| LIVE-11 | P1 | Cancelamento e falhas temporárias tinham recuperação incompleta. | Retry limitado para 408/429/5xx, falha de rede e timeout; cancelamento interrompe espera. 400/401/403/404/409/422 não são repetidos cegamente. |
| LIVE-12 | P1 | Requisições do widget não tinham limite de espera próprio. | Limite de 30 segundos cobre fetch e corpo; timeout é identificado como 504. Testes de corpo parado e HTML inválido. |
| LIVE-13 | P1 | Polling do widget recuperava apenas 502. | Recuperação limitada também para 408/429/500/503/504. Revisão; não muda a capacidade do servidor upstream. |
| LIVE-14 | P1 | Pausar o widget não invalidava tradução/carregamento em andamento. | Invalidação de sequência e cancelamento do carregamento pendente. Testes de pausa durante pose compartilhada e replay. |
| LIVE-15 | P1 | Confirmações duplicadas de reprodução reiniciavam o relógio do lote. | ACK duplicado é ignorado depois do início confirmado. Teste preserva o mesmo timer. |
| LIVE-16 | P1 | Loop podia calcular duração com metadados de outra frase. | Seleção dos metadados da pose correspondente à frase do loop. Revisão; testes existentes verificam duração por frame/FPS e folga final. |
| LIVE-17 | P1 | Widget em troca/carregamento de avatar podia continuar considerado pronto. | Status `loading_avatar` suspende despacho até `ready`. Teste de fila com runtime indisponível. |
| LIVE-18 | P2 | Janela externa/link direto usavam o avatar inicial, não o selecionado. | URL construída com o avatar selecionado. Revisão; seleção de outros avatares ainda pede ensaio visual próprio. |
| LIVE-19 | P1 | Heartbeat 404 tentava ressuscitar sala encerrada. | Encerra a sessão local e orienta início de nova sala. Teste garante que não há segundo `/start`. |
| LIVE-20 | P1 | Backend permitia iniciar novamente uma sala finalizada. | `/start` aceita somente `ready/live`, preservando checagem de proprietário. Contrato SQL. |
| LIVE-21 | P2 | `/finish` repetido podia reduzir duração e substituir horário de término. | `GREATEST` para duração e `COALESCE` para término. Contrato SQL; encerramento idempotente. |
| LIVE-22 | P1 | PATCH atrasado podia regredir lote `done/error` para `translating`. | Proteção de estado terminal e retorno do estado autoritativo, com ownership. Contrato SQL. |
| LIVE-23 | P1 | Sala encerrada podia aceitar um novo lote. | Criação bloqueia/valida sala em estado `live`. Contrato SQL. |
| LIVE-24 | P2 | Encerrar sala deixava lotes pendentes eternamente em processamento no banco. | CTE finaliza sala e marca seus lotes incompletos como interrompidos na mesma instrução. Contrato SQL; integração PostgreSQL real pendente. |
| LIVE-25 | P2 | Mapas de metadados de lotes concluídos cresciam durante a sessão. | Remoção dos metadados terminais e limpeza ao encerrar. 1.200 frases sequenciais sem crescimento desses mapas no ensaio simulado. |
| LIVE-26 | P1 | Notificação/retry externo tardio podia reenviar pose após encerrar. | Guardas de escuta/sessão e limpeza da pose externa. Teste de `pose-ready` atrasado. |
| LIVE-27 | P1 | Montagem do player podia esperar para sempre pelo script relay. | Timeout de oito segundos, mensagem orientativa e fallback para janela compatível. O bloqueio de `about:blank` foi observado no ensaio headless; causa de navegador/ambiente não foi atribuída definitivamente. |
| LIVE-28 | P2 | Botão “Legenda” era inerte. | Aba funcional com histórico limitado a 50 trechos concluídos. Verificado no navegador. |
| LIVE-29 | P2 | Concluídos desapareciam e a UI voltava a “Ouvindo o primeiro trecho…”. | Últimos concluídos permanecem no painel; histórico separado; mensagem vazia coerente. Verificado no navegador. |
| LIVE-30 | P2 | Rótulos compridos podiam sobrepor o texto do trecho. | Coluna do rótulo ampliada, texto em coluna flexível. Revisão/CSS e captura visual. |
| LIVE-31 | P2 | Script `npm test` não incluía todas as suítes. | Descoberta de `tests/*.test.mjs`, incluindo regressões novas e testes de qualidade de vídeo existentes. |

## Bateria executada

### Plataforma — 59 testes

- Clientes HTTP: credenciais, CSRF em mutações, 204 sem JSON, HTML em respostas de erro, JSON inválido, timeout durante leitura do corpo e cancelamento.
- Sessão: início simultâneo, permissão atrasada, encerramento com tarefas pendentes, reinício e isolamento entre salas.
- Tradução: pular fragmento sem glosa sem bloquear o próximo; falha transitória recuperada; concorrência/ordenação.
- Widget: fonte/origem de mensagens, payload inválido, pose compartilhada idêntica para janela externa, ACK duplicado e runtime ainda carregando.
- Captura: falha do gravador, limite de backlog com ordem preservada e aviso não repetitivo.
- Continuidade: 1.200 frases sequenciais com metadados limitados; 7.200 trechos entregues em ordem apesar de conclusão invertida em pares.
- Regressões existentes: relay, métodos do proxy, timing, renderização das rotas e configurações de vídeo.

Os dois testes longos são **volume simulado**, não ensaios de uma hora real com microfone/Unity. O teste do componente usa hooks e doubles determinísticos; o ensaio seguinte usa React real.

### Backend — 29 testes

Incluem autenticação de acesso rápido, autorização de administrador, CSRF, normalização de telefone, fluxo de lead, rate limiting, PDF do dataset, parsing/retry do agente e contratos novos de ciclo de vida da sala. O banco foi simulado. Os testes não chamaram o GPT nem a API real de sinais.

### Widget — 10 testes

Pose compartilhada sem nova submissão; compartilhamento antes de tocar; retry de ACK ausente; reutilização de pose ativa sem recriar o retarget; troca de runtime; pausa durante replay/carregamento; timeout do corpo HTTP; respostas inválidas; preservação de status upstream.

### Chromium local — 12 verificações

1. Widget Unity pronto na plataforma local.
2. Reconhecimento configurado para `pt-BR`.
3. Frase de teste chega a tradução, pose e reprodução.
4. Canvas principal muda visualmente entre frames.
5. Aba Legenda funciona e preserva concluídos.
6. Tela cheia conserva legenda e permite zoom.
7. Relay envia a pose para a janela secundária.
8. Canvas secundário muda durante a sinalização.
9. Um HTTP 502 proposital é recuperado e a próxima frase toca.
10. Mute ignora resultado tardio do reconhecimento.
11. Encerramento retorna a sala ao estado reiniciável.
12. Nenhuma exceção JavaScript não tratada (`pageerror`).

O 502 proposital aparece no console do navegador: isso é esperado. O aplicativo não pode suprimir o registro nativo de uma resposta HTTP falha. O requisito relevante é não expor erro técnico na transmissão e recuperar o fluxo.

Frases visuais usadas: “Meu amigo.” e “Quero aprender.”, com arquivos reais `amigo.pose` e `aprender.pose` do repositório. Não foi percorrido o catálogo completo de 400–800 sinais.

## Evidências e reprodução

- Registro estruturado e capturas: `outputs/qa-elia-live/`, na raiz do workspace.
- Script reproduzível do navegador: `tmp/qa-live-browser.cjs`.
- Mudanças da plataforma/backend: `neotalk-eventos/`.
- Widget baseado no main isolado: `tmp/avatar-main-pose-fix/`. Não substituir o main por um branch antigo; os diffs são locais sobre essa base.
- O script usa biblioteca Playwright do runtime local, browsers em `tmp/browsers`, servidor na porta 3110 e respostas interceptadas. Não executá-lo como teste de produção.

Comandos da plataforma: `npm run build` e `node --test tests/*.test.mjs`. Suíte Python: `python -m unittest discover -s backend/tests -v`, com backend e dependências disponíveis no PYTHONPATH. Suíte do widget: `node --test tests/widget*.test.*` no checkout isolado.

O sandbox inicialmente bloqueou resolução de dependências e execução assíncrona; build e suíte Python foram repetidos com autorização fora do sandbox e passaram. O typecheck integral havia falhado por configuração/tipos de Next/Workers do projeto; build passou, mas isso não elimina a dívida de configuração. Não foram instaladas dependências para esconder esse problema.

## Achados ainda abertos e riscos

| Prioridade | Ponto aberto | O que falta |
| --- | --- | --- |
| P1 | PiP nativo com documento `about:blank`. | No headless, o relay não concluiu carregamento nessa configuração. Janela de mesma origem passou. Validar PiP real em Chrome/Edge/Brave com HTTPS; não considerar homologado com o substituto de API. |
| P1 | Palestra contínua de 60–90 minutos. | Teste real com pausas, fala rápida, mute, perda/retorno de rede, troca de aba e saída externa. Volume simulado não detecta todas as falhas de GPU/microfone. |
| P1 | Falhas 502 reais do upstream. | Correlacionar logs do proxy, plataforma, API de sinais e widget por trace/task/load ID. Recuperação foi testada; a causa real não foi demonstrada por esses testes. |
| P1 | Backpressure de fala mais rápida que a sinalização. | Atualização: crescimento ilimitado reproduzido e corrigido com fila limitada e pausa explícita da captura, preservando a sinalização admitida. Ver `QA-LIVE-BACKPRESSURE-2026-10-06.md`. Rajada de 2.000 callbacks passou com Unity real e API simulada. Ainda falta validar a política de pausa em palestra real; não há garantia de perda zero. |
| P1 | Persistência após queda longa da API. | Falhas ao salvar/sincronizar continuam possíveis; falta armazenamento local durável e sincronização posterior. A fila não deve ser confundida com confirmação de salvamento. |
| P1 | Qualidade das mãos/punhos e possíveis interseções. | As capturas mostram artefatos visuais. Separar influência do renderizador SwiftShader de malha/rig/retarget. Inspecionar frames em GPU real e no Unity antes de aplicar correção geral. Não foi feita reconstrução Unity nesta rodada. |
| P1 | Validade linguística das poses e traduções. | Revisar sinais com QA fluente em Libras, inclusive EU/QUERER/PERGUNTAR_DÚVIDA e ACOMPANHAR. Animação em movimento não prova tradução correta. |
| P2 | Brave/Firefox/Safari/iPad e microfone em call simultânea. | Hardware e políticas dos navegadores precisam de ensaios próprios. `pt-BR` configura preferência, não garante que o motor nunca reconheça outra língua. |
| P2 | Concorrência SQL real. | Rodar CTE de encerramento, criação simultânea e PATCH atrasado em PostgreSQL real. Pools simulados testam contratos, não locks reais. |
| P2 | Três avisos de hooks / configuração de tipos. | Refatorar efeitos e callbacks em controlador de sessão estável. Acrescentar dependências mecanicamente pode criar reassinaturas; não silenciar o lint sem análise. |
| P2 | Tipografia no ensaio offline. | Captura local apresentou fonte substituta. Verificar entrega da fonte em produção e evitar dependência frágil de recurso externo. |
| P2 | Aviso de múltiplos renderizadores React no servidor de desenvolvimento. | Observado no log do servidor durante recargas HMR; não houve `pageerror` no ensaio final. Reproduzir em modo produção antes de atribuir impacto ao usuário. |

## Critério para fechar a homologação

Só declarar a Elia homologada depois de: PiP nativo validado; ensaio prolongado real concluído; SQL concorrente exercitado em banco real; logs dos 502 correlacionados; testes físicos por navegador/dispositivo prioritário; e avaliação linguística/visual de amostra representativa do catálogo. O catálogo completo precisa de revisão separada, não de uma afirmação baseada em duas poses.

As correções desta rodada reduzem riscos concretos e têm regressões reproduzíveis. **Não significam que todos os bugs possíveis foram encontrados ou que a produção está sem falhas.**
