import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decide } from '../.claude/hooks/guard.mjs';

const bash = (command, branch) => decide({ tool: 'Bash', input: { command }, branch });
const edit = (file_path, branch) => decide({ tool: 'Edit', input: { file_path }, branch });

// [description, result, expected deny?]
const cases = [
  // Rule 1: edits / commits / pushes only on feature/* and hotfix/*
  ['edit on main', edit('src/a.js', 'main'), true],
  ['edit on feature', edit('src/a.js', 'feature/x'), false],
  ['edit own settings on feature', edit('.claude/settings.json', 'feature/x'), true],
  ['edit own hook on feature (win path)', edit('C:\\repo\\.claude\\hooks\\guard.mjs', 'feature/x'), true],
  ['commit on main', bash('git commit -m x', 'main'), true],
  ['commit on dev', bash('git commit -m x', 'dev'), true],
  ['commit on feature', bash('git commit -m x', 'feature/x'), false],
  ['commit on hotfix', bash('git commit -m x', 'hotfix/y'), false],
  ['switch to main then commit (chain)', bash('git switch main && git commit -m x', 'feature/x'), true],
  ['commit --no-verify', bash('git commit --no-verify -m x', 'feature/x'), true],
  ['push current feature', bash('git push -u origin feature/x', 'feature/x'), false],
  ['push HEAD:main from feature', bash('git push origin HEAD:main', 'feature/x'), true],
  ['push main', bash('git push origin main', 'main'), true],
  ['push feature with redirect (2>&1)', bash('git push origin feature/x 2>&1 | tail -3', 'feature/x'), false],
  ['force push', bash('git push --force origin feature/x', 'feature/x'), true],

  // Rule 2: merge order feature -> dev -> release -> main
  ['merge feature -> main', bash('git merge feature/x', 'main'), true],
  ['merge feature -> release', bash('git merge feature/x', 'release/1.0'), true],
  ['merge dev -> main', bash('git merge dev', 'main'), true],
  ['merge feature -> dev', bash('git merge feature/x', 'dev'), false],
  ['merge dev -> release', bash('git merge dev', 'release/1.0'), false],
  ['merge release -> main', bash('git merge release/1.0', 'main'), false],
  ['gh pr merge', bash('gh pr merge 1 --squash', 'feature/x'), true],

  // Same rules apply when the agent uses the PowerShell tool instead of Bash
  ['powershell: commit on main', decide({ tool: 'PowerShell', input: { command: 'git commit -m x' }, branch: 'main' }), true],
  ['powershell: commit on feature', decide({ tool: 'PowerShell', input: { command: 'git commit -m x' }, branch: 'feature/x' }), false],

  // Harmless commands pass through
  ['npm test', bash('npm test', 'main'), false],
  ['git status on main', bash('git status', 'main'), false],
];

for (const [name, result, expectedDeny] of cases) {
  test(name, () => assert.equal(result.deny, expectedDeny, result.reason));
}

// End-to-end: run the hook as a real process, the way Claude Code does (JSON on stdin).
const hook = path.resolve('.claude/hooks/guard.mjs');
function runHook(branch, toolName, toolInput) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'guard-'));
  execFileSync('git', ['init', '-b', branch], { cwd, stdio: 'ignore' });
  return spawnSync('node', [hook], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd }),
    encoding: 'utf8',
  });
}

test('e2e: hook process exits 2 with a message on main', () => {
  const r = runHook('main', 'Bash', { command: 'git commit -m x' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOCKED by guardrails/);
});

test('e2e: hook process exits 0 on a feature branch', () => {
  assert.equal(runHook('feature/demo', 'Bash', { command: 'git commit -m x' }).status, 0);
});

// Wiring: the guard must be registered, and the allowlist must not be a blanket "allow everything".
test('settings.json registers the hook and has no blanket Bash allow', () => {
  const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
  const entry = settings.hooks.PreToolUse.find((h) => h.hooks.some((x) => x.command.includes('guard.mjs')));
  for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write']) assert.match(entry.matcher, new RegExp(tool));
  assert.ok(!settings.permissions.allow.some((r) => r === 'Bash' || r === 'Bash(*)'));
});
