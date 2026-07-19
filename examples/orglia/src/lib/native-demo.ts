export const NATIVE_DEMO_EMAIL = "admin@kanto.orglia.local";
export const NATIVE_DEMO_PASSWORD = "orglia-demo-change-me";

export function nativeDemoUsesBundledCredentials(
	env: Readonly<Record<string, string | undefined>>,
): boolean {
	return env.ORGLIA_NATIVE_DEMO === "1";
}
