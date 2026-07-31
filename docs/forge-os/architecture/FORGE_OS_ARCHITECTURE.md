# FORGE OS Architecture

Status: Draft
Version: 0.1
Architecture Phase: 2B — Master Architecture Expansion
Authority: Owner-approved architectural contract required before runtime expansion
Implementation Status: Target Version 1 architecture with prototype implementation mapping

---

## 1. Purpose

FORGE OS is a shared engineering operating platform.

It coordinates:

- repository inspection
- engineering memory
- governance
- planning
- validation
- execution
- reasoning
- recovery
- logical agent roles
- bounded workspaces

The platform exists to make engineering activity attributable, governed, inspectable, reproducible, context-aware, validation-first, safe by default, and resistant to architectural drift.

FORGE OS owns orchestration and shared engineering operating capabilities.

FORGE OS does not own workspace business logic.

This document defines the master architecture for the platform.

---

## 2. Architectural Authority

The engineering authority of FORGE OS is established through the following documents, in descending order of authority:

1. `FORGE_OS_CONSTITUTION.md`
   - constitutional engineering authority
   - architectural invariants
   - governance law

2. `FORGE_ARCHITECTURAL_PRINCIPLES.md`
   - engineering doctrine
   - dependency principles
   - architectural guidance

3. `FORGE_OS_ARCHITECTURE.md`
   - master system architecture
   - component boundaries
   - dependency rules
   - canonical data flow
   - runtime lifecycle

4. `FORGE_OS_KERNEL_SPECIFICATION.md`
   - kernel manager responsibilities
   - stable manager contracts
   - manager authority boundaries

5. `WORKSPACE_MODEL.md`
   - workspace isolation
   - workspace registration
   - workspace-owned capabilities

6. `MEMORY_ARCHITECTURE.md`
   - durable engineering memory
   - working context
   - incidents
   - decisions
   - lessons
   - owner preferences

7. `REPOSITORY_INTELLIGENCE_MODEL.md`
   - repository inspection
   - structural evidence
   - dependency mapping
   - architecture discovery
   - impact analysis

8. `AGENT_COORDINATION_MODEL.md`
   - logical agent roles
   - task delegation
   - authority propagation
   - shared context
   - arbitration

9. `VERSION_1_ROADMAP.md`
   - implementation sequence
   - architectural gates
   - validation milestones
   - Version 1 boundaries

Where supporting documents conflict with higher-authority governance documents, the higher-authority document governs until the conflict is explicitly resolved.

---

## 3. Architectural Overview

FORGE OS is a layered engineering operating platform that separates human
authority, engineering orchestration, bounded platform capabilities, domain
behavior, stable contracts, implementation adapters, and infrastructure.

Authority and intent flow from the Owner Interface toward execution.

Evidence, outcomes, findings, and approval requirements flow back through the
Kernel and the Canonical Engineering Context.

The seven architectural layers are:

1. Owner Interface
2. FORGE OS Kernel
3. Kernel Manager Layer
4. Workspace Layer
5. Platform Contract Layer
6. Adapter Layer
7. Infrastructure Layer

This separation prevents:

- the Kernel from absorbing workspace business logic
- managers from becoming competing orchestration systems
- workspaces from acquiring shared platform responsibilities
- adapters from making engineering-policy decisions
- infrastructure from becoming a source of engineering authority

Implementation dependencies point toward contracts, adapters, and
infrastructure.

Lower architectural layers shall not acquire authority over higher-level
engineering decisions.

---

## 4. Architectural Layers

The seven architectural layers define responsibility, dependency direction,
and authority boundaries for FORGE OS.

### 4.1 Owner Interface

The Owner Interface is the authoritative entry point for human intent.

It is responsible for:

- defining engineering objectives
- establishing owner directives
- approving architectural decisions
- granting or denying protected-operation authority
- reviewing validation and governance evidence
- accepting residual risk
- directing long-term platform evolution

The Owner Interface does not directly implement manager capabilities,
workspace business logic, adapters, or infrastructure behavior.

### 4.2 FORGE OS Kernel

The Kernel is the sole platform-level coordinator of engineering activity.

It is responsible for:

- receiving and classifying engineering requests
- establishing lifecycle state
- constructing and maintaining the Canonical Engineering Context
- coordinating Kernel managers
- coordinating workspace activation
- enforcing authority, security, governance, and validation gates
- sequencing execution
- publishing canonical events
- coordinating recovery
- determining whether a workflow may complete

The Kernel owns coordination but does not absorb manager responsibilities or
workspace business logic.

### 4.3 Kernel Manager Layer

Kernel managers own bounded engineering capabilities.

Version 1 managers are:

- Repository Intelligence Manager
- Memory Manager
- Planning Manager
- Execution Manager
- Validation Manager
- Governance Manager
- Security Manager
- Reasoning Manager
- Recovery Manager
- Workspace Manager

Managers operate through versioned request and outcome contracts.

A manager shall not:

- establish a competing orchestration lifecycle
- directly control another manager
- maintain competing canonical engineering truth
- bypass Kernel authority
- absorb workspace-specific business logic

### 4.4 Workspace Layer

Workspaces own domain-specific and business-specific behavior.

A workspace may contain:

- domain models
- business rules
- workflows
- application services
- user interfaces
- domain integrations
- workspace-specific validation
- workspace-specific execution procedures

Workspaces register capabilities with the Workspace Manager and participate
through platform contracts.

A workspace shall not own shared Kernel orchestration.

### 4.5 Platform Contract Layer

The Platform Contract Layer defines versioned boundaries between:

- the Kernel and managers
- the Kernel and workspaces
- managers and adapters
- workspaces and adapters
- extensions and the platform
- canonical events and their consumers
- Canonical Engineering Context producers and consumers

