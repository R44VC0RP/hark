ALTER TABLE `analytics_event` ADD `client_event_id` text;--> statement-breakpoint
ALTER TABLE `analytics_event` ADD `anonymous_id` text;--> statement-breakpoint
ALTER TABLE `analytics_event` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `analytics_event` ADD `surface` text;--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_event_client_event_id_unique` ON `analytics_event` (`client_event_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_anonymous_created_at_idx` ON `analytics_event` (`anonymous_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_event_session_created_at_idx` ON `analytics_event` (`session_id`,`created_at`);