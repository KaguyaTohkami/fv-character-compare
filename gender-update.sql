-- Tohkami Scale v14 性別カラム追加用
-- Supabase SQL Editorで一度だけ実行してください。

alter table public.fv_characters
  add column if not exists gender text not null default 'male'
  check (gender in ('male', 'female'));

update public.fv_characters
set gender = 'male'
where gender is null;
