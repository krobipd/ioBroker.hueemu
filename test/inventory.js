"use strict";
// Generates the adapter's complete object inventory from fixtures and proves that
// an update reaches every object of an existing installation.
//
// Suite 1 "object inventory": start the adapter in the throwaway js-controller,
//   drive it with fixtures covering EVERY object hueemu can create
//   (feedFixtures), then dump every hueemu.0.* object to
//   test/objects.inventory.json in the ioBroker object-structure bot's format.
// Suite 2 "upgrade from the previous release" (only when INVENTORY_PREVIOUS is
//   set — pre-release.py exports the last tag's inventory): seed the previous
//   objects BEFORE start, start, feed, then assert that every object carries the
//   current name/desc/role/type/unit and that removed objects are gone.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { tests } = require("@iobroker/testing");

const ADAPTER_DIR = path.join(__dirname, "..");
const ADAPTER = require(path.join(ADAPTER_DIR, "io-package.json")).common.name;
const NS = `${ADAPTER}.0.`;
const INVENTORY = path.join(__dirname, "objects.inventory.json");
const VOLATILE = ["ts", "from", "user", "acl"];
const COMPARED = ["name", "desc", "role", "type", "unit"];
// Key order carries no meaning in an ioBroker object: extendObject keeps the key order an existing
// object already has, while adapter-core's I18n.getTranslatedObject builds its own — the same eleven
// texts in another order are the same name. Arrays keep their order.
const canonical = v =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map(k => [k, x[k]]),
        )
      : x,
  );

/** A port the emulator can bind in CI without colliding with anything real. */
const FIXTURE_PORT = 18080;
/** The HTTPS listener — on, so the start proves the stored TLS key is read back (v1.19.0). */
const FIXTURE_HTTPS_PORT = 18443;
/** A fixed pairing key — a generated UUID would make the inventory differ per run. */
const FIXTURE_CLIENT_KEY = "inventory-fixture-client";
/** Where the fixture's source datapoints live — outside the adapter's namespace, like a real device. */
const SRC = "javascript.0.inv.";

/**
 * The source datapoints the lights bind: real objects with the facts a real adapter
 * declares, so the start derives every scale from them the way it does on an
 * installation — not only reads a configuration (audit 2026-09-25 Q33). One source per
 * scale hueemu knows, including the percent colour temperature of ioBroker.tradfri.
 * `[id suffix, common, value]`.
 */
const SOURCES = [
  ["on", { type: "boolean", role: "switch.light" }, true],
  ["bri", { type: "number", role: "level.dimmer", min: 0, max: 100, unit: "%" }, 50],
  ["ct", { type: "number", role: "level.color.temperature", min: 2000, max: 6500, unit: "K" }, 4000],
  ["hue", { type: "number", role: "level.color.hue", min: 0, max: 360, unit: "°" }, 120],
  ["sat", { type: "number", role: "level.color.saturation", min: 0, max: 100, unit: "%" }, 100],
  ["xy", { type: "string", role: "level.color.cie" }, "[0.3,0.4]"],
  // A dimmer WITHOUT a switch (HomeMatic LEVEL): 0..1, on/off follows the level.
  ["level", { type: "number", role: "level.dimmer", min: 0, max: 1 }, 0.5],
  // A colour temperature in percent (ioBroker.tradfri: "0% = cold, 100% = warm").
  ["ctpct", { type: "number", role: "level.color.temperature", min: 0, max: 100, unit: "%" }, 50],
  // A colour temperature in mired without unit or bounds (the zigbee adapter).
  ["ctmired", { type: "number", role: "level.color.temperature" }, 300],
  // A 0..255 brightness.
  ["bri255", { type: "number", role: "level.dimmer", min: 0, max: 255 }, 255],
];

