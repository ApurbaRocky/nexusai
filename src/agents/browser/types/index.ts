/**
 * Phase 8 — Browser Agent domain types.
 * Pure data types for browser automation, security, and orchestration integration.
 */

export type BrowserSessionStatus =
  | "created"
  | "launching"
  | "ready"
  | "running"
  | "waiting"
  | "waiting_approval"
  | "waiting_user"
  | "paused"
  | "verifying"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type BrowserActionType =
  | "NAVIGATE"
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "SCROLL"
  | "WAIT"
  | "OPEN_TAB"
  | "SWITCH_TAB"
  | "CLOSE_TAB"
  | "SCREENSHOT"
  | "EXTRACT"
  | "DOWNLOAD"
  | "UPLOAD"
  | "SUBMIT_FORM"
  | "AUTHENTICATE"
  | "PAYMENT"
  | "PURCHASE"
  | "SEND_MESSAGE"
  | "DELETE"
  | "PUBLISH"
  | "CHANGE_SETTING"
  | "READ"
  | "INSPECT";

export type BrowserRiskLevel =
  | "SAFE"
  | "LOW_RISK"
  | "MEDIUM_RISK"
  | "HIGH_RISK"
  | "CRITICAL"
  | "BLOCKED";

export type BrowserActionStatus =
  | "pending"
  | "planning"
  | "ready"
  | "running"
  | "waiting_approval"
  | "waiting_verification"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying";

export type BrowserAutonomyLevel = 0 | 1 | 2 | 3;

export type ElementLocatorStrategy =
  | "accessibility_role"
  | "accessible_name"
  | "label"
  | "text"
  | "dom_reference"
  | "stable_attribute"
  | "css_selector"
  | "xpath"
  | "visual_location";

export type PageElementRole =
  | "button"
  | "link"
  | "textbox"
  | "checkbox"
  | "radio"
  | "combobox"
  | "listbox"
  | "option"
  | "tab"
  | "tabpanel"
  | "dialog"
  | "alert"
  | "heading"
  | "paragraph"
  | "table"
  | "row"
  | "cell"
  | "grid"
  | "menu"
  | "menuitem"
  | "navigation"
  | "form"
  | "search"
  | "img"
  | "banner"
  | "contentinfo"
  | "complementary"
  | "main"
  | "region"
  | "separator"
  | "status"
  | "timer"
  | "progressbar"
  | "slider"
  | "spinbutton"
  | "switch"
  | "tree"
  | "treeitem"
  | "unknown";

export type WaitConditionType =
  | "url_contains"
  | "url_matches"
  | "element_visible"
  | "element_hidden"
  | "element_enabled"
  | "element_disabled"
  | "text_appears"
  | "text_disappears"
  | "network_idle"
  | "dom_ready"
  | "custom";

export type FormFieldClassification =
  | "PUBLIC"
  | "NON_SENSITIVE"
  | "PERSONAL"
  | "SENSITIVE"
  | "FINANCIAL"
  | "AUTHENTICATION";

export type PromptInjectionRisk = "none" | "low" | "medium" | "high" | "critical";

export type BrowserArtifactType =
  | "screenshot"
  | "extracted_text"
  | "webpage_snapshot"
  | "downloaded_file"
  | "structured_data"
  | "evidence"
  | "url"
  | "action_log"
  | "dom_snapshot";

export type TabStatus = "active" | "background" | "loading" | "crashed";

export interface BrowserTarget {
  strategy: ElementLocatorStrategy;
  value: string;
  description: string;
  frameId?: string;
  fallbackStrategies?: ElementLocatorStrategy[];
}

export interface BrowserAction {
  actionId: string;
  type: BrowserActionType;
  target?: BrowserTarget;
  parameters: Record<string, unknown>;
  riskLevel: BrowserRiskLevel;
  requiresApproval: boolean;
  expectedOutcome: string;
  verificationStrategy: VerificationStrategy;
  timeoutMs?: number;
  maxRetries?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: BrowserActionStatus;
  result?: ActionResult;
  error?: string;
  retryCount: number;
}

export interface VerificationStrategy {
  type: "visual" | "dom" | "network" | "text" | "url" | "custom";
  expected: Record<string, unknown>;
  tolerance?: number;
}

export interface ActionResult {
  success: boolean;
  output?: unknown;
  screenshot?: BrowserScreenshot;
  extractedData?: unknown;
  newUrl?: string;
  newPageState?: PageState;
  error?: string;
  durationMs: number;
}

