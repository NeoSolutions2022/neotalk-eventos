# Acesso rápido da beta

No ambiente do Easypanel, configure e implante novamente:

```env
PUBLIC_ACCESS_MODE=quick
```

O backend lê a configuração em tempo de execução. Os dois arquivos Compose
repassam a variável; não há chave de API nem segredo novo. O valor padrão é
`password`. Para voltar ao cadastro/login com senha:

```env
PUBLIC_ACCESS_MODE=password
```

## Comportamento e limites de segurança

- Login/cadastro público oferece nome e WhatsApp, sem envio de mensagem nem
  verificação. Números brasileiros sem código de país recebem `+55`.
- É um cadastro gratuito, **não autenticação por telefone**. Uma sessão válida
  permanece no navegador pelo prazo configurado. Sem ela, outro cadastro cria
  outra identidade, mesmo que o telefone coincida. Não recupera salas alheias.
- A sessão usa o mesmo cookie HttpOnly, CSRF e permissões da plataforma.
  O usuário continua vendo somente suas salas e só pode manter uma ativa.
- Admin sempre entra com e-mail e senha em `/login?senha=1`.
- `/conta` permite associar e-mail e senha para recuperar a mesma conta depois.
  Um e-mail já existente não pode ser tomado por esse fluxo.
- Ao desativar o modo rápido, novas entradas rápidas são recusadas pelo backend;
  sessões existentes não são revogadas. Usuários sem senha devem defini-la no
  perfil antes de sair/perder a sessão.
- Há limite de tentativas por IP no processo da API, não distribuído. O modo é
  temporário para beta: não substitui verificação de identidade ou controle de
  abuso distribuído e não serve para acesso a informações sensíveis.

## Formulário neotalk.app/acesso

O handoff existente `/acesso?code=...` e seus tickets de uso único continuam
funcionando nos dois modos, sem mudanças nos endpoints de lead.

O formulário antigo está usando `/cadastro?nome=...&origem=acesso`.
No modo `quick`, a plataforma aceita esse link como uma **nova sessão gratuita**
e redireciona para `/salas`. Não identifica uma conta existente. O link só contém
nome, portanto o WhatsApp não é importado nem inventado. Uma sessão já válida é
preservada. No modo `password`, volta ao cadastro com nome pré-preenchido.

Para leads que precisam manter e-mail/dados do formulário, prefira o handoff por
ticket. Não coloque senhas, tokens permanentes ou telefone na query string.

## Migração

Na inicialização da API, migração idempotente permite e-mail nulo e acrescenta
`whatsapp_phone` e `registration_source` em `users`. Contas/salas existentes são
preservadas. Telefone não é chave única porque não foi verificado.
