# NeoTalk Eventos

Protótipo visual navegável para gerenciamento de traduções em Libras.

## Beta pública

A especificação funcional e de segurança para transformar o protótipo em uma beta pública está em [docs/BETA_PUBLICA.md](docs/BETA_PUBLICA.md). Ela define autenticação, papéis `user` e `admin`, isolamento das salas, funcionalidades bloqueadas, migração do banco e critérios de aceite para publicação.

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

O widget do avatar está conectado por `iframe` e `postMessage`. A sala prefere o reconhecimento de voz nativo em português (`pt-BR`); quando ele não existe ou o serviço é bloqueado — cenário comum no Brave — o navegador grava pequenos trechos e o backend os transcreve sem expor a chave da API. Cada lote fecha após uma pausa curta ou 12 palavras, pede ao agente glosas compatíveis com o dataset e segue para o avatar. O loop reaproveita a pose já carregada no próprio widget, sem criar outra tarefa na API. Salas abandonadas são encerradas automaticamente pelo heartbeat e pelo processo de expiração do backend.

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

As integrações do backend usam `NEOTALK_API_KEY`, `NEOTALK_API_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` e `OPENAI_TRANSCRIBE_MODEL`. Nenhuma dessas chaves é enviada ao navegador ou versionada. As rotas de vídeo também podem ser trocadas por ambiente com `NEOTALK_VIDEO_SUBMIT_PATH` e `NEOTALK_VIDEO_STATUS_PATH`.

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

No EasyPanel, o navegador usa `/api/v1` no próprio domínio da plataforma. O serviço web encaminha essas chamadas para `http://api:8000/api/v1` pela rede interna do Compose, evitando conflito de CORS e garantindo que o cookie de sessão pertença a `plataforma.neotalk.app`.

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

Defina `APP_PUBLIC_ORIGIN=https://plataforma.neotalk.app` e, para aceitar a entrada automática do formulário, `LEAD_FORM_ORIGIN=https://neotalk.app`. Não configure uma lista separada em `NEXT_PUBLIC_API_URL`: o Compose fixa o cliente em `/api/v1` e mantém a API interna fora do navegador.
