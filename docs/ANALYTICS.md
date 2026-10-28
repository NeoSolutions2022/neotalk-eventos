# Analytics comercial — primeira entrega do /acesso

## Extensão da landing (28/10/2026)

O mesmo banco, endpoints, sessão admin, limites e retenção passam a aceitar a
landing. Migração aditiva: `analytics_events.source/release` e
`analytics_settings.sources`. Registros existentes continuam `source=access`.
Coleta da landing inicia desativada, independentemente do formulário.

- `GET /analytics/config?source=landing`: versão `landing-analytics-v1`, sem IDs.
- POST existente distingue a origem pela versão permitida; eventos/etapas de uma
  origem são recusados na outra. Não há URLs, texto livre, nomes ou contatos.
- Relatório admin aceita `source=access|landing`; padrão continua `access`.
- Dashboard possui seletor de origem e controles independentes de ativação.
- Landing: sessões consentidas, alcance por seção, tempo ativo, cliques de CTAs,
  FAQ, seleções de plano/período/horas, campanhas, dispositivos, erros categóricos
  e heatmap 20×20 por seção/dispositivo/versão (mínimo 3 sessões por célula).
- Preferência da landing é independente da preferência do quiz. GPC/DNT prevalecem.
- Não há união determinística das identidades entre home/formulário nem confirmação
  de chegada ou compra a partir de clique; UTMs fixas identificam a origem no quiz.
- Não há GeoIP, gravação de sessão ou novo serviço de banco/analytics.

Implantar API/admin antes do novo HTML da landing; então habilitar a origem pelo
admin, respeitando a preferência individual. Desativar apenas `sources.landing`
é rollback de coleta sem desligar o /acesso ou apagar histórico.

Regressão SQL/API: 13 testes no PostgreSQL temporário isolado. Tracker da landing:
`node --test tests/landing-analytics.test.mjs` no fonte da landing (17 testes).
Não confundir testes sintéticos com visitas reais em produção.

## Arquitetura aprovada em 28/10/2026

O formulário neotalk.app/acesso só coleta métricas autorizadas e envia à API da plataforma. A página /analytics usa PlatformApp, menu admin, sessão e CSRF já existentes. As tabelas analytics_events, analytics_settings e analytics_rate_limits ficam no **mesmo PostgreSQL/DATABASE_URL da plataforma**. Não criar outro banco, serviço, senha admin ou backend na HostGator.

Contatos, respostas e consentimento de novidades continuam no CRM atual, sem migração. Somente os eventos analíticos são centralizados. O formulário também continua pedindo o acesso automático à plataforma pelo fluxo já existente. Não inferir identidade por telefone não verificado.

## Endpoints e acesso

- GET /api/v1/analytics/config: configurações públicas, sem segredo/IDs; origem exata do formulário.
- POST /api/v1/analytics/events: JSON limitado a 20KB/20 eventos, sem autenticação; whitelist estrita, UUID idempotente, consentimento por grupo, campos pessoais/tokens rejeitados. Aceita text/plain para Beacon cross-origin sem preflight na saída, validando o mesmo JSON.
- GET /api/v1/admin/analytics/report?days=1|7|30|90: somente admin; dados agregados sem IDs/contatos.
- GET e PUT /api/v1/admin/analytics/settings: admin; PUT exige CSRF existente.

ANALYTICS_FORM_ORIGINS tem padrão https://neotalk.app e é encaminhado pelos dois compose. Usar somente origens exatas, sem wildcard. A exceção CORS pública vale apenas para config/events, sem permitir credenciais; o proxy encaminha seus cabeçalhos de preflight. Os endpoints admin de analytics recusam a origem do formulário mesmo se o CORS legado permitir o handoff de autenticação. Não ampliar o CORS global para esta funcionalidade.

## Inicialização e operação

A inicialização executa a migração aditiva e idempotente depois do schema atual. A coleta começa **desativada** em analytics_settings. O admin pode habilitar cada grupo após revisão do aviso/finalidade e smoke. Configuração e dados não dependem de localStorage do admin; são persistidos no PostgreSQL. O segredo de rate limit é gerado pelo próprio banco e nunca retornado ao browser.

