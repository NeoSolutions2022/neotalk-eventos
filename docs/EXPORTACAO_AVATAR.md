# Exportação experimental do avatar — Tradução de vídeos

Em `/videos`, digite uma frase e selecione **Gerar sinalização**. O agente
valida as glosas e o widget mostra o avatar. Depois use **Preparar vídeo**.
O widget se expande para ocupar a janela; maximize o navegador se possível.
Espere o avatar se ajustar e clique **Gravar vídeo**. Escolha a aba atual na
solicitação de compartilhamento do navegador.
A opção **Formato** altera o enquadramento do próprio widget antes da
captura: horizontal 16:9, Shorts/Reels 9:16, quadrado 1:1 ou retrato 4:5.
Confira se o corpo e as mãos permanecem visíveis na prévia ampliada. O arquivo
recebe o formato no nome, por exemplo `neotalk-elia-shorts-xxxxxxxx.webm`.
A captura é recortada para o widget e salva em WebM, sem áudio nem o restante
da página. Se o recorte não estiver disponível, a gravação é cancelada.

A página está disponível para contas comuns e administradores. O envio de um
arquivo de vídeo original ainda não foi implementado: esta etapa cria um vídeo
do avatar a partir de texto. A aba Qualidade continua dedicada à comparação,
avaliações e observações de QA.

## Qualidade

- **Leve:** taxa de vídeo solicitada de 2,5 Mbps, até 30 fps.
- **Alta (padrão):** 8 Mbps, até 30 fps, menos compressão.
- **Máxima:** 16 Mbps, até 60 fps, maior uso de processamento e arquivo maior.

A captura pede até 3840 × 2160 para evitar reduzir a aba antes de recortar.
O modo de gravação agora expande o próprio widget, cuja renderização Unity é
ajustada ao tamanho do canvas. Isso remove o principal limite de resolução do
painel dividido de QA. **Não garante 4K ou Full HD no arquivo do avatar**;
o tamanho da janela, a tela e o navegador continuam limitando os detalhes.
Formatos verticais terão menos pixels horizontais em uma tela horizontal;
usar uma janela maximizada ajuda a preservar a resolução.
O navegador pode entregar menos fps ou outra taxa de codificação. O painel
informa as dimensões/fps reportados pela faixa e a taxa reportada pelo gravador.
Essa taxa é uma configuração do encoder, não uma medição do bitrate do arquivo.
Não há ampliação artificial, alteração de velocidade dos sinais ou promessa de
60 fps reais. Aumentar apenas o bitrate não recupera detalhes ausentes no WebGL.

Requer navegador desktop com Region Capture (`CropTarget`, `cropTo`), captura
de aba e MediaRecorder. Não é uma exportação MP4 no servidor; a compatibilidade
é detectada antes da gravação. Chrome/Edge atualizados são os alvos iniciais.

A gravação começa após o widget informar reprodução. O encerramento automático
usa uma duração estimada pela frase (máximo 60 segundos); também é possível
encerrar manualmente. Este limite é experimental, não garante exatamente um
ciclo completo do sinal. Ao terminar, a comparação volta ao loop normal.

O recurso ainda precisa de homologação interativa nos navegadores suportados.
