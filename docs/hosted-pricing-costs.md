# Hosted Premium cost model

Checked October 26, 2026. **Approved launch prices: US$2.99/month and R$9.99/month. No annual offer.** Premium has a ten-space creation limit and permits one custom domain per space; Free includes two spaces. Self-hosting remains free with all features. Existing excess spaces are retained after a hosting-mode migration, so ten domains is a normal-use scenario, not an unconditional account-wide domain cap. Provider prices below are public list rates, not an invoice forecast. The launch prices are an early-stage product decision, not a guarantee of profitability.

## What is actually known

A read-only Cloudflare dashboard check on October 26 showed the account on **Workers Free**, with $0 incurred in its October 24-November 24 period. The account reported approximately 3.34k requests and 95.88k CPU milliseconds so far. It also hosts another application, so those totals are not Wya-only. This short development sample cannot establish per-customer production cost. The owner confirmed that the Stripe business is registered in **Brazil**. Resend/PostHog subscription tiers, any negotiated Stripe fees and actual USD settlement/conversion terms still need confirmation.

Wya-specific last-24-hour observations were approximately 1.98k Worker invocations with no errors, and D1 at 8k queries, 58k rows read, 154 rows written and 1.64MB stored. D1 metadata inspection alone accounted for about 4,407 queries and 37.06k rows read, so administrative work materially affects the sample. The pictures bucket contained 8.62kB in R2 Standard storage. A deployed-version CPU median of 14.32ms is not the arithmetic mean required for billing estimates.

For a paid hosted service, model a potential Workers Paid upgrade explicitly rather than treating its $5 minimum as an existing bill. Free has 100k Worker requests/day and 10ms CPU per invocation; exceeding a daily allowance is an availability issue, not a useful pricing strategy. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Infrastructure rates

Included allowances apply across the relevant account/plan scope, **once**, not once per Wya customer.

| Service | Included / baseline | Additional usage |
| --- | --- | --- |
| Workers Paid | $5/month; 10M requests; 30M CPU ms | $0.30/M requests; $0.02/M CPU ms |
| Cloudflare for SaaS | 100 custom hostnames | $0.10/hostname/month |
| D1 on Workers Paid | 25B rows read; 50M rows written; 5GB | $0.001/M read; $1/M written; $0.75/GB-month |
| R2 Standard | 10GB-month; 1M class A; 10M class B operations | $0.015/GB-month; $4.50/M A; $0.36/M B; internet egress free |
| Queues on Workers Paid | 1M operations/month | $0.40/M operations |

