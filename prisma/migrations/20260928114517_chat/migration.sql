-- CreateTable
CREATE TABLE `conversations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(120) NULL,
    `description` VARCHAR(255) NULL,
    `scope_type` VARCHAR(10) NULL,
    `scope_id` INTEGER NULL,
    `auto_key` VARCHAR(40) NULL,
    `direct_key` VARCHAR(80) NULL,
    `created_by` CHAR(36) NULL,
    `last_message_id` BIGINT NULL,
    `last_message_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `conversations_tenant_id_scope_type_scope_id_idx`(`tenant_id`, `scope_type`, `scope_id`),
    UNIQUE INDEX `conversations_tenant_id_auto_key_key`(`tenant_id`, `auto_key`),
    UNIQUE INDEX `conversations_tenant_id_direct_key_key`(`tenant_id`, `direct_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_members` (
    `conversation_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'member',
    `muted_until` DATETIME(3) NULL,
    `last_read_message_id` BIGINT NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `conversation_members_tenant_id_member_id_idx`(`tenant_id`, `member_id`),
    PRIMARY KEY (`conversation_id`, `member_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `sender_member_id` CHAR(36) NOT NULL,
    `client_id` VARCHAR(64) NULL,
    `body` TEXT NOT NULL,
    `reply_to_id` BIGINT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_conversation_id_id_idx`(`conversation_id`, `id`),
    UNIQUE INDEX `messages_sender_member_id_client_id_key`(`sender_member_id`, `client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_reports` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `message_id` BIGINT NOT NULL,
    `reporter_member_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_reports_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `message_reports_message_id_reporter_member_id_key`(`message_id`, `reporter_member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_members` ADD CONSTRAINT `conversation_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_members` ADD CONSTRAINT `conversation_members_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_members` ADD CONSTRAINT `conversation_members_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_member_id_fkey` FOREIGN KEY (`sender_member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_reply_to_id_fkey` FOREIGN KEY (`reply_to_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reports` ADD CONSTRAINT `message_reports_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reports` ADD CONSTRAINT `message_reports_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reports` ADD CONSTRAINT `message_reports_reporter_member_id_fkey` FOREIGN KEY (`reporter_member_id`) REFERENCES `tenant_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
