# Learned adaptive questions

[Issue #627](https://github.com/ethan-ngai/quorem/issues/627). Individual practice and competitive question selection share the learner/predictor. Interviews and review workspaces are excluded.

## Design and implementation

1. Record eligible outcomes and exposure independently of expiring submission payloads.
2. Encode question text locally using pinned pretrained MiniLM weights.
3. Update personal skill, topic and semantic state from prediction errors; decay old evidence.
4. Fit shared success-prediction coefficients, question difficulty offsets and decay half-lives from chronological outcomes.
5. Promote only after held-out improvement; persist evaluation, expire old artifacts and support rollback.
6. Apply separate practice-learning and competitive-fairness policies over the same predictor.

Embeddings describe related content; they do not independently estimate mastery or review timing. The learned logistic predictor combines content with outcomes and elapsed time. This follows the general distinction between content representations and learned forgetting models in [Duolingo's half-life regression research](https://research.duolingo.com/papers/settles.acl16.pdf); it does not reproduce Duolingo's model or claim its language-learning results for coding.

## Data and privacy

Migration `080_question_learning.sql` introduces exposure and `question_learning_events`, `question_embeddings` and `recommendation_models`. Existing workspaces backfill exposure only. Expired outcomes and historical content cannot reconstruct chronological labels; no synthetic historical events are created.

Trusted completion records Submit verdicts: accepted, wrong answer, time limit, runtime error and memory limit. Runs, custom runs, syntax errors, infrastructure failures, cancellation, interviews, review workspaces and intermediate Odyssey levels do not train the system. Replayed terminal updates are idempotent. Observation time orders evidence by when the result became available, avoiding delayed-result leakage. Admission time is retained separately.

Events contain outcome, context and public topic/difficulty/content identity; no source code or test data. They survive ordinary submission deletion, expire after 180 days, and cascade on user/version deletion. Existing authoring replacement deletes owned version data, so that operation also resets its exposure/events/vectors. Old model offsets only match the same content key and expire with their model. Personal inference reads at most 512 recent events per participant. Shared training reads at most 20,000 recent events from enabled accounts on public questions. Private-question outcomes affect only their owner's profile. Guests use the prior for practice; guest match histories contribute to their own competitive profile, never global fitting.

Workspace creation and eligible submissions record exposure. Viewing a suggestion or reopening an existing workspace does not. Exposure never counts as mastery. Existing authorization, publication checks, filters and personal cache isolation remain authoritative. No probabilities or participant history are exposed in API responses.

## Model and time decay

`modules/problems/recommendations/model.ts` owns the provider-neutral learner. The predictor is logistic regression over intercept, catalog difficulty, overall skill, mean topic skill, semantic skill projection, estimated question recall and match context, plus a learned per-content difficulty offset.

Personal skill updates use the residual `outcome − predictedSuccess`. Only the first eligible outcome per question/content per UTC day updates proficiency and enters training/evaluation. Later successful retries refresh recall without repeatedly increasing skill. A first-attempt lapse resets that question's recall reinforcement. Skill is bounded; returning learners regress toward the neutral prior rather than becoming permanently classified as weak.

Elapsed-time multiplier: `2^(−elapsedDays / halfLifeDays)`.

- Overall, topic and semantic skill decay toward zero with the fitted skill half-life.
- Question recall decays since its last success. Its half-life is the fitted recall half-life times the square root of successful practice days, capped at 90 days.
- SGD training examples receive a separate 90-day recency half-life so recent behavior matters more.
- Practice exposure penalties have a one-day half-life; competition uses seven days.
- Shared model artifacts expire after 30 days. Missing, invalid, incompatible or expired models use an explicit untrained prior. Superseded artifacts are retained until 15 days past expiry for bounded audit history.

The prior uses 30-day skill / seven-day recall half-lives. It is not presented as a trained probability model. Enough actual outcomes must accumulate before promotion.

## Training and evaluation

`training.ts` fits bounded, regularized logistic coefficients and item offsets using eight chronological SGD passes. A chronological 60% training / 20% tuning / 20% test split selects skill half-life from 7/30/90 days and recall half-life from 3/14/45 days. The final test boundary moves past the incumbent's training timestamp when necessary. Parameters are refitted on pre-test data only; held-out outcomes update online learner state only after their prediction is scored.

Promotion requires at least 200 raw events, ten learners and 40 first-attempt test observations; a chronological tuning interval; log loss at least 0.005 better than both prior and incumbent; and Brier score no more than 0.005 worse than either. Insufficient or non-improving runs store an inactive candidate with a reason. Evaluation reports include counts, time boundaries, log loss and Brier scores. These are initial product gates, not a guarantee of educational benefit or statistical significance. Synthetic tests establish mechanics; real calibration requires real usage.

Activation uses an advisory lock and an expected-active-model comparison, preventing stale concurrent training from replacing a newer model. Rollback accepts only validated, compatible, unexpired artifacts; selecting `prior` disables the learned model.

## Embeddings

`QuestionEncoder` is a consumer-owned port. Its maintenance adapter runs [Transformers.js](https://huggingface.co/docs/transformers.js/index) on CPU with `onnx-community/all-MiniLM-L6-v2-ONNX`, revision `aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f`, float32, mean pooling and normalization: 384 dimensions. Question text stays on the maintenance host; only public model weights are downloaded. No inference provider credentials are required.

Input comprises title, tags and the first 12,000 statement characters, then the model's tokenizer truncation. Vectors are keyed by encoder identity and a hash of version ID, title, statement, difficulty and tags. Conditional writes reject intervening edits/deletions. Invalid or missing vectors contribute no semantic signal; topic/outcome learning still works. A bounded refresh processes up to 3,200 questions per invocation. Obsolete encoder vectors and unreferenced obsolete content vectors expire after 180 days. PostgreSQL stores vectors; no separate vector service or ANN index is required at the current catalog scale.

## Selection policies

Practice uses `GET /v1/problems?sort=recommended`; Suggested/Browse controls, filters and pagination remain unchanged. It targets a predicted success rate near 0.65, prioritizes due reviews, adds exploration for unseen questions/topics, penalizes recent exposure, and diversifies the preceding two suggestions using tag overlap and embedding cosine similarity. Reasons remain `review`, `weak_topic`, `new_topic`, `challenge` or `practice`.

Competition computes profiles for every fixed seat at activation. It first prefers questions unseen by everyone, otherwise minimizes familiarity imbalance (unseen/exposed/solved). Within that pool it targets mean success near 0.55, penalizes participant probability spread and recent exposure, then randomly selects among candidates within 0.1 of the best score. Explicit host choices bypass ranking and retain access checks. Tiny/exhausted pools remain playable. Matchmaking and ratings are unchanged.

Candidate metadata is ranked in memory. Diversity selection costs O(candidates × requested prefix), with 384-dimensional comparisons. Event reads, training input and maintenance batches are bounded. Large-catalog latency and learning benefit have not been measured.

## Operations

Apply product migrations through the existing deployment workflow before using this code. Locally, use a dedicated fixture database, then:

```sh
# DATABASE_URL must point to the intended local fixture database.
vp -C apps/api exec node src/cli/recommendations.ts refresh
vp -C apps/api exec node src/cli/recommendations.ts evaluate
vp -C apps/api exec node src/cli/recommendations.ts train
vp -C apps/api exec node src/cli/recommendations.ts activate <validated-model-uuid>
vp -C apps/api exec node src/cli/recommendations.ts activate prior
```

`refresh` encodes missing revisions, trains, evaluates and conditionally activates. `train` reuses existing vectors. `evaluate` reports without writing artifacts. `QUOREM_MODEL_CACHE` optionally selects the weights cache directory; default `.local/models` under the API checkout. Failures preserve the active model. The existing retention scheduler removes aged learning data in bounded batches.

`.github/workflows/recommendations.yaml` provides daily refresh and manual evaluation/training/rollback. It runs only on `main`, with repository variable `QUOREM_LEARNED_RECOMMENDATIONS=true` and production-environment secret `QUOREM_RECOMMENDATION_DATABASE_URL`. Configure these through the normal deployment process after migrations. This feature work does not enable the production schedule, add cloud infrastructure or deploy.

## Validation

Node/workerd suites cover learner decay, retries, semantic transfer, chronological leakage, actual coefficient fitting, promotion gates, catalog authorization and all-seat selection. Disposable PostgreSQL tests exercise idempotent collection, excluded contexts, final Odyssey credit, retained events, private/global separation, stale vector rejection and atomic model activation/rollback. Local inference was exercised with actual pinned model weights, not fake vectors.

Frontend controls and cache-isolation tests were validated with the initial feature; this learned extension changes the shared backend only. Fixture preview uses live Vite/HMR from `/Users/engai/.codex/worktrees/adaptive-suggestions/quorem`, web `http://127.0.0.1:5194/practice?sort=recommended`, API `http://127.0.0.1:8794`. Local fixture auth is not cloud validation.
