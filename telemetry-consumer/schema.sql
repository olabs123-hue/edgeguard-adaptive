-- Cloudflare D1 reliability telemetry; no personal credentials, request payloads or URLs.
CREATE TABLE IF NOT EXISTS reliability_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('origin_attempt_failure','origin_failure','origin_recovery')),
  origin TEXT NOT NULL CHECK(origin IN ('origin-a','origin-b')),
  request_id TEXT NOT NULL,
  http_status INTEGER CHECK(http_status BETWEEN 100 AND 599 OR http_status IS NULL),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reliability_events_type_timestamp
  ON reliability_events(event_type,event_timestamp);
CREATE INDEX IF NOT EXISTS idx_reliability_events_origin_timestamp
  ON reliability_events(origin,event_timestamp);
