# docs

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Anonymous CLI measurement operations

`POST /api/telemetry/v1/events` accepts the documented opt-in CLI events. The
Dokploy/VPS deployment persists aggregates with Node 24's built-in SQLite.
Configure these server-only environment variables:

- `MURASAKI_TELEMETRY_DB_PATH` — an absolute path on a persistent volume,
  recommended: `/data/murasaki-telemetry.sqlite`.
- `MURASAKI_TELEMETRY_ADMIN_TOKEN` — a separate random bearer token used only
  to read the aggregate summary.

Mount a persistent Dokploy volume at `/data`; otherwise a container replacement
will discard the database. Without `MURASAKI_TELEMETRY_DB_PATH`, the route writes only the already-sanitized event
to the hosting log. It never exposes that fallback as a successful persistent
aggregate. With SQLite configured, daily counters, dimensions, and hashed
installation identifiers expire after 90 days. Read the private 30-day view:

```bash
curl -H "Authorization: Bearer $MURASAKI_TELEMETRY_ADMIN_TOKEN" \
  'https://murasaki.ichi10.com/api/telemetry/v1/summary?days=30'
```

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
