# NeoTalk Offline mobile — implementação inicial

## Implementado

Projetos Capacitor para Android e iOS/iPadOS em `mobile-offline/`, bundle local React/Vite, reutilização direta da tela `LiveRoom` e identidade visual da plataforma, Elia como único avatar instalado, tradução determinística por catálogo com expressões compostas e aliases, concatenação de poses locais sem alterar coordenadas, validação SHA-256 e cache de sequências.

Voz local: Whisper tiny multilíngue q8 via Transformers.js/ONNX WASM em worker serializado, configurado para português, modelo/tokenizer/WASM empacotados. Sem reconhecimento de voz de navegador/cloud. Preparação explícita antes de iniciar captura. Cancelamento descarta resultados de sessões anteriores; inferência já em execução não é interrompida imediatamente. Pausa explícita do microfone ao ocultar o app; recuperação da sala não depende de `navigator.onLine`.

Página `/offline` e link na plataforma. Nenhum APK/IPA anunciado: links só aparecem quando as variáveis de release são configuradas.

## Verificado localmente

- 11 testes específicos do mobile offline passaram.
- 59 testes existentes da plataforma passaram após os parâmetros offline.
- TypeScript do mobile sem erros; build web da plataforma e do mobile passaram.
- Chromium, viewport 390 × 844, sem chamadas externas: catálogo carregado, Unity inicializado, sequência AMIGO APRENDER em execução com 76 frames, segundo pedido reutilizou a mesma URL, modelo ASR preparado sem rede externa e sem exceções de página.
- Evidência: `outputs/mobile-offline/browser-results.json` e `mobile-preview.png` na raiz da workspace.
- Checagem de release recusou o catálogo incompleto, como esperado.

Esse teste **não** mede precisão da transcrição de fala portuguesa real nem homologa WebGL/voz em iPhone ou Android. Não é ensaio de duração de uma hora.

## Ainda não entregue

1. Dataset completo: somente cinco poses de desenvolvimento disponíveis no pacote atual. Obter os arquivos originais, aliases, FPS e contagem confirmada; passar manifesto completo ao preparador.
2. APK/AAB: não compilado; ambiente inspecionado tem Java 8 e não foi encontrado Android SDK no local padrão. Preparar toolchain compatível com Capacitor 8.
3. IPA/TestFlight: não compilado; esta máquina é Windows, falta build macOS/Xcode e assinatura/distribuição Apple.
4. Homologação em aparelhos reais: consumo de RAM/bateria, cancelamento de inferência, recuperação em segundo plano, URLs blob de poses no WKWebView, uma hora de fala, permissões e precisão do português.
5. Ícones de loja/assinatura, termos e revisão de licenças para distribuição.
6. Histórico persistente e atualização incremental de catálogo; neste corte o histórico é somente da sessão em memória.

O pacote web de desenvolvimento tem aproximadamente 230 MiB, antes do dataset completo. Não extrapolar isso para tamanho final da instalação.

Nenhum push, publicação, alteração em produção ou consulta a dados de usuários foi feito nesta tarefa.
