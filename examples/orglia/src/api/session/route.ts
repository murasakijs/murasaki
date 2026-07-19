import type { RouteHandler } from 'murasaki'
// @ts-expect-error Shared self-host/native JavaScript adapter.
import { handleNativeApi } from '../../../server/native-api.mjs'
export const GET: RouteHandler = (request) => handleNativeApi(request)
