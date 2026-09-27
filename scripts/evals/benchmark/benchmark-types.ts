import type { DecisionModel } from "../../../src/models/system-one.ts";
import type { TextModel } from "../../../src/models/text.ts";
import type { ModelProvenance } from "./benchmark-provenance.ts";
import type { StartupMetrics } from "./benchmark-runtime.ts";

interface Models {
  readonly decision: DecisionModel;
  readonly text: TextModel;
}
type StartupRecord =
  | {
      readonly status: "ready";
      readonly modelId: string;
      readonly provenance: ModelProvenance;
      readonly metrics: StartupMetrics;
      readonly postDecisionTextProbeMs?: number;
    }
  | {
      readonly status: "load-failed";
      readonly modelId: string;
      readonly reason: string;
      readonly at: string;
    };
export type { Models, StartupRecord };
