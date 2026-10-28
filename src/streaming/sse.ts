import { limits, StreamFailure, type Metrics } from './contracts.js';

export type Event = { event: string; data: string };
export class EventParser {
  private line = '';
  private lineBytes = 0;
  private eventBytes = 0;
  private data: string[] = [];
  private event = '';
  private skipLF = false;
  constructor(private readonly stats: Metrics) {}

  *push(text: string): Generator<Event> {
    for (const char of text) {
      if (this.skipLF) {
        this.skipLF = false;
        if (char === '\n') continue;
      }
      const bytes = Buffer.byteLength(char);
      if (this.eventBytes + bytes > limits.eventBytes) throw new StreamFailure('STREAM_LIMIT');
      this.eventBytes += bytes;
      this.stats.peak_event_bytes = Math.max(this.stats.peak_event_bytes, this.eventBytes);
      if (char === '\r' || char === '\n') {
        this.skipLF = char === '\r';
        if (this.line === '') {
          const result = this.data.length ? { event: this.event || 'message', data: this.data.join('\n') } : undefined;
          this.eventBytes = 0; this.data = []; this.event = '';
          if (result) yield result;
        } else {
          const colon = this.line.indexOf(':');
          const field = colon === -1 ? this.line : this.line.slice(0, colon);
          let value = colon === -1 ? '' : this.line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'data') this.data.push(value);
          else if (field === 'event') this.event = value;
          // Comments and unused SSE fields count towards limits, but are never forwarded.
        }
        this.line = ''; this.lineBytes = 0;
        continue;
      }
      if (this.lineBytes + bytes > limits.lineBytes) {
        throw new StreamFailure('STREAM_LIMIT');
      }
      this.line += char; this.lineBytes += bytes;
      this.stats.peak_line_bytes = Math.max(this.stats.peak_line_bytes, this.lineBytes);
      this.stats.peak_event_bytes = Math.max(this.stats.peak_event_bytes, this.eventBytes);
    }
  }
}
