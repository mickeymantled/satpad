import { STAGE_LABEL } from "@/lib/format";
import type { Stage } from "@/lib/api";

export function StageBadge({ stage, progressBps }: { stage: Stage; progressBps?: number }) {
  return (
    <span className={`badge badge-${stage}`} title={stage === "dust" ? "Fewer than 10 buys" : stage === "mining" ? "On the bonding curve" : "Graduated to PumpSwap"}>
      {STAGE_LABEL[stage]}{stage === "mining" && progressBps !== undefined ? ` · ${(progressBps / 100).toFixed(1)}%` : ""}
    </span>
  );
}
