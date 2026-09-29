-- Data-only: the seeded campaign is renamed from GYB to SYB (slug, subdomain, display names).
-- Skipped when a `syb` tenant already exists, so the unique slug never collides.
UPDATE `tenants` t
LEFT JOIN `tenants` s ON s.`slug` = 'syb'
SET t.`slug` = 'syb', t.`subdomain` = 'syb', t.`name` = REPLACE(t.`name`, 'GYB', 'SYB')
WHERE t.`slug` = 'gyb' AND s.`id` IS NULL;

UPDATE `tenant_branding` b
JOIN `tenants` t ON t.`id` = b.`tenant_id`
SET b.`app_name` = REPLACE(b.`app_name`, 'GYB', 'SYB'), b.`sms_sender_id` = REPLACE(b.`sms_sender_id`, 'GYB', 'SYB')
WHERE t.`slug` = 'syb';
