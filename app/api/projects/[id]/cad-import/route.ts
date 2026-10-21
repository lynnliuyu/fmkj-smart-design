import { createCadImportApiHandlers } from "@/lib/cad-import-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const handlers = createCadImportApiHandlers()
export const POST = handlers.POST
