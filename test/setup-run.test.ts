import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as p from "@clack/prompts"
import { detectBackends } from "../src/agent.js"
import { runSetup } from "../src/setup.js"
import { configPath } from "../src/config.js"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { makeBoard, makeCard, makeColumn } from "./fixtures.js"

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: {
    info: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("../src/agent.js", () => ({
  detectBackends: vi.fn(),
}))

const originalCwd = process.cwd()
let tempDir: string

describe("runSetup", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fizzy-popper-setup-"))
    process.chdir(tempDir)
    process.env.FIZZY_API_URL = "https://app.fizzy.do"
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true, force: true })
    delete process.env.FIZZY_API_URL
    vi.unstubAllGlobals()
  })

  it("bootstraps a recommended starter board when no boards exist", async () => {
    vi.mocked(detectBackends).mockResolvedValue(["codex"])
    vi.mocked(p.text).mockResolvedValue("fz_test")
    vi.mocked(p.select)
      .mockResolvedValueOnce("codex")
      .mockResolvedValueOnce("recommended")
    vi.mocked(p.confirm).mockResolvedValue(true)

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url === "https://app.fizzy.do/my/identity") {
        return jsonResponse({ accounts: [{ id: "acct-1", name: "Test Account", slug: "/test-account", user: {} }] })
      }
      if (url === "https://app.fizzy.do/test-account/boards" && method === "GET") {
        return jsonResponse([])
      }
      if (url === "https://app.fizzy.do/test-account/boards" && method === "POST") {
        return jsonResponse(makeBoard({ id: "board-new", name: "Agent Playground: fizzy-popper-setup-test" }), 201)
      }
      if (url === "https://app.fizzy.do/test-account/boards/board-new/columns" && method === "POST") {
        const body = JSON.parse(String(init?.body))
        const name = String(body.name)
        return jsonResponse(makeColumn({
          id: name === "Done" ? "col-done" : "col-ready",
          name,
        }), 201)
      }
      if (url === "https://app.fizzy.do/test-account/cards" && method === "POST") {
        const body = JSON.parse(String(init?.body))
        const title = String(body.title)
        const number = title === "Smoke test the agent loop" ? 102 : 101
        return jsonResponse(makeCard({ id: `card-${number}`, number, title }), 201)
      }
      if (url.match(/\/cards\/101\/taggings$/) && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (url.match(/\/cards\/101\/triage$/) && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (url.match(/\/cards\/101\/steps$/) && method === "POST") {
        return jsonResponse({ id: "step-new", content: "step", completed: false }, 201)
      }
      if (url.match(/\/cards\/102\/triage$/) && method === "POST") {
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await runSetup()

    const saved = parseYaml(readFileSync(configPath(), "utf-8")) as Record<string, any>
    expect(saved.boards).toEqual(["board-new"])
    expect(saved.agent).toMatchObject({
      default_backend: "codex",
      max_concurrent: 1,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.fizzy.do/test-account/cards/101/taggings",
      expect.objectContaining({ body: JSON.stringify({ tag_title: "agent-instructions" }) }),
    )
    expect(p.multiselect).not.toHaveBeenCalled()
    expect(p.outro).toHaveBeenCalledWith(expect.stringContaining("fizzy-popper start"))
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}
