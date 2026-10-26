# Pool HTTPS do proxy — integração real

Subentrega de PERF-03 no Avatar3DFrontend, independente do pool já existente no
backend desta plataforma. Sem mudança de filas, WebGL ou duração dos sinais.

[Agregados da integração](integration.json): dez frases diferentes/70 palavras,
alvo de 180 palavras/minuto, GPT e NeoTalk reais, dois Unity reais e Document PiP
nativo. ASR pt-BR injetado, dispositivo de permissão falso. Edge 155.0.4283.62.

- Dez lotes completos em cada saída, primeiros/últimos frames confirmados;
  zero medições obrigatórias ausentes, erro, skip, reset ou pausa de captura.
- Dez traduções HTTP 200; dez submits 202; 39 polls 202 + dez 200;
  17 heartbeats 204. Nenhuma rejeição de entrada. Duração: 167,743 s.
- PiP: nove intervalos, mediana 2,095 s, p95 4,058 s. **Ainda não aprova fluidez.**
- O corpus/cache/memória difere do ensaio de 100 lotes. Não anunciar redução
  ponta a ponta usando comparação entre essas populações.

Benchmark distinto, com HTTPS real e **mesma tarefa já concluída**, alternou
seis rodadas por variante/três consultas por rodada. Média total da rodada
incluindo criar/fechar transporte: urllib 1.502,17 ms versus pool 824,90 ms,
45,09% menor **nesse componente/ensaio**. Todas as 36 respostas equivalentes,
sem latência artificial. Primeira conexão continua fria; p95 de chamada mudou
pouco (524,58→505,82 ms). Não mede worker/Unity/GPT/ASR.

Dados, gráfico, segurança e reprodução no repositório do avatar:
`docs/performance/2026-10-26/README.md` e `https-status.json/png/svg`.
Sem credenciais, transcrição, cookie ou identificadores de sessão nos agregados.
Brutos privados: `outputs/real-services-1793034926657`.

32 testes Python do avatar (16 existentes + 16 novos) e 28 Node passaram.
139 testes Node da plataforma passaram nesta atualização.
O sumarizador agora aceita mínimo explícito de dez; não usa silenciosamente
o gate de cinco. Ainda faltam voz física, sessão prolongada e preparação nativa.
Nenhum merge/deploy em produção foi feito.

Rebuild final com validação adicional de URL: mais três lotes completos em
cada saída, zero spans ausentes, pausa/reset/rejeição, 56,446 s. Ensaio separado,
não somado aos dez: [agregados do smoke final](final-smoke.json), mínimo explícito
de três. Brutos privados `outputs/real-services-1793035496945`.
Imagem final: `sha256:0d1428f3d8f2f516ff5184da7f1e5a952e3b2e84dd2a514eb23429c3899a3975`.
Hashes de `app/neotalk.py` e `app/main.py` no container conferidos contra o checkout.
