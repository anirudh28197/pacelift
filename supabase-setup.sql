-- Run this in your Supabase project's SQL Editor (Database > SQL Editor > New query).

-- Stores your height for BMI calculations. One row per user.
create table if not exists profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  height_cm numeric not null,
  updated_at timestamptz not null default now()
);

-- Exercises you add yourself, on top of the built-in defaults per muscle group.
create table if not exists custom_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  muscle_group text not null check (muscle_group in ('chest', 'back', 'biceps', 'triceps', 'shoulders')),
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, muscle_group, name)
);

-- Each row is one set of one exercise on one date.
create table if not exists lift_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  muscle_group text not null check (muscle_group in ('chest', 'back', 'biceps', 'triceps', 'shoulders')),
  exercise_name text not null,
  set_number int not null,
  reps int not null,
  weight_kg numeric not null,
  created_at timestamptz not null default now()
);

-- Each row is one run.
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  run_type text not null check (run_type in ('speed', 'recovery', 'long')),
  distance_km numeric not null,
  duration_seconds int not null,
  route jsonb,
  source text not null default 'manual' check (source in ('gps', 'manual')),
  notes text,
  created_at timestamptz not null default now()
);

-- One body weight entry per day.
create table if not exists body_weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- Indexes used by the analytics and progress queries.
create index if not exists lift_sets_user_date_idx on lift_sets (user_id, date);
create index if not exists runs_user_date_idx on runs (user_id, date);
create index if not exists body_weight_logs_user_date_idx on body_weight_logs (user_id, date);

-- Lock every table down to its owning user only.
alter table profile enable row level security;
alter table custom_exercises enable row level security;
alter table lift_sets enable row level security;
alter table runs enable row level security;
alter table body_weight_logs enable row level security;

create policy "Users manage their own profile"
  on profile for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own custom exercises"
  on custom_exercises for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own lift sets"
  on lift_sets for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own runs"
  on runs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own body weight logs"
  on body_weight_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
