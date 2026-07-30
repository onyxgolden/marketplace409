# FORGE OS Kernel Specification

Status: Draft
Version: 0.1
Architecture Authority: FORGE OS Master Architecture Specification Version 0.1
Phase: 2B — Kernel Specification

---

## 1. Purpose

The FORGE OS Kernel is the central orchestration authority of the FORGE OS platform.

The Kernel coordinates shared engineering capabilities across registered workspaces while remaining independent of workspace-specific business logic, implementation technologies, repository structures, and deployment environments.

This specification defines the operational responsibilities, architectural boundaries, lifecycle, contracts, coordination rules, and invariants of the Kernel.

It establishes the implementation-independent blueprint from which the Version 1 Kernel may be designed, implemented, validated, governed, and evolved.

The Kernel owns orchestration.

Kernel managers own bounded engineering capabilities.

Registered workspaces own their business logic and domain behavior.

---

## 2. Specification Scope

This specification defines:

- Kernel purpose
- architectural authority
- Kernel responsibilities
- Kernel exclusions
- Kernel lifecycle
- lifecycle state transitions
- Canonical Engineering Context integration
- Kernel manager coordination
- common manager contracts
- engineering request handling
- planning integration
- execution orchestration
- validation integration
- governance integration
- reasoning integration
- recovery integration
- workspace integration
- Kernel events
- state management
- error handling
- observability
- security responsibilities
- extension boundaries
- Version 1 constraints
- architectural invariants
- implementation readiness criteria

This specification does not define:

- implementation classes
- programming languages
- runtime frameworks
- storage technologies
- transport protocols
- user-interface behavior
- workspace-specific business rules
- workspace-specific execution procedures
- deployment infrastructure
- vendor-specific services
- internal algorithms
- physical repository layouts

Implementation decisions may evolve without changing this specification provided all published Kernel contracts, responsibilities, lifecycle rules, and architectural invariants remain satisfied.

---

## 3. Architectural Authority

The FORGE OS Master Architecture Specification is the governing architectural authority for this document.

This Kernel Specification refines the Kernel responsibilities established by the Master Architecture but shall not redefine, weaken, or contradict them.

Where ambiguity exists, authority shall be applied in the following order:

1. The FORGE OS Master Architecture governs platform structure and architectural intent.
2. This specification governs Kernel operational behavior.
3. Published manager specifications govern manager-specific behavior.
4. Workspace contracts govern workspace-specific integration.
5. Implementation details remain subordinate to all architectural specifications.

The Kernel shall enforce architectural authority through:

- explicit contracts
- bounded responsibilities
- authority validation
- governance evidence
- reproducible validation
- attributable execution
- observable lifecycle transitions

The Kernel shall not create competing architectural truth.

The Canonical Engineering Context is the authoritative engineering-state boundary used throughout Kernel operation.

---

## 4. Kernel Role

The Kernel is the platform-level coordinator of engineering activity.

The Kernel receives engineering requests, establishes authoritative context, coordinates managers, validates authority, orchestrates execution, coordinates verification, applies governance, updates canonical state, and publishes operational evidence.

The Kernel shall coordinate engineering capabilities without absorbing their internal responsibilities.

The Kernel shall remain:

- workspace-independent
- implementation-independent
- contract-driven
- policy-aware
- evidence-based
- attributable
- observable
- recoverable
- deterministic wherever practical

The Kernel shall not become a general-purpose repository for business logic, manager logic, workspace logic, or infrastructure behavior.

---

## 5. Kernel Responsibilities

The Kernel is responsible for:

- initializing the FORGE OS runtime
- validating platform configuration
- establishing architectural version compatibility
- loading the Canonical Engineering Context
- registering required Kernel managers
- validating manager contracts
- validating manager compatibility
- loading workspace registrations
- coordinating workspace discovery
- coordinating workspace activation
- receiving engineering requests
- validating request structure
- classifying engineering requests
- determining required capabilities
- coordinating engineering planning
- validating execution authority
- enforcing security boundaries
- coordinating bounded execution
- coordinating execution tracking
- coordinating validation
- coordinating governance evaluation
- coordinating engineering reasoning
- coordinating failure recovery
- updating the Canonical Engineering Context
- maintaining Kernel lifecycle state
- recording execution evidence
- recording validation evidence
- recording governance evidence
- publishing canonical Kernel events
- preserving workspace isolation
- exposing stable platform contracts
- producing attributable operational outcomes
- preventing unsafe or unauthorized transitions
- preserving unresolved failure and recovery state

