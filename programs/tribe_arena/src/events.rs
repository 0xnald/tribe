use anchor_lang::prelude::*;

#[event]
pub struct ArenaCreated {
    pub arena: Pubkey,
    pub creator: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub backing_close_ts: i64,
}

#[event]
pub struct PoolFunded {
    pub arena: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ArenaStarted {
    pub arena: Pubkey,
    pub price_a_q8: u64,
    pub price_b_q8: u64,
}

#[event]
pub struct Backed {
    pub arena: Pubkey,
    pub owner: Pubkey,
    pub side: u8,
    pub units: u64,
    pub fee_paid: u64,
    pub fee_required: u64,
    pub multiplier_q4: u32,
    pub notional_usdc: u64,
}

#[event]
pub struct Exited {
    pub arena: Pubkey,
    pub owner: Pubkey,
    pub side: u8,
    pub units: u64,
    pub forfeited_weight: u128,
}

#[event]
pub struct ArenaSettled {
    pub arena: Pubkey,
    pub winner: u8,
    pub perf_bps_a: i64,
    pub perf_bps_b: i64,
    pub pool_at_settlement: u64,
    pub upset_bonus: u64,
    pub m_settle_q4: u32,
}

#[event]
pub struct RewardClaimed {
    pub arena: Pubkey,
    pub owner: Pubkey,
    pub side: u8,
    pub amount: u64,
}

#[event]
pub struct ArenaCancelled {
    pub arena: Pubkey,
    pub expired: bool,
    pub reason_code: u16,
}

#[event]
pub struct SettlementExtended {
    pub arena: Pubkey,
    pub secs: i64,
}

#[event]
pub struct SponsorRefunded {
    pub arena: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct UnclaimedSwept {
    pub arena: Pubkey,
    pub amount: u64,
}
