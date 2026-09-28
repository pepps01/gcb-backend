-- AlterTable
ALTER TABLE `kyc_submissions` ADD COLUMN `nin_slip_upload_id` CHAR(36) NULL,
    ADD COLUMN `pvc_upload_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `lgas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `lgas_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NOT NULL,
    `lga_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(20) NULL,

    INDEX `wards_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `wards_lga_id_name_key`(`lga_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `polling_units` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NOT NULL,
    `ward_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(30) NULL,

    INDEX `polling_units_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `polling_units_ward_id_name_key`(`ward_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `uploads` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `mime` VARCHAR(60) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `uploads_tenant_id_member_id_idx`(`tenant_id`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_bank_accounts` (
    `member_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `bank_name` VARCHAR(100) NOT NULL,
    `account_number` CHAR(10) NOT NULL,
    `account_name` VARCHAR(200) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `member_bank_accounts_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`member_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `lgas` ADD CONSTRAINT `lgas_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wards` ADD CONSTRAINT `wards_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wards` ADD CONSTRAINT `wards_lga_id_fkey` FOREIGN KEY (`lga_id`) REFERENCES `lgas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `polling_units` ADD CONSTRAINT `polling_units_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `polling_units` ADD CONSTRAINT `polling_units_ward_id_fkey` FOREIGN KEY (`ward_id`) REFERENCES `wards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_bank_accounts` ADD CONSTRAINT `member_bank_accounts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_bank_accounts` ADD CONSTRAINT `member_bank_accounts_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
