// Audit Playwright — adapté depuis tests/browser-audit.mjs (site statique
// d'origine) pour la version Next.js + Firebase. Voir le plan de migration §7 :
//   - remplace le test « fonctionne sans JS » (structurellement faux avec un
//     panier/admin qui dépendent de React) par une vérification du HTML brut
//     renvoyé par le serveur, sans navigateur ;
//   - remplace le test « aucune requête externe » par une liste blanche de
//     domaines (Firebase, Cloudinary) puisque le catalogue et les images ne
//     sont plus servis localement ;
//   - garde tels quels : un seul <h1> par page, une seule couleur verte
//     WhatsApp calculée, pas de débordement horizontal à 390px/1400px,
//     navigation clavier, panier résistant à un localStorage altéré.
//
// Lance un vrai `next start` (build de production) sur un port libre, exécute
// les contrôles, puis coupe le serveur. Nécessite `npm run build` au préalable
// (voir le script npm "test:browser", qui l'enchaîne automatiquement).
import { config } from "dotenv";
config({ path: new URL("../.env.local", import.meta.url) });

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { initializeApp as initClientApp } from "firebase/app";
import { getAuth as getClientAuth, signInWithCustomToken } from "firebase/auth";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Compte admin utilisé pour fabriquer un cookie de session de test (voir
// createAdminSessionCookie ci-dessous) — doit déjà exister et porter le
// custom claim {admin:true} (scripts/create-admin.mjs). Aucun mot de passe
// n'est nécessaire : on signe un jeton personnalisé côté serveur.
const TEST_ADMIN_EMAIL = process.env.LMI_TEST_ADMIN_EMAIL;

// Domaines externes légitimes depuis la bascule vers Firebase/Cloudinary
// (plan §7) — tout le reste doit rester servi par notre propre serveur.
const ALLOWED_HOSTS = [
  /^127\.0\.0\.1$/,
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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startNextServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["next", "start", "-p", String(port)], {
      cwd: rootDir,
      shell: true,
      env: process.env,
    });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`next start n'a pas démarré à temps :\n${out}`));
    }, 45000);
    function onData(chunk) {
      out += chunk.toString();
      if (!settled && /Ready in|started server on/i.test(out)) {
        settled = true;
        clearTimeout(timer);
        // Le message "Ready" précède parfois de quelques centaines de ms le
        // moment où le socket accepte vraiment des connexions (observé sous
        // Windows) — sans ce délai, la toute première navigation échoue par
        // intermittence avec ERR_SOCKET_NOT_CONNECTED.
        setTimeout(() => resolve(child), 500);
      }
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`next start a quitté prématurément (code ${code}) :\n${out}`));
    });
  });
}

function killProcessTree(child) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
}

/** Fabrique un cookie de session admin valide sans mot de passe, via un jeton
 * personnalisé (Admin SDK) échangé contre un ID token (SDK client). Même
 * mécanisme que la connexion réelle (app/api/session/route.ts), juste sans
 * passer par le formulaire. */
async function createAdminSessionCookie() {
  if (!TEST_ADMIN_EMAIL) {
    throw new Error("LMI_TEST_ADMIN_EMAIL doit être configurée pour tester l'espace administrateur.");
  }
  const adminApp = initializeApp(
    {
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    },
    "audit-admin"
  );
  const adminAuth = getAdminAuth(adminApp);
  const user = await adminAuth.getUserByEmail(TEST_ADMIN_EMAIL);
  if (user.customClaims?.admin !== true) {
    throw new Error(`${TEST_ADMIN_EMAIL} n'a pas le rôle admin (customClaims.admin !== true).`);
  }
  const customToken = await adminAuth.createCustomToken(user.uid);

  const clientApp = initClientApp(
    {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    },
    "audit-client"
  );
  const credential = await signInWithCustomToken(getClientAuth(clientApp), customToken);
  const idToken = await credential.user.getIdToken();
  return adminAuth.createSessionCookie(idToken, { expiresIn: 60 * 60 * 1000 });
}

// Attend que le réseau se calme, sans en faire une condition d'échec. Une
// vidéo diffusée en continu (reel du portail, fiche produit) garde sa requête
// ouverte indéfiniment : exiger "networkidle" faisait planter l'audit dès
// l'accueil au bout de 30 s. On attend donc "load", puis le calme réseau
// pendant quelques secondes au plus.
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
}
async function gotoSettled(page, url) {
  const response = await page.goto(url, { waitUntil: "load" });
  await settle(page);
  return response;
}