Contract definitions include:

- request schemas
- outcome schemas
- event schemas
- context schemas
- authority requirements
- evidence requirements
- compatibility declarations
- failure semantics

Contracts are architectural assets and remain independent of individual
implementations.

### 4.6 Adapter Layer

Adapters translate platform contracts into implementation-specific behavior.

Examples include:

- repository adapters
- filesystem adapters
- command-execution adapters
- validation-tool adapters
- AI-provider adapters
- database adapters
- observability adapters
- authentication adapters
- deployment adapters

Adapters shall not independently determine engineering policy, approval,
governance, or completion.

### 4.7 Infrastructure Layer

Infrastructure supplies physical and external resources.

Examples include:

- repositories
- filesystems
- databases
- operating systems
- local processes
- cloud platforms
- AI providers
- authentication services
- external APIs
- logging destinations

Infrastructure may report capability, availability, and operational outcomes,
but it shall not become the source of engineering authority.

---

## 5. Core Architectural Principles

The following principles govern every architectural decision within FORGE OS. All runtime components, services, workspaces, and future extensions shall conform to these principles unless an owner-approved architectural revision explicitly supersedes them.

### 5.1 Stable Contracts

Every architectural component shall communicate through explicit, versioned contracts rather than implementation details.

Implementations may evolve independently provided their published contracts remain compatible.

### 5.2 Separation of Responsibilities

Each architectural layer shall have one primary responsibility.

Business logic belongs to workspaces.

Shared orchestration belongs to the kernel.

Infrastructure provides capabilities but does not perform engineering decisions.

### 5.3 Single Source of Engineering Truth

The Canonical Engineering Context is the authoritative engineering state for the platform.

Planning, execution, validation, governance, reasoning, recovery, and agent coordination shall consume this shared context rather than maintaining independent engineering state.

### 5.4 Repository Evidence First

Current repository evidence has higher authority than remembered state, inferred state, generated summaries, or conversational assumptions.

Engineering decisions shall always be based upon inspected repository evidence whenever available.

### 5.5 Validation Before Acceptance

Execution alone never constitutes completion.

Engineering work is considered complete only after required validation succeeds and evidence has been recorded.

### 5.6 Explicit Authority

Every mutation requires explicit authority.

Authority shall be represented as data and validated before execution.

### 5.7 Safe Failure

When uncertainty exists, FORGE OS shall preserve evidence, stop unsafe execution, classify the failure, and recommend bounded recovery rather than continuing speculatively.

---

## 6. Dependency Rules

Architectural dependencies define how information, authority, and implementation flow throughout the platform.

FORGE OS shall enforce the following dependency rules.

### 6.1 Downward Dependencies

Dependencies shall always point toward lower architectural layers.

Higher layers may depend upon lower layers.

Lower layers shall never depend upon higher layers.

### 6.2 Workspace Independence

Workspaces shall remain independent from one another.

Cross-workspace interaction shall occur only through published platform contracts.

### 6.3 Kernel Independence

The kernel shall never contain workspace-specific business rules.

Its responsibility is orchestration, coordination, and shared engineering services.

### 6.4 Infrastructure Isolation

Infrastructure provides storage, computation, networking, authentication, external integrations, and runtime resources.

Infrastructure shall never own planning, governance, validation, or engineering decision logic.

### 6.5 Contract Stability

Implementations may change without affecting dependent components provided published contracts remain compatible.

Architectural compatibility shall always take precedence over implementation convenience.

---

## 7. Canonical Engineering Context

The Canonical Engineering Context (CEC) is the single authoritative
engineering-state boundary of FORGE OS.

It represents the attributable engineering state known to the platform for a
specific context version.

The CEC is not merely a shared mutable object.

It is a versioned canonical model constructed from validated evidence and
updated through controlled Kernel coordination.

The CEC shall contain or reference:

- context identity
- context version
- repository intelligence
- repository baseline
- observed repository state
- engineering memory
- architectural metadata
- engineering requests
- owner directives
- planning state
- accepted plans
- authority state
- security state
- governance evidence
- execution state
- execution evidence
- validation requirements
- validation evidence
- reasoning evidence
- recovery state
- incident evidence
- workspace registrations
- workspace activation state
- manager registration
- manager availability
- unresolved assumptions
- unresolved findings
- unresolved risks
- approvals
- approval requirements
- workflow correlation references
- event correlation references

Subsystems contribute bounded evidence to the CEC but shall not establish a
competing source of engineering truth.

### 7.1 Context Construction

Context construction shall:

1. identify the requested workspace and repository scope
2. load the last accepted context version where available
3. inspect current repository and runtime evidence
4. load relevant durable engineering memory
5. load architectural and governance authority
6. load security and identity state
7. discover manager and workspace capabilities
8. identify divergence, uncertainty, and unresolved recovery state
9. reconcile evidence according to architectural authority
10. publish a new attributable context version

Repository evidence has priority over stale remembered repository state.

Owner directives have authority over recommendations but do not transform
unobserved assumptions into repository facts.

Validation evidence has authority only for checks that were actually executed.

### 7.2 Context Update

A CEC update shall identify:

- prior context version
- initiating request or workflow
- contributing manager outcomes
- contributing workspace outcomes
- canonical events
- evidence added
- state transitions
- unresolved conflicts
- authority used
- resulting context version

Managers shall propose bounded outcomes.

The Kernel coordinates acceptance of those outcomes into canonical state.

### 7.3 Context Reconciliation

When evidence conflicts, the Kernel shall not silently select the most
convenient value.

Reconciliation shall:

