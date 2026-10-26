-- AlterTable: Tenant — billing integration fields
ALTER TABLE "tenants" ADD COLUMN "planSlug" TEXT;
ALTER TABLE "tenants" ADD COLUMN "lastBillingEventSeq" INTEGER;

-- AlterTable: User — mustChangePassword for provisioned accounts
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum: AuditAction — new values for team and billing
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_INVITED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_ROLE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'BILLING_EVENT_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_ACCEPTED';

-- CreateEnum: BillingEventOutcome
CREATE TYPE "BillingEventOutcome" AS ENUM ('APPLIED', 'DUPLICATE', 'OUT_OF_ORDER', 'IGNORED');

-- CreateTable: TenantEntitlement
CREATE TABLE "tenant_entitlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_entitlements_tenantId_key_key" ON "tenant_entitlements"("tenantId", "key");

ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: PlanEntitlementPreset
CREATE TABLE "plan_entitlement_presets" (
    "id" TEXT NOT NULL,
    "planSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,

    CONSTRAINT "plan_entitlement_presets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_entitlement_presets_planSlug_key_key" ON "plan_entitlement_presets"("planSlug", "key");

-- CreateTable: BillingEventReceipt
CREATE TABLE "billing_event_receipts" (
    "eventId" TEXT NOT NULL,
    "billingCustomerId" TEXT,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "payload" JSONB,
    "outcome" "BillingEventOutcome" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_event_receipts_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "billing_event_receipts_billingCustomerId_idx" ON "billing_event_receipts"("billingCustomerId");
CREATE INDEX "billing_event_receipts_tenantId_idx" ON "billing_event_receipts"("tenantId");

ALTER TABLE "billing_event_receipts" ADD CONSTRAINT "billing_event_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: JobLease
CREATE TABLE "job_leases" (
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("name")
);
