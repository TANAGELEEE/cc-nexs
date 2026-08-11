// cc-nexs core: reviewer-adapter.
// Abstracts the "external reviewer" tool used for SA / QA / Evaluator-style roles.
// Supported tools (declared in preset.roles.definitions[<role>].tool):
//   - "codex"           : Codex CLI in non-interactive exec mode; optional file content is passed on stdin
//   - "claude-subagent" : invoke Claude as a subagent within the same plugin session (handled by orchestrator command, not this lib)
//   - "gemini"          : `gemini -p "<prompt>"`  (hypothetical, command varies)
//   - "openai-cli"      : `openai api chat.completions.create ...`
//   - "pi-subagent"     : invoke an isolated agent through the pi-subagents extension
//   - "custom"          : preset must provide `command_template` (e.g. "mytool --in {file} --prompt '{prompt}'")
//
// This module returns an argv plan rather than a shell command. Callers must use
// execFile/spawn semantics so prompts and paths cannot become shell syntax.

export function planReviewerInvocation({
  tool,
  prompt,
  promptFile = null,
  diffFile = null,
  customTemplate = null,
  model = 'inherit',
  effort = 'inherit',
  fallbackModels = [],
}) {
  if (!prompt) throw new Error('[cc-nexs] reviewer prompt is required');

  switch (tool) {
    case 'codex':
      const codexModelArgs = model === 'inherit' ? [] : ['--model', model];
      const codexEffortArgs = effort === 'inherit' ? [] : ['--config', `model_reasoning_effort="${effort}"`];
      if (diffFile) {
        return {
          tool,
          mode: 'bash',
          executable: 'codex',
          args: [...codexModelArgs, ...codexEffortArgs, 'exec', prompt],
          stdinFile: diffFile,
        };
      }
      if (promptFile) {
        return {
          tool,
          mode: 'bash',
          executable: 'codex',
          args: [...codexModelArgs, ...codexEffortArgs, 'exec', '-'],
          stdinFile: promptFile,
        };
      }
      return {
        tool,
        mode: 'bash',
        executable: 'codex',
        args: [...codexModelArgs, ...codexEffortArgs, 'exec', prompt],
      };

    case 'claude-subagent':
      // Caller (orchestrator command) should use Task tool with subagent_type matching role,
      // not the Bash tool. We return a structured hint instead of a shell command.
      return {
        tool,
        mode: 'task',
        instruction: prompt,
        model,
        effort,
        fallbackModels,
        notes: 'Caller should invoke the Task tool with subagent_type set to the role agent.',
      };

    case 'native-agent':
      return {
        tool,
        mode: 'native-agent',
        instruction: prompt,
        model,
        reasoning_effort: effort,
        notes: 'Spawn an independent native agent. Apply model/effort when configured; inherit otherwise.',
      };

    case 'pi-subagent':
      return {
        tool,
        mode: 'pi-subagent',
        instruction: prompt,
        model,
        thinking: effort,
        fallbackModels,
        notes: 'Invoke the package-qualified cc-nexs role through pi-subagents with fresh context. Encode thinking as a provider/model:thinking selector; retry fallbackModels only for failed tasks.',
      };

    case 'gemini':
      return {
        tool,
        mode: 'bash',
        executable: 'gemini',
        args: ['-p', prompt],
      };

    case 'openai-cli':
      return {
        tool,
        mode: 'bash',
        executable: 'openai',
        args: ['responses', 'create', '--input', prompt],
        notes: 'No model id is passed; the configured CLI/channel default must be used.',
      };

    case 'custom':
      if (!customTemplate) {
        throw new Error('[cc-nexs] tool=custom requires command_template in preset role definition');
      }
      if (!Array.isArray(customTemplate) || customTemplate.length === 0) {
        throw new Error('[cc-nexs] custom command_template must be an argv array');
      }
      const expanded = customTemplate.map((part) => part
        .replaceAll('{prompt}', prompt)
        .replaceAll('{file}', diffFile || promptFile || ''));
      return { tool, mode: 'bash', executable: expanded[0], args: expanded.slice(1) };

    default:
      throw new Error(`[cc-nexs] Unknown reviewer tool: ${tool}`);
  }
}
