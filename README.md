# NeoTalk Eventos

Protótipo visual navegável para gerenciamento de traduções em Libras.

## Escopo atual

- Login e criação de conta
- Painel de saldo e consumo de horas
- Histórico de instâncias de tradução
- Pacotes de horas e dados de pagamento
- Estúdio com captura simulada, legenda e o widget real do Avatar3DFrontend
- Opções visuais para abrir ou compartilhar o player

O widget do avatar já está conectado por `iframe` e `postMessage`. As integrações de captura real de áudio, pagamento e transmissão ainda estão representadas visualmente nesta etapa.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Docker

Primeiro, inicie o serviço do avatar no repositório `Avatar3DFrontend`. O endereço da aplicação precisa estar autorizado como origem do widget:

```powershell
cd C:\Users\felip\Avatar3DFrontend
$env:AVATAR3D_WIDGET_ORIGINS='http://localhost:3000'
docker compose up --build -d
```

O serviço do avatar ficará disponível em `http://localhost:8080`. A tradução de frases requer que `NEOTALK_API_KEY` esteja configurada nesse serviço; essa chave nunca deve ser exposta no frontend.

Para construir e iniciar o protótipo na porta 3000:

```bash
docker compose up --build -d
```

Depois, acesse `http://localhost:3000`.

Por padrão, o frontend usa `http://localhost:8080/widget`. Para apontar para outra implantação do avatar, defina `NEXT_PUBLIC_AVATAR_WIDGET_URL` durante o build.

Para utilizar outra porta no computador:

```bash
APP_PORT=8080 docker compose up --build -d
```

Para acompanhar ou encerrar:

```bash
docker compose logs -f
docker compose down
```
