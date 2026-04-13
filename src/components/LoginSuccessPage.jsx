import { useEffect } from 'react';

function LoginSuccessPage() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Forward oauth params to the main app so App.jsx can handle session setup.
    const params = new URLSearchParams(window.location.search);
    const hasOauthParam = params.has('oauth');
    const target = hasOauthParam ? `/?${params.toString()}` : '/';
    window.location.replace(target);
  }, []);

  return (
    <main className="page app-shell">
      <section className="panel">
        <div className="panel-head">
          <h2>Signing you in&hellip;</h2>
        </div>
        <p className="muted">Please wait while we complete your sign-in.</p>
      </section>
    </main>
  );
}

export default LoginSuccessPage;
