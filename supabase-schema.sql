-- Schema de Calendaria para Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query

-- Tabla principal: datos por dia (y __pending__)
create table if not exists calendar_data (
  user_id    uuid references auth.users not null,
  key        text not null,          -- 'YYYY-MM-DD' o '__pending__'
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Tabla de preferencias (tema, etc.)
create table if not exists user_prefs (
  user_id    uuid references auth.users primary key,
  prefs      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Row Level Security: cada usuario solo ve sus propios datos
alter table calendar_data enable row level security;
alter table user_prefs    enable row level security;

create policy "Propios datos calendario" on calendar_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Propias preferencias" on user_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Indice para acelerar queries por usuario
create index if not exists idx_calendar_data_user on calendar_data (user_id);
