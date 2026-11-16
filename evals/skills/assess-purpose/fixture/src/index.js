'use strict';
const express = require('express');
const patients = require('./routes/patients');
const appointments = require('./routes/appointments');
const { startReminderJob } = require('./services/reminders');

const app = express();
app.use(express.json());
app.use('/patients', patients);
app.use('/appointments', appointments);

app.listen(process.env.PORT || 3000);
startReminderJob();
