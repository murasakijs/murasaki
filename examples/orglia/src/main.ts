import { join } from "node:path";
import { defineMain } from "murasaki/main";
import { NATIVE_DEMO_PASSWORD } from "./lib/native-demo";

interface NativeStore {
	initializeTenant(
		tenantId: string,
		data: unknown,
		accounts: unknown[],
		passwordHash: string,
	): Promise<void>;
	close(): Promise<void>;
}
let nativeStore: NativeStore | undefined;

export default defineMain({
	async ready(context) {
		// MainContext.launch is the framework-owned cold-start contract. Do not use
		// process.argv here: packaged launchers and the dev passthrough normalize it.
		// Optional fallback keeps this example runnable against the published
		// 0.55.0 runtime while the workspace build carries the launch contract.
		const launch = (
			context as typeof context & { launch?: { argv: string[]; cwd: string } }
		).launch ?? { argv: [], cwd: context.projectRoot };
		const withSample = !launch.argv.includes("--no-sample-data");
		process.env.SQLITE_PATH = join(context.paths.data, "orglia.db");
		process.env.NO_SAMPLE_DATA = withSample ? "0" : "1";
		const hasConfiguredPassword = Boolean(
			process.env.ORGLIA_BOOTSTRAP_PASSWORD ||
				process.env.ORGLIA_BOOTSTRAP_PASSWORD_FILE,
		);
		if (context.isPackaged && !hasConfiguredPassword) {
			// A downloaded native demo must be usable by double-clicking it. This
			// fixed credential is confined to the local sample database and is
			// advertised in the renderer; the standalone self-host server retains
			// its fail-closed production secret requirement.
			process.env.ORGLIA_BOOTSTRAP_PASSWORD = NATIVE_DEMO_PASSWORD;
			process.env.ORGLIA_NATIVE_DEMO = "1";
		} else {
			delete process.env.ORGLIA_NATIVE_DEMO;
		}
		// These modules are JavaScript because the same implementation is executed
		// directly by the self-host Node server.
		// @ts-expect-error JavaScript server module intentionally has no declaration file.
		const { openStore } = await import("../server/storage.mjs");
		// @ts-expect-error JavaScript server module intentionally has no declaration file.
		const { accountsFor, bootstrapData, tenantIds } = await import("../server/sample-data.mjs");
		// @ts-expect-error JavaScript server module intentionally has no declaration file.
		const { hashPassword, readSecret } = await import("../server/auth.mjs");
		nativeStore = (await openStore({
			sqlitePath: join(context.paths.data, "orglia.db"),
		})) as NativeStore;
		const password = await readSecret("ORGLIA_BOOTSTRAP_PASSWORD", {
			developmentFallback: "orglia-demo-change-me",
		});
		const tenantId = tenantIds[0];
		const initial = bootstrapData(tenantId, withSample);
		await nativeStore.initializeTenant(
			tenantId,
			initial,
			accountsFor(initial),
			await hashPassword(password),
		);
		context.log.info("Orglia native storage initialized", {
			withSample,
			launchCwd: launch.cwd,
			database: join(context.paths.data, "orglia.db"),
		});
	},
	async shutdown({ log }) {
		await nativeStore?.close();
		nativeStore = undefined;
		log.info("Orglia native storage stopped");
	},
});
