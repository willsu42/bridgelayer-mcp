import { StreamFailure } from './contracts.js';

export class ByteDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  decode(chunk?: Uint8Array): string {
    try { return chunk === undefined ? this.decoder.decode() : this.decoder.decode(chunk, { stream: true }); }
    catch { throw new StreamFailure('INVALID_STREAM'); }
  }
}
