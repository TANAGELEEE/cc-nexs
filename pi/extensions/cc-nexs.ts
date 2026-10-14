import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { modelGateway } from "../../packages/core/lib/model-gateway.mjs";
import { findWorkspaceRoot } from "../../packages/core/lib/candidate-context.mjs";
import { piSubagentApi, piTask, subagentRpc } from "../../packages/core/lib/pi-subagent-adapter.mjs";

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
  "revise-hotfix",
  "lean-review",
  "lean-verify",
  "migrate-progress",
  "migrate-feature-config",
  "recon",
  "sync-base",
  "switch-test-target",
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
  let childRole = isCcNexsChild ? normalizeRole(qualifiedChildRole) : "";
  if (childRole) process.env.CC_NEXS_ROLE = childRole;
  pi.on("session_start", (_event, ctx) => {
    const name = ctx.sessionManager.getSessionName() || "";
    if (name.startsWith("cc-nexs.")) childRole = normalizeRole(name.split("#")[0]);
  });

  {
    pi.on("tool_call", (event, ctx) => {
      if (!childRole) return undefined;
      if (["Agent", "subagent", "get_subagent_result", "steer_subagent"].includes(event.toolName)
        || event.toolName.startsWith("cc_nexs_")) {
        return { block: true, reason: "cc-nexs role children cannot dispatch children or operate parent controllers." };
      }
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
        cwd: ctx.cwd,
        progressPath: process.env.CC_NEXS_PROGRESS_FILE
          || (process.env.CC_NEXS_REQ_DIR ? resolve(process.env.CC_NEXS_REQ_DIR, "progress.json") : null),
      });
      if (violation) return { block: true, reason: `[cc-nexs role-boundary] ${violation}` };
      return undefined;
    });
  }

  if (!childRole) pi.registerTool({
    name: "cc_nexs_dispatch",
    label: "cc-nexs Pi dispatch",
    description: "Detect Pi subagent API or dispatch one bounded wave with frozen models and assigned worktrees. Tintin uses RPC v2 because Agent lacks cwd. Wait for all completion notifications before recording gateway results.",
    parameters: Type.Object({
      tasks: Type.Optional(Type.Array(Type.Object({
        agent: Type.String(), task: Type.String(), cwd: Type.String(),
        model: Type.Optional(Type.String()), effort: Type.Optional(Type.String()),
      }))),
      concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const api = piSubagentApi(pi.getAllTools());
      if (api === "tintin-rpc-v2") {
        const handshake = await subagentRpc(pi.events, "ping");
        if (handshake.version !== 2) throw new Error("Unsupported Pi subagent RPC version");
      }
      if (!params.tasks?.length) return { content: [{ type: "text", text: JSON.stringify({ api }) }], details: { api } };
      const tasks = params.tasks.map(piTask);
      if (api === "tintin-rpc-v2") {
        for (const task of tasks) {
          const expected = readFileSync(resolve(PACKAGE_ROOT, "pi/tintin-agents", `${task.type}.md`), "utf8");
          const installed = readFileSync(resolve(getAgentDir(), "agents", `${task.type}.md`), "utf8");
          if (installed !== expected) throw new Error("Tintin cc-nexs roles are stale; run install:local:pi and reload");
          for (const directory of [".pi/agents", ".agents/agents"]) {
            const override = resolve(ctx.cwd, directory, `${task.type}.md`);
            if (existsSync(override) && readFileSync(override, "utf8") !== expected) {
              throw new Error(`Project agent shadows the cc-nexs role contract: ${override}`);
            }
          }
        }
      }
      if (!params.concurrency || tasks.length > params.concurrency) throw new Error("Split the wave into bounded batches before dispatch");
      if (api === "tasks") {
        const outcome = await ctx.executeTool("subagent", {
          tasks: params.tasks.map((task) => ({
            agent: task.agent, task: task.task, cwd: task.cwd,
            ...((task.model && task.model !== "inherit") || (task.effort && task.effort !== "inherit") ? {
              model: `${task.model && task.model !== "inherit" ? task.model : `${ctx.model.provider}/${ctx.model.id}`}${task.effort && task.effort !== "inherit" ? `:${task.effort}` : ""}`,
            } : {}),
          })),
          concurrency: params.concurrency, async: true, worktree: false, context: "fresh",
        });
        if (outcome.isError) throw new Error(JSON.stringify(outcome.result));
        return outcome.result;
      }
      const results = await Promise.allSettled(tasks.map((task) => subagentRpc(pi.events, "spawn", {
        ...task, options: { ...task.options, signal: _signal },
      })));
      const result = { api, children: results.map((item, index) => ({
        agent: tasks[index].type,
        ...(item.status === "fulfilled" ? { id: item.value.id } : { error: String(item.reason) }),
      })) };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });

  if (!childRole) pi.registerTool({
    name: "cc_nexs_model_gateway",
    label: "cc-nexs model preview",
    description: "Non-blocking model preview, reusable successful combinations and user corrections. Inspect before discovery; prepare/start/result around real role dispatch. Feedback only records an actual user instruction.",
    parameters: Type.Object({
      operation: Type.Union(["inspect", "prepare", "view", "start", "feedback", "result"].map((value) => Type.Literal(value))),
      request: Type.String({ description: "JSON request for shared modelGateway, including runtime pi and non-secret host/account context. Prepare also needs preset, options and tasks." }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const request = JSON.parse(params.request);
      if (request.runtime !== "pi") throw new Error("Pi model gateway requires runtime pi");
      const result = modelGateway(params.operation, request, { cwd: findWorkspaceRoot(ctx.cwd) });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });

  if (!childRole) pi.registerTool({
    name: "cc_nexs_models",
    label: "cc-nexs models",
    description: "Read available models from this Pi session without inference or credentials. Use before cc-nexs role dispatch.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const snapshot = {
        runtime: "pi", source: "pi-session", discovered_at: new Date().toISOString(),
        current_model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
        models: ctx.modelRegistry.getAvailable().map((model) => ({
          id: `${model.provider}/${model.id}`, name: model.name,
          reasoning: model.reasoning, input: model.input,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(snapshot) }], details: snapshot };
    },
  });

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
