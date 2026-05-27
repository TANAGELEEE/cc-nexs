// cc-nexs core: reviewer-adapter.
// Abstracts the "external reviewer" tool used for SA / QA / Evaluator-style roles.
// Supported tools (declared in preset.roles.definitions[<role>].tool):
//   - "codex"           : codex CLI (`codex "<prompt>"` or `codex --file <path> "<prompt>"`)
//   - "claude-subagent" : invoke Claude as a subagent within the same plugin session (handled by orchestrator command, not this lib)
//   - "gemini"          : `gemini -p "<prompt>"`  (hypothetical, command varies)
//   - "openai-cli"      : `openai api chat.completions.create ...`
//   - "custom"          : preset must provide `command_template` (e.g. "mytool --in {file} --prompt '{prompt}'")
//
// This module returns a *plan* (the shell command to run) rather than executing it. The orchestrator
// command (run.md / sa.md / qa.md ...) decides whether to use the Bash tool or the Task tool.

export function planReviewerInvocation({
  tool,
  prompt,
  promptFile = null,
  diffFile = null,
  customTemplate = null,
}) {
  if (!prompt) throw new Error('[cc-nexs] reviewer prompt is required');

  switch (tool) {
    case 'codex':
      if (diffFile) {
        return {
          tool,
          mode: 'bash',
          command: `codex --file ${shellQuote(diffFile)} ${shellQuote(prompt)}`,
        };
      }
      if (promptFile) {
        return {
          tool,
          mode: 'bash',
          command: `codex --file ${shellQuote(promptFile)}`,
        };
      }
      return {
        tool,
        mode: 'bash',
        command: `codex ${shellQuote(prompt)}`,
      };

    case 'claude-subagent':
      // Caller (orchestrator command) should use Task tool with subagent_type matching role,
      // not the Bash tool. We return a structured hint instead of a shell command.
      return {
        tool,
        mode: 'task',
        instruction: prompt,
        notes: 'Caller should invoke the Task tool with subagent_type set to the role agent.',
      };

    case 'gemini':
      return {
        tool,
        mode: 'bash',
        command: `gemini -p ${shellQuote(prompt)}`,
      };

    case 'openai-cli':
      return {
        tool,
        mode: 'bash',
        command: `openai chat completions create -m gpt-5 -g user ${shellQuote(prompt)}`,
      };

    case 'custom':
      if (!customTemplate) {
        throw new Error('[cc-nexs] tool=custom requires command_template in preset role definition');
      }
      const cmd = customTemplate
        .replace('{prompt}', prompt.replace(/'/g, "'\\''"))
        .replace('{file}', diffFile || promptFile || '');
      return { tool, mode: 'bash', command: cmd };

    default:
      throw new Error(`[cc-nexs] Unknown reviewer tool: ${tool}`);
  }
}

function shellQuote(s) {
  if (typeof s !== 'string') return "''";
  if (/^[a-zA-Z0-9_./@:=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
