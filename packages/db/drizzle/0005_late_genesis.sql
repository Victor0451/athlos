DROP INDEX "uq_notifications_event_id";--> statement-breakpoint
CREATE INDEX "idx_notifications_event_id" ON "notifications" USING btree ("event_id");