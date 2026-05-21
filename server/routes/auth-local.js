import { Router } from 'express';
import { z } from 'zod';
import { getSaasPool } from '../lib/saas-db.js';
import { getEmailReadiness } from '../lib/email/email-readiness.js';
import { passwordResetTemplate } from '../lib/email/email-templates.js';

const resendVerifyEmailSchema = z
  .object({
    email: z.string().trim().email()
  })
  .strict();

export function buildAuthLocalRouter({
  authLimiter,
  registrationEnabled,
  registerSchema,
  loginSchema,
  loginMfaVerifySchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  emailVerifySchema,
  sendMachineError,
  withDb,
  readDb,
  hashPassword,
  verifyPassword,
  logAuthEvent,
  upsertUserLead,
  issueSessionTokens,
  buildSessionResponsePayload,
  resolveUserPlan,
  userIsLocked,
  registerFailedLogin,
  resetUserLoginFailures,
  hashPasswordResetToken,
  buildPasswordResetUrl,
  hashEmailVerifyToken,
  buildEmailVerifyUrl,
  sendMail,
  nanoid,
  randomBytes,
  addDays,
  logger,
  speakeasy,
  loginDummyPasswordHash,
  grantPremiumTrial = async () => null,
  checkAndExpireTrial = async () => false,
  isAdminEmail = () => false
}) {
  const router = Router();
  const saasPool = getSaasPool();

  router.post('/auth/register', authLimiter, async (req, res) => {
    if (!registrationEnabled) return sendMachineError(req, res, 403, 'registration_disabled');

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');
    const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const emailReadiness = getEmailReadiness(process.env);
    if (isProduction && emailReadiness.status === 'EMAIL_NOT_CONFIGURED') {
      logger.error({ request_id: req.id || null }, '[FATAL] SMTP must be configured in production to register users safely');
      return sendMachineError(req, res, 503, 'smtp_required_in_production');
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    let hashed = null;
    try {
      hashed = await hashPassword(password);
    } catch (error) {
      logger.error(
        {
          request_id: req.id || null,
          stage: 'hash_password',
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'register_service_unavailable'
      );
      return sendMachineError(req, res, 503, 'service_unavailable');
    }

    let createdUser = null;
    try {
      if (saasPool) {
        const existsRow = await saasPool.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
          [normalizedEmail]
        );
        if (existsRow.rows[0]?.id) {
          createdUser = null;
        } else {
          const userId = nanoid(10);
          const inserted = await saasPool.query(
            `INSERT INTO users (
               id, name, email, password_hash, is_premium, plan_type, plan_status, onboarding_done,
               mfa_enabled, mfa_secret, mfa_temp_secret, failed_login_count, lock_until,
               auth_channel, email_verified, created_at, updated_at
             )
             VALUES (
               $1, $2, $3, $4, false, 'free', 'active', false,
               false, NULL, NULL, 0, NULL, 'email_password', false, NOW(), NOW()
             )
             RETURNING id, name, email, is_premium, plan_type, plan_status, onboarding_done,
                       mfa_enabled, mfa_secret, mfa_temp_secret, failed_login_count, lock_until,
                       auth_channel, email_verified, created_at`,
            [userId, name, normalizedEmail, hashed]
          );
          const row = inserted.rows[0];
          createdUser = {
            id: row.id,
            name: row.name,
            email: row.email,
            passwordHash: hashed,
            isPremium: Boolean(row.is_premium),
            planType: String(row.plan_type || 'free'),
            planStatus: String(row.plan_status || 'active'),
            onboardingDone: Boolean(row.onboarding_done),
            mfaEnabled: Boolean(row.mfa_enabled),
            mfaSecret: row.mfa_secret || null,
            mfaTempSecret: row.mfa_temp_secret || null,
            failedLoginCount: Number(row.failed_login_count || 0),
            lockUntil: row.lock_until || null,
            authChannel: String(row.auth_channel || 'email_password'),
            emailVerified: Boolean(row.email_verified),
            createdAt: row.created_at || new Date().toISOString()
          };
        }
      } else {
        await withDb(async (db) => {
          const exists = db.users.some((u) => u.email === normalizedEmail);
          if (exists) return db;

          createdUser = {
            id: nanoid(10),
            name,
            email: normalizedEmail,
            passwordHash: hashed,
            isPremium: false,
            planType: 'free',
            planStatus: 'active',
            onboardingDone: false,
            mfaEnabled: false,
            mfaSecret: null,
            mfaTempSecret: null,
            failedLoginCount: 0,
            lockUntil: null,
            authChannel: 'email_password',
            emailVerified: false,
            createdAt: new Date().toISOString()
          };
          db.users.push(createdUser);
          return db;
        });
      }
    } catch (error) {
      logger.error(
        {
          request_id: req.id || null,
          stage: 'create_user',
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'register_service_unavailable'
      );
      return sendMachineError(req, res, 503, 'service_unavailable');
    }

    if (!createdUser) {
      await logAuthEvent({
        email: normalizedEmail,
        type: 'register_duplicate_email',
        success: false,
        req,
        detail: 'Email already registered.'
      }).catch((error) => {
        logger.warn(
          {
            request_id: req.id || null,
            stage: 'audit_duplicate',
            err_code: String(error?.code || '').slice(0, 60),
            err_message: String(error?.message || '').slice(0, 220)
          },
          'register_audit_write_failed'
        );
      });
      return sendMachineError(req, res, 409, 'email_already_exists');
    }

    // Email verification: production requires SMTP; dev/test can auto-verify when SMTP is not configured.
    const emailVerifyRawToken = randomBytes(32).toString('hex');
    const emailVerifyTokenHash = hashEmailVerifyToken(emailVerifyRawToken);
    const emailVerifyExpiry = addDays(new Date(), 3).toISOString();

    const mailResult = await sendMail({
      to: createdUser.email,
      subject: 'Please verify your email address',
      text: `Welcome to Flight Suite! Verify your email: ${buildEmailVerifyUrl(emailVerifyRawToken)}`,
      html: `<p>Welcome to Flight Suite!</p><p>Please verify your email address:</p><p><a href="${buildEmailVerifyUrl(emailVerifyRawToken)}">Verify email</a></p><p>This link expires in 3 days.</p>`
    }).catch((error) => {
      logger.warn(
        {
          request_id: req.id || null,
          user_id: createdUser.id,
          code: 'AUTH_SECURITY_EVENT',
          reason: 'email_verification_send_failed',
          route: req.path,
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'auth_email_send_failed'
      );
      return { sent: false, skipped: true, reason: 'smtp_error' };
    });

    if (!mailResult.sent && mailResult.skipped) {
      // Dev/test fallback only. In production this path is blocked by the guard above.
      if (mailResult.reason === 'smtp_not_configured' && !isProduction) {
        logger.warn({ userId: createdUser.id }, 'email_verification_auto_verified_smtp_not_configured');
        const markVerifiedPromise = saasPool
          ? saasPool.query('UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1', [createdUser.id])
          : withDb(async (db) => {
              const u = db.users.find((item) => item.id === createdUser.id);
              if (u) u.emailVerified = true;
              return db;
            });
        await markVerifiedPromise.catch((error) => {
          logger.warn(
            {
              request_id: req.id || null,
              user_id: createdUser.id,
              code: 'AUTH_SECURITY_EVENT',
              reason: 'email_verification_autoverify_update_failed',
              route: req.path,
              err_code: String(error?.code || '').slice(0, 60),
              err_message: String(error?.message || '').slice(0, 220)
            },
            'auth_email_verification_autoverify_update_failed'
          );
        });
      }
    } else {
      // Store verification token for later confirmation.
      const persistTokenPromise = saasPool
        ? saasPool.query(
            `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
             VALUES ($1, $2, $3, $4::timestamptz, NULL, NOW())`,
            [nanoid(12), createdUser.id, emailVerifyTokenHash, emailVerifyExpiry]
          )
        : withDb(async (db) => {
            db.emailVerificationTokens = db.emailVerificationTokens || [];
            db.emailVerificationTokens.push({
              id: nanoid(12),
              userId: createdUser.id,
              tokenHash: emailVerifyTokenHash,
              expiresAt: emailVerifyExpiry,
              usedAt: null,
              createdAt: new Date().toISOString()
            });
            db.emailVerificationTokens = db.emailVerificationTokens.slice(-10000);
            return db;
          });
      await persistTokenPromise.catch((error) => {
        logger.warn(
          {
            request_id: req.id || null,
            user_id: createdUser.id,
            code: 'AUTH_SECURITY_EVENT',
            reason: 'email_verification_token_store_failed',
            route: req.path,
            err_code: String(error?.code || '').slice(0, 60),
            err_message: String(error?.message || '').slice(0, 220)
          },
          'auth_email_verification_token_store_failed'
        );
      });
    }

    // Grant a time-limited premium trial to the new user (non-blocking).
    const trialResult = await grantPremiumTrial(createdUser.id).catch(() => null);
    if (trialResult) {
      createdUser.planType = trialResult.planType;
      createdUser.isPremium = true;
      createdUser.trialEndsAt = trialResult.trialEndsAt;
    }

    await upsertUserLead({
      userId: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      source: 'register',
      channel: 'email_password'
    }).catch((error) => {
      logger.warn(
        {
          request_id: req.id || null,
          user_id: createdUser.id,
          stage: 'upsert_user_lead',
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'register_lead_sync_failed_non_blocking'
      );
    });

    const csrfToken = nanoid(24);
    const family = nanoid(16);

    let accessToken = '';
    try {
      ({ accessToken } = await issueSessionTokens({ req, res, user: createdUser, csrfToken, family }));
    } catch (error) {
      logger.error(
        {
          request_id: req.id || null,
          user_id: createdUser.id,
          stage: 'issue_session_tokens',
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'register_service_unavailable'
      );
      await logAuthEvent({
        userId: createdUser.id,
        email: createdUser.email,
        type: 'register_session_issue_failed',
        success: false,
        req,
        detail: 'Session issuance failed.'
      }).catch((error) => {
        logger.warn(
          {
            request_id: req.id || null,
            user_id: createdUser.id,
            code: 'AUTH_SECURITY_EVENT',
            reason: 'register_session_issue_audit_write_failed',
            route: req.path,
            err_code: String(error?.code || '').slice(0, 60),
            err_message: String(error?.message || '').slice(0, 220)
          },
          'auth_register_session_issue_audit_write_failed'
        );
      });
      return sendMachineError(req, res, 503, 'service_unavailable');
    }

    await logAuthEvent({
      userId: createdUser.id,
      email: createdUser.email,
      type: 'register_success',
      success: true,
      req
    }).catch((error) => {
      logger.warn(
        {
          request_id: req.id || null,
          user_id: createdUser.id,
          stage: 'audit_success',
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'register_audit_write_failed'
      );
    });

    return res.status(201).json(
      buildSessionResponsePayload(accessToken, {
        session: { cookie: true, expiresInDays: 7, csrfToken },
        user: {
          id: createdUser.id,
          name: createdUser.name,
          email: createdUser.email,
          mfaEnabled: Boolean(createdUser.mfaEnabled),
          isPremium: Boolean(createdUser.isPremium),
          planType: resolveUserPlan(createdUser).planType,
          planStatus: resolveUserPlan(createdUser).planStatus,
          onboardingDone: Boolean(createdUser.onboardingDone),
          emailVerified: Boolean(createdUser.emailVerified),
          isInTrial: Boolean(createdUser.trialEndsAt && new Date(createdUser.trialEndsAt) > new Date()),
          trialEndsAt: createdUser.trialEndsAt ?? null,
          isAdmin: Boolean(isAdminEmail(createdUser.email))
        }
      })
    );
  });

  router.post('/auth/login', authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const email = parsed.data.email.toLowerCase();

    let user = null;
    await withDb(async (db) => {
      user = db.users.find((u) => u.email === email) ?? null;
      return null;
    });

    if (!user) {
      await verifyPassword(parsed.data.password, loginDummyPasswordHash).catch(() => false);
      await logAuthEvent({
        email,
        type: 'login_user_not_found',
        success: false,
        req
      });
      return res.status(401).json({ error: 'Wrong credentials.' });
    }

    if (userIsLocked(user)) {
      await logAuthEvent({
        userId: user.id,
        email: user.email,
        type: 'login_blocked_locked',
        success: false,
        req,
        detail: `Locked until ${user.lockUntil}`
      });
      return sendMachineError(req, res, 429, 'limit_exceeded', { reset_at: user.lockUntil });
    }

    if (!user.passwordHash) {
      await verifyPassword(parsed.data.password, loginDummyPasswordHash).catch(() => false);
      await logAuthEvent({
        userId: user.id,
        email: user.email,
        type: 'login_password_not_available',
        success: false,
        req
      });
      return res.status(401).json({ error: 'Wrong credentials.' });
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      await withDb(async (db) => {
        const hit = db.users.find((u) => u.id === user.id);
        if (hit) registerFailedLogin(hit);
        return db;
      });
      await logAuthEvent({
        userId: user.id,
        email: user.email,
        type: 'login_wrong_password',
        success: false,
        req
      });
      return res.status(401).json({ error: 'Wrong credentials.' });
    }

    if (user.mfaEnabled) {
      const ticket = nanoid(32);
      const expiresAt = addDays(new Date(), 1 / (24 * 12)).toISOString();
      await withDb(async (db) => {
        db.mfaChallenges = (db.mfaChallenges || [])
          .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
          .filter((item) => !(item.userId === user.id && !item.consumedAt));
        db.mfaChallenges.push({
          id: nanoid(10),
          ticket,
          userId: user.id,
          email: user.email,
          createdAt: new Date().toISOString(),
          expiresAt,
          consumedAt: null,
          attempts: 0
        });
        db.mfaChallenges = db.mfaChallenges.slice(-4000);
        return db;
      });
      await logAuthEvent({
        userId: user.id,
        email: user.email,
        type: 'login_mfa_challenge_issued',
        success: true,
        req
      });
      return res.status(202).json({ mfaRequired: true, ticket, expiresAt });
    }

    if (Number.isFinite(user.failedLoginCount) && user.failedLoginCount > 0) {
      await withDb(async (db) => {
        const hit = db.users.find((u) => u.id === user.id);
        if (hit) resetUserLoginFailures(hit);
        return db;
      });
    }

    // Expire trial if it has ended (non-blocking — failure silently ignored).
    const trialExpired = await checkAndExpireTrial(user.id).catch(() => false);
    if (trialExpired) {
      user.planType = 'free';
      user.isPremium = false;
      user.trialEndsAt = null;
    }

    const csrfToken = nanoid(24);
    const family = nanoid(16);
    user.authChannel = 'email_password';
    const { accessToken } = await issueSessionTokens({ req, res, user, csrfToken, family });
    await upsertUserLead({ userId: user.id, email: user.email, name: user.name, source: 'login', channel: 'email_password' });
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'login_success',
      success: true,
      req
    });
    return res.json(
      buildSessionResponsePayload(accessToken, {
        session: { cookie: true, expiresInDays: 7, csrfToken },
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mfaEnabled: Boolean(user.mfaEnabled),
          isPremium: Boolean(user.isPremium),
          planType: resolveUserPlan(user).planType,
          planStatus: resolveUserPlan(user).planStatus,
          onboardingDone: Boolean(user.onboardingDone),
          isInTrial: Boolean(user.trialEndsAt && new Date(user.trialEndsAt) > new Date()),
          trialEndsAt: user.trialEndsAt ?? null,
          isAdmin: Boolean(isAdminEmail(user.email))
        }
      })
    );
  });

  router.post('/auth/login/mfa', authLimiter, async (req, res) => {
    const parsed = loginMfaVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid MFA verify payload.' });

    const { ticket, code } = parsed.data;
    let challenge = null;
    let user = null;
    await withDb(async (db) => {
      challenge = (db.mfaChallenges || []).find((item) => item.ticket === ticket && !item.consumedAt) || null;
      if (!challenge) return db;
      if (new Date(challenge.expiresAt).getTime() <= Date.now()) return db;
      user = db.users.find((item) => item.id === challenge.userId) || null;
      if (!user || !user.mfaEnabled || !user.mfaSecret) return db;

      const valid = speakeasy.totp.verify({
        secret: String(user.mfaSecret || ''),
        encoding: 'base32',
        token: code,
        window: 1
      });
      if (!valid) {
        challenge.attempts = (challenge.attempts || 0) + 1;
        if (challenge.attempts >= 5) {
          challenge.consumedAt = new Date().toISOString();
        }
        return db;
      }

      challenge.consumedAt = new Date().toISOString();
      return db;
    });

    if (!challenge || !user) {
      return res.status(401).json({ error: 'Invalid or expired MFA ticket.' });
    }
    if (challenge.consumedAt && (challenge.attempts || 0) >= 5) {
      await logAuthEvent({ userId: user.id, email: user.email, type: 'login_mfa_ticket_locked', success: false, req });
      return res.status(401).json({ error: 'Too many MFA attempts. Start login again.' });
    }
    const valid = challenge.consumedAt && (challenge.attempts || 0) < 5;
    if (!valid) {
      await logAuthEvent({ userId: user.id, email: user.email, type: 'login_mfa_failed', success: false, req });
      return res.status(401).json({ error: 'Invalid MFA code.' });
    }

    if (Number.isFinite(user.failedLoginCount) && user.failedLoginCount > 0) {
      await withDb(async (db) => {
        const hit = db.users.find((u) => u.id === user.id);
        if (hit) resetUserLoginFailures(hit);
        return db;
      });
    }

    const trialExpiredMfa = await checkAndExpireTrial(user.id).catch(() => false);
    if (trialExpiredMfa) {
      user.planType = 'free';
      user.isPremium = false;
      user.trialEndsAt = null;
    }

    const csrfToken = nanoid(24);
    const family = nanoid(16);
    user.authChannel = 'email_mfa';
    const { accessToken } = await issueSessionTokens({ req, res, user, csrfToken, family });
    await upsertUserLead({ userId: user.id, email: user.email, name: user.name, source: 'login_mfa', channel: 'email_mfa' });
    await logAuthEvent({ userId: user.id, email: user.email, type: 'login_success_mfa', success: true, req });
    return res.json(
      buildSessionResponsePayload(accessToken, {
        session: { cookie: true, expiresInDays: 7, csrfToken },
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mfaEnabled: Boolean(user.mfaEnabled),
          isPremium: Boolean(user.isPremium),
          planType: resolveUserPlan(user).planType,
          planStatus: resolveUserPlan(user).planStatus,
          onboardingDone: Boolean(user.onboardingDone),
          isInTrial: Boolean(user.trialEndsAt && new Date(user.trialEndsAt) > new Date()),
          trialEndsAt: user.trialEndsAt ?? null,
          isAdmin: Boolean(isAdminEmail(user.email))
        }
      })
    );
  });

  router.post('/auth/password-reset/request', authLimiter, async (req, res) => {
    const parsed = passwordResetRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'validation_failed', message: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const normalizedEmail = parsed.data.email.toLowerCase();
    let user = null;
    await withDb(async (db) => {
      user = db.users.find((item) => item.email === normalizedEmail) || null;
      db.passwordResetTokens = (db.passwordResetTokens || []).filter((entry) => !entry.usedAt && new Date(entry.expiresAt).getTime() > Date.now());
      return db;
    });

    if (user) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashPasswordResetToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await withDb(async (db) => {
        db.passwordResetTokens = db.passwordResetTokens || [];
        db.passwordResetTokens.push({
          id: nanoid(12),
          userId: user.id,
          tokenHash,
          expiresAt,
          usedAt: null,
          createdAt: new Date().toISOString()
        });
        db.passwordResetTokens = db.passwordResetTokens.slice(-5000);
        return db;
      });

      const resetUrl = buildPasswordResetUrl(rawToken);
      const template = passwordResetTemplate({
        resetUrl,
        managePreferencesUrl: `${process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173'}/account/email-preferences`,
        privacyUrl: `${process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173'}/privacy`
      });
      sendMail({
        to: user.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        type: 'service'
      }).catch((error) => {
        logger.warn(
          {
            request_id: req.id || null,
            user_id: user.id,
            code: 'AUTH_SECURITY_EVENT',
            reason: 'password_reset_email_send_failed',
            route: req.path,
            err_code: String(error?.code || '').slice(0, 60),
            err_message: String(error?.message || '').slice(0, 220)
          },
          'auth_password_reset_email_send_failed'
        );
      });

      await logAuthEvent({
        userId: user.id,
        email: user.email,
        type: 'password_reset_requested',
        success: true,
        req
      });
    }

    return res.json({ ok: true });
  });

  router.post('/auth/password-reset/confirm', authLimiter, async (req, res) => {
    const parsed = passwordResetConfirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'validation_failed', message: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const tokenHash = hashPasswordResetToken(parsed.data.token);
    const hashed = await hashPassword(parsed.data.password);

    // Validate AND mark token as used atomically inside a single withDb call
    // to prevent race conditions where two concurrent requests use the same token.
    let confirmedUser = null;
    let invalidToken = false;
    await withDb(async (db) => {
      const nowIso = new Date().toISOString();
      const tokenRow = (db.passwordResetTokens || []).find((entry) => entry.tokenHash === tokenHash);
      const tokenIsValid = Boolean(tokenRow && !tokenRow.usedAt && new Date(tokenRow.expiresAt).getTime() > Date.now());
      if (!tokenIsValid) {
        invalidToken = true;
        return db;
      }
      const dbUser = db.users.find((entry) => entry.id === tokenRow.userId);
      if (!dbUser) {
        invalidToken = true;
        return db;
      }
      // Mark ALL tokens for this user as used (invalidate siblings) and update password.
      db.passwordResetTokens = (db.passwordResetTokens || []).map((entry) => {
        if (entry.userId !== dbUser.id) return entry;
        return { ...entry, usedAt: entry.usedAt || nowIso };
      });
      dbUser.passwordHash = hashed;
      resetUserLoginFailures(dbUser);
      confirmedUser = { id: dbUser.id, email: dbUser.email };
      return db;
    });

    if (invalidToken || !confirmedUser) {
      return res.status(400).json({ error: 'invalid_or_expired_token', message: 'Invalid or expired reset token.' });
    }

    await logAuthEvent({
      userId: confirmedUser.id,
      email: confirmedUser.email,
      type: 'password_reset_confirmed',
      success: true,
      req
    });

    return res.json({ ok: true });
  });

  // ── Email verification ────────────────────────────────────────────────────
  router.post('/auth/verify-email', authLimiter, async (req, res) => {
    const parsed = emailVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');

    const tokenHash = hashEmailVerifyToken(parsed.data.token);
    let verifiedUser = null;
    let tokenInvalid = false;

    await withDb(async (db) => {
      const nowIso = new Date().toISOString();
      const tokens = db.emailVerificationTokens || [];
      const tokenRow = tokens.find((t) => t.tokenHash === tokenHash);
      if (!tokenRow || tokenRow.usedAt || new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
        tokenInvalid = true;
        return db;
      }
      const user = db.users.find((u) => u.id === tokenRow.userId);
      if (!user) { tokenInvalid = true; return db; }

      tokenRow.usedAt = nowIso;
      user.emailVerified = true;
      verifiedUser = { id: user.id, email: user.email };
      return db;
    });

    if (tokenInvalid || !verifiedUser) {
      return res.status(400).json({ error: 'invalid_or_expired_token', message: 'Invalid or expired verification token.' });
    }

    await logAuthEvent({ userId: verifiedUser.id, email: verifiedUser.email, type: 'email_verified', success: true, req }).catch((error) => {
      logger.warn(
        {
          request_id: req.id || null,
          user_id: verifiedUser.id,
          code: 'AUTH_SECURITY_EVENT',
          reason: 'email_verified_audit_write_failed',
          route: req.path,
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'auth_email_verified_audit_write_failed'
      );
    });
    return res.json({ ok: true });
  });

  router.post('/auth/verify-email/resend', authLimiter, async (req, res) => {
    // Accepts { email } for unauthenticated resend (e.g. post-register before session expires).
    const parsed = resendVerifyEmailSchema.safeParse(req.body || {});
    if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');
    const rawEmail = parsed.data.email.toLowerCase();

    let targetUser = null;
    await withDb(async (db) => {
      targetUser = db.users.find((u) => u.email === rawEmail) || null;
      return null;
    });

    // Always respond 200 to prevent email enumeration.
    if (!targetUser || targetUser.emailVerified) return res.json({ ok: true });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashEmailVerifyToken(rawToken);
    const expiresAt = addDays(new Date(), 3).toISOString();

    await withDb(async (db) => {
      db.emailVerificationTokens = (db.emailVerificationTokens || []).filter(
        (t) => t.userId !== targetUser.id || t.usedAt
      );
      db.emailVerificationTokens.push({
        id: nanoid(12), userId: targetUser.id, tokenHash,
        expiresAt, usedAt: null, createdAt: new Date().toISOString()
      });
      db.emailVerificationTokens = db.emailVerificationTokens.slice(-10000);
      return db;
    });

    sendMail({
      to: targetUser.email,
      subject: 'Verify your email address',
      text: `Verify your email: ${buildEmailVerifyUrl(rawToken)}`,
      html: `<p>Please verify your email address:</p><p><a href="${buildEmailVerifyUrl(rawToken)}">Verify email</a></p><p>This link expires in 3 days.</p>`
    }).catch((error) => {
      logger.warn(
        {
          request_id: req.id || null,
          user_id: targetUser.id,
          code: 'AUTH_SECURITY_EVENT',
          reason: 'email_verification_resend_send_failed',
          route: req.path,
          err_code: String(error?.code || '').slice(0, 60),
          err_message: String(error?.message || '').slice(0, 220)
        },
        'auth_email_verification_resend_send_failed'
      );
    });

    return res.json({ ok: true });
  });

  return router;
}
