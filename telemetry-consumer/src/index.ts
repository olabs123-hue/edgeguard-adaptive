/** Dedicated Cloudflare Queue consumer: idempotent D1 reliability-event recording. */
export type EventType = 'origin_attempt_failure' | 'origin_failure' | 'origin_recovery';
export interface ReliabilityEvent {
  version: 1;
  eventId: string;
  timestamp: string;
  type: EventType;
  origin: string;
  requestId: string;
  status?: number;
}
export interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  run(): Promise<{success: boolean}>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
export interface QueueMessage {
  body: unknown;
  ack(): void;
  retry(): void;
}
export interface QueueBatch { messages: QueueMessage[] }
export interface Env { RELIABILITY_DB: D1Database }
const INSERT = `INSERT INTO reliability_events
(event_id, event_timestamp, event_type, origin, request_id, http_status)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(event_id) DO NOTHING`;
const TYPES = new Set(['origin_attempt_failure', 'origin_failure', 'origin_recovery']);
const ORIGINS = new Set(['origin-a', 'origin-b']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateEvent(data: unknown): ReliabilityEvent | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const e = data as Record<string,unknown>;
  if (e.version !== 1 || typeof e.eventId !== 'string' || !UUID.test(e.eventId)
    || typeof e.timestamp !== 'string' || Number.isNaN(Date.parse(e.timestamp))
    || typeof e.type !== 'string' || !TYPES.has(e.type)
    || typeof e.origin !== 'string' || !ORIGINS.has(e.origin)
    || typeof e.requestId !== 'string' || !UUID.test(e.requestId)) return null;
  if (e.status !== undefined && (!Number.isInteger(e.status) ||
      (e.status as number) < 100 || (e.status as number) > 599)) return null;
  return e as unknown as ReliabilityEvent;
}

export default {
  // The consumer has no public HTTP endpoint. Do not create a route or workers.dev hostname.
  async queue(batch: QueueBatch, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const event = validateEvent(msg.body);
      if (!event) {
        console.error('Dropping malformed reliability telemetry event');
        msg.ack(); // Poison messages should not block the entire queue.
        continue;
      }
      try {
        const result = await env.RELIABILITY_DB.prepare(INSERT).bind(
          event.eventId,
          event.timestamp,
          event.type,
          event.origin,
          event.requestId,
          event.status ?? null
        ).run();
        if (!result.success) throw new Error('D1 insert unsuccessful');
        msg.ack(); // Ack only after durable DB write completed.
      } catch (error) {
        // At-least-once Queue delivery means DB writes must be idempotent.
        console.error('D1 persistence failed; retrying event', event.type);
        msg.retry(); // max_retries + dead_letter_queue in Wrangler.
      }
    }
  }
};
