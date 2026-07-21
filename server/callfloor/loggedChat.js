/**
 * callfloor/loggedChat.js — the ONLY door Mode 2 code may use for chat-completion LLM calls.
 *
 * Wraps Mode 1's shared chatWithFailover (imported, never modified): same arguments, same
 * return value, same failure semantics — plus every call is priced from the price book and
 * recorded to ai_usage_events. Cost logging is fire-safe: a logging failure never reaches the
 * caller (usage.js already never throws).
 */

import { chatWithFailover } from '../llmFailover.js';
import { priceChatUsage } from './pricebook.config.js';
import { recordAiUsage } from './usage.js';

/**
 * loggedChat(chatOpts, { userId, feature }) → chatWithFailover's exact result.
 * `_chat` is a test seam (defaults to the real client).
 */
export async function loggedChat(chatOpts, { userId = 'system', feature = 'callfloor', _chat = chatWithFailover } = {}) {
  const res = await _chat(chatOpts);
  const [provider = 'unknown', model = 'unknown'] = String(res?.provider || '').split(':');
  const priced = priceChatUsage(res?.provider, res?.usage);
  await recordAiUsage({
    userId, feature, provider, model,
    unitType: 'tokens',
    unitsIn:  priced.unitsIn,
    unitsOut: priced.unitsOut,
    usdActual: priced.usdActual,
    usdList:   priced.usdList,
    measured: true,
    meta: priced.known ? null : { unpriced: true, providerString: res?.provider || null },
  });
  return res;
}

export default { loggedChat };
