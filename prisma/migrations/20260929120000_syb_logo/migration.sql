-- Data-only: give the seeded SYB campaign its logo (served by gcb-frontend at /brand/syb-logo.png)
-- unless one has already been set.
UPDATE `tenant_branding` b
JOIN `tenants` t ON t.`id` = b.`tenant_id`
SET b.`logo_url` = '/brand/syb-logo.png'
WHERE t.`slug` = 'syb' AND (b.`logo_url` IS NULL OR b.`logo_url` = '');
