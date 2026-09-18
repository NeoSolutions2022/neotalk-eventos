# Especificação da beta pública — NeoTalk Eventos

Status: núcleo da Fase 1–3 implementado; pendências de publicação listadas abaixo.  
Objetivo: disponibilizar uma beta pública gratuita com autenticação, separação segura de dados e acesso administrativo.

## Estado da implementação

Já implementado: cadastro e login com Argon2id, sessão opaca em cookie HttpOnly, CSRF, logout, papéis `user`/`admin`, isolamento das salas, uma sala ativa por usuário, proteção das rotas administrativas, menu por papel, previews bloqueados e tutorial persistido.

Antes de divulgação pública ampla ainda são recomendados: verificação de e-mail, recuperação de senha, MFA do administrador, rate limit compartilhado entre réplicas, auditoria e backup validado. O limitador atual de login/cadastro é local ao processo e serve como primeira contenção, não como proteção distribuída.

## 1. Escopo da beta

A beta permitirá que qualquer pessoa crie uma conta gratuita, entre na plataforma e utilize uma sala de tradução ao vivo. Cada usuário verá somente suas próprias salas e seus próprios lotes de tradução.

O administrador terá acesso às funções de operação e qualidade. Funcionalidades futuras continuarão visíveis como prévias bloqueadas, sem endpoints funcionais expostos ao usuário comum.

### Decisão sobre o limite de salas

Nesta especificação, “só pode criar uma sala ao vivo” significa **uma sala ativa por usuário por vez**. Depois de encerrar a sala, o usuário poderá criar outra e consultar seu próprio histórico. Essa regra evita sessões simultâneas e preserva a utilidade da beta.

Se o objetivo comercial for permitir apenas uma sala durante toda a vida da conta, essa regra deverá ser alterada antes da implementação.

## 2. Perfis e permissões

Existem dois papéis:

- `user`: usuário comum da beta;
- `admin`: operador da NeoTalk.

| Recurso | Visitante | Usuário | Admin |
|---|---:|---:|---:|
| Criar conta e entrar | Sim | — | Sim |
| Sala ao vivo | Não | Sim | Sim |
| Criar sala | Não | Uma ativa por vez | Sem limite operacional |
| Listar/ver salas | Não | Somente próprias | Todas |
| Ver lotes/transcrições | Não | Somente das próprias salas | Todos |
| Tradução de vídeos | Prévia pública opcional | Prévia bloqueada | Prévia bloqueada |
| Plugins | Prévia pública opcional | Prévia bloqueada | Prévia bloqueada |
| Laboratório de qualidade | Não | Não | Sim |
| Dataset e prompts | Não | Não | Sim |
| Pagamento | Não | Não | Sim |

Ocultar um item no menu não substitui autorização. Toda permissão deverá ser validada novamente no backend.

## 3. Experiência e rotas

### Rotas públicas

- `/login`: autenticação;
- `/cadastro`: criação de conta;
- `/verificar-email`: confirmação de e-mail;
- `/esqueci-senha` e `/redefinir-senha`: recuperação de acesso;
- páginas institucionais, termos e privacidade quando adicionadas.

### Rotas do usuário autenticado

- `/salas`: lista exclusivamente as salas do usuário;
- `/salas/ao-vivo`: cria ou retoma a única sala ativa;
- `/salas/{id}`: detalhes de uma sala própria;
- `/videos`: prévia bloqueada com descrição e selo “Em breve”;
- `/plugins`: prévia bloqueada com descrição e selo “Em breve”;
- `/conta`: perfil, troca de senha e encerramento de sessões.

O acesso a `/dashboard`, `/uso` e `/pagamento` pelo usuário comum deverá redirecionar para `/salas` ou responder `403`, conforme a rota. A navegação comum será reduzida a Salas ao vivo, Tradução de vídeos, Plugins e Conta.

### Tutorial de primeiro acesso

Depois do primeiro login com e-mail verificado, o usuário comum verá um tutorial curto dentro da plataforma. O objetivo é levá-lo até uma primeira tradução bem-sucedida, sem transformar o onboarding em um bloqueio.

O tutorial terá cinco etapas:

