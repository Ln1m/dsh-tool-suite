/**
 * dsh-hot-memory -- host half.
 *
 * PURPOSE
 *   Project the Mnemon runtime memory files (USER.md / MEMORY.md) into the system
 *   prompt of every session, as a single lazy `systemPrompt` section.
 *
 * WHY THIS EXISTS
 *   dsh-mnemon renders the same content through `agent/pre-step` ->
 *   `memorySnapshotMessage()`, but that whole tail sits BEHIND its
 *   `lifecycleEnabled` gate, which this machine keeps off so the idle review stops
 *   forking whole conversations. Measured 2026-09-24 (session-1f2a0e9b): the static
 *   `mnemon:runtime-memory-protocol` text is present while the runtime-memory
 *   snapshot is absent, so USER.md / MEMORY.md never reach the model at all.
 *   This plugin takes the projection off that gate: it reads the two files and
 *   registers them, nothing else.
 *
 * COST MODEL
 *   A section's lazy text is re-rendered on every request; a CHANGED string is
 *   added once and an unchanged one adds no message. A stable memory file therefore
 *   rides the cached prompt prefix at hit price (~4k tok -> about 0.0002 CNY per
 *   request), and only an actual memory write invalidates the prefix once.
 *
 * RETIRE CONDITION
 *   If dsh-mnemon's Composable Memory View is ever repaired (a real STRATEGY section
 *   and a MNEMON VIEW ROUTES envelope appear in the system prompt), this section
 *   duplicates its snapshot: disable the row in the profile patch and remove the
 *   bundle entry.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-hot-memory";

/** Registered in the shared `mnemon:` band (protocol 144 / runtime-memory 145 / guidance 150). */
const SECTION_NAME = "hot-memory";
const SECTION_ORDER = 146;

const MEMORY_DIR = join(homedir(), ".mnemon", "runtime");
const USER_FILE = join(MEMORY_DIR, "USER.md");
const MEMORY_FILE = join(MEMORY_DIR, "MEMORY.md");

function readText(file) {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function renderSnapshot() {
  const user = readText(USER_FILE);
  const memory = readText(MEMORY_FILE);
  if (user === "" && memory === "") return "";
  const parts = [
    "<hot-memory>",
    "Runtime memory for this user and workspace: a complete projection of the two files below. It supersedes earlier copies, applies silently, and is never recited back merely to prove it was read.",
  ];
  if (user !== "") parts.push(`<user-profile source="USER.md">\n${user}\n</user-profile>`);
  if (memory !== "") parts.push(`<project-memory source="MEMORY.md">\n${memory}\n</project-memory>`);
  parts.push("</hot-memory>");
  return parts.join("\n");
}

export function apply(ctx) {
  // `ctx.inject` waits for the service instead of racing plugin load order:
  // `ctx.get("systemPrompt")` returns undefined while the service is not mounted yet,
  // which would drop this section silently and make the whole plugin a no-op that
  // only shows up after wasting a restart.
  ctx.inject(["systemPrompt"], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: renderSnapshot,
    });
  });
}
