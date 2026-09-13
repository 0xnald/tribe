/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tribe_arena.json`.
 */
export type TribeArena = {
  address: 'shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4';
  metadata: {
    name: 'tribeArena';
    version: '0.1.0';
    spec: '0.1.0';
    description: 'Tribe Arena program: competitive ownership layer for markets on Solana';
  };
  instructions: [
    {
      name: 'back';
      discriminator: [1, 144, 109, 177, 110, 131, 124, 0];
      accounts: [
        {
          name: 'owner';
          writable: true;
          signer: true;
          relations: ['position'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
          relations: ['position'];
        },
        {
          name: 'position';
          writable: true;
        },
        {
          name: 'assetMint';
          docs: ["The side's mint — must be the registered asset for `side`."];
        },
        {
          name: 'ownerAsset';
          writable: true;
        },
        {
          name: 'positionVault';
          docs: ['Position vault (created by `open_position`).'];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'position';
              },
              {
                kind: 'account';
                path: 'assetTokenProgram';
              },
              {
                kind: 'account';
                path: 'assetMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'assetTokenProgram';
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'ownerUsdc';
          writable: true;
        },
        {
          name: 'rewardVault';
          writable: true;
        },
        {
          name: 'treasury';
          writable: true;
        },
        {
          name: 'creatorUsdc';
          writable: true;
          optional: true;
        },
        {
          name: 'usdcTokenProgram';
        },
      ];
      args: [
        {
          name: 'side';
          type: 'u8';
        },
        {
          name: 'units';
          type: 'u64';
        },
        {
          name: 'feePaid';
          type: 'u64';
        },
      ];
    },
    {
      name: 'cancelArena';
      discriminator: [104, 161, 139, 47, 18, 111, 92, 43];
      accounts: [
        {
          name: 'authority';
          signer: true;
          relations: ['config'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
        },
      ];
      args: [
        {
          name: 'reasonCode';
          type: 'u16';
        },
      ];
    },
    {
      name: 'cancelExpired';
      discriminator: [248, 138, 112, 93, 177, 89, 249, 246];
      accounts: [
        {
          name: 'cranker';
          signer: true;
        },
        {
          name: 'arena';
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: 'claim';
      discriminator: [62, 198, 214, 193, 213, 159, 108, 210];
      accounts: [
        {
          name: 'owner';
          signer: true;
          relations: ['position'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
          relations: ['position'];
        },
        {
          name: 'position';
          writable: true;
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'rewardVault';
          writable: true;
        },
        {
          name: 'ownerUsdc';
          docs: ['Reward destination must be owned by the claimant.'];
          writable: true;
        },
        {
          name: 'usdcTokenProgram';
        },
      ];
      args: [];
    },
    {
      name: 'createArena';
      discriminator: [174, 236, 45, 61, 197, 215, 149, 169];
      accounts: [
        {
          name: 'creator';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'assetA';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [97, 115, 115, 101, 116];
              },
              {
                kind: 'account';
                path: 'assetA.mint';
                account: 'assetEntry';
              },
            ];
          };
        },
        {
          name: 'assetB';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [97, 115, 115, 101, 116];
              },
              {
                kind: 'account';
                path: 'assetB.mint';
                account: 'assetEntry';
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [97, 114, 101, 110, 97];
              },
              {
                kind: 'account';
                path: 'creator';
              },
              {
                kind: 'arg';
                path: 'args.nonce';
              },
            ];
          };
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'rewardVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'arena';
              },
              {
                kind: 'account';
                path: 'usdcTokenProgram';
              },
              {
                kind: 'account';
                path: 'usdcMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'usdcTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'createArenaArgs';
            };
          };
        },
      ];
    },
    {
      name: 'exit';
      discriminator: [234, 32, 12, 71, 126, 5, 219, 160];
      accounts: [
        {
          name: 'owner';
          signer: true;
          relations: ['position'];
        },
        {
          name: 'arena';
          writable: true;
          relations: ['position'];
        },
        {
          name: 'position';
          writable: true;
        },
        {
          name: 'assetMint';
        },
        {
          name: 'positionVault';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'position';
              },
              {
                kind: 'account';
                path: 'assetTokenProgram';
              },
              {
                kind: 'account';
                path: 'assetMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'ownerAsset';
          docs: ['Destination must be owned by the position owner.'];
          writable: true;
        },
        {
          name: 'assetTokenProgram';
        },
      ];
      args: [
        {
          name: 'units';
          type: 'u64';
        },
      ];
    },
    {
      name: 'extendSettlement';
      discriminator: [37, 213, 212, 44, 107, 158, 247, 111];
      accounts: [
        {
          name: 'authority';
          signer: true;
          relations: ['config'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
        },
      ];
      args: [
        {
          name: 'secs';
          type: 'i64';
        },
      ];
    },
    {
      name: 'fundRewardPool';
      discriminator: [85, 49, 108, 245, 204, 70, 243, 3];
      accounts: [
        {
          name: 'sponsor';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
        },
        {
          name: 'sponsorRecord';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [115, 112, 111, 110, 115, 111, 114];
              },
              {
                kind: 'account';
                path: 'arena';
              },
              {
                kind: 'account';
                path: 'sponsor';
              },
            ];
          };
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'sponsorUsdc';
          writable: true;
        },
        {
          name: 'rewardVault';
          writable: true;
        },
        {
          name: 'usdcTokenProgram';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [
        {
          name: 'amount';
          type: 'u64';
        },
      ];
    },
    {
      name: 'initConfig';
      discriminator: [23, 235, 115, 232, 168, 96, 1, 231];
      accounts: [
        {
          name: 'authority';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'treasury';
          docs: ['Protocol treasury USDC account (any owner chosen by the authority).'];
        },
        {
          name: 'upsetReserve';
          docs: ['Upset Reserve: ATA of the config PDA.'];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'config';
              },
              {
                kind: 'account';
                path: 'usdcTokenProgram';
              },
              {
                kind: 'account';
                path: 'usdcMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'usdcTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'initConfigArgs';
            };
          };
        },
      ];
    },
    {
      name: 'openPosition';
      discriminator: [135, 128, 47, 77, 15, 152, 240, 49];
      accounts: [
        {
          name: 'owner';
          writable: true;
          signer: true;
        },
        {
          name: 'arena';
        },
        {
          name: 'position';
          writable: true;
        },
        {
          name: 'assetMint';
        },
        {
          name: 'positionVault';
          docs: [
            'Position vault: ATA of the position PDA. Only `owner` can move units out (`exit`).',
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'account';
                path: 'position';
              },
              {
                kind: 'account';
                path: 'assetTokenProgram';
              },
              {
                kind: 'account';
                path: 'assetMint';
              },
            ];
            program: {
              kind: 'const';
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: 'assetTokenProgram';
        },
        {
          name: 'associatedTokenProgram';
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [
        {
          name: 'side';
          type: 'u8';
        },
      ];
    },
    {
      name: 'refundSponsor';
      discriminator: [137, 0, 158, 28, 172, 220, 165, 25];
      accounts: [
        {
          name: 'sponsor';
          signer: true;
          relations: ['sponsorRecord'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
        },
        {
          name: 'sponsorRecord';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [115, 112, 111, 110, 115, 111, 114];
              },
              {
                kind: 'account';
                path: 'arena';
              },
              {
                kind: 'account';
                path: 'sponsor';
              },
            ];
          };
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'sponsorUsdc';
          writable: true;
        },
        {
          name: 'rewardVault';
          writable: true;
        },
        {
          name: 'usdcTokenProgram';
        },
      ];
      args: [];
    },
    {
      name: 'setAsset';
      discriminator: [243, 216, 48, 30, 63, 58, 91, 239];
      accounts: [
        {
          name: 'authority';
          writable: true;
          signer: true;
          relations: ['config'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'asset';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [97, 115, 115, 101, 116];
              },
              {
                kind: 'account';
                path: 'mint';
              },
            ];
          };
        },
        {
          name: 'mint';
        },
        {
          name: 'tokenProgram';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'setAssetArgs';
            };
          };
        },
      ];
    },
    {
      name: 'setPaused';
      discriminator: [91, 60, 125, 192, 176, 225, 166, 218];
      accounts: [
        {
          name: 'authority';
          signer: true;
          relations: ['config'];
        },
        {
          name: 'config';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
      ];
      args: [
        {
          name: 'paused';
          type: 'bool';
        },
      ];
    },
    {
      name: 'settle';
      discriminator: [175, 42, 185, 87, 144, 131, 102, 212];
      accounts: [
        {
          name: 'cranker';
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
        },
        {
          name: 'priceUpdateA';
        },
        {
          name: 'priceUpdateB';
        },
        {
          name: 'mintA';
        },
        {
          name: 'mintB';
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'upsetReserve';
          writable: true;
        },
        {
          name: 'rewardVault';
          writable: true;
        },
        {
          name: 'usdcTokenProgram';
        },
      ];
      args: [];
    },
    {
      name: 'snapshotStart';
      discriminator: [108, 236, 59, 172, 109, 2, 70, 248];
      accounts: [
        {
          name: 'cranker';
          signer: true;
        },
        {
          name: 'arena';
          writable: true;
        },
        {
          name: 'priceUpdateA';
        },
        {
          name: 'priceUpdateB';
        },
        {
          name: 'mintA';
        },
        {
          name: 'mintB';
        },
      ];
      args: [];
    },
    {
      name: 'sweepUnclaimed';
      discriminator: [64, 168, 221, 224, 42, 216, 138, 144];
      accounts: [
        {
          name: 'cranker';
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: 'arena';
          writable: true;
        },
        {
          name: 'usdcMint';
        },
        {
          name: 'rewardVault';
          writable: true;
        },
        {
          name: 'treasury';
          docs: [
            'Rollover destination: the protocol treasury (per-pair rollover vaults are post-MVP).',
          ];
          writable: true;
        },
        {
          name: 'usdcTokenProgram';
        },
      ];
      args: [];
    },
  ];
  accounts: [
    {
      name: 'arena';
      discriminator: [243, 215, 44, 44, 231, 211, 232, 168];
    },
    {
      name: 'assetEntry';
      discriminator: [188, 204, 219, 208, 231, 79, 223, 47];
    },
    {
      name: 'position';
      discriminator: [170, 188, 143, 228, 122, 64, 247, 208];
    },
    {
      name: 'protocolConfig';
      discriminator: [207, 91, 250, 28, 152, 179, 215, 209];
    },
    {
      name: 'sponsor';
      discriminator: [19, 128, 115, 109, 118, 109, 66, 213];
    },
  ];
  events: [
    {
      name: 'arenaCancelled';
      discriminator: [78, 72, 160, 220, 199, 234, 70, 227];
    },
    {
      name: 'arenaCreated';
      discriminator: [93, 57, 84, 96, 112, 3, 148, 17];
    },
    {
      name: 'arenaSettled';
      discriminator: [54, 201, 162, 154, 85, 183, 209, 60];
    },
    {
      name: 'arenaStarted';
      discriminator: [88, 67, 253, 107, 214, 211, 21, 200];
    },
    {
      name: 'backed';
      discriminator: [42, 235, 220, 40, 248, 188, 206, 255];
    },
    {
      name: 'exited';
      discriminator: [219, 97, 107, 184, 198, 48, 50, 243];
    },
    {
      name: 'poolFunded';
      discriminator: [164, 221, 242, 68, 164, 64, 24, 214];
    },
    {
      name: 'rewardClaimed';
      discriminator: [49, 28, 87, 84, 158, 48, 229, 175];
    },
    {
      name: 'settlementExtended';
      discriminator: [250, 141, 223, 126, 194, 57, 104, 90];
    },
    {
      name: 'sponsorRefunded';
      discriminator: [240, 109, 192, 135, 64, 233, 69, 160];
    },
    {
      name: 'unclaimedSwept';
      discriminator: [20, 92, 19, 237, 135, 103, 255, 168];
    },
  ];
  errors: [
    {
      code: 6000;
      name: 'nonMonotonicClock';
      msg: 'clock moved backwards';
    },
    {
      code: 6001;
      name: 'invalidStatus';
      msg: 'invalid arena status for this instruction';
    },
    {
      code: 6002;
      name: 'tooEarly';
      msg: 'too early';
    },
    {
      code: 6003;
      name: 'tooLate';
      msg: 'too late';
    },
    {
      code: 6004;
      name: 'backingClosed';
      msg: 'backing is closed for this arena';
    },
    {
      code: 6005;
      name: 'alreadySettled';
      msg: 'arena already settled';
    },
    {
      code: 6006;
      name: 'alreadyExtended';
      msg: 'settlement already extended';
    },
    {
      code: 6007;
      name: 'notExpired';
      msg: 'window not expired';
    },
    {
      code: 6008;
      name: 'zeroAmount';
      msg: 'amount must be greater than zero';
    },
    {
      code: 6009;
      name: 'belowMinimumBacking';
      msg: 'notional below minimum backing';
    },
    {
      code: 6010;
      name: 'feeTooLow';
      msg: 'fee paid below requirement';
    },
    {
      code: 6011;
      name: 'insufficientUnits';
      msg: 'insufficient units in position';
    },
    {
      code: 6012;
      name: 'invalidParams';
      msg: 'invalid parameters';
    },
    {
      code: 6013;
      name: 'sameAsset';
      msg: 'both sides reference the same asset';
    },
    {
      code: 6014;
      name: 'oracleFeedMismatch';
      msg: 'oracle feed id mismatch';
    },
    {
      code: 6015;
      name: 'oracleNotFullyVerified';
      msg: 'oracle update not fully verified';
    },
    {
      code: 6016;
      name: 'oracleNonPositivePrice';
      msg: 'oracle price not positive';
    },
    {
      code: 6017;
      name: 'oracleConfidenceTooWide';
      msg: 'oracle confidence too wide';
    },
    {
      code: 6018;
      name: 'oracleStale';
      msg: 'oracle price stale for the target window';
    },
    {
      code: 6019;
      name: 'oracleTooEarly';
      msg: 'oracle price published after the target window';
    },
    {
      code: 6020;
      name: 'oracleUnsupportedExponent';
      msg: 'oracle exponent unsupported';
    },
    {
      code: 6021;
      name: 'positionNotFound';
      msg: 'position not found';
    },
    {
      code: 6022;
      name: 'alreadyClaimed';
      msg: 'reward already claimed';
    },
    {
      code: 6023;
      name: 'notWinningSide';
      msg: 'position is not on the winning side';
    },
    {
      code: 6024;
      name: 'noWinner';
      msg: 'arena ended in a tie; no winner';
    },
    {
      code: 6025;
      name: 'noRewardWeight';
      msg: 'position has no reward weight';
    },
    {
      code: 6026;
      name: 'nothingToClaim';
      msg: 'nothing to claim';
    },
    {
      code: 6027;
      name: 'sponsorNotFound';
      msg: 'sponsor record not found';
    },
    {
      code: 6028;
      name: 'sponsorAlreadyRefunded';
      msg: 'sponsor already refunded';
    },
    {
      code: 6029;
      name: 'sponsorClosed';
      msg: 'sponsor funding is closed';
    },
    {
      code: 6030;
      name: 'refundNotAvailable';
      msg: 'refund not available in this status';
    },
    {
      code: 6031;
      name: 'insufficientVault';
      msg: 'insufficient vault balance';
    },
    {
      code: 6032;
      name: 'unauthorized';
      msg: 'unauthorized';
    },
    {
      code: 6033;
      name: 'mathOverflow';
      msg: 'arithmetic overflow';
    },
    {
      code: 6034;
      name: 'assetNotActive';
      msg: 'asset is not active in the registry';
    },
    {
      code: 6035;
      name: 'mintMismatch';
      msg: 'mint does not match the registered asset';
    },
    {
      code: 6036;
      name: 'tokenProgramMismatch';
      msg: 'token program does not match the registered asset';
    },
    {
      code: 6037;
      name: 'unsupportedExtension';
      msg: 'mint has an unsupported Token-2022 extension';
    },
    {
      code: 6038;
      name: 'activeTransferHook';
      msg: 'mint has an active transfer hook';
    },
    {
      code: 6039;
      name: 'paused';
      msg: 'protocol is paused';
    },
    {
      code: 6040;
      name: 'depositMismatch';
      msg: 'deposited amount did not match the vault delta';
    },
    {
      code: 6041;
      name: 'ownerMismatch';
      msg: 'token account owner mismatch';
    },
    {
      code: 6042;
      name: 'invalidSide';
      msg: 'side index must be 0 or 1';
    },
    {
      code: 6043;
      name: 'invalidMultiplier';
      msg: 'scaled-ui multiplier out of range';
    },
  ];
  types: [
    {
      name: 'arena';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'creator';
            type: 'pubkey';
          },
          {
            name: 'nonce';
            type: 'u64';
          },
          {
            name: 'nonceLe';
            docs: ['`nonce.to_le_bytes()` kept for PDA seed reconstruction.'];
            type: {
              array: ['u8', 8];
            };
          },
          {
            name: 'assets';
            type: {
              array: [
                {
                  defined: {
                    name: 'arenaAsset';
                  };
                },
                2,
              ];
            };
          },
          {
            name: 'startTs';
            type: 'i64';
          },
          {
            name: 'endTs';
            type: 'i64';
          },
          {
            name: 'backingCloseTs';
            type: 'i64';
          },
          {
            name: 'params';
            type: {
              defined: {
                name: 'arenaParams';
              };
            };
          },
          {
            name: 'feePolicy';
            type: {
              defined: {
                name: 'feePolicy';
              };
            };
          },
          {
            name: 'creatorTarget';
            docs: ["`creator_target::*` for this Arena's creator share."];
            type: 'u8';
          },
          {
            name: 'allowClosedSettlement';
            type: 'bool';
          },
          {
            name: 'sponsorOpen';
            type: 'bool';
          },
          {
            name: 'status';
            type: 'u8';
          },
          {
            name: 'startPrices';
            type: {
              array: [
                {
                  defined: {
                    name: 'priceSnapshot';
                  };
                },
                2,
              ];
            };
          },
          {
            name: 'endPrices';
            type: {
              array: [
                {
                  defined: {
                    name: 'priceSnapshot';
                  };
                },
                2,
              ];
            };
          },
          {
            name: 'lastAccrualTs';
            type: 'i64';
          },
          {
            name: 'sides';
            type: {
              array: [
                {
                  defined: {
                    name: 'sideState';
                  };
                },
                2,
              ];
            };
          },
          {
            name: 'rewardVault';
            type: 'pubkey';
          },
          {
            name: 'rewardPoolBalance';
            docs: [
              'USDC accounting (micro). `reward_pool_balance` mirrors the vault and is',
              'the settlement base pool (the vault may hold more from direct donations).',
            ];
            type: 'u64';
          },
          {
            name: 'sponsorTotal';
            type: 'u64';
          },
          {
            name: 'rolloverIn';
            type: 'u64';
          },
          {
            name: 'rolloverOut';
            type: 'u64';
          },
          {
            name: 'protocolFees';
            type: 'u64';
          },
          {
            name: 'creatorFees';
            type: 'u64';
          },
          {
            name: 'totalClaimed';
            type: 'u64';
          },
          {
            name: 'settlement';
            type: {
              defined: {
                name: 'settlementRecord';
              };
            };
          },
          {
            name: 'cancelReason';
            type: 'u8';
          },
          {
            name: 'extensions';
            type: 'u8';
          },
          {
            name: 'extensionSecs';
            type: 'i64';
          },
          {
            name: 'claimsSweptAt';
            type: 'i64';
          },
          {
            name: 'bump';
            type: 'u8';
          },
          {
            name: 'reserved';
            type: {
              array: ['u8', 64];
            };
          },
        ];
      };
    },
    {
      name: 'arenaAsset';
      docs: ['Per-side asset facts snapshotted into the Arena at creation.'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'mint';
            type: 'pubkey';
          },
          {
            name: 'tokenProgram';
            type: 'pubkey';
          },
          {
            name: 'decimals';
            type: 'u8';
          },
          {
            name: 'assetClass';
            type: 'u8';
          },
          {
            name: 'feedId';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'scaledUi';
            type: 'bool';
          },
          {
            name: 'toleranceSecs';
            type: 'i64';
          },
          {
            name: 'maxClosedStalenessSecs';
            type: 'i64';
          },
          {
            name: 'maxConfBps';
            type: 'u16';
          },
        ];
      };
    },
    {
      name: 'arenaCancelled';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'expired';
            type: 'bool';
          },
          {
            name: 'reasonCode';
            type: 'u16';
          },
        ];
      };
    },
    {
      name: 'arenaCreated';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'creator';
            type: 'pubkey';
          },
          {
            name: 'mintA';
            type: 'pubkey';
          },
          {
            name: 'mintB';
            type: 'pubkey';
          },
          {
            name: 'startTs';
            type: 'i64';
          },
          {
            name: 'endTs';
            type: 'i64';
          },
          {
            name: 'backingCloseTs';
            type: 'i64';
          },
        ];
      };
    },
    {
      name: 'arenaParams';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'tieBps';
            type: 'u16';
          },
          {
            name: 'minHoldBps';
            type: 'u16';
          },
          {
            name: 'minHoldFloorSecs';
            type: 'i64';
          },
          {
            name: 'underdog';
            type: {
              defined: {
                name: 'underdogPolicy';
              };
            };
          },
          {
            name: 'settlementGraceSecs';
            type: 'i64';
          },
          {
            name: 'minBackingUsdc';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'arenaSettled';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'winner';
            type: 'u8';
          },
          {
            name: 'perfBpsA';
            type: 'i64';
          },
          {
            name: 'perfBpsB';
            type: 'i64';
          },
          {
            name: 'poolAtSettlement';
            type: 'u64';
          },
          {
            name: 'upsetBonus';
            type: 'u64';
          },
          {
            name: 'mSettleQ4';
            type: 'u32';
          },
        ];
      };
    },
    {
      name: 'arenaStarted';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'priceAQ8';
            type: 'u64';
          },
          {
            name: 'priceBQ8';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'assetEntry';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'mint';
            type: 'pubkey';
          },
          {
            name: 'tokenProgram';
            type: 'pubkey';
          },
          {
            name: 'decimals';
            type: 'u8';
          },
          {
            name: 'assetClass';
            type: 'u8';
          },
          {
            name: 'feedId';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'scaledUi';
            type: 'bool';
          },
          {
            name: 'toleranceSecs';
            type: 'i64';
          },
          {
            name: 'maxClosedStalenessSecs';
            type: 'i64';
          },
          {
            name: 'maxConfBps';
            type: 'u16';
          },
          {
            name: 'status';
            type: 'u8';
          },
          {
            name: 'bump';
            type: 'u8';
          },
          {
            name: 'reserved';
            type: {
              array: ['u8', 32];
            };
          },
        ];
      };
    },
    {
      name: 'backed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'owner';
            type: 'pubkey';
          },
          {
            name: 'side';
            type: 'u8';
          },
          {
            name: 'units';
            type: 'u64';
          },
          {
            name: 'feePaid';
            type: 'u64';
          },
          {
            name: 'feeRequired';
            type: 'u64';
          },
          {
            name: 'multiplierQ4';
            type: 'u32';
          },
          {
            name: 'notionalUsdc';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'createArenaArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'nonce';
            type: 'u64';
          },
          {
            name: 'startTs';
            type: 'i64';
          },
          {
            name: 'endTs';
            type: 'i64';
          },
          {
            name: 'allowClosedSettlement';
            type: 'bool';
          },
          {
            name: 'sponsorOpen';
            type: 'bool';
          },
          {
            name: 'firstParty';
            docs: ['First-party Arenas route the creator share per protocol policy.'];
            type: 'bool';
          },
        ];
      };
    },
    {
      name: 'exited';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'owner';
            type: 'pubkey';
          },
          {
            name: 'side';
            type: 'u8';
          },
          {
            name: 'units';
            type: 'u64';
          },
          {
            name: 'forfeitedWeight';
            type: 'u128';
          },
        ];
      };
    },
    {
      name: 'feePolicy';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'feeBps';
            type: 'u16';
          },
          {
            name: 'rewardPoolBps';
            type: 'u16';
          },
          {
            name: 'protocolBps';
            type: 'u16';
          },
          {
            name: 'creatorBps';
            type: 'u16';
          },
          {
            name: 'firstPartyCreatorTarget';
            docs: ['Where the creator share of first-party Arenas goes (see `CreatorTarget`).'];
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'initConfigArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'feePolicy';
            type: {
              defined: {
                name: 'feePolicy';
              };
            };
          },
          {
            name: 'limits';
            type: {
              defined: {
                name: 'protocolLimits';
              };
            };
          },
          {
            name: 'defaultParams';
            type: {
              defined: {
                name: 'arenaParams';
              };
            };
          },
        ];
      };
    },
    {
      name: 'poolFunded';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'sponsor';
            type: 'pubkey';
          },
          {
            name: 'amount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'position';
      docs: [
        'Mirrors `PositionState` in the TS engine. The position PDA is the',
        'authority of its own vault ATA; only `owner` can move units out.',
      ];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'owner';
            type: 'pubkey';
          },
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'side';
            type: 'u8';
          },
          {
            name: 'units';
            type: 'u64';
          },
          {
            name: 'unitSeconds';
            type: 'u128';
          },
          {
            name: 'effUnits';
            type: 'u128';
          },
          {
            name: 'effUnitSeconds';
            type: 'u128';
          },
          {
            name: 'entryTs';
            type: 'i64';
          },
          {
            name: 'lastTouchTs';
            type: 'i64';
          },
          {
            name: 'claimed';
            type: 'bool';
          },
          {
            name: 'deposits';
            type: 'u32';
          },
          {
            name: 'feePaid';
            type: 'u64';
          },
          {
            name: 'forfeited';
            type: 'bool';
          },
          {
            name: 'bump';
            type: 'u8';
          },
          {
            name: 'reserved';
            type: {
              array: ['u8', 32];
            };
          },
        ];
      };
    },
    {
      name: 'priceFeedMessage';
      repr: {
        kind: 'c';
      };
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'feedId';
            docs: [
              "`FeedId` but avoid the type alias because of compatibility issues with Anchor's `idl-build` feature.",
            ];
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'price';
            type: 'i64';
          },
          {
            name: 'conf';
            type: 'u64';
          },
          {
            name: 'exponent';
            type: 'i32';
          },
          {
            name: 'publishTime';
            docs: ['The timestamp of this price update in seconds'];
            type: 'i64';
          },
          {
            name: 'prevPublishTime';
            docs: [
              'The timestamp of the previous price update. This field is intended to allow users to',
              'identify the single unique price update for any moment in time:',
              'for any time t, the unique update is the one such that prev_publish_time < t <= publish_time.',
              '',
              'Note that there may not be such an update while we are migrating to the new message-sending logic,',
              'as some price updates on pythnet may not be sent to other chains (because the message-sending',
              'logic may not have triggered). We can solve this problem by making the message-sending mandatory',
              '(which we can do once publishers have migrated over).',
              '',
              'Additionally, this field may be equal to publish_time if the message is sent on a slot where',
              'where the aggregation was unsuccesful. This problem will go away once all publishers have',
              'migrated over to a recent version of pyth-agent.',
            ];
            type: 'i64';
          },
          {
            name: 'emaPrice';
            type: 'i64';
          },
          {
            name: 'emaConf';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'priceSnapshot';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'priceQ8';
            docs: ['Reference price of one raw unit (Q8), multiplier applied.'];
            type: 'u64';
          },
          {
            name: 'oraclePriceQ8';
            type: 'u64';
          },
          {
            name: 'publishTime';
            type: 'i64';
          },
          {
            name: 'mode';
            type: 'u8';
          },
          {
            name: 'multQ6';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'priceUpdateV2';
      docs: [
        'A price update account. This account is used by the Pyth Receiver program to store a verified price update from a Pyth price feed.',
        'It contains:',
        '- `write_authority`: The write authority for this account. This authority can close this account to reclaim rent or update the account to contain a different price update.',
        '- `verification_level`: The [`VerificationLevel`] of this price update. This represents how many Wormhole guardian signatures have been verified for this price update.',
        '- `price_message`: The actual price update.',
        '- `posted_slot`: The slot at which this price update was posted.',
      ];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'writeAuthority';
            type: 'pubkey';
          },
          {
            name: 'verificationLevel';
            type: {
              defined: {
                name: 'verificationLevel';
              };
            };
          },
          {
            name: 'priceMessage';
            type: {
              defined: {
                name: 'priceFeedMessage';
              };
            };
          },
          {
            name: 'postedSlot';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'protocolConfig';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'authority';
            type: 'pubkey';
          },
          {
            name: 'usdcMint';
            type: 'pubkey';
          },
          {
            name: 'usdcDecimals';
            type: 'u8';
          },
          {
            name: 'treasury';
            docs: ['USDC token account receiving the protocol fee share.'];
            type: 'pubkey';
          },
          {
            name: 'upsetReserve';
            docs: ['USDC token account (ATA of this PDA) funding Upset Bonuses.'];
            type: 'pubkey';
          },
          {
            name: 'feePolicy';
            type: {
              defined: {
                name: 'feePolicy';
              };
            };
          },
          {
            name: 'limits';
            type: {
              defined: {
                name: 'protocolLimits';
              };
            };
          },
          {
            name: 'defaultParams';
            type: {
              defined: {
                name: 'arenaParams';
              };
            };
          },
          {
            name: 'paused';
            type: 'bool';
          },
          {
            name: 'bump';
            type: 'u8';
          },
          {
            name: 'reserved';
            type: {
              array: ['u8', 64];
            };
          },
        ];
      };
    },
    {
      name: 'protocolLimits';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'minDurationSecs';
            type: 'i64';
          },
          {
            name: 'maxDurationSecs';
            type: 'i64';
          },
          {
            name: 'minLeadSecs';
            type: 'i64';
          },
          {
            name: 'claimWindowSecs';
            type: 'i64';
          },
          {
            name: 'maxExtensionSecs';
            type: 'i64';
          },
          {
            name: 'reserveDrawBps';
            type: 'u16';
          },
          {
            name: 'upsetBonusCapUsdc';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'rewardClaimed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'owner';
            type: 'pubkey';
          },
          {
            name: 'side';
            type: 'u8';
          },
          {
            name: 'amount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'setAssetArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'assetClass';
            type: 'u8';
          },
          {
            name: 'feedId';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'toleranceSecs';
            type: 'i64';
          },
          {
            name: 'maxClosedStalenessSecs';
            type: 'i64';
          },
          {
            name: 'maxConfBps';
            type: 'u16';
          },
          {
            name: 'status';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'settlementExtended';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'secs';
            type: 'i64';
          },
        ];
      };
    },
    {
      name: 'settlementRecord';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'winner';
            type: 'u8';
          },
          {
            name: 'perfBpsA';
            type: 'i64';
          },
          {
            name: 'perfBpsB';
            type: 'i64';
          },
          {
            name: 'poolAtSettlement';
            type: 'u64';
          },
          {
            name: 'wTotal';
            type: 'u128';
          },
          {
            name: 'winnerTwabShareBps';
            type: 'u16';
          },
          {
            name: 'mSettleQ4';
            type: 'u32';
          },
          {
            name: 'upsetBonus';
            type: 'u64';
          },
          {
            name: 'settledAt';
            type: 'i64';
          },
        ];
      };
    },
    {
      name: 'sideState';
      docs: ['Mirrors `SideState` in the TS engine.'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'units';
            type: 'u64';
          },
          {
            name: 'unitSeconds';
            docs: ['∫ units dt — backing TWAB; never reduced by exits.'];
            type: 'u128';
          },
          {
            name: 'rewardUnitSeconds';
            docs: ['Σ position.unit_seconds — reduced by forfeiture; raw reward basis.'];
            type: 'u128';
          },
          {
            name: 'effUnits';
            type: 'u128';
          },
          {
            name: 'effUnitSeconds';
            docs: ['Σ position.eff_unit_seconds — reduced by forfeiture; boosted reward basis.'];
            type: 'u128';
          },
          {
            name: 'participants';
            type: 'u32';
          },
        ];
      };
    },
    {
      name: 'sponsor';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'sponsor';
            type: 'pubkey';
          },
          {
            name: 'amount';
            type: 'u64';
          },
          {
            name: 'refunded';
            type: 'bool';
          },
          {
            name: 'bump';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'sponsorRefunded';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'sponsor';
            type: 'pubkey';
          },
          {
            name: 'amount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'unclaimedSwept';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'arena';
            type: 'pubkey';
          },
          {
            name: 'amount';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'underdogPolicy';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'slope';
            type: 'u8';
          },
          {
            name: 'capQ4';
            type: 'u32';
          },
          {
            name: 'warmupBps';
            type: 'u16';
          },
          {
            name: 'warmupFloorSecs';
            type: 'i64';
          },
        ];
      };
    },
    {
      name: 'verificationLevel';
      docs: [
        'Pyth price updates are bridged to all blockchains via Wormhole.',
        'Using the price updates on another chain requires verifying the signatures of the Wormhole guardians.',
        'The usual process is to check the signatures for two thirds of the total number of guardians, but this can be cumbersome on Solana because of the transaction size limits,',
        'so we also allow for partial verification.',
        '',
        'This enum represents how much a price update has been verified:',
        '- If `Full`, we have verified the signatures for two thirds of the current guardians.',
        '- If `Partial`, only `num_signatures` guardian signatures have been checked.',
        '',
        '# Warning',
        'Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update.',
      ];
      type: {
        kind: 'enum';
        variants: [
          {
            name: 'partial';
            fields: [
              {
                name: 'numSignatures';
                type: 'u8';
              },
            ];
          },
          {
            name: 'full';
          },
        ];
      };
    },
  ];
};
