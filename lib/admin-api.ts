import { adminAuthErrorResponse } from "./admin-auth"
import { platformValidationErrorResponse } from "./account-system/platform-admin-service"
import { platformSettingsErrorResponse } from "./platform-settings"
import { productValidationErrorResponse } from "./product-admin-service"

export function adminApiErrorResponse(error: unknown) {
  try {
    return adminAuthErrorResponse(error)
  } catch (authError) {
    try {
      return platformValidationErrorResponse(authError)
    } catch (validationError) {
      try {
        return platformSettingsErrorResponse(validationError)
      } catch (settingsError) {
        try {
          return productValidationErrorResponse(settingsError)
        } catch (productError) {
          throw productError
        }
      }
    }
  }
}
