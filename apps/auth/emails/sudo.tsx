/** @file sudo.tsx @description React Email code preview. @module auth */
import { createElement } from "react";
import { AccountEmail } from "../src/emails/account-email.ts";
export default function Email() {
  return createElement(AccountEmail, {
    kind: "sudo",
    url: "",
    code: "482619",
    assetBaseURL: "http://localhost:5300/static",
  });
}
