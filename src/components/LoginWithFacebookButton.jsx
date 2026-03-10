function LoginWithFacebookButton() {
  const handleFacebookLogin = () => {
    window.location.href = '/api/auth/oauth/facebook/start';
  };

  return (
    <button type="button" onClick={handleFacebookLogin}>
      Login with Facebook
    </button>
  );
}

export default LoginWithFacebookButton;
