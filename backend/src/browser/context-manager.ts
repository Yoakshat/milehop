import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { launchChrome } from './chrome-launcher.js';
import { ensureChromeProfile } from './chrome-profile.js';

// Ported from ~/projects/voyage/main/src/main/browser/context-manager.ts,
// simplified for standalone use: voyage tracked a separate tab tree per
// chat (multi-conversation Electron app); this server only needs a single
// shared tab tree for the one real Chrome window it drives, so the
// `ChatId`-keyed map collapses to one module-level registry.

export type TabId = string;

export interface TabInfo {
  tabId: TabId;
  url: string;
  title: string;
}

interface Registry {
  context: BrowserContext;
  tabs: Map<TabId, Page>;
  parents: Map<TabId, TabId>; // tab -> opener tab, for tree/ownership tracking
  nextTabNum: number;
}

let browser: Browser | null = null;
let registry: Registry | null = null;
let connecting: Promise<{ browser: Browser; context: BrowserContext }> | null = null;

function findTabId(reg: Registry, page: Page): TabId | undefined {
  for (const [id, p] of reg.tabs) {
    if (p === page) return id;
  }
  return undefined;
}

/** Registers a page as a tracked tab. This is the single place a page ever
 * enters `tabs` — covers pages we open ourselves (openTab) as well as pages
 * Alaska's site opens on its own (target="_blank", window.open popups),
 * which otherwise would exist in real Chrome but be invisible to us. */
function registerPage(reg: Registry, page: Page): TabId {
  const tabId = `tab-${reg.nextTabNum++}`;
  reg.tabs.set(tabId, page);
  page.on('close', () => {
    reg.tabs.delete(tabId);
    reg.parents.delete(tabId);
  });

  page
    .opener()
    .then((opener) => {
      if (!opener) return;
      const openerId = findTabId(reg, opener);
      if (openerId) reg.parents.set(tabId, openerId);
    })
    .catch(() => {});

  return tabId;
}

/** Connects to a real, visible Chrome.app running against a one-time COPY
 * of the user's real Chrome profile (see chrome-profile.ts) — carries over
 * real cookies/logins without needing to attach CDP to the actual default
 * profile directory, which Chrome 136+ blocks specifically to prevent this
 * exact class of cookie exfiltration. Launches with remote debugging if
 * it isn't already running with CDP enabled.
 *
 * Real Chrome over CDP only exposes a single default BrowserContext (unlike
 * headless Chromium, it doesn't support creating isolated contexts) — per
 * Playwright's connectOverCDP docs, that's `browser.contexts()[0]`.
 *
 * Returns the raw Browser/BrowserContext plus an `openTab` helper for
 * opening new tabs against that shared context.
 */
export async function connectToRealChrome(): Promise<{
  browser: Browser;
  context: BrowserContext;
  openTab: (url?: string) => Promise<{ tabId: TabId; page: Page }>;
  listTabs: () => TabInfo[];
  getTab: (tabId: TabId) => Page | undefined;
  closeTab: (tabId: TabId) => Promise<void>;
}> {
  if (browser && registry) {
    return buildHandle(browser, registry);
  }
  if (connecting) {
    const { browser: b } = await connecting;
    return buildHandle(b, registry!);
  }

  connecting = (async () => {
    const profileDir = ensureChromeProfile();
    const { cdpUrl } = await launchChrome(profileDir);
    const b = await chromium.connectOverCDP(cdpUrl);
    b.on('disconnected', () => {
      browser = null;
      registry = null;
    });

    const context = b.contexts()[0];
    if (!context) throw new Error('No default browser context available over CDP.');

    const reg: Registry = { context, tabs: new Map(), parents: new Map(), nextTabNum: 1 };
    context.on('page', (page) => {
      if (findTabId(reg, page)) return; // already registered
      registerPage(reg, page);
    });

    const existingPages = context.pages();
    if (existingPages.length > 0) {
      for (const p of existingPages) registerPage(reg, p);
    } else {
      await context.newPage(); // picked up by the 'page' listener above
    }

    browser = b;
    registry = reg;
    return { browser: b, context };
  })();

  try {
    const { browser: b } = await connecting;
    return buildHandle(b, registry!);
  } finally {
    connecting = null;
  }
}

function buildHandle(b: Browser, reg: Registry) {
  return {
    browser: b,
    context: reg.context,
    openTab: async (url?: string) => {
      const page = await reg.context.newPage(); // registered by the 'page' listener
      const tabId = findTabId(reg, page) ?? registerPage(reg, page);
      // 'domcontentloaded' rather than the default 'load': heavy SPAs like
      // Alaska's results page may never cleanly fire 'load' (trackers,
      // long-polling, etc.) within a reasonable timeout — callers that need
      // to wait for specific content should do so explicitly afterward
      // (e.g. alaska-scraper.ts's waitForFareResults).
      if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
      return { tabId, page };
    },
    listTabs: () => {
      const result: TabInfo[] = [];
      for (const [tabId, page] of reg.tabs) {
        result.push({ tabId, url: page.url(), title: '' });
      }
      return result;
    },
    getTab: (tabId: TabId) => reg.tabs.get(tabId),
    closeTab: async (tabId: TabId) => {
      const page = reg.tabs.get(tabId);
      if (page) await page.close();
    },
  };
}
