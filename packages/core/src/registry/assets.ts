import { z } from 'zod';

import type { ArenaAssetSpec, AssetClass } from '../engine/types';
import { MintExtensionSchema, TokenProgramSchema } from '../market/quality';

/**
 * Seed asset registry (ARCHITECTURE §6). Every value below was read from a
 * primary source on 2026-09-12 — the xStocks public API, Jupiter Tokens v2,
 * Pyth `/v2/price_feeds`, or a mainnet `getAccountInfo` — and is recorded in
 * docs/RESEARCH_NOTES.md. Nothing here is invented; unknown values are null
 * and assets that cannot safely participate are marked `Unsupported`.
 */

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const MarketHoursPolicySchema = z.enum(['Always', 'UsEquityRth']);
export type MarketHoursPolicy = z.infer<typeof MarketHoursPolicySchema>;

export const RegistryStatusSchema = z.enum(['Active', 'Suspended', 'Retired', 'Unsupported']);

export const AssetCategorySchema = z.enum([
  'Meme',
  'L1',
  'BtcWrapper',
  'Stock',
  'Etf',
  'Commodity',
]);

export const RegistryAssetSchema = z.object({
  symbol: z.string(),
  displaySymbol: z.string(),
  name: z.string(),
  mint: z.string(),
  decimals: z.number().int().min(0).max(18),
  tokenProgram: TokenProgramSchema,
  tokenProgramId: z.string(),
  category: AssetCategorySchema,
  assetClass: z.enum(['Crypto', 'Equity', 'Etf', 'Commodity']),
  isXStock: z.boolean(),
  /** Underlying ticker for xStocks. */
  underlying: z.string().nullable(),
  /** Pyth Core feed id (hex, no 0x) used for settlement. */
  pythFeedId: z.string().length(64).nullable(),
  pythSymbol: z.string().nullable(),
  /** Issuer-published xStock-specific Pyth feed (display cross-check only). */
  xstockPythFeedId: z.string().length(64).nullable(),
  chainlinkFeedId: z.string().nullable(),
  marketHours: MarketHoursPolicySchema,
  scaledUi: z.boolean(),
  extensions: z.array(MintExtensionSchema),
  /** Free-text Token-2022 notes shown in the rules drawer. */
  token2022Notes: z.string().nullable(),
  /** Oracle policy used to build the ArenaAssetSpec. */
  toleranceSecs: z.number().int().nonnegative(),
  maxClosedStalenessSecs: z.number().int().nonnegative(),
  maxConfBps: z.number().int().nonnegative(),
  visual: z.object({
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    logoUrl: z.url().nullable(),
    classTag: z.string(),
  }),
  status: RegistryStatusSchema,
  statusReason: z.string().nullable(),
  provenance: z.object({
    verifiedAt: z.string(),
    sources: z.array(z.string()),
  }),
});
export type RegistryAsset = z.infer<typeof RegistryAssetSchema>;

const VERIFIED = '2026-09-12';
const XSTOCK_EXTENSIONS = [
  'MetadataPointer',
  'PermanentDelegate',
  'DefaultAccountState',
  'ScaledUiAmount',
  'Pausable',
  'ConfidentialTransferMint',
  'TransferHook',
  'TokenMetadata',
] as const;
const XSTOCK_NOTES =
  'Token-2022 with ScaledUiAmount (raw balance constant; multiplier applied for display and for the Arena reference price), Pausable and PermanentDelegate controlled by the issuer, freeze authority set, TransferHook extension present with no program. Raw amounts are used in all transactions.';