The Kernel shall remain deterministic wherever practical.

Given equivalent authoritative context, inputs, configuration, manager capabilities, and authority, the Kernel should produce equivalent coordination decisions and lifecycle outcomes.

---

## 6. Kernel Boundaries

The Kernel shall not:

- contain workspace-specific business logic
- implement workspace domain behavior
- redefine manager responsibilities
- directly depend on manager implementation details
- bypass published manager contracts
- permit hidden manager-to-manager implementation coupling
- establish engineering truth outside the Canonical Engineering Context
- infer authority where explicit authority is required
- treat requested work as planned work
- treat planned work as executed work
- treat executed work as validated work
- treat validated work as accepted without required governance
- suppress validation findings
- suppress governance findings
- suppress recovery evidence
- expose secrets through context, events, logs, or diagnostics
- permit a workspace to access another workspace's protected state
- permit an extension to override Kernel invariants
- perform autonomous commits in Version 1
- perform autonomous releases in Version 1
- perform autonomous production deployment in Version 1
- authorize itself beyond explicitly granted authority
- conceal degraded or failed operating state

Workspace-specific logic remains within the workspace.

Manager-specific logic remains within the responsible manager.

Infrastructure-specific behavior remains behind platform contracts.

The Kernel may coordinate these capabilities but shall not assume ownership of them.

---

## 7. Core Operating Principles

The Kernel shall operate according to the following principles.

### 7.1 Orchestration over implementation

The Kernel coordinates work but does not implement the internal behavior of managers or workspaces.

### 7.2 Canonical context over fragmented state

All platform-level engineering decisions shall begin from the Canonical Engineering Context.

### 7.3 Contracts over internal knowledge

Managers and workspaces shall be coordinated through published contracts rather than implementation knowledge.

### 7.4 Evidence over assumption

Repository evidence, executed validation, explicit authority, and recorded outcomes outrank unsupported inference.

### 7.5 Validation before acceptance

Execution completion alone does not establish acceptance.

### 7.6 Governance before irreversible action

Actions requiring approval, elevated authority, or architectural exception shall not proceed until governance requirements are satisfied.

### 7.7 Recovery as a first-class capability

Recovery shall be designed into the normal operating model rather than treated as an undocumented exception path.

### 7.8 Least authority

Every manager, workspace, extension, and execution shall receive only the authority necessary for its bounded responsibility.

### 7.9 Workspace isolation

One workspace shall not affect another workspace unless an explicitly authorized platform contract permits the interaction.

### 7.10 Observable operation

Significant Kernel decisions and transitions shall produce attributable operational evidence.

---

## 8. Canonical Engineering Context Integration

The Canonical Engineering Context is the authoritative engineering-state boundary for all Kernel operations.

The Kernel shall establish or retrieve the current Canonical Engineering Context before coordinating:

- planning
- execution
- validation
- governance
- reasoning
- recovery
- workspace activation
- architectural analysis

The Canonical Engineering Context may contain authoritative state concerning:

- repository intelligence
- engineering memory
- governance
- planning
- execution
- validation
- recovery
- workspace registrations
- workspace capabilities
- architectural metadata
- security state
- manager capabilities
- owner directives
- operational evidence
- unresolved risks
- required approvals

Kernel managers contribute bounded evidence to the Canonical Engineering Context through their published contracts.

No manager may establish a competing source of overall engineering truth.

Manager-local state may exist only when:

- it is bounded to the manager's responsibility
- it does not replace canonical engineering state
- its lifecycle is explicitly defined
- its authoritative status is unambiguous
- relevant outcomes are published into the Canonical Engineering Context

The Kernel shall distinguish between:

- observed state
- inferred state
- requested state
- proposed state
- planned state
- authorized state
- executing state
- executed state
- validated state
- governed state
- accepted state
- failed state
- recovering state
- recovered state

