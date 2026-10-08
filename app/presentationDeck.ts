// Illustrative gestures only: deliberately independent of the spoken captions.
// Exact catalog membership avoids sending invented glosses to the pose service.
export const PRESENTATION_LIMIT = 64;
export const PRESENTATION_DISCLOSURE = "Demonstração · sinais ilustrativos";
const normalize = (value: string) => value.replace(/\.pose$/i, "").replace(/\s+/g, " ").trim().toUpperCase();

export function buildPresentationPhrases(catalog: string[]): string[] {
  const words = new Set(catalog.map(normalize).filter(Boolean));
  const topics = [
    "AMIGO", "APRENDER", "COMPREENDER", "COMPRAR", "AJUDAR", "TRABALHAR",
    "ESTUDAR", "CONVERSAR", "CONHECER", "ENSINAR", "PARTICIPAR", "ACOMPANHAR",
    "PERGUNTAR_DÚVIDA", "FALAR", "PENSAR", "ENTENDER", "FAZER", "CRIAR",
    "TECNOLOGIA", "INOVAÇÃO", "PALESTRA", "COMUNICAÇÃO", "ACESSIBILIDADE",
    "LIBRAS", "EDUCAÇÃO", "ESCOLA", "FAMÍLIA", "PESSOA", "FUTURO", "HOJE",
    "BOM", "OBRIGADO", "BEM", "IMPORTANTE", "EU", "VOCÊ", "NÓS", "QUERER",
  ].filter(word => words.has(word));
  // Include actual dataset additions, not a hardcoded subset alone.
  const available = [...topics, ...[...words].sort().filter(word => !topics.includes(word))];
  const phrases = new Set<string>();
  // Short clips keep native preparation bounded. These are gesture sequences,
  // not linguistically validated Libras sentences or a translation result.
  for (let offset = 1; offset <= 3 && phrases.size < PRESENTATION_LIMIT; offset++) {
    for (let i = 0; i < Math.min(available.length, 48) && phrases.size < PRESENTATION_LIMIT; i++) {
      if (available.length < 2) break;
      const next = available[(i + offset) % available.length];
      if (available[i] !== next) phrases.add(`${available[i]} ${next}`);
    }
  }
  return [...phrases];
}

export class PresentationShuffle {
  private bag: string[] = [];
  private recent: string[] = [];
  constructor(private readonly random: () => number = Math.random) {}
  next(available: string[]): string | undefined {
    const valid = new Set(available);
    this.bag = this.bag.filter(phrase => valid.has(phrase));
    if (!this.bag.length) {
      this.bag = [...valid];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    const recentWindow = Math.min(12, valid.size - 1);
    let index = this.bag.findIndex(phrase => !this.recent.slice(-recentWindow).includes(phrase));
    if (index < 0) index = 0;
    const [phrase] = this.bag.splice(index, 1);
    if (phrase) this.recent = [...this.recent, phrase].slice(-12);
    return phrase;
  }
}
