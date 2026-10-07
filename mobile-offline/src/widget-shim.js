const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname === '/api/v1/widget/config') return Response.json({ allowed_origins: [location.origin] });
  if (url.pathname === '/api/v1/mvp/sign') {
    const { phrase } = JSON.parse(options.body);
    const result = await parent.neoTalkOffline.buildPose(phrase);
    return Response.json({ task_id: phrase, ...result });
  }
  if (url.pathname.startsWith('/api/v1/mvp/tasks/')) {
    return Response.json(await parent.neoTalkOffline.buildPose(decodeURIComponent(url.pathname.split('/').pop())));
  }
  // No network fallback for any missing API; local files only.
  if (url.pathname.startsWith('/api/')) return Response.json({ detail: 'Operação local indisponível.' }, { status: 404 });
  return originalFetch(input, options);
};
await import('/static/widget.js');
