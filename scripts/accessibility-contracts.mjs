import { evaluate } from "./browser-session.mjs";
import { navigateAndValidate, waitForSelector } from "./route-validation.mjs";

export async function validateAccessibilityContracts(cdp, origin) {
  await navigateAndValidate(
    cdp,
    `${origin}#/labs/portfolio-projection/accumulation`,
  );
  await disableMotionForAudit(cdp);
  await cdp.call("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await evaluate(
    cdp,
    `localStorage.setItem('montepathfolio/theme', 'dark'); document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'`,
  );
  await waitForVisualStability(cdp);
  await assertContrast(
    cdp,
    '.model-selector__option[data-selected="true"]',
    '.model-selector__option[data-selected="true"]',
    4.5,
    "selected model label",
  );
  await assertContrast(
    cdp,
    '.model-selector__option[data-selected="true"] small',
    '.model-selector__option[data-selected="true"]',
    4.5,
    "selected model detail",
  );
  await evaluate(cdp, `document.querySelector('.control__number')?.focus()`);
  await waitForVisualStability(cdp);
  await assertContrast(
    cdp,
    ".control__number",
    ".control__input-shell",
    4.5,
    "focused projection input",
  );
  await assertBorderContrast(
    cdp,
    ".control__input-shell",
    3,
    "projection field boundary",
  );
  const selectedComparison =
    '.model-comparison thead th[data-selected="true"]';
  await waitForSelector(cdp, selectedComparison);
  await assertContrast(
    cdp,
    selectedComparison,
    "body",
    4.5,
    "selected comparison heading",
  );
  await validateTouchTargets(cdp, "portfolio projection");

  await navigateAndValidate(cdp, `${origin}#/labs/risk/var-cvar`);
  await assertContrast(
    cdp,
    ".run-experiment",
    ".run-experiment",
    4.5,
    "run experiment button",
  );
  const hashFocus = await evaluate(
    cdp,
    `(() => {
      const before = location.hash;
      document.querySelector('.skip-link').click();
      return { before, after: location.hash, activeId: document.activeElement?.id };
    })()`,
  );
  if (hashFocus.before !== hashFocus.after || hashFocus.activeId !== "lesson-results") {
    throw new Error(
      `In-page navigation changed the SPA route or missed focus: ${JSON.stringify(hashFocus)}`,
    );
  }

  await navigateAndValidate(
    cdp,
    `${origin}#/labs/portfolio-projection/garch`,
  );
  await attachCsv(cdp);
  await waitForSelector(cdp, ".dataset-import__file button");
  await validateTouchTargets(cdp, "advanced lesson");

  await navigateAndValidate(cdp, `${origin}#/labs/risk/not-a-lesson`);
  const canonicalHash = await evaluate(cdp, "location.hash");
  if (canonicalHash !== "#/labs/risk/var-cvar") {
    throw new Error(`Unknown lesson did not canonicalize: ${canonicalHash}`);
  }

  await cdp.call("Emulation.setEmulatedMedia", { media: "" });
}

async function disableMotionForAudit(cdp) {
  await evaluate(
    cdp,
    `(() => {
      const style = document.createElement('style');
      style.id = 'accessibility-audit-disable-motion';
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
      document.head.append(style);
    })()`,
  );
}

async function waitForVisualStability(cdp) {
  await evaluate(
    cdp,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
}

async function validateTouchTargets(cdp, pageLabel) {
  await cdp.call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  try {
    await waitForVisualStability(cdp);
    const targets = await evaluate(
      cdp,
      `Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, summary'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            label: element.getAttribute('aria-label') || element.getAttribute('title') || element.labels?.[0]?.textContent?.trim() || element.textContent.trim() || element.tagName.toLowerCase(),
            width: rect.width,
            height: rect.height,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1,
          };
        })
        .filter((target) => target.visible)`,
    );
    const undersized = targets.filter(
      (target) => target.width < 44 || target.height < 44,
    );
    if (undersized.length > 0) {
      throw new Error(
        `${pageLabel} touch targets below 44px: ${JSON.stringify(undersized)}`,
      );
    }
  } finally {
    await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}

async function attachCsv(cdp) {
  await evaluate(
    cdp,
    `(async () => {
      const input = document.querySelector('.dataset-import input[type="file"]');
      if (!input) throw new Error('CSV input was not available.');
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        ['date,Asset\\n2025-01-01,0.01\\n2025-02-01,-0.01'],
        'touch-target.csv',
        { type: 'text/csv' },
      ));
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: transfer.files,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function assertContrast(
  cdp,
  foregroundSelector,
  backgroundSelector,
  minimum,
  label,
) {
  const ratio = await evaluate(
    cdp,
    contrastExpression(foregroundSelector, backgroundSelector, false),
  );
  if (ratio < minimum) {
    throw new Error(
      `${label} contrast ${ratio.toFixed(2)} is below ${minimum}:1.`,
    );
  }
}

async function assertBorderContrast(cdp, selector, minimum, label) {
  const ratio = await evaluate(
    cdp,
    contrastExpression(selector, selector, true),
  );
  if (ratio < minimum) {
    throw new Error(
      `${label} contrast ${ratio.toFixed(2)} is below ${minimum}:1.`,
    );
  }
}

function contrastExpression(
  foregroundSelector,
  backgroundSelector,
  useBorder,
) {
  return `(() => {
    const foreground = getComputedStyle(document.querySelector(${JSON.stringify(foregroundSelector)}));
    const background = getComputedStyle(document.querySelector(${JSON.stringify(backgroundSelector)}));
    const pixel = (color) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const left = luminance(pixel(${useBorder ? "foreground.borderBottomColor" : "foreground.color"}));
    const right = luminance(pixel(background.backgroundColor));
    return (Math.max(left, right) + .05) / (Math.min(left, right) + .05);
  })()`;
}
