//! Shared-vector parity: replays `packages/core/test-vectors/*.json` through
//! the Rust engine and compares every `expected` value bit-for-bit.
//! Vectors are loaded from disk — never duplicated here.

use anchor_lang::prelude::Pubkey;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

use tribe_arena::engine::accrual::{
    accrue_position, accrue_side, apply_deposit, apply_exit, Window,
};
use tribe_arena::engine::arena as eng;
use tribe_arena::engine::fees::{fee_required, split_fee};
use tribe_arena::engine::math::{
    decide_winner, notional_usdc, perf_bps, ref_price_q8, to_q8, WinnerSide,
};
use tribe_arena::engine::oracle::{validate_price_update, PriceInput};
use tribe_arena::engine::shares::{instant_share_after_deposit_bps, twab_share_bps, Valuation};
use tribe_arena::engine::underdog::underdog_multiplier;
use tribe_arena::engine::upset::{compute_upset_bonus, Limiter};
use tribe_arena::state::*;

// ───────────────────────────────────────── json helpers

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/core/test-vectors")
}

fn load(category: &str) -> Vec<Value> {
    let path = vectors_dir().join(format!("{category}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["schema"], "tribe-core-vectors");
    assert_eq!(v["version"], 1);
    assert_eq!(v["category"], category);
    v["vectors"].as_array().unwrap().clone()
}

fn s(v: &Value) -> &str {
    v.as_str()
        .unwrap_or_else(|| panic!("expected string, got {v}"))
}
fn u128_(v: &Value) -> u128 {
    s(v).parse().unwrap_or_else(|_| panic!("u128 {v}"))
}
fn u64_(v: &Value) -> u64 {
    s(v).parse().unwrap_or_else(|_| panic!("u64 {v}"))
}
fn i64_(v: &Value) -> i64 {
    s(v).parse().unwrap_or_else(|_| panic!("i64 {v}"))
}
fn i128_(v: &Value) -> i128 {
    s(v).parse().unwrap_or_else(|_| panic!("i128 {v}"))
}
fn num(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("number {v}"))
}
fn b(v: &Value) -> bool {
    v.as_bool().unwrap_or_else(|| panic!("bool {v}"))
}
fn hex32(v: &Value) -> [u8; 32] {
    let bytes = hex::decode(s(v)).unwrap();
    bytes.try_into().unwrap()
}

/// Deterministic pubkey from a vector owner string.
fn key_of(name: &str) -> Pubkey {
    let mut bytes = [0u8; 32];
    let n = name.as_bytes();
    bytes[..n.len().min(32)].copy_from_slice(&n[..n.len().min(32)]);
    Pubkey::new_from_array(bytes)
}

fn error_name(e: anchor_lang::error::Error) -> String {
    match e {
        anchor_lang::error::Error::AnchorError(a) => a.error_name,
        anchor_lang::error::Error::ProgramError(p) => format!("{p:?}"),
    }
}

fn underdog_policy(v: &Value) -> UnderdogPolicy {
    UnderdogPolicy {
        slope: num(&v["slope"]) as u8,
        cap_q4: num(&v["capQ4"]) as u32,
        warmup_bps: num(&v["warmupBps"]) as u16,
        warmup_floor_secs: num(&v["warmupFloorSecs"]),
    }
}

fn fee_policy(v: &Value) -> (FeePolicy, u8) {
    let target = match s(&v["creatorShareTarget"]) {
        "Creator" => creator_target::CREATOR,
        "Protocol" => creator_target::PROTOCOL,
        "RewardPool" => creator_target::REWARD_POOL,
        t => panic!("target {t}"),
    };
    (
        FeePolicy {
            fee_bps: num(&v["feeBps"]) as u16,
            reward_pool_bps: num(&v["split"]["rewardPoolBps"]) as u16,
            protocol_bps: num(&v["split"]["protocolBps"]) as u16,
            creator_bps: num(&v["split"]["creatorBps"]) as u16,
            first_party_creator_target: creator_target::REWARD_POOL,
        },
        target,
    )
}

fn asset(v: &Value) -> ArenaAsset {
    ArenaAsset {
        mint: key_of(s(&v["mint"])),
        token_program: Pubkey::default(),
        decimals: num(&v["decimals"]) as u8,
        asset_class: match s(&v["assetClass"]) {
            "Crypto" => asset_class::CRYPTO,
            "Equity" => asset_class::EQUITY,
            "Etf" => asset_class::ETF,
            "Commodity" => asset_class::COMMODITY,
            c => panic!("class {c}"),
        },
        feed_id: hex32(&v["feedId"]),
        scaled_ui: b(&v["scaledUi"]),
        tolerance_secs: i64_(&v["toleranceSecs"]),
        max_closed_staleness_secs: i64_(&v["maxClosedStalenessSecs"]),
        max_conf_bps: u64_(&v["maxConfBps"]) as u16,
    }
}

fn price_input(v: &Value) -> PriceInput {
    PriceInput {
        feed_id: hex32(&v["feedId"]),
        price: i64_(&v["price"]),
        conf: u64_(&v["conf"]),
        expo: num(&v["expo"]) as i32,
        publish_time: i64_(&v["publishTime"]),
        fully_verified: s(&v["verificationLevel"]) == "Full",
        mult_q6: v.get("multQ6").filter(|m| !m.is_null()).map(u64_),
    }
}

fn side_state(v: &Value) -> SideState {
    SideState {
        units: u64_(&v["units"]),
        unit_seconds: u128_(&v["unitSeconds"]),
        reward_unit_seconds: u128_(&v["rewardUnitSeconds"]),
        eff_units: u128_(&v["effUnits"]),
        eff_unit_seconds: u128_(&v["effUnitSeconds"]),
        participants: u64_(&v["participants"]) as u32,
    }
}

fn snapshot(v: &Value) -> PriceSnapshot {
    PriceSnapshot {
        price_q8: u64_(&v["priceQ8"]),
        oracle_price_q8: u64_(&v["oraclePriceQ8"]),
        publish_time: i64_(&v["publishTime"]),
        mode: if s(&v["mode"]) == "Exact" {
            price_mode::EXACT
        } else {
            price_mode::LAST_KNOWN
        },
        mult_q6: u64_(&v["multQ6"]),
    }
}

fn new_position(owner: &str, arena: Pubkey, side: u8) -> Position {
    Position {
        owner: key_of(owner),
        arena,
        side,
        units: 0,
        unit_seconds: 0,
        eff_units: 0,
        eff_unit_seconds: 0,
        entry_ts: 0,
        last_touch_ts: 0,
        claimed: false,
        deposits: 0,
        fee_paid: 0,
        forfeited: false,
        bump: 0,
        _reserved: [0; 32],
    }
}

// ───────────────────────────────────────── math

#[test]
fn math_vectors() {
    let mut n = 0;
    for v in load("math") {
        let i = &v["inputs"];
        let args: Vec<i128> = i["args"].as_array().unwrap().iter().map(i128_).collect();
        let nums: Vec<i64> = i
            .get("numArgs")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().map(num).collect())
            .unwrap_or_default();
        let exp = &v["expected"]["result"];
        match s(&i["op"]) {
            "toQ8" => assert_eq!(
                to_q8(args[0] as i64, nums[0] as i32).unwrap() as u128,
                u128_(exp),
                "{}",
                v["name"]
            ),
            "refPriceQ8" => assert_eq!(
                ref_price_q8(args[0] as u64, args[1] as u64).unwrap() as u128,
                u128_(exp)
            ),
            "notionalUsdc" => assert_eq!(
                notional_usdc(args[0] as u64, args[1] as u64, nums[0] as u8).unwrap() as u128,
                u128_(exp)
            ),
            "perfBps" => assert_eq!(
                perf_bps(args[0] as u64, args[1] as u64).unwrap() as i128,
                i128_(exp)
            ),
            "decideWinner" => {
                let w = decide_winner(
                    args[0] as u64,
                    args[1] as u64,
                    args[2] as u64,
                    args[3] as u64,
                    args[4] as u16,
                )
                .unwrap();
                let want = match s(exp) {
                    "A" => WinnerSide::A,
                    "B" => WinnerSide::B,
                    _ => WinnerSide::Tie,
                };
                assert_eq!(w, want, "{}", v["name"]);
            }
            op => panic!("op {op}"),
        }
        n += 1;
    }
    assert_eq!(n, 17);
}

