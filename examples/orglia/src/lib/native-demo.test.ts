import { describe, expect, it } from "vitest";
import {
	NATIVE_DEMO_EMAIL,
	NATIVE_DEMO_PASSWORD,
	nativeDemoUsesBundledCredentials,
} from "./native-demo";

describe("native demo credentials", () => {
	it("are enabled only by the packaged main-process marker", () => {
		expect(nativeDemoUsesBundledCredentials({ ORGLIA_NATIVE_DEMO: "1" })).toBe(
			true,
		);
		expect(nativeDemoUsesBundledCredentials({})).toBe(false);
		expect(
			nativeDemoUsesBundledCredentials({ ORGLIA_NATIVE_DEMO: "true" }),
		).toBe(false);
	});

	it("identify the seeded local administrator account", () => {
		expect(NATIVE_DEMO_EMAIL).toBe("admin@kanto.orglia.local");
		expect(NATIVE_DEMO_PASSWORD.length).toBeGreaterThanOrEqual(16);
	});
});
