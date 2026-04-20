import AdminBackofficeSection from '../../admin-dashboard/ui/AdminBackofficeSection';
import AdminBackofficeLoginSection from '../../admin-dashboard/ui/AdminBackofficeLoginSection';

export default function AdminMainSection({
  isAuthenticated,
  isAdminUser,
  authForm,
  authError,
  setAuthForm,
  submitAuth,
  adminDashboardLoading,
  adminDashboardError,
  adminDashboardReport,
  loadAdminBackofficeReport,
  closeAdminBackoffice
}) {
  if (!isAuthenticated) {
    return (
      <AdminBackofficeLoginSection
        authForm={authForm}
        authError={authError}
        onEmailChange={(value) => setAuthForm((prev) => ({ ...prev, email: value }))}
        onPasswordChange={(value) => setAuthForm((prev) => ({ ...prev, password: value }))}
        onSubmit={submitAuth}
        data-testid="admin-backoffice-login-section"
      />
    );
  }

  return (
    <AdminBackofficeSection
      isAuthorized={isAuthenticated && isAdminUser}
      loading={adminDashboardLoading}
      error={adminDashboardError}
      report={adminDashboardReport}
      onRefresh={loadAdminBackofficeReport}
      onBackToApp={closeAdminBackoffice}
      data-testid="admin-backoffice-section"
    />
  );
}

