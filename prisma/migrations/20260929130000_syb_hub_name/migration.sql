-- Data-only: the SYB campaign is called "SYB Hub" (was "SYB Campaign Hub"); custom names are left alone.
UPDATE `tenants`
SET `name` = 'SYB Hub'
WHERE `slug` = 'syb' AND `name` IN ('SYB Campaign Hub', 'Campaign Hub');

UPDATE `tenant_branding` b
JOIN `tenants` t ON t.`id` = b.`tenant_id`
SET b.`app_name` = 'SYB Hub'
WHERE t.`slug` = 'syb' AND b.`app_name` IN ('SYB Campaign Hub', 'Campaign Hub');