- identify the conflict
- preserve both attributable evidence sources
- apply the architectural authority hierarchy
- classify the unresolved condition
- request inspection, validation, governance, security review, recovery, or
  owner decision as appropriate
- prevent unsafe execution while blocking uncertainty remains

Every planning cycle begins with the current Canonical Engineering Context.

Every completed, blocked, failed, degraded, or recovered workflow shall produce
an attributable context outcome.

---

## 8. Kernel Architecture

The FORGE OS Kernel is the sole coordinator of platform-level engineering
workflows.

It converts owner intent and observed engineering conditions into controlled,
attributable, and recoverable lifecycle execution.

The Kernel shall remain smaller than the combined manager and workspace
capability surface.

It coordinates bounded capabilities rather than implementing all capabilities
directly.

### 8.1 Kernel Responsibilities

The Kernel is responsible for:

- engineering-request intake
- request identity and correlation
- request classification
- Canonical Engineering Context construction
- manager discovery and availability checks
- workspace discovery and activation
- lifecycle-state coordination
- planning coordination
- authority evaluation
- security evaluation
- governance evaluation
- execution sequencing
- validation coordination
- reasoning coordination
- event publication
- evidence attribution
- completion determination
- failure classification
- recovery coordination
- owner escalation

### 8.2 Kernel Internal Components

The Version 1 Kernel architecture contains the following logical components:

- Request Gateway
- Request Classifier
- Context Coordinator
- Lifecycle Coordinator
- Manager Registry
- Workspace Registry
- Capability Router
- Authority Coordinator
- Event Coordinator
- Evidence Coordinator
- Completion Coordinator
- Recovery Coordinator

These are Kernel responsibilities, not independent manager systems.

#### Request Gateway

The Request Gateway receives engineering requests and establishes:

- request identity
- initiating actor
- requested workspace
- requested repository scope
- requested objective
- supplied constraints
- supplied authority
- correlation references

#### Request Classifier

The Request Classifier determines the request category, required capabilities,
initial risk classification, and whether planning, execution, validation,
governance, security, reasoning, or recovery participation is required.

#### Context Coordinator

The Context Coordinator constructs, versions, reconciles, and publishes the
Canonical Engineering Context.

#### Lifecycle Coordinator

The Lifecycle Coordinator owns the authoritative workflow state machine and
sequences manager and workspace participation.

#### Manager Registry

The Manager Registry records:

- manager identity
- manager version
- supported contract versions
- declared capabilities
- health
- availability
- dependencies
- activation requirements

#### Workspace Registry

The Workspace Registry records:

- workspace identity
- workspace version
- supported contracts
- declared capabilities
- repository boundaries
- activation requirements
- health
- availability

#### Capability Router

The Capability Router resolves a required capability to an eligible manager,
workspace, or adapter through registered contracts.

It shall not select implementations that violate declared boundaries,
authority, compatibility, or health requirements.

#### Authority Coordinator

The Authority Coordinator evaluates whether the current actor, request,
workflow state, and evidence permit the next protected transition.

#### Event Coordinator

The Event Coordinator publishes canonical lifecycle events with stable
identity, correlation, causation, source, version, and evidence references.

#### Evidence Coordinator

The Evidence Coordinator preserves attributable inputs and outcomes produced by
the Kernel, managers, workspaces, adapters, and infrastructure.

#### Completion Coordinator

The Completion Coordinator determines whether the request is:

- completed
- completed with accepted residual risk
- blocked
- failed
- degraded
- cancelled
- awaiting owner decision
- awaiting external dependency
- entering recovery

#### Recovery Coordinator

The Recovery Coordinator initiates controlled recovery when execution,
validation, governance, security, context reconciliation, workspace
activation, or infrastructure behavior fails.

### 8.3 Kernel Lifecycle

The canonical lifecycle is:

1. receive request
2. establish identity and correlation
3. classify request
4. construct or refresh the Canonical Engineering Context
5. discover required capabilities
6. activate required workspace context
7. construct or obtain an engineering plan
8. evaluate authority, security, and governance gates
9. sequence bounded execution
10. collect execution evidence
11. run required validation
12. reconcile outcomes into canonical context
13. determine completion or recovery state
14. publish final lifecycle events
15. return attributable outcome to the Owner Interface

A lifecycle step may be skipped only when the request contract and current
context prove that the step is not required.

### 8.4 Kernel State Machine

The minimum Version 1 workflow states are:

- received
- classified
- context-building
- context-ready
- planning
- awaiting-approval
- ready-for-execution
- executing
- validating
- reconciling
- recovering
- blocked
- failed
- degraded
- completed
- cancelled

Every transition shall identify:

- prior state
- next state
- initiating cause
- authority used
- evidence produced
- timestamp
- correlation identity
- resulting context version

### 8.5 Kernel Coordination Rules

The Kernel shall:

- use contracts rather than implementation-specific calls where practical
- preserve manager and workspace boundaries
- prevent direct manager-to-manager orchestration
- prevent workspaces from controlling shared platform lifecycle
- fail closed when protected authority is absent
- preserve partial evidence when workflows fail
- avoid reporting success before required validation completes
- distinguish blocked, failed, degraded, and recovered outcomes
- make lifecycle transitions attributable
- avoid hidden state outside canonical lifecycle and context records

---

## 9. Kernel Managers

Kernel functionality is divided among bounded managers.

Each manager owns one architectural capability and participates in workflows
only through Kernel coordination and versioned platform contracts.

Managers contribute specialized evidence and outcomes to the Canonical
Engineering Context.

A manager does not own the complete engineering workflow.

Every manager shall declare:

- manager identity
- manager version
- supported contract versions
- provided capabilities
- required dependencies
- activation requirements
- authority requirements
- input requirements
- outcome schema
- evidence schema
- failure semantics
- health and availability state

