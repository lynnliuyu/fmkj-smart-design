import { ErrorState } from "@/components/errors/error-state"

export default function InternalServerErrorPage() {
  return <ErrorState kind="internal-server-error" />
}
