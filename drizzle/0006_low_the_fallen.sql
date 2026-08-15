CREATE TABLE `offerwallPostbacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`providerId` int NOT NULL,
	`providerTransactionId` varchar(191) NOT NULL,
	`userId` int NOT NULL,
	`amount` int NOT NULL,
	`offerName` varchar(255),
	`payloadHash` varchar(64) NOT NULL,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `offerwallPostbacks_id` PRIMARY KEY(`id`),
	CONSTRAINT `offerwall_provider_transaction_idx` UNIQUE(`providerId`,`providerTransactionId`)
);
--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `providerKey` varchar(64);--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `secretEnvKey` varchar(128);--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `signatureMode` enum('hmac_body','hmac_query') DEFAULT 'hmac_body' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `signatureHeader` varchar(80) DEFAULT 'x-orbit-signature' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `signatureField` varchar(80) DEFAULT 'signature' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `transactionIdField` varchar(80) DEFAULT 'transactionId' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `userIdField` varchar(80) DEFAULT 'userId' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `amountField` varchar(80) DEFAULT 'amount' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `offerNameField` varchar(80) DEFAULT 'offerName' NOT NULL;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD `allowedIps` text;--> statement-breakpoint
ALTER TABLE `offerProviders` ADD CONSTRAINT `offer_provider_key_idx` UNIQUE(`providerKey`);