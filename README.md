# NeoTalk Eventos

Protótipo visual navegável para gerenciamento de traduções em Libras.

## Escopo atual

- Login e criação de conta
- Painel de saldo e consumo de horas
- Histórico de instâncias de tradução
- Pacotes de horas e dados de pagamento
- Salas ao vivo com captura real do microfone, legenda contínua e o widget do Avatar3DFrontend
- Agente GPT que converte cada lote de fala em glosas validadas pelo catálogo `.pose`
- Laboratório administrativo para versionar prompts, consultar o dataset e comparar vídeo e avatar lado a lado
- Envio automático das glosas validadas para a fila da Lia
- Backend FastAPI e PostgreSQL para persistir salas, duração, transcrições e estado dos lotes
- Opções visuais para abrir ou compartilhar o player

O widget do avatar está conectado por `iframe` e `postMessage`. No Chrome e no Edge, a sala usa o reconhecimento de voz do navegador em português (`pt-BR`), fecha lotes após uma pausa curta ou 12 palavras, pede ao agente as glosas compatíveis com o dataset e as envia sequencialmente ao avatar. Pagamento e transmissão externa ainda estão representados visualmente nesta etapa.

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

Crie um `.env` a partir do exemplo e preencha as chaves somente no arquivo local:

```bash
cp .env.example .env
```

As integrações do backend usam `NEOTALK_API_KEY`, `NEOTALK_API_BASE_URL`, `OPENAI_API_KEY` e `OPENAI_MODEL`. Nenhuma dessas chaves é enviada ao navegador ou versionada. As rotas de vídeo também podem ser trocadas por ambiente com `NEOTALK_VIDEO_SUBMIT_PATH` e `NEOTALK_VIDEO_STATUS_PATH`.

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

Depois da primeira subida, sincronize o catálogo pelo botão **Sincronizar** em **Qualidade** ou pela API:

```bash
curl -X POST http://localhost:8000/api/v1/admin/dataset/sync
```

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

## EasyPanel

Para produção no EasyPanel, use `compose.easypanel.yaml`. O guia completo de configuração, domínios e primeira sincronização está em [EASYPANEL.md](EASYPANEL.md). Os valores reais devem ser cadastrados como variáveis do painel e nunca versionados.
