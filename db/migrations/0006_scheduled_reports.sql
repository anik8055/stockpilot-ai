-- Scheduled weekly report emails (opt-in per workspace).
ALTER TABLE businesses ADD COLUMN weekly_report_email boolean NOT NULL DEFAULT false;
GRANT UPDATE (weekly_report_email) ON businesses TO stockpilot_app;

ALTER TABLE reports ADD COLUMN scheduled boolean NOT NULL DEFAULT false;
-- At most one scheduled report per workspace per week, so a scheduler that fires twice sends one email.
CREATE UNIQUE INDEX reports_scheduled_week_uidx ON reports (business_id, period_start) WHERE scheduled;
