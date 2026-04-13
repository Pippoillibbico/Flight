function LoginWithGoogleButton() {
  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:8080/auth/google';
  };

  return (
    <button type="button" onClick={handleGoogleLogin}>
      Login with Google
    </button>
  );
}

export default LoginWithGoogleButton;

