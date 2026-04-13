import { useMemo } from 'react';

function parseUserFromQuery() {
  if (typeof window === 'undefined') return { user: null, error: 'Browser context not available.' };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('user');
  if (!raw) return { user: null, error: 'No user data found in callback URL.' };

  try {
    return { user: JSON.parse(decodeURIComponent(raw)), error: '' };
  } catch {
    try {
      return { user: JSON.parse(raw), error: '' };
    } catch {
      return { user: null, error: 'Unable to decode user payload from callback URL.' };
    }
  }
}

function LoginSuccessPage() {
  const { user, error } = useMemo(() => parseUserFromQuery(), []);

  return (
    <main className="page app-shell">
      <section className="panel">
        <div className="panel-head">
          <h2>Login successful</h2>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {user ? (
          <div className="list-stack">
            <p>
              <strong>ID:</strong> {user.id || user.sub || '-'}
            </p>
            <p>
              <strong>Name:</strong> {user.name || '-'}
            </p>
            <p>
              <strong>Email:</strong> {user.email || '-'}
            </p>
            <p>
              <strong>Provider:</strong> {user.provider || '-'}
            </p>
            {user.picture ? (
              <p>
                <strong>Picture URL:</strong> {user.picture}
              </p>
            ) : null}
            <pre>{JSON.stringify(user, null, 2)}</pre>
          </div>
        ) : null}
        <div className="item-actions">
          <a href="/">Back to app</a>
        </div>
      </section>
    </main>
  );
}

export default LoginSuccessPage;

