# SWR consumer inventory (React #418 hydration boundary, PR fix/health-snapshot-normalize-hydration)

Generated from a repository-wide search for every `useStaleWhileRevalidate(` call
and every direct render-time `getCacheEntry` call (none found outside
`src/hooks/swrCache.js` and `src/hooks/useStaleWhileRevalidate.js`).

## Shared behavior (applies to every row)

- **Persistence:** every key persists through the shared hook to disk under
  `forge.swr.v1:<signed-in-user-id>:<key>` (24h max age, 2MB per-entry cap) when an
  identity is set; memory-only while signed out (fail-closed). No consumer
  persists anything by itself.
- **Server-render exposure:** every consumer is a client component rendered inside a
  Next.js App Router page, so its first render is part of the server HTML. Before
  this fix, a persisted entry made the first client render show data while the
  server rendered loading (React #418). After the fix, the first client render is
  loading-equivalent until the root bridge marks hydration, matching the server.
- **First-render data-dependence:** the hook has always returned `data: null` on a
  cold load (no cache entry), so every consumer already handles a null first
  render. The hydration gate only makes the first render loading-equivalent even
  when a cache entry exists; it introduces no new null-data case. The column below
  records whether the consumer branches on `isLoading`/data in render (data-
  dependent) or renders the same shape regardless (tolerant).
- **Focused regression test:** the existing test file(s) for that consumer, if any;
  otherwise the shared-hook regression (`src/hooks/useStaleWhileRevalidate.test.jsx`,
  `src/hooks/useStaleWhileRevalidate.lifecycle.test.jsx`, `src/hooks/swrHydration.test.jsx`).

| File | Key | Branches on isLoading/data | Focused test |
|---|---|---|---|
| `src/app/forge/financial/AnomalyAlertsPanel.jsx:51` | `"financial:anomalies"` | yes | shared-hook regression |
| `src/app/forge/financial/CashForecastPanel.jsx:195` | ``financial:forecast:${days}`` | yes | `src/app/forge/financial/CashForecastPanel.test.jsx` |
| `src/app/forge/financial/DebtPayoffPanel.jsx:270` | ``financial:debt-payoff:${committed.surplus}:${committed.taxRate}`` | yes | `src/app/forge/financial/DebtPayoffPanel.test.jsx` |
| `src/app/forge/financial/LeftThisMonthPanel.jsx:64` | ``financial:left-this-month:${monthKey}`` | yes | `src/app/forge/financial/LeftThisMonthPanel.test.jsx` |
| `src/app/forge/financial/MonthComparisonPanel.jsx:49` | ``financial:comparison:${appliedKeys}`` | yes | shared-hook regression |
| `src/app/import/FinancialImportTool.jsx:96` | `"financial-import:bootstrap"` | no | `src/app/import/FinancialImportTool.test.jsx`, `src/app/import/FinancialImportTool.interactions.test.jsx` |
| `src/components/forge/ReconcileDuplicatesPanel.jsx:43` | `"financial:reconcile-duplicates"` | yes | shared-hook regression |
| `src/components/forge/ReconcileTransfersPanel.jsx:84` | `"financial:reconcile-transfers"` | yes | shared-hook regression |
| `src/components/forge/RecurringPaymentsPanel.jsx:35` | `"financial:recurring-patterns"` | yes | shared-hook regression |
| `src/components/forge/budget/BudgetPanel.jsx:123` | `budgetKey` | yes | `src/components/forge/budget/BudgetPanel.dismiss.test.jsx` |
| `src/components/forge/callShield/CallShieldHome.jsx:174` | `"call-shield:home"` | yes | `src/components/forge/callShield/CallShieldHome.test.jsx` |
| `src/components/forge/callShield/CallShieldHome.jsx:196` | `"call-shield:labels"` | yes | `src/components/forge/callShield/CallShieldHome.test.jsx` |
| `src/components/forge/callShield/CallShieldHome.jsx:218` | `selectedCaseId ? `call-shield:case:${selectedCaseId}` : null` | yes | `src/components/forge/callShield/CallShieldHome.test.jsx` |
| `src/components/forge/capture/CaptureLibraryGrid.jsx:54` | `"capture:library-items"` | yes | shared-hook regression |
| `src/components/forge/developer/BrainHealthDashboard.jsx:295` | `"engineering-brain:health"` | yes | `src/components/forge/developer/BrainHealthDashboard.test.jsx` |
| `src/components/forge/developer/EngineeringBrainPanel.jsx:105` | `brainKey(params)` | yes | `src/components/forge/developer/EngineeringBrainPanel.test.jsx` |
| `src/components/forge/developer/UiImprovementManagerPanel.jsx:140` | `"ui-improvement:proposals"` | yes | `src/components/forge/developer/UiImprovementManagerPanel.test.jsx` |
| `src/components/forge/financial/FinancialAccountBalancesPanel.jsx:592` | `"financial:account-balances"` | yes | `src/components/forge/financial/FinancialAccountBalancesPanel.test.jsx` |
| `src/components/forge/financial/FinancialAssetsPanel.jsx:33` | `"financial:assets"` | yes | `src/components/forge/financial/FinancialAssetsPanel.test.jsx` |
| `src/components/forge/financial/InvestmentAccountsPanel.jsx:37` | `"financial:investment-accounts"` | yes | `src/components/forge/financial/InvestmentAccountsPanel.test.jsx` |
| `src/components/forge/health/HealthDashboard.jsx:1028` | `workspaceId ? `health:dashboard:${workspaceId}` : null` | yes | `src/components/forge/health/HealthDashboard.test.jsx`, `src/components/forge/health/HealthDashboard.labLayout.test.jsx`, `src/components/forge/health/HealthDashboard.snapshot.test.jsx` |
| `src/components/forge/property/PropertyConditionAssessmentPanel.jsx:273` | `"property:portfolio-properties"` | yes | `src/components/forge/property/__tests__/PropertyConditionAssessmentPanel.test.jsx` |
| `src/components/forge/property/PropertyConditionAssessmentPanel.jsx:301` | `effectivePropertyId       ? `property-condition-assessments:${effectivePropertyId}`       : null` | yes | `src/components/forge/property/__tests__/PropertyConditionAssessmentPanel.test.jsx` |
| `src/components/forge/property/PropertyEvidenceHistoryPanel.jsx:339` | `url ? `property-evidence:${propertyId}` : null` | yes | `src/components/forge/property/__tests__/PropertyEvidenceHistoryPanel.test.jsx` |
| `src/components/forge/property/PropertyHVACComponentPanel.jsx:216` | `effectiveSystemId       ? `property-hvac-history:${effectiveSystemId}`       : null` | yes | `src/components/forge/property/__tests__/PropertyHVACComponentPanel.test.jsx` |
| `src/components/forge/property/PropertyHVACPanel.jsx:215` | `"property:portfolio-properties"` | yes | `src/components/forge/property/__tests__/PropertyHVACPanel.test.jsx` |
| `src/components/forge/property/PropertyHVACPanel.jsx:239` | `effectivePropertyId       ? `property-hvac-systems:${effectivePropertyId}`       : null` | yes | `src/components/forge/property/__tests__/PropertyHVACPanel.test.jsx` |
| `src/components/forge/property/PropertyOperatingCostsPanel.jsx:1232` | `"property:operating-obligations"` | yes | `src/components/forge/property/__tests__/PropertyOperatingCostsPanel.test.jsx` |
| `src/components/forge/property/PropertyValuationPanel.jsx:124` | `"property:portfolio-properties"` | yes | `src/components/forge/property/__tests__/PropertyValuationPanel.test.jsx` |
| `src/components/forge/property/PropertyValuationPanel.jsx:143` | `"property:valuations"` | yes | `src/components/forge/property/__tests__/PropertyValuationPanel.test.jsx` |
| `src/components/forge/rental/BankLedgerPage.jsx:220` | `"bank-ledger:accounts"` | yes | `src/components/forge/rental/BankLedgerPage.test.jsx`, `src/components/forge/rental/BankLedgerPage.followup-g14.test.jsx`, `src/components/forge/rental/BankLedgerPage.save-confirmation.test.jsx` |
| `src/components/forge/rental/BankLedgerPage.jsx:286` | `effectiveAccountId ? `bank-ledger:${effectiveAccountId}` : null` | yes | `src/components/forge/rental/BankLedgerPage.test.jsx`, `src/components/forge/rental/BankLedgerPage.followup-g14.test.jsx`, `src/components/forge/rental/BankLedgerPage.save-confirmation.test.jsx` |
| `src/components/forge/rental/DepreciationAssetsPanel.jsx:53` | `propertyId ? `depreciation-assets:${propertyId}` : null` | yes | `src/components/forge/rental/DepreciationAssetsPanel.test.jsx`, `src/components/forge/rental/DepreciationAssetsPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/DepreciationAssetsPanel.jsx:67` | `propertyId && reportYear ? `depreciation-schedule:${propertyId}:${reportYear}` : null` | yes | `src/components/forge/rental/DepreciationAssetsPanel.test.jsx`, `src/components/forge/rental/DepreciationAssetsPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/MessagesPanel.jsx:46` | `"rental:owner-inbox"` | yes | `src/components/forge/rental/MessagesPanel.test.jsx`, `src/components/forge/rental/MessagesPanel.followup-g24.test.jsx` |
| `src/components/forge/rental/PrivateFinancingAccountDetail.jsx:64` | `accountId ? `private-financing:account:${accountId}` : null` | yes | `src/components/forge/rental/PrivateFinancingAccountDetail.test.jsx` |
| `src/components/forge/rental/PrivateFinancingAccountsPanel.jsx:43` | `"private-financing:accounts"` | yes | `src/components/forge/rental/PrivateFinancingAccountsPanel.test.jsx` |
| `src/components/forge/rental/PrivateFinancingBorrowerPortal.jsx:42` | ``private-financing:borrower-portal:${search}`` | yes | `src/components/forge/rental/PrivateFinancingBorrowerPortal.test.jsx` |
| `src/components/forge/rental/PrivateFinancingLedgerHistory.jsx:197` | `accountId ? `private-financing:events:${accountId}` : null` | yes | `src/components/forge/rental/PrivateFinancingLedgerHistory.test.jsx` |
| `src/components/forge/rental/PropertyExpenseHistory.jsx:123` | `propertyId ? `property-expenses:${propertyId}` : null` | yes | shared-hook regression |
| `src/components/forge/rental/PropertyFinancialSetupPanel.jsx:45` | `propertyId ? `rental:property-financial-setup:${propertyId}` : null` | yes | `src/components/forge/rental/__tests__/PropertyFinancialSetupPanel.test.jsx` |
| `src/components/forge/rental/PropertyLedgerPage.jsx:99` | `propertyId ? `property-ledger:${propertyId}` : null` | yes | `src/components/forge/rental/PropertyLedgerPage.test.jsx`, `src/components/forge/rental/PropertyLedgerPage.followup-g12.test.jsx`, `src/components/forge/rental/PropertyLedgerPage.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentalAnimalsPanel.jsx:18` | `"rental:animals"` | yes | `src/components/forge/rental/RentalAnimalsPanel.followup-g22.test.jsx`, `src/components/forge/rental/RentalAnimalsPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentalApplicationShell.jsx:236` | `activeId === "overview" && !wizardDismissed ? "rental:setup-wizard-status" : null` | no | `src/components/forge/rental/RentalApplicationShell.test.jsx` |
| `src/components/forge/rental/RentalAutopayPanel.jsx:29` | `"rental:autopay"` | yes | `src/components/forge/rental/RentalAutopayPanel.controls-sweep.test.jsx` |
| `src/components/forge/rental/RentalCommunicationsPanel.jsx:35` | `cacheKey` | yes | `src/components/forge/rental/RentalCommunicationsPanel.followup-g24.test.jsx` |
| `src/components/forge/rental/RentalCommunicationsPanel.jsx:46` | `"rental:email-settings"` | yes | `src/components/forge/rental/RentalCommunicationsPanel.followup-g24.test.jsx` |
| `src/components/forge/rental/RentalContextualSurface.jsx:22` | `cacheKey` | yes | `src/components/forge/rental/RentalContextualSurface.test.jsx` |
| `src/components/forge/rental/RentalDepositsPanel.jsx:53` | `"rental:deposits"` | yes | `src/components/forge/rental/RentalDepositsPanel.test.jsx`, `src/components/forge/rental/RentalDepositsPanel.controls-sweep.test.jsx` |
| `src/components/forge/rental/RentalDocumentsPanel.jsx:92` | `initialData ? null : `rental-documents:${propertyId \|\| "all"}`` | yes | `src/components/forge/rental/RentalDocumentsPanel.test.jsx` |
| `src/components/forge/rental/RentalInspectionsPanel.jsx:29` | `cacheKey` | yes | `src/components/forge/rental/RentalInspectionsPanel.test.jsx`, `src/components/forge/rental/RentalInspectionsPanel.followup-g23.test.jsx` |
| `src/components/forge/rental/RentalInsuranceAddonsPanel.jsx:35` | `"rental:insurance-addons"` | yes | `src/components/forge/rental/RentalInsuranceAddonsPanel.test.jsx`, `src/components/forge/rental/RentalInsuranceAddonsPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentalInsurancePanel.jsx:21` | `"rental:insurance"` | yes | `src/components/forge/rental/RentalInsurancePanel.followup-g22.test.jsx` |
| `src/components/forge/rental/RentalLeaseLifecyclePanel.jsx:47` | `"rental:lease-lifecycle"` | yes | `src/components/forge/rental/RentalLeaseLifecyclePanel.test.jsx` |
| `src/components/forge/rental/RentalLeasePanel.jsx:87` | `loadOnMount ? "rental:lease-setup" : null` | yes | `src/components/forge/rental/RentalLeasePanel.test.jsx`, `src/components/forge/rental/RentalLeasePanel.activate-forge-billing.test.jsx`, `src/components/forge/rental/RentalLeasePanel.balance.test.jsx`, `src/components/forge/rental/RentalLeasePanel.controls-sweep.test.jsx`, `src/components/forge/rental/RentalLeasePanel.deposit.test.jsx`, `src/components/forge/rental/RentalLeasePanel.edit-terms.test.jsx`, `src/components/forge/rental/RentalLeasePanel.pet-fee.test.jsx`, `src/components/forge/rental/RentalLeasePanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentalLeasePreparationPanel.jsx:13` | `"rental:lease-preparation"` | yes | `src/components/forge/rental/RentalLeasePreparationPanel.test.jsx` |
| `src/components/forge/rental/RentalMailingPanel.jsx:66` | `"rental:mailing-templates"` | yes | `src/components/forge/rental/RentalMailingPanel.test.jsx`, `src/components/forge/rental/RentalMailingPanel.followup-g25.test.jsx` |
| `src/components/forge/rental/RentalMailingPanel.jsx:68` | `"rental:mailing-master"` | yes | `src/components/forge/rental/RentalMailingPanel.test.jsx`, `src/components/forge/rental/RentalMailingPanel.followup-g25.test.jsx` |
| `src/components/forge/rental/RentalMailingPanel.jsx:70` | `"rental:mailing-batches"` | yes | `src/components/forge/rental/RentalMailingPanel.test.jsx`, `src/components/forge/rental/RentalMailingPanel.followup-g25.test.jsx` |
| `src/components/forge/rental/RentalMailingPanel.jsx:72` | `"rental:mailing-provider"` | yes | `src/components/forge/rental/RentalMailingPanel.test.jsx`, `src/components/forge/rental/RentalMailingPanel.followup-g25.test.jsx` |
| `src/components/forge/rental/RentalMaintenancePanel.jsx:31` | `cacheKey` | yes | `src/components/forge/rental/RentalMaintenancePanel.followup-g19.test.jsx`, `src/components/forge/rental/RentalMaintenancePanel.followup-g24.test.jsx` |
| `src/components/forge/rental/RentalPaymentsPanel.jsx:273` | `cacheKey` | yes | `src/components/forge/rental/RentalPaymentsPanel.test.jsx`, `src/components/forge/rental/RentalPaymentsPanel.controls-sweep.test.jsx`, `src/components/forge/rental/RentalPaymentsPanel.followup-g8.test.jsx` |
| `src/components/forge/rental/RentalPaymentsPanel.jsx:284` | `initialAccount === undefined ? "rental:stripe-account" : null` | yes | `src/components/forge/rental/RentalPaymentsPanel.test.jsx`, `src/components/forge/rental/RentalPaymentsPanel.controls-sweep.test.jsx`, `src/components/forge/rental/RentalPaymentsPanel.followup-g8.test.jsx` |
| `src/components/forge/rental/RentalReconciliationPanel.jsx:40` | `"rental:reconciliation"` | yes | `src/components/forge/rental/RentalReconciliationPanel.test.jsx`, `src/components/forge/rental/RentalReconciliationPanel.followup-g18.test.jsx` |
| `src/components/forge/rental/RentalReportsPanel.jsx:121` | `swrKey` | yes | `src/components/forge/rental/RentalReportsPanel.test.jsx` |
| `src/components/forge/rental/RentalSetupPanel.jsx:94` | `"rental:setup"` | yes | `src/components/forge/rental/RentalSetupPanel.test.jsx`, `src/components/forge/rental/RentalSetupPanel.controls-sweep.test.jsx`, `src/components/forge/rental/RentalSetupPanel.interaction.test.jsx`, `src/components/forge/rental/RentalSetupPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentalSetupWizardPanel.jsx:115` | `"rental:setup-wizard-status"` | yes | `src/components/forge/rental/RentalSetupWizardPanel.test.jsx` |
| `src/components/forge/rental/RentalSupportPanel.jsx:10` | `"rental:support"` | yes | `src/components/forge/rental/RentalSupportPanel.followup-g25.test.jsx`, `src/components/forge/rental/RentalSupportPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentalTenantPanel.jsx:99` | `"rental:tenants"` | yes | `src/components/forge/rental/RentalTenantPanel.test.jsx`, `src/components/forge/rental/RentalTenantPanel.balance-click.test.jsx`, `src/components/forge/rental/RentalTenantPanel.controls-sweep.test.jsx`, `src/components/forge/rental/RentalTenantPanel.household-active.test.jsx`, `src/components/forge/rental/RentalTenantPanel.interaction.test.jsx`, `src/components/forge/rental/RentalTenantPanel.ledger.test.jsx`, `src/components/forge/rental/RentalTenantPanel.make-primary.test.jsx`, `src/components/forge/rental/RentalTenantPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/RentecPaymentImportPanel.jsx:35` | `"rental:rentec-linked-properties"` | yes | `src/components/forge/rental/RentecPaymentImportPanel.test.jsx` |
| `src/components/forge/rental/ReservationInventoryPanel.jsx:25` | `"rental:reservation-inventory"` | yes | `src/components/forge/rental/ReservationInventoryPanel.test.jsx`, `src/components/forge/rental/ReservationInventoryPanel.controls-sweep.test.jsx`, `src/components/forge/rental/ReservationInventoryPanel.save-confirmation.test.jsx` |
| `src/components/forge/rental/ReservationOperationsDashboard.jsx:21` | ``rental:reservations-dashboard:${days}`` | yes | `src/components/forge/rental/ReservationOperationsDashboard.test.jsx` |
| `src/components/forge/rental/ReservationsPanel.jsx:29` | `"rental:reservations"` | yes | `src/components/forge/rental/ReservationsPanel.test.jsx`, `src/components/forge/rental/ReservationsPanel.controls-sweep.test.jsx`, `src/components/forge/rental/ReservationsPanel.followup-g25.test.jsx` |
| `src/components/forge/rental/TenantDocumentsPanel.jsx:19` | `"rental:tenant-documents"` | yes | `src/components/forge/rental/TenantDocumentsPanel.test.jsx` |
| `src/components/forge/rental/TenantLedgerPage.jsx:64` | `tenantId ? `tenant-ledger:${tenantId}` : null` | yes | `src/components/forge/rental/TenantLedgerPage.test.jsx`, `src/components/forge/rental/TenantLedgerPage.followup-g11.test.jsx` |
| `src/components/forge/rental/TenantPaymentHistory.jsx:51` | `tenantId ? `tenant-ledger:${tenantId}` : null` | yes | `src/components/forge/rental/TenantPaymentHistory.followup-g11.test.jsx` |
| `src/components/forge/rental/TenantPortal.jsx:123` | `initialPortal ? null : "rental:tenant-portal"` | yes | `src/components/forge/rental/TenantPortal.test.jsx`, `src/components/forge/rental/TenantPortal.save-confirmation.test.jsx` |
| `src/components/forge/rental/TransactionForm.jsx:296` | `"transaction-form:bank-accounts"` | no | `src/components/forge/rental/TransactionForm.test.jsx`, `src/components/forge/rental/TransactionForm.followup-g15.test.jsx` |
| `src/components/forge/scheduling/DriftAlertsPanel.jsx:52` | `projectId ? `scheduling:drift:${projectId}:${thresholdDays}` : null` | yes | `src/components/forge/scheduling/DriftAlertsPanel.test.jsx` |
| `src/components/forge/scheduling/ProjectsScreen.jsx:33` | `"scheduling:projects"` | yes | `src/components/forge/scheduling/ProjectsScreen.test.jsx` |
| `src/components/forge/scheduling/SchedulingBaselinesModal.jsx:38` | `projectId ? `scheduling:baselines:${projectId}` : null` | yes | `src/components/forge/scheduling/SchedulingBaselinesModal.test.jsx` |
| `src/components/forge/scheduling/SchedulingBoard.jsx:145` | `isOwner ? "scheduling:resources" : null` | yes | `src/components/forge/scheduling/SchedulingBoard.test.jsx` |
| `src/components/forge/scheduling/SchedulingBoard.jsx:156` | `isOwner ? "scheduling:cost-accounts" : null` | yes | `src/components/forge/scheduling/SchedulingBoard.test.jsx` |
| `src/components/forge/scheduling/SchedulingBoard.jsx:1728` | `blockCostsKey` | yes | `src/components/forge/scheduling/SchedulingBoard.test.jsx` |
| `src/components/forge/scheduling/SchedulingCostAccountsModal.jsx:27` | `"scheduling:cost-accounts"` | yes | `src/components/forge/scheduling/SchedulingCostAccountsModal.test.jsx` |
| `src/components/forge/scheduling/SchedulingCostsModal.jsx:34` | `rollupKey` | yes | `src/components/forge/scheduling/SchedulingCostsModal.test.jsx` |
| `src/components/forge/scheduling/SchedulingEvmDcmaModal.jsx:45` | `projectId ? `scheduling:baselines:${projectId}` : null` | yes | `src/components/forge/scheduling/SchedulingEvmDcmaModal.test.jsx` |
| `src/components/forge/scheduling/SchedulingEvmDcmaModal.jsx:67` | `reportKey` | yes | `src/components/forge/scheduling/SchedulingEvmDcmaModal.test.jsx` |
| `src/components/forge/scheduling/SchedulingLevelingModal.jsx:23` | `previewKey` | yes | `src/components/forge/scheduling/SchedulingLevelingModal.test.jsx` |
| `src/components/forge/scheduling/SchedulingResourcesModal.jsx:32` | `"scheduling:resources"` | yes | `src/components/forge/scheduling/SchedulingResourcesModal.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:328` | ``work-packages:drawing:${pIdDrawing.id}:summary:${refreshToken}`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:396` | ``work-packages:drawing:${drawing.id}:lines`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:492` | ``work-packages:progress:${entryId}:revisions`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:692` | ``work-packages:${packageId}:progress-summary`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:697` | ``work-packages:${packageId}:progress-entries`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:707` | ``work-packages:${packageId}:drawing-readiness`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:851` | ``work-packages:${packageId}:drawings`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/work-management/WorkPackageTakeoffScreen.jsx:859` | ``work-packages:${packageId}:permit-annotations:drawing`` | yes | `src/components/forge/work-management/WorkPackageTakeoffScreen.test.jsx` |
| `src/components/forge/workspace/WorkspaceMembersPanel.jsx:22` | `"workspace:members"` | yes | `src/components/forge/workspace/WorkspaceMembersPanel.test.jsx` |
| `src/components/reservations/GuestReservationAccess.jsx:26` | ``reservation:access:${slug}:${token}`` | yes | `src/components/reservations/GuestReservationAccess.test.jsx` |
| `src/components/reservations/PublicReservationBooking.jsx:25` | ``reservation:listing:${slug}`` | yes | `src/components/reservations/PublicReservationBooking.test.jsx` |
| `src/components/work-management/WorkPackageBusts.jsx:121` | `scopedSWRKey(pageContext, "work-packages", packageId, "busts", "badges")` | yes | `src/components/work-management/WorkPackageBusts.test.jsx` |
| `src/components/work-management/WorkPackageBusts.jsx:175` | `scopedSWRKey(pageContext, "work-packages", packageId, "busts", bust.id, "detail")` | yes | `src/components/work-management/WorkPackageBusts.test.jsx` |
| `src/components/work-management/WorkPackageBusts.jsx:180` | `scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", "link-picker")` | yes | `src/components/work-management/WorkPackageBusts.test.jsx` |
| `src/components/work-management/WorkPackageBusts.jsx:710` | `scopedSWRKey(pageContext, "work-packages", packageId, "busts", "candidates")` | yes | `src/components/work-management/WorkPackageBusts.test.jsx` |
| `src/components/work-management/WorkPackageBusts.jsx:722` | `scopedSWRKey(pageContext, "work-packages", packageId, "busts", "list", bustsQuery)` | yes | `src/components/work-management/WorkPackageBusts.test.jsx` |
| `src/components/work-management/WorkPackageChangeOrders.jsx:97` | `scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", changeOrderId, "revisions", "pages", pages)` | yes | `src/components/work-management/WorkPackageChangeOrders.test.jsx` |
| `src/components/work-management/WorkPackageChangeOrders.jsx:184` | `scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", refreshKey)` | yes | `src/components/work-management/WorkPackageChangeOrders.test.jsx` |
| `src/components/work-management/WorkPackageChangeOrders.jsx:195` | `showRetired ? scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", "retired") : null` | yes | `src/components/work-management/WorkPackageChangeOrders.test.jsx` |
| `src/components/work-management/WorkPackageCraftAssignments.jsx:83` | `scopedSWRKey(pageContext, "work-packages", packageId, "craft-assignments", assignmentId, "revisions")` | yes | `src/components/work-management/WorkPackageCraftAssignments.test.jsx` |
| `src/components/work-management/WorkPackageCraftAssignments.jsx:147` | `scopedSWRKey(pageContext, "work-packages", packageId, "craft-assignments", query)` | yes | `src/components/work-management/WorkPackageCraftAssignments.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:317` | `expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "reviews", review.id, "detail") : null` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:643` | `expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "revisions") : null` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:648` | `expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "reviews") : null` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:658` | `expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "ifc-releases") : null` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:663` | `expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "field-redlines") : null` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:670` | `expanded ? scopedSWRKey(pageContext, "work-packages", packageId, "drawings", drawingId, "artifacts") : null` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageDrawingReadiness.jsx:1224` | `scopedSWRKey(pageContext, "work-packages", packageId, "drawing-readiness")` | yes | `src/components/work-management/WorkPackageDrawingReadiness.test.jsx` |
| `src/components/work-management/WorkPackageManpowerCurve.jsx:243` | `scopedSWRKey(pageContext, "work-packages", packageId, "manpower-curve", refreshKey)` | yes | `src/components/work-management/WorkPackageManpowerCurve.test.jsx` |
| `src/components/work-management/WorkPackagePermitAnnotations.jsx:53` | `scopedSWRKey(pageContext, "work-packages", packageId, "permit-annotations", annotationId, "revisions")` | yes | `src/components/work-management/WorkPackagePermitAnnotations.test.jsx` |
| `src/components/work-management/WorkPackagePermitAnnotations.jsx:101` | `scopedSWRKey(pageContext, "work-packages", packageId, "permit-annotations", scope, drawingId, showRetired ? "retired" : "active")` | yes | `src/components/work-management/WorkPackagePermitAnnotations.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:109` | `scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", stepId, "revisions", "pages", pages)` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:148` | `scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", stepId, "drawings", linkId, "revisions", "pages", pages)` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:206` | `scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", step.id, "drawings", "pages", pages)` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:221` | `scopedSWRKey(pageContext, "work-packages", packageId, "drawing-readiness")` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:368` | `scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "assignment-context")` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:401` | `scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "progress-context")` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:526` | `scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "all")` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/components/work-management/WorkPackageSteps.jsx:542` | `scopedSWRKey(pageContext, "work-packages", packageId, "drawings")` | yes | `src/components/work-management/WorkPackageSteps.test.jsx` |
| `src/app/forge/connections/page.js:98` | `"connections:dashboard"` | yes | `src/app/auth/mfa/page.test.js`, `src/app/auth/page.test.js`, `src/app/auth/recovery/page.test.js`, `src/app/auth/reset-password/page.test.js`, `src/app/forge/accounts/add/page.test.jsx`, `src/app/forge/developer/engineering-brain/page.test.jsx`, `src/app/forge/developer/page.test.jsx`, `src/app/forge/developer/ui-improvement-manager/page.test.jsx`, `src/app/forge/doc-overview/page.test.jsx`, `src/app/forge/health/page.test.js`, `src/app/forge/page.test.js`, `src/app/forge/private-financing/page.test.jsx`, `src/app/forge/property/page.test.jsx`, `src/app/forge/rental/page.test.jsx`, `src/app/forge/reservations/page.test.jsx`, `src/app/forge/work/[packageId]/page.test.jsx`, `src/app/forge/work/page.test.jsx`, `src/app/forge/workspace/page.test.jsx`, `src/app/import/page.test.js`, `src/app/page.test.js` |
| `src/app/forge/inbox/page.js:238` | ``forge:inbox-sources:${month}`` | yes | `src/app/auth/mfa/page.test.js`, `src/app/auth/page.test.js`, `src/app/auth/recovery/page.test.js`, `src/app/auth/reset-password/page.test.js`, `src/app/forge/accounts/add/page.test.jsx`, `src/app/forge/developer/engineering-brain/page.test.jsx`, `src/app/forge/developer/page.test.jsx`, `src/app/forge/developer/ui-improvement-manager/page.test.jsx`, `src/app/forge/doc-overview/page.test.jsx`, `src/app/forge/health/page.test.js`, `src/app/forge/page.test.js`, `src/app/forge/private-financing/page.test.jsx`, `src/app/forge/property/page.test.jsx`, `src/app/forge/rental/page.test.jsx`, `src/app/forge/reservations/page.test.jsx`, `src/app/forge/work/[packageId]/page.test.jsx`, `src/app/forge/work/page.test.jsx`, `src/app/forge/workspace/page.test.jsx`, `src/app/import/page.test.js`, `src/app/page.test.js` |
| `src/components/forge/rental/useRentalDashboardPayload.js:29` | `disabled ? null : RENTAL_DASHBOARD_PAYLOAD_SWR_KEY` | no | shared-hook regression |
