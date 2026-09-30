-- Integrated BOM analyzer usage metadata. Additive only: never mutates live qty_on_hand.
alter table public.stock
  add column if not exists qty_used_5600 integer not null default 0 check (qty_used_5600 >= 0),
  add column if not exists qty_used_7600 integer not null default 0 check (qty_used_7600 >= 0),
  add column if not exists qty_used_3600 integer not null default 0 check (qty_used_3600 >= 0),
  add column if not exists bom_section text not null default '';

comment on column public.stock.qty_used_5600 is 'Quantity used per VITROS 5600 analyzer from reviewed Integrated BOM source.';
comment on column public.stock.qty_used_7600 is 'Quantity used per VITROS 7600 analyzer from reviewed Integrated BOM source.';
comment on column public.stock.qty_used_3600 is 'Quantity used per VITROS 3600 analyzer from reviewed Integrated BOM source.';
comment on column public.stock.bom_section is 'Integrated BOM section. Origin, Duplicate, and BOM Rev are intentionally out of scope.';