// ───────────────────────────────────────── accrual

#[test]
fn accrual_vectors() {
    let mut n = 0;
    for v in load("accrual") {
        let i = &v["inputs"];
        let w = Window {
            start_ts: i64_(&i["startTs"]),
            end_ts: i64_(&i["endTs"]),
        };
        let ops = i["ops"].as_array().unwrap();
        let mut p = new_position("u", Pubkey::default(), 0);
        p.entry_ts = i64_(&ops[0]["now"]);
        p.last_touch_ts = p.entry_ts;
        let mut side = SideState::default();
        let mut last = p.last_touch_ts;
        let steps = v["expected"]["steps"].as_array().unwrap();
        for (k, op) in ops.iter().enumerate() {
            let now = i64_(&op["now"]);
            let c = |t: i64| t.clamp(w.start_ts, w.end_ts);
            let dt = (c(now) - c(last)) as u128;
            accrue_position(&mut p, now, &w).unwrap();
            accrue_side(&mut side, dt).unwrap();
            last = p.last_touch_ts;
            match s(&op["op"]) {
                "deposit" => apply_deposit(
                    &mut p,
                    &mut side,
                    u64_(&op["units"]),
                    op.get("mQ4").map(u64_).unwrap_or(10_000) as u32,
                    0,
                )
                .unwrap(),
                "exit" => {
                    apply_exit(
                        &mut p,
                        &mut side,
                        u64_(&op["units"]),
                        op.get("forfeit").map(b).unwrap_or(true),
                    )
                    .unwrap();
                }
                _ => {}
            }
            let e = &steps[k];
            let ep = &e["position"];
            assert_eq!(
                p.units as u128,
                u128_(&ep["units"]),
                "{} step {k}",
                v["name"]
            );
            assert_eq!(
                p.unit_seconds,
                u128_(&ep["unitSeconds"]),
                "{} step {k}",
                v["name"]
            );
            assert_eq!(
                p.eff_units,
                u128_(&ep["effUnits"]),
                "{} step {k}",
                v["name"]
            );
            assert_eq!(
                p.eff_unit_seconds,
                u128_(&ep["effUnitSeconds"]),
                "{} step {k}",
                v["name"]
            );
            assert_eq!(p.forfeited, b(&ep["forfeited"]));
            let es = &e["side"];
            assert_eq!(side.units as u128, u128_(&es["units"]));
            assert_eq!(side.unit_seconds, u128_(&es["unitSeconds"]));
            assert_eq!(side.eff_units, u128_(&es["effUnits"]));
            assert_eq!(side.eff_unit_seconds, u128_(&es["effUnitSeconds"]));
            assert_eq!(side.participants as u64, u64_(&es["participants"]));
        }
        n += 1;
    }
    assert_eq!(n, 9);
}

