-- The trigger compares vector columns, so its search_path must include the schema that owns the
-- vector operators (extensions). Without it every UPDATE on entries failed with
-- "operator does not exist: extensions.vector = extensions.vector".
create or replace function public.entries_before_update() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.updated_at := now();
  if new.embedding is not distinct from old.embedding
     and (new.topic is distinct from old.topic or new.key_idea is distinct from old.key_idea
          or new.raw_text is distinct from old.raw_text) then
    new.embedding := null;
  end if;
  return new;
end $$;
