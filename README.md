# NeoTalk Eventos

Protótipo visual navegável para gerenciamento de traduções em Libras.

## Escopo atual

- Login e criação de conta
- Painel de saldo e consumo de horas
- Histórico de instâncias de tradução
- Pacotes de horas e dados de pagamento
- Salas ao vivo com captura real do microfone, legenda contínua e o widget do Avatar3DFrontend
- Envio automático da fala em lotes de até 12 palavras para a fila da Lia
- Backend FastAPI e PostgreSQL para persistir salas, duração, transcrições e estado dos lotes
- Opções visuais para abrir ou compartilhar o player

O widget do avatar está conectado por `iframe` e `postMessage`. No Chrome e no Edge, a sala usa o reconhecimento de voz do navegador em português (`pt-BR`), fecha lotes após uma pausa curta ou 12 palavras e os envia sequencialmente ao avatar. Pagamento e transmissão externa ainda estão representados visualmente nesta etapa.

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

Esse comando inicia três serviços:

- aplicação em `http://localhost:3000`;
- API FastAPI em `http://localhost:8000` (documentação em `/docs`);
- PostgreSQL interno com volume persistente.

Depois, acesse `http://localhost:3000`.

Por padrão, o frontend usa o widget oficial em `https://infra-avatar3d-oficial.k3p3ex.easypanel.host/widget`. Para apontar para outra implantação do avatar, defina `NEXT_PUBLIC_AVATAR_WIDGET_URL` durante o build.

O frontend usa `http://localhost:8000/api/v1` para o histórico das salas. A URL pode ser alterada com `NEXT_PUBLIC_API_URL` durante o build.

Para utilizar outra porta no computador:

```bash
APP_PORT=8080 docker compose up --build -d
```

Para acompanhar ou encerrar:

```bash
docker compose logs -f
docker compose down
```