// Vercel Analytics charge /_vercel/insights/script.js, qui n'existe que sur
// Vercel : hors de Vercel ce script répond 404. Ce bruit ne signale pas une
// erreur du site, on l'écarte du contrôle des erreurs console.
function isVercelInsightsNoise(message) {
  return `${message.text()} ${message.location()?.url || ""}`.includes("/_vercel/insights/");
}

const port = await getFreePort();
const base = `http://127.0.0.1:${port}/`;
console.log(`Démarrage de next start sur ${base}...`);
const server = await startNextServer(port);
const browser = await chromium.launch({ headless: true });

try {
  const whatsappColors = new Set();
  const routes = [
    "",
    "football",
    "football/boutique",
    "football/produits/maillot-domicile-cameroun",
    "football/phototheque",
    "confidentialite",
  ];

  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on("console", (m) => m.type() === "error" && !isVercelInsightsNoise(m) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.protocol !== "data:" && !ALLOWED_HOSTS.some((re) => re.test(url.hostname))) external.push(url.href);
    });

    const response = await gotoSettled(page, `${base}${route}`);
    check(response?.status() === 200, `/${route} ne répond pas en 200`);
    check(errors.length === 0, `/${route} produit des erreurs : ${errors.join(" | ")}`);
    check(external.length === 0, `/${route} charge des ressources hors liste blanche : ${external.join(", ")}`);

    const audit = await page.evaluate(() => ({
      brokenImages: [...document.images].filter(
        (img) => img.getClientRects().length > 0 && img.complete && img.naturalWidth === 0 && img.src
      ).length,
      missingIcons: [...document.querySelectorAll("use")].filter((use) => {
        const id = (use.getAttribute("href") || "").split("#").pop();
        return id && !document.getElementById(id);
      }).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1Count: document.querySelectorAll("h1").length,
    }));
    check(audit.brokenImages === 0, `/${route} contient des images cassées`);
    check(audit.missingIcons === 0, `/${route} contient des icônes absentes`);
    check(audit.h1Count === 1, `/${route} doit contenir exactement un titre h1 (trouvé ${audit.h1Count})`);
    check(audit.overflow <= 0, `/${route} déborde sur mobile (390px)`);

    const colors = await page
      .locator(".btn-whatsapp, .wa-float")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    colors.forEach((c) => whatsappColors.add(c));

    if (route === "") {
      check((await page.locator(".skip-link").count()) === 1, "le lien d'évitement est absent de l'accueil");
      check(await page.locator("#portalDrawer").evaluate((nav) => nav.inert), "le menu du portail fermé reste accessible au clavier");
      await page.locator(".portal-hamburger").click();
      check(
        await page.locator("#portalDrawer").evaluate((nav) => !nav.inert),
        "le menu du portail ouvert reste inaccessible"
      );
      await page.keyboard.press("Escape");
      check(
        await page.evaluate(() => document.activeElement === document.querySelector(".portal-hamburger")),
        "la fermeture du menu du portail ne restaure pas le focus"
      );
    }

    if (route === "football") {
      const closedNav = await page
        .locator(".main-nav")
        .evaluate((nav) => ({ hidden: nav.getAttribute("aria-hidden"), inert: nav.inert }));
      check(closedNav.hidden === "true" && closedNav.inert, "le menu mobile fermé reste accessible au clavier");
      await page.locator(".nav-toggle").click();
      check(
        await page.locator(".main-nav").evaluate((nav) => nav.getAttribute("aria-hidden") === "false" && !nav.inert),
        "le menu mobile ouvert reste masqué aux technologies d'assistance"
      );
      await page.keyboard.press("Escape");
      check(
        await page.evaluate(() => document.activeElement === document.querySelector(".nav-toggle")),
        "la fermeture du menu mobile ne restaure pas le focus"
      );
    }

    if (route.includes("/produits/")) {
      const beforePath = new URL(page.url()).pathname;
      await page.locator(".skip-link").focus();
      await page.keyboard.press("Enter");
      check(new URL(page.url()).pathname === beforePath, "le lien d'évitement quitte la fiche produit");
      check(new URL(page.url()).hash === "#main", "le lien d'évitement ne cible pas le contenu");
    }

    if (await page.locator(".theme-toggle").count()) {
      const themeBefore = await page.locator("html").getAttribute("data-theme");
      await page.locator(".theme-toggle").first().click();
      check(await page.locator("html").getAttribute("data-theme") !== themeBefore, `/${route} ne change pas de thème`);
    }

    await context.close();
  }

  check(
    whatsappColors.size === 1,
    `plusieurs couleurs de vert WhatsApp détectées : ${[...whatsappColors].join(", ")}`
  );

  for (const route of ["", "football", "football/boutique", "football/produits/maillot-domicile-cameroun", "confidentialite"]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await gotoSettled(page, `${base}${route}`);
    check(errors.length === 0, `/${route} produit des erreurs en desktop : ${errors.join(" | ")}`);
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `/${route} déborde en desktop (1400px)`
    );
    if (await page.locator(".nav-toggle").count()) {
      check(await page.locator(".nav-toggle").isHidden(), `/${route} affiche le bouton du menu mobile en desktop`);
    }
    await context.close();
  }

  // Remplace l'ancien test « fonctionne sans JS » : le panier/l'admin dépendent
  // désormais réellement de React, donc « JS désactivé » n'a plus de sens à
  // tester. Ce qui compte encore, c'est que le HTML renvoyé par le serveur
  // (avant toute exécution JS) porte déjà le contenu essentiel — SEO et repli
  // en cas de JS lent/bloqué sur réseau mobile.
  {
    const rawHtml = await fetch(`${base}football/produits/maillot-domicile-cameroun`).then((r) => r.text());
    check(rawHtml.includes('class="pd-title"'), "le HTML brut ne contient pas le nom du produit");
    check(rawHtml.includes('class="price-now"'), "le HTML brut ne contient pas le prix");
    check(/href="https:\/\/wa\.me\//.test(rawHtml), "le HTML brut ne contient pas de lien WhatsApp exploitable");
    check(rawHtml.includes("application/ld+json"), "le HTML brut ne contient pas de données structurées JSON-LD");
  }

  // Panier résistant à un localStorage altéré : prix/nom toujours relus depuis
  // le catalogue réel, jamais depuis les champs (même inattendus) du panier
  // stocké ; slug inconnu et taille invalide ignorés ; lignes identiques fusionnées.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await gotoSettled(page, `${base}football/produits/maillot-domicile-psg`);
    const realPriceText = await page.locator(".price-now").first().textContent();
    const realPrice = Number((realPriceText || "").replace(/\D/g, ""));
    check(realPrice > 0, "impossible de lire le prix réel du produit de test (maillot-domicile-psg)");

    await page.evaluate(() => {
      localStorage.setItem(
        "lmi_cart_v3",
        JSON.stringify([
          { slug: "maillot-domicile-psg", size: "M", qty: 2, price: 1, name: "PRIX ALTÉRÉ" },
          { slug: "maillot-domicile-psg", size: "M", qty: 3 },
          { slug: "produit-qui-n-existe-pas", size: "M", qty: 1 },
          { slug: "maillot-domicile-psg", size: "taille-invalide", qty: 1 },
        ])
      );
    });

    const cartErrors = [];
    page.on("pageerror", (e) => cartErrors.push(e.message));
    await page.reload({ waitUntil: "load" });
    await settle(page);
    check(cartErrors.length === 0, "un panier altéré fait planter la fiche produit");

    await page.locator(".cart-bar").click();
    const panelText = await page.locator("#cartPanel").innerText();
    check(!panelText.includes("PRIX ALTÉRÉ"), "le panier affiche un nom injecté depuis le stockage local");
    check((await page.locator(".cp-item").count()) === 1, "le panier ne fusionne/filtre pas les lignes altérées comme attendu");

    const subtotalText = await page.locator(".cp-subtotal .amount").textContent();
    const subtotal = Number((subtotalText || "").replace(/\D/g, ""));
    check(
      subtotal === realPrice * 5,
      `le sous-total (${subtotal}) ne recalcule pas depuis le prix réel × quantité fusionnée (attendu ${realPrice * 5})`
    );

    const checkoutHref = decodeURIComponent(await page.locator(".cp-checkout").getAttribute("href") || "");
    check(
      !checkoutHref.includes("1 FCFA") && !checkoutHref.includes("PRIX ALTÉRÉ"),
      "le message WhatsApp fait confiance au panier local altéré"
    );

    const storedAfter = await page.evaluate(() => localStorage.getItem("lmi_cart_v3"));
    check(!!storedAfter && JSON.parse(storedAfter).length === 1, "le panier corrigé n'est pas réécrit dans le stockage local");

    await context.close();
  }

  // JSON complètement invalide (pas juste sémantiquement incorrect) : ne doit
  // ni planter, ni laisser une valeur corrompue en place.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("lmi_cart_v3", "{"));
    const corruptErrors = [];
    page.on("pageerror", (e) => corruptErrors.push(e.message));
    await gotoSettled(page, `${base}football/boutique`);
    check(corruptErrors.length === 0, "un panier JSON invalide fait planter la boutique");
    check((await page.locator(".product-card").count()) > 0, "le catalogue ne se rend pas après réparation du panier");
    check(
      await page.evaluate(() => localStorage.getItem("lmi_cart_v3") === "[]"),
      "un JSON de panier invalide n'est pas réparé dans le stockage"
    );
    await context.close();
  }

  // Garde d'authentification admin (proxy.ts) : sans cookie, toujours renvoyé
  // vers la connexion, jamais vers le contenu.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await gotoSettled(page, `${base}admin`);
    check(new URL(page.url()).pathname === "/admin/connexion", "un visiteur non connecté peut accéder à /admin");
    await context.close();
  }

  // Avec une vraie session admin : le tableau produits se rend, le thème
  // fonctionne, et (si aucun avis n'est encore publié) la validation croisée
  // refuse d'activer les témoignages sans contenu réel.
  {
    let sessionCookie = null;
    try {
      sessionCookie = await createAdminSessionCookie();
    } catch (error) {
      check(false, `impossible de préparer une session admin de test : ${error.message}`);
    }

    if (sessionCookie) {
      const context = await browser.newContext();
      await context.addCookies([
        { name: "session", value: sessionCookie, domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
      ]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));

      // "networkidle" ne se résout jamais sur les pages admin : elles ouvrent
      // un onSnapshot Firestore (connexion de streaming volontairement tenue
      // ouverte pour la synchronisation temps réel entre admins, voir le plan
      // §3) — on attend le rendu réel via un sélecteur précis à la place.
      await page.goto(`${base}admin`, { waitUntil: "load" });
      check(new URL(page.url()).pathname === "/admin", "une session admin valide est quand même renvoyée vers la connexion");
      await page.waitForSelector(".adm-table tbody tr", { timeout: 10000 });
      check((await page.locator(".adm-table tbody tr").count()) > 0, "le tableau produits de l'admin ne se rend pas pour un admin connecté");

      const themeBefore = await page.locator("html").getAttribute("data-theme");
      await page.locator(".theme-toggle").first().click();
      check(await page.locator("html").getAttribute("data-theme") !== themeBefore, "l'admin ne change pas de thème");

      const testimonialCount = Number(
        (await page.locator('a[href="/admin/avis"] .cnt').textContent().catch(() => "1")) || "1"
      );
      if (testimonialCount === 0) {
        await page.goto(`${base}admin/textes`, { waitUntil: "load" });
        await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
        await page
          .locator("label.adm-check", { hasText: "Afficher les avis clients" })
          .locator('input[type="checkbox"]')
          .check();
        await page.locator('button[type="submit"]').click();
        await page.waitForTimeout(500);
        const errorText = await page.locator(".adm-warn").innerText().catch(() => "");
        check(
          /Ajoutez au moins un avis réel/i.test(errorText),
          "la configuration autorise des témoignages vides à être publiés"
        );
      } else {
        console.log(`(validation croisée « avis » ignorée : ${testimonialCount} avis déjà publiés)`);
      }

      check(errors.length === 0, `l'admin produit des erreurs : ${errors.join(" | ")}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  killProcessTree(server);
}

if (failures) {
  console.error(`\n${failures} contrôle(s) en échec.`);
  process.exitCode = 1;
} else {
  console.log("Audit navigateur réussi.");
}
