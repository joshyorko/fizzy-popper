import type { Config } from "./config.js"
import type { BoardConfig, Router } from "./router.js"
import * as log from "./log.js"

interface ActiveStatusRun {
  card_number: number
  card_title: string
  column: string
  backend: string
  started_at: string
}

interface StatusResponse {
  active: ActiveStatusRun[]
}

const MS_PER_SECOND = 1000

type StatusRouter = Pick<Router, "loadBoardConfigs" | "getBoardConfigs">

type StatusLogger = Pick<typeof log, "info" | "board" | "column" | "header" | "agentSpawn" | "agentStep">

export async function runStatusCommand(
  config: Config,
  router: StatusRouter,
  fetchImpl: typeof fetch = fetch,
  logger: StatusLogger = log,
): Promise<void> {
  const boardIds = config.boards === "all" ? [] : config.boards

  await router.loadBoardConfigs(boardIds.length > 0 ? boardIds : undefined)

  const boardConfigs = router.getBoardConfigs()
  if (boardConfigs.size === 0) {
    logger.info("No boards configured.")
    return
  }

  renderBoardSummary(boardConfigs, logger)

  const status = await fetchStatus(config.webhook.port, fetchImpl)
  if (!status) {
    logger.info(`Status server unavailable at http://127.0.0.1:${config.webhook.port}/status. Start fizzy-popper to see live agents.`)
    return
  }

  renderActiveAgents(status.active, logger)
}

async function fetchStatus(port: number, fetchImpl: typeof fetch): Promise<StatusResponse | null> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/status`)
    if (!response.ok) return null

    const body = await response.json() as unknown
    if (!isStatusResponse(body)) return null

    return body
  } catch {
    return null
  }
}

function isStatusResponse(value: unknown): value is StatusResponse {
  if (!value || typeof value !== "object") return false
  return "active" in value && Array.isArray(value.active)
}

function renderBoardSummary(boardConfigs: Map<string, BoardConfig>, logger: StatusLogger): void {
  for (const [, boardConfig] of boardConfigs) {
    logger.board(boardConfig.boardName, `${boardConfig.goldenTickets.size} agent column(s)`)
    for (const [, ticket] of boardConfig.goldenTickets) {
      logger.column(ticket.column_name, ticket.backend)
    }
  }
}

function renderActiveAgents(active: ActiveStatusRun[], logger: StatusLogger): void {
  if (active.length === 0) {
    logger.info("No agents currently running.")
    return
  }

  logger.header("Active Agents")
  for (const run of active) {
    logger.agentSpawn(run.card_number, run.card_title, run.column)

    const startedAtMs = Date.parse(run.started_at)
    const runningFor = Number.isNaN(startedAtMs)
      ? "unknown"
      : ((Date.now() - startedAtMs) / MS_PER_SECOND).toFixed(0)

    logger.agentStep(`${run.backend} — running for ${runningFor}s`)
  }
}
