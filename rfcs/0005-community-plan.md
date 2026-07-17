# RFC 0005 — Community & Repo Hygiene Plan

- Status: Draft (authored 2026-07-17). Mostly maintainer actions, not code.

## P0 — confusion removal (needs maintainer/GitHub action)

1. **Archive the stale standalone `create-murasaki` repo** (local copy:
   `murasaki-oss/create-murasaki`, v0.25.0, @clack-based — npm publishes from
   the monorepo's `packages/create-murasaki` per `release.yml`). Action:
   README banner pointing to the monorepo → GitHub archive. ⚠️ Outward-facing;
   maintainer confirms before execution.
2. README (monorepo): add a "repository layout" note stating the monorepo is
   the single source of truth for all published packages.

## P1 — channels & contribution surface

3. **GitHub Discussions** over Discord initially (async, indexable, zero
   moderation staffing, feeds the MCP/docs knowledge loop). Categories: Q&A,
   Show & Tell, RFCs (0001–0005 seed it), Roadmap. Discord later, when there
   are >~50 weekly actives to justify it.
4. Issue templates (bug incl. `murasaki doctor` output field / feature /
   security-redirect) + PR template referencing capabilities.json honesty
   rule ("if you change behavior, change the manifest").
5. `CONTRIBUTING.md`: add plugin-authoring pointer (build-time SDK today, RFC
   0004 for runtime), and a "good first issue" curation habit — label ~10
   issues from the S/A/B backlog items that are genuinely contained.

## P2 — ecosystem seeding

6. Publish RFCs 0001–0004 as Discussions; roadmap page on the docs site
   generated from capabilities.json statuses (the manifest is already the
   roadmap — render it).
7. `awesome-murasaki` seeded only after runtime plugins exist (empty awesome
   lists age badly).
