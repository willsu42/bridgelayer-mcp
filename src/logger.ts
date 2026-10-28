export type LogEvent = {
  event: string;
  request_id?: string | number;
  tool?: 'get_customer_record' | 'trigger_refund' | 'admin_health_check' | 'unknown';
  outcome?: 'success' | 'rejected' | 'business_error' | 'internal_error' | 'cancelled' | 'timeout';
  duration_ms?: number;
  input_bytes?: number; output_bytes?: number; redactions?: number; suppressions?: number;
  peak_token_bytes?: number; peak_line_bytes?: number; peak_event_bytes?: number; peak_output_bytes?: number; peak_frame_bytes?: number;
};

// Explicit fields prevent accidental logging of tokens, customer records, or reasons.
export function log(event: LogEvent): void {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}
