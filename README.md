# NeoTalk Eventos

Protótipo visual navegável para gerenciamento de traduções em Libras.

## Escopo atual

- Login e criação de conta
- Painel de saldo e consumo de horas
- Histórico de instâncias de tradução
- Pacotes de horas e dados de pagamento
- Estúdio com captura simulada, legenda, avatar 3D e mini player
- Opções visuais para abrir ou compartilhar o player

As integrações de áudio, pagamento, avatar e transmissão estão representadas visualmente nesta etapa e serão conectadas em uma fase posterior.

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

Para construir e iniciar o protótipo na porta 3000:

```bash
docker compose up --build -d
```

Depois, acesse `http://localhost:3000`.

Para utilizar outra porta no computador:

```bash
APP_PORT=8080 docker compose up --build -d
```

Para acompanhar ou encerrar:

```bash
docker compose logs -f
docker compose down
```
