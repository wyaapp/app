# Hosted Premium and self-hosting

Product decision, October 26, 2026: offer one **Premium subscription per account**, with Stripe and USD base pricing plus an explicit localized BRL price. The approved launch prices are **US$2.99/month** and **R$9.99/month**, accepted while the service has no paying audience. There is no annual offer at launch. See [the cost model](./hosted-pricing-costs.md) for the assumptions and remaining cost risks. Do not offer a separate subscription for each small feature.

| Installation / plan | Spaces per account | Custom domains |
| --- | --- | --- |
| Hosted Free | 2 | Not included |
| Hosted Premium | 10 | Included, one domain per space |
| Self-hosted | No plan-based cap | Included, free forever |

Self-hosting has no paid license, payment account requirement, or feature restriction. Operators still configure their own domain provider, DNS and hosting resources. Operational safeguards such as mutation limits and document size limits remain in place.

## Account access

Use the account's stable user ID for both the Stripe customer and Premium access. Premium applies to every space that account owns. A handle or email address is not a purchase identity. The customer brings a domain they already own; domain registration and renewal are separate.

`WYA_HOSTING_MODE` is trusted server configuration: `hosted` or `self-hosted`, defaulting to self-hosted. An unknown nonempty value is an error. Self-hosted requests do not read billing state. The production hosted configuration must explicitly select `hosted`.

The private `account_plans` projection contains `user_id`, `premium_until` and `updated_at`, with times in Unix milliseconds. Only verified server-side subscription processing writes it. A future access deadline grants Premium; expiration is enforced even if a renewal webhook has not arrived. Neither public profile JSON, revision restores nor browser input can grant a plan.

Hosted space creation counts existing spaces and reads current access in the same conditional SQL insert. Concurrent creates cannot claim the same last slot. Expiry or downgrade preserves all existing spaces, editing and history, including accounts already over the Free allowance; it blocks further creation until they are below the applicable limit or upgrade. Self-hosting removes the previous five-space restriction.

## Payments and domain readiness

Payment grants permission to use custom domains. Serving one still requires verified domain control, active HTTPS, correct DNS and a fresh verification check. Keep `space_domains` provider state separate from billing state. A successful payment cannot bypass ownership checks.

Use Stripe hosted Checkout for purchasing Premium and its customer portal for billing details, invoices and cancellation. Create sessions on the canonical authenticated Wya origin. Select the stored customer and configured USD/BRL price on the server; never treat a browser-supplied customer, subscription, plan, price or limit as authorization. Prevent duplicate purchases for an account that already has Premium. See [subscription Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions) and [customer portal](https://docs.stripe.com/customer-management).

The checkout success URL is not proof of payment. Verify event signatures using the raw request body, durably accept events, deduplicate delivery and reconcile current subscription state. Delayed or reordered events must not overwrite newer entitlement state. Stripe retries failed webhook deliveries; opening account billing also reconciles current provider state. Scheduled billing reconciliation is not implemented and remains a follow-up for recovering missed events without an account visit. See [Stripe webhooks](https://docs.stripe.com/webhooks) and [subscription lifecycle events](https://docs.stripe.com/billing/subscriptions/webhooks).

Visitors use the local access projection and domain state, never a Stripe request. Cache entries must carry the access deadline and cannot remain active beyond it. An immediate revocation invalidates local entries and is visible to other isolates within the bounded routing cache TTL.

## Cancellation and recovery

- Cancellation at period end retains Premium until the paid-through deadline. Free Wya addresses and existing content remain available afterward.
- At expiry, custom-domain routing and Wya-to-custom-domain redirects stop. Preserve the hostname claim and setup so renewal can restore it after fresh ownership and provider checks. Provider cleanup is retryable background work.
- A failed renewal needs a deliberate grace policy; its duration is not decided. Do not quietly invent extra paid access in frontend code.
- Removing a domain or a space does not cancel account-wide Premium. Cancellation belongs in account billing management, with clear confirmation of its effects.
- Existing connected domains need an explicit transition policy before hosted billing enforcement goes live. Migration 0015 does not create Premium grants; without an approved transition, those hosted domains would become unavailable to visitors. No migration deletes their content. Resolve the transition before deployment.

## Release decisions still required

Confirm Stripe tax/configuration choices, payment-failure grace and the transition policy for current users. Configure exactly two monthly Stripe Prices with `unit_amount=299` in USD and `unit_amount=999` in BRL; the server rejects a currency, amount or recurrence mismatch. The dashboard can display these approved prices before checkout is enabled. Currency choice is currently available to every account; no Brazil-only eligibility rule has been approved or implemented. Configure test-mode prices and verify checkout, duplicate purchase protection, signed duplicate/reordered events, renewal, failed payment, cancellation, recovery, and account isolation before enabling production payments. The provider configuration, deployment and production migrations require a separately approved release.
