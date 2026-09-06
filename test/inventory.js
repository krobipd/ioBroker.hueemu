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

/** A port the emulator can bind in CI without colliding with anything real. */
const FIXTURE_PORT = 18080;
/** A fixed pairing key — a generated UUID would make the inventory differ per run. */
const FIXTURE_CLIENT_KEY = "inventory-fixture-client";

/**
 * Adapter-specific config the fixtures need. One light of EVERY supported type,
 * so the configuration the adapter starts with is the full matrix — the lights
 * themselves live in `native`, not in the object tree, but a broken mapping
 * would stop the start and the inventory would come out empty.
 */
const FIXTURE_NATIVE = {
  host: "0.0.0.0",
  port: FIXTURE_PORT,
  httpsPort: "",
  udn: "12345678-1234-1234-1234-123456789abc",
  mac: "AA:BB:CC:DD:EE:FF",
  trustProxy: false,
  devices: [
    { name: "Inventory on/off", lightType: "onoff", onState: "javascript.0.inv.on" },
    {
      name: "Inventory dimmable",
      lightType: "dimmable",
      onState: "javascript.0.inv.on",
      briState: "javascript.0.inv.bri",
      briScale: "percent",
    },
    {
      name: "Inventory colour temperature",
      lightType: "ct",
      onState: "javascript.0.inv.on",
      briState: "javascript.0.inv.bri",
      ctState: "javascript.0.inv.ct",
      ctScale: "kelvin",
    },
    {
      name: "Inventory colour",
      lightType: "color",
      onState: "javascript.0.inv.on",
      briState: "javascript.0.inv.bri",
      hueState: "javascript.0.inv.hue",
      hueScale: "degrees",
      satState: "javascript.0.inv.sat",
      satScale: "percent",
      xyState: "javascript.0.inv.xy",
    },
  ],
};

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
  // The object is written asynchronously right after the response.
  await new Promise(resolve => setTimeout(resolve, 1000));
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
        await harness.changeAdapterConfig(ADAPTER, { native: FIXTURE_NATIVE });
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
          await harness.changeAdapterConfig(ADAPTER, { native: FIXTURE_NATIVE });
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
              if (JSON.stringify(got.common?.[f]) !== JSON.stringify(obj.common?.[f])) {
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
