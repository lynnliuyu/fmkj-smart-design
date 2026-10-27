import { ProjectPresentation } from "@/components/projects/project-presentation"
import { resolveDocumentBrand } from "@/lib/document-brand"
import { listPlatformSettings } from "@/lib/platform-settings"

export default async function ProjectPresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const brand = resolveDocumentBrand(await listPlatformSettings())
  return <ProjectPresentation brand={brand} projectId={id} />
}