// ───────────────────────────────────────── underdog

#[test]
fn underdog_vectors() {
    let mut n = 0;
    for v in load("underdog") {
        let i = &v["inputs"];
        let sides = [
            SideState {
                units: u64_(&i["sides"]["A"]["units"]),
                unit_seconds: u128_(&i["sides"]["A"]["unitSeconds"]),
                ..Default::default()
            },
            SideState {
                units: u64_(&i["sides"]["B"]["units"]),
                unit_seconds: u128_(&i["sides"]["B"]["unitSeconds"]),
                ..Default::default()
            },
        ];
        let vals = [
            Valuation {
                price_q8: u64_(&i["prices"]["A"]),
                decimals: num(&i["decimals"]["A"]) as u8,
            },
            Valuation {
                price_q8: u64_(&i["prices"]["B"]),
                decimals: num(&i["decimals"]["B"]) as u8,
            },
        ];
        let side = if s(&i["side"]) == "A" { 0 } else { 1 };
        let policy = underdog_policy(&i["policy"]);
        let r = underdog_multiplier(
            &sides,
            &vals,
            side,
            u64_(&i["depositUnits"]),
            i64_(&i["now"]),
            i64_(&i["startTs"]),
            i64_(&i["endTs"]),
            &policy,
        )
        .unwrap();
        let e = &v["expected"];
        assert_eq!(
            instant_share_after_deposit_bps(&sides, &vals, side, u64_(&i["depositUnits"])).unwrap(),
            u128_(&e["shareInstBps"]),
            "{}",
            v["name"]
        );
        let twab = twab_share_bps(&sides, &vals, side).unwrap();
        if e["shareTwabBps"].is_null() {
            assert!(twab.is_none());
        } else {
            assert_eq!(twab.unwrap(), u128_(&e["shareTwabBps"]));
        }
        assert_eq!(r.share_eff_bps, u128_(&e["shareEffBps"]));
        assert_eq!(r.raw_q4, u128_(&e["rawQ4"]));
        assert_eq!(r.warmup, u128_(&e["warmupSecs"]));
        assert_eq!(r.elapsed, i64_(&e["elapsedSecs"]));
        assert_eq!(r.m_q4, u128_(&e["mQ4"]), "{}", v["name"]);
        n += 1;
    }
    assert_eq!(n, 9);
}

