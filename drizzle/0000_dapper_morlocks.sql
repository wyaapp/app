CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_handle_unique` ON `profiles` (`handle`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_user_version` ON `revisions` (`user_id`,`version`);