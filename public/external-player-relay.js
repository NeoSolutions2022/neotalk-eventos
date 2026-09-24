// PiP uses about:blank: location.origin is "null", but window.origin inherits
// the opener's security origin. Execute the final postMessage in this realm
// so the cross-origin widget sees its actual parent as event.source.
(() => {
  const controllerOrigin = new URL(document.currentScript.src).origin;
  window.addEventListener("message", (event) => {
    if (event.source !== window.opener || event.origin !== controllerOrigin) return;
    const payload = event.data;
    if (payload?.type !== "neotalk:external-player-command" || !payload.message || typeof payload.message !== "object") return;
    const frame = document.querySelector("iframe.avatar-widget-frame");
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(payload.message, new URL(frame.src).origin);
  });
})();