These states shall not be treated as interchangeable.

Every Kernel workflow shall begin with a defined context version or context snapshot.

Every completed workflow shall produce one of the following:

- an updated Canonical Engineering Context
- a validated no-change result
- a blocked result with preserved evidence
- a failure result with preserved evidence
- a recovery result with preserved evidence
- an escalation result requiring additional authority

Context updates shall be:

- attributable
- ordered
- version-aware
- observable
- reproducible where practical
- protected against unauthorized mutation

---

## 9. Canonical Context Ownership

The Kernel coordinates the lifecycle of the Canonical Engineering Context.

Individual managers own only their contributed evidence and bounded state.

The Kernel shall coordinate context construction from manager outputs without redefining the meaning of manager-owned evidence.

The Kernel shall ensure that:

- context sources are identifiable
- evidence provenance is preserved
- stale context is detectable
- conflicting evidence is not silently merged
- unresolved conflicts remain visible
- context updates are not partially accepted without explicit handling
- protected data is excluded or redacted
- workspace-scoped state remains correctly scoped

The Kernel shall not claim that context is current when required sources are unavailable or stale.

A degraded context may be used only when:

- the degradation is explicitly represented
- the missing evidence is identified
- the workflow permits degraded operation
- governance and security rules permit continuation
- the resulting limitations are preserved in the outcome

---

## 10. Kernel Lifecycle

The Kernel lifecycle defines the operational states through which the Kernel progresses.

Version 1 recognizes the following Kernel lifecycle states:

1. Uninitialized
2. Initializing
3. Context Loading
4. Manager Registration
5. Contract Validation
6. Workspace Discovery
7. Ready
8. Planning
9. Awaiting Authority
10. Executing
11. Validating
12. Governing
13. Updating Context
14. Recovering
15. Degraded
16. Failed
17. Shutting Down
18. Stopped

---

## 11. Lifecycle State Requirements

### 11.1 Uninitialized

The Kernel has not established an operating environment.

No engineering request may be executed.

### 11.2 Initializing

The Kernel is loading configuration and establishing platform prerequisites.

### 11.3 Context Loading

The Kernel is loading, validating, or creating the Canonical Engineering Context.

### 11.4 Manager Registration

Required Kernel managers are being registered.

### 11.5 Contract Validation

Manager contracts and version compatibility are being evaluated.

### 11.6 Workspace Discovery

Registered workspaces and available capabilities are being discovered.

### 11.7 Ready

The Kernel is capable of receiving an engineering request.

Ready does not imply that every possible capability is available.

Unavailable or degraded capabilities shall remain visible.

### 11.8 Planning

The Kernel is coordinating construction or evaluation of an engineering plan.

### 11.9 Awaiting Authority

A plan exists, but required authority or approval has not been established.

No protected execution may begin in this state.

### 11.10 Executing

The Kernel is coordinating an authorized execution.

### 11.11 Validating

Execution results are being verified against required validation criteria.

### 11.12 Governing

The workflow is being evaluated for policy, authority, architectural, and acceptance compliance.

### 11.13 Updating Context

Validated and governed outcomes are being incorporated into the Canonical Engineering Context.

### 11.14 Recovering

The Kernel is coordinating bounded recovery from a failure or interrupted workflow.

### 11.15 Degraded

The Kernel can continue operating with explicitly limited capabilities.

Degraded operation shall never be represented as fully healthy operation.

### 11.16 Failed

The Kernel cannot safely continue normal operation.

### 11.17 Shutting Down

The Kernel is preserving required context and terminating active coordination safely.

### 11.18 Stopped

The Kernel is no longer coordinating work.

---

## 12. Lifecycle Transition Rules

The Kernel shall not enter Planning unless:

- a valid engineering request exists
- the relevant workspace is identified
- sufficient context exists to begin planning
- required planning capabilities are available

The Kernel shall not enter Awaiting Authority unless:

- a bounded plan exists
- authority requirements are identifiable
- unresolved assumptions are represented

The Kernel shall not enter Executing unless:

- an accepted plan exists
- required authority exists
- required security checks have passed
- participating managers are available
- workspace boundaries are established
- recovery requirements are known

The Kernel shall not enter Validating unless:

