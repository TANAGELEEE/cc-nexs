import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  runCcNexsCommand,
  splitCommandArguments,
} from "../../packages/core/lib/cc-nexs-cli.mjs";
import {
  isGitMutation,
  isProgressMutation,
  normalizeRole,
  roleBoundaryViolation,
} from "../../packages/core/lib/role-boundary.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const P2_COMMANDS = [
  "approve-deploy",
  "approve-plan",
  "approve-release",
  "approve-spec",
  "brainstorm",
  "build",
  "doctor",
  "fullstack",
  "planner",
  "dev",
  "sa",
  "qa",
  "evaluator",
  "git-custodian",
  "hotfix",
  "init",
  "lean-review",
  "lean-verify",
  "migrate-progress",
  "migrate-feature-config",
  "recon",
  "release-test",
  "release-base",
  "render-plan",
  "request-release-changes",
  "review",
  "run",
  "status",
  "verify",
  "verify-local",
  "plan",
  "execute",
] as const;

function commandDescription(name: string): string {
  if (name === "run") return "Run cc-nexs Lean, Fast, Full, or Hotfix through isolated Pi subagents to test delivery and verification";
  if (name === "init") return "Initialize a cc-nexs lean-default feature";
  if (name === "hotfix") return "Run the cc-nexs P0/P1/P2/P3 hotfix workflow through isolated Pi subagents";
  if (name === "doctor") return "Validate cc-nexs workspace and Pi subagent prerequisites";
  if (name === "release-test") return "Deliver exact candidates to test/CI first; verify after deployment or record recoverable manual verification";
  return `Execute the cc-nexs ${name} workflow`;
}

export default function ccNexsPiExtension(pi: ExtensionAPI) {
  process.env.CC_NEXS_RUNTIME = "pi";
  process.env.CC_NEXS_PLUGIN_ROOT = PACKAGE_ROOT;

  const qualifiedChildRole = process.env.PI_SUBAGENT_CHILD_AGENT || "";
  const isCcNexsChild = qualifiedChildRole.startsWith("cc-nexs.");
  const childRole = isCcNexsChild ? normalizeRole(qualifiedChildRole) : "";
  if (childRole) process.env.CC_NEXS_ROLE = childRole;

  if (childRole) {
    pi.on("tool_call", (event) => {
      const input = (event.input || {}) as Record<string, unknown>;
      const command = typeof input.command === "string" ? input.command : "";
      const filePath = typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string" ? input.path : "";

      if (event.toolName === "bash" && isGitMutation(command)) {
        return {
          block: true,
          reason: "cc-nexs Pi role sessions cannot mutate Git; the parent orchestrator owns Git Custodian operations.",
        };
      }

      if (event.toolName === "bash" && isProgressMutation(command)) {
        return {
          block: true,
          reason: "cc-nexs Pi role sessions cannot mutate progress.md or progress.json; the parent orchestrator owns state transitions.",
        };
      }

      if (
        ["edit", "write", "notebookedit"].includes(event.toolName.toLowerCase())
        && /(^|\/)progress\.(?:md|json)$/.test(filePath)
      ) {
        return {
          block: true,
          reason: "cc-nexs Pi role sessions cannot mutate progress.md or progress.json; the parent orchestrator owns state transitions.",
        };
      }

      if (
        childRole === "repo-scout"
        && ["edit", "write"].includes(event.toolName.toLowerCase())
        && !/(^|\/)repo-context\.md$/.test(filePath)
      ) {
        return {
          block: true,
          reason: "[cc-nexs role-boundary] Repo Scout may only write repo-context.md.",
        };
      }

      const violation = roleBoundaryViolation({
        role: childRole,
        toolName: event.toolName,
        filePath,
        command,
      });
      if (violation) return { block: true, reason: `[cc-nexs role-boundary] ${violation}` };
      return undefined;
    });
  }

  for (const name of P2_COMMANDS) {
    pi.registerCommand(`cc-nexs:${name}`, {
      description: commandDescription(name),
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("cc-nexs commands must start while the Pi agent is idle.", "warning");
          return;
        }
        if (["approve-deploy", "approve-spec", "approve-plan", "approve-release"].includes(name)) {
          try {
            const result = runCcNexsCommand([name, ...splitCommandArguments(args)], { cwd: process.cwd() });
            const sprint = result.sprint === null ? "" : ` M${result.sprint}`;
            const status = result.alreadyApproved ? "already approved" : "approved";
            ctx.ui.notify(`cc-nexs ${result.gate.toUpperCase()}${sprint} ${status} for ${result.feature.id}`, "info");
            pi.sendUserMessage(`/skill:cc-nexs-run ${result.feature.id}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`cc-nexs approval failed: ${message}`, "error");
          }
          return;
        }
        const suffix = args.trim() ? ` ${args.trim()}` : "";
        pi.sendUserMessage(`/skill:cc-nexs-${name}${suffix}`);
      },
    });
  }
}
