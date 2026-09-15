# Deploying to Vercel + Render + Supabase

The stack splits cleanly: the **Next.js UI** goes to Vercel, the **Express API** goes to Render,
and **Supabase** is optional storage for the trained model (and, if you want it, datasets and an
audit log). The repo stays free of large artifacts: `model.json` and `dataset.csv` are gitignored,
so the API obtains the model at boot from one of three sources (below).

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
| (none)           | If a `dataset.csv` is present the API trains in memory at boot; otherwise it serves with "no model". |

`PORT` is injected by Render and honoured. The trained model is never written to Render's ephemeral
disk when it comes from a URL/Supabase; it lives in memory.

To publish a model: train locally (`npm run train`), then upload `server/data/model.json` to the
`models` bucket (Supabase) or any static host (MODEL_URL).

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
