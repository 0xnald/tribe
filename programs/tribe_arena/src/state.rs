use anchor_lang::prelude::*;

// ───────────────────────────────────────── seeds

pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const ARENA_SEED: &[u8] = b"arena";
pub const POSITION_SEED: &[u8] = b"position";
pub const SPONSOR_SEED: &[u8] = b"sponsor";
pub const RESERVE_SEED: &[u8] = b"reserve";

// ───────────────────────────────────────── policy

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct FeePolicy {
    pub fee_bps: u16,
    pub reward_pool_bps: u16,
    pub protocol_bps: u16,
    pub creator_bps: u16,
    /// Where the creator share of first-party Arenas goes (see `CreatorTarget`).
    pub first_party_creator_target: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct UnderdogPolicy {
    pub slope: u8,
    pub cap_q4: u32,
    pub warmup_bps: u16,
    pub warmup_floor_secs: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct ArenaParams {
    pub tie_bps: u16,
    pub min_hold_bps: u16,
    pub min_hold_floor_secs: i64,
    pub underdog: UnderdogPolicy,
    pub settlement_grace_secs: i64,
    pub min_backing_usdc: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct ProtocolLimits {
    pub min_duration_secs: i64,
    pub max_duration_secs: i64,
    pub min_lead_secs: i64,
    pub claim_window_secs: i64,
    pub max_extension_secs: i64,
    pub reserve_draw_bps: u16,
    pub upset_bonus_cap_usdc: u64,
}

pub mod creator_target {
    pub const CREATOR: u8 = 0;
    pub const PROTOCOL: u8 = 1;
    pub const REWARD_POOL: u8 = 2;
}

pub mod asset_class {
    pub const CRYPTO: u8 = 0;
    pub const EQUITY: u8 = 1;
    pub const ETF: u8 = 2;
    pub const COMMODITY: u8 = 3;
}

pub mod asset_status {
    pub const ACTIVE: u8 = 0;
    pub const SUSPENDED: u8 = 1;
    pub const RETIRED: u8 = 2;
}

pub mod arena_status {
    pub const SCHEDULED: u8 = 0;
    pub const LIVE: u8 = 1;
    pub const SETTLED: u8 = 2;
    pub const CANCELLED: u8 = 3;
}

pub mod winner {
    pub const NONE: u8 = 255;
    pub const A: u8 = 0;
    pub const B: u8 = 1;
    pub const TIE: u8 = 2;
}

pub mod price_mode {
    pub const EXACT: u8 = 0;
    pub const LAST_KNOWN: u8 = 1;
}

pub mod cancel_reason {
    pub const NONE: u8 = 0;
    pub const AUTHORITY: u8 = 1;
    pub const EXPIRED: u8 = 2;
}

// ───────────────────────────────────────── accounts

#[account]
#[derive(InitSpace, Debug)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    /// USDC token account receiving the protocol fee share.
    pub treasury: Pubkey,
    /// USDC token account (ATA of this PDA) funding Upset Bonuses.
    pub upset_reserve: Pubkey,
    pub fee_policy: FeePolicy,
    pub limits: ProtocolLimits,
    pub default_params: ArenaParams,
    pub paused: bool,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

#[account]
#[derive(InitSpace, Debug)]
pub struct AssetEntry {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub asset_class: u8,
    pub feed_id: [u8; 32],
    pub scaled_ui: bool,
    pub tolerance_secs: i64,
    pub max_closed_staleness_secs: i64,
    pub max_conf_bps: u16,
    pub status: u8,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

/// Per-side asset facts snapshotted into the Arena at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct ArenaAsset {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub asset_class: u8,
    pub feed_id: [u8; 32],
    pub scaled_ui: bool,
    pub tolerance_secs: i64,
    pub max_closed_staleness_secs: i64,
    pub max_conf_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct PriceSnapshot {
    /// Reference price of one raw unit (Q8), multiplier applied.
    pub price_q8: u64,
    pub oracle_price_q8: u64,
    pub publish_time: i64,
    pub mode: u8,
    pub mult_q6: u64,
}

/// Mirrors `SideState` in the TS engine.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct SideState {
    pub units: u64,
    /// ∫ units dt — backing TWAB; never reduced by exits.
    pub unit_seconds: u128,
    /// Σ position.unit_seconds — reduced by forfeiture; raw reward basis.
    pub reward_unit_seconds: u128,
    pub eff_units: u128,
    /// Σ position.eff_unit_seconds — reduced by forfeiture; boosted reward basis.
    pub eff_unit_seconds: u128,
    pub participants: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct SettlementRecord {
    pub winner: u8,
    pub perf_bps_a: i64,
    pub perf_bps_b: i64,
    pub pool_at_settlement: u64,
    pub w_total: u128,
    pub winner_twab_share_bps: u16,
    pub m_settle_q4: u32,
    pub upset_bonus: u64,
    pub settled_at: i64,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Arena {
    pub creator: Pubkey,
    pub nonce: u64,
    /// `nonce.to_le_bytes()` kept for PDA seed reconstruction.
    pub nonce_le: [u8; 8],
    pub assets: [ArenaAsset; 2],
    pub start_ts: i64,
    pub end_ts: i64,
    pub backing_close_ts: i64,
    pub params: ArenaParams,
    pub fee_policy: FeePolicy,
    /// `creator_target::*` for this Arena's creator share.
    pub creator_target: u8,
    pub allow_closed_settlement: bool,
    pub sponsor_open: bool,
    pub status: u8,
    pub start_prices: [PriceSnapshot; 2],
    pub end_prices: [PriceSnapshot; 2],
    pub last_accrual_ts: i64,
    pub sides: [SideState; 2],
    pub reward_vault: Pubkey,
    /// USDC accounting (micro). `reward_pool_balance` mirrors the vault and is
    /// the settlement base pool (the vault may hold more from direct donations).
    pub reward_pool_balance: u64,
    pub sponsor_total: u64,
    pub rollover_in: u64,
    pub rollover_out: u64,
    pub protocol_fees: u64,
    pub creator_fees: u64,
    pub total_claimed: u64,
    pub settlement: SettlementRecord,
    pub cancel_reason: u8,
    pub extensions: u8,
    pub extension_secs: i64,
    pub claims_swept_at: i64,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

/// Mirrors `PositionState` in the TS engine. The position PDA is the
/// authority of its own vault ATA; only `owner` can move units out.
#[account]
#[derive(InitSpace, Debug)]
pub struct Position {
    pub owner: Pubkey,
    pub arena: Pubkey,
    pub side: u8,
    pub units: u64,
    pub unit_seconds: u128,
    pub eff_units: u128,
    pub eff_unit_seconds: u128,
    pub entry_ts: i64,
    pub last_touch_ts: i64,
    pub claimed: bool,
    pub deposits: u32,
    pub fee_paid: u64,
    pub forfeited: bool,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Sponsor {
    pub arena: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
    pub refunded: bool,
    pub bump: u8,
}

impl Arena {
    pub fn window(&self) -> crate::engine::accrual::Window {
        crate::engine::accrual::Window {
            start_ts: self.start_ts,
            end_ts: self.end_ts,
        }
    }

    pub fn settlement_deadline(&self) -> i64 {
        self.end_ts
            .saturating_add(self.params.settlement_grace_secs)
            .saturating_add(self.extension_secs)
    }
}
