# Estresse de fila — sala ao vivo

## Falha reproduzida antes da correção

Teste executando as closures reais de `LiveRoom.tsx`, com APIs e eventos simulados: segurar as respostas de tradução e inserir 2.000 transcrições produziu **2.000 lotes pendentes**. O teste falhou com `queue grew to 2000`. A concorrência de GPT já era limitada a dois, mas o total admitido não era.

## Correção

- Limite de 24 lotes pendentes (mais um eventualmente em execução), buffer textual de até 120 palavras e dois pedidos de tradução simultâneos.
- Ao atingir o limite, microfone pausado explicitamente, não sala/Unity. Os lotes admitidos continuam escoando. Não reinicializa avatar nem apaga sinais anteriores para recuperar atraso.
- Retomada manual somente com até oito lotes pendentes, até dois áudios aguardando e buffer residual pequeno.
- Ao encher os seis slots de áudio aguardando, aplicar também a pausa preventiva. Pedidos de transcrição já aceitos não são abortados por essa pausa e podem escoar.
- Lotes sem glosa removidos da fila após finalização; não se acumulam esperando outro lote válido.
- Buffer remanescente escoa quando uma tradução/sinalização libera capacidade durante a pausa.
- Limites excedidos por um resultado excepcionalmente grande ou callbacks tardios são comunicados ao apresentador; não existe promessa de armazenar fala ilimitada sem perdas.

## Testes automatizados

Passaram 62 testes da plataforma, incluindo três novos testes de pressão, e 10 testes do widget:

1. 2.000 entradas com tradução paralisada: fila <= 24, buffer <= 120, concorrência <= 2; sala permanece aberta; encerrar descarta resultados atrasados.
2. Rajada durante avatar ocupado: todos os tokens admitidos escoam em ordem; nenhum comando de troca/reinicialização de avatar; metadados são limpos; nova sala inicia desmutada.
3. 500 lotes sem glosa em ondas: não sobra fila de erros, promessas ou IDs; sala segue aberta.
4. Regressões existentes: 1.200 frases sequenciais, 7.200 trechos em buffer ordenado, retry HTTP 502, encerramento durante requisição, isolamento de sessão, mini-player com a mesma pose.

São testes determinísticos: não são uma palestra real de uma hora nem teste de capacidade da API de produção.

## Integração no navegador

Script da workspace `tmp/qa-live-browser.cjs`: React e Unity reais, fala/API simuladas, popup de mesma origem (não homologação do PiP nativo). Inclui 2.000 callbacks em rajada, atraso de 1,2 s na tradução, fila escoando e retomada de captura. Resultado final em `outputs/qa-elia-live/browser-results.json`.

Execução final passou nas 15 verificações, sem exceções de página. A primeira tentativa integrada foi interrompida por fechamento inesperado do navegador de teste, antes da etapa de pressão; não foi determinada a causa desse fechamento. A repetição completou a bateria. O build passou; lint da sala não teve erros, mas mantém três avisos de dependências de hooks.

## Limitação e compromisso de UX

Se a entrada permanecer mais rápida que a saída, não é possível garantir simultaneamente armazenamento finito, atraso limitado e nenhuma interrupção/perda. Este corte escolhe **pausa explícita de captura**, com continuidade do avatar e retomada manual. Fala ocorrida durante a pausa não entra na tradução. Isso deve ser validado com o responsável pelo produto antes de publicar.

Não atribuir genericamente HTTP 502 à sobrecarga do avatar: o teste injeta uma falha e valida recuperação, mas não identifica a causa de cada 502 real no upstream.

Não houve nova alteração no Avatar3DFrontend nesta correção: a falha reproduzida era admissão ilimitada na plataforma. Seus dez testes de regressão passaram; mudanças anteriores daquele checkout continuam locais.

Sem push ou deploy nesta tarefa.

## Refinamento para pitch: atualização após feedback

Pausar uma apresentação normal não é a estratégia desejada. Acrescentado agrupamento de fragmentos consecutivos ainda não traduzidos (até 36 palavras / 480 caracteres), preservando a ordem e sem resumir ou eliminar conteúdo. Apenas dois trechos ficam preparados antecipadamente; os demais permanecem agrupáveis. A persistência ocorre quando o texto do lote está fechado, para o histórico não registrar uma versão parcial. O limite extremo e a pausa de emergência continuam existindo; não é uma promessa de captura ilimitada.

Três ensaios de cinco minutos **virtuais**, com resultados de tradução/tempos de sinalização simulados, todos passaram sem mutar, avisar, trocar avatar ou perder tokens:

| Entrada | Palavras | Pico de lotes pendentes | Fila terminou após encerrar a fala |
| --- | ---: | ---: | ---: |
| 140 palavras/min | 702 | 3 | 17,5 s |
| 180 palavras/min | 900 | 6 | 90,1 s |
| 220 palavras/min | 1.104 | 12 | 175,7 s |

Hipóteses explícitas: fragmentos de seis palavras; API em 400 ms, a cada 17 pedidos uma demora de 2 s; 0,65 glosa por palavra de origem; 650 ms/glosa e 80 ms entre lotes. São parâmetros sintéticos deliberadamente lentos, não medições da Elia em produção. O atraso final deixa claro que **a correção evita falha, mas não garante acompanhar o falante sem atraso** quando a saída é mais lenta.

Antes do controle de lookahead, os testes de 180 e 220 palavras/min acionavam a pausa após 162,4 s e 92,1 s, respectivamente. Após o ajuste, completaram sem pausa. O conteúdo persistido foi comparado com a entrada completa, além do conteúdo sinalizado simulado.

A suíte da plataforma agora passa em 65 testes. Build passou. `tsc --noEmit` global continua bloqueado por tipos ausentes de Next/Cloudflare e erros de configuração fora desta alteração; não foi declarado limpo. O teste integrado com Unity da seção anterior foi feito antes deste último refinamento de agrupamento; estes novos cenários de pitch são determinísticos, não uma gravação de apresentação real.
