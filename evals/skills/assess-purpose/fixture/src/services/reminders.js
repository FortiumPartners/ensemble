'use strict';
const cron = require('node-cron');
const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const db = require('../db');

// Every morning text the owner of each animal whose vaccination falls due within a week.
function startReminderJob() {
  cron.schedule('0 8 * * *', async () => {
    const due = db.prepare(`SELECT o.phone, p.name AS pet, v.vaccine, v.due_on FROM vaccinations v
      JOIN patients p ON p.id = v.patient_id JOIN owners o ON o.id = p.owner_id
      WHERE date(v.due_on) <= date('now', '+7 days')`).all();
    for (const d of due) {
      await twilio.messages.create({ to: d.phone, from: process.env.TWILIO_FROM, body: `${d.pet} is due for ${d.vaccine} on ${d.due_on}. Call the clinic to book.` });
    }
  });
}

module.exports = { startReminderJob };
