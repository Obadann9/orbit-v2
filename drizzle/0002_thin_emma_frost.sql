CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('task','withdrawal','system') NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` varchar(255) NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
