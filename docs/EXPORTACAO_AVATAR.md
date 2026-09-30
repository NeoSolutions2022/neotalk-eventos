# Exportação experimental do avatar — Qualidade

Depois de executar uma comparação, use **Baixar vídeo** abaixo do avatar.
Escolha a aba atual na solicitação de compartilhamento do navegador.
A captura é recortada para o widget e salva em WebM, sem áudio nem o restante
da página. Se o recorte não estiver disponível, a gravação é cancelada.

Requer navegador desktop com Region Capture (`CropTarget`, `cropTo`), captura
de aba e MediaRecorder. Não é uma exportação MP4 no servidor; a compatibilidade
é detectada antes da gravação. Chrome/Edge atualizados são os alvos iniciais.

A gravação começa após o widget informar reprodução. O encerramento automático
usa uma duração estimada pela frase (máximo 60 segundos); também é possível
encerrar manualmente. Este limite é experimental, não garante exatamente um
ciclo completo do sinal. Ao terminar, a comparação volta ao loop normal.

O recurso ainda precisa de homologação interativa nos navegadores suportados.
