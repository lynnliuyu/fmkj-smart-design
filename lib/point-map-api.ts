import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "./account-context"
import {
  getProjectPointMap,
  MAX_POINT_MAP_REQUEST_BYTES,
  MAX_POINT_MAP_REVISION,
  PointMapServiceError,
  saveProjectPointMap,
} from "./point-map-service"

type RouteContext = { params: Promise<{ id: string }> }
type Dependencies = {
  getContext?: typeof getCurrentAccountContext
  read?: typeof getProjectPointMap
  save?: typeof saveProjectPointMap
}

export function createPointMapApiHandlers(dependencies: Dependencies = {}) {
  return {
    async GET(request: Request, context: RouteContext) {
      try {
        const account = await (dependencies.getContext ?? getCurrentAccountContext)()
        if (!account) throw new PointMapServiceError("NOT_AUTHENTICATED", 401)
        const { id } = await context.params
        const versions = new URL(request.url).searchParams.getAll("version")
        let version: number | undefined
        if (versions.length) {
          version = Number(versions[0])
          if (versions.length !== 1 || !/^[1-9]\d*$/.test(versions[0]) || !Number.isSafeInteger(version) || version > MAX_POINT_MAP_REVISION) {
            throw new PointMapServiceError("INVALID_POINT_MAP_VERSION", 400)
          }
        }
        return privateJson(await (dependencies.read ?? getProjectPointMap)(account, id, version))
      } catch (error) {
        return pointMapApiErrorResponse(error)
      }
    },
    async PUT(request: Request, context: RouteContext) {
      try {
        const account = await (dependencies.getContext ?? getCurrentAccountContext)()
        if (!account) throw new PointMapServiceError("NOT_AUTHENTICATED", 401)
        const { id } = await context.params
        const input = await readLimitedJson(request)
        return privateJson(await (dependencies.save ?? saveProjectPointMap)(account, id, input))
      } catch (error) {
        return pointMapApiErrorResponse(error)
      }
    },
  }
}

export function pointMapApiErrorResponse(error: unknown) {
  if (error instanceof PointMapServiceError) {
    const body = error.status === 401 || error.status === 404
      ? { error: error.code }
      : { code: error.code, error: error.message, ...(error.revision === undefined ? {} : { revision: error.revision }) }
    return privateJson(body, error.status)
  }
  // Database diagnostics may contain customer data; keep them out of API responses.
  return privateJson({ error: "POINT_MAP_UNAVAILABLE" }, 503)
}

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
}

async function readLimitedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new PointMapServiceError("JSON_CONTENT_TYPE_REQUIRED", 415)
  }
  const declaredLength = Number(request.headers.get("content-length"))
  if (declaredLength > MAX_POINT_MAP_REQUEST_BYTES) throw new PointMapServiceError("POINT_MAP_TOO_LARGE", 413)
  const reader = request.body?.getReader()
  if (!reader) throw new PointMapServiceError("INVALID_JSON", 400)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let body = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_POINT_MAP_REQUEST_BYTES) {
        await reader.cancel()
        throw new PointMapServiceError("POINT_MAP_TOO_LARGE", 413)
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    body += decoder.decode()
    return JSON.parse(body)
  } catch (error) {
    if (error instanceof PointMapServiceError) throw error
    throw new PointMapServiceError("INVALID_JSON", 400)
  } finally {
    reader.releaseLock()
  }
}
