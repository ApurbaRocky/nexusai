/**
 * Phase 8 — Browser Controller using Playwright.
 * Provider-independent abstraction for browser automation.
 */

import {
  Browser,
  BrowserContext,
  Page,
  Locator,
  PageScreenshotOptions as PlaywrightScreenshotOptions,
} from "playwright";
import {
  BrowserController,
  BrowserLaunchConfig,
  BrowserSession,
  BrowserTab,
  PageState,
  BrowserTarget,
  ActionResult,
  BrowserScreenshot,
  ScrollDirection,
  ScreenshotOptions,
  WaitCondition,
  DownloadOptions,
  DownloadResult,
  BrowserPermissions,
  SerializedDOM,
  SerializedElement,
  FrameInfo,
  ElementLocatorStrategy,
  PageElementRole,
} from "@/agents/browser/types";

class BrowserControllerError extends Error {
  constructor(message: string, public code: string, public sessionId?: string) {
    super(message);
    this.name = "BrowserControllerError";
  }
}

interface SessionData {
  browser: Browser;
  context: BrowserContext;
  session: BrowserSession;
  pages: Map<string, Page>;
}

const sessions = new Map<string, SessionData>();

const defaultBrowserPermissions: BrowserPermissions = {
  allowedDomains: [],
  blockedDomains: [],
  mode: "strict",
  canDownload: false,
  canUpload: false,
  canNavigateCrossDomain: false,
  maxTabs: 10,
  maxActions: 100,
  maxScreenshots: 20,
  autonomyLevel: 0,
};

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getSession(sessionId: string): SessionData {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new BrowserControllerError(`Session ${sessionId} not found`, "SESSION_NOT_FOUND", sessionId);
  }
  return session;
}

function getPage(sessionId: string, tabId?: string): Page {
  const session = getSession(sessionId);
  const targetTabId = tabId ?? session.session.currentTabId;
  if (!targetTabId) {
    throw new BrowserControllerError("No active tab", "NO_ACTIVE_TAB", sessionId);
  }
  const page = session.pages.get(targetTabId);
  if (!page) {
    throw new BrowserControllerError(`Tab ${targetTabId} not found`, "TAB_NOT_FOUND", sessionId);
  }
  return page;
}

