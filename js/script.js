function selectRole(role) {
  const destinations = {
    beta:   'businessownerdashboard.html',
    alpha:  'investordashboard.html',
    victor: 'moderatordashboard.html',
  };

  const dest = destinations[role];
  if (dest) {
    window.location.href = dest;
  }
}