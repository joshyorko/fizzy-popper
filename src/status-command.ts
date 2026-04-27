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
const LOCAL_STATUS_HOST = "http://127.0.0.1"

type StatusRouter = Pick<Router, "loadBoardConfigs" | "getBoardConfigs">

type StatusLogger = Pick<typeof log, "info" | "board" | "column" | "header" | "agentSpawn" | "agentStep">

type StatusFetchResult =
  | { ok: true; status: StatusResponse }
  | { ok: false; message: string }

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

  const statusResult = await fetchStatus(config.webhook.port, fetchImpl)
  if (!statusResult.ok) {
    logger.info(statusResult.message)
    return
  }

  renderActiveAgents(statusResult.status.active, logger)
}

async function fetchStatus(port: number, fetchImpl: typeof fetch): Promise<StatusFetchResult> {
  const url = statusUrl(port)

  try {
    const response = await fetchImpl(url)
    if (!response.ok) {
      return {
        ok: false,
        message: `Unable to read live status from ${url} (HTTP ${response.status}). Check the running fizzy-popper service.`,
      }
    }

    let body: unknown
    try {
      body = await response.json() as unknown
    } catch {
      return {
        ok: false,
        message: `Unable to read live status from ${url} (invalid JSON response). Check the running fizzy-popper service.`,
      }
    }

    if (!isStatusResponse(body)) {
      return {
        ok: false,
        message: `Unable to read live status from ${url} (invalid response payload). Check the running fizzy-popper service.`,
      }
    }

    return { ok: true, status: body }
  } catch {
    return {
      ok: false,
      message: `Unable to read live status from ${url} (service unreachable). Start fizzy-popper to see live agents.`,
    }
  }
}

function statusUrl(port: number): string {
  return `${LOCAL_STATUS_HOST}:${port}/status`
}

function formatRunningTime(startedAt: string): string {
  const startedAtMs = new Date(startedAt).getTime()
  if (Number.isNaN(startedAtMs)) return "unknown time"
  return `${((Date.now() - startedAtMs) / MS_PER_SECOND).toFixed(0)}s`
}

function isStatusResponse(value: unknown): value is StatusResponse {
  if (!value || typeof value !== "object") return false
  return "active" in value && Array.isArray(value.active) && value.active.every(isActiveStatusRun)
}

function isActiveStatusRun(value: unknown): value is ActiveStatusRun {
  if (!value || typeof value !== "object") return false

  return (
    "card_number" in value
    && typeof value.card_number === "number"
    && "card_title" in value
    && typeof value.card_title === "string"
    && "column" in value
    && typeof value.column === "string"
    && "backend" in value
    && typeof value.backend === "string"
    && "started_at" in value
    && typeof value.started_at === "string"
  )
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
    logger.agentStep(`${run.backend} — running for ${formatRunningTime(run.started_at)}`)
  }
}
