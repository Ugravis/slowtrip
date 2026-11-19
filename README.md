# Slowtrip

Contemplative 3D road-trip & vanlife exploration game, running in the browser.
Low-poly, flat-shaded art style. Procedurally generated infinite world.

> Drive, walk or ride through endless biomes, photograph wildlife and landscapes,
> fill your field journal, earn money, buy vehicles and fit out your van.

## Core loop

```
Explore → Photograph species & landscapes → Fill the journal → Earn money
   ↑                                                              ↓
   └──────── Upgrade van / buy vehicles (dealership) ←────────────┘
```

## Features (target)

- **Locomotion**: on foot (1st person), vehicle (1st/3rd person), bicycle (1st/3rd person).
- **Procedural world**: infinite, seed-based, multiple biomes and moods, procedural roads, day/night cycle, weather.
- **Photography & journal**: photo scoring (subject, framing, distance, occlusion, rarity, time of day), discovery journal.
- **Van fit-out**: modular interior based on layouts (slot grid), modules & equipment.
- **Dealership**: buy and switch vehicles.
- **Accounts & cloud saves**: guest account first, upgradable to a full account. Cross-device sync (desktop ↔ mobile).
- **Back office**: content management (species, modules, vehicles, biomes), player support, analytics.

Single-player only. Desktop and mobile.

## Repository layout

pnpm workspaces monorepo, orchestrated by Turborepo.

```
apps/
  game/      # Browser game (Vite + React + R3F)
  api/       # Backend API (Fastify)         (planned)
  admin/     # Back office (Vite + React)    (planned)
  site/      # SEO landing page (Astro)      (planned)
packages/
  shared/    # Zod schemas, DTO types, constants shared by all apps
  config/    # Shared tsconfig, ESLint, Prettier presets
```

## Tech stack

### Game (`apps/game`)

| Concern         | Choice                                                          |
| --------------- | --------------------------------------------------------------- |
| Build           | Vite                                                            |
| UI              | React                                                           |
| 3D rendering    | Three.js via React Three Fiber (`@react-three/fiber`, `@react-three/drei`) |
| Physics         | Rapier (`@dimforge/rapier3d-compat`)                            |
| Noise           | `simplex-noise` + seeded PRNG                                   |
| Workers         | Web Workers + `comlink` (terrain, roads, scatter)               |
| State           | Zustand (transient updates for hot paths)                       |
| Local cache     | IndexedDB via Dexie (offline play, sync queue)                  |

### Backend (`apps/api`)

| Concern         | Choice                                   |
| --------------- | ---------------------------------------- |
| Runtime         | Node.js (LTS)                            |
| Framework       | Fastify                                  |
| Database        | PostgreSQL                               |
| ORM / migrations| Drizzle ORM + drizzle-kit                |
| Auth            | Better Auth (guest → full account)       |
| Validation      | Zod (schemas from `packages/shared`)     |

### Back office (`apps/admin`)

| Concern | Choice                          |
| ------- | ------------------------------- |
| Build   | Vite                            |
| UI      | React + shadcn/ui + TanStack Query |

### Landing page (`apps/site`)

| Concern | Choice                               |
| ------- | ------------------------------------ |
| Framework | Astro (static, zero JS by default) |

### Tooling

| Concern         | Choice                    |
| --------------- | ------------------------- |
| Language        | TypeScript (strict)       |
| Monorepo        | pnpm workspaces + Turborepo |
| Tests           | Vitest                    |
| Lint / format   | ESLint + Prettier         |
| Local services  | Docker Compose (PostgreSQL) |
| CI              | GitHub Actions            |

### Data model (overview)

- The world is deterministic from its seed: it is **never stored**.
- Saves store player deltas only: journal, money, inventory, van layout, position, seed.
- Game is local-first: progress is written to IndexedDB, then synced to the API.
- Analytics: batched gameplay events, ingested by the API into PostgreSQL.
- Game content (species, modules, vehicles) is edited in the back office and served by the API.

## Architecture principles

- **Performance first** (see [CLAUDE.md](CLAUDE.md) rules).
- **Deterministic generation**: same seed + chunk coords → same chunk, always.
- **Chunked streaming**: terrain, roads, vegetation generated per chunk in workers, with LOD rings.
- **Floating origin**: world recentered around the player to keep float32 precision in an infinite world.
- **React for composition and UI only**: the per-frame simulation runs in plain TS systems, through refs and `useFrame`.
- **Shared contract**: every API payload is defined once as a Zod schema in `packages/shared`.
- **Quality tiers**: automatic low/medium/high presets (desktop vs mobile), adaptive resolution.

## Getting started

> Not scaffolded yet.

```bash
pnpm install
docker compose up -d   # PostgreSQL
pnpm db:migrate
pnpm dev               # game + api + admin
```

## Roadmap

0. **Foundations**: monorepo layout, tooling, CI, branch workflow.
1. **Vertical slice**: 1 biome, 1 van, infinite procedural road, driving (1st/3rd person), camera + journal (~5 species), day/night.
2. On-foot exploration.
3. Van interior fit-out (layouts + modules).
4. Economy & dealership.
5. More biomes, weather, fauna.
6. Bicycle.
7. Backend: accounts, cloud saves, analytics, back office, SEO landing page.

## Contributing

Gitflow branching, Conventional Commits.

- `main`: production. Protected, updated only through PRs from `dev` (or `hotfix/*`).
- `dev`: integration branch (default). Protected, updated only through PRs.
- Work branches: `feature/*`, `fix/*`, `chore/*`, `hotfix/*`.
- CI (lint, typecheck, test, build) must pass before merging.
