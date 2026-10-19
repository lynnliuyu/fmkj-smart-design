import { ProjectPresentation } from "@/components/projects/project-presentation"

export default async function ProjectPresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectPresentation projectId={id} />
}
