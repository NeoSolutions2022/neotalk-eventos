window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const payload = event.data;
  if (!payload || payload.type !== "neotalk:external-player-command") return;
  if (!payload.message || typeof payload.message !== "object") return;
  const frame = document.querySelector("iframe.avatar-widget-frame");
  if (!frame?.contentWindow || typeof payload.widgetOrigin !== "string") return;
  frame.contentWindow.postMessage(payload.message, payload.widgetOrigin);
});
