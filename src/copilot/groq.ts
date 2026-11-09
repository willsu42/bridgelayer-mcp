import { z } from 'zod';
import { ByteDecoder } from '../streaming/decoder.js';
import { EventParser } from '../streaming/sse.js';
import { limits, metrics, StreamFailure } from '../streaming/contracts.js';
import { frame } from '../streaming/provider.js';
import type { Usage } from '../resilience/budget.js';
import type { Attempt } from '../resilience/provider.js';
import type { GenerationProvider } from './generation.js';

export const groqModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'] as const;
export const defaultGroqModel = groqModels[0];
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount, total_tokens: tokenCount });
const chunkSchema = z.object({
  choices: z.array(z.object({ index: z.literal(0), delta: z.object({
    content: z.string().nullable().optional(), reasoning: z.string().nullable().optional(),
    tool_calls: z.unknown().optional(), function_call: z.unknown().optional(),
  }), finish_reason: z.enum(['stop', 'length', 'tool_calls', 'function_call', 'content_filter']).nullable() })).max(1),
  usage: z.unknown().optional(), x_groq: z.object({ usage: z.unknown().optional() }).optional(),
});

// No SDK retry layer, redirects, arbitrary endpoints, or model-selected tools.
export class GroqProvider implements GenerationProvider {
  readonly model: string;
  constructor(private readonly options: { apiKey: string; model?: string; fetch?: typeof fetch }) {
    this.model = options.model ?? defaultGroqModel;
    if (!options.apiKey.trim() || /[\r\n]/.test(options.apiKey) || !groqModels.some(model => model === this.model)) {
      throw new Error('Invalid Groq configuration');
    }
  }
  open(input: Parameters<GenerationProvider['open']>[0]): Attempt {
    let finalUsage: Usage | undefined;
    const { options, model } = this;
    return { usage: () => finalUsage, bytes: (async function* () {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let response: Response | undefined;
      try {
        input.signal.throwIfAborted();
        response = await (options.fetch ?? fetch)('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', redirect: 'error', signal: input.signal,
          headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ model, messages: input.messages, stream: true, n: 1,
            max_completion_tokens: input.maxOutputTokens, reasoning_effort: 'low', include_reasoning: false }),
        });
        if (!response.ok) {
          const code = response.status === 429 ? 'PROVIDER_RATE_LIMIT' : [401, 403].includes(response.status) ? 'PROVIDER_AUTH' :
            response.status === 408 || response.status === 504 ? 'PROVIDER_TIMEOUT' : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED';
          // Never read or forward provider error bodies, which can contain input or credentials.
          throw new StreamFailure(code);
        }
        if (!response.body || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'text/event-stream') throw new StreamFailure('INVALID_STREAM');
        reader = response.body.getReader();
        const decoder = new ByteDecoder(); const parser = new EventParser(metrics());
        let received = 0; let emptyChunks = 0; let finish: string | undefined; let hasText = false;
        let candidate: Usage | undefined;
        while (true) {
          input.signal.throwIfAborted();
          const item = await reader.read();
          if (item.done) { decoder.decode(); throw new StreamFailure('INVALID_STREAM'); }
          received += item.value.byteLength;
          emptyChunks = item.value.byteLength === 0 ? emptyChunks + 1 : 0;
          if (received > limits.totalBytes || emptyChunks > limits.emptyChunks) throw new StreamFailure('STREAM_LIMIT');
          // Network reads may exceed the guardrail chunk limit. Parse bounded slices, with backpressure.
          for (let offset = 0; offset < item.value.length; offset += limits.chunkBytes) {
            for (const event of parser.push(decoder.decode(item.value.subarray(offset, offset + limits.chunkBytes)))) {
              input.signal.throwIfAborted();
              if (event.event !== 'message') throw new StreamFailure('INVALID_STREAM');
              if (event.data === '[DONE]') {
                if (!finish) throw new StreamFailure('INVALID_STREAM');
                finalUsage = candidate;
                if (finish === 'length') throw new StreamFailure('PROVIDER_TRUNCATED');
                if (finish !== 'stop' || !hasText) throw new StreamFailure('INVALID_STREAM');
                yield Buffer.from(frame('done', {})); return;
              }
              const chunk = chunkSchema.parse(JSON.parse(event.data));
              for (const raw of [chunk.usage, chunk.x_groq?.usage]) {
                if (raw === undefined || raw === null) continue;
                if (!finish && !chunk.choices[0]?.finish_reason) throw new StreamFailure('USAGE_INVALID');
                const parsed = usageSchema.safeParse(raw);
                if (!parsed.success) throw new StreamFailure('USAGE_INVALID');
                const next = { input: parsed.data.prompt_tokens, output: parsed.data.completion_tokens };
                if (!Number.isSafeInteger(next.input + next.output) || next.input + next.output !== parsed.data.total_tokens ||
                  (candidate && (candidate.input !== next.input || candidate.output !== next.output))) throw new StreamFailure('USAGE_INVALID');
                candidate = next;
              }
              const choice = chunk.choices[0];
              if (!choice) continue;
              if (finish || choice.delta.tool_calls != null || choice.delta.function_call != null) throw new StreamFailure('INVALID_STREAM');
              const content = choice.delta.content;
              if (content) {
                if (/[\uD800-\uDFFF]/u.test(content)) throw new StreamFailure('INVALID_STREAM');
                hasText ||= !!content.trim();
                // Escape-heavy JSON can expand several times. Bound normalized frames as well.
                const chars = Array.from(content);
                for (let index = 0; index < chars.length; index += 1024) {
                  yield Buffer.from(frame('delta', { text: chars.slice(index, index + 1024).join('') }));
                }
              }
              if (choice.finish_reason !== null) finish = choice.finish_reason;
            }
          }
        }
      } catch (error) {
        if (input.signal.aborted) throw new StreamFailure('CANCELLED');
        if (error instanceof StreamFailure) throw error;
        throw new StreamFailure(error instanceof SyntaxError || error instanceof z.ZodError ? 'INVALID_STREAM' : 'PROVIDER_UNAVAILABLE');
      } finally {
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        else await response?.body?.cancel().catch(() => {});
      }
    })() };
  }
}
