function ownerPasswordForm(action,email=''){
  return signInForm(action,(email?'<p>Sign in as <strong>'+esc(email)+'</strong>.</p>':
    input('clubEmail','Club email','type="email" required autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254"'))+
    input('clubPassword','Club password','type="password" required autocomplete="current-password" maxlength="72"')+'<p class="sub">Your password is not saved by this page.</p>','Sign in to club desk');
}
