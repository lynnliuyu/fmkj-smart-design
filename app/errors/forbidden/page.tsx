import { ErrorState } from "@/components/errors/error-state"

export default function ForbiddenPage() {
  return <ErrorState kind="forbidden" />
}
