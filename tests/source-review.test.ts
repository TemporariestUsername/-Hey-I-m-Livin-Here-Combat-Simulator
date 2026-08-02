import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_REVIEW_ATTESTATIONS, validateSourceReviewApproval, type SourceReviewApproval } from "../packages/analysis/src/source-review.ts";

const manifestHash = "a".repeat(64);
const approved = (): SourceReviewApproval => ({
  schemaVersion: "1.0.0",
  reviewPackageId: "source-trait-review-1.0",
  reviewPackageHash: manifestHash,
  status: "approved",
  reviewer: { name: "Alex Reviewer", role: "Product owner" },
  reviewedAt: "2026-08-03",
  decision: "approved",
  conditions: [],
  attestations: Object.fromEntries(REQUIRED_REVIEW_ATTESTATIONS.map(key => [key, true])),
  notes: "Reviewed the manifest-bound synthetic model and limitations.",
});

test("source review approval accepts a complete manifest-bound human decision", () => {
  assert.equal(validateSourceReviewApproval(approved(), { reviewPackageId: "source-trait-review-1.0", manifestHash }), "approved");
});

test("source review approval fails closed for pending, rejected, stale, and placeholder decisions", () => {
  assert.throws(() => validateSourceReviewApproval({ ...approved(), status: "pending", decision: "pending" }, { reviewPackageId: "source-trait-review-1.0", manifestHash }), /pending/);
  assert.equal(validateSourceReviewApproval({ ...approved(), status: "pending", decision: "pending" }, { reviewPackageId: "source-trait-review-1.0", manifestHash, allowPending: true }), "pending");
  assert.throws(() => validateSourceReviewApproval({ ...approved(), status: "rejected", decision: "rejected" }, { reviewPackageId: "source-trait-review-1.0", manifestHash }), /rejected/);
  assert.throws(() => validateSourceReviewApproval({ ...approved(), reviewPackageHash: "b".repeat(64) }, { reviewPackageId: "source-trait-review-1.0", manifestHash }), /current.*manifest/);
  assert.throws(() => validateSourceReviewApproval({ ...approved(), reviewer: { name: "Pending", role: "Product owner" } }, { reviewPackageId: "source-trait-review-1.0", manifestHash }), /name/);
});

test("conditional review requires conditions and every attestation", () => {
  assert.throws(() => validateSourceReviewApproval({ ...approved(), decision: "approved-with-conditions" }, { reviewPackageId: "source-trait-review-1.0", manifestHash }), /conditions/);
  const missing = approved(); missing.attestations.acceptsAbstractSafetyVocabulary = false;
  assert.throws(() => validateSourceReviewApproval(missing, { reviewPackageId: "source-trait-review-1.0", manifestHash }), /acceptsAbstractSafetyVocabulary/);
});
