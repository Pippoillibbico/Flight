import { z } from 'zod';
import { validateProps } from '../../../utils/validateProps';

const AdminBackofficeLoginSectionPropsSchema = z
  .object({
    authForm: z.object({
      email: z.string(),
      password: z.string()
    }),
    authError: z.string().optional().default(''),
    onEmailChange: z.function(),
    onPasswordChange: z.function(),
    onSubmit: z.function()
  })
  .passthrough();

function AdminBackofficeLoginSection(props) {
  const { authForm, authError, onEmailChange, onPasswordChange, onSubmit } = validateProps(
    AdminBackofficeLoginSectionPropsSchema,
    props,
    'AdminBackofficeLoginSection'
  );

  return (
    <section className="panel admin-backoffice-login" data-testid="admin-backoffice-login">
      <div className="panel-head">
        <h2>Admin login</h2>
      </div>
      <p className="muted">Use internal username and password to access the private backoffice dashboard.</p>

      <form className="form-stack admin-backoffice-login-form" data-testid="admin-backoffice-login-form" onSubmit={onSubmit}>
        <label>
          Username
          <input
            type="email"
            required
            autoComplete="username"
            value={authForm.email}
            onChange={(event) => onEmailChange(event.target.value)}
            data-testid="admin-backoffice-username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            value={authForm.password}
            onChange={(event) => onPasswordChange(event.target.value)}
            data-testid="admin-backoffice-password"
          />
        </label>
        <button type="submit" data-testid="admin-backoffice-login-submit">
          Sign in to backoffice
        </button>
      </form>

      {authError ? (
        <p className="error" data-testid="admin-backoffice-login-error">
          {authError}
        </p>
      ) : null}
    </section>
  );
}

export default AdminBackofficeLoginSection;
