import type { OAuth2ProxyResult } from '@backstage/plugin-auth-backend-module-oauth2-proxy-provider';
import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  AuthResolverContext,
  createSignInResolverFactory,
  OAuthAuthenticatorResult,
  SignInInfo,
} from '@backstage/plugin-auth-node';

import { decodeJwt } from 'jose';
import { z } from 'zod';

const KEYCLOAK_ID_ANNOTATION = 'keycloak.org/id';
const PING_IDENTITY_ID_ANNOTATION = 'pingidentity.org/id';

/**
 * Creates an OIDC sign-in resolver that looks up the user using a specific annotation key.
 *
 * @param annotationKey - The annotation key to match the user's `sub` claim.
 * @param providerName - The name of the identity provider to report in error message if the `sub` claim is missing.
 */
const createOidcSubClaimResolver = (userIdKey: string, providerName: string) =>
  createSignInResolverFactory({
    optionsSchema: z
      .object({
        dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
      })
      .optional(),
    create(options) {
      return async (
        info: SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>,
        ctx: AuthResolverContext,
      ) => {
        const sub = info.result.fullProfile.userinfo.sub;
        if (!sub) {
          throw new Error(
            `The user profile from ${providerName} is missing a 'sub' claim, likely due to a misconfiguration in the provider. Please contact your system administrator for assistance.`,
          );
        }

        const idToken = info.result.fullProfile.tokenset.id_token;
        if (!idToken) {
          throw new Error(
            `The user ID token from ${providerName} is missing a 'sub' claim, likely due to a misconfiguration in the provider. Please contact your system administrator for assistance.`,
          );
        }

        const subFromIdToken = decodeJwt(idToken)?.sub;
        if (sub !== subFromIdToken) {
          throw new Error(
            `There was a problem verifying your identity with ${providerName} due to a mismatching 'sub' claim. Please contact your system administrator for assistance.`,
          );
        }
        return ctx.signInWithCatalogUser(
          {
            annotations: { [userIdKey]: sub },
          },
          sub,
          options?.dangerouslyAllowSignInWithoutUserInCatalog,
        );
      };
    },
  });

/**
 * Additional sign-in resolvers for the Oidc auth provider.
 *
 * @public
 */
export namespace rhdhSignInResolvers {
  /**
   * An OIDC resolver that looks up the user using their Keycloak user ID.
   */
  export const oidcSubClaimMatchingKeycloakUserId = createOidcSubClaimResolver(
    KEYCLOAK_ID_ANNOTATION,
    'Keycloak',
  );

  /**
   * An OIDC resolver that looks up the user using their Ping Identity user ID.
   */
  export const oidcSubClaimMatchingPingIdentityUserId =
    createOidcSubClaimResolver(PING_IDENTITY_ID_ANNOTATION, 'Ping Identity');

  /**
   * An oauth2proxy resolver that looks up the user using the OAUTH_USER_HEADER environment variable,
   * 'x-forwarded-preferred-username' or 'x-forwarded-user'.
   */
  export const oauth2ProxyUserHeaderMatchingUserEntityName =
    createSignInResolverFactory({
      optionsSchema: z
        .object({
          dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
        })
        .optional(),
      create(options) {
        return async (
          info: SignInInfo<OAuth2ProxyResult>,
          ctx: AuthResolverContext,
        ) => {
          const name = process.env.OAUTH_USER_HEADER
            ? info.result.getHeader(process.env.OAUTH_USER_HEADER)
            : info.result.getHeader('x-forwarded-preferred-username') ||
              info.result.getHeader('x-forwarded-user');
          if (!name) {
            throw new Error('Request did not contain a user');
          }
          return ctx.signInWithCatalogUser(
            {
              entityRef: { name },
            },
            name,
            options?.dangerouslyAllowSignInWithoutUserInCatalog,
          );
        };
      },
    });
}
