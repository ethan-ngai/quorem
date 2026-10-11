# Implementation tickets

Planning parent: [#1](https://github.com/ethan-ngai/quorem/issues/1). Baseline PR: [#2](https://github.com/ethan-ngai/quorem/pull/2). Linked issues, no native sub-issues.

| Domain | Ticket | Prerequisites |
| --- | --- | --- |
| Q1 | [build: establish reproducible local monorepo development](https://github.com/ethan-ngai/quorem/issues/3) | [Planning PR](https://github.com/ethan-ngai/quorem/pull/2) |
| Q2 | [feat: implement workspace design tokens and themes](https://github.com/ethan-ngai/quorem/issues/4) | [Q1](https://github.com/ethan-ngai/quorem/issues/3) |
| Q3 | [feat: freeze API event and execution contracts](https://github.com/ethan-ngai/quorem/issues/5) | [Q1](https://github.com/ethan-ngai/quorem/issues/3) |
| Q4 | [feat: add original problems and recoverable workspace drafts](https://github.com/ethan-ngai/quorem/issues/6) | [Q1](https://github.com/ethan-ngai/quorem/issues/3), [Q3](https://github.com/ethan-ngai/quorem/issues/5) |
| Q5 | [feat: build CodeMirror Python practice workspace](https://github.com/ethan-ngai/quorem/issues/7) | [Q1](https://github.com/ethan-ngai/quorem/issues/3), [Q2](https://github.com/ethan-ngai/quorem/issues/4), [Q3](https://github.com/ethan-ngai/quorem/issues/5) |
| Q5a | [feat: integrate scoped Python language intelligence](https://github.com/ethan-ngai/quorem/issues/8) | [Q1](https://github.com/ethan-ngai/quorem/issues/3), [Q3](https://github.com/ethan-ngai/quorem/issues/5), [Q5](https://github.com/ethan-ngai/quorem/issues/7) |
| Q6 | [feat: add bounded Python judging and partial scoring](https://github.com/ethan-ngai/quorem/issues/9) | [Q1](https://github.com/ethan-ngai/quorem/issues/3), [Q3](https://github.com/ethan-ngai/quorem/issues/5) |
| Q7 | [test: validate integrated local solo practice](https://github.com/ethan-ngai/quorem/issues/10) | [Q4](https://github.com/ethan-ngai/quorem/issues/6), [Q5](https://github.com/ethan-ngai/quorem/issues/7), [Q5a](https://github.com/ethan-ngai/quorem/issues/8), [Q6](https://github.com/ethan-ngai/quorem/issues/9) |
| Q8 | [feat: implement authoritative invite match lifecycle](https://github.com/ethan-ngai/quorem/issues/11) | [Q7](https://github.com/ethan-ngai/quorem/issues/10) |
| Q9 | [feat: add private local realtime and snapshot recovery](https://github.com/ethan-ngai/quorem/issues/12) | [Q3](https://github.com/ethan-ngai/quorem/issues/5), [Q8](https://github.com/ethan-ngai/quorem/issues/11) |
| Q10 | [feat: integrate two-player match workspace](https://github.com/ethan-ngai/quorem/issues/13) | [Q8](https://github.com/ethan-ngai/quorem/issues/11), [Q9](https://github.com/ethan-ngai/quorem/issues/12) |
| QA | [feat: integrate Better Auth Cognito identity boundary](https://github.com/ethan-ngai/quorem/issues/14) | [Q7](https://github.com/ethan-ngai/quorem/issues/10), [Q3](https://github.com/ethan-ngai/quorem/issues/5) |
| Q11 | [infra: validate and deploy AWS adapters with Terraform](https://github.com/ethan-ngai/quorem/issues/15) | [Q10](https://github.com/ethan-ngai/quorem/issues/13), [QA](https://github.com/ethan-ngai/quorem/issues/14) |
| Q12 | [feat: add Astro marketing after local MVP](https://github.com/ethan-ngai/quorem/issues/16) | [Q10](https://github.com/ethan-ngai/quorem/issues/13) |