export interface PageState {
  url: string;
  title: string;
  readyState: "loading" | "interactive" | "complete";
  domSnapshot: SerializedDOM;
  screenshot?: BrowserScreenshot;
  timestamp: Date;
  frameTree: FrameInfo[];
}

export interface SerializedDOM {
  elements: SerializedElement[];
  html: string;
  textContent: string;
}

export interface SerializedElement {
  ref: string;
  tagName: string;
  role: PageElementRole;
  name?: string;
  label?: string;
  text?: string;
  visible: boolean;
  enabled: boolean;
  attributes: Record<string, string>;
  boundingBox?: BoundingBox;
  selector?: string;
  children?: SerializedElement[];
  isInteractive: boolean;
  isEditable: boolean;
  formFieldType?: FormFieldClassification;
  securityFlags?: string[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameInfo {
  frameId: string;
  parentFrameId?: string;
  url: string;
  name?: string;
  title?: string;
}

export interface BrowserScreenshot {
  id: string;
  sessionId: string;
  actionId?: string;
  tabId: string;
  url: string;
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  devicePixelRatio: number;
  fullPage: boolean;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface BrowserTab {
  tabId: string;
  sessionId: string;
  url: string;
  title: string;
  status: TabStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  favicon?: string;
  screenshot?: BrowserScreenshot;
}

export interface BrowserSession {
  sessionId: string;
  taskId: string;
  userId: string;
  browserInstanceId: string;
  status: BrowserSessionStatus;
  currentUrl: string;
  currentTabId?: string;
  tabs: BrowserTab[];
  cookiesMetadata: CookieMetadata[];
  sessionState: Record<string, unknown>;
  permissions: BrowserPermissions;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface CookieMetadata {
  domain: string;
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "lax" | "strict" | "none";
  expires?: Date;
}

export interface BrowserPermissions {
  allowedDomains: string[];
  blockedDomains: string[];
  mode: "global" | "task_scoped" | "strict";
  canDownload: boolean;
  canUpload: boolean;
  canNavigateCrossDomain: boolean;
  maxTabs: number;
  maxActions: number;
  maxScreenshots: number;
  autonomyLevel: BrowserAutonomyLevel;
}

export interface WaitCondition {
  type: WaitConditionType;
  target?: string;
  value?: string;
  timeoutMs: number;
  selector?: string;
}

export interface BrowserController {
  launch(config: BrowserLaunchConfig): Promise<BrowserSession>;
  navigate(sessionId: string, url: string): Promise<void>;
  goBack(sessionId: string): Promise<void>;
  goForward(sessionId: string): Promise<void>;
  reload(sessionId: string): Promise<void>;
  getPageState(sessionId: string): Promise<PageState>;
  click(sessionId: string, target: BrowserTarget): Promise<ActionResult>;
  type(sessionId: string, target: BrowserTarget, text: string): Promise<ActionResult>;
  select(sessionId: string, target: BrowserTarget, value: string): Promise<ActionResult>;
  scroll(sessionId: string, direction: ScrollDirection, amount?: number): Promise<ActionResult>;
  screenshot(sessionId: string, options?: ScreenshotOptions): Promise<BrowserScreenshot>;
  openTab(sessionId: string, url?: string): Promise<BrowserTab>;
  switchTab(sessionId: string, tabId: string): Promise<void>;
  closeTab(sessionId: string, tabId: string): Promise<void>;
  waitFor(sessionId: string, condition: WaitCondition): Promise<void>;
  extract(sessionId: string, selector: string, attribute?: string): Promise<unknown>;
  download(sessionId: string, url: string, options?: DownloadOptions): Promise<DownloadResult>;
  upload(sessionId: string, target: BrowserTarget, filePath: string): Promise<ActionResult>;
  submitForm(sessionId: string, formSelector: string, data: Record<string, string>): Promise<ActionResult>;
  close(sessionId: string): Promise<void>;
  getTabs(sessionId: string): Promise<BrowserTab[]>;
  getActiveTab(sessionId: string): Promise<BrowserTab | null>;
}

export interface BrowserLaunchConfig {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  proxy?: { server: string; username?: string; password?: string };
  downloadsPath?: string;
  extraArgs?: string[];
  sessionId: string;
  taskId: string;
  userId: string;
  permissions?: BrowserPermissions;
}

export interface ScrollDirection {
  direction: "up" | "down" | "left" | "right";
  amount?: number;
  unit?: "px" | "pages" | "viewport";
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  quality?: number;
  type?: "png" | "jpeg";
  clip?: BoundingBox;
}

export interface DownloadOptions {
  filename?: string;
  saveAs?: string;
  overwrite?: boolean;
}

export interface DownloadResult {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface BrowserArtifact {
  artifactId: string;
  taskId: string;
  sessionId: string;
  sourceUrl: string;
  artifactType: BrowserArtifactType;
  title: string;
  summary: string;
  contentReference: string;
  metadata: Record<string, unknown>;
  provenance: ArtifactProvenance;
  createdAt: Date;
}

export interface ArtifactProvenance {
  taskId: string;
  agents: string[];
  sources: string[];
  version: string;
  createdAt: Date;
}

export interface BrowserPlan {
  planId: string;
  taskId: string;
  goal: string;
  steps: BrowserAction[];
  estimatedSteps: number;
  riskLevel: BrowserRiskLevel;
  requiresApproval: boolean;
  allowedDomains: string[];
  budget: BrowserBudget;
  createdAt: Date;
}

export interface BrowserBudget {
  maxActions: number;
  maxTabs: number;
  maxScreenshots: number;
  maxModelCalls: number;
  maxExecutionTimeMs: number;
  maxDownloads: number;
  maxCostUsd?: number;
}

export interface BrowserEvent {
  eventId: string;
  sessionId: string;
  taskId?: string;
  type: BrowserEventType;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export type BrowserEventType =
  | "SESSION_CREATED"
  | "SESSION_LAUNCHING"
  | "SESSION_READY"
  | "NAVIGATED"
  | "PAGE_ANALYZED"
  | "ACTION_STARTED"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED"
  | "APPROVAL_REQUIRED"
  | "WAITING_FOR_USER"
  | "SCREENSHOT_CREATED"
  | "ARTIFACT_CREATED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCELLED"
  | "ERROR_RECOVERY"
  | "PROMPT_INJECTION_DETECTED"
  | "CREDENTIAL_PROTECTED"
  | "SSRF_BLOCKED"
  | "DOWNLOAD_BLOCKED"
  | "UPLOAD_BLOCKED"
  | "CAPTCHA_DETECTED"
  | "LOOP_DETECTED"
  | "BUDGET_EXCEEDED";

export interface BrowserApproval {
  approvalId: string;
  taskId: string;
  sessionId: string;
  actionId: string;
  category: BrowserRiskLevel;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  requestedBy: string;
  actionDescription: string;
  targetUrl: string;
  dataInvolved: Record<string, unknown>;
  riskLevel: BrowserRiskLevel;
  expectedResult: string;
  possibleConsequences: string[];
  askedAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  meta?: Record<string, unknown>;
}

export interface BrowserMemory {
  memoryId: string;
  sessionId: string;
  taskId: string;
  kind: "visited_url" | "successful_selector" | "failed_selector" | "page_state" | "finding" | "user_decision" | "approved_domain" | "artifact";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface BrowserPolicyDecision {
  allowed: boolean;
  riskLevel: BrowserRiskLevel;
  requiresApproval: boolean;
  reason: string;
  restrictions?: string[];
  blockedReasons?: string[];
}

export interface BrowserContext {
  sessionId: string;
  taskId: string;
  userId: string;
  currentUrl: string;
  currentTabId: string;
  allowedDomains: string[];
  blockedDomains: string[];
  autonomyLevel: BrowserAutonomyLevel;
  permissions: BrowserPermissions;
  memory: BrowserMemory[];
  artifacts: BrowserArtifact[];
}

export interface BrowserToolResult {
  success: boolean;
  content: string;
  data?: unknown;
  artifacts?: BrowserArtifact[];
  approvalRequired?: BrowserApproval;
  waitingForUser?: boolean;
  error?: string;
}

export interface BrowserAgentCapabilities {
  webNavigation: boolean;
  webExtraction: boolean;
  visualUnderstanding: boolean;
  formInteraction: boolean;
  browserAutomation: boolean;
  downloadHandling: boolean;
  uploadHandling: boolean;
  multiTab: boolean;
  sessionIsolation: boolean;
}

export interface BrowserProviderConfig {
  name: string;
  type: "playwright" | "puppeteer" | "cdp" | "custom";
  executablePath?: string;
  defaultViewport?: { width: number; height: number };
  defaultTimeout?: number;
  headless?: boolean;
  args?: string[];
  env?: Record<string, string>;
}