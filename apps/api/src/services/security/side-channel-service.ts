import { auditChainService } from "../audit/audit-chain.service";

export interface SideChannelRunResult {
  mode: "baseline_shared" | "resource_isolated" | "cache_salted";
  sampleSize: number;
  auc: number;
  ci95: [number, number];
  blueIdleTTFTMean: number;
  blueBusyTTFTMean: number;
  deltaTTFT: number;
  isSimulated: boolean;
  samples: Array<{
    idx: number;
    idleTTFT: number;
    busyTTFT: number;
  }>;
}

export class SideChannelService {
  runTimingExperiment(mode: "baseline_shared" | "resource_isolated" | "cache_salted" = "cache_salted"): SideChannelRunResult {
    const N = 50;
    const samples: Array<{ idx: number; idleTTFT: number; busyTTFT: number }> = [];

    let baseIdle = 14.5;
    let baseBusy = mode === "baseline_shared" ? 38.2 : mode === "resource_isolated" ? 22.1 : 14.8;
    let expectedAuc = mode === "baseline_shared" ? 0.894 : mode === "resource_isolated" ? 0.712 : 0.512;

    for (let i = 1; i <= N; i++) {
      // Natural jitter / gaussian noise simulation
      const noise1 = (Math.random() - 0.5) * 3;
      const noise2 = (Math.random() - 0.5) * 3;
      samples.push({
        idx: i,
        idleTTFT: Number((baseIdle + noise1).toFixed(1)),
        busyTTFT: Number((baseBusy + noise2).toFixed(1)),
      });
    }

    const result: SideChannelRunResult = {
      mode,
      sampleSize: N,
      auc: expectedAuc,
      ci95: mode === "cache_salted" ? [0.485, 0.539] : mode === "baseline_shared" ? [0.852, 0.936] : [0.672, 0.752],
      blueIdleTTFTMean: baseIdle,
      blueBusyTTFTMean: baseBusy,
      deltaTTFT: Number((baseBusy - baseIdle).toFixed(1)),
      isSimulated: true, // Transparently labelled SIMULATED per Rule 1 of Gap Analysis
      samples,
    };

    auditChainService.recordEvent("SIDE_CHANNEL_BENCHMARK", {
      mode,
      auc: result.auc,
      deltaTTFT: result.deltaTTFT,
      sampleSize: N,
      isSimulated: true,
    });

    return result;
  }
}

export const sideChannelService = new SideChannelService();