1. **Boas-vindas:** explicar em uma frase que a NeoTalk captura a fala, cria legendas e envia a tradução em Libras para o avatar.
2. **Preparar a sala:** solicitar um nome para a primeira sala e permitir escolher o avatar disponível.
3. **Testar o microfone:** explicar por que a permissão é necessária. O navegador só deve solicitar acesso depois de o usuário clicar em “Testar microfone”, nunca automaticamente ao abrir a página.
4. **Conhecer a transmissão:** destacar legenda, mute, loop das últimas frases, tela cheia e zoom. Cada destaque deve usar texto curto e apontar para o controle real.
5. **Fazer a primeira tradução:** orientar o usuário a dizer uma frase de exemplo e concluir somente quando uma legenda for reconhecida e pelo menos um lote for enviado ao avatar.

Ao concluir, mostrar uma confirmação simples: “Tudo pronto. Sua sala está preparada para traduzir ao vivo.”

#### Comportamento do tutorial

- Exibir automaticamente apenas para `user` que ainda não concluiu a versão atual do onboarding.
- Permitir **Pular por agora** desde a primeira etapa.
- Permitir avançar, voltar e fechar sem perder o estado já alcançado.
- Disponibilizar **Refazer tutorial** na página `/conta` e em um item de ajuda na sala.
- Não iniciar uma sala, ativar o microfone ou transmitir áudio sem uma ação explícita do usuário.
- Se a permissão do microfone for negada, explicar como tentar novamente sem impedir que o restante da plataforma seja visualizado.
- Não exibir o tutorial administrativo para o papel `admin`; o admin poderá abri-lo manualmente para testar a experiência comum.
- Funcionar em desktop e celular, com navegação por teclado, foco visível, leitura por tecnologia assistiva e botão para fechar identificado por texto acessível.
- Nunca incluir chaves, detalhes técnicos da API ou mensagens internas de erro.

#### Estado e persistência

O progresso deve ser salvo no backend para acompanhar o usuário em outros dispositivos. Campos sugeridos em `users`:

- `onboarding_version INTEGER NOT NULL DEFAULT 0`;
- `onboarding_completed_at TIMESTAMPTZ NULL`.

A versão inicial será `1`. Quando o fluxo mudar de forma relevante, incrementar a versão permite apresentar somente as novidades ou repetir o tutorial completo, conforme decisão de produto.

Endpoints sugeridos:

- `GET /api/v1/onboarding`: retorna versão atual, conclusão e última etapa;
- `PATCH /api/v1/onboarding`: salva etapa, estado `skipped` ou conclusão;
- `POST /api/v1/onboarding/restart`: reinicia o tutorial para o próprio usuário.

Esses endpoints aceitam somente o usuário da sessão; nenhum `user_id` será recebido do navegador.

#### Eventos de produto

Registrar eventos sem conteúdo de áudio ou transcrição:

- `onboarding_started`;
- `onboarding_step_viewed`;
- `microphone_test_succeeded` ou `microphone_test_failed`;
- `onboarding_skipped`;
- `first_translation_succeeded`;
- `onboarding_completed`.

Esses eventos permitirão identificar em qual etapa os usuários encontram dificuldade, sem armazenar o que foi falado.

### Rotas administrativas

- `/qualidade`: comparação entre vídeo e avatar;
- `/pagamento`: configuração e acompanhamento administrativo;
- `/admin/usuarios`: prevista para gestão básica da beta;
- todas as rotas comuns.

Ao acessar uma rota sem permissão:

- usuário não autenticado: `401` na API e redirecionamento para `/login` no frontend;
- usuário autenticado sem papel adequado: `403` na API e tela de acesso negado no frontend;
- tentativa de acessar a sala de outro usuário: preferencialmente `404`, evitando confirmar que o recurso existe.

## 4. Autenticação proposta

Para esta arquitetura, a opção recomendada é autenticação própria no FastAPI com sessões opacas armazenadas no PostgreSQL.

### Cadastro

1. Usuário informa nome, e-mail e senha.
2. E-mail é normalizado e deve ser único.
3. Senha é armazenada somente como hash Argon2id com salt individual.
4. Uma mensagem de verificação é enviada.
5. A sala ao vivo só é liberada depois da confirmação do e-mail.

Não manter valores demonstrativos preenchidos nos campos de autenticação da versão pública.

### Login e sessão

