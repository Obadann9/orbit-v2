CREATE TABLE `kycRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`requestedBy` int NOT NULL,
	`status` enum('requested','submitted','under_review','approved','rejected') NOT NULL DEFAULT 'requested',
	`reason` varchar(255),
	`reviewerNote` varchar(500),
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`submittedAt` timestamp,
	`reviewedAt` timestamp,
	`reviewedBy` int,
	CONSTRAINT `kycRequests_id` PRIMARY KEY(`id`)
);