// ───────────────────────────────────────── fees

#[test]
fn fees_vectors() {
    let mut n = 0;
    for v in load("fees") {
        let i = &v["inputs"];
        let (policy, target) = fee_policy(&i["policy"]);
        let fee = fee_required(u64_(&i["notionalUsdc"]), policy.fee_bps).unwrap();
        let e = &v["expected"];
        assert_eq!(fee, u64_(&e["feeRequired"]), "{}", v["name"]);
        let sp = split_fee(fee, &policy, target).unwrap();
        assert_eq!(sp.to_pool, u64_(&e["split"]["toPool"]));
        assert_eq!(sp.to_protocol, u64_(&e["split"]["toProtocol"]));
        assert_eq!(sp.to_creator, u64_(&e["split"]["toCreator"]));
        n += 1;
    }
    assert_eq!(n, 10);
}

// ───────────────────────────────────────── oracle

#[test]
fn oracle_vectors() {
    let mut n = 0;
    for v in load("oracle") {
        let i = &v["inputs"];
        let r = validate_price_update(
            &price_input(&i["input"]),
            &asset(&i["asset"]),
            i64_(&i["targetTs"]),
            b(&i["allowClosed"]),
        );
        let e = &v["expected"];
        if b(&e["ok"]) {
            let snap = r.unwrap_or_else(|err| panic!("{}: {err}", v["name"]));
            assert_eq!(snap, snapshot(&e["snapshot"]), "{}", v["name"]);
        } else {
            let err = error_name(
                r.err()
                    .unwrap_or_else(|| panic!("{} expected error", v["name"])),
            );
            assert_eq!(err, s(&e["code"]), "{}", v["name"]);
        }
        n += 1;
    }
    assert_eq!(n, 18);
}

// ───────────────────────────────────────── settlement

#[test]
fn settlement_vectors() {
    let mut n = 0;
    for v in load("settlement") {
        let i = &v["inputs"];
        let sa = u64_(&i["A"]["startQ8"]);
        let ea = u64_(&i["A"]["endQ8"]);
        let sb = u64_(&i["B"]["startQ8"]);
        let eb = u64_(&i["B"]["endQ8"]);
        let w = decide_winner(sa, ea, sb, eb, u64_(&i["tieBps"]) as u16).unwrap();
        let e = &v["expected"];
        let want = match s(&e["winner"]) {
            "A" => WinnerSide::A,
            "B" => WinnerSide::B,
            _ => WinnerSide::Tie,
        };
        assert_eq!(w, want, "{}", v["name"]);
        assert_eq!(perf_bps(sa, ea).unwrap() as i128, i128_(&e["perfBpsA"]));
        assert_eq!(perf_bps(sb, eb).unwrap() as i128, i128_(&e["perfBpsB"]));
        n += 1;
    }
    assert_eq!(n, 10);
}

// ───────────────────────────────────────── distribution (normative subset)

