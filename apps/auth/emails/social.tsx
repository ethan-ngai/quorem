/** @file social.tsx @description React Email preview. @module auth */
import { createElement } from "react";
import { AccountEmail } from "../src/emails/account-email.ts";

export default function Email() {
  return createElement(AccountEmail, {
    kind: "social",
    assetBaseURL: "http://localhost:5300/static",
    url: "http://localhost:5180/login?preview=social",
  });
}
