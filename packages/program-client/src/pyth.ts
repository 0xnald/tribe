import { createHash } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';

/**
 * `PriceUpdateV2` account encoding (pyth-solana-receiver-sdk 2.0):
 *
 *   discriminator          [u8; 8]   sha256("account:PriceUpdateV2")[..8]
 *   write_authority        Pubkey
 *   verification_level     enum { Partial { num_signatures: u8 } = 0, Full = 1 }
 *   price_message          { feed_id [u8;32], price i64, conf u64, exponent i32,
 *                            publish_time i64, prev_publish_time i64, ema_price i64, ema_conf u64 }
 *   posted_slot            u64
 *
 * Used by tests to fabricate receiver-owned fixtures under LiteSVM, and by
 * the crank to decode live accounts.
 */

export const PRICE_UPDATE_V2_DISCRIMINATOR: Uint8Array = createHash('sha256')
  .update('account:PriceUpdateV2')
  .digest()
  .subarray(0, 8);

export interface PriceUpdateV2Fields {
  writeAuthority: PublicKey;
  verificationLevel: 'Full' | { partial: number };
  feedId: Uint8Array; // 32 bytes
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  prevPublishTime: bigint;
  emaPrice: bigint;
  emaConf: bigint;
  postedSlot: bigint;
}

export function feedIdFromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error(`feed id must be 32 bytes: ${hex}`);
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}

export function encodePriceUpdateV2(f: PriceUpdateV2Fields): Buffer {
  const vl =
    f.verificationLevel === 'Full'
      ? Buffer.from([1])
      : Buffer.from([0, f.verificationLevel.partial]);
  const msg = Buffer.alloc(32 + 8 + 8 + 4 + 8 + 8 + 8 + 8);
  let o = 0;
  msg.set(f.feedId, o);
  o += 32;
  msg.writeBigInt64LE(f.price, o);
  o += 8;
  msg.writeBigUInt64LE(f.conf, o);
  o += 8;
  msg.writeInt32LE(f.exponent, o);
  o += 4;
  msg.writeBigInt64LE(f.publishTime, o);
  o += 8;
  msg.writeBigInt64LE(f.prevPublishTime, o);
  o += 8;
  msg.writeBigInt64LE(f.emaPrice, o);
  o += 8;
  msg.writeBigUInt64LE(f.emaConf, o);
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(f.postedSlot);
  return Buffer.concat([
    Buffer.from(PRICE_UPDATE_V2_DISCRIMINATOR),
    f.writeAuthority.toBuffer(),
    vl,
    msg,
    slot,
  ]);
}

export function decodePriceUpdateV2(data: Uint8Array): PriceUpdateV2Fields {
  const buf = Buffer.from(data);
  if (!buf.subarray(0, 8).equals(Buffer.from(PRICE_UPDATE_V2_DISCRIMINATOR))) {
    throw new Error('not a PriceUpdateV2 account');
  }
  let o = 8;
  const writeAuthority = new PublicKey(buf.subarray(o, o + 32));
  o += 32;
  const tag = buf.readUInt8(o);
  o += 1;
  let verificationLevel: PriceUpdateV2Fields['verificationLevel'];
  if (tag === 1) verificationLevel = 'Full';
  else {
    verificationLevel = { partial: buf.readUInt8(o) };
    o += 1;
  }
  const feedId = Uint8Array.from(buf.subarray(o, o + 32));
  o += 32;
  const price = buf.readBigInt64LE(o);
  o += 8;
  const conf = buf.readBigUInt64LE(o);
  o += 8;
  const exponent = buf.readInt32LE(o);
  o += 4;
  const publishTime = buf.readBigInt64LE(o);
  o += 8;
  const prevPublishTime = buf.readBigInt64LE(o);
  o += 8;
  const emaPrice = buf.readBigInt64LE(o);
  o += 8;
  const emaConf = buf.readBigUInt64LE(o);
  o += 8;
  const postedSlot = buf.readBigUInt64LE(o);
  return {
    writeAuthority,
    verificationLevel,
    feedId,
    price,
    conf,
    exponent,
    publishTime,
    prevPublishTime,
    emaPrice,
    emaConf,
    postedSlot,
  };
}
