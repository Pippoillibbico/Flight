import { z } from 'zod';

export const BILLING_PROVIDER = 'stripe';

export const checkoutPayloadSchema = z
  .object({
    planType: z.enum(['pro', 'elite']),
    successUrl: z.string().trim().url().optional(),
    cancelUrl: z.string().trim().url().optional(),
    paymentMethodNonce: z.string().trim().optional(),
    deviceData: z.string().trim().optional()
  })
  .strict();

export const portalPayloadSchema = z
  .object({
    returnUrl: z.string().trim().url().optional()
  })
  .strict();

export const changePlanPayloadSchema = z
  .object({
    planType: z.enum(['pro', 'elite']),
    prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']).optional()
  })
  .strict();

export const cancelPayloadSchema = z
  .object({
    cancelAtPeriodEnd: z.coerce.boolean().optional().default(true)
  })
  .strict();

export const resumePayloadSchema = z
  .object({
    reactivateNow: z.coerce.boolean().optional().default(true)
  })
  .strict();
