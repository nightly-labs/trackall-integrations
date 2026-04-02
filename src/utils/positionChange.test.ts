import { describe, expect, it } from "bun:test";
import {
  applyPositionPctUsdValueChange24,
  applyPositionsPctUsdValueChange24,
  computePositionPctUsdValueChange24,
} from "./positionChange";

type TestPosition = {
  pctUsdValueChange24?: string;
  positionKind?: string;
  meta?: Record<string, unknown>;
  staked?: {
    amount: { token: string; amount: string; decimals: string };
    usdValue: string;
  };
  poolTokens?: Array<{
    amount: { token: string; amount: string; decimals: string };
    usdValue: string;
  }>;
  rewards?: Array<{
    amount: { token: string; amount: string; decimals: string };
    usdValue: string;
  }>;
  fees?: Array<{
    amount: { token: string; amount: string; decimals: string };
    usdValue: string;
  }>;
};

describe("positionChange utils", () => {
  it("computes a USD-weighted average from eligible components only", () => {
    const tokenSource = {
      get(token: string) {
        return (
          {
            AAA: { pctPriceChange24h: 10 },
            BBB: { pctPriceChange24h: -20 },
            CCC: { pctPriceChange24h: 99 },
          }[token] ?? undefined
        );
      },
    };

    const position: TestPosition = {
      positionKind: "liquidity",
      poolTokens: [
        {
          amount: { token: "AAA", amount: "1", decimals: "6" },
          usdValue: "100",
        },
        {
          amount: { token: "BBB", amount: "2", decimals: "6" },
          usdValue: "50",
        },
        {
          amount: { token: "MISSING", amount: "3", decimals: "6" },
          usdValue: "30",
        },
      ],
      rewards: [
        {
          amount: { token: "CCC", amount: "4", decimals: "6" },
          usdValue: "0",
        },
        {
          amount: { token: "AAA", amount: "5", decimals: "6" },
          usdValue: "not-a-number",
        },
      ],
      meta: {
        ignored: {
          nested: {
            amount: { token: "CCC", amount: "6", decimals: "6" },
            usdValue: "999",
          },
        },
      },
    };

    expect(computePositionPctUsdValueChange24(tokenSource, position)).toBe("0");
  });

  it("treats borrowed components as negative weight by default", () => {
    const tokenSource = {
      get(token: string) {
        return (
          {
            COLLATERAL: { pctPriceChange24h: 10 },
            DEBT: { pctPriceChange24h: 5 },
          }[token] ?? undefined
        );
      },
    };

    const position = {
      positionKind: "lending",
      supplied: [
        {
          amount: { token: "COLLATERAL", amount: "1", decimals: "6" },
          usdValue: "200",
        },
      ],
      borrowed: [
        {
          amount: { token: "DEBT", amount: "1", decimals: "6" },
          usdValue: "50",
        },
      ],
    };

    expect(computePositionPctUsdValueChange24(tokenSource, position)).toBe(
      ((200 * 10 - 50 * 5) / (200 - 50)).toString(),
    );
  });

  it("leaves the value unset when no component is eligible", () => {
    const tokenSource = {
      get() {
        return undefined;
      },
    };

    const position: TestPosition = {
      positionKind: "staking",
      staked: {
        amount: { token: "AAA", amount: "1", decimals: "6" },
        usdValue: "100",
      },
    };

    expect(computePositionPctUsdValueChange24(tokenSource, position)).toBe(
      undefined,
    );

    applyPositionPctUsdValueChange24(tokenSource, position);
    expect(position.pctUsdValueChange24).toBeUndefined();
  });

  it("applies the computed value across multiple positions", () => {
    const tokenSource = {
      get(token: string) {
        return (
          {
            AAA: { pctPriceChange24h: 12 },
            BBB: { pctPriceChange24h: -4 },
          }[token] ?? undefined
        );
      },
    };

    const positions: TestPosition[] = [
      {
        poolTokens: [
          {
            amount: { token: "AAA", amount: "1", decimals: "6" },
            usdValue: "25",
          },
        ],
      },
      {
        rewards: [
          {
            amount: { token: "BBB", amount: "1", decimals: "6" },
            usdValue: "10",
          },
        ],
      },
      {
        fees: [
          {
            amount: { token: "UNKNOWN", amount: "1", decimals: "6" },
            usdValue: "10",
          },
        ],
      },
    ];

    applyPositionsPctUsdValueChange24(tokenSource, positions);

    expect(positions[0]?.pctUsdValueChange24).toBe("12");
    expect(positions[1]?.pctUsdValueChange24).toBe("-4");
    expect(positions[2]?.pctUsdValueChange24).toBeUndefined();
  });
});
