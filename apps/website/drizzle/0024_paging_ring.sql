CREATE TABLE `oncall_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ring_until_acknowledged` integer DEFAULT true NOT NULL,
	`ring_interval_seconds` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `device` ADD `critical_alerts` text;--> statement-breakpoint
ALTER TABLE `oncall_group` ADD `ring_interval_seconds` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_group` ADD `ring_max_repeats` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_page_recipient` ADD `previous_response_token_hash` text;--> statement-breakpoint
ALTER TABLE `oncall_page_recipient` ADD `ring_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_page_recipient` ADD `next_ring_at` integer;--> statement-breakpoint
CREATE INDEX `oncall_page_recipient_ring_idx` ON `oncall_page_recipient` (`next_ring_at`);