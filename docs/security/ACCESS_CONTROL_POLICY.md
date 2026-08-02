# Access Control Policy

## Document Control

- Organization: 409 Marketplace LLC
- Platform: 409 Marketplace / FORGE
- Document Status: Active
- Policy Owner: Jason Morgan
- Review Frequency: Annual and after material access-control changes

---

## Purpose

This policy defines how access to 409 Marketplace systems, production assets,
financial integrations, sensitive data, and supporting infrastructure is
authorized, restricted, reviewed, and removed.

The policy supports the security requirements of Plaid, Stripe, Supabase,
Vercel, GitHub, and future FORGE worker infrastructure.

---

## Scope

This policy applies to:

- 409 Marketplace users
- Administrators and developers
- Contractors and service providers
- Supabase
- Vercel
- GitHub
- Plaid
- Stripe
- Production databases
- Development systems
- FORGE coordinator and worker systems

---

## Access Control Principles

409 Marketplace applies these principles:

- Access must be explicitly authorized.
- Access must be limited to legitimate operational need.
- Least privilege must be used wherever practical.
- Sensitive financial workflows require stronger authentication.
- Application users may only access data they are authorized to access.
- Secrets must not be exposed through normal application responses.
- Access changes must be traceable.
- Security claims must match verified implementation.

---

## Current Implemented Controls

Current controls include:

- Supabase authentication.
- Authenticated owner identification.
- Owner-scoped financial application access.
- Protected Plaid API routes.
- Database row-level security for applicable financial data.
- Credential-reference boundaries that exclude Plaid access tokens from
  ordinary connection models and summaries.
- Git-backed change history.
- Restricted production administration through managed service accounts.

---

## Consumer Access

Consumers must authenticate before accessing protected 409 Marketplace
features.

Current application authorization uses authenticated owner identity to limit
access to owner-scoped financial records and financial connection workflows.

Mandatory application-level MFA enforcement before Plaid Link is not yet
implemented.

Supabase TOTP MFA capability is enabled and mandatory MFA enforcement is
tracked as a Phase 5K security requirement.

---

## Administrative Access

Administrative access is limited to authorized individuals with a legitimate
business or operational need.

Critical systems include:

- GitHub
- Supabase
- Vercel
- Plaid
- Stripe
- Business email
- Domain administration
- Production databases
- FORGE coordinator infrastructure

Administrative credentials must not be shared.

Where supported, critical systems must use multi-factor authentication.

---

## Authorization

Authorization decisions must be based on authenticated identity, ownership,
assigned role, or explicitly granted authority.

Application ownership boundaries must prevent one user from accessing another
user's financial data.

Client-side interface restrictions are not sufficient by themselves.
Sensitive server-side routes must independently validate authorization.

---

## Least Privilege

Users, administrators, applications, service accounts, and future FORGE
workers must receive only the permissions required for their approved task.

Broad or permanent administrator access must be avoided where narrower access
is available.

Temporary elevated access must be removed after the approved task is complete.

---

## Access Provisioning

Access may be granted only after:

- Identity is verified.
- The required role or operational need is established.
- The minimum necessary access is identified.
- Required security controls are enabled.

Administrative access grants must be documented through repository history,
provider records, or another retained operational record.

---

## Access Modification

Access must be reviewed and modified when:

- Responsibilities change.
- A user or administrator changes roles.
- A contractor engagement changes.
- A system or vendor is replaced.
- A security incident affects account trust.
- Access is no longer required.

---

## Access Removal

Access must be removed promptly when:

- Employment or contractor access ends.
- A user account is closed.
- Authorization is withdrawn.
- Credentials are suspected to be compromised.
- A vendor relationship ends.
- A service account is retired.

Credential rotation must be considered when shared infrastructure or secrets
may have been exposed.

---

## Multi-Factor Authentication

MFA is required for critical administrative systems where supported.

The production roadmap requires application-level MFA assurance before:

- Plaid Link
- Plaid connection management
- Stripe payment administration
- Sensitive financial settings
- High-risk administrative actions

MFA capability alone does not constitute enforcement.

The application must verify the required authentication assurance level on
the server before permitting sensitive operations.

---

## Service Accounts and Secrets

Service accounts must be used only for approved system-to-system operations.

Secrets must:

- Remain outside the Git repository.
- Be stored through approved environment or secret-management systems.
- Be restricted to authorized services.
- Be rotated after suspected compromise.
- Never appear in ordinary logs or user-facing responses.

Plaid access tokens must remain behind the credential-vault boundary.

Encryption of persisted Plaid credentials remains a tracked Phase 5K
requirement.

---

## Access Reviews

Formal periodic access reviews are not yet operational.

Phase 5K requires a recurring review of:

- Administrative users
- Production service accounts
- GitHub access
- Supabase access
- Vercel access
- Plaid access
- Stripe access
- Business email and domain access
- FORGE coordinator and worker permissions

Access reviews must identify unnecessary, stale, excessive, or unprotected
access and track remediation to completion.

---

## Access Logging and Evidence

Relevant access events should be retained where supported, including:

- Authentication successes and failures
- MFA enrollment and changes
- Administrative access changes
- Plaid connection activity
- Stripe administration
- Secret rotation
- Account suspension and deletion
- Access review findings

A comprehensive security audit trail is a planned Phase 5K control.

---

## Policy Exceptions

Exceptions must be:

- Necessary for a documented operational reason.
- Limited in scope and duration.
- Approved by the policy owner.
- Reviewed for security impact.
- Removed when no longer required.

Exceptions must not be used to conceal permanent weak controls.

---

## Planned Improvements

Tracked improvements include:

- Mandatory MFA before Plaid Link.
- Server-side assurance-level enforcement.
- Periodic access reviews.
- Formal de-provisioning procedures.
- Security audit logging.
- Plaid credential encryption.
- Future FORGE worker permission boundaries.

---

## Review

This policy is reviewed:

- At least annually.
- After material authentication or authorization changes.
- After security incidents.
- Before broad external customer onboarding.
- Before new payment or financial-data integrations.

All revisions are maintained through Git history.
