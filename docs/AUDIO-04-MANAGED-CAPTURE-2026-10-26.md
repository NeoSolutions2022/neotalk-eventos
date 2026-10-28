# AUDIO-04 — microfone e captura gerenciada

Subentrega candidata; não é aprovação de isolamento de voz nem de todos os
navegadores. Sem mudança de Unity, modelo de ASR, duração dos chunks ou GPT.

## Comportamento

- Padrão preservado: WebSpeech, quando disponível, continua controlando sua
  própria captura. Um `getUserMedia` de permissão não configura o WebSpeech.
- Escolher hardware, perfil ou modo compatível usa o stream adquirido no
  `MediaRecorder` que envia áudio ao transcritor. Pode aumentar a latência em
  comparação com WebSpeech; não é uma otimização de velocidade.
- Hardware explícito usa `deviceId: { exact }`. Se faltar, a sala não inicia
  silenciosamente em outro microfone. Recuperação mantém a seleção da sessão.
- Perfil Voz solicita eco/ruído/ganho ligados; Mesa de som solicita desligados.
  Apenas constraints suportadas são enviadas, como preferências `ideal`.
  `getSettings()` informa os booleanos efetivos ao admin, não uma promessa de
  que o navegador aplicou as preferências ou isolou uma voz.
- Listar dispositivos não pede permissão nem abre o microfone. Nomes podem
  ficar ocultos até a autorização. Seleção bloqueada durante a transmissão.
- Mutar atua nas faixas reais; desmutar reutiliza o stream; encerrar libera as
  faixas. Identificadores de hardware ficam apenas em memória da página, sem
  inclusão em telemetria, banco, logs ou relatório do teste.

## Validação

`npm test`: build e **152 testes passaram**, incluindo seleção, recuperação,
privacidade, fluxo padrão e quatro regressões da continuidade fora da tela.
O `tsc --noEmit` integral ainda tem os três erros anteriores de tipos Cloudflare
(`cloudflare:workers`, `Fetcher`, `D1Database`); não foi declarado aprovado.

`node tests/capture-browser.cjs`: Edge 155.0.4283.62, plataforma/backend locais,
`getUserMedia` e `MediaRecorder` reais, dispositivo de áudio sintético do
navegador. Nenhuma resposta HTTP ou transcrição foi simulada nesse ensaio.
As **12 verificações passaram**: listagem sem captura, identidade do stream,
desvio correto do WebSpeech, seleção exata, mute/desmute, ASR real e liberação.
Evidência sanitizada: [capture-browser.json](performance/2026-10-26/audio-capture/capture-browser.json).

Naquela repetição, o backend retornou **três 502 antes de 200**, inicialmente
tratados como falha transitória. A investigação posterior identificou uma
rejeição 400 do arquivo sem mídia no provedor; veja a correção e a nova rodada
em [AUDIO-BOUNDARY](AUDIO-BOUNDARY-2026-10-26.md). Foram observados chunks de 110 bytes
após mute/desmute rápido; a associação causal com cada 502 não foi estabelecida.
O teste não mede qualidade acústica, WER, clipping nem supressão de interlocutor.
Ensaios intermediários também não foram apagados dos outputs privados.
Repetição final: `outputs/capture-managed-1793038165025`; imagem da plataforma
`sha256:97b0ff658601735327b84afe2dc48078afdd8272d67af36230774e166f835f7f`.
Hashes do código e harness estão no JSON; os 12 checks são de captura, não
atestam ausência de falhas do provedor de ASR.

## Checklist para o Trello

Card: [AUDIO-04](https://trello.com/c/cZVdlsgg). A primeira tentativa de atualizar
foi bloqueada: conector em conta sem acesso e navegador local desabilitado.
Após restauração do acesso ao Brave, o card foi movido para Em andamento, com
o critério do stream marcado e comentários contendo escopo/evidências/limites.
O registro abaixo detalha as subentregas técnicas; não equivale ao checklist
geral do card inteiro nem a uma aprovação de todos os seus critérios.

- [x] Seleção explícita e recuperação sem trocar hardware silenciosamente.
- [x] Perfis configuram o stream realmente enviado ao ASR no modo gerenciado.
- [x] Exibir booleanos efetivos ao admin, sem exportar IDs de dispositivos.
- [x] Regressões automatizadas e ensaio de captura real com dispositivo sintético.
- [ ] Comparação acústica com microfone físico e fonte concorrente controlada.
- [ ] Comparar WER, clipping e latência com/sem filtros; não prometer isolamento.
- [ ] Chrome/Edge/Brave/Safari/iPad reais, permissões, Bluetooth e desconexão.
- [x] Reproduzir/corrigir o cabeçalho sem mídia e a corrida de timer em mute/desmute.
- [ ] Validar falhas ASR restantes e continuidade prolongada com áudio físico.
- [ ] Aceite prolongado e revisão antes de merge/deploy.

O escopo completo do card permanece incompleto; não mover para concluído apenas
pelos testes do componente. Isso não afirma nem altera a coluna atual no Trello.
O ensaio encontrou ainda uma falha independente de
conclusão do mini-player: [diagnóstico](PIP-OFFSCREEN-2026-10-26.md).
