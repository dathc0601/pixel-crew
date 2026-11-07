# Quarantined assets (not shipped)

Files here are kept in the repository for reference but are **not** part of
any build: they live outside `public/`, so Next.js never copies them into
`out/`, and the web build step (`scripts/strip-unshippable.mjs`) deletes `out/offices/` if it reappears.

## `offices/` (12 themed office backgrounds)

Each `*.zip` holds a 1024×1024 `background.jpeg` and a `room.json` walk grid;
the `*.jpeg`/`*.jpg` files are thumbnails. They came from upstream
(longyangxi/OpenOffice) without any source, author or license information,
and they look AI-generated. Until their provenance and license are confirmed,
we treat them as **not redistributable**.

Without them the office falls back to the default pixel-agents layout
(`public/pixel-agents-layout.json`), and the theme switcher shows an empty list.

To use them locally, at your own discretion, copy the folder back to
`apps/web/public/offices/` and run the dev server (`pnpm dev:web`). Do not
commit them to `public/` and do not ship builds that contain them.

Replacement art with recorded licenses is planned (see THIRD_PARTY_NOTICES.md).
