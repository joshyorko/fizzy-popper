import { mkdirSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { execa } from "execa"
import type { Config } from "./config.js"
import type { GoldenTicket } from "./fizzy.js"

export interface PreparedWorkspace {
  cwd: string
  name?: string
  cleanup(): Promise<void>
}

interface ResolvedWorkspace {
  path: string
  isolation: "none" | "git-worktree"
  ref: string
  worktree_root?: string
  name?: string
}

export async function prepareAgentWorkspace(
  config: Config,
  goldenTicket: GoldenTicket,
  cardNumber: number,
): Promise<PreparedWorkspace> {
  const workspace = resolveAgentWorkspace(config, goldenTicket)
  const sourcePath = resolve(workspace.path)

  if (workspace.isolation === "none") {
    return {
      cwd: sourcePath,
      name: workspace.name,
      cleanup: async () => {},
    }
  }

  const root = resolve(workspace.worktree_root ?? join(tmpdir(), "fizzy-popper-worktrees"))
  mkdirSync(root, { recursive: true })
  const worktreePath = join(root, `card-${cardNumber}-${randomUUID().slice(0, 8)}`)

  await execa("git", ["-C", sourcePath, "worktree", "add", "--detach", worktreePath, workspace.ref])

  return {
    cwd: worktreePath,
    name: workspace.name,
    async cleanup() {
      try {
        await execa("git", ["-C", sourcePath, "worktree", "remove", "--force", worktreePath])
      } catch {
        try { rmSync(worktreePath, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    },
  }
}

function resolveAgentWorkspace(config: Config, goldenTicket: GoldenTicket): ResolvedWorkspace {
  const name = goldenTicket.workspace ?? config.agent.default_workspace
  if (name) {
    const workspace = config.workspaces[name]
    if (!workspace) throw new Error(`Workspace "${name}" not found in config.workspaces`)
    return { ...workspace, name }
  }

  if (config.workspace.path) return config.workspace as ResolvedWorkspace

  return {
    path: process.cwd(),
    isolation: "none",
    ref: "HEAD",
  }
}
