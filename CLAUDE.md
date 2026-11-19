# Project Guidelines

## Stack & Commands
- Monorepo: pnpm workspaces + Turborepo. `apps/game`, `apps/api`, `apps/admin`, `apps/site`, `packages/shared`, `packages/config`. Backend, admin and site are planned, not built yet.
- Game: TypeScript (strict), Vite, React, React Three Fiber + drei, Three.js, Rapier (`@dimforge/rapier3d-compat`), `simplex-noise`, Web Workers + `comlink`, Zustand, Dexie (IndexedDB local cache).
- API: Node.js LTS, Fastify, PostgreSQL, Drizzle ORM + drizzle-kit, Better Auth, Zod.
- Admin: Vite, React, shadcn/ui, TanStack Query.
- Site (SEO landing): Astro.
- Tooling: Vitest, ESLint + Prettier, Docker Compose (PostgreSQL).
- Commands: `pnpm dev`, `pnpm build`, `pnpm --filter <app> test <file>`, `pnpm lint --quiet`, `pnpm db:generate`, `pnpm db:migrate` (once scaffolded).

## Project Rules
1. **Performance is rule #1.** Every feature is designed for a stable 60 fps on desktop and 30+ fps on mid-range mobile.
   - Zero allocations in hot loops (`useFrame`, physics step, systems): reuse `Vector3`/`Quaternion`/`Matrix4` scratch objects.
   - Never call React `setState` per frame. Use refs and Zustand transient updates (`getState`/`subscribe`).
   - `InstancedMesh` / merged geometries for repeated objects. Minimize draw calls and material count. Share materials.
   - Flat shading via vertex colors / shared palette texture. No per-object textures unless justified.
   - Heavy generation (terrain, roads, scatter) runs in Web Workers. Transfer `ArrayBuffer`s; never clone them.
   - LOD rings plus frustum culling. Dispose geometries, materials and physics bodies when chunks unload.
   - Physics colliders only near the player. Simple shapes (heightfield, boxes, capsules) over trimesh.
   - Quality tiers (low/medium/high) plus adaptive DPR. Mobile defaults to low.
   - Measure before and after optimizing (`r3f-perf`, `renderer.info`, browser profiler). Budgets: draw calls < 150, triangles < 500k on mobile.
   - Lazy-load non-core code (dealership, van editor UI) and assets. Compress assets (glTF + Draco/Meshopt, KTX2).
2. **Determinism.** Generation depends only on `(seed, chunkCoords)` via a seeded PRNG. Never call `Math.random()` in generation code.
3. **Infinite world.** Chunk streaming plus floating origin. Never store absolute world positions in float32 far from the origin.
4. **Separation.** React handles scene composition and UI. Simulation logic lives in plain TS modules (testable without rendering).
5. **Mobile parity.** Every input has a touch equivalent. UI is responsive.
6. **Backend & data.**
   - Every API payload has one Zod schema in `packages/shared`, used by the API (validation) and the clients (types). No duplicated DTOs.
   - Schema changes only through drizzle-kit migrations, committed. Never edit an applied migration.
   - The world is never stored. Saves hold player deltas only, versioned (`saveVersion`) with forward migrations.
   - Game is local-first: it must stay playable offline. Writes go to IndexedDB, then sync to the API.
   - Analytics events are batched client-side and never block the game loop.
   - Admin routes require an admin role, checked server-side. Secrets only in env vars, never committed.
7. **Scope discipline.** Vertical slice first (see README roadmap). No feature from a later step before the current one ships.

## Interaction & Git
- Language: French for discussion, English for code/docs/commits.
- Git: Gitflow, Conventional Commits (no AI/Claude mentions). User validates PRs.
- Branches: `main` and `dev` are protected (PR + green CI required). Branch from `dev` (`feature/*`, `fix/*`, `chore/*`); `hotfix/*` from `main`.

## File Inspection & Token Guardrails
- Source code: Max 150 lines per read. If > 150 lines, locate targets via `grep -n` and inspect using `offset`/`limit`.
- Configs/Locks/Data: NEVER read full lockfiles, logs, GeoJSON, GPX, or Docker files. Use `jq`, `yq`, `grep`, `head`, `tail`.
- Tests: Run targeted files only (never full suite). Silence linters (`--quiet`).

## Output Rules
- Output changed lines only (minimal diff style).
- No unrequested architectural overhauls or passive code echoes.

## Task Delegation

Spawn subagents to isolate context, parallelize independent work, or offload bulk mechanical tasks. Don't spawn when the parent needs the reasoning, when synthesis requires holding things together, or when spawn overhead dominates.

Pick the cheapest model that can do the subtask well:
- Haiku: bulk mechanical work, no judgment
- Sonnet: scoped research, code exploration, in-scope synthesis
- Opus: subtasks needing real planning or tradeoffs

If a subagent realizes it needs a higher tier than itself, return to the parent.

Parent owns final output and cross-spawn synthesis. User instructions override.