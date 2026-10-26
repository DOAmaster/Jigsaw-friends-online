# Architecture and deployment

## Runtime layout

| Path | Purpose |
| --- | --- |
| `public/` | Browser interface, styles, puzzle rendering, and direct Function transport |
| `netlify/functions/game.ts` | The single Netlify Function at `/.netlify/functions/game` |
| `src/game-service.mjs` | Room rules, authorization, image handling, and conditional state updates |
| `src/puzzles.mjs` | Temporary sample puzzle pictures |
| `netlify.toml` | Netlify build, publish, and Function bundling configuration |

The browser polls the Function for room changes. The Function stores each room as JSON and uploaded image bytes in separate Netlify Blobs stores. Room reads use strong consistency; state changes use ETag-based conditional writes so simultaneous piece moves and votes do not silently overwrite one another.

No continuously running backend, external database, or user-managed API key is part of the deployed setup. Netlify supplies Function context and Blobs access to the deployed site.

## Netlify drag-and-drop deployment

Use the signed-in Netlify project publisher with the unzipped **project folder**, not its `public/` subfolder. Netlify reads `netlify.toml`, runs the project build, bundles `netlify/functions/game.ts`, and publishes `public/` alongside the Function. Uploading only static files would leave the multiplayer room service unavailable.

The Function is deliberately defined at the default `/.netlify/functions/game` path. The frontend calls that path directly; there is no custom function path or `/api/game` redirect.

## Local development

Use Node.js 22 or newer. Install from the lockfile with pnpm and start the local Netlify environment with `pnpm dev`. The frontend is static, while the Function and Blobs behavior are provided by Netlify’s local development environment. A deployed Netlify site remains the source of truth for persistent multiplayer rooms and image uploads.

## Source changes

- Add or revise game rules in `src/game-service.mjs` and document player-facing changes in `docs/gameplay.md`.
- Replace sample scenes in `src/puzzles.mjs` when licensed final artwork is ready.
- Keep shared helpers in `src/`; `netlify/functions/` contains only deployable Function entry points.