#[test]
fn distribution_vectors_proportional() {
    // Only the normative Proportional mode is implemented on-chain.
    let mut n = 0;
    for v in load("distribution") {
        let i = &v["inputs"];
        if s(&i["mode"]) != "Proportional" {
            continue;
        }
        let pool = u64_(&i["pool"]);
        let weights: Vec<(String, u128)> = i["weights"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| (s(&w["key"]).to_string(), u128_(&w["weight"])))
            .collect();
        let total: u128 = weights.iter().map(|w| w.1).sum();
        let mut distributed = 0u64;
        for (k, w) in &weights {
            let pay = eng::payout_proportional(pool, *w, total).unwrap();
            assert_eq!(pay, u64_(&v["expected"]["payouts"][k]), "{} {k}", v["name"]);
            distributed += pay;
        }
        assert_eq!(distributed, u64_(&v["expected"]["distributed"]));
        assert_eq!(pool - distributed, u64_(&v["expected"]["remainder"]));
        n += 1;
    }
    assert_eq!(n, 5);
}

// ───────────────────────────────────────── upset

#[test]
fn upset_vectors() {
    let mut n = 0;
    for v in load("upset") {
        let i = &v["inputs"];
        let r = compute_upset_bonus(
            u128_(&i["winnerTwabShareBps"]),
            u64_(&i["basePool"]),
            u64_(&i["reserveBalance"]),
            &underdog_policy(&i["underdog"]),
            num(&i["reserveDrawBps"]) as u16,
            u64_(&i["upsetBonusCapUsdc"]),
        )
        .unwrap();
        let e = &v["expected"];
        assert_eq!(r.m_upset_q4, u128_(&e["mUpsetQ4"]), "{}", v["name"]);
        assert_eq!(r.requested, u64_(&e["requested"]));
        assert_eq!(r.bonus, u64_(&e["bonus"]));
        let lim = match r.limited_by {
            Limiter::None => "none",
            Limiter::Formula => "formula",
            Limiter::ReserveDraw => "reserveDraw",
            Limiter::ReserveBalance => "reserveBalance",
            Limiter::Cap => "cap",
        };
        assert_eq!(lim, s(&e["limitedBy"]));
        n += 1;
    }
    assert_eq!(n, 8);
}

// ───────────────────────────────────────── arena event streams

struct Sim {
    arena: Arena,
    limits: ProtocolLimits,
    authority: Pubkey,
    positions: BTreeMap<String, Position>,
    sponsors: BTreeMap<String, (u64, bool)>,
}

fn build_arena(cfg: &Value, created_at: i64, rollover_in: u64) -> (Sim, Result<(), String>) {
    let params = &cfg["params"];
    let (fee_policy, target) = fee_policy(&cfg["feePolicy"]);
    let lim = &cfg["limits"];
    let limits = ProtocolLimits {
        min_duration_secs: num(&lim["minDurationSecs"]),
        max_duration_secs: num(&lim["maxDurationSecs"]),
        min_lead_secs: num(&lim["minLeadSecs"]),
        claim_window_secs: num(&lim["claimWindowSecs"]),
        max_extension_secs: num(&lim["maxExtensionSecs"]),
        reserve_draw_bps: num(&lim["reserveDrawBps"]) as u16,
        upset_bonus_cap_usdc: u64_(&lim["upsetBonusCapUsdc"]),
    };
    let mut arena = Arena {
        creator: key_of(s(&cfg["creator"])),
        nonce: 0,
        nonce_le: [0; 8],
        assets: [asset(&cfg["assets"]["A"]), asset(&cfg["assets"]["B"])],
        start_ts: i64_(&cfg["startTs"]),
        end_ts: i64_(&cfg["endTs"]),
        backing_close_ts: 0,
        params: ArenaParams {
            tie_bps: num(&params["tieBps"]) as u16,
            min_hold_bps: num(&params["minHoldBps"]) as u16,
            min_hold_floor_secs: num(&params["minHoldFloorSecs"]),
            underdog: underdog_policy(&params["underdog"]),
            settlement_grace_secs: num(&params["settlementGraceSecs"]),
            min_backing_usdc: u64_(&params["minBackingUsdc"]),
        },
        fee_policy,
        creator_target: target,
        allow_closed_settlement: b(&cfg["allowClosedSettlement"]),
        sponsor_open: b(&cfg["sponsorOpen"]),
        status: arena_status::SCHEDULED,
        start_prices: [PriceSnapshot::default(); 2],
        end_prices: [PriceSnapshot::default(); 2],
        last_accrual_ts: 0,
        sides: [SideState::default(); 2],
        reward_vault: Pubkey::default(),
        reward_pool_balance: 0,
        sponsor_total: 0,
        rollover_in: 0,
        rollover_out: 0,
        protocol_fees: 0,
        creator_fees: 0,
        total_claimed: 0,
        settlement: SettlementRecord::default(),
        cancel_reason: 0,
        extensions: 0,
        extension_secs: 0,
        claims_swept_at: 0,
        bump: 0,
        _reserved: [0; 64],
    };
    let r =
        eng::validate_creation(&mut arena, created_at, &limits, rollover_in).map_err(error_name);
    (
        Sim {
            arena,
            limits,
            authority: key_of(s(&cfg["authority"])),
            positions: BTreeMap::new(),
            sponsors: BTreeMap::new(),
        },
        r,
    )
}