Every manager shall:

- accept attributable requests
- return attributable outcomes
- preserve request and workflow correlation
- distinguish observations from recommendations
- distinguish recommendations from authorized decisions
- report partial outcomes when appropriate
- fail explicitly rather than silently degrading protected behavior
- avoid maintaining competing canonical engineering state
- avoid directly orchestrating another manager
- avoid bypassing Kernel lifecycle, authority, security, or governance gates

Version 1 defines the following Kernel managers:

### 9.1 Repository Intelligence Manager

The Repository Intelligence Manager produces attributable observations about
repository structure, state, dependencies, and likely impact.

Responsible for:

- repository inspection
- repository baseline capture
- working-tree observation
- branch and revision observation
- structural analysis
- dependency discovery
- architectural mapping
- symbol and reference discovery
- change-surface identification
- impact analysis
- repository divergence detection
- repository evidence production

Inputs may include:

- repository identity
- requested scope
- current Canonical Engineering Context
- inspection depth
- requested evidence categories
- known architectural boundaries

Outputs may include:

- observed repository baseline
- structural inventory
- dependency map
- architectural observations
- affected components
- uncertainty findings
- divergence findings
- impact assessment
- repository evidence references

The Repository Intelligence Manager shall distinguish directly observed facts
from inferred relationships.

It shall not:

- modify repository state
- authorize changes
- claim validation that was not executed
- replace the Planning Manager
- convert stale memory into current repository fact

### 9.2 Memory Manager

The Memory Manager preserves and retrieves attributable engineering knowledge
without becoming a competing source of current repository truth.

Responsible for:

- durable engineering memory
- working context
- historical context
- architectural decisions
- governance decisions
- incidents
- recovery history
- lessons learned
- owner directives
- owner preferences
- known invariants
- prior validation outcomes
- prior workflow summaries
- memory relevance evaluation
- memory provenance

Memory records shall identify:

- memory identity
- memory type
- source
- creation time
- applicable repository or workspace
- applicable version or revision where known
- authority classification
- confidence
- supersession state
- evidence references

The Memory Manager may return:

- relevant decisions
- relevant incidents
- known invariants
- prior plans
- prior outcomes
- warnings
- owner preferences
- potentially stale context
- conflicting memories

The Memory Manager shall clearly distinguish:

- current owner directives
- historical owner directives
- observed facts
- accepted decisions
- recommendations
- lessons learned
- unresolved assumptions

Repository inspection overrides stale remembered repository state.

Memory may inform planning and reasoning, but memory alone shall not prove the
current state of a repository, runtime, dependency, validation result, or
external system.

### 9.3 Planning Manager

The Planning Manager converts an accepted engineering objective and current
Canonical Engineering Context into a bounded, attributable execution plan.

Responsible for:

- objective interpretation
- scope definition
- constraint incorporation
- assumption identification
- task decomposition
- dependency ordering
- architectural sequencing
- execution-step definition
- validation-step definition
- governance-gate definition
- security-gate definition
- approval requirement identification
- recovery consideration
- plan evidence production

Planning inputs may include:

- engineering request
- current Canonical Engineering Context
- repository intelligence
- relevant memory
- owner directives
- architecture contracts
- governance requirements
- security requirements
- workspace capabilities
- manager capabilities
- known incidents and invariants

A plan shall identify:

- plan identity
- plan version
- initiating request
- objective
- repository and workspace scope
- assumptions
- constraints
- ordered steps
- step dependencies
- responsible capabilities
- expected inputs
- expected outcomes
- protected operations
- authority requirements
- validation requirements
- governance requirements
- security requirements
- rollback or recovery expectations
- completion criteria
- unresolved questions
- known risks

The Planning Manager may propose alternatives and recommendations.

It shall not:

- execute repository changes
- grant authority
- approve its own protected plan
- claim that assumptions are observed facts
- bypass required validation, governance, or security gates
- report completion of work that has not been executed

Plans shall remain deterministic for equivalent canonical inputs unless an
explicitly recorded nondeterministic capability is required.

### 9.4 Execution Manager

The Execution Manager coordinates authorized execution steps and preserves
attributable execution evidence.

Responsible for:

- accepted-plan intake
- execution readiness verification
- step sequencing
- dependency enforcement
- protected-operation checks
- adapter invocation
- workspace-operation coordination
- execution-state tracking
- execution evidence collection
- partial-result preservation
- interruption handling
- cancellation handling
- failure reporting
- handoff to validation
- handoff to recovery

Execution inputs may include:

- accepted plan
- current Canonical Engineering Context
- authority evidence
- governance evidence
- security evidence
- workspace activation state
- manager availability
- adapter availability
- repository baseline
- execution constraints

Every execution step shall identify:

- step identity
- plan identity
- required capability
- target scope
- expected preconditions
- actual preconditions
- authority used
- operation requested
- implementation selected
- start time
- completion time
- outcome status
- produced evidence
- changed resources
- unresolved side effects
- recovery information

The Execution Manager shall distinguish:

- not started
- ready
- running
- completed
- completed with warnings
- blocked
- failed
- cancelled
- interrupted
- recovery required

The Execution Manager shall not:

- alter an accepted plan without an attributable plan revision
- invent missing authority
- bypass security or governance gates
- silently continue after a failed protected step
- declare workflow completion before required validation
- conceal partial changes or side effects
- directly establish canonical engineering truth

Execution outcomes are proposed to the Kernel for reconciliation into the
Canonical Engineering Context.

### 9.5 Validation Manager

The Validation Manager determines whether executed outcomes satisfy declared
technical, architectural, operational, and acceptance requirements.

