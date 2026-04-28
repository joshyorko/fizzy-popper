import { describe, it, expect, vi, beforeEach } from "vitest"
import { createBackend } from "../src/agent.js"
import { makeConfig } from "./fixtures.js"

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: JSON.stringify({ output: "<p>Done</p>" }) }),
}))

describe("CLI backend workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes configured cwd to Codex --cd and process cwd", async () => {
    const { execa } = await import("execa")
    const backend = createBackend("codex", makeConfig())

    await backend.execute("Do work", {
      timeout: 1000,
      signal: new AbortController().signal,
      cwd: "/work/repo",
    })

    expect(execa).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["--cd", "/work/repo"]),
      expect.objectContaining({ cwd: "/work/repo" }),
    )
  })
})
