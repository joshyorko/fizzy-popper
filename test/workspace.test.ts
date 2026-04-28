import { describe, it, expect, vi, beforeEach } from "vitest"
import { prepareAgentWorkspace } from "../src/workspace.js"
import { makeConfig, makeGoldenTicket } from "./fixtures.js"

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "" }),
}))

describe("prepareAgentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses process cwd when no workspace is configured", async () => {
    const workspace = await prepareAgentWorkspace(makeConfig(), makeGoldenTicket(), 42)

    expect(workspace.cwd).toBe(process.cwd())
    await expect(workspace.cleanup()).resolves.toBeUndefined()
  })

  it("uses the default workspace path without isolation", async () => {
    const workspace = await prepareAgentWorkspace(
      makeConfig({ workspace: { path: "/work/repo", isolation: "none", ref: "HEAD", worktree_root: undefined } }),
      makeGoldenTicket(),
      42,
    )

    expect(workspace.cwd).toBe("/work/repo")
  })

  it("creates and cleans up an isolated git worktree", async () => {
    const { execa } = await import("execa")
    const workspace = await prepareAgentWorkspace(
      makeConfig({
        workspace: {
          path: "/work/repo",
          isolation: "git-worktree",
          ref: "main",
          worktree_root: "/tmp/fizzy-worktrees",
        },
      }),
      makeGoldenTicket(),
      42,
    )

    expect(workspace.cwd).toMatch(/^\/tmp\/fizzy-worktrees\/card-42-/)
    expect(execa).toHaveBeenCalledWith("git", [
      "-C",
      "/work/repo",
      "worktree",
      "add",
      "--detach",
      workspace.cwd,
      "main",
    ])

    await workspace.cleanup()

    expect(execa).toHaveBeenCalledWith("git", [
      "-C",
      "/work/repo",
      "worktree",
      "remove",
      "--force",
      workspace.cwd,
    ])
  })

  it("throws when a selected named workspace is not configured", async () => {
    await expect(
      prepareAgentWorkspace(makeConfig(), makeGoldenTicket({ workspace: "missing" }), 42),
    ).rejects.toThrow('Workspace "missing" not found in config.workspaces')
  })
})
