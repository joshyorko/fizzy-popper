import { describe, it, expect, vi } from "vitest"
import {
  bootstrapStarterBoard,
  buildSetupConfig,
  buildStarterBoardPlan,
  defaultStarterBoardName,
} from "../src/setup-bootstrap.js"
import { makeBoard, makeCard, makeColumn } from "./fixtures.js"

describe("setup bootstrap helpers", () => {
  it("uses the repo folder in the default starter board name", () => {
    expect(defaultStarterBoardName("/tmp/work/fizzy-popper")).toBe("Agent Playground: fizzy-popper")
  })

  it("builds the recommended golden ticket tags for the selected backend", () => {
    const plan = buildStarterBoardPlan({
      cwd: "/tmp/work/fizzy-popper",
      backend: "codex",
      includeSampleCard: true,
    })

    expect(plan.goldenTicket.tags).toEqual(["agent-instructions", "codex", "move-to-done"])
  })

  it("can include or omit the sample smoke-test card", () => {
    const withSample = buildStarterBoardPlan({
      cwd: "/tmp/work/fizzy-popper",
      backend: "claude",
      includeSampleCard: true,
    })
    const withoutSample = buildStarterBoardPlan({
      cwd: "/tmp/work/fizzy-popper",
      backend: "claude",
      includeSampleCard: false,
    })

    expect(withSample.sampleCard).toEqual(expect.objectContaining({
      title: "Smoke test the agent loop",
    }))
    expect(withoutSample.sampleCard).toBeNull()
  })

  it("creates the starter board and returns a config that watches the created board", async () => {
    const plan = buildStarterBoardPlan({
      cwd: "/tmp/work/fizzy-popper",
      backend: "codex",
      includeSampleCard: false,
    })
    const client = {
      createBoard: vi.fn().mockResolvedValue(makeBoard({ id: "board-new", name: plan.boardName })),
      createColumn: vi.fn()
        .mockResolvedValueOnce(makeColumn({ id: "col-ready", name: plan.agentColumnName }))
        .mockResolvedValueOnce(makeColumn({ id: "col-done", name: plan.doneColumnName })),
      createCard: vi.fn().mockResolvedValue(makeCard({ id: "golden-new", number: 77, title: plan.goldenTicket.title })),
      toggleTag: vi.fn().mockResolvedValue(undefined),
      triageCard: vi.fn().mockResolvedValue(undefined),
      createStep: vi.fn().mockResolvedValue({ id: "step-new", content: "Inspect", completed: false }),
    }

    const result = await bootstrapStarterBoard(client, plan)
    const config = buildSetupConfig({
      token: "fz_test",
      account: "test-account",
      apiUrl: "https://app.fizzy.do",
      boardIds: [result.board.id],
      defaultBackend: "codex",
    })

    expect(result.board.id).toBe("board-new")
    expect(client.createBoard).toHaveBeenCalledWith({ name: "Agent Playground: fizzy-popper" })
    expect(client.triageCard).toHaveBeenCalledWith(77, "col-ready")
    expect(client.createStep).toHaveBeenCalledTimes(plan.goldenTicket.steps.length)
    expect(config).toMatchObject({
      boards: ["board-new"],
      agent: {
        max_concurrent: 1,
        default_backend: "codex",
      },
    })
  })
})
