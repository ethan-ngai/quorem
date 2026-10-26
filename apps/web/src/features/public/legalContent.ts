/** @file legalContent.ts @description Small-project privacy and service terms matching Quorem's data flows. @module public */
export type LegalDocument = {
  title: string;
  summary: string;
  sections: { id: string; title: string; paragraphs: string[] }[];
};

export const legalDocuments: Record<"privacy" | "terms", LegalDocument> = {
  privacy: {
    title: "Privacy Policy",
    summary:
      "Quorem uses account information, code, and session activity to provide coding practice, matches, and interviews. We do not sell personal information or share it for targeted advertising across other websites.",
    sections: [
      {
        id: "about",
        title: "About this policy",
        paragraphs: [
          "Quorem is an independently operated project based in the United States. In this policy, ‘Quorem’, ‘we’, and ‘us’ refer to the operator of quorem.app. Contact us at contact@quorem.app.",
          "This policy covers information we process through Quorem, including guest sessions and support requests. External sign-in providers and organizations running interviews may also process information under their own policies.",
        ],
      },
      {
        id: "information",
        title: "Information we collect",
        paragraphs: [
          "Account information includes your email address, name, username, optional profile image, and information needed to authenticate you. Depending on your sign-in method, this includes password-verification data, passkey public-key credentials, or account details supplied by a sign-in provider. We do not receive a passkey’s private key or your device’s fingerprint or face-recognition data.",
          "Workspace information includes code you run, submit, or share in a collaborative session; test inputs; execution results; question content; progress; and match or interview records. Guest sessions include the name you provide and information linking your activity to the session. Support correspondence includes information you send us directly.",
          "Technical information may include IP addresses, browser and device information, request times, sign-in activity, errors, and security or usage records processed by Quorem and its infrastructure providers.",
        ],
      },
      {
        id: "use",
        title: "How we use information",
        paragraphs: [
          "We use information to authenticate users, provide account settings, run and evaluate code, preserve progress, deliver invitations and account messages, and support shared sessions. We also use relevant records to answer support requests, investigate errors, enforce session rules, prevent abuse, and meet legal obligations.",
          "Where applicable privacy law requires a legal basis, we rely on providing the service you request, our legitimate interests in operating and securing Quorem, compliance with legal obligations, or consent where required. You may withdraw consent by contacting us; withdrawal does not affect processing that was lawful before withdrawal.",
        ],
      },
      {
        id: "visibility",
        title: "Shared sessions & monitoring",
        paragraphs: [
          "Other participants may see your display name, profile image, presence, and information made available by the session’s rules. Interviewers can view candidate work, shared code, submissions, results, and relevant session events. Publishing a question makes its published content available to its intended audience; joining a session does not make all of your other work public.",
          "Depending on session settings, Quorem may report pasting into the code editor or leaving the window, together with associated session and timing information. Clipboard provenance checks happen in your browser using temporary fingerprints; monitoring reports do not include raw clipboard text. Code pasted into the editor can still be shared or submitted as part of your work. Focus events do not reveal which other website or application you visited.",
          "An organization using Quorem for interviews determines its own hiring purposes and use of candidate records. Contact that organization about its decisions and copies of your information; contact us about Quorem’s handling of the same records. We may coordinate with the session organizer when responding to a request.",
        ],
      },
      {
        id: "storage",
        title: "Cookies & browser storage",
        paragraphs: [
          "Cookies support sign-in, account verification, and secure sessions. Browser storage remembers appearance and editor settings and stores local recovery copies and history. In individual practice, draft recovery is stored in your browser; running or submitting code sends the relevant code snapshot to the service. Collaborative editing also transmits shared code to support the session.",
          "You can block or clear cookies and site storage in your browser. This may sign you out, reset preferences, or remove unsaved recovery data. Clearing browser storage does not delete server records. Quorem does not use cross-site behavioral advertising; browser Do Not Track signals do not change essential sign-in and storage behavior.",
        ],
      },
      {
        id: "sharing",
        title: "When we share information",
        paragraphs: [
          "We use providers for hosting, network security, databases, code execution, authentication, email, and image storage. These providers process information needed for their functions. Connecting a sign-in provider also involves that provider’s own terms and privacy policy. Authorized participants receive information as described above.",
          "We may disclose information when reasonably necessary to comply with law or valid legal process, protect people or systems, investigate abuse, or establish or defend legal claims. If Quorem changes ownership or transfers its operations, relevant records may transfer with it, subject to the applicable privacy obligations. We may also disclose information at your direction.",
        ],
      },
      {
        id: "retention",
        title: "Retention & deletion",
        paragraphs: [
          "We retain account, progress, authored-question, and session records as needed to provide the service, maintain shared records, address security issues and disputes, and comply with law. The purpose, sensitivity, ongoing use, and legal requirements determine retention; there is no single deletion period for every type of record.",
          "Routine cleanup removes source code and stored execution results from completed submissions after 30 days, or after 7 days for guest submissions. Cleanup may be delayed by an outage. This cleanup does not remove every related record: progress, match metadata, shared interview code, and questions can remain. Local browser copies have their own lifetime and can be cleared through your browser.",
          "You may request account closure or deletion by emailing contact@quorem.app. We review requests manually and may retain information needed for legal obligations, security, disputes, or other people’s rights in shared records. Deletion may not immediately remove copies in backups. Information retained after a request remains subject to this policy.",
        ],
      },
      {
        id: "security",
        title: "Security & processing locations",
        paragraphs: [
          "We use measures such as authenticated access, permissions, and protected connections to safeguard information. No online service or storage system is completely secure. Protect your sign-in methods and avoid putting passwords, API keys, or sensitive personal information into code, test inputs, or support messages.",
          "Quorem is operated from the United States. Infrastructure providers may process information in the United States and other countries, whose privacy laws may differ from those where you live. Applicable legal requirements for international transfers continue to apply. Contact us for information about the providers and processing relevant to your request.",
        ],
      },
      {
        id: "choices",
        title: "Your choices & rights",
        paragraphs: [
          "You can update available account settings and control optional profile information. You may contact us to request access, correction, a copy, or deletion of your information. Depending on applicable law, you may also have rights to restrict or object to processing, receive portable data, withdraw consent, or appeal a decision about your request.",
          "Send requests to contact@quorem.app, preferably from the email associated with your account. We may request information reasonably necessary to verify your identity or authority. We respond within the period required by applicable law, explain limitations or refusals, and do not retaliate against you for exercising applicable privacy rights. You may also complain to your local privacy regulator or other competent authority.",
        ],
      },
      {
        id: "children",
        title: "Children’s privacy",
        paragraphs: [
          "Quorem is intended for people aged 13 and older. If you are under the age of legal adulthood where you live, you must have a parent or guardian’s permission to use it. A higher minimum age applies where required by local law.",
          "We do not knowingly collect personal information from children under 13. If you believe a child under 13 has provided information, contact contact@quorem.app so we can investigate and take appropriate steps to remove it. Parental permission for a teenager does not make Quorem available to children under 13.",
        ],
      },
      {
        id: "contact",
        title: "Changes & contact",
        paragraphs: [
          "We may update this policy as Quorem changes. The date at the top identifies the current version. For material changes, we will provide a prominent notice on the service or notify affected users by email, and obtain consent where required by law.",
          "For privacy questions or requests, email contact@quorem.app. Please do not include passwords, sign-in codes, or unnecessary sensitive information.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    summary:
      "Use Quorem fairly, protect your account, and share only content you have permission to use. Quorem is a small, independently operated service without a guarantee of uninterrupted availability.",
    sections: [
      {
        id: "using-quorem",
        title: "Using Quorem",
        paragraphs: [
          "These terms govern your use of quorem.app and its coding practice, Odyssey questions, matches, and interview tools. ‘Quorem’, ‘we’, and ‘us’ refer to the operator of this independently operated project based in the United States. Contact us at contact@quorem.app.",
          "By creating an account or using Quorem after these terms have been made available to you, you agree to them. If you do not agree, do not use the service. Our Privacy Policy explains how we handle personal information. Nothing in these terms removes rights or protections that applicable law does not allow you to waive.",
        ],
      },
      {
        id: "eligibility",
        title: "Age & account responsibility",
        paragraphs: [
          "You must be at least 13 years old, or older where local law requires. If you have not reached legal adulthood where you live, you must have a parent or guardian’s permission, and they should review these terms with you. If you use Quorem on behalf of an organization, you must have authority to agree on its behalf.",
          "Provide accurate account information and protect your sign-in methods. You are responsible for activity you authorize and for promptly reporting suspected misuse. Do not impersonate anyone, share access without authorization, or enter sessions you are not entitled to access. An invitation grants access only to the session and permissions it provides.",
        ],
      },
      {
        id: "fair-play",
        title: "Fair play & acceptable use",
        paragraphs: [
          "Follow the rules shown for each match or interview, including restrictions on outside assistance, code pasting, and leaving the session. Do not manipulate results, expose hidden tests, exploit authorization failures, or interfere with another participant.",
          "Do not use Quorem for malicious code, unauthorized security testing, harassment, unlawful content, intellectual-property infringement, unsolicited messages, or accessing networks and data unrelated to the coding task. Do not bypass quotas, create accounts to evade restrictions, overload the service, or run unrelated workloads. Report suspected vulnerabilities privately to contact@quorem.app.",
        ],
      },
      {
        id: "content",
        title: "Your code & content",
        paragraphs: [
          "You retain ownership rights you hold in your code, questions, test data, and other original content. You grant Quorem a non-exclusive, worldwide, royalty-free permission to host, copy, transmit, execute, evaluate, and display that content only as needed to operate, secure, and support the service and carry out your sharing choices. This includes processing by service providers and displaying shared work to authorized participants.",
          "Sharing code in an interview does not transfer its ownership to Quorem or automatically grant the interviewer ownership. Any separate agreement between a candidate and an organization remains their responsibility. Publishing a question makes its published material available to the audience you select. The operational permission continues only as needed for retained records and obligations described in the Privacy Policy.",
          "Submit only material you have permission to use and share. Do not submit confidential employer material, personal data, or secrets without authorization. Quorem’s software, branding, and provided questions remain subject to their owners’ rights and any stated licenses; using the service does not grant ownership of them.",
        ],
      },
      {
        id: "sessions",
        title: "Interviews & shared work",
        paragraphs: [
          "Hosts and interviewers manage invitations and available session settings. Review the rules and monitoring notices before joining. Depending on those settings, session activity can include paste and window-focus events. Monitoring can be incomplete or inaccurate and should not be treated as conclusive proof of misconduct.",
          "Respect private questions, candidate work, and personal information you access. Do not publish or reuse another person’s nonpublic material without permission or another lawful basis. Organizers are responsible for appropriate participant notices, lawful use of candidate information, and their own hiring or educational decisions. Quorem’s results do not guarantee any professional outcome.",
        ],
      },
      {
        id: "access",
        title: "Access, limits & external services",
        paragraphs: [
          "While you comply with these terms, you may access Quorem for its intended purposes within the available features and usage limits. We may change limits or features to protect capacity and maintain the project. Current free access does not create a promise that every feature will remain available or free forever. Any future purchase would require separately disclosed pricing and payment terms; these terms do not enroll you in a paid subscription.",
          "Optional external sign-in services and links are subject to their own terms. We do not control those services or guarantee their availability. Do not assume that access through an external account guarantees continuing access to Quorem.",
        ],
      },
      {
        id: "termination",
        title: "Suspension & account closure",
        paragraphs: [
          "You may stop using Quorem at any time and request account closure at contact@quorem.app. We may suspend or end access for violations, abuse, security or legal concerns, or if we discontinue the project. Where reasonably practicable, we will provide notice and an opportunity to address a problem; urgent action may be taken without advance notice.",
          "After access ends, you may lose access to your workspace and session records. Retention and deletion follow the Privacy Policy, including applicable exceptions for shared records and legal obligations. Keep separate copies of work you need. Provisions concerning ownership, retained content, confidentiality of others’ material, liability, and disputes continue to apply where relevant after access ends.",
        ],
      },
      {
        id: "availability",
        title: "Availability & warranties",
        paragraphs: [
          "To the extent permitted by law, Quorem is provided ‘as is’ and ‘as available’, without warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not promise uninterrupted service, error-free execution, perfectly accurate grading or monitoring, or that every loss of data can be recovered.",
          "Quorem is a small project, not a service with a guaranteed uptime or support response time. Sessions can end and execution or saving can fail. You remain responsible for checking results and preserving copies of important work. These limitations do not exclude warranties or consumer protections that the law requires.",
        ],
      },
      {
        id: "liability",
        title: "Limits on liability",
        paragraphs: [
          "To the maximum extent permitted by law, Quorem and its operator are not liable for indirect, incidental, special, consequential, or punitive losses arising from use of the service, including lost profits, lost opportunities, or loss of data. Our total liability arising from the service or these terms is limited to the amount you paid us for Quorem in the 12 months before the event giving rise to the claim. If you paid nothing, that limit is zero, to the extent the law permits.",
          "These exclusions and limits do not apply to fraud, gross negligence, willful misconduct, or any liability that applicable law does not allow us to exclude or limit. They also do not restrict mandatory consumer rights. The extent to which these provisions apply depends on applicable law.",
        ],
      },
      {
        id: "changes",
        title: "Changes to these terms",
        paragraphs: [
          "We may update these terms to reflect changes in the service or legal requirements. We will post the revised version with its date and give reasonable advance notice of material changes through the service or by email, except where immediate changes are necessary for legal or security reasons. We will obtain additional agreement where required by law.",
          "If you do not agree to revised terms, stop using Quorem and contact us about account closure or your information. Changes will not retroactively remove rights relating to a dispute that arose before the change.",
        ],
      },
      {
        id: "contact",
        title: "Questions & disputes",
        paragraphs: [
          "For support, content complaints, privacy requests, or a dispute, contact contact@quorem.app with enough detail for us to investigate. We encourage trying to resolve problems directly, but contacting us is not a condition for exercising rights available under applicable law. These terms do not require arbitration or waive access to small-claims court or other courts with proper jurisdiction.",
          "If a provision is unenforceable, the remaining provisions continue to apply to the extent permitted by law. Failure to enforce a provision immediately is not a waiver. These terms and any separate terms you expressly accept for a feature govern your use of Quorem, subject to mandatory legal protections.",
        ],
      },
    ],
  },
};
