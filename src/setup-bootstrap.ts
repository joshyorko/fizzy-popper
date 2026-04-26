import { basename } from "node:path"
import type { FizzyBoard, FizzyCard, FizzyColumn, FizzyStep } from "./fizzy.js"

export const DEFAULT_AGENT_COLUMN_NAME = "Ready for Agents"
export const DEFAULT_DONE_COLUMN_NAME = "Done"
export const DEFAULT_GOLDEN_TICKET_TITLE = "Repo Agent"
export const DEFAULT_SAMPLE_CARD_TITLE = "Smoke test the agent loop"

export const DEFAULT_GOLDEN_TICKET_PROMPT = [
  "You are working in this repository.",
  "Inspect the card request, read relevant files, make the smallest safe change, run appropriate local checks, and summarize what changed.",
  "Do not commit unless the card explicitly asks for a commit.",
].join(" ")

export const DEFAULT_GOLDEN_TICKET_STEPS = [
  "Inspect the repository and the card request",
  "Make the smallest safe change that satisfies the request",
  "Run the appropriate local checks",
  "Summarize what changed and any follow-up needed",
]

export interface StarterBoardPlan {
  boardName: string
  agentColumnName: string
  doneColumnName: string
  goldenTicket: {
    title: string
    description: string
    tags: string[]
    steps: string[]
  }
  sampleCard: {
    title: string
    description: string
  } | null
}

export interface StarterBoardPlanInput {
  cwd?: string
  backend: string
  includeSampleCard: boolean
  boardName?: string
  agentColumnName?: string
  doneColumnName?: string
  goldenTicketTitle?: string
  goldenTicketPrompt?: string
}

export interface BootstrapFizzyClient {
  createBoard(input: { name: string; all_access?: boolean }): Promise<FizzyBoard>
  createColumn(boardId: string, input: { name: string; color?: string }): Promise<FizzyColumn>
  createCard(input: { board_id: string; title: string; description?: string }): Promise<FizzyCard>
  toggleTag(cardNumber: number, tagTitle: string): Promise<void>
  triageCard(cardNumber: number, columnId: string): Promise<void>
  createStep(cardNumber: number, input: { content: string; completed?: boolean }): Promise<FizzyStep>
}

export interface StarterBoardResult {
  board: FizzyBoard
  agentColumn: FizzyColumn
  doneColumn: FizzyColumn
  goldenTicket: FizzyCard
  sampleCard: FizzyCard | null
}

export function defaultStarterBoardName(cwd: string = process.cwd()): string {
  const folder = basename(cwd) || "repository"
  return `Agent Playground: ${folder}`
}

export function buildStarterBoardPlan(input: StarterBoardPlanInput): StarterBoardPlan {
  const doneColumnName = normalizeRequired(input.doneColumnName, DEFAULT_DONE_COLUMN_NAME)
  return {
    boardName: normalizeRequired(input.boardName, defaultStarterBoardName(input.cwd)),
    agentColumnName: normalizeRequired(input.agentColumnName, DEFAULT_AGENT_COLUMN_NAME),
    doneColumnName,
    goldenTicket: {
      title: normalizeRequired(input.goldenTicketTitle, DEFAULT_GOLDEN_TICKET_TITLE),
      description: normalizeRequired(input.goldenTicketPrompt, DEFAULT_GOLDEN_TICKET_PROMPT),
      tags: ["agent-instructions", input.backend, completionTagForColumnName(doneColumnName)],
      steps: [...DEFAULT_GOLDEN_TICKET_STEPS],
    },
    sampleCard: input.includeSampleCard
      ? {
          title: DEFAULT_SAMPLE_CARD_TITLE,
          description: "Inspect this repository and post a short summary of what it is.",
        }
      : null,
  }
}

export async function bootstrapStarterBoard(
  client: BootstrapFizzyClient,
  plan: StarterBoardPlan,
): Promise<StarterBoardResult> {
  const board = await client.createBoard({ name: plan.boardName })
  const agentColumn = await client.createColumn(board.id, { name: plan.agentColumnName })
  const doneColumn = await client.createColumn(board.id, { name: plan.doneColumnName })

  const goldenTicket = await client.createCard({
    board_id: board.id,
    title: plan.goldenTicket.title,
    description: plan.goldenTicket.description,
  })
  for (const tag of plan.goldenTicket.tags) {
    await client.toggleTag(goldenTicket.number, tag)
  }
  await client.triageCard(goldenTicket.number, agentColumn.id)
  for (const content of plan.goldenTicket.steps) {
    await client.createStep(goldenTicket.number, { content, completed: false })
  }

  let sampleCard: FizzyCard | null = null
  if (plan.sampleCard) {
    sampleCard = await client.createCard({
      board_id: board.id,
      title: plan.sampleCard.title,
      description: plan.sampleCard.description,
    })
    await client.triageCard(sampleCard.number, agentColumn.id)
  }

  return { board, agentColumn, doneColumn, goldenTicket, sampleCard }
}

export function buildSetupConfig(input: {
  token: string
  account: string
  apiUrl: string
  boardIds: string[]
  defaultBackend: string
}): Record<string, unknown> {
  return {
    fizzy: {
      token: input.token,
      account: input.account,
      api_url: input.apiUrl,
    },
    boards: input.boardIds,
    agent: {
      max_concurrent: 1,
      timeout: 300000,
      default_backend: input.defaultBackend,
    },
    polling: {
      interval: 30000,
    },
    webhook: {
      port: 4567,
    },
  }
}

function completionTagForColumnName(columnName: string): string {
  const slug = columnName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `move-to-${slug || "done"}`
}

function normalizeRequired(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}
