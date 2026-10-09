-- Tasti: biblioteca de canciones, jugadores y clasificaciones.
-- Pega todo este archivo en el SQL Editor de tu proyecto de Supabase y dale Run.
-- ANTES de correrlo, cambia el código de admin en la última línea.
-- Se puede volver a correr sin romper nada (no borra canciones ni puntajes).

create extension if not exists pgcrypto with schema extensions;

/* ---------------- canciones ---------------- */
create table if not exists public.songs (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (char_length(title) between 1 and 120),
  composer text not null default '' check (char_length(composer) <= 80),
  years text not null default '' check (char_length(years) <= 30),
  work text not null default '' check (char_length(work) <= 60),
  quip text not null default '' check (char_length(quip) <= 200),
  midi text not null, -- el .mid en base64 (son archivos pequeños)
  duration real not null default 0,
  note_count int not null default 0,
  stars jsonb not null default '{}'::jsonb, -- dificultad de 1 a 5 por nivel: {"easy":1,"medium":2,…}
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.songs enable row level security;
drop policy if exists "songs: todos leen las visibles" on public.songs;
create policy "songs: todos leen las visibles" on public.songs for select using (not hidden);

/* ---------------- código de admin (nadie lo puede leer) ---------------- */
create table if not exists public.admin (
  id int primary key default 1 check (id = 1),
  code_hash text not null
);
alter table public.admin enable row level security;

create or replace function public.admin_ok(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.admin where code_hash = extensions.crypt(coalesce(p_code, ''), code_hash));
$$;
revoke all on function public.admin_ok(text) from public, anon, authenticated;

-- La primera vez fija el código; después, para cambiarlo hay que dar el código actual.
create or replace function public.admin_set_code(p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(p_new, '')) < 4 then raise exception 'El código debe tener al menos 4 caracteres'; end if;
  if exists (select 1 from public.admin) then
    if not public.admin_ok(p_old) then raise exception 'Código incorrecto'; end if;
    update public.admin set code_hash = extensions.crypt(p_new, extensions.gen_salt('bf'));
  else
    insert into public.admin (code_hash) values (extensions.crypt(p_new, extensions.gen_salt('bf')));
  end if;
  return true;
end $$;

create or replace function public.admin_check(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_ok(p_code);
$$;

create or replace function public.admin_save_song(p_code text, p_song jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := p_song->>'id';
begin
  if not public.admin_ok(p_code) then raise exception 'Código incorrecto'; end if;
  if p_song ? 'midi' and char_length(p_song->>'midi') > 3000000 then raise exception 'El MIDI es demasiado grande'; end if;
  if exists (select 1 from public.songs where id = v_id) then
    update public.songs set
      title = coalesce(p_song->>'title', title),
      composer = coalesce(p_song->>'composer', composer),
      years = coalesce(p_song->>'years', years),
      work = coalesce(p_song->>'work', work),
      quip = coalesce(p_song->>'quip', quip),
      midi = coalesce(p_song->>'midi', midi),
      duration = coalesce((p_song->>'duration')::real, duration),
      note_count = coalesce((p_song->>'note_count')::int, note_count),
      stars = coalesce(p_song->'stars', stars),
      hidden = coalesce((p_song->>'hidden')::boolean, hidden),
      updated_at = now()
    where id = v_id;
  else
    if not p_song ? 'midi' then raise exception 'Falta el MIDI'; end if;
    insert into public.songs (id, title, composer, years, work, quip, midi, duration, note_count, stars, hidden)
    values (v_id, p_song->>'title', coalesce(p_song->>'composer', ''), coalesce(p_song->>'years', ''),
            coalesce(p_song->>'work', ''), coalesce(p_song->>'quip', ''), p_song->>'midi',
            coalesce((p_song->>'duration')::real, 0), coalesce((p_song->>'note_count')::int, 0),
            coalesce(p_song->'stars', '{}'::jsonb), coalesce((p_song->>'hidden')::boolean, false));
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_song(p_code text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_code) then raise exception 'Código incorrecto'; end if;
  delete from public.scores where song_id = p_id;
  delete from public.songs where id = p_id;
  return found;
end $$;

-- Todas las canciones, también las escondidas (sin el MIDI)
create or replace function public.admin_songs(p_code text)
returns table (id text, title text, composer text, years text, work text, quip text, duration real, note_count int, stars jsonb, hidden boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_ok(p_code) then raise exception 'Código incorrecto'; end if;
  return query select s.id, s.title, s.composer, s.years, s.work, s.quip, s.duration, s.note_count, s.stars, s.hidden, s.created_at
    from public.songs s order by s.created_at;
end $$;

/* ---------------- jugadores: cada nombre una sola vez ---------------- */
create table if not exists public.players (
  token uuid primary key,
  name text not null check (char_length(name) between 2 and 20),
  created_at timestamptz not null default now(),
  last_submit timestamptz
);
create unique index if not exists players_name_unique on public.players (lower(name));
alter table public.players enable row level security;

-- Devuelve el nombre de ese jugador. Si el token ya tenía nombre, no lo cambia.
create or replace function public.register_player(p_token uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
declare v_existing text;
begin
  select name into v_existing from public.players where token = p_token;
  if v_existing is not null then return v_existing; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 20 then raise exception 'El nombre debe tener entre 2 y 20 letras'; end if;
  if exists (select 1 from public.players where lower(name) = lower(v_name)) then raise exception 'nombre_ocupado'; end if;
  insert into public.players (token, name) values (p_token, v_name);
  return v_name;
end $$;

/* ---------------- puntajes: el mejor de cada jugador por pieza y nivel ---------------- */
create table if not exists public.scores (
  token uuid not null references public.players (token) on delete cascade,
  song_id text not null,
  diff text not null check (diff in ('easy', 'medium', 'hard', 'expert')),
  score int not null check (score >= 0),
  accuracy real not null check (accuracy between 0 and 1),
  max_combo int not null check (max_combo >= 0),
  created_at timestamptz not null default now(),
  primary key (token, song_id, diff)
);
create index if not exists scores_board on public.scores (song_id, diff, score desc);
alter table public.scores enable row level security;

-- Piezas que vienen dentro del juego (no están en la tabla songs)
create or replace function public.builtin_song(p_id text) returns boolean
language sql immutable set search_path = public as $$ select p_id = any (array['bach-preludio-do']) $$;

create or replace function public.submit_score(p_token uuid, p_song text, p_diff text, p_score int, p_accuracy real, p_combo int, p_notes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
declare v_best int;
declare v_rank int;
declare v_improved boolean := false;
begin
  select last_submit into v_last from public.players where token = p_token;
  if not found then raise exception 'Jugador desconocido'; end if;
  if v_last is not null and v_last > now() - interval '3 seconds' then raise exception 'Muy seguido'; end if;
  if not (public.builtin_song(p_song) or exists (select 1 from public.songs where id = p_song and not hidden)) then raise exception 'Pieza desconocida'; end if;
  -- límites generosos: nadie puede pasarse de lo que da la pieza
  if p_notes < 1 or p_notes > 20000 or p_combo > p_notes or p_accuracy < 0 or p_accuracy > 1
     or p_score > p_notes * 50 * 8 + p_notes * 200 then raise exception 'Puntaje imposible'; end if;

  update public.players set last_submit = now() where token = p_token;
  select score into v_best from public.scores where token = p_token and song_id = p_song and diff = p_diff;
  if v_best is null or p_score > v_best then
    insert into public.scores (token, song_id, diff, score, accuracy, max_combo)
    values (p_token, p_song, p_diff, p_score, p_accuracy, p_combo)
    on conflict (token, song_id, diff) do update set score = excluded.score, accuracy = excluded.accuracy, max_combo = excluded.max_combo, created_at = now();
    v_best := p_score;
    v_improved := true;
  end if;
  select count(*) + 1 into v_rank from public.scores where song_id = p_song and diff = p_diff and score > v_best;
  return jsonb_build_object('best', v_best, 'rank', v_rank, 'improved', v_improved);
end $$;

create or replace function public.top_scores(p_song text, p_diff text, p_limit int default 10)
returns table (rank bigint, name text, score int, accuracy real, max_combo int)
language sql stable security definer set search_path = public as $$
  select rank() over (order by s.score desc), p.name, s.score, s.accuracy, s.max_combo
  from public.scores s join public.players p using (token)
  where s.song_id = p_song and s.diff = p_diff
  order by s.score desc, s.created_at
  limit least(greatest(p_limit, 1), 50);
$$;

-- Clasificación general: la suma de los mejores puntajes de cada jugador
create or replace function public.top_total(p_limit int default 10)
returns table (rank bigint, name text, total bigint, pieces bigint)
language sql stable security definer set search_path = public as $$
  select rank() over (order by sum(s.score) desc), p.name, sum(s.score), count(distinct s.song_id)
  from public.scores s join public.players p using (token)
  group by p.name
  order by sum(s.score) desc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on public.admin, public.players, public.scores from anon, authenticated;
revoke insert, update, delete on public.songs from anon, authenticated;
grant select on public.songs to anon, authenticated;

-- ▼▼▼ Cambia TU-CODIGO por el código que quieras usar para subir canciones ▼▼▼
-- (si ya habías fijado uno, esta línea no hace nada: el código solo se cambia desde el juego)
do $$ begin if not exists (select 1 from public.admin) then perform public.admin_set_code(null, 'TU-CODIGO'); end if; end $$;
