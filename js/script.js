function selectRole(role) {
  const labels = {
    beta:   'Business Owner (Beta)',
    alpha:  'Investor (Alpha)',
    victor: 'Administrator (Victor)',
  };

  const hint = document.querySelector('.nav-hint');
  if (hint) {
    hint.textContent = 'Role selected: ' + (labels[role] || role);
  }

  console.log('Selected role:', role);

  // Extend here: redirect to role-specific dashboard pages
  // e.g. window.location.href = role + '-dashboard.html';
}