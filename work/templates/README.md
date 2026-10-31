# Шаблоны рабочих артефактов

Шаблоны лежат здесь и записями ADR не считаются.

- `adr-full.md` — полный MADR 4.0.0 для крупных решений.
- `adr-minimal.md` — минимальный набор для малых решений и ADR-gap.
- `spec.md`, `impl.md`, `research.md` — появятся вместе с задачами, которые их создают.

## ADR

Обязательные поля шапки: `status`, `date`, `decision-makers`, `applies_to` (непустой, глобы валидны).

Опциональные поля шапки: `consulted`, `informed`, `origin`, `core`.

Обязательные разделы: `Context and Problem Statement`, `Considered Options`, `Decision Outcome` с `Chosen option`, `Consequences`, `Confirmation`.

Опциональные разделы: `Decision Drivers`, `Pros and Cons of the Options`, `More Information`.

Статусы: `accepted`, `deprecated`, `superseded by ADR-NNNN[, ADR-NNNN]`. Статусы `proposed` и `rejected` не используются: слияние — единственное изменение состояния, отклонённый ADR в основную ветку не попадает.

## Правила

- Заголовки разделов — канонические английские, текст — по-русски.
- Одно решение — один ADR; связанные решения — кластером, каждый со своим ID.
- Полный ADR обычно 60–120 строк, minimal — 20–40; больше 150 строк — предупреждение, больше 200 — дробить.
- Частичная замена: `amends` — только дополнение, не меняющее решение; замена любой части решения — новый ADR с полным переизложением и `supersedes`.
- Значения (версии, пороги) живут в профиле, а не в ADR.