- Resposta de login cria uma sessão aleatória e revogável no banco.
- O identificador é enviado em cookie `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`.
- O token de sessão não deve ser armazenado em `localStorage` ou `sessionStorage`.
- O frontend deve usar `credentials: "include"` ao chamar a API.
- Sessão inativa: expiração sugerida de 24 horas.
- Sessão com “lembrar de mim”: expiração sugerida de 30 dias.
- Logout revoga a sessão no banco e remove o cookie.
- Troca de senha revoga todas as demais sessões.

### Conta administrativa

- A atribuição do papel `admin` nunca será aceita no cadastro ou em payload enviado pelo navegador.
- O primeiro admin será criado por comando interno ou migração controlada.
- Senha do admin será exclusiva e forte.
- MFA deve ser obrigatório para administradores antes da abertura pública.
- Ações administrativas relevantes serão registradas em auditoria.

O arquivo atual `app/chatgpt-auth.ts` não constitui autenticação para esta implantação: ele depende de cabeçalhos de uma infraestrutura diferente e não protege as rotas FastAPI. Deve ser removido do fluxo público ou mantido apenas para ambientes que forneçam esses cabeçalhos de forma confiável.

## 5. Modelo de dados

### `users`

| Coluna | Tipo/observação |
|---|---|
| `id` | UUID, chave primária |
| `name` | Nome exibido |
| `email` | `CITEXT` ou índice único sobre e-mail normalizado |
| `password_hash` | Hash Argon2id |
| `role` | `user` ou `admin`, padrão `user` |
| `status` | `pending`, `active`, `blocked` |
| `email_verified_at` | Data opcional |
| `onboarding_version` | Versão concluída, inicialmente `0` |
| `onboarding_completed_at` | Data opcional de conclusão |
| `created_at`, `updated_at` | Auditoria básica |

### `user_sessions`

| Coluna | Tipo/observação |
|---|---|
| `id` | UUID |
| `user_id` | FK para `users` |
| `token_hash` | Hash do token; nunca armazenar o token puro |
| `expires_at` | Expiração obrigatória |
| `revoked_at` | Revogação opcional |
| `created_at`, `last_seen_at` | Controle da sessão |

### Tokens temporários

Tabelas ou registros separados para verificação de e-mail e redefinição de senha, contendo somente o hash do token, finalidade, expiração e data de consumo. O token deve ser de uso único.

### Salas existentes

Adicionar `rooms.user_id UUID NOT NULL REFERENCES users(id)`. A migração deverá:

1. criar o usuário administrador;
2. adicionar `user_id` inicialmente opcional;
3. atribuir todas as salas históricas ao administrador;
4. criar índice por `(user_id, created_at DESC)`;
5. tornar `user_id` obrigatório.

Os lotes herdam a propriedade por `translation_batches.room_id`. Toda consulta deve atravessar a sala e confirmar o proprietário.

### Auditoria

Criar `audit_events` para registrar, no mínimo:

- login administrativo e falhas relevantes;
- alteração ou ativação de prompt;
- sincronização do dataset;
- acesso administrativo a salas de usuários;
- bloqueio/desbloqueio de contas.

Não registrar senhas, cookies, tokens, chaves de API, áudio bruto ou conteúdo sensível desnecessário.

## 6. API proposta

