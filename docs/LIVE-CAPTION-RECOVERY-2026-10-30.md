# Sala ao vivo: continuidade de captura e lacunas do dataset

## Causas identificadas no código de produção de referência (f2fe4a0)

- Ao atingir 72 lotes pendentes, a aplicação mutava o microfone, abortava o reconhecimento e exigia reativação manual. O avatar podia continuar sinalizando o material anterior, com legendas e lotes novos parados.
- O buffer de texto era truncado em 120 palavras. Na captura compatível, os áudios acima de seis pendências eram descartados.
- `recognition.start()` com erro era retentado indefinidamente. Um `start()` sem resultados renovava indevidamente a atividade. O watchdog ignorava a página oculta, inclusive com mini-player ativo.
- Reconectar o gravador cancelava pedidos de transcrição já aceitos e apagava sua fila.

Essas causas reproduzem mecanismos compatíveis com o relato. Não foi capturado um diagnóstico da sessão real do usuário para determinar qual disparou naquele momento.

## Alterações

- Captura e legendas não dependem da capacidade da fila de animação.
- Permanecem os limites de dois pedidos de tradução, dois de transcrição e 72 lotes materializados. O excedente é texto pendente da sessão, sem truncamento em 120 palavras.
- Seis áudios pendentes passam a ser um limiar de diagnóstico, não de descarte/mute. Os áudios capturados aguardam processamento na ordem.
- Três falhas de início ativam a captura compatível. Sem respostas do serviço por 30 segundos há uma tentativa de recuperação; outra janela de 30 segundos sem progresso ativa o fallback. Resultados e respostas normais `no-speech` renovam a saúde; o simples `start()` não.
- A checagem não é desativada por a plataforma estar oculta. Isso não impede o sistema operacional de suspender o navegador.
- Reconexão do gravador preserva pedidos e áudios já aceitos, separando a geração do gravador da geração da fila de transcrição.
- Mute manual, encerramento da sala, permissões e offline continuam explícitos. Não há modificação no Unity/WebGL ou no repositório do widget.

## Limites importantes

- As pendências de texto/áudio ainda ficam em memória da aba e são descartadas ao encerrar a sala. Esta entrega não implementa persistência de recuperação após recarregar/fechar a página.
- Capturar sem descartar exige memória proporcional ao atraso. Sob indisponibilidade prolongada do serviço, a fila pode crescer; não se afirma capacidade ilimitada nem ausência de qualquer perda possível.
- Falhas definitivas de transcrição após as retentativas continuam registradas como trecho não transcrito. Não há promessa de recuperar áudio que o navegador não capturou durante uma falha do serviço nativo.
- A mudança remove a pausa artificial por acúmulo; não demonstra ganho de velocidade da animação nem traduz mais rápido que a capacidade do avatar.
- Falta validação prolongada com microfone físico e serviço real no navegador do evento. Testes determinísticos não substituem essa validação.

## Sinais a adicionar ao dataset

- Mesma base PostgreSQL da plataforma: `dataset_missing_terms` agrega frequência e datas; `dataset_missing_observations` evita contar duas vezes o mesmo termo na mesma observação/lote.
- O agente informa até 12 `missing_concepts` na mesma resposta estruturada. Não existe segunda chamada de IA para coleta.
- Conceitos são candidatos para revisão do QA, não prova de ausência de equivalência semântica. Glosas inválidas da saída permanecem separadas de lacunas de vocabulário.
- Normalização de caixa, acentos e separadores; eliminação de duplicados, termos disponíveis, palavras funcionais, números, URLs e formatos de contato. Não se grava frase completa, áudio ou identidade do usuário nessa funcionalidade. Não é um detector infalível de nomes próprios.
- Escrita opcional pós-resposta, uma instrução SQL com prazo de um segundo. Falha nessa escrita gera diagnóstico e não interrompe a tradução. Em crash/timeout dessa escrita, a observação pode não ser registrada.
- Na sala ao vivo, usa o ID do lote quando disponível, senão o ID da resposta. Em QA usa o ID da resposta. Ocorrências significam solicitações distintas, não pessoas únicas nem contagem literal de cada repetição dentro de uma frase.
- Chaves de deduplicação expiram em 90 dias; contadores agregados permanecem.
- Admin: Qualidade → **Sinais a adicionar**, com paginação e frequências. API `GET /api/v1/admin/dataset-gaps` exige sessão de administrador; usuários comuns recebem 403 e anônimos 401.
- Termos que entram no catálogo sincronizado ficam ocultos sem apagar o histórico.
- Migração aditiva/idempotente. Versão anterior ignora as tabelas novas; não é necessário apagá-las para rollback.

## Validação

- Testes executam as closures reais de `LiveRoom.tsx`, com microfone, API e relógios simulados: 2.000 trechos/24.000 palavras retidos com tradução suspensa; 2.000 trechos drenados na ordem com saída lenta, sem mute/reset; retomada após mute manual; captura após fila cheia; vinte áudios em ordem; troca do gravador; início nativo falhando; página oculta com mini-player.
- Testes SQL em PostgreSQL descartável local: UPSERT, origens, concorrência/idempotência, permissões, paginação, migração e atualização de catálogo.
- Regressão do analytics no mesmo banco isolado. Não foram inseridos dados fictícios no banco de produção.
- Build de produção e TypeScript dos componentes modificados. A checagem TypeScript global tem erros preexistentes nos tipos Cloudflare (`cloudflare:workers`, `Fetcher`, `D1Database`); lint mantém três avisos preexistentes de dependências de efeitos em `LiveRoom.tsx`.

Referência da saída estruturada: [documentação oficial da OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