Analytics usa o pool existente, limitado a 2 ingestões concorrentes por processo, aquisição de pool com timeout curto e prazo total de 4s por ingestão; falha opcional não pode esperar indefinidamente pelos recursos das salas ao vivo. Relatório tem prazo de consulta de 3s. Limites persistidos: 120 batches/jornada/min e 1200 batches globais/min; são tetos de proteção, não capacidade comprovada. Não agrupar todos os visitantes sob o IP compartilhado do proxy. Não armazenar IP bruto nem cabeçalhos de GeoIP não confiáveis.

Retenção padrão de 90 dias com limpeza horária em blocos de até 10.000 registros. A tarefa é cancelada no shutdown, junto com o reaper de salas. Monitorar atraso de expurgo sob grande volume; blocos limitados evitam exclusão longa competindo com tradução. Não apagar dados de CRM ou tabelas atuais para implantação/rollback.

## Indicadores e limites

Funil das cinco etapas, retorno, falhas/validação, tentativa e resposta aceita de envio, tempo ativo/rolagem, cliques nos CTAs, campanha por códigos permitidos, dispositivo e idioma. Mapa de calor 20×20 normalizado por etapa/viewport, sem contato/digitação/replay; amostra mínima de 3 sessões por célula, segmento, campanha e qualificação.

Visitantes são navegadores estimados, não pessoas únicas. Denominador da conclusão só inclui funil autorizado. Qualificação considera a última etapa concluída por jornada, corrigindo respostas ao voltar. Abandono sem envio aceito é provisório depois de 30min e consolidado depois de 24h; retomadas corrigem estimativa dentro da janela observada. Tempo ativo exige visibilidade/foco, com teto de 30s sem interação.

lead_submit_accepted é resposta HTTP aceita pelo webhook, não confirmação transacional do CRM. Clique/redirecionamento não confirma chegada ou criação de conta. Localidade desconhecida nesta fase, sem GPS/consulta externa. Não há ainda correlação determinística com conta, métricas das telas da plataforma ou e-mail semanal. Analytics de browser pode ser forjado/perdido/bloqueado: não é fonte contábil nem prova de identidade ou atenção.

## Privacidade

Coleta só após preferência granular, com recusa equivalente e sem bloquear cadastro. Respeitar GPC/DNT. Sem nome, e-mail, telefone, empresa, áudio, transcrição, senha, cookie ou ticket no stream. Preferências de analytics são separadas do checkbox de novidades existente. Retirada para futuras coletas não apaga retroativamente dados; implementar procedimento operacional de exclusão autorizado. Revisar finalidade/aviso com responsável de privacidade antes de ativar. Sem fingerprinting, pixels de anúncios ou gravação de sessão.

## Validação e publicação

- Testes do tracker no repo NeoFlowIA/neotalk: npm run test:analytics (18 testes).
- PostgreSQL real isolado: POSTGRES_BIN/PYTHON_BIN configurados, node tests/analytics-postgres.cjs (9 testes de API/SQL, incluindo RBAC/CSRF/CORS, UUID/dedup, validação, abandono/retomada, retenção, flags e relatórios).
- Fluxo completo: definir ANALYTICS_FORM_ROOT e PLAYWRIGHT_MODULE, node tests/analytics-postgres.cjs --browser. Cria cluster com senha aleatória em porta própria, API real, plataforma local e formulário estático; CRM/handoff são simulados. Não altera banco/contatos de produção. O harness encerra apenas seus processos/cluster.
- npx tsc --noEmit -p tsconfig.analytics.json valida o app. O tsc global da base já tem três erros de bindings Cloudflare nos arquivos worker/db; não foram mascarados nem corrigidos nesta tarefa.
- npm run build; testes existentes de apiClient/proxy; lint dos componentes novos. Alertas de dependências da plataforma preexistentes devem ser revisados separadamente; não certificar segurança completa nem executar atualização massiva sem regressão.

Publicar backend/plataforma antes do formulário; fazer backup do /acesso realmente hospedado antes de subir o novo dist. O backup Git/source não substitui o dist do cPanel. Confirmar admin/usuário comum, consentimento, quiz/CRM/acesso automático, dashboard e rollback na hospedagem real. A coleta pode continuar desativada enquanto isso. Este documento não autoriza merge/deploy automático em produção.