- execution has produced an attributable outcome
- required execution evidence is available
- validation requirements are known

The Kernel shall not enter Governing unless:

- validation status is available
- required governance evidence is available
- unresolved validation findings are represented

The Kernel shall not enter Updating Context unless:

- the workflow outcome is classified
- required validation is complete
- required governance evaluation is complete
- context changes are identifiable
- evidence provenance is preserved

The Kernel shall not classify a workflow as accepted until:

- execution completed within authority
- required validation passed
- required governance checks passed
- security findings are resolved or explicitly accepted
- context was updated or a validated no-change result was recorded

A failure may transition the Kernel to:

- Recovering, when bounded recovery is available
- Degraded, when safe limited operation remains possible
- Failed, when safe continuation cannot be established
- Ready, when the failure is non-blocking and safely contained

---

## 13. Kernel Initialization

Kernel initialization establishes the minimum valid operating environment.

Initialization shall include:

- loading Kernel configuration
- validating required configuration
- identifying architecture versions
- establishing architectural compatibility
- loading or creating the Canonical Engineering Context
- validating context integrity
- registering required managers
- validating manager contracts
- validating manager compatibility
- loading workspace registrations
- discovering workspace capabilities
- establishing security boundaries
- establishing observability
- detecting unresolved recovery state
- determining whether the Kernel may enter Ready

The Kernel shall fail closed when required initialization conditions are not satisfied.

The Kernel shall not enter Ready when:

- a required manager is unavailable
- a required manager contract is incompatible
- the Canonical Engineering Context cannot be established
- context integrity cannot be determined
- workspace isolation cannot be guaranteed
- required security boundaries are unavailable
- unresolved recovery state prohibits safe operation
- architectural compatibility cannot be determined
- required configuration is invalid

Initialization failures shall produce attributable diagnostic evidence without exposing protected information.

---

## 14. Kernel Shutdown

Kernel shutdown shall preserve operational integrity.

Shutdown shall include:

- rejecting or deferring new execution requests
- identifying active workflows
- allowing safe completion where permitted
- interrupting unsafe or unauthorized work
- preserving execution evidence
- preserving validation evidence
- preserving unresolved recovery state
- publishing shutdown events
- updating Kernel lifecycle state
- releasing platform resources through published contracts

The Kernel shall not silently discard:

- active execution state
- unresolved validation findings
- unresolved governance findings
- pending approvals
- recovery requirements
- workspace activation state
- context updates awaiting persistence

An interrupted workflow shall remain distinguishable from a completed workflow.

---

## 15. Kernel Manager Set

Version 1 defines the following Kernel managers:

1. Repository Intelligence Manager
2. Memory Manager
3. Planning Manager
4. Execution Manager
5. Validation Manager
6. Governance Manager
7. Security Manager
8. Reasoning Manager
9. Recovery Manager
10. Workspace Manager

Each manager owns one bounded architectural responsibility.

The Kernel may coordinate multiple managers within one workflow, but responsibility shall remain attributable to the manager that owns the capability.

The Kernel shall not create substitute managers with overlapping architectural authority.

An extension may add capabilities but shall not redefine, weaken, or bypass the responsibilities of the Version 1 manager set.

---

## 16. Manager Coordination Model

The Kernel coordinates managers through:

- explicit requests
- published contracts
- Canonical Engineering Context
- bounded authority
- structured outcomes
- canonical events
- validation evidence
- governance evidence

Managers shall not depend upon one another's internal implementation.

Direct manager-to-manager implementation coupling is prohibited.

A manager may request another capability only through:

- Kernel coordination
- an explicitly published platform contract
- an architectural contract authorized by the Master Architecture

The Kernel coordination sequence is:

1. receive or generate a bounded engineering request
2. validate the request
3. identify the current Canonical Engineering Context
4. identify the target workspace
5. classify required capabilities
6. identify responsible managers
7. verify manager availability
8. verify contract compatibility
9. determine dependency order
10. establish authority requirements
11. establish security requirements
12. invoke managers within their bounded responsibilities
13. collect outputs and evidence
14. coordinate validation
15. coordinate governance
16. update the Canonical Engineering Context
17. publish resulting Kernel events
18. return an attributable workflow outcome

