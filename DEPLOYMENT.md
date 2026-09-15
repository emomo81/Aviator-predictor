# Deploying to Vercel + Render + Supabase

The stack splits cleanly: the **Next.js UI** goes to Vercel, the **Express API** goes to Render,
and **Supabase** is optional storage for the trained model (and, if you want it, datasets and an
audit log). A model trained from the repository's `multipliers.csv` is included at
`server/data/model.json`; you can deploy it directly or replace it with a model loaded from one of
the remote sources below.

## 1. Render (API)

Use the provided `render.yaml` or create a Web Service manually:

| Setting        | Value                          |
|----------------|--------------------------------|
| Root directory | `server`                       |
| Build command  | `npm install`                  |
| Start command  | `node src/index.js`            |
| Health check   | `/api/health`                  |
| Node version   | `22`                           |

Environment variables:

| Var              | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `GEMINI_API_KEY` | Enables real vision. Without it (or if egress is blocked) the offline extractor is used. |
| `GEMINI_MODEL`   | e.g. `gemini-3.5-flash`                                        |
| `MODEL_URL`      | https URL to a `model.json` to load into memory at boot, **or** |
| `SUPABASE_URL` + `SUPABASE_KEY` | Read `model.json` from the private `models` bucket, **or** |
| (none)           | Uses the checked-in `server/data/model.json`. If absent, the repo's `multipliers.csv` can be trained in memory at boot. |

`PORT` is injected by Render and honoured. A model fetched from a URL/Supabase or trained at boot
lives in memory and is not written to Render's ephemeral disk.

To publish a replacement model: train locally (`npm --prefix server run train`) and commit the new
`server/data/model.json`. Alternatively, remove the local bundle in your deployment and upload it to
the `models` bucket (Supabase), or put it on a static host and set `MODEL_URL`.

## 2. Vercel (UI)

* Create a Vercel project with **Root Directory = `web`**.
* Set `API_BASE_URL` to your Render service URL (e.g. `https://aviator-api.onrender.com`). It is read
  by `next.config.mjs` for the `/api/*` rewrite, so set it as both a build and runtime variable.
* The browser only ever calls same-origin `/api/...`; the rewrite proxies to Render server-side, so
  there is no CORS or localhost in client code.

## 3. Supabase (optional persistence)

* Run `supabase/schema.sql` in the SQL editor. It creates `datasets`, `predictions`, and the private
  `models`/`datasets` buckets with service-role-only policies.
* Give Render `SUPABASE_URL` and the **service-role** key as `SUPABASE_KEY` (keep it server-side only).
* The API reads `models/model.json` at boot. Writing prediction rows is not wired in yet; the schema is
  ready for it if you want an audit log.

## Honesty note

This remains an analysis tool: crash games are provably-fair RNGs, so the model reports ~0 skill on
random data and says so. Deployment does not change that.
