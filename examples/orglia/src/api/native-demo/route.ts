import type { RouteHandler } from "murasaki";
import { nativeDemoUsesBundledCredentials } from "@/lib/native-demo";

export const GET: RouteHandler = async () => {
	if (!nativeDemoUsesBundledCredentials(process.env)) {
		return Response.json(
			{ enabled: false },
			{
				status: 404,
				headers: { "cache-control": "no-store" },
			},
		);
	}
	console.log("MURASAKI_ORGLIA_NATIVE_DEMO_READY=1");
	return Response.json(
		{ enabled: true },
		{
			headers: { "cache-control": "no-store" },
		},
	);
};