The Kernel shall provide each participating manager only the information and authority required for its responsibility.

---

## 17. Common Manager Contract

Every Kernel manager shall publish a versioned contract.

The common manager contract shall define:

- manager identity
- manager version
- architectural responsibility
- supported capabilities
- accepted inputs
- produced outputs
- required context
- optional context
- authority requirements
- security requirements
- dependencies
- validation requirements
- evidence requirements
- failure behavior
- recovery behavior
- compatibility rules
- lifecycle participation
- observability requirements

Manager contracts constitute stable architectural boundaries.

A manager may evolve internally without affecting the remainder of the platform provided its published contract remains compatible.

The Kernel shall reject a manager when:

- its identity cannot be established
- its contract is missing
- its contract is invalid
- its architectural responsibility conflicts with another manager
- its version is incompatible
- its required authority exceeds configured authority
- its security requirements cannot be satisfied
- its failure behavior is undefined
- its outputs cannot be attributed

---

## 18. Manager Request Contract

A Kernel-issued manager request shall contain or reference:

- request identity
- workflow identity
- target workspace
- requested capability
- current context version
- bounded input
- granted authority
- security scope
- required evidence
- expected output
- validation expectations
- timeout or interruption rules
- correlation metadata

A request shall not grant implicit authority beyond its declared scope.

A manager shall reject a request when:

- required input is missing
- context is incompatible or stale
- authority is insufficient
- the capability is unsupported
- security requirements are not satisfied
- the request violates workspace boundaries
- execution would violate manager invariants

---

## 19. Manager Outcome Contract

Every manager outcome shall indicate:

- request identity
- workflow identity
- manager identity
- capability invoked
- completion status
- whether state changed
- produced output
- produced evidence
- resulting risks
- validation requirements
- governance requirements
- recovery requirements
- additional authority requirements
- context contribution
- failure classification
- timing and correlation information

A manager outcome shall not be accepted solely because the manager reports success.

The Kernel shall evaluate the outcome against:

- the original request
- granted authority
- security requirements
- validation requirements
- governance requirements
- context compatibility
- workspace boundaries

---

## 20. Engineering Request Model

An engineering request is the Kernel's entry point for coordinated work.

Every engineering request shall identify:

- request identity
- requesting authority
- objective
- target workspace
- known constraints
- requested outcome
- urgency where relevant
- approval requirements where known

The Kernel shall classify a request before planning or execution.

Request classifications may include:

- inspection
- analysis
- planning
- documentation
- validation
- governed modification
- recovery
- workspace operation
- security review
- architectural review

The Kernel shall reject or escalate requests that are:

- structurally invalid
- outside platform authority
- outside workspace authority
- prohibited by governance
- prohibited by security policy
- incompatible with Version 1 constraints
- impossible to attribute
- dependent on unavailable required capabilities

---

## 21. Planning Integration

The Kernel coordinates planning through the Planning Manager.

Planning shall begin from:

- the current Canonical Engineering Context
- the engineering request
- workspace capabilities
- repository evidence
- engineering memory
- governance state
- security constraints
- owner directives

Every plan shall identify:

- objective
- scope
- assumptions
- dependencies
- affected workspaces
- affected architectural areas
- required capabilities
- execution steps
- execution order
- authority requirements
- security requirements
- validation requirements
- governance requirements
- recovery considerations
- expected context changes
- completion criteria
- unresolved risks

The Kernel shall distinguish between:

- proposed plan
- reviewed plan
- accepted plan
- authorized plan
- executing plan
- completed plan
- failed plan
- superseded plan

Only an accepted and sufficiently authorized plan may enter execution.

The Kernel shall reject a plan that:

- lacks a bounded objective
- lacks required validation
- violates architecture
- violates governance
- violates security constraints
- exceeds available authority
- crosses workspace boundaries without authorization
- depends on unavailable required capabilities
- has unresolved blocking assumptions
- has no defined completion criteria

---

## 22. Execution Orchestration

The Kernel coordinates execution through the Execution Manager.

The Kernel owns execution orchestration.

The Execution Manager owns bounded execution coordination and tracking.

Execution shall be based on:

