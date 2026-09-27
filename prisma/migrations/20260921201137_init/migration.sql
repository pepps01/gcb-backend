-- CreateTable
CREATE TABLE `tenants` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(60) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `tenant_type` VARCHAR(40) NOT NULL DEFAULT 'campaign',
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `plan` VARCHAR(30) NOT NULL DEFAULT 'standard',
    `custom_domain` VARCHAR(200) NULL,
    `subdomain` VARCHAR(60) NOT NULL,
    `country_code` CHAR(2) NOT NULL DEFAULT 'NG',
    `default_language` VARCHAR(10) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(50) NOT NULL DEFAULT 'Africa/Lagos',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    UNIQUE INDEX `tenants_custom_domain_key`(`custom_domain`),
    UNIQUE INDEX `tenants_subdomain_key`(`subdomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_branding` (
    `tenant_id` CHAR(36) NOT NULL,
    `app_name` VARCHAR(100) NULL,
    `tagline` VARCHAR(200) NULL,
    `logo_url` TEXT NULL,
    `primary_color` CHAR(7) NULL DEFAULT '#0B6E4F',
    `secondary_color` CHAR(7) NULL DEFAULT '#F2A900',
    `accent_color` CHAR(7) NULL,
    `text_color` CHAR(7) NULL DEFAULT '#111111',
    `font_family` VARCHAR(60) NULL DEFAULT 'Inter',
    `sms_sender_id` VARCHAR(11) NULL,
    `support_phone` VARCHAR(20) NULL,
    `support_email` VARCHAR(200) NULL,
    `social_links` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tenant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_features` (
    `tenant_id` CHAR(36) NOT NULL,
    `feature_key` VARCHAR(80) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NULL,

    PRIMARY KEY (`tenant_id`, `feature_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `phone_verified_at` DATETIME(3) NULL,
    `email` VARCHAR(200) NULL,
    `password_hash` TEXT NULL,
    `full_name` VARCHAR(200) NULL,
    `photo_url` TEXT NULL,
    `preferred_lang` VARCHAR(10) NULL DEFAULT 'en',
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_members` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` VARCHAR(40) NOT NULL DEFAULT 'supporter',
    `level` VARCHAR(30) NULL DEFAULT 'Supporter',
    `lga_id` INTEGER NULL,
    `ward_id` INTEGER NULL,
    `polling_unit_id` INTEGER NULL,
    `referral_code` VARCHAR(12) NULL,
    `referred_by` CHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verified_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_members_referral_code_key`(`referral_code`),
    INDEX `tenant_members_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `tenant_members_tenant_id_user_id_key`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_submissions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `nin_hash` CHAR(64) NULL,
    `vin_hash` CHAR(64) NULL,
    `nin_slip_url` TEXT NULL,
    `pvc_url` TEXT NULL,
    `lga_id` INTEGER NULL,
    `ward_id` INTEGER NULL,
    `polling_unit_id` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `rejection_reason` TEXT NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kyc_submissions_tenant_id_member_id_created_at_idx`(`tenant_id`, `member_id`, `created_at`),
    UNIQUE INDEX `kyc_submissions_tenant_id_nin_hash_key`(`tenant_id`, `nin_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `balance_kobo` BIGINT NOT NULL DEFAULT 0,
    `currency` CHAR(3) NULL DEFAULT 'NGN',
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallets_tenant_id_member_id_key`(`tenant_id`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_transactions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `wallet_id` CHAR(36) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `amount_kobo` BIGINT NOT NULL,
    `balance_after` BIGINT NOT NULL,
    `reference` VARCHAR(100) NOT NULL,
    `source` VARCHAR(40) NULL,
    `source_id` CHAR(36) NULL,
    `narration` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallet_transactions_reference_key`(`reference`),
    INDEX `wallet_transactions_wallet_id_created_at_idx`(`wallet_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_batches` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `total_amount_kobo` BIGINT NOT NULL,
    `recipient_count` INTEGER NOT NULL,
    `filter_json` JSON NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `gift_batches_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gifts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NULL,
    `recipient_member_id` CHAR(36) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `amount_kobo` BIGINT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `gifts_tenant_id_recipient_member_id_created_at_idx`(`tenant_id`, `recipient_member_id`, `created_at`),
    INDEX `gifts_batch_id_idx`(`batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incidents` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `reporter_member_id` CHAR(36) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `severity` VARCHAR(20) NOT NULL DEFAULT 'medium',
    `title` VARCHAR(200) NULL,
    `description` TEXT NULL,
    `media_urls` JSON NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `lga_id` INTEGER NULL,
    `ward_id` INTEGER NULL,
    `polling_unit_id` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `incidents_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `actor_user_id` CHAR(36) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity_type` VARCHAR(60) NULL,
    `entity_id` CHAR(36) NULL,
    `after_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_branding` ADD CONSTRAINT `tenant_branding_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_features` ADD CONSTRAINT `tenant_features_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_members` ADD CONSTRAINT `tenant_members_referred_by_fkey` FOREIGN KEY (`referred_by`) REFERENCES `tenant_members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_submissions` ADD CONSTRAINT `kyc_submissions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_submissions` ADD CONSTRAINT `kyc_submissions_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_submissions` ADD CONSTRAINT `kyc_submissions_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_wallet_id_fkey` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_batches` ADD CONSTRAINT `gift_batches_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_batches` ADD CONSTRAINT `gift_batches_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_batches` ADD CONSTRAINT `gift_batches_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gifts` ADD CONSTRAINT `gifts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gifts` ADD CONSTRAINT `gifts_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `gift_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gifts` ADD CONSTRAINT `gifts_recipient_member_id_fkey` FOREIGN KEY (`recipient_member_id`) REFERENCES `tenant_members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_reporter_member_id_fkey` FOREIGN KEY (`reporter_member_id`) REFERENCES `tenant_members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
