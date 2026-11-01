import { parentPort, workerData } from 'node:worker_threads';
import { TokenBudget } from '../../src/resilience/budget.js';
const store = new TokenBudget(workerData.path as string, { tokens: 1000 });
parentPort!.postMessage('ready');
parentPort!.once('message', () => {
  try { store.reserve('tenant', 600, 'primary'); parentPort!.postMessage('accepted'); }
  catch (error) { parentPort!.postMessage((error as { code: string }).code); }
  finally { store.close(); parentPort!.close(); }
});