- an accepted plan
- explicit authority
- established workspace scope
- established security scope
- defined validation requirements
- defined recovery expectations

Execution orchestration shall include:

- verifying plan currency
- verifying context currency
- verifying authority
- verifying security requirements
- verifying workspace activation
- verifying participating capabilities
- establishing execution identity
- coordinating ordered execution steps
- collecting step outcomes
- preserving execution evidence
- handling interruption
- detecting divergence from the plan
- stopping unauthorized continuation
- transitioning to validation or recovery

The Kernel shall not silently modify an accepted plan during execution.

Material plan changes shall require:

- a revised plan
- renewed authority where required
- updated validation requirements
- updated governance evaluation

Execution completion does not establish acceptance.

---

## 23. Version 1 Execution Restrictions

Version 1 shall support:

- repository inspection
- architectural inspection
- context construction
- planning
- reasoning
- documentation preparation
- owner-approved documentation updates
- validation coordination
- governance evaluation
- recovery planning
- workspace registration
- read-only repository intelligence

Version 1 shall not permit:

- autonomous code modification
- autonomous commits
- autonomous branch creation
- autonomous merges
- autonomous releases
- autonomous production deployment
- autonomous credential modification
- autonomous security-policy modification
- autonomous governance-policy modification
- autonomous destructive repository action
- autonomous cross-workspace mutation

Any capability beyond these boundaries requires a later architectural version and explicit governance approval.

---

## 24. Validation Integration

The Kernel coordinates validation through the Validation Manager.

Validation shall determine whether executed work satisfies:

- the accepted plan
- architectural requirements
- workspace requirements
- security requirements
- governance requirements
- completion criteria
- reproducibility expectations

Validation planning shall occur before execution whenever practical.

Validation evidence shall identify:

- validation identity
- workflow identity
- validated outcome
- validation method
- execution environment where relevant
- required checks
- executed checks
- skipped checks
- pass or fail status
- limitations
- reproducibility information
- supporting evidence
- unresolved findings

The Kernel shall distinguish between:

- validation required
- validation planned
- validation executing
- validation passed
- validation failed
- validation partial
- validation unavailable
- validation not applicable

Partial or unavailable validation shall not be represented as passing validation.

The Kernel shall not accept execution when required validation has failed.

---

## 25. Governance Integration

The Kernel coordinates governance through the Governance Manager.

Governance integration shall evaluate:

- architectural compliance
- policy compliance
- authority
- approval requirements
- immutable boundaries
- delegated authority
- workspace restrictions
- validation status
- security findings
- exception requirements

The Governance Manager produces canonical governance evidence.

The Kernel shall enforce governance outcomes.

Governance outcomes may include:

- permitted
- permitted with conditions
- approval required
- blocked
- exception required
- escalation required

The Kernel shall not:

- infer approval
- conceal governance conditions
- bypass immutable boundaries
- reinterpret a blocked action as permitted
- accept execution that exceeded granted authority

Governance evidence shall be preserved in the Canonical Engineering Context.

---

## 26. Reasoning Integration

The Kernel coordinates engineering reasoning through the Reasoning Manager.

Reasoning may support:

- architectural analysis
- alternative evaluation
- impact analysis
- risk identification
- recommendation generation
- assumption identification
- ambiguity resolution
- plan review
- recovery analysis

Reasoning output is advisory unless explicitly granted decision authority by governance.

Reasoning shall not replace:

- repository evidence
- executed validation
- explicit owner directives
- architectural authority
- governance decisions
- security decisions

Reasoning outcomes shall identify:

- available evidence
- assumptions
- uncertainties
- alternatives considered
- tradeoffs
- recommendation
- confidence limitations
- required verification

The Kernel shall not represent inference as observed fact.

---

## 27. Recovery Integration

The Kernel coordinates recovery through the Recovery Manager.

Recovery is required when:

- execution fails
- validation fails in a recoverable manner
- context update fails
- a workflow is interrupted
- a manager becomes unavailable
- repository state diverges
- authority is revoked during execution
- security boundaries are violated
- lifecycle integrity cannot be preserved

Recovery coordination shall include:

