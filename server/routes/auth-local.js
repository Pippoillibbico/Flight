import { Router } from 'express';

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
  loginDummyPasswordHash
}) {
  const router = Router();

  router.post('/auth/register', authLimiter, async (req, res) => {
    if (!registrationEnabled) return sendMachineError(req, res, 403, 'registration_disabled');

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');

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

    // Email verification: send token if SMTP is configured; auto-verify otherwise.
    const emailVerifyRawToken = randomBytes(32).toString('hex');
    const emailVerifyTokenHash = hashEmailVerifyToken(emailVerifyRawToken);
    const emailVerifyExpiry = addDays(new Date(), 3).toISOString();

    const mailResult = await sendMail({
      to: createdUser.email,
      subject: 'Please verify your email address',
      text: `Welcome to Flight Suite! Verify your email: ${buildEmailVerifyUrl(emailVerifyRawToken)}`,
      html: `<p>Welcome to Flight Suite!</p><p>Please verify your email address:</p><p><a href="${buildEmailVerifyUrl(emailVerifyRawToken)}">Verify email</a></p><p>This link expires in 3 days.</p>`
    }).catch(() => ({ sent: false, skipped: true, reason: 'smtp_error' }));

    if (!mailResult.sent && mailResult.skipped) {
      // SMTP not configured or unavailable — auto-verify so the app stays usable.
      if (mailResult.reason === 'smtp_not_configured') {
        logger.warn({ userId: createdUser.id }, 'email_verification_auto_verified_smtp_not_configured');
      }
      await withDb(async (db) => {
        const u = db.users.find((item) => item.id === createdUser.id);
        if (u) u.emailVerified = true;
        return db;
      }).catch(() => {});
    } else {
      // Store verification token for later confirmation.
      await withDb(async (db) => {
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
      }).catch(() => {});
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
      }).catch(() => {});
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
          emailVerified: Boolean(createdUser.emailVerified)
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
          onboardingDone: Boolean(user.onboardingDone)
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
          onboardingDone: Boolean(user.onboardingDone)
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
      sendMail({
        to: user.email,
        subject: 'Password reset request',
        text: `Use this secure link to reset your password: ${resetUrl}`,
        html: `<p>Use this secure link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      }).catch(() => {});

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

    await logAuthEvent({ userId: verifiedUser.id, email: verifiedUser.email, type: 'email_verified', success: true, req }).catch(() => {});
    return res.json({ ok: true });
  });

  router.post('/auth/verify-email/resend', authLimiter, async (req, res) => {
    // Accepts { email } for unauthenticated resend (e.g. post-register before session expires).
    const rawEmail = String(req.body?.email || '').toLowerCase().trim();
    if (!rawEmail) return sendMachineError(req, res, 400, 'invalid_payload');

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
    }).catch(() => {});

    return res.json({ ok: true });
  });

  return router;
}
