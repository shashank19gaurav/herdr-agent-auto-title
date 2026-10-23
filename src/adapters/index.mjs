import { copilot } from './copilot.mjs';
import { pi } from './pi.mjs';

// Exact Herdr identifiers only. Title text must never select a harness.
const adapters = new Map([['copilot', copilot], ['pi', pi]]);

export function adapterFor(harness) {
  return adapters.get(harness);
}