fn apply(sim: &mut Sim, ev: &Value) -> Result<(), String> {
    let now = i64_(&ev["now"]);
    match s(&ev["type"]) {
        "fundPool" => {
            let who = s(&ev["sponsor"]).to_string();
            let amount = u64_(&ev["amount"]);
            let allowed = sim.arena.sponsor_open
                || key_of(&who) == sim.arena.creator
                || key_of(&who) == sim.authority;
            if !allowed {
                return Err("SponsorClosed".into());
            }
            eng::fund_pool(&mut sim.arena, now, amount).map_err(error_name)?;
            let e = sim.sponsors.entry(who).or_insert((0, false));
            e.0 += amount;
            e.1 = false;
            Ok(())
        }
        "snapshotStart" => {
            let inputs = [
                price_input(&ev["prices"]["A"]),
                price_input(&ev["prices"]["B"]),
            ];
            eng::snapshot_start(&mut sim.arena, now, &inputs).map_err(error_name)
        }
        "back" => {
            let side = if s(&ev["side"]) == "A" { 0u8 } else { 1u8 };
            let owner = s(&ev["owner"]).to_string();
            let key = format!("{}:{owner}", s(&ev["side"]));
            let mut pos = sim
                .positions
                .get(&key)
                .cloned()
                .unwrap_or_else(|| new_position(&owner, Pubkey::default(), side));
            let mut arena = sim.arena.clone();
            eng::back(
                &mut arena,
                &mut pos,
                side as usize,
                u64_(&ev["units"]),
                u64_(&ev["feePaid"]),
                now,
            )
            .map_err(error_name)?;
            sim.arena = arena;
            sim.positions.insert(key, pos);
            Ok(())
        }
        "exit" => {
            let key = format!("{}:{}", s(&ev["side"]), s(&ev["owner"]));
            let Some(existing) = sim.positions.get(&key) else {
                return Err("PositionNotFound".into());
            };
            let mut pos = existing.clone();
            let mut arena = sim.arena.clone();
            eng::exit(&mut arena, &mut pos, u64_(&ev["units"]), now).map_err(error_name)?;
            sim.arena = arena;
            sim.positions.insert(key, pos);
            Ok(())
        }
        "settle" => {
            let inputs = [
                price_input(&ev["prices"]["A"]),
                price_input(&ev["prices"]["B"]),
            ];
            let mut arena = sim.arena.clone();
            eng::settle(
                &mut arena,
                now,
                &inputs,
                u64_(&ev["reserveBalance"]),
                &sim.limits,
            )
            .map_err(error_name)?;
            sim.arena = arena;
            Ok(())
        }
        "claim" => {
            let key = format!("{}:{}", s(&ev["side"]), s(&ev["owner"]));
            let side = if s(&ev["side"]) == "A" {
                winner::A
            } else {
                winner::B
            };
            // program ordering: status, winner, side, then position existence
            if sim.arena.status != arena_status::SETTLED {
                return Err("InvalidStatus".into());
            }
            if sim.arena.settlement.winner == winner::TIE {
                return Err("NoWinner".into());
            }
            if side != sim.arena.settlement.winner {
                return Err("NotWinningSide".into());
            }
            let Some(existing) = sim.positions.get(&key) else {
                return Err("PositionNotFound".into());
            };
            let mut pos = existing.clone();
            let mut arena = sim.arena.clone();
            eng::claim(&mut arena, &mut pos, now).map_err(error_name)?;
            sim.arena = arena;
            sim.positions.insert(key, pos);
            Ok(())
        }
        "cancel" => {
            if key_of(s(&ev["actor"])) != sim.authority {
                // the reducer checks status first, then actor
                if !matches!(
                    sim.arena.status,
                    arena_status::SCHEDULED | arena_status::LIVE
                ) {
                    return Err("InvalidStatus".into());
                }
                return Err("Unauthorized".into());
            }
            eng::cancel_by_authority(&mut sim.arena, now).map_err(error_name)
        }
        "cancelExpired" => eng::cancel_expired(&mut sim.arena, now).map_err(error_name),
        "extendSettlement" => {
            if sim.arena.status != arena_status::LIVE {
                return Err("InvalidStatus".into());
            }
            if key_of(s(&ev["actor"])) != sim.authority {
                return Err("Unauthorized".into());
            }
            eng::extend_settlement(&mut sim.arena, now, i64_(&ev["secs"]), &sim.limits)
                .map_err(error_name)
        }
        "refundSponsor" => {
            let who = s(&ev["sponsor"]).to_string();
            let Some(rec) = sim.sponsors.get(&who).cloned() else {
                return Err("SponsorNotFound".into());
            };
            if rec.1 {
                return Err("SponsorAlreadyRefunded".into());
            }
            eng::refund_sponsor(&mut sim.arena, rec.0).map_err(error_name)?;
            sim.sponsors.insert(who, (rec.0, true));
            Ok(())
        }
        "sweepUnclaimed" => eng::sweep_unclaimed(&mut sim.arena, now, &sim.limits)
            .map(|_| ())
            .map_err(error_name),
        t => panic!("event {t}"),
    }
}

