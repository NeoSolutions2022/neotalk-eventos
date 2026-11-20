# ANA-01 — Contrato de eventos e indicadores comerciais

Revisão técnica: 20/11/2026. Contrato de transporte v1; propostas para a plataforma abaixo **não** são eventos aceitos no v1. Este documento não ativa coleta nem altera o CRM. Referências implementadas: `backend/app/analytics.py`, `app/LandingAnalytics.tsx` e `docs/ANALYTICS.md`.

## Inventário observado e fronteiras

- [Landing pública](https://neotalk.app/): entrada, navegação por seções, Como funciona, Plataforma/Plugin/App, planos Pro/Business/Enterprise, acesso gratuito, FAQ, CTA final e login no rodapé. Links de interesse ou plano não confirmam compra, cadastro nem chegada.
- [/acesso publicado](https://neotalk.app/acesso/): as cinco telas foram percorridas sem preencher contato ou enviar dados: perfil de uso → tipos de conteúdo (múltipla escolha) → volume mensal → prazo → contato. A última tela mostra nome, e-mail, WhatsApp, empresa/projeto opcional, opção de novidades e “Continuar para a plataforma”. Há ação Voltar nas etapas 2–5. A tela pós-envio e seus CTAs foram verificados **no produtor local**, não no CRM real.
- [Plataforma](https://plataforma.neotalk.app/): chegada, autenticação, tutorial e sala são marcos propostos; não estão no contrato público de coleta v1. Telas/actions a inventariar no ANA-06: login/cadastro, salas e estúdio ao vivo; vídeo, plugins, conta e qualidade separadas por disponibilidade/perfil.

## Envelope e deduplicação

POST `/api/v1/analytics/events`; envelope `schema: 1`, `release: access-analytics-v1 | landing-analytics-v1`, UUIDv4 `visitor/session`, `consent` com cinco flags booleanas (funnel, engagement, heatmap, errors, attribution), `device: mobile|tablet|desktop`, `language: pt|other`, `campaign` e 1–20 `events` (até 20 KB por requisição). Evento: UUIDv4 `id`, epoch em ms `at`, `name`, `step`, `device`, `props`. O servidor grava `received_at`; janela de relógio do cliente: ±7 dias. Releitura de lote deve manter o mesmo ID para cada evento. PK global deduplica a retentativa; repetição legítima usa novo ID. `release` determina a origem e seus nomes/etapas permitidos. IDs no v1 não atravessam domínios como identidade. Campos extras não são aceitos.

Dimensões: origem/release, etapa/seção, classe de dispositivo, idioma, data de recepção e campanha. Campanha v1 permite apenas as chaves utm_source/medium/campaign/content, com formato validado; produtores devem emitir códigos de campanha aprovados. QR é código de campanha, não pessoa. País/UF/cidade, SO/navegador, referrer, utm_term e campaign_id não são coletados no v1. Células de mapa de calor e cortes de segmento/campanha/opções exigem pelo menos três sessões no relatório existente; não generalizar esse limiar a todos os totais.

## Matriz de eventos

Retenção padrão da base de eventos abaixo: **90 dias**, com expurgo; não é retenção do CRM. Cada produtor só pode enviar o grupo habilitado e autorizado no consentimento. Propriedade ausente na tabela significa objeto vazio.

| Produtor e grupo | Eventos | Propriedades permitidas | Finalidade / indicador |
|---|---|---|---|
| Landing · funil | landing_view, section_view | — | Sessões observadas e alcance da seção |
| Landing · funil | cta_click | cta e target enumerados no backend | Cliques e sessões com clique por CTA, sem inferir destino alcançado |
| Landing · funil | faq_open, pricing_change | faq_1…faq_8; ou plan, billing, hours enumerados | Interesse em assunto/plano, não compra |
| Quiz · funil | form_view, form_start, form_step_view, form_step_complete | option indexado por etapa ou options[] em tipos_de_conteudo para conclusão | Entrada, início, alcance e conclusão por etapa; última escolha observada |
| Quiz · funil | form_back, form_submit_attempt, instagram_cta_click, platform_cta_click, redirect_initiated | action enumerada, quando presente | Volta, tentativa, clique por destino e início do redirecionamento |
| Quiz · funil | lead_submit_accepted, success_view | — | Webhook aceitou o envio; tela de sucesso foi exibida; nenhum prova transação no CRM |
| Landing/quiz · engajamento | active_time, scroll_depth | active_ms 0…60000; depth 0…100 | Soma de incrementos e profundidade; tempo ativo não é duração da transmissão |
| Landing/quiz · mapa de calor | heat_click | x e y 0…19 | Frequência por célula, seção/etapa, release e dispositivo. Sem etapa contato |
| Landing · erros | landing_error | code: runtime, resource, promise | Ocorrências técnicas categorizadas |
| Quiz · erros | form_validation_error, form_submit_failed | code: nome, email, whatsapp, network, save_failed, unknown | Falha por categoria; não contém o valor digitado |

Attribution é uma dimensão protegida pela preferência, não um nome de evento. Não enviar nome, e-mail, telefone, empresa, texto digitado, URL completa, IP bruto, áudio, transcrição, senha, cookie, ticket, GPS ou dados/atributos sensíveis — inclusive em códigos de campanha ou diagnóstico. Qualificação analítica usa categorias voluntárias, não textos da ficha. Recusa, bloqueio ou perda de rede não significam abandono. Não inferir identidade por telefone ou navegador.

## KPIs e regras

Unidade do quiz: par (origem, session). Visitante estimado: UUID de navegador observado; sessão: UUID de janela de jornada; lead: cadastro confirmado pelo CRM, não dedutível pela sessão; conta: registro confirmado na plataforma; organização: unidade comercial própria, não dedutível no v1. Não somar visitantes únicos de landing e quiz para obter pessoas únicas.

- Início do quiz (definição): sessões com form_view e form_start / sessões com form_view na mesma coorte. Conversão de etapa: sessões que **viram e concluíram** a etapa / sessões que a viram. O relatório usa `step_conversion` para essa interseção no período de recepção selecionado. As séries originais `views` e `completed` continuam como contagens marginais para compatibilidade. Denominador zero → indisponível.
- Envio aceito: sessões com lead_submit_accepted entre as que tentaram / sessões com tentativa; o relatório usa `submit_conversion` e mantém volume de eventos separado do volume de sessões. Exemplo: dois cliques de envio, uma aceitação e uma retentativa HTTP com mesmo ID = duas tentativas, uma sessão com aceite, **zero confirmação de lead persistido** sem evento do CRM.
- CTAs são independentes. Exemplo: A clicou Instagram e Plataforma; dois destinos, uma jornada observada, nenhuma chegada confirmada. B clicou mas fechou a aba: não virar conta criada. C já tinha conta e autenticou: autenticação válida, não conta nova.
- Abandono observado: última recepção de evento de funil elegível, sem aceite; até 30 min em andamento, de 30 min a menos de 24 h provisório, a partir de 24 h consolidado. Volta/aceitação dentro da sessão pode reclassificar o relatório. Última etapa é a última vista, não prova intenção. O SQL atual considera a janela de recepção consultada; jornadas anteriores podem não aparecer.
- Atribuição v1: descritiva por campanha da origem, sem unir navegadores/contas. Proposta futura: primeiro e último toque elegível nos 30 dias que antecedem a conversão, apenas com união permitida e determinística; sem vínculo → não correlacionado. Não usar IP para atribuir.
- Ativação futura: primeira sinalização com frame nativo confirmado em sala real por conta autorizada; não usar sala iniciada, texto transcrito, pose pronta nem modo apresentação. Taxa = contas de uma coorte que ativam na janela de 7 dias / contas elegíveis dessa coorte com janela madura. Tempo até ativação = primeiro frame confirmado − criação da conta, p50/p95 e quantidade de amostras.
- Retenção futura: entre contas ativadas com janela madura, proporção com nova atividade de valor no dia civil D1, D7 ou D30 após a primeira ativação, por America/Fortaleza; usar um marco confirmado por sala, não autoestações ou recargas. Datas exibidas em Fortaleza; persistência UTC. Sem dados observáveis → indisponível, não zero.

## Passagem para implementação e QA

Propostas para ANA-05/06, em versão própria: `platform_arrival` (entrada confirmada), `account_created` e `auth_succeeded` (servidor: gravação e sessão efetivas, independentes), `onboarding_completed` (fim confirmado), `room_started` (backend), `first_native_frame_confirmed` (widget/servidor, idempotente por sala real). Sem ativar até definir consentimento/base, retenção e isolamento entre ambientes. Backend é dono de timestamps server-side, dedup e validação; frontend, de enums e disparo único no marco; QA, de reconciliação por jornada; Produto, de interpretação e denominadores.

Revisão técnica: reconcilie enums/propriedades com o backend, propriedades sem PII com o tracker e fórmulas com o SQL. Casos mínimos: dois CTAs na mesma sessão; recusa não gera sessão elegível; retransmissão com o mesmo UUID não soma; volta altera a última escolha; aceite sem CRM não vira lead real; coorte incompleta não recebe percentual. Revisão de Produto/implementação/QA deve ser registrada no ANA-01; não equivale a homologação de coleta em produção.
