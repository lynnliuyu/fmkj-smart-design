-- Store the selected housing layout without guessing legacy project types.
alter table projects
  add column if not exists property_type text;

alter table projects
  drop constraint if exists projects_property_type_check;

alter table projects
  add constraint projects_property_type_check
  check (property_type is null or property_type in ('flat', 'villa'));
