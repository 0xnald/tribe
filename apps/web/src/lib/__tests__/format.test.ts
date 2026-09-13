import { describe, expect, it } from 'vitest';

import {
  fmtAmount,
  fmtCountdown,
  fmtDuration,
  fmtMultiplier,
  fmtPct,
  fmtPrice,
  fmtUsd,
  shortAddress,
} from '../format';

describe('format', () => {
  it('percentages carry a sign and two decimals', () => {
    expect(fmtPct(8.42)).toBe('+8.42%');
    expect(fmtPct(-1.8)).toBe('−1.80%');
    expect(fmtPct(0)).toBe('0.00%');
  });
  it('money groups and compacts', () => {
    expect(fmtUsd(184291)).toBe('$184,291');
    expect(fmtUsd(184291, { compact: true })).toBe('$184K');
    expect(fmtUsd(1_250_000, { compact: true })).toBe('$1.3M');
    expect(fmtUsd(12.5, { cents: true })).toBe('$12.50');
  });
  it('prices adapt precision', () => {
    expect(fmtPrice(365.25)).toBe('$365.25');
    expect(fmtPrice(0.0000276)).toBe('$0.0000276');
    expect(fmtPrice(1234.5)).toBe('$1,234.50');
  });
  it('countdowns', () => {
    expect(fmtCountdown(1 * 3600 + 42 * 60 + 18)).toBe('01:42:18');
    expect(fmtCountdown(90_000)).toBe('1d 01:00:00');
    expect(fmtCountdown(-5)).toBe('00:00:00');
    expect(fmtDuration(6120)).toBe('1h 42m');
    expect(fmtDuration(48 * 60)).toBe('48m');
  });
  it('amounts and multipliers', () => {
    expect(fmtAmount(1_240_000, 'BONK')).toBe('1,240,000 BONK');
    expect(fmtAmount(0.27337718, 'TSLAx')).toBe('0.273377 TSLAx');
    expect(fmtMultiplier(1.46)).toBe('1.46×');
    expect(fmtMultiplier(2)).toBe('2×');
    expect(shortAddress('GrUT28TocKAAo5BDfV9wQejZ1aQsVTNpynYGjLjzwykf')).toBe('GrUT…wykf');
  });
});
