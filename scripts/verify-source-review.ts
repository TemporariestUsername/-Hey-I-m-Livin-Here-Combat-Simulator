#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateSourceReviewApproval, type SourceReviewApproval } from "../packages/analysis/src/source-review.ts";

const root = new URL("../", import.meta.url);
const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const manifestText = await readFile(new URL("docs/calibration/source-review-manifest.json", root), "utf8");
const manifest = JSON.parse(manifestText) as {
  schemaVersion: string;
  reviewPackageId: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};
const approval = JSON.parse(await readFile(new URL("docs/calibration/source-review-approval.json", root), "utf8")) as SourceReviewApproval;

const manifestHash = sha256(manifestText);
for (const file of manifest.files) {
  const bytes = await readFile(new URL(file.path, root));
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`reviewed input changed: ${file.path}`);
}

const allowPending = process.argv.includes("--allow-pending");
const status = validateSourceReviewApproval(approval, { reviewPackageId: manifest.reviewPackageId, manifestHash, allowPending });
if (status === "pending") {
  console.log(`Source-review package integrity passed; independent human approval remains pending for ${manifestHash}.`);
  process.exit(0);
}
console.log(`Independent human source-trait approval passed for ${manifestHash}: ${approval.reviewer.name}, ${approval.decision}, ${approval.reviewedAt}.`);
