// Short status-line text for an API error code (map status, COMM).
export function errText(code, retryAfter = 0) {
  if (code === 'rate_limited') return `лимит запросов${retryAfter ? ` · ${retryAfter}с` : ''}`;
  if (code === 'origin_denied') return 'сервер отклонил запрос';
  if (code === 'network') return 'нет сети';
  return `ошибка: ${code || 'request_failed'}`;
}