function xstock(o: {
  symbol: string;
  name: string;
  mint: string;
  underlying: string;
  pythFeedId: string;
  xstockPythFeedId: string | null;
  chainlinkFeedId: string | null;
  color: string;
  classTag: string;
  category: 'Stock' | 'Etf' | 'Commodity';
  assetClass: AssetClass;
  /** Which of the seed mint(s) were inspected on-chain vs listed by the API. */
  sources: string[];
}): RegistryAsset {
  return RegistryAssetSchema.parse({
    symbol: o.symbol,
    displaySymbol: o.symbol,
    name: o.name,
    mint: o.mint,
    decimals: 8,
    tokenProgram: 'Token2022',
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
    category: o.category,
    assetClass: o.assetClass,
    isXStock: true,
    underlying: o.underlying,
    pythFeedId: o.pythFeedId,
    pythSymbol: `Equity.US.${o.underlying}/USD`,
    xstockPythFeedId: o.xstockPythFeedId,
    chainlinkFeedId: o.chainlinkFeedId,
    marketHours: 'UsEquityRth',
    scaledUi: true,
    extensions: [...XSTOCK_EXTENSIONS],
    token2022Notes: XSTOCK_NOTES,
    toleranceSecs: 120,
    maxClosedStalenessSecs: 72 * 3600,
    maxConfBps: 50,
    visual: {
      color: o.color,
      logoUrl: `https://xstocks-metadata.backed.fi/logos/tokens/${o.symbol}.png`,
      classTag: o.classTag,
    },
    status: 'Active',
    statusReason: null,
    provenance: { verifiedAt: VERIFIED, sources: o.sources },
  });
}

const XS_API = 'xStocks API /public/assets (Solana deployment)';
const XS_ORACLES = 'xStocks API /public/oracles (Solana)';
const PYTH_FEEDS = 'Pyth /v2/price_feeds?asset_type=equity';
const JUP_TOKENS = 'Jupiter Tokens v2 /search';
const RPC_MINT = 'mainnet getAccountInfo (jsonParsed) on the mint';

