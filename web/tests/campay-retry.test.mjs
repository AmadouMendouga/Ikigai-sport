import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

function loadCampay() {
  const absolute = path.join(root, "lib/campay.ts");
  const source = fs.readFileSync(absolute, "utf8");
  const output = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const customRequire = (name) => {
    if (name === "server-only") return {};
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Dépendance non simulée : ${name}`);
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: absolute })(customRequire, mod, mod.exports);
  return mod.exports;
}

async function withFetch(fake, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

const input = {
  amount: 12000,
  from: "237690000000",
  description: "IKIGAI test",
  externalReference: "external-test",
};

test("CamPay : une panne réseau reste incertaine et ne doit pas autoriser un nouveau débit", async () => {
  const campay = loadCampay();
  await withFetch(async () => { throw new Error("timeout"); }, async () => {
    await assert.rejects(
      () => campay.campayCollect(input),
      (error) => error instanceof campay.CampayCollectError && error.outcome === "unknown"
    );
  });
});

test("CamPay : une erreur fournisseur 5xx reste incertaine", async () => {
  const campay = loadCampay();
  await withFetch(async () => new Response(JSON.stringify({ detail: "provider unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  }), async () => {
    await assert.rejects(
      () => campay.campayCollect(input),
      (error) => error instanceof campay.CampayCollectError && error.outcome === "unknown"
    );
  });
});

test("CamPay : un refus de validation 400 peut libérer la réservation", async () => {
  const campay = loadCampay();
  await withFetch(async () => new Response(JSON.stringify({ detail: "invalid phone" }), {
    status: 400,
    headers: { "content-type": "application/json" },
  }), async () => {
    await assert.rejects(
      () => campay.campayCollect(input),
      (error) => error instanceof campay.CampayCollectError && error.outcome === "rejected"
    );
  });
});

test("CamPay : une réponse 200 incomplète reste incertaine", async () => {
  const campay = loadCampay();
  await withFetch(async () => new Response(JSON.stringify({ reference: "provider-test" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }), async () => {
    await assert.rejects(
      () => campay.campayCollect(input),
      (error) => error instanceof campay.CampayCollectError && error.outcome === "unknown"
    );
  });
});

test("CamPay : une réponse complète est acceptée", async () => {
  const campay = loadCampay();
  await withFetch(async () => new Response(JSON.stringify({
    reference: "provider-test",
    ussd_code: "*126#",
    operator: "MTN",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }), async () => {
    const result = await campay.campayCollect(input);
    assert.equal(result.reference, "provider-test");
    assert.equal(result.ussd_code, "*126#");
  });
});
