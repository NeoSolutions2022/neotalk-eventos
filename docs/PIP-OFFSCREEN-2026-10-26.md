# Continuidade do PiP com o principal fora da tela

## Falha reproduzida

Dois ensaios de três frases falharam: o mini-player informou seu último frame,
mas o principal não confirmou carregamento; a fila esperou, repetiu o mini-player
e acabou marcando erro. Todos os HTTP de tradução/pose responderam com sucesso.
Não era prova de falha da API ou do novo seletor de áudio.

A nova seção de áudio aumentou a rolagem necessária para abrir o PiP. O iframe
principal podia sair totalmente do viewport, embora o documento continuasse
`visible`. O gate anterior só distinguia aba oculta de aba visível e continuava
esperando o principal, que o navegador podia suspender.

Controle com a mesma imagem antiga e o principal visível: três lotes completos
nas duas saídas, sem reset/pausa/erro. O harness agora registra retângulo,
interseção e visibilidade do documento, sem mudar flags de throttling.

## Ajuste candidato

- Principal fora do viewport, com dimensão zero ou aba oculta: o último frame
  nativo válido do mini-player aberto pode concluir o lote.
- Principal visível ou geometria desconhecida: continuam obrigatórios os dois
  últimos frames. Sem saída externa aberta, só o principal pode concluir.
- Evento tardio/ID incorreto/frame não terminal continua sem poder concluir.
- Progresso externo real cancela watchdog de processamento; um timeout tardio
  do principal não reinicia a pose que o mini-player já aceitou.
- Scroll/resize reavaliam a conclusão sem esperar um timer de recuperação.
- Sem conclusão por duração estimada, reset, descarte de lote ou novo WebGL.

## Evidência antes/depois

Quatro regressões do componente e build passaram junto com os 152 testes.
Edge 155.0.4283.62, GPT/NeoTalk/Unity reais e Document PiP nativo:

| Ensaio | Resultado observado |
|---|---|
| Imagem anterior, principal fora da tela | Um lote externo terminou; zero lotes concluídos na fila até o limite de 55 s. Documento `visible`, iframe entre -700 e -234 px. |
| Imagem anterior, principal visível | Três lotes completos nas duas saídas em 51,482 s. |
| Candidata, principal fora da tela | Três lotes externos completos em 39,448 s; fila escoada, principal suspenso com zero execuções completas. |
| Candidata, principal visível | Três lotes completos em cada saída em 55,233 s; nenhum primeiro/último frame ou span obrigatório ausente. |

Nas duas rodadas candidatas: zero erro/skip/pendência ao final, reset, pausa
automática ou rejeição de entrada. Não é aprovação de soak, hardware físico,
Safari/iPad, janela minimizada por longo período ou performance ponta a ponta.
Tempos totais de cenários diferentes **não são comparação de velocidade**.
O mecanismo interno de suspensão do navegador é inferido dessa mudança de
visibilidade e dos callbacks observados, não de instrumentação do scheduler.

O cenário fora da tela conserva **três primeiros e três últimos frames ausentes
do principal** no relatório. Ele passa apenas o contrato de continuidade da
saída externa visível; não passa o gate estrito de dois Unity completos.

[Agregados sanitizados](performance/2026-10-26/audio-capture/pip-visibility.json).
Brutos privados preservados: `outputs/real-services-1793037240817` e
`1793037507801` (falhas iniciais), `1793037811769` (reprodução controlada),
`1793037658977` (controle visível), `1793037979528` (candidata fora da tela) e
`1793038069502` (candidata visível).

## Reprodução local

Serviços isolados de `compose.homolog.yaml`, credenciais no arquivo privado
ignorado pelo Git. Nunca copiar segredos para comandos, relatórios ou cards.

```powershell
$env:QA_TRANSCRIPTS='3'
$env:QA_MAX_SECONDS='150'
$env:QA_PRIMARY_VIEW='visible' # depois repetir com offscreen
node tests/real-services-browser.cjs
```

O cenário `offscreen` exige final real de **cada lote externo**, continuidade
da captura e ausência de erro/reset/skip/rejeição. Preserva explicitamente as
medições ausentes do principal suspenso; não fabrica frames nem recebe o selo
de aprovação do gate que exige dois renderizadores completos. O cenário
`visible` mantém o gate estrito anterior. ASR é controlado nesse harness;
GPT/NeoTalk/Unity e PiP são reais.
