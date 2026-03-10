function LoginWithGoogleButton() {
  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/oauth/google/start';
  };

  return (
    <button type="button" onClick={handleGoogleLogin}>
      Login with Google
    </button>
  );
}

export default LoginWithGoogleButton;