export const SEED_ASSETS: readonly RegistryAsset[] = [
  RegistryAssetSchema.parse({
    symbol: 'BONK',
    displaySymbol: 'BONK',
    name: 'Bonk',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    decimals: 5,
    tokenProgram: 'TokenProgram',
    tokenProgramId: TOKEN_PROGRAM_ID,
    category: 'Meme',
    assetClass: 'Crypto',
    isXStock: false,
    underlying: null,
    pythFeedId: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
    pythSymbol: 'Crypto.BONK/USD',
    xstockPythFeedId: null,
    chainlinkFeedId: null,
    marketHours: 'Always',
    scaledUi: false,
    extensions: [],
    token2022Notes: null,
    toleranceSecs: 60,
    maxClosedStalenessSecs: 0,
    maxConfBps: 100,
    visual: {
      color: '#FF8A1F',
      logoUrl: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
      classTag: 'MEME',
    },
    status: 'Active',
    statusReason: null,
    provenance: {
      verifiedAt: VERIFIED,
      sources: [RPC_MINT, JUP_TOKENS, 'Pyth /v2/price_feeds?asset_type=crypto'],
    },
  }),
  RegistryAssetSchema.parse({
    symbol: 'SOL',
    displaySymbol: 'SOL',
    name: 'Wrapped SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    tokenProgram: 'TokenProgram',
    tokenProgramId: TOKEN_PROGRAM_ID,
    category: 'L1',
    assetClass: 'Crypto',
    isXStock: false,
    underlying: null,
    pythFeedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    pythSymbol: 'Crypto.SOL/USD',
    xstockPythFeedId: null,
    chainlinkFeedId: null,
    marketHours: 'Always',
    scaledUi: false,
    extensions: [],
    token2022Notes: null,
    toleranceSecs: 60,
    maxClosedStalenessSecs: 0,
    maxConfBps: 100,
    visual: { color: '#19E0A0', logoUrl: null, classTag: 'L1' },
    status: 'Active',
    statusReason: null,
    provenance: {
      verifiedAt: VERIFIED,
      sources: [JUP_TOKENS, 'Pyth /v2/price_feeds?asset_type=crypto'],
    },
  }),
  RegistryAssetSchema.parse({
    symbol: 'WBTC',
    displaySymbol: 'BTC',
    name: 'Wrapped BTC (Portal)',
    mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    decimals: 8,
    tokenProgram: 'TokenProgram',
    tokenProgramId: TOKEN_PROGRAM_ID,
    category: 'BtcWrapper',
    assetClass: 'Crypto',
    isXStock: false,
    underlying: 'BTC',
    // Settlement feed is the wrapper's own feed so the Arena measures what the user actually owns.
    pythFeedId: 'c9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33',
    pythSymbol: 'Crypto.WBTC/USD',
    xstockPythFeedId: null,
    chainlinkFeedId: null,
    marketHours: 'Always',
    scaledUi: false,
    extensions: [],
    token2022Notes: null,
    toleranceSecs: 60,
    maxClosedStalenessSecs: 0,
    maxConfBps: 100,
    visual: { color: '#F7931A', logoUrl: null, classTag: 'BTC' },
    status: 'Active',
    statusReason:
      'BTC is represented by Wormhole Portal WBTC: largest Solana liquidity ($35.4M) and organic score (96.7) among BTC wrappers on 2026-09-12; cbBTC ($29.0M, 92.1) is the alternative.',
    provenance: {
      verifiedAt: VERIFIED,
      sources: [JUP_TOKENS, 'Pyth /v2/price_feeds?asset_type=crypto'],
    },
  }),
  RegistryAssetSchema.parse({
    symbol: 'PENGU',
    displaySymbol: 'PENGU',
    name: 'Pudgy Penguins',
    mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
    decimals: 6,
    tokenProgram: 'TokenProgram',
    tokenProgramId: TOKEN_PROGRAM_ID,
    category: 'Meme',
    assetClass: 'Crypto',
    isXStock: false,
    underlying: null,
    pythFeedId: 'bed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61',
    pythSymbol: 'Crypto.PENGU/USD',
    xstockPythFeedId: null,
    chainlinkFeedId: null,
    marketHours: 'Always',
    scaledUi: false,
    extensions: [],
    token2022Notes: null,
    toleranceSecs: 60,
    maxClosedStalenessSecs: 0,
    maxConfBps: 100,
    visual: { color: '#7FD1FF', logoUrl: null, classTag: 'MEME' },
    status: 'Active',
    statusReason: null,
    provenance: {
      verifiedAt: VERIFIED,
      sources: [JUP_TOKENS, 'Pyth /v2/price_feeds?asset_type=crypto'],
    },
  }),
  RegistryAssetSchema.parse({
    symbol: 'WIF',
    displaySymbol: 'WIF',
    name: 'dogwifhat',
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    decimals: 6,
    tokenProgram: 'TokenProgram',
    tokenProgramId: TOKEN_PROGRAM_ID,
    category: 'Meme',
    assetClass: 'Crypto',
    isXStock: false,
    underlying: null,
    pythFeedId: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
    pythSymbol: 'Crypto.WIF/USD',
    xstockPythFeedId: null,
    chainlinkFeedId: null,
    marketHours: 'Always',
    scaledUi: false,
    extensions: [],
    token2022Notes: null,
    toleranceSecs: 60,
    maxClosedStalenessSecs: 0,
    maxConfBps: 100,
    visual: { color: '#D9A066', logoUrl: null, classTag: 'MEME' },
    status: 'Active',
    statusReason: null,
    provenance: {
      verifiedAt: VERIFIED,
      sources: [JUP_TOKENS, 'Pyth /v2/price_feeds?asset_type=crypto'],
    },
  }),
  xstock({
    symbol: 'TSLAx',
    name: 'Tesla xStock',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    underlying: 'TSLA',
    pythFeedId: '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
    xstockPythFeedId: '47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362',
    chainlinkFeedId: '0x000a80c655069b61d168b887d5e7f4231fe288c6ccb84b1854c9ccead20f3398',
    color: '#E31937',
    classTag: 'STOCK',
    category: 'Stock',
    assetClass: 'Equity',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS, JUP_TOKENS, RPC_MINT],
  }),
  xstock({
    symbol: 'SPYx',
    name: 'SP500 xStock',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    underlying: 'SPY',
    pythFeedId: '19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5',
    xstockPythFeedId: '2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14',
    chainlinkFeedId: '0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77',
    color: '#2559CC',
    classTag: 'INDEX',
    category: 'Etf',
    assetClass: 'Etf',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS],
  }),
  xstock({
    symbol: 'MSTRx',
    name: 'MicroStrategy xStock',
    mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ',
    underlying: 'MSTR',
    pythFeedId: 'e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09',
    xstockPythFeedId: '53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28',
    chainlinkFeedId: '0x000a7b26938f7df83a0bd00f76b0f644a6ef4f28b5cbb9afb800fbcdc8536255',
    color: '#FF5E1F',
    classTag: 'STOCK',
    category: 'Stock',
    assetClass: 'Equity',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS],
  }),
  xstock({
    symbol: 'DISx',
    name: 'The Walt Disney xStock',
    mint: 'Xsg93jDV656ULQ5u9yT2x5DS9b4xGD8aDCtfESSW6Bb',
    underlying: 'DIS',
    pythFeedId: '703e36203020ae6761e6298975764e266fb869210db9b35dd4e4225fa68217d0',
    xstockPythFeedId: null, // no issuer oracle entry for DISx
    chainlinkFeedId: null,
    color: '#1E3BB8',
    classTag: 'STOCK',
    category: 'Stock',
    assetClass: 'Equity',
    sources: [XS_API, PYTH_FEEDS],
  }),
  xstock({
    symbol: 'NVDAx',
    name: 'NVIDIA xStock',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    underlying: 'NVDA',
    pythFeedId: 'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
    xstockPythFeedId: '4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f',
    chainlinkFeedId: '0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a',
    color: '#76B900',
    classTag: 'STOCK',
    category: 'Stock',
    assetClass: 'Equity',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS, JUP_TOKENS],
  }),
  xstock({
    symbol: 'AAPLx',
    name: 'Apple xStock',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    underlying: 'AAPL',
    pythFeedId: '49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
    xstockPythFeedId: '978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675',
    chainlinkFeedId: '0x000a7a12270b5a30236bf410679df0c6bb1bba2b40e5d86847748ff1c8f8452b',
    color: '#B8BCC6',
    classTag: 'STOCK',
    category: 'Stock',
    assetClass: 'Equity',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS],
  }),
  xstock({
    symbol: 'GMEx',
    name: 'Gamestop xStock',
    mint: 'Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc',
    underlying: 'GME',
    pythFeedId: '6f9cd89ef1b7fd39f667101a91ad578b6c6ace4579d5f7f285a4b06aa4504be6',
    xstockPythFeedId: null, // issuer lists a Pyth Lazer id (3387) only
    chainlinkFeedId: null,
    color: '#C62828',
    classTag: 'STOCK',
    category: 'Stock',
    assetClass: 'Equity',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS, JUP_TOKENS],
  }),
  xstock({
    symbol: 'GLDx',
    name: 'Gold xStock',
    mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re',
    underlying: 'GLD',
    pythFeedId: 'e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca',
    xstockPythFeedId: 'e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96',
    chainlinkFeedId: null,
    color: '#E6B422',
    classTag: 'COMMODITY',
    category: 'Commodity',
    assetClass: 'Etf',
    sources: [XS_API, XS_ORACLES, PYTH_FEEDS],
  }),
];

/** Seed Arena pairs (PRODUCT §8). */
export const SEED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['BONK', 'TSLAx'],
  ['SOL', 'SPYx'],
  ['WBTC', 'MSTRx'],
  ['PENGU', 'DISx'],
  ['NVDAx', 'AAPLx'],
  ['WIF', 'GMEx'],
  ['GLDx', 'WBTC'],
];

export function findAsset(symbol: string): RegistryAsset | undefined {
  return SEED_ASSETS.find((a) => a.symbol === symbol || a.displaySymbol === symbol);
}

/** Build the engine-facing spec from a registry entry. */
export function toArenaAssetSpec(a: RegistryAsset): ArenaAssetSpec {
  if (a.pythFeedId === null) throw new Error(`${a.symbol} has no settlement feed`);
  if (a.status !== 'Active') throw new Error(`${a.symbol} is ${a.status}`);
  return {
    mint: a.mint,
    decimals: a.decimals,
    assetClass: a.assetClass,
    feedId: a.pythFeedId,
    scaledUi: a.scaledUi,
    toleranceSecs: BigInt(a.toleranceSecs),
    maxClosedStalenessSecs: BigInt(a.maxClosedStalenessSecs),
    maxConfBps: BigInt(a.maxConfBps),
  };
}