- failure classification
- impact assessment
- safe-state determination
- recovery-plan construction
- authority validation
- rollback coordination where applicable
- evidence preservation
- post-recovery validation
- context reconciliation
- incident recording

Recovery outcomes may include:

- restored
- partially restored
- safely contained
- degraded
- manual intervention required
- unrecoverable

Recovery shall not erase the evidence of the original failure.

A recovered workflow shall remain distinguishable from a workflow that completed without failure.

---

## 28. Workspace Integration

The Kernel coordinates workspace integration through the Workspace Manager.

A workspace is a registered engineering environment operating under FORGE OS platform contracts.

Every workspace registration shall define:

- workspace identity
- workspace version
- workspace location or reference
- ownership
- capabilities
- business-logic boundary
- repository boundary
- security boundary
- supported operations
- required managers
- validation requirements
- governance requirements
- activation requirements
- compatibility information

The Kernel shall not assume that all workspaces expose identical capabilities.

The Kernel shall discover and validate workspace capabilities before planning or execution.

Workspace business logic shall remain inside the workspace.

The Kernel shall not copy workspace-specific business logic into platform managers.

---

## 29. Workspace Activation

A workspace shall be activated before workspace-scoped execution.

Activation shall include:

- validating workspace registration
- validating workspace compatibility
- validating repository boundaries
- validating security boundaries
- discovering current capabilities
- establishing workspace context
- detecting unresolved workspace recovery state
- confirming required manager support

A workspace shall not be activated when:

- registration is invalid
- identity cannot be established
- repository boundaries are ambiguous
- required security boundaries are unavailable
- compatibility cannot be established
- unresolved recovery state prohibits safe operation

Workspace activation status shall be represented in the Canonical Engineering Context.

---

## 30. Workspace Isolation

The Kernel shall enforce workspace isolation.

Workspace-scoped requests, context, evidence, execution, and recovery shall remain associated with the correct workspace.

A workspace shall not:

- access another workspace's protected state
- mutate another workspace
- inherit another workspace's authority
- consume another workspace's secrets
- publish evidence as though it originated from another workspace

Cross-workspace coordination requires:

- an explicit platform contract
- explicit authority
- security validation
- governance validation
- attributable evidence

---

## 31. Event Model

The Kernel shall publish canonical events for significant lifecycle and workflow activity.

Kernel events shall support:

- observability
- correlation
- auditability
- recovery
- context reconstruction
- validation traceability
- governance traceability

Every Kernel event shall contain or reference:

- event identity
- event type
- event version
- timestamp or sequence
- Kernel lifecycle state
- workflow identity
- request identity where applicable
- workspace identity where applicable
- producing component
- authority context
- correlation information
- bounded event payload
- evidence references

Events shall be immutable after publication.

Corrections shall be represented by subsequent events rather than hidden mutation.

---

## 32. Canonical Kernel Events

Version 1 shall recognize events including:

- Kernel Initialization Started
- Kernel Initialization Completed
- Kernel Initialization Failed
- Context Loading Started
- Context Loading Completed
- Context Loading Failed
- Manager Registered
- Manager Registration Failed
- Manager Contract Validated
- Manager Contract Rejected
- Workspace Discovered
- Workspace Activated
- Workspace Activation Failed
- Kernel Ready
- Engineering Request Received
- Engineering Request Rejected
- Planning Started
- Plan Produced
- Plan Accepted
- Plan Rejected
- Authority Required
- Authority Granted
- Authority Denied
- Execution Started
- Execution Step Completed
- Execution Interrupted
- Execution Completed
- Execution Failed
- Validation Started
- Validation Passed
- Validation Failed
- Validation Partial
- Governance Evaluation Started
- Governance Permitted
- Governance Blocked
- Governance Escalation Required
- Context Update Started
- Context Updated
- Context Update Failed
- Recovery Started
- Recovery Completed
- Recovery Failed
- Kernel Degraded
- Kernel Failed
- Kernel Shutdown Started
- Kernel Stopped

Event names and schemas shall be versioned platform contracts.

---

## 33. State Model

Kernel state shall be explicit.

The Kernel shall not rely on undocumented implicit state to determine:

- lifecycle position
- workflow status
- authority
- validation status
- governance status
- recovery requirements
- workspace activation
- manager availability

