#!/usr/bin/env node
// PreToolUse guard for Claude Code. Enforces the git workflow rules technically,
// so the agent cannot skip them (a deny here wins over any "allow" in settings.json).
//
//   Rule 1: edit/commit/push only on feature/* and hotfix/* branches.
//   Rule 2: merges follow feature -> dev -> release -> main (no shortcuts).
//   Extra : the agent cannot edit its own guardrails; `gh pr merge` is human-only.
//
// Deny = exit code 2 + message on stderr (Claude sees the message and adapts).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK_BRANCH = /^(feature|hotfix)\/.+$/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const OWN_GUARDRAILS = /(^|[\\/])\.claude[\\/](settings(\.local)?\.json|hooks[\\/])/;

// [allowed source, target] pairs for `git merge <source>` run on <target>.
const MERGE_CHAIN = [
  [/^(feature|hotfix)\/.+$/, /^dev$/],
  [/^dev$/, /^release\/.+$/],
  [/^release\/.+$/, /^main$/],
  [/^hotfix\/.+$/, /^main$/],
];
const MERGE_HELP = 'Allowed: feature/*|hotfix/* -> dev, dev -> release/*, release/* -> main, hotfix/* -> main.';

const ok = { deny: false };
const deny = (reason) => ({ deny: true, reason });
const isWork = (branch) => WORK_BRANCH.test(branch);
const branchHelp = (branch) =>
  `Branch '${branch || '(detached)'}' is protected. Create a work branch first: git switch -c feature/<name>.`;

/** Pure decision function: no I/O, so it is trivial to unit-test. */
export function decide({ tool, input = {}, branch }) {
  if (EDIT_TOOLS.has(tool)) {
    const file = input.file_path ?? input.notebook_path ?? '';
    if (OWN_GUARDRAILS.test(file)) return deny(`Editing the guardrails (${file}) is not allowed. Ask a human.`);
    if (!isWork(branch)) return deny(`Edits are blocked. ${branchHelp(branch)}`);
    return ok;
  }
  if (tool === 'Bash' || tool === 'PowerShell') return decideBash(input.command ?? '', branch);
  return ok;
}

function decideBash(command, startBranch) {
  let branch = startBranch; // tracked through `git switch x && git commit`
  // Split chains (&&, ||, ;, |, newline) so `git checkout main && git commit` cannot hide a commit.
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ''))
      .filter((t) => !/^[0-9]*[<>]/.test(t)); // drop redirects like 2>&1, >file

    if (tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') {
      return deny('Merging pull requests is human-only (only 2 people may merge).');
    }
    if (tokens[0] !== 'git') continue;

    let i = 1; // skip global options: git -C <dir> -c k=v --no-pager ...
    while (tokens[i]?.startsWith('-')) i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
    const sub = tokens[i];
    const args = tokens.slice(i + 1);
    const flags = args.filter((a) => a.startsWith('-'));
    const positional = args.filter((a) => !a.startsWith('-'));

    if (sub === 'checkout' || sub === 'switch') {
      if (positional[0]) branch = positional[0];
    } else if (sub === 'commit') {
      if (flags.includes('--no-verify') || flags.includes('-n')) return deny('--no-verify is not allowed.');
      if (!isWork(branch)) return deny(`Commits are blocked. ${branchHelp(branch)}`);
    } else if (sub === 'push') {
      const result = checkPush(flags, positional, branch);
      if (result.deny) return result;
    } else if (sub === 'merge') {
      const result = checkMerge(flags, positional, branch);
      if (result.deny) return result;
    }
  }
  return ok;
}

function checkPush(flags, positional, branch) {
  if (flags.some((f) => ['--all', '--mirror', '--delete', '--force', '-f'].includes(f))) {
    return deny('Push with --all/--mirror/--delete/--force is not allowed.');
  }
  const refspecs = positional.slice(1); // positional[0] is the remote
  const targets = refspecs.length ? refspecs : [branch];
  for (const spec of targets) {
    const dst = spec.replace(/^\+/, '').split(':').pop();
    const name = (dst === 'HEAD' ? branch : dst).replace(/^refs\/heads\//, '');
    if (!isWork(name)) return deny(`Push to '${name}' is blocked. Only feature/* and hotfix/* may be pushed; promote via the merge chain and a human.`);
  }
  return ok;
}

function checkMerge(flags, positional, target) {
  if (flags.some((f) => ['--abort', '--continue', '--quit'].includes(f))) return ok;
  if (!positional.length) return deny(`Specify the branch to merge explicitly. ${MERGE_HELP}`);
  for (const raw of positional) {
    const source = raw.replace(/^origin\//, '');
    const allowed = MERGE_CHAIN.some(([src, dst]) => src.test(source) && dst.test(target));
    if (!allowed) return deny(`Merge '${source}' -> '${target}' is not allowed. ${MERGE_HELP}`);
  }
  return ok;
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return ''; // not a repo / detached HEAD: fail closed
  }
}

// Run as a hook only when executed directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  const result = decide({
    tool: payload.tool_name,
    input: payload.tool_input,
    branch: currentBranch(payload.cwd || process.cwd()),
  });
  if (result.deny) {
    process.stderr.write(`BLOCKED by guardrails: ${result.reason}\n`);
    process.exit(2);
  }
}
