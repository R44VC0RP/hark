CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text,
	`client` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_user_created_at_idx` ON `feedback` (`user_id`,`created_at`);