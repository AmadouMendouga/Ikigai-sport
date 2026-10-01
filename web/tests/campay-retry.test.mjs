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

async function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("CamPay : en production sans configuration, aucun appel ne part vers le bac à sable", async () => {
  const campay = loadCampay();
  const calls = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await withEnv({ VERCEL_ENV: "production", CAMPAY_BASE_URL: undefined, CAMPAY_PERMANENT_ACCESS_TOKEN: undefined }, () =>
      withFetch(async (url) => { calls.push(String(url)); return new Response("{}", { status: 200 }); }, async () => {
        // Refus certain (rien n'a été envoyé) : le stock peut être libéré.
        await assert.rejects(
          () => campay.campayCollect(input),
          (error) => error instanceof campay.CampayCollectError && error.outcome === "rejected"
        );
        await assert.rejects(() => campay.campayGetTransaction("provider-test"), campay.CampayConfigError);
      })
    );
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(calls, []);
});

test("CamPay : la production utilise l'adresse configurée, le hors-production garde le bac à sable", async () => {
  const campay = loadCampay();
  const calls = [];
  const complete = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ reference: "provider-test", ussd_code: "*126#", operator: "MTN" }), { status: 200 });
  };
  await withEnv({ VERCEL_ENV: "production", CAMPAY_BASE_URL: "https://paiement.test.invalid/", CAMPAY_PERMANENT_ACCESS_TOKEN: "jeton-de-test" }, () =>
    withFetch(complete, () => campay.campayCollect(input))
  );
  await withEnv({ VERCEL_ENV: "preview", CAMPAY_BASE_URL: undefined, CAMPAY_PERMANENT_ACCESS_TOKEN: undefined }, () =>
    withFetch(complete, () => campay.campayCollect(input))
  );
  assert.deepEqual(calls, ["https://paiement.test.invalid/api/collect/", "https://demo.campay.net/api/collect/"]);
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
