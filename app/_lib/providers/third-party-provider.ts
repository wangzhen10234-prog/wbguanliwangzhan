import type { MarketAnalyticsProvider } from "../market-analytics-provider";
import { PROVIDER_CAPABILITIES } from "../market-analytics-provider";
import type { MarketDataset } from "../market-niche-types";

/** Adapter slot for a future, contractually verified provider. Disabled by default. */
export class ThirdPartyProvider implements MarketAnalyticsProvider {
  readonly id = "third-party-disabled";
  readonly source = "THIRD_PARTY" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.thirdParty;
  async load(): Promise<MarketDataset> { throw new Error("THIRD_PARTY_PROVIDER_NOT_CONFIGURED"); }
}
