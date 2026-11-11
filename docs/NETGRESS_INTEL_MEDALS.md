# Netgress API 1.4.0 — медали агентов

Базовый адрес — `https://api.netgress.ru`. Запросы медалей используют `Authorization: Bearer <Intel-токен>`, полученный через `POST /v1/auth/intel/login`.

## Запросы

`GET /v1/intel/me/medals` — медали авторизованного агента.

`GET /v1/intel/agents/{id}/medals` — медали агента по UUID. UUID можно получить из профиля по нику через `GET /v1/intel/agents?nickname=...`.

`GET /v1/intel/medal-art/{catalog}/{file}` — изображение PNG. Это публичный ресурс, его можно использовать в `img` без передачи токена. Используйте готовые URL из ответа.

```bash
curl -H "Authorization: Bearer $INTEL_TOKEN" https://api.netgress.ru/v1/intel/me/medals
```

## Ответ

Корневой объект содержит `schema` (1), `agent_id` (UUID), `catalog_version`, `generated_at` и массив `medals`.

У медали есть стабильный `id`, `title`, `description`, `category`, `availability`, `metric_code` и `level_eligible` (засчитывается ли медаль для повышения уровня агента).

`earned_tier` — наивысшая подтверждённая ступень, 0 у незаработанной медали. `awarded_at` и `award_origin` относятся к этой ступени и равны null до получения. `awards` перечисляет все сохранённые ступени с полями `tier`, `awarded_at` и `origin`. Даты в ISO 8601, `historical_import` означает дату подтверждения по импортированным данным.

`thresholds`, `artwork_keys` и `artwork_urls` идут по возрастанию ступени. `image_url` указывает на изображение полученной ступени, у незаработанной — на первую ступень, если она есть. Пустая строка в `artwork_urls` означает отсутствие соответствующего файла.

`progress` содержит `value`, `unit`, `availability`, `coverage`, `observed_from` и `next_threshold`. Последний равен null после последней ступени. У памятных медалей без числовой метрики `metric_code` и `progress` равны null.

**Alpha Tester** — памятная медаль `alpha-tester`, показывается получившим её агентам, имеет одну ступень и собственное PNG. **Guardian** отдаёт длительность удержания в полных 24-часовых периодах. Идентификатор, название и координаты портала в данных Guardian отсутствуют.

Ответы с медалями имеют `Cache-Control: private, no-store`. Ошибки: 401 для недействительного токена, 403 при непринятых обязательных условиях, 404 для неизвестного агента, 429 при превышении лимита, 503 при временной недоступности.
