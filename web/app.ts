type Catalog = { live: { available: boolean; provider: string; model: string | null }; customers: { id: string; name: string }[]; cases: { id: string; title: string; description: string; issue: string }[] };
function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element ${id}`);
  return value as T;
}
const scenario = element<HTMLSelectElement>('simulation-scenario');
const recover = element<HTMLButtonElement>('recover');
let observedScenario: string | undefined;
const mode = element<HTMLSelectElement>('generation-mode');
const customer = element<HTMLSelectElement>('customer');
const issue = element<HTMLTextAreaElement>('issue');
const draft = element<HTMLTextAreaElement>('draft');
const sampleEmail = element<HTMLInputElement>('sample-email');
const generate = element<HTMLButtonElement>('generate');
const stop = element<HTMLButtonElement>('stop');
const copy = element<HTMLButtonElement>('copy');
const reset = element<HTMLButtonElement>('reset');
const cases = element<HTMLFieldSetElement>('cases');
const notice = element('notice');
const events = element<HTMLOListElement>('events');
let catalog: Catalog | undefined;
let caseType = 'account';
let run = 0;
let controller: AbortController | undefined;
let busy = false;
let started = 0;

function message(text: string, kind = '') { notice.textContent = text; notice.className = `notice ${kind}`; }
function count() { element('issue-count').textContent = `${issue.value.length.toLocaleString('en-US')} / 1,200`; }
function setBusy(value: boolean) {
  busy = value;
  scenario.disabled = mode.disabled = customer.disabled = issue.disabled = cases.disabled = sampleEmail.disabled = value || !catalog;
  sampleEmail.disabled ||= mode.value === 'simulation';
  recover.disabled = value;
  generate.disabled = value || !catalog; generate.hidden = value;
  stop.hidden = !value; draft.readOnly = value;
  copy.disabled = value || !draft.value.trim();
}
function activity(text: string, detail = '', failed = false) {
  events.querySelector('.waiting')?.remove();
  const item = document.createElement('li'); item.textContent = text;
  if (failed) item.className = 'failed';
  if (detail) { const small = document.createElement('small'); small.textContent = detail; item.append(small); }
  events.append(item);
}
function clearOutput() {
  observedScenario = undefined; recover.hidden = true;
  element('simulation-evidence').textContent = 'Run a scenario to observe how the request is handled.';
  draft.value = ''; draft.hidden = true; element('empty-state').hidden = false;
  events.replaceChildren(); const waiting = document.createElement('li'); waiting.className = 'waiting'; waiting.textContent = 'Waiting for your first draft'; events.append(waiting);
  element('verified-name').textContent = 'No lookup yet'; element('verified-plan').textContent = 'Generate a draft to retrieve the profile.';
  for (const id of ['redactions', 'output-bytes', 'elapsed', 'model-tokens', 'budget-available']) element(id).textContent = '—';
  element('draft-status').textContent = 'Ready when you are';
  element('review-note').textContent = 'Review every draft before sharing.';
  copy.textContent = 'Copy draft'; copy.disabled = true;
}
function updateMode() {
  const live = mode.value === 'live';
  const simulation = mode.value === 'simulation';
  element('simulation-controls').hidden = !simulation;
  element('simulation-result').hidden = !simulation;
  element('empty-state').hidden = simulation;
  element('budget-label').textContent = simulation ? 'Simulation budget remaining' : 'Local budget remaining';
  generate.textContent = simulation ? 'Run simulation' : 'Generate draft ↗';
  if (simulation) {
    element('mode-badge').textContent = 'Failure simulation';
    element('data-note').textContent = 'Simulated failure. No cloud AI.';
    element('mode-note').textContent = 'Test how failures are handled using local fixtures and a separate temporary token budget. No Groq requests are sent.';
    element('generation-note').textContent = 'Runs a real customer lookup, then exercises the selected failure. No reply is generated.';
    element('provider-label').textContent = 'Simulated provider';
    element('provider-note').textContent = 'The timeout uses a shortened 1.5-second deadline. Simulation allowances are not real model usage. Each run starts fresh.';
    element('model-tokens').textContent = 'Not measured (simulation)';
    return;
  }
  element('mode-badge').textContent = live ? 'Live AI · Groq' : 'Scripted demo';
  element('data-note').textContent = live ? 'Fictional data. Cloud AI.' : 'Fictional data. No live AI.';
  element('mode-note').textContent = live
    ? 'Your question and the verified name and plan are sent to Groq. Use fictional information only. Email protection applies to generated output.'
    : catalog?.live.available ? 'Live AI is configured. Select it to generate with Groq.' : 'Live AI is unavailable. Set GROQ_API_KEY in the server’s .env file and restart.';
  element('generation-note').textContent = live ? 'Uses your question and the verified profile to generate a reply with AI.' : 'Uses the selected case template and the customer’s verified name and plan.';
  element('provider-label').textContent = live ? `Groq · ${catalog?.live.model ?? ''}` : 'Scripted provider';
  element('provider-note').textContent = live ? 'Use a Groq Free plan account. Limits vary by account. The local token budget is separate from Groq’s quota.' : 'Deterministic templates. No model tokens or API charges.';
}
function selectCase(id: string) {
  const selected = catalog?.cases.find(item => item.id === id);
  if (!selected) return;
  caseType = id; issue.value = selected.issue; count();
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="case"]')) radio.checked = radio.value === id;
}
async function session(signal?: AbortSignal) {
  const response = await fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}', ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error('SESSION_REQUIRED');
}
const errors: Record<string, string> = {
  SESSION_REQUIRED: 'The demo session could not be started. Reload the page and try again.',
  CUSTOMER_NOT_FOUND: 'That customer was not found. Select another demo customer and try again.',
  CUSTOMER_LOOKUP_FAILED: 'Customer lookup failed. Check that the local demo is still running, then try again.',
  INVALID_REQUEST: 'Enter a question between 10 and 1,200 characters and choose a support case.',
  STREAM_CAPACITY: 'All four draft slots are busy. Stop another draft or try again shortly.',
  REQUEST_TIMEOUT: 'The request timed out. You can try generating again.',
  STREAM_TIMEOUT: 'The stream timed out. You can try generating again.',
  INVALID_STREAM: 'The generation stream could not complete. Try generating again.',
  LIVE_UNAVAILABLE: 'Live AI is unavailable. Configure the server API key or select Scripted demo.',
  PROVIDER_RATE_LIMIT: 'Groq’s rate limit was reached. Wait before retrying, or select Scripted demo. No automatic retry was sent.',
  PROVIDER_AUTH: 'Groq rejected access. Check the server API key and model permissions.',
  PROVIDER_REQUEST_REJECTED: 'Groq rejected this request. Check the configured model and account access.',
  PROVIDER_UNAVAILABLE: 'Groq is unavailable. Try later or select Scripted demo.',
  PROVIDER_TIMEOUT: 'Groq timed out. Try later or select Scripted demo.',
  PROVIDER_TRUNCATED: 'The model reached its output limit. This draft is incomplete; try a shorter question.',
  BUDGET_EXHAUSTED: 'The local token budget is full. Wait for capacity or select Scripted demo.',
  BUDGET_UNAVAILABLE: 'The local budget ledger is unavailable. Check the server before using Live AI.',
  USAGE_INVALID: 'Provider usage could not be validated. This request cannot be marked complete.',
};

async function consume(response: Response, signal: AbortSignal, current: number) {
  if (!response.body) throw new Error('INCOMPLETE_STREAM');
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = ''; let completed = false;
  const process = (block: string) => {
    if (current !== run || signal.aborted || completed) return;
    const lines = block.split('\n');
    const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (type === 'status') {
      if (data.step === 'lookup') { activity('Looking up customer', 'Authenticated MCP gateway'); message('Retrieving the selected customer through MCP…'); }
      if (data.step === 'generating' && mode.value === 'simulation') { activity('Running local failure fixture', 'No external model call'); message('Simulation running. The selected failure is intentional.'); }
      else if (data.step === 'generating') { activity(mode.value === 'live' ? 'Generating with Groq' : 'Generating scripted draft', 'Email guardrail active'); message(mode.value === 'live' ? 'Streaming a live AI reply from Groq…' : 'Streaming a deterministic template. No live model is connected.'); }
    } else if (type === 'customer') {
      element('verified-name').textContent = String(data.name);
      element('verified-plan').textContent = `${String(data.plan)} plan · ${String(data.customer_id)}`;
      activity('Customer retrieved', `${String(data.name)} · ${String(data.plan)} plan`);
    } else if (type === 'delta') {
      if (typeof data.text !== 'string' || draft.value.length + data.text.length > 100_000) throw new Error('INVALID_STREAM');
      draft.hidden = false; element('empty-state').hidden = true; draft.value += data.text; draft.scrollTop = draft.scrollHeight;
    } else if (type === 'simulation') {
      if (data.phase === 'started') {
        activity('Simulation started', `${String(data.scenario)} · isolated temporary budget`);
      } else if (data.phase === 'finished') {
        observedScenario = String(data.scenario);
        element('simulation-evidence').textContent = `${String(data.providerCalls)} local simulated provider attempt(s). ${String(data.budgetUsed)} tokens held in the simulation ledger. Cancellation observed: ${data.cancelled ? 'yes' : 'no'}. No Groq request was sent.`;
        activity('Simulation evidence recorded', `${String(data.providerCalls)} simulated attempt(s); no automatic retry`);
      }
      element('budget-available').textContent = Number(data.budgetAvailable).toLocaleString('en-US');
    } else if (type === 'usage' && data.provider === 'simulated') {
      element('model-tokens').textContent = 'Not measured (simulation)';
      element('budget-available').textContent = Number(data.budgetAvailable).toLocaleString('en-US');
      activity('Simulation allowance retained', `${String(data.reservedTokens)} estimated tokens; no real model usage or charge`);
    } else if (type === 'usage') {
      element('model-tokens').textContent = data.status === 'known' ? `${String(data.inputTokens)} / ${String(data.outputTokens)}` : 'Unknown';
      element('budget-available').textContent = Number(data.budgetAvailable).toLocaleString('en-US');
      activity(data.status === 'known' ? 'Model usage recorded' : 'Model usage unavailable', data.status === 'known'
        ? `${String(data.chargedTokens)} tokens charged to the local budget`
        : `${String(data.reservedTokens)} tokens retained in the local budget; this is an allowance, not measured usage`);
    } else if (type === 'metrics') {
      element('redactions').textContent = String(data.redactions);
      element('output-bytes').textContent = Number(data.outputBytes).toLocaleString('en-US');
      activity('Output protection checked', `${String(data.redactions)} email token(s) redacted`);
    } else if (type === 'error') { throw new Error(String(data.code)); }
    else if (type === 'done') {
      completed = true; activity('Draft ready for review');
      element('draft-status').textContent = 'Ready to edit';
      message('Draft complete. Review and edit the text before copying.', 'success');
    }
  };
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      if (signal.aborted || current !== run) return;
      if (done) { decoder.decode(); break; }
      pending += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        if (boundary > 65_536) throw new Error('INVALID_STREAM');
        process(pending.slice(0, boundary)); pending = pending.slice(boundary + 2);
      }
      if (pending.length > 65_536) throw new Error('INVALID_STREAM');
    }
    if (!completed) throw new Error('INCOMPLETE_STREAM');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

element<HTMLFormElement>('draft-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || !catalog) return;
  if (issue.value.trim().length < 10) { message(errors.INVALID_REQUEST!, 'error'); issue.focus(); return; }
  const current = ++run; const control = new AbortController(); controller = control;
  clearOutput(); updateMode(); setBusy(true); started = performance.now();
  element('draft-status').textContent = 'Generating'; message('Starting the local demo session…');
  const timer = setInterval(() => { if (current === run) element('elapsed').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`; }, 100);
  void (async () => {
    try {
      await session(control.signal);
      const response = await fetch('/copilot/draft', { method: 'POST', credentials: 'same-origin', signal: control.signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ mode: mode.value, ...(mode.value === 'simulation' ? { scenario: scenario.value } : {}), customerId: customer.value, caseType, issue: issue.value, includeSampleEmail: sampleEmail.checked }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { code?: string } };
        throw new Error(body.error?.code ?? 'DRAFT_FAILED');
      }
      await consume(response, control.signal, current);
    } catch (error) {
      if (current !== run) return;
      if (control.signal.aborted) {
        element('draft-status').textContent = 'Stopped · incomplete';
        message((draft.value ? 'Generation stopped. The partial draft is incomplete and can be edited.' : 'Generation stopped. No draft text was received.') + (mode.value === 'live' ? ' Live usage may be unknown; its allowance is retained.' : ''));
        element('review-note').textContent = 'Partial draft. Check for missing information.';
        activity('Generation stopped', 'The active request was cancelled');
      } else {
        const code = error instanceof Error ? error.message : 'DRAFT_FAILED';
        const expected: Record<string, string> = { 'rate-limit': 'PROVIDER_RATE_LIMIT', timeout: 'STREAM_TIMEOUT', 'budget-exhausted': 'BUDGET_EXHAUSTED' };
        if (mode.value === 'simulation' && observedScenario === scenario.value && expected[scenario.value] === code) {
          const explanations: Record<string, string> = {
            'rate-limit': 'Simulated 429 handled. No retry or fallback was started; the unknown allowance was retained in the temporary ledger.',
            timeout: 'Simulated timeout handled. The pending operation was cancelled and its unknown allowance retained.',
            'budget-exhausted': 'Simulated budget rejection handled. Admission stopped the request before any provider attempt.',
          };
          message(explanations[scenario.value]!, 'success');
          element('draft-status').textContent = 'Scenario demonstrated';
          element('review-note').textContent = 'Intentional simulated failure. No draft was generated.';
          activity('Expected failure handled', code); recover.hidden = false;
          return;
        }
        message(errors[code] ?? 'The draft could not complete. Check the connection and try again.', 'error');
        element('draft-status').textContent = 'Could not complete';
        element('review-note').textContent = draft.value ? 'Incomplete draft. Review before use.' : 'No complete draft was generated.';
        activity('Request could not complete', '', true);
      }
    } finally {
      clearInterval(timer);
      if (current === run) { controller = undefined; setBusy(false); }
    }
  })();
});
stop.addEventListener('click', () => controller?.abort());
reset.addEventListener('click', () => {
  ++run; controller?.abort(); controller = undefined;
  clearOutput(); mode.value = 'scripted'; scenario.value = 'rate-limit'; updateMode(); customer.selectedIndex = 0; sampleEmail.checked = true; selectCase('account'); setBusy(false);
  message('Demo reset. Choose a customer and generate a new draft.'); issue.focus();
});
mode.addEventListener('change', () => { ++run; clearOutput(); updateMode(); setBusy(false); message('Mode selected. Generate a new draft.'); });
scenario.addEventListener('change', () => { ++run; clearOutput(); updateMode(); setBusy(false); message('Simulation selected. Run it to inspect the result.'); });
recover.addEventListener('click', () => { ++run; clearOutput(); mode.value = 'scripted'; updateMode(); setBusy(false); message('Scripted recovery selected. Generate a new draft to demonstrate recovery.'); });
issue.addEventListener('input', count);
draft.addEventListener('input', () => { copy.disabled = busy || !draft.value.trim(); if (!busy) element('draft-status').textContent = 'Edited by you'; copy.textContent = 'Copy draft'; });
copy.addEventListener('click', () => {
  const current = run; const text = draft.value;
  void (async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (current === run && draft.value === text) copy.textContent = 'Copied';
    } catch {
      if (current !== run || draft.value !== text) return;
      draft.focus(); draft.select(); message('Clipboard access is unavailable. The draft is selected so you can copy it manually.');
    }
  })();
});
window.addEventListener('pagehide', () => controller?.abort());
async function initialize() {
  try {
    await session();
    const response = await fetch('/api/catalog', { credentials: 'same-origin' });
    if (!response.ok) throw new Error();
    catalog = await response.json() as Catalog;
    customer.replaceChildren();
    for (const item of catalog.customers) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; customer.append(option); }
    for (const item of catalog.cases) {
      const wrapper = document.createElement('div'); wrapper.className = 'case-choice';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'case'; radio.id = `case-${item.id}`; radio.value = item.id;
      const label = document.createElement('label'); label.htmlFor = radio.id;
      const title = document.createElement('strong'); title.textContent = item.title;
      const description = document.createElement('span'); description.textContent = item.description;
      label.append(title, description); wrapper.append(radio, label); element('case-list').append(wrapper);
      radio.addEventListener('change', () => { if (radio.checked) selectCase(item.id); });
    }
    mode.querySelector<HTMLOptionElement>('option[value="live"]')!.disabled = !catalog.live.available;
    updateMode(); selectCase('account'); setBusy(false); reset.disabled = false;
    message('Choose a customer and case, then generate a draft.');
  } catch { message('Could not connect to the local demo. Start the server and reload this page.', 'error'); }
}
void initialize();
export {};
