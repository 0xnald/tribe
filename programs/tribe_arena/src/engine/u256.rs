//! 256-bit unsigned integer for exact mul-div intermediates. Kept in its own
//! module so the `construct_uint!` macro does not see Anchor's `Result` alias.
#![allow(clippy::all)]

uint::construct_uint! {
    pub struct U256(4);
}
