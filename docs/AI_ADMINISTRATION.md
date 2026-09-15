# AI Administration

Open REM Command Center as Superuser, then choose **AI Administration** in the sidebar or Settings.

The dashboard uses only OpenCode Zen models that the current catalog lists with zero input, output and cache prices. The variant is default. Go and OpenAI credentials and paid-model fallbacks are excluded. Catalog verification expires after five minutes; requests refresh it automatically and stop if verification fails. Free availability and provider limits can change.

## Server credential
Set the dedicated Zen key as **OPENCODE_ZEN_API_KEY** in the production Vercel environment and deploy. The existing production build synchronizes this explicitly named secret to Convex without printing it. Alternatively, manage that named key directly in Convex. Missing Vercel values preserve an existing Convex key. Neither the browser nor configuration/audit tables receive the secret.

Use Refresh status, Refresh free models and Test saved text model. “Configured” confirms presence only; a successful test confirms that model's access. If OpenCode restricts a free model to supported clients, the request stops and reports the restriction. The application does not spoof client/session identifiers or switch to paid access.

## Settings
Select compatible free text, image and PDF models; use the per-feature switches or global pause; set output, timeout, per-calendar-minute and per-UTC-day limits. A connection diagnostic remains available while paused and counts toward limits. Review the exact changes and apply them. Concurrent edits require reload. Retrying a lost save response uses the same operation ID and cannot apply twice.

Settings history preserves actor, before/after values, reason, time and operation identity. Load previous settings into a draft, review and apply to restore them with a new audit entry. The model workspace sends only the text entered; it has no database tools or operational write permissions.

## Data use and usage
Read the policy displayed for the selected model. Some free models use submitted data for training; NVIDIA free models are trial-only and prohibit personal/confidential data. See https://opencode.ai/docs/zen/#privacy for current policies. Use synthetic content for connection/OCR verification.

Usage shows UTC-day request/success/failure counts and provider-reported tokens, plus the latest 50 requests and latest 10 settings changes. It is not a provider-credit balance. Missing token usage is displayed as a dash per request. Keys, document contents and prompts are not stored in the request log. An interrupted action may have an unconfirmed completion; it is never automatically retried.

Receiving and DHR OCR use this gateway but preserve their existing document validation and human review. An AI response cannot directly adjust inventory, delete/complete a DHR, or post to SAP. Existing user/part/SAP administration and dashboard customization remain accessible through Settings.
