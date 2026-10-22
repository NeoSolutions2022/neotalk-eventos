# OBS-01 — coleta dos tempos do widget/proxy

Card: https://trello.com/c/1L9pnuQh

## Subentrega

O relatório de latência admin acrescenta `pose_pipeline_ms` (quantidade, média,
p50, p95 e máximo por etapa), spans por lote e `missing.poseTimings`.
A coleta usa somente eventos do widget principal associados à frase atual
ou a um prefetch da fila atual. Ignora a cópia do mini-player e repetição do
mesmo resultado para não contar uma requisição duas vezes. Apresentação e
repetições ociosas não geram novas amostras de tradução.

A lista permitida contém total, requisições de submit/status, espera de polling,
espera de retentativa, chamada upstream do proxy, consulta ao armazenamento,
download para o proxy e validação/persistência. Só aceita números finitos e
não negativos. Não exporta frases, glosas, URLs, palavras do catálogo ou campos
desconhecidos. O limite existente de 512 lotes continua válido.

## Como interpretar

- `total_ms` termina na pose pronta da API; não inclui arquivo chegando ao
  navegador nem preparação Unity. Prefetch pode acontecer antes do despacho.
- `proxy_download_ms` é API de sinais→proxy, não proxy→navegador.
- `poseCacheHit` é o armazenamento do proxy, não o cache do widget/Unity.
- Spans do proxy já estão dentro das requisições do navegador. Não somar todas
  as colunas como se fossem etapas sequenciais independentes.
- Chamada de status não mede duração interna da fila/computação do worker.
- Widget antigo ou campos indisponíveis ficam ausentes; `null` não significa
  zero. Ausência de amostra bem-sucedida também pode representar erro/cancelamento.
- Repetições da mesma frase usando cache local podem não fornecer spans novos.
  `missing.poseTimings` não é uma contagem de falhas de reprodução.

## Verificação em 22/10/2026

- Build da plataforma passou; 113 testes frontend e 41 backend passaram.
- Novas regressões: filtro de dados, evento duplicado, origem/saída, frase
  antiga, prefetch, proxy/widget antigos e exclusão do modo apresentação.
- Avatar3DFrontend: 21 testes Node e 16 Python passaram, incluindo cache
  frio/quente, retentativa e cancelamento. APIs e relógios simulados.
- TypeScript integral ainda encontra os três erros preexistentes dos tipos
  Cloudflare (`cloudflare:workers`, `Fetcher`, `D1Database`), fora desta mudança.
- Nenhum WebGL ou arquivo de mãos mudou. Não mede ganho em produção e não
  aprova o build Unity. Não houve merge/deploy.

Gate seguinte: instalar ambos os PRs em homologação e coletar ao menos 100
lotes reais, mantendo versões, carga, navegador e rede registrados. OBS-01
continua em andamento até esse gate e a atribuição interna do worker.
