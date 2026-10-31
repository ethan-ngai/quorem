# Case teardown namespace fence

Issue #432. Case DELETE now requires the same actual namespace pin and scope as POST, before invoking the case Durable Object. The zero bootstrap sentinel cannot authorize either mutation. A stale cleanup must target the actual pinned namespace; an unconfirmed deletion remains unconfirmed.

Node ingress tests pass 7/7, including no forwarding for wrong scope, mismatched pin and zero sentinel, and a real CaseSandbox full-attempt deletion with signed proof and a durable tombstone rejecting a later POST after object recreation. Native workerd tests pass 3/3, including no forwarding on wrong pin/scope and signature verification for a valid forwarded DELETE. The native fixture has no actual container, so the live CaseSandbox teardown test uses the Node fixture. API typecheck passes. Hosted namespace and teardown behavior remain unverified.
