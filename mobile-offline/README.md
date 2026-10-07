# NeoTalk Offline — Android e iOS

Estado: implementação inicial em validação, não uma release instalável homologada.

## Arquitetura

- Capacitor empacota uma interface React/Vite local. Não carrega plataforma.neotalk.app.
- A sala é o próprio `app/LiveRoom.tsx`, não uma cópia visual; CSS, logo e Inter são empacotados localmente.
- O adaptador local substitui API, salas e histórico de sessão. Não usa a conta ou banco online.
- Catálogo por maior expressão correspondente, normalização de acentos e aliases explícitos. Não interpreta português como GPT e não inventa sinais faltantes.
- `.pose` são concatenadas preservando coordenadas e FPS. SHA-256 detecta corrupção; cache reutiliza sequências e é limitado.
- Whisper tiny multilíngue quantizado, via Transformers.js/ONNX WASM em worker, configurado exclusivamente para português e arquivos locais. O reconhecimento de voz do navegador fica desativado.
- CSP impede conexões a servidores externos durante o uso. Sem analytics ou telemetria.
- Histórico é limitado e apenas em memória neste primeiro corte: reiniciar o app inicia uma nova sessão. Não promete recuperar salas antigas.
- PiP, OBS e abertura de janela são recursos de desktop, não expostos como disponíveis no app mobile.

## Preparar

```sh
cd mobile-offline
npm ci
npm run prepare:assets -- --avatar-root ../../Avatar3DFrontend --widget-root ../../Avatar3DFrontend
node scripts/download-model.mjs
npm test
npm run build
npm run dev
```

O comando sem `--dataset` prepara somente cinco sinais de desenvolvimento, com aviso explícito. Não libera distribuição. As pastas padrão são conveniências desta workspace; em CI passe os caminhos reais das fontes validadas.

Para todos os sinais, fornecer um manifesto e os arquivos originais:

```json
{
  "version": "2026-10-06",
  "complete": true,
  "expectedCount": 750,
  "entries": [
    { "gloss": "ACOMPANHAR", "aliases": ["acompanho", "acompanhando"], "file": "poses/acompanhar.pose", "fps": 24 }
  ]
}
```

`expectedCount` acima é EXEMPLO, não contagem confirmada. Cada caminho é relativo ao manifesto. O FPS precisa vir do dataset original. Não usar poses de teste/debugging como catálogo de produção.

```sh
npm run prepare:assets -- --dataset /caminho/dataset/catalog.json --avatar-root /caminho/avatar --widget-root /caminho/widget
npm run verify:release
```

O modelo é baixado em uma revisão fixa por execução, registrada em `public/models/manifest.json`, com hashes. O download de preparação precisa de internet; a inferência não. Pacotes grandes ficam fora do Git. Conferir as licenças do dataset, avatar, modelo e ONNX antes de distribuir.

## Native

```sh
npx cap add android
npx cap add ios
npm run native:sync
npm run native:android
npm run native:ios
```

Android exige SDK/JDK compatíveis. iOS exige ambiente macOS/Xcode ou build remoto, assinatura Apple e TestFlight/App Store. Uma IPA solta não permite instalação pública em qualquer iPhone.

Os projetos precisam declarar permissão de microfone: `android.permission.RECORD_AUDIO` no Android e `NSMicrophoneUsageDescription` no Info.plist iOS. Não solicitar câmera, contatos ou localização.

## Gate antes da distribuição

Não liberar somente porque o build web passou. Testar em pelo menos um Android intermediário e um iPhone/iPad reais:

1. Iniciar após instalação, preparar voz; depois modo avião, fechar e abrir o app.
2. Confirmar ausência de requisições externas, incluindo tokenizer, ONNX e Unity.
3. Todas as poses do catálogo disponíveis, sem T-pose inicial ou durante troca.
4. Português real, recusa e revogação de microfone, silêncio, mutar e retomar.
5. Sessão de uma hora: RAM, aquecimento, bateria, fila, frases finais e loop.
6. Segundo plano/bloqueio: não prometer gravação contínua; tornar a pausa explícita e retomar com segurança.
7. Voice + Unity simultâneos; redução de backlog sem travar nem redefinir avatar.
8. Safe areas, paisagem/retrato, teclado e legendas legíveis.

Limitações em aberto: compatibilidade Unity WebGL/WKWebView e URLs blob em dispositivos reais; custo da voz local; interrupção de inferência ao cancelar sessão; retenção persistente de histórico e distribuição de updates de dataset. Esses itens não estão homologados.

## Publicação na plataforma

A página `/offline` existe com estado honesto de preparação. Somente configurar `NEXT_PUBLIC_OFFLINE_ANDROID_URL` e `NEXT_PUBLIC_OFFLINE_IOS_URL` depois de publicar uma release testada. Os links precisam usar HTTPS. Nenhum APK/IPA fictício é anunciado.
