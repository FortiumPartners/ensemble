const app = document.getElementById('app');
fetch('/api/tides')
  .then((r) => r.json())
  .then((d) => { if (app) app.textContent = `Next high tide: ${d.nextHigh}`; });
