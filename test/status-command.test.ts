import { describe, expect, it, vi, afterEach } from "vitest"
import { runStatusCommand } from "../src/status-command.js"
import { makeConfig, makeGoldenTicket } from "./fixtures.js"

function makeLogger() {
  return {
    info: vi.fn(),
    board: vi.fn(),
    column: vi.fn(),
    header: vi.fn(),
    agentSpawn: vi.fn(),
    agentStep: vi.fn(),
  }
}

describe("runStatusCommand", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports active agents from the running local service", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-27T12:00:10Z"))

    const logger = makeLogger()
    const router = {
      loadBoardConfigs: vi.fn().mockResolvedValue(undefined),
      getBoardConfigs: vi.fn().mockReturnValue(new Map([
        ["board-1", {
          boardId: "board-1",
          boardName: "work-ai-board",
          goldenTickets: new Map([["col-1", makeGoldenTicket({ column_name: "Triage", backend: "codex" })]]),
        }],
      ])),
    }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      active: [
        {
          card_number: 255,
          card_title: "Fix RPA Playwright browser automation failures from PROD run 24919915027",
          column: "Triage",
          backend: "codex",
          started_at: "2026-04-27T12:00:00Z",
        },
      ],
      recent: [],
      active_count: 1,
    })))

    await runStatusCommand(makeConfig(), router, fetchImpl, logger)

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:4567/status")
    expect(logger.board).toHaveBeenCalledWith("work-ai-board", "1 agent column(s)")
    expect(logger.column).toHaveBeenCalledWith("Triage", "codex")
    expect(logger.header).toHaveBeenCalledWith("Active Agents")
    expect(logger.agentSpawn).toHaveBeenCalledWith(
      255,
      "Fix RPA Playwright browser automation failures from PROD run 24919915027",
      "Triage",
    )
    expect(logger.agentStep).toHaveBeenCalledWith("codex — running for 10s")
    expect(logger.info).not.toHaveBeenCalledWith("No agents currently running.")
  })

  it("does not incorrectly report no agents when the local service is unavailable", async () => {
    const logger = makeLogger()
    const router = {
      loadBoardConfigs: vi.fn().mockResolvedValue(undefined),
      getBoardConfigs: vi.fn().mockReturnValue(new Map([
        ["board-1", {
          boardId: "board-1",
          boardName: "work-ai-board",
          goldenTickets: new Map([["col-1", makeGoldenTicket({ column_name: "Triage", backend: "codex" })]]),
        }],
      ])),
    }
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))

    await runStatusCommand(makeConfig(), router, fetchImpl, logger)

    expect(logger.info).toHaveBeenCalledWith("Status server unavailable on :4567. Start fizzy-popper to see live agents.")
    expect(logger.info).not.toHaveBeenCalledWith("No agents currently running.")
  })
})
