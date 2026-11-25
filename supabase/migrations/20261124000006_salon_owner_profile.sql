-- 0006 Owner name + Vietnamese honorific on the salon, used in texts ("Lan will call you back",
-- "chị Lan sẽ gọi lại"). Editable from Settings → Salon profile.
alter table salons
  add column owner_first_name text check (length(owner_first_name) <= 30),
  add column owner_title_vi text check (owner_title_vi in ('chị', 'anh', 'cô', 'chú', 'bà', 'ông'));
