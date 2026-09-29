-- Data-only: SYB's brand colour is red (replacing the seeded green or the brief burgundy); a custom colour is left alone.
UPDATE `tenant_branding` b
JOIN `tenants` t ON t.`id` = b.`tenant_id`
SET b.`primary_color` = '#C8102E'
WHERE t.`slug` = 'syb' AND b.`primary_color` IN ('#0B6E4F', '#7B1E3A');