Responsible for:

- validation-scope interpretation
- validation planning
- test selection
- static-analysis coordination
- build verification
- runtime verification
- contract verification
- architectural-boundary verification
- acceptance-criteria verification
- regression verification
- evidence collection
- validation-result classification
- validation reporting
- unresolved-defect reporting

Validation inputs may include:

- accepted plan
- execution outcomes
- changed-resource inventory
- required validation checks
- repository baseline
- resulting repository state
- workspace validation capabilities
- architecture contracts
- acceptance criteria
- known invariants
- prior relevant validation evidence

Every validation check shall identify:

- check identity
- validation category
- target scope
- command or capability used
- expected result
- actual result
- start time
- completion time
- status
- evidence references
- limitations
- skipped conditions
- unresolved findings

Validation outcomes shall distinguish:

- passed
- passed with warnings
- failed
- blocked
- not run
- partially run
- unavailable
- inconclusive

The Validation Manager shall not:

- report unexecuted checks as passed
- conceal skipped or unavailable checks
- grant authority
- approve governance exceptions
- modify implementation merely to produce a passing report
- treat prior validation as proof of current behavior without confirming
  continued applicability
- declare workflow completion independently of the Kernel

Validation evidence is authoritative only for the checks, scope, environment,
revision, and conditions actually evaluated.

### 9.6 Governance Manager

The Governance Manager evaluates engineering activity against owner-approved
policies, architectural contracts, delegation boundaries, and approval rules.

Responsible for:

- governance-policy loading
- architectural-compliance evaluation
- authority-delegation evaluation
- owner-directive enforcement
- protected-operation classification
- approval requirement determination
- policy-exception handling
- governance-gate evaluation
- governance evidence production
- residual-risk reporting
- noncompliance reporting
- owner-escalation recommendation

Governance inputs may include:

- engineering request
- accepted plan
- current Canonical Engineering Context
- owner directives
- governance mode
- architectural contracts
- delegation configuration
- security findings
- execution evidence
- validation evidence
- requested exceptions
- known incidents and invariants

A governance decision shall identify:

- decision identity
- applicable policy
- applicable architecture rule
- evaluated subject
- requesting actor
- available authority
- required authority
- evidence considered
- decision status
- conditions
- exceptions
- residual risks
- required approvals
- expiration or review requirements

Governance decisions shall distinguish:

- permitted
- permitted with conditions
- owner approval required
- denied
- blocked by missing evidence
- blocked by policy conflict
- exception requested
- exception approved
- exception denied
- review required

The Governance Manager shall not:

- invent owner approval
- broaden delegated authority
- silently waive architecture requirements
- replace the Security Manager
- replace technical validation
- execute repository changes
- treat a recommendation as an approved governance decision
- conceal policy conflicts or residual risk

Governance enforcement shall fail closed for protected operations when required
authority, evidence, or approval is absent.

### 9.7 Security Manager

The Security Manager evaluates whether identities, credentials, resources,
operations, and execution boundaries satisfy platform security requirements.

Responsible for:

- identity-context evaluation
- authentication-state evaluation
- authorization evaluation
- least-privilege enforcement
- credential-boundary enforcement
- secret-handling requirements
- repository-boundary protection
- filesystem-boundary protection
- command-execution restrictions
- network-access restrictions
- external-provider restrictions
- sensitive-data classification
- protected-operation evaluation
- security evidence production
- security-incident reporting

Security inputs may include:

- initiating actor
- engineering request
- accepted plan
- current Canonical Engineering Context
- requested operations
- target resources
- credential references
- workspace security declarations
- adapter security declarations
- governance decisions
- infrastructure capability and health
- applicable security policies

A security decision shall identify:

- decision identity
- evaluated actor
- evaluated operation
- target resource
- required permission
- available permission
- credential class
- applicable policy
- evidence considered
- decision status
- conditions
- restrictions
- unresolved findings
- expiration or reevaluation requirements

Security decisions shall distinguish:

- permitted
- permitted with restrictions
- authentication required
- authorization required
- credential unavailable
- credential invalid
- denied
- blocked by policy
- blocked by insufficient evidence
- security review required
- incident suspected

The Security Manager shall not:

- expose secret values in plans, events, evidence, logs, or context
- broaden actor authority
- invent credentials
- bypass owner or governance authority
- approve operations outside declared repository or workspace boundaries
- treat infrastructure availability as permission
- execute repository changes
- conceal security findings

Protected operations shall fail closed when authentication, authorization,
credential, boundary, or policy requirements are not satisfied.

### 9.8 Reasoning Manager

The Reasoning Manager produces bounded engineering analysis,
recommendations, alternatives, and explanations from attributable context.

Responsible for:

- problem interpretation
- engineering analysis
- architectural analysis
- alternative generation
- tradeoff evaluation
- risk reasoning
- assumption identification
- uncertainty classification
- recommendation generation
- explanation generation
- decision-support evidence
- escalation recommendation

Reasoning inputs may include:

- engineering request
- current Canonical Engineering Context
- repository intelligence
- relevant engineering memory
- architecture contracts
- accepted plans
- execution evidence
- validation evidence
- governance evidence
- security evidence
- recovery evidence
- workspace knowledge
- owner directives and preferences

A reasoning outcome shall identify:

- reasoning identity
- question or decision supported
- evidence considered
- assumptions
- constraints
- alternatives considered
- tradeoffs
- uncertainties
- risks
- recommendation
- confidence
- required validation
- required owner decision
- evidence references

The Reasoning Manager shall clearly distinguish:

- observed fact
- retrieved memory
- architectural rule
- assumption
- inference
- prediction
- recommendation
- owner-approved decision