/**
 * Adapter-specific config the fixtures need. One light of EVERY supported type
 * and of every scale path — declared, derived from the source object, and without
 * any evidence — so the configuration the adapter starts with is the full matrix.
 * The lights themselves live in `native`, not in the object tree, but a broken
 * mapping would stop the start and the inventory would come out empty.
 *
 * Every light carries its permanent number (`id`, v1.18.0): the fixture is the
 * MIGRATED shape. A start-up migration that writes `native` stops the start and
 * waits for a restart the harness never performs — the bridge would stay silent
 * and the dump would time out. For the same reason the TLS material is stored
 * up front, encrypted the way js-controller stores `encryptedNative` (see
 * {@link configureInstance}).
 */
const FIXTURE_NATIVE = {
  bind: "0.0.0.0",
  port: FIXTURE_PORT,
  httpsPort: FIXTURE_HTTPS_PORT,
  udn: "12345678-1234-1234-1234-123456789abc",
  mac: "AA:BB:CC:DD:EE:FF",
  trustProxy: false,
  lastLightId: 9,
  devices: [
    { id: 1, name: "Inventory on/off", lightType: "onoff", onState: `${SRC}on` },
    {
      id: 2,
      name: "Inventory dimmable",
      lightType: "dimmable",
      onState: `${SRC}on`,
      briState: `${SRC}bri`,
      briScale: "percent",
    },
    {
      id: 3,
      name: "Inventory colour temperature",
      lightType: "ct",
      onState: `${SRC}on`,
      briState: `${SRC}bri`,
      ctState: `${SRC}ct`,
      ctScale: "kelvin",
    },
    {
      id: 4,
      name: "Inventory colour",
      lightType: "color",
      onState: `${SRC}on`,
      briState: `${SRC}bri`,
      hueState: `${SRC}hue`,
      hueScale: "degrees",
      satState: `${SRC}sat`,
      satScale: "percent",
      xyState: `${SRC}xy`,
    },
    // Scales left open: the start derives them from the source objects.
    { id: 5, name: "Inventory dimmer without switch", lightType: "dimmable", briState: `${SRC}level` },
    {
      id: 6,
      name: "Inventory percent colour temperature",
      lightType: "ct",
      onState: `${SRC}on`,
      ctState: `${SRC}ctpct`,
    },
    {
      id: 7,
      name: "Inventory mired colour temperature",
      lightType: "ct",
      onState: `${SRC}on`,
      ctState: `${SRC}ctmired`,
    },
    { id: 9, name: "Inventory byte brightness", lightType: "dimmable", onState: `${SRC}on`, briState: `${SRC}bri255` },
  ],
};

/**
 * What the bridge must report for the derived lights — the proof that the scales came
 * from the source objects. `[light id, attribute, expected]`.
 */
const EXPECTED_LIGHT_STATE = [
  ["5", "bri", 127], // 0.5 on a 0..1 source
  ["5", "on", true], // no switch: on follows the level
  ["6", "ct", 327], // 50 % across 153..500 mired
  ["7", "ct", 300], // mired passes through
  ["9", "bri", 254], // 255 of 0..255 is full brightness
];

/**
 * Create the source datapoints the lights bind, with their values.
 *
 * @param {import("@iobroker/testing").TestHarness} harness
 */
async function seedSources(harness) {
  for (const [suffix, common, val] of SOURCES) {
    const id = `${SRC}${suffix}`;
    await harness.objects.setObjectAsync(id, {
      type: "state",
      common: { name: suffix, read: true, write: true, ...common },
      native: {},
    });
    await harness.states.setStateAsync(id, { val, ack: true });
  }
}

/** The certificate the fixture serves HTTPS with — generated once per run. */
let fixtureTls;

/**
 * Encrypt a value the way js-controller's `encrypt` does for an `encryptedNative`
 * setting (`tools.encrypt`, js-controller-common-db 7.2.2: AES-192-CBC with the
 * installation secret, `$/aes-192-cbc:<iv>:<ciphertext>`) — the form the adapter
 * itself writes since v1.19.0. The harness' own `encryptValue` still produces the
 * legacy XOR form without the prefix.
 *
 * @param {import("@iobroker/testing").TestHarness} harness
 * @param {string} value
 */
