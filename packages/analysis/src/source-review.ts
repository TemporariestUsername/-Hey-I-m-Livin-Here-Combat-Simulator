export interface SourceReviewApproval {
  schemaVersion: string;
  reviewPackageId: string;
  reviewPackageHash: string;
  status: "pending" | "approved" | "rejected";
  reviewer: { name: string; role: string };
  reviewedAt: string | null;
  decision: "pending" | "approved" | "approved-with-conditions" | "rejected";
  conditions: string[];
  attestations: Record<string, boolean>;
  notes: string;
}

export const REQUIRED_REVIEW_ATTESTATIONS = [
  "independentHumanReview",
  "reviewedReferenceMapping",
  "acceptsSyntheticModelLimitations",
  "rejectsRealWorldEfficacyClaims",
  "acceptsAbstractSafetyVocabulary",
  "acceptsCanonicalScenarioSignatures",
] as const;

export function validateSourceReviewApproval(
  approval: SourceReviewApproval,
  expected: { reviewPackageId: string; manifestHash: string; allowPending?: boolean },
): "pending" | "approved" {
  if (approval.schemaVersion !== "1.0.0") throw new Error("unsupported source-review schema version");
  if (approval.reviewPackageId !== expected.reviewPackageId) throw new Error("approval names a different source-review package");
  if (approval.reviewPackageHash !== expected.manifestHash) throw new Error("approval is not bound to the current source-review manifest");
  if (approval.status === "pending") {
    if (!expected.allowPending) throw new Error("independent human source-trait approval is pending");
    return "pending";
  }
  if (approval.status === "rejected" || approval.decision === "rejected") throw new Error("independent human source-trait review rejected this package");
  if (approval.status !== "approved" || !["approved", "approved-with-conditions"].includes(approval.decision)) {
    throw new Error("approval status and decision are inconsistent");
  }
  if (!approval.reviewer.name.trim() || /^pending$/iu.test(approval.reviewer.name.trim())) throw new Error("reviewer name is required");
  if (!approval.reviewer.role.trim() || /designated human reviewer|pending/iu.test(approval.reviewer.role)) throw new Error("specific reviewer role is required");
  if (!approval.reviewedAt || !/^\d{4}-\d{2}-\d{2}$/u.test(approval.reviewedAt)) throw new Error("ISO review date is required");
  if (approval.decision === "approved-with-conditions" && approval.conditions.length === 0) throw new Error("conditional approval must list conditions");
  for (const key of REQUIRED_REVIEW_ATTESTATIONS) if (approval.attestations[key] !== true) throw new Error(`review attestation ${key} is required`);
  return "approved";
}
