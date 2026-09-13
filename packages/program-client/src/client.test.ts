import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  PRICE_UPDATE_V2_DISCRIMINATOR,
  TRIBE_ARENA_PROGRAM_ID,
  TribeClient,
  arenaPda,
  configPda,
  decodePriceUpdateV2,
  encodePriceUpdateV2,
  feedIdFromHex,
  positionPda,
  readonlyProvider,
} from './index';

const FEED = '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419';

describe('PDAs', () => {
  it('derives the documented seeds (ARCHITECTURE §8.1)', () => {
    const [config] = configPda();
    expect(
      config.equals(
        PublicKey.findProgramAddressSync([Buffer.from('config')], TRIBE_ARENA_PROGRAM_ID)[0],
      ),
    ).toBe(true);
    const creator = Keypair.generate().publicKey;
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(7n);
    expect(
      arenaPda(creator, 7n)[0].equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from('arena'), creator.toBuffer(), nonce],
          TRIBE_ARENA_PROGRAM_ID,
        )[0],
      ),
    ).toBe(true);
    // sides derive distinct positions for the same owner
    const arena = arenaPda(creator, 1n)[0];
    expect(positionPda(arena, 0, creator)[0].equals(positionPda(arena, 1, creator)[0])).toBe(false);
  });

  it('client PDA helpers agree with the standalone functions', () => {
    const client = new TribeClient(
      readonlyProvider(new Connection('http://127.0.0.1:1')),
      TRIBE_ARENA_PROGRAM_ID,
    );
    const creator = Keypair.generate().publicKey;
    expect(client.config().equals(configPda()[0])).toBe(true);
    expect(client.arena(creator, 3n).equals(arenaPda(creator, 3n)[0])).toBe(true);
  });
});

describe('PriceUpdateV2 codec', () => {
  it('round-trips and carries the Anchor discriminator', () => {
    const fields = {
      writeAuthority: Keypair.generate().publicKey,
      verificationLevel: 'Full' as const,
      feedId: feedIdFromHex(FEED),
      price: 36_525_000_000n,
      conf: 12_000n,
      exponent: -8,
      publishTime: 1_800_000_000n,
      prevPublishTime: 1_799_999_999n,
      emaPrice: 36_500_000_000n,
      emaConf: 11_000n,
      postedSlot: 42n,
    };
    const data = encodePriceUpdateV2(fields);
    expect(
      Buffer.from(data.subarray(0, 8)).equals(Buffer.from(PRICE_UPDATE_V2_DISCRIMINATOR)),
    ).toBe(true);
    const back = decodePriceUpdateV2(data);
    expect(back.price).toBe(fields.price);
    expect(back.exponent).toBe(-8);
    expect(back.publishTime).toBe(fields.publishTime);
    expect(back.verificationLevel).toBe('Full');
    expect(Buffer.from(back.feedId).toString('hex')).toBe(FEED);
    const partial = decodePriceUpdateV2(
      encodePriceUpdateV2({ ...fields, verificationLevel: { partial: 3 } }),
    );
    expect(partial.verificationLevel).toEqual({ partial: 3 });
  });

  it('rejects malformed feed ids', () => {
    expect(() => feedIdFromHex('abcd')).toThrow();
  });
});