async function encryptLikeController(harness, value) {
  const crypto = require("node:crypto");
  const secret = await harness.getSystemSecret();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-192-cbc", Buffer.from(secret, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return `$/aes-192-cbc:${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Configure the instance for this run: the fixture above plus a TLS pair whose key is
 * stored encrypted the way js-controller's `encrypt` stores an `encryptedNative` value —
 * the form the adapter itself writes since v1.19.0. Written straight into the instance
 * object: the harness' `changeAdapterConfig` encrypts `encryptedNative` fields on its
 * own (legacy XOR form), a pre-encrypted value would come out encrypted twice. Before
 * v1.19.0 the adapter stored the key in plaintext, the decryption at start turned it
 * into garbage, and every start regenerated and restarted — the bridge never came up
 * (audit 2026-09-25 K1).
 *
 * @param {import("@iobroker/testing").TestHarness} harness
 */
async function configureInstance(harness) {
  if (!fixtureTls) {
    fixtureTls = require(path.join(ADAPTER_DIR, "build/lib/tls-material.js")).generateCertificate();
  }
  await harness.changeAdapterConfig(ADAPTER, { native: { ...FIXTURE_NATIVE, tlsCert: fixtureTls.cert } });
  const id = `system.adapter.${ADAPTER}.0`;
  const instance = await harness.objects.getObjectAsync(id);
  instance.native.tlsKey = await encryptLikeController(harness, fixtureTls.key);
  await harness.objects.setObjectAsync(id, instance);
}

/**
 * The HTTPS listener answers — a certificate the bridge could not read back would
 * have stopped the start before either port was bound.
 */
async function httpsAnswers() {
  const https = require("node:https");
  return new Promise(resolve => {
    const req = https.get(
      { host: "127.0.0.1", port: FIXTURE_HTTPS_PORT, path: "/description.xml", rejectUnauthorized: false },
      res => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", () => resolve(0));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

/**
 * Wait until the emulated bridge answers on its HTTP port.
 *
 * @param {number} timeoutMs how long to keep trying
 */
async function waitForBridge(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/description.xml`);
      if (res.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`the bridge did not answer on port ${FIXTURE_PORT} within ${timeoutMs} ms`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

/**
 * Adapter-specific: make the adapter create every object it can create.
 *
 * hueemu's tree is its two switches, the serving indicator and one object per
 * PAIRED CLIENT — and a client object only ever appears when a real Hue client
 * pairs. So the fixture is a real pairing: press the virtual link button, then
 * POST /api the way an Echo or a Harmony Hub does. The key is fixed, otherwise
 * the generated UUID would make two runs differ.
 *
 * @param {import("@iobroker/testing").TestHarness} harness
 */
async function feedFixtures(harness) {
  await waitForBridge();
  // The virtual link button — an ack:false write is what a user does in the admin.
  await harness.states.setStateAsync(`${NS}startPairing`, { val: true, ack: false });
  await new Promise(resolve => setTimeout(resolve, 500));

  const res = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/api`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ devicetype: "inventory#fixture", username: FIXTURE_CLIENT_KEY }),
  });
  const body = await res.json();
  assert.ok(Array.isArray(body) && body[0] && body[0].success, `pairing did not succeed: ${JSON.stringify(body)}`);
  // The object is written asynchronously right after the response — wait for the tree to
  // stop growing rather than trusting a fixed moment.
  await new Promise(resolve => setTimeout(resolve, 1000));
  await waitForStableTree(harness);
}

/**
 * Wait until the object tree has stopped growing for a second. The fire-and-forget writes
 * above have no completion signal the harness could wait on; on the GitHub runner a sibling
 * harness (homewizard, 2026-09-15) dumped while such writes were still in flight and lost
 * two objects. A quiet window is the settle check beszel and govee-smart already use.
 *
 * @param {import("@iobroker/testing").TestHarness} harness The harness.
 */
async function waitForStableTree(harness) {
  const count = async () => (await harness.objects.getObjectList({ startkey: NS, endkey: `${NS}香` })).rows.length;
  const deadline = Date.now() + 60000;
  let previous = await count();
  for (;;) {
    let stable = true;
    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const now = await count();
      if (now !== previous) {
        previous = now;
        stable = false;
        break;
      }
    }
    if (stable) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`object tree did not settle (last count ${previous})`);
    }
  }
}

