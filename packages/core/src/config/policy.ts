import { z } from 'zod';

/**
 * Economic policy schemas. Defaults mirror docs/ECONOMICS.md §12 exactly.
 * Nothing in the app or program may hard-code these numbers; they flow from
 * a validated policy object.
 */

const bps = z.number().int().min(0).max(10_000);
const secs = z.number().int().min(0);

export const FeeSplitSchema = z
  .object({
    rewardPoolBps: bps,
    protocolBps: bps,
    creatorBps: bps,
  })
  .refine((s) => s.rewardPoolBps + s.protocolBps + s.creatorBps === 10_000, {
    message: 'fee split must sum to 10_000 bps',
  });
export type FeeSplit = z.infer<typeof FeeSplitSchema>;

export const CreatorShareTargetSchema = z.enum(['Creator', 'Protocol', 'RewardPool']);
export type CreatorShareTarget = z.infer<typeof CreatorShareTargetSchema>;

export const FeePolicySchema = z.object({
  feeBps: bps,
  split: FeeSplitSchema,
  creatorShareTarget: CreatorShareTargetSchema,
});
export type FeePolicy = z.infer<typeof FeePolicySchema>;

export const UnderdogPolicySchema = z.object({
  /** Multiplier slope per unit of (0.5 − share); ECONOMICS §7.1. */
  slope: z.number().int().min(0).max(10),
  /** Q4 cap (20_000 = 2.0×). */
  capQ4: z.number().int().min(10_000).max(50_000),
  warmupBps: bps,
  warmupFloorSecs: secs,
});
export type UnderdogPolicy = z.infer<typeof UnderdogPolicySchema>;

export const ArenaParamsSchema = z
  .object({
    tieBps: bps,
    minHoldBps: bps,
    minHoldFloorSecs: secs,
    underdog: UnderdogPolicySchema,
    maxShareBps: bps,
    settlementGraceSecs: secs,
    minBackingUsdc: z.bigint().nonnegative(),
  })
  .refine((p) => p.maxShareBps > 0, { message: 'maxShareBps must be > 0' });
export type ArenaParams = z.infer<typeof ArenaParamsSchema>;

export const ProtocolLimitsSchema = z
  .object({
    minDurationSecs: secs,
    maxDurationSecs: secs,
    minLeadSecs: secs,
    claimWindowSecs: secs,
    rolloverExpirySecs: secs,
    maxExtensionSecs: secs,
    reserveDrawBps: bps,
    upsetBonusCapUsdc: z.bigint().nonnegative(),
  })
  .refine((l) => l.minDurationSecs < l.maxDurationSecs, {
    message: 'minDurationSecs must be < maxDurationSecs',
  });
export type ProtocolLimits = z.infer<typeof ProtocolLimitsSchema>;

const H = 3600;
const D = 24 * H;

export const DEFAULT_FEE_POLICY: FeePolicy = FeePolicySchema.parse({
  feeBps: 50,
  split: { rewardPoolBps: 4000, protocolBps: 4000, creatorBps: 2000 },
  creatorShareTarget: 'Creator',
});

export const DEFAULT_ARENA_PARAMS: ArenaParams = ArenaParamsSchema.parse({
  tieBps: 1,
  minHoldBps: 1000,
  minHoldFloorSecs: 15 * 60,
  underdog: { slope: 2, capQ4: 20_000, warmupBps: 1000, warmupFloorSecs: 30 * 60 },
  maxShareBps: 2500,
  settlementGraceSecs: 6 * H,
  minBackingUsdc: 5_000_000n,
});

export const DEFAULT_PROTOCOL_LIMITS: ProtocolLimits = ProtocolLimitsSchema.parse({
  minDurationSecs: 1 * H,
  maxDurationSecs: 30 * D,
  minLeadSecs: 5 * 60,
  claimWindowSecs: 30 * D,
  rolloverExpirySecs: 90 * D,
  maxExtensionSecs: 1 * D,
  reserveDrawBps: 1000,
  upsetBonusCapUsdc: 5_000_000_000n,
});
