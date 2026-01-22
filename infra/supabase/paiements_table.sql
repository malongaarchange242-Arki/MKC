-- SQL to create `paiements` table
create table if not exists paiements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  status text default 'pending',
  created_at timestamptz default now()
);