The Reasoning Manager shall not:

- establish repository facts without repository evidence
- grant authority
- approve its own recommendation
- execute changes
- replace validation
- replace governance
- replace security review
- conceal uncertainty
- report generated reasoning as owner intent
- modify the Canonical Engineering Context directly

Reasoning recommendations become actionable only through Kernel coordination,
accepted planning, and all required authority, security, governance, execution,
and validation gates.

### 9.9 Recovery Manager

Responsible for:

- failure classification
- recovery planning
- rollback coordination
- incident handling
- operational resilience

### 9.10 Workspace Manager

Responsible for:

- workspace registration
- capability discovery
- lifecycle management
- workspace isolation
- workspace metadata

---

## 10. Manager Contracts

Kernel managers communicate exclusively through published architectural contracts.

Managers shall not depend upon one another's internal implementation.

Each manager shall expose only the interfaces required by other architectural components.

Every manager contract shall define:

- responsibilities
- inputs
- outputs
- authority requirements
- validation requirements
- failure behavior
- version compatibility

Managers exchange engineering state through the Canonical Engineering Context.

Direct implementation coupling between managers is prohibited.

A manager may evolve internally without affecting the remainder of the platform provided its published contract remains compatible.

Manager contracts constitute stable architectural boundaries and shall be treated as versioned platform interfaces.

---

## 11. Engineering Memory Architecture

Engineering memory provides continuity across planning, execution, validation, and recovery.

Unlike conversational context, engineering memory is durable, structured, and governed by explicit lifecycle rules.

The Memory Manager is responsible for maintaining engineering memory as an authoritative architectural capability rather than as transient runtime state.

### 11.1 Memory Objectives

Engineering memory shall:

- preserve engineering continuity
- reduce rediscovery of previous work
- capture architectural decisions
- record incidents and resolutions
- maintain owner preferences
- provide historical engineering evidence
- support deterministic planning

### 11.2 Memory Categories

Version 1 defines the following memory categories:

- Working Context
- Architectural Decisions
- Repository Knowledge
- Incident History
- Lessons Learned
- Validation History
- Execution History
- Owner Preferences
- Governance History

Each category shall define its own lifecycle, retention policy, and validation requirements.

### 11.3 Architectural Boundaries

Engineering memory supports engineering decisions.

Engineering memory does not replace repository evidence.

When memory conflicts with inspected repository state, repository evidence shall remain authoritative until reconciliation occurs.

---

## 12. Repository Intelligence Architecture

Repository Intelligence provides an architectural understanding of the software system.

Rather than simply reading files, Repository Intelligence constructs a structured model describing architecture, dependencies, capabilities, risks, and implementation boundaries.

### 12.1 Objectives

Repository Intelligence shall:

- inspect repository structure
- discover architectural components
- identify dependency relationships
- detect architectural drift
- analyze implementation impact
- identify validation scope
- support planning decisions

### 12.2 Repository Model

The Repository Intelligence Manager maintains a structured engineering representation including:

- projects
- workspaces
- packages
- modules
- architectural layers
- contracts
- dependencies
- public interfaces
- implementation boundaries
- validation assets

This representation becomes part of the Canonical Engineering Context.

### 12.3 Architectural Authority

Repository Intelligence observes the repository.

It does not modify repository contents.

Repository mutation remains the responsibility of execution operating under approved authority.

---

## 13. Planning Architecture

Planning converts engineering objectives into deterministic execution plans.

Planning is performed against the Canonical Engineering Context using current repository evidence, engineering memory, governance constraints, and owner authority.

### 13.1 Planning Objectives

Planning shall:

- decompose objectives
- identify dependencies
- order execution
- minimize implementation risk
- preserve architectural boundaries
- define validation requirements
- identify approval requirements

### 13.2 Planning Outputs

Every planning operation produces a structured execution plan containing:

- objectives
- assumptions
- dependencies
- implementation tasks
- validation activities
- governance checkpoints
- expected deliverables
- completion criteria

### 13.3 Planning Constraints

Planning shall not authorize execution.

Planning produces recommendations and executable plans.

Execution begins only after required authority has been validated by the Governance Manager.

---

## 14. Execution Architecture

Execution transforms approved engineering plans into controlled engineering activity.

Execution shall operate only against approved plans, validated authority, and the current Canonical Engineering Context.

The Execution Manager is responsible for coordinating engineering work while preserving architectural integrity, validation requirements, and complete execution evidence.

### 14.1 Execution Objectives

Execution shall:

- execute approved engineering plans
- preserve architectural boundaries
- maintain execution traceability
- collect execution evidence
- coordinate dependent activities
- support interruption and recovery
- operate deterministically whenever practical

### 14.2 Execution Lifecycle

Every execution shall progress through defined lifecycle stages:

1. Authority Verification
2. Context Synchronization
3. Plan Initialization
4. Controlled Execution
5. Evidence Collection
6. Validation Coordination
7. Completion or Recovery

No execution stage may be skipped without explicit architectural approval.

### 14.3 Execution Evidence

Every execution shall produce durable engineering evidence including:

- execution identifier
- execution timestamp
- initiating authority
- affected components
- completed operations
- encountered failures
- generated artifacts
- validation requests
- completion status

Execution evidence becomes part of the Canonical Engineering Context.

---

## 15. Validation Architecture

Validation confirms that engineering work satisfies architectural, functional, and governance requirements.

Validation is an architectural responsibility rather than a testing activity performed after implementation.

The Validation Manager coordinates validation throughout the engineering lifecycle.

### 15.1 Validation Objectives

Validation shall:

