export const normalize = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// Longest-match lookup preserves catalog expressions; no invented glosses or GPT.
export function translate(text, entries) {
  const dictionary = new Map();
  for (const entry of entries) {
    for (const alias of [entry.gloss, ...(entry.aliases || [])]) {
      const key = normalize(alias);
      if (dictionary.has(key) && dictionary.get(key).gloss !== entry.gloss) throw new Error(`Alias ambíguo: ${alias}`);
      dictionary.set(key, entry);
    }
  }
  const tokens = normalize(text).split(' ').filter(Boolean);
  const max = Math.max(1, ...Array.from(dictionary.keys(), (key) => key.split(' ').length));
  const found = [], missing = [];
  for (let offset = 0; offset < tokens.length;) {
    let match;
    for (let length = Math.min(max, tokens.length - offset); length > 0; length--) {
      const entry = dictionary.get(tokens.slice(offset, offset + length).join(' '));
      if (entry) { match = { entry, length }; break; }
    }
    if (match) { found.push(match.entry); offset += match.length; }
    else { missing.push(tokens[offset]); offset++; }
  }
  return { entries: found, missing, gloss_text: found.map((entry) => entry.gloss).join(' ') };
}

export function concatenatePoses(contents, maxFrames = 6000) {
  let nextFrame = 0;
  const output = contents.map((content) => {
    const ids = new Map();
    const result = content.replace(/^# Frame: (.*?) - (.+ Keypoints)\s*$/gm, (_line, source, section) => {
      if (!ids.has(source)) ids.set(source, nextFrame++);
      return `# Frame: frame_${String(ids.get(source)).padStart(12, '0')}_keypoints.json - ${section}`;
    });
    if (!ids.size || !/ - Body Keypoints/.test(result)) throw new Error('Arquivo .pose inválido.');
    if (nextFrame > maxFrames) throw new Error('Sequência excede o limite de frames do dispositivo.');
    return result.trim();
  });
  if (!nextFrame) throw new Error('Nenhuma pose disponível para este trecho.');
  return { content: output.join('\n\n') + '\n', frame_count: nextFrame };
}

export class PoseCache {
  constructor(limit = 8) { this.limit = limit; this.items = new Map(); }
  async get(key, create) {
    if (this.items.has(key)) {
      const value = this.items.get(key); this.items.delete(key); this.items.set(key, value); return value;
    }
    const value = await create(); this.items.set(key, value);
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next().value;
      URL.revokeObjectURL(this.items.get(oldest).pose.content_url); this.items.delete(oldest);
    }
    return value;
  }
  dispose() { for (const value of this.items.values()) URL.revokeObjectURL(value.pose.content_url); this.items.clear(); }
}
