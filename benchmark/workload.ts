import { createHash } from "node:crypto";

export type WorkloadSegment =
  | "syntax_invalid"
  | "nonexistent_domain"
  | "no_usable_mx"
  | "known_disposable"
  | "controlled_mailbox_exists"
  | "controlled_mailbox_missing"
  | "controlled_catch_all"
  | "ambiguous_disagreement_only";

export interface WorkloadCase {
  readonly id: string;
  readonly split: "calibration" | "held_out";
  readonly segment: WorkloadSegment;
  readonly email: string;
  readonly controlled: boolean;
  readonly groundTruth?: "send" | "do_not_send";
  /** False placeholders must be replaced by owned/controlled addresses before live use. */
  readonly liveEligible: boolean;
}

const cases = (
  segment: WorkloadSegment,
  count: number,
  email: (index: number) => string,
  details: Pick<WorkloadCase, "controlled" | "liveEligible"> & {
    readonly groundTruth?: "send" | "do_not_send";
  },
): readonly WorkloadCase[] =>
  Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      id: `${segment}-${String(index).padStart(3, "0")}`,
      split: offset % 5 < 2 ? "calibration" : "held_out",
      segment,
      email: email(index),
      controlled: details.controlled,
      ...(details.groundTruth === undefined
        ? {}
        : { groundTruth: details.groundTruth }),
      liveEligible: details.liveEligible,
    };
  });

/**
 * Privacy-safe frozen manifest. Placeholder controlled cases deliberately block
 * live evaluation; replace them in a separately reviewed private manifest.
 */
export const frozenWorkload: readonly WorkloadCase[] = [
  ...cases("syntax_invalid", 15, (i) => `invalid-address-${i}`, {
    controlled: true,
    groundTruth: "do_not_send",
    liveEligible: true,
  }),
  ...cases("nonexistent_domain", 15, (i) => `case-${i}@domain-${i}.invalid`, {
    controlled: true,
    groundTruth: "do_not_send",
    liveEligible: true,
  }),
  ...cases("no_usable_mx", 15, (i) => `case-${i}@no-mx-${i}.example`, {
    controlled: false,
    groundTruth: "do_not_send",
    liveEligible: false,
  }),
  ...cases("known_disposable", 15, (i) => `router-v0-${i}@mailinator.com`, {
    controlled: false,
    groundTruth: "do_not_send",
    liveEligible: true,
  }),
  ...cases(
    "controlled_mailbox_exists",
    15,
    (i) => `exists-${i}@owned-mail.example`,
    {
      controlled: false,
      groundTruth: "send",
      liveEligible: false,
    },
  ),
  ...cases(
    "controlled_mailbox_missing",
    15,
    (i) => `missing-${i}@owned-mail.example`,
    {
      controlled: false,
      groundTruth: "do_not_send",
      liveEligible: false,
    },
  ),
  ...cases(
    "controlled_catch_all",
    15,
    (i) => `catch-all-${i}@owned-catchall.example`,
    {
      controlled: false,
      liveEligible: false,
    },
  ),
  ...cases(
    "ambiguous_disagreement_only",
    15,
    (i) => `ambiguous-${i}@owned-ambiguous.example`,
    {
      controlled: false,
      liveEligible: false,
    },
  ),
];

export const workloadHash = createHash("sha256")
  .update(JSON.stringify(frozenWorkload), "utf8")
  .digest("hex");

export const EXPECTED_WORKLOAD_HASH =
  "8de1a8243c2d92cf8dee1ecff2dc01f77ac6dbf6d8dd2c67ec7febd5d79352f5";

export const validateFrozenWorkload = (): readonly string[] => {
  const errors: string[] = [];
  if (frozenWorkload.length < 100)
    errors.push("workload has fewer than 100 cases");
  if (
    new Set(frozenWorkload.map((item) => item.id)).size !==
    frozenWorkload.length
  )
    errors.push("workload IDs are not unique");
  if (workloadHash !== EXPECTED_WORKLOAD_HASH)
    errors.push("workload hash differs from frozen hash");
  const segments = new Set(frozenWorkload.map((item) => item.segment));
  if (segments.size !== 8)
    errors.push("workload does not cover all required segments");
  if (!frozenWorkload.some((item) => item.split === "calibration"))
    errors.push("calibration split is empty");
  if (!frozenWorkload.some((item) => item.split === "held_out"))
    errors.push("held-out split is empty");
  return errors;
};