- verify architectural compliance
- verify implementation correctness
- verify contract compatibility
- verify governance compliance
- verify completion criteria
- produce validation evidence
- determine engineering acceptance

### 15.2 Validation Categories

Version 1 supports validation including:

- architectural validation
- contract validation
- implementation validation
- repository validation
- governance validation
- security validation
- regression validation
- acceptance validation

Additional validation categories may be introduced without modifying kernel architecture.

### 15.3 Validation Authority

Validation results shall be objective.

Execution success alone shall never constitute engineering acceptance.

Engineering work becomes accepted only after required validation succeeds and evidence has been recorded.

---

## 16. Governance Architecture

Governance establishes the policies, authority, and decision boundaries that control engineering activity throughout FORGE OS.

The Governance Manager ensures that engineering activity remains compliant with approved architectural rules and owner authority.

### 16.1 Governance Objectives

Governance shall:

- validate authority
- enforce architectural policy
- enforce execution constraints
- preserve engineering accountability
- maintain approval records
- prevent unauthorized mutation
- provide governance evidence

### 16.2 Governance Model

Governance operates using explicit policies rather than implicit behavior.

Every engineering action shall be evaluated against:

- architectural policy
- owner authority
- workspace permissions
- execution constraints
- security requirements
- validation requirements

### 16.3 Authority Model

Authority is represented as structured engineering data.

Authority may originate from:

- owner approval
- approved governance policy
- delegated architectural authority
- validated execution plans

Authority shall never be inferred from conversational context or previous execution history.

Every repository mutation shall be traceable to an explicit authority source.

---

## 17. Reasoning Architecture

Reasoning transforms engineering evidence into bounded recommendations that assist planning, execution, validation, governance, and recovery.

The Reasoning Manager shall operate exclusively against the Canonical Engineering Context and shall remain constrained by repository evidence, engineering memory, and approved governance policy.

Reasoning shall never establish engineering truth independently.

### 17.1 Reasoning Objectives

Reasoning shall:

- analyze engineering state
- evaluate architectural alternatives
- identify implementation risks
- explain recommendations
- support engineering decisions
- preserve architectural consistency
- remain bounded by evidence

### 17.2 Evidence Hierarchy

Engineering reasoning shall prioritize evidence in the following order:

1. Current repository evidence
2. Validation evidence
3. Governance state
4. Engineering memory
5. Historical execution evidence
6. Generated recommendations

Reasoning shall never elevate inferred conclusions above verified engineering evidence.

### 17.3 Recommendation Model

Every recommendation shall include:

- supporting evidence
- architectural rationale
- identified risks
- affected components
- implementation impact
- confidence assessment
- recommended next actions

Recommendations inform engineering decisions but shall not authorize execution.

---

## 18. Recovery Architecture

Recovery restores the engineering platform to a safe, consistent, and governed operating state following interruption, failure, or architectural inconsistency.

Recovery shall preserve engineering evidence before attempting corrective action.

### 18.1 Recovery Objectives

Recovery shall:

- classify failures
- preserve engineering evidence
- coordinate rollback
- restore architectural consistency
- resume interrupted execution
- minimize engineering disruption
- document recovery outcomes

### 18.2 Recovery Classification

Version 1 recognizes recovery categories including:

- execution failures
- validation failures
- governance violations
- repository inconsistencies
- infrastructure failures
- interrupted workflows
- architectural conflicts

Each recovery category shall define documented recovery procedures.

### 18.3 Recovery Guarantees

Recovery shall never discard engineering evidence.

Recovery actions shall remain traceable.

Every recovery operation shall produce durable recovery evidence that becomes part of the Canonical Engineering Context.

---

## 19. Workspace Architecture

A workspace is an isolated engineering domain that provides business capabilities while relying upon the FORGE OS Kernel for shared engineering services.

Workspaces extend the platform without modifying kernel architecture.

### 19.1 Workspace Objectives

Each workspace shall:

- encapsulate domain logic
- publish stable capabilities
- remain architecturally isolated
- consume platform contracts
- participate in governance
- contribute engineering evidence
- preserve implementation independence

### 19.2 Workspace Boundaries

A workspace owns:

- domain models
- business services
- workflows
- user interfaces
- domain integrations
- workspace configuration

A workspace shall not own shared kernel services.

### 19.3 Workspace Isolation

Workspaces shall not directly depend upon one another.

Shared functionality shall be accessed exclusively through published platform contracts.

---

## 20. Workspace Registration and Capability Model

Every workspace shall register with the Workspace Manager before participating in engineering operations.

Registration establishes architectural identity and published capabilities.

### 20.1 Registration Requirements

Every workspace registration shall include:

- workspace identifier
- version
- owner
- published capabilities
- required platform contracts
- compatibility declaration
- lifecycle status

### 20.2 Capability Publication

Capabilities shall be published through stable contracts.

Capability implementations may evolve without affecting dependent workspaces provided published contracts remain compatible.

### 20.3 Capability Discovery

The Workspace Manager shall maintain the authoritative registry of workspace capabilities.

Planning, execution, and reasoning shall discover workspace functionality through this registry rather than through implementation-specific knowledge.

---

## 21. Runtime Lifecycle

The FORGE OS Runtime Lifecycle defines the sequence through which engineering activity progresses from initialization to completion.

Every engineering operation shall follow a deterministic lifecycle to ensure reproducibility, traceability, and architectural consistency.

### 21.1 Runtime Phases

Version 1 defines the following runtime phases:

1. Platform Initialization
2. Workspace Discovery
3. Context Construction
4. Planning
5. Authority Validation
6. Execution
7. Validation
8. Recovery (if required)
9. Context Update
10. Completion

Each phase shall complete successfully before the next phase begins unless an approved recovery workflow is initiated.

