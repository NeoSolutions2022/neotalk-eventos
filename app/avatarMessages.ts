const NON_BLOCKING_AVATAR_PATTERNS = [
  /não confirmou (?:o )?carregamento da pose/i,
  /confirmação (?:do carregamento )?da pose expirou/i,
  /pose (?:load|loading) confirmation timeout/i,
];

const RETRYABLE_AVATAR_PATTERNS = [
  /(?:erro|error|status|http|falha http)?\s*(?:408|422|429|500|502|503|504)\b/i,
  /unprocessable entity/i,
  /(?:network|rede|fetch|temporariamente indisponível|timeout|tempo de resposta)/i,
];

export function isNonBlockingAvatarError(message?: string) {
  if (!message) return false;
  return NON_BLOCKING_AVATAR_PATTERNS.some((pattern) => pattern.test(message));
}

export function isRetryableAvatarError(message?: string) {
  if (!message) return false;
  return RETRYABLE_AVATAR_PATTERNS.some((pattern) => pattern.test(message));
}
