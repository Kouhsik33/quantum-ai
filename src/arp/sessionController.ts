import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { ArpApiClient } from "./apiClient";
import type {
  ChatMessage,
  ChatSessionState,
  ClarificationQuestion,
  ConfirmationAction,
  ExperimentLogEntry,
  ExperimentLifecycleStatus,
  PendingQuestionPayload,
  StatusData
} from "./types";

type UpdateListener = (state: ChatSessionState) => void;

type SessionControllerOptions = {
  pollIntervalMs: number;
};

export class ChatSessionController {
  private readonly api: ArpApiClient;
  private readonly options: SessionControllerOptions;
  private readonly listeners = new Set<UpdateListener>();
  private pollTimer: NodeJS.Timeout | null = null;
  private pollBusy = false;
  private messageCounter = 0;
  private terminalArtifactsFetched = false;
  private lastAnnouncedActionId: string | null = null;
  private lastAnnouncedQuestionId: string | null = null;

  private state: ChatSessionState = {
    experimentId: null,
    status: "idle",
    phase: null,
    researchType: "ai",
    executionMode: null,
    executionTarget: null,
    progressPct: 0,
    pendingQuestion: null,
    pendingAction: null,
    lastSuggestedAnswer: "",
    inputPlaceholder: "Describe what you want to research...",
    messages: [],
    polling: {
      enabled: false,
      intervalMs: 3000
    }
  };

  constructor(api: ArpApiClient, _context: unknown, options: SessionControllerOptions) {
    this.api = api;
    this.options = options;
    this.state.polling.intervalMs = options.pollIntervalMs;
  }

  getState(): ChatSessionState {
    return { ...this.state, messages: [...this.state.messages] };
  }

  onUpdate(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.stopPolling();
    this.listeners.clear();
  }

  async hydrateFromPersistedState(): Promise<boolean> {
    return false;
  }

  async startFreshSession(): Promise<void> {
    this.stopPolling();
    this.terminalArtifactsFetched = false;
    this.state.experimentId = null;
    this.state.status = "idle";
    this.state.phase = null;
    this.state.progressPct = 0;
    this.state.pendingQuestion = null;
    this.state.pendingAction = null;
    this.state.lastSuggestedAnswer = "";
    this.state.inputPlaceholder = "Describe what you want to research...";
    this.state.messages = [];
    this.lastAnnouncedActionId = null;
    this.lastAnnouncedQuestionId = null;
    this.notify();
  }

  async startFromChatQuery(query: string, researchType: "ai" | "quantum", projectRoot = ""): Promise<void> {
    const configOverrides: Record<string, unknown> = {
      research_type: researchType,
      research_mode: researchType
    };
    if (projectRoot.trim()) {
      configOverrides.project_root = projectRoot.trim();
    }
    await this.startFromUserPrompt(query, "normal", configOverrides);
  }

  async startFromUserPrompt(prompt: string, _priority: string, configOverrides: Record<string, unknown>): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    this.stopPolling();
    this.terminalArtifactsFetched = false;
    this.state.messages = [];
    this.state.pendingQuestion = null;
    this.state.pendingAction = null;
    this.state.progressPct = 0;
    this.lastAnnouncedActionId = null;
    this.lastAnnouncedQuestionId = null;
    this.pushMessage("user", "text", trimmed);

    const researchType = String(configOverrides.research_type || configOverrides.research_mode || "ai").toLowerCase().includes("quantum")
      ? "quantum"
      : "ai";

