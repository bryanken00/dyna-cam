-- 026_hide_settings_permission.sql
-- CR-021: the Admin Settings page is gone (nothing read its values). Its
-- permission is hidden from Roles / user permissions by marking it Inactive;
-- the row, the stored settings and their API are kept so it can come back.

UPDATE permissions SET status = 'Inactive'
WHERE module = 'settings' AND submodule IS NULL;
