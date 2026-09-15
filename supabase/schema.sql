-- Optional Supabase schema. The API only *reads* a trained model from Storage at boot;
-- the relational tables are for persisting datasets and an audit log of predictions if you want them.

-- One row per uploaded/trained dataset (the raw CSV lives in Storage, metadata here).
create table if not exists public.datasets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  storage_path  text not null,          -- e.g. datasets/2026-09-15.csv
  rounds        integer,
  created_at    timestamptz not null default now()
);

-- Audit log of predictions (no images are stored; only the extracted history + outputs).
create table if not exists public.predictions (
  id            bigint generated always as identity primary key,
  source        text not null,          -- 'image' | 'history'
  rounds_used   integer,
  median_x      numeric(10,3),
  p_over_2      numeric(6,4),
  p_over_10     numeric(6,4),
  skill         numeric(8,4),
  created_at    timestamptz not null default now()
);

create index if not exists predictions_created_at_idx on public.predictions (created_at desc);

-- Storage buckets. 'models' is private; the API reads it with the service-role key.
insert into storage.buckets (id, name, public) values ('models', 'models', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('datasets', 'datasets', false)
  on conflict (id) do nothing;

-- Only the service role may read/write these buckets (the API uses the service key server-side).
create policy "service role read models"  on storage.objects for select to service_role using (bucket_id = 'models');
create policy "service role write models" on storage.objects for insert to service_role with check (bucket_id = 'models');
create policy "service role read datasets"  on storage.objects for select to service_role using (bucket_id = 'datasets');
create policy "service role write datasets" on storage.objects for insert to service_role with check (bucket_id = 'datasets');
