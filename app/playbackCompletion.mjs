// A hidden embedded renderer can be suspended by the browser. The visible
// external renderer's real final frame is authoritative in that condition.
export function playbackComplete(native, primaryHidden, externalOpen) {
  if (native.externalRequired && externalOpen) {
    return native.externalDone && (primaryHidden || native.primaryDone);
  }
  return native.primaryDone;
}
