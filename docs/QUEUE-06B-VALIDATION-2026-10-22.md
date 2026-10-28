# QUEUE-06b — revisão e segunda rodada de pressão

Card: https://trello.com/c/khtoQNjM

## Falhas reproduzidas e corrigidas

1. Uma primeira requisição ASR retida permitia acumular respostas posteriores
   fora do FIFO de áudio. No teste de 100 chunks, 90 requisições já haviam sido
   despachadas enquanto a primeira permanecia pendente. Agora a janela de
   respostas fora de ordem também limita o despacho; a captura continua no
   staging com orçamento. Liberar a primeira permite escoar os 100 chunks.
2. Falha terminal de um áudio já aceito liberava a ordem, mas só informava o
   administrador. Agora o operador recebe aviso simples fora do player, limitado
   a um a cada 15 segundos. Não é um alerta por retentativa, não pausa a captura
   e não aparece sobre o avatar. Cancelamentos de uma sala anterior não avisam
   nem entram na sala nova.

O relatório admin inclui a contagem `backlog.audioReordered`, sem conteúdo.

## Verificação

- Antes das correções: os dois testes novos falharam reproduzindo as lacunas.
- Depois: 108 testes frontend passaram, incluindo os três cenários novos;
  31 testes backend passaram usando o ambiente Python de testes existente.
- `npm run build` passou. A checagem TypeScript integral mantém os três erros
  preexistentes de tipos Cloudflare em `db/index.ts` e `worker/index.ts`;
  portanto, não há aprovação dessa checagem integral.
- `git diff --check` sem erros.

## Ensaio virtual ampliado

Os testes executam as closures reais da sala com serviços e reprodução
simulados. Não executam Unity, dispositivo de áudio, navegador ou rede reais.
Cada cenário agora injeta **60 minutos virtuais** de fala e espera escoamento.

| Entrada | Palavras preservadas e escoadas em ordem | Máximo da janela de trabalho | Fim virtual do escoamento |
|---|---:|---:|---:|
| 140 palavras/min | 8.400 | 23 | 3.717.900 ms |
| 180 palavras/min | 10.800 | 72 | 4.954.300 ms |
| 220 palavras/min | 13.200 | 72 | 6.105.200 ms |

Nos três: sem mute automático por pressão, reset solicitado ou perda de texto
aceito. Concorrência de tradução limitada a duas. A saída usa a hipótese
sintética de 0,65 glosa/palavra, 650 ms/glosa e 80 ms/transição, não medições.

**Limitação importante:** aos 220 palavras/min, essa hipótese deixa cerca de
41 min e 45 s de atraso ao terminar a entrada. O teste prova continuidade e
ordem nesse modelo; não prova fluidez, baixa latência ou prontidão para evento.
Mais staging não aumenta a velocidade do avatar. PERF-02/03 e baseline real
continuam necessários. Também não substitui QA-07 de 60 min reais + 2 h.

## Entrega e próximo gate

Preparar branch de validação com observabilidade e captura contínua. Não
publicar diretamente na main/produção nem marcar o card concluído. Próximo
gate: ambiente com builds identificados, ASR/API reais, perfil de rede e
homologação dos dispositivos/mini-player. Nenhum WebGL foi modificado nesta
rodada. Nenhuma chave ou gravação de usuário foi incluída.
