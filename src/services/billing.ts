// src/services/billing.ts
// GCP Billing: account info via Cloud Billing API, cost data via BigQuery billing export.

import { google } from 'googleapis';
import { BigQuery } from '@google-cloud/bigquery';
import { log } from '../middleware/auth';

const PROJECT_ID = process.env.GCP_PROJECT_ID || '';
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const BILLING_BQ_DATASET = process.env.BILLING_BQ_DATASET || '';  // e.g. "billing_export"
const BILLING_BQ_TABLE = process.env.BILLING_BQ_TABLE || '';      // e.g. "gcp_billing_export_v1_XXXXXX"
const BILLING_BQ_PROJECT = process.env.BILLING_BQ_PROJECT || PROJECT_ID; // project that hosts the BQ dataset

async function getAuth() {
    return google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

// ─── Tier 1: Billing Account Info ────────────────────────────────────

export interface BillingInfo {
    billingAccountId: string | null;
    billingEnabled: boolean;
    billingConsoleUrl: string;
}

export async function getBillingInfo(projectId: string): Promise<BillingInfo> {
    log('billing.info.fetch', { projectId });
    const consoleUrl = `https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;

    if (!projectId) {
        return { billingAccountId: null, billingEnabled: false, billingConsoleUrl: consoleUrl };
    }

    try {
        const auth = await getAuth();
        const billing = google.cloudbilling({ version: 'v1', auth });
        const res = await billing.projects.getBillingInfo({ name: `projects/${projectId}` });
        const accountName = res.data.billingAccountName || '';
        const accountId = accountName.replace('billingAccounts/', '');

        return {
            billingAccountId: accountId || null,
            billingEnabled: res.data.billingEnabled === true,
            billingConsoleUrl: consoleUrl,
        };
    } catch (error: any) {
        log('billing.info.error', { projectId, error: error.message });
        return {
            billingAccountId: null,
            billingEnabled: false,
            billingConsoleUrl: consoleUrl,
        };
    }
}

// ─── Tier 2: Cost Data from BigQuery ─────────────────────────────────

export interface ServiceCost {
    service: string;
    cost: number;
}

export interface ProjectCost {
    costThisMonth: number | null;
    costLastMonth: number | null;
    currency: string;
    topServices: ServiceCost[];
    billingExportAvailable: boolean;
}

export async function getProjectCost(projectId: string): Promise<ProjectCost> {
    const noCostResult: ProjectCost = {
        costThisMonth: null,
        costLastMonth: null,
        currency: 'USD',
        topServices: [],
        billingExportAvailable: false,
    };

    if (!BILLING_BQ_DATASET || !BILLING_BQ_TABLE) {
        log('billing.cost.skip', { reason: 'BILLING_BQ_DATASET or BILLING_BQ_TABLE not configured' });
        return noCostResult;
    }

    try {
        const bq = new BigQuery({ projectId: BILLING_BQ_PROJECT });
        const tableRef = `\`${BILLING_BQ_PROJECT}.${BILLING_BQ_DATASET}.${BILLING_BQ_TABLE}\``;

        // Current month cost
        const [thisMonthRows] = await bq.query({
            query: `
                SELECT
                    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost,
                    currency
                FROM ${tableRef}
                WHERE project.id = @projectId
                  AND invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
                GROUP BY currency
                LIMIT 1
            `,
            params: { projectId },
        });

        // Last month cost
        const [lastMonthRows] = await bq.query({
            query: `
                SELECT
                    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost
                FROM ${tableRef}
                WHERE project.id = @projectId
                  AND invoice.month = FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))
            `,
            params: { projectId },
        });

        // Top services this month
        const [serviceRows] = await bq.query({
            query: `
                SELECT
                    service.description AS service,
                    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost
                FROM ${tableRef}
                WHERE project.id = @projectId
                  AND invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
                GROUP BY service.description
                HAVING cost > 0.01
                ORDER BY cost DESC
                LIMIT 5
            `,
            params: { projectId },
        });

        const costThisMonth = thisMonthRows.length > 0 ? Math.round((thisMonthRows[0].net_cost || 0) * 100) / 100 : 0;
        const costLastMonth = lastMonthRows.length > 0 ? Math.round((lastMonthRows[0].net_cost || 0) * 100) / 100 : 0;
        const currency = thisMonthRows.length > 0 && thisMonthRows[0].currency ? thisMonthRows[0].currency : 'USD';

        const topServices: ServiceCost[] = serviceRows.map((row: any) => ({
            service: row.service,
            cost: Math.round((row.cost || 0) * 100) / 100,
        }));

        log('billing.cost.success', { projectId, costThisMonth, costLastMonth, services: topServices.length });

        return {
            costThisMonth,
            costLastMonth,
            currency,
            topServices,
            billingExportAvailable: true,
        };
    } catch (error: any) {
        log('billing.cost.error', { projectId, error: error.message });
        return noCostResult;
    }
}

// ─── Combined: Full billing data ─────────────────────────────────────

export interface FullBillingData extends BillingInfo, ProjectCost { }

export async function getFullBillingData(projectId: string): Promise<FullBillingData> {
    const [info, cost] = await Promise.all([
        getBillingInfo(projectId),
        getProjectCost(projectId),
    ]);
    return { ...info, ...cost };
}
