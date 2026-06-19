-- 0005 Seed the GLOBAL permissions catalog (not tenant-scoped).
-- Default roles + default pipeline are seeded per-tenant by signup_organization().

insert into public.permissions (code, description) values
  ('lead.create',    'Create leads'),
  ('lead.read',      'Read leads'),
  ('lead.update',    'Update leads'),
  ('lead.delete',    'Delete leads'),
  ('lead.convert',   'Convert leads'),
  ('contact.create', 'Create contacts'),
  ('contact.read',   'Read contacts'),
  ('contact.update', 'Update contacts'),
  ('contact.delete', 'Delete contacts'),
  ('account.create', 'Create accounts'),
  ('account.read',   'Read accounts'),
  ('account.update', 'Update accounts'),
  ('account.delete', 'Delete accounts'),
  ('deal.create',    'Create deals'),
  ('deal.read',      'Read deals'),
  ('deal.update',    'Update deals'),
  ('deal.delete',    'Delete deals'),
  ('pipeline.manage','Manage pipelines and stages'),
  ('task.manage',    'Manage tasks, notes and activities'),
  ('user.manage',    'Invite and manage users and roles'),
  ('customfield.manage', 'Define and manage custom fields'),
  ('org.manage',     'Manage organization settings')
on conflict (code) do nothing;
