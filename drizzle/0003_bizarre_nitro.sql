ALTER TABLE `users` ADD `notifyTasks` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notifyWithdrawals` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notifySystem` int DEFAULT 1 NOT NULL;