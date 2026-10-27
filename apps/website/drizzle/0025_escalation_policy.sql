CREATE TABLE `oncall_page_event` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`kind` text NOT NULL,
	`level` integer,
	`loop` integer,
	`user_ids` text NOT NULL,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `oncall_page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `oncall_page_event_page_idx` ON `oncall_page_event` (`page_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `oncall_group` ADD `escalation_mode` text DEFAULT 'fan_out' NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_group` ADD `escalation_loops` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_group` ADD `escalation_final` text DEFAULT 'none' NOT NULL;