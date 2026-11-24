# BruA1 Music Network — founding release
Owner approved the community concept: affordable membership, professional profiles, searchable directory, internal forum, channel chat, private messages. Proposed $4.99/month and $49.99/year; subscription terms and billing not yet published.
## Separation
Public preview at /music-network.html. Separate network database and separate API Worker planned. No changes to instrumental checkout, orders, PayPal merchant secrets or R2 masters. Public asset allowlist includes only the three network presentation files.
## Sequence
1. Public preview with clearly labeled example profiles and discussions; no payment, data collection or sign-up.
2. Account authentication, email verification, secure session lifecycle, rate limits and separate D1 migration. Member status, paid entitlement and expiry enforced server-side on every private API operation, never based on browser flags.
3. Member-consented profile visibility, multiple professional roles and searchable directory. Public visitor sees only opt-in fields; no email or private data.
4. Member-only persistent forum threads, replies and chat; safe text rendering, reporting and blocking. Admin authorization, moderation audit, abuse handling and privacy controls are required before opening beta.
5. Private messaging with authorization of both parties, blocking, rate limits, reports; never expose other people's messages.
6. PayPal sandbox recurring subscriptions; webhook signature, entitlement updates, renewal/cancellation/expiry, nonpayment handling and audit. Separate tax classification from instrumental licenses; transparent recurring billing and cancellation terms. Live billing remains off pending verification.
7. Founding beta with real approved members, then public launch. No fabricated users or member counts.
## Data
Schema: workers/brua1-music-network/schema.sql. Local isolated prototype test only. No production community database, credentials, registrations or subscriptions activated by this commit.
