import * as p from "@clack/prompts"
import chalk from "chalk"
import { execFileSync } from "node:child_process"
import { saveConfig } from "./config.js"
import { FizzyClient, type FizzyBoard } from "./fizzy.js"
import { detectBackends } from "./agent.js"
import {
  bootstrapStarterBoard,
  buildSetupConfig,
  buildStarterBoardPlan,
  defaultStarterBoardName,
  DEFAULT_AGENT_COLUMN_NAME,
  DEFAULT_DONE_COLUMN_NAME,
  DEFAULT_GOLDEN_TICKET_PROMPT,
  DEFAULT_GOLDEN_TICKET_TITLE,
  type StarterBoardResult,
} from "./setup-bootstrap.js"

const DEFAULT_FIZZY_API_URL = "https://app.fizzy.do"

export async function runSetup(): Promise<void> {
  p.intro(chalk.bold("fizzy-popper") + " — AI agents for your Fizzy boards")
  const apiUrl = resolveFizzyApiUrl()
  p.log.info(`Fizzy API: ${apiUrl}`)

  // API token
  const token = await p.text({
    message: "Fizzy API token (profile → API → Personal access tokens)",
    placeholder: "fz_...",
    validate(value) {
      if (!value) return "Token is required"
    },
  })
  if (p.isCancel(token)) return cancel()

  // Validate token and get accounts
  const tempClient = new FizzyClient({
    fizzy: { token: token as string, account: "", api_url: apiUrl },
  } as any)

  let identity: Awaited<ReturnType<typeof tempClient.getIdentity>>
  try {
    identity = await tempClient.getIdentity()
  } catch (err) {
    p.cancel("Failed to authenticate. Check your API token.")
    process.exit(1)
  }

  if (identity.accounts.length === 0) {
    p.cancel("No accounts found for this token.")
    process.exit(1)
  }

  // Account selection
  let accountSlug: string
  if (identity.accounts.length === 1) {
    accountSlug = identity.accounts[0].slug.replace(/^\//, "")
    p.log.info(`Account: ${identity.accounts[0].name} (${accountSlug})`)
  } else {
    const selected = await p.select({
      message: "Which account?",
      options: identity.accounts.map(a => ({
        value: a.slug.replace(/^\//, ""),
        label: a.name,
        hint: a.slug,
      })),
    })
    if (p.isCancel(selected)) return cancel()
    accountSlug = selected as string
  }

  // Fetch boards
  const client = new FizzyClient({
    fizzy: { token: token as string, account: accountSlug, api_url: apiUrl },
  } as any)

  // Backend detection and selection
  const s = p.spinner()
  s.start("Detecting installed agent backends...")
  const detected = await detectBackends()
  s.stop(
    detected.length > 0
      ? `Detected: ${detected.join(", ")}`
      : "No CLI backends detected (you can use API backends)",
  )

  const backendOptions: Array<{ value: string; label: string; hint?: string }> = []
  if (detected.includes("claude")) backendOptions.push({ value: "claude", label: "Claude Code CLI" })
  if (detected.includes("codex")) backendOptions.push({ value: "codex", label: "OpenAI Codex CLI" })
  if (detected.includes("opencode")) backendOptions.push({ value: "opencode", label: "OpenCode CLI" })
  backendOptions.push({ value: "anthropic", label: "Anthropic API (direct)", hint: "requires ANTHROPIC_API_KEY" })
  backendOptions.push({ value: "openai", label: "OpenAI API (direct)", hint: "requires OPENAI_API_KEY" })
  backendOptions.push({ value: "command", label: "Custom command" })

  const defaultBackend = await p.select({
    message: "Default agent backend",
    options: backendOptions,
  })
  if (p.isCancel(defaultBackend)) return cancel()

  let boards: FizzyBoard[]
  try {
    boards = await client.listBoards()
  } catch (err) {
    p.cancel("Failed to fetch boards. Check your permissions.")
    process.exit(1)
  }

  if (boards.length === 0) p.log.info("No existing boards found. Setup can create one for you.")

  // Board setup
  const boardModeOptions: Array<{ value: "recommended" | "existing" | "custom"; label: string; hint?: string }> = [
    {
      value: "recommended",
      label: "Create recommended starter board",
      hint: `${defaultStarterBoardName()} with ${DEFAULT_AGENT_COLUMN_NAME} → ${DEFAULT_DONE_COLUMN_NAME}`,
    },
  ]
  if (boards.length > 0) {
    boardModeOptions.push({
      value: "existing",
      label: "Use existing board(s)",
      hint: "Choose boards that already have golden tickets",
    })
  }
  boardModeOptions.push({
    value: "custom",
    label: "Customize starter board",
    hint: "Choose board, column, and golden ticket names",
  })

  const boardMode = await p.select({
    message: "How should setup configure boards?",
    options: boardModeOptions,
  })
  if (p.isCancel(boardMode)) return cancel()

  let selectedBoardIds: string[]
  let starterResult: StarterBoardResult | null = null

  if (boardMode === "existing") {
    const selectedBoards = await p.multiselect({
      message: "Which boards to watch?",
      options: boards.map(b => ({ value: b.id, label: b.name })),
      required: true,
    })
    if (p.isCancel(selectedBoards)) return cancel()
    selectedBoardIds = selectedBoards as string[]
  } else {
    const includeSampleCard = await p.confirm({
      message: "Create a smoke-test work card too?",
      initialValue: true,
    })
    if (p.isCancel(includeSampleCard)) return cancel()

    let plan = buildStarterBoardPlan({
      backend: defaultBackend as string,
      includeSampleCard: includeSampleCard as boolean,
    })

    if (boardMode === "custom") {
      const boardName = await p.text({
        message: "Board name",
        placeholder: plan.boardName,
        validate(value) {
          if (!value) return "Board name is required"
        },
      })
      if (p.isCancel(boardName)) return cancel()

      const agentColumnName = await p.text({
        message: "Agent column name",
        placeholder: plan.agentColumnName,
        validate(value) {
          if (!value) return "Agent column name is required"
        },
      })
      if (p.isCancel(agentColumnName)) return cancel()

      const doneColumnName = await p.text({
        message: "Done column name",
        placeholder: plan.doneColumnName,
        validate(value) {
          if (!value) return "Done column name is required"
        },
      })
      if (p.isCancel(doneColumnName)) return cancel()

      const goldenTicketTitle = await p.text({
        message: "Golden ticket title",
        placeholder: DEFAULT_GOLDEN_TICKET_TITLE,
        validate(value) {
          if (!value) return "Golden ticket title is required"
        },
      })
      if (p.isCancel(goldenTicketTitle)) return cancel()

      const goldenTicketPrompt = await p.text({
        message: "Golden ticket prompt",
        placeholder: DEFAULT_GOLDEN_TICKET_PROMPT,
        validate(value) {
          if (!value) return "Golden ticket prompt is required"
        },
      })
      if (p.isCancel(goldenTicketPrompt)) return cancel()

      plan = buildStarterBoardPlan({
        backend: defaultBackend as string,
        includeSampleCard: includeSampleCard as boolean,
        boardName: boardName as string,
        agentColumnName: agentColumnName as string,
        doneColumnName: doneColumnName as string,
        goldenTicketTitle: goldenTicketTitle as string,
        goldenTicketPrompt: goldenTicketPrompt as string,
      })
    }

    const bootstrapSpinner = p.spinner()
    bootstrapSpinner.start(`Creating ${plan.boardName}...`)
    try {
      starterResult = await bootstrapStarterBoard(client, plan)
    } catch (err) {
      bootstrapSpinner.stop("Starter board creation failed")
      const message = err instanceof Error ? err.message : String(err)
      p.cancel(`Failed to create starter board: ${message}`)
      process.exit(1)
    }
    bootstrapSpinner.stop(`Created ${starterResult.board.name}`)
    selectedBoardIds = [starterResult.board.id]
  }

  // Build config
  const config = buildSetupConfig({
    token: token as string,
    account: accountSlug,
    apiUrl,
    boardIds: selectedBoardIds,
    defaultBackend: defaultBackend as string,
  })

  // Save
  const path = saveConfig(config)
  p.log.success(`Config saved to ${chalk.dim(path)}`)

  if (starterResult) {
    p.note(
      [
        `Board: ${starterResult.board.name}`,
        `Agent column: ${starterResult.agentColumn.name}`,
        `Golden ticket: #${starterResult.goldenTicket.number} ${starterResult.goldenTicket.title}`,
        starterResult.sampleCard
          ? `Smoke-test card: #${starterResult.sampleCard.number} ${starterResult.sampleCard.title} (runs after ${chalk.cyan("fizzy-popper start")})`
          : "No smoke-test card created.",
      ].join("\n"),
      "Starter board",
    )
  } else {
    p.note(
      [
        `1. Add a card tagged ${chalk.cyan("#agent-instructions")} to any column you want agents to work`,
        `2. Write instructions in the card description, add a checklist as steps`,
        `3. Tag it ${chalk.cyan("#claude")}, ${chalk.cyan("#codex")}, etc. to pick the backend (or use your default)`,
      ].join("\n"),
      "Next steps",
    )
  }

  p.outro(`Run ${chalk.cyan("fizzy-popper start")} to begin watching.`)
}

function cancel(): void {
  p.cancel("Setup cancelled.")
  process.exit(0)
}

export function resolveFizzyApiUrl(): string {
  const envUrl = normalizeFizzyApiUrl(process.env.FIZZY_API_URL)
  if (envUrl) return envUrl

  try {
    const stdout = execFileSync("fizzy", ["config", "show", "--json"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const parsed = JSON.parse(stdout) as { data?: { api_url?: unknown } }
    const apiUrl = normalizeFizzyApiUrl(parsed.data?.api_url)
    if (apiUrl) return apiUrl
  } catch {
    // If the Fizzy CLI is unavailable or unauthenticated, fall back to hosted Fizzy.
  }

  return DEFAULT_FIZZY_API_URL
}

function normalizeFizzyApiUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const apiUrl = raw.trim().replace(/\/$/, "")
  if (!apiUrl) return null

  try {
    const parsed = new URL(apiUrl)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return apiUrl
  } catch {
    // Ignore invalid URLs and fall back to the next configured source.
  }

  return null
}
