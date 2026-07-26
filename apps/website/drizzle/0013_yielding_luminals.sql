CREATE TABLE `agent_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requester_token_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`image_url` text,
	`url` text,
	`status` text NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`idempotency_key` text,
	`request_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_notification_token_idempotency_key_unique` ON `agent_notification` (`requester_token_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_notification_user_created_at_idx` ON `agent_notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_token_created_at_idx` ON `agent_notification` (`requester_token_id`,`created_at`);