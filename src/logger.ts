type LogEvent = {
  event: string;
  request_id?: string | number;
  tool?: 'get_customer_record' | 'trigger_refund' | 'unknown';
  outcome?: 'success' | 'rejected' | 'business_error' | 'internal_error';
};

// Explicit fields prevent accidental logging of tokens, customer records, or reasons.
export function log(event: LogEvent): void {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}
