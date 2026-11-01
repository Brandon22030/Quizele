CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`owner_id` text NOT NULL,
	`quiz_id` text,
	`quiz_title` text NOT NULL,
	`mode` text NOT NULL,
	`show_correct_answer` integer NOT NULL,
	`shuffle` integer NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "game_sessions_mode_check" CHECK("mode" IN ('together', 'own_pace')),
	CONSTRAINT "game_sessions_status_check" CHECK("status" IN ('lobby', 'running', 'ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_sessions_active_code_idx` ON `game_sessions` (`code`) WHERE "game_sessions"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX `game_sessions_owner_idx` ON `game_sessions` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `game_sessions_created_idx` ON `game_sessions` (`created_at`);--> statement-breakpoint
CREATE INDEX `game_sessions_ended_idx` ON `game_sessions` (`ended_at`);--> statement-breakpoint
CREATE INDEX `game_sessions_quiz_idx` ON `game_sessions` (`quiz_id`);--> statement-breakpoint
CREATE TABLE `options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "options_label_length_check" CHECK(length("label") <= 200)
);
--> statement-breakpoint
CREATE INDEX `options_question_position_idx` ON `options` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `question_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`prompt` text NOT NULL,
	`correct_labels` text NOT NULL,
	`reference` text,
	`answer_count` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`distribution` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_stats_session_position_idx` ON `question_stats` (`session_id`,`position`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`duration_sec` integer DEFAULT 20 NOT NULL,
	`reference` text,
	`explanation` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "questions_type_check" CHECK("type" IN ('single', 'multiple', 'true_false')),
	CONSTRAINT "questions_duration_check" CHECK("duration_sec" IN (10, 20, 30, 60)),
	CONSTRAINT "questions_prompt_length_check" CHECK(length("prompt") <= 300)
);
--> statement-breakpoint
CREATE INDEX `questions_quiz_position_idx` ON `questions` (`quiz_id`,`position`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text,
	`category` text,
	`mode` text DEFAULT 'together' NOT NULL,
	`show_correct_answer` integer DEFAULT true NOT NULL,
	`shuffle` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quizzes_mode_check" CHECK("mode" IN ('together', 'own_pace'))
);
--> statement-breakpoint
CREATE INDEX `quizzes_owner_idx` ON `quizzes` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `session_players` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`pseudo` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`total_time_ms` integer DEFAULT 0 NOT NULL,
	`rank` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_players_pseudo_length_check" CHECK(length("pseudo") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_players_session_rank_idx` ON `session_players` (`session_id`,`rank`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);