#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("docs/calibration/source-review-manifest.json", root);
const approvalUrl = new URL("docs/calibration/source-review-approval.json", root);
const reviewFiles = [
  "mad dog combat simulator reference.md",
  "docs/calibration/source-trait-review.md",
  "docs/calibration/report-0.6.md",
  "docs/calibration/canonical-results.json",
  "docs/security/prohibited-content-policy.md",
  "packages/policies/src/index.ts",
  "packages/engine/src/engagement.ts",
  "packages/engine/src/mechanics.ts",
  "packages/engine/src/morale.ts",
  "packages/scenarios/fixtures/open-regulated-duel.json",
  "packages/scenarios/fixtures/sudden-crisis-physics.json",
  "packages/scenarios/fixtures/morale-cascade-1v3.json",
  "packages/scenarios/fixtures/threat-ends.json",
  "packages/scenarios/fixtures/crowd-broken-sightlines.json",
  "packages/scenarios/fixtures/four-person-escort.json",
].sort();

const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const files = await Promise.all(reviewFiles.map(async path => {
  const bytes = await readFile(new URL(path, root));
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}));
const manifest = {
  schemaVersion: "1.0.0",
  reviewPackageId: "source-trait-review-1.0",
  releaseCandidate: "1.0.0-rc.1",
  engineVersion: "0.4.0",
  policyVersions: { chenInspired: "1.2.0", sportive: "1.1.0" },
  files,
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestHash = sha256(manifestText);

if (process.argv.includes("--check")) {
  const current = await readFile(manifestUrl, "utf8").catch(() => "");
  if (current !== manifestText) throw new Error("source-review manifest is stale; run npm run review:package");
  console.log(`Source-review package is current: ${files.length} files, manifest ${manifestHash}.`);
} else {
  await writeFile(manifestUrl, manifestText);
  const approval = JSON.parse(await readFile(approvalUrl, "utf8")) as Record<string, unknown>;
  if (approval.status === "pending") {
    approval.reviewPackageHash = manifestHash;
    await writeFile(approvalUrl, `${JSON.stringify(approval, null, 2)}\n`);
  }
  console.log(`Wrote source-review package: ${files.length} files, manifest ${manifestHash}.`);
}
