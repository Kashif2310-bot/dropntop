import { getUsage } from './usage';
import { isPro } from './subscriptions';

// Per MONETIZATION.md: fire on someone's 4th-5th use, never on their first.
// Combined drop+retrieve count is a simple proxy for "this person is actually
// using the product" without needing a rolling-window query yet.
export const UPGRADE_PROMPT_THRESHOLD = 4;

export function getPaywallStatus(deviceHash: string, dismissed: boolean) {
  const usage = getUsage(deviceHash);
  const pro = isPro(deviceHash);
  const totalActivity = usage.dropCount + usage.retrieveCount;

  return {
    isPro: pro,
    dropCount: usage.dropCount,
    retrieveCount: usage.retrieveCount,
    showUpgradePrompt: !pro && !dismissed && totalActivity >= UPGRADE_PROMPT_THRESHOLD,
  };
}