    try {
      const start = await this.api.startExperiment(trimmed, researchType, configOverrides);
      this.state.experimentId = start.experiment_id;
      this.state.status = this.normalizeStatus(start.status);
      this.state.phase = start.phase;
      this.state.researchType = start.research_type === "quantum" ? "quantum" : researchType;
      this.state.executionMode = start.execution_mode || null;
      this.state.executionTarget = start.execution_target || null;
      this.pushMessage("assistant", "status", `Experiment started: ${start.experiment_id}`);

      const question = this.extractQuestion(start.pending_questions);
      if (question) {
        this.setPendingQuestion(question);
      } else {
        this.startPolling();
      }
      this.updateInputPlaceholder();
      this.notify();
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Failed to start workflow");
      this.updateInputPlaceholder();
      this.notify();
    }
  }

  async submitCustomClarification(value: string): Promise<void> {
    if (!this.state.pendingQuestion) {
      return;
    }
    await this.submitClarification(this.state.pendingQuestion, value);
  }

  async acceptQuestion(): Promise<void> {
    if (!this.state.pendingQuestion) {
      return;
    }
    const value = this.suggestedAnswer(this.state.pendingQuestion);
    await this.submitClarification(this.state.pendingQuestion, value);
  }

  async denyQuestionEdit(value: string): Promise<void> {
    if (!this.state.pendingQuestion) {
      return;
    }
    await this.submitClarification(this.state.pendingQuestion, value);
  }

  async acceptConfirm(): Promise<void> {
    if (!this.state.pendingAction || !this.state.experimentId) {
      return;
    }
    const executionResult = await this.executePendingAction(this.state.pendingAction);
    await this.submitConfirmation("confirm", "", "", executionResult);
  }

  async denyConfirm(reason: string, alternativePreference: string): Promise<void> {
    await this.submitConfirmation("deny", reason, alternativePreference);
  }

  private async submitClarification(question: ClarificationQuestion, value: unknown): Promise<void> {
    if (!this.state.experimentId) {
      return;
    }
    const cleaned = typeof value === "string" ? value.trim() : value;
    if (cleaned === "") {
      this.pushMessage("system", "error", "Answer cannot be empty.");
      this.notify();
      return;
    }

    try {
      this.pushMessage("user", "text", `${question.text}\nAnswer: ${String(cleaned)}`);
      const data = await this.api.answerQuestion(this.state.experimentId, question.id, cleaned);
      this.state.status = this.normalizeStatus(data.status);
      this.state.phase = data.phase;
      this.state.researchType = data.research_type === "quantum" ? "quantum" : this.state.researchType;
      this.state.pendingAction = null;

      const nextQuestion = this.extractQuestion(data.pending_questions);
      if (nextQuestion && this.state.status === "waiting_user") {
        this.setPendingQuestion(nextQuestion);
      } else {
        this.state.pendingQuestion = null;
        this.startPolling();
      }
      this.updateInputPlaceholder();
      this.notify();
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Failed to submit answer");
      this.updateInputPlaceholder();
      this.notify();
    }
  }

  private async submitConfirmation(
    decision: "confirm" | "deny",
    reason = "",
    alternativePreference = "",
    executionResult?: Record<string, unknown>
  ): Promise<void> {
    if (!this.state.experimentId || !this.state.pendingAction) {
      return;
    }
    const current = this.state.pendingAction;

    try {
      this.pushMessage("user", "text", `${decision.toUpperCase()}: ${current.action}`);
      if (decision === "confirm" && executionResult) {
        const returncode = Number(executionResult.returncode ?? 1);
        const stderr = String(executionResult.stderr || "").trim();
        if (returncode !== 0) {
          this.pushMessage(
            "system",
            "error",
            `Local action failed before backend confirmation (${current.action}). returncode=${returncode}${stderr ? `\n${stderr.slice(0, 600)}` : ""}`
          );
        } else {
          this.pushMessage("system", "status", `Local action succeeded: ${current.action}`);
        }
      }
      const data = await this.api.submitConfirmation(
        this.state.experimentId,
        current.action_id,
        decision,
        reason,
        alternativePreference,
        executionResult
      );

      this.state.status = this.normalizeStatus(data.status);
      this.state.phase = data.phase;
      this.state.pendingQuestion = null;
      this.state.pendingAction = data.pending_action || null;
      this.lastAnnouncedQuestionId = null;

      if (this.state.pendingAction) {
        const actionId = String(this.state.pendingAction.action_id || "");
        if (actionId && actionId !== this.lastAnnouncedActionId) {
          this.lastAnnouncedActionId = actionId;
          this.pushMessage("assistant", "confirmation", this.describeConfirmation(this.state.pendingAction));
        }
      } else {
        this.lastAnnouncedActionId = null;
        this.startPolling();
      }
      this.updateInputPlaceholder();
      this.notify();
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Failed to confirm action");
      this.updateInputPlaceholder();
      this.notify();
    }
  }

  private startPolling(): void {
    if (!this.state.experimentId || this.pollTimer) {
      return;
    }
    this.state.polling.enabled = true;
    this.pollTimer = setInterval(() => {
      void this.pollTick();
    }, this.options.pollIntervalMs);
    void this.pollTick();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.state.polling.enabled = false;
  }

  private async pollTick(): Promise<void> {
    if (!this.state.experimentId || this.pollBusy) {
      return;
    }
    this.pollBusy = true;
    try {
      const status = await this.api.getStatus(this.state.experimentId);
      this.applyStatus(status);

      if (this.state.status === "waiting_user") {
        if (status.pending_action && status.pending_action.action_id) {
          if (!this.state.pendingAction || this.state.pendingAction.action_id !== status.pending_action.action_id) {
            this.state.pendingAction = status.pending_action;
            this.state.pendingQuestion = null;
            this.lastAnnouncedQuestionId = null;
            const actionId = String(status.pending_action.action_id || "");
            if (actionId && actionId !== this.lastAnnouncedActionId) {
              this.lastAnnouncedActionId = actionId;
              this.pushMessage("assistant", "confirmation", this.describeConfirmation(status.pending_action));
            }
          }
        } else if (!this.state.pendingQuestion) {
          await this.refreshPendingQuestion();
        }
      } else {
        this.lastAnnouncedActionId = null;
      }

      if (this.isTerminal(this.state.status)) {
        this.stopPolling();
        this.state.pendingQuestion = null;
        this.state.pendingAction = null;
        this.pushMessage("assistant", "summary", `Workflow ${this.state.status}.`);
        await this.fetchTerminalArtifacts();
      }

      this.updateInputPlaceholder();
      this.notify();
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Polling failed");
      this.updateInputPlaceholder();
      this.notify();
    } finally {
      this.pollBusy = false;
    }
  }

  private async refreshPendingQuestion(): Promise<void> {
    if (!this.state.experimentId) {
      return;
    }
    try {
      const details = await this.api.getExperiment(this.state.experimentId);
      const question = this.extractQuestion(details.pending_questions);
      if (question) {
        this.setPendingQuestion(question);
      }
    } catch {
      // no-op; status polling will continue
    }
  }

  private async fetchTerminalArtifacts(): Promise<void> {
    if (!this.state.experimentId || this.terminalArtifactsFetched) {
      return;
    }
    this.terminalArtifactsFetched = true;
    try {
      const results = await this.api.getResults(this.state.experimentId);
      this.pushMessage("assistant", "summary", `Results:\n${this.pretty(results)}`);
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Failed to fetch results");
    }

    try {
      const report = await this.api.getReport(this.state.experimentId);
      const content = this.reportToText(report.content);
      if (content.trim()) {
        this.pushMessage("assistant", "summary", `Research Report:\n${content.slice(0, 6000)}`);
      }
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Failed to fetch report");
    }

    if (this.state.status === "failed") {
      await this.fetchFailureDiagnostics();
    }
  }

  private async fetchFailureDiagnostics(): Promise<void> {
    if (!this.state.experimentId) {
      return;
    }
    try {
      const logs = await this.api.getLogs(this.state.experimentId, 150);
      const entries = Array.isArray(logs.logs) ? logs.logs : [];
      const critical = entries
        .filter((entry) => this.isErrorLog(entry))
        .slice(0, 5)
        .map((entry) => this.formatLog(entry))
        .filter((line) => line.length > 0);

      if (critical.length > 0) {
        this.pushMessage("system", "error", `Failure diagnostics:\n${critical.join("\n")}`);
      }
    } catch (error) {
      this.pushMessage("system", "error", error instanceof Error ? error.message : "Failed to fetch failure diagnostics");
    }
  }

  private applyStatus(status: StatusData): void {
    this.state.status = this.normalizeStatus(status.status);
    this.state.phase = status.phase;
    this.state.researchType = status.research_type === "quantum" ? "quantum" : this.state.researchType;
    this.state.executionMode = status.execution_mode || this.state.executionMode;
    this.state.executionTarget = status.execution_target || this.state.executionTarget;
    this.state.progressPct = Number.isFinite(status.progress_pct) ? Number(status.progress_pct) : this.state.progressPct;
  }

  private extractQuestion(raw: unknown): ClarificationQuestion | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const payload = raw as PendingQuestionPayload | ClarificationQuestion;
    const candidate = (payload as PendingQuestionPayload).current_question || (payload as ClarificationQuestion);
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.text !== "string") {
      return null;
    }
    return candidate;
  }

  private setPendingQuestion(question: ClarificationQuestion): void {
    this.state.pendingQuestion = question;
    this.state.pendingAction = null;
    this.state.lastSuggestedAnswer = String(this.suggestedAnswer(question));
    const questionId = String(question.id || "");
    if (questionId && questionId === this.lastAnnouncedQuestionId) {
      return;
    }
    this.lastAnnouncedQuestionId = questionId || this.lastAnnouncedQuestionId;
    const optionsText = Array.isArray(question.options) && question.options.length ? `\nOptions: ${question.options.join(", ")}` : "";
    this.pushMessage(
      "assistant",
      "question",
      `${question.text}${optionsText}\nSuggested answer: ${this.state.lastSuggestedAnswer || "(none)"}`
    );
  }

  private suggestedAnswer(question: ClarificationQuestion): unknown {
    if (question.default !== undefined && question.default !== null) {
      return question.default;
    }
    if (Array.isArray(question.options) && question.options.length > 0) {
      return question.options[0];
    }
    return "";
  }

  private describeConfirmation(action: ConfirmationAction): string {
    const fileCount = Array.isArray(action.file_operations) ? action.file_operations.length : 0;
    const commandCount = this.normalizeCommands(action.commands, action.command).length;
    const reason = action.reason ? `\nReason: ${action.reason}` : "";
    const cwd = action.cwd ? `\nCWD: ${action.cwd}` : "";
    return `Approval required: ${action.action}${reason}${cwd}\nWill run ${fileCount} file ops and ${commandCount} command(s).`;
  }

  private async executePendingAction(action: ConfirmationAction): Promise<Record<string, unknown>> {
    const started = Date.now();
    const cwd = resolve(String(action.cwd || process.cwd()));
    const fileResults: Array<Record<string, unknown>> = [];
    const createdFiles: string[] = [];
    const commandResults: Array<Record<string, unknown>> = [];

    for (const op of Array.isArray(action.file_operations) ? action.file_operations : []) {
      const rawPath = String(op.path || "").trim();
      if (!rawPath) {
        continue;
      }
      const absolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
      if (!this.isWithin(absolute, cwd)) {
        fileResults.push({ path: absolute, success: false, reason: "Path escapes action cwd" });
        continue;
      }
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, String(op.content || ""), "utf-8");
      fileResults.push({ path: absolute, success: true, mode: op.mode || "write" });
      createdFiles.push(absolute);
    }

    for (const command of this.normalizeCommands(action.commands, action.command)) {
      const commandSequence = this.expandCommandFallbacks(command, action.action, cwd);
      let finalResult: Record<string, unknown> | null = null;
      for (const variant of commandSequence) {
        const result = await this.runCommand(variant, cwd, Number(action.timeout_seconds || 0));
        finalResult = result;
        if (Number(result.returncode) === 0) {
          break;
        }
      }
      if (finalResult) {
        commandResults.push(finalResult);
      }
      if (!finalResult || Number(finalResult.returncode) !== 0) {
        break;
      }
    }

    const failedFile = fileResults.some((row) => row.success === false);
    const failedCommand = commandResults.some((row) => Number(row.returncode) !== 0);
    const returncode = failedFile || failedCommand ? 1 : 0;

    const combinedStdout = commandResults
      .map((row) => String(row.stdout || ""))
      .filter(Boolean)
      .join("\n")
      .slice(-10000);

    const combinedStderr = commandResults
      .map((row) => String(row.stderr || ""))
      .filter(Boolean)
      .join("\n")
      .slice(-10000);

    return {
      returncode,
      stdout: combinedStdout,
      stderr: combinedStderr,
      duration_sec: Number(((Date.now() - started) / 1000).toFixed(3)),
      command: this.commandSummary(commandResults),
      cwd,
      created_files: createdFiles,
      metadata: {
        action: action.action,
        action_id: action.action_id,
        file_results: fileResults,
        command_results: commandResults
      }
    };
  }

  private normalizeCommands(commands: ConfirmationAction["commands"], command?: ConfirmationAction["command"]): string[][] {
    if ((!commands || (Array.isArray(commands) && commands.length === 0)) && command) {
      if (Array.isArray(command)) {
        const single = command.map((part) => String(part)).filter((part) => part.trim().length > 0);
        return single.length ? [single] : [];
      }
      if (typeof command === "string" && command.trim()) {
        return [[command.trim()]];
      }
    }

    if (!commands || !Array.isArray(commands) || commands.length === 0) {
      return [];
    }

    const first = commands[0] as unknown;
    if (Array.isArray(first)) {
      return (commands as unknown[])
        .map((entry) => (Array.isArray(entry) ? entry.map((part) => String(part)) : []))
        .filter((entry) => entry.length > 0);
    }

    return [(commands as unknown[]).map((part) => String(part)).filter((part) => part.trim().length > 0)];
  }

  private runCommand(command: string[], cwd: string, timeoutSeconds: number): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise) => {
      const started = Date.now();
      const cmd = command[0] || "";
      const args = command.slice(1);

      if (!cmd) {
        resolvePromise({ command: "", returncode: 1, stdout: "", stderr: "Empty command", duration_sec: 0 });
        return;
      }

      const child = spawn(cmd, args, { cwd, shell: false, env: process.env });
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk) => {
        stdout = (stdout + String(chunk)).slice(-12000);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-12000);
      });

      let timer: NodeJS.Timeout | null = null;
      if (timeoutSeconds > 0) {
        timer = setTimeout(() => {
          child.kill("SIGTERM");
        }, timeoutSeconds * 1000);
      }

      child.on("close", (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolvePromise({
          command: [cmd, ...args].join(" "),
          returncode: code ?? 1,
          stdout,
          stderr,
          duration_sec: Number(((Date.now() - started) / 1000).toFixed(3))
        });
      });

      child.on("error", (error) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolvePromise({
          command: [cmd, ...args].join(" "),
          returncode: 1,
          stdout,
          stderr: error.message,
          duration_sec: Number(((Date.now() - started) / 1000).toFixed(3))
        });
      });
    });
  }

  private expandCommandFallbacks(command: string[], actionName: string, cwd: string): string[][] {
    if (!command.length) {
      return [command];
    }
    const primary = [command];
    const supportsPythonFallback = actionName === "prepare_venv" || actionName === "install_package" || actionName === "run_local_commands";
    if (!supportsPythonFallback) {
      return primary;
    }
    const exe = String(command[0] || "").trim().toLowerCase();
    if (exe !== "python" && exe !== "python3" && exe !== "python3.11") {
      return primary;
    }
    const args = command.slice(1);
    const seen = new Set<string>();
    const variants: string[][] = [];
    for (const py of this.pythonCandidates(cwd, command[0])) {
      const key = py.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      variants.push([py, ...args]);
    }
    return variants.length > 0 ? variants : primary;
  }

  private pythonCandidates(cwd: string, original: string): string[] {
    const list: string[] = [];
    const venvUnix = resolve(cwd, ".venv/bin/python");
    const venvMac = resolve(cwd, ".venv/bin/python3");
    const venvWin = resolve(cwd, ".venv/Scripts/python.exe");

    if (existsSync(venvUnix)) {
      list.push(venvUnix);
    }
    if (existsSync(venvMac)) {
      list.push(venvMac);
    }
    if (existsSync(venvWin)) {
      list.push(venvWin);
    }

    list.push(String(original || "python"));
    list.push("python3");
    list.push("python3.11");
    list.push("/usr/bin/python3");
    return list;
  }

  private isWithin(path: string, cwd: string): boolean {
    const normalizedPath = resolve(path);
    const normalizedCwd = resolve(cwd);
    return normalizedPath === normalizedCwd || normalizedPath.startsWith(`${normalizedCwd}/`);
  }

  private commandSummary(commandResults: Array<Record<string, unknown>>): string[] {
    return commandResults.map((row) => String(row.command || "")).filter(Boolean);
  }

  private reportToText(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }
    if (content && typeof content === "object" && typeof (content as { markdown?: unknown }).markdown === "string") {
      return String((content as { markdown?: unknown }).markdown);
    }
    return "";
  }

  private isErrorLog(entry: ExperimentLogEntry): boolean {
    const level = String(entry.level || "").toLowerCase();
    if (level === "error") {
      return true;
    }
    const message = String(entry.message || "").toLowerCase();
    return message.includes("failed") || message.includes("error");
  }

  private formatLog(entry: ExperimentLogEntry): string {
    const phase = String(entry.phase || "unknown");
    const level = String(entry.level || "info").toUpperCase();
    const message = String(entry.message || "").trim();
    if (!message) {
      return "";
    }
    const details = entry.details && typeof entry.details === "object" ? this.pretty(entry.details) : "";
    const shortDetails = details ? ` | details: ${details.slice(0, 300)}` : "";
    return `[${phase}/${level}] ${message}${shortDetails}`;
  }

  private pretty(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value ?? "");
    }
  }

  private updateInputPlaceholder(): void {
    if (this.state.pendingQuestion) {
      this.state.inputPlaceholder = "Type custom answer, then click 'Deny / Send Custom Answer'";
      return;
    }
    if (this.state.pendingAction) {
      this.state.inputPlaceholder = "Optional deny reason for current approval step";
      return;
    }
    if (this.state.experimentId && !this.isTerminal(this.state.status)) {
      this.state.inputPlaceholder = "Workflow is running...";
      return;
    }
    this.state.inputPlaceholder = "Describe what you want to research...";
  }

  private pushMessage(role: ChatMessage["role"], kind: ChatMessage["kind"], content: string, meta?: Record<string, unknown>): void {
    const last = this.state.messages[this.state.messages.length - 1];
    if (last && last.role === role && last.kind === kind && last.content === content) {
      return;
    }
    this.messageCounter += 1;
    this.state.messages.push({
      id: `m_${Date.now()}_${this.messageCounter}`,
      role,
      kind,
      content,
      meta,
      createdAt: Date.now()
    });
  }

  private normalizeStatus(status: string): ExperimentLifecycleStatus {
    if (status === "pending" || status === "waiting_user" || status === "running" || status === "success" || status === "failed" || status === "aborted") {
      return status;
    }
    return "idle";
  }

  private isTerminal(status: ExperimentLifecycleStatus): boolean {
    return status === "success" || status === "failed" || status === "aborted";
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
