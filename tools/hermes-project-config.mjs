import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The isolated Hermes workspace is the repository containing this source by
// default. Deployment may bind it explicitly without changing product code.
export const HERMES_WORKSPACE = process.env.TERAS_HERMES_WORKSPACE || REPO_ROOT;
// CRM remains an explicit protected boundary, but can be supplied by the
// deployment environment rather than baked into a runtime installation.
export const CANONICAL_WORKSPACE = process.env.TERAS_CANONICAL_WORKSPACE || "D:\\Projects\\terasuniversal-website-clean";