Sources: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/) and [monthly hostname price](https://blog.cloudflare.com/waf-for-saas), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Queues](https://developers.cloudflare.com/queues/platform/pricing/).

Pending provider hostnames count until deleted, so use provisioned hostnames rather than successful connections in the bill. Standard SaaS plans list a 50,000-hostname maximum; the quota endpoint identifies the applicable account/zone scope. Ten provisioned domains therefore add **$1/month of marginal hostname cost per Premium account** after the shared allowance, before traffic or support. Migrated accounts retaining more than ten spaces can currently connect additional domains and require a separate transition decision. [Hostname billing](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/quotas-and-billing/)

A healthy domain currently receives roughly four checks/day. In a 30-day month, 120 checks times the usual three Queue operations is approximately 360 operations/domain: $0.000144 beyond the included operations. Retries and pending verification add work; Worker CPU and D1 writes are separate. [Queue operation accounting](https://developers.cloudflare.com/queues/platform/pricing/)

D1 charges scanned and written rows, including affected index entries, rather than SQL statement count. Measure its `meta.rows_read`/`rows_written`; do not assume a cached domain lookup eliminates profile, file or analytics reads. [D1 billing metrics](https://developers.cloudflare.com/d1/platform/pricing/)

## Email and analytics

Resend Free includes 3,000 transactional emails/month with a 100/day limit. Pro is $20/month for 50,000, then $0.90/1,000. Model account authentication email for Free users too. Wya sends from its own email domain; customers' website domains do not each require a Resend sending domain. [Resend pricing](https://resend.com/pricing)

PostHog analytics includes 1M events/month; the next 1M costs $0.00005/event, or $50, then the next tier is $0.0000343/event. Wya currently emits public page views and item clicks; autocapture, session replay and person profiles are disabled. One additional million captured events can cost much more than the corresponding hosting requests. Include clicks and enabled future analytics products, and set a deliberate event budget. [PostHog analytics pricing](https://posthog.com/product-analytics/pricing)

## Transparent scenarios, not measured forecasts

Assumptions for the following **monthly infrastructure-only illustration**:

- Nine Free accounts per paying account; 100 public visits/account/month.
- Two dynamic Worker requests/visit, assuming 20ms average CPU and 200 D1 rows read each (illustrative, not measured production averages); one captured analytics event/visit and no replay.
- Per account: 0.5MB D1 storage, 2MB R2 storage, two R2 writes, one R2 read/visit, two emails and 30 ordinary D1 row writes/month.
- Healthy domains: 120 checks/month, three Queue operations/check and an illustrative 20 D1 rows read and ten D1 row writes/check. No retry storm.
- Workers Paid ($5) plus Resend Pro ($20) are budgeted even at low usage. Other included allowances are applied once. R2 uses decimal GB and Standard storage.

| Paying accounts | Total accounts | Total visits | Total cost: 1 domain/payer | Cost/payer | Total cost: 10 domains/payer | Cost/payer |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 250 | 25,000 | $25.00 | $1.00 | $40.00 | $1.60 |
| 100 | 1,000 | 100,000 | $25.00 | $0.25 | $115.00 | $1.15 |
| 1,000 | 10,000 | 1,000,000 | $115.35 | $0.115 | $1,016.39 | $1.016 |

These are arithmetic applications of the rates above. At 1,000 payers using all ten domains: $5.20 Workers + $20 email + $990 hostnames + $0.15 R2 + $1.04 Queues. The assumed D1 and analytics usage remain within allowances. This is not a load-capacity claim. Background-job CPU, billable logs, support, development, taxes, payment fees, disputes, marketing, provider add-ons and unusual traffic are not quantified here. More visits, clicks, documents, revisions or uploads change the result.

For recalculation, with `positive(x) = max(0, x)`:

```text
Workers USD = 5 + 0.30 * positive(requests - 10M) / 1M
                + 0.02 * positive(totalCpuMs - 30M) / 1M
Hostnames USD = 0.10 * positive(provisionedHostnames - 100)
D1 USD = 0.001 * positive(rowsRead - 25B) / 1M
         + positive(rowsWritten - 50M) / 1M + 0.75 * positive(storedGB - 5)
Queue USD = 0.40 * positive(operations - 1M) / 1M
```

Apply R2, email and analytics tiers separately, then add all operational costs and divide by paying accounts. Provider unit rounding can make small overages differ from a smooth estimate. Free users and dormant retained data still consume resources; revenue comes from payers.

## Turning costs into USD and BRL prices

For the confirmed **Brazilian Stripe business**, standard domestic card processing is 3.99% + R$0.39, with Billing adding 0.7%; international cards add two percentage points. Confirm actual settlement/conversion terms and any custom contract. A USD display price does not imply US processing fees. [Stripe Brazil](https://stripe.com/br/pricing), [currency settlement](https://docs.stripe.com/payments/currencies/settlement-payouts)

For a domestic BRL subscription, let `C` be the full allocated monthly cost in BRL, including support and the Free tier; let `m` be the desired contribution margin:

```text
Break-even price = (C + 0.39) / (1 - 0.0469)
Price for margin m = (C + 0.39) / (1 - 0.0469 - m)
```

Using the modeled infrastructure cost only, domestic BRL cards and a **hypothetical R$5/USD budget rate**, the monthly break-even floors are:

| Paying accounts | 1 domain/payer | 10 domains/payer |
| ---: | ---: | ---: |
| 25 | R$5.66 | R$8.80 |
| 100 | R$1.72 | R$6.44 |
| 1,000 | R$1.01 | R$5.74 |

For illustration only, the $1.01639 infrastructure scenario at a **hypothetical** R$5/USD gives R$5.74 break-even or R$21.62 at a 70% margin. At hypothetical R$6/USD, those become R$6.81 and R$25.64. These are not recommended prices: support, taxes and risk reserves are still missing. Annual billing reduces the fixed collection fee per service month, but a discount must still fund twelve months of cost.

Review the launch prices after collecting a representative billing period of Wya-specific usage, account conversion and domain utilization; allocate support time; confirm Stripe settlement fees and tax treatment; model normal and high-usage customers; then test full ten-domain utilization and migrated excess-space accounts against both currency prices. Keep exchange-rate and contingency assumptions explicit. No Stripe Price objects, production configuration, paid plan upgrade or provider purchase was created or changed for this analysis.

## Approved launch-price check

The owner selected monthly US$2.99 and R$9.99 after reviewing the Free-tier allocation. At 100 paying accounts, nine Free accounts per payer and ten domains per payer, the modeled infrastructure allocation is US$1.15 per payer. With the hypothetical R$5/USD rate:

| Monthly offer | Modeled payment fees | Infrastructure | Remaining before other expenses | Contribution / gross revenue |
| --- | ---: | ---: | ---: | ---: |
| US$2.99 | US$0.28 | US$1.15 | US$1.56 | 52.24% |
| R$9.99 | R$0.86 | R$5.75 | R$3.38 | 33.85% |

The USD row assumes international cards at 6.69% including Billing, plus the R$0.39 fixed fee converted at the same hypothetical budget rate. The BRL row assumes domestic cards at 4.69% including Billing plus R$0.39. Unknown FX/settlement costs, taxes, support, development, disputes and refunds remain excluded. These are contribution estimates, not profit margins.

At 25 paying accounts using ten domains each, the R$9.99 offer leaves only R$1.13 per payer at R$5/USD, or loses R$0.47 at R$6/USD before other expenses. Monitor conversion, domain utilization, analytics volume and support effort after launch. There is no promised annual discount or guaranteed lifetime price. The current currency selector allows either currency regardless of country; regional eligibility needs a separate product decision if BRL must be restricted to Brazilian customers.
