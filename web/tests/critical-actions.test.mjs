import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

function makeDb(initial) {
  const rows = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  let counter = 0;
  let queue = Promise.resolve();
  const apply = (kind, ref, value) => {
    if (kind === "set") rows.set(ref.path, clone(value));
    else rows.set(ref.path, { ...clone(rows.get(ref.path)), ...clone(value) });
  };
  const document = (documentPath) => ({
    path: documentPath,
    id: documentPath.split("/").at(-1),
    get() {
      const value = clone(rows.get(this.path));
      return Promise.resolve({ id: this.id, ref: this, exists: value !== undefined, data: () => clone(value) });
    },
    set(value, options) { apply(options?.merge ? "update" : "set", this, value); return Promise.resolve(); },
    update(value) { apply("update", this, value); return Promise.resolve(); },
    delete() { rows.delete(this.path); return Promise.resolve(); },
    collection(name) { return collection(`${this.path}/${name}`); },
  });
  function collection(collectionPath, filters = [], maximum = Infinity, order = null) {
    return {
      path: collectionPath,
      doc(id = `test-${++counter}`) { return document(`${collectionPath}/${id}`); },
      add(value) { const ref = this.doc(); return ref.set(value).then(() => ref); },
      where(field, operator, expected) {
        assert.equal(operator, "==");
        return collection(collectionPath, [...filters, [field, expected]], maximum, order);
      },
      limit(value) { return collection(collectionPath, filters, value, order); },
      orderBy(field, direction = "asc") { return collection(collectionPath, filters, maximum, [field, direction]); },
      async get() {
        let docs = [...rows.entries()]
          .filter(([key]) => key.startsWith(`${collectionPath}/`) && !key.slice(collectionPath.length + 1).includes("/"))
          .map(([key]) => document(key))
          .map(async (ref) => ref.get());
        docs = await Promise.all(docs);
        docs = docs.filter((doc) => filters.every(([field, expected]) => doc.data()?.[field] === expected));
        if (order) docs.sort((a, b) => String(a.data()?.[order[0]]).localeCompare(String(b.data()?.[order[0]])) * (order[1] === "desc" ? -1 : 1));
        docs = docs.slice(0, maximum);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  const db = { rows, collection };
  db.runTransaction = (callback) => {
    const run = queue.then(async () => {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, value) => writes.push(["set", ref, clone(value)]),
        update: (ref, value) => writes.push(["update", ref, clone(value)]),
      };
      const result = await callback(tx);
      writes.forEach((write) => apply(...write));
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };
  db.batch = () => {
    const writes = [];
    return {
      update: (ref, value) => writes.push(["update", ref, clone(value)]),
      commit: async () => writes.forEach((write) => apply(...write)),
    };
  };
  return db;
}

function fixture(extra = {}) {
  const db = makeDb({
    "customers/client-test": { name: "Client test", phone: "12345678" },
    "products/maillot-test": { name: "Maillot test", price: 12000, stock: 10, sizes: ["M", "L"] },
    ...extra,
  });
  const state = { adminChecks: 0, customerChecks: 0, collectCalls: [], revalidations: [] };
  const modules = new Map();
  const mocks = {
    "server-only": {},
    react: { cache: (fn) => fn },
    "next/cache": { revalidatePath: (...args) => state.revalidations.push(args) },
    "next/headers": {},
    "@/lib/firebase/admin": { adminDb: db },
    "@/lib/auth/dal": {
      AuthError: class AuthError extends Error {},
      verifyAdminSession: async () => { state.adminChecks++; return { uid: "admin-test" }; },
      verifyCustomerSession: async () => { state.customerChecks++; return { uid: "client-test" }; },
    },
    "@/lib/cloudinary": { signUpload: () => { throw new Error("hors périmètre"); } },
  };

  function load(relative) {
    const absolute = path.join(root, relative);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const testModule = { exports: {} };
    modules.set(absolute, testModule);
    const source = fs.readFileSync(absolute, "utf8");
    const output = ts.transpileModule(source, {
      fileName: absolute,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const customRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
      if (name.startsWith("node:")) return require(name);
      throw new Error(`Dépendance non simulée : ${name}`);
    };
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: absolute })(customRequire, testModule, testModule.exports);
    return testModule.exports;
  }
  return { db, load, mocks, state };
}

const item = (qty, size = "M") => ({ slug: "maillot-test", size, qty });
const orderRows = (fixtureValue) => [...fixtureValue.db.rows.entries()].filter(([key]) => /^orders\/[^/]+$/.test(key));

test("commande WhatsApp : refuse une quantité négative sans toucher au stock", async () => {
  const f = fixture();
  const result = await f.load("lib/actions/orders.ts").createCustomerOrderAction({ items: [item(-5, "X")], requestId: "request-negative-0001" });
  assert.equal(result.ok, false);
  assert.equal(f.db.rows.get("products/maillot-test").stock, 10);
  assert.equal(orderRows(f).length, 0);
});

test("commande WhatsApp : total serveur, cumul des tailles et réessai idempotent", async () => {
  const f = fixture();
  const action = f.load("lib/actions/orders.ts").createCustomerOrderAction;
  const input = { items: [item(2, "M"), item(3, "L")], requestId: "request-idempotent-0001", total: 1 };
  const [first, retry] = await Promise.all([action(input), action(input)]);
  assert.equal(first.ok && retry.ok, true);
  assert.equal(first.id, retry.id);
  assert.equal(f.db.rows.get("products/maillot-test").stock, 5);
  assert.equal(orderRows(f).length, 1);
  assert.equal(orderRows(f)[0][1].total, 60000);
});

test("paiement : succès, échec tardif et répétition ne décomptent qu'une fois", async () => {
  const f = fixture({
    "products/maillot-test": { name: "Maillot test", price: 12000, stock: 8, sizes: ["M"] },
    "orders/payment": { items: [item(2)], paymentStatus: "pending", stockState: "reserved", paidAt: null },
  });
  const apply = f.load("lib/paymentHelpers.ts").applyPaymentResult;
  await apply("payment", "SUCCESSFUL", null);
  await apply("payment", "FAILED", "tardif");
  await apply("payment", "SUCCESSFUL", null);
  assert.equal(f.db.rows.get("products/maillot-test").stock, 8);
  assert.equal(f.db.rows.get("orders/payment").paymentStatus, "paid");
});

test("paiement : un échec libère une réservation exactement une fois", async () => {
  const f = fixture({
    "products/maillot-test": { name: "Maillot test", price: 12000, stock: 8, sizes: ["M"] },
    "orders/payment": { items: [item(2)], paymentStatus: "pending", stockState: "reserved", paidAt: null },
  });
  const apply = f.load("lib/paymentHelpers.ts").applyPaymentResult;
  await apply("payment", "FAILED", "refusé");
  await apply("payment", "FAILED", "répété");
  assert.equal(f.db.rows.get("products/maillot-test").stock, 10);
  assert.equal(f.db.rows.get("orders/payment").stockState, "released");
});

test("paiement : réservation atomique empêche deux ventes du dernier article", async () => {
  const f = fixture({ "products/maillot-test": { name: "Maillot test", price: 12000, stock: 1, sizes: ["M"] } });
  f.mocks["@/lib/campay"] = {
    campayCollect: async (input) => { f.state.collectCalls.push(input); return { reference: `provider-${f.state.collectCalls.length}`, ussd_code: "*126#", operator: "TEST" }; },
    campayGetTransaction: async () => { throw new Error("non utilisé"); },
    campayTransactionMismatch: () => null,
  };
  const action = f.load("lib/actions/payments.ts").initiateCampayPaymentAction;
  const [a, b] = await Promise.all([
    action({ items: [item(1)], requestId: "payment-request-00001" }),
    action({ items: [item(1)], requestId: "payment-request-00002" }),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  assert.equal(f.state.collectCalls.length, 1);
  assert.equal(f.db.rows.get("products/maillot-test").stock, 0);
});

test("couche de données admin : vérifie elle-même la session", async () => {
  const f = fixture({ "orders/private": { createdAt: "2026-01-01" } });
  await f.load("lib/data/orders.ts").getAllOrders();
  assert.equal(f.state.adminChecks, 1);
});

test("webhook : applique uniquement le statut relu auprès de CamPay", async () => {
  const f = fixture({
    "orders/payment": {
      paymentReference: "external-test", campayReference: "provider-test", total: 12000,
      paymentStatus: "pending", stockState: "reserved", items: [item(1)],
    },
  });
  const applied = [];
  f.mocks["@/lib/campay"] = {
    verifyCampayWebhookSignature: () => true,
    campayGetTransaction: async () => ({
      reference: "provider-test", external_reference: "external-test", amount: 12000,
      currency: "XAF", status: "FAILED", reason: "statut fournisseur",
    }),
    campayTransactionMismatch: () => null,
  };
  f.mocks["@/lib/paymentHelpers"] = { applyPaymentResult: async (...args) => applied.push(args) };
  const response = await f.load("app/api/campay/webhook/route.ts").POST(new Request("https://test.invalid/api/campay/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signature: "validée-par-le-double", endpoint: "collect", external_reference: "external-test",
      status: "SUCCESSFUL", amount: 1, currency: "USD",
    }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(applied[0], ["payment", "FAILED", "statut fournisseur"]);
});

test("livraison : réaffecter révoque l'ancien jeton et le livreur ne reçoit pas le jeton d'avis", async () => {
  const f = fixture({
    "couriers/new": { active: true },
    "orders/delivery": {
      status: "prete", assignedCourierId: "old", courierLocationToken: "old-token",
      courierLocationSharing: true, courierLiveLocation: null, locationToken: "customer-token",
    },
  });
  const courierActions = f.load("lib/actions/couriers.ts");
  assert.equal((await courierActions.assignCourierToOrderAction("delivery", "new")).ok, true);
  assert.notEqual(f.db.rows.get("orders/delivery").courierLocationToken, "old-token");
  assert.equal((await f.load("lib/actions/orders.ts").getOrderForLocationAction("old-token")).ok, false);

  const currentToken = f.db.rows.get("orders/delivery").courierLocationToken;
  f.db.rows.set("orders/delivery", {
    ...f.db.rows.get("orders/delivery"), status: "livree", reviewToken: "customer-review", reviewSubmitted: false,
  });
  const shared = await f.load("lib/actions/orders.ts").getSharedLocationViewAction(currentToken);
  assert.equal(shared.ok, true);
  assert.equal(shared.reviewToken, null);
});

test("livreur : une inscription publique reste inactive et inassignable jusqu'à validation admin", async () => {
  const f = fixture({ "orders/delivery": { status: "prete", assignedCourierId: null } });
  const actions = f.load("lib/actions/couriers.ts");

  const registered = await actions.registerCourierAction({ name: "Jean Mboa", phone: "237 655 00 00 01" });
  assert.equal(registered.ok, true);
  assert.equal(f.state.adminChecks, 0);
  const [courierPath, courier] = [...f.db.rows.entries()].find(([key]) => key.startsWith("couriers/"));
  const courierId = courierPath.split("/")[1];
  assert.equal(courier.active, false);
  assert.equal(courier.pendingApproval, true);

  // Tant que l'admin n'a rien validé : ni tableau de bord, ni livraison.
  const dashboard = await actions.getCourierDashboardAction(registered.token);
  assert.equal(dashboard.ok, false);
  assert.match(dashboard.error, /en attente de validation/);
  assert.equal((await actions.assignCourierToOrderAction("delivery", courierId)).ok, false);

  assert.equal((await actions.setCourierActiveAction(courierId, true)).ok, true);
  assert.equal(f.db.rows.get(courierPath).active, true);
  assert.equal(f.db.rows.get(courierPath).pendingApproval, false);
  assert.equal((await actions.getCourierDashboardAction(registered.token)).ok, true);
  assert.equal((await actions.assignCourierToOrderAction("delivery", courierId)).ok, true);
});

test("livreur : l'inscription publique refuse les doublons et plafonne les demandes en attente", async () => {
  const pending = Object.fromEntries(Array.from({ length: 19 }, (_, index) => [
    `couriers/pending-${index}`, { name: `Faux ${index}`, phone: `2376000000${String(index).padStart(2, "0")}`, active: false, pendingApproval: true },
  ]));
  const f = fixture({ ...pending, "couriers/known": { name: "Connu", phone: "237655000002", token: "known-token", active: true } });
  const actions = f.load("lib/actions/couriers.ts");
  const countCouriers = () => [...f.db.rows.keys()].filter((key) => key.startsWith("couriers/")).length;

  // Un numéro déjà enregistré ne crée rien et ne révèle jamais le lien existant.
  const duplicate = await actions.registerCourierAction({ name: "Usurpateur", phone: "+237 655 000 002" });
  assert.equal(duplicate.ok, false);
  assert.equal("token" in duplicate, false);
  assert.equal(countCouriers(), 20);

  assert.equal((await actions.registerCourierAction({ name: "Vingtième", phone: "237655000003" })).ok, true);
  const overflow = await actions.registerCourierAction({ name: "De trop", phone: "237655000004" });
  assert.equal(overflow.ok, false);
  assert.equal(countCouriers(), 21);
  assert.equal((await actions.registerCourierAction({ name: "x".repeat(81), phone: "237655000005" })).ok, false);
});

test("livreur : seule une demande en attente peut être refusée, jamais un livreur validé", async () => {
  const f = fixture({
    "couriers/pending": { name: "Inconnu", phone: "237655000006", active: false, pendingApproval: true },
    "couriers/validated": { name: "Validé", phone: "237655000007", active: true },
  });
  const actions = f.load("lib/actions/couriers.ts");

  assert.equal((await actions.rejectCourierAction("validated")).ok, false);
  assert.ok(f.db.rows.has("couriers/validated"));
  assert.equal((await actions.rejectCourierAction("pending")).ok, true);
  assert.equal(f.db.rows.has("couriers/pending"), false);
  assert.equal(f.state.adminChecks, 2);
});

test("livraison : cinq codes erronés verrouillent temporairement la confirmation", async () => {
  const f = fixture({
    "orders/delivery-code": {
      status: "arrivee", courierLocationToken: "courier-token", deliveryCode: "1234",
      deliveryCodeAttempts: 0, reviewToken: null, deliveredAt: null,
    },
  });
  const action = f.load("lib/actions/orders.ts").markOrderDeliveredByCourierAction;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await action("courier-token", "9999");
    assert.equal(result.ok, false);
  }
  const row = f.db.rows.get("orders/delivery-code");
  assert.ok(row.deliveryCodeLockedUntil);
  assert.equal((await action("courier-token", "1234")).ok, false);
  assert.equal(f.db.rows.get("orders/delivery-code").status, "arrivee");
});

test("livraison : le client ne reçoit son lien qu'après le départ réel du livreur", async () => {
  const f = fixture({
    "orders/workflow": {
      status: "livreur_assigne", courierLocationToken: "courier-start", locationToken: null,
      courierLocationSharing: false, courierLiveLocation: null, locationSharing: false, liveLocation: null,
    },
  });
  const actions = f.load("lib/actions/orders.ts");
  assert.equal((await actions.getOrCreateLocationTokenAction("workflow", "customer")).ok, false);
  assert.equal((await actions.startDeliveryByCourierAction("courier-start")).ok, true);
  assert.equal(f.db.rows.get("orders/workflow").status, "en_route");
  assert.equal((await actions.getOrCreateLocationTokenAction("workflow", "customer")).ok, true);
});

test("livraison : le code de remise n'est accepté qu'après l'arrivée", async () => {
  const f = fixture({
    "orders/handover": {
      status: "en_route", courierLocationToken: "courier-handover", deliveryCode: "4321",
      courierLocationSharing: true, locationSharing: true, reviewToken: null, deliveredAt: null,
    },
  });
  const actions = f.load("lib/actions/orders.ts");
  assert.equal((await actions.markOrderDeliveredByCourierAction("courier-handover", "4321")).ok, false);
  assert.equal((await actions.markCourierArrivedAction("courier-handover")).ok, true);
  assert.equal((await actions.markOrderDeliveredByCourierAction("courier-handover", "4321")).ok, true);
  assert.equal(f.db.rows.get("orders/handover").status, "livree");
});

test("profil d'accueil : ne lit que le client authentifié et ne renvoie aucun champ privé supplémentaire", async () => {
  const { load, state } = fixture({
    "customers/client-test": { name: "  Client IKIGAI  ", phone: "12345678", admin: true, internalNote: "private" },
    "customers/other-client": { name: "Autre client" },
  });
  const { getCustomerProfile } = load("lib/data/customer.ts");
  const profile = await getCustomerProfile();
  assert.equal(state.customerChecks, 1);
  assert.equal(profile.name, "Client IKIGAI");
  assert.deepEqual(Object.keys(profile).sort(), ["defaultAddress", "email", "name", "phone"]);
});

test("profil d'accueil : refuse une session absente avant toute lecture des clients", async () => {
  const { load, mocks, db } = fixture();
  mocks["@/lib/auth/dal"].verifyCustomerSession = async () => { throw new Error("Session absente"); };
  db.collection = () => { throw new Error("Lecture interdite"); };
  const { getCustomerProfile } = load("lib/data/customer.ts");
  await assert.rejects(getCustomerProfile(), /Session absente/);
});

test("accueil connecté : la réponse privée n'est jamais mise en cache et ne contient pas l'e-mail", async () => {
  const { load, mocks } = fixture();
  mocks["@/lib/auth/dal"].AuthError = class AuthError extends Error {};
  const { GET } = load("app/api/customer-session/route.ts");
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.deepEqual(await response.json(), { profile: { name: "Client test" } });
});

test("accueil public : une session invalide ne révèle aucun profil", async () => {
  const { load, mocks } = fixture();
  class AuthError extends Error {}
  mocks["@/lib/auth/dal"].AuthError = AuthError;
  mocks["@/lib/auth/dal"].verifyCustomerSession = async () => { throw new AuthError("Expirée"); };
  const response = await load("app/api/customer-session/route.ts").GET();
  assert.deepEqual(await response.json(), { profile: null });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

const customerOrder = (overrides = {}) => ({
  uid: "client-test", status: "confirmee", createdAt: "2026-09-08T10:00:00.000Z", statusUpdatedAt: "2026-09-08T10:05:00.000Z",
  customerName: "Client test", customerPhone: "237600000001", orderSummary: "1 × Maillot test (M)", address: "Douala",
  locationToken: "customer-secret", courierLocationToken: "courier-secret", deliveryCode: "0042", total: 12000,
  paymentStatus: "unpaid", reviewToken: null, deliveredAt: null, locationSharing: false, courierLocationSharing: false,
  liveLocation: null, courierLiveLocation: null, ...overrides,
});

test("admin : mutation enregistrée et historisée, sans revalidation globale", async () => {
  const f = fixture({ "orders/order-fast": customerOrder() });
  const result = await f.load("lib/actions/orders.ts").updateOrderStatusAction("order-fast", "preparation", "confirmee");
  assert.equal(result.ok, true);
  assert.equal(result.patch.status, "preparation");
  assert.deepEqual(result.patch.statusHistory.map((event) => event.status), ["confirmee", "preparation"]);
  assert.deepEqual(result.patch.statusHistory, f.db.rows.get("orders/order-fast").statusHistory);
  assert.equal(f.state.revalidations.length, 0);
  assert.equal(f.state.adminChecks, 1);
});

test("admin : deux modifications issues du même état ne s'écrasent pas", async () => {
  const f = fixture({ "orders/race": customerOrder() });
  const action = f.load("lib/actions/orders.ts").updateOrderStatusAction;
  const responses = await Promise.all([action("race", "preparation", "confirmee"), action("race", "annulee", "confirmee")]);
  assert.equal(responses.filter((result) => result.ok).length, 1);
  assert.equal(f.db.rows.get("orders/race").status, "preparation");
  assert.match(responses[1].error, /entre-temps/);
});

test("admin : incident et modification tardive ne rouvrent jamais une livraison clôturée", async () => {
  const f = fixture({ "orders/closed": customerOrder({ status: "livree" }) });
  const action = f.load("lib/actions/orders.ts");
  assert.equal((await action.reportDeliveryIncidentAction("closed", "autre")).ok, false);
  assert.equal((await action.updateOrderStatusAction("closed", "reportee")).ok, false);
  assert.equal(f.db.rows.get("orders/closed").status, "livree");
});

test("admin : créneau et adresse renvoient leur valeur nettoyée sans relire le site", async () => {
  const f = fixture({ "orders/edit": customerOrder() });
  const action = f.load("lib/actions/orders.ts");
  assert.equal((await action.updateDeliverySlotAction("edit", "  Mardi 14 h–17 h  ")).patch.deliverySlot, "Mardi 14 h–17 h");
  assert.equal((await action.updateOrderAddressAction("edit", "  Akwa, Douala  ")).patch.address, "Akwa, Douala");
  assert.equal(f.state.revalidations.length, 0);
});

test("catalogue admin : contrôle de session avant les lectures serveur", async () => {
  const f = fixture({ "settings/site": { businessName: "IKIGAI" } });
  const catalog = f.load("lib/data/adminCatalog.ts");
  const [products, settings] = await Promise.all([catalog.getAllProducts(), catalog.getSiteSettings()]);
  assert.equal(products[0].slug, "maillot-test");
  assert.equal(settings.businessName, "IKIGAI");
  assert.equal(f.state.adminChecks, 2);
  f.mocks["@/lib/auth/dal"].verifyAdminSession = async () => { throw new Error("interdit"); };
  await assert.rejects(catalog.getAllProducts(), /interdit/);
});

test("mes commandes : projection minimale, code et avis au bon moment", () => {
  const { toCustomerOrderView } = fixture().load("lib/customerOrderView.ts");
  const raw = customerOrder({ id: "private", paymentReference: "secret-pay", deliveryIncidentNote: "note interne", reviewToken: "review-secret" });
  const prepared = toCustomerOrderView(raw, true);
  for (const field of ["uid", "customerPhone", "courierLocationToken", "locationToken", "deliveryIncidentNote", "paymentReference", "reviewToken"]) assert.equal(field in prepared, false, field);
  assert.equal(prepared.deliveryCode, null);
  assert.equal(prepared.reviewHref, null);
  assert.equal(toCustomerOrderView({ ...raw, status: "en_route" }, true).deliveryCode, "0042");
  assert.equal(toCustomerOrderView({ ...raw, status: "en_route" }).deliveryCode, null);
  const delivered = toCustomerOrderView({ ...raw, status: "livree" }, true);
  assert.equal(delivered.deliveryCode, null);
  assert.equal(delivered.reviewHref, "/avis/review-secret");
  assert.equal(toCustomerOrderView({ ...raw, status: "livree", reviewSubmitted: true }, true).reviewHref, null);
});

test("mes commandes : propriétaire uniquement, données jamais mises en cache", async () => {
  const f = fixture({ "orders/own": customerOrder(), "orders/foreign": customerOrder({ uid: "other" }) });
  const GET = f.load("app/api/customer/orders/route.ts").GET;
  const listing = await GET(new Request("https://test.invalid/api/customer/orders"));
  assert.equal(listing.status, 200);
  assert.match(listing.headers.get("Cache-Control"), /private, no-store/);
  assert.equal(listing.headers.get("Vary"), "Cookie");
  assert.deepEqual((await listing.json()).map((row) => row.id), ["own"]);
  const foreign = await GET(new Request("https://test.invalid/api/customer/orders?orderId=foreign"));
  const missing = await GET(new Request("https://test.invalid/api/customer/orders?orderId=missing"));
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
});

test("mes commandes : refuse une session révoquée avant de lire les données", async () => {
  const f = fixture();
  f.mocks["@/lib/auth/dal"].verifyCustomerSession = async () => { throw new f.mocks["@/lib/auth/dal"].AuthError("révoquée"); };
  f.db.collection = () => { throw new Error("Aucune lecture autorisée"); };
  assert.equal((await f.load("app/api/customer/orders/route.ts").GET(new Request("https://test.invalid/api/customer/orders"))).status, 401);
});

test("livraison : le scan confirmé apparaît dans le détail client et clôture le GPS", async () => {
  const f = fixture({ "orders/scan": customerOrder({ status: "arrivee", locationSharing: true, courierLocationSharing: true }) });
  const GET = f.load("app/api/customer/orders/route.ts").GET;
  const read = async () => (await GET(new Request("https://test.invalid/api/customer/orders?orderId=scan"))).json();
  const action = f.load("lib/actions/orders.ts").markOrderDeliveredByCourierAction;
  assert.equal((await read()).status, "arrivee");
  assert.equal((await action("courier-secret", "0000")).ok, false);
  assert.equal((await read()).status, "arrivee");
  assert.equal((await action("courier-secret", "0042")).ok, true);
  const detail = await read();
  assert.equal(detail.status, "livree");
  assert.equal(detail.history.at(-1).status, "livree");
  assert.equal(detail.history.at(-1).at, detail.deliveredAt);
  assert.equal(detail.deliveryCode, null);
  assert.match(detail.reviewHref, /^\/avis\//);
  assert.equal(f.db.rows.get("orders/scan").locationSharing, false);
  assert.equal(f.db.rows.get("orders/scan").courierLocationSharing, false);
});

test("suivi du compte : aucun lien avant le départ ni pour une commande tierce", async () => {
  const f = fixture({ "orders/not-ready": customerOrder(), "orders/other": customerOrder({ uid: "other", status: "en_route" }) });
  const action = f.load("lib/actions/customerTracking.ts").openCustomerTrackingAction;
  assert.equal((await action("not-ready")).ok, false);
  assert.equal((await action("other")).ok, false);
});

test("suivi du compte : crée une capacité client sans exposer celle du livreur", async () => {
  const f = fixture({ "orders/track": customerOrder({ status: "en_route", locationToken: null, deliveryCode: undefined }) });
  const action = f.load("lib/actions/customerTracking.ts").openCustomerTrackingAction;
  const result = await action("track");
  assert.equal(result.ok, true);
  assert.equal(result.href, (await action("track")).href);
  const row = f.db.rows.get("orders/track");
  assert.equal(result.href, `/livraison/${row.locationToken}`);
  assert.match(row.deliveryCode, /^\d{4}$/);
  assert.equal(row.courierLocationToken, "courier-secret");
  assert.equal(JSON.stringify(result).includes("courier-secret"), false);
});

test("chronologie : pas d'horaires de préparation inventés pour les anciennes commandes", () => {
  const { toCustomerOrderView, customerOrderTimeline } = fixture().load("lib/customerOrderView.ts");
  const timeline = customerOrderTimeline(toCustomerOrderView(customerOrder({ status: "en_route", trackingStartedAt: "2026-09-09T10:00:00.000Z" }), true));
  assert.equal(timeline[1].at, null);
  assert.equal(timeline[2].at, null);
  assert.equal(timeline[3].at, "2026-09-09T10:00:00.000Z");
  assert.equal(timeline[3].current, true);
  assert.equal(timeline[5].complete, false);
});

test("chronologie : report conserve les étapes observées sans confirmer la livraison", () => {
  const { toCustomerOrderView, customerOrderTimeline, customerOrderGroup } = fixture().load("lib/customerOrderView.ts");
  const view = toCustomerOrderView(customerOrder({ status: "reportee", deliverySlot: "Mardi, après-midi", statusHistory: [{ status: "en_route", at: "2026-09-09T10:00:00Z" }, { status: "reportee", at: "2026-09-09T10:30:00Z" }] }));
  assert.equal(customerOrderGroup(view), "scheduled");
  assert.equal(customerOrderTimeline(view).some((step) => step.current), false);
  assert.equal(customerOrderTimeline(view)[5].complete, false);
});

test("historique : borné et sans duplication du même état", () => {
  const patch = fixture().load("lib/orderStatusHistory.ts").orderStatusPatch;
  const history = Array.from({ length: 65 }, (_, i) => ({ status: i % 2 ? "preparation" : "confirmee", at: new Date(1700000000000 + i * 60000).toISOString() }));
  const result = patch(customerOrder({ statusHistory: history }), "prete", "2026-09-09T10:00:00Z");
  assert.equal(result.statusHistory.length, 60);
  assert.deepEqual(patch(customerOrder(result), "prete", "2026-09-09T10:01:00Z").statusHistory, result.statusHistory);
});

test("profil : seuls les champs autorisés du client authentifié sont modifiés", async () => {
  const f = fixture({ "customers/client-test": { name: "Avant", phone: "12345678", createdAt: "2026-01-01", note: "à conserver" }, "customers/other": { name: "Autre" } });
  const action = f.load("lib/actions/customers.ts").updateCustomerProfileAction;
  assert.equal((await action({ uid: "other", admin: true, name: "  Après  ", phone: "+237 600 000 002", defaultAddress: "  Douala, Akwa  " })).ok, true);
  const profile = f.db.rows.get("customers/client-test");
  assert.equal(profile.name, "Après");
  assert.equal(profile.phone, "237600000002");
  assert.equal(profile.defaultAddress, "Douala, Akwa");
  assert.equal(profile.createdAt, "2026-01-01");
  assert.equal(profile.note, "à conserver");
  assert.equal(profile.admin, undefined);
  assert.equal(f.db.rows.get("customers/other").name, "Autre");
  assert.equal((await action({ name: "", phone: "1", defaultAddress: "" })).ok, false);
});

test("profil : l'adresse enregistrée s'applique aux prochaines commandes seulement", async () => {
  const f = fixture({ "orders/old": customerOrder({ address: "Ancienne adresse" }) });
  await f.load("lib/actions/customers.ts").updateCustomerProfileAction({ name: "Client test", phone: "12345678", defaultAddress: "Nouvelle adresse" });
  const result = await f.load("lib/actions/orders.ts").createCustomerOrderAction({ items: [item(1)], requestId: "new-order-address-0001" });
  assert.equal(result.ok, true);
  assert.equal(f.db.rows.get(`orders/${result.id}`).address, "Nouvelle adresse");
  assert.equal(f.db.rows.get("orders/old").address, "Ancienne adresse");
});

test("API admin : lecture privée refusée sans session admin", async () => {
  const f = fixture();
  f.mocks["@/lib/auth/dal"].verifyAdminSession = async () => { throw new f.mocks["@/lib/auth/dal"].AuthError("interdit"); };
  const response = await f.load("app/api/admin/orders/route.ts").GET();
  assert.equal(response.status, 401);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});

test("état admin : refuse les clés héritées du prototype", async () => {
  const f = fixture({ "orders/invalid": customerOrder() });
  for (const status of ["toString", "constructor", "__proto__"]) {
    assert.equal((await f.load("lib/actions/orders.ts").updateOrderStatusAction("invalid", status)).ok, false);
  }
  assert.equal(f.db.rows.get("orders/invalid").status, "confirmee");
});

test("chronologie : ne confond pas heure de réception, confirmation et affectation", () => {
  const { toCustomerOrderView, customerOrderTimeline } = fixture().load("lib/customerOrderView.ts");
  const source = customerOrder({ status: "livreur_assigne", statusHistory: [{ status: "confirmee", at: "2026-09-08T12:00:00Z" }, { status: "livreur_assigne", at: "2026-09-09T10:30:00Z" }] });
  const timeline = customerOrderTimeline(toCustomerOrderView(source));
  assert.equal(timeline[0].at, source.createdAt);
  assert.equal(timeline[2].at, null);
});
