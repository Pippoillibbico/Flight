function LoginWithFacebookButton() {
  const handleFacebookLogin = () => {
    window.location.href = 'http://localhost:8080/auth/facebook';
  };

  return (
    <button type="button" onClick={handleFacebookLogin}>
      Login with Facebook
    </button>
  );
}

export default LoginWithFacebookButton;

