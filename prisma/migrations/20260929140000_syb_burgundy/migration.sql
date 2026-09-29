-- Data-only: SYB's brand colour moves from the seeded green to burgundy; a custom colour is left alone.
UPDATE `tenant_branding` b
JOIN `tenants` t ON t.`id` = b.`tenant_id`
SET b.`primary_color` = '#7B1E3A'
WHERE t.`slug` = 'syb' AND b.`primary_color` = '#0B6E4F';