async function createTab(sessionData: SessionData, url?: string): Promise<BrowserTab> {
  const page = await sessionData.context.newPage();
  const tabId = generateId("tab");
  
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  const tab: BrowserTab = {
    tabId,
    sessionId: sessionData.session.sessionId,
    url: page.url(),
    title: await page.title(),
    status: "active",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  sessionData.pages.set(tabId, page);
  sessionData.session.tabs.push(tab);
  sessionData.session.currentTabId = tabId;

  // Update other tabs to inactive
  for (const t of sessionData.session.tabs) {
    if (t.tabId !== tabId) t.isActive = false;
  }

  return tab;
}

async function serializeDOM(page: Page): Promise<SerializedDOM> {
  const html = await page.content();
  const textContent = await page.evaluate(() => document.body?.innerText ?? "");

  const elements = await page.evaluate(() => {
    const results: SerializedElement[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    let node: Node | null = walker.nextNode();
    let index = 0;
    while (node) {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = rect.width > 0 && rect.height > 0 && 
        style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
      const isEnabled = !el.hasAttribute("disabled") && !el.hasAttribute("readonly");

      // Determine role
      const role = (el.getAttribute("role") || 
        (el.tagName.toLowerCase() === "a" && el.hasAttribute("href") ? "link" :
         el.tagName.toLowerCase() === "button" ? "button" :
         el.tagName.toLowerCase() === "input" ? "textbox" :
         el.tagName.toLowerCase() === "select" ? "combobox" :
         el.tagName.toLowerCase() === "textarea" ? "textbox" :
         el.tagName.toLowerCase() === "h1" || el.tagName.toLowerCase() === "h2" || 
         el.tagName.toLowerCase() === "h3" || el.tagName.toLowerCase() === "h4" ||
         el.tagName.toLowerCase() === "h5" || el.tagName.toLowerCase() === "h6" ? "heading" :
         el.tagName.toLowerCase() === "p" ? "paragraph" :
         el.tagName.toLowerCase() === "img" ? "img" :
         el.tagName.toLowerCase() === "form" ? "form" :
         el.tagName.toLowerCase() === "nav" ? "navigation" :
         el.tagName.toLowerCase() === "table" ? "table" :
         el.tagName.toLowerCase() === "tr" ? "row" :
         el.tagName.toLowerCase() === "td" || el.tagName.toLowerCase() === "th" ? "cell" :
         el.tagName.toLowerCase() === "ul" || el.tagName.toLowerCase() === "ol" ? "list" :
         el.tagName.toLowerCase() === "li" ? "listitem" :
         "unknown")) as PageElementRole;

      const attributes: Record<string, string> = {};
      for (const attr of el.attributes) {
        if (!["style", "class", "data-*"].includes(attr.name)) {
          attributes[attr.name] = attr.value;
        }
      }

      const ref = `element_${index++}`;
      
      results.push({
        ref,
        tagName: el.tagName.toLowerCase(),
        role,
        name: el.getAttribute("aria-label") || el.getAttribute("name") || undefined,
        label: el.getAttribute("aria-labelledby") ? 
          document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent || undefined :
          el.querySelector("label[for]")?.textContent || undefined,
        text: el.innerText?.slice(0, 500),
        visible: isVisible,
        enabled: isEnabled,
        attributes,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        selector: undefined,
        children: [],
        isInteractive: ["button", "link", "textbox", "checkbox", "radio", "combobox", "tab", "menuitem"].includes(role),
        isEditable: el.isContentEditable || ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
        formFieldType: undefined,
        securityFlags: [],
      });

      node = walker.nextNode();
    }
    return results;
  });

  return { elements, html, textContent };
}

async function getFrameTree(page: Page): Promise<FrameInfo[]> {
  const frames: FrameInfo[] = [];
  for (const frame of page.frames()) {
    const parentFrame = frame.parentFrame();
    frames.push({
      frameId: frame.url() || frame.name() || "main",
      parentFrameId: parentFrame?.url(),
      url: frame.url(),
      name: frame.name() || undefined,
      title: undefined, // Could get frame title if needed
    });
  }
  return frames;
}

async function resolveElement(page: Page, target: BrowserTarget): Promise<Locator> {
  // Try strategies in order of preference
  const strategies: ElementLocatorStrategy[] = [
    target.strategy,
    ...(target.fallbackStrategies ?? []),
  ];

  for (const strategy of strategies) {
    try {
      let locator: Locator;
      switch (strategy) {
        case "accessibility_role":
          locator = page.getByRole(target.value as Parameters<Page["getByRole"]>[0], { name: target.value });
          break;
        case "accessible_name":
          locator = page.getByLabel(target.value);
          break;
        case "label":
          locator = page.getByLabel(target.value);
          break;
        case "text":
          locator = page.getByText(target.value, { exact: false });
          break;
        case "dom_reference":
          locator = page.locator(target.value);
          break;
        case "stable_attribute":
          locator = page.locator(`[data-testid="${target.value}"], [data-cy="${target.value}"], [id="${target.value}"]`);
          break;
        case "css_selector":
          locator = page.locator(target.value);
          break;
        case "xpath":
          locator = page.locator(`xpath=${target.value}`);
          break;
        case "visual_location":
          // Visual location requires screenshot analysis - fallback to CSS
          locator = page.locator(target.value);
          break;
        default:
          locator = page.locator(target.value);
      }

      // Check if element exists and is visible
      const count = await locator.count();
      if (count > 0) {
        // Return first visible element
        for (let i = 0; i < count; i++) {
          const el = locator.nth(i);
          if (await el.isVisible().catch(() => false)) {
            return el;
          }
        }
        // Return first if none visible
        return locator.first();
      }
    } catch {
      // Try next strategy
    }
  }

  throw new BrowserControllerError(
    `Could not locate element: ${target.description}`,
    "ELEMENT_NOT_FOUND",
    target.value
  );
}

export class PlaywrightController implements BrowserController {
  async launch(config: BrowserLaunchConfig): Promise<BrowserSession> {
    const { chromium } = await import("playwright");
    
    const browser = await chromium.launch({
      headless: config.headless ?? true,
      args: config.extraArgs ?? [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
      proxy: config.proxy ? { server: config.proxy.server } : undefined,
    });

    const context = await browser.newContext({
      viewport: config.viewport ?? { width: 1280, height: 720 },
      userAgent: config.userAgent,
      locale: config.locale,
      timezoneId: config.timezoneId,
      acceptDownloads: true,
      recordVideo: { dir: config.downloadsPath ?? "./browser-downloads" },
    });

    // Block dangerous resources
    await context.route("**/*", (route) => {
      const url = route.request().url();
      try {
        const parsed = new URL(url);
        // Block private IPs, localhost, etc.
        if (this.isBlockedUrl(parsed)) {
          return route.abort("blockedbyclient");
        }
      } catch {
        // Invalid URL, allow
      }
      route.continue();
    });

    const sessionId = config.sessionId;
    const permissions = config.permissions ?? defaultBrowserPermissions;
    const session: BrowserSession = {
      sessionId,
      taskId: config.taskId,
      userId: config.userId,
      browserInstanceId: generateId("browser"),
      status: "launching",
      currentUrl: "about:blank",
      currentTabId: undefined,
      tabs: [],
      cookiesMetadata: [],
      sessionState: {},
      permissions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const sessionData: SessionData = {
      browser,
      context,
      session,
      pages: new Map(),
    };

    sessions.set(sessionId, sessionData);

    // Create initial tab
    const tab = await createTab(sessionData);
    session.currentUrl = tab.url;
    session.status = "ready";

    return session;
  }

  private isBlockedUrl(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();
    const blockedHosts = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "metadata.google.internal",
      "169.254.169.254",
      "metadata.azure.com",
      "metadata.threatstack.com",
    ];
    
    if (blockedHosts.includes(hostname)) return true;

    // Check private IP ranges
    const ip = url.hostname;
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^169\.254\./,
      /^::1$/,
      /^fe80::/,
      /^fc00:/,
    ];
    
    if (privateRanges.some((r) => r.test(ip))) return true;

    // Block dangerous protocols
    if (!["http:", "https:"].includes(url.protocol)) return true;

    // Block dangerous ports
    const port = parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80);
    const blockedPorts = [22, 23, 25, 53, 110, 143, 465, 587, 993, 995, 3306, 5432, 6379, 8086, 9200, 27017];
    if (blockedPorts.includes(port)) return true;

    return false;
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    const session = getSession(sessionId);
    const page = getPage(sessionId);
    
    // Validate URL
    try {
      const parsed = new URL(url);
      if (this.isBlockedUrl(parsed)) {
        throw new BrowserControllerError(`Navigation to ${url} is blocked`, "NAVIGATION_BLOCKED", sessionId);
      }
    } catch {
      throw new BrowserControllerError(`Invalid URL: ${url}`, "INVALID_URL", sessionId);
    }

    session.session.status = "running";
    session.session.currentUrl = url;
    
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      session.session.currentUrl = page.url();
      session.session.currentTabId = page.url(); // Update tab URL
      session.session.updatedAt = new Date();
    } catch (err) {
      session.session.status = "failed";
      session.session.error = err instanceof Error ? err.message : String(err);
      throw new BrowserControllerError(`Navigation failed: ${err}`, "NAVIGATION_FAILED", sessionId);
    }
  }

  async goBack(sessionId: string): Promise<void> {
    const page = getPage(sessionId);
    await page.goBack({ waitUntil: "domcontentloaded" });
    const session = getSession(sessionId);
    session.session.currentUrl = page.url();
    session.session.updatedAt = new Date();
  }

  async goForward(sessionId: string): Promise<void> {
    const page = getPage(sessionId);
    await page.goForward({ waitUntil: "domcontentloaded" });
    const session = getSession(sessionId);
    session.session.currentUrl = page.url();
    session.session.updatedAt = new Date();
  }

  async reload(sessionId: string): Promise<void> {
    const page = getPage(sessionId);
    await page.reload({ waitUntil: "domcontentloaded" });
    const session = getSession(sessionId);
    session.session.currentUrl = page.url();
    session.session.updatedAt = new Date();
  }

  async getPageState(sessionId: string): Promise<PageState> {
    const session = getSession(sessionId);
    const page = getPage(sessionId);

    const [domSnapshot, frameTree] = await Promise.all([
      serializeDOM(page),
      getFrameTree(page),
    ]);

    const screenshot = await this.screenshot(sessionId, { fullPage: false });

    const state: PageState = {
      url: page.url(),
      title: await page.title(),
      readyState: await page.evaluate(() => document.readyState),
      domSnapshot,
      screenshot,
      timestamp: new Date(),
      frameTree,
    };

    session.session.currentUrl = page.url();
    session.session.updatedAt = new Date();

    return state;
  }

  async click(sessionId: string, target: BrowserTarget): Promise<ActionResult> {
    const started = Date.now();
    const page = getPage(sessionId);
    const session = getSession(sessionId);
    
    session.session.status = "running";

    try {
      const locator = await resolveElement(page, target);
      await locator.click({ timeout: 10000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

      const newUrl = page.url();
      const newState = await this.getPageState(sessionId);

      return {
        success: true,
        newUrl,
        newPageState: newState,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  async type(sessionId: string, target: BrowserTarget, text: string): Promise<ActionResult> {
    const started = Date.now();
    const page = getPage(sessionId);
    const session = getSession(sessionId);
    
    session.session.status = "running";

    try {
      const locator = await resolveElement(page, target);
      await locator.fill(text, { timeout: 10000 });

      return {
        success: true,
        output: { text, target: target.description },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  async select(sessionId: string, target: BrowserTarget, value: string): Promise<ActionResult> {
    const started = Date.now();
    const page = getPage(sessionId);
    const session = getSession(sessionId);
    
    session.session.status = "running";

    try {
      const locator = await resolveElement(page, target);
      await locator.selectOption(value, { timeout: 10000 });

      return {
        success: true,
        output: { value, target: target.description },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  async scroll(sessionId: string, direction: ScrollDirection, amount?: number): Promise<ActionResult> {
    const started = Date.now();
    const page = getPage(sessionId);
    const session = getSession(sessionId);
    
    session.session.status = "running";

    try {
      const delta = amount ?? (direction.unit === "pages" ? 800 : direction.unit === "viewport" ? 600 : 300);
      const x = direction.direction === "left" ? -delta : direction.direction === "right" ? delta : 0;
      const y = direction.direction === "up" ? -delta : direction.direction === "down" ? delta : 0;

      await page.mouse.wheel(x, y);
      await page.waitForTimeout(300);

      return {
        success: true,
        output: { direction: direction.direction, amount: delta },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  async screenshot(sessionId: string, options?: ScreenshotOptions): Promise<BrowserScreenshot> {
    const page = getPage(sessionId);
    const session = getSession(sessionId);

    try {
      const pwOptions: PlaywrightScreenshotOptions = {
        fullPage: options?.fullPage ?? false,
        type: options?.type ?? "png",
        quality: options?.quality,
        clip: options?.clip ? {
          x: options.clip.x,
          y: options.clip.y,
          width: options.clip.width,
          height: options.clip.height,
        } : undefined,
      };

      const buffer = await page.screenshot(pwOptions);
      const base64 = buffer.toString("base64");
      const mimeType = options?.type === "jpeg" ? "image/jpeg" : "image/png";

      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      const dpr = await page.evaluate(() => window.devicePixelRatio);

      const screenshot: BrowserScreenshot = {
        id: generateId("screenshot"),
        sessionId,
        tabId: session.session.currentTabId ?? "",
        url: page.url(),
        data: base64,
        mimeType,
        width: viewport.width,
        height: viewport.height,
        devicePixelRatio: dpr,
        fullPage: options?.fullPage ?? false,
        timestamp: new Date(),
        metadata: { actionId: options?.fullPage ? "full_page" : "viewport" },
      };

      return screenshot;
    } catch (err) {
      throw new BrowserControllerError(`Screenshot failed: ${err}`, "SCREENSHOT_FAILED", sessionId);
    }
  }

  async openTab(sessionId: string, url?: string): Promise<BrowserTab> {
    const sessionData = getSession(sessionId);
    
    if (sessionData.session.tabs.length >= sessionData.session.permissions.maxTabs) {
      throw new BrowserControllerError("Maximum tabs reached", "MAX_TABS_REACHED", sessionId);
    }

    const tab = await createTab(sessionData, url);
    sessionData.session.currentUrl = tab.url;
    sessionData.session.updatedAt = new Date();

    return tab;
  }

  async switchTab(sessionId: string, tabId: string): Promise<void> {
    const sessionData = getSession(sessionId);
    const page = sessionData.pages.get(tabId);
    
    if (!page) {
      throw new BrowserControllerError(`Tab ${tabId} not found`, "TAB_NOT_FOUND", sessionId);
    }

    await page.bringToFront();
    
    for (const tab of sessionData.session.tabs) {
      tab.isActive = tab.tabId === tabId;
      tab.updatedAt = new Date();
    }
    
    sessionData.session.currentTabId = tabId;
    sessionData.session.currentUrl = page.url();
    sessionData.session.updatedAt = new Date();
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const sessionData = getSession(sessionId);
    const page = sessionData.pages.get(tabId);
    
    if (!page) {
      throw new BrowserControllerError(`Tab ${tabId} not found`, "TAB_NOT_FOUND", sessionId);
    }

    await page.close();
    sessionData.pages.delete(tabId);
    
    const tabIndex = sessionData.session.tabs.findIndex((t) => t.tabId === tabId);
    if (tabIndex !== -1) {
      sessionData.session.tabs.splice(tabIndex, 1);
    }

    // If we closed the active tab, switch to another
    if (sessionData.session.currentTabId === tabId) {
      const nextTab = sessionData.session.tabs[0];
      if (nextTab) {
        await this.switchTab(sessionId, nextTab.tabId);
      } else {
        sessionData.session.currentTabId = undefined;
        sessionData.session.currentUrl = "about:blank";
      }
    }

    sessionData.session.updatedAt = new Date();
  }

  async waitFor(sessionId: string, condition: WaitCondition): Promise<void> {
    const page = getPage(sessionId);
    const timeout = condition.timeoutMs ?? 30000;

    switch (condition.type) {
      case "url_contains":
        await page.waitForURL(`**/*${condition.value}*`, { timeout });
        break;
      case "url_matches":
        await page.waitForURL(new RegExp(condition.value!), { timeout });
        break;
      case "element_visible":
        await page.locator(condition.selector!).waitFor({ state: "visible", timeout });
        break;
      case "element_hidden":
        await page.locator(condition.selector!).waitFor({ state: "hidden", timeout });
        break;
      case "element_enabled":
        await page.locator(condition.selector!).waitFor({ state: "attached", timeout });
        await page.waitForFunction(
          (selector) => {
            const element = document.querySelector(selector) as HTMLInputElement | null;
            return element !== null && !element.disabled;
          },
          condition.selector!,
          { timeout },
        );
        break;
      case "element_disabled":
        await page.locator(condition.selector!).waitFor({ state: "attached", timeout });
        await page.waitForFunction(
          (selector) => {
            const element = document.querySelector(selector) as HTMLInputElement | null;
            return element !== null && element.disabled;
          },
          condition.selector!,
          { timeout },
        );
        break;
      case "text_appears":
        await page.getByText(condition.value!).waitFor({ state: "visible", timeout });
        break;
      case "text_disappears":
        await page.getByText(condition.value!).waitFor({ state: "hidden", timeout });
        break;
      case "network_idle":
        await page.waitForLoadState("networkidle", { timeout });
        break;
      case "dom_ready":
        await page.waitForLoadState("domcontentloaded", { timeout });
        break;
      case "custom":
        // Custom condition would need a function - not implemented in this version
        break;
    }
  }

  async extract(sessionId: string, selector: string, attribute?: string): Promise<unknown> {
    const page = getPage(sessionId);
    
    if (attribute) {
      return await page.locator(selector).getAttribute(attribute);
    }
    
    return await page.locator(selector).allTextContents();
  }

  async download(sessionId: string, url: string, options?: DownloadOptions): Promise<DownloadResult> {
    const session = getSession(sessionId);
    const page = getPage(sessionId);
    
    if (!session.session.permissions.canDownload) {
      throw new BrowserControllerError("Downloads not permitted", "DOWNLOAD_NOT_PERMITTED", sessionId);
    }

    // Validate URL
    const parsed = new URL(url);
    if (this.isBlockedUrl(parsed)) {
      throw new BrowserControllerError(`Download from ${url} is blocked`, "DOWNLOAD_BLOCKED", sessionId);
    }

    const downloadPromise = page.waitForEvent("download");
    await page.goto(url);
    const download = await downloadPromise;

    const filename = options?.filename ?? download.suggestedFilename();
    const path = options?.saveAs ?? `${session.session.permissions.mode === "task_scoped" ? "./browser-downloads" : "./downloads"}/${filename}`;

    await download.saveAs(path);

    return {
      path,
      filename,
      mimeType: "application/octet-stream", // Would need to detect from response
      size: 0, // Would need to get from file system
      url,
    };
  }

  async upload(sessionId: string, target: BrowserTarget, filePath: string): Promise<ActionResult> {
    const started = Date.now();
    const page = getPage(sessionId);
    const session = getSession(sessionId);
    
    if (!session.session.permissions.canUpload) {
      return {
        success: false,
        error: "Uploads not permitted",
        durationMs: Date.now() - started,
      };
    }

    session.session.status = "running";

    try {
      const locator = await resolveElement(page, target);
      await locator.setInputFiles(filePath);

      return {
        success: true,
        output: { filePath, target: target.description },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  async submitForm(sessionId: string, formSelector: string, data: Record<string, string>): Promise<ActionResult> {
    const started = Date.now();
    const page = getPage(sessionId);
    const session = getSession(sessionId);
    
    session.session.status = "running";

    try {
      for (const [selector, value] of Object.entries(data)) {
        const locator = page.locator(`${formSelector} ${selector}`);
        const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
        
        if (tagName === "select") {
          await locator.selectOption(value);
        } else if (tagName === "input" || tagName === "textarea") {
          const type = await locator.getAttribute("type");
          if (type === "checkbox" || type === "radio") {
            if (value === "true" || value === "on" || value === "1") {
              await locator.check();
            } else {
              await locator.uncheck();
            }
          } else {
            await locator.fill(value);
          }
        }
      }

      const form = page.locator(formSelector);
      await form.evaluate((f) => (f as HTMLFormElement).submit());
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

      return {
        success: true,
        newUrl: page.url(),
        output: { submitted: true, data },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  async close(sessionId: string): Promise<void> {
    const sessionData = sessions.get(sessionId);
    if (!sessionData) return;

    for (const page of sessionData.pages.values()) {
      await page.close().catch(() => {});
    }
    await sessionData.context.close().catch(() => {});
    await sessionData.browser.close().catch(() => {});
    
    sessions.delete(sessionId);
  }

  async getTabs(sessionId: string): Promise<BrowserTab[]> {
    const session = getSession(sessionId);
    return session.session.tabs;
  }

  async getActiveTab(sessionId: string): Promise<BrowserTab | null> {
    const session = getSession(sessionId);
    if (!session.session.currentTabId) return null;
    return session.session.tabs.find((t) => t.tabId === session.session.currentTabId) ?? null;
  }
}

export const browserController = new PlaywrightController();

export function getSessionData(sessionId: string): BrowserSession | null {
  return sessions.get(sessionId)?.session ?? null;
}