/**
 * Dump every object of the adapter's namespace in the bot's format.
 *
 * @param {import("@iobroker/testing").TestHarness} harness
 */
/**
 * Remove every object of this adapter's instance so the run starts on an empty
 * tree. See the call site for why the coarser variants do not work.
 *
 * @param harness The integration harness.
 */
async function wipeAdapterObjects(harness) {
  const list = await harness.objects.getObjectList({ startkey: NS, endkey: `${NS}\u9999` });
  for (const row of list.rows) {
    await harness.objects.delObjectAsync(row.id);
  }
}

async function dumpObjects(harness) {
  // The range starts at "<adapter>.0." — the instance root object itself is not part of the tree.
  const list = await harness.objects.getObjectList({ startkey: NS, endkey: `${NS}香` });
  const out = {};
  for (const row of list.rows.sort((a, b) => a.id.localeCompare(b.id))) {
    const obj = { ...row.value };
    for (const key of VOLATILE) {
      delete obj[key];
    }
    out[row.id] = obj;
  }
  return out;
}

tests.integration(ADAPTER_DIR, {
  controllerVersion: "stable",
  defineAdditionalTests({ suite }) {
    suite("object inventory", getHarness => {
      let harness;
      before(async function () {
        this.timeout(120000);
        harness = getHarness();
        // Wipe every <adapter>.0.* object BEFORE the start. The harness keeps its
        // throwaway js-controller between runs and its DB reset does not reach
        // these: measured 2026-09-06, `clients` arrived as `meta` from a run that
        // predates the folder switch, so the adapter only MIGRATED it and the path
        // the inventory is meant to show — fresh creation — never ran. The
        // inventory is the reference for the upgrade comparison and for the diff
        // against the previous release, so it must show what the CURRENT code
        // produces on an empty installation.
        // Only these objects go: removing `iobroker-data` takes the harness' own
        // `iobroker.json` with it (ENOENT on the next start), and removing the
        // whole directory forces a js-controller reinstall that ran past the
        // release gate's 15-minute budget.
        await wipeAdapterObjects(harness);
        await seedSources(harness);
        await configureInstance(harness);
        await harness.startAdapterAndWait();
        await feedFixtures(harness);
      });

      it("writes test/objects.inventory.json", async function () {
        this.timeout(30000);
        const objects = await dumpObjects(harness);
        assert.ok(Object.keys(objects).length > 0, "no objects created — fixtures did not reach the adapter");
        assert.ok(
          objects[`${NS}clients.${FIXTURE_CLIENT_KEY}`],
          "the paired client object is missing — the pairing fixture did not reach the adapter",
        );
        fs.writeFileSync(INVENTORY, `${JSON.stringify(objects, null, 2)}\n`);
      });

      it("reports the bridge as answering", async function () {
        this.timeout(30000);
        const connection = await harness.states.getStateAsync(`${NS}info.connection`);
        assert.strictEqual(connection && connection.val, true, "info.connection is not true while serving");
        const error = await harness.states.getStateAsync(`${NS}info.error`);
        assert.strictEqual(error && error.val, "", "info.error is not empty while serving");
      });

      // v1.19.0 (audit 2026-09-25 K1): the stored TLS key is read back — the bridge
      // serves HTTPS and nothing was regenerated (a regeneration writes native and
      // restarts the instance before either port is bound).
      it("serves HTTPS with the stored, encrypted certificate", async function () {
        this.timeout(30000);
        assert.strictEqual(await httpsAnswers(), 200, "the HTTPS listener does not answer");
        // Read raw — the harness' getAdapterConfig assumes the legacy XOR form.
        const instance = await harness.objects.getObjectAsync(`system.adapter.${ADAPTER}.0`);
        const stored = instance && instance.native;
        assert.ok(stored && String(stored.tlsKey).startsWith("$/aes-192-cbc:"), "the TLS key is not stored encrypted");
        assert.strictEqual(stored.tlsCert, fixtureTls.cert, "the certificate was regenerated");
      });

      // Audit 2026-09-25 Q33: the lights are asked for, not only configured — the
      // scales the start derived from the source objects decide what a client sees.
      it("serves every configured light with the values its source proves", async function () {
        this.timeout(30000);
        const res = await fetch(`http://127.0.0.1:${FIXTURE_PORT}/api/${FIXTURE_CLIENT_KEY}/lights`);
        const lights = await res.json();
        assert.deepStrictEqual(
          Object.keys(lights).sort(),
          FIXTURE_NATIVE.devices.map(d => String(d.id)).sort(),
          "the bridge does not list every configured light under its permanent number",
        );
        for (const [id, attr, expected] of EXPECTED_LIGHT_STATE) {
          assert.strictEqual(lights[id].state[attr], expected, `light ${id} ${attr}`);
        }
        for (const [id, light] of Object.entries(lights)) {
          assert.strictEqual(light.state.reachable, true, `light ${id} is not reachable`);
        }
      });
    });

    const previousFile = process.env.INVENTORY_PREVIOUS;
    if (previousFile && fs.existsSync(previousFile)) {
      suite("upgrade from the previous release", getHarness => {
        let harness;
        const previous = JSON.parse(fs.readFileSync(previousFile, "utf8"));
        before(async function () {
          this.timeout(120000);
          harness = getHarness();
          // The harness registers its own before() (fresh DB) ahead of this one,
          // so the seed survives and the adapter starts on top of the OLD objects.
          for (const [id, obj] of Object.entries(previous)) {
            await harness.objects.setObjectAsync(id, obj);
          }
          await seedSources(harness);
          await configureInstance(harness);
          await harness.startAdapterAndWait();
          await feedFixtures(harness);
        });

        it("every current object carries the current texts and roles", async function () {
          this.timeout(30000);
          const current = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
          const live = await dumpObjects(harness);
          const stale = [];
          for (const [id, obj] of Object.entries(current)) {
            const got = live[id];
            if (!got) {
              stale.push(`${id}: missing after upgrade`);
              continue;
            }
            // The object TYPE itself, not only common.* — v1.17.0 turns the
            // `clients` folder from `meta` into `folder` (repochecker E2001 for
            // every state below it). A common-only comparison cannot see a
            // failed type migration: every text would match while the tree
            // stays wrong.
            if (got.type !== obj.type) {
              stale.push(`${id}: type still ${JSON.stringify(got.type)}, want ${JSON.stringify(obj.type)}`);
            }
            for (const f of COMPARED) {
              if (canonical(got.common?.[f]) !== canonical(obj.common?.[f])) {
                stale.push(`${id}: ${f} still ${JSON.stringify(got.common?.[f])}`);
              }
            }
          }
          assert.deepStrictEqual(stale, [], `objects an update did not reach:\n${stale.join("\n")}`);
        });

        it("objects the release removed are gone (no leftovers)", async function () {
          this.timeout(30000);
          const current = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
          const live = await dumpObjects(harness);
          const leftovers = Object.keys(previous).filter(id => !(id in current) && id in live);
          assert.deepStrictEqual(leftovers, [], `leftover objects:\n${leftovers.join("\n")}`);
        });
      });
    }
  },
});