### Autenticação

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`

Mensagens de login e recuperação não devem revelar se determinado e-mail existe.

### Salas

- `POST /api/v1/rooms`: exige sessão; força `user_id` a partir da sessão e rejeita uma segunda sala ativa para `user` com `409`;
- `GET /api/v1/rooms`: filtra por `user_id`; admin pode usar uma rota administrativa explícita para visão global;
- `GET /api/v1/rooms/{id}`: exige propriedade ou papel admin;
- `POST /api/v1/rooms/{id}/start`: exige propriedade e aplica limite de concorrência;
- `POST /api/v1/rooms/{id}/finish`: exige propriedade;
- `POST /api/v1/rooms/{id}/heartbeat`: renova a atividade durante a transmissão;
- `POST /api/v1/rooms/{id}/batches`: exige propriedade;
- `PATCH /api/v1/batches/{id}`: exige propriedade por meio da sala.

Uma sala `live` sem heartbeat por dois minutos e uma sala `ready` abandonada por quinze minutos são finalizadas automaticamente. O processo roda em segundo plano e também antes das operações de criação e listagem, evitando salas-fantasma após fechamento de aba, queda de rede ou travamento do navegador.

### Compatibilidade do microfone

O cliente prefere a API nativa de reconhecimento de fala. Se ela não estiver disponível ou retornar indisponibilidade de serviço/rede, a sala alterna automaticamente para captura com `MediaRecorder` e envia trechos curtos autenticados para `POST /api/v1/agent/transcribe`. Áudio bruto não é persistido, detalhes técnicos ficam restritos ao modo administrativo e uma falha isolada não encerra a transmissão.

O endpoint `/api/v1/agent/translate` também deverá exigir sessão e validar que `batch_id`, quando informado, pertence ao usuário atual.

### Administração

Todos os caminhos abaixo exigem `role=admin` no backend:

- `/api/v1/admin/integrations`
- `/api/v1/admin/prompts*`
- `/api/v1/admin/dataset*`
- `/api/v1/admin/pose-words*`
- `/api/v1/admin/quality-runs*`
- futuras rotas de pagamento e usuários.

## 7. Controles de segurança obrigatórios

- HTTPS obrigatório no frontend, API e widget.
- CORS restrito aos domínios exatos da plataforma; sem `*` com credenciais.
- Proteção CSRF nas operações que alteram estado, além de validação de `Origin`/`Referer`.
- Cookies seguros e sessão rotacionada após login ou elevação de privilégio.
- Rate limit por IP e por usuário em cadastro, login, recuperação, criação de sala e tradução.
- Atraso progressivo ou bloqueio temporário após tentativas de login repetidas.
- Limite de tamanho já validado no backend para todos os payloads.
- Cabeçalhos de segurança: CSP compatível com o iframe oficial, HSTS, `X-Content-Type-Options`, `Referrer-Policy` e política explícita de `frame-ancestors`.
- Chaves OpenAI e NeoTalk somente no backend/EasyPanel; nunca em variáveis `NEXT_PUBLIC_*`.
- Logs estruturados com `request_id`, `user_id` quando aplicável e remoção de segredos.
- Backups automáticos do PostgreSQL e teste periódico de restauração.
- Dependências verificadas antes de cada publicação.

Como a beta é gratuita, autenticação sozinha não impede abuso das APIs pagas. Além de uma sala ativa por usuário, implementar limites configuráveis, por exemplo:

- minutos diários por usuário;
- lotes por minuto;
- tamanho máximo do trecho;
- concorrência global de traduções;
- bloqueio operacional de uma conta abusiva.

Os valores devem ser definidos por ambiente, sem ficarem fixos no código.

## 8. Pagamentos e dados demonstrativos

Na beta, a página de pagamento será administrativa e não processará cobranças reais. Os dados visuais atuais deverão ser claramente substituídos por estado de demonstração interno ou removidos da publicação.

Quando pagamentos reais forem implementados:

- números completos de cartão e código de segurança nunca serão enviados ao backend NeoTalk;
- usar campos/tokenização hospedados pelo provedor de pagamento;
- armazenar somente identificadores do provedor e metadados permitidos, como bandeira e quatro últimos dígitos;
- exigir reautenticação para operações sensíveis.

## 9. Funcionalidades bloqueadas

“Tradução de vídeos” e “Plugins” devem aparecer na navegação do usuário com:

- selo “Em breve”;
- descrição curta do benefício;
- botão desabilitado ou formulário opcional de interesse;
- ausência de chamadas reais às APIs de processamento;
- nenhuma indicação de erro ou funcionalidade incompleta.

Essas rotas ainda exigem autenticação se exibirem qualquer informação da conta.

## 10. Variáveis de ambiente novas

Nomes sugeridos:

```ini
SESSION_COOKIE_NAME=__Host-neotalk_session
SESSION_SECRET=<segredo aleatório longo>
SESSION_TTL_HOURS=24
REMEMBER_SESSION_TTL_DAYS=30
PASSWORD_PEPPER=<segredo separado do banco>
PUBLIC_APP_ORIGIN=https://app.seudominio.com
EMAIL_FROM=no-reply@seudominio.com
EMAIL_PROVIDER_API_KEY=<segredo>
ADMIN_BOOTSTRAP_EMAIL=<email inicial>
BETA_DAILY_MINUTES_PER_USER=60
BETA_BATCHES_PER_MINUTE=30
```

Não versionar valores reais. O admin deve receber uma senha temporária por um canal separado ou ser criado por comando interativo; não incluir senha padrão no Compose.

Antes da publicação, rotacionar todas as chaves que já tenham sido compartilhadas em chats, capturas de tela ou outros canais e verificar o histórico Git. Os arquivos `.env` locais atuais não estão rastreados, mas isso não elimina a necessidade de rotação de credenciais expostas fora do repositório.

## 11. Sequência de implementação

### Fase 1 — Identidade e migração

- criar tabelas de usuários, sessões e tokens;
- implementar hash Argon2id e autenticação;
- criar admin inicial de forma segura;
- adicionar `rooms.user_id` e migrar histórico;
- implementar dependências FastAPI `current_user` e `require_admin`.

### Fase 2 — Autorização e isolamento

- proteger todas as rotas;
- filtrar salas e lotes por proprietário;
- aplicar uma sala ativa por usuário;
- proteger endpoints administrativos;
- adicionar testes de acesso horizontal e vertical.

### Fase 3 — Frontend

- conectar login e cadastro reais;
- remover dados pré-preenchidos de demonstração;
- carregar usuário por `/auth/me`;
- gerar menu por papel;
- implementar o tutorial de primeiro acesso e sua persistência;
- criar previews bloqueados de vídeos e plugins;
- tratar `401`, `403`, expiração e logout.

### Fase 4 — Proteções de beta

- verificação de e-mail e recuperação de senha;
- rate limits e cotas gratuitas;
- MFA administrativo;
- auditoria, alertas, backups e cabeçalhos de segurança;
- política de privacidade, termos e consentimento para áudio/transcrição.

### Fase 5 — Homologação e publicação

- testes end-to-end com dois usuários e um admin;
- revisão de segredos e CORS;
- teste de carga do fluxo de tradução;
- teste de restauração do banco;
- publicação controlada e monitoramento de erros/custos.

## 12. Critérios de aceite

A beta só estará pronta para acesso público quando:

- cadastro, verificação, login, logout e recuperação funcionarem;
- senhas estiverem armazenadas com Argon2id;
- cookies de sessão não estiverem acessíveis por JavaScript;
- um usuário não conseguir ler ou alterar a sala de outro usuário, mesmo trocando UUIDs manualmente;
- um usuário comum receber `403` em toda rota administrativa;
- existir no máximo uma sala ativa por usuário comum;
- admin acessar Qualidade e Pagamento;
- usuário comum visualizar apenas Salas, Vídeos “Em breve”, Plugins “Em breve” e Conta;
- novo usuário receber o tutorial e conseguir pulá-lo, concluí-lo e reabri-lo;
- permissão do microfone ser solicitada somente depois de ação explícita;
- conclusão do tutorial persistir entre dispositivos e sessões;
- nenhuma chave secreta estiver no bundle do frontend ou no Git;
- limites contra abuso estiverem ativos;
- HTTPS, CORS e CSRF estiverem configurados;
- logs e backups estiverem operacionais;
- testes automatizados cobrirem autenticação, propriedade, papel e concorrência de salas.

### Testes mínimos de autorização

1. Usuário A cria a sala X.
2. Usuário B tenta listar, abrir, iniciar, finalizar e criar lote na sala X.
3. Todas as tentativas retornam `404` ou `403`, nunca dados da sala.
4. Usuário comum chama cada rota `/admin/*` e recebe `403`.
5. Usuário com sala ativa tenta criar outra e recebe `409`.
6. Depois de encerrar sua sala, o mesmo usuário consegue criar uma nova.
7. Sessão revogada ou expirada recebe `401`.
8. Novo usuário vê o onboarding; usuário que concluiu a versão atual não o vê novamente automaticamente.
9. Usuário que pulou consegue iniciar a sala normalmente e refazer o tutorial pela ajuda.
10. Nenhum áudio ou texto transcrito aparece nos eventos de telemetria do onboarding.

## 13. Fora do escopo inicial

- cobrança real e armazenamento de métodos de pagamento;
- planos pagos e saldo de horas comercial;
- tradução de vídeos funcional;
- marketplace ou instalação de plugins;
- organizações com múltiplos membros e papéis adicionais;
- login social, salvo decisão posterior;
- retenção de áudio bruto.

## Referências de segurança

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP IDOR Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
- [OWASP Authorization Regression Testing Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Regression_Testing_Cheat_Sheet.html)
