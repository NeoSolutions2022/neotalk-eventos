# Retomada do roadmap — 26/10/2026

Cards vencidos revisados: OBS-01, QUEUE-06b e PERF-03a. Atrasos não foram
escondidos mudando datas. Homologação local já realizada foi marcada nas
checklists de QUEUE-06b/PERF-03a; não equivale a ASR físico ou produção aprovada.
PERF-03 recebeu uma subentrega de prefetch, ligada à redução das pausas.

## Implementação no repositório correto

Correção do widget em [Avatar3DFrontend, PR #40](https://github.com/NeoSolutions2022/Avatar3DFrontend/pull/40):
promessa de prefetch cobre consulta e download, máximo de dois trabalhos por
geração, invalidação por troca de avatar e fallback normal caso o warmup falhe.
Sete testes novos, incluindo HTTP real em loopback e burst controlado de 100
pedidos. Três regressões foram primeiro reproduzidas na base. Ao todo 28 testes
Node do avatar passaram. WebGL/poses/mãos não mudaram; HTML/JS identificam widget
`.30` e manifest continua com o build Unity existente.

O defeito era uma corrida: `requestSign` podia aguardar só a API e mandar carregar
a URL antes de terminar o download que deveria adiantar essa mesma transferência.
O teste HTTP confirma consumo exato dos bytes com uma transferência da origem.
Nesse teste a API e Unity são controlados. Não significa preparação nativa pronta.

## Integração com serviços e Unity reais

Mesma frase de sete palavras enviada cinco vezes, alvo de 180 palavras/minuto,
Edge 155.0.4283.62 headless, principal e Document PiP nativo. GPT e NeoTalk reais;
ASR pt-BR injetado/dispositivo de permissão falso. Banco/cache locais isolados.

| Observação | Base | Candidata comportamental |
|---|---:|---:|
| Lotes completos em cada saída | 5 | 5 |
| Pausas de captura / resets / rejeições | 0 / 0 / 0 | 0 / 0 / 0 |
| Submits de pose / amostras / replays | 3 / 3 / 2 | 3 / 3 / 2 |
| Duração total | 99,095 s | 94,344 s |
| Pedido GPT, mediana | 2,158 s | 1,702 s |
| Intervalo PiP, mediana (n=4) | 0,514 s | 0,511 s |
| Intervalo PiP, máximo/p95 (n=4) | 0,559 s | 0,637 s |

**Não há ganho de velocidade aprovado.** Uma execução pequena por variante,
frase repetida e variações de GPT/polling/cache/clips não permitem atribuir a
diferença total à correção. O máximo do intervalo piorou nessa amostra pequena.
Ambos passaram no gate de execução/cobertura correspondente a cinco lotes;
isso não substitui o gate de 100 estratificados nem o teste de evento.

Agregados sem conteúdo de fala: [base](baseline-smoke.json) e
[candidata](candidate-smoke.json). Relatórios privados originais:
`outputs/real-services-1793026037764` e `outputs/real-services-1793026240445`.
As imagens Docker efetivas constam nos JSONs; commit do checkout sozinho não
é prova de qual imagem estava executando. A candidata comportamental foi
testada antes de mudar o rótulo visual para `.30`, sem outra alteração funcional.

O ensaio histórico de 100 lotes e o FAIL por oito spans ausentes permanecem
inalterados em [23/10](../2026-10-23/README.md). Não comparar a mediana de 3,44 s
do corpus anterior com a frase repetida para anunciar redução de pausa.

## Verificação e limites

138 testes Node da plataforma passaram, incluindo a allowlist/privacidade dos
agregados. Mais quatro testes Python de polling passaram no avatar. O servidor do teste
HTTP tem deadline para que falta de permissão de loopback não deixe a suíte presa.
Uma execução na sandbox expirou; repetida com rede local autorizada, passou.

Pacote final `.30` validado após rebuild local: três frases diferentes/21
palavras, três lotes completos em cada saída, primeiro/último frame e spans
presentes em todos, zero pausa/reset/rejeição, duração de 50,259 s. Ambos
widgets confirmaram a versão `2026.10.26-elia.30`. Relatório privado:
`outputs/real-services-1793026741232`; imagem final do avatar:
`sha256:6956cef8016553be8d5925cde4312dd3b3a378926d6d3f832f68ea7587373e74`.

Sem merge/deploy. Faltam sessão de uma hora, ASR/microfone físicos, hardware e
navegadores adicionais, minimização/background, comparação repetida e preparação
nativa PERF-02. Efí depende de insumos. Não marcar cartões pais como concluídos.

Reprodução dos agregados, a partir dos arquivos locais preservados:

```powershell
node scripts/summarize-prefetch-validation.mjs outputs/real-services-1793026037764 docs/performance/2026-10-26/baseline-smoke.json
node scripts/summarize-prefetch-validation.mjs outputs/real-services-1793026240445 docs/performance/2026-10-26/candidate-smoke.json
```
