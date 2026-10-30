# Security policy

## Supported scope

Report vulnerabilities affecting the current Quorem deployment or the latest `dev` code. Older commits and releases have no separate security maintenance commitment. Include the affected URL, commit, or version when known.

## Report privately

Email [contact@quorem.app](mailto:contact@quorem.app) with the subject `Quorem security report`. Do not open a public issue or pull request containing vulnerability details. GitHub private vulnerability reporting is not currently enabled for this repository.

Include:

- Affected component and environment.
- Reproduction steps or a minimal proof of concept.
- Expected and observed behavior, potential impact, and prerequisites.
- A way to contact you for follow-up.

Remove credentials, session tokens, personal data, and other secrets from reports and attachments. If sensitive evidence is necessary, describe it first and arrange a suitable transfer with the maintainer.

## Research and disclosure

Use local fixtures and accounts you control. Obtain explicit permission before testing hosted systems. Avoid accessing other users' data, disrupting service, exhausting judge capacity, or attempting destructive sandbox escapes. Stop if testing exposes private data; report the minimum evidence needed.

Relevant areas include authentication and authorization, private questions and hidden tests, interview access, code-execution isolation, SQL isolation, and credential exposure.

The maintainer will assess reports and coordinate fixes and disclosure. Keep exploit details private until disclosure is agreed. No fixed response deadline or paid bounty is promised.
