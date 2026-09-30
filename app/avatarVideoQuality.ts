export const videoQualityPresets = {
  light: { label: "Leve", bitrate: 2_500_000, fps: 30, description: "Arquivo menor · até 30 fps" },
  high: { label: "Alta", bitrate: 8_000_000, fps: 30, description: "Menos compressão · até 30 fps" },
  maximum: { label: "Máxima", bitrate: 16_000_000, fps: 60, description: "Mais detalhe e fluidez · até 60 fps · arquivo maior" },
} as const;

export type VideoQuality = keyof typeof videoQualityPresets;

export const videoFramePresets = {
  landscape: { label: "Horizontal · 16:9", ratio: 16 / 9, minWidth: 640, minHeight: 360 },
  shorts: { label: "Shorts / Reels · 9:16", ratio: 9 / 16, minWidth: 300, minHeight: 530 },
  square: { label: "Quadrado · 1:1", ratio: 1, minWidth: 480, minHeight: 480 },
  portrait: { label: "Retrato · 4:5", ratio: 4 / 5, minWidth: 400, minHeight: 500 },
} as const;

export type VideoFrameFormat = keyof typeof videoFramePresets;

export function avatarCaptureConstraints(quality: VideoQuality): MediaTrackConstraints {
  // Keep the tab's native detail, rather than requesting a small, downscaled
  // stream. Region Capture subsequently restricts output to the avatar iframe.
  return {
    displaySurface: "browser",
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: videoQualityPresets[quality].fps, max: videoQualityPresets[quality].fps },
  };
}

export function avatarRecorderOptions(quality: VideoQuality, mimeType: string): MediaRecorderOptions {
  return { mimeType, videoBitsPerSecond: videoQualityPresets[quality].bitrate };
}

export function captureDetails(settings: MediaTrackSettings, bitrate: number): string {
  const resolution = settings.width && settings.height ? `${settings.width} × ${settings.height}` : "Resolução do navegador";
  const fps = settings.frameRate ? ` · ${Math.round(settings.frameRate)} fps` : "";
  return `${resolution}${fps} · ${(bitrate / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbps`;
}