Kernel state shall distinguish:

- current state
- desired state
- transitional state
- historical state
- unresolved state

State changes shall be attributable to:

- a request
- an event
- a manager outcome
- an authority decision
- a validation result
- a governance result
- a recovery result
- an owner directive

---

## 34. Error Model

The Kernel shall classify errors before determining response behavior.

Version 1 error categories include:

- configuration error
- context error
- contract error
- compatibility error
- workspace error
- planning error
- authority error
- security error
- execution error
- validation error
- governance error
- reasoning error
- recovery error
- observability error
- extension error
- infrastructure error

Every error shall identify:

- error identity
- category
- severity
- source
- workflow identity where applicable
- workspace identity where applicable
- affected capability
- user-safe message
- diagnostic evidence
- recoverability
- required escalation
- context impact

Protected information shall not appear in user-safe error output.

---

## 35. Error Handling

The Kernel shall handle errors through:

- classification
- containment
- evidence preservation
- lifecycle transition
- recovery evaluation
- escalation where required
- context update where required
- event publication

The Kernel shall fail closed when:

- authority cannot be established
- workspace isolation cannot be guaranteed
- security boundaries cannot be guaranteed
- required context integrity cannot be established
- an irreversible action cannot be safely controlled

The Kernel may continue in degraded mode only when:

- the failure is contained
- unavailable capabilities are explicit
- required workflows remain safe
- governance permits continuation
- security boundaries remain intact

Errors shall not be silently ignored.

---

## 36. Concurrency and Ordering

Kernel workflows shall preserve deterministic ordering where required.

The Kernel shall prevent unsafe concurrent operations affecting the same:

- context version
- workspace state
- repository state
- execution plan
- recovery operation
- authority decision

When concurrent workflows are permitted, the Kernel shall ensure:

- identities remain distinct
- evidence remains attributable
- context updates are conflict-aware
- ordering is observable
- workspace isolation remains intact

A stale workflow shall not overwrite a newer authoritative context without explicit conflict handling.

---

## 37. Interruption and Cancellation

The Kernel shall support bounded interruption and cancellation.

An interruption request shall identify:

- target workflow
- requesting authority
- reason
- urgency
- expected safe state

Cancellation shall not be represented as successful completion.

The Kernel shall coordinate interruption by:

- preventing new execution steps
- allowing atomic steps to finish where safer
- preserving completed-step evidence
- recording incomplete steps
- determining recovery requirements
- updating workflow status
- publishing interruption events

Irreversible operations shall define interruption behavior before execution begins.

---

## 38. Observability

Every significant Kernel operation shall be observable.

Observability shall support:

- operational diagnosis
- lifecycle inspection
- workflow tracing
- manager coordination tracing
- event correlation
- validation traceability
- governance traceability
- recovery analysis
- security review

Version 1 observability shall include:

- structured logs
- canonical events
- workflow status
- manager status
- workspace status
- validation evidence
- governance evidence
- recovery evidence
- error classification
- context version information

Observability shall not expose:

- secrets
- credentials
- private keys
- access tokens
- protected personal information
- unauthorized workspace data

---

## 39. Auditability

Kernel actions shall be attributable.

Audit evidence shall identify:

- what occurred
- when it occurred
- why it occurred
- which request initiated it
- which authority permitted it
- which workspace was affected
- which managers participated
- what evidence was produced
- what validation occurred
- what governance decision applied
- what context changed
- whether recovery occurred

Audit evidence shall not depend exclusively on unstructured logs.

---

## 40. Security Responsibilities

The Kernel coordinates security through the Security Manager and enforces security requirements throughout the lifecycle.

Kernel security responsibilities include:

- validating requester authority
- validating execution authority
- enforcing least authority
- preserving workspace isolation
- protecting credentials and secrets
- enforcing protected-data boundaries
- validating manager security requirements
- validating extension security requirements
- preventing unauthorized context mutation
- preventing unauthorized execution
- coordinating security findings
- preserving security evidence
- escalating sensitive operations

The Kernel shall not store secrets in:

- canonical events
- general logs
- reasoning output
- validation summaries
- governance summaries
- unprotected context fields

