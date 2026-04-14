import { promises as fs } from "node:fs";

import { STATE_SCHEMA_VERSION } from "./constants.js";
import { pathExists, readJson, writeJson } from "./util.js";

export async function loadState(statePath) {
  if (!(await pathExists(statePath))) {
    return null;
  }
  const state = await readJson(statePath);
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`unsupported state schema version: ${state.schemaVersion}`);
  }
  return state;
}

export async function saveState(statePath, state) {
  await writeJson(statePath, {
    ...state,
    schemaVersion: STATE_SCHEMA_VERSION,
  });
}

export async function deleteState(statePath) {
  if (await pathExists(statePath)) {
    await fs.unlink(statePath);
  }
}
