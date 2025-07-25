import { Input, InvocationLink } from "@storacha/upload-api"
import { Result, Await } from "@ucanto/server"
import * as AccessCapabilities from "@storacha/capabilities/access"

export interface SSOFact {
  authProvider: string
  externalUserId: string
  externalSessionToken: string
}

export interface SSOAuthRequest {
  authProvider: string
  email: string
  externalUserId: string
  externalSessionToken: string
}

export interface SSOAuthResponse {
  userData: {
    id: string
    email: string
    emailVerified: boolean
    accountStatus: string
  }
}

/**
 * SSO service can authorize an user based on a SSO auth provider specified in the SSOAuthRequest.authProvider.
 */
export interface SSOService {
  authorize: (
    invocation: Input<typeof AccessCapabilities.authorize>['invocation'],
    ssoAuthRequest: SSOAuthRequest
  ) => Await<Result<InvocationLink, Error>>
}

/**
 * SSO provider can validate a SSO auth request.
 */
export interface SSOProvider {
  validate: (
    ssoAuthRequest: SSOAuthRequest
  ) => Await<Result<SSOAuthResponse, Error>>
}