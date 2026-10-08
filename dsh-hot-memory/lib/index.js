/**
 * dsh-hot-memory -- host half.
 *
 * PURPOSE
 *   Project the Mnemon runtime memory files (USER.md / MEMORY.md) into the system
 *   prompt of every session, as a single lazy `systemPrompt` section.
 *
 * WHY THIS EXISTED
 *   dsh-mnemon renders the same content through `agent/pre-step` ->
 *   `memorySnapshotMessage()`, but that whole tail sits BEHIND its
 *   `lifecycleEnabled` gate, which this machine kept off so the idle review stopped
 *   forking whole conversations. Measured 2026-09-24 (session-1f2a0e9b): the static
 *   `mnemon:runtime-memory-protocol` text was present while the runtime-memory
 *   snapshot was absent, so USER.md / MEMORY.md never reach the model at all.
 *   This plugin took the projection off that gate: it reads the two files and
 *   registers them, nothing else.
 *
 * RETIRED 2026-10-01
 *   The gate is on again (`lifecycleEnabled: true` with `idleReview.enabled: false`
 *   in the web profile), so dsh-mnemon once more emits both the protocol text and
 *   the runtime-memory snapshot. On the retirement day the system prompt carried
 *   MNEMON RUNTIME MEMORY SNAPSHOT and the MNEMON VIEW TOOLS / AVAILABILITY lists
 *   next to this section, i.e. the same two files twice. The bundle entry was
 *   therefore dropped from `dsh.profile.bundles` in profiles/web/package.json; the
 *   `dsh-hot-memory` dependency row stays, it is simply never registered. Source
 *   kept on purpose: if mnemon regresses, putting the bundle entry back is the
 *   whole revival step.
 *
 * COST MODEL
 *   A section's lazy text is re-rendered on every request; a CHANGED string is
 *   added once and an unchanged one adds no message. A stable memory file therefore
 *   rides the cached prompt prefix at hit price (~4k tok -> about 0.0002 CNY per
 *   request), and only an actual memory write invalidates the prefix once.
 *
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
