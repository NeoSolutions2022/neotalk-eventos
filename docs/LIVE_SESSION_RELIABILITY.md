# Confiabilidade da sala ao vivo

## Objetivo operacional

A sala deve permanecer utilizável durante uma palestra de pelo menos 60 minutos, inclusive após silêncio prolongado, troca de aba, suspensão breve da rede e reinício interno do reconhecimento de voz. A interface pública não deve exibir detalhes de API, pose, fila ou retentativas; esses dados ficam restritos ao modo de diagnóstico do administrador.

## Ciclos supervisionados

- **Microfone nativo:** o reconhecimento contínuo é renovado quando o navegador o encerra. Um watchdog reinicia uma sessão sem atividade há 30 segundos, mas não atua enquanto a página estiver oculta ou sem rede.
- **Microfone compatível:** cada trecho usa um `MediaRecorder` independente para produzir arquivos decodificáveis. A faixa de áudio e o gravador têm recuperação automática. Resultados pertencentes a uma geração antiga da captura são descartados.
- **Transcrição:** no máximo duas chamadas ficam em voo e seis trechos aguardam na memória. Isso impede crescimento ilimitado quando a rede ou o serviço ficam lentos.
- **Avatar:** um comando sem confirmação é reenviado. Depois de confirmado, um segundo watchdog detecta processamento travado; ele tenta novamente e, no último nível de recuperação, reinicia o iframe WebGL preservando o lote atual.
- **Sala e histórico:** heartbeats são sequenciais, têm timeout e backoff. Se o backend expirar a sala após uma suspensão longa do navegador, o frontend retoma a mesma sala. O servidor só considera uma sala ao vivo abandonada após dez minutos sem heartbeat.
- **Chamadas HTTP:** nenhuma requisição pode permanecer pendurada indefinidamente; o limite geral é de 60 segundos.

## Roteiro de homologação de 60 minutos

1. Iniciar uma sala com Elia e confirmar legenda e movimento no primeiro trecho.
2. Falar continuamente por 15 minutos e observar se a fila continua avançando.
3. Permanecer em silêncio por 3 minutos e voltar a falar; o microfone deve retomar sem recriar a sala.
4. Mutar por 2 minutos; o avatar deve manter o loop. Desmutar e confirmar nova tradução.
5. Trocar de aba por 3 minutos e retornar. Repetir com o mini-player aberto.
6. Desconectar a rede por 30 segundos e reconectar. A captura, o heartbeat e a fila devem se recuperar.
7. Manter a sala até completar 60 minutos e encerrá-la. Conferir duração, lotes e estado `finished` no histórico.

Durante a homologação, o usuário comum deve ver apenas estados como “preparando”, “reconectando” e “sinalizando”. Códigos HTTP e mensagens internas são aceitáveis somente no diagnóstico administrativo e nos logs.

