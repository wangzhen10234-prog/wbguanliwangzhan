import type { MarketAnalyticsProvider } from "../market-analytics-provider";
import { PROVIDER_CAPABILITIES } from "../market-analytics-provider";
import type { MarketDataset } from "../market-niche-types";

export class WbImportProvider implements MarketAnalyticsProvider {
  readonly id = "wb-official-export";
  readonly source = "WB_EXPORT" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.wbImport;
  constructor(private datasetLoader: () => Promise<MarketDataset>) {}
  load() { return this.datasetLoader(); }
}