### 21.2 Runtime Guarantees

The runtime shall guarantee:

- deterministic execution ordering
- complete engineering traceability
- consistent engineering context
- explicit authority validation
- durable engineering evidence
- bounded recovery behavior

### 21.3 Runtime Completion

A runtime operation is complete only after:

- execution has finished
- validation has succeeded
- engineering evidence has been recorded
- the Canonical Engineering Context has been updated

---

## 22. Security Architecture

Security protects engineering assets, execution authority, platform integrity, and operational trust.

Security is enforced throughout every architectural layer rather than being confined to infrastructure.

### 22.1 Security Objectives

Security shall:

- authenticate participants
- authorize engineering activity
- protect credentials
- preserve engineering integrity
- secure workspace isolation
- secure platform contracts
- record security evidence

### 22.2 Security Domains

Version 1 defines security domains including:

- identity
- authorization
- credential management
- workspace isolation
- contract integrity
- execution authorization
- audit evidence

### 22.3 Security Guarantees

Security controls shall operate continuously throughout planning, execution, validation, governance, and recovery.

No engineering mutation shall bypass architectural security requirements.

---

## 23. Observability and Telemetry

Observability provides visibility into engineering activity across the entire platform.

Observability supports engineering understanding rather than operational control.

### 23.1 Observability Objectives

Observability shall collect:

- execution metrics
- validation metrics
- governance metrics
- recovery metrics
- workspace metrics
- repository metrics
- platform health indicators

### 23.2 Engineering Telemetry

Engineering telemetry shall remain attributable to:

- engineering operations
- execution identifiers
- architectural components
- affected workspaces
- responsible managers

### 23.3 Observability Guarantees

Observability shall never modify engineering state.

Telemetry exists solely to improve engineering visibility and architectural understanding.

---

## 24. Extensibility Model

FORGE OS is designed for long-term architectural evolution through stable platform contracts.

New capabilities shall extend the platform without requiring kernel redesign.

### 24.1 Extension Principles

Extensions shall:

- preserve architectural contracts
- maintain backward compatibility
- remain independently deployable
- publish stable interfaces
- respect workspace isolation
- participate in governance

### 24.2 Supported Extension Types

Version 1 supports extension through:

- kernel managers
- workspaces
- platform contracts
- engineering tools
- reasoning providers
- repository adapters
- infrastructure adapters

### 24.3 Compatibility Requirements

Every extension shall declare:

- supported platform version
- required contracts
- published capabilities
- compatibility constraints

Extensions that violate architectural contracts shall not participate in runtime execution.

---

## 25. Architectural Invariants

Architectural invariants are rules that shall remain true regardless of implementation details or future platform evolution.

These invariants define the permanent engineering contract of FORGE OS.

### 25.1 Core Invariants

FORGE OS shall always preserve:

- a single Canonical Engineering Context
- explicit architectural authority
- stable platform contracts
- deterministic planning
- evidence-based reasoning
- validation before engineering acceptance
- workspace isolation
- repository-first engineering decisions

### 25.2 Mutation Invariants

Every engineering mutation shall:

- possess explicit authority
- produce engineering evidence
- remain attributable
- preserve architectural integrity
- participate in validation
- support recovery

### 25.3 Evolution Invariants

Future architectural evolution shall not invalidate:

- platform contracts
- workspace isolation
- Canonical Engineering Context
- engineering evidence
- governance authority
- engineering traceability

---

## 26. Version 1 Implementation Boundaries

Version 1 intentionally defines a bounded implementation to maximize stability while establishing a foundation for future expansion.

### 26.1 Included Capabilities

Version 1 includes:

- kernel managers
- workspace registration
- engineering memory
- repository intelligence
- planning
- execution
- validation
- governance
- reasoning
- recovery
- observability
- extensibility

### 26.2 Deferred Capabilities

Future versions may introduce:

- distributed execution
- multi-user collaboration
- autonomous engineering agents
- distributed engineering memory
- advanced optimization
- additional reasoning providers

These capabilities shall extend the architecture without violating established contracts.

### 26.3 Compatibility

Version 1 establishes the baseline compatibility contract for future platform versions.

Backward compatibility shall be preserved whenever practical.

---

## 27. Future Evolution

FORGE OS is designed to evolve continuously while preserving architectural stability.

Evolution shall occur through contract expansion rather than architectural replacement.

### 27.1 Evolution Principles

Future evolution shall:

- preserve architectural invariants
- maintain compatibility
- minimize disruption
- expand through stable contracts
- preserve engineering evidence
- remain governance-driven

### 27.2 Architectural Review

Significant architectural evolution shall require:

- documented rationale
- architectural review
- governance approval
- compatibility assessment
- updated engineering documentation

---

## 28. Architecture Completion Criteria

The FORGE OS Architecture shall be considered complete for Version 1 when:

- all architectural contracts are defined
- kernel responsibilities are documented
- workspace architecture is specified
- engineering lifecycle is documented
- governance model is complete
- validation model is complete
- implementation boundaries are established
- supporting specifications are synchronized

Future revisions shall extend this architecture rather than replace it.

---

## 29. Glossary

### Canonical Engineering Context (CEC)

The authoritative engineering model consumed by all kernel managers.

### Workspace

An isolated engineering domain providing business capabilities through stable platform contracts.

### Kernel

The shared engineering operating system responsible for orchestration and coordination.

### Manager

A kernel component responsible for one architectural capability.

### Platform Contract

A stable interface governing interaction between architectural components.

### Engineering Evidence

Structured information produced during planning, execution, validation, governance, reasoning, or recovery.

### Architectural Authority

Explicit authorization permitting engineering activity within defined governance constraints.
