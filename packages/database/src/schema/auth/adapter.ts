import { userInQuorem_auth, accountInQuorem_auth, sessionInQuorem_auth, verificationInQuorem_auth, jwksInQuorem_auth, passkeyInQuorem_auth } from './index.ts';

export const authAdapterSchema = {
  user: userInQuorem_auth,
  account: accountInQuorem_auth,
  session: sessionInQuorem_auth,
  verification: verificationInQuorem_auth,
  jwks: jwksInQuorem_auth,
  passkey: passkeyInQuorem_auth,
};
