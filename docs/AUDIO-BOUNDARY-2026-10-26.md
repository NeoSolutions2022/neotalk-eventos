# AUDIO-04 — fronteira de gravação e falsos 502

Subentrega candidata, sem merge/deploy, alteração de modelo, idioma, duração dos
chunks, Unity ou widget. Os resultados anteriores continuam preservados.

## Duas causas verificadas

1. **Gravador antigo cancelava o temporizador novo.** Ao mutar/desmutar antes
   do `onstop` anterior chegar, um novo gravador já podia estar ativo. O callback
   anterior chamava `clearFallbackChunkTimer()` global e removia o deadline do
   novo. A regressão falhou na base (`null !== 6`) e passou após condicionar a
   limpeza/continuação à identidade do gravador atual. A cauda anterior continua
   admitida, não é descartada para encobrir a corrida.
2. **Cabeçalho sem mídia era enviado e retentado.** Um `MediaRecorder` real do
   Edge 155, com dispositivo sintético, iniciado/parado imediatamente, gerou
   110 bytes: cabeçalho EBML `webm` e zeros, sem Segment/Tracks/Cluster. O decoder
   retornou `EncodingError`; o transcritor real respondeu **400**,
   `invalid_value`, `param=file`. O backend convertia isso em 502 e o cliente
   retentava o mesmo arquivo. Não era indisponibilidade transitória nesse caso.

Controle de 4,2 s no mesmo dispositivo produziu 60.300 bytes e foi decodificado
em 201.600 amostras. Não foi voz física nem validação linguística.
[Diagnóstico sanitizado](performance/2026-10-26/audio-boundary/recorder-diagnostic.json).

## Tratamento

- Classificador limitado reconhece somente cabeçalho EBML completo com DocType
  `webm`, seguido exclusivamente de zeros ou fim do arquivo. Não usa tamanho
  mínimo, duração mínima, volume ou hipótese de silêncio para descartar fala.
- Qualquer byte de mídia/Segment, estrutura incompleta/desconhecida ou outros
  containers segue a validação normal. Acima de 4 KiB o classificador nem tenta
  reconhecer o padrão; isso limita trabalho, não define tamanho mínimo de fala.
- Esse caso sem mídia responde `200`, `text=""`, `skipped="empty_container"`
  **sem consultar o provedor**. O slot ordenado é liberado normalmente.
- `emptyAudioChunks` é separado na telemetria admin. Não vira amostra de
  latência/sucesso do provedor, nem entra nos contadores de áudio rejeitado.
- Rejeição 400/422 do provedor identificando `param=file` vira 422 permanente,
  sem upload repetido. A falha real segue avisando o operador, sem pausar o mic.
- 429/5xx, timeout e respostas inválidas continuam falhas; não foram mascaradas
  como sucesso. Texto ausente/não textual não é convertido em fala inventada.
- O callback antigo não cancela mais o timer do gravador atual. Nenhum mecanismo
  de pressão de fila, limite de memória ou política de mute foi removido.

O contrato da transcrição foi consultado na
[documentação oficial da OpenAI](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).
Mantidos `gpt-4o-mini-transcribe`, `language=pt` e `response_format=json`.
Não houve migração de modelo ou adoção de Realtime nesta entrega.

## Validação e limites

- Build e **156 testes Node** passaram; **52 testes Python** passaram.
- Novos testes cobrem timer antigo/cauda, slots vazios ordenados, 422 sem retry,
  contagem separada, parser conservador, endpoint sem chamada ao provedor e
  manutenção das falhas reais. A suíte Python precisou de loopback autorizado
  no Windows; tentativas bloqueadas pelo sandbox não foram chamadas de aprovação.
- O `tsc --noEmit` continua com os três erros de tipos Cloudflare anteriores
  (`cloudflare:workers`, `Fetcher`, `D1Database`); não foi declarado aprovado.
- Docker reaberto com autorização; reconstruídos somente API e plataforma da
  homologação isolada, com banco/cache locais preservados.
- Repetição do cenário real de captura: **14 verificações passaram**. O chunk
  de 110 B agora retornou `200/empty_container`, e o de 50.623 B teve `200` normal.
  Zero respostas ASR com erro nesse cenário, sem simulação de HTTP/transcrição.
  Um controle separado do mesmo cabeçalho também verificou o resultado explícito.
  [Relatório](performance/2026-10-26/audio-boundary/capture-after.json).
- Smoke posterior com GPT/NeoTalk/Unity reais, ASR controlado e dois players
  visíveis: três lotes/21 palavras, primeiro/último frame em cada saída, zero
  span obrigatório ausente, erro, skip, reset, pausa ou rejeição. 57,919 s;
  [agregados](performance/2026-10-26/audio-boundary/signaling-smoke.json).

Não é garantia de zero 502 em geral, um ensaio de microfone físico/ruído,
benchmark de latência, uso de uma hora ou aprovação de Chrome/Brave/Safari/iPad.
O cenário anterior com três 502 está preservado em
`docs/performance/2026-10-26/audio-capture/capture-browser.json`.

## Reprodução

```powershell
npm test
$env:PYTHONPATH='backend'
../stability-venv/Scripts/python.exe -m unittest discover -s backend/tests -v
node tests/recorder-empty-browser.cjs
# Opcional: uma consulta do cabeçalho sintético ao provedor; chave só no env ignorado.
$env:QA_PROVIDER_PROBE='1'
node tests/recorder-empty-browser.cjs
# Com compose.homolog.yaml saudável e credenciais privadas:
node tests/capture-browser.cjs
```

O diagnóstico grava apenas o cabeçalho sem mídia sintético em outputs privados,
nunca conteúdo de voz do usuário. Relatórios públicos têm status/códigos
permitidos, tamanhos, hashes e resultados; não têm chaves, transcrição ou IDs
de hardware/sala. Nenhum aviso real foi removido para fazer um teste passar.

## Trello

[AUDIO-04](https://trello.com/c/cZVdlsgg) permanece em andamento. O checklist
específico desta subentrega tem quatro de cinco itens concluídos; a validação
prolongada/física e os critérios gerais não foram marcados como aprovados.
Atualização feita pela aba do Brave, sem controle de janelas do Windows.
