use anchor_lang::prelude::*;

/// One-to-one with `ErrorCode` in `packages/core/src/engine/errors.ts`.
/// The shared test vectors reference these identifiers by name.
#[error_code]
pub enum TribeError {
    // clock / ordering
    #[msg("clock moved backwards")]
    NonMonotonicClock,
    // state
    #[msg("invalid arena status for this instruction")]
    InvalidStatus,
    #[msg("too early")]
    TooEarly,
    #[msg("too late")]
    TooLate,
    #[msg("backing is closed for this arena")]
    BackingClosed,
    #[msg("arena already settled")]
    AlreadySettled,
    #[msg("settlement already extended")]
    AlreadyExtended,
    #[msg("window not expired")]
    NotExpired,
    // inputs
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("notional below minimum backing")]
    BelowMinimumBacking,
    #[msg("fee paid below requirement")]
    FeeTooLow,
    #[msg("insufficient units in position")]
    InsufficientUnits,
    #[msg("invalid parameters")]
    InvalidParams,
    #[msg("both sides reference the same asset")]
    SameAsset,
    // oracle
    #[msg("oracle feed id mismatch")]
    OracleFeedMismatch,
    #[msg("oracle update not fully verified")]
    OracleNotFullyVerified,
    #[msg("oracle price not positive")]
    OracleNonPositivePrice,
    #[msg("oracle confidence too wide")]
    OracleConfidenceTooWide,
    #[msg("oracle price stale for the target window")]
    OracleStale,
    #[msg("oracle price published after the target window")]
    OracleTooEarly,
    #[msg("oracle exponent unsupported")]
    OracleUnsupportedExponent,
    // positions / claims
    #[msg("position not found")]
    PositionNotFound,
    #[msg("reward already claimed")]
    AlreadyClaimed,
    #[msg("position is not on the winning side")]
    NotWinningSide,
    #[msg("arena ended in a tie; no winner")]
    NoWinner,
    #[msg("position has no reward weight")]
    NoRewardWeight,
    #[msg("nothing to claim")]
    NothingToClaim,
    // sponsors
    #[msg("sponsor record not found")]
    SponsorNotFound,
    #[msg("sponsor already refunded")]
    SponsorAlreadyRefunded,
    #[msg("sponsor funding is closed")]
    SponsorClosed,
    #[msg("refund not available in this status")]
    RefundNotAvailable,
    #[msg("insufficient vault balance")]
    InsufficientVault,
    // auth
    #[msg("unauthorized")]
    Unauthorized,
    // math
    #[msg("arithmetic overflow")]
    MathOverflow,
    // program-only (no TS counterpart)
    #[msg("asset is not active in the registry")]
    AssetNotActive,
    #[msg("mint does not match the registered asset")]
    MintMismatch,
    #[msg("token program does not match the registered asset")]
    TokenProgramMismatch,
    #[msg("mint has an unsupported Token-2022 extension")]
    UnsupportedExtension,
    #[msg("mint has an active transfer hook")]
    ActiveTransferHook,
    #[msg("protocol is paused")]
    Paused,
    #[msg("deposited amount did not match the vault delta")]
    DepositMismatch,
    #[msg("token account owner mismatch")]
    OwnerMismatch,
    #[msg("side index must be 0 or 1")]
    InvalidSide,
    #[msg("scaled-ui multiplier out of range")]
    InvalidMultiplier,
}
