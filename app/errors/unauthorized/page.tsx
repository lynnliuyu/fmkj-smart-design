import { ErrorState } from "@/components/errors/error-state"

export default function UnauthorizedPage() {
  return <ErrorState kind="unauthorized" />
}
