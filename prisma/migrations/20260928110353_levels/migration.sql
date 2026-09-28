-- Replace the free-text tenant_members.level with per-tenant levels.

-- CreateTable
CREATE TABLE `levels` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `rank` INTEGER NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `levels_tenant_id_name_key`(`tenant_id`, `name`),
    UNIQUE INDEX `levels_tenant_id_rank_key`(`tenant_id`, `rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_members` ADD COLUMN `level_id` CHAR(36) NULL;

-- Backfill: every tenant gets a default "Supporter" level (rank 1) ...
INSERT INTO `levels` (`id`, `tenant_id`, `name`, `rank`, `is_default`)
SELECT UUID(), `id`, 'Supporter', 1, true FROM `tenants`;

-- ... plus one level per other distinct value already in use, ranked after it
INSERT INTO `levels` (`id`, `tenant_id`, `name`, `rank`, `is_default`)
SELECT UUID(), d.`tenant_id`, d.`level`,
       1 + ROW_NUMBER() OVER (PARTITION BY d.`tenant_id` ORDER BY d.`level`), false
FROM (
    SELECT DISTINCT `tenant_id`, `level` FROM `tenant_members`
    WHERE `level` IS NOT NULL AND `level` <> 'Supporter'
) d;

UPDATE `tenant_members` m
JOIN `levels` l ON l.`tenant_id` = m.`tenant_id` AND l.`name` = COALESCE(m.`level`, 'Supporter')
SET m.`level_id` = l.`id`;

ALTER TABLE `tenant_members` DROP COLUMN `level`;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_level_id_fkey` FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `levels` ADD CONSTRAINT `levels_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
