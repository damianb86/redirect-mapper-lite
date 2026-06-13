# AI Cleanup Wizard

The AI wizard is a read-only planning layer on top of the existing cleanup flow. It does not replace manual cleanup steps and it never calls the apply route.

## Code Map

- `app/routes/app.ai-wizard.tsx`: authenticated AI wizard loader/action.
- `app/services/ai-wizard.server.ts`: Responses API orchestration, model fallback, tool loop, and final plan validation.
- `app/services/ai-wizard.schemas.ts`: strict structured plan schema and TypeScript types.
- `app/services/ai-wizard.tools.server.ts`: read-only internal tools backed by Shopify catalog and cleanup services.
- `app/services/cleanup-rules.ts`: reusable cleanup preset/filter/rule helpers.
- `app/routes/app._index.tsx`: drawer UI, plan prefill, redirect review states, and final confirmation UI.
- `app/routes/app.validate-targets.tsx`: redirect destination and source-path safety checks.
- `app/routes/app.apply.tsx`: final apply/export handling and cleanup history persistence.

## Endpoint

- `GET /app/ai-wizard`: authenticated status/config probe.
- `POST /app/ai-wizard`: accepts JSON `{ "userGoal": "..." }` or form data `userGoal`.

The action returns a strict `ai_wizard_plan_v1` JSON plan with:

- merchant goal and detected cleanup intent
- cleanup mode and preset suggestions
- product filter prefill values
- product match preview from Shopify
- redirect rules generated with the existing rule concepts
- redirect preview rows
- target validation results
- warnings, assumptions, multiple-choice clarifying questions, confidence, and next step

## Model Selection

Default model:

- `AI_WIZARD_MODEL=gpt-5-mini`

Fallback model:

- `AI_WIZARD_FALLBACK_MODEL=gpt-5.5`

The orchestrator starts on the cheaper model with low reasoning. It retries with the fallback model only when the plan is ambiguous, below `AI_WIZARD_CONFIDENCE_THRESHOLD`, or explicitly recommends fallback. Keep the default model small; the wizard mainly classifies intent and asks internal tools for real catalog data.

Set `AI_WIZARD_REASONING_EFFORT` only if plan quality needs more reasoning. Leave it unset for the cheapest normal path.

## Disabling

Set `AI_WIZARD_DISABLED=true` to disable the drawer actions without affecting manual cleanup. Leaving `OPENAI_API_KEY` unset also makes the AI wizard unavailable. In both cases the UI keeps the manual setup path available.

## Tooling

The Responses API request uses strict function tools and a strict JSON schema final response. Tools are intentionally read-only:

- catalog lookup: vendors, collections, product types, tags
- product preview from Shopify filters
- cleanup preset suggestion
- product filter and preset detail suggestion
- redirect rule suggestion
- redirect preview
- redirect target summary
- redirect destination validation
- preview impact estimate

The model is instructed not to invent catalog values or counts. Full-catalog totals remain `null` unless a tool returns an exact count.

## Redirect Safety

The wizard always returns:

- `requiresReview: true`
- `requiresExplicitConfirmation: true`
- `mustNotApplyAutomatically: true`

When essential scope or destination data is missing, plans set `nextStep` to `ask_clarifying_question`. Clarifications are returned as structured `clarifyingQuestions`, each with clickable options. The drawer renders those options as a small form, assembles the selected answers in JavaScript, and sends the completed clarification plus the previous plan back to `/app/ai-wizard`. The wizard should ask all necessary clarification questions in that first pass and should not ask a second clarification round.

Destructive cleanup modes, invalid destinations, broad destinations, and low-confidence destinations are surfaced as warnings for merchant review.

Generated redirects are validated before final review for:

- missing product, collection, or page destinations
- storefront paths that may 404
- invalid URL patterns
- duplicate redirect sources in the cleanup batch
- existing Shopify URL redirects with the same source path
- circular redirects
- redirects into products that are also being retired
- weak fallback destinations such as home page, all products, or search
- low-confidence AI or rule matches

Each redirect is shown with one review status: `ready`, `low confidence`, `needs review`, `edited`, `skipped`, `invalid`, or `conflict`.

## Approval Flow

The merchant can approve a suggestion, edit the destination, choose a destination type, skip a redirect, regenerate the AI plan, export instead of applying, or continue manually. Applying is blocked while invalid redirects or conflicts remain.

The drawer review cards prefill the normal cleanup flow before navigating to the corresponding step. The matching-products card opens a product detail modal where merchants can deselect AI-previewed products before opening a step or preparing Summary. The primary drawer CTA opens Summary with products, filters, rules, redirects, and cleanup mode prepared; it does not apply changes.

Quick prompt examples are compact helper buttons. Hovering shows the full guide prompt and any replaceable tags; clicking only copies the prompt into the textarea and does not submit it automatically.

The final confirmation summarizes selected products, redirects to create, archive/delete counts, skipped rows, conflicts, low-confidence rows, estimated impact, and cleanup mode. Destructive modes are labeled as:

- redirects only
- redirects + archive
- redirects + delete

`app.apply` creates redirects first. Archive/delete operations only run for products whose redirect was created successfully, and only after the merchant confirms the final modal.

## QA Checklist

Use the existing manual flow and the AI drawer to verify:

- vendor exit request creates vendor filters, product preview, and redirect suggestions
- seasonal cleanup request prefers seasonal filters and collection destinations
- out-of-stock cleanup request selects inventory-focused filters
- ambiguous request asks multiple-choice clarification questions or recommends manual setup
- invalid vendor or collection does not invent catalog data
- low-confidence destinations are marked for review
- editing an AI suggestion marks it reviewed/edited
- switching from AI to manual mode leaves the manual flow usable
- final apply still requires the confirmation modal
- export still works without applying changes
- no redirect, archive, or delete action runs before final confirmation