#[test]
fn arena_vectors() {
    let mut n = 0;
    for v in load("arena") {
        let name = s(&v["name"]).to_string();
        let i = &v["inputs"];
        let (mut sim, created) =
            build_arena(&i["config"], i64_(&i["createdAt"]), u64_(&i["rolloverIn"]));
        created.unwrap_or_else(|e| panic!("{name}: creation failed {e}"));
        let e = &v["expected"];
        assert_eq!(
            sim.arena.backing_close_ts,
            i64_(&e["backingCloseTs"]),
            "{name}"
        );

        let trace = e["trace"].as_array().unwrap();
        for (idx, ev) in i["events"].as_array().unwrap().iter().enumerate() {
            let r = apply(&mut sim, ev);
            let t = &trace[idx];
            match r {
                Ok(()) => assert!(
                    b(&t["ok"]),
                    "{name} event {idx} should have failed with {}",
                    t["error"]
                ),
                Err(code) => {
                    assert!(
                        !b(&t["ok"]),
                        "{name} event {idx} should have succeeded, got {code}"
                    );
                    assert_eq!(code, s(&t["error"]), "{name} event {idx}");
                }
            }
        }

        // status
        let status = match s(&e["status"]) {
            "Scheduled" => arena_status::SCHEDULED,
            "Live" => arena_status::LIVE,
            "Settled" => arena_status::SETTLED,
            _ => arena_status::CANCELLED,
        };
        assert_eq!(sim.arena.status, status, "{name}");
        // accounting
        assert_eq!(
            sim.arena.reward_pool_balance,
            u64_(&e["rewardVault"]),
            "{name} vault"
        );
        assert_eq!(sim.arena.protocol_fees, u64_(&e["protocolFees"]), "{name}");
        assert_eq!(sim.arena.creator_fees, u64_(&e["creatorFees"]), "{name}");
        assert_eq!(sim.arena.sponsor_total, u64_(&e["sponsorTotal"]), "{name}");
        assert_eq!(sim.arena.rollover_in, u64_(&e["rolloverIn"]), "{name}");
        assert_eq!(sim.arena.rollover_out, u64_(&e["rolloverOut"]), "{name}");
        assert_eq!(sim.arena.total_claimed, u64_(&e["totalClaimed"]), "{name}");
        // sides
        assert_eq!(
            sim.arena.sides[0],
            side_state(&e["sides"]["A"]),
            "{name} side A"
        );
        assert_eq!(
            sim.arena.sides[1],
            side_state(&e["sides"]["B"]),
            "{name} side B"
        );
        // prices
        for (k, side) in ["A", "B"].iter().enumerate() {
            if let Some(sp) = e["startPrices"].get(*side) {
                assert_eq!(
                    sim.arena.start_prices[k],
                    snapshot(sp),
                    "{name} start {side}"
                );
            }
            if let Some(ep) = e["endPrices"].get(*side) {
                assert_eq!(sim.arena.end_prices[k], snapshot(ep), "{name} end {side}");
            }
        }
        // settlement
        if e["settlement"].is_null() {
            assert_ne!(sim.arena.status, arena_status::SETTLED);
        } else {
            let st = &e["settlement"];
            let want_winner = match s(&st["winner"]) {
                "A" => winner::A,
                "B" => winner::B,
                _ => winner::TIE,
            };
            let got = sim.arena.settlement;
            assert_eq!(got.winner, want_winner, "{name}");
            assert_eq!(got.perf_bps_a as i128, i128_(&st["perfBpsA"]), "{name}");
            assert_eq!(got.perf_bps_b as i128, i128_(&st["perfBpsB"]), "{name}");
            assert_eq!(
                got.pool_at_settlement,
                u64_(&st["poolAtSettlement"]),
                "{name}"
            );
            assert_eq!(got.w_total, u128_(&st["wTotal"]), "{name} wTotal");
            assert_eq!(
                got.winner_twab_share_bps as u128,
                u128_(&st["winnerTwabShareBps"]),
                "{name}"
            );
            assert_eq!(got.m_settle_q4 as u128, u128_(&st["mSettleQ4"]), "{name}");
            assert_eq!(got.upset_bonus, u64_(&st["upsetBonus"]), "{name}");
            assert_eq!(got.settled_at, i64_(&st["settledAt"]), "{name}");
        }
        // positions
        let ep = e["positions"].as_object().unwrap();
        assert_eq!(ep.len(), sim.positions.len(), "{name} position count");
        for (key, want) in ep {
            let p = sim
                .positions
                .get(key)
                .unwrap_or_else(|| panic!("{name} missing {key}"));
            assert_eq!(p.units as u128, u128_(&want["units"]), "{name} {key} units");
            assert_eq!(
                p.unit_seconds,
                u128_(&want["unitSeconds"]),
                "{name} {key} unitSeconds"
            );
            assert_eq!(
                p.eff_units,
                u128_(&want["effUnits"]),
                "{name} {key} effUnits"
            );
            assert_eq!(
                p.eff_unit_seconds,
                u128_(&want["effUnitSeconds"]),
                "{name} {key}"
            );
            assert_eq!(p.claimed, b(&want["claimed"]), "{name} {key} claimed");
            assert_eq!(p.forfeited, b(&want["forfeited"]), "{name} {key} forfeited");
            assert_eq!(p.fee_paid, u64_(&want["feePaid"]), "{name} {key} fee");
            // reward weight / payout from the final state (independent claim per position)
            if !want["rewardWeight"].is_null() {
                let w = eng::position_reward_weight(&sim.arena, p).unwrap();
                assert_eq!(w, u128_(&want["rewardWeight"]), "{name} {key} weight");
            }
            match &want["payout"] {
                Value::Null => {}
                Value::String(x) if x.parse::<u64>().is_ok() => {
                    let mut arena = sim.arena.clone();
                    let mut pos = p.clone();
                    let amount = eng::claim(&mut arena, &mut pos, i64_(&i["claimAt"])).unwrap();
                    assert_eq!(amount, x.parse::<u64>().unwrap(), "{name} {key} payout");
                }
                Value::String(code) => {
                    let mut arena = sim.arena.clone();
                    let mut pos = p.clone();
                    let err = eng::claim(&mut arena, &mut pos, i64_(&i["claimAt"]))
                        .err()
                        .map(error_name);
                    assert_eq!(
                        err.as_deref(),
                        Some(code.as_str()),
                        "{name} {key} payout error"
                    );
                }
                other => panic!("payout {other}"),
            }
        }
        n += 1;
    }
    assert_eq!(n, 11);
}
