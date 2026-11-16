# Learned adaptive questions

[Issue #627](https://github.com/ethan-ngai/quorem/issues/627). Individual practice and competitive question selection share the learner/predictor. Interviews and review workspaces are excluded.

## Design and implementation

1. Record eligible outcomes and exposure independently of expiring submission payloads.
2. Update personal skill and topic state from prediction errors; decay old evidence.
3. Fit shared success-prediction coefficients, question difficulty offsets and decay half-lives from chronological outcomes.
4. Promote only after held-out improvement; persist evaluation, expire old artifacts and support rollback.
5. Apply separate practice-learning and competitive-fairness policies over the same predictor.

The predictor uses tags and outcomes. Practice uses tag overlap to diversify adjacent suggestions.

## Data and privacy

Migration `086_question_learning.sql` introduces exposure, `question_learning_events` and `recommendation_models`. Existing workspaces backfill exposure only. Expired outcomes and historical content cannot reconstruct chronological labels; no synthetic historical events are created.

Trusted completion records Submit verdicts: accepted, wrong answer, time limit, runtime error and memory limit. Runs, custom runs, syntax errors, infrastructure failures, cancellation, interviews, review workspaces and intermediate Odyssey levels do not train the system. Replayed terminal updates are idempotent. Observation time orders evidence by when the result became available, avoiding delayed-result leakage. Admission time is retained separately.

Events contain outcome, context and public topic/difficulty/content identity; no source code or test data. They survive ordinary submission deletion, expire after 180 days, and are removed on account or permanent question deletion. Publishing an edit keeps the stable question ID, learning events, exposure and impressions. Model offsets are keyed by question ID. Training and serving replay the same closed two-hour sessions over the 180-day window. A session groups one learner, question ID and context. Training selects whole public account histories up to 20,000 sessions, avoiding raw retry truncation. Private-question outcomes affect only their owner's profile. Guests use the prior for practice; guest match histories contribute to their own competitive profile, never global fitting.

Workspace creation, reopening through the workspace upsert, and eligible submissions record exposure. Viewing a suggestion records a separate impression. Exposure never counts as mastery. Existing authorization, publication checks, filters and personal cache isolation remain authoritative. No probabilities or participant history are exposed in API responses.

## Model and time decay

`modules/problems/recommendations/model.ts` owns the provider-neutral learner. The predictor is logistic regression over intercept, catalog difficulty, overall skill, mean topic skill, question review strength, match context and an optional weakest-topic gap, plus a learned per-question difficulty offset.

Personal skill updates use the residual `outcome − predictedSuccess` once per closed session. An eventual solve receives positive credit with a bounded retry discount. Repeat sessions within 24 hours and observed editorial assistance receive reduced credit. Assistance includes editorial access in the day before submission and recorded competitive reveals. Assistance outside Quorem is unobserved. All outcomes in a closing window are scored against the preceding learner state.

Elapsed-time multiplier: `2^(−elapsedDays / halfLifeDays)`.

- Overall and topic skill decay toward zero with the fitted skill half-life.
- Review strength decays since its last success. Its half-life is the fitted recall half-life times the square root of successful practice days, capped at 90 days.
- SGD training examples receive a separate 90-day recency half-life so recent behavior matters more.
- Practice exposure penalties have a one-day half-life; competition uses seven days.
- Shared model artifacts expire after 30 days. Missing, invalid, incompatible or expired models use an explicit untrained prior. Superseded artifacts are retained until 15 days past expiry for bounded audit history.

The prior uses 30-day skill / seven-day recall half-lives. It is not presented as a trained probability model. Enough actual outcomes must accumulate before promotion.

## Training and evaluation

`training.ts` fits bounded, regularized logistic coefficients and item offsets using eight chronological SGD passes. A chronological 60% training / 20% tuning / 20% test split selects skill half-life from 7/30/90 days and review half-life from 3/7/14/45 days. The final test boundary moves past the incumbent's training timestamp when necessary. Parameters are refitted on pre-test data only; held-out outcomes update online learner state only after their prediction is scored.

Training compares a mean-only model against one that adds the gap between the weakest tagged skill and the mean. The gap weight is bounded so improving any tagged skill can only help. Missing tags contribute zero evidence. The gap must improve tuning loss by 0.005 and beat the fitted mean-only comparator on held-out log loss within the Brier tolerance. Tags have no primary/secondary role in the current catalog. Holdout reports show prediction and observed solve rates for practice, matches, first recorded learner attempts, questions absent from fitting, questions new to each learner, and practice predictions near the target.

Promotion requires at least 200 sessions, ten learners and 40 test sessions; a chronological tuning interval; log loss at least 0.005 better than both prior and incumbent; and Brier score no more than 0.005 worse than either. Insufficient or non-improving runs store an inactive candidate with a reason. Evaluation reports include counts, time boundaries, log loss and Brier scores. These are initial product gates, not a guarantee of educational benefit or statistical significance. Synthetic tests establish mechanics; real calibration requires real usage.

The review score is a scheduling signal. A nondefault review half-life requires at least 40 unassisted delayed repeat sessions in both tuning and holdout, with delayed Brier score checked against the default.

Activation uses an advisory lock and an expected-active-model comparison, preventing stale concurrent training from replacing a newer model. Rollback accepts only validated, compatible, unexpired artifacts; selecting `prior` disables the learned model.

## Selection policies

Practice uses `GET /v1/problems?sort=recommended`; a five-question carousel sits above the browse table and follows the selected library. Recommended accepts only page 1 and at most 20 items; other catalog sorts retain their existing pagination. It targets a predicted success rate near 0.65, prioritizes due reviews, adds exploration for unseen questions/topics, penalizes recent exposure, and diversifies the preceding two suggestions using tag overlap. A 30-minute cooldown pushes recent opens behind other candidates, with fallback for small pools. Dismissing a suggestion hides it from Recommended for seven days. The question remains available in Browse.

New lobbies default to Recommended. Random draws uniformly from all sealed, authorized candidates matching the lobby filters, with replacement across matches. Explicit host choices bypass ranking and retain access checks. SQL Recommended uses the difficulty, novelty and fairness pool with a uniform draw.

### Recommended match curriculum

1. **Resolve techniques.** Canonicalize publication tags and historical outcome tags with catalog aliases. Give each question one technique for the draw. Advanced and DP tags take precedence, then recognized techniques, other tags, and broad tags like Arrays or Graphs. Ties use publication tag order. Apply advanced readiness to every gated tag on the question.
2. **Check shared readiness.** Topological Sort, Union-Find and Minimum Spanning Trees require two distinct unassisted solves in that technique from every seat. An affirmative lobby topic filter opts in to the named technique. Exclusion filters do not opt in. Evidence comes from retained, closed practice and match sessions. Repeated solves, assisted solves and opens cannot unlock topics. For cold or mixed-skill lobbies, default readiness follows the seat with the least evidence.
3. **Keep fair questions in play.** Build the usual pool among curriculum-eligible candidates. Candidates with mean predicted success from 0.35 to 0.75 and spread at most 0.25 qualify for the novelty preference. Prefer unseen questions, then minimize familiarity imbalance if no question is unseen by every seat. Keep rows within 0.10 of the best score in the resulting pool. If the success band is empty, use the existing challenge and fairness fallback within the curriculum-eligible set. If filters leave only locked questions, the lobby gets the existing no-matching-questions error. An affirmative topic filter, Random or an explicit host pick can request that material.
4. **Weight techniques.** Binary Search, BFS, DFS, Hash Tables, Intervals, Prefix Sums, Sliding Window, Sorting, Stack and Two Pointers start at weight 4. When every seat has independently solved a distinct problem in each of two of those techniques, their weight drops to 2. DP gets weight 0.25 until that point, then 1. It gets weight 2 if every seat has two unassisted DP solves or the host explicitly requests DP. Other techniques start at weight 1. DP can still come up early when the fair pool is small.
5. **Rotate and offer review.** Use the most recent question exposure for each technique across the seats, including recent practice. A technique just seen gets 15% of its base weight, with a two-day cooldown half-life and a 14-day history window. A shared brush-up technique gets a 35% boost if every seat has unsolved, unassisted attempts on two distinct questions in that technique in the past 30 days. If it wins the draw, prefer Easy questions within its fair pool when available.
6. **Draw a technique, then a question.** Weighted technique selection gives small buckets a chance alongside large ones. Once a technique is drawn, pick a question uniformly from its final bucket. Catalog filters and sealed-publication checks apply throughout.

Initial weights and thresholds are product defaults. Track repeat techniques, participation and completion before tuning. Compare starts and solves for cold-start and mixed-readiness lobbies, and inspect how often narrow filters exhaust the eligible pool. Technique classification depends on catalog tags and their order where a question has several comparable techniques. The match selection report continues to record fairness and familiarity for the chosen question.

Practice assigns each account to a stable control or exploration arm. The exploration arm can reserve slot three for an unseen topic at suitable difficulty. The server records the model, arm and served position, while the browser acknowledges each visible carousel card. A workspace opened within two hours is attributed to the latest acknowledged suggestion for that question. Outcome tracking records attempts, solves and the first unassisted return two to fourteen days after a solve. The measurement report groups public data by arm and model and reports delayed results only after the full observation window. Transfer counts the first unassisted judged submission on a different public question with an overlapping catalog tag and no prior judged attempt in retained history. Starts without a judged attempt are tracked separately. Match reports include predicted success spread, familiarity gap and completion outcomes. Attribution is observational at the impression level. Assess experiments by account and account for who returns when interpreting delayed solve rates.

Candidate metadata is ranked in memory. Diversity selection costs O(candidates × requested prefix). Event reads, training input and maintenance batches are bounded. Large-catalog latency and learning benefit have not been measured.

## Operations

Apply product migrations through the existing deployment workflow before using this code. Locally, use a dedicated fixture database, then:

```sh
# DATABASE_URL must point to the intended local fixture database.
vp -C apps/api exec node src/cli/recommendations.ts evaluate
vp -C apps/api exec node src/cli/recommendations.ts measure
vp -C apps/api exec node src/cli/recommendations.ts train
vp -C apps/api exec node src/cli/recommendations.ts activate <validated-model-uuid>
vp -C apps/api exec node src/cli/recommendations.ts activate prior
```

`train` evaluates the tags-and-outcomes predictor and conditionally activates it. Incompatible predictor artifacts fall back to the prior until retraining. `evaluate` reports without writing artifacts. Runs with insufficient evidence skip artifact writes. Failures preserve the active model. The existing retention scheduler removes aged learning data in bounded batches.

`.github/workflows/recommendations.yaml` provides weekly tags-based training and manual evaluation, training and rollback. It runs only on `main`, with repository variable `QUOREM_LEARNED_RECOMMENDATIONS=true` and production-environment secret `QUOREM_RECOMMENDATION_DATABASE_URL`. Configure these through the normal deployment process after migrations.

## Validation

Node/workerd suites cover learner decay, retries, topic transfer, chronological leakage, actual coefficient fitting, promotion gates, catalog authorization and all-seat selection. Disposable PostgreSQL tests exercise idempotent collection, excluded contexts, final Odyssey credit, retained events, private/global separation, atomic model activation/rollback.

Frontend checks cover the Recommended controls and account-scoped catalog cache.
