import { chromium } from "playwright";

const configuredBase = process.env.LMI_AUDIT_BASE_URL?.trim();
if (!configuredBase) throw new Error("LMI_AUDIT_BASE_URL est obligatoire pour le smoke test distant.");

const baseUrl = new URL(configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`);
const baseHost = baseUrl.hostname;
const ALLOWED_EXTERNAL_HOSTS = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)gstatic\.com$/,
  /(^|\.)firebaseio\.com$/,
  /(^|\.)cloudinary\.com$/,
];

let failures = 0;
function check(condition, message) {
  if (condition) return;
  failures += 1;
  console.error(`ÉCHEC — ${message}`);
}

function urlFor(route = "") {
  return new URL(route.replace(/^\//, ""), baseUrl).href;
}

function allowedRequest(urlText) {
  const url = new URL(urlText);
  if (["data:", "blob:"].includes(url.protocol)) return true;
  return url.hostname === baseHost || ALLOWED_EXTERNAL_HOSTS.some((re) => re.test(url.hostname));
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
}

async function auditPage(browser, route, viewport, label) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width <= 500,
    isMobile: viewport.width <= 500,
  });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  const serverErrors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => !allowedRequest(request.url()) && external.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  try {
    const response = await page.goto(urlFor(route), { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page);
    check(response?.status() === 200, `${label} /${route} ne répond pas en 200`);
    check(
      serverErrors.length === 0,
      `${label} /${route} reçoit des réponses 5xx : ${[...new Set(serverErrors)].join(", ")}`
    );
    check(errors.length === 0, `${label} /${route} produit des erreurs : ${errors.join(" | ")}`);
    check(external.length === 0, `${label} /${route} charge des domaines non autorisés : ${[...new Set(external)].join(", ")}`);

    const audit = await page.evaluate(() => ({
      h1Count: document.querySelectorAll("h1").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowing: [...document.querySelectorAll("*")]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || "",
            className: typeof el.className === "string" ? el.className : "",
            width: Math.round(rect.width),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        })
        .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
        .sort((a, b) => Math.max(b.right - window.innerWidth, -b.left) - Math.max(a.right - window.innerWidth, -a.left))
        .slice(0, 16),
      brokenImages: [...document.images].filter(
        (img) => img.getClientRects().length > 0 && img.complete && img.naturalWidth === 0 && Boolean(img.src)
      ).length,
    }));
    check(audit.h1Count === 1, `${label} /${route} doit avoir exactement un h1 (trouvé ${audit.h1Count})`);
    check(
      audit.overflow <= 0,
      `${label} /${route} déborde horizontalement de ${audit.overflow}px ; éléments : ${JSON.stringify(audit.overflowing)}`
    );
    check(audit.brokenImages === 0, `${label} /${route} contient ${audit.brokenImages} image(s) visible(s) cassée(s)`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
let productPath = null;

try {
  const publicRoutes = ["", "football", "football/boutique", "football/phototheque", "confidentialite"];
  for (const route of publicRoutes) {
    await auditPage(browser, route, { width: 390, height: 844 }, "mobile");
  }

  // Découvre une fiche depuis le catalogue live au lieu de figer un slug produit.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      const response = await page.goto(urlFor("football/boutique"), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      check(response?.status() === 200, "la boutique ne répond pas en 200 pendant la découverte produit");
      const href = await page.locator("a.product-media").first().getAttribute("href");
      check(Boolean(href), "aucune fiche produit n'est découvrable depuis la boutique live");
      if (href) productPath = new URL(href, baseUrl).pathname.replace(/^\//, "");
    } finally {
      await context.close();
    }
  }

  if (productPath) {
    await auditPage(browser, productPath, { width: 390, height: 844 }, "mobile");

    const response = await fetch(urlFor(productPath), { redirect: "follow" });
    const rawHtml = await response.text();
    check(response.ok, "la fiche produit dynamique n'est pas récupérable en HTML brut");
    check(rawHtml.includes('class="pd-title"'), "le HTML brut de la fiche ne contient pas le nom du produit");
    check(rawHtml.includes('class="price-now"'), "le HTML brut de la fiche ne contient pas le prix");
    check(rawHtml.includes("application/ld+json"), "le HTML brut de la fiche ne contient pas JSON-LD");
    check(/href="https:\/\/wa\.me\//.test(rawHtml), "le HTML brut de la fiche ne contient pas de lien WhatsApp");
  }

  // Un localStorage corrompu ne doit ni planter la boutique, ni rester corrompu.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("lmi_cart_v3", "{"));
    try {
      await page.goto(urlFor("football/boutique"), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      check(errors.length === 0, `un panier JSON corrompu fait planter la boutique : ${errors.join(" | ")}`);
      check((await page.locator(".product-card").count()) > 0, "le catalogue ne se rend pas après réparation du panier");
      check(
        await page.evaluate(() => localStorage.getItem("lmi_cart_v3") === "[]"),
        "le panier JSON corrompu n'est pas réparé dans localStorage"
      );
    } finally {
      await context.close();
    }
  }

  // La route admin doit rester inaccessible sans cookie de session.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(urlFor("admin"), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      check(new URL(page.url()).pathname === "/admin/connexion", "un visiteur non connecté peut atteindre /admin");
    } finally {
      await context.close();
    }
  }

  const desktopRoutes = ["", "football", "football/boutique", "confidentialite", ...(productPath ? [productPath] : [])];
  for (const route of desktopRoutes) {
    await auditPage(browser, route, { width: 1400, height: 900 }, "desktop");
  }
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n${failures} contrôle(s) navigateur distant en échec.`);
  process.exitCode = 1;
} else {
  console.log(`Smoke navigateur distant réussi sur ${baseUrl.origin}.`);
}
