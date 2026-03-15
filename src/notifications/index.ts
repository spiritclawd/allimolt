/**
 * AlliGo - Notification Service
 * Centralized notification dispatch
 */

import { sendNewClaimNotification, sendWeeklyDigest } from '../email/index';
import { triggerClaimCreated, triggerClaimVerified } from '../webhooks/index';
import { sendClaimAlert, sendDailyStats, sendLeaderboardUpdate } from '../telegram/index';

interface Claim {
  id: string;
  agentId: string;
  agentName?: string;
  title: string;
  description: string;
  amountLost: number;
  claimType: string;
  category: string;
  chain?: string;
  platform?: string;
  verified: boolean;
}

interface NotificationConfig {
  email: boolean;
  webhooks: boolean;
  telegram: boolean;
  minAmount?: number;
}

const defaultConfig: NotificationConfig = {
  email: true,
  webhooks: true,
  telegram: true,
  minAmount: 1000, // Lowered to $1000 for testing
};

/**
 * Notify all channels about a new claim
 */
export async function notifyNewClaim(
  claim: Claim,
  config: NotificationConfig = defaultConfig
): Promise<{ email: boolean; webhooks: boolean; telegram: boolean }> {
  const results = { email: false, webhooks: false, telegram: false };

  if (config.minAmount && claim.amountLost < config.minAmount) {
    console.log(`Claim ${claim.id} below notification threshold`);
    return results;
  }

  const promises: Promise<void>[] = [];

  if (config.email) {
    promises.push(
      (async () => {
        try {
          const subscribers = process.env.ALERT_RECIPIENTS?.split(',').map(email => ({ email })) || [];
          if (subscribers.length > 0) {
            await sendNewClaimNotification(subscribers, claim);
            results.email = true;
          }
        } catch (e) {
          console.error('Email notification failed:', e);
        }
      })()
    );
  }

  if (config.webhooks) {
    promises.push(
      (async () => {
        try {
          await triggerClaimCreated(claim);
          results.webhooks = true;
        } catch (e) {
          console.error('Webhook notification failed:', e);
        }
      })()
    );
  }

  if (config.telegram) {
    promises.push(
      (async () => {
        try {
          const result = await sendClaimAlert(claim);
          results.telegram = result.success;
        } catch (e) {
          console.error('Telegram notification failed:', e);
        }
      })()
    );
  }

  await Promise.allSettled(promises);
  return results;
}

/**
 * Send weekly digest to all subscribers
 */
export async function sendWeeklyDigestToSubscribers(stats: {
  totalClaims: number;
  totalValueLost: number;
  topAgents: Array<{ agentId: string; name?: string; valueLost: number }>;
  topCategories: Record<string, number>;
}): Promise<void> {
  const subscribers = process.env.DIGEST_RECIPIENTS?.split(',').map(email => ({ email })) || [];

  for (const subscriber of subscribers) {
    try {
      await sendWeeklyDigest(subscriber, stats);
    } catch (e) {
      console.error(`Failed to send digest:`, e);
    }
  }
}

/**
 * Send daily stats to Telegram
 */
export async function sendDailyStatsToTelegram(stats: {
  totalClaims: number;
  totalValueLost: number;
  claimsToday: number;
  valueLostToday: number;
  topCategory: string;
  topChain: string;
}): Promise<boolean> {
  try {
    const result = await sendDailyStats(stats);
    return result.success;
  } catch (e) {
    console.error('Failed to send Telegram daily stats:', e);
    return false;
  }
}

/**
 * Send leaderboard update to Telegram
 */
export async function sendLeaderboardToTelegram(agents: Array<{
  agentId: string;
  agentName?: string;
  claims: number;
  valueLost: number;
}>): Promise<boolean> {
  try {
    const result = await sendLeaderboardUpdate(agents);
    return result.success;
  } catch (e) {
    console.error('Failed to send Telegram leaderboard:', e);
    return false;
  }
}

export default { notifyNewClaim, sendWeeklyDigestToSubscribers, sendDailyStatsToTelegram, sendLeaderboardToTelegram };
