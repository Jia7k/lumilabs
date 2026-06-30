function selectRole(role) {
  const users = {
    beta: { key: 'beta', name: 'Beta', role: 'business_owner' },
    alpha: { key: 'alpha', name: 'Alpha', role: 'investor' },
    victor: { key: 'victor', name: 'Victor', role: 'admin' },
  };

  const destinations = {
    beta:   'businessownerdashboard.html',
    alpha:  'investordashboard.html',
    victor: 'moderatordashboard.html',
  };

  const dest = destinations[role];
  if (dest) {
    localStorage.setItem('lumilabsSelectedUser', JSON.stringify(users[role]));
    window.location.href = dest;
  }
}
