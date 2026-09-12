//! Token program / Token-2022 handling: extension policy checks, scaled-UI
//! multiplier reads, and `transfer_checked` helpers for both token programs.

use crate::errors::TribeError;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::spl_token_2022::extension::{
    scaled_ui_amount::ScaledUiAmountConfig, transfer_hook::TransferHook,
    BaseStateWithExtensions, ExtensionType, StateWithExtensions,
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

/// Extensions that break vault accounting or transferability and are never accepted.
const UNSUPPORTED: &[ExtensionType] = &[
    ExtensionType::TransferFeeConfig,
    ExtensionType::NonTransferable,
    ExtensionType::InterestBearingConfig,
];

pub struct MintFacts {
    pub scaled_ui: bool,
}

/// Validate a mint against Tribe's Token-2022 policy (ARCHITECTURE §6):
/// legacy SPL mints pass; Token-2022 mints must not carry an unsupported
/// extension or an active transfer hook program.
pub fn inspect_mint(mint: &InterfaceAccount<Mint>, token_program: &Pubkey) -> Result<MintFacts> {
    let info = mint.to_account_info();
    require_keys_eq!(*info.owner, *token_program, TribeError::TokenProgramMismatch);
    if *token_program == anchor_spl::token::ID {
        return Ok(MintFacts { scaled_ui: false });
    }
    require_keys_eq!(
        *token_program,
        anchor_spl::token_2022::ID,
        TribeError::TokenProgramMismatch
    );
    let data = info.try_borrow_data()?;
    let state = StateWithExtensions::<
        anchor_spl::token_interface::spl_token_2022::state::Mint,
    >::unpack(&data)?;
    let types = state.get_extension_types()?;
    for t in &types {
        require!(!UNSUPPORTED.contains(t), TribeError::UnsupportedExtension);
    }
    if types.contains(&ExtensionType::TransferHook) {
        let hook = state.get_extension::<TransferHook>()?;
        let program: Option<Pubkey> = hook.program_id.into();
        require!(program.is_none(), TribeError::ActiveTransferHook);
    }
    Ok(MintFacts {
        scaled_ui: types.contains(&ExtensionType::ScaledUiAmount),
    })
}

/// Read the effective scaled-UI multiplier as Q6. The token program stores an
/// IEEE f64; conversion happens once here, deterministically (round half
/// away from zero), and is range-checked. Returns `None` for mints without
/// the extension.
pub fn read_scaled_multiplier_q6(mint: &AccountInfo, now: i64) -> Result<Option<u64>> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(None);
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<
        anchor_spl::token_interface::spl_token_2022::state::Mint,
    >::unpack(&data)?;
    let Ok(cfg) = state.get_extension::<ScaledUiAmountConfig>() else {
        return Ok(None);
    };
    let effective_ts: i64 = cfg.new_multiplier_effective_timestamp.into();
    let m: f64 = if effective_ts != 0 && now >= effective_ts {
        cfg.new_multiplier.into()
    } else {
        cfg.multiplier.into()
    };
    require!(m.is_finite() && m > 0.0, TribeError::InvalidMultiplier);
    let scaled = (m * 1_000_000.0).round();
    require!(
        (1.0..=1_000_000_000_000.0).contains(&scaled),
        TribeError::InvalidMultiplier
    );
    Ok(Some(scaled as u64))
}

/// `transfer_checked` from a user-owned account (user signs).
pub fn transfer_from_user<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

/// `transfer_checked` from a PDA-owned vault (PDA signs).
pub fn transfer_from_pda<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority,
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}
