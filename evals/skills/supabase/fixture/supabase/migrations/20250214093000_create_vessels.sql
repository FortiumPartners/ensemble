-- Vessels hauled out or stored in the yard.
create table if not exists public.vessels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_email text not null,
  berth text,
  created_at timestamptz not null default now()
);

alter table public.vessels enable row level security;

create policy "vessels are readable by authenticated users"
  on public.vessels for select
  to authenticated
  using (true);
