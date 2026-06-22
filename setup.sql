-- FVキャラクター比較 権限分離版
-- Supabase SQL Editorで実行してください。

create extension if not exists pgcrypto;

create table if not exists public.fv_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('admin', 'moderator', 'editor')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fv_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 999,
  created_at timestamptz not null default now()
);

create table if not exists public.fv_characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  height numeric not null check (height > 0),
  gender text not null default 'male' check (gender in ('male', 'female')),
  color text not null default '#4b6fa9',
  categories text[] not null default '{}',
  image_url text,
  image_path text,
  visible boolean not null default true,
  owner_user_id uuid references public.fv_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- 既存テーブル向け：性別カラムを追加
alter table public.fv_characters
  add column if not exists gender text not null default 'male'
  check (gender in ('male', 'female'));

alter table public.fv_users enable row level security;
alter table public.fv_categories enable row level security;
alter table public.fv_characters enable row level security;

insert into public.fv_categories (name, sort_order) values
  ('白市民', 1),
  ('黒市民', 2),
  ('警察', 3),
  ('救急', 4),
  ('メカニック', 5),
  ('飲食店', 6),
  ('ギャング', 7),
  ('半グレ', 8),
  ('不明', 10),
  ('その他', 11)
on conflict (name) do nothing;
