# Deploy no EasyPanel

O arquivo `compose.easypanel.yaml` sobe três serviços: `app`, `api` e `postgres`.
As duas imagens da aplicação são construídas diretamente a partir deste repositório.

## 1. Criar o projeto

1. No EasyPanel, crie um projeto chamado `neotalk-eventos`.
2. Adicione um serviço do tipo **Docker Compose** com origem GitHub.
3. Use o repositório `https://github.com/NeoSolutions2022/neotalk-eventos` e a branch `main`.
4. Informe `compose.easypanel.yaml` como caminho do Compose.

## 2. Variáveis

Copie as variáveis de `easypanel.env.example` para **Environment** e troque os três valores secretos. Um arquivo local chamado `.env.easypanel.local`, ignorado pelo Git, pode ser usado como fonte segura para copiar os valores.

As URLs públicas são usadas durante o build do frontend. Se qualquer domínio mudar, atualize `APP_PUBLIC_ORIGIN` e `API_PUBLIC_ORIGIN` e faça um novo deploy completo.

## 3. Domínios

Na aba **Domains**, publique:

- serviço `app`, porta `3000`: `neotalk-eventos.k3p3ex.easypanel.host`;
- serviço `api`, porta `8000`: `neotalk-eventos-api.k3p3ex.easypanel.host`.

Não publique o serviço `postgres` na internet.

## 4. Primeira inicialização

Após os serviços ficarem saudáveis, sincronize o dataset uma vez:

```bash
curl -X POST https://neotalk-eventos-api.k3p3ex.easypanel.host/api/v1/admin/dataset/sync
```

Também é possível abrir **Qualidade** e usar o botão **Sincronizar**.

## 5. Verificação

- Aplicação: `https://neotalk-eventos.k3p3ex.easypanel.host`
- API: `https://neotalk-eventos-api.k3p3ex.easypanel.host/api/v1/health`
- Documentação: `https://neotalk-eventos-api.k3p3ex.easypanel.host/docs`

Observação: no host NeoTalk informado, as rotas atuais de catálogo e `.pose` estão disponíveis, mas as rotas documentadas de vídeo `/sign-process-type` e `/task-status-type` retornaram `404` na última validação. Elas permanecem configuráveis por variáveis.
