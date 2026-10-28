export type CaptureProfile = "standard" | "lecture" | "direct";
export type CaptureSelection = { deviceId: string; profile: CaptureProfile; compatible: boolean };

export function needsManagedCapture(selection: CaptureSelection): boolean {
  return selection.compatible || Boolean(selection.deviceId) || selection.profile !== "standard";
}

export async function acquireCapture(media: MediaDevices, selection: CaptureSelection): Promise<MediaStream> {
  const supported = media.getSupportedConstraints?.() || {};
  const audio: MediaTrackConstraints = {};
  // Explicit hardware selection must never silently fall back to another mic.
  if (selection.deviceId) {
    if (!supported.deviceId) throw new Error("Este navegador não permite selecionar o microfone. Use o dispositivo padrão ou outro navegador.");
    audio.deviceId = { exact: selection.deviceId };
  }
  if (selection.profile !== "standard") {
    const filtered = selection.profile === "lecture";
    for (const key of ["echoCancellation", "noiseSuppression", "autoGainControl"] as const) {
      if (supported[key]) audio[key] = { ideal: filtered };
    }
  }
  return media.getUserMedia({ audio: Object.keys(audio).length ? audio : true, video: false });
}

// Report effective booleans, not requested settings or hardware identifiers.
export function effectiveCapture(track: MediaStreamTrack): string {
  try {
    const settings = track.getSettings?.() || {};
    return ([['echoCancellation', 'Eco'], ['noiseSuppression', 'Ruído'], ['autoGainControl', 'Ganho']] as const)
      .map(([key, label]) => `${label}: ${typeof settings[key] === 'boolean' ? settings[key] ? 'ligado' : 'desligado' : 'não informado'}`).join(' · ');
  } catch { return "O navegador não informou os filtros efetivos."; }
}